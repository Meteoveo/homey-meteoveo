/* MeteoVeo weather icons — a vanilla port of apps/web/src/design/WeatherIcon.tsx
 * (same shapes, gradients and keys; animations left out — a dashboard widget
 * repaints on its own schedule). Gradient ids are unique per instance so that
 * several icons on one page never borrow each other's defs. */
(function (global) {
  'use strict';

  let counter = 0;

  const GRADIENTS = {
    sun: (p) => `<radialGradient id="${p}sun" cx="34%" cy="28%" r="78%"><stop offset="0" stop-color="#ffdf90"/><stop offset=".55" stop-color="#f4a935"/><stop offset="1" stop-color="#dd8615"/></radialGradient>`,
    cloud: (p) => `<linearGradient id="${p}cloud" gradientUnits="userSpaceOnUse" x1="0" y1="6" x2="0" y2="52"><stop offset="0" stop-color="#e4edeb"/><stop offset=".5" stop-color="#c3d3d3"/><stop offset="1" stop-color="#8ea8aa"/></linearGradient>`,
    mist: (p) => `<linearGradient id="${p}mist" gradientUnits="userSpaceOnUse" x1="0" y1="6" x2="0" y2="52"><stop offset="0" stop-color="#f1f6f5"/><stop offset=".5" stop-color="#d9e4e4"/><stop offset="1" stop-color="#aebfc0"/></linearGradient>`,
    dark: (p) => `<linearGradient id="${p}dark" gradientUnits="userSpaceOnUse" x1="0" y1="6" x2="0" y2="46"><stop offset="0" stop-color="#a8b7a6"/><stop offset=".6" stop-color="#8b9a8a"/><stop offset="1" stop-color="#63735f"/></linearGradient>`,
    drop: (p) => `<linearGradient id="${p}drop" gradientUnits="userSpaceOnUse" x1="0" y1="44" x2="0" y2="60"><stop offset="0" stop-color="#84d4f2"/><stop offset="1" stop-color="#2477a8"/></linearGradient>`,
    bolt: (p) => `<linearGradient id="${p}bolt" gradientUnits="userSpaceOnUse" x1="0" y1="40" x2="0" y2="74"><stop offset="0" stop-color="#ffe98f"/><stop offset="1" stop-color="#e79a12"/></linearGradient>`,
  };

  const cloud = (p, fill = 'cloud') => `<g><circle cx="24" cy="28" r="14" fill="url(#${p}${fill})"/><circle cx="43" cy="23" r="17" fill="url(#${p}${fill})"/><rect x="10" y="28" width="49" height="15" rx="7.5" fill="url(#${p}${fill})"/></g>`;
  const smallCloud = (p, fill = 'cloud') => `<g><circle cx="25" cy="30" r="13" fill="url(#${p}${fill})"/><circle cx="42" cy="25" r="16" fill="url(#${p}${fill})"/><rect x="12" y="30" width="46" height="14" rx="7" fill="url(#${p}${fill})"/></g>`;

  function sun(p, rays) {
    let out = '';
    if (rays === 'full') {
      out += '<g stroke="#f8c95c" stroke-width="5" stroke-linecap="round"><path d="M36 6v9"/><path d="M36 57v9"/><path d="M6 36h9"/><path d="M57 36h9"/><path d="M14 14l6.5 6.5"/><path d="M51.5 51.5L58 58"/><path d="M58 14l-6.5 6.5"/><path d="M20.5 51.5L14 58"/></g>';
    } else if (rays === 'short') {
      out += '<g stroke="#f8c95c" stroke-width="6" stroke-linecap="round"><path d="M36 7v8"/><path d="M36 57v8"/><path d="M7 36h8"/><path d="M57 36h8"/></g>';
    }
    out += `<circle cx="36" cy="36" r="15" fill="url(#${p}sun)"/><ellipse cx="30.5" cy="30" rx="5.4" ry="3.9" fill="#fff6d4" opacity=".6"/>`;
    return out;
  }

  const moon = (p) => `<circle cx="36" cy="36" r="16" fill="url(#${p}sun)" opacity=".22"/><path d="M41 20a17 17 0 1 0 11 30 19 19 0 0 1-11-30z" fill="#ffeeb5" stroke="#c9a94a" stroke-width="1.4"/>`;

  const drops = (p) => `<g fill="url(#${p}drop)"><path d="M24 48c3 4 3 6 0 6s-3-2 0-6z"/><path d="M36 50c3.4 4.6 3.4 7 0 7s-3.4-2.4 0-7z"/><path d="M48 48c3 4 3 6 0 6s-3-2 0-6z"/></g>`;
  const fineDrops = (p) => `<g fill="url(#${p}drop)" opacity=".8"><circle cx="22" cy="50" r="1.7"/><circle cx="32" cy="54" r="1.7"/><circle cx="42" cy="49" r="1.7"/><circle cx="52" cy="53" r="1.7"/></g>`;

  function drawing(icon, night) {
    const sunOrMoon = (p, rays) => (night ? moon(p) : sun(p, rays));
    switch (icon) {
      case 'napos':
        return { viewBox: '0 0 72 72', use: ['sun'], render: (p) => sunOrMoon(p, 'full') };
      case 'reszben_felhos':
        return {
          viewBox: '0 0 72 66',
          use: ['sun', 'cloud'],
          render: (p) => (night
            ? '<path d="M55 10a12 12 0 1 0 8 21 13 13 0 0 1-8-21z" fill="#ffeeb5" stroke="#c9a94a" stroke-width="1.2"/>'
            : `<g stroke="#f8c95c" stroke-width="4.5" stroke-linecap="round"><path d="M52 3v6"/><path d="M68 21h-6"/><path d="M64 8l-4.5 4.5"/></g><circle cx="52" cy="21" r="11" fill="url(#${p}sun)"/>`)
            + `<g transform="translate(0 2)">${smallCloud(p)}</g>`,
        };
      case 'fatyolfelhos':
        return {
          viewBox: '0 0 72 72',
          use: ['sun'],
          render: (p) => sunOrMoon(p, 'full')
            + '<g fill="none" stroke="#e9f2f1" stroke-linecap="round"><path d="M8 28q14-6 28 0t28-2" stroke-width="5.5" stroke-opacity=".9"/><path d="M14 42q12-5 24 0t22-2" stroke-width="4.5" stroke-opacity=".78"/><path d="M10 55q10-4 20 0t18-1" stroke-width="3.5" stroke-opacity=".62"/></g>',
        };
      case 'borult':
        return { viewBox: '0 0 72 60', use: ['cloud'], render: (p) => cloud(p) };
      case 'eso':
      case 'zapor':
        return { viewBox: '0 0 72 74', use: ['cloud', 'drop'], render: (p) => smallCloud(p) + drops(p) };
      case 'szemerkel':
        return { viewBox: '0 0 72 68', use: ['mist', 'drop'], render: (p) => smallCloud(p, 'mist') + fineDrops(p) };
      case 'zivatar':
        return {
          viewBox: '0 0 72 74',
          use: ['dark', 'bolt'],
          render: (p) => smallCloud(p, 'dark') + `<path d="M38 43l-11 16h8l-3 13 15-19h-9z" fill="url(#${p}bolt)"/>`,
        };
      case 'havazas':
        return {
          viewBox: '0 0 72 74',
          use: ['cloud'],
          render: (p) => smallCloud(p) + '<g stroke="#dfefff" stroke-width="3.4" stroke-linecap="round">'
            + [24, 36, 48].map((x) => `<path d="M${x} 48v8"/><path d="M${x - 3.5} 50l7 4"/><path d="M${x + 3.5} 50l-7 4"/>`).join('')
            + '</g>',
        };
      case 'kod':
        return {
          viewBox: '0 0 72 66',
          use: ['cloud'],
          render: (p) => `<g opacity=".95">${smallCloud(p)}</g><g stroke="#8fa5a4" stroke-width="5" stroke-linecap="round"><path d="M18 52h24"/><path d="M48 52h8"/></g>`,
        };
      default:
        return { viewBox: '0 0 72 60', use: ['cloud'], render: (p) => cloud(p) };
    }
  }

  /** SVG markup for a MeteoVeo icon key; `size` is the width in px. */
  function weatherIconSvg(icon, size, night) {
    const plan = drawing(icon, !!night);
    const [, , w, h] = plan.viewBox.split(' ').map(Number);
    const height = Math.round((size * h) / w);
    const p = `mvi${(counter += 1)}-`;
    const defs = plan.use.map((g) => GRADIENTS[g](p)).join('');
    return `<svg class="mv-icon" width="${size}" height="${height}" viewBox="${plan.viewBox}" fill="none" aria-hidden="true" data-mv-icon="${icon}"><defs>${defs}</defs>${plan.render(p)}</svg>`;
  }

  global.weatherIconSvg = weatherIconSvg;
}(window));
