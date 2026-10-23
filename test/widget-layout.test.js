'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CARDS, CARD_IDS, defaultLayout, normalizeLayout, layoutKey, isConditional } = require('../lib/widget-layout');

const ids = (layout) => layout.cards.map((c) => c.id);
const showOf = (layout, id) => layout.cards.find((c) => c.id === id).show;

test('the default layout is every card in the full order; warning auto, the rest always', () => {
  assert.deepEqual(ids(defaultLayout()), ['warning', 'hero', 'metrics', 'nextHour', 'nowcast3h', 'hours', 'days']);
  assert.equal(showOf(defaultLayout(), 'warning'), 'auto');
  for (const id of CARD_IDS.filter((x) => x !== 'warning')) assert.equal(showOf(defaultLayout(), id), 'always');
  assert.deepEqual(normalizeLayout(undefined), defaultLayout());
  assert.deepEqual(normalizeLayout(null), defaultLayout());
  assert.deepEqual(normalizeLayout('nonsense'), defaultLayout());
  assert.deepEqual(normalizeLayout({ cards: 'nonsense' }), defaultLayout());
});

test('warning, nextHour and nowcast3h are the conditional cards', () => {
  assert.deepEqual(CARD_IDS.filter(isConditional), ['warning', 'nextHour', 'nowcast3h']);
  assert.equal(isConditional('radar'), false);
  assert.equal(CARDS.nextHour.default, 'always');
  assert.equal(CARDS.nowcast3h.default, 'always');
});

test('a saved order and the three states are kept', () => {
  const saved = { cards: [{ id: 'days', show: 'always' }, { id: 'hero', show: 'always' }, { id: 'nextHour', show: 'auto' }, { id: 'nowcast3h', show: 'never' },
    { id: 'warning', show: 'never' }, { id: 'metrics', show: 'never' }, { id: 'hours', show: 'always' }] };
  assert.deepEqual(normalizeLayout(saved), saved);
  assert.deepEqual(normalizeLayout(saved.cards), saved); // a bare array works too
});

test('layouts saved with on/off migrate: off is never, on is what the card did then', () => {
  const old = { cards: [{ id: 'days', on: true }, { id: 'hero', on: true }, { id: 'nextHour', on: false },
    { id: 'warning', on: true }, { id: 'metrics', on: false }, { id: 'hours', on: true }] };
  const out = normalizeLayout(old);
  // The card that did not exist yet sits next to its neighbour, not at the end.
  assert.deepEqual(ids(out), ['days', 'hero', 'nextHour', 'nowcast3h', 'warning', 'metrics', 'hours']);
  assert.equal(showOf(out, 'nowcast3h'), 'always');
  assert.equal(showOf(out, 'days'), 'always');
  assert.equal(showOf(out, 'nextHour'), 'never');
  assert.equal(showOf(out, 'metrics'), 'never');
  // The band appeared only with a warning before: 'on' keeps that, it does not become a permanent band.
  assert.equal(showOf(out, 'warning'), 'auto');
  assert.equal(showOf(normalizeLayout({ cards: [{ id: 'warning', on: false }] }), 'warning'), 'never');
  assert.equal(showOf(normalizeLayout({ cards: [{ id: 'nextHour', on: true }] }), 'nextHour'), 'always');
  for (const c of out.cards) assert.equal('on' in c, false);
});

test('`show` wins over a stray `on`, and an invalid `show` falls back to the card default', () => {
  assert.equal(showOf(normalizeLayout({ cards: [{ id: 'hours', show: 'never', on: true }] }), 'hours'), 'never');
  assert.equal(showOf(normalizeLayout({ cards: [{ id: 'hours', show: 'sometimes' }] }), 'hours'), 'always');
  assert.equal(showOf(normalizeLayout({ cards: [{ id: 'warning', show: 42 }] }), 'warning'), 'auto');
  assert.equal(showOf(normalizeLayout({ cards: [{ id: 'nextHour', show: null }] }), 'nextHour'), 'always');
  assert.equal(showOf(normalizeLayout({ cards: [{ id: 'days' }] }), 'days'), 'always');
});

test('`auto` is only kept on conditional cards; elsewhere it reads as always', () => {
  const out = normalizeLayout({ cards: [{ id: 'hero', show: 'auto' }, { id: 'days', show: 'auto' }, { id: 'nextHour', show: 'auto' }, { id: 'warning', show: 'auto' }] });
  assert.equal(showOf(out, 'hero'), 'always');
  assert.equal(showOf(out, 'days'), 'always');
  assert.equal(showOf(out, 'nextHour'), 'auto');
  assert.equal(showOf(out, 'warning'), 'auto');
});

