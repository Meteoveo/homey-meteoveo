// Dev harness: renders widgets/weather/public/index.html with a mocked Homey
// object and writes screenshots (and, with --previews, the App Store preview
// images). Usage:
//   node scripts/widget-preview/render.mjs                          # all variants, Homey language es
//   node scripts/widget-preview/render.mjs --only dry --widths 360 --language ca
//   node scripts/widget-preview/render.mjs --only dry --edit        # the edit view
//   node scripts/widget-preview/render.mjs --only dry --layout reordered
//   node scripts/widget-preview/render.mjs --previews               # preview-light/dark.png
// Options: --lang <es|en> (the Homey language = "automatic"), --language <auto|es|en|ca>
// (the widget setting), --layout <default|reordered|minimal>, --edit, --themes, --widths, --only.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/zsolt/MeteoVeo/node_modules/playwright/index.mjs';
import { variants } from './variants.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const require = createRequire(import.meta.url);
const { normalizeLayout, defaultLayout } = require(path.join(repo, 'lib', 'widget-layout.js'));
const widgetDir = path.join(repo, 'widgets', 'weather');
const outDir = path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const lang = opt('lang', 'es');
const language = opt('language', 'auto');
const only = opt('only', '').split(',').filter(Boolean);
const widths = opt('widths', '360,480').split(',').map(Number);
const themes = opt('themes', 'light,dark').split(',');
const layoutName = opt('layout', 'default');
const edit = args.includes('--edit');
const licence = args.includes('--licence');
const bgName = opt('background', 'default');
const BACKGROUNDS = {
  default: undefined,
  weather70: { mode: 'weather', color: '#2b6fa8', opacity: 70 },
  paper: { mode: 'color', color: '#f1f8f4', opacity: 100 },
  cobalt: { mode: 'color', color: '#2b6fa8', opacity: 100 },
  'cobalt50': { mode: 'color', color: '#2b6fa8', opacity: 50 },
  transparent: { mode: 'transparent', color: '#2b6fa8', opacity: 100 },
};
const previews = args.includes('--previews');

const always = (ids) => ids.map((id) => ({ id, show: 'always' }));
const LAYOUTS = {
  default: undefined,
  reordered: { cards: [...always(['days', 'hero', 'nextHour']), { id: 'warning', show: 'auto' }, { id: 'metrics', show: 'never' }, { id: 'hours', show: 'never' }] },
  minimal: { cards: [...always(['hero', 'nextHour']), { id: 'warning', show: 'never' }, { id: 'metrics', show: 'never' }, { id: 'hours', show: 'never' }, { id: 'days', show: 'never' }] },
  // The next-hour card only when it rains (the owner's "csak ha lesz eső").
  'nexthour-auto': { cards: [{ id: 'warning', show: 'auto' }, ...always(['hero', 'metrics']), { id: 'nextHour', show: 'auto' }, ...always(['hours', 'days'])] },
  // The 0-3 h card only when it rains within 3 h.
  'nowcast-auto': { cards: [{ id: 'warning', show: 'auto' }, ...always(['hero', 'metrics', 'nextHour']), { id: 'nowcast3h', show: 'auto' }, ...always(['hours', 'days'])] },
  // The warning band always, with its quiet state on a calm day.
  'warning-always': { cards: [...always(['warning', 'hero', 'metrics', 'nextHour', 'hours', 'days'])] },
  // A layout saved before the three states: must migrate.
  legacy: { cards: [{ id: 'days', on: true }, { id: 'hero', on: true }, { id: 'nextHour', on: false }, { id: 'warning', on: true }, { id: 'metrics', on: false }, { id: 'hours', on: true }] },
};

const mockCss = fs.readFileSync(path.join(here, 'homey-mock.css'), 'utf8');

