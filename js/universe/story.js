// Universe — the story director on screen.
//
// The director (director.js) runs by itself. Before the next show up, and
// after each show's results are in, it may decide what else happened, and
// records it at once as canon: incidents on the show, each with its cause.
// Nothing waits for approval. This file shows what it did:
//   - the "What happened" feed, on the calendar and on its own page
//   - Before the show / During & after, on a show's page
//   - each event, with why it happened and what it changed
//   - the log of every run: its seed, every possibility, its chance and draw
//   - the settings: on or off, and the pace
// Any event can be edited (the incident sheet), undone, or overridden - undo
// it and record what you'd rather, or have the director run that show again.
// It never decides a match: WWE 2K25 does.
import * as M from './model.js';
import * as RL from './relations.js';
import * as DR from './director.js';
import { ICON, INCIDENT, esc, incidentText, section, sideName } from './ui.js';
import { closeSheet, commit, confirmThen, openSheet, pushPage, refresh, uni } from './app.js';
import { uvRelNews } from './personality.js';

export function uvOpenStory() { pushPage('story', 'all'); }

// ================================================================ running it

/**
 * Catch the director up, inside a change: whatever's due now runs. The seed is
 * rolled here the first time (the model never rolls). A story event never
 * stands in the way of the change it follows. Returns the runs it made.
 */
export function uvDirect(st) {
  if (!st.story.on) return [];
  const n = st.story.rolls.length;
  try {
    DR.tick(st, { seed: Math.floor(Math.random() * 2147483646) });
  } catch (e) {
    if (!(e instanceof M.UniverseError)) throw e;
  }
  return st.story.rolls.slice(n);
}

/** A toast's tail for what the director just did: " · After Raw: Roman attacked Solo (+1 more)". */
export function uvDirectedToast(runs) {
  const st = uni();
  const evs = (runs || []).flatMap(r => storyEvents(st, { roll: r.id }));
  if (!evs.length) return '';
  const g = evs[0];
  return ` · ${g.phase === 'pre' ? 'Before' : 'After'} ${g.event.name}: ${headline(st, g)}${evs.length > 1 ? ` (+${evs.length - 1} more)` : ''}`;
}

export function uvStoryCatchUp() {
  commit(st => uvDirect(st), runs => {
    const n = runs.reduce((k, r) => k + storyEvents(uni(), { roll: r.id }).length, 0);
    return runs.length ? `Caught up — ${n ? `${n} story event${n === 1 ? '' : 's'}` : 'nothing happened'}` : 'Nothing to catch up on';
  });
}

// the director can go again on a show's latest run for a part, while that part is still open: before an
// unplayed show, after a played one
function canRerun(st, roll) {
  const ev = roll && M.eventById(st, roll.event);
  if (!ev || !st.story.on || M.directorRollOf(st, roll.event, roll.phase) !== roll) return false;
  const played = ev.matches.some(m => m.status === 'played');
  return roll.phase === 'pre' ? !played : played;
}

// ================================================================ story events

// One story event is what the director decided in one go - an attack and the
// save that stopped it, a betrayal and the turn that came with it - or one
// incident the owner recorded. The incidents of one decision share a run and
// a cause. Newest first; on one show, after before before.
function storyEvents(st, { event = null, roll = null, phase = null, wrestler = null, season = null } = {}) {
  const out = [];
  const one = id => [M.eventById(st, id)].filter(Boolean);
  const evs = event ? one(event) : roll ? one((M.rollById(st, roll) || {}).event) : st.events;
  evs.forEach(ev => {
    if (season && ev.at.season !== season) return;
    ev.incidents.forEach(inc => {
      if (roll && inc.story !== roll) return;
      const ph = inc.phase === 'pre' ? 'pre' : 'post';
      if (phase && ph !== phase) return;
      const last = out[out.length - 1];
      if (inc.story && last && last.event === ev && last.roll && last.roll.id === inc.story
        && JSON.stringify(last.cause) === JSON.stringify(inc.cause)) {
        last.incs.push(inc);
        return;
      }
      out.push({ event: ev, phase: ph, incs: [inc], roll: inc.story ? M.rollById(st, inc.story) : null, cause: inc.cause || [] });
    });
  });
  const people = g => g.incs.flatMap(i => [...i.by, ...i.on, ...i.helped]);
  return (wrestler ? out.filter(g => people(g).includes(wrestler)) : out)
    .sort((a, b) => M.compareStamps(st, b.event.at, a.event.at) || (a.phase === b.phase ? 0 : a.phase === 'post' ? -1 : 1));
}

