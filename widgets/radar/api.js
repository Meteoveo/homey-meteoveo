'use strict';

module.exports = {
  // The place and the frame lists; the key stays on the Homey.
  async getRadar({ homey, query }) {
    return homey.app.radarData(query.device);
  },

  // The coloured radar tiles of one frame, fetched by the app with the
  // device's key (the API sends no CORS headers, so the page cannot).
  async getTiles({ homey, body }) {
    const { device, tiles } = body || {};
    return homey.app.radarTiles(device, tiles);
  },
};
