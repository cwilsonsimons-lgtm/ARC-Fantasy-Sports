// Bundle the split source back into self-contained HTML files.
//
// The modular source needs an HTTP server, because browsers refuse to load ES
// modules over file://. This produces dist/index.html with the CSS and JS inlined
// so it can be opened by double-clicking, the way the original prototype worked.
//
// dist/universe.html is the same treatment for the WWE 2K Universe dashboard,
// which is a separate page rather than a view inside the fantasy app.
//
// Usage: node tools/build.mjs
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const kb = n => (n / 1024).toFixed(0) + ' KB';

async function page(src, entry, out) {
  const html = await readFile(src, 'utf8');

  // CSS, concatenated in the exact order the page links it, to preserve cascade.
  const hrefs = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(m => m[1]);
  const css = (await Promise.all(
    hrefs.map(async h => `/* ${h} */\n${await readFile(h, 'utf8')}`)
  )).join('\n');

  // JS, bundled to a single classic script. The module version is deferred; this
  // tag sits last in <body>, so the DOM is parsed either way.
  const bundled = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    write: false,
    legalComments: 'none',
  });
  const js = bundled.outputFiles[0].text;

  const outHtml = html
    .replace(/ *<link rel="stylesheet" href="[^"]+">\n/g, '')
    .replace('</head>', `<style>\n${css}\n</style>\n</head>`)
    .replace(/<script type="module" src="[^"]+"><\/script>/, `<script>\n${js}\n</script>`);

  await mkdir('dist', { recursive: true });
  await writeFile(out, outHtml);
  console.log(`${out}  ${kb(outHtml.length)}  (css ${kb(css.length)}, js ${kb(js.length)})`);
}

await page('index.html', 'js/main.js', 'dist/index.html');
await page('universe.html', 'js/universe/ui/app.js', 'dist/universe.html');
