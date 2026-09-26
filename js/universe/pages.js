// WWE Universe — profile pages: a wrestler, a tag team, a championship. (A
// show's page, with its match card, is in card.js.)
//
// Read-first screens. Each shows where things stand now at the top, the
// record and history underneath, and a "Fix a mistake" card at the bottom
// holding only the corrections that apply. Every correction fixes one thing
// and says exactly what it will take back before it does.
//
// Records follow the model's rules: a wrestler's singles and tag records are
// counted from their own side in each match; a team's record counts only
// matches it wrestled as the team.
import * as M from './model.js';
import {
  ICON, LABEL, avatar, chip, esc, eventWhen, fmtRec, histLine, holderLink, kindChip, matchLine, recNote, section, showColor,
  showName, stampLabel, tag, vsLine, weeksText, wrestlerLink,
} from './ui.js';
import { pushPage, refresh, uni } from './app.js';
import { uvEventPage } from './card.js';
import { uvTransitionPage } from './relegation.js';

export function uvOpenWrestler(id) { pushPage('wrestler', id); }
export function uvOpenTeam(id) { pushPage('team', id); }
export function uvOpenTitle(id) { pushPage('title', id); }

/** { title, body } for a page, or null if what it showed no longer exists. */
export function uvPageView(kind, id) {
  return kind === 'wrestler' ? wrestlerPage(id) : kind === 'team' ? teamPage(id) : kind === 'title' ? titlePage(id)
    : kind === 'event' ? uvEventPage(id) : kind === 'transition' ? uvTransitionPage(id) : null;
}

// Long lists start short; "Show all" opens one list on one page.
const expanded = new Set();
export function uvShowAll(key) { expanded.add(key); refresh(); }
function capped(key, items, n, row) {
  const all = expanded.has(key);
  const shown = all ? items : items.slice(0, n);
  return shown.map(row).join('')
    + (!all && items.length > n ? `<div class="uv-more" onclick="uvShowAll('${key}')">Show all ${items.length}</div>` : '');
}

const recTile = (label, rec, note) =>
  `<div class="uv-rec"><div class="k">${esc(label)}</div><div class="v">${fmtRec(rec)}</div><div class="s">${esc(note || recNote(rec))}</div></div>`;
const numTile = (label, n, note) =>
  `<div class="uv-rec"><div class="k">${esc(label)}</div><div class="v">${n}</div><div class="s">${esc(note)}</div></div>`;
const fixRow = (onclick, icon, head, sub, cls = '') =>
  `<div class="uv-fixrow ${cls}" onclick="${onclick}">${icon}<div><b>${head}</b><span>${sub}</span></div></div>`;
const span = (st, a, b) => `${stampLabel(st, a)} → ${b ? stampLabel(st, b) : 'now'}`;
const eventName = (st, id) => (M.eventById(st, id) || { name: '(deleted event)' }).name;

// A title reign as a row: which title (or holder), when, how long, defences.
function reignRow(st, r, lead) {
  const weeks = M.reignWeeks(st, r), def = M.defencesOf(st, r);
  const where = r.eventId ? ` · ${esc(eventName(st, r.eventId))}` : '';
  return `<div class="uv-row" onclick="uvOpenTitle('${r.titleId}')">
    <span class="uv-av sq gold" style="--c:${showColor(st, (M.titleById(st, r.titleId) || {}).showId)}">${ICON.belt}</span>
    <div class="uv-main"><div class="nm">${lead}</div>
      <div class="sub">${span(st, r.start, r.end)}${r.vacated ? ' (vacated)' : ''}${where}</div></div>
    <div class="uv-champ"><div class="h">${weeksText(weeks)}</div><div class="s">${def} defence${def === 1 ? '' : 's'}</div></div>
  </div>`;
}

function resultRow(st, x, label) {
  const r = M.resultFor(x.match, x.side);
  return `<div class="uv-li" onclick="uvOpenEvent('${x.event.id}')"><span class="uv-res ${r}">${r}</span>
    <span>${matchLine(st, x.match)}<span class="uv-muted d">${esc(x.event.name)} · ${stampLabel(st, x.event.at)}${label ? ` · ${esc(label)}` : ''}</span></span></div>`;
}

