'use strict';

/**
 * Lightning near the location (contract v1 section 7, EUMETSAT MTG-LI
 * flashes; MeteoVeo Plus, as in the app). The radii are the app's lightning
 * alert steps (ADR-0633): 15 / 30 / 50 km.
 *
 * `lightning` is `{ locked: true }` on a free account, `null` when the source
 * is down (no successful LI run in 30 minutes), otherwise the counts.
 *
 * Triggers fire per storm, not per poll: when strikes first appear within
 * 50 km and each time they come a ring closer. Moving away is not news; the
 * storm is over when nothing is left within 50 km.
 */

const RINGS = [15, 30, 50];

function open(lightning) {
  return lightning && lightning.locked === false ? lightning : null;
}

function ringOf(lightning) {
  const l = open(lightning);
  if (!l) return null;
  for (const ring of RINGS) if ((l[`count${ring}km`] || 0) > 0) return ring;
  return null;
}

function initialLightningState() {
  return { ring: null };
}

function nextLightningState(previous, lightning) {
  const state = { ...initialLightningState(), ...previous };
  const events = [];
  if (!open(lightning)) return { state, events };
  const ring = ringOf(lightning);
  if (ring !== null && (state.ring === null || ring < state.ring)) {
    events.push({ type: 'lightning_near', ring, nearestKm: lightning.nearestKm, bearingDeg: lightning.bearingDeg });
  }
  // Keep the closest ring of this storm until it is gone entirely.
  if (ring === null) state.ring = null;
  else if (state.ring === null || ring < state.ring) state.ring = ring;
  return { state, events };
}

const POINTS = {
  es: ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'],
  en: ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'],
};

function compass(bearingDeg, lang) {
  if (typeof bearingDeg !== 'number' || !Number.isFinite(bearingDeg)) return '';
  const points = POINTS[lang] || POINTS.en;
  return points[Math.round((((bearingDeg % 360) + 360) % 360) / 22.5) % 16];
}

/** Strikes within `radiusKm` (one of 15/30/50) in the window: true/false, 'locked', or null (down). */
function lightningWithin(lightning, radiusKm) {
  if (lightning && lightning.locked === true) return 'locked';
  const l = open(lightning);
  if (!l) return null;
  return (l[`count${radiusKm}km`] || 0) > 0;
}

function lightningCapability(lightning) {
  const l = open(lightning);
  return l && typeof l.nearestKm === 'number' ? l.nearestKm : null;
}

module.exports = {
  RINGS, ringOf, initialLightningState, nextLightningState, compass, lightningWithin, lightningCapability,
};
