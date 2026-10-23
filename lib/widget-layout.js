'use strict';

// The dashboard widget's card layout (order + on/off), saved per widget
// instance. Pure functions: whatever the widget sends is normalized here
// before it is stored or rendered, so a stale or malformed layout can never
// break the widget.

/** Every card the widget can show, in the default order (the full layout). */
const CARD_IDS = Object.freeze(['warning', 'hero', 'metrics', 'nextHour', 'hours', 'days']);

/** The card switched back on when a layout would leave nothing visible. */
const FALLBACK_CARD = 'hero';

/** More entries than this are ignored: the list has six valid ids at most. */
const MAX_INPUT = 64;

function defaultLayout() {
  return { cards: CARD_IDS.map((id) => ({ id, on: true })) };
}

/**
 * A valid layout from any input: unknown ids dropped, duplicates removed
 * (first wins), missing ids appended in default order and on, at least one
 * card on. Accepts `{ cards: [...] }` or a bare array; anything else gives the
 * default.
 */
function normalizeLayout(input) {
  const raw = input && Array.isArray(input.cards) ? input.cards : Array.isArray(input) ? input : [];
  const seen = new Set();
  const cards = [];
  for (const entry of raw.slice(0, MAX_INPUT)) {
    const id = entry && typeof entry.id === 'string' ? entry.id : null;
    if (!id || !CARD_IDS.includes(id) || seen.has(id)) continue;
    seen.add(id);
    cards.push({ id, on: entry.on !== false });
  }
  for (const id of CARD_IDS) if (!seen.has(id)) cards.push({ id, on: true });
  if (!cards.some((c) => c.on)) cards.find((c) => c.id === FALLBACK_CARD).on = true;
  return { cards };
}

/** The settings key for a widget instance, or null when the id is not usable as one. */
function layoutKey(instanceId) {
  return typeof instanceId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(instanceId) ? `widget-layout:${instanceId}` : null;
}

module.exports = { CARD_IDS, FALLBACK_CARD, MAX_INPUT, defaultLayout, normalizeLayout, layoutKey };
