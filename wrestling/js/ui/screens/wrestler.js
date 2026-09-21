// One wrestler, in the six layers the model is built from.
//
// The memory list is the important part of this screen. The design foundation
// calls the memory log the debugging window into the simulation: if behaviour
// does not follow from what is listed here, the sim is wrong and this is where
// you can see it.

import * as store from '../../core/store.js';
import {
  recordOf, streakLabel, memoryWeightOn, relationshipTo, relationshipWith, notableTies,
  alliesOf, enemiesOf, rivalsOf,
  TRAITS, TRAIT_GROUPS, ABILITIES, CAREER_STATUS, TRAJECTORY, statusRank, CAREER_ORDER,
  ALIGNMENT_LABEL,
} from '../../models/wrestler.js';
import { refusalFloor, expectedMinutes, expectedSlot } from '../../systems/disposition.js';
import { satisfactionOf, DIMENSIONS, DIMENSION_LABEL } from '../../systems/satisfaction.js';
import { wantsOf, voiceThreshold } from '../../systems/requests.js';
import { REQUEST_LABEL } from '../../models/request.js';
import { reignsOf, championIds } from '../../models/title.js';
import { AXES, describe as describeRelationship, isRival, isAlly, isEnemy } from '../../models/relationship.js';
import { memoryTypeOf } from '../../models/memory.js';
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
    const sat = satisfactionOf(w.id);
    const threshold = voiceThreshold(w);
    const wants = wantsOf(w.id);

    const kv = (k, v) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`;
    const bar = (k, v) => `<div class="kv"><span>${k}</span><span>${v}</span></div>${meter(v)}`;

    const ties = notableTies(w);
    const relationships = ties.map(({ id: otherId, rel, label }) => {
      const other = store.getWrestler(otherId);
      const theirAffinity = relationshipTo(other, w.id);
      const oneSided = Math.abs(rel.affinity - theirAffinity) > 35;
      const recent = rel.history.slice(-2).reverse();
      return `<tr>
        <td><button class="rowlink" data-action="go" data-arg="wrestler/${otherId}">${esc(store.nameOf(otherId))}</button>
          <div><span class="pill ${isRival(rel) ? 'grease' : isAlly(rel) ? 'brass' : ''}">${esc(label)}</span></div></td>
        <td class="num ${toneOf(rel.affinity)}">${signed(rel.affinity)}</td>
        <td class="num ${rel.hostility >= 55 ? 'neg' : 'muted'}">${rel.hostility}</td>
        <td class="num">${rel.respect}</td>
        <td class="num ${rel.trust < 35 ? 'neg' : ''}">${rel.trust}</td>
        <td class="num ${toneOf(theirAffinity)}">${signed(theirAffinity)}${oneSided ? '<div class="muted" style="font-size:11px">one-sided</div>' : ''}</td>
        <td style="font-size:11px" class="muted">${recent.map((h) =>
          `d${h.day} ${esc(h.summary || h.type)}`).join('<br>') || '-'}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="7" class="empty">No opinions about anyone yet.</td></tr>';

    const memories = w.memory
      .map((m) => ({ m, weight: memoryWeightOn(m, day) }))
      .sort((a, b) => b.weight - a.weight)
      .map(({ m, weight }) => `
        <tr>
          <td class="num">d${m.day}</td>
          <td>${esc(m.summary)}
            ${m.aboutIds.map((a) => `<button class="rowlink muted" data-action="go" data-arg="wrestler/${a}" style="font-size:11px">${esc(store.nameOf(a))}</button>`).join(' ')}</td>
          <td><span class="pill ${m.scar ? 'grease' : ''}">${esc(titleCase(m.type))}</span>${m.scar ? '<div class="muted" style="font-size:10px">scar</div>' : ''}</td>
          <td class="num">${Math.round(weight)} <span class="muted">/ ${m.weight}</span></td>
        </tr>`).join('') || '<tr><td colspan="4" class="empty">Nothing worth remembering yet.</td></tr>';

    const history = store.historyOf(w.id, { newestFirst: true, limit: 25 })
      .map((e) => `<div class="ev"><span class="d">d${e.day}</span><span class="t">${esc(e.type)}</span><span>${esc(e.summary)}</span></div>`)
      .join('');

    return `
      <h1>${esc(w.name)}</h1>
      <p class="sub">${w.id} &middot; ${esc(titleCase(w.standing.careerStatus))} &middot; debuted day ${w.standing.debutDay}</p>

      <div class="cards">
        <div class="card"><h3>1. Identity &middot; what they want</h3>
          ${kv('The crowd takes them as', ALIGNMENT_LABEL[w.identity.alignment])}
          ${kv('Runs with', store.factionOf(w.id)
            ? `${esc(store.factionOf(w.id).name)}${store.factionOf(w.id).leaderId === w.id ? ' <span class="muted">(leads)</span>' : ''}`
            : '<span class="muted">nobody</span>')}
          ${bar('Ego', w.identity.ego)}
          ${bar('Ambition', w.identity.ambition)}
          <div class="kv"><span class="muted" style="font-size:11px">Ego is what pushes back. Ambition is what they will put up with to get somewhere.</span><span></span></div>
        </div>
        <div class="card"><h3>1. Identity &middot; how they are</h3>
          ${TRAIT_GROUPS.map((group) => `
            <div class="kv" style="border-bottom:0;padding-bottom:0">
              <span class="muted" style="font-size:10px;letter-spacing:.1em;text-transform:uppercase">${esc(group.label)}</span><span></span>
            </div>
            ${group.traits.map((t) => kv(titleCase(t), w.identity.traits[t])).join('')}
          `).join('')}
        </div>
        <div class="card"><h3>2. Ability</h3>
          ${ABILITIES.map((a) => bar(titleCase(a), w.ability[a])).join('')}
        </div>
        <div class="card"><h3>3. Standing</h3>
          ${kv('On the card', `${titleCase(w.standing.careerStatus)} <span class="muted">(${statusRank(w) + 1} of ${CAREER_ORDER.length})</span>`)}
          ${kv('Trajectory', `<span class="${w.standing.trajectory === TRAJECTORY.RISING ? 'pos' : w.standing.trajectory === TRAJECTORY.DECLINING ? 'neg' : 'muted'}">${titleCase(w.standing.trajectory)}</span>`)}
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
          <div class="kv"><span class="muted" style="font-size:11px">Trust is whether they believe what you say. Respect is whether they rate you at the job. They are earned and lost separately.</span><span></span></div>
        </div>
        <div class="card"><h3>5. Ties &middot; the locker room</h3>
          ${kv('Opinions held', Object.keys(w.ties.relationships).length)}
          ${kv('Allies', alliesOf(w).length)}
          ${kv('Enemies', enemiesOf(w).length)}
          ${kv('Live rivalries', rivalsOf(w).length)}
        </div>
        <div class="card"><h3>Contract</h3>
          ${kv('Salary', money(w.contract.salary))}
          ${kv('Expires', w.contract.expiresOnDay == null ? '-' : `day ${w.contract.expiresOnDay}`)}
          ${kv('Status', titleCase(w.contract.status))}
          <div class="kv"><span class="muted" style="font-size:11px">Fields only. The contract system is not built.</span><span></span></div>
        </div>
      </div>

      <h2>How they feel about it</h2>
      <p class="sub">Six things they are separately judging you on. Morale settles toward the total.</p>
      <div class="scroller"><table>
        <thead><tr><th>Dimension</th><th>Score</th><th>Weight</th><th>Why</th></tr></thead>
        <tbody>
          ${DIMENSIONS.map((key) => `<tr>
            <td>${esc(DIMENSION_LABEL[key])}</td>
            <td class="num ${sat.dimensions[key].score < 35 ? 'neg' : sat.dimensions[key].score > 65 ? 'pos' : ''}">${Math.round(sat.dimensions[key].score)}${meter(sat.dimensions[key].score, 35)}</td>
            <td class="num muted">${Math.round(sat.weights[key] * 100)}%</td>
            <td style="font-size:12px" class="muted">${sat.dimensions[key].reasons.map((r) => esc(r)).join('<br>')}</td>
          </tr>`).join('')}
          <tr><td><strong>Overall</strong></td>
            <td class="num"><strong>${sat.overall}</strong></td>
            <td class="num muted">morale ${Math.round(w.state.morale)}</td>
            <td class="muted" style="font-size:12px">Morale drifts toward this over time</td></tr>
        </tbody>
      </table></div>

      <h2>What they want</h2>
      <p class="sub">They will say anything above ${Math.round(threshold)} out loud. Below that they keep it to themselves.</p>
      <div class="scroller"><table>
        <thead><tr><th>Want</th><th>Strength</th><th>Would they say it</th><th>Because</th></tr></thead>
        <tbody>${wants.length ? wants.map((want) => `<tr>
          <td>${esc(REQUEST_LABEL[want.kind])}${want.targetId ? ` <span class="muted">(${esc(store.nameOf(want.targetId))})</span>` : ''}</td>
          <td class="num">${Math.round(want.strength)}</td>
          <td>${want.strength >= threshold
            ? '<span class="pill brass">Says it</span>'
            : '<span class="pill">Keeps it in</span>'}</td>
          <td style="font-size:12px" class="muted">${want.reasons.map((r) => esc(r)).join('<br>')}</td>
        </tr>`).join('') : '<tr><td colspan="4" class="empty">They want nothing in particular right now.</td></tr>'}</tbody>
      </table></div>

      <h2>What they think they are worth</h2>
      <p class="sub">Read off their status. This is what the GM is measured against when a booking arrives.</p>
      <div class="cards">
        <div class="card"><h3>Expectations</h3>
          ${kv('Ring time', `about ${Math.round(expectedMinutes(w))} minutes`)}
          ${kv('Spot on the card', `${Math.round(expectedSlot(w) * 100)}% of the way up`)}
        </div>
        <div class="card"><h3>Room to refuse</h3>
          ${kv('Willingness floor', Math.round(refusalFloor(w)))}
          <div class="kv"><span class="muted" style="font-size:11px">${refusalFloor(w) >= 70
            ? 'Has no standing to turn anything down, whatever they think of it.'
            : refusalFloor(w) >= 45
              ? 'Can complain, and be talked round.'
              : 'Has the standing to say no and make it stick.'}</span><span></span></div>
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
      <p class="sub">Four axes, because one number cannot say that you respect someone you cannot stand.
      All of it is directed: the last column disagreeing with the first is the normal case, not a bug.</p>
      <div class="scroller"><table>
        <thead><tr>
          <th>Wrestler</th><th>Ally</th><th>Hostility</th><th>Respect</th><th>Trust</th>
          <th>They think</th><th>What moved it</th>
        </tr></thead>
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
