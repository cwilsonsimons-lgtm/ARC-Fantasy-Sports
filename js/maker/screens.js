// The finished screens. One card per matchup, drawn by the same renderer that
// writes the PNG, so the preview is not an approximation of the export - it is
// the export at a smaller scale.

import { qs, el, clear, toast, btn, select, download, safeName } from './ui.js';
import { state, save, games, team, tpl } from './store.js';
import { draw } from './render.js';

const PREVIEW_W = 900;   // full-size canvases here would cost ~10 MB each

export function initScreens() {
  qs('#scrIncl').addEventListener('change', e => { state.inclWeek = e.target.checked; save(); paintScreens(); });
  qs('#btnExportAll').addEventListener('click', exportWeek);
}

const templateFor = g => tpl(g.tpl || state.screenTpl || state.defaultTpl);

function nameFor(g) {
  const A = team(g.a), B = team(g.b);
  return `week-${state.week}-${safeName(A && A.name)}-vs-${safeName(B && B.name)}.png`;
}

function render(canvas, g, scale) {
  draw(canvas, {
    tplId: templateFor(g).id, game: g, week: state.week,
    includeWeek: !!state.inclWeek, scale,
  });
}

export function paintScreens() {
  qs('#scrWeek').textContent = state.week;
  qs('#scrIncl').checked = !!state.inclWeek;
  const grid = clear(qs('#screenGrid'));
  const wk = games(state.week).filter(g => g.a || g.b);
  qs('#scrCount').textContent = wk.length ? `${wk.length} matchup${wk.length > 1 ? 's' : ''}` : '';
  if (!wk.length) {
    grid.append(el('div', { class: 'empty' }, 'Nothing scheduled for this week. Add the matchups on the Scores tab.'));
    return;
  }
  wk.forEach(g => {
    const t = templateFor(g);
    const canvas = el('canvas');
    render(canvas, g, Math.min(1, PREVIEW_W / t.w));
    const A = team(g.a), B = team(g.b);
    grid.append(el('div', { class: 'shot' }, canvas,
      el('div', { class: 'shot-foot' },
        el('span', { class: 'shot-t' }, `${A ? A.name : '—'} vs ${B ? B.name : '—'}`),
        el('span', { class: 'spacer', style: 'flex:1' }),
        select([['', 'Default template']].concat(state.templates.map(x => [x.id, x.name])), g.tpl || '',
          v => { g.tpl = v; save(); paintScreens(); }),
        btn('PNG', () => exportOne(g), 'sm'),
        btn('Copy', () => copyOne(g), 'sm'))));
  });
}

// Full-size draw happens on a throwaway canvas so the preview keeps its scale.
function fullCanvas(g) {
  const c = document.createElement('canvas');
  render(c, g, 1);
  return c;
}

function toBlob(canvas) {
  return new Promise(res => canvas.toBlob(res, 'image/png'));
}

async function exportOne(g) {
  const blob = await toBlob(fullCanvas(g));
  download(blob, nameFor(g));
  toast('Saved ' + nameFor(g));
}

async function copyOne(g) {
  try {
    const blob = await toBlob(fullCanvas(g));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Copied — paste it straight into the group chat');
  } catch {
    toast('This browser blocked the clipboard; use PNG instead');
  }
}

async function exportWeek() {
  const wk = games(state.week).filter(g => g.a && g.b);
  if (!wk.length) return toast('Nothing scheduled for week ' + state.week);
  for (const g of wk) {
    const blob = await toBlob(fullCanvas(g));
    download(blob, nameFor(g));
    // Browsers drop a burst of simultaneous downloads; space them out.
    await new Promise(r => setTimeout(r, 350));
  }
  toast(`Exported ${wk.length} screens`);
}
