'use strict';

/**
 * Measurement catalogue and upload payload builder — the Homey twin of
 * ha-meteoveo's wu_payload.py, with the same factors and bounds.
 *
 * Unit conversion is where a station bridge fails most quietly: a wrong factor
 * raises no error, it produces a plausible but false reading. Every conversion
 * therefore has a hand-checkable reference point in test/wu.test.js.
 */

const { isNumber, round } = require('./convert');

const MM_PER_INCH = 25.4;
const HPA_PER_INHG = 33.863886666667;
const MPH_PER_MS = 2.236936;
const MPH_PER_KMH = 0.621371;

const identity = (v) => v;
const cToF = (v) => v * 9 / 5 + 32;

/**
 * Readings arrive through the "Send … to MeteoVeo" Flow cards.
 * Bounds apply after conversion, in the transmitted unit; the server enforces
 * the same limits.
 */
const MEASUREMENTS = Object.freeze([
  {
    key: 'temperature', field: 'tempf',
    converters: { '°C': cToF, C: cToF, '°F': identity, F: identity }, min: -80, max: 150, decimals: 2,
  },
  {
    key: 'humidity', field: 'humidity',
    converters: { '%': identity }, min: 0, max: 100, decimals: 2,
  },
  {
    // Station (absolute) pressure; the server reduces it to sea level.
    key: 'pressure', field: 'absbaromin',
    converters: { hPa: (v) => v / HPA_PER_INHG, mbar: (v) => v / HPA_PER_INHG, inHg: identity },
    min: 0, max: 40, decimals: 4,
  },
  {
    key: 'wind_speed', field: 'windspeedmph',
    converters: { 'm/s': (v) => v * MPH_PER_MS, 'km/h': (v) => v * MPH_PER_KMH, mph: identity },
    min: 0, max: 250, decimals: 2,
  },
  {
    key: 'wind_gust', field: 'windgustmph',
    converters: { 'm/s': (v) => v * MPH_PER_MS, 'km/h': (v) => v * MPH_PER_KMH, mph: identity },
    min: 0, max: 250, decimals: 2,
  },
  {
    key: 'wind_direction', field: 'winddir',
    converters: { '°': identity, deg: identity }, min: 0, max: 360, decimals: 2,
  },
  {
    // Rainfall since local midnight.
    key: 'daily_rain', field: 'dailyrainin',
    converters: { mm: (v) => v / MM_PER_INCH, in: identity }, min: 0, max: 40, decimals: 4,
  },
  {
    key: 'solar_radiation', field: 'solarradiation',
    converters: { 'W/m²': identity, 'W/m2': identity }, min: 0, max: 2000, decimals: 2,
  },
]);

const BY_KEY = Object.freeze(Object.fromEntries(MEASUREMENTS.map((m) => [m.key, m])));

/**
 * readings: { key: { value, unit } }. Only usable values make it into the
 * result; an empty result means there is nothing worth uploading.
 */
function buildWuParams(readings) {
  const params = {};
  for (const [key, reading] of Object.entries(readings || {})) {
    const m = BY_KEY[key];
    if (!m || !reading) continue;
    // An unrecognised unit is skipped, not guessed: a missing field is
    // recoverable, a wrongly scaled one is not.
    const convert = m.converters[reading.unit];
    if (!convert || !isNumber(reading.value)) continue;
    const converted = convert(reading.value);
    if (!isNumber(converted) || converted < m.min || converted > m.max) continue;
    params[m.field] = round(converted, m.decimals);
  }
  return params;
}

function freshReadings(readings, now, maxAgeMs) {
  const out = {};
  for (const [key, reading] of Object.entries(readings || {})) {
    if (reading && isNumber(reading.at) && now - reading.at <= maxAgeMs) out[key] = reading;
  }
  return out;
}

module.exports = { MEASUREMENTS, buildWuParams, freshReadings };
