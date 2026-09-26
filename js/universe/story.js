// Universe — the story engine on screen.
//
// After a show's results are in, the engine (suggest.js) may suggest what
// happens next. A suggestion is shown as exactly that - with how likely it
// was and every reason it came up - until the owner accepts it; only then is
// anything recorded, as incidents on the show. The owner can edit one before
// accepting, dismiss it, bring a dismissed one back, or take an accepted one
// back. None of it is ever a result: WWE 2K25 decides every match.
import * as M from './model.js';
import * as RL from './relations.js';
import * as SG from './suggest.js';
import { ICON, INCIDENT, esc, eventWhen, field, incidentText, section, select, wrestlerOptions } from './ui.js';
import { closeSheet, commit, confirmThen, openSheet, paintSheet, pushPage, refresh, uni } from './app.js';

export function uvOpenStory() { pushPage('story', 'all'); }

// the engine reads the record as it stands now, so it only looks at recent shows
function recentEnough(st, ev) {
  const s = M.activeSeason(st);
  return ev.at.season === s.id && ev.at.week >= s.week - 2;
}
// look at a show, inside a change - seeding the draw the first time (the model never rolls)
function look(st, eventId) {
  M.seedStory(st, Math.floor(Math.random() * 2147483646));
  return M.saveStoryRoll(st, eventId, SG.lookAt(st, eventId));
}

/**
 * Called inside a result's own change: once a recent show's card is
 * complete, the engine looks at it, if it's on and hasn't already. Returns
 * how many suggestions came up, or null if it didn't look.
 */
export function uvStoryAfterResult(st, eventId) {
  const ev = M.eventById(st, eventId);
  if (!st.story.on || !ev || M.storyRollOf(st, eventId) || M.cardStatus(ev).state !== 'complete' || !recentEnough(st, ev)) return null;
  try {
    return look(st, eventId).length;
  } catch (e) {                             // a story idea never stands in the way of a result
    if (e instanceof M.UniverseError) return null;
    throw e;
  }
}
/** The tail for a result's toast. */
export function uvStoryToast(n) {
  if (n == null) return '';
  return n ? ` · Story: ${n} suggestion${n === 1 ? '' : 's'} on the show` : '';
}

export function uvStoryLook(eventId) {
  commit(st => look(st, eventId), made => (made.length ? `${made.length} story suggestion${made.length === 1 ? '' : 's'}` : 'Nothing unexpected this time'));
}

// ================================================================ a suggestion

// what accepting would do to relationships, tried on a copy
function preview(st, apply, base = RL.snapshot(st)) {
  try {
    const copy = JSON.parse(JSON.stringify(st));
    apply(copy);
    return RL.changesBetween(copy, base, RL.snapshot(copy));
  } catch (e) {
    if (e instanceof M.UniverseError) return null;
    throw e;
  }
}

// the next episode of a show from this week on, or the week to plan one in
function bookingTarget(st, showId) {
  const s = M.activeSeason(st);
  const eps = st.events.filter(e => e.kind === 'weekly' && e.showId === showId && e.at.season === s.id);
  const next = eps.filter(e => e.at.week >= s.week && M.cardStatus(e).state !== 'complete').sort((a, b) => M.compareStamps(st, a.at, b.at))[0];
  if (next) return { event: next };
  let week = s.week;
  while (eps.some(e => e.at.week === week)) week++;
  return { week };
}
// a challenge or demand, accepted: book the match (the booking form, filled in - never a result)
function bookButton(st, sg) {
  const inc = sg.plan.incidents[0];
  if (!['challenge', 'demand'].includes(inc.kind)) return '';
  const t = inc.title && M.titleById(st, inc.title);
  const showId = (t && t.showId) || (M.wrestlerById(st, inc.by[0]) || {}).showId;
  if (!showId) return '';
  const side = ids => {
    const team = ids.length > 1 && st.teams.find(x => x.active && x.members.length === ids.length && ids.every(i => x.members.includes(i)));
    return `${team ? `${team.id}:` : ''}${ids.join(',')}`;
  };
  const lineup = `${side(inc.by)}|${side(inc.on)}`;
  const target = bookingTarget(st, showId);
  const onclick = target.event ? `uvBookLineup('${target.event.id}','${lineup}','${t ? t.id : ''}')`
    : `uvPlanAndBook('${showId}',${target.week},'${lineup}','${t ? t.id : ''}')`;
  const where = target.event ? target.event.name : `${M.showById(st, showId).name} · Week ${target.week}`;
  return `<div class="uv-btn sm2" onclick="${onclick}">${ICON.plus}Book ${t ? 'the title match' : 'the match'}</div>
    <span class="uv-muted uv-sgw">on ${esc(where)}</span>`;
}