// A booked match that hasn't been played yet: who's in it, and where and when.
function bookingRow(st, x) {
  const t = x.match.titleId && M.titleById(st, x.match.titleId);
  return `<div class="uv-li" onclick="uvOpenEvent('${x.event.id}')"><span class="uv-res up">vs</span>
    <span>${vsLine(st, x.match)}<span class="uv-muted d">${esc(x.event.name)} · ${esc(eventWhen(st, x.event))}</span>
      <span class="uv-chips">${kindChip(x.match)}${t ? chip(t.name, 'gold') : ''}${x.match.stip ? chip(x.match.stip) : ''}</span></span></div>`;
}
const upcoming = (st, list) => (list.length ? section('Booked', list.length) + list.map(x => bookingRow(st, x)).join('') : '');

// ================================================================ wrestler

function careerText(st, e) {
  const show = id => esc(showName(st, id));
  const team = t => `<span class="uv-link" onclick="uvOpenTeam('${t.id}')">${esc(t.name)}</span>`;
  const title = e => `the <span class="uv-link" onclick="uvOpenTitle('${e.title.id}')">${esc(e.title.name)}</span>${e.team ? ` with ${esc(e.team.name)}` : ''}`;
  switch (e.type) {
    case 'move': {
      const m = e.move, note = m.note ? ` <span class="uv-muted">— ${esc(m.note)}</span>` : '';
      if (!m.from) return `Joined ${show(m.to)}${note}`;
      if (!m.to) return `Left ${show(m.from)}${note}`;
      return `Moved from ${show(m.from)} to ${show(m.to)}${note}`;
    }
    case 'team-formed': return `Formed ${team(e.team)}`;
    case 'team-joined': return `Joined ${team(e.team)}`;
    case 'team-left': return `Left ${team(e.team)}`;
    case 'team-disbanded': return `${team(e.team)} disbanded`;
    case 'team-reunited': return `${team(e.team)} reunited`;
    case 'title-won': return `<b>Won ${title(e)}</b>${e.reign.eventId ? ` at ${esc(eventName(st, e.reign.eventId))}` : ''}`;
    case 'title-lost': return `Lost ${title(e)}`;
    case 'title-vacated': return `${title(e).replace(/^the/, 'The')} was vacated`;
    default: return '';
  }
}

