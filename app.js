'use strict';

const Homey = require('homey');
const { MeteoVeoClient } = require('./lib/client');
const { normalizeLayout, layoutKey } = require('./lib/widget-layout');
const { TileCache, RadarTileSource, radarTilesFor } = require('./lib/tile-cache');

/** A dashboard that asked for the radar this recently keeps its tiles warm. */
const RADAR_WARM_WINDOW_MS = 20 * 60000;
const RADAR_WARM_EVERY_MS = 5 * 60000;
/** The frame lists change every 10 minutes; a dashboard opening within a minute reuses them. */
const RADAR_LISTS_TTL_MS = 60000;

const REPORTS = {
  report_temperature: ['temperature', '°C'],
  report_humidity: ['humidity', '%'],
  report_pressure: ['pressure', 'hPa'],
  report_wind_speed: ['wind_speed', 'km/h'],
  report_wind_gust: ['wind_gust', 'km/h'],
  report_wind_direction: ['wind_direction', '°'],
  report_daily_rain: ['daily_rain', 'mm'],
  report_solar_radiation: ['solar_radiation', 'W/m²'],
};

class MeteoVeoApp extends Homey.App {
  async onInit() {
    this.client = new MeteoVeoClient({ version: this.homey.manifest.version });
    this._api = null;
    // The radar widget's tiles: an in-memory LRU (observed frames are immutable) and a fetch pool of 10.
    this.radarSource = new RadarTileSource({ client: this.client, cache: new TileCache(), concurrency: 10, log: (m) => this.log(m) });
    this._radarAsks = new Map(); // deviceId -> { at, tiles } : the last stage a widget asked for
    this._radarLists = new Map(); // deviceId -> { at, data } : the last frame lists, for a minute
    this.homey.setInterval(() => this._warmRadar().catch((err) => this.log('radar warm', err.message)), RADAR_WARM_EVERY_MS);

    const { flow } = this.homey;
    flow.getConditionCard('rain_within')
      .registerRunListener(async ({ device, minutes }) => device.rainWithin(Number(minutes)));
    flow.getConditionCard('warning_active')
      .registerRunListener(async ({ device, level }) => device.warningActive(level));
    for (const [cardId, [measurement, unit]] of Object.entries(REPORTS)) {
      flow.getActionCard(cardId)
        .registerRunListener(async ({ device, value }) => device.report(measurement, value, unit));
    }
    flow.getActionCard('refresh').registerRunListener(async ({ device }) => device.refresh({ force: true }));
    flow.getConditionCard('rain_intensity_within')
      .registerRunListener(async ({ device, intensity, minutes }) => device.rainIntensityWithin(intensity, Number(minutes)));
    flow.getConditionCard('warning_type_active')
      .registerRunListener(async ({ device, phenomenon, level }) => device.warningTypeActive(phenomenon, level));
    flow.getConditionCard('rain_chance_above')
      .registerRunListener(async ({ device, day, percent }) => device.rainChanceAbove(Number(day), Number(percent)));
    flow.getActionCard('get_forecast').registerRunListener(async ({ device, day }) => device.forecastTokens(Number(day)));

    this.homey.dashboards.getWidget('weather')
      .registerSettingAutocompleteListener('device', async (query) => this._locations(query));
    this.homey.dashboards.getWidget('radar')
      .registerSettingAutocompleteListener('device', async (query) => this._locations(query));
  }

  /**
   * The Web API, for reading the weather-station devices the user picked
   * during pairing (homey:manager:api). Created lazily: most users have no
   * station, and they never need it.
   */
  async api() {
    if (!this._api) {
      // Required here so a broken or missing homey-api cannot stop the
      // forecast part of the app from starting.
      const { HomeyAPI } = require('homey-api');
      this._api = HomeyAPI.createAppAPI({ homey: this.homey });
    }
    return this._api;
  }

  _locations(query) {
    const q = String(query || '').toLowerCase();
    return this.homey.drivers.getDriver('meteoveo').getDevices()
      .map((device) => ({ id: device.getData().id, name: device.getName() }))
      .filter((item) => item.name.toLowerCase().includes(q));
  }

  /**
   * Data for the dashboard widget (widgets/weather/api.js): the device's
   * forecast (an unknown id falls back to the first location), the Homey
   * language for the widget's "automatic" setting, and the card layout saved
   * for this widget instance.
   */
  widgetData(deviceId, instanceId) {
    const devices = this.homey.drivers.getDriver('meteoveo').getDevices();
    const device = devices.find((d) => d.getData().id === deviceId) || devices[0];
    const common = { language: this.homey.i18n.getLanguage(), layout: this.widgetLayout(instanceId) };
    return device ? { ...device.widgetData(), ...common } : { state: 'no_device', ...common };
  }

