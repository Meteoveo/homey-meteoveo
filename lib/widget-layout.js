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
// within 3 h) is the third one.

/** Every card the widget can show, in the default order, with its rules. */
const CARDS = Object.freeze({
  warning: Object.freeze({ conditional: true, default: 'auto' }),
  hero: Object.freeze({ conditional: false, default: 'always' }),
  metrics: Object.freeze({ conditional: false, default: 'always' }),
  nextHour: Object.freeze({ conditional: true, default: 'always' }),
  nowcast3h: Object.freeze({ conditional: true, default: 'always' }),
  hours: Object.freeze({ conditional: false, default: 'always' }),
  days: Object.freeze({ conditional: false, default: 'always' }),
});

const CARD_IDS = Object.freeze(Object.keys(CARDS));
const SHOW_VALUES = Object.freeze(['always', 'auto', 'never']);

/** The card forced to 'always' when a layout would otherwise show nothing on a dry day. */
const FALLBACK_CARD = 'hero';

/** More entries than this are ignored: the list has seven valid ids at most. */
const MAX_INPUT = 64;

function isConditional(id) {
  return !!(CARDS[id] && CARDS[id].conditional);
}

function defaultLayout() {
  return { cards: CARD_IDS.map((id) => ({ id, show: CARDS[id].default })), background: { ...DEFAULT_BACKGROUND } };
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
 * Where a card missing from a saved layout goes: right after the nearest
 * card that precedes it in the default order and is present (a new card
 * appears next to its neighbour, not at the end of a layout the user has
 * arranged); with no such card, at the start.
 */
function insertAtDefaultPosition(cards, id, show) {
  const before = CARD_IDS.slice(0, CARD_IDS.indexOf(id)).reverse();
  for (const prev of before) {
    const at = cards.findIndex((c) => c.id === prev);
    if (at >= 0) { cards.splice(at + 1, 0, { id, show }); return; }
  }
  cards.unshift({ id, show });
}

/**
 * A valid layout from any input: unknown ids dropped, duplicates removed
 * (first wins), missing ids inserted at their default relative position with
 * their default, invalid `show` replaced by the card's default, `auto` only
 * on conditional cards, and at least one card 'always'. Accepts
 * `{ cards: [...] }` or a bare array; anything else gives the default.
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
  for (const id of CARD_IDS) if (!seen.has(id)) insertAtDefaultPosition(cards, id, CARDS[id].default);
  if (!cards.some((c) => c.show === 'always')) cards.find((c) => c.id === FALLBACK_CARD).show = 'always';
  // Layouts saved before the background existed have none: the default (the photo).
  return { cards, background: normalizeBackground(input && !Array.isArray(input) ? input.background : null) };
}

// ---- Background ------------------------------------------------------------
//
// `background`: { mode, color, opacity }. mode 'weather' = the sky photo of the
// moment (today's look), 'color' = a solid colour, 'transparent' = the
// dashboard shows through. opacity 0-100 applies to the photo or the colour.

const BACKGROUND_MODES = Object.freeze(['weather', 'color', 'transparent']);
const DEFAULT_BACKGROUND = Object.freeze({ mode: 'weather', color: '#2b6fa8', opacity: 100 });

/** A six-digit lowercase hex colour from `#rgb` / `#rrggbb` input (any case), or null. */
function normalizeColor(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return '#' + v.slice(1).split('').map((c) => c + c).join('');
  return null;
}

/** A valid background from any input: unknown mode -> weather, bad colour -> default, opacity clamped to an integer 0-100. */
function normalizeBackground(input) {
  const src = input && typeof input === 'object' ? input : {};
  const mode = BACKGROUND_MODES.includes(src.mode) ? src.mode : DEFAULT_BACKGROUND.mode;
  const color = normalizeColor(src.color) || DEFAULT_BACKGROUND.color;
  // null / undefined / '' mean "not set" (the default), not zero.
  const n = src.opacity === null || src.opacity === undefined || src.opacity === '' ? NaN : Number(src.opacity);
  const opacity = Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : DEFAULT_BACKGROUND.opacity;
  return { mode, color, opacity };
}

/** The settings key for a widget instance, or null when the id is not usable as one. */
function layoutKey(instanceId) {
  return typeof instanceId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(instanceId) ? `widget-layout:${instanceId}` : null;
}

module.exports = {
  CARDS, CARD_IDS, SHOW_VALUES, FALLBACK_CARD, MAX_INPUT, BACKGROUND_MODES, DEFAULT_BACKGROUND,
  isConditional, defaultLayout, normalizeLayout, normalizeBackground, normalizeColor, layoutKey,
};
