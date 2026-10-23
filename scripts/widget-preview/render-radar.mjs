// Dev harness for the radar widget: the page runs against a mocked Homey whose
// /radar and /tiles calls go to the LIVE API through lib/client.js with a dev
// integration key (never printed, never committed). Usage:
//   MV_RADAR_KEY_FILE=/path/key.json node scripts/widget-preview/render-radar.mjs [--lat 40.45 --lon 0.70 --name Vinaròs]
//     [--zoom local|comarca|region] [--language auto|es|en|ca] [--lang es|en] [--widths 360,480] [--themes light,dark]
//     [--frame last|first|rainy|<n>] [--previews]
//   Measurement without a key, against a fake API with realistic latency (--fake), through the same
//   RadarTileSource the app uses; --legacy drives the pre-round-7 page from a saved copy with the old
//   flat proxy (4 fetches at a time, no cache) for the before/after comparison:
//   node scripts/widget-preview/render-radar.mjs --fake [--latency 120] [--rpc 30] [--legacy <dir>] [--runs 2]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/zsolt/MeteoVeo/node_modules/playwright/index.mjs';
import { startFakeRadar } from './fake-radar-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const require = createRequire(import.meta.url);
const { MeteoVeoClient } = require(path.join(repo, 'lib', 'client.js'));
const { TileCache, RadarTileSource, radarTilesFor } = require(path.join(repo, 'lib', 'tile-cache.js'));
const widgetDir = path.join(repo, 'widgets', 'radar');
const outDir = path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const fake = args.includes('--fake');
const legacyDir = opt('legacy', null);
const keyFile = process.env.MV_RADAR_KEY_FILE;
if (!keyFile && !fake) { console.error('MV_RADAR_KEY_FILE is required (a JSON with key, lat, lon), or --fake'); process.exit(2); }
const dev = keyFile ? JSON.parse(fs.readFileSync(keyFile, 'utf8')) : { key: 'fake-key', lat: 38.92, lon: -0.26 };
const lat = Number(opt('lat', dev.lat)); const lon = Number(opt('lon', dev.lon));
const name = opt('name', 'Castellonet de la Conquesta');
const zoom = opt('zoom', 'comarca');
const language = opt('language', 'auto');
const lang = opt('lang', 'es');
const widths = opt('widths', '360,480').split(',').map(Number);
const themes = opt('themes', 'light,dark').split(',');
const frameOpt = opt('frame', 'last');
const previews = args.includes('--previews');

const fakeServer = fake ? await startFakeRadar({ latencyMs: Number(opt('latency', 120)), bearer: dev.key }) : null;
const rpcMs = Number(opt('rpc', 30)); // simulated Homey RPC overhead per widget->app call (plus 0.2 ms per KB)
const client = new MeteoVeoClient({ version: 'preview', apiBase: fakeServer ? fakeServer.url : undefined });
const appLog = [];
const source = new RadarTileSource({ client, cache: new TileCache(), concurrency: 10, log: (m) => appLog.push(m) });
const rpc = { calls: 0, bytes: 0 };
const mockCss = fs.readFileSync(path.join(here, 'homey-mock.css'), 'utf8');

/** The app side, as app.js does it: lists, and tiles through the cached source (or the old flat proxy under --legacy). */
async function api(method, p, body) {
  rpc.calls++;
  let out;
  if (p.startsWith('/radar')) {
    const lists = await client.radarFrames(dev.key, 2);
    out = { state: 'ok', language: lang, timezone: 'Europe/Madrid', name: 'MeteoVeo ' + name, place: { name, lat, lon }, lat, lon, ...lists };
    // As app.radarData(): the newest frame's tiles with the lists when the widget tells its stage.
    const q = new URL('http://x' + p).searchParams;
    if (q.get('zoom') && lists.frames.length) {
      const tiles = radarTilesFor({ lat, lon, zoom: q.get('zoom'), width: Number(q.get('w')), height: Number(q.get('h')) });
      if (tiles.length) {
        const at = lists.frames[lists.frames.length - 1];
        const { frames } = await source.tiles(dev.key, { frames: [{ at, kind: 'obs' }], tiles });
        out.first = { at, tiles: tiles.map((t, i) => ({ ...t, tile: frames[0].tiles[i] })) };
      }
    }
  } else if (p === '/tiles' && body && Array.isArray(body.frames)) {
    out = await source.tiles(dev.key, { frames: body.frames, tiles: body.tiles });
  } else if (p === '/tiles') {
    // The first widget's proxy: one frame per call, four at a time, no cache.
    const list = (body && body.tiles) || [];
    const res = new Array(list.length).fill(null);
    let next = 0;
    const worker = async () => { while (next < list.length) { const i = next++; try { const tile = await client.radarTile(dev.key, list[i]); if (tile) res[i] = { type: tile.type, data: tile.bytes.toString('base64') }; } catch (e) { res[i] = { error: true }; } } };
    await Promise.all([worker(), worker(), worker(), worker()]);
    out = res;
  } else throw new Error('unknown path ' + p);
  const size = JSON.stringify(out).length;
  rpc.bytes += size;
  if (fake) await new Promise((r) => setTimeout(r, rpcMs + size / 1024 * 0.2));
  return out;
}