/** Installs window.Homey and calls onHomeyReady once the page's script is parsed. */
function mockScript({ settings, data, dark, preview }) {
  return `
    (() => {
      const Homey = {
        getSettings: () => (${JSON.stringify(settings)}),
        getWidgetInstanceId: () => 'preview-instance',
        hapticFeedback: () => { window.__mvHaptics = (window.__mvHaptics || 0) + 1; },
        api: async (method, path, body) => {
          if (method === 'PUT') { window.__mvPut = body; return window.__mvNormalize(body); }
          return (${JSON.stringify(data)});
        },
        __: (key) => key,
        ready: (a) => { window.__mvHeight = a && a.height; window.__mvReady = true; },
        setHeight: async (h) => { window.__mvHeight = h; },
      };
      window.Homey = Homey;
      document.addEventListener('DOMContentLoaded', () => {
        if (${dark}) document.documentElement.classList.add('homey-dark-mode');
        const style = document.createElement('style'); style.textContent = ${JSON.stringify(mockCss)}; document.head.prepend(style);
        if (${!!preview}) document.body.setAttribute('data-preview', '1');
        onHomeyReady(Homey);
      });
    })();`;
}

/** Text-free version for the App Store previews: every text run becomes a soft bar. */
async function blankText(page) {
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) if (walker.currentNode.nodeValue.trim()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      if (n.parentElement.closest('svg')) { n.nodeValue = ''; continue; }
      const span = document.createElement('span');
      span.textContent = n.nodeValue;
      span.style.cssText = 'color:transparent;text-shadow:none;background:rgba(255,255,255,.38);border-radius:5px;box-decoration-break:clone;-webkit-box-decoration-break:clone;';
      n.parentNode.replaceChild(span, n);
    }
    for (const t of document.querySelectorAll('svg text')) t.remove();
    // The licence line would only be a row of bars with a trailing ellipsis.
    for (const f of document.querySelectorAll('.foot')) f.remove();
  });
}

async function shoot(browser, { name, data, settings, width, dark, preview = false, openEdit = false, openLicence = false }) {
  const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 2 });
  await page.exposeFunction('__mvNormalize', (body) => normalizeLayout({ cards: body && body.cards, background: body && body.background }));
  await page.addInitScript(mockScript({ settings, data, dark, preview }));
  await page.goto('file://' + path.join(widgetDir, 'public', 'index.html'));
  await page.waitForFunction(() => window.__mvReady === true);
  await page.waitForTimeout(150);
  if (openEdit) {
    await page.click('.edit-btn');
    await page.waitForSelector('.rows .row');
    await page.waitForTimeout(100);
  }
  if (openLicence) {
    await page.click('.foot .lic');
    await page.waitForSelector('.foot .lic.open');
    await page.waitForTimeout(100);
  }
  if (preview) await blankText(page);
  const height = await page.evaluate(() => Math.ceil(document.getElementById('root').getBoundingClientRect().height));
  await page.setViewportSize({ width, height });
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  await page.close();
  return { file, height };
}

