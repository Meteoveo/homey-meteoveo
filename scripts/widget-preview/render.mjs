// Dev harness: renders widgets/weather/public/index.html with a mocked Homey
// object and writes screenshots (and, with --previews, the App Store preview
// images). Usage:
//   node scripts/widget-preview/render.mjs                 # all variants, es
//   node scripts/widget-preview/render.mjs --lang en --only dry,raining --widths 360
//   node scripts/widget-preview/render.mjs --previews      # preview-light/dark.png
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/zsolt/MeteoVeo/node_modules/playwright/index.mjs';
import { variants } from './variants.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const widgetDir = path.join(repo, 'widgets', 'weather');
const outDir = path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const lang = opt('lang', 'es');
const only = opt('only', '').split(',').filter(Boolean);
const widths = opt('widths', '360,480').split(',').map(Number);
const themes = opt('themes', 'light,dark').split(',');
const layouts = opt('layouts', 'full').split(',');
const previews = args.includes('--previews');

const locale = JSON.parse(fs.readFileSync(path.join(repo, 'locales', `${lang}.json`), 'utf8'));
const mockCss = fs.readFileSync(path.join(here, 'homey-mock.css'), 'utf8');

function lookup(key) {
  return key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), locale);
}

/** Installs window.Homey and calls onHomeyReady once the page's script is parsed. */
function mockScript({ settings, data, strings, dark, preview }) {
  return `
    (() => {
      const strings = ${JSON.stringify(strings)};
      const Homey = {
        getSettings: () => (${JSON.stringify(settings)}),
        api: async () => (${JSON.stringify(data)}),
        __: (key, tokens) => {
          let s = strings[key];
          if (s === undefined) return key;
          for (const [k, v] of Object.entries(tokens || {})) s = s.split('__' + k + '__').join(String(v));
          return s;
        },
        ready: (a) => { window.__mvHeight = a && a.height; window.__mvReady = true; },
        setHeight: async (h) => { window.__mvHeight = h; },
        getLanguage: () => '${lang}',
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

const flat = {};
(function walk(o, p) { for (const [k, v] of Object.entries(o)) { if (v && typeof v === 'object') walk(v, p + k + '.'); else flat[p + k] = v; } }(locale, ''));

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

async function shoot(browser, { name, data, settings, width, dark, preview = false }) {
  const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 2 });
  await page.addInitScript(mockScript({ settings, data, strings: flat, dark, preview }));
  await page.goto('file://' + path.join(widgetDir, 'public', 'index.html'));
  await page.waitForFunction(() => window.__mvReady === true);
  await page.waitForTimeout(150);
  if (preview) await blankText(page);
  const height = await page.evaluate(() => Math.ceil(document.getElementById('root').getBoundingClientRect().height));
  await page.setViewportSize({ width, height });
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  await page.close();
  return { file, height };
}

const browser = await chromium.launch();
try {
  if (previews) {
    // 1024×1024 transparent, the widget centred with the dashboard's rounded frame, no text.
    const all = variants();
    for (const [theme, variant] of [['light', 'soon'], ['dark', 'night']]) {
      const shot = await shoot(browser, { name: `_preview-${theme}-src`, data: all[variant], settings: { layout: 'full' }, width: 440, dark: theme === 'dark', preview: true });
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
  } else {
    const all = variants();
    for (const [variant, data] of Object.entries(all)) {
      if (only.length && !only.includes(variant)) continue;
      for (const layout of layouts) for (const width of widths) for (const theme of themes) {
        const name = `${variant}${layout === 'full' ? '' : '-' + layout}-${theme}-${width}-${lang}`;
        const r = await shoot(browser, { name, data, settings: { layout }, width, dark: theme === 'dark' });
        console.log(name, r.height + 'px', path.relative(repo, r.file));
      }
    }
  }
} finally {
  await browser.close();
}
