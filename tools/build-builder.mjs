// Build the matchup builder into one self-contained HTML file.
//
// Usage: node tools/build-builder.mjs [outfile]     (default dist/matchup-builder.html)
//
// The component stays a .jsx file: esbuild transpiles it and bundles React in,
// so the output is a single page that opens by double-clicking, with no build
// step, no server and no React CDN. The one thing it does still fetch is the
// Google Fonts stylesheet — the component injects that link itself at runtime,
// and the display faces it picks (Bangers, Titan One, Rye, UnifrakturMaguntia…)
// are not among the faces embedded in css/fonts.css. Offline, team names fall
// back to a system sans; everything else works.
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const out = process.argv[2] || 'dist/matchup-builder.html';

const bundled = await build({
  entryPoints: ['tools/builder-host.jsx'],
  bundle: true,
  format: 'iife',
  jsx: 'automatic',
  loader: { '.jsx': 'jsx' },
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  write: false,
  legalComments: 'none',
});
const js = bundled.outputFiles[0].text;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>City Boys Dynasty — Matchup Builder</title>
<style>
  html,body{margin:0;padding:0;background:#14161c}
  #root{min-height:100vh}
</style>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>
`;

await mkdir(dirname(out), { recursive: true });
await writeFile(out, html);
console.log(`${out}  ${(html.length / 1024).toFixed(0)} KB`);
