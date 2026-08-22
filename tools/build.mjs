// Bundle the split source back into one self-contained HTML file.
//
// The modular source needs an HTTP server, because browsers refuse to load ES
// modules over file://. This produces dist/index.html with the CSS and JS inlined
// so it can be opened by double-clicking, the way the original prototype worked.
//
// Usage: node tools/build.mjs
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const html = await readFile('index.html', 'utf8');

// CSS, concatenated in the exact order index.html links it, to preserve cascade.
const hrefs = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(m => m[1]);
const css = (await Promise.all(
  hrefs.map(async h => `/* ${h} */\n${await readFile(h, 'utf8')}`)
)).join('\n');

// JS, bundled to a single classic script. The module version is deferred; this
// tag sits last in <body>, so the DOM is parsed either way.
const bundled = await build({
  entryPoints: ['js/main.js'],
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

await mkdir('dist', { recursive: true });
await writeFile('dist/index.html', out);

const kb = n => (n / 1024).toFixed(0) + ' KB';
console.log(`dist/index.html  ${kb(out.length)}  (css ${kb(css.length)}, js ${kb(js.length)})`);