function suggestionCard(st, sg, { showEvent = false, base } = {}) {
  const ev = M.eventById(st, sg.event);
  const k = SG.KIND[sg.kind];
  const problem = sg.status === 'open' ? M.suggestionProblem(st, sg) : null;
  const status = sg.status === 'accepted' ? 'Accepted' : sg.status === 'dismissed' ? 'Dismissed' : problem ? 'No longer fits' : 'Suggested';
  const made = sg.status === 'accepted' && ev ? ev.incidents.filter(x => x.story === sg.id) : [];
  const split = sg.created && sg.created.disbanded && M.teamById(st, sg.created.disbanded.team);
  const team = sg.plan.disband && M.teamById(st, sg.plan.disband);
  const news = sg.status === 'open' && !problem ? preview(st, copy => M.acceptSuggestion(copy, sg.id), base) : null;
  const acts = {
    open: problem ? `<div class="uv-btn sm2" onclick="uvStoryDismiss('${sg.id}')">Dismiss</div>`
      : `<div class="uv-btn pri sm2" onclick="uvStoryAccept('${sg.id}')">${ICON.check}Accept</div>
        <div class="uv-btn sm2" onclick="uvStoryEdit('${sg.id}')">${ICON.edit}Edit</div>
        <div class="uv-btn sm2" onclick="uvStoryDismiss('${sg.id}')">Dismiss</div>`,
    accepted: `<div class="uv-btn sm2" onclick="uvStoryUndo('${sg.id}')">${ICON.undo}Take it back</div>${bookButton(st, sg)}`,
    dismissed: `<div class="uv-btn sm2" onclick="uvStoryReopen('${sg.id}')">Bring it back</div>`,
  }[sg.status];
  return `<div class="uv-sg ${sg.status}${problem ? ' stale' : ''}" style="--k:${k.color}" data-sg="${sg.id}" data-kind="${sg.kind}">
    <div class="top"><span class="uv-rk" style="--k:${k.color}">${esc(k.label)}</span><span class="st">${status}${sg.edited && sg.status === 'open' ? ' · edited' : ''}</span>
      <span class="odds">${esc(SG.oddsText(sg.chance))}</span></div>
    <div class="hl">${esc(SG.headline(st, sg))}</div>
    ${showEvent && ev ? `<div class="where"><span class="uv-link" onclick="uvOpenEvent('${ev.id}')">${esc(ev.name)}</span> · ${esc(eventWhen(st, ev))}</div>` : ''}
    ${problem ? `<div class="warn">${esc(problem)}</div>` : ''}
    <details class="why"${sg.status === 'open' ? ' open' : ''}><summary>Why it came up</summary>
      <ul>${sg.why.map(w => `<li class="${/^Less likely/.test(w) ? 'minus' : ''}">${esc(w)}</li>`).join('')}</ul></details>
    ${sg.status === 'open' && !problem ? `<div class="fx"><b>If you accept</b>
      ${sg.plan.incidents.map(i => `<span>Records on ${esc(ev.name)}: ${esc(incidentText(st, i))}${i.note ? ` — ${esc(i.note)}` : ''}</span>`).join('')}
      ${team ? `<span>${esc(team.name)} are disbanded</span>` : ''}
      ${(news || []).map(x => `<span class="rel">${esc(x)}</span>`).join('')}
      <span class="fine">It’s only a suggestion until then — nothing has happened. Recreate it in WWE 2K25, or just let it stand as part of the story.</span></div>` : ''}
    ${sg.status === 'accepted' ? `<div class="fx"><b>On record</b>
      ${made.map(i => `<span>${esc(incidentText(st, i))}</span>`).join('') || '<span>Its incidents have since been deleted.</span>'}
      ${split ? `<span>${esc(split.name)} split up</span>` : ''}</div>` : ''}
    ${sg.status === 'dismissed' && sg.note ? `<div class="where">Dismissed — ${esc(sg.note)}</div>` : ''}
    <div class="acts">${acts}</div>
  </div>`;
}