  _device(deviceId) {
    const devices = this.homey.drivers.getDriver('meteoveo').getDevices();
    return devices.find((d) => d.getData().id === deviceId) || devices[0] || null;
  }

  /**
   * Data for the radar widget (widgets/radar/api.js): place + frame lists; an
   * unknown id falls back to the first location. When the widget says its map
   * (`stage` = { zoom, width, height }), the newest observed frame's tiles ride
   * along as `first` - the picture is on screen one round trip earlier.
   */
  async radarData(deviceId, stage) {
    const device = this._device(deviceId);
    const language = this.homey.i18n.getLanguage();
    if (!device) return { state: 'no_device', language };
    const id = device.getData().id;
    const memo = this._radarLists.get(id);
    const lists = memo && Date.now() - memo.at < RADAR_LISTS_TTL_MS ? memo.data : await device.radarData(2);
    if (lists.state === 'ok') this._radarLists.set(id, { at: Date.now(), data: lists });
    const data = { language, ...lists };
    if (data.state === 'ok' && stage && data.frames && data.frames.length) {
      const tiles = radarTilesFor({ lat: data.lat, lon: data.lon, zoom: stage.zoom, width: stage.width, height: stage.height });
      if (tiles.length) {
        this._radarAsks.set(device.getData().id, { at: Date.now(), tiles });
        const at = data.frames[data.frames.length - 1];
        const { frames } = await this.radarSource.tiles(device.radarKey(), { frames: [{ at, kind: 'obs' }], tiles });
        data.first = { at, tiles: tiles.map((t, i) => ({ ...t, tile: frames[0].tiles[i] })) };
      }
    }
    return data;
  }

  /**
   * Radar tiles for the widget, fetched here with the device's key: the API
   * sends no CORS headers, so the widget's page cannot fetch them itself (and
   * this keeps the key on the Homey). One call carries several frames of the
   * same stage; the app's LRU answers what it already has (lib/tile-cache.js).
   * A tile the server has nothing for is `null` (404 = empty, ADR-0171); a
   * tile that could not be fetched is `{ error: true }`.
   *
   * Two request shapes: `{ frames: [{at, kind}], tiles: [{z,x,y}] }` (the
   * widget since the progressive loader) answered as `{ frames: [{at, tiles}] }`,
   * and the first widget's flat `tiles: [{z,x,y,at}]` answered as a flat list.
   */
  async radarTiles(deviceId, body) {
    const device = this._device(deviceId);
    const key = device ? device.radarKey() : null;
    if (body && Array.isArray(body.frames)) {
      const tiles = Array.isArray(body.tiles) ? body.tiles : [];
      if (device && tiles.length) this._radarAsks.set(device.getData().id, { at: Date.now(), tiles: tiles.slice(0, 25) });
      return this.radarSource.tiles(key, { frames: body.frames, tiles });
    }
    const flat = Array.isArray(body) ? body : [];
    const at = flat.length && typeof flat[0].at === 'string' ? flat[0].at : null;
    const { frames } = await this.radarSource.tiles(key, { frames: [{ at }], tiles: flat });
    return frames.length ? frames[0].tiles : flat.map(() => null);
  }

  /**
   * Keeps the tiles of recently watched stages warm: the newest observed
   * frames and the nowcast instants, so a dashboard opening (or the 5-minute
   * refresh) finds them in the cache. Only while a radar widget asked in the
   * last 20 minutes; the frame lists themselves are one small request.
   */
  async _warmRadar() {
    const now = Date.now();
    for (const [deviceId, ask] of this._radarAsks) {
      if (now - ask.at > RADAR_WARM_WINDOW_MS) { this._radarAsks.delete(deviceId); continue; }
      const device = this._device(deviceId);
      const key = device && device.radarKey();
      if (!key) continue;
      const lists = await device.radarData(2).catch(() => null);
      if (!lists || lists.state !== 'ok') continue;
      this._radarLists.set(deviceId, { at: now, data: lists });
      const fetched = await this.radarSource.warm(key, lists, ask.tiles, { observed: 2 });
      if (fetched) this.log(`radar warm: ${fetched} tiles fetched for a watched stage`);
    }
  }

  /** The saved card layout of a widget instance, always valid (lib/widget-layout.js). */
  widgetLayout(instanceId) {
    const key = layoutKey(instanceId);
    return normalizeLayout(key ? this.homey.settings.get(key) : null);
  }

  /** Stores the layout from the widget's edit mode and answers with what was kept. */
  saveWidgetLayout(instanceId, cards, background) {
    const layout = normalizeLayout({ cards, background });
    const key = layoutKey(instanceId);
    if (key) this.homey.settings.set(key, layout);
    return layout;
  }
}

module.exports = MeteoVeoApp;
