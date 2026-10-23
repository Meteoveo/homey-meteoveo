'use strict';

/**
 * Comfort and household helpers for the Spanish use cases the Homey research
 * found (docs/marketing/homey-spanyol-igenyek-2026-10-23.md in the monorepo):
 * awnings and blinds (gusts, sun), heat and ventilation (feels-like, dew
 * point, tropical nights, cooler outside), and AEMET warning notices.
 * Calculations only — every input comes from the integration contract v1.
 */

const { isNumber, round, WARNING_LEVELS } = require('./convert');

const MAGNUS_A = 17.62;
const MAGNUS_B = 243.12;

function dewPoint(tempC, humidityPct) {
  if (!isNumber(tempC) || !isNumber(humidityPct) || humidityPct <= 0) return null;
  const gamma = Math.log(humidityPct / 100) + (MAGNUS_A * tempC) / (MAGNUS_B + tempC);
  return round((MAGNUS_B * gamma) / (MAGNUS_A - gamma), 1);
}

function comfortCapabilityValues(home) {
  const current = (home && home.current) || {};
  const hour = ((home && home.hourly) || [])[0] || {};
  return {
    'measure_temperature.feels_like': isNumber(hour.feelsLikeC) ? hour.feelsLikeC : null,
    'measure_temperature.dew_point': dewPoint(current.tempC, current.humidityPct),
  };
}

/** Strongest gust (km/h, rounded) expected within `hours`: 10-min steps first, then the hours. */
function maxGustWithin(home, hours, now) {
  const horizon = now + hours * 3600_000;
  const values = [];
  const take = (list) => {
    for (const item of list || []) {
      const t = Date.parse(item.at);
      if (!Number.isNaN(t) && t >= now - 3600_000 && t <= horizon && isNumber(item.gustMs)) values.push(item.gustMs);
    }
  };
  take(home && home.nextHour && home.nextHour.steps);
  take(home && home.hourly);
  return values.length ? Math.round(Math.max(...values) * 3.6) : null;
}

const SUNNY = new Set(['napos', 'reszben_felhos']);

/** Sun on the awning now: clear or partly cloudy, in daylight. null = unknown. */
function isSunny(home) {
  const current = (home && home.current) || {};
  if (!current.iconKey || current.iconKey === 'ismeretlen' || typeof current.isDaylight !== 'boolean') return null;
  return current.isDaylight && SUNNY.has(current.iconKey);
}

function localHour(ms, timezone) {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: timezone }).format(new Date(ms)));
}

/**
 * Tonight's minimum at least 20 °C. After midday "tonight" ends tomorrow
 * morning (the next day's minimum); before midday it is the night just gone.
 */
function tropicalNight(home, now, timezone, threshold = 20) {
  const days = (home && home.daily) || [];
  const day = days[localHour(now, timezone) >= 12 ? 1 : 0];
  if (!day || !isNumber(day.tempMinC)) return null;
  return day.tempMinC >= threshold;
}

/** Outside at least `margin` °C cooler than `indoorC` (a token the user drops in). */
function coolerOutside(home, indoorC, margin) {
  const outside = home && home.current ? home.current.tempC : null;
  if (!isNumber(outside) || !isNumber(indoorC)) return null;
  return outside <= indoorC - (isNumber(margin) ? margin : 0);
}

/**
 * Timeline notice for a fresh warning when its level reaches the device
 * setting (`off` | `yellow` | `orange` | `red`); null = no notice.
 */
function warningNotice(warning, setting, words, place, until) {
  if (!warning || setting === 'off' || !WARNING_LEVELS.includes(setting)) return null;
  if (WARNING_LEVELS.indexOf(warning.level) < WARNING_LEVELS.indexOf(setting)) return null;
  return words.template
    .replace('__level__', words.levels[warning.level] || warning.level)
    .replace('__phenomenon__', String(warning.phenomenonName || warning.phenomenon || '').toLowerCase())
    .replace('__place__', place || '')
    .replace('__until__', until || '');
}

module.exports = {
  dewPoint, comfortCapabilityValues, maxGustWithin, isSunny, tropicalNight, coolerOutside, warningNotice,
};