export function uvStoryAccept(id) {
  const before = RL.snapshot(uni());
  commit(st => M.acceptSuggestion(st, id), () => {
    const news = RL.changesBetween(uni(), before, RL.snapshot(uni()));
    return `Accepted${news.length ? ` — ${news[0]}${news.length > 1 ? ` (+${news.length - 1} more)` : ''}` : ''}`;
  });
}
export function uvStoryDismiss(id) { commit(st => M.dismissSuggestion(st, id), 'Dismissed — it won’t come back for a while'); }
export function uvStoryReopen(id) { commit(st => M.reopenSuggestion(st, id), 'Brought back'); }
export function uvStoryUndo(id) {
  const st = uni();
  const sg = M.suggestionById(st, id);
  const split = sg.created && sg.created.disbanded && M.teamById(st, sg.created.disbanded.team);
  confirmThen('Take it back?', `Its incidents come off ${(M.eventById(st, sg.event) || { name: 'the show' }).name}${split ? ` and ${split.name} are back together` : ''},`
    + ' and every relationship change they made is worked out again without them. The suggestion goes back to waiting for you.',
  'Take it back', () => commit(s => M.undoSuggestion(s, id), 'Taken back — the suggestion is open again'));
}

// ================================================================ on a show's page

/** The show page's Story section: its suggestions, or whether the engine has looked. */
export function uvStoryBlock(st, ev) {
  const list = M.suggestionsFor(st, ev.id);
  const roll = M.storyRollOf(st, ev.id);
  if (!st.story.on && !list.length) return '';
  const base = list.some(sg => sg.status === 'open') ? RL.snapshot(st) : null;
  const played = ev.matches.some(m => m.status === 'played');
  let note = '';
  if (roll && !list.length) {
    note = `<div class="uv-none">The story engine looked after this show — ${roll.pool} possibilit${roll.pool === 1 ? 'y' : 'ies'} at a
      ${esc(SG.PACE[roll.pace].label.toLowerCase())} pace — and nothing unexpected happened.</div>`;
  } else if (!roll && st.story.on && played && recentEnough(st, ev)) {
    note = `<div class="uv-none">The story engine looks here once every result is in.</div>
      <div class="uv-page-acts"><div class="uv-btn" onclick="uvStoryLook('${ev.id}')">${ICON.star}Look for story ideas now</div></div>`;
  } else if (!roll && st.story.on && played) {
    note = '<div class="uv-none">The story engine only looks at shows from the last couple of weeks.</div>';
  } else if (!roll && st.story.on) {
    note = '<div class="uv-none">Once the results are in, the story engine may suggest what happens next. Nothing happens unless you accept it.</div>';
  }
  return `${section('Story', list.length || null)}
    ${list.length ? `<div class="uv-sgs">${list.map(sg => suggestionCard(st, sg, { base })).join('')}</div>` : ''}
    ${note}
    <p class="uv-p uv-inset-p"><span class="uv-link" onclick="uvOpenStory()">All story suggestions</span> ·
      <span class="uv-link" onclick="uvHowStory()">How the story engine works</span></p>`;
}

