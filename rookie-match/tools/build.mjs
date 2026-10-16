// Builds dist/rookie-match.html: one self-contained file (React, styles and all),
// so it can be opened straight from disk with no server and no network.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const r = await build({
  entryPoints: ['src/main.tsx'],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: 'es2020',
  jsx: 'transform',
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = await readFile('src/styles.css', 'utf8');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Rookie Match</title>
<meta name="description" content="Rename generated Madden draft prospects after real-life prospects with similar positions, heights and weights.">
<style>
${css}
</style>
</head>
<body>
<div id="root"></div>
<script>
${js}
</script>
</body>
</html>
`;

await mkdir('dist', { recursive: true });
await writeFile('dist/rookie-match.html', html);
console.log(`dist/rookie-match.html ${(html.length / 1024).toFixed(0)} KB`);
