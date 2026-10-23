// Store images in the brand language (design/brand/README.md): the app image
// (an illustration: the sky-disc gradient as a landscape, the logo's cloud,
// the sun, the olive ground), the driver image (the logo disc on white), and
// the two single-colour line icons. Text-free. Rendered with sharp from SVG.
//   node scripts/widget-preview/render-store-images.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('/Users/zsolt/MeteoVeo/node_modules/sharp/dist/index.cjs');
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const outDir = path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });

const CLOUD_DEFS = `
  <linearGradient id="cloudFill" gradientUnits="userSpaceOnUse" x1="0" y1="50" x2="0" y2="106"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#f7f1e6"/><stop offset="1" stop-color="#dcd9c9"/></linearGradient>
  <linearGradient id="drop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#84d4f2"/><stop offset="1" stop-color="#2477a8"/></linearGradient>`;

/** The logo's cloud silhouette (the simple logo's shapes), flat paper-white with one soft gradient, in its own 132-unit space. */
const CLOUD = `
  <g fill="url(#cloudFill)">
    <circle cx="36" cy="84" r="16"/>
    <circle cx="82" cy="82" r="17"/>
    <circle cx="58" cy="74" r="22"/>
    <rect x="20" y="84" width="80" height="20" rx="10"/>
  </g>
  <path d="M22 97h76a11 11 0 0 1-11 7H33a11 11 0 0 1-11-7z" fill="#d3d4c3" opacity=".55"/>
  <ellipse cx="54" cy="62" rx="12" ry="5" fill="#ffffff" opacity=".55"/>`;

/** The app image: a 1000 x 700 landscape. */
function appSvg() {
  // Rain under the near cloud: five drops, two heights, the web icon set's drop shape.
  const drops = [[30, 114], [44, 122], [58, 114], [72, 122], [86, 114]]
    .map(([x, y]) => `<path d="M${x} ${y}c3.4 4.6 3.4 7 0 7s-3.4-2.4 0-7z" fill="url(#drop)" opacity=".95"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700" viewBox="0 0 1000 700">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b6fa8"/><stop offset=".42" stop-color="#7fb6cf"/><stop offset=".68" stop-color="#dfa137"/><stop offset=".86" stop-color="#bd4a2b"/></linearGradient>
    <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fdf1cf" stop-opacity=".9"/><stop offset=".45" stop-color="#fdf1cf" stop-opacity=".25"/><stop offset="1" stop-color="#fdf1cf" stop-opacity="0"/></radialGradient>
    <linearGradient id="hillBack" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ea05f"/><stop offset="1" stop-color="#6c7f4b"/></linearGradient>
    <linearGradient id="hillFront" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6c7f4b"/><stop offset="1" stop-color="#4f5f36"/></linearGradient>
    ${CLOUD_DEFS}
  </defs>
  <rect width="1000" height="700" fill="url(#sky)"/>
  <circle cx="760" cy="215" r="190" fill="url(#sunGlow)"/>
  <circle cx="760" cy="215" r="74" fill="#fdf1cf"/>
  <!-- the small cloud, far -->
  <g transform="translate(600 310) scale(1.5)" opacity=".95">${CLOUD}</g>
  <!-- the big cloud with rain, near -->
  <g transform="translate(120 40) scale(3.6)">${CLOUD}${drops}</g>
  <!-- the ground: two hills, the house's village as a thin line -->
  <path d="M0 560c140-50 260-62 410-30s270 60 410 18 180-40 180-40v192H0z" fill="url(#hillBack)"/>
  <path d="M0 610c120-44 250-60 400-28s300 70 450 32 150-30 150-30v116H0z" fill="url(#hillFront)"/>
  <!-- a few trees as discs, olive on olive -->
  <g fill="#43522f" opacity=".85"><circle cx="150" cy="596" r="10"/><circle cx="175" cy="604" r="13"/><circle cx="845" cy="590" r="11"/><circle cx="870" cy="598" r="9"/></g>
</svg>`;
}

/** The driver image: the logo disc on white, 1000 x 1000. */
function driverSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b6fa8"/><stop offset=".38" stop-color="#7fb6cf"/><stop offset=".62" stop-color="#dfa137"/><stop offset="1" stop-color="#bd4a2b"/></linearGradient>
    <clipPath id="disc"><circle cx="66" cy="66" r="63"/></clipPath>
    ${CLOUD_DEFS}
  </defs>
  <rect width="1000" height="1000" fill="#ffffff"/>
  <g transform="translate(170 170) scale(5)">
    <circle cx="66" cy="66" r="63" fill="url(#sky)"/>
    <g clip-path="url(#disc)">
      <circle cx="90" cy="38" r="18" fill="#fdf1cf"/>
      ${CLOUD}
      <rect x="0" y="110" width="132" height="22" fill="#6c7f4b"/>
    </g>
  </g>
</svg>`;
}

/** The app icon: the logo's silhouette as a single-colour line icon (disc outline, cloud, ground). */
const APP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 132 132"><circle cx="66" cy="66" r="58" fill="none" stroke="#000" stroke-width="8"/><g fill="#000"><circle cx="40" cy="80" r="13"/><circle cx="80" cy="78" r="14"/><circle cx="60" cy="68" r="19"/><rect x="27" y="80" width="67" height="14" rx="7"/></g><path d="M22 104h88" stroke="#000" stroke-width="8" stroke-linecap="round"/></svg>`;

/** The driver icon: a house with the cloud over it (the forecast for your home). */
const DRIVER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 132 132"><path d="M18 66 66 26l48 40" fill="none" stroke="#000" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><path d="M30 60v52h72V60" fill="none" stroke="#000" stroke-width="8" stroke-linejoin="round"/><g fill="#000"><circle cx="53" cy="87" r="9"/><circle cx="79" cy="85" r="10"/><circle cx="66" cy="78" r="13"/><rect x="44" y="87" width="44" height="10" rx="5"/></g></svg>`;

async function write(svg, sizes, target) {
  for (const [w, h, file] of sizes) {
    await sharp(Buffer.from(svg), { density: 300 }).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).png({ compressionLevel: 9, palette: w <= 500 }).toFile(path.join(repo, target, file));
    console.log('wrote', path.join(target, file), `${w}x${h}`);
  }
}

await write(appSvg(), [[1000, 700, 'xlarge.png'], [500, 350, 'large.png'], [250, 175, 'small.png']], 'assets/images');
await write(driverSvg(), [[1000, 1000, 'xlarge.png'], [500, 500, 'large.png'], [75, 75, 'small.png']], 'drivers/meteoveo/assets/images');
fs.writeFileSync(path.join(repo, 'assets', 'icon.svg'), APP_ICON + '\n');
fs.writeFileSync(path.join(repo, 'drivers', 'meteoveo', 'assets', 'icon.svg'), DRIVER_ICON + '\n');
// Previews of the icons for a look (not shipped).
for (const [name, svg] of [['app-icon', APP_ICON], ['driver-icon', DRIVER_ICON]]) {
  await sharp(Buffer.from(svg), { density: 300 }).resize(256, 256).flatten({ background: '#ffffff' }).png().toFile(path.join(outDir, `${name}.png`));
}
console.log('icons written; previews in', path.relative(repo, outDir));
