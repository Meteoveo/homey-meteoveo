'use strict';

module.exports = {
  // The place and the frame lists; the key stays on the Homey.
  async getRadar({ homey, query }) {
    const stage = query.zoom ? { zoom: query.zoom, width: Number(query.w), height: Number(query.h) } : null;
    return homey.app.radarData(query.device, stage);
  },

  // The coloured radar tiles of one frame, fetched by the app with the
  // device's key (the API sends no CORS headers, so the page cannot).
  async getTiles({ homey, body }) {
    const { device, frames, tiles } = body || {};
    return homey.app.radarTiles(device, frames ? { frames, tiles } : tiles);
  },
};