const nameList = (st, ids) => ids.map(id => (M.wrestlerById(st, id) || { name: '(deleted)' }).name).join(' & ');
// the headline: one line for the whole event
function headline(st, g) {
  const [first, ...rest] = g.incs;
  const extra = rest.map(i => {
    if (i.kind === 'save') return `${nameList(st, i.by)} made the save`;
    if (i.kind === 'turn') return `${nameList(st, i.by)} turned ${i.turn ? i.turn.to : ''}`.trim();
    if (i.kind === 'breakup') return `${(M.teamById(st, i.team) || { name: 'the team' }).name} split`;
    return incidentText(st, i);
  });
  return [incidentText(st, first), ...extra].join(' — ');
}
// the kind a group is shown as: a save stands for the attack it stopped
const kindOf = g => (g.incs.some(i => i.kind === 'save') ? 'save' : g.incs[0].kind);
// the reasons: what drove it, then what held it back
const reasons = g => [...g.cause.filter(w => !/^Less likely/.test(w)), ...g.cause.filter(w => /^Less likely/.test(w))];
const whenText = g => `${g.phase === 'pre' ? 'Before' : g.incs[0].phase ? 'After' : 'At'} ${g.event.name}`;

// the logged possibility behind a director event, for its chance and draw
const PICKED_AS = { momentum: ['rise'], truce: ['respect', 'cooling'], attack: ['attack', 'save'] };
function pickOf(g) {
  if (!g.roll) return null;
  const kinds = g.incs.some(i => i.kind === 'save') ? ['save'] : PICKED_AS[g.incs[0].kind] || [g.incs[0].kind];
  return g.roll.considered.find(k => k.picked && kinds.includes(k.kind)) || null;
}
const chanceText = x => (x >= 0.1 ? `${Math.round(x * 100)}%` : x >= 0.01 ? `${(x * 100).toFixed(1)}%` : `${(x * 100).toFixed(2)}%`);

const matchName = (st, ev, id) => {
  const i = ev.matches.findIndex(m => m.id === id);
  return i < 0 ? '' : `Match ${i + 1}: ${ev.matches[i].sides.map(sd => sideName(st, sd)).join(' vs ')}`;
};

function feedRow(st, g, { where = true } = {}) {
  const k = INCIDENT[kindOf(g)];
  const problem = g.incs.map(i => M.storyProblem(st, g.event, i)).find(Boolean);
  // the director's: where, and its main reason; yours: the match and your note
  const sub = [where ? whenText(g) : '', g.roll ? '' : 'Recorded by you', g.incs.some(i => i.edited) ? 'Edited by you' : '',
    ...(g.roll ? [problem ? '' : reasons(g)[0]] : [g.incs[0].match && matchName(st, g.event, g.incs[0].match), g.incs[0].note])]
    .filter(Boolean).join(' · ');
  return `<div class="uv-wh${problem ? ' stale' : ''}" data-wh="${g.incs[0].id}" data-kind="${kindOf(g)}" onclick="uvStoryEvent('${g.event.id}','${g.incs[0].id}')">
    <span class="uv-rk" style="--k:${k.color}">${esc(k.label)}</span>
    <div class="uv-main"><div class="nm">${esc(headline(st, g))}</div>
      ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}${problem ? `<div class="sub warn">${esc(problem)}</div>` : ''}</div>
    <span class="uv-chev">${ICON.right}</span></div>`;
}

// ================================================================ one event

let open = null;          // { event, inc } - the event on the sheet

export function uvStoryEvent(eventId, incId) {
  open = { event: eventId, inc: incId };
  openSheet(eventSheet);
}
const groupOf = (st, eventId, incId) => storyEvents(st, { event: eventId }).find(g => g.incs.some(i => i.id === incId)) || null;

