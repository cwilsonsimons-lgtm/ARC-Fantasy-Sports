// Championships: who holds what, how long they have held it, who is next in
// line, and every reign the belt has ever had.

import * as store from '../../core/store.js';
import * as clock from '../../core/clock.js';
import * as rankings from '../../systems/rankings.js';
import { championIds, currentReign, isVacant, reignLength } from '../../models/title.js';
import { EVENT_TYPES } from '../../core/events.js';
import { esc, titleCase } from '../format.js';
import { notLoaded } from './roster.js';

export default {
  label: 'Titles',
  render() {
    if (!store.isLoaded()) return notLoaded();
    const titles = store.allTitles();
    if (!titles.length) return `<h1>Titles</h1><p class="empty">No championships exist in this save.</p>`;

    const today = store.today();
    const cal = store.getState().calendar;

    const blocks = titles.map((title) => {
      const reign = currentReign(title);
      const holders = championIds(title);
      const contender = title.contenderId ? store.getWrestler(title.contenderId) : null;
      const days = reignLength(title, today);

      const lineage = [...title.lineage].reverse().map((r, i) => {
        const length = (r.lostOnDay ?? today) - r.wonOnDay;
        return `<tr>
          <td class="num muted">${title.lineage.length - i}</td>
          <td>${r.wrestlerIds.map((id) =>
            `<button class="rowlink" data-action="go" data-arg="wrestler/${id}">${esc(store.nameOf(id))}</button>`).join(' &amp; ')}
            ${r.lostOnDay == null ? ' <span class="pill brass">current</span>' : ''}</td>
          <td class="num">${clock.formatDate(cal, r.wonOnDay)}</td>
          <td class="num">${r.lostOnDay == null ? '<span class="muted">-</span>' : clock.formatDate(cal, r.lostOnDay)}</td>
          <td class="num">${length}d</td>
          <td class="num">${r.defenses}</td>
          <td>${r.wonFromIds.length ? esc(r.wonFromIds.map(store.nameOf).join(' & ')) : '<span class="muted">vacant</span>'}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="7" class="empty">Never defended.</td></tr>';

      const titleMatches = store.queryLog({ type: EVENT_TYPES.MATCH_RESULT })
        .filter((e) => e.data.titleId === title.id)
        .slice(-6).reverse()
        .map((e) => `<div class="ev"><span class="d">d${e.day}</span><span>${esc(e.summary)}</span></div>`)
        .join('') || '<p class="empty">No title matches yet.</p>';

      return `
        <h2>${esc(title.name)}</h2>
        <div class="cards">
          <div class="card"><h3>Champion</h3>
            ${isVacant(title)
              ? '<p class="neg" style="margin:0">Vacant.</p>'
              : `<div class="pb-outcome">${holders.map((id) =>
                  `<button class="rowlink" data-action="go" data-arg="wrestler/${id}"><strong>${esc(store.nameOf(id))}</strong></button>`).join(' &amp; ')}</div>
                 <div class="kv"><span>Held for</span><span>${days} days</span></div>
                 <div class="kv"><span>Defences</span><span>${reign.defenses}</span></div>
                 <div class="kv"><span>Won it</span><span>${clock.formatDate(cal, reign.wonOnDay)}</span></div>`}
          </div>
          <div class="card"><h3>#1 contender</h3>
            ${contender
              ? `<div class="pb-outcome"><button class="rowlink" data-action="go" data-arg="wrestler/${contender.id}"><strong>${esc(contender.name)}</strong></button></div>
                 <div class="kv"><span>Ranked</span><span>#${contender.standing.rank}</span></div>
                 <div class="kv"><span>Record</span><span>${contender.standing.wins}-${contender.standing.losses}</span></div>
                 <div class="kv"><span>Streak</span><span>${contender.standing.streak.type || '-'}${contender.standing.streak.count || ''}</span></div>`
              : '<p class="empty" style="padding:0">Nobody ranked yet.</p>'}
            <div class="kv"><span class="muted" style="font-size:11px">Highest ranked wrestler who is not the champion. You can book past them, and they will notice.</span><span></span></div>
          </div>
          <div class="card"><h3>Recent title matches</h3>
            <div class="log">${titleMatches}</div>
          </div>
        </div>

        <h3 style="margin-top:1rem">Lineage</h3>
        <div class="scroller"><table>
          <thead><tr><th>#</th><th>Champion</th><th>Won</th><th>Lost</th><th>Days</th><th>Def.</th><th>Beat</th></tr></thead>
          <tbody>${lineage}</tbody>
        </table></div>`;
    }).join('');

    const table = rankings.table().slice(0, 10).map((w) => {
      const belts = store.titlesHeldBy(w.id);
      return `<tr>
        <td class="num ${w.standing.rank <= 3 ? 'pos' : ''}">#${w.standing.rank}</td>
        <td><button class="rowlink" data-action="go" data-arg="wrestler/${w.id}">${esc(w.name)}</button>
          ${belts.map((b) => `<span class="pill brass">${esc(b.shortName)}</span>`).join('')}</td>
        <td class="num">${w.standing.wins}-${w.standing.losses}${w.standing.draws ? `-${w.standing.draws}` : ''}</td>
        <td class="num ${w.standing.streak.type === 'W' ? 'pos' : w.standing.streak.type === 'L' ? 'neg' : 'muted'}">${w.standing.streak.type || '-'}${w.standing.streak.count || ''}</td>
        <td class="num">${w.standing.rankPoints.toFixed(1)}</td>
      </tr>`;
    }).join('');

    return `
      <h1>Championships</h1>
      <p class="sub">Rankings are computed from the record after every match. Wrestlers know their number.</p>
      ${blocks}

      <h2>Top ten</h2>
      <div class="scroller"><table>
        <thead><tr><th>Rank</th><th>Wrestler</th><th>Record</th><th>Streak</th><th>Points</th></tr></thead>
        <tbody>${table}</tbody>
      </table></div>`;
  },
};
