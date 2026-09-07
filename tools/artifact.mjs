// Repackage the standalone prototype as an Artifact page.
//
// prototype/app.html is a complete document — doctype, <html>, <head>, <body>.
// An Artifact supplies all of that itself and wraps whatever the file contains,
// so publishing the document as-is would nest one inside another. This strips
// the shell and keeps the parts that belong to the page: the title, the styles
// and everything inside <body>.
//
// Two things about the Artifact sandbox are worth knowing here, and neither is
// worked around — both already degrade the way they should:
//
//   * Its CSP allows scripts, styles and fonts only from a short list of hosts.
//     Player headshots come from nfl.com and are blocked, so faces fall back to
//     initials; the typefaces are base64 in the stylesheet already and are
//     unaffected.
//   * api.sleeper.app is blocked too, so a live import cannot reach Sleeper and
//     falls back to the demo league, which the import screens say plainly.
//
// Usage: node tools/artifact.mjs [in] [out]
import { readFile, writeFile } from 'node:fs/promises';

const src = process.argv[2] || 'prototype/app.html';
const out = process.argv[3] || 'prototype/artifact.html';

const doc = await readFile(src, 'utf8');

// Anchored on document positions rather than matched by pattern: the stylesheet
// contains CSS comments that mention <body>, and a regex for the body tag finds
// one of those first and swallows the tail of the stylesheet with it.
const headEnd = doc.indexOf('</head>');
const bodyOpen = doc.indexOf('<body>', headEnd);
const bodyClose = doc.lastIndexOf('</body>');
if (headEnd < 0 || bodyOpen < 0 || bodyClose < bodyOpen) throw new Error('could not find the document shell in ' + src);

const head = doc.slice(0, headEnd);
const title = (head.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
const style = (head.match(/<style>[\s\S]*<\/style>/) || [])[0];
const body = doc.slice(bodyOpen + '<body>'.length, bodyClose);
if (!title || !style || !body) throw new Error('could not find title, style and body in ' + src);

// The Artifact shell sets color-scheme: light and paints an off-white ground
// behind the page. This app is dark throughout and commits to it, so it says so
// rather than letting form controls and scrollbars render for the wrong theme.
const scheme = `<style>:root{color-scheme:dark}html,body{background:#131114}</style>`;

const page = [
  `<title>Arc Fantasy Football</title>`,
  scheme,
  style,
  body.trim(),
  ''
].join('\n');

await writeFile(out, page);

const kb = n => (n / 1024).toFixed(0) + ' KB';
console.log(`${out}  ${kb(page.length)}  (was ${kb(doc.length)} as a standalone document)`);
console.log(`title: Arc Fantasy Football${title === 'Arc Fantasy Football' ? '' : `  (source document says "${title}")`}`);
