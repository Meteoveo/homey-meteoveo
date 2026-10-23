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

test('settlement search uses the account token and asks for a short list', async () => {
  const fetch = fakeFetch([{ status: 200, body: { items: [{ name: 'Almiserà', lat: 38.92, lon: -0.27, admin1: 'Valencia' }] } }]);
  const items = await client(fetch).searchSettlements('jwt', 'almi');
  assert.equal(items.length, 1);
  assert.equal(fetch.calls[0].url, `${API_BASE}/v1/settlements/search?q=almi&limit=8`);
  assert.equal(fetch.calls[0].init.headers.Authorization, 'Bearer jwt');
});

test('radar frames go with the key, the hours, and come back as clean lists', async () => {
  const fetch = fakeFetch([{ status: 200, body: { layer: 'radar', frames: ['2026-10-23T15:30:00.000Z', 7, '2026-10-23T15:40:00.000Z'], forecast: ['2026-10-23T15:50:00.000Z'], forecastBaseAt: '2026-10-23T15:40:00.000Z' } }]);
  const out = await client(fetch).radarFrames('mvik_key', 2);
  assert.equal(fetch.calls[0].url, `${API_BASE}/v1/overlays/radar/frames?hours=2`);
  assert.equal(fetch.calls[0].init.headers.Authorization, 'Bearer mvik_key');
  assert.deepEqual(out, { layer: 'radar', frames: ['2026-10-23T15:30:00.000Z', '2026-10-23T15:40:00.000Z'], forecast: ['2026-10-23T15:50:00.000Z'], forecastBaseAt: '2026-10-23T15:40:00.000Z' });
});

test('radar frames: more than the free 3 hours is a rejection the UI can name, a bad key is InvalidKey, junk is an outage', async () => {
  await assert.rejects(client(fakeFetch([{ status: 403, body: { error: 'plus_required' } }])).radarFrames('k', 6), (e) => e instanceof RequestRejected && e.code === 'plus_required');
  await assert.rejects(client(fakeFetch([{ status: 401 }])).radarFrames('k'), InvalidKey);
  await assert.rejects(client(fakeFetch([{ status: 200, body: { nope: true } }])).radarFrames('k'), ServiceUnavailable);
});

test('a radar tile comes back as bytes with its type; 404 is null, 401 is InvalidKey', async () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/9/')) return { status: 404, ok: false, headers: { get: () => null }, text: async () => '{"error":"no tile"}' };
    if (String(url).includes('/7/')) return { status: 401, ok: false, headers: { get: () => null }, text: async () => '' };
    return { status: 200, ok: true, headers: { get: (n) => (n === 'content-type' ? 'image/png' : null) }, arrayBuffer: async () => png.buffer };
  };
  const c = new MeteoVeoClient({ fetch, version: '0.1.0' });
  const tile = await c.radarTile('mvik_key', { z: 8, x: 127, y: 97, at: '2026-10-23T15:40:00.000Z' });
  assert.equal(calls[0].url, `${API_BASE}/v1/overlays/radar/8/127/97.png?at=2026-10-23T15%3A40%3A00.000Z`);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer mvik_key');
  assert.equal(tile.type, 'image/png');
  assert.deepEqual([...tile.bytes], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(await c.radarTile('mvik_key', { z: 9, x: 1, y: 1, at: null }), null);
  assert.equal(calls[1].url, `${API_BASE}/v1/overlays/radar/9/1/1.png`);
  await assert.rejects(c.radarTile('mvik_key', { z: 7, x: 1, y: 1 }), InvalidKey);
});

test('radar still image: JPEG of the "now" frame with the key, ETag passed back', async () => {
  const fetch = async (url, init) => {
    fetch.calls.push({ url: String(url), init });
    return {
      status: 200, ok: true,
      headers: { get: (n) => ({ 'content-type': 'image/jpeg', etag: '"radar-1-es-jpg"' })[n.toLowerCase()] ?? null },
      arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff]).buffer,
    };
  };
  fetch.calls = [];
  const img = await new MeteoVeoClient({ fetch, version: '0.1.0' }).radarImage('mvik_1.s', { lang: 'es' });
  assert.equal(fetch.calls[0].url, `${API_BASE}/v1/integration/radar.webp?format=jpg&lang=es`);
  assert.equal(fetch.calls[0].init.headers.Authorization, 'Bearer mvik_1.s');
  assert.equal(img.contentType, 'image/jpeg');
  assert.equal(img.etag, '"radar-1-es-jpg"');
  assert.deepEqual([...img.buffer], [0xff, 0xd8, 0xff]);
});

test('radar still image: no coverage is a rejection with the code, busy is an outage', async () => {
  const reply = (status, body, headers = {}) => async () => ({
    status, ok: false, headers: { get: (n) => headers[n.toLowerCase()] ?? null },
    text: async () => JSON.stringify(body), arrayBuffer: async () => new ArrayBuffer(0),
  });
  const c1 = new MeteoVeoClient({ fetch: reply(404, { error: { code: 'no_coverage' } }), version: '0.1.0' });
  const e1 = await c1.radarImage('k', {}).catch((e) => e);
  assert.ok(e1 instanceof RequestRejected);
  assert.equal(e1.code, 'no_coverage');
  const c2 = new MeteoVeoClient({ fetch: reply(503, { error: { code: 'busy' } }, { 'retry-after': '5' }), version: '0.1.0' });
  await assert.rejects(c2.radarImage('k', {}), ServiceUnavailable);
});
