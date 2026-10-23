// Fixture variants for the widget preview harness. The base is a real
// /v1/integration/home response (dry afternoon); the others are synthetic.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'home-v1.json'), 'utf8'));

const iso = (ms) => new Date(ms).toISOString();

/** Re-time the fixture so that "now" is now: steps from issuedAt, hourly from the current hour. */
function retime(data, nowMs) {
  const d = JSON.parse(JSON.stringify(data));
  const issued = nowMs - 2 * 60000;
  d.issuedAt = iso(nowMs - 60000);
  d.current.at = iso(nowMs - 3 * 60000);
  if (d.nextHour) {
    d.nextHour.issuedAt = iso(issued);
    d.nextHour.ageMinutes = 2;
    d.nextHour.steps = d.nextHour.steps.map((s, i) => ({ ...s, at: iso(issued + i * 600000), leadMinutes: i * 10 }));
  }
  const hour = Math.floor(nowMs / 3600000) * 3600000;
  d.hourly = d.hourly.map((h, i) => ({ ...h, at: iso(hour + i * 3600000) }));
  const day = new Date(nowMs); day.setUTCHours(12, 0, 0, 0);
  d.daily = d.daily.map((x, i) => ({ ...x, date: iso(day.getTime() + i * 86400000).slice(0, 10) }));
  return d;
}

function bands(d, fn) {
  d.nextHour.steps = d.nextHour.steps.map((s, i) => ({ ...s, band: fn(i, s) }));
  const first = d.nextHour.steps.findIndex((s) => s.band !== 'none');
  d.nextHour.rainNow = d.nextHour.steps[0].band !== 'none';
  d.nextHour.rainSoon = d.nextHour.steps.slice(0, 7).some((s) => s.band !== 'none');
  d.nextHour.rainStartsAt = first >= 0 ? d.nextHour.steps[first].at : null;
  const end = d.nextHour.rainNow ? d.nextHour.steps.findIndex((s) => s.band === 'none') : -1;
  d.nextHour.rainEndsAt = end >= 0 ? d.nextHour.steps[end].at : null;
  return d;
}

export function widgetData(data, extra = {}) {
  return {
    state: 'ok',
    language: 'es',
    layout: undefined,
    name: 'MeteoVeo ' + data.place.name,
    timezone: 'Europe/Madrid',
    level: data.level,
    place: data.place,
    current: data.current,
    nextHour: data.nextHour,
    hourly: data.hourly.slice(0, 12),
    daily: data.daily.slice(0, 7),
    warnings: data.warnings || [],
    attribution: data.attribution,
    ...extra,
  };
}

export function variants({ nowMs = Date.now(), language = 'es' } = {}) {
  const dry = retime(base, nowMs);

  const soon = bands(retime(base, nowMs), (i) => (i < 3 ? 'none' : i < 5 ? 'light' : i < 8 ? 'moderate' : 'light'));
  soon.current.iconKey = 'reszben_felhos';
  soon.hourly = soon.hourly.map((h, i) => ({ ...h, iconKey: i < 1 ? 'reszben_felhos' : 'eso', precipProbPct: i < 1 ? 10 : 60 + (i % 3) * 10, tempC: 21 - i * 0.6 }));

  const raining = bands(retime(base, nowMs), (i) => (i < 2 ? 'heavy' : i < 5 ? 'moderate' : i < 7 ? 'light' : 'none'));
  raining.current.iconKey = 'eso';
  raining.current.tempC = 17.8;
  raining.current.humidityPct = 93;
  raining.current.precipMm = 6.4;
  raining.hourly = raining.hourly.map((h, i) => ({ ...h, iconKey: i < 2 ? 'eso' : i < 5 ? 'zapor' : 'borult', precipProbPct: i < 2 ? 95 : i < 5 ? 50 : 10, tempC: 17 + i * 0.3 }));
  raining.daily = raining.daily.map((x, i) => ({ ...x, iconKey: i === 0 ? 'eso' : i === 1 ? 'zapor' : x.iconKey, precipMm: i === 0 ? 18 : i === 1 ? 4 : x.precipMm, precipProbPct: i === 0 ? 100 : i === 1 ? 60 : x.precipProbPct }));

  const warning = retime(base, nowMs);
  warning.current.iconKey = 'zivatar';
  warning.current.tempC = 26.2;
  warning.warnings = [
    { level: 'orange', phenomenon: 'PR', phenomenonName: 'Lluvias', probability: '40%-70%', headline: 'Lluvias', onset: iso(nowMs - 3600000), expires: iso(nowMs + 7 * 3600000) },
    { level: 'yellow', phenomenon: 'TO', phenomenonName: 'Tormentas', probability: '40%-70%', headline: 'Tormentas', onset: iso(nowMs - 3600000), expires: iso(nowMs + 5 * 3600000) },
  ];
  warning.hourly = warning.hourly.map((h, i) => ({ ...h, iconKey: i < 3 ? 'zivatar' : 'zapor', precipProbPct: 80 - i * 5 }));

  const night = retime(base, nowMs);
  night.current.iconKey = 'napos';
  night.current.isDaylight = false;
  night.current.tempC = 14.3;
  night.current.basis = 'model';
  night.hourly = night.hourly.map((h, i) => ({ ...h, iconKey: 'napos', isDaylight: i > 7, tempC: 14 - Math.min(i, 5) * 0.7 + Math.max(0, i - 7) * 1.4 }));

  const noNowcast = retime(base, nowMs);
  noNowcast.nextHour = null;
  noNowcast.current.iconKey = 'fatyolfelhos';
  noNowcast.place = { name: 'Santa Cruz de Tenerife', lat: 28.46, lon: -16.25, elevationM: 4 };

  const lang = (d) => ({ ...d, language });
  return {
    dry: lang(widgetData(dry)),
    soon: lang(widgetData(soon)),
    raining: lang(widgetData(raining)),
    warning: lang(widgetData(warning)),
    night: lang(widgetData(night)),
    'no-nowcast': lang(widgetData(noNowcast)),
    loading: { state: 'loading', language },
    'no-device': { state: 'no_device', language },
  };
}