function eventSheet() {
  const st = uni();
  const g = open && groupOf(st, open.event, open.inc);
  if (!g) return null;
  const ids = g.incs.map(i => i.id);
  const changes = RL.relationships(st).entries.filter(e => ids.includes(e.cause.incident));
  const pick = pickOf(g);
  const problems = [...new Set(g.incs.map(i => M.storyProblem(st, g.event, i)).filter(Boolean))];
  const turns = g.incs.filter(i => i.turn);
  const split = g.roll ? g.roll.disbanded.filter(d => ids.includes(d.incident)).map(d => M.teamById(st, d.team)).filter(Boolean) : [];
  const rs = reasons(g);
  const none = g.incs.some(i => i.kind === 'momentum') ? 'No relationship changes — the director remembers it when a title shot comes up'
    : g.incs.some(i => i.kind === 'open-challenge') ? 'No relationship changes yet — whoever answers is up to you and the game' : 'No relationship changes';
  return {
    title: INCIDENT[kindOf(g)].label,
    body: `
      <div class="uv-whhead" data-event="${g.event.id}">
        <div class="hl">${esc(headline(st, g))}</div>
        <div class="s"><span class="uv-link" onclick="uvStoryToShow('${g.event.id}')">${esc(whenText(g))}</span>${g.event.kind === 'weekly' ? '' : ` · Week ${g.event.at.week}`}
          · ${g.roll ? 'the story director' : 'recorded by you'}${g.incs.some(i => i.edited) ? ' · edited by you' : ''}</div>
      </div>
      ${problems.map(p => `<div class="uv-note warn">${esc(p)} It stays on record — edit it or undo it if it no longer fits.</div>`).join('')}
      ${g.incs.map(i => (i.note ? `<div class="uv-note">${esc(i.note)}</div>` : '')).join('')}
      ${rs.length ? `<div class="uv-sub flush">Why it happened</div>
        <ul class="uv-why" data-why="1">${rs.map(w => `<li class="${/^Less likely/.test(w) ? 'minus' : ''}">${esc(w)}</li>`).join('')}</ul>` : ''}
      <div class="uv-sub flush">What it changed</div>
      <ul class="uv-why" data-fx="1">
        ${changes.map(e => `<li class="${e.ignored ? 'minus' : ''}">${esc(RL.entryText(st, e).result)}${e.ignored ? ' — ignored by you' : ''}</li>`).join('')}
        ${turns.map(i => `<li>${esc(nameList(st, i.by))}: ${esc(i.turn.from || 'no alignment')} → ${esc(i.turn.to)}</li>`).join('')}
        ${split.map(t => `<li>${esc(t.name)} disbanded</li>`).join('')}
        ${changes.length || turns.length || split.length ? '' : `<li class="minus">${esc(none)}</li>`}
      </ul>
      ${pick ? `<div class="uv-odds">Chance ${esc(chanceText(pick.chance))} · drew ${pick.draw.toFixed(4)}${pick.shock ? ' · a rare shock' : ''}
        · <span class="uv-link" onclick="uvStoryLog('${g.roll.id}')">See the whole run</span></div>` : ''}
      ${bookButton(st, g)}
      <div class="uv-sub flush">Change it</div>
      ${g.incs.map(i => `<div class="uv-btn full" data-edit="${i.id}" onclick="uvStoryEdit('${g.event.id}','${i.id}')">${ICON.edit}Edit “${esc(incidentText(st, i))}”</div>`).join('')}
      <div class="uv-btn bad full" onclick="uvStoryUndoEvent('${g.event.id}','${g.incs[0].id}')">${ICON.undo}Undo it — it didn’t happen</div>
      ${g.roll && canRerun(st, g.roll) ? `<div class="uv-btn full" onclick="uvStoryRerun('${g.roll.id}')">Run ${g.phase === 'pre' ? 'before' : 'after'} ${esc(g.event.name)} again</div>` : ''}
      <div class="fine">Nothing here needs your approval — it’s already part of the story. Edit it, undo it, or have the show run
        again for something else. None of it changes a result, a title or a roster.</div>`,
  };
}
export function uvStoryToShow(eventId) { closeSheet(); pushPage('event', eventId); }
export function uvStoryEdit(eventId, incId) { closeSheet(); window.uvIncident(eventId, incId); }

export function uvStoryUndoEvent(eventId, incId) {
  const st = uni();
  const g = groupOf(st, eventId, incId);
  if (!g) return;
  const split = g.roll ? g.roll.disbanded.filter(d => g.incs.some(i => i.id === d.incident)).map(d => M.teamById(st, d.team)).filter(Boolean) : [];
  const turn = g.incs.find(i => i.turn);
  confirmThen('Undo it?', `“${headline(st, g)}” comes off ${g.event.name}, and every relationship change it made is worked out again without it.`
    + (turn ? ` ${nameList(st, turn.by)} goes back to ${turn.turn.from || 'no alignment'}.` : '')
    + (split.length ? ` ${split.map(t => t.name).join(' and ')} are back together.` : '')
    + (g.roll ? ' The director won’t do it again by itself.' : ''),
  'Undo it', () => {
    const before = RL.snapshot(uni());
    const r = commit(s => g.incs.forEach(i => M.deleteIncident(s, eventId, i.id)), () => `Undone${uvRelNews(before)}`);
    if (r.ok) closeSheet();
  });
}

