import fs from 'fs';

// Color palettes (pairs of gradients) for generated album/track covers
const PALETTES = [
  ['#7c3aed', '#db2777'], ['#0ea5e9', '#6366f1'], ['#f59e0b', '#ef4444'],
  ['#10b981', '#0ea5e9'], ['#f43f5e', '#a855f7'], ['#14b8a6', '#3b82f6'],
  ['#e11d48', '#f97316'], ['#8b5cf6', '#06b6d4'], ['#22c55e', '#facc15'],
  ['#f97316', '#db2777'], ['#6366f1', '#ec4899'], ['#06b6d4', '#84cc16']
];

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function svgCover(title, subtitle, seedStr, { size = 640 } = {}) {
  const seed = hashCode(seedStr);
  const [c1, c2] = PALETTES[seed % PALETTES.length];
  const id = 'g' + seed;
  const angle = (seed % 360);
  const words = title.toUpperCase().split(' ').slice(0, 3).join(' ');

  // a few decorative circles
  const circles = [];
  for (let i = 0; i < 4; i++) {
    const cx = 80 + ((seed * (i + 3)) % 480);
    const cy = 90 + ((seed * (i + 7)) % 440);
    const r = 30 + ((seed * (i + 5)) % 140);
    circles.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(255,255,255,0.08)"/>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 640 640">
  <defs>
    <linearGradient id="${id}" gradientTransform="rotate(${angle} 0.5 0.5)">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="640" height="640" fill="url(#${id})"/>
  ${circles.join('\n  ')}
  <circle cx="320" cy="260" r="150" fill="rgba(0,0,0,0.18)"/>
  <circle cx="320" cy="260" r="150" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="3"/>
  <circle cx="320" cy="260" r="52" fill="rgba(255,255,255,0.9)"/>
  <text x="320" y="470" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="bold" fill="#fff" style="letter-spacing:1px">${words}</text>
  <text x="320" y="520" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="26" fill="rgba(255,255,255,0.85)">${subtitle}</text>
</svg>`;
}

export function writeCover(path, title, subtitle, seedStr) {
  fs.writeFileSync(path, svgCover(title, subtitle, seedStr));
  return path;
}
