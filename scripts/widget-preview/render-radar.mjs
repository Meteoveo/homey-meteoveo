// Dev harness for the radar widget: the page runs against a mocked Homey whose
// /radar and /tiles calls go to the LIVE API through lib/client.js with a dev
// integration key (never printed, never committed). Usage:
//   MV_RADAR_KEY_FILE=/path/key.json node scripts/widget-preview/render-radar.mjs [--lat 40.45 --lon 0.70 --name Vinaròs]
//     [--zoom local|comarca|region] [--language auto|es|en|ca] [--lang es|en] [--widths 360,480] [--themes light,dark]
//     [--frame last|first|rainy|<n>] [--previews]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/zsolt/MeteoVeo/node_modules/playwright/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const require = createRequire(import.meta.url);
const { MeteoVeoClient } = require(path.join(repo, 'lib', 'client.js'));
const widgetDir = path.join(repo, 'widgets', 'radar');
const outDir = path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const keyFile = process.env.MV_RADAR_KEY_FILE;
if (!keyFile) { console.error('MV_RADAR_KEY_FILE is required (a JSON with key, lat, lon)'); process.exit(2); }
const dev = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
const lat = Number(opt('lat', dev.lat)); const lon = Number(opt('lon', dev.lon));
const name = opt('name', 'Castellonet de la Conquesta');
const zoom = opt('zoom', 'comarca');
const language = opt('language', 'auto');
const lang = opt('lang', 'es');
const widths = opt('widths', '360,480').split(',').map(Number);
const themes = opt('themes', 'light,dark').split(',');
const frameOpt = opt('frame', 'last');
const previews = args.includes('--previews');

const client = new MeteoVeoClient({ version: 'preview' });
const mockCss = fs.readFileSync(path.join(here, 'homey-mock.css'), 'utf8');

async function api(method, p, body) {
  if (p.startsWith('/radar')) {
    const lists = await client.radarFrames(dev.key, 2);
    return { state: 'ok', language: lang, timezone: 'Europe/Madrid', name: 'MeteoVeo ' + name, place: { name, lat, lon }, lat, lon, ...lists };
  }
  if (p === '/tiles') {
    // Like app.radarTiles: four at a time, a missing tile is null.
    const list = (body && body.tiles) || [];
    const out = new Array(list.length).fill(null);
    let next = 0;
    const worker = async () => { while (next < list.length) { const i = next++; try { const tile = await client.radarTile(dev.key, list[i]); if (tile) out[i] = { type: tile.type, data: tile.bytes.toString('base64') }; } catch (e) { /* skip */ } } };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return out;
  }
  throw new Error('unknown path ' + p);
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

async function shoot(browser, { tag, width, dark, settings, preview = false }) {
  const page = await browser.newPage({ viewport: { width, height: 700 }, deviceScaleFactor: 2 });
  await page.exposeFunction('__mvApi', api);
  await page.addInitScript(mockScript({ settings, dark }));
  await page.goto('file://' + path.join(widgetDir, 'public', 'index.html'));
  await page.waitForFunction(() => window.__mvReady === true, null, { timeout: 60000 });
  await page.waitForFunction(() => window.__mvRadarReady === true, null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(400);
  const frames = await page.evaluate(() => window.__mvRadar.frames());
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
  return { file, height, frames };
}

const browser = await chromium.launch();
try {
  if (previews) {
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
}
