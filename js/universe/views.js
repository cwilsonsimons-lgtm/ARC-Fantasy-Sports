// WWE Universe — the tabs: Calendar, Roster, Teams, Titles, History. (Rankings
// is in ranks.js.)
//
// Lists only. Tapping a row opens its page: a show's card (card.js) or a
// profile (pages.js). The roster also has a select mode for moving several
// wrestlers between shows at once.
import {
  activeSeason, byName, calendarDate, cardStatus, currentReign, eventsIn, holderName, reignWeeks, resultsHistory,
  rosterCounts, rosterOf, seasonById, teamById, teamRecord, teamShows, timeline, titleById, titlesHeldBy,
  titlesOfWrestler, wrestlerById,
} from './model.js';
import {
  ICON, LABEL, NIGHT, avatar, chip, empty, esc, eventWhen, fallLine, fmtRec, isoText, kindChip, matchLine, section,
  showColor, showDot, showName, stampLabel, tag, weeksText,
} from './ui.js';
import { refresh, uni } from './app.js';
import { uvRankFollow } from './ranks.js';
import { uvTransitionSummary } from './relegation.js';
import { uvRelationsView } from './personality.js';

// ---------------------------------------------------------------- calendar
//
// The week at a glance: each show on its night, planned or not, and where
// its card stands. The season's clock (the current week) is only moved by
// Next week / Back a week; browsing other weeks here never moves it.

let calWeek = null;          // the week on screen; null follows the current week

const CARD_TEXT = {
  empty: () => 'Planned — nothing booked yet',
  booked: c => `${c.total} booked · no results yet`,
  partial: c => `${c.played} of ${c.total} results in`,
  complete: c => `${c.total} result${c.total === 1 ? '' : 's'} in`,
};
const cardText = c => CARD_TEXT[c.state](c);

function weekRange(st, seasonId, week) {
  const a = calendarDate(st, seasonId, week, 0);
  return a ? `${isoText(a, false)} – ${isoText(calendarDate(st, seasonId, week, 6))}` : '';
}

export function uvCalendarView() {
  const st = uni();
  const s = activeSeason(st);
  const week = calWeek || s.week;
  const off = week - s.week;
  const rel = off === 0 ? 'This week' : off === 1 ? 'Next week' : off === -1 ? 'Last week'
    : off > 0 ? `${off} weeks ahead` : `${-off} weeks ago`;
  const range = weekRange(st, s.id, s.week);
  const next = Math.max(...st.seasons.map(x => x.number)) + 1;

  const card = `<div class="uv-card">
    <div class="uv-season">
      <div><div class="k">${esc(s.name)}</div><div class="v">Week ${s.week}</div>${range ? `<div class="s">${esc(range)}</div>` : ''}</div>
      <div class="uv-step">
        <div class="uv-ic" onclick="uvStepWeek(-1)" title="Back a week">${ICON.left}</div>
        <div class="uv-btn" onclick="uvStepWeek(1)">Next week${ICON.right}</div>
      </div>
    </div>
    ${transitionRows(st, s)}
    <div class="uv-card-f"><span onclick="uvSeasonDates('${s.id}')">${s.start ? 'Dates' : 'Set dates'}</span>
      <span onclick="uvRenameSeason('${s.id}')">Rename</span><span onclick="uvNextSeason()">Start Season ${next}…</span></div>
  </div>`;

  // this week's episodes, and a row to plan each show that has none yet
  const evs = eventsIn(st, s.id).filter(e => e.at.week === week);
  const rows = evs.map(e => ({ day: e.at.day, e }));
  st.shows.forEach(sh => { if (!evs.some(e => e.kind === 'weekly' && e.showId === sh.id)) rows.push({ day: sh.day, show: sh }); });
  rows.sort((a, b) => (a.day ?? 9) - (b.day ?? 9));     // stable: a night's episodes before its unplanned shows

  const wr = weekRange(st, s.id, week);
  return card + `
    <div class="uv-weeknav">
      <div class="uv-ic" onclick="uvCalWeek(-1)" title="Previous week">${ICON.left}</div>
      <div class="c"><div class="t">Week ${week}</div><div class="s">${esc(rel)}${wr ? ` · ${esc(wr)}` : ''}</div></div>
      <div class="uv-ic" onclick="uvCalWeek(1)" title="Following week">${ICON.right}</div>
    </div>
    ${off ? `<div class="uv-back-now" onclick="uvCalGo(${s.week})">Back to this week (week ${s.week})</div>` : ''}
    <div class="uv-nights">${rows.map(r => nightRow(st, s, week, r)).join('')}</div>
    <div class="uv-addrow" onclick="uvNewPle(${week})">${ICON.star}Add a premium live event to week ${week}</div>
    ${seasonGrid(st, s, week)}`;
}