function wrestlerPage(id) {
  const st = uni();
  const w = M.wrestlerById(st, id);
  if (!w) return null;
  const rec = M.wrestlerRecord(st, id);
  const champs = M.championshipsOf(st, id);
  const holding = c => !c.reign.end && (!c.team || c.team.members.includes(id));
  const current = champs.filter(holding), former = champs.filter(c => !holding(c));
  const mates = M.teammatesOf(st, id).sort((a, b) => b.current - a.current || M.byName(a.team, b.team));
  const partners = M.tagPartnersOf(st, id);
  const career = M.careerOf(st, id);
  const results = M.matchesOf(st, id);
  const booked = M.bookingsOf(st, id);
  const relegated = M.relegationsOf(st, id);
  const moves = M.movesOf(st, id);
  const lastMove = moves[moves.length - 1];
  const refs = M.wrestlerRefs(st, id);
  const tags = [tag(w.origin), w.gender === 'female' ? tag('Women’s division') : tag('Men’s division'),
    w.alignment ? tag(LABEL.alignment[w.alignment], w.alignment) : '', w.status === 'injured' ? tag('Injured', 'inj') : ''].join('');

  const champRow = c => reignRow(st, c.reign, `${esc(c.title.name)}${c.team ? ` <span class="uv-muted">with ${esc(c.team.name)}</span>` : ''}`);
  const mateRow = m => {
    const spell = m.spells[m.spells.length - 1];
    const when = m.current ? (m.team.active ? `since ${stampLabel(st, m.spells[0].start)}` : 'team disbanded')
      : `${span(st, spell.start, spell.end)}`;
    const together = rec.teams[m.team.id];
    return `<div class="uv-row${m.current && m.team.active ? '' : ' dim'}" onclick="uvOpenTeam('${m.team.id}')">
      <span class="uv-av sq">${ICON.team}</span>
      <div class="uv-main"><div class="nm">${esc(m.team.name)}${m.current ? '' : ' ' + tag('Former')}</div>
        <div class="sub">${m.partners.length ? `with ${esc(m.partners.map(p => p.name).join(' & '))} · ` : ''}${when}</div></div>
      <div class="uv-champ"><div class="h">${fmtRec(together)}</div><div class="s">as the team</div></div>
    </div>`;
  };
  const typeOf = x => {
    const s = x.match.sides[x.side];
    if (s.wrestlers.length === 1) return 'Singles';
    return s.team ? `with ${(M.teamById(st, s.team) || { name: 'team' }).name}` : 'Tag';
  };
  const moveDesc = mv => `${mv.from ? showName(st, mv.from) : 'Unassigned'} → ${showName(st, mv.to)}`;

  return {
    title: w.name,
    body: `
      <div class="uv-prof" style="--c:${showColor(st, w.showId)}">
        <div class="uv-prof-top">${avatar(st, w, 'xl')}
          <div class="uv-prof-id"><div class="nm">${esc(w.name)}</div>
            <div class="show">${w.showId ? `<span class="uv-dot" style="--c:${showColor(st, w.showId)}"></span>${esc(showName(st, w.showId))}` : 'Unassigned'}</div>
            <div class="tags">${tags}</div></div></div>
        <div class="uv-prof-acts">
          <div class="uv-btn pri" onclick="uvMoveWrestlers(['${id}'])">${ICON.move}Move show</div>
          <div class="uv-btn" onclick="uvEditWrestler('${id}')">${ICON.edit}Edit</div>
        </div>
      </div>
      <div class="uv-recs">
        ${recTile('Singles', rec.singles)}${recTile('Tag', rec.tag)}
        ${numTile('Title reigns', champs.length, current.length ? `${current.length} held now` : champs.length ? 'none held now' : 'never a champion')}
      </div>
      ${w.notes ? `<div class="uv-note">${esc(w.notes)}</div>` : ''}

      ${upcoming(st, booked)}
      ${relegated.length ? section('Relegation', relegated.length) + relegated.map(r => `<div class="uv-relrec in" onclick="uvOpenTransition('${r.transition}')">
        <b>${esc(showName(st, r.show))} → NXT · ${stampLabel(st, r.at)}</b><span>${esc(r.reason)}</span></div>`).join('') : ''}

      ${section('Championships', champs.length || null)}
      ${champs.length ? current.map(champRow).join('') + (former.length ? `<div class="uv-sub">Former</div>` + capped(`c-${id}`, former, 5, champRow) : '')
        : '<div class="uv-none">Never held a title.</div>'}

      ${section('Tag teams & partners', mates.length || null)}
      ${mates.length ? mates.map(mateRow).join('') : '<div class="uv-none">Never on a registered tag team.</div>'}
      ${partners.length ? `<div class="uv-none">Also teamed with ${partners.map(p => `${wrestlerLink(st, p.wrestler)} (${p.count})`).join(', ')}</div>` : ''}

      ${section('Career history', career.length || null)}
      <div class="uv-tls">${career.length ? capped(`h-${id}`, career, 12, e => histLine(st, e, careerText(st, e))) : '<div class="uv-none">Nothing yet.</div>'}</div>

      ${section('Results', results.length || null)}
      ${results.length ? capped(`r-${id}`, results, 10, x => resultRow(st, x, typeOf(x))) : '<div class="uv-none">No results recorded yet.</div>'}

      <div class="uv-fix">
        <div class="h">Fix a mistake</div>
        ${lastMove ? fixRow(`uvUndoMove('${id}')`, ICON.undo, 'Undo last move',
          `${esc(moveDesc(lastMove))} · ${stampLabel(st, lastMove.at)}`) : ''}
        ${fixRow(`uvEditWrestler('${id}')`, ICON.edit, 'Edit details', 'Name, division, promotion, alignment, status, notes')}
        ${fixRow(`uvMergeInto('${id}')`, ICON.team, `Merge a duplicate into ${esc(w.name)}`, 'For the same wrestler entered twice')}
        ${refs.length ? `<div class="fine">${esc(w.name)} is part of the history (${esc(refs.join(', '))}), so they can’t be deleted — leave them unassigned instead.</div>`
          : fixRow(`uvDeleteWrestler('${id}')`, ICON.x, `Delete ${esc(w.name)}`, 'No history yet — for someone added by mistake', 'bad')}
        <div class="fine">A wrong result is fixed on its show: open it from Results above and tap <b>Correct</b>.</div>
      </div>`,
  };
}

