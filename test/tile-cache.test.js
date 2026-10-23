'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { TileCache, RadarTileSource, radarTilesFor, MAX_TILES_PER_CALL, MAX_FRAMES_PER_CALL } = require('../lib/tile-cache');

const png = (n) => ({ type: 'image/png', bytes: Buffer.alloc(n, 1) });

/** A fake client: every tile takes `delayMs`, tiles with y === 99 are empty (404 -> null), z === 7 throws. */
function fakeClient({ delayMs = 5, size = 300 } = {}) {
  const calls = [];
  let inFlight = 0; let maxInFlight = 0;
  return {
    calls,
    get maxInFlight() { return maxInFlight; },
    async radarTile(key, tile) {
      calls.push({ key, ...tile });
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, delayMs));
      inFlight--;
      if (tile.z === 7) throw new Error('boom');
      return tile.y === 99 ? null : png(size);
    },
  };
}

test('the cache keeps the most recently used tiles within its byte budget', () => {
  const cache = new TileCache({ maxBytes: 1000 });
  cache.set('a', { type: 'image/png', data: 'x'.repeat(400) });
  cache.set('b', { type: 'image/png', data: 'x'.repeat(400) });
  assert.equal(cache.size, 2);
  assert.ok(cache.get('a')); // a is now the most recent
  cache.set('c', { type: 'image/png', data: 'x'.repeat(400) }); // over budget: b (least recent) goes
  assert.equal(cache.get('b'), undefined);
  assert.ok(cache.get('a'));
  assert.ok(cache.get('c'));
  assert.ok(cache.bytes <= 1000);
  cache.set('huge', { type: 'image/png', data: 'x'.repeat(5000) }); // never stored, never evicts the rest
  assert.ok(cache.get('a'));
});

test('an empty tile is cached as null and distinguished from unknown', () => {
  const cache = new TileCache();
  assert.equal(cache.get('k'), undefined);
  cache.set('k', null);
  assert.equal(cache.get('k'), null);
  assert.deepEqual([cache.hits, cache.misses], [1, 1]);
});

test('forecast entries expire after their TTL; observed ones do not', () => {
  let now = 1000;
  const cache = new TileCache({ forecastTtlMs: 500, now: () => now });
  cache.set('fc', { type: 'image/png', data: 'abc' }, { ttlMs: 500 });
  cache.set('obs', { type: 'image/png', data: 'abc' });
  now = 1400;
  assert.ok(cache.get('fc'));
  now = 1600;
  assert.equal(cache.get('fc'), undefined);
  assert.ok(cache.get('obs'));
  assert.equal(cache.size, 1);
});

test('tiles(): one answer per frame in order, base64 data, null for empty, {error} for a failure', async () => {
  const client = fakeClient();
  const source = new RadarTileSource({ client, concurrency: 8 });
  const { frames, timing } = await source.tiles('mvik_k', {
    frames: [{ at: '2026-10-23T15:40:00Z', kind: 'obs' }, { at: '2026-10-23T15:50:00Z', kind: 'fc' }],
    tiles: [{ z: 8, x: 1, y: 1 }, { z: 8, x: 1, y: 99 }, { z: 7, x: 1, y: 1 }],
  });
  assert.equal(frames.length, 2);
  assert.equal(frames[0].at, '2026-10-23T15:40:00Z');
  assert.equal(frames[0].tiles[0].type, 'image/png');
  assert.equal(frames[0].tiles[0].data, Buffer.alloc(300, 1).toString('base64'));
  assert.equal(frames[0].tiles[1], null);
  assert.deepEqual(frames[0].tiles[2], { error: true });
  assert.equal(timing.fetched, 6);
  assert.equal(timing.errors, 2);
  assert.equal(client.calls[0].key, 'mvik_k');
});

test('tiles(): the second ask for the same observed tiles is served from the cache; forecast tiles expire', async () => {
  let now = 0;
  const client = fakeClient();
  const cache = new TileCache({ forecastTtlMs: 1000, now: () => now });
  const source = new RadarTileSource({ client, cache, now: () => now });
  const ask = { frames: [{ at: 'A', kind: 'obs' }, { at: 'F', kind: 'fc' }], tiles: [{ z: 8, x: 1, y: 1 }, { z: 8, x: 2, y: 99 }] };
  await source.tiles('k', ask);
  assert.equal(client.calls.length, 4);
  const second = await source.tiles('k', ask);
  assert.equal(client.calls.length, 4, 'nothing fetched again');
  assert.equal(second.timing.hits, 4);
  assert.equal(second.frames[0].tiles[1], null, 'the empty tile is a cached null, not refetched');
  now = 2000;
  const third = await source.tiles('k', ask);
  assert.equal(client.calls.length, 6, 'only the forecast frame is refetched');
  assert.equal(third.timing.hits, 2);
});

