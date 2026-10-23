'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  dewPoint, comfortCapabilityValues, maxGustWithin, isSunny, tropicalNight, coolerOutside, warningNotice,
} = require('../lib/comfort');

test('dew point (Magnus) has hand-checkable reference points', () => {
  assert.equal(dewPoint(20, 50), 9.3);
  assert.equal(dewPoint(30, 70), 23.9);
  assert.equal(dewPoint(null, 50), null);
  assert.equal(dewPoint(20, 0), null);
});

test('comfort capabilities: feels-like from the running hour, dew point from now', () => {
  const home = { current: { tempC: 20, humidityPct: 50 }, hourly: [{ feelsLikeC: 21.4 }] };
  assert.deepEqual(comfortCapabilityValues(home), {
    'measure_temperature.feels_like': 21.4,
    'measure_temperature.dew_point': 9.3,
  });
  assert.deepEqual(comfortCapabilityValues({ current: {}, hourly: [] }), {
    'measure_temperature.feels_like': null,
    'measure_temperature.dew_point': null,
  });
});

const T = Date.parse('2026-10-23T12:00:00Z');
const at = (h, m = 0) => new Date(T + h * 3600_000 + m * 60_000).toISOString();

test('strongest gust within a window, from the 10-min steps and the hours, in km/h', () => {
  const home = {
    nextHour: { steps: [{ at: at(0, 10), gustMs: 5 }, { at: at(0, 50), gustMs: 12 }] },
    hourly: [{ at: at(1), gustMs: 8 }, { at: at(4), gustMs: 15 }, { at: at(9), gustMs: 20 }],
  };
  assert.equal(maxGustWithin(home, 1, T), 43);
  assert.equal(maxGustWithin(home, 6, T), 54);
  assert.equal(maxGustWithin(home, 12, T), 72);
  assert.equal(maxGustWithin({ nextHour: null, hourly: [] }, 3, T), null);
});

test('sunny now: clear or partly cloudy in daylight', () => {
  assert.equal(isSunny({ current: { iconKey: 'napos', isDaylight: true } }), true);
  assert.equal(isSunny({ current: { iconKey: 'reszben_felhos', isDaylight: true } }), true);
  assert.equal(isSunny({ current: { iconKey: 'napos', isDaylight: false } }), false);
  assert.equal(isSunny({ current: { iconKey: 'borult', isDaylight: true } }), false);
  assert.equal(isSunny({ current: {} }), null);
});

test('tropical night: tonight\'s minimum (tomorrow\'s, after midday) at least 20 °C', () => {
  const home = { daily: [{ tempMinC: 18 }, { tempMinC: 21 }] };
  // 14:00 in Madrid: tonight's minimum is tomorrow's early-morning minimum.
  assert.equal(tropicalNight(home, Date.parse('2026-07-23T12:00:00Z'), 'Europe/Madrid'), true);
  // 08:00 in Madrid: the night that just ended belongs to today.
  assert.equal(tropicalNight(home, Date.parse('2026-07-23T06:00:00Z'), 'Europe/Madrid'), false);
  assert.equal(tropicalNight({ daily: [] }, T, 'Europe/Madrid'), null);
});

test('cooler outside than inside by at least a margin', () => {
  const home = { current: { tempC: 22 } };
  assert.equal(coolerOutside(home, 25, 2), true);
  assert.equal(coolerOutside(home, 23, 2), false);
  assert.equal(coolerOutside({ current: {} }, 25, 2), null);
});

test('warning notice only at or above the chosen level, with a readable text', () => {
  const words = { levels: { yellow: 'amarillo', orange: 'naranja', red: 'rojo' }, template: 'Aviso __level__ por __phenomenon__ en __place__, hasta las __until__' };
  const w = { level: 'orange', phenomenonName: 'Lluvias', expires: '2026-10-23T21:00:00Z' };
  assert.equal(warningNotice(w, 'off', words, 'Almiserà', '23:00'), null);
  assert.equal(warningNotice(w, 'red', words, 'Almiserà', '23:00'), null);
  assert.equal(warningNotice(w, 'orange', words, 'Almiserà', '23:00'), 'Aviso naranja por lluvias en Almiserà, hasta las 23:00');
  assert.equal(warningNotice({ ...w, level: 'yellow' }, 'yellow', words, 'Almiserà', '23:00'), 'Aviso amarillo por lluvias en Almiserà, hasta las 23:00');
});
