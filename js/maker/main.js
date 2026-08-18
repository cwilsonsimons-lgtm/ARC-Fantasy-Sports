// Boot for the matchup screen maker.
//
// Two things have to finish before the first canvas draw or it comes out wrong
// and stays wrong until something forces a repaint: the assets have to be
// decoded (a logo drawn from an undecoded Image draws nothing), and the
// typefaces have to be loaded. Canvas has no equivalent of font-display:swap -
// it silently uses the fallback and never redraws - so every face is requested
// up front rather than left to load on first use.

import { initAssets, persistent } from './assets.js';
import { qs, qsa, el, toast } from './ui.js';
import { state, load, save, tpl, newGame, FONTS } from './store.js';
import { weekNumbers, stats, roundRobin } from './standings.js';
import { draw, context, resolve } from './render.js';
import { initEditor, paintEditor } from './editor.js';
import { initTeams, paintTeams } from './teams.js';
import { initScores, paintScores } from './scores.js';
import { initStandings, paintStandings } from './table.js';
import { initScreens, paintScreens } from './screens.js';
import { initData, paintData } from './data.js';

async function preloadFonts() {
  const families = FONTS.map(f => f.ff.replace(/'/g, ''));
  await Promise.all(families.map(f =>
    document.fonts.load(`700 40px "${f}"`).catch(() => {})));
  await document.fonts.ready;
}

function paintTopBar() {
  qs('#topYear').value = state.year;

  const wk = qs('#topWeek');
  const weeks = weekNumbers();
  if (!weeks.includes(state.week)) state.week = weeks[0] || 1;
  wk.innerHTML = '';
  weeks.forEach(n => wk.append(el('option', { value: n, selected: n === state.week }, 'Week ' + n)));
  wk.value = state.week;

  const tp = qs('#topTpl');
  tp.innerHTML = '';
  state.templates.forEach(t => tp.append(el('option', { value: t.id }, t.name)));
  tp.value = state.screenTpl && state.templates.some(t => t.id === state.screenTpl)
    ? state.screenTpl : state.defaultTpl;
}

// One repaint entry point: any edit anywhere can invalidate any pane, and the
// panes are cheap enough that working out which is not worth the bugs.
function refresh() {
  paintTopBar();
  paintScreens();
  paintScores();
  paintStandings();
  paintData();
}

function showPane(name) {
  qsa('.tab').forEach(t => t.classList.toggle('on', t.dataset.pane === name));
  qsa('.pane').forEach(p => p.classList.toggle('on', p.id === 'pane-' + name));
  state.pane = name;
  save();
  if (name === 'template') paintEditor();
  if (name === 'teams') paintTeams();
  if (name === 'screens') paintScreens();
  if (name === 'scores') paintScores();
  if (name === 'standings') paintStandings();
  if (name === 'data') paintData();
}

async function boot() {
  // Firefox and Safari refuse IndexedDB on file:// origins, and private windows
  // can refuse it anywhere. Imports still work in that case - they are held in
  // memory for the session - so this is a warning, not a failure.
  await initAssets();
  load();
  if (!state.editTpl || !state.templates.some(t => t.id === state.editTpl)) state.editTpl = state.defaultTpl;
  await preloadFonts();

  qsa('.tab').forEach(t => t.addEventListener('click', () => showPane(t.dataset.pane)));
  qs('#topYear').addEventListener('change', e => {
    state.year = parseInt(e.target.value, 10) || new Date().getFullYear();
    save(); refresh();
  });
  qs('#topWeek').addEventListener('change', e => {
    state.week = parseInt(e.target.value, 10) || 1;
    save(); refresh(); paintEditor();
  });
  qs('#topTpl').addEventListener('change', e => {
    state.screenTpl = e.target.value;
    save(); paintScreens();
  });

  initEditor(refresh);
  initTeams(refresh);
  initScores(refresh);
  initStandings();
  initScreens();
  initData(refresh);

  paintTeams();
  paintEditor();
  refresh();
  showPane(state.pane || 'screens');
  if (!persistent()) toast('This browser will not store images from a file:// page — photos work now but are gone on reload. Chrome or Edge keeps them, or run npm start.');

  // Handy from the console and from the check harness.
  Object.assign(window, {
    MK: { state, save, tpl, newGame, refresh, showPane, paintEditor, paintScreens,
      paintScores, paintStandings, paintTeams, draw, context, resolve, stats, roundRobin },
  });
}

boot().catch(e => {
  document.body.append(el('div', { class: 'empty' }, 'Failed to start: ' + e.message));
  console.error(e);
});
