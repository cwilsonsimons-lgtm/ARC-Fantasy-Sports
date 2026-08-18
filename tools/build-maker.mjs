// Bundle the matchup screen maker into one self-contained HTML file, the same
// way tools/build.mjs does for the app: browsers refuse ES modules over
// file://, and this tool is most useful as something you double-click.
//
// Usage: node tools/build-maker.mjs
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const html = await readFile('maker.html', 'utf8');

const hrefs = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(m => m[1]);
const css = (await Promise.all(
  hrefs.map(async h => `/* ${h} */\n${await readFile(h, 'utf8')}`)
)).join('\n');

const bundled = await build({
  entryPoints: ['js/maker/main.js'],
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
await writeFile('dist/maker.html', out);

const kb = n => (n / 1024).toFixed(0) + ' KB';
console.log(`dist/maker.html  ${kb(out.length)}  (css ${kb(css.length)}, js ${kb(js.length)})`);
