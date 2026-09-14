// Bundle the split source back into one self-contained HTML file.
//
// The modular source needs an HTTP server, because browsers refuse to load ES
// modules over file://. This produces dist/index.html with the CSS and JS inlined
// so it can be opened by double-clicking, the way the original prototype worked.
//
// Usage: node tools/build.mjs [htmlPath] [entryPath] [outPath]
// Defaults bundle the fantasy app; the wrestling GM app passes its own paths.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';

const [htmlPath = 'index.html', entryPath = 'js/main.js', outPath = 'dist/index.html'] = process.argv.slice(2);
const srcDir = dirname(htmlPath);

const html = await readFile(htmlPath, 'utf8');

// CSS, concatenated in the exact order index.html links it, to preserve cascade.
const hrefs = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(m => m[1]);
const css = (await Promise.all(
  hrefs.map(async h => `/* ${h} */\n${await readFile(resolve(srcDir, h), 'utf8')}`)
)).join('\n');

// JS, bundled to a single classic script. The module version is deferred; this
// tag sits last in <body>, so the DOM is parsed either way.
const bundled = await build({
  entryPoints: [entryPath],
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

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, out);

const kb = n => (n / 1024).toFixed(0) + ' KB';
console.log(`${outPath}  ${kb(out.length)}  (css ${kb(css.length)}, js ${kb(js.length)})`);
