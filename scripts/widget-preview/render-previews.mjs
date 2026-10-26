// Store previews for the two widgets (widgets/*/preview-{light,dark}.png).
// App Store guideline 1.10: a simplified picture of the widget — shapes only,
// no text, no screenshot — on a transparent 1024×1024 canvas, light and dark.
//
//   node scripts/widget-preview/render-previews.mjs

import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const THEMES = {
  light: { card: '#ffffff', shape: '#e6e9ee', soft: '#f1f3f6', shadow: 'rgba(16,24,40,0.16)', map: '#dfe7ee', land: '#eef1ea' },
  dark: { card: '#26272b', shape: '#3a3c42', soft: '#303237', shadow: 'rgba(0,0,0,0.45)', map: '#2c3a46', land: '#34362f' },
};
// MeteoVeo's own colours: sky blue, sun, and the next-hour rain bands.
const BLUE = '#2b6fa8';
const SUN = '#f5b82e';
const RAIN = ['#5cc59a', '#4f9f84', '#c9a640'];

const rect = (x, y, w, h, r, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;

function frame(t, x, y, w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="10" stdDeviation="18" flood-color="${t.shadow}"/></filter></defs>
  <g filter="url(#s)">${rect(x, y, w, h, 40, t.card)}</g>
  ${body}
</svg>`;
}

// The forecast widget: header, now (temperature + sky), four values, the
// next-hour bars, the hourly line and seven days.
function weather(t) {
  const x = 212; const y = 45; const w = 600; const h = 934;
  const p = x + 44;
  const bars = Array.from({ length: 12 }, (_, i) => {
    const color = i < 3 ? t.shape : RAIN[i >= 5 && i <= 7 ? 2 : i % 2];
    const bh = i >= 5 && i <= 7 ? 40 : i < 3 ? 10 : 26;
    return rect(p + i * 43, y + 452 - bh, 34, bh, 8, color);
  }).join('');
  const days = Array.from({ length: 7 }, (_, i) => {
    const cx = p + 22 + i * 75;
    const icon = i % 3 === 1
      ? `<circle cx="${cx}" cy="${y + 790}" r="16" fill="${SUN}"/>`
      : `<circle cx="${cx - 6}" cy="${y + 792}" r="14" fill="${t.shape}"/><circle cx="${cx + 8}" cy="${y + 788}" r="17" fill="${t.shape}"/>`;
    return icon + rect(cx - 18, y + 826, 36, 14, 7, t.shape) + rect(cx - 14, y + 852, 28, 12, 6, t.soft);
  }).join('');
  const line = [0, 1, 2, 3, 4, 5].map((i) => `${p + 20 + i * 98},${y + 560 + [0, 14, 22, 40, 46, 60][i]}`).join(' ');
  const body = [
    `<circle cx="${p + 18}" cy="${y + 58}" r="18" fill="${BLUE}"/>`,
    rect(p + 48, y + 48, 120, 20, 10, t.shape),
    rect(x + w - 44 - 150, y + 42, 150, 32, 16, t.soft),
    rect(p, y + 110, 330, 30, 15, t.shape),
    rect(p, y + 168, 190, 100, 24, t.shape),
    `<circle cx="${p + 300}" cy="${y + 200}" r="34" fill="${SUN}"/>`,
    `<circle cx="${p + 262}" cy="${y + 236}" r="30" fill="${t.shape}"/><circle cx="${p + 306}" cy="${y + 226}" r="38" fill="${t.shape}"/>`,
    `<rect x="${p + 236}" y="${y + 232}" width="110" height="34" rx="17" fill="${t.shape}"/>`,
    rect(p + 380, y + 176, 132, 22, 11, t.shape),
    rect(p + 380, y + 212, 90, 18, 9, t.soft),
    rect(p + 380, y + 242, 90, 18, 9, t.soft),
    rect(p, y + 300, w - 88, 64, 18, t.soft),
    rect(p, y + 384, w - 88, 96, 22, t.soft),
    rect(p + 16, y + 398, 170, 16, 8, t.shape),
    bars,
    rect(p, y + 500, w - 88, 150, 22, t.soft),
    `<polyline points="${line}" fill="none" stroke="${SUN}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
    rect(p, y + 670, w - 88, 220, 22, t.soft),
    rect(p + 16, y + 690, 110, 16, 8, t.shape),
    days,
  ].join('\n  ');
  return frame(t, x, y, w, h, body);
}

// The radar widget: a map with rain echoes around the home, and the loop's timeline.
function radar(t) {
  const x = 152; const y = 92; const w = 720; const h = 840;
  const m = { x: x + 36, y: y + 92, w: w - 72, h: 600 };
  const body = [
    `<circle cx="${x + 62}" cy="${y + 50}" r="18" fill="${BLUE}"/>`,
    rect(x + 92, y + 40, 140, 20, 10, t.shape),
    rect(x + w - 36 - 120, y + 34, 120, 32, 16, t.soft),
    `<clipPath id="m">${rect(m.x, m.y, m.w, m.h, 26, '#000')}</clipPath>`,
    `<g clip-path="url(#m)">`,
    rect(m.x, m.y, m.w, m.h, 0, t.map),
    `<path d="M${m.x} ${m.y + 380} C ${m.x + 160} ${m.y + 300}, ${m.x + 260} ${m.y + 420}, ${m.x + 380} ${m.y + 330} S ${m.x + 560} ${m.y + 200}, ${m.x + m.w} ${m.y + 160} L ${m.x + m.w} ${m.y + m.h} L ${m.x} ${m.y + m.h} Z" fill="${t.land}"/>`,
    `<ellipse cx="${m.x + 400}" cy="${m.y + 210}" rx="170" ry="96" fill="${RAIN[0]}" opacity="0.8"/>`,
    `<ellipse cx="${m.x + 430}" cy="${m.y + 200}" rx="92" ry="52" fill="${RAIN[2]}" opacity="0.9"/>`,
    `<ellipse cx="${m.x + 150}" cy="${m.y + 460}" rx="110" ry="60" fill="${RAIN[0]}" opacity="0.7"/>`,
    `</g>`,
    `<circle cx="${m.x + m.w / 2}" cy="${m.y + m.h / 2}" r="15" fill="${BLUE}" stroke="${t.card}" stroke-width="6"/>`,
    `<circle cx="${x + 64}" cy="${y + 752}" r="26" fill="${BLUE}"/>`,
    `<path d="M${x + 56} ${y + 738} L ${x + 76} ${y + 752} L ${x + 56} ${y + 766} Z" fill="${t.card}"/>`,
    rect(x + 112, y + 746, w - 148, 12, 6, t.shape),
    rect(x + 112, y + 746, 360, 12, 6, BLUE),
    `<circle cx="${x + 472}" cy="${y + 752}" r="13" fill="${BLUE}"/>`,
  ].join('\n  ');
  return frame(t, x, y, w, h, body);
}

for (const [name, draw] of Object.entries({ weather, radar })) {
  for (const [mode, theme] of Object.entries(THEMES)) {
    const out = path.join(root, 'widgets', name, `preview-${mode}.png`);
    await sharp(Buffer.from(draw(theme))).png().toFile(out);
    console.log(out);
  }
}
