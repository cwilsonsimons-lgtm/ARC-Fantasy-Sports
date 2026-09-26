// Bundle each app's split source into one self-contained HTML file.
//
// This repository holds two separate apps: the City Boys Dynasty fantasy
// league (index.html) and Universe, the WWE 2K25 companion (universe.html).
// Each page is built on its own - its stylesheets in the order it links them,
// its own module entry point - into dist/, so either can be opened by
// double-clicking, the way the original prototype worked.
//
// Usage: node tools/build.mjs
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const PAGES = [
  { html: 'index.html', out: 'dist/index.html' },
  // Universe sets its type in Oswald and Barlow only; the other thirteen
  // embedded faces belong to the fantasy app's team names.
  { html: 'universe.html', out: 'dist/universe.html', fonts: ['Oswald', 'Barlow'] },
];

// Keep only the @font-face rules for the given families. Base64 never
// contains a brace, so each rule ends at its first closing one.
function onlyFonts(css, families) {
  return css.replace(/@font-face\s*\{[^}]*\}\n?/g, rule => {
    const m = /font-family:\s*'([^']+)'/.exec(rule);
    return m && families.includes(m[1]) ? rule : '';
  });
}

const kb = n => (n / 1024).toFixed(0) + ' KB';
await mkdir('dist', { recursive: true });

for (const page of PAGES) {
  const html = await readFile(page.html, 'utf8');

  // CSS, concatenated in the exact order the page links it, to preserve cascade.
  const hrefs = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(m => m[1]);
  const css = (await Promise.all(hrefs.map(async h => {
    let text = await readFile(h, 'utf8');
    if (page.fonts && h === 'css/fonts.css') text = onlyFonts(text, page.fonts);
    return `/* ${h} */\n${text}`;
  }))).join('\n');

  // JS, bundled to a single classic script from the page's own entry point.
  // The module version is deferred; this tag sits last in <body>, so the DOM
  // is parsed either way.
  const entry = /<script type="module" src="([^"]+)"><\/script>/.exec(html)[1];
  const bundled = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    write: false,
    legalComments: 'none',
  });
  const js = bundled.outputFiles[0].text;

  const out = html
    .replace(/ *<link rel="stylesheet" href="[^"]+">\n/g, '')
    .replace('</head>', `<style>\n${css}\n</style>\n</head>`)
    .replace(/<script type="module" src="[^"]+"><\/script>/, `<script>\n${js}\n</script>`);

  await writeFile(page.out, out);
  console.log(`${page.out.padEnd(19)} ${kb(out.length)}  (css ${kb(css.length)}, js ${kb(js.length)})`);
}
