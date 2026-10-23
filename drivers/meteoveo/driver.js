'use strict';

const Homey = require('homey');
const { PairingSession, PairingError } = require('../../lib/pairing');
const { RequestRejected, ServiceUnavailable } = require('../../lib/client');
const { MEASUREMENTS } = require('../../lib/wu');

const OWN_DRIVER_PREFIX = 'homey:app:com.meteoveo:';

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
    on('set_location', async (d) => pairing.setLocation(d));
    on('station_candidates', async () => this._stationCandidates());
    on('set_station', async (d) => pairing.setStation(d.station || null));
    on('finish', (d) => pairing.finish(d));
  }

  async onRepair(session, device) {
    const { client } = this.homey.app;
    const on = (event, fn) => session.setHandler(event, handler(this.log.bind(this), event, fn));
    const email = (raw) => String(raw || '').trim().toLowerCase();

    on('homey_location', async () => this._homeyLocation());

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

  /**
   * Weather-station devices from other apps, per measurement, for the
   * device-mode station. Read through the Web API (homey:manager:api);
   * nothing is read until the user opts into a station.
   */
  async _stationCandidates() {
    const api = await this.homey.app.api();
    const [devices, zones] = await Promise.all([api.devices.getDevices(), api.zones.getZones().catch(() => ({}))]);
    const list = Object.values(devices).filter((d) => {
      const driver = d.driverId || d.driverUri || '';
      return !driver.startsWith(OWN_DRIVER_PREFIX);
    });
    const out = {};
    for (const m of MEASUREMENTS) {
      if (!m.capabilities.length) continue;
      out[m.key] = list.flatMap((d) => {
        const capability = m.capabilities.find((c) => (d.capabilities || []).includes(c));
        if (!capability) return [];
        const state = (d.capabilitiesObj || {})[capability] || {};
        const zone = zones[d.zone];
        return [{
          deviceId: d.id,
          name: d.name,
          zone: zone ? zone.name : '',
          capability,
          value: typeof state.value === 'number' ? state.value : null,
          units: state.units || '',
        }];
      });
    }
    return out;
  }
}

module.exports = MeteoVeoDriver;