// a title demand, a challenge or an open challenge can be booked: the booking
// form, filled in, on the show's next episode - never a result
function bookingTarget(st, showId) {
  const s = M.activeSeason(st);
  const eps = st.events.filter(e => e.kind === 'weekly' && e.showId === showId && e.at.season === s.id);
  const next = eps.filter(e => e.at.week >= s.week && !e.matches.some(m => m.status === 'played')).sort((a, b) => M.compareStamps(st, a.at, b.at))[0];
  if (next) return { event: next };
  let week = s.week;
  while (eps.some(e => e.at.week === week)) week++;
  return { week };
}
function bookButton(st, g) {
  const inc = g.incs.find(i => ['challenge', 'demand', 'open-challenge'].includes(i.kind));
  if (!inc) return '';
  const t = inc.title && M.titleById(st, inc.title);
  const reign = t && t.active && M.currentReign(st, t.id);
  const champs = reign ? (reign.holder.type === 'team' ? (M.teamById(st, reign.holder.id) || { members: [] }).members : [reign.holder.id]) : [];
  const other = inc.on.length ? inc.on : champs.filter(id => !inc.by.includes(id));     // a champion's open challenge: the other side is yours to fill
  const showId = (t && t.showId) || (M.wrestlerById(st, inc.by[0]) || {}).showId;
  if (!showId || !M.showById(st, showId)) return '';
  const side = ids => {
    const team = ids.length > 1 && st.teams.find(x => x.active && x.members.length === ids.length && ids.every(i => x.members.includes(i)));
    return `${team ? `${team.id}:` : ''}${ids.join(',')}`;
  };
  const lineup = `${side(inc.by)}|${side(other)}`;
  const target = bookingTarget(st, showId);
  const title = reign ? t.id : '';
  const onclick = target.event ? `uvStoryBook('${target.event.id}',0,'${lineup}','${title}')` : `uvStoryBook('${showId}',${target.week},'${lineup}','${title}')`;
  const where = target.event ? target.event.name : `${M.showById(st, showId).name} · Week ${target.week}`;
  return `<div class="uv-btn pri full" data-book="1" onclick="${onclick}">${ICON.plus}Book ${title ? 'the title match' : 'the match'} on ${esc(where)}</div>
    <div class="fine">Opens the booking form, filled in. You decide whether it happens — and WWE 2K25 decides who wins.</div>`;
}
export function uvStoryBook(target, week, lineup, titleId) {
  closeSheet();
  if (week) window.uvPlanAndBook(target, week, lineup, titleId);
  else window.uvBookLineup(target, lineup, titleId);
}

// ================================================================ runs

export function uvStoryRerun(rollId) {
  const st = uni();
  const roll = M.rollById(st, rollId);
  const ev = roll && M.eventById(st, roll.event);
  if (!ev) return;
  confirmThen(`Run ${roll.phase === 'pre' ? 'before' : 'after'} ${ev.name} again?`,
    `${roll.undone ? 'The director' : 'Everything the director did there comes off, and it'} decides again with the next draw — just as reproducible.`
    + ' Anything you recorded yourself stays.',
    'Run it again', () => {
      closeSheet();
      commit(s => DR.rerun(s, rollId), r => {
        const n = storyEvents(uni(), { roll: r.id }).length;
        return n ? `Ran again${uvDirectedToast([r]).replace(/^ · /, ' — ')}` : 'Ran again — nothing happened this time';
      });
    });
}
export function uvStoryUndoRun(rollId) {
  const st = uni();
  const roll = M.rollById(st, rollId);
  const ev = roll && M.eventById(st, roll.event);
  if (!ev) return;
  const n = storyEvents(st, { roll: rollId }).length;
  confirmThen(`Undo everything ${roll.phase === 'pre' ? 'before' : 'after'} ${ev.name}?`,
    `The director’s ${n} event${n === 1 ? '' : 's'} there come off: turns go back, teams it split are back together, and relationships are worked out again.`
    + ' The run stays in the log as undone, and the director won’t redo it by itself.',
    'Undo them', () => {
      closeSheet();
      const before = RL.snapshot(uni());
      commit(s => M.undoDirectorRoll(s, rollId), () => `Undone${uvRelNews(before)}`);
    });
}

