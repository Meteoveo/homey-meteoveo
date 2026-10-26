'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildWuParams, freshReadings } = require('../lib/wu');

test('every conversion has a reference point (same factors as ha-meteoveo)', () => {
  const params = buildWuParams({
    temperature: { value: 20, unit: '°C' },
    humidity: { value: 55, unit: '%' },
    pressure: { value: 1013.25, unit: 'hPa' },
    wind_speed: { value: 36, unit: 'km/h' },
    wind_gust: { value: 10, unit: 'm/s' },
    wind_direction: { value: 270, unit: '°' },
    daily_rain: { value: 25.4, unit: 'mm' },
    solar_radiation: { value: 800, unit: 'W/m²' },
  });
  assert.deepEqual(params, {
    tempf: 68,
    humidity: 55,
    absbaromin: 29.9213,
    windspeedmph: 22.37,
    windgustmph: 22.37,
    winddir: 270,
    dailyrainin: 1,
    solarradiation: 800,
  });
});

test('Homey default units: mbar is hPa, km/h for wind', () => {
  const params = buildWuParams({
    pressure: { value: 1000, unit: 'mbar' },
    wind_speed: { value: 10, unit: 'km/h' },
  });
  assert.equal(params.absbaromin, 29.53);
  assert.equal(params.windspeedmph, 6.21);
});

test('an unknown unit, a non-number or an out-of-range value is skipped, never guessed', () => {
  const params = buildWuParams({
    temperature: { value: 20, unit: 'K' },
    humidity: { value: 140, unit: '%' },
    wind_direction: { value: 'unknown', unit: '°' },
    wind_speed: { value: NaN, unit: 'km/h' },
    wind_gust: { value: null, unit: 'km/h' },
    pressure: { value: true, unit: 'hPa' },
  });
  assert.deepEqual(params, {});
});

test('zero is a valid reading', () => {
  assert.deepEqual(buildWuParams({ daily_rain: { value: 0, unit: 'mm' } }), { dailyrainin: 0 });
});

test('only fresh readings are uploaded', () => {
  const now = Date.parse('2026-10-23T12:00:00Z');
  const readings = {
    temperature: { value: 20, unit: '°C', at: now - 5 * 60_000 },
    humidity: { value: 50, unit: '%', at: now - 16 * 60_000 },
  };
  assert.deepEqual(Object.keys(freshReadings(readings, now, 15 * 60_000)), ['temperature']);
});
