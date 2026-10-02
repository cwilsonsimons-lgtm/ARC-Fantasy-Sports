// Builds two single-file outputs:
//   dist/foil-and-ink.html   standalone page, React bundled in; open it directly.
//   dist/artifact.html       the claude.ai artifact body: React from cdnjs, everything else inline.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const REACT_CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js',
];
const FONTS = 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=Big+Shoulders+Display:wght@600;700;800;900&family=IBM+Plex+Mono:wght@400;600;700&family=Mrs+Saint+Delafield&display=swap';
const TITLE = 'Foil &amp; Ink';

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

async function bundle(externalReact) {
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
    plugins: externalReact ? [reactGlobals] : [],
  });
  return r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
}

const css = await readFile('src/styles.css', 'utf8');
const [standaloneJs, artifactJs] = await Promise.all([bundle(false), bundle(true)]);

const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="${FONTS}">`;

const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${TITLE}</title>
${fonts}
<style>
${css}
</style>
</head>
<body>
<div id="root"></div>
<script>
${standaloneJs}
</script>
</body>
</html>
`;

const artifact = `<title>${TITLE}</title>
${fonts}
<style>
${css}
</style>
<div id="root"></div>
${REACT_CDN.map((u) => `<script src="${u}" crossorigin="anonymous"></script>`).join('\n')}
<script>
${artifactJs}
</script>
`;

await mkdir('dist', { recursive: true });
await writeFile('dist/foil-and-ink.html', standalone);
await writeFile('dist/artifact.html', artifact);
const kb = (s) => `${(s.length / 1024).toFixed(0)} KB`;
console.log(`dist/foil-and-ink.html ${kb(standalone)} · dist/artifact.html ${kb(artifact)}`);
