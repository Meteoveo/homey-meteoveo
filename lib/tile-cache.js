'use strict';

// The radar widget's tile source: an in-memory LRU of tile responses in the
// app, and the fetch pool behind it. Past observed frames are immutable, so a
// tile fetched once serves every dashboard and every refresh; the nowcast
// instants change with each run and live a few minutes only. Pure of Homey:
// testable, and the preview harness drives the same code.

const DEFAULT_MAX_BYTES = 30 * 1024 * 1024;
const DEFAULT_FORECAST_TTL_MS = 5 * 60000;
/** A cached "no tile" (404 = empty, ADR-0171) costs no bytes, but it is an entry. */
const EMPTY_ENTRY_BYTES = 64;
const MAX_TILES_PER_CALL = 25;
const MAX_FRAMES_PER_CALL = 16;

class TileCache {
  constructor({ maxBytes = DEFAULT_MAX_BYTES, forecastTtlMs = DEFAULT_FORECAST_TTL_MS, now = Date.now } = {}) {
    this.maxBytes = maxBytes;
    this.forecastTtlMs = forecastTtlMs;
    this._now = now;
    this._map = new Map(); // insertion order = recency (re-inserted on hit)
    this.bytes = 0;
    this.hits = 0;
    this.misses = 0;
  }

  static key({ z, x, y, at }) {
    return `${z}/${x}/${y}/${at || 'latest'}`;
  }

  /** The cached value (`null` for a known-empty tile), or `undefined` when unknown or expired. */
  get(key) {
    const entry = this._map.get(key);
    if (!entry) { this.misses++; return undefined; }
    if (entry.expires && entry.expires <= this._now()) { this._delete(key); this.misses++; return undefined; }
    // Refresh recency.
    this._map.delete(key); this._map.set(key, entry);
    this.hits++;
    return entry.value;
  }

  /**
   * Store a tile (`{ type, data }` with base64 `data`) or `null` for an empty
   * tile. `ttlMs` makes it expire (the nowcast instants); without it the entry
   * lives until the LRU pushes it out.
   */
  set(key, value, { ttlMs = 0 } = {}) {
    const bytes = value && value.data ? value.data.length + 32 : EMPTY_ENTRY_BYTES;
    if (bytes > this.maxBytes) return;
    if (this._map.has(key)) this._delete(key);
    this._map.set(key, { value, bytes, expires: ttlMs > 0 ? this._now() + ttlMs : 0 });
    this.bytes += bytes;
    while (this.bytes > this.maxBytes && this._map.size) this._delete(this._map.keys().next().value);
  }

  _delete(key) {
    const entry = this._map.get(key);
    if (!entry) return;
    this._map.delete(key);
    this.bytes -= entry.bytes;
  }

  get size() { return this._map.size; }

  stats() {
    return { entries: this._map.size, bytes: this.bytes, hits: this.hits, misses: this.misses };
  }
}

class RadarTileSource {
  /**
   * @param client  a MeteoVeoClient (radarTile / radarFrames)
   * @param cache   a TileCache
   * @param concurrency  parallel tile fetches per call
   * @param log  one line per call with timings (names and numbers only, never a key)
   */
  constructor({ client, cache = new TileCache(), concurrency = 8, log = () => {}, now = Date.now }) {
    this.client = client;
    this.cache = cache;
    this.concurrency = concurrency;
    this.log = log;
    this._now = now;
    this.inFlight = 0;
    this.maxInFlight = 0;
  }

