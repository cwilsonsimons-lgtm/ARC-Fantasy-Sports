// Roster: the whole locker room at a glance, every row a link into one entity.

import * as store from '../../core/store.js';
import { recordOf, streakLabel, alliesOf, enemiesOf, CAREER_RANK } from '../../models/wrestler.js';
import { esc, signed, toneOf, meter, titleCase, money } from '../format.js';

export default {
  label: 'Roster',
  render() {
    if (!store.isLoaded()) return notLoaded();
    const day = store.today();
    // Ranked order once rankings exist, because that is the order the locker
    // room argues in. Career status is only the fallback before any results.
    const roster = store.allWrestlers().sort((a, b) => {
      if (a.standing.rank != null && b.standing.rank != null) return a.standing.rank - b.standing.rank;
      if (a.standing.rank != null) return -1;
      if (b.standing.rank != null) return 1;
      return (CAREER_RANK[b.standing.careerStatus] - CAREER_RANK[a.standing.careerStatus])
        || (b.ability.starPower - a.ability.starPower);
    });

    const rows = roster.map((w) => {
      const allies = alliesOf(w).length;
      const enemies = enemiesOf(w).length;
      const expiry = w.contract.expiresOnDay;
      const daysLeft = expiry == null ? null : expiry - day;
      return `
        <tr>
          <td class="num ${w.standing.rank && w.standing.rank <= 3 ? 'pos' : 'muted'}">${w.standing.rank ? `#${w.standing.rank}` : '-'}</td>
          <td><button class="rowlink" data-action="go" data-arg="wrestler/${w.id}"><strong>${esc(w.name)}</strong></button>
              ${store.titlesHeldBy(w.id).map((t) => `<span class="pill brass">${esc(t.shortName)}</span>`).join('')}
              <div class="muted num" style="font-size:11px">${w.id}</div></td>
          <td><span class="pill">${esc(titleCase(w.standing.careerStatus))}</span></td>
          <td class="num">${recordOf(w)}</td>
          <td class="num ${w.standing.streak.type === 'W' ? 'pos' : w.standing.streak.type === 'L' ? 'neg' : 'muted'}">${streakLabel(w)}</td>
          <td class="num">${w.state.morale}${meter(w.state.morale)}</td>
          <td class="num ${toneOf(w.state.momentum)}">${signed(w.state.momentum)}</td>
          <td class="num">${w.ties.gm.trust}${meter(w.ties.gm.trust, 40)}</td>
          <td class="num">${allies ? `<span class="pos">${allies}</span>` : '<span class="muted">0</span>'} / ${enemies ? `<span class="neg">${enemies}</span>` : '<span class="muted">0</span>'}</td>
          <td class="num">${money(w.contract.salary)}</td>
          <td class="num ${daysLeft != null && daysLeft < 120 ? 'neg' : 'muted'}">${daysLeft == null ? '-' : `${daysLeft}d`}</td>
        </tr>`;
    }).join('');

    return `
      <h1>Roster</h1>
      <p class="sub">${roster.length} under contract &middot; one entity each, referenced by ID everywhere else</p>
      <div class="scroller">
        <table>
          <thead><tr>
            <th>Rank</th><th>Wrestler</th><th>Status</th><th>Record</th><th>Streak</th>
            <th>Morale</th><th>Mom.</th><th>Trusts GM</th><th>Allies / Enemies</th>
            <th>Salary</th><th>Deal ends</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  },
};

export function notLoaded() {
  return `<h1>No game loaded</h1>
    <p class="sub">Start one from the saves screen.</p>
    <div class="bar"><button class="act primary" data-action="go" data-arg="saves">Go to saves</button></div>`;
}
