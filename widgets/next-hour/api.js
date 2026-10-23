'use strict';

module.exports = {
  // The widget reads what the device already fetched: no extra request to
  // MeteoVeo per dashboard, however many dashboards show it.
  async getForecast({ homey, query }) {
    return homey.app.widgetData(query.device);
  },
};