/** The season card's line for the story engine. */
export function uvStoryRow(st) {
  const waiting = st.story.suggestions.filter(sg => sg.status === 'open' && !M.suggestionProblem(st, sg)).length;
  const head = waiting ? `Story · ${waiting} suggestion${waiting === 1 ? '' : 's'} waiting` : st.story.on ? 'Story engine' : 'Story engine is off';
  const sub = waiting ? 'Accept, edit or dismiss — nothing has happened until you do'
    : st.story.on ? `${SG.PACE[st.story.pace].label} pace · it looks after each show’s results` : 'Switch it on to get suggestions after shows';
  return `<div class="uv-card-row${waiting ? ' hot' : ''}" data-story="1" onclick="uvOpenStory()">${ICON.star}<div><b>${esc(head)}</b>
    <span>${esc(sub)}</span></div>${ICON.right}</div>`;
}

// ================================================================ the Story page

let decidedShown = 12;
export function uvStoryMore() { decidedShown += 12; refresh(); }

export function uvStoryPage() {
  const st = uni();
  const sto = st.story;
  const at = sg => (M.eventById(st, sg.event) || { at: { season: '', week: 0, seq: 0 } }).at;
  const open = sto.suggestions.filter(sg => sg.status === 'open').sort((a, b) => M.compareStamps(st, at(b), at(a)));
  const decided = sto.suggestions.filter(sg => sg.status !== 'open').sort((a, b) => b.decided.seq - a.decided.seq);
  const accepted = sto.suggestions.filter(sg => sg.status === 'accepted').length;
  const base = open.length ? RL.snapshot(st) : null;
  const seg = (list, cur, fn) => `<div class="uv-seg">${list.map(([k, lb]) => `<div class="${String(cur) === String(k) ? 'on' : ''}" data-v="${k}"
    onclick="${fn}('${k}')">${esc(lb)}</div>`).join('')}</div>`;
  return {
    title: 'Story',
    body: `
      <div class="uv-storyhead">
        <div class="k">Story engine</div>
        <p>After a show’s results are in, it may suggest what happens next — an attack, a save, a betrayal, a challenge — with
          the reasons. Nothing happens unless you accept it, and it never decides a match.</p>
        ${seg([['on', 'On'], ['off', 'Off']], sto.on ? 'on' : 'off', 'uvStoryOn')}
        ${sto.on ? `<div class="uv-sub flush">Pace</div>${seg(Object.entries(SG.PACE).map(([k, p]) => [k, p.label]), sto.pace, 'uvStoryPace')}
          <div class="s">${esc(SG.PACE[sto.pace].text)} At most ${SG.PACE[sto.pace].perShow} a show and ${SG.PACE[sto.pace].perWeek} a week.</div>` : ''}
        <div class="s">Looked at ${sto.rolls.length} show${sto.rolls.length === 1 ? '' : 's'} · ${sto.suggestions.length} suggestion${sto.suggestions.length === 1 ? '' : 's'}
          · ${accepted} accepted · <span class="uv-link" onclick="uvHowStory()">How it works</span></div>
      </div>
      ${section('Waiting for you', open.length || null)}
      ${open.length ? `<div class="uv-sgs">${open.map(sg => suggestionCard(st, sg, { showEvent: true, base })).join('')}</div>`
        : '<div class="uv-none">Nothing waiting. Suggestions turn up here, and on the show they’re about, after its results are in.</div>'}
      ${decided.length ? `${section('Decided', decided.length)}<div class="uv-sgs">${decided.slice(0, decidedShown).map(sg => suggestionCard(st, sg, { showEvent: true })).join('')}</div>
        ${decided.length > decidedShown ? `<div class="uv-more" onclick="uvStoryMore()">Show more (${decided.length - decidedShown})</div>` : ''}` : ''}`,
  };
}
export function uvStoryOn(v) { commit(st => M.setStory(st, { on: v === 'on' }), v === 'on' ? 'Story engine on' : 'Story engine off'); }
export function uvStoryPace(v) { commit(st => M.setStory(st, { pace: v }), `${SG.PACE[v].label} pace`); }

// ================================================================ editing a suggestion

let se = null;

