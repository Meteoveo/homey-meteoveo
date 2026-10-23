'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  msToKmh,
  capabilityValues,
  highestWarningLevel,
  localTime,
} = require('../lib/convert');

test('m/s to km/h has a hand-checkable reference point', () => {
  assert.equal(msToKmh(10), 36);
  assert.equal(msToKmh(2.6), 9.4);
  assert.equal(msToKmh(null), null);
  assert.equal(msToKmh(undefined), null);
});

test('capability values come from the contract, null stays null', () => {
  const home = {
    current: {
      tempC: 23.1, humidityPct: 44, pressureHpa: null, windMs: 2.6, gustMs: 9.7,
      windBearingDeg: 113, iconKey: 'fatyolfelhos',
    },
    hourly: [{ at: '2026-10-23T13:00:00Z', uvIndex: 3 }],
    nextHour: { rainNow: false, rainSoon: true, rainStartsAt: '2026-10-23T13:20:00Z', rainEndsAt: null },
    warnings: [{ level: 'yellow' }, { level: 'orange' }],
  };
  const values = capabilityValues(home, { timezone: 'Europe/Madrid' });
  assert.equal(values.measure_temperature, 23.1);
  assert.equal(values.measure_humidity, 44);
  // A missing reading is not zero: null leaves the previous value alone in Homey.
  assert.equal(values.measure_pressure, null);
  assert.equal(values.measure_wind_strength, 9.4);
  assert.equal(values.measure_gust_strength, 34.9);
  assert.equal(values.measure_wind_angle, 113);
  assert.equal(values.measure_ultraviolet, 3);
  assert.equal(values.meteoveo_condition, 'fatyolfelhos');
  assert.equal(values.meteoveo_rain_soon, true);
  assert.equal(values.meteoveo_rain_start, '15:20');
  assert.equal(values.meteoveo_warning, 'orange');
});

test('without next-hour coverage the rain capabilities are null, not false', () => {
  const values = capabilityValues({ current: {}, hourly: [], nextHour: null, warnings: [] }, { timezone: 'Europe/Madrid' });
  assert.equal(values.meteoveo_rain_soon, null);
  assert.equal(values.meteoveo_rain_start, null);
  assert.equal(values.meteoveo_warning, 'none');
});

test('an unknown icon key falls back to ismeretlen', () => {
  const values = capabilityValues({ current: { iconKey: 'something-new' }, hourly: [], nextHour: null, warnings: [] }, { timezone: 'Europe/Madrid' });
  assert.equal(values.meteoveo_condition, 'ismeretlen');
});

test('highest warning level orders red over orange over yellow', () => {
  assert.equal(highestWarningLevel([]), 'none');
  assert.equal(highestWarningLevel(undefined), 'none');
  assert.equal(highestWarningLevel([{ level: 'yellow' }, { level: 'red' }, { level: 'orange' }]), 'red');
});

test('local time uses the Homey time zone, also across DST', () => {
  assert.equal(localTime('2026-10-23T13:20:00Z', 'Europe/Madrid'), '15:20');
  assert.equal(localTime('2026-12-01T13:20:00Z', 'Europe/Madrid'), '14:20');
  assert.equal(localTime('2026-12-01T13:20:00Z', 'Atlantic/Canary'), '13:20');
  assert.equal(localTime(null, 'Europe/Madrid'), null);
});
