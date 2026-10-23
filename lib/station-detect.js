'use strict';

/**
 * Finds the user's weather station among the Homey devices offered in the
 * pairing station step (driver._stationCandidates), so the step can propose
 * it instead of making the user hunt through every sensor in the house.
 *
 * A device counts as a station when it comes from a weather-station app, or
 * when it is named/placed outdoors and measures at least three things. A
 * device named or placed indoors never counts: an indoor thermostat sent as
 * the outdoor temperature would ruin the station's data at MeteoVeo.
 */

const STATION_APP = /ecowitt|misol|fineoffset|froggit|weatherflow|tempest|netatmo|wunderground|weather-?underground|davis|ambient|bresser|meteobridge|weewx|awekas|sainlogic/i;
const OUTDOOR = /exterior|outdoor|outside|jard[ií]n|terraza|patio|balc[oó]n|garden|tejado|azotea|roof|buiten|tuin|au(?:ss|ß)en|garten|estaci[oó]n|station|weather|meteo/i;
const INDOOR = /interior|indoor|inside|sal[oó]n|living|dormitorio|bedroom|habitaci[oó]n|cocina|kitchen|ba[nñ]o|bath|oficina|office|despacho|binnen|woonkamer|slaapkamer|keuken|innen|wohnzimmer|schlafzimmer|k[uü]che|termostato|thermostat/i;

function detectStation(candidates) {
  const devices = new Map();
  for (const [measurement, list] of Object.entries(candidates || {})) {
    for (const c of list || []) {
      const d = devices.get(c.deviceId) || {
        deviceId: c.deviceId, name: c.name || '', zone: c.zone || '', driverId: c.driverId || '', measurements: {},
      };
      d.measurements[measurement] = c.capability;
      devices.set(c.deviceId, d);
    }
  }

  const eligible = [...devices.values()].map((d) => {
    const where = `${d.name} ${d.zone}`;
    const app = STATION_APP.test(d.driverId);
    const coverage = Object.keys(d.measurements).length;
    const outdoor = OUTDOOR.test(where);
    const ok = !INDOOR.test(where) && (app || (outdoor && coverage >= 3));
    return { ...d, app, ok, score: (app ? 5 : 0) + coverage + (outdoor ? 1 : 0) };
  }).filter((d) => d.ok).sort((a, b) => b.score - a.score);

  if (!eligible.length) return { station: null, preselect: {} };
  const best = eligible[0];
  const preselect = {};
  for (const [measurement, capability] of Object.entries(best.measurements)) {
    preselect[measurement] = { deviceId: best.deviceId, capability };
  }
  // Gaps only from another weather-station app (e.g. a Tempest next to a Netatmo).
  for (const d of eligible.slice(1)) {
    if (!d.app) continue;
    for (const [measurement, capability] of Object.entries(d.measurements)) {
      if (!preselect[measurement]) preselect[measurement] = { deviceId: d.deviceId, capability };
    }
  }
  return { station: { deviceId: best.deviceId, name: best.name, zone: best.zone }, preselect };
}

module.exports = { detectStation };