// ================================================================ tag team

function teamHistText(st, t, e) {
  const who = e.wrestler ? wrestlerLink(st, e.wrestler) : '';
  const title = e.title ? `the <span class="uv-link" onclick="uvOpenTitle('${e.title.id}')">${esc(e.title.name)}</span>` : '';
  switch (e.type) {
    case 'team-formed': {
      const founders = M.membershipsOf(st, t.id).filter(m => m.start.seq === M.teamFormed(t).seq)
        .map(m => wrestlerLink(st, M.wrestlerById(st, m.wrestler)));
      return `Formed — ${founders.join(' & ')}`;
    }
    case 'team-disbanded': return 'Disbanded';
    case 'team-reunited': return 'Reunited';
    case 'member-joined': return `${who} joined`;
    case 'member-left': return `${who} left`;
    case 'title-won': return `<b>Won ${title}</b>${e.reign.eventId ? ` at ${esc(eventName(st, e.reign.eventId))}` : ''}`;
    case 'title-lost': return `Lost ${title}`;
    case 'title-vacated': return `${title.replace(/^the/, 'The')} was vacated`;
    default: return '';
  }
}

function teamChangeText(st, c) {
  if (c.kind === 'disbanded') return 'Disbanding';
  if (c.kind === 'reunited') return 'Reuniting';
  const w = M.wrestlerById(st, c.m.wrestler);
  return `${w ? w.name : 'A member'} ${c.kind === 'joined' ? 'joining' : 'leaving'}`;
}

