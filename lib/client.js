'use strict';

/**
 * HTTP client for the MeteoVeo integration contract v1.
 *
 * Three error classes, because the device reacts differently to each:
 * - InvalidKey: the key was revoked or the account deleted → unavailable +
 *   repair; retrying never recovers.
 * - ServiceUnavailable: network, 5xx, 429, unreadable body → keep the last
 *   values and try again later; never ask the user to sign in again.
 * - RequestRejected: a 4xx with an error code the pairing UI explains
 *   (weak_password, invalid_code, invalid_location, too_many_keys…).
 *
 * Messages never contain the request URL: the upload URL carries the station
 * secret as a query parameter (the station protocol requires it).
 */

const API_BASE = 'https://www.meteoveo.com/api';
const UPLOAD_URL = 'https://www.meteoveo.com/weatherstation/updateweatherstation.php';
const TIMEOUT_MS = 20_000;

class InvalidKey extends Error {
  constructor(message = 'key rejected') {
    super(message);
    this.name = 'InvalidKey';
  }
}

class ServiceUnavailable extends Error {
  constructor(message, { retryAfterSeconds = null } = {}) {
    super(message);
    this.name = 'ServiceUnavailable';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

class RequestRejected extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(code ? `${message}: ${code}` : message);
    this.name = 'RequestRejected';
    this.status = status;
    this.code = code;
  }
}

function errorCode(body) {
  const err = body && body.error;
  if (!err) return null;
  if (typeof err === 'string') return err.trim().toLowerCase().replace(/\s+/g, '_');
  return typeof err.code === 'string' ? err.code : null;
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

class MeteoVeoClient {
  constructor({ fetch = globalThis.fetch, version, apiBase = API_BASE, uploadUrl = UPLOAD_URL } = {}) {
    this._fetch = fetch;
    this._userAgent = `homey-meteoveo/${version}`;
    this._apiBase = apiBase;
    this._uploadUrl = uploadUrl;
  }

  async _send(url, { method = 'GET', token, body, headers = {} } = {}, what) {
    const init = {
      method,
      headers: { 'User-Agent': this._userAgent, Accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    };
    if (token) init.headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    try {
      return await this._fetch(url, init);
    } catch {
      // Deliberately without the cause: undici puts the URL into its errors.
      throw new ServiceUnavailable(`network error during ${what}`);
    }
  }

  /** Shared status mapping. `on401` decides whether 401 means a dead key or bad credentials. */
  async _json(response, what, { on401 = 'invalid_key' } = {}) {
    const text = await response.text().catch(() => '');
    const body = parseJson(text);
    const { status } = response;
    if (status === 401 && on401 === 'invalid_key') throw new InvalidKey(`${what}: key rejected`);
    if (status === 429) {
      const retry = Number.parseInt(response.headers.get('retry-after'), 10);
      throw new ServiceUnavailable(`${what}: rate limited`, { retryAfterSeconds: Number.isFinite(retry) ? retry : null });
    }
    if (status >= 500) throw new ServiceUnavailable(`${what}: server error ${status}`);
    if (status >= 400) {
      const code = errorCode(body) || (status === 401 ? 'invalid_credentials' : `http_${status}`);
      throw new RequestRejected(`${what} rejected`, { status, code });
    }
    if (body === undefined) throw new ServiceUnavailable(`${what}: unreadable response`);
    return body;
  }

  async _call(method, path, { token, body, on401, what } = {}) {
    const response = await this._send(`${this._apiBase}${path}`, { method, token, body }, what);
    return this._json(response, what, { on401 });
  }

  // --- Account (existing endpoints) -------------------------------------

  signup({ email, password, marketingConsent, lang }) {
    return this._call('POST', '/auth/signup', {
      body: { email, password, marketingConsent: Boolean(marketingConsent), lang }, on401: 'reject', what: 'signup',
    });
  }

  verify({ email, code }) {
    return this._call('POST', '/auth/signup/verify', { body: { email, code }, on401: 'reject', what: 'verify' });
  }

  login({ email, password }) {
    return this._call('POST', '/auth/login/password', { body: { email, password }, on401: 'reject', what: 'login' });
  }

  deleteAccount(jwt, { password, confirm }) {
    return this._call('POST', '/v1/me/delete', { token: jwt, body: { password, confirm }, on401: 'reject', what: 'delete account' });
  }

  createStation(jwt, { name, lat, lon, sensorHeightCm }) {
    return this._call('POST', '/v1/me/stations/direct', {
      token: jwt, body: { name, lat, lon, sensorHeightCm }, on401: 'reject', what: 'create station',
    });
  }

  /** Spanish settlements for the pairing location step (accepts the account token). */
  async searchSettlements(jwt, q) {
    const body = await this._call('GET', `/v1/settlements/search?q=${encodeURIComponent(q)}&limit=8`, {
      token: jwt, on401: 'reject', what: 'search',
    });
    return Array.isArray(body && body.items) ? body.items : [];
  }

  // --- Integration key ---------------------------------------------------

  createKey(jwt, { lat, lon, label, stationId }) {
    return this._call('POST', '/v1/me/integration-keys', {
      token: jwt, body: { clientKind: 'homey', lat, lon, label, stationId }, on401: 'reject', what: 'create key',
    });
  }

  updateLocation(key, { lat, lon }) {
    return this._call('PUT', '/v1/integration/location', { token: key, body: { lat, lon }, what: 'update location' });
  }

  async revokeKey(key) {
    const response = await this._send(`${this._apiBase}/v1/integration/key`, { method: 'DELETE', token: key }, 'revoke key');
    // 401: already revoked (or the account is gone) — the goal is reached.
    if (response.status === 204 || response.status === 401 || response.ok) return;
    await this._json(response, 'revoke key');
  }

  async home(key, { lang, etag } = {}) {
    const query = lang ? `?lang=${encodeURIComponent(lang)}` : '';
    const headers = etag ? { 'If-None-Match': etag } : {};
    const response = await this._send(`${this._apiBase}/v1/integration/home${query}`, { token: key, headers }, 'forecast');
    if (response.status === 304) return { notModified: true, etag, data: null };
    const data = await this._json(response, 'forecast');
    if (!data || data.v !== 1) throw new ServiceUnavailable('forecast: unsupported contract version');
    return { notModified: false, etag: response.headers.get('etag'), data };
  }

  // --- Station upload (the protocol every weather station speaks) ---------

  async upload(station, fields, dateutc) {
    const url = new URL(this._uploadUrl);
    url.searchParams.set('ID', station.ingestId);
    url.searchParams.set('PASSWORD', station.secret);
    url.searchParams.set('dateutc', dateutc);
    for (const [field, value] of Object.entries(fields)) url.searchParams.set(field, String(value));
    const response = await this._send(url.toString(), {}, 'upload');
    if (response.status === 401 || response.status === 403) throw new InvalidKey('upload: station key rejected');
    if (response.status >= 400) throw new ServiceUnavailable(`upload failed (${response.status})`);
    return true;
  }
}

module.exports = {
  MeteoVeoClient, InvalidKey, ServiceUnavailable, RequestRejected, API_BASE, UPLOAD_URL,
};