// The season transition, on the season card: this season's and last season's
// while they're recent, or - once WrestleMania is on the calendar - the way in.
function transitionRows(st, s) {
  const recent = st.transitions.filter(t => {
    const n = seasonById(st, t.season).number;
    return n === s.number || n === s.number - 1;
  });
  const row = (onclick, head, sub) => `<div class="uv-card-row" onclick="${onclick}">${ICON.move}<div><b>${esc(head)}</b>
    <span>${esc(sub)}</span></div>${ICON.right}</div>`;
  const rows = recent.map(t => row(`uvOpenTransition('${t.id}')`, `${seasonById(st, t.season).name} transition · relegation`,
    uvTransitionSummary(st, t).map(x => `${x.label}: ${x.text}`).join(' · ')));
  const mania = !recent.some(t => t.season === s.id) && eventsIn(st, s.id).filter(e => e.kind === 'ple' && /wrestlemania/i.test(e.name)).pop();
  if (mania) rows.push(row(`uvStartTransitionAt('${mania.id}')`, `${mania.name} ends the season`, 'Start the season transition: relegation to NXT'));
  return rows.join('');
}

function nightRow(st, s, week, r) {
  const iso = r.day == null ? null : calendarDate(st, s.id, week, r.day);
  const dt = `<div class="dt"><b>${r.day == null ? '—' : NIGHT[r.day]}</b>${iso ? `<span>${isoText(iso, false)}</span>` : ''}</div>`;
  if (r.show) {
    return `<div class="uv-night open" style="--c:${showColor(st, r.show.id)}" data-plan="${r.show.id}">${dt}
      <div class="uv-main"><div class="nm">${esc(r.show.name)}</div><div class="sub">Not planned</div></div>
      <div class="uv-btn sm2" onclick="uvPlanShow('${r.show.id}',${week})">${ICON.plus}Plan</div></div>`;
  }
  const e = r.e, c = cardStatus(e);
  return `<div class="uv-night" style="--c:${showColor(st, e.showId)}" data-ev="${e.id}" onclick="uvOpenEvent('${e.id}')">${dt}
    <div class="uv-main"><div class="nm">${e.kind === 'ple' ? `<span class="uv-star">${ICON.star}</span>` : ''}${esc(e.name)}</div>
      <div class="sub"><span class="uv-state ${c.state}"></span>${esc(cardText(c))}</div></div>
    <span class="uv-chev">${ICON.right}</span></div>`;
}

const SHORT = { raw: 'Raw', smackdown: 'SD', dynamite: 'Dyn', nxt: 'NXT' };