/** A scripted tap-to-move in the edit view: proves the reorder and the PUT round trip. */
async function dragCheck(browser, data) {
  const page = await browser.newPage({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 1 });
  await page.exposeFunction('__mvNormalize', (body) => normalizeLayout({ cards: body && body.cards, background: body && body.background }));
  await page.addInitScript(mockScript({ settings: { language: 'es' }, data, dark: false }));
  await page.goto('file://' + path.join(widgetDir, 'public', 'index.html'));
  await page.waitForFunction(() => window.__mvReady === true);
  await page.click('.edit-btn');
  await page.waitForSelector('.rows .row');
  // Tap to pick up the first card, tap the fourth row to place it there.
  await page.click('.rows .row:nth-child(1) .handle');
  await page.click('.rows .row:nth-child(4) .name');
  const order = await page.$$eval('.rows .row', (rows) => rows.map((r) => r.dataset.id));
  await page.click('.rows .row:nth-child(2) .switch');
  // The next-hour card to "if rain", the warning band to "always".
  await page.click('.rows .row[data-id="nextHour"] .seg button[data-show="auto"]');
  await page.click('.rows .row[data-id="nowcast3h"] .seg button[data-show="never"]');
  await page.click('.rows .row[data-id="warning"] .seg button[data-show="always"]');
  // Refused: with every other card off or auto, the last 'always' (hero) may not leave.
  for (const id of ['hours', 'days']) await page.click(`.rows .row[data-id="${id}"] .switch`);
  await page.click('.rows .row[data-id="warning"] .seg button[data-show="auto"]');
  await page.click('.rows .row[data-id="hero"] .switch');
  const refused = await page.$eval('.edit-msg', (m) => m.textContent);
  const heroStill = await page.$eval('.rows .row[data-id="hero"] .switch', (b) => b.getAttribute('aria-checked'));
  await page.click('.rows .row[data-id="warning"] .seg button[data-show="always"]');
  for (const id of ['hours', 'days']) await page.click(`.rows .row[data-id="${id}"] .switch`);
  // Background: a light solid colour at 60 % -> the ink scheme must switch on live, and the PUT must carry it.
  await page.click('.bg-seg button[data-mode="color"]');
  await page.click('.swatch[data-color="#f1f8f4"]');
  await page.$eval('.opacity input', (r) => { r.value = '60'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  const inkWhileEditing = await page.$eval('.sky', (s) => s.classList.contains('ink'));
  await page.click('.btn.primary');
  await page.waitForSelector('.edit-btn');
  const put = await page.evaluate(() => window.__mvPut);
  const haptics = await page.evaluate(() => window.__mvHaptics);
  const shown = await page.$$eval('.wrap > *', (nodes) => nodes.map((n) => n.className.split(' ')[0]));
  const inkAfterSave = await page.$eval('.sky', (s) => s.classList.contains('ink'));
  const bgStyle = await page.$eval('.sky > .bg', (b) => b.style.backgroundColor + ' @ ' + b.style.opacity);
  await page.close();
  return { order, put, haptics, shown, refused, heroStill, inkWhileEditing, inkAfterSave, bgStyle };
}

const browser = await chromium.launch();
try {
  const all = variants({ language: lang });
  if (previews) {
    // 1024×1024 transparent, the widget centred with the dashboard's rounded frame, no text.
    for (const [theme, variant] of [['light', 'soon'], ['dark', 'night']]) {
      const shot = await shoot(browser, { name: `_preview-${theme}-src`, data: all[variant], settings: { language: 'es' }, width: 440, dark: theme === 'dark', preview: true });
      const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
      const png = fs.readFileSync(shot.file).toString('base64');
      const scale = Math.min(1, 960 / (shot.height * 2), 900 / 880);
      await page.setContent(`<html><body style="margin:0;width:1024px;height:1024px;display:flex;align-items:center;justify-content:center;background:transparent">
        <div style="width:${Math.round(880 * scale)}px;height:${Math.round(shot.height * 2 * scale)}px;border-radius:${Math.round(40 * scale)}px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.25)">
          <img src="data:image/png;base64,${png}" style="display:block;width:100%;height:100%" /></div></body></html>`);
      const file = path.join(widgetDir, `preview-${theme}.png`);
      const raw = file + '.raw.png';
      await page.screenshot({ path: raw, omitBackground: true });
      await page.close();
      fs.unlinkSync(shot.file);
      // Palette PNG: a third of the size, no visible change in a store thumbnail.
      const { default: sharp } = await import('/Users/zsolt/MeteoVeo/node_modules/sharp/dist/index.cjs');
      await sharp(raw).png({ palette: true, quality: 90, compressionLevel: 9 }).toFile(file);
      fs.unlinkSync(raw);
      console.log('wrote', file);
    }
  } else if (args.includes('--drag-check')) {
    console.log(JSON.stringify(await dragCheck(browser, all.dry), null, 1));
  } else {
    for (const [variant, base] of Object.entries(all)) {
      if (only.length && !only.includes(variant)) continue;
      let data = LAYOUTS[layoutName] ? { ...base, layout: LAYOUTS[layoutName] } : base;
      if (BACKGROUNDS[bgName]) data = { ...data, layout: { ...(data.layout || defaultLayout()), background: BACKGROUNDS[bgName] } };
      for (const width of widths) for (const theme of themes) {
        const tag = [variant, layoutName !== 'default' ? layoutName : '', bgName !== 'default' ? 'bg-' + bgName : '', edit ? 'edit' : '', licence ? 'licence' : '', theme, width, language === 'auto' ? lang : language].filter(Boolean).join('-');
        const r = await shoot(browser, { name: tag, data, settings: { language }, width, dark: theme === 'dark', openEdit: edit, openLicence: licence });
        console.log(tag, r.height + 'px', path.relative(repo, r.file));
      }
    }
  }
} finally {
  await browser.close();
}