  /**
   * The tiles of several frames in one answer, cache first.
   * @param key    the device's integration key
   * @param frames [{ at, kind: 'obs'|'fc' }]  (kind decides the cache TTL)
   * @param tiles  [{ z, x, y }]  the same stage for every frame
   * @returns { frames: [{ at, tiles: [ {type,data} | null | {error:true} ] }], timing }
   */
  async tiles(key, { frames, tiles }) {
    const t0 = this._now();
    const frameList = (Array.isArray(frames) ? frames : []).slice(0, MAX_FRAMES_PER_CALL)
      .filter((f) => f && typeof f.at === 'string').map((f) => ({ at: f.at, kind: f.kind === 'fc' ? 'fc' : 'obs' }));
    const tileList = (Array.isArray(tiles) ? tiles : []).slice(0, MAX_TILES_PER_CALL)
      .map((t) => ({ z: Number(t.z), x: Number(t.x), y: Number(t.y) }))
      .filter((t) => [t.z, t.x, t.y].every(Number.isInteger) && t.z >= 0 && t.z <= 12);
    const out = frameList.map((f) => ({ at: f.at, tiles: new Array(tileList.length).fill(null) }));
    const jobs = [];
    let hits = 0;
    frameList.forEach((f, fi) => tileList.forEach((t, ti) => {
      const cacheKey = TileCache.key({ ...t, at: f.at });
      const cached = this.cache.get(cacheKey);
      if (cached !== undefined) { out[fi].tiles[ti] = cached; hits++; return; }
      jobs.push({ fi, ti, t, f, cacheKey });
    }));
    let fetchMs = 0; let encodeMs = 0; let errors = 0; let bytes = 0;
    if (key && jobs.length) {
      let next = 0;
      const worker = async () => {
        while (next < jobs.length) {
          const job = jobs[next++];
          const f0 = this._now();
          this.inFlight++; this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
          try {
            const tile = await this.client.radarTile(key, { ...job.t, at: job.f.at });
            fetchMs += this._now() - f0;
            const e0 = this._now();
            const value = tile ? { type: tile.type, data: tile.bytes.toString('base64') } : null;
            encodeMs += this._now() - e0;
            if (value) bytes += value.data.length;
            this.cache.set(job.cacheKey, value, { ttlMs: job.f.kind === 'fc' ? this.cache.forecastTtlMs : 0 });
            out[job.fi].tiles[job.ti] = value;
          } catch (err) {
            fetchMs += this._now() - f0;
            errors++;
            out[job.fi].tiles[job.ti] = { error: true };
          } finally {
            this.inFlight--;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(this.concurrency, jobs.length) }, worker));
    } else if (!key) {
      for (const job of jobs) out[job.fi].tiles[job.ti] = { error: true };
    }
    const total = this._now() - t0;
    const timing = { frames: frameList.length, tiles: tileList.length, hits, fetched: jobs.length, errors, fetchMs, encodeMs, totalMs: total, bytes };
    this.log(`radar: ${frameList.length} frame(s) × ${tileList.length} tiles · cache hits ${hits} · fetched ${jobs.length}`
      + ` (${errors} failed) in ${total} ms (fetch avg ${jobs.length ? Math.round(fetchMs / jobs.length) : 0} ms, encode ${encodeMs} ms) · ${Math.round(bytes / 1024)} KB · cache ${Math.round(this.cache.bytes / 1024)} KB`);
    return { frames: out, timing };
  }

  /**
   * Warm the cache for a stage the widget asked recently: the newest observed
   * frames not yet cached, and the nowcast instants (short-lived). Returns
   * how many tiles were fetched.
   */
  async warm(key, lists, tiles, { observed = 2 } = {}) {
    const obs = (lists.frames || []).slice(-observed).map((at) => ({ at, kind: 'obs' }));
    const fc = (lists.forecast || []).map((at) => ({ at, kind: 'fc' }));
    const frames = [...obs, ...fc];
    if (!frames.length || !tiles.length) return 0;
    const { timing } = await this.tiles(key, { frames, tiles });
    return timing.fetched;
  }
}

// ---- The stage's radar tiles, from the place and the map size ---------------
//
// The same geometry as the widget's stageFor(): a Web-Mercator stage of
// width x height CSS px centred on the place at the map zoom, the radar layer
// at z8 under the local/district maps and z6 under the region map. The app
// uses it to answer the newest frame's tiles together with the frame lists,
// one round trip earlier than the widget could ask; the tiles come back with
// their z/x/y, so the widget places them by id and nothing can drift.

const TILE = 256;
const ZOOMS = { local: 10, comarca: 9, region: 7 };
const RADAR_MAX_Z = 8;

function worldX(lon, z) { return ((lon + 180) / 360) * TILE * 2 ** z; }
function worldY(lat, z) {
  const c = Math.max(-85.05, Math.min(85.05, lat));
  return ((1 - Math.asinh(Math.tan((c * Math.PI) / 180)) / Math.PI) / 2) * TILE * 2 ** z;
}

/** The radar tiles ({z,x,y}) covering the widget's stage; [] when the inputs are not usable. */
function radarTilesFor({ lat, lon, zoom, width, height }) {
  const z = ZOOMS[zoom] || ZOOMS.comarca;
  const W = Number(width); const H = Number(height);
  if (![lat, lon, W, H].every(Number.isFinite) || W <= 0 || H <= 0 || W > 2000 || H > 2000) return [];
  const ox = worldX(lon, z) - W / 2; const oy = worldY(lat, z) - H / 2;
  const rz = z >= RADAR_MAX_Z ? RADAR_MAX_Z : 6; const size = TILE * 2 ** (z - rz);
  const tiles = [];
  for (let ty = Math.floor(oy / size); ty <= Math.floor((oy + H - 1) / size); ty++) {
    for (let tx = Math.floor(ox / size); tx <= Math.floor((ox + W - 1) / size); tx++) tiles.push({ z: rz, x: tx, y: ty });
  }
  return tiles.slice(0, MAX_TILES_PER_CALL);
}

module.exports = { TileCache, RadarTileSource, radarTilesFor, DEFAULT_MAX_BYTES, DEFAULT_FORECAST_TTL_MS, MAX_TILES_PER_CALL, MAX_FRAMES_PER_CALL };
