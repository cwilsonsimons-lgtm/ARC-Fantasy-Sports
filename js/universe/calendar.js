// Universe — the universe calendar on screen.
//
// Twelve months of exactly four weeks, seven days a week (model.js): the
// month at a glance, the premium live events and special events ahead and how
// each is being built toward, scheduling and rescheduling them, the annual
// events, and the calendar's settings - the month and year the universe began
// in, and each show's night.
//
// Nothing here moves the clock or decides a match. Next week (sheets.js) is
// the only thing that advances the date; it puts the year's annual events on
// the calendar and never enters a result.
import * as M from './model.js';
import {
  ICON, LABEL, MONTH_NAMES, NIGHT, STATUS_LABEL, chip, dateText, esc, eventShowsText, eventWhen, field, monthText, options, section, select,
  showColor, statusBadge, vsLine,
} from './ui.js';
import { closeSheet, commit, confirmThen, openSheet, paintSheet, pushPage, refresh, uni } from './app.js';
import { uvDirect, uvDirectedToast } from './story.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const toGoText = w => (w <= 0 ? 'this week' : w === 1 ? 'next week' : `in ${w} weeks`);
export const FOCUS_LABEL = { qualifiers: 'Qualifying matches', contenders: '#1 contender’s matches', feuds: 'Rivalries', teams: 'Team formation' };
export const PREP_LABEL = { qualifier: 'Qualifier', contender: '#1 contender', feud: 'Building', team: 'Teams form' };
const KIND_WORD = { ple: 'Premium live event', special: 'Special event' };
const SHORT = { raw: 'Raw', smackdown: 'SD', dynamite: 'Dyn', nxt: 'NXT' };
const shortName = sh => SHORT[sh.id] || sh.name.slice(0, 4);

// ================================================================ the month at a glance

let calMode = 'week';        // the Calendar tab: 'week' or 'month'
let calMonth = null;         // { year, month } on screen; null follows the current week's month

