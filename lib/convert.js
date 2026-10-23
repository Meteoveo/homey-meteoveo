'use strict';

/**
 * From the integration contract (docs/integracio-szerzodes-v1.md in the
 * MeteoVeo monorepo, `v: 1`) to Homey capability values.
 *
 * The contract fixes units in field names (…C, …Pct, …Hpa, …Ms, …Deg); Homey
 * capabilities expect °C, %, mbar, km/h and degrees. hPa and mbar are the same
 * unit, so only wind needs a factor. A missing value stays `null`: Homey keeps
 * the previous reading on null, while a zero would be a false measurement.
 */

/** MeteoVeo's own condition keys (`iconKey`), also the enum of meteoveo_condition. */
const ICON_KEYS = Object.freeze([
  'napos', 'reszben_felhos', 'fatyolfelhos', 'borult', 'eso', 'szemerkel',
  'zapor', 'zivatar', 'havazas', 'kod', 'ismeretlen',
]);

const WARNING_LEVELS = Object.freeze(['none', 'yellow', 'orange', 'red']);

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function round(value, decimals) {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function msToKmh(ms) {
  return isNumber(ms) ? round(ms * 3.6, 1) : null;
}

function numberOrNull(value) {
  return isNumber(value) ? value : null;
}

function highestWarningLevel(warnings) {
  let best = 0;
  for (const w of warnings || []) {
    const rank = WARNING_LEVELS.indexOf(w && w.level);
    if (rank > best) best = rank;
  }
  return WARNING_LEVELS[best];
}

/** "15:20" in the given IANA zone, or null. */
function localTime(iso, timezone) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
  }).format(date);
}

/** Local calendar date "2026-10-23" in the given zone (daily rain resets on it). */
function localDate(ms, timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timezone,
  }).format(new Date(ms));
}

function capabilityValues(home, { timezone }) {
  const current = (home && home.current) || {};
  const nextHour = home ? home.nextHour : null;
  const firstHour = (home && Array.isArray(home.hourly) && home.hourly[0]) || {};
  const iconKey = ICON_KEYS.includes(current.iconKey) ? current.iconKey : 'ismeretlen';

  return {
    measure_temperature: numberOrNull(current.tempC),
    measure_humidity: numberOrNull(current.humidityPct),
    measure_pressure: numberOrNull(current.pressureHpa),
    measure_wind_strength: msToKmh(current.windMs),
    measure_gust_strength: msToKmh(current.gustMs),
    measure_wind_angle: numberOrNull(current.windBearingDeg),
    // The contract has no current UV; the running hour's value is the honest one.
    measure_ultraviolet: numberOrNull(firstHour.uvIndex),
    meteoveo_condition: iconKey,
    // Outside next-hour coverage the answer is "unknown", not "no rain".
    meteoveo_rain_soon: nextHour ? Boolean(nextHour.rainSoon || nextHour.rainNow) : null,
    meteoveo_rain_start: nextHour ? localTime(nextHour.rainStartsAt, timezone) : null,
    meteoveo_warning: highestWarningLevel(home && home.warnings),
  };
}

module.exports = {
  ICON_KEYS,
  WARNING_LEVELS,
  msToKmh,
  capabilityValues,
  highestWarningLevel,
  localTime,
  localDate,
  isNumber,
  round,
};
