'use strict';

/**
 * AEMET warnings (Meteoalerta) for the "warning issued" trigger.
 *
 * A warning is identified by phenomenon, level and time window: an upgrade
 * from yellow to orange, or a moved window, is news and fires again; the same
 * warning seen on every poll is not. Seen ids are kept until their window has
 * passed, so a warning that briefly drops out of the feed does not fire twice.
 */

const { WARNING_LEVELS } = require('./convert');

function warningId(w) {
  return [w.phenomenon, w.level, w.onset, w.expires].join('|');
}

function expiresOf(id) {
  const parts = String(id).split('|');
  return parts.length === 4 ? Date.parse(parts[3]) : NaN;
}

function newWarnings(list, seen, now) {
  const current = (list || []).filter((w) => w && WARNING_LEVELS.includes(w.level) && w.level !== 'none');
  const known = new Set(seen || []);
  const fresh = current.filter((w) => !known.has(warningId(w)));

  const kept = new Set(current.map(warningId));
  for (const id of known) {
    if (expiresOf(id) > now) kept.add(id);
  }
  return { fresh, seen: [...kept] };
}

/** AEMET Meteoalerta phenomenon codes, as the MeteoVeo server names them (avisos-mapa/format.ts). */
const PHENOMENA = Object.freeze(['PR', 'TO', 'NE', 'VI', 'CO', 'CA', 'BF', 'NI', 'PO', 'DP', 'AL']);

/**
 * Highest-level transitions between two polls. `previous` null = no history
 * (first poll after start): nothing is invented.
 */
function levelTransition(previous, level) {
  if (previous == null || previous === level) return [];
  const events = [{ type: 'warning_level_changed', level, previous }];
  if (level === 'none') events.push({ type: 'warning_cleared' });
  return events;
}

function phenomenonActive(warnings, code, minimum) {
  return (warnings || []).some((w) => w && w.phenomenon === code && levelAtLeast(w.level, minimum));
}

function levelAtLeast(level, minimum) {
  const have = WARNING_LEVELS.indexOf(level);
  const need = WARNING_LEVELS.indexOf(minimum);
  return have > 0 && need > 0 && have >= need;
}

module.exports = { newWarnings, warningId, levelAtLeast, levelTransition, phenomenonActive, PHENOMENA };