// Every week of the season so far, one square per show: how far along each card is.
function seasonGrid(st, s, week) {
  const evs = eventsIn(st, s.id);
  if (!evs.length) return '';
  const last = Math.max(s.week, week, ...evs.map(e => e.at.week));
  const cols = [...st.shows.map(sh => ({ key: sh.id, label: SHORT[sh.id] || sh.name.slice(0, 3), color: showColor(st, sh.id) })),
    { key: 'ple', label: 'PLE', color: 'var(--uv-gold)' }];
  const cell = (w, col) => {
    const here = evs.filter(e => e.at.week === w && (col.key === 'ple' ? e.kind === 'ple' : e.kind === 'weekly' && e.showId === col.key));
    if (!here.length) return '<span class="uv-cell"></span>';
    const c = cardStatus({ matches: here.flatMap(e => e.matches) });
    return `<span class="uv-cell ${c.state}" style="--c:${col.color}"></span>`;
  };
  let rows = '';
  for (let w = last; w >= 1; w--) {
    rows += `<div class="uv-gr${w === week ? ' on' : ''}${w === s.week ? ' now' : ''}" onclick="uvCalGo(${w})">
      <span class="w">W${w}</span>${cols.map(col => cell(w, col)).join('')}</div>`;
  }
  return `${section('Season at a glance', null)}
    <div class="uv-grid-wk" style="--n:${cols.length}">
      <div class="uv-gr hd"><span class="w"></span>${cols.map(c => `<span class="h">${esc(c.label)}</span>`).join('')}</div>
      ${rows}
    </div>
    <div class="uv-legend"><span><i class="uv-cell empty"></i>Planned</span><span><i class="uv-cell booked"></i>Booked</span>
      <span><i class="uv-cell partial"></i>Some results</span><span><i class="uv-cell complete"></i>All results in</span></div>`;
}

export function uvCalWeek(d) {
  const s = activeSeason(uni());
  calWeek = Math.max(1, Math.min(999, (calWeek || s.week) + d));
  if (calWeek === s.week) calWeek = null;
  refresh();
}
export function uvCalGo(w) {
  calWeek = w === activeSeason(uni()).week ? null : w;
  refresh();
  const sc = document.getElementById('uvScroll');
  if (sc) sc.scrollTop = 0;
}
/** When the clock moves, the calendar goes with it. */
export function uvCalFollow() { calWeek = null; }


// ---------------------------------------------------------------- roster

let rosterShow = 'all';      // 'all', a show id, or '' for unassigned
let rosterMode = 'wrestlers';  // or 'relations'
let rosterQ = '';
let picking = null;          // a Set of wrestler ids while selecting, else null

export function uvRosterShow() { return rosterShow === 'all' ? '' : rosterShow; }

export function uvRosterView() {
  const seg = (k, lb) => `<div class="${rosterMode === k ? 'on' : ''}" data-mode="${k}" onclick="uvRosterMode('${k}')">${lb}</div>`;
  const top = `<div class="uv-seg uv-seg-page">${seg('wrestlers', 'Wrestlers')}${seg('relations', 'Relationships')}</div>`;
  if (rosterMode === 'relations') return top + uvRelationsView();
  const st = uni();
  const counts = rosterCounts(st);
  const pill = (k, label, n, color) => `<div class="uv-pill${rosterShow === k ? ' on' : ''}" onclick="uvRosterFilter('${k}')">`
    + `${color ? `<span class="uv-dot" style="--c:${color}"></span>` : ''}${esc(label)}<span class="n">${n}</span></div>`;
  return `${top}
    <div class="uv-bar">
      <div class="uv-search">${ICON.search}<input id="uvQ" type="search" placeholder="Search wrestlers"
        autocomplete="off" spellcheck="false" value="${esc(rosterQ)}" oninput="uvRosterSearch(this.value)"></div>
      ${st.wrestlers.length ? `<div class="uv-btn${picking ? ' on' : ''}" onclick="uvToggleSelect()">${picking ? 'Cancel' : 'Select'}</div>` : ''}
      ${picking ? '' : `<div class="uv-btn pri" onclick="uvAddWrestler()">${ICON.plus}Add</div>`}
    </div>
    <div class="uv-pills">
      ${pill('all', 'All', st.wrestlers.length)}
      ${st.shows.map(s => pill(s.id, s.name, counts[s.id], s.color)).join('')}
      ${pill('', 'Unassigned', counts[''])}
    </div>
    <div id="uvRosterList">${rosterList()}</div>
    ${picking ? `<div class="uv-selbar"><span>${picking.size ? `${picking.size} selected` : 'Tap wrestlers to select them'}</span>
      <div class="uv-btn pri${picking.size ? '' : ' off'}" onclick="uvMoveSelected()">${ICON.move}Move to…</div></div>` : ''}`;
}

