// The week's matchups and their final scores. Type a score here and every
// record, average and standing recomputes from it - there is nowhere else to
// update, which is the point.

import { qs, el, clear, toast, btn, select, text } from './ui.js';
import { state, save, games, newGame, team } from './store.js';
import { roundRobin, isFinal } from './standings.js';

let onChange = () => {};

export function initScores(notify) {
  onChange = notify || (() => {});
  qs('#scAdd').addEventListener('click', () => {
    games(state.week).push(newGame(state.teams[0] && state.teams[0].id, state.teams[1] && state.teams[1].id));
    save(); onChange(); paintScores();
  });
  qs('#scGen').addEventListener('click', generate);
}

function generate() {
  const weeks = state.weeks || 14;
  const played = Object.values(state.schedule).flat().filter(isFinal).length;
  if (played && !confirm(`This replaces the whole schedule. ${played} played game(s) and their scores will be lost. Continue?`)) return;
  const sched = roundRobin(state.teams.map(t => t.id), weeks);
  state.schedule = {};
  Object.entries(sched).forEach(([w, pairs]) => {
    state.schedule[w] = pairs.map(([a, b]) => newGame(a, b));
  });
  save(); onChange(); paintScores();
  toast(`Generated ${weeks} weeks`);
}

const opts = () => [['', '—']].concat(state.teams.map(t => [t.id, t.name]));

export function paintScores() {
  qs('#scWeek').textContent = state.week;
  const list = clear(qs('#scList'));
  const wk = games(state.week);
  if (!wk.length) {
    list.append(el('div', { class: 'empty' }, 'No matchups this week yet. Add them one at a time, or generate a full round-robin season.'));
    return;
  }
  wk.forEach((g, i) => {
    const A = team(g.a), B = team(g.b);
    const aWin = isFinal(g) && g.as > g.bs, bWin = isFinal(g) && g.bs > g.as;
    const scoreBox = (key, cls) => el('input', {
      type: 'number', step: '0.01', class: cls, value: g[key] == null ? '' : g[key],
      placeholder: '—',
      oninput: e => {
        const v = e.target.value === '' ? null : parseFloat(e.target.value);
        g[key] = isFinite(v) ? v : null;
        g.final = g.as != null && g.bs != null;
        save(); onChange(); paintScores();
      },
    });

    const row = el('div', { class: 'game' + (isFinal(g) ? ' final' : '') },
      select(opts(), g.a, v => { g.a = v; save(); onChange(); paintScores(); }),
      scoreBox('as', aWin ? 'win' : ''),
      el('span', { class: 'vs' }, 'vs'),
      scoreBox('bs', bWin ? 'win' : ''),
      select(opts(), g.b, v => { g.b = v; save(); onChange(); paintScores(); }),
      el('div', { class: 'row' },
        btn('▲', () => { if (i) { wk.splice(i - 1, 0, wk.splice(i, 1)[0]); save(); paintScores(); } }, 'sm'),
        btn('✕', () => { wk.splice(i, 1); save(); onChange(); paintScores(); }, 'sm warn')),
      el('div', { class: 'notes' },
        el('textarea', {
          placeholder: `Note under ${A ? A.name : 'team A'} — the trash talk line`,
          oninput: e => { g.noteA = e.target.value; save(); onChange(); },
        }, g.noteA || ''),
        el('textarea', {
          placeholder: `Note under ${B ? B.name : 'team B'}`,
          oninput: e => { g.noteB = e.target.value; save(); onChange(); },
        }, g.noteB || '')));
    list.append(row);
  });
}
