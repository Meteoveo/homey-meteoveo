'use strict';

/**
 * The pairing conversation, independent of Homey's view plumbing so it can be
 * tested: account → (code) → location → (station) → device.
 *
 * What may leave this object is fixed: the device gets the integration key and,
 * with a station, the station key — never the account token or the password.
 * The account token lives only for the length of the pairing session; the
 * server issues no refresh token, so dropping it is the whole logout.
 */

const MIN_PASSWORD = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class PairingError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PairingError';
    this.code = code;
  }
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

class PairingSession {
  constructor({ client, lang }) {
    this.client = client;
    this.lang = lang === 'es' ? 'es' : 'en';
    this.email = null;
    this.token = null;
    this.location = null;
    this.stationRequest = null;
    this.station = null;
    this._password = null;
  }

  _email(raw) {
    const email = String(raw || '').trim().toLowerCase();
    if (!EMAIL.test(email)) throw new PairingError('invalid_email');
    return email;
  }

  async signup({ email, password, acceptTerms, marketingConsent }) {
    if (!acceptTerms) throw new PairingError('terms_required');
    const address = this._email(email);
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) throw new PairingError('weak_password');
    await this.client.signup({ email: address, password, marketingConsent: Boolean(marketingConsent), lang: this.lang });
    this.email = address;
    // Kept in memory until the code step signs in; never stored.
    this._password = password;
  }

  async verify({ code }) {
    if (!this.email || !this._password) throw new PairingError('signup_first');
    await this.client.verify({ email: this.email, code: String(code || '').trim() });
    await this._signIn(this.email, this._password);
  }

  async login({ email, password }) {
    await this._signIn(this._email(email), String(password || ''));
  }

  async _signIn(email, password) {
    const session = await this.client.login({ email, password });
    this.email = email;
    this.token = session.token;
    this._password = null;
  }

  /** Settlement search for the location step; needs the signed-in session. */
  async searchPlaces({ q }) {
    if (!this.token) throw new PairingError('not_signed_in');
    const query = String(q || '').trim();
    if (query.length < 2) return [];
    return this.client.searchSettlements(this.token, query);
  }

  setLocation({ lat, lon }) {
    const la = Number(lat);
    const lo = Number(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
      throw new PairingError('invalid_location');
    }
    // The server keeps 0.01° (~1 km); sending no more than that keeps the
    // exact home position on the Homey.
    this.location = { lat: round2(la), lon: round2(lo) };
  }

  /** null = no station; otherwise { mode: 'devices'|'flow', sensorHeightCm, sources }. */
  setStation(request) {
    this.stationRequest = request || null;
  }

  async finish({ label } = {}) {
    if (!this.token) throw new PairingError('not_signed_in');
    if (!this.location) throw new PairingError('location_required');
    const name = String(label || '').trim().slice(0, 80) || undefined;

    if (this.stationRequest && !this.station) {
      // Created once: a retry after a failed key request must not leave a
      // second station behind.
      const height = Math.round(Number(this.stationRequest.sensorHeightCm));
      this.station = await this.client.createStation(this.token, {
        name: name || 'Homey',
        lat: this.location.lat,
        lon: this.location.lon,
        sensorHeightCm: Number.isFinite(height) ? height : 150,
      });
    }

    const issued = await this.client.createKey(this.token, {
      lat: this.location.lat,
      lon: this.location.lon,
      label: name,
      stationId: this.station ? this.station.stationId : undefined,
    });
    this.token = null;

    const station = this.station
      ? { stationId: this.station.stationId, ingestId: this.station.ingestId, secret: this.station.secret }
      : null;
    return {
      // "MeteoVeo <town>", as in Home Assistant (owner's decision): the brand shows in
      // device lists and Flow cards, the town is never a station name.
      name: issued.place && issued.place.name ? `MeteoVeo ${issued.place.name}` : name || 'MeteoVeo',
      data: { id: issued.keyId },
      store: {
        key: issued.key,
        keyId: issued.keyId,
        place: issued.place || null,
        station,
        stationMode: station ? this.stationRequest.mode : null,
        stationSources: station && this.stationRequest.mode === 'devices' ? this.stationRequest.sources || {} : null,
      },
    };
  }
}

module.exports = { PairingSession, PairingError, MIN_PASSWORD };
