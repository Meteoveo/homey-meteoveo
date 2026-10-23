'use strict';

module.exports = {
  // The widget reads what the device already fetched: no extra request to
  // MeteoVeo per dashboard, however many dashboards show it. An unknown or
  // removed device id falls back to the first location (app.js).
  async getForecast({ homey, query }) {
    return homey.app.widgetData(query.device);
  },
};
