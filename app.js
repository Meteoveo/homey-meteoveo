'use strict';

const Homey = require('homey');
const { MeteoVeoClient } = require('./lib/client');
const { normalizeLayout, layoutKey } = require('./lib/widget-layout');

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

  /** The saved card layout of a widget instance, always valid (lib/widget-layout.js). */
  widgetLayout(instanceId) {
    const key = layoutKey(instanceId);
    return normalizeLayout(key ? this.homey.settings.get(key) : null);
  }

  /** Stores the layout from the widget's edit mode and answers with what was kept. */
  saveWidgetLayout(instanceId, cards) {
    const layout = normalizeLayout({ cards });
    const key = layoutKey(instanceId);
    if (key) this.homey.settings.set(key, layout);
    return layout;
  }
}

module.exports = MeteoVeoApp;