// a possibility's key, in names: "attack:w3>w7" → "Roman Reigns → Solo Sikoa"
function keyText(st, key) {
  return key.slice(key.indexOf(':') + 1)
    .replace(/[a-z]+\d+/g, id => (M.wrestlerById(st, id) || M.teamById(st, id) || M.titleById(st, id) || { name: id }).name)
    .replace(/>/g, ' → ').replace(/\+/g, ' & ').replace(/:/g, ' · ');
}

export function uvStoryLog(rollId) {
  openSheet(() => {
    const st = uni();
    const roll = M.rollById(st, rollId);
    const ev = roll && M.eventById(st, roll.event);
    if (!ev) return null;
    const made = storyEvents(st, { roll: roll.id });
    return {
      title: `${roll.phase === 'pre' ? 'Before' : 'After'} ${ev.name}`,
      body: `
        <div class="uv-logh" data-log="${roll.id}">
          <div><span>Seed</span><b>${roll.seed}</b></div><div><span>Run</span><b>${roll.nonce ? `again ×${roll.nonce}` : 'first'}</b></div>
          <div><span>Pace</span><b>${esc(DR.PACE[roll.pace] ? DR.PACE[roll.pace].label : roll.pace)}</b></div><div><span>Weighed</span><b>${roll.pool}</b></div>
        </div>
        ${roll.problem ? `<div class="uv-note warn">What it picked couldn’t be recorded — ${esc(roll.problem)} It was logged with nothing made.</div>` : ''}
        <p class="uv-p">${roll.undone ? 'You undid this run.' : made.length ? `${made.length} event${made.length === 1 ? '' : 's'} came of it.` : 'Nothing came of it.'}
          A possibility happens when its draw is under its chance, if the show still has room. Each draw comes from the save’s seed,
          the show, the run and the possibility — the same save always draws the same.</p>
        ${made.length ? `<div class="uv-whs">${made.map(g => feedRow(st, g, { where: false })).join('')}</div>` : ''}
        <div class="uv-sub flush">Every possibility</div>
        <div class="uv-log">${roll.considered.length ? roll.considered.map(k => `<div class="${k.picked ? 'on' : k.draw < k.chance ? 'near' : ''}">
          <span class="k">${esc(k.kind === 'save' ? 'Attack, then a save' : (DR.KIND[k.kind] || { label: k.kind }).label)}</span><span class="p">${esc(keyText(st, k.key))}</span>
          <span class="n">${esc(chanceText(k.chance))}</span><span class="n">${k.draw.toFixed(3)}</span>
          <span class="r">${k.picked ? 'Happened' : k.draw < k.chance ? 'Came up — no room' : ''}${k.shock ? ' · shock' : ''}</span></div>`).join('')
          : '<div class="none">Nothing was possible here.</div>'}</div>
        ${roll.considered.length < roll.pool ? `<div class="fine">The log keeps the ${roll.considered.length} likeliest of ${roll.pool}.</div>` : ''}
        ${canRerun(st, roll) ? `<div class="uv-btn full" onclick="uvStoryRerun('${roll.id}')">Run it again</div>` : ''}
        ${roll.undone || !made.length ? '' : `<div class="uv-btn bad full" onclick="uvStoryUndoRun('${roll.id}')">${ICON.undo}Undo everything from this run</div>`}`,
    };
  });
}

// ================================================================ on a show's page

