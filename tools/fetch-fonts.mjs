// Download the Google Fonts the app uses and write them into css/fonts.css as
// base64 @font-face rules.
//
// Why: the prototype linked fonts.googleapis.com, so the design only appeared
// with a working network. Offline - or on a locked-down network - every rule
// that said font-family:'Oswald' fell back to the browser default, which is a
// serif, and the whole app changed character. Embedding makes dist/index.html
// self-contained: it looks the same emailed, offline, or opened from a USB stick.
//
// Usage: node tools/fetch-fonts.mjs
import { writeFile } from 'node:fs/promises';

// Only the latin subset is kept; the app has no other scripts and the full set
// would multiply the file size for nothing.
const FAMILIES = [
  'Oswald:wght@400;500;600;700',
  'Barlow:wght@400;500;600;700',
  'JetBrains+Mono:wght@500;700',
  'Anton', 'Bebas+Neue', 'Archivo+Black', 'Alfa+Slab+One', 'Bungee',
  'Permanent+Marker', 'Creepster', 'Press+Start+2P',
  'Playfair+Display:wght@700;900', 'Special+Elite', 'Rubik+Mono+One', 'Monoton',
];

// A modern browser UA is required, or Google serves ttf instead of woff2.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
         + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const url = 'https://fonts.googleapis.com/css2?'
  + FAMILIES.map(f => 'family=' + f).join('&') + '&display=swap';

console.log('fetching stylesheet…');
const css = await fetch(url, { headers: { 'User-Agent': UA } }).then(r => r.text());

// Split into @font-face blocks so each keeps its family/weight/unicode-range.
const blocks = css.split('@font-face').slice(1).map(b => '@font-face' + b.split('}')[0] + '}');
console.log(`${blocks.length} @font-face blocks`);

let out = `/* Fonts embedded by tools/fetch-fonts.mjs — do not edit by hand.
   Base64 so the app renders identically with no network. */\n`;
let kept = 0, bytes = 0;

for (const block of blocks) {
  // keep latin only (the block without a unicode-range is also latin)
  const range = /unicode-range:\s*([^;]+);/.exec(block);
  if (range && !/U\+0000-00FF/.test(range[1])) continue;

  const src = /url\((https:[^)]+\.woff2)\)/.exec(block);
  if (!src) continue;

  const buf = Buffer.from(await fetch(src[1]).then(r => r.arrayBuffer()));
  bytes += buf.length;
  kept++;
  out += block.replace(/src:\s*url\([^)]+\)\s*format\('woff2'\)/,
    `src: url(data:font/woff2;base64,${buf.toString('base64')}) format('woff2')`) + '\n';
}

await writeFile('css/fonts.css', out);
console.log(`kept ${kept} faces, ${(bytes / 1024).toFixed(0)} KB of woff2 `
  + `-> css/fonts.css ${(out.length / 1024).toFixed(0)} KB`);
