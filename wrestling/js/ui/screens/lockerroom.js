// The locker room: who is feuding with whom, who is close, and where the GM
// stands with everybody.
//
// All of it is read off the relationship axes rather than stored as lists, so
// this screen cannot disagree with the numbers on a wrestler's own page.

import * as store from '../../core/store.js';
import { EVENT_TYPES } from '../../core/events.js';
import {
  describe, isRival, isAlly, RIVAL_THRESHOLD,
} from '../../models/relationship.js';
import { relationshipWith, notableTies, memoryWeightOn } from '../../models/wrestler.js';
import { esc, signed, toneOf, meter, titleCase } from '../format.js';
import { notLoaded } from './roster.js';

/** Every pair with heat, counted once, hottest first. */
function rivalries() {
  const seen = new Set();
  const out = [];
  for (const w of store.allWrestlers()) {
    for (const [otherId, rel] of Object.entries(w.ties.relationships)) {
      const pair = [w.id, otherId].sort().join('|');
      if (seen.has(pair)) continue;
      const other = store.getWrestler(otherId);
      if (!other) continue;
      const back = relationshipWith(other, w.id);
      const heat = Math.max(rel.hostility, back.hostility);
      if (heat < RIVAL_THRESHOLD) continue;
      seen.add(pair);
      out.push({ a: w, b: other, ab: rel, ba: back, heat });
    }
  }
  return out.sort((x, y) => y.heat - x.heat);
}

function alliances() {
  const seen = new Set();
  const out = [];
  for (const w of store.allWrestlers()) {
    for (const [otherId, rel] of Object.entries(w.ties.relationships)) {
      if (!isAlly(rel)) continue;
      const pair = [w.id, otherId].sort().join('|');
      if (seen.has(pair)) continue;
      const other = store.getWrestler(otherId);
      if (!other) continue;
      const back = relationshipWith(other, w.id);
      seen.add(pair);
      out.push({ a: w, b: other, ab: rel, ba: back, mutual: isAlly(back) });
    }
  }
  return out.sort((x, y) => (y.ab.affinity + y.ba.affinity) - (x.ab.affinity + x.ba.affinity));
}

const link = (w) => `<button class="rowlink" data-action="go" data-arg="wrestler/${w.id}">${esc(w.name)}</button>`;

export default {
  label: 'Locker room',
  render() {
    if (!store.isLoaded()) return notLoaded();
    const today = store.today();

    const feuds = rivalries().map(({ a, b, ab, ba, heat }) => `
      <tr>
        <td>${link(a)} <span class="muted">vs</span> ${link(b)}
          <div><span class="pill grease">${esc(describe(ab.hostility >= ba.hostility ? ab : ba))}</span></div></td>
        <td class="num neg">${heat}</td>
        <td class="num">${ab.hostility} / ${ba.hostility}</td>
        <td class="num">${ab.respect} / ${ba.respect}</td>
        <td style="font-size:11px" class="muted">${
          (ab.history.slice(-1)[0] || ba.history.slice(-1)[0])
            ? esc((ab.history.slice(-1)[0] || ba.history.slice(-1)[0]).summary) : '-'}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="empty">No rivalries yet. Book people against each other more than once.</td></tr>';

    const friends = alliances().map(({ a, b, ab, ba, mutual }) => `
      <tr>
        <td>${link(a)} <span class="muted">and</span> ${link(b)}</td>
        <td class="num pos">${signed(ab.affinity)} / ${signed(ba.affinity)}</td>
        <td class="num">${ab.trust} / ${ba.trust}</td>
        <td class="muted">${mutual ? 'mutual' : 'one-sided'}</td>
      </tr>`).join('') || '<tr><td colspan="4" class="empty">Nobody is close to anybody.</td></tr>';

    const gm = store.allWrestlers()
      .slice()
      .sort((a, b) => (a.ties.gm.trust + a.ties.gm.respect) - (b.ties.gm.trust + b.ties.gm.respect))
      .map((w) => {
        const grievances = w.memory
          .filter((m) => ['cut_from_show', 'overlooked', 'title_shot_denied', 'gm_promise_broken'].includes(m.type))
          .map((m) => ({ m, weight: memoryWeightOn(m, today) }))
          .sort((x, y) => y.weight - x.weight);
        return `<tr>
          <td>${link(w)}<div class="muted" style="font-size:11px">${esc(titleCase(w.standing.careerStatus))}</div></td>
          <td class="num ${w.ties.gm.trust < 35 ? 'neg' : ''}">${w.ties.gm.trust}${meter(w.ties.gm.trust, 35)}</td>
          <td class="num ${w.ties.gm.respect < 35 ? 'neg' : ''}">${w.ties.gm.respect}${meter(w.ties.gm.respect, 35)}</td>
          <td class="num">${grievances.length || '<span class="muted">0</span>'}</td>
          <td style="font-size:11px" class="muted">${grievances[0] ? esc(grievances[0].m.summary) : '-'}</td>
        </tr>`;
      }).join('');

    const recent = store.queryLog({
      types: [EVENT_TYPES.WRESTLER_RELATION, EVENT_TYPES.WRESTLER_MEMORY],
      newestFirst: true, limit: 18,
    }).map((e) => `<div class="ev"><span class="d">d${e.day}</span><span>${esc(e.summary)}</span></div>`).join('')
      || '<p class="empty">Nothing has happened between anybody yet.</p>';

    return `
      <h1>Locker room</h1>
      <p class="sub">Read off the relationship axes, never stored as lists, so this cannot disagree with
      the numbers on anybody's own page.</p>

      <h2>Live rivalries</h2>
      <p class="sub">Heat above ${RIVAL_THRESHOLD}. It builds when two people keep meeting and cools when they stop.</p>
      <div class="scroller"><table>
        <thead><tr><th>Pair</th><th>Heat</th><th>Hostility</th><th>Respect</th><th>Last thing that moved it</th></tr></thead>
        <tbody>${feuds}</tbody>
      </table></div>

      <h2>Alliances</h2>
      <div class="scroller"><table>
        <thead><tr><th>Pair</th><th>Affinity</th><th>Trust</th><th></th></tr></thead>
        <tbody>${friends}</tbody>
      </table></div>

      <h2>Where you stand</h2>
      <p class="sub">Worst first. Trust is whether they believe you; respect is whether they rate you.</p>
      <div class="scroller"><table>
        <thead><tr><th>Wrestler</th><th>Trusts you</th><th>Respects you</th><th>Grievances</th><th>Worst of them</th></tr></thead>
        <tbody>${gm}</tbody>
      </table></div>

      <h2>Recently</h2>
      <div class="log">${recent}</div>`;
  },
};