function rosterList() {
  const st = uni();
  if (!st.wrestlers.length) {
    return empty(ICON.user, 'No wrestlers yet',
      'Add your universe roster one at a time, or paste a whole list at once. Wrestlers from WWE, AEW and NXT can go on any show.',
      `<div class="uv-btn pri" onclick="uvAddWrestler()">${ICON.plus}Add wrestlers</div>`);
  }
  const q = rosterQ.trim().toLowerCase();
  const groups = rosterShow === 'all' ? [...st.shows.map(s => s.id), ''] : [rosterShow];
  const html = groups.map(id => {
    const list = rosterOf(st, id || null).filter(w => !q || w.name.toLowerCase().includes(q));
    if (q && !list.length) return '';
    const head = section(showName(st, id || null), list.length, id ? showColor(st, id) : null);
    const rows = list.length ? list.map(w => wrestlerRow(st, w)).join('')
      : `<div class="uv-none">Nobody on ${esc(showName(st, id || null))}.</div>`;
    return head + rows;
  }).join('');
  return html || `<div class="uv-none">No wrestler matches <b>${esc(rosterQ)}</b>.</div>`;
}

function wrestlerRow(st, w) {
  const held = titlesOfWrestler(st, w.id);
  const tags = [tag(w.origin)];
  if (w.gender === 'female') tags.push(tag('F'));
  if (w.alignment) tags.push(tag(LABEL.alignment[w.alignment], w.alignment));
  if (w.status === 'injured') tags.push(tag('Injured', 'inj'));
  const on = picking && picking.has(w.id);
  return `<div class="uv-row${on ? ' picked' : ''}" data-w="${w.id}" onclick="${picking ? `uvPick('${w.id}')` : `uvOpenWrestler('${w.id}')`}">
    ${picking ? `<span class="uv-tick">${on ? ICON.check : ''}</span>` : ''}
    ${avatar(st, w)}
    <div class="uv-main"><div class="nm">${esc(w.name)}</div><div class="sub">${tags.join('')}</div></div>
    ${held.length ? `<span class="uv-belt" title="${esc(held.map(h => h.title.name).join(', '))}">${ICON.belt}${held.length > 1 ? held.length : ''}</span>` : ''}
    ${picking ? '' : `<span class="uv-chev">${ICON.right}</span>`}
  </div>`;
}

export function uvToggleSelect() { picking = picking ? null : new Set(); refresh(); }
export function uvPick(id) {
  if (!picking) return;
  if (picking.has(id)) picking.delete(id); else picking.add(id);
  refresh();
}
export function uvMoveSelected() {
  if (picking && picking.size) window.uvMoveWrestlers([...picking]);
}
/** After a move from select mode, leave select mode - and show the list without it. */
export function uvEndSelect() {
  if (!picking) return;
  picking = null;
  refresh();
}

export function uvRosterMode(k) { rosterMode = k; picking = null; refresh(); }
export function uvRosterFilter(k) {
  rosterShow = k;
  refresh();
}
/** Repaint the rows only, so the search box keeps focus while typing. */
export function uvRosterSearch(v) {
  rosterQ = v;
  const el = document.getElementById('uvRosterList');
  if (el) el.innerHTML = rosterList();
}

// ---------------------------------------------------------------- tag teams