test('unknown ids are dropped and duplicates removed, the first occurrence winning', () => {
  const out = normalizeLayout({ cards: [{ id: 'days', show: 'never' }, { id: 'radar', show: 'always' }, { id: 'days', show: 'always' }, { id: 'hero' }, 42, null, { id: 7 }] });
  // Nothing precedes the missing warning: it goes to the start.
  assert.deepEqual(ids(out), ['warning', 'days', 'hero', 'metrics', 'nextHour', 'nowcast3h', 'hours']);
  assert.equal(showOf(out, 'days'), 'never');
  assert.equal(showOf(out, 'hero'), 'always');
});

test('a missing card is inserted after its preceding default neighbour that is present', () => {
  // The owner's case: a layout saved before nowcast3h existed, with its own order.
  const out = normalizeLayout({ cards: [{ id: 'days', show: 'always' }, { id: 'nextHour', show: 'always' }, { id: 'hero', show: 'always' },
    { id: 'warning', show: 'auto' }, { id: 'metrics', show: 'never' }, { id: 'hours', show: 'always' }] });
  assert.deepEqual(ids(out), ['days', 'nextHour', 'nowcast3h', 'hero', 'warning', 'metrics', 'hours']);
  assert.equal(showOf(out, 'nowcast3h'), 'always');
  // Its neighbour missing too: the nearest earlier default card that is present (metrics) is the anchor.
  const noNext = normalizeLayout({ cards: [{ id: 'days', show: 'always' }, { id: 'metrics', show: 'always' }, { id: 'hours', show: 'always' }] });
  assert.deepEqual(ids(noNext), ['warning', 'hero', 'days', 'metrics', 'nextHour', 'nowcast3h', 'hours']);
  // Nothing before it present: the start.
  const onlyLast = normalizeLayout({ cards: [{ id: 'days', show: 'always' }] });
  assert.deepEqual(ids(onlyLast), ['warning', 'hero', 'metrics', 'nextHour', 'nowcast3h', 'hours', 'days']);
  assert.equal(showOf(onlyLast, 'warning'), 'auto');
  assert.ok(onlyLast.cards.filter((c) => c.id !== 'warning').every((c) => c.show === 'always'));
});

test('at least one card is always: never/auto everywhere forces hero to always', () => {
  const none = normalizeLayout({ cards: CARD_IDS.map((id) => ({ id, show: 'never' })) });
  assert.deepEqual(none.cards.filter((c) => c.show === 'always').map((c) => c.id), ['hero']);
  const onlyAuto = normalizeLayout({ cards: [{ id: 'nextHour', show: 'auto' }, { id: 'warning', show: 'auto' }, { id: 'nowcast3h', show: 'auto' }, { id: 'hero', show: 'never' },
    { id: 'metrics', show: 'never' }, { id: 'hours', show: 'never' }, { id: 'days', show: 'never' }] });
  assert.equal(showOf(onlyAuto, 'hero'), 'always');
  assert.equal(showOf(onlyAuto, 'nextHour'), 'auto');
  // One 'always' anywhere is enough: nothing else is touched.
  const ok = normalizeLayout({ cards: [{ id: 'days', show: 'always' }, { id: 'hero', show: 'never' }] });
  assert.equal(showOf(ok, 'hero'), 'never');
});

test('oversized input is cut, never iterated in full, and still yields a complete layout', () => {
  const huge = Array.from({ length: 10000 }, (_, i) => (i === 9999 ? { id: 'days', show: 'never' } : { id: 'junk' + i }));
  const out = normalizeLayout({ cards: huge });
  assert.equal(out.cards.length, CARD_IDS.length);
  assert.equal(showOf(out, 'days'), 'always'); // beyond the cut: not seen
});

test('the settings key accepts only a plain instance id', () => {
  assert.equal(layoutKey('abc-123_X'), 'widget-layout:abc-123_X');
  assert.equal(layoutKey(''), null);
  assert.equal(layoutKey(undefined), null);
  assert.equal(layoutKey('a b'), null);
  assert.equal(layoutKey('x'.repeat(81)), null);
  assert.equal(layoutKey({ toString: () => 'abc' }), null);
});