// where the director is with a show's part: done (and what can be done about it), coming, or not at all
function runLine(st, ev, phase, roll) {
  if (roll) {
    const n = storyEvents(st, { roll: roll.id }).length;
    const what = roll.undone ? 'You undid what the director did here.' : n ? '' : `Nothing happened ${phase === 'pre' ? 'before the show' : 'after the results'}.`;
    const links = [`<span class="uv-link" onclick="uvStoryLog('${roll.id}')">The director’s log</span>`,
      !roll.undone && n ? `<span class="uv-link" onclick="uvStoryUndoRun('${roll.id}')">Undo all</span>` : '',
      canRerun(st, roll) ? `<span class="uv-link" onclick="uvStoryRerun('${roll.id}')">Run it again</span>` : ''].filter(Boolean);
    return `<div class="uv-runl" data-run="${roll.id}">${what ? `${esc(what)} ` : ''}${links.join(' · ')}</div>`;
  }
  if (!st.story.on) return '';
  if (DR.due(st).some(d => d.event.id === ev.id && d.phase === phase)) {
    return '<div class="uv-runl">The story director hasn’t been through this yet. <span class="uv-link" onclick="uvStoryCatchUp()">Catch up now</span></div>';
  }
  const s = M.activeSeason(st);
  const since = st.story.since;
  const inScope = ev.at.season === s.id && ev.at.week >= s.week - DR.RULES.window && !(since && since.season === s.id && ev.at.week < since.week);
  const played = ev.matches.some(m => m.status === 'played');
  if (!inScope) return '';
  if (phase === 'pre') return played ? '' : '<div class="uv-runl">The story director decides what happens before the show once it’s the next one up.</div>';
  return `<div class="uv-runl">${played ? 'Once every result is in — or the week is over — the story director decides what happens after.'
    : 'After the results, the story director decides what else happens.'}</div>`;
}

/**
 * A show's story: 'pre' (Before the show, above the card) or 'post' (During &
 * after, below it) - every event with its cause, and where the director is.
 */
export function uvStoryBlock(st, ev, phase) {
  const list = storyEvents(st, { event: ev.id, phase });
  const line = runLine(st, ev, phase, M.directorRollOf(st, ev.id, phase));
  if (!list.length && !line) return '';
  return `${section(phase === 'pre' ? 'Before the show' : 'During & after', list.length || null)}
    ${list.length ? `<div class="uv-whs" data-phase="${phase}">${list.map(g => feedRow(st, g, { where: false })).join('')}</div>` : ''}
    ${line}`;
}

// ================================================================ the feed

/** The calendar's "What happened": the latest few things, and the way to all of them. */
export function uvStoryRow(st) {
  const s = M.activeSeason(st);
  const recent = storyEvents(st, { season: s.id }).filter(g => g.event.at.week >= s.week - 1).slice(0, 3);
  const head = st.story.on ? 'What happened' : 'What happened · the story director is off';
  const sub = st.story.on ? 'Nothing off the card lately — the story director runs around every show' : 'Switch it on to have the story unfold by itself';
  return `<div class="uv-card-row" data-story="1" onclick="uvOpenStory()">${ICON.star}<div><b>${esc(head)}</b>
    ${recent.length ? recent.map(g => `<span class="wh">${esc(headline(st, g))}</span>`).join('') : `<span>${esc(sub)}</span>`}</div>${ICON.right}</div>`;
}

let shown = 20;
let only = '';
export function uvStoryMore() { shown += 20; refresh(); }
export function uvStoryOnly(v) { only = v; shown = 20; refresh(); }

