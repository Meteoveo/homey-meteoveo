'use strict';

// The dashboard widget's card layout (order + when each card shows), saved
// per widget instance. Pure functions: whatever the widget sends is
// normalized here before it is stored or rendered, so a stale or malformed
// layout can never break the widget.
//
// `show` per card: 'always' | 'auto' | 'never'. 'auto' exists only on the
// CONDITIONAL cards — those with a natural "is there anything to say?" test
// (rain in the next hour, an active warning); on the others it is read as
// 'always'. A future `nowcast3h` card (our own 0–3 h forecast; auto = rain
// within 3 h) joins the table below once the server sends its fields.

/** Every card the widget can show, in the default order, with its rules. */
const CARDS = Object.freeze({
  warning: Object.freeze({ conditional: true, default: 'auto' }),
  hero: Object.freeze({ conditional: false, default: 'always' }),
  metrics: Object.freeze({ conditional: false, default: 'always' }),
  nextHour: Object.freeze({ conditional: true, default: 'always' }),
  hours: Object.freeze({ conditional: false, default: 'always' }),
  days: Object.freeze({ conditional: false, default: 'always' }),
});

const CARD_IDS = Object.freeze(Object.keys(CARDS));
const SHOW_VALUES = Object.freeze(['always', 'auto', 'never']);

/** The card forced to 'always' when a layout would otherwise show nothing on a dry day. */
const FALLBACK_CARD = 'hero';

/** More entries than this are ignored: the list has six valid ids at most. */
const MAX_INPUT = 64;

function isConditional(id) {
  return !!(CARDS[id] && CARDS[id].conditional);
}

function defaultLayout() {
  return { cards: CARD_IDS.map((id) => ({ id, show: CARDS[id].default })) };
}

/**
 * The `show` of one saved entry. Layouts saved before the three states had
 * `on: true | false`: `on: false` is 'never'; `on: true` is what the card did
 * then — 'always', except on a conditional card whose default is 'auto'
 * (the warning band only ever appeared when there was a warning, and a
 * migration must not make a quiet "no warnings" band appear overnight).
 */
function showOf(id, entry) {
  let show = entry.show;
  if (show === undefined && typeof entry.on === 'boolean') show = entry.on ? CARDS[id].default : 'never';
  if (!SHOW_VALUES.includes(show)) show = CARDS[id].default;
  if (show === 'auto' && !isConditional(id)) show = 'always';
  return show;
}

/**
 * A valid layout from any input: unknown ids dropped, duplicates removed
 * (first wins), missing ids appended in default order with their default,
 * invalid `show` replaced by the card's default, `auto` only on conditional
 * cards, and at least one card 'always'. Accepts `{ cards: [...] }` or a bare
 * array; anything else gives the default.
 */
function normalizeLayout(input) {
  const raw = input && Array.isArray(input.cards) ? input.cards : Array.isArray(input) ? input : [];
  const seen = new Set();
  const cards = [];
  for (const entry of raw.slice(0, MAX_INPUT)) {
    const id = entry && typeof entry.id === 'string' ? entry.id : null;
    if (!id || !CARDS[id] || seen.has(id)) continue;
    seen.add(id);
    cards.push({ id, show: showOf(id, entry) });
  }
  for (const id of CARD_IDS) if (!seen.has(id)) cards.push({ id, show: CARDS[id].default });
  if (!cards.some((c) => c.show === 'always')) cards.find((c) => c.id === FALLBACK_CARD).show = 'always';
  return { cards };
}

/** The settings key for a widget instance, or null when the id is not usable as one. */
function layoutKey(instanceId) {
  return typeof instanceId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(instanceId) ? `widget-layout:${instanceId}` : null;
}

module.exports = { CARDS, CARD_IDS, SHOW_VALUES, FALLBACK_CARD, MAX_INPUT, isConditional, defaultLayout, normalizeLayout, layoutKey };
