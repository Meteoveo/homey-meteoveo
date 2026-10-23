'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildWuParams, MEASUREMENTS, DailyRain, freshReadings } = require('../lib/wu');

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

test('the catalogue knows the Homey capability for each measurement', () => {
  const byKey = Object.fromEntries(MEASUREMENTS.map((m) => [m.key, m]));
  assert.deepEqual(byKey.temperature.capabilities, ['measure_temperature']);
  assert.deepEqual(byKey.pressure.capabilities, ['measure_pressure']);
  assert.deepEqual(byKey.wind_speed.capabilities, ['measure_wind_strength']);
  assert.deepEqual(byKey.daily_rain.capabilities, ['meter_rain']);
});

test('only fresh readings are uploaded', () => {
  const now = Date.parse('2026-10-23T12:00:00Z');
  const readings = {
    temperature: { value: 20, unit: '°C', at: now - 5 * 60_000 },
    humidity: { value: 50, unit: '%', at: now - 16 * 60_000 },
  };
  assert.deepEqual(Object.keys(freshReadings(readings, now, 15 * 60_000)), ['temperature']);
});

test('daily rain from a cumulative counter starts at zero each local day', () => {
  const rain = new DailyRain();
  assert.equal(rain.update(120.0, '2026-10-23'), 0);
  assert.equal(rain.update(121.5, '2026-10-23'), 1.5);
  assert.equal(rain.update(122.0, '2026-10-24'), 0);
  assert.equal(rain.update(123.2, '2026-10-24'), 1.2);
});

test('daily rain survives a counter reset during the day', () => {
  const rain = new DailyRain();
  rain.update(10, '2026-10-23');
  rain.update(12, '2026-10-23');
  // The source app reset its counter (re-pair, battery change, its own midnight).
  assert.equal(rain.update(0.5, '2026-10-23'), 2.5);
  assert.equal(rain.update(1.0, '2026-10-23'), 3);
});

test('daily rain state round-trips through the device store', () => {
  const rain = new DailyRain();
  rain.update(10, '2026-10-23');
  rain.update(11, '2026-10-23');
  const restored = DailyRain.fromJSON(JSON.parse(JSON.stringify(rain)));
  assert.equal(restored.update(12, '2026-10-23'), 2);
});
