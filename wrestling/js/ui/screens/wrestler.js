// One wrestler, in the six layers the model is built from.
//
// The memory list is the important part of this screen. The design foundation
// calls the memory log the debugging window into the simulation: if behaviour
// does not follow from what is listed here, the sim is wrong and this is where
// you can see it.

import * as store from '../../core/store.js';
import {
  recordOf, streakLabel, memoryWeightOn, relationshipTo,
  TRAITS, ABILITIES, CAREER_STATUS,
} from '../../models/wrestler.js';
import { reignsOf, championIds } from '../../models/title.js';
import * as rankings from '../../systems/rankings.js';
import { esc, signed, toneOf, meter, titleCase, money } from '../format.js';
import { notLoaded } from './roster.js';

export default {
  label: 'Wrestler',
  inNav: false,
  render([id]) {
    if (!store.isLoaded()) return notLoaded();
    const w = store.getWrestler(id);
    if (!w) return `<h1>Unknown wrestler</h1><p class="sub">No wrestler with id ${esc(id)}.</p>`;
    const day = store.today();
    const held = store.titlesHeldBy(w.id);
    const reigns = reignsOf(store.getState().titles, w.id);
    const score = rankings.scoreFor(w.id);

    const kv = (k, v) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`;
    const bar = (k, v) => `<div class="kv"><span>${k}</span><span>${v}</span></div>${meter(v)}`;

    const relationships = Object.entries(w.ties.relationships)
      .sort((a, b) => b[1].value - a[1].value)
      .map(([otherId, rel]) => {
        const theirView = relationshipTo(store.getWrestler(otherId), w.id);
        const mutual = Math.sign(rel.value) === Math.sign(theirView) || theirView === 0;
        return `<tr>
          <td><button class="rowlink" data-action="go" data-arg="wrestler/${otherId}">${esc(store.nameOf(otherId))}</button></td>
          <td class="num ${toneOf(rel.value)}">${signed(rel.value)}</td>
          <td class="num ${toneOf(theirView)}">${signed(theirView)}</td>
          <td class="muted">${mutual ? '' : 'one-sided'}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="4" class="empty">No opinions about anyone yet.</td></tr>';

    const memories = w.memory
      .map((m) => ({ m, weight: memoryWeightOn(m, day) }))
      .sort((a, b) => b.weight - a.weight)
      .map(({ m, weight }) => `
        <tr>
          <td class="num">d${m.day}</td>
          <td>${esc(m.summary)}
            ${m.aboutIds.map((a) => `<button class="rowlink muted" data-action="go" data-arg="wrestler/${a}" style="font-size:11px">${esc(store.nameOf(a))}</button>`).join(' ')}</td>
          <td><span class="pill ${m.scar ? 'grease' : ''}">${esc(titleCase(m.type))}</span></td>
          <td class="num">${Math.round(weight)} <span class="muted">/ ${m.weight}</span></td>
        </tr>`).join('') || '<tr><td colspan="4" class="empty">Nothing worth remembering yet.</td></tr>';

    const history = store.historyOf(w.id, { newestFirst: true, limit: 25 })
      .map((e) => `<div class="ev"><span class="d">d${e.day}</span><span class="t">${esc(e.type)}</span><span>${esc(e.summary)}</span></div>`)
      .join('');

    return `
      <h1>${esc(w.name)}</h1>
      <p class="sub">${w.id} &middot; ${esc(titleCase(w.standing.careerStatus))} &middot; debuted day ${w.standing.debutDay}</p>

      <div class="cards">
        <div class="card"><h3>1. Identity</h3>
          ${bar('Ego', w.identity.ego)}
          ${bar('Ambition', w.identity.ambition)}
          ${TRAITS.map((t) => kv(titleCase(t), w.identity.traits[t])).join('')}
        </div>
        <div class="card"><h3>2. Ability</h3>
          ${ABILITIES.map((a) => bar(titleCase(a), w.ability[a])).join('')}
        </div>
        <div class="card"><h3>3. Standing</h3>
          ${kv('Record', recordOf(w))}
          ${kv('Streak', streakLabel(w))}
          ${kv('Rank', w.standing.rank ? `#${w.standing.rank}` : 'unranked')}
          ${kv('Ranking points', w.standing.rankPoints?.toFixed(1) ?? '0')}
          ${kv('Title reigns', reignsOf(store.getState().titles, w.id).length)}
          ${held.length ? kv('Holds', held.map((t) => esc(t.shortName)).join(', ')) : ''}
        </div>
        <div class="card"><h3>4. State</h3>
          ${bar('Morale', w.state.morale)}
          ${kv('Momentum', `<span class="${toneOf(w.state.momentum)}">${signed(w.state.momentum)}</span>`)}
          ${bar('Condition', w.state.condition)}
          ${kv('Mood', titleCase(w.state.mood))}
          ${kv('Health', titleCase(w.state.health.status))}
        </div>
        <div class="card"><h3>5. Ties &middot; the GM</h3>
          ${bar('Trusts you', w.ties.gm.trust)}
          ${bar('Respects you', w.ties.gm.respect)}
          ${kv('Relationships', Object.keys(w.ties.relationships).length)}
        </div>
        <div class="card"><h3>Contract</h3>
          ${kv('Salary', money(w.contract.salary))}
          ${kv('Expires', w.contract.expiresOnDay == null ? '-' : `day ${w.contract.expiresOnDay}`)}
          ${kv('Status', titleCase(w.contract.status))}
          <div class="kv"><span class="muted" style="font-size:11px">Fields only. The contract system is not built.</span><span></span></div>
        </div>
      </div>

      <h2>Why they are ranked #${w.standing.rank ?? '-'}</h2>
      <p class="sub">Rankings come from results and nothing else, which is what makes them arguable.</p>
      <div class="scroller"><table>
        <thead><tr><th>Component</th><th>Points</th><th></th></tr></thead>
        <tbody>
          <tr><td>Lifetime record</td><td class="num ${toneOf(score.parts.career)}">${signed(Math.round(score.parts.career * 10) / 10)}</td><td class="muted">${recordOf(w)}</td></tr>
          <tr><td>Recent results</td><td class="num ${toneOf(score.parts.recent)}">${signed(Math.round(score.parts.recent * 10) / 10)}</td><td class="muted">${score.results.length} match${score.results.length === 1 ? '' : 'es'} in the window</td></tr>
          <tr><td>Momentum</td><td class="num ${toneOf(score.parts.momentum)}">${signed(Math.round(score.parts.momentum * 10) / 10)}</td><td class="muted">${signed(w.state.momentum)}</td></tr>
          <tr><td>Streak</td><td class="num ${toneOf(score.parts.streak)}">${signed(Math.round(score.parts.streak * 10) / 10)}</td><td class="muted">${streakLabel(w)}</td></tr>
          <tr><td><strong>Total</strong></td><td class="num"><strong>${score.points.toFixed(1)}</strong></td><td></td></tr>
        </tbody>
      </table></div>

      ${reigns.length ? `<h2>Championship history</h2>
      <div class="scroller"><table>
        <thead><tr><th>Title</th><th>Won</th><th>Lost</th><th>Days</th><th>Defences</th></tr></thead>
        <tbody>${reigns.map((r) => `<tr>
          <td>${esc(r.titleName)}${r.reign.lostOnDay == null ? ' <span class="pill brass">current</span>' : ''}</td>
          <td class="num">d${r.reign.wonOnDay}</td>
          <td class="num">${r.reign.lostOnDay == null ? '-' : `d${r.reign.lostOnDay}`}</td>
          <td class="num">${(r.reign.lostOnDay ?? day) - r.reign.wonOnDay}</td>
          <td class="num">${r.reign.defenses}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : ''}

      <h2>5. Ties &middot; the locker room</h2>
      <p class="sub">Relationships are directed. The two columns disagreeing is the normal case, not a bug.</p>
      <div class="scroller"><table>
        <thead><tr><th>Wrestler</th><th>${esc(w.shortName)} thinks</th><th>They think</th><th></th></tr></thead>
        <tbody>${relationships}</tbody>
      </table></div>

      <h2>6. Memory</h2>
      <p class="sub">Weight today, against weight when it happened. Scars hold at a high floor.</p>
      <div class="scroller"><table>
        <thead><tr><th>Day</th><th>What they remember</th><th>Type</th><th>Weight</th></tr></thead>
        <tbody>${memories}</tbody>
      </table></div>

      <h2>Everything that has happened to them</h2>
      <div class="log">${history || '<p class="empty">Nothing yet.</p>'}</div>

      <div class="bar" style="margin-top:1.4rem">
        <button class="act" data-action="go" data-arg="roster">Back to roster</button>
      </div>`;
  },
};
