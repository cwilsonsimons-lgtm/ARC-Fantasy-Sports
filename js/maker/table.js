// The standings pane. Read-only: everything here is derived.

import { qs, el, clear, toast } from './ui.js';
import { state } from './store.js';
import { stats } from './standings.js';

export function initStandings() {
  qs('#stIncl').addEventListener('change', paintStandings);
  qs('#stCopy').addEventListener('click', copyText);
}

const f2 = n => n.toFixed(2);

function rows() {
  const through = qs('#stIncl').checked ? state.week : state.week - 1;
  return stats(through).order;
}

export function paintStandings() {
  const box = clear(qs('#stTable'));
  const order = rows();
  const t = el('table', {},
    el('thead', {}, el('tr', {},
      ...['#', 'Team', 'Record', 'PPG', 'PF', 'PA', 'Streak'].map(h => el('th', {}, h)))),
    el('tbody', {}, order.map((r, i) => {
      const tm = state.teams.find(x => x.id === r.id) || { name: r.id, color: '#888' };
      return el('tr', {},
        el('td', {}, String(i + 1)),
        el('td', {}, el('span', { class: 'dot', style: `background:${tm.color}` }), tm.name),
        el('td', {}, r.record),
        el('td', {}, r.gp ? f2(r.ppg) : '—'),
        el('td', {}, f2(r.pf)),
        el('td', {}, f2(r.pa)),
        el('td', {}, r.streak));
    })));
  box.append(t);
}

function copyText() {
  const lines = rows().map((r, i) => {
    const tm = state.teams.find(x => x.id === r.id);
    return `${i + 1}. ${tm ? tm.name : r.id}  ${r.record}  ${r.gp ? r.ppg.toFixed(2) : '--'} ppg`;
  });
  navigator.clipboard.writeText(lines.join('\n')).then(
    () => toast('Standings copied'),
    () => toast('Clipboard blocked by the browser'));
}
