'use strict';

const Homey = require('homey');
const { PairingSession, PairingError } = require('../../lib/pairing');
const { RequestRejected, ServiceUnavailable } = require('../../lib/client');

/** Error → stable code; the views translate it with Homey.__('errors.<code>'). */
function errorCode(err) {
  if (err instanceof PairingError || err instanceof RequestRejected) return err.code || 'unknown';
  if (err instanceof ServiceUnavailable) return 'unavailable';
  return 'unknown';
}

function handler(log, event, fn) {
  return async (data) => {
    try {
      const result = await fn(data || {});
      // Step names only: the payloads carry passwords.
      log(`pairing: ${event} ok`);
      return result;
    } catch (err) {
      log(`pairing: ${event} failed: ${err.name} ${errorCode(err)}`);
      throw new Error(errorCode(err));
    }
  };
}

class MeteoVeoDriver extends Homey.Driver {
  _lang() {
    return this.homey.i18n.getLanguage() === 'es' ? 'es' : 'en';
  }

  _homeyLocation() {
    const lat = this.homey.geolocation.getLatitude();
    const lon = this.homey.geolocation.getLongitude();
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  }

  async onPair(session) {
    const pairing = new PairingSession({ client: this.homey.app.client, lang: this._lang() });
    this.log('pairing: started');
    const on = (event, fn) => session.setHandler(event, handler(this.log.bind(this), event, fn));

    on('signup', (d) => pairing.signup(d));
    on('verify', (d) => pairing.verify(d));
    on('login', (d) => pairing.login(d));
    on('homey_location', async () => this._homeyLocation());
    on('search_places', (d) => pairing.searchPlaces(d));
    on('set_location', async (d) => pairing.setLocation(d));
    on('set_station', async (d) => pairing.setStation(d.station || null));
    on('finish', (d) => pairing.finish(d));
  }

  async onRepair(session, device) {
    const { client } = this.homey.app;
    const on = (event, fn) => session.setHandler(event, handler(this.log.bind(this), event, fn));
    const email = (raw) => String(raw || '').trim().toLowerCase();

    on('homey_location', async () => this._homeyLocation());
    on('current_location', async () => device.getStoreValue('place') || null);
    // The town search opens with the device's own integration key (no sign-in in Repair).
    on('search_places', async ({ q }) => {
      const query = String(q || '').trim();
      return query.length < 2 ? [] : client.searchSettlements(device.getStoreValue('key'), query);
    });

    on('login_again', async ({ email: address, password }) => {
      const account = await client.login({ email: email(address), password: String(password || '') });
      const place = device.getStoreValue('place') || this._homeyLocation() || {};
      const station = device.getStoreValue('station');
      // The old key goes first: it is dead or about to be replaced, and it
      // must not count against the five-keys-per-account limit.
      await client.revokeKey(device.getStoreValue('key')).catch(() => {});
      const issued = await client.createKey(account.token, {
        lat: place.lat, lon: place.lon, label: device.getName(), stationId: station ? station.stationId : undefined,
      });
      await device.replaceKey(issued);
    });

    on('set_location', async ({ lat, lon }) => {
      const probe = new PairingSession({ client, lang: this._lang() });
      probe.setLocation({ lat, lon });
      const result = await client.updateLocation(device.getStoreValue('key'), probe.location);
      await device.locationChanged(result.place);
      return { name: result.place && result.place.name };
    });

    on('delete_account', async ({ email: address, password, confirm }) => {
      const account = email(address);
      if (!account || email(confirm) !== account) throw new PairingError('confirm_mismatch');
      const session = await client.login({ email: account, password: String(password || '') });
      await client.deleteAccount(session.token, { password: String(password || ''), confirm: account });
      await device.accountDeleted();
    });
  }

}

module.exports = MeteoVeoDriver;