export function uvTeamsView() {
  const st = uni();
  const bar = `<div class="uv-bar"><div class="uv-bar-t">Tag teams</div>
    <div class="uv-btn pri" onclick="uvNewTeam()">${ICON.plus}New team</div></div>`;
  if (!st.teams.length) {
    return bar + empty(ICON.team, 'No tag teams yet',
      'A team is two or more wrestlers. They can be on different shows, and a wrestler can be on more than one team.');
  }
  const active = st.teams.filter(t => t.active).sort(byName);
  const gone = st.teams.filter(t => !t.active).sort(byName);
  return bar
    + section('Active', active.length) + (active.map(t => teamRow(st, t)).join('') || '<div class="uv-none">No active teams.</div>')
    + (gone.length ? section('Disbanded', gone.length) + gone.map(t => teamRow(st, t)).join('') : '');
}

function teamRow(st, t) {
  const shows = teamShows(st, t);
  const held = titlesHeldBy(st, { type: 'team', id: t.id });
  const members = t.members.map(id => (wrestlerById(st, id) || { name: '?' }).name).join(' & ');
  return `<div class="uv-row${t.active ? '' : ' dim'}" onclick="uvOpenTeam('${t.id}')">
    <span class="uv-av sq">${ICON.team}</span>
    <div class="uv-main"><div class="nm">${esc(t.name)}${held.length ? ` <span class="uv-belt in">${ICON.belt}</span>` : ''}</div>
      <div class="sub">${shows.map(id => showDot(st, id)).join('')}${esc(members)}${shows.length > 1 ? tag('Split', 'warn') : ''}</div></div>
    <div class="uv-champ"><div class="h">${fmtRec(teamRecord(st, t.id))}</div><div class="s">W–L–D</div></div>
  </div>`;
}

// ---------------------------------------------------------------- titles

export function uvTitlesView() {
  const st = uni();
  const bar = `<div class="uv-bar"><div class="uv-bar-t">Championships</div>
    <div class="uv-btn pri" onclick="uvNewTitle()">${ICON.plus}New title</div></div>`;
  if (!st.titles.length) {
    return bar + empty(ICON.belt, 'No championships yet',
      'Add the titles your universe uses. Each can belong to one show or to none, and be singles or tag team.');
  }
  const live = st.titles.filter(t => t.active);
  const groups = [...st.shows.map(s => s.id), null];
  const html = groups.map(id => {
    const list = live.filter(t => t.showId === id);
    if (!list.length) return '';
    return section(showName(st, id, 'No brand'), list.length, id ? showColor(st, id) : null)
      + list.map(t => titleRow(st, t)).join('');
  }).join('');
  const retired = st.titles.filter(t => !t.active);
  return bar + html + (retired.length ? section('Retired', retired.length) + retired.map(t => titleRow(st, t)).join('') : '');
}

function titleRow(st, t) {
  const r = currentReign(st, t.id);
  return `<div class="uv-row${t.active ? '' : ' dim'}" onclick="uvOpenTitle('${t.id}')">
    <span class="uv-av sq gold" style="--c:${showColor(st, t.showId)}">${ICON.belt}</span>
    <div class="uv-main"><div class="nm">${esc(t.name)}</div>
      <div class="sub">${esc(LABEL.division[t.division])} · ${esc(LABEL.kind[t.kind])}</div></div>
    <div class="uv-champ">${r ? `<div class="h">${esc(holderName(st, r.holder))}</div><div class="s">${weeksText(reignWeeks(st, r))} · since ${stampLabel(st, r.start)}</div>`
      : `<div class="h vac">Vacant</div>`}</div>
  </div>`;
}

// ---------------------------------------------------------------- history
//
// Two ways through the past, newest first: every result show by show (filter
// by season and show), or everything that happened - results, title changes,
// moves, team changes - on one timeline.

let viewSeason = null;       // null follows the active season
let histMode = 'results';    // 'results' or 'all'
let histShow = '';           // '' for every show, a show id, or 'ple'
let eventsShown = 12;
let historyShown = 40;