export function uvStoryPage() {
  const st = uni();
  const sto = st.story;
  const s = M.activeSeason(st);
  const all = storyEvents(st, { season: s.id });
  const list = all.filter(g => !only || (only === 'yours' ? !g.roll : g.roll && g.phase === only));
  const runs = sto.rolls.filter(r => M.eventById(st, r.event));
  const due = sto.on ? DR.due(st).length : 0;
  const seg = (items, cur, fn) => `<div class="uv-seg">${items.map(([k, lb]) => `<div class="${String(cur) === String(k) ? 'on' : ''}" data-v="${k}"
    onclick="${fn}('${k}')">${esc(lb)}</div>`).join('')}</div>`;
  let wk = null;        // the feed, a week at a time
  const rows = list.slice(0, shown).map(g => {
    const head = g.event.at.week !== wk ? `<div class="uv-sub">Week ${g.event.at.week}${g.event.at.week === s.week ? ' · this week' : ''}</div>` : '';
    wk = g.event.at.week;
    return head + feedRow(st, g);
  }).join('');
  const pace = DR.PACE[sto.pace];
  return {
    title: 'What happened',
    body: `
      <div class="uv-storyhead">
        <div class="k">Story director</div>
        <p>Around every show it decides what else happens — attacks, saves, betrayals, alliances, challenges, turns — from the
          record, and makes it part of the story. No approval needed: edit, undo or rerun anything. It never decides a match.</p>
        ${seg([['on', 'On'], ['off', 'Off']], sto.on ? 'on' : 'off', 'uvStoryOn')}
        ${sto.on ? `<div class="uv-sub flush">Pace</div>${seg(Object.entries(DR.PACE).map(([k, p]) => [k, p.label]), sto.pace, 'uvStoryPace')}
          <div class="s">${esc(pace.text)} At most ${pace.pre} before a show, ${pace.post} after, and ${pace.perWeek} a week.</div>` : ''}
        <div class="s">${all.length} event${all.length === 1 ? '' : 's'} in ${esc(s.name)} · ${runs.length} run${runs.length === 1 ? '' : 's'} logged${sto.seed ? ` · seed ${sto.seed}` : ''}
          · <span class="uv-link" onclick="uvHowStory()">How it works</span></div>
      </div>
      ${due ? `<div class="uv-card-row hot uv-inset" onclick="uvStoryCatchUp()">${ICON.star}<div><b>The story director is behind</b>
        <span>${due} show${due === 1 ? '' : 's'} to go through — catch up now</span></div>${ICON.right}</div>` : ''}
      <div class="uv-pills tight uv-whf">${[['', 'Everything'], ['pre', 'Before shows'], ['post', 'After shows'], ['yours', 'Yours']].map(([k, lb]) =>
        `<div class="uv-pill${only === k ? ' on' : ''}" data-only="${k}" onclick="uvStoryOnly('${k}')">${esc(lb)}</div>`).join('')}</div>
      <div class="uv-whs" data-feed="1">${rows || `<div class="uv-none">${sto.on ? 'Nothing yet. Plan a show, enter results, or move on a week — the story director does the rest.'
        : 'The story director is off. What you record yourself shows up here.'}</div>`}</div>
      ${list.length > shown ? `<div class="uv-more" onclick="uvStoryMore()">Show more (${list.length - shown})</div>` : ''}
      ${runs.length ? `${section('The director’s log', runs.length)}
        <div class="uv-whs">${[...runs].reverse().slice(0, 12).map(r => {
          const ev = M.eventById(st, r.event);
          const n = storyEvents(st, { roll: r.id }).length;
          return `<div class="uv-wh log" data-log="${r.id}" onclick="uvStoryLog('${r.id}')"><div class="uv-main">
            <div class="nm">${r.phase === 'pre' ? 'Before' : 'After'} ${esc(ev.name)}</div>
            <div class="sub">${r.undone ? 'Undone' : `${n} event${n === 1 ? '' : 's'}`} · ${r.pool} weighed${r.nonce ? ` · run again ×${r.nonce}` : ''}</div></div>
            <span class="uv-chev">${ICON.right}</span></div>`;
        }).join('')}</div>` : ''}`,
  };
}
export function uvStoryOn(v) {
  commit(st => { M.setStory(st, { on: v === 'on' }); return v === 'on' ? uvDirect(st) : []; },
    runs => (v === 'on' ? `Story director on — from this week${uvDirectedToast(runs)}` : 'Story director off — nothing more happens by itself'));
}
export function uvStoryPace(v) { commit(st => M.setStory(st, { pace: v }), `${DR.PACE[v].label} pace`); }

// ================================================================ on a wrestler's page

/** Where a wrestler's story stands: what they're after, how they're going, and what's happened to them lately. */
export function uvProfileStory(st, w) {
  const goal = DR.goalOf(st, w.id);
  const mo = DR.momentumOf(st, w.id);
  const mine = storyEvents(st, { wrestler: w.id }).slice(0, 4);
  const label = { hot: 'Hot', rising: 'Rising', steady: 'Steady', cold: 'Cold' }[mo.label];
  return `${section('Story', null)}
    <div class="uv-story1" data-goal="${esc(goal || '')}" data-momentum="${mo.label}">
      <div><span>Goal</span><b>${esc(goal || 'Nothing in particular')}</b></div>
      <div><span>Momentum</span><b class="mo ${mo.label}">${label}${mo.form ? ` · ${esc(mo.form.split('').join(' '))}` : ''}</b>
        ${mo.reasons.length ? `<em>${esc(mo.reasons.join(' · '))}</em>` : ''}</div>
    </div>
    ${mine.length ? `<div class="uv-whs">${mine.map(g => feedRow(st, g)).join('')}</div>` : ''}
    <p class="uv-p uv-inset-p">Worked out from the record, and used by the story director. Everything that happened is in the career history below.</p>`;
}

// ================================================================ the rules, in the app

