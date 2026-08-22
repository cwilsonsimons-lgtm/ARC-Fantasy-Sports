// Entry point for the matchup-graphic builder (builder.html).
//
// Separate from js/main.js on purpose: this page shares the league's teams,
// typefaces and schedule with the app, but none of its screens, and it should
// not have to load the roster, the draft room or Arc Markets to draw a PNG.
import { FONTS, LABEL_FONT, UI_FONT, VALUE_FONT } from './data.js';
import { B, draw, initBuilder, render } from './ui.js';

// Canvas text measures against whatever face is loaded *at the moment it draws*,
// so a graphic painted before the webfonts arrive is laid out in the fallback and
// silently keeps those line breaks. Draw once for responsiveness, then again once
// the faces are in.
async function warmFonts() {
  const families = [UI_FONT, LABEL_FONT, VALUE_FONT, ...FONTS.map((f) => f.ff.replace(/'/g, ''))];
  try {
    await Promise.all(families.map((f) => document.fonts.load(`400 40px "${f}"`).catch(() => {})));
    await Promise.all(families.map((f) => document.fonts.load(`700 40px "${f}"`).catch(() => {})));
    await document.fonts.ready;
  } catch (e) { /* no font loading API — the fallback stack still renders */ }
  if (B.ready) draw();
}

initBuilder().then(warmFonts);

// The tab bar and export button live in the markup; everything else is rendered.
window.addEventListener('pageshow', () => { if (B.ready) render(); });