function teamPage(id) {
  const st = uni();
  const t = M.teamById(st, id);
  if (!t) return null;
  const rec = M.teamRecord(st, id);
  const shows = M.teamShows(st, t);
  const spells = M.membershipsOf(st, id);
  const former = spells.filter(m => m.end).sort((a, b) => b.end.seq - a.end.seq);
  const reigns = st.reigns.filter(r => r.holder.type === 'team' && r.holder.id === id).sort((a, b) => M.compareStamps(st, b.start, a.start));
  const held = reigns.filter(r => !r.end).length;
  const hist = M.teamHistoryOf(st, id);
  const results = M.teamMatches(st, id);
  const booked = M.teamBookings(st, id);
  const last = M.lastTeamChange(st, id);
  const refs = M.teamRefs(st, id);
  const lastLog = t.log[t.log.length - 1];

  const memberRow = m => {
    const w = M.wrestlerById(st, m.wrestler);
    return `<div class="uv-row${m.end ? ' dim' : ''}" onclick="uvOpenWrestler('${w.id}')">${avatar(st, w)}
      <div class="uv-main"><div class="nm">${esc(w.name)}</div>
        <div class="sub">${esc(showName(st, w.showId))} · ${m.end ? span(st, m.start, m.end) : `since ${stampLabel(st, m.start)}`}</div></div>
      <span class="uv-chev">${ICON.right}</span></div>`;
  };

  return {
    title: t.name,
    body: `
      <div class="uv-prof" style="--c:${shows.length === 1 ? showColor(st, shows[0]) : '#5E6979'}">
        <div class="uv-prof-top"><span class="uv-av xl sq">${ICON.team}</span>
          <div class="uv-prof-id"><div class="nm">${esc(t.name)}</div>
            <div class="show">${t.active ? shows.map(s => `<span class="uv-dot" style="--c:${showColor(st, s)}"></span>${esc(showName(st, s))}`).join(' &nbsp;')
              : `Disbanded ${stampLabel(st, lastLog.at)}`}</div>
            <div class="tags">${t.active ? tag('Active') : tag('Disbanded', 'warn')}${shows.length > 1 && t.active ? tag('Split across shows', 'warn') : ''}</div></div></div>
        <div class="uv-prof-acts">
          <div class="uv-btn pri" onclick="uvLineup('${id}')">${ICON.team}Line-up</div>
          <div class="uv-btn" onclick="uvRenameTeam('${id}')">${ICON.edit}Rename</div>
          <div class="uv-btn" onclick="uvTeamActive('${id}',${!t.active})">${t.active ? 'Disband' : 'Reunite'}</div>
        </div>
      </div>
      <div class="uv-recs">
        ${recTile('Team record', rec)}
        ${numTile('Title reigns', reigns.length, held ? `${held} held now` : reigns.length ? 'none held now' : 'never champions')}
        ${numTile('Members', t.members.length, former.length ? `${former.length} former` : 'original line-up')}
      </div>
      <div class="uv-note">Counts only matches wrestled as ${esc(t.name)}. Members’ singles matches, and tag matches with other partners, go on their own records — not the team’s.</div>

      ${upcoming(st, booked)}

      ${section('Members', t.members.length)}
      ${t.members.map(wid => memberRow(spells.find(m => m.wrestler === wid && !m.end))).join('')}
      ${former.length ? `<div class="uv-sub">Former</div>${former.map(memberRow).join('')}` : ''}

      ${section('Championships', reigns.length || null)}
      ${reigns.length ? reigns.map(r => reignRow(st, r, esc(M.titleById(st, r.titleId).name))).join('') : '<div class="uv-none">Never champions.</div>'}

      ${section('Team history', hist.length)}
      <div class="uv-tls">${capped(`th-${id}`, hist, 12, e => histLine(st, e, teamHistText(st, t, e)))}</div>

      ${section('Results as a team', results.length || null)}
      ${results.length ? capped(`tr-${id}`, results, 10, x => resultRow(st, x, '')) : '<div class="uv-none">No matches as a team yet.</div>'}

      <div class="uv-fix">
        <div class="h">Fix a mistake</div>
        ${last ? fixRow(`uvUndoTeam('${id}')`, ICON.undo, 'Undo last change', `${esc(teamChangeText(st, last))} · ${stampLabel(st, last.at)}`) : ''}
        ${fixRow(`uvRenameTeam('${id}')`, ICON.edit, 'Rename the team', 'Past results show the new name')}
        ${refs.length ? `<div class="fine">${esc(t.name)} are part of the history (${esc(refs.join(', '))}), so they can’t be deleted — disband them instead.</div>`
          : fixRow(`uvDeleteTeam('${id}')`, ICON.x, `Delete ${esc(t.name)}`, 'No matches or titles yet — for a team added by mistake', 'bad')}
      </div>`,
  };
}

// ================================================================ championship

