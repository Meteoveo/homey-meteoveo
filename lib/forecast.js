'use strict';

/**
 * Daily forecast for the sub-capabilities and the "get the forecast" action.
 * `daily[0]` is today, `daily[1]` tomorrow (contract v1). Missing values stay
 * null — a gap must never read as zero.
 */

const { isNumber, round } = require('./convert');

const num = (v) => (isNumber(v) ? v : null);

function dailyCapabilityValues(home) {
  const days = (home && home.daily) || [];
  const today = days[0] || {};
  const tomorrow = days[1] || {};
  return {
    'measure_temperature.max_today': num(today.tempMaxC),
    'measure_temperature.min_today': num(today.tempMinC),
    'measure_temperature.max_tomorrow': num(tomorrow.tempMaxC),
    'measure_temperature.min_tomorrow': num(tomorrow.tempMinC),
    'measure_ultraviolet.max_today': num(today.uvIndex),
  };
}

function precipChance(home, index) {
  const day = ((home && home.daily) || [])[index];
  return day ? num(day.precipProbPct) : null;
}

/**
 * Tokens for one day. `words`: { conditions: {iconKey: name}, days: [today, tomorrow, …],
 * sentence: '__day__: __condition__, __max__°/__min__°, __chance__ …', unknown: '–' }.
 */
function dayForecast(home, index, words) {
  const day = ((home && home.daily) || [])[index];
  if (!day) return null;
  const max = isNumber(day.tempMaxC) ? Math.round(day.tempMaxC) : null;
  const min = isNumber(day.tempMinC) ? Math.round(day.tempMinC) : null;
  const condition = words.conditions[day.iconKey] || words.conditions.ismeretlen || words.unknown;
  const chance = num(day.precipProbPct);
  const show = (v) => (v === null ? words.unknown : String(v));
  const summary = words.sentence
    .replace('__day__', words.days[index] || '')
    .replace('__condition__', condition)
    .replace('__max__', show(max))
    .replace('__min__', show(min))
    .replace('__chance__', show(chance));
  return {
    max,
    min,
    condition,
    rain_chance: chance,
    rain_mm: isNumber(day.precipMm) ? round(day.precipMm, 1) : null,
    uv: num(day.uvIndex),
    summary,
  };
}

module.exports = { dailyCapabilityValues, dayForecast, precipChance };