export function uvStoryEdit(id) {
  const sg = M.suggestionById(uni(), id);
  if (!sg) return;
  se = { id, parts: sg.plan.incidents.map(i => ({ ...i, by: [...i.by], on: [...i.on], helped: [...i.helped], note: i.note || '' })),
    disband: !!sg.plan.disband, team: sg.plan.disband || (sg.plan.incidents.find(i => i.team) || {}).team || null };
  openSheet(editSheet);
}
const plan = () => ({ incidents: se.parts.map(p => ({ kind: p.kind, by: p.by, on: p.on, helped: p.helped, match: p.match, title: p.title, team: p.team, note: p.note })),
  disband: se.disband ? se.team : null });

function editSheet() {
  const st = uni();
  const sg = se && M.suggestionById(st, se.id);
  if (!sg || sg.status !== 'open') return null;
  const picks = (j, list, label, optional) => `<div class="uv-sidebox"><div class="h"><span>${esc(label)}</span></div>
    ${se.parts[j][list].map((wid, i) => `<div class="uv-pick">${select(`uvSePick(${j},'${list}',${i},this.value)`, wrestlerOptions(st, wid), ` data-${list}="${j}-${i}"`)}
      ${se.parts[j][list].length > 1 || optional ? `<div class="uv-ic sm" onclick="uvSeDrop(${j},'${list}',${i})">${ICON.x}</div>` : ''}</div>`).join('')}
    <div class="uv-add" onclick="uvSeAdd(${j},'${list}')">${ICON.plus}Add ${se.parts[j][list].length ? 'another' : 'someone'}</div></div>`;
  const news = preview(st, copy => { M.editSuggestion(copy, se.id, plan()); M.acceptSuggestion(copy, se.id); });
  const team = se.team && M.teamById(st, se.team);
  return {
    title: 'Edit the suggestion',
    body: `
      <p class="uv-p">Change who’s in it, or add a note, before you accept it. ${esc(SG.KIND[sg.kind].label)} at
        ${esc((M.eventById(st, sg.event) || { name: '' }).name)}.</p>
      ${se.parts.map((p, j) => {
        const k = INCIDENT[p.kind];
        return `<div class="uv-separt"><div class="h"><span class="uv-rk" style="--k:${k.color}">${esc(k.label)}</span>
          ${se.parts.length > 1 ? `<span class="uv-link" onclick="uvSeDropPart(${j})">Leave this part out</span>` : ''}</div>
          ${picks(j, 'by', k.by, false)}${k.on === false ? '' : picks(j, 'on', k.on || 'Left behind / called out (optional)', k.on === null)}
          ${k.helped ? picks(j, 'helped', k.helped, p.kind === 'interference') : ''}
          <div style="margin-top:8px">${field('Note (optional)', `<input class="uv-in" maxlength="2000" value="${esc(p.note)}" data-note="${j}"
            oninput="uvSeNote(${j},this.value)">`, 'wide')}</div></div>`;
      }).join('')}
      ${team ? `<label class="uv-check"><input id="uvSeDisband" type="checkbox"${se.disband ? ' checked' : ''} onchange="uvSeDisband(this.checked)">
        <span>Disband ${esc(team.name)}</span></label>` : ''}
      <div class="uv-prev"><b>If you accept</b>${news == null ? '<span>Pick who’s in it.</span>'
        : news.length ? news.map(x => `<span>${esc(x)}</span>`).join('') : '<span>No relationship changes.</span>'}</div>
      <div class="uv-btn pri full" onclick="uvSeSave(true)">Save and accept</div>
      <div class="uv-btn full" onclick="uvSeSave(false)">Save changes — decide later</div>`,
  };
}
export function uvSePick(j, list, i, v) { se.parts[j][list][i] = v; paintSheet(); }
export function uvSeAdd(j, list) { se.parts[j][list].push(''); paintSheet(); }
export function uvSeDrop(j, list, i) { se.parts[j][list].splice(i, 1); paintSheet(); }
export function uvSeDropPart(j) { se.parts.splice(j, 1); paintSheet(); }
export function uvSeNote(j, v) { se.parts[j].note = v; }
export function uvSeDisband(v) { se.disband = !!v; paintSheet(); }
export function uvSeSave(accept) {
  const before = RL.snapshot(uni());
  const r = commit(st => { M.editSuggestion(st, se.id, plan()); if (accept) M.acceptSuggestion(st, se.id); }, () => {
    if (!accept) return 'Suggestion saved';
    const news = RL.changesBetween(uni(), before, RL.snapshot(uni()));
    return `Accepted${news.length ? ` — ${news[0]}${news.length > 1 ? ` (+${news.length - 1} more)` : ''}` : ''}`;
  });
  if (r.ok) closeSheet();
}