export function uvHowStory() {
  openSheet(() => {
    const K = DR.KIND, R = DR.RULES, P = DR.PACE;
    const pace = P[uni().story.pace];
    return {
      title: 'How the story director works',
      body: `
        <p class="uv-p"><b>You watch; it tells the story around the matches.</b> Before the next show up — once it’s planned, or you move to
          its week — and after each show’s results are in, the director may decide what else happened. It’s recorded at once, as canon,
          on the show: in the What happened feed, on the timeline, on each wrestler’s page, and in their relationships. Nothing waits
          for approval.</p>
        <div class="uv-calc">
          <div><span>Before a show</span><b>a ${K.confrontation.label.toLowerCase()} (two tag teams at odds face off as teams), a
            ${K.demand.label.toLowerCase()} (a #1 contender wants their match), an ${K['open-challenge'].label.toLowerCase()},
            a ${K.alliance.label.toLowerCase()}, team tension, a rivalry cooling, a turn — so they can shape the card you book</b></div>
          <div><span>After the results</span><b>an ${K.interference.label.toLowerCase()} — a friend, tag partner or ally running in to help
            someone win, or a rival costing someone the match — a ${K.attack.label.toLowerCase()} (partners joining in; sometimes stopped
            by a ${K.save.label.toLowerCase()}), a ${K.betrayal.label.toLowerCase()}, a rivalry boiling over, a team breakup, a handshake,
            a title challenge (a new #1 contender above all), an underdog on the rise, a turn</b></div>
        </div>
        <p class="uv-p"><b>Every event has a cause.</b> It comes from the record: personalities, relationships and grudges, goals, momentum,
          tag teams, champions, recent results and what’s already happened. The reasons stay with it — tap any event to see them, and
          what it changed.</p>
        <p class="uv-p"><b>Personalities decide who does what.</b> The hot-headed attack and confront; the proud hate to lose; the cowardly
          strike from outside the ring, bring their partners, and need the help; the opportunistic run in when there’s something in it;
          the loyal stand by partners and make saves; the patient hold back; the respectful shake hands and stay out of other people’s
          fights. Friends, tag partners and allies run in for each other and make the saves; rivals and grudges cost each other
          matches and confront each other; teammates who stop trusting each other clash, and then split.</p>
        <p class="uv-p"><b>Occasional and varied.</b> Every chance starts small, and the pace scales it (Quiet ×${P.quiet.mult}, Normal ×1,
          Wild ×${P.wild.mult}). At this pace a show gets at most ${pace.pre} before and ${pace.post} after, and a week ${pace.perWeek} — never
          two of a kind on a show, or one wrestler twice. Anyone in something in the last ${R.recentWeeks} weeks is less likely to be in more,
          and the same thing between the same people doesn’t happen again for ${R.repeatWeeks} weeks. After an eventful episode, a show’s
          next one is calmer.</p>
        <p class="uv-p"><b>Big moments are earned.</b> A betrayal needs buildup — tension between them, a grudge, losing together. A
          breakup needs ${R.breakupTension} or more rounds of tension within ${R.buildupWeeks} weeks, and champions don’t split. A turn needs a
          record: attacks and betrayals for a face to turn heel; saves, alliances and truces (or being wronged by heels) for a heel to turn
          face. Betrayals, breakups and turns are spaced out across the universe, and nobody turns twice within ${R.turnGapWeeks} weeks. A true
          shock — a betrayal out of nowhere — is a long shot, at most once every ${R.shockSpacing} weeks.</p>
        <p class="uv-p"><b>Outcomes stay open.</b> A title challenger is drawn from everyone eligible, weighted by the record with nobody
          ruled out, and an underdog’s wins get noticed — a wrestler at the bottom of the rankings can become a star if the CPU results
          say so.</p>
        <p class="uv-p"><b>What it never does.</b> It never enters, invents or changes a match or its winner, never hands out a title
          (titles change only on a result you enter), and never moves anyone between shows (only the draft and relegation do). A
          breakup can disband a team and a turn changes an alignment — that’s all it changes beyond the story.</p>
        <p class="uv-p"><b>Reproducible.</b> Each save has its own seed. Every draw comes from the seed, the show, the run and the
          possibility, so the same save always tells the same story. Every run is logged — each possibility, its chance and its
          draw — from the show’s page and the What happened page.</p>
        <p class="uv-p"><b>Yours to change.</b> Edit any event, undo it, or have the director run a show again (the next draw, just as
          reproducible). What you undo stays undone. Switch it off and nothing happens by itself; switch it back on and it starts from
          that week. If a result an event followed is corrected later, the event is marked — it stays unless you change it.</p>`,
    };
  });
}
