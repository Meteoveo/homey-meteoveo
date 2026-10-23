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
 * `capabilities`: the Homey capabilities a source device may offer for this
 * measurement (device mode). An empty list means Flow cards only.
 * Bounds apply after conversion, in the transmitted unit; the server enforces
 * the same limits.
 */
const MEASUREMENTS = Object.freeze([
  {
    key: 'temperature', field: 'tempf', capabilities: ['measure_temperature'],
    converters: { '°C': cToF, C: cToF, '°F': identity, F: identity }, min: -80, max: 150, decimals: 2,
  },
  {
    key: 'humidity', field: 'humidity', capabilities: ['measure_humidity'],
    converters: { '%': identity }, min: 0, max: 100, decimals: 2,
  },
  {
    // Station (absolute) pressure; the server reduces it to sea level.
    key: 'pressure', field: 'absbaromin', capabilities: ['measure_pressure'],
    converters: { hPa: (v) => v / HPA_PER_INHG, mbar: (v) => v / HPA_PER_INHG, inHg: identity },
    min: 0, max: 40, decimals: 4,
  },
  {
    key: 'wind_speed', field: 'windspeedmph', capabilities: ['measure_wind_strength'],
    converters: { 'm/s': (v) => v * MPH_PER_MS, 'km/h': (v) => v * MPH_PER_KMH, mph: identity },
    min: 0, max: 250, decimals: 2,
  },
  {
    key: 'wind_gust', field: 'windgustmph', capabilities: ['measure_gust_strength'],
    converters: { 'm/s': (v) => v * MPH_PER_MS, 'km/h': (v) => v * MPH_PER_KMH, mph: identity },
    min: 0, max: 250, decimals: 2,
  },
  {
    key: 'wind_direction', field: 'winddir', capabilities: ['measure_wind_angle'],
    converters: { '°': identity, deg: identity }, min: 0, max: 360, decimals: 2,
  },
  {
    // Rainfall since local midnight. In device mode it is derived from a
    // cumulative `meter_rain` by DailyRain below.
    key: 'daily_rain', field: 'dailyrainin', capabilities: ['meter_rain'],
    converters: { mm: (v) => v / MM_PER_INCH, in: identity }, min: 0, max: 40, decimals: 4,
  },
  {
    key: 'solar_radiation', field: 'solarradiation', capabilities: [],
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

/**
 * Daily rainfall from a cumulative counter. Homey weather apps expose
 * `meter_rain` with different meanings (since pairing, since their own
 * midnight); counting from the first value of the local day and carrying over
 * resets gives "since local midnight" in every case.
 */
class DailyRain {
  constructor({ day = null, baseline = 0, offset = 0, last = null } = {}) {
    Object.assign(this, { day, baseline, offset, last });
  }

  update(value, day) {
    if (day !== this.day || this.last == null) {
      Object.assign(this, { day, baseline: value, offset: 0, last: value });
      return 0;
    }
    if (value < this.last) {
      this.offset += this.last - this.baseline;
      this.baseline = 0;
    }
    this.last = value;
    return round(this.offset + value - this.baseline, 2);
  }

  toJSON() {
    return { day: this.day, baseline: this.baseline, offset: this.offset, last: this.last };
  }

  static fromJSON(json) {
    return new DailyRain(json || {});
  }
}

module.exports = { MEASUREMENTS, buildWuParams, freshReadings, DailyRain };
