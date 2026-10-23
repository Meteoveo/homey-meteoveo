// A fake MeteoVeo radar API for measuring the widget's loading path without a
// live key: the frame lists (11 observed 10-minute instants + 6 nowcast ones)
// and coloured tiles - synthetic PNGs with an echo that drifts with time -
// behind a configurable latency, with 404 for tiles outside the echo (as the
// real server answers for empty tiles, ADR-0171). Counts every request.
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('/Users/zsolt/MeteoVeo/node_modules/sharp/dist/index.cjs');

const STEP = 600000;

export async function startFakeRadar({ latencyMs = 120, perKbMs = 0.5, observed = 11, forecast = 6, echoTiles = (t) => (t.x + t.y) % 3 !== 0, bearer = null } = {}) {
  const stats = { frames: 0, tiles: 0, tile404: 0, bytes: 0 };
  const pngCache = new Map();

  async function tilePng(z, x, y, atIndex) {
    const key = `${z}/${x}/${y}/${atIndex}`;
    if (pngCache.has(key)) return pngCache.get(key);
    // An echo: a soft blob moving ~12 px per frame, colours from the radar ramp.
    const W = 256;
    const raw = Buffer.alloc(W * W * 4, 0);
    const cx = 60 + ((x * 37 + atIndex * 12) % 140); const cy = 70 + ((y * 53 + atIndex * 7) % 120);
    for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) {
      const d = Math.hypot(px - cx, py - cy);
      if (d > 70) continue;
      const i = (py * W + px) * 4;
      const t = d / 70;
      const [r, g, b, a] = t < 0.25 ? [255, 40, 40, 230] : t < 0.45 ? [255, 140, 0, 210] : t < 0.65 ? [255, 220, 0, 185] : t < 0.85 ? [0, 110, 255, 150] : [80, 170, 255, 120];
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a;
    }
    const png = await sharp(raw, { raw: { width: W, height: W, channels: 4 } }).png({ compressionLevel: 6 }).toBuffer();
    pngCache.set(key, png);
    return png;
  }

  const base = Math.floor(Date.now() / STEP) * STEP - 2 * STEP; // the newest observed instant
  const lists = () => {
    const frames = Array.from({ length: observed }, (_, i) => new Date(base - (observed - 1 - i) * STEP).toISOString());
    const fc = Array.from({ length: forecast }, (_, i) => new Date(base + (i + 1) * STEP).toISOString());
    return { layer: 'radar', frames, forecast: fc, forecastBaseAt: new Date(base).toISOString() };
  };
  const indexOf = (at) => Math.round((Date.parse(at) - base) / STEP); // 0 = newest observed, >0 forecast, <0 older

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (bearer && req.headers.authorization !== `Bearer ${bearer}`) { res.writeHead(401); res.end(); return; }
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    if (url.pathname === '/v1/overlays/radar/frames') {
      stats.frames++;
      await wait(latencyMs);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(lists())); return;
    }
    const m = /^\/v1\/overlays\/radar\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(url.pathname);
    if (m) {
      stats.tiles++;
      const [z, x, y] = m.slice(1).map(Number);
      const at = url.searchParams.get('at');
      const idx = at ? indexOf(at) : 0;
      const empty = !echoTiles({ z, x, y, idx }) || idx > forecast || idx < -(observed - 1);
      if (empty) { stats.tile404++; await wait(latencyMs); res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"nincs csempe erre a területre"}'); return; }
      const png = await tilePng(z, x, y, idx);
      await wait(latencyMs + (png.length / 1024) * perKbMs);
      stats.bytes += png.length;
      res.writeHead(200, { 'content-type': 'image/png' }); res.end(png); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, stats, lists, close: () => new Promise((r) => server.close(r)) };
}