function titlePage(id) {
  const st = uni();
  const t = M.titleById(st, id);
  if (!t) return null;
  const cur = M.currentReign(st, id);
  const reigns = M.titleReigns(st, id);
  const refs = M.titleRefs(st, id);
  const last = reigns[reigns.length - 1];
  const longest = reigns.reduce((best, r) => (!best || M.reignWeeks(st, r) > M.reignWeeks(st, best) ? r : best), null);
  const holders = new Set(reigns.map(r => `${r.holder.type}:${r.holder.id}`)).size;
  const kindWord = t.kind === 'tag' ? 'Champions' : 'Champion';
  const booked = titleBookings(st, id);

  const historyRow = (r, n) => {
    const weeks = M.reignWeeks(st, r), def = M.defencesOf(st, r);
    const how = r.matchId ? `won at ${esc(eventName(st, r.eventId))}` : r.eventId ? esc(eventName(st, r.eventId)) : 'awarded';
    return `<div class="uv-row" onclick="uvEditReign('${r.id}')">
      <span class="uv-num">${n}</span>
      <div class="uv-main"><div class="nm">${esc(M.holderName(st, r.holder))}</div>
        <div class="sub">${span(st, r.start, r.end)}${r.vacated ? ' (vacated)' : ''} · ${how}${r.note ? ` · ${esc(r.note)}` : ''}</div></div>
      <div class="uv-champ"><div class="h">${weeksText(weeks)}</div><div class="s">${def} defence${def === 1 ? '' : 's'}</div></div>
    </div>`;
  };
  const undoText = !last ? '' : last.end ? `The vacancy · ${stampLabel(st, last.end)}`
    : `${esc(M.holderName(st, last.holder))} winning it · ${stampLabel(st, last.start)}`;

  return {
    title: t.name,
    body: `
      <div class="uv-champ-card" style="--c:${showColor(st, t.showId)}">
        <div class="k">${!t.active ? 'Retired' : cur ? kindWord : 'Vacant'}</div>
        <div class="h">${cur ? holderLink(st, cur.holder) : '—'}</div>
        ${cur ? `<div class="s">Since ${stampLabel(st, cur.start)} · ${weeksText(M.reignWeeks(st, cur))} · ${M.defencesOf(st, cur)} defence${M.defencesOf(st, cur) === 1 ? '' : 's'}</div>` : ''}
        <div class="s">${esc(showName(st, t.showId, 'No brand'))} · ${esc(LABEL.division[t.division])} · ${esc(LABEL.kind[t.kind])}</div>
      </div>
      <div class="uv-prof-acts">
        ${t.active ? `<div class="uv-btn pri" onclick="uvCrownSheet('${id}')">${ICON.belt}Crown…</div>` : ''}
        ${cur ? `<div class="uv-btn" onclick="uvVacate('${id}')">Vacate</div>` : ''}
        <div class="uv-btn" onclick="uvEditTitle('${id}')">${ICON.edit}Edit</div>
      </div>
      <div class="uv-recs">
        ${numTile('Reigns', reigns.length, `${holders} different ${t.kind === 'tag' ? 'teams' : 'champions'}`)}
        ${numTile('Longest', longest ? M.reignWeeks(st, longest) : 0, longest ? M.holderName(st, longest.holder) : '—')}
        ${numTile('Title matches', countTitleMatches(st, id), booked.length ? `${booked.length} booked` : 'with a result')}
      </div>
      <p class="uv-p">A title that changes hands on a show is best recorded on that match’s result, so the reign is dated to it and the defences count.</p>

      ${upcoming(st, booked)}

      ${section('Title history', reigns.length || null)}
      ${reigns.length ? reigns.map((r, i) => [r, i + 1]).reverse().map(([r, n]) => historyRow(r, n)).join('') : '<div class="uv-none">Never held.</div>'}

      <div class="uv-fix">
        <div class="h">Fix a mistake</div>
        ${last ? fixRow(`uvUndoTitle('${id}')`, ICON.undo, 'Undo last change', undoText) : ''}
        ${reigns.length ? `<div class="fine">To correct an older reign — who held it, or the week it began — tap it in the history above. Nothing around it changes.</div>` : ''}
        ${fixRow(`uvEditTitle('${id}')`, ICON.edit, 'Edit details', 'Name, show, division; retire or bring back')}
        ${refs.length ? `<div class="fine">The ${esc(t.name)} has history (${esc(refs.join(', '))}), so it can’t be deleted — retire it instead.</div>`
          : fixRow(`uvDeleteTitle('${id}')`, ICON.x, `Delete the ${esc(t.name)}`, 'No history yet — for a title added by mistake', 'bad')}
      </div>`,
  };
}

function countTitleMatches(st, titleId) {
  return st.events.reduce((n, e) => n + e.matches.filter(m => m.titleId === titleId && m.status === 'played').length, 0);
}
// title matches on the card with no result yet, soonest first
function titleBookings(st, titleId) {
  const out = [];
  st.events.forEach(event => event.matches.forEach(match => {
    if (match.titleId === titleId && match.status === 'scheduled') out.push({ event, match });
  }));
  return out.sort((a, b) => M.compareStamps(st, a.event.at, b.event.at));
}
