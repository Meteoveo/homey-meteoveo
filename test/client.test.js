'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MeteoVeoClient, InvalidKey, ServiceUnavailable, RequestRejected, API_BASE, UPLOAD_URL,
} = require('../lib/client');

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    const { status = 200, body = null, headers = {} } = next;
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (name) => headers[name.toLowerCase()] ?? null },
      text: async () => (body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body)),
    };
  };
  fn.calls = calls;
  return fn;
}

const client = (fetch) => new MeteoVeoClient({ fetch, version: '0.1.0' });

test('every request identifies the client with the agreed User-Agent', async () => {
  const fetch = fakeFetch([{ status: 202, body: { status: 'code_sent' } }]);
  await client(fetch).signup({ email: 'a@b.es', password: '12345678', marketingConsent: false, lang: 'es' });
  assert.equal(fetch.calls[0].url, `${API_BASE}/auth/signup`);
  assert.equal(fetch.calls[0].init.headers['User-Agent'], 'homey-meteoveo/0.1.0');
  assert.deepEqual(JSON.parse(fetch.calls[0].init.body), { email: 'a@b.es', password: '12345678', marketingConsent: false, lang: 'es' });
});

test('home sends the key as a bearer header and the ETag back', async () => {
  const fetch = fakeFetch([
    { status: 200, body: { v: 1, place: { name: 'Almiserà' } }, headers: { etag: '"abc"' } },
    { status: 304 },
  ]);
  const c = client(fetch);
  const first = await c.home('mvik_1.s', { lang: 'es' });
  assert.equal(first.notModified, false);
  assert.equal(first.etag, '"abc"');
  assert.equal(first.data.place.name, 'Almiserà');
  assert.equal(fetch.calls[0].url, `${API_BASE}/v1/integration/home?lang=es`);
  assert.equal(fetch.calls[0].init.headers.Authorization, 'Bearer mvik_1.s');

  const second = await c.home('mvik_1.s', { lang: 'es', etag: first.etag });
  assert.equal(second.notModified, true);
  assert.equal(fetch.calls[1].init.headers['If-None-Match'], '"abc"');
});

test('a contract version other than 1 is refused instead of misread', async () => {
  const fetch = fakeFetch([{ status: 200, body: { v: 2 } }]);
  await assert.rejects(client(fetch).home('mvik_1.s', { lang: 'es' }), ServiceUnavailable);
});

test('401 is an invalid key, 503 and network errors are outages', async () => {
  await assert.rejects(client(fakeFetch([{ status: 401, body: { error: { code: 'invalid_key' } } }])).home('k', {}), InvalidKey);
  await assert.rejects(client(fakeFetch([{ status: 503 }])).home('k', {}), ServiceUnavailable);
  await assert.rejects(client(fakeFetch([new TypeError('fetch failed')])).home('k', {}), ServiceUnavailable);
  await assert.rejects(client(fakeFetch([{ status: 200, body: 'not json' }])).home('k', {}), ServiceUnavailable);
});

test('429 carries Retry-After', async () => {
  const err = await client(fakeFetch([{ status: 429, headers: { 'retry-after': '120' } }])).home('k', {}).catch((e) => e);
  assert.ok(err instanceof ServiceUnavailable);
  assert.equal(err.retryAfterSeconds, 120);
});

test('a rejected request exposes the server error code for the UI', async () => {
  const fetch = fakeFetch([{ status: 409, body: { error: { code: 'too_many_keys' } } }]);
  const err = await client(fetch).createKey('jwt', { lat: 38.9, lon: -0.26, label: 'Casa' }).catch((e) => e);
  assert.ok(err instanceof RequestRejected);
  assert.equal(err.code, 'too_many_keys');
  assert.deepEqual(JSON.parse(fetch.calls[0].init.body), { clientKind: 'homey', lat: 38.9, lon: -0.26, label: 'Casa' });
});

test('login with bad credentials maps to invalid_credentials (string error body)', async () => {
  const err = await client(fakeFetch([{ status: 401, body: { error: 'invalid credentials' } }]))
    .login({ email: 'a@b.es', password: 'x' }).catch((e) => e);
  assert.ok(err instanceof RequestRejected);
  assert.equal(err.code, 'invalid_credentials');
});

test('error messages never carry the password, the key or the station secret', async () => {
  const fetch = fakeFetch([{ status: 500, body: 'boom' }]);
  const err = await client(fetch)
    .upload({ ingestId: 'ING', secret: 'TOPSECRET' }, { tempf: 68 }, '2026-10-23 12:00:00').catch((e) => e);
  assert.ok(err instanceof ServiceUnavailable);
  assert.ok(!String(err.message).includes('TOPSECRET'));
  assert.ok(!String(err.stack).includes('TOPSECRET'));
});

test('upload uses the station protocol with ID, PASSWORD and dateutc', async () => {
  const fetch = fakeFetch([{ status: 200, body: 'success' }]);
  await client(fetch).upload({ ingestId: 'ING', secret: 'S' }, { tempf: 68, humidity: 55 }, '2026-10-23 12:00:00');
  const url = new URL(fetch.calls[0].url);
  assert.equal(`${url.origin}${url.pathname}`, UPLOAD_URL);
  assert.equal(url.searchParams.get('ID'), 'ING');
  assert.equal(url.searchParams.get('PASSWORD'), 'S');
  assert.equal(url.searchParams.get('dateutc'), '2026-10-23 12:00:00');
  assert.equal(url.searchParams.get('tempf'), '68');
});

test('upload 401 or 403 is an invalid key', async () => {
  await assert.rejects(client(fakeFetch([{ status: 403 }])).upload({ ingestId: 'I', secret: 'S' }, { tempf: 1 }, 'x'), InvalidKey);
});

test('delete account sends the password and the typed e-mail as confirm', async () => {
  const fetch = fakeFetch([{ status: 200, body: { ok: true } }]);
  await client(fetch).deleteAccount('jwt', { password: 'pw', confirm: 'a@b.es' });
  assert.equal(fetch.calls[0].url, `${API_BASE}/v1/me/delete`);
  assert.equal(fetch.calls[0].init.headers.Authorization, 'Bearer jwt');
  assert.deepEqual(JSON.parse(fetch.calls[0].init.body), { password: 'pw', confirm: 'a@b.es' });
});

test('revoking the own key accepts 204 and treats 401 as already revoked', async () => {
  const fetch = fakeFetch([{ status: 204 }, { status: 401 }]);
  const c = client(fetch);
  await c.revokeKey('mvik_1.s');
  await c.revokeKey('mvik_1.s');
  assert.equal(fetch.calls[0].init.method, 'DELETE');
  assert.equal(fetch.calls[0].url, `${API_BASE}/v1/integration/key`);
});

test('station creation sends no vendor: it names the hardware maker, not the hub', async () => {
  const fetch = fakeFetch([{ status: 200, body: { stationId: 7, ingestId: 'ING', secret: 'S' } }]);
  const station = await client(fetch).createStation('jwt', { name: 'Casa', lat: 38.9, lon: -0.26, sensorHeightCm: 150 });
  assert.deepEqual(station, { stationId: 7, ingestId: 'ING', secret: 'S' });
  assert.deepEqual(JSON.parse(fetch.calls[0].init.body), { name: 'Casa', lat: 38.9, lon: -0.26, sensorHeightCm: 150 });
});
