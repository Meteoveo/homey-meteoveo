// Previews of the icons the way Homey shows them: as a single-colour mask -
// white on dark, dark on light, at 32 and 96 px - and the app icon white on
// the brand-colour disc (the brand tile in "New device"). Output in
// scripts/widget-preview/out/icons/. Run make-icons.py first.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('/Users/zsolt/MeteoVeo/node_modules/sharp/dist/index.cjs');
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const out = path.join(here, 'out', 'icons');
fs.mkdirSync(out, { recursive: true });

const ICONS = {
  app: 'assets/icon.svg',
  device: 'drivers/meteoveo/assets/icon.svg',
  condition: 'assets/capabilities/condition.svg',
  rain: 'assets/capabilities/rain.svg',
  clock: 'assets/capabilities/clock.svg',
  warning: 'assets/capabilities/warning.svg',
};

const recolour = (svg, fill) => svg.replace(/fill="#000"/g, `fill="${fill}"`);

async function tile(svgText, { size, fg, bg, disc = false, pad = 0.18 }) {
  const inner = Math.round(size * (1 - 2 * pad));
  const icon = await sharp(Buffer.from(recolour(svgText, fg)), { density: 400 }).resize(inner, inner).png().toBuffer();
  const back = disc
    ? Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${bg}"/></svg>`)
    : Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="${bg}"/></svg>`);
  return sharp(back).composite([{ input: icon, left: Math.round((size - inner) / 2), top: Math.round((size - inner) / 2) }]).png().toBuffer();
}

/** One sheet per icon: [32 dark, 32 light, 32 brand] + [96 dark, 96 light, 96 brand], on a neutral grey. */
async function sheet(name, file) {
  const svgText = fs.readFileSync(path.join(repo, file), 'utf8');
  const cells = [];
  for (const size of [32, 96]) {
    cells.push(await tile(svgText, { size, fg: '#ffffff', bg: '#1c1c1e' }));
    cells.push(await tile(svgText, { size, fg: '#1c1c1e', bg: '#ffffff' }));
    cells.push(await tile(svgText, { size, fg: '#ffffff', bg: '#2b6fa8', disc: true }));
  }
  const gap = 16;
  const widths = [32, 32, 32, 96, 96, 96];
  const totalW = widths.reduce((a, b) => a + b, 0) + gap * 7;
  const H = 96 + gap * 2;
  const composites = [];
  let x = gap;
  cells.forEach((buf, i) => { composites.push({ input: buf, left: x, top: Math.round((H - widths[i]) / 2) }); x += widths[i] + gap; });
  const file2 = path.join(out, `${name}.png`);
  await sharp({ create: { width: totalW, height: H, channels: 4, background: '#8e8e93' } }).composite(composites).png().toFile(file2);
  // The icon at 1:1 scale for a close look too.
  await sharp(Buffer.from(recolour(svgText, '#1c1c1e')), { density: 300 }).resize(480, 480).flatten({ background: '#ffffff' }).png().toFile(path.join(out, `${name}-480.png`));
  return file2;
}

for (const [name, file] of Object.entries(ICONS)) console.log('wrote', path.relative(repo, await sheet(name, file)));
