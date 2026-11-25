// Builds dist/artifact.html, the claude.ai artifact body: React from cdnjs, everything else
// inline. It saves to the owner's account through the db capability and reads the league
// through the StatsDeck connector (mcp capability).
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export const REACT_CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js',
];
const FONTS =
  'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600;700&display=swap';

const reactGlobals = {
  name: 'react-globals',
  setup(b) {
    b.onResolve({ filter: /^react(-dom)?(\/client)?$/ }, (a) => ({ path: a.path, namespace: 'global' }));
    b.onLoad({ filter: /.*/, namespace: 'global' }, (a) => ({
      contents: a.path === 'react' ? 'module.exports = window.React;' : 'module.exports = window.ReactDOM;',
      loader: 'js',
    }));
  },
};

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
  plugins: [reactGlobals],
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = await readFile('src/styles.css', 'utf8');

// The artifact skeleton (doctype, head, body) is added at publish time.
const artifact = `<title>Trade Desk</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>
${css}
</style>
<div id="root"></div>
${REACT_CDN.map((u) => `<script src="${u}" crossorigin="anonymous"></script>`).join('\n')}
<script>
${js}
</script>
`;
await mkdir('dist', { recursive: true });
await writeFile('dist/artifact.html', artifact);
console.log(`dist/artifact.html ${(artifact.length / 1024).toFixed(0)} KB`);
