'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { dailyCapabilityValues, dayForecast, precipChance } = require('../lib/forecast');

const home = {
  daily: [
    { date: '2026-10-23', iconKey: 'zapor', tempMaxC: 23.4, tempMinC: 12.6, precipProbPct: 60, precipMm: 4.2, uvIndex: 3 },
    { date: '2026-10-24', iconKey: 'napos', tempMaxC: 25, tempMinC: 13, precipProbPct: 0, precipMm: 0, uvIndex: 5 },
    { date: '2026-10-25', iconKey: 'borult', tempMaxC: null, tempMinC: 14, precipProbPct: null, precipMm: null, uvIndex: null },
  ],
};

test('daily values for the sub-capabilities, null stays null', () => {
  assert.deepEqual(dailyCapabilityValues(home), {
    'measure_temperature.max_today': 23.4,
    'measure_temperature.min_today': 12.6,
    'measure_temperature.max_tomorrow': 25,
    'measure_temperature.min_tomorrow': 13,
    'measure_ultraviolet.max_today': 3,
  });
  assert.deepEqual(dailyCapabilityValues({ daily: [] }), {
    'measure_temperature.max_today': null,
    'measure_temperature.min_today': null,
    'measure_temperature.max_tomorrow': null,
    'measure_temperature.min_tomorrow': null,
    'measure_ultraviolet.max_today': null,
  });
});

test('day forecast tokens, rounded, with a ready sentence', () => {
  const words = { conditions: { zapor: 'Chubascos', napos: 'Despejado', borult: 'Cubierto' }, days: ['Hoy', 'Mañana', 'Pasado mañana'],
    sentence: '__day__: __condition__, __max__°/__min__°, __chance__ % de lluvia', unknown: '–' };
  assert.deepEqual(dayForecast(home, 0, words), {
    max: 23, min: 13, condition: 'Chubascos', rain_chance: 60, rain_mm: 4.2, uv: 3,
    summary: 'Hoy: Chubascos, 23°/13°, 60 % de lluvia',
  });
  const third = dayForecast(home, 2, words);
  assert.equal(third.max, null);
  assert.equal(third.summary, 'Pasado mañana: Cubierto, –°/14°, – % de lluvia');
  assert.equal(dayForecast({ daily: [] }, 1, words), null);
});

test('rain chance for today and tomorrow', () => {
  assert.equal(precipChance(home, 0), 60);
  assert.equal(precipChance(home, 1), 0);
  assert.equal(precipChance(home, 2), null);
});