export function uvHistoryView() {
  const st = uni();
  const cur = activeSeason(st);
  const seasonId = (viewSeason && seasonById(st, viewSeason)) ? viewSeason : cur.id;
  const seg = (k, lb) => `<div class="${histMode === k ? 'on' : ''}" onclick="uvHistMode('${k}')">${lb}</div>`;
  const pills = st.seasons.length > 1 ? `<div class="uv-pills">${[...st.seasons].reverse().map(s =>
    `<div class="uv-pill${s.id === seasonId ? ' on' : ''}" onclick="uvViewSeason('${s.id}')">${esc(s.name)}</div>`).join('')}</div>` : '';
  return `<div class="uv-seg uv-seg-page">${seg('results', 'Results')}${seg('all', 'Everything')}</div>
    ${pills}
    ${histMode === 'results' ? resultsView(st, seasonId) : everythingView(st, seasonId)}`;
}

function resultsView(st, seasonId) {
  const pill = (k, label, color) => `<div class="uv-pill${histShow === k ? ' on' : ''}" onclick="uvHistShow('${k}')">`
    + `${color ? `<span class="uv-dot" style="--c:${color}"></span>` : ''}${esc(label)}</div>`;
  const shows = `<div class="uv-pills">${pill('', 'All shows')}${st.shows.map(s => pill(s.id, s.name, showColor(st, s.id))).join('')}${pill('ple', 'PLEs')}</div>`;
  const rows = resultsHistory(st, { seasonId, showId: histShow || undefined });
  const groups = [];
  rows.forEach(x => {
    const g = groups[groups.length - 1];
    if (g && g.event === x.event) g.rows.push(x); else groups.push({ event: x.event, rows: [x] });
  });
  if (!groups.length) {
    return shows + empty(ICON.list, 'No results yet',
      histShow ? 'Nothing entered for this show in this season.'
        : 'Plan a show on the Calendar, book its matches, then enter each result after the CPU plays it in WWE 2K25.');
  }
  let lastWeek = null;
  const html = groups.slice(0, eventsShown).map(g => {
    const head = g.event.at.week !== lastWeek ? `<div class="uv-wk">Week ${g.event.at.week}</div>` : '';
    lastWeek = g.event.at.week;
    return head + eventBlock(st, g);
  }).join('');
  const n = rows.length;
  return shows + `<div class="uv-count">${n} result${n === 1 ? '' : 's'} on ${groups.length} show${groups.length === 1 ? '' : 's'}</div>`
    + html + (groups.length > eventsShown ? `<div class="uv-more" onclick="uvMoreResults()">Show older shows (${groups.length - eventsShown})</div>` : '');
}

function eventBlock(st, g) {
  const e = g.event, c = cardStatus(e);
  const lines = g.rows.map(x => {
    const m = x.match;
    const t = m.titleId && titleById(st, m.titleId);
    const won = st.reigns.some(r => r.matchId === m.id);
    const bits = [m.finish && LABEL.finish[m.finish], fallLine(st, m)].filter(Boolean).join(' · ');
    return `<div class="uv-hm" data-m="${m.id}" onclick="uvOpenEvent('${e.id}')"><span class="n">${x.n}</span>
      <div class="b"><div class="l">${matchLine(st, m)}</div>
        <div class="uv-chips">${kindChip(m)}${t ? chip(won ? `${t.name} · new champion` : t.name, 'gold') : ''}${m.stip ? chip(m.stip) : ''}</div>
        ${bits ? `<div class="d">${bits}</div>` : ''}${m.notes ? `<div class="d nt">${esc(m.notes)}</div>` : ''}</div></div>`;
  }).join('');
  return `<div class="uv-hev" style="--c:${showColor(st, e.showId)}" data-ev="${e.id}" onclick="uvOpenEvent('${e.id}')">
      <div class="uv-main"><div class="nm">${e.kind === 'ple' ? `<span class="uv-star">${ICON.star}</span>` : ''}${esc(e.name)}</div>
        <div class="sub">${esc(eventWhen(st, e))} · ${esc(e.showId ? showName(st, e.showId) : 'All shows')}${c.booked ? ` · ${c.booked} still to enter` : ''}</div></div>
      <span class="uv-chev">${ICON.right}</span></div>
    <div class="uv-hms">${lines}</div>`;
}

