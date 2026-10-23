'use strict';

module.exports = {
  // The widget reads what the device already fetched: no extra request to
  // MeteoVeo per dashboard, however many dashboards show it. An unknown or
  // removed device id falls back to the first location (app.js). The saved
  // card layout of this widget instance rides along with the data.
  async getForecast({ homey, query }) {
    return homey.app.widgetData(query.device, query.instance);
  },

  // The card layout and background from the widget's edit mode; the app
  // normalizes and stores them per widget instance, and answers with what it kept.
  async putLayout({ homey, body }) {
    const { instanceId, cards, background } = body || {};
    return homey.app.saveWidgetLayout(instanceId, cards, background);
  },
};