function mockScript({ settings, dark }) {
  return `(() => {
    const Homey = {
      getSettings: () => (${JSON.stringify(settings)}),
      getWidgetInstanceId: () => 'preview-radar',
      hapticFeedback: () => {},
      api: (method, path, body) => window.__mvApi(method, path, body || null),
      __: (k) => k,
      ready: (a) => { window.__mvHeight = a && a.height; window.__mvReady = true; },
      setHeight: async (h) => { window.__mvHeight = h; },
    };
    window.Homey = Homey;
    document.addEventListener('DOMContentLoaded', () => {
      if (${dark}) document.documentElement.classList.add('homey-dark-mode');
      const style = document.createElement('style'); style.textContent = ${JSON.stringify(mockCss)}; document.head.prepend(style);
      onHomeyReady(Homey);
    });
  })();`;
}

/** Text-free version for the App Store previews: text runs become soft bars, the credit goes. */
async function blankText(page) {
  await page.evaluate(() => {
    for (const c of document.querySelectorAll('.credit')) c.remove();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) if (walker.currentNode.nodeValue.trim()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      if (n.parentElement.closest('svg')) { n.nodeValue = ''; continue; }
      const span = document.createElement('span');
      span.textContent = n.nodeValue;
      span.style.cssText = 'color:transparent;background:rgba(255,255,255,.45);border-radius:5px;';
      n.parentNode.replaceChild(span, n);
    }
  });
}

const snapAt = opt('snap-at', null); // screenshot after N ms, without waiting for the frames (the loading state)
async function shoot(browser, { tag, width, dark, settings, preview = false }) {
  const page = await browser.newPage({ viewport: { width, height: 700 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.log('page error:', e.message));
  page.on('crash', () => console.log('page CRASHED'));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text().slice(0, 200)); });
  await page.exposeFunction('__mvApi', api);
  await page.addInitScript(mockScript({ settings, dark }));
  await page.goto('file://' + path.join(legacyDir || path.join(widgetDir, 'public'), 'index.html'));
  if (snapAt) {
    // The loading state of a dashboard that was opened before: let the page remember its place
    // (localStorage), open it again, and shoot N ms after that load.
    await page.waitForFunction(() => window.__mvReady === true, null, { timeout: 60000 });
    await page.goto('file://' + path.join(legacyDir || path.join(widgetDir, 'public'), 'index.html'));
    await page.waitForTimeout(Number(snapAt));
    const h0 = await page.evaluate(() => Math.ceil(document.getElementById('root').getBoundingClientRect().height) || 448);
    await page.setViewportSize({ width, height: h0 });
    const f0 = path.join(outDir, `radar-${tag}-loading.png`);
    await page.screenshot({ path: f0 });
    console.log('loading snapshot', path.relative(repo, f0));
  }
  await page.waitForFunction(() => window.__mvReady === true, null, { timeout: 60000 });
  const tStart = Date.now();
  await page.waitForFunction(() => window.__mvRadarReady === true, null, { timeout: 120000 }).catch(() => {});
  const wallAll = Date.now() - tStart;
  await page.waitForTimeout(400);
  const frames = await page.evaluate(() => window.__mvRadar.frames());
  const timing = await page.evaluate(() => (window.__mvRadar.timing ? window.__mvRadar.timing() : { first: null, all: null }));
  const visible = frames.filter((f) => f.status !== 'missing');
  const lastObs = visible.map((f) => f.kind).lastIndexOf('obs');
  // 'rainy' = the last observed frame that has any echo (for a screenshot that shows the layer).
  const lastRainy = visible.map((f) => (f.kind === 'obs' && f.painted > 0 ? 1 : 0)).lastIndexOf(1);
  const want = frameOpt === 'last' ? lastObs : frameOpt === 'first' ? 0 : frameOpt === 'rainy' ? (lastRainy >= 0 ? lastRainy : lastObs) : Number(frameOpt);
  await page.evaluate((i) => window.__mvRadar.show(i), want);
  await page.waitForTimeout(150);
  if (preview) await blankText(page);
  const height = await page.evaluate(() => Math.ceil(document.getElementById('root').getBoundingClientRect().height));
  await page.setViewportSize({ width, height });
  const file = path.join(outDir, `radar-${tag}.png`);
  await page.screenshot({ path: file });
  await page.close();
  return { file, height, frames, timing: { ...timing, wallAll } };
}

