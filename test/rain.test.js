'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { initialRainState, nextRainState } = require('../lib/rain');

const T0 = Date.parse('2026-10-23T12:00:00Z');
const min = (m) => T0 + m * 60_000;
const hour = (fields) => ({ rainNow: false, rainSoon: false, rainStartsAt: null, rainEndsAt: null, ...fields });

function run(sequence) {
  let state = initialRainState();
  const events = [];
  for (const [at, nextHour] of sequence) {
    const result = nextRainState(state, nextHour, at);
    state = result.state;
    for (const event of result.events) events.push({ at, ...event });
  }
  return { state, events };
}

test('dry to expected fires rain_expected once, with minutes until the start', () => {
  const { events } = run([
    [min(0), hour({})],
    [min(5), hour({ rainSoon: true, rainStartsAt: '2026-10-23T12:30:00Z' })],
    [min(10), hour({ rainSoon: true, rainStartsAt: '2026-10-23T12:30:00Z' })],
  ]);
  assert.deepEqual(events, [{ at: min(5), type: 'rain_expected', minutes: 25 }]);
});

test('expected then raining fires rain_started', () => {
  const { events } = run([
    [min(0), hour({ rainSoon: true, rainStartsAt: '2026-10-23T12:20:00Z' })],
    [min(20), hour({ rainNow: true, rainSoon: true, rainStartsAt: '2026-10-23T12:20:00Z' })],
  ]);
  assert.deepEqual(events.map((e) => e.type), ['rain_expected', 'rain_started']);
});

test('rain without a forecast still fires rain_started', () => {
  const { events } = run([
    [min(0), hour({})],
    [min(5), hour({ rainNow: true, rainSoon: true, rainStartsAt: '2026-10-23T12:05:00Z' })],
  ]);
  assert.deepEqual(events.map((e) => e.type), ['rain_started']);
});

test('rain_stopped needs two dry polls in a row, so one gap is not a stop', () => {
  const { events } = run([
    [min(0), hour({ rainNow: true, rainSoon: true })],
    [min(5), hour({})],
    [min(10), hour({ rainNow: true, rainSoon: true })],
    [min(15), hour({})],
    [min(20), hour({})],
  ]);
  assert.deepEqual(events.map((e) => [e.type, e.at]), [['rain_started', min(0)], ['rain_stopped', min(20)]]);
});

test('a withdrawn forecast does not fire again within the cooldown', () => {
  const { events } = run([
    [min(0), hour({ rainSoon: true, rainStartsAt: '2026-10-23T12:40:00Z' })],
    [min(5), hour({})],
    [min(10), hour({ rainSoon: true, rainStartsAt: '2026-10-23T12:40:00Z' })],
    [min(45), hour({})],
    [min(50), hour({ rainSoon: true, rainStartsAt: '2026-10-23T13:20:00Z' })],
  ]);
  assert.deepEqual(events.map((e) => [e.type, e.at]), [['rain_expected', min(0)], ['rain_expected', min(50)]]);
});

test('no coverage keeps the state and fires nothing', () => {
  const { events, state } = run([
    [min(0), hour({ rainNow: true, rainSoon: true })],
    [min(5), null],
    [min(10), null],
  ]);
  assert.deepEqual(events.map((e) => e.type), ['rain_started']);
  assert.equal(state.phase, 'raining');
});

test('the very first poll in the rain does not invent a start in the past', () => {
  // A fresh device during rain reports rain_started once: users expect the
  // Flow to run when the device learns it is raining, not to stay silent.
  const { events } = run([[min(0), hour({ rainNow: true, rainSoon: true })]]);
  assert.deepEqual(events.map((e) => e.type), ['rain_started']);
});

test('the state survives a JSON round trip (it is kept in the device store)', () => {
  const { state } = run([[min(0), hour({ rainSoon: true, rainStartsAt: '2026-10-23T12:30:00Z' })]]);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});
