'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { PairingSession, upgradeStationStore } = require('../lib/pairing');
const { RequestRejected } = require('../lib/client');

function fakeClient(overrides = {}) {
  const calls = [];
  const record = (name, result) => async (...args) => {
    calls.push([name, ...args]);
    if (typeof result === 'function') return result(...args);
    return result;
  };
  const c = {
    calls,
    signup: record('signup', { status: 'code_sent' }),
    verify: record('verify', { verified: true }),
    login: record('login', { token: 'JWT', level: 'free' }),
    createStation: record('createStation', { stationId: 7, ingestId: 'ING', secret: 'S' }),
    createKey: record('createKey', { keyId: 'k1', key: 'mvik_k1.s', place: { name: 'Almiserà', lat: 38.92, lon: -0.26 } }),
    ...overrides,
  };
  return c;
}

test('new account: signup, code, login, then key; the JWT is dropped afterwards', async () => {
  const client = fakeClient();
  const s = new PairingSession({ client, lang: 'es' });
  await s.signup({ email: ' A@B.es ', password: '12345678', acceptTerms: true, marketingConsent: false });
  await s.verify({ code: ' 123456 ' });
  s.setLocation({ lat: 38.9234, lon: -0.2611 });
  const device = await s.finish({ label: 'Casa' });

  assert.deepEqual(client.calls.map((c) => c[0]), ['signup', 'verify', 'login', 'createKey']);
  assert.deepEqual(client.calls[0][1], { email: 'a@b.es', password: '12345678', marketingConsent: false, lang: 'es' });
  assert.deepEqual(client.calls[1][1], { email: 'a@b.es', code: '123456' });
  assert.equal(device.name, 'MeteoVeo Almiserà');
  assert.equal(device.store.key, 'mvik_k1.s');
  assert.equal(device.data.id, 'k1');
  assert.equal(device.store.station, null);
  // Nothing account-level survives the pairing.
  assert.equal(JSON.stringify(device).includes('JWT'), false);
  assert.equal(JSON.stringify(device).includes('12345678'), false);
  assert.equal(s.token, null);
});

test('the terms checkbox is mandatory, the marketing one is not', async () => {
  const s = new PairingSession({ client: fakeClient(), lang: 'es' });
  await assert.rejects(s.signup({ email: 'a@b.es', password: '12345678', acceptTerms: false }), /terms_required/);
});

test('a short password is caught before the request', async () => {
  const client = fakeClient();
  const s = new PairingSession({ client, lang: 'en' });
  await assert.rejects(s.signup({ email: 'a@b.es', password: '1234567', acceptTerms: true }), /weak_password/);
  assert.equal(client.calls.length, 0);
});

test('existing account: login only', async () => {
  const client = fakeClient();
  const s = new PairingSession({ client, lang: 'es' });
  await s.login({ email: 'a@b.es', password: 'pw' });
  s.setLocation({ lat: 40.4, lon: -3.7 });
  await s.finish({});
  assert.deepEqual(client.calls.map((c) => c[0]), ['login', 'createKey']);
});

test('with a station: the station is created first and bound to the key', async () => {
  const client = fakeClient();
  const s = new PairingSession({ client, lang: 'es' });
  await s.login({ email: 'a@b.es', password: 'pw' });
  s.setLocation({ lat: 38.92, lon: -0.26 });
  s.setStation({ sensorHeightCm: 150 });
  const device = await s.finish({ label: 'Casa' });
  assert.deepEqual(client.calls.map((c) => c[0]), ['login', 'createStation', 'createKey']);
  assert.equal(client.calls[2][2].stationId, 7);
  assert.deepEqual(device.store.station, { stationId: 7, ingestId: 'ING', secret: 'S' });
  assert.equal(device.store.stationMode, 'flow');
  assert.equal('stationSources' in device.store, false);
});

test('readings only come from Flow cards: a device-mode request still pairs a Flow station', async () => {
  const client = fakeClient();
  const s = new PairingSession({ client, lang: 'es' });
  await s.login({ email: 'a@b.es', password: 'pw' });
  s.setLocation({ lat: 38.92, lon: -0.26 });
  s.setStation({ mode: 'devices', sensorHeightCm: 150, sources: { temperature: { deviceId: 'd1', capability: 'measure_temperature' } } });
  const device = await s.finish({});
  assert.equal(device.store.stationMode, 'flow');
  assert.equal('stationSources' in device.store, false);
});

test('a device paired in device mode (Build 1) switches to Flow once, keeping its station', () => {
  const station = { stationId: 7, ingestId: 'ING', secret: 'S' };
  assert.deepEqual(
    upgradeStationStore({ station, stationMode: 'devices', stationSources: { temperature: {} } }),
    { stationMode: 'flow', stationSources: null, notify: true },
  );
  assert.equal(upgradeStationStore({ station, stationMode: 'flow' }), null);
  assert.equal(upgradeStationStore({ station: null, stationMode: null }), null);
});

test('a location outside the service area is reported, not retried', async () => {
  const client = fakeClient({
    createKey: async () => { throw new RequestRejected('rejected', { status: 400, code: 'invalid_location' }); },
  });
  const s = new PairingSession({ client, lang: 'es' });
  await s.login({ email: 'a@b.es', password: 'pw' });
  s.setLocation({ lat: 52.37, lon: 4.9 });
  await assert.rejects(s.finish({}), /invalid_location/);
});

test('finish before login is a programming error, not a silent anonymous device', async () => {
  const s = new PairingSession({ client: fakeClient(), lang: 'es' });
  s.setLocation({ lat: 40.4, lon: -3.7 });
  await assert.rejects(s.finish({}), /not_signed_in/);
});

test('coordinates are validated and rounded before they leave Homey', () => {
  const s = new PairingSession({ client: fakeClient(), lang: 'es' });
  assert.throws(() => s.setLocation({ lat: 'x', lon: 1 }), /invalid_location/);
  assert.throws(() => s.setLocation({ lat: 91, lon: 1 }), /invalid_location/);
  s.setLocation({ lat: 38.923456, lon: -0.261199 });
  assert.deepEqual(s.location, { lat: 38.92, lon: -0.26 });
});

test('place search needs a signed-in session; short queries cost no request', async () => {
  const searched = [];
  const client = fakeClient({ searchSettlements: async (token, q) => { searched.push([token, q]); return [{ name: 'Almiserà' }]; } });
  const s = new PairingSession({ client, lang: 'es' });
  await assert.rejects(s.searchPlaces({ q: 'almi' }), /not_signed_in/);
  await s.login({ email: 'a@b.es', password: 'pw' });
  assert.deepEqual(await s.searchPlaces({ q: ' a ' }), []);
  assert.deepEqual(await s.searchPlaces({ q: ' almi ' }), [{ name: 'Almiserà' }]);
  assert.deepEqual(searched, [['JWT', 'almi']]);
});