export function uvCalMode(mode) { calMode = mode === 'month' ? 'month' : 'week'; refresh(); }
export const calendarMode = () => calMode;
/** When the clock moves, the month view goes with it. */
export function uvMonthFollow() { calMonth = null; }
export function uvCalMonth(d) {
  const st = uni();
  const cur = shownMonth(st);
  const m = cur.month + Number(d);
  calMonth = { year: cur.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
  const now = nowDate(st);
  if (calMonth.year === now.year && calMonth.month === now.month) calMonth = null;
  refresh();
}
export function uvCalThisMonth() { calMonth = null; refresh(); }
/** A week of the month, opened in the week view. */
export function uvCalOpenWeek(seasonId, week) {
  calMode = 'week';
  window.uvGo('week', `${seasonId}:${week}`);
}

const nowDate = st => { const s = M.activeSeason(st); return M.universeDate(st, s.id, s.week); };
const shownMonth = st => calMonth || (({ year, month }) => ({ year, month }))(nowDate(st));

/** The month view: four weeks of seven days, every event on its night, and where each stands. */
export function uvMonthView(st) {
  const s = M.activeSeason(st);
  const now = nowDate(st);
  const cur = shownMonth(st);
  const isNow = cur.year === now.year && cur.month === now.month;
  const rows = [1, 2, 3, 4].map(w => ({ w, at: M.seasonWeekOf(st, { year: cur.year, month: cur.month, week: w }) }));
  const inMonth = [];
  const row = ({ w, at }) => {
    const label = at ? `<div class="wk${at.season === s.id && at.week === s.week ? ' now' : ''}" onclick="uvCalOpenWeek('${at.season}',${at.week})"
      title="Open this week"><b>W${w}</b><span>${at.season === s.id ? `wk ${at.week}` : `S${M.seasonById(st, at.season).number}`}</span></div>`
      : `<div class="wk off"><b>W${w}</b><span>—</span></div>`;
    const evs = at ? st.events.filter(e => e.at.season === at.season && e.at.week === at.week).sort((a, b) => M.compareStamps(st, a.at, b.at)) : [];
    inMonth.push(...evs);
    const future = at && at.season === s.id && at.week >= s.week;
    const prep = at && at.season === s.id ? M.approaching(st, { season: at.season, week: at.week, day: 0 }) : [];
    const cells = M.DAYS.map((_, day) => {
      const here = evs.filter(e => (e.at.day == null ? 0 : e.at.day) === day);
      // shows whose night it is, not planned yet (from this week on)
      const open = future ? st.shows.filter(sh => sh.day === day && !evs.some(e => M.eventShows(st, e).includes(sh.id) && (e.kind === 'weekly' || e.at.day === day))) : [];
      const date = (w - 1) * 7 + day + 1;
      const add = future ? ` onclick="uvNewEvent(${at.week},${day})" title="Add an event on ${esc(dateText({ ...M.universeDate(st, at.season, at.week, day) }))}"` : '';
      return `<div class="uv-mday${here.some(M.isBigEvent) ? ' big' : ''}${future ? ' add' : ''}" data-date="${date}"${add}><span class="d">${date}</span>
        ${here.map(e => `<div class="uv-mev ${M.eventStatus(e)}${M.isBigEvent(e) ? ' big' : ''}" data-mev="${e.id}" style="--c:${M.isBigEvent(e) ? 'var(--uv-gold)' : showColor(st, e.showId)}"
          onclick="event.stopPropagation();uvOpenEvent('${e.id}')" title="${esc(`${e.name} — ${STATUS_LABEL[M.eventStatus(e)]}`)}">${M.isBigEvent(e) ? ICON.star : ''}<span>${esc(M.isBigEvent(e) ? e.name
          : shortName(M.showById(st, e.showId) || { id: '', name: e.name }))}</span></div>`).join('')}
        ${open.map(sh => `<div class="uv-mev open" style="--c:${showColor(st, sh.id)}" title="${esc(sh.name)} — not planned"><span>${esc(shortName(sh))}</span></div>`).join('')}
      </div>`;
    }).join('');
    const toward = prep.length ? `<div class="uv-mprep" title="${esc(prep.map(x => `Building to ${x.event.name}`).join(' · '))}">${ICON.star}${esc(prep.map(x => `${x.event.name} ${toGoText(x.weeks)}`).join(' · '))}</div>` : '';
    return `<div class="uv-mrow${at && at.season === s.id && at.week === s.week ? ' now' : ''}" data-mweek="${w}">${label}${cells}${toward}</div>`;
  };
  const grid = rows.map(row).join('');
  return `
    <div class="uv-weeknav" data-month="${cur.year}-${cur.month + 1}">
      <div class="uv-ic" onclick="uvCalMonth(-1)" title="Previous month">${ICON.left}</div>
      <div class="c"><div class="t">${esc(monthText(cur))}</div><div class="s">${isNow ? 'This month' : esc(relMonth(cur, now))} · 4 weeks · 28 days</div></div>
      <div class="uv-ic" onclick="uvCalMonth(1)" title="Following month">${ICON.right}</div>
    </div>
    ${isNow ? '' : `<div class="uv-back-now" onclick="uvCalThisMonth()">Back to this month (${esc(monthText(now))})</div>`}
    <div class="uv-month">
      <div class="uv-mrow hd"><div class="wk"></div>${NIGHT.map(n => `<div class="h">${n}</div>`).join('')}</div>
      ${grid}
    </div>
    <div class="uv-legend">${Object.entries(STATUS_LABEL).map(([k, lb]) => `<span><i class="uv-mev ${k}" style="--c:var(--uv-ink-2)"></i>${esc(lb)}</span>`).join('')}
      <span><i class="uv-mev big scheduled" style="--c:var(--uv-gold)"></i>PLE or special</span></div>
    ${section('This month', inMonth.length || null)}
    ${inMonth.length ? `<div class="uv-list">${inMonth.map(e => eventRow(st, e)).join('')}</div>`
      : '<div class="uv-none">Nothing on the calendar this month yet.</div>'}`;
}
function relMonth(cur, now) {
  const n = (cur.year - now.year) * 12 + (cur.month - now.month);
  return n === 1 ? 'Next month' : n === -1 ? 'Last month' : n > 0 ? `${n} months ahead` : `${-n} months ago`;
}

/** An event as a row: when, what, which shows, and where it stands. */
export function eventRow(st, e, sub = '') {
  return `<div class="uv-row uv-evrow" data-evrow="${e.id}" style="--c:${M.isBigEvent(e) ? 'var(--uv-gold)' : showColor(st, e.showId)}" onclick="uvOpenEvent('${e.id}')">
    <div class="uv-main"><div class="nm">${M.isBigEvent(e) ? `<span class="uv-star">${ICON.star}</span>` : ''}${esc(e.name)} ${statusBadge(e)}</div>
      <div class="sub">${esc(eventWhen(st, e))} · ${esc(eventShowsText(st, e))}${sub ? ` · ${esc(sub)}` : ''}</div></div>${ICON.right}</div>`;
}

// ================================================================ the events ahead

/** The premium live events and special events from this week on, with how each is being built toward. */
export function uvComingUp(st, n = 6) {
  const s = M.activeSeason(st);
  const evs = M.eventsIn(st, s.id).filter(e => M.isBigEvent(e) && e.at.week >= s.week && M.eventStatus(e) !== 'completed').slice(0, n);
  if (!evs.length) return '';
  return `${section('Events ahead', evs.length, 'var(--uv-gold)')}
    <div class="uv-list" data-ahead>${evs.map(e => eventRow(st, e, prepLine(st, e))).join('')}</div>`;
}
// where an event's preparation stands, in a few words
function prepLine(st, e) {
  const s = M.activeSeason(st);
  const weeks = e.at.week - s.week;
  if (M.eventStatus(e) !== 'scheduled') return '';
  if (!e.prep || !e.prep.weeks) return weeks <= 0 ? 'this week' : toGoText(weeks);
  if (weeks <= e.prep.weeks) return `${toGoText(weeks)} · being built toward`;
  return `${toGoText(weeks)} · build-up starts week ${e.at.week - e.prep.weeks}`;
}

// ================================================================ an event's page: building toward it

/** The preparation block on a big event's page: its phases, who has qualified, and what's booked toward it. */
export function uvPrepBlock(st, e) {
  if (!M.isBigEvent(e)) return '';
  const s = M.activeSeason(st);
  const status = M.eventStatus(e);
  const p = e.prep;
  const here = e.at.season === s.id;
  const matches = M.prepMatches(st, e.id);
  const phases = M.prepPhases(e);
  const wkOf = n => e.at.week - n;                                   // weeks to go -> the season's week
  const label = (a, b) => (a === b ? `Week ${a}` : `Weeks ${a}–${b}`);
  const stateOf = ph => (!here || status === 'completed' || s.week > wkOf(ph.to) ? 'done' : s.week >= wkOf(ph.from) ? 'now' : 'later');
  const head = !p || !p.weeks ? 'Not built toward: no preparation set'
    : status === 'completed' ? `Built toward over ${plural(p.weeks, 'week')}`
      : !here ? `Built toward over ${plural(p.weeks, 'week')}`
        : s.week >= wkOf(p.weeks) ? `Being built toward — ${toGoText(e.at.week - s.week)}`
          : `The build-up begins week ${wkOf(p.weeks)} (${dateText(M.universeDate(st, e.at.season, Math.max(1, wkOf(p.weeks))))}), ${plural(p.weeks, 'week')} ahead`;
  const qual = p && p.focus.includes('qualifiers') ? M.qualifiedFor(st, e.id) : [];
  const nameOf = id => (M.wrestlerById(st, id) || { name: '?' }).name;
  const byGender = g => qual.filter(q => (M.wrestlerById(st, q.wrestler) || {}).gender === g);
  return `${section('Building toward it', null, 'var(--uv-gold)')}
    <div class="uv-prep" data-prep="${e.id}">
      <div class="h">${esc(head)}</div>
      ${p && p.weeks ? `<div class="fine">${esc(p.focus.map(f => FOCUS_LABEL[f]).join(' · ') || 'Nothing in particular')}${p.focus.includes('qualifiers') ? ` · ${plural(p.spots, 'spot')} in each division` : ''}.
        The auto booker and the story director build toward it in these weeks; move the event and they move with it.</div>
      <div class="uv-phases">${phases.map(ph => `<div class="uv-phase ${stateOf(ph)}" data-phase="${ph.focus}"><span class="w">${esc(label(wkOf(ph.from), wkOf(ph.to)))}</span>
        <span class="x">${esc(ph.label)}</span><span class="s">${{ done: 'Done', now: 'Now', later: '' }[stateOf(ph)]}</span></div>`).join('')}</div>` : ''}
      ${p && p.focus.includes('qualifiers') ? `<div class="uv-sub">Qualified</div>${M.GENDERS.map(g => {
        const list = byGender(g);
        return `<div class="uv-qual" data-qual="${g}"><b>${esc(LABEL.gender[g])}</b> ${list.length} of ${p.spots}${list.length ? `: ${esc(list.map(q => nameOf(q.wrestler)).join(', '))}` : ''}</div>`;
      }).join('')}` : ''}
      ${matches.length ? `<div class="uv-sub">Booked toward it</div>${matches.map(({ event: on, match: m }) => `<div class="uv-prepm" data-prepm="${m.id}" onclick="uvOpenEvent('${on.id}')">
        <div class="l">${vsLine(st, m)}</div>
        <div class="d">${chip(PREP_LABEL[m.prep.kind] || m.prep.kind, 'gold')}${m.locked ? chip('Locked', 'lock') : ''} ${esc(on.name)} · ${esc(eventWhen(st, on))} · ${m.status === 'played' ? 'Result in' : 'Booked'}</div></div>`).join('')}` : ''}
      <div class="uv-page-acts">${here ? `<div class="uv-btn" onclick="uvReschedule('${e.id}')">${ICON.cal}Reschedule</div>` : ''}
        <div class="uv-btn" onclick="uvEventDetails('${e.id}')">${ICON.edit}Preparation</div></div>
    </div>`;
}

/** Lock a match on the card, or unlock it. */
export function uvLockMatch(eventId, matchId, on) {
  commit(st => M.setMatchLocked(st, eventId, matchId, !!on), on ? 'Locked — nothing automatic will change or remove it' : 'Unlocked');
}

// ================================================================ the date pickers

// a universe date picker: month, year, week of the month, night
function datePicker(d, set, { night = true } = {}) {
  return `<div class="uv-grid" style="margin-top:10px">
    ${field('Month', select(set('month'), options(MONTH_NAMES.map((n, i) => [String(i), n]), String(d.month))))}
    ${field('Year', `<input class="uv-in" type="number" min="1" max="9999" inputmode="numeric" value="${esc(d.year)}" onchange="${set('year')}">`)}
    ${field('Week of the month', select(set('week'), options([1, 2, 3, 4].map(n => [String(n), `Week ${n}`]), String(d.week))))}
    ${night ? field('Night', select(set('day'), options(M.DAYS.map((n, i) => [String(i), n]), String(d.day)))) : ''}
  </div>`;
}
// what a picked date is in the season: "Season week 12 · Sat 26 Mar 2026"
function dateNote(st, d) {
  const week = M.weekOfDate(st, d);
  if (week == null) return `${MONTH_NAMES[d.month]} ${d.year} is before ${M.activeSeason(st).name} began.`;
  const u = M.universeDate(st, M.activeSeason(st).id, week, d.day == null ? null : Number(d.day));
  return `${d.day == null ? '' : `${M.DAYS[d.day]} `}${dateText(u)} — week ${week} of ${M.activeSeason(st).name}.`;
}
// the preparation fields: how far ahead, what for, and how many spots
function prepFields(p, set, setFocus) {
  return `<div class="uv-grid" style="margin-top:10px">
      ${field('Build-up begins', select(set('weeks'), options(Array.from({ length: M.MAX_PREP_WEEKS + 1 }, (_, n) => [String(n), n ? `${plural(n, 'week')} ahead` : 'No build-up']), String(p.weeks))), 'wide')}
    </div>
    ${p.weeks ? `<div class="uv-checks">${M.PREP_FOCUS.map(f => `<label class="uv-check"><input type="checkbox" data-focus="${f}"${p.focus.includes(f) ? ' checked' : ''}
      onchange="${setFocus(f)}"><span>${esc(FOCUS_LABEL[f])}</span></label>`).join('')}</div>
    ${p.focus.includes('qualifiers') ? `<div class="uv-grid" style="margin-top:10px">${field('Qualifying spots in each division',
      `<input class="uv-in" type="number" min="1" max="${M.MAX_SPOTS}" inputmode="numeric" value="${esc(p.spots || '')}" onchange="${set('spots')}">`, 'wide')}</div>` : ''}` : ''}`;
}
// the shows taking part, as ticks
function showPicks(st, picked, handler) {
  return `<div class="uv-checks" data-shows>${st.shows.map(sh => `<label class="uv-check"><input type="checkbox" data-show="${sh.id}"${picked.includes(sh.id) ? ' checked' : ''}
    onchange="${handler(sh.id)}"><span><span class="uv-dot" style="--c:${showColor(st, sh.id)}"></span>${esc(sh.name)} <span class="uv-muted">${NIGHT[sh.day]}</span></span></label>`).join('')}</div>`;
}

// ================================================================ scheduling an event

let evDraft = null;

/** Add a premium live event or special event: its name, universe date, the shows taking part and how it's built toward. */
export function uvNewEvent(week = null, day = null) {
  const st = uni();
  const s = M.activeSeason(st);
  const u = M.universeDate(st, s.id, week == null || week === '' ? s.week : Number(week));
  evDraft = { kind: 'ple', name: '', year: u.year, month: u.month, week: u.week, day: day == null ? M.PLE_DAY : Number(day), dayTouched: day != null,
    shows: [], prep: { ...M.PREP_DEFAULTS.ple, focus: [...M.PREP_DEFAULTS.ple.focus] }, prepTouched: false, every: false };
  openSheet(newEventSheet);
}
function newEventSheet() {
  const st = uni();
  const d = evDraft;
  if (!d) return null;
  const set = k => `uvEvDraft('${k}',this.value)`;
  return {
    title: 'Schedule an event',
    body: `
      <div class="uv-seg" data-evkind>${['ple', 'special'].map(k => `<div class="${d.kind === k ? 'on' : ''}" data-v="${k}" onclick="uvEvDraft('kind','${k}')">${KIND_WORD[k]}</div>`).join('')}</div>
      ${field('Name', `<input id="uvEvName" class="uv-in" maxlength="60" value="${esc(d.name)}" placeholder="${d.kind === 'ple' ? 'e.g. SummerSlam' : 'e.g. Raw: Season Premiere'}"
        oninput="uvEvDraft('name',this.value,true)">`, 'wide')}
      <div class="uv-sub sh">Date</div>
      ${datePicker(d, set)}
      <div class="fine tight" data-datenote>${esc(dateNote(st, d))}</div>
      <div class="uv-sub sh">Shows taking part</div>
      ${showPicks(st, d.shows, id => `uvEvDraftShow('${id}',this.checked)`)}
      <div class="fine tight">${d.kind === 'ple' ? 'None ticked: every show. Their rosters make up the card.' : 'Tick at least one. For one show, it takes the place of that week’s episode on its night.'}</div>
      <div class="uv-sub sh">Preparation</div>
      ${prepFields(d.prep, k => `uvEvDraftPrep('${k}',this.value)`, f => `uvEvDraftFocus('${f}',this.checked)`)}
      <label class="uv-check"><input type="checkbox" id="uvEvEvery"${d.every ? ' checked' : ''} onchange="uvEvDraft('every',this.checked,true)">
        <span>Every year — an annual event, on this date each year</span></label>
      <div class="uv-btn pri full" onclick="uvCreateEvent()">Add to the calendar</div>`,
  };
}
export function uvEvDraft(k, v, quiet = false) {
  const d = evDraft;
  if (k === 'kind') {
    d.kind = v;
    if (!d.prepTouched) d.prep = { ...M.PREP_DEFAULTS[v], focus: [...M.PREP_DEFAULTS[v].focus] };
    if (!d.dayTouched) d.day = v === 'special' && d.shows.length ? M.showById(uni(), d.shows[0]).day : M.PLE_DAY;
  } else if (k === 'every') d.every = !!v;
  else if (k === 'name') d.name = v;
  else { d[k] = Number(v); if (k === 'day') d.dayTouched = true; }
  if (!quiet) paintSheet();
}
export function uvEvDraftShow(id, on) {
  const d = evDraft;
  d.shows = on ? [...new Set([...d.shows, id])] : d.shows.filter(x => x !== id);
  if (d.kind === 'special' && !d.dayTouched && d.shows.length) d.day = M.showById(uni(), d.shows[0]).day;
  paintSheet();
}
export function uvEvDraftPrep(k, v) { evDraft.prep[k] = Number(v); evDraft.prepTouched = true; paintSheet(); }
export function uvEvDraftFocus(f, on) {
  const p = evDraft.prep;
  p.focus = on ? [...new Set([...p.focus, f])] : p.focus.filter(x => x !== f);
  if (f === 'qualifiers' && on && !p.spots) p.spots = 4;
  evDraft.prepTouched = true;
  paintSheet();
}
export function uvCreateEvent() {
  const d = evDraft;
  const name = (document.getElementById('uvEvName') || { value: d.name }).value;
  let runs = [];
  const r = commit(st => {
    const ev = M.addEvent(st, { kind: d.kind, name, date: { year: d.year, month: d.month, week: d.week, day: d.day }, shows: d.shows, prep: d.prep });
    // every year: an annual event on the same date, which takes this one as its first
    if (d.every) M.addAnnual(st, { name: ev.name, kind: d.kind, month: d.month, week: d.week, day: d.day, shows: d.shows, prep: d.prep });
    runs = uvDirect(st);
    return ev;
  }, ev => `${ev.name} scheduled for ${eventWhen(uni(), ev)}${d.every ? ' — every year' : ''}${uvDirectedToast(runs)}`);
  if (r.ok) { closeSheet(); evDraft = null; window.uvOpenEvent(r.value.id); }
}

// ================================================================ editing a big event

/** The details of a premium live event or special event: name, kind, shows, preparation, notes - and the way to reschedule it. */
export function uvBigEventDetails(id) {
  openSheet(() => {
    const st = uni();
    const e = M.eventById(st, id);
    if (!e) return null;
    const set = k => `uvSetEvent('${id}','${k}',this.value)`;
    const p = e.prep || { weeks: 0, focus: [], spots: 0 };
    const rule = e.recurring && M.annualById(st, e.recurring);
    const here = e.at.season === M.activeSeason(st).id;
    return {
      title: 'Edit details',
      body: `
        <div class="uv-seg" data-evkind>${['ple', 'special'].map(k => `<div class="${e.kind === k ? 'on' : ''}" data-v="${k}" onclick="uvSetEvent('${id}','kind','${k}')">${KIND_WORD[k]}</div>`).join('')}</div>
        ${field('Name', `<input class="uv-in" maxlength="60" value="${esc(e.name)}" onchange="${set('name')}">`, 'wide')}
        <div class="uv-sub sh">Date</div>
        <div class="uv-datebox"><b>${esc(eventWhen(st, e, true))}</b><span>Week ${e.at.week} of ${esc(M.seasonById(st, e.at.season).name)}${rule ? ` · ${e.moved ? 'moved from its annual date' : 'its annual date'}` : ''}</span>
          ${here ? `<div class="uv-btn sm2" onclick="uvReschedule('${id}')">${ICON.cal}Reschedule</div>` : ''}</div>
        <div class="uv-sub sh">Shows taking part</div>
        ${showPicks(st, e.shows || [], sid => `uvEventShow('${id}','${sid}',this.checked)`)}
        <div class="fine tight">${e.kind === 'ple' ? 'None ticked: every show.' : 'A special event needs at least one show.'}</div>
        <div class="uv-sub sh">Preparation</div>
        ${prepFields(p, k => `uvEventPrep('${id}','${k}',this.value)`, f => `uvEventFocus('${id}','${f}',this.checked)`)}
        ${field('Notes', `<textarea class="uv-in" rows="2" maxlength="2000" onchange="${set('notes')}">${esc(e.notes)}</textarea>`, 'wide')}
        ${rule ? `<div class="fine tight">An annual event (${esc(rule.name)}): change every year’s in <span class="uv-link" onclick="uvAnnualSheet('${rule.id}')">its annual settings</span>.</div>` : ''}
        <div class="uv-btn full" onclick="uvCloseSheet()">Done</div>
        <div class="uv-btn bad full" onclick="uvDeleteEvent('${id}')">Delete this event</div>`,
    };
  });
}
export function uvEventShow(id, showId, on) {
  const e = M.eventById(uni(), id);
  const cur = e.shows || [];
  const shows = on ? [...new Set([...cur, showId])] : cur.filter(x => x !== showId);
  commit(st => M.updateEvent(st, id, { shows }), 'Saved');
}
const prepNews = r => (r.removed ? ` — ${plural(r.removed, 'match', 'matches')} booked toward it no longer fit and came off` : '');
export function uvEventPrep(id, k, v) {
  const e = M.eventById(uni(), id);
  const p = { ...(e.prep || { weeks: 0, focus: [], spots: 0 }) };
  p[k] = Number(v);
  if (k === 'weeks' && p.weeks && !p.focus.length) p.focus = [...M.PREP_DEFAULTS[e.kind].focus];
  commit(st => M.setEventPrep(st, id, p), r => `Preparation saved${prepNews(r)}`);
}
export function uvEventFocus(id, f, on) {
  const e = M.eventById(uni(), id);
  const p = { ...e.prep, focus: on ? [...new Set([...e.prep.focus, f])] : e.prep.focus.filter(x => x !== f) };
  if (f === 'qualifiers' && on && !p.spots) p.spots = 4;
  commit(st => M.setEventPrep(st, id, p), r => `Preparation saved${prepNews(r)}`);
}

// ================================================================ rescheduling

let rs = null;
/** Move an event to another universe date. Its card and results go with it; its preparation follows. */
export function uvReschedule(id) {
  const st = uni();
  const e = M.eventById(st, id);
  const u = M.stampDate(st, e.at);
  rs = { id, year: u.year, month: u.month, week: u.week, day: e.at.day == null ? M.defaultDay(st, e.kind, e.showId) : e.at.day };
  openSheet(() => {
    const s2 = uni();
    const ev = M.eventById(s2, rs.id);
    if (!ev) return null;
    const set = k => `uvRsSet('${k}',this.value)`;
    const kept = ev.matches.filter(m => m.status === 'played').length;
    const prep = M.prepMatches(s2, ev.id);
    const locked = prep.filter(x => x.match.locked && x.match.status === 'scheduled').length;
    return {
      title: `Reschedule ${ev.name}`,
      body: `
        <p class="uv-p">Now: <b>${esc(eventWhen(s2, ev, true))}</b> (week ${ev.at.week}). Pick its new universe date.</p>
        ${datePicker(rs, set)}
        <div class="fine tight" data-datenote>${esc(dateNote(s2, rs))}</div>
        <div class="uv-calc">
          <div><b>The card</b><span>${ev.matches.length ? `Its ${plural(ev.matches.length, 'match', 'matches')} go with it${kept ? ` — the ${plural(kept, 'result')} too, untouched` : ''}.` : 'Nothing booked on it yet.'}</span></div>
          ${M.isBigEvent(ev) ? `<div><b>Preparation</b><span>${ev.prep && ev.prep.weeks ? `Starts ${plural(ev.prep.weeks, 'week')} before the new date.` : 'None set.'}
            ${prep.length ? ` Matches booked toward it that no longer fit come off — never one with a result, one on an earlier week’s show${locked ? `, or the ${plural(locked, 'locked match', 'locked matches')}` : ', or one you’ve locked'}.` : ''}</span></div>` : ''}
        </div>
        <div class="uv-btn pri full" onclick="uvRescheduleGo()">${ICON.cal}Move it</div>`,
    };
  });
}
export function uvRsSet(k, v) { rs[k] = Number(v); paintSheet(); }
export function uvRescheduleGo() {
  const { id, year, month, week, day } = rs;
  const r = commit(st => M.moveEvent(st, id, { date: { year, month, week }, day }),
    x => `${x.event.name} moved to ${eventWhen(uni(), x.event)}${prepNews(x)}`);
  if (r.ok) closeSheet();
}

// ================================================================ the calendar's settings

export function uvOpenCalendar() { pushPage('calendar', 'all'); }

/** The universe calendar's page: when it began, each show's night, and the annual events. */
export function uvCalendarPage() {
  const st = uni();
  const s = M.activeSeason(st);
  const cal = st.calendar;
  const now = nowDate(st);
  const rules = [...st.annual].sort((a, b) => a.month - b.month || a.week - b.week || a.day - b.day || a.name.localeCompare(b.name));
  const first = M.universeDate(st, st.seasons.slice().sort((a, b) => a.number - b.number)[0].id, 1);
  return {
    title: 'Universe calendar',
    body: `
      <p class="uv-p uv-inset-p">Your universe keeps its own calendar: twelve months of exactly <b>four weeks</b>, seven days a week —
        28 days a month, 48 weeks a year, whatever the real calendar says. Every week of every season is a week of a month.</p>
      ${section('When it began', null)}
      <div class="uv-calset">
        <div class="uv-grid">
          ${field('Month', select(`uvCalStart('month',this.value)`, options(MONTH_NAMES.map((n, i) => [String(i), n]), String(cal.month)), ' id="uvCalMonth"'))}
          ${field('Year', `<input id="uvCalYear" class="uv-in" type="number" min="1" max="9999" inputmode="numeric" value="${cal.year}" onchange="uvCalStart('year',this.value)">`)}
        </div>
        <div class="fine" data-calnow>Season 1 began in ${esc(dateText(first))}. This week — ${esc(s.name)}, week ${s.week} — is ${esc(dateText(now))}.
          Changing it relabels every week; nothing on record moves.</div>
      </div>
      ${section('Show nights', st.shows.length)}
      <div class="uv-list">${st.shows.map(sh => `<div class="uv-row" data-shownight="${sh.id}" style="--c:${showColor(st, sh.id)}">
        <div class="uv-main"><div class="nm">${esc(sh.name)}</div><div class="sub">Every week on ${esc(M.DAYS[sh.day])}</div></div>
        <select class="uv-in sm" onchange="uvSetShowNight('${sh.id}',this.value)">${options(M.DAYS.map((n, i) => [String(i), n]), String(sh.day))}</select></div>`).join('')}</div>
      <p class="uv-p uv-inset-p fine">A new night applies from this week on: episodes still to come with no results move to it, and so does
        the show’s Last Stand. Nothing with a result moves.</p>
      ${section('Annual events', rules.length, 'var(--uv-gold)')}
      <div class="uv-list">${rules.map(r => `<div class="uv-row${r.on ? '' : ' dim'}" data-annual="${r.key || r.id}" onclick="uvAnnualSheet('${r.id}')">
        <span class="uv-av sq gold">${ICON.star}</span>
        <div class="uv-main"><div class="nm">${esc(r.name)} ${r.on ? '' : chip('Off', 'warn')}</div>
          <div class="sub">${esc(`${MONTH_NAMES[r.month]} · week ${r.week} · ${M.DAYS[r.day]} · ${KIND_WORD[r.kind]} · ${r.shows.length ? M.showNamesOf(st, r.shows, '&') : 'All shows'}`)}</div></div>${ICON.right}</div>`).join('')}
        <div class="uv-row" onclick="uvAnnualSheet('')"><span class="uv-av sq">${ICON.plus}</span><div class="uv-main"><div class="nm">Add an annual event</div>
          <div class="sub">Any event on the same date every year</div></div>${ICON.right}</div></div>
      <p class="uv-p uv-inset-p fine">Each year’s goes on the calendar as the year comes round (up to a year ahead), as an ordinary event:
        its own card, results and build-up. Reschedule one year’s and the others stay put; change the annual date and the years still
        to come follow it, unless you moved them; delete one year’s and it doesn’t come back.</p>`,
  };
}
export function uvCalStart(k, v) {
  const cal = uni().calendar;
  const next = { ...cal, [k]: Number(v) };
  commit(st => M.setCalendar(st, next), moved => `The universe began in ${MONTH_NAMES[next.month]} ${next.year}${moved.length ? ` — ${plural(moved.length, 'annual event')} put on the calendar or moved` : ''}`);
}
export function uvSetShowNight(id, day) {
  commit(st => M.setShowDay(st, id, Number(day)), n => `${M.showById(uni(), id).name} is on ${M.DAYS[Number(day)]}s now${n ? ` — ${plural(n, 'show')} moved` : ''}`);
}

// ---------------------------------------------------------------- an annual event

let an = null;
export function uvAnnualSheet(id) {
  const st = uni();
  const r = id ? M.annualById(st, id) : null;
  an = r ? { id: r.id, name: r.name, kind: r.kind, month: r.month, week: r.week, day: r.day, shows: [...r.shows], prep: { ...r.prep, focus: [...r.prep.focus] }, on: r.on }
    : { id: '', name: '', kind: 'ple', month: 0, week: 1, day: M.PLE_DAY, shows: [], prep: { ...M.PREP_DEFAULTS.ple, focus: [...M.PREP_DEFAULTS.ple.focus] }, on: true };
  openSheet(() => {
    const s2 = uni();
    const d = an;
    if (!d) return null;
    const set = k => `uvAnSet('${k}',this.value)`;
    const rule = d.id ? M.annualById(s2, d.id) : null;
    const years = rule ? s2.events.filter(e => e.recurring === rule.id).sort((a, b) => M.compareStamps(s2, a.at, b.at)) : [];
    return {
      title: d.id ? d.name || 'Annual event' : 'Add an annual event',
      body: `
        <div class="uv-seg" data-ankind>${['ple', 'special'].map(k => `<div class="${d.kind === k ? 'on' : ''}" data-v="${k}" onclick="uvAnSet('kind','${k}')">${KIND_WORD[k]}</div>`).join('')}</div>
        ${field('Name', `<input id="uvAnName" class="uv-in" maxlength="60" value="${esc(d.name)}" oninput="uvAnSet('name',this.value,true)">`, 'wide')}
        <div class="uv-sub sh">Every year on</div>
        <div class="uv-grid" style="margin-top:10px">
          ${field('Month', select(set('month'), options(MONTH_NAMES.map((n, i) => [String(i), n]), String(d.month))))}
          ${field('Week of the month', select(set('week'), options([1, 2, 3, 4].map(n => [String(n), `Week ${n}`]), String(d.week))))}
          ${field('Night', select(set('day'), options(M.DAYS.map((n, i) => [String(i), n]), String(d.day))), 'wide')}
        </div>
        <div class="uv-sub sh">Shows taking part</div>
        ${showPicks(s2, d.shows, sid => `uvAnShow('${sid}',this.checked)`)}
        <div class="uv-sub sh">Preparation</div>
        ${prepFields(d.prep, k => `uvAnPrep('${k}',this.value)`, f => `uvAnFocus('${f}',this.checked)`)}
        <label class="uv-check"><input type="checkbox"${d.on ? ' checked' : ''} onchange="uvAnSet('on',this.checked,true)"><span>On the calendar every year</span></label>
        ${years.length ? `<div class="uv-sub sh">On the calendar</div>${years.map(e => eventRow(s2, e)).join('')}` : ''}
        <div class="uv-btn pri full" onclick="uvAnSave()">${d.id ? 'Save' : 'Add it'}</div>
        ${d.id ? `<div class="uv-btn bad full" onclick="uvAnDelete()">Stop it recurring</div>` : ''}`,
    };
  });
}
export function uvAnSet(k, v, quiet = false) {
  if (k === 'name') an.name = v;
  else if (k === 'on') an.on = !!v;
  else if (k === 'kind') an.kind = v;
  else an[k] = Number(v);
  if (!quiet) paintSheet();
}
export function uvAnShow(id, on) { an.shows = on ? [...new Set([...an.shows, id])] : an.shows.filter(x => x !== id); paintSheet(); }
export function uvAnPrep(k, v) { an.prep[k] = Number(v); paintSheet(); }
export function uvAnFocus(f, on) {
  an.prep.focus = on ? [...new Set([...an.prep.focus, f])] : an.prep.focus.filter(x => x !== f);
  if (f === 'qualifiers' && on && !an.prep.spots) an.prep.spots = 4;
  paintSheet();
}
export function uvAnSave() {
  const d = an;
  const name = (document.getElementById('uvAnName') || { value: d.name }).value;
  const input = { name, kind: d.kind, month: d.month, week: d.week, day: d.day, shows: d.shows, prep: d.prep, on: d.on };
  const r = commit(st => (d.id ? M.updateAnnual(st, d.id, input) : M.addAnnual(st, input)), rule => `${rule.name} ${d.id ? 'saved' : 'added'} — every year, ${MONTH_NAMES[rule.month]} week ${rule.week}`);
  if (r.ok) { closeSheet(); an = null; }
}
export function uvAnDelete() {
  const rule = M.annualById(uni(), an.id);
  confirmThen(`Stop ${rule.name} recurring?`, 'Each year already on the calendar stays, as a one-off event — delete those on their own pages if you don’t want them.',
    'Stop it', () => { if (commit(st => M.deleteAnnual(st, rule.id), `${rule.name} no longer recurs`).ok) { closeSheet(); an = null; } });
}