function everythingView(st, seasonId) {
  // an event is history once it has a result; planned and booked ones live on the calendar
  const tl = timeline(st).filter(e => e.season === seasonId
    && (e.type !== 'event' || e.rec.matches.some(m => m.status === 'played')));
  if (!tl.length) return empty(ICON.list, 'Nothing yet', 'Results, title changes, moves and team changes show up here as they happen.');
  const entries = tl.slice(0, historyShown).map(e => `<div class="uv-tl"><span class="w">${stampLabel(st, e)}</span>`
    + `<span class="x">${timelineText(st, e)}</span></div>`).join('');
  return `<div class="uv-tls">${entries}</div>
    ${tl.length > historyShown ? `<div class="uv-more" onclick="uvMoreHistory()">Show more (${tl.length - historyShown})</div>` : ''}`;
}

function timelineText(st, e) {
  const r = e.rec;
  const w = id => `<b>${esc((wrestlerById(st, id) || { name: '(deleted)' }).name)}</b>`;
  const show = id => esc(showName(st, id));
  switch (e.type) {
    case 'season-start': return `<b>${esc(r.name)}</b> began`;
    case 'season-end': return `<b>${esc(r.name)}</b> ended after ${r.ended.week} week${r.ended.week === 1 ? '' : 's'}`;
    case 'move':
      if (!r.from) return `${w(r.wrestler)} joined ${show(r.to)}${r.note ? ` — ${esc(r.note)}` : ''}`;
      if (!r.to) return `${w(r.wrestler)} left ${show(r.from)}${r.note ? ` — ${esc(r.note)}` : ''}`;
      return `${w(r.wrestler)} moved from ${show(r.from)} to ${show(r.to)}${r.note ? ` — ${esc(r.note)}` : ''}`;
    case 'team-formed': return `<b>${esc(r.name)}</b> formed`;
    case 'team-disbanded': return `<b>${esc(r.name)}</b> disbanded`;
    case 'team-reunited': return `<b>${esc(r.name)}</b> reunited`;
    case 'team-joined': return `${w(r.wrestler)} joined <b>${esc((teamById(st, r.team) || { name: '?' }).name)}</b>`;
    case 'team-left': return `${w(r.wrestler)} left <b>${esc((teamById(st, r.team) || { name: '?' }).name)}</b>`;
    case 'title-won': {
      const t = titleById(st, r.titleId);
      const ev = r.eventId ? ` at ${esc((st.events.find(x => x.id === r.eventId) || {}).name || '')}` : '';
      return `<b>${esc(holderName(st, r.holder))}</b> won the ${esc(t ? t.name : 'title')}${ev}`;
    }
    case 'title-vacated': { const t = titleById(st, r.titleId); return `The ${esc(t ? t.name : 'title')} was vacated`; }
    case 'event': {
      const c = cardStatus(r);
      return `<span class="uv-link" onclick="uvOpenEvent('${r.id}')">${esc(r.name)}</span> <span class="uv-muted">${esc(eventWhen(st, r))}</span>`
        + ` — ${c.played} result${c.played === 1 ? '' : 's'}${c.booked ? `, ${c.booked} still to enter` : ''}`;
    }
    default: return '';
  }
}

export function uvHistMode(k) { histMode = k; refresh(); }
export function uvHistShow(k) { histShow = k; eventsShown = 12; refresh(); }
export function uvViewSeason(id) { viewSeason = id; eventsShown = 12; historyShown = 40; refresh(); }
export function uvMoreResults() { eventsShown += 12; refresh(); }
export function uvMoreHistory() { historyShown += 40; refresh(); }
/** When the active season changes, follow it - on the calendar and in the history. */
export function uvFollowActiveSeason() { viewSeason = null; calWeek = null; uvRankFollow(); }
