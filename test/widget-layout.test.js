'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CARD_IDS, defaultLayout, normalizeLayout, layoutKey } = require('../lib/widget-layout');

const ids = (layout) => layout.cards.map((c) => c.id);

test('the default layout is every card, on, in the full order', () => {
  assert.deepEqual(defaultLayout(), { cards: CARD_IDS.map((id) => ({ id, on: true })) });
  assert.deepEqual(normalizeLayout(undefined), defaultLayout());
  assert.deepEqual(normalizeLayout(null), defaultLayout());
  assert.deepEqual(normalizeLayout('nonsense'), defaultLayout());
  assert.deepEqual(normalizeLayout({ cards: 'nonsense' }), defaultLayout());
});

test('a saved order and the switches are kept', () => {
  const saved = { cards: [{ id: 'days', on: true }, { id: 'hero', on: true }, { id: 'nextHour', on: false },
    { id: 'warning', on: true }, { id: 'metrics', on: false }, { id: 'hours', on: true }] };
  assert.deepEqual(normalizeLayout(saved), saved);
  assert.deepEqual(normalizeLayout(saved.cards), saved); // a bare array works too
});

test('unknown ids are dropped and duplicates removed, the first occurrence winning', () => {
  const out = normalizeLayout({ cards: [{ id: 'days', on: false }, { id: 'radar', on: true }, { id: 'days', on: true }, { id: 'hero' }, 42, null, { id: 7 }] });
  assert.deepEqual(ids(out), ['days', 'hero', 'warning', 'metrics', 'nextHour', 'hours']);
  assert.equal(out.cards[0].on, false);
  assert.equal(out.cards[1].on, true); // a missing `on` means on
});

test('ids missing from a saved layout are appended in default order, on', () => {
  const out = normalizeLayout({ cards: [{ id: 'hours', on: true }] });
  assert.deepEqual(ids(out), ['hours', 'warning', 'hero', 'metrics', 'nextHour', 'days']);
  assert.ok(out.cards.slice(1).every((c) => c.on));
});

test('at least one card stays on', () => {
  const out = normalizeLayout({ cards: CARD_IDS.map((id) => ({ id, on: false })) });
  assert.deepEqual(out.cards.filter((c) => c.on).map((c) => c.id), ['hero']);
});

test('`on` is a boolean whatever was sent', () => {
  const out = normalizeLayout({ cards: [{ id: 'hero', on: 'yes' }, { id: 'days', on: 0 }, { id: 'hours', on: null }] });
  assert.deepEqual(out.cards.slice(0, 3).map((c) => c.on), [true, true, true]);
  for (const c of out.cards) assert.equal(typeof c.on, 'boolean');
});

test('oversized input is cut, never iterated in full, and still yields a complete layout', () => {
  const huge = Array.from({ length: 10000 }, (_, i) => (i === 9999 ? { id: 'days', on: false } : { id: 'junk' + i }));
  const out = normalizeLayout({ cards: huge });
  assert.equal(out.cards.length, CARD_IDS.length);
  assert.equal(out.cards.find((c) => c.id === 'days').on, true); // beyond the cut: not seen
});

test('the settings key accepts only a plain instance id', () => {
  assert.equal(layoutKey('abc-123_X'), 'widget-layout:abc-123_X');
  assert.equal(layoutKey(''), null);
  assert.equal(layoutKey(undefined), null);
  assert.equal(layoutKey('a b'), null);
  assert.equal(layoutKey('x'.repeat(81)), null);
  assert.equal(layoutKey({ toString: () => 'abc' }), null);
});