// ================================================================ the rules, in the app

export function uvHowStory() {
  openSheet(() => {
    const k = SG.KIND, R = SG.RULES;
    return {
      title: 'How the story engine works',
      body: `
        <p class="uv-p"><b>Suggestions, not events.</b> When the last result of a recent show goes in, the engine reads the record —
          results, personalities, relationships, champions, tag teams and who’s been getting booked — and may suggest what happens
          next. Nothing happens until you accept it: no relationship changes, nothing reaches the timeline, and no match is ever
          booked or decided for you. WWE 2K25 decides every result.</p>
        <div class="uv-calc">
          <div><span>${k.attack.label}</span><b>a loser lashes out — likelier if they’re hot-headed or proud, hold a grudge, keep losing to them, or just lost a title</b></div>
          <div><span>${k.save.label}</span><b>someone runs in to stop an attack — a friend, ally, partner, or someone with their own grudge</b></div>
          <div><span>${k.betrayal.label}</span><b>a partner turns — likelier if they’re opportunistic or ambitious, hold a grudge, or keep losing together; rare for the loyal</b></div>
          <div><span>${k.escalation.label}</span><b>rivals, or wrestlers with grudges, brawl — likelier the more bad blood, and if they just shared a ring</b></div>
          <div><span>${k.challenge.label}</span><b>someone steps up to a champion. Everyone eligible is in the draw — weighted by grudges, wins over the champion, streaks and ambition, but nobody is ranked out</b></div>
          <div><span>${k.breakup.label}</span><b>a tag team splits over bad blood, ambition or a losing run. Champions don’t</b></div>
          <div><span>${k.streak.label}</span><b>${R.streakMin}+ straight wins from someone who was losing more than winning</b></div>
          <div><span>${k.demand.label}</span><b>someone short of matches, or ambitious and winning, wants a chance — sometimes at a title</b></div>
        </div>
        <p class="uv-p"><b>Rarity.</b> Every chance starts small; the pace scales it (Quiet ×${SG.PACE.quiet.mult}, Normal ×1, Wild ×${SG.PACE.wild.mult}).
          Someone in something in the last ${R.recentWeeks} weeks is less likely to be in something again. The same thing between the same
          people won’t come back for ${R.repeatWeeks} weeks, and something you dismissed stays away for ${R.dismissedWeeks}. After an
          eventful episode, that show’s next one is calmer. A show gets at most a few, never two of a kind or one wrestler twice.
          With nothing behind it, a suggestion is a real long shot — but not impossible.</p>
        <p class="uv-p"><b>Why each one came up.</b> Every suggestion lists its reasons and how likely it was. The draw is seeded, so the
          same universe always gets the same suggestions — looking again never rerolls.</p>
        <p class="uv-p"><b>Accepting</b> records it on the show as incidents (a team breakup also disbands the team), so relationships
          change and it joins the timeline. <b>Edit</b> changes who’s in it first. <b>Dismiss</b> keeps it off the record. An accepted
          one can be taken back, and its incidents can be edited on the show like any other.</p>
        <p class="uv-p"><b>Outcomes stay open.</b> Rankings never rule anyone out — the least likely challenger can come up, and anyone
          can be booked for any title and win it.</p>`,
    };
  });
}
