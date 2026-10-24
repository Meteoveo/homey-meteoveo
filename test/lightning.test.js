'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ringOf, initialLightningState, nextLightningState, compass, lightningWithin, lightningCapability,
} = require('../lib/lightning');

const L = (fields) => ({
  locked: false, windowMinutes: 30, nearestKm: null, bearingDeg: null,
  count15km: 0, count30km: 0, count50km: 0, lastStrikeAt: null, ageMinutes: null, source: 'eumetsat-li', ...fields,
});

test('the ring is the smallest of the app\'s radii (15/30/50 km) with strikes', () => {
  assert.equal(ringOf(L({})), null);
  assert.equal(ringOf(L({ count50km: 2, nearestKm: 41 })), 50);
  assert.equal(ringOf(L({ count30km: 1, count50km: 3, nearestKm: 22 })), 30);
  assert.equal(ringOf(L({ count15km: 1, count30km: 1, count50km: 1, nearestKm: 9 })), 15);
  assert.equal(ringOf({ locked: true }), null);
  assert.equal(ringOf(null), null);
});

test('a storm fires when it first appears and each time it comes a ring closer, not while it stays', () => {
  let s = initialLightningState();
  const step = (l) => { const r = nextLightningState(s, l); s = r.state; return r.events.map((e) => e.ring); };
  assert.deepEqual(step(L({})), []);
  assert.deepEqual(step(L({ count50km: 2, nearestKm: 44, bearingDeg: 270 })), [50]);
  assert.deepEqual(step(L({ count50km: 4, nearestKm: 40 })), []);
  assert.deepEqual(step(L({ count30km: 1, count50km: 4, nearestKm: 25 })), [30]);
  assert.deepEqual(step(L({ count15km: 1, count30km: 2, count50km: 5, nearestKm: 8 })), [15]);
  // Moving away is not news; the storm is over only when nothing is left within 50 km.
  assert.deepEqual(step(L({ count50km: 2, nearestKm: 45 })), []);
  assert.deepEqual(step(L({})), []);
  assert.deepEqual(step(L({ count50km: 1, nearestKm: 48 })), [50]);
});

test('locked or unavailable data changes nothing and fires nothing', () => {
  let s = initialLightningState();
  s = nextLightningState(s, L({ count30km: 1, count50km: 1, nearestKm: 20 })).state;
  for (const l of [{ locked: true }, null]) {
    const r = nextLightningState(s, l);
    assert.deepEqual(r.events, []);
    assert.deepEqual(r.state, s);
  }
});

test('events carry distance and bearing for the tokens', () => {
  const r = nextLightningState(initialLightningState(), L({ count30km: 1, count50km: 1, nearestKm: 17.4, bearingDeg: 245 }));
  assert.deepEqual(r.events, [{ type: 'lightning_near', ring: 30, nearestKm: 17.4, bearingDeg: 245 }]);
});

test('compass points in Spanish and English', () => {
  assert.equal(compass(0, 'es'), 'N');
  assert.equal(compass(245, 'es'), 'OSO');
  assert.equal(compass(245, 'en'), 'WSW');
  assert.equal(compass(359, 'en'), 'N');
  assert.equal(compass(null, 'es'), '');
});

test('strikes within a radius: unknown when locked or down', () => {
  assert.equal(lightningWithin(L({ count30km: 2 }), 30), true);
  assert.equal(lightningWithin(L({ count30km: 0, count50km: 3 }), 30), false);
  assert.equal(lightningWithin({ locked: true }, 30), 'locked');
  assert.equal(lightningWithin(null, 30), null);
});

test('capability: the nearest flash in km, null when locked, down or calm', () => {
  assert.equal(lightningCapability(L({ count50km: 1, nearestKm: 17.4 })), 17.4);
  assert.equal(lightningCapability(L({})), null);
  assert.equal(lightningCapability({ locked: true }), null);
  assert.equal(lightningCapability(null), null);
});