test('tiles(): errors are not cached, so the next ask retries them', async () => {
  const client = fakeClient();
  const source = new RadarTileSource({ client });
  const ask = { frames: [{ at: 'A', kind: 'obs' }], tiles: [{ z: 7, x: 1, y: 1 }] };
  await source.tiles('k', ask);
  await source.tiles('k', ask);
  assert.equal(client.calls.length, 2);
});

test('tiles(): the fetch pool is bounded by the concurrency', async () => {
  const client = fakeClient({ delayMs: 10 });
  const source = new RadarTileSource({ client, concurrency: 3 });
  const tiles = Array.from({ length: 12 }, (_, i) => ({ z: 8, x: i, y: 1 }));
  await source.tiles('k', { frames: [{ at: 'A' }, { at: 'B' }], tiles });
  assert.equal(client.calls.length, 24);
  assert.equal(client.maxInFlight, 3);
});

test('tiles(): caps on the request and junk entries dropped; no key means every tile is an error', async () => {
  const client = fakeClient();
  const source = new RadarTileSource({ client });
  const tiles = Array.from({ length: MAX_TILES_PER_CALL + 10 }, (_, i) => ({ z: 8, x: i, y: 1 }));
  const frames = Array.from({ length: MAX_FRAMES_PER_CALL + 5 }, (_, i) => ({ at: 'T' + i }));
  const { frames: out } = await source.tiles('k', { frames: [...frames, { nope: 1 }, null], tiles: [...tiles, { z: 99, x: 1, y: 1 }, 'junk'] });
  assert.equal(out.length, MAX_FRAMES_PER_CALL);
  assert.equal(out[0].tiles.length, MAX_TILES_PER_CALL);
  const noKey = await new RadarTileSource({ client: fakeClient() }).tiles(null, { frames: [{ at: 'A' }], tiles: [{ z: 8, x: 1, y: 1 }] });
  assert.deepEqual(noKey.frames[0].tiles, [{ error: true }]);
});

test('warm(): fetches the newest observed frames and the forecast once; a second warm is all hits', async () => {
  const client = fakeClient();
  const source = new RadarTileSource({ client });
  const lists = { frames: ['O1', 'O2', 'O3', 'O4'], forecast: ['F1', 'F2'] };
  const tiles = [{ z: 8, x: 1, y: 1 }, { z: 8, x: 2, y: 1 }];
  assert.equal(await source.warm('k', lists, tiles, { observed: 2 }), 8); // (2 obs + 2 fc) × 2 tiles
  assert.equal(await source.warm('k', lists, tiles, { observed: 2 }), 0);
  assert.ok(!client.calls.some((c) => c.at === 'O1' || c.at === 'O2'), 'old observed frames are not warmed');
});

test('the log line carries numbers only', async () => {
  const lines = [];
  const source = new RadarTileSource({ client: fakeClient(), log: (m) => lines.push(m) });
  await source.tiles('mvik_SECRET', { frames: [{ at: 'A' }], tiles: [{ z: 8, x: 1, y: 1 }] });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^radar: 1 frame\(s\) × 1 tiles · cache hits 0 · fetched 1/);
  assert.ok(!lines[0].includes('SECRET'));
});

test('radarTilesFor(): the stage tiles of the widget - z8 under local/district, z6 under region, nothing for junk', () => {
  // Castellonet de la Conquesta, the district map on a 360 px phone: a 2 x 2 of z8 tiles (512 px each at z9).
  const district = radarTilesFor({ lat: 38.92, lon: -0.26, zoom: 'comarca', width: 360, height: 360 });
  assert.equal(district.length, 4);
  assert.ok(district.every((t) => t.z === 8));
  assert.deepEqual(district[0], { z: 8, x: 127, y: 97 });
  const local = radarTilesFor({ lat: 38.92, lon: -0.26, zoom: 'local', width: 360, height: 360 });
  assert.ok(local.every((t) => t.z === 8) && local.length <= 4);
  // The region map (z7) over 480 x 360 px: z6 tiles are 512 px there, so two of them cover it.
  const region = radarTilesFor({ lat: 38.92, lon: -0.26, zoom: 'region', width: 480, height: 360 });
  assert.deepEqual(region, [{ z: 6, x: 31, y: 24 }, { z: 6, x: 32, y: 24 }]);
  assert.deepEqual(radarTilesFor({ lat: 38.92, lon: -0.26, zoom: 'local', width: 360, height: 360 }), [{ z: 8, x: 127, y: 97 }, { z: 8, x: 127, y: 98 }]);
  assert.deepEqual(radarTilesFor({ lat: 'x', lon: 1, zoom: 'comarca', width: 360, height: 360 }), []);
  assert.deepEqual(radarTilesFor({ lat: 38.9, lon: -0.2, zoom: 'comarca', width: 99999, height: 360 }), []);
});
