'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { newWarnings, warningId, levelAtLeast } = require('../lib/warnings');

const W = (fields) => ({
  level: 'yellow', phenomenon: 'PR', phenomenonName: 'Lluvias', probability: '40%-70%',
  headline: 'Acumulación de 40 mm en 12 horas', onset: '2026-10-23T18:00:00Z', expires: '2026-10-24T06:00:00Z',
  ...fields,
});

test('a warning fires once, and again only when its level or window changes', () => {
  const now = Date.parse('2026-10-23T12:00:00Z');
  let seen = [];
  let result = newWarnings([W({})], seen, now);
  assert.equal(result.fresh.length, 1);
  seen = result.seen;

  result = newWarnings([W({})], seen, now + 300_000);
  assert.equal(result.fresh.length, 0);

  result = newWarnings([W({ level: 'orange' })], result.seen, now + 600_000);
  assert.equal(result.fresh.length, 1);
  assert.equal(result.fresh[0].level, 'orange');
});

test('expired warnings are forgotten, so the store does not grow forever', () => {
  const now = Date.parse('2026-10-25T12:00:00Z');
  const seen = [warningId(W({})), 'stale-id-without-date'];
  const result = newWarnings([], seen, now);
  assert.deepEqual(result.seen, []);
});

test('a missing list is no warnings', () => {
  assert.deepEqual(newWarnings(undefined, [], Date.now()).fresh, []);
});

test('level comparison for the condition card', () => {
  assert.equal(levelAtLeast('orange', 'yellow'), true);
  assert.equal(levelAtLeast('yellow', 'orange'), false);
  assert.equal(levelAtLeast('red', 'red'), true);
  assert.equal(levelAtLeast('none', 'yellow'), false);
});

const { levelTransition, phenomenonActive, PHENOMENA } = require('../lib/warnings');

test('level transitions: cleared when the last warning goes, changed between levels', () => {
  assert.deepEqual(levelTransition('none', 'none'), []);
  assert.deepEqual(levelTransition('none', 'yellow'), [{ type: 'warning_level_changed', level: 'yellow', previous: 'none' }]);
  assert.deepEqual(levelTransition('yellow', 'orange'), [{ type: 'warning_level_changed', level: 'orange', previous: 'yellow' }]);
  assert.deepEqual(levelTransition('orange', 'none'), [
    { type: 'warning_level_changed', level: 'none', previous: 'orange' },
    { type: 'warning_cleared' },
  ]);
  // The first poll after start has no history: no transition is invented.
  assert.deepEqual(levelTransition(null, 'orange'), []);
});

test('a phenomenon warning at or above a level is active', () => {
  const ws = [{ phenomenon: 'PR', level: 'yellow' }, { phenomenon: 'VI', level: 'orange' }];
  assert.equal(phenomenonActive(ws, 'PR', 'yellow'), true);
  assert.equal(phenomenonActive(ws, 'PR', 'orange'), false);
  assert.equal(phenomenonActive(ws, 'VI', 'orange'), true);
  assert.equal(phenomenonActive(ws, 'TO', 'yellow'), false);
  assert.equal(phenomenonActive(undefined, 'TO', 'yellow'), false);
});

test('the phenomenon list matches the AEMET codes the server uses', () => {
  assert.deepEqual(PHENOMENA, ['PR', 'TO', 'NE', 'VI', 'CO', 'CA', 'BF', 'NI', 'PO', 'DP', 'AL']);
});
