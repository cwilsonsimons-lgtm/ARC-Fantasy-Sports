// WWE Universe — the four tabs: Roster, Teams, Titles, History.
//
// Lists only. Tapping a row opens its profile page (pages.js) or, for an
// event, its sheet. The roster also has a select mode for moving several
// wrestlers between shows at once.
import {
  activeSeason, byName, currentReign, eventsIn, holderName, reignWeeks, rosterCounts, rosterOf,
  seasonById, teamById, teamRecord, teamShows, timeline, titleById, titlesHeldBy, titlesOfWrestler,
  wrestlerById,
} from './model.js';
import { ICON, LABEL, avatar, empty, esc, fmtRec, section, showColor, showDot, showName, stampLabel, tag, weeksText } from './ui.js';
import { refresh, uni } from './app.js';

// ---------------------------------------------------------------- roster

let rosterShow = 'all';      // 'all', a show id, or '' for unassigned
let rosterQ = '';
let picking = null;          // a Set of wrestler ids while selecting, else null

export function uvRosterShow() { return rosterShow === 'all' ? '' : rosterShow; }

export function uvRosterView() {
  const st = uni();
  const counts = rosterCounts(st);
  const pill = (k, label, n, color) => `<div class="uv-pill${rosterShow === k ? ' on' : ''}" onclick="uvRosterFilter('${k}')">`
    + `${color ? `<span class="uv-dot" style="--c:${color}"></span>` : ''}${esc(label)}<span class="n">${n}</span></div>`;
  return `
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

let viewSeason = null;      // null follows the active season
let historyShown = 40;

export function uvHistoryView() {
  const st = uni();
  const cur = activeSeason(st);
  const seasonId = (viewSeason && seasonById(st, viewSeason)) ? viewSeason : cur.id;
  const season = seasonById(st, seasonId);

  const card = `<div class="uv-card">
    <div class="uv-season">
      <div><div class="k">${esc(cur.name)}</div><div class="v">Week ${cur.week}</div></div>
      <div class="uv-step">
        <div class="uv-ic" onclick="uvStepWeek(-1)" title="Back a week">${ICON.left}</div>
        <div class="uv-btn" onclick="uvStepWeek(1)">Next week${ICON.right}</div>
      </div>
    </div>
    <div class="uv-card-f"><span onclick="uvNextSeason()">Start Season ${Math.max(...st.seasons.map(s => s.number)) + 1}…</span>
      <span onclick="uvRenameSeason('${cur.id}')">Rename</span></div>
  </div>`;

  const pills = st.seasons.length > 1 ? `<div class="uv-pills">${st.seasons.map(s =>
    `<div class="uv-pill${s.id === seasonId ? ' on' : ''}" onclick="uvViewSeason('${s.id}')">${esc(s.name)}</div>`).join('')}</div>` : '';

  const events = eventsIn(st, seasonId).reverse();
  let lastWeek = null;
  const eventRows = events.map(e => {
    const head = e.at.week !== lastWeek ? `<div class="uv-wk">Week ${e.at.week}</div>` : '';
    lastWeek = e.at.week;
    return head + eventRow(st, e);
  }).join('');

  const tl = timeline(st);
  const entries = tl.slice(0, historyShown).map(e => `<div class="uv-tl"><span class="w">${stampLabel(st, e)}</span>`
    + `<span class="x">${timelineText(st, e)}</span></div>`).join('');

  return card + `
    <div class="uv-bar"><div class="uv-bar-t">Events${st.seasons.length > 1 ? ` · ${esc(season.name)}` : ''}</div>
      ${season.status === 'active' ? `<div class="uv-btn pri" onclick="uvNewEvent()">${ICON.plus}New event</div>` : ''}</div>
    ${pills}
    ${eventRows || empty(ICON.cal, 'No events yet',
      'Add each show or premium live event after you play or watch it in WWE 2K25, then record the results the game gave you.')}
    ${section('History', null)}
    <div class="uv-tls">${entries}</div>
    ${tl.length > historyShown ? `<div class="uv-more" onclick="uvMoreHistory()">Show more (${tl.length - historyShown})</div>` : ''}`;
}

function eventRow(st, e) {
  const n = e.matches.length;
  const kind = e.kind === 'ple' ? tag('PLE', 'ple') : '';
  return `<div class="uv-row" onclick="uvOpenEvent('${e.id}')">
    <span class="uv-av sq" style="--c:${showColor(st, e.showId)}">${ICON.cal}</span>
    <div class="uv-main"><div class="nm">${esc(e.name)}</div>
      <div class="sub">${kind}${esc(e.showId ? showName(st, e.showId) : 'All shows')} · ${n} match${n === 1 ? '' : 'es'}</div></div>
    <span class="uv-chev">${ICON.right}</span>
  </div>`;
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
    case 'event': return `${esc(r.name)} — ${r.matches.length} match${r.matches.length === 1 ? '' : 'es'} recorded`;
    default: return '';
  }
}

export function uvViewSeason(id) { viewSeason = id; refresh(); }
export function uvMoreHistory() { historyShown += 40; refresh(); }
/** When the active season changes, follow it. */
export function uvFollowActiveSeason() { viewSeason = null; }