/** First-frame and all-frames times, measured in the page; the fake server's request count; the simulated RPC. */
async function measure(browser, label) {
  const before = fakeServer ? { ...fakeServer.stats } : null;
  const callsBefore = rpc.calls; const bytesBefore = rpc.bytes;
  const page = await browser.newPage({ viewport: { width: 360, height: 700 } });
  page.on('pageerror', (e) => console.log('page error:', e.message));
  page.on('crash', () => console.log('page CRASHED'));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text().slice(0, 200)); });
  await page.exposeFunction('__mvApi', api);
  await page.addInitScript(mockScript({ settings: { zoom, language: 'es' }, dark: false }));
  const t0 = Date.now();
  await page.goto('file://' + path.join(legacyDir || path.join(widgetDir, 'public'), 'index.html'));
  // The first painted frame: poll the hook (the legacy page has no timing hook, so watch its frames).
  let first = null;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const painted = await page.evaluate(() => (window.__mvRadar ? window.__mvRadar.frames().some((f) => f.status === 'ready') : false)).catch(() => false);
    if (painted) { first = Date.now() - t0; break; }
    await page.waitForTimeout(20);
  }
  await page.waitForFunction(() => window.__mvRadarReady === true, null, { timeout: 120000 }).catch(() => {});
  const all = Date.now() - t0;
  const pauseShownEarly = await page.evaluate(() => document.querySelector('.play') && document.querySelector('.play').getAttribute('aria-label'));
  await page.close();
  const s = fakeServer ? fakeServer.stats : null;
  console.log(`${label}: first frame ${first} ms · all frames ${all} ms · widget->app calls ${rpc.calls - callsBefore} (${Math.round((rpc.bytes - bytesBefore) / 1024)} KB)`
    + (s ? ` · server tile requests ${s.tiles - before.tiles} (404: ${s.tile404 - before.tile404})` : '') + ` · play button now: ${pauseShownEarly}`);
  return { first, all };
}

const browser = await chromium.launch();
try {
  if (fake && !previews && !args.includes('--shots')) {
    const runs = Number(opt('runs', 2));
    for (let i = 1; i <= runs; i++) await measure(browser, `${legacyDir ? 'legacy' : 'new'} run ${i}${i > 1 ? ' (second widget / warm cache)' : ' (cold)'}`);
    if (!legacyDir) { console.log('app log, last lines:'); for (const l of appLog.slice(-4)) console.log('  ' + l); }
  } else if (previews) {
    for (const theme of ['light', 'dark']) {
      const shot = await shoot(browser, { tag: `_preview-${theme}`, width: 440, dark: theme === 'dark', settings: { zoom, language: 'es' }, preview: true });
      const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
      const png = fs.readFileSync(shot.file).toString('base64');
      const scale = Math.min(1, 960 / (shot.height * 2), 900 / 880);
      await page.setContent(`<html><body style="margin:0;width:1024px;height:1024px;display:flex;align-items:center;justify-content:center;background:transparent">
        <div style="width:${Math.round(880 * scale)}px;height:${Math.round(shot.height * 2 * scale)}px;border-radius:${Math.round(40 * scale)}px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.25)"><img src="data:image/png;base64,${png}" style="display:block;width:100%;height:100%"/></div></body></html>`);
      const file = path.join(widgetDir, `preview-${theme}.png`);
      const raw = file + '.raw.png';
      await page.screenshot({ path: raw, omitBackground: true });
      await page.close();
      fs.unlinkSync(shot.file);
      const { default: sharp } = await import('/Users/zsolt/MeteoVeo/node_modules/sharp/dist/index.cjs');
      await sharp(raw).png({ palette: true, quality: 90, compressionLevel: 9 }).toFile(file);
      fs.unlinkSync(raw);
      console.log('wrote', file);
    }
  } else {
    for (const width of widths) for (const theme of themes) {
      const tag = [zoom, theme, width, language === 'auto' ? lang : language, name.replace(/\W+/g, '').slice(0, 12)].join('-');
      const r = await shoot(browser, { tag, width, dark: theme === 'dark', settings: { zoom, language } });
      const summary = r.frames.map((f) => (f.kind === 'fc' ? 'F' : 'o') + (f.status === 'ready' ? (f.painted ? '' : '.') : f.status === 'missing' ? 'x' : '?')).join('');
      // o = observed frame with echo, o. = observed frame painted empty, F = forecast with echo, x = failed
      console.log(tag, r.height + 'px', summary, path.relative(repo, r.file));
    }
  }
} finally {
  await browser.close();
  if (fakeServer) await fakeServer.close();
}
