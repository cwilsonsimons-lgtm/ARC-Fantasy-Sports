// Universe — a show's match card, and the form behind it.
//
// The workflow the app is built around: plan an episode on the calendar, book
// its matches, watch WWE 2K25's CPU play them, then enter what happened. A
// booked match has no result at all until the owner enters one - the form's
// result starts blank and is never filled in for them, because the game is
// the only source of truth for who won.
//
// Corrections work on the same match: correct a result, clear it back to
// booked, or take it off the card. Records and title histories follow,
// under the model's rule that a title change is taken back only while nothing
// later depends on it.
import * as M from './model.js';
import {
  ICON, LABEL, chip, empty, esc, eventWhen, fallLine, field, isoText, kindChip, labelPairs, matchLine, options,
  select, showColor, showName, showPairs, teamOptions, titleOptions, vsLine, wrestlerOptions,
} from './ui.js';
import { closeSheet, commit, confirmThen, openSheet, paintSheet, pushPage, toast, uni } from './app.js';

export function uvOpenEvent(id) { pushPage('event', id); }

// ================================================================ planning shows

/** Plan an episode of a show for a week: it goes on the calendar, empty, ready to book. */
export function uvPlanShow(showId, week) {
  const r = commit(st => M.addEvent(st, { showId, week }), e => `${e.name} planned`);
  if (r.ok) uvOpenEvent(r.value.id);
}

let pleDraft = null;

/** A premium live event: its own name, any show or all of them, any night. */
export function uvNewPle(week) {
  pleDraft = { name: '', showId: '', week: String(week), day: String(M.PLE_DAY) };
  openSheet(() => {
    const st = uni();
    const d = pleDraft;
    return {
      title: 'Premium live event',
      body: `
        ${field('Name', `<input id="uvPleName" class="uv-in" maxlength="60" value="${esc(d.name)}" placeholder="e.g. WrestleMania"
          oninput="uvPleSet('name',this.value)">`, 'wide')}
        <div class="uv-grid" style="margin-top:10px">
          ${field('Show', select(`uvPleSet('showId',this.value)`, options(showPairs(st, 'All shows'), d.showId)), 'wide')}
          ${field('Week', `<input class="uv-in" type="number" min="1" max="999" inputmode="numeric" value="${esc(d.week)}"
            oninput="uvPleSet('week',this.value)">`)}
          ${field('Night', select(`uvPleSet('day',this.value)`, options(M.DAYS.map((n, i) => [String(i), n]), d.day)))}
        </div>
        <div class="uv-btn pri full" onclick="uvCreatePle()">Add to the calendar</div>`,
    };
  });
}
export function uvPleSet(k, v) { pleDraft[k] = v; }
export function uvCreatePle() {
  const d = pleDraft;
  const r = commit(st => M.addEvent(st, { kind: 'ple', name: d.name, showId: d.showId, week: d.week, day: d.day }), e => `${e.name} added`);
  if (r.ok) { closeSheet(); uvOpenEvent(r.value.id); }
}

export function uvEventDetails(id) {
  openSheet(() => {
    const st = uni();
    const e = M.eventById(st, id);
    if (!e) return null;
    const set = k => `uvSetEvent('${id}','${k}',this.value)`;
    const changed = st.reigns.some(r => r.eventId === id);
    return {
      title: 'Edit details',
      body: `
        ${field('Name', `<input class="uv-in" maxlength="60" value="${esc(e.name)}" onchange="${set('name')}">`, 'wide')}
        <div class="uv-grid" style="margin-top:10px">
          ${field('Show', select(set('showId'), options(showPairs(st, e.kind === 'ple' ? 'All shows' : ''), e.showId || '')), 'wide')}
          ${field('Week', `<input id="uvEvWeek" class="uv-in" type="number" min="1" max="999" inputmode="numeric" value="${e.at.week}" onchange="${set('week')}">`)}
          ${field('Night', select(set('day'), options(M.DAYS.map((n, i) => [String(i), n]), String(e.at.day)), ' id="uvEvDay"'))}
          ${field('Notes', `<textarea class="uv-in" rows="2" maxlength="2000" onchange="${set('notes')}">${esc(e.notes)}</textarea>`, 'wide')}
        </div>
        ${changed ? '<div class="fine">A title changed hands here, so a new week or night moves that title change with it — as long as the title’s history still reads in order.</div>' : ''}
        <div class="uv-btn full" onclick="uvCloseSheet()">Done</div>
        <div class="uv-btn bad full" onclick="uvDeleteEvent('${id}')">Delete this ${e.kind === 'ple' ? 'event' : 'episode'}</div>`,
    };
  });
}
export function uvSetEvent(id, key, value) { commit(st => M.updateEvent(st, id, { [key]: value }), 'Saved'); }

export function uvDeleteEvent(id) {
  const st = uni();
  const e = M.eventById(st, id);
  const { played, booked } = M.cardStatus(e);
  const titles = st.reigns.filter(r => r.eventId === id).map(r => M.titleById(st, r.titleId).name);
  const parts = [played && `${played} result${played === 1 ? '' : 's'}`, booked && `${booked} booked match${booked === 1 ? '' : 'es'}`].filter(Boolean);
  confirmThen(`Delete ${e.name}?`,
    (parts.length ? `Its ${parts.join(' and ')} go with it.` : 'Nothing is booked on it yet.')
    + (titles.length ? ` The ${titles.join(' and the ')} will go back to whoever held ${titles.length === 1 ? 'it' : 'them'} before.` : ''),
    'Delete', () => { if (commit(s => M.deleteEvent(s, id), `${e.name} deleted`).ok) closeSheet(); });
}

// ================================================================ the show page

const STATUS_TEXT = {
  empty: () => 'Nothing booked yet',
  booked: c => `${c.total} match${c.total === 1 ? '' : 'es'} booked — waiting for results`,
  partial: c => `${c.played} of ${c.total} results in`,
  complete: c => `Complete — ${c.total} result${c.total === 1 ? '' : 's'}`,
};

function matchCard(st, ev, m, i) {
  const played = m.status === 'played';
  const title = m.titleId && M.titleById(st, m.titleId);
  const reign = played && st.reigns.find(r => r.matchId === m.id);
  const detail = played ? [m.finish && LABEL.finish[m.finish], fallLine(st, m)].filter(Boolean).join(' · ') : '';
  const move = d => `<div class="uv-ic mv" title="Move ${d < 0 ? 'up' : 'down'}" onclick="uvMoveMatch('${ev.id}','${m.id}',${d})">${d < 0 ? ICON.up : ICON.down}</div>`;
  return `<div class="uv-mc ${m.status}" data-m="${m.id}">
    <div class="uv-mc-top"><span class="n">${i + 1}</span>${kindChip(m)}${title ? chip(title.name, 'gold') : ''}${m.stip ? chip(m.stip) : ''}
      <span class="st">${played ? 'Result' : 'Booked'}</span></div>
    <div class="uv-mc-body">${played ? matchLine(st, m) : vsLine(st, m)}</div>
    ${detail ? `<div class="uv-mc-d">${detail}</div>` : ''}
    ${reign ? `<div class="uv-mc-d uv-gold">New ${esc(title.name)} ${reign.holder.type === 'team' ? 'champions' : 'champion'}</div>` : ''}
    ${m.notes ? `<div class="uv-mc-n">${esc(m.notes)}</div>` : ''}
    <div class="uv-mc-acts">
      ${played ? `<div class="uv-btn sm2" onclick="uvCorrectResult('${ev.id}','${m.id}')">${ICON.edit}Correct</div>`
        : `<div class="uv-btn pri sm2" onclick="uvEnterResult('${ev.id}','${m.id}')">Enter result</div>
           <div class="uv-btn sm2" onclick="uvEditBooking('${ev.id}','${m.id}')">${ICON.edit}Edit</div>`}
      <span class="sp"></span>${move(-1)}${move(1)}
    </div>
  </div>`;
}

/** The event page: when and where, where the card stands, and the card itself. */
export function uvEventPage(id) {
  const st = uni();
  const e = M.eventById(st, id);
  if (!e) return null;
  const season = M.seasonById(st, e.at.season);
  const c = M.cardStatus(e);
  return {
    title: e.name,
    body: `
      <div class="uv-evhead" style="--c:${showColor(st, e.showId)}">
        <div class="k">${esc(LABEL.event[e.kind])} · ${esc(e.showId ? showName(st, e.showId) : 'All shows')}</div>
        <div class="nm">${esc(e.name)}</div>
        <div class="s">${esc(eventWhen(st, e, true))}${M.calendarDate(st, e.at.season, e.at.week, e.at.day) ? ` · week ${e.at.week}` : ''} · ${esc(season.name)}</div>
        <div class="st"><span class="uv-state ${c.state}"></span>${STATUS_TEXT[c.state](c)}</div>
      </div>
      <div class="uv-page-acts">
        <div class="uv-btn pri" onclick="uvBookMatch('${id}')">${ICON.plus}Book a match</div>
        <div class="uv-btn" onclick="uvEventDetails('${id}')">${ICON.edit}Details</div>
      </div>
      ${e.notes ? `<div class="uv-note">${esc(e.notes)}</div>` : ''}
      <div class="uv-sec"><span class="t">The card</span>${c.total ? `<span class="n">${c.total}</span>` : ''}</div>
      ${c.total ? `<div class="uv-cards">${e.matches.map((m, i) => matchCard(st, e, m, i)).join('')}</div>`
        : empty(ICON.cal, 'Nothing booked yet', 'Book the matches for this show, watch the CPU play them in WWE 2K25, then enter each result here.')}
      <div class="uv-fix">
        <div class="h">Fix a mistake</div>
        <div class="fine">A result entered wrong: tap <b>Correct</b> on it. You can change anything, clear the result
          so the match is booked again, or take the match off the card. Records and title histories follow.</div>
        <div class="uv-fixrow bad" onclick="uvDeleteEvent('${id}')">${ICON.x}<div><b>Delete this ${e.kind === 'ple' ? 'event' : 'episode'}</b>
          <span>Takes its bookings and results with it</span></div></div>
      </div>`,
  };
}

export function uvMoveMatch(eventId, matchId, d) {
  const r = commit(st => M.moveMatch(st, eventId, matchId, d));
  if (r.ok && !r.value) toast(d < 0 ? 'Already first on the card' : 'Already last on the card');
}

// ================================================================ the match form
//
// One form, four jobs: book a match, edit a booking, enter a result, correct
// a result. The draft lives here until it's saved, so a refused save keeps
// everything typed.

let md = null;
const blankSide = () => ({ team: '', wrestlers: [''] });
const PRESETS = [
  ['Singles', [1, 1]], ['Tag team', [2, 2]], ['Triple threat', [1, 1, 1]], ['Fatal 4-way', [1, 1, 1, 1]],
  ['Handicap 1-on-2', [1, 2]], ['3-on-3 tag', [3, 3]], ['Triple threat tag', [2, 2, 2]], ['Battle royal', [1, 1, 1, 1, 1, 1]],
];
const STIPULATIONS = ['Normal', 'No Disqualification', 'Street Fight', 'Extreme Rules', 'Falls Count Anywhere', 'Ladder', 'Tables',
  'TLC', 'Steel Cage', 'Hell in a Cell', 'Last Man Standing', 'Iron Man', 'Submission', 'I Quit', 'Casket', 'Ambulance',
  'Backstage Brawl', 'Royal Rumble', 'Battle Royal', 'Elimination Chamber', 'Money in the Bank', 'Gauntlet', 'Special Guest Referee'];

const fromMatch = m => m.sides.map(sd => ({ team: sd.team || '', wrestlers: [...sd.wrestlers] }));

function openForm(mode, eventId, m) {
  const st = uni();
  const linked = m && st.reigns.some(r => r.matchId === m.id);
  md = {
    mode, eventId, matchId: m ? m.id : null,
    sides: m ? fromMatch(m) : [blankSide(), blankSide()],
    titleId: (m && m.titleId) || '', stip: (m && m.stip) || '', notes: (m && m.notes) || '',
    // a result is never pre-filled for a match that hasn't got one
    result: m && m.status === 'played' ? (m.outcome === 'win' ? String(m.winner) : m.outcome) : '',
    finish: (m && m.finish) || '', by: (m && m.fall && m.fall.by) || '', on: (m && m.fall && m.fall.on) || '',
    titleChange: !!linked,
    // entering a result starts from the booking as it stands; the line-up
    // opens only if the owner asks (a run-in, a late change)
    lineup: mode === 'book' || mode === 'edit',
  };
  openSheet(formSheet);
}
const matchOf = (eventId, matchId) => M.eventById(uni(), eventId).matches.find(x => x.id === matchId);
export function uvBookMatch(eventId) { openForm('book', eventId, null); }
export function uvEditBooking(eventId, matchId) { openForm('edit', eventId, matchOf(eventId, matchId)); }
export function uvEnterResult(eventId, matchId) { openForm('result', eventId, matchOf(eventId, matchId)); }
export function uvCorrectResult(eventId, matchId) { openForm('correct', eventId, matchOf(eventId, matchId)); }

// Registered teams a side could be wrestling as: every wrestler on it is on
// the team now. Offered, never assumed - it decides whose record it counts on.
function teamGuesses(st, side) {
  const ids = side.wrestlers.filter(Boolean);
  if (side.team || ids.length < 2) return [];
  return st.teams.filter(t => t.active && ids.every(id => t.members.includes(id)));
}

const TITLES = { book: 'Book a match', edit: 'Edit the booking', result: 'Enter the result', correct: 'Correct the result' };

function formSheet() {
  const st = uni();
  const e = M.eventById(st, md.eventId);
  if (!e) return null;
  if (md.matchId && !e.matches.some(m => m.id === md.matchId)) return null;
  if (st.wrestlers.length < 2) {
    return { title: TITLES[md.mode], body: empty(ICON.user, 'Add wrestlers first', 'A match needs at least two wrestlers on the roster.') };
  }
  const withResult = md.mode === 'result' || md.mode === 'correct';
  const label = (s, i) => {
    const team = s.team && M.teamById(st, s.team);
    const ids = s.wrestlers.filter(Boolean);
    return team ? team.name : ids.length ? ids.map(id => M.wrestlerById(st, id).name).join(' & ') : `Side ${i + 1}`;
  };
  const shape = md.sides.map(s => s.wrestlers.length).join(',');
  const title = md.titleId ? M.titleById(st, md.titleId) : null;
  const cur = title && M.currentReign(st, title.id);
  const champIn = cur && md.sides.some(s => (cur.holder.type === 'team' ? s.team === cur.holder.id : s.wrestlers.includes(cur.holder.id)));
  const w = md.result !== '' && !isNaN(Number(md.result)) ? Number(md.result) : null;
  const linked = md.matchId && st.reigns.find(r => r.matchId === md.matchId);
  const hasTeams = st.teams.some(t => t.active) || md.sides.some(s => s.team);

  const sides = md.sides.map((s, i) => `<div class="uv-sidebox">
      <div class="h"><span>Side ${i + 1}</span>${md.sides.length > 2 ? `<span class="uv-link" onclick="uvMDropSide(${i})">Remove</span>` : ''}</div>
      ${hasTeams && (s.wrestlers.length > 1 || s.team) ? `<div class="uv-pick">${select(`uvMTeam(${i},this.value)`, teamOptions(st, s.team, 'Not as a tag team'), ' data-team="1"')}</div>` : ''}
      ${s.wrestlers.map((wid, j) => `<div class="uv-pick">${select(`uvMWrestler(${i},${j},this.value)`, wrestlerOptions(st, wid), ` data-w="${j}"`)}
        ${s.wrestlers.length > 1 ? `<div class="uv-ic sm" onclick="uvMDropWrestler(${i},${j})">${ICON.x}</div>` : ''}</div>`).join('')}
      ${teamGuesses(st, s).map(t => `<div class="uv-hint" onclick="uvMTeam(${i},'${t.id}')">Wrestling as <b>${esc(t.name)}</b>?
        <span>Tap so it counts on their team record</span></div>`).join('')}
      <div class="uv-add" onclick="uvMAddWrestler(${i})">${ICON.plus}Add a partner</div>
    </div>`).join('');

  const winSide = w != null ? md.sides[w] : null;
  const losers = w != null ? md.sides.filter((_, i) => i !== w).flatMap(s => s.wrestlers.filter(Boolean)) : [];
  const pickFrom = (ids, v, k, blank) => select(`uvMSet('${k}',this.value)`,
    options([['', blank], ...ids.map(id => [id, M.wrestlerById(st, id).name])], v), ` id="uvM${k === 'by' ? 'By' : 'On'}"`);

  const result = withResult ? `
      <h4>What happened in the game</h4>
      ${field('Result', select(`uvMSet('result',this.value)`, options([['', '— Pick the result —'],
        ...md.sides.map((s, i) => [String(i), `${label(s, i)} won`]), ['draw', 'Draw'], ['nc', 'No contest']], md.result), ' id="uvMResult"'), 'wide')}
      <div class="uv-grid" style="margin-top:10px">
        ${field('Finish', select(`uvMSet('finish',this.value)`, options([['', '—'], ...labelPairs(LABEL.finish)], md.finish), ' id="uvMFinish"'), 'wide')}
        ${winSide && winSide.wrestlers.filter(Boolean).length > 1 ? `${field('Won by (optional)', pickFrom(winSide.wrestlers.filter(Boolean), md.by, 'by', '—'))}
          ${field('Fall taken by (optional)', pickFrom(losers, md.on, 'on', '—'))}` : ''}
        ${winSide && winSide.wrestlers.filter(Boolean).length === 1 ? field('Who took the fall (optional)', pickFrom(losers, md.on, 'on', '—'), 'wide') : ''}
      </div>
      ${title && w != null ? `<label class="uv-check"><input id="uvMTitleChange" type="checkbox"${md.titleChange ? ' checked' : ''} onchange="uvMSet('titleChange',this.checked)">
        <span>The title changed hands — ${esc(label(winSide, w))} ${winSide.team || winSide.wrestlers.length > 1 ? 'are the new champions' : 'is the new champion'}</span></label>` : ''}
      ${linked ? `<div class="fine">This result made a title change. A different winner takes over that reign; unticking the box
        hands the belt back — as long as it hasn’t changed hands since.</div>` : ''}` : '';

  const buttons = {
    book: `<div class="uv-btn pri full" onclick="uvMSave(false)">Add to the card</div>
      <div class="uv-btn full" onclick="uvMSave(true)">Add, and enter its result</div>`,
    edit: `<div class="uv-btn pri full" onclick="uvMSave(false)">Save the booking</div>
      <div class="uv-btn bad full" onclick="uvMDelete()">Take it off the card</div>`,
    result: `<div class="uv-btn pri full" onclick="uvMSave(false)">Save the result</div>`,
    correct: `<div class="uv-btn pri full" onclick="uvMSave(false)">Save the correction</div>
      <div class="uv-btn full" onclick="uvMClear()">Clear the result — keep it booked</div>
      <div class="uv-btn bad full" onclick="uvMDelete()">Take it off the card</div>`,
  }[md.mode];

  const lineup = `
      ${md.mode === 'book' || md.mode === 'edit' ? `<div class="uv-pills tight">${PRESETS.map(([lb, sz]) =>
        `<div class="uv-pill${sz.join(',') === shape ? ' on' : ''}" onclick="uvMPreset('${sz.join(',')}')">${lb}</div>`).join('')}</div>` : ''}
      ${PRESETS.some(([, sz]) => sz.join(',') === shape) && md.mode !== 'result' && md.mode !== 'correct' ? ''
        : `<div class="uv-kindline">${kindChip({ sides: md.sides })}</div>`}
      ${sides}
      <div class="uv-add" onclick="uvMAddSide()">${ICON.plus}Add another side</div>
      <div class="uv-grid" style="margin-top:14px">
        ${field('Championship at stake', select(`uvMSet('titleId',this.value)`, titleOptions(st, md.titleId, 'None'), ' id="uvMTitle"'), 'wide')}
        ${field('Stipulation', `<input id="uvMStip" class="uv-in" maxlength="60" list="uvStips" value="${esc(md.stip)}" placeholder="e.g. Ladder"
          oninput="uvMText('stip',this.value)"><datalist id="uvStips">${STIPULATIONS.map(x => `<option value="${esc(x)}">`).join('')}</datalist>`, 'wide')}
      </div>
      ${title && cur && !champIn ? `<div class="fine">The current ${esc(title.name)} ${cur.holder.type === 'team' ? 'champions' : 'champion'}, ${esc(M.holderName(st, cur.holder))}, ${cur.holder.type === 'team' ? 'aren’t' : 'isn’t'} in this match.</div>` : ''}`;

  // entering a result: the match as booked on top, the result straight under it
  const summary = `<div class="uv-mc uv-mc-sum">
      <div class="uv-mc-top">${kindChip({ sides: md.sides })}${title ? chip(title.name, 'gold') : ''}${md.stip.trim() ? chip(md.stip.trim()) : ''}</div>
      <div class="uv-mc-body">${md.sides.map((sd, i) => `<b>${esc(label(sd, i))}</b>`).join(' <span class="uv-muted">vs</span> ')}</div>
    </div>`;

  return {
    title: TITLES[md.mode],
    body: `
      <p class="uv-p">${esc(e.name)} · ${esc(eventWhen(st, e))}${withResult ? ' — enter what the CPU produced. Nothing is filled in for you.' : ''}</p>
      ${md.lineup ? lineup : summary}
      ${result}
      ${md.lineup ? '' : `<div class="uv-add" onclick="uvMLineup()">${ICON.edit}Change the line-up, title or stipulation</div>`}
      <div style="margin-top:12px">${field(withResult ? 'What happened (optional)' : 'Notes (optional)',
        `<textarea id="uvMNotes" class="uv-in" rows="2" maxlength="2000" oninput="uvMText('notes',this.value)"
          placeholder="${withResult ? 'e.g. Run-in, botched finish, crowd went wild' : 'e.g. #1 contender’s match'}">${esc(md.notes)}</textarea>`, 'wide')}</div>
      ${buttons}`,
  };
}

// a new shape keeps whoever's already picked, in order, and drops the teams
export function uvMPreset(shape) {
  const sizes = shape.split(',').map(Number);
  const picked = md.sides.flatMap(s => s.wrestlers.filter(Boolean));
  let k = 0;
  md.sides = sizes.map(n => ({ team: '', wrestlers: Array.from({ length: n }, () => picked[k++] || '') }));
  resetResult();
  paintSheet();
}
export function uvMTeam(i, teamId) {
  const side = md.sides[i];
  side.team = teamId;
  const team = teamId && M.teamById(uni(), teamId);
  // picking the team fills in its line-up - unless the side already names
  // only its members (a trio sending two), which is left as it is
  const ids = side.wrestlers.filter(Boolean);
  if (team && (!ids.length || !ids.every(id => team.members.includes(id)))) side.wrestlers = [...team.members];
  paintSheet();
}
export function uvMWrestler(i, j, v) { md.sides[i].wrestlers[j] = v; checkFallPicks(); paintSheet(); }
export function uvMAddWrestler(i) { md.sides[i].wrestlers.push(''); paintSheet(); }
export function uvMDropWrestler(i, j) { md.sides[i].wrestlers.splice(j, 1); checkFallPicks(); paintSheet(); }
export function uvMAddSide() { md.sides.push(blankSide()); paintSheet(); }
export function uvMDropSide(i) { md.sides.splice(i, 1); resetResult(); paintSheet(); }
export function uvMSet(k, v) {
  md[k] = v;
  if (k === 'titleId' && !v) md.titleChange = false;
  if (k === 'result') { md.by = ''; md.on = ''; if (isNaN(Number(v)) || v === '') md.titleChange = false; }
  paintSheet();
}
export function uvMText(k, v) { md[k] = v; }
export function uvMLineup() { md.lineup = true; paintSheet(); }
// the line-up changed under the result: never leave a winner the owner didn't just pick
function resetResult() { md.result = ''; md.by = ''; md.on = ''; md.titleChange = false; }
function checkFallPicks() {
  const w = Number(md.result);
  if (md.result === '' || isNaN(w) || !md.sides[w]) return;
  if (md.by && !md.sides[w].wrestlers.includes(md.by)) md.by = '';
  if (md.on && !md.sides.some((s, i) => i !== w && s.wrestlers.includes(md.on))) md.on = '';
}

export function uvMSave(thenResult) {
  const d = md;
  const booking = {
    sides: d.sides.map(s => ({ team: s.team || null, wrestlers: s.wrestlers.filter(Boolean) })),
    titleId: d.titleId || null, stip: d.stip, notes: d.notes,
  };
  if (d.mode === 'book') {
    const r = commit(st => M.bookMatch(st, d.eventId, booking), 'Match booked');
    if (!r.ok) return;
    if (thenResult) uvEnterResult(d.eventId, r.value.id); else closeSheet();
    return;
  }
  if (d.mode === 'edit') {
    if (commit(st => M.updateBooking(st, d.eventId, d.matchId, booking), 'Booking saved').ok) closeSheet();
    return;
  }
  const isWin = d.result !== '' && !isNaN(Number(d.result));
  const input = {
    ...booking,
    outcome: d.result === '' ? '' : isWin ? 'win' : d.result,
    winner: isWin ? Number(d.result) : null,
    finish: d.finish, fall: { by: d.by || null, on: d.on || null },
  };
  const opts = { titleChange: !!(d.titleId && d.titleChange && isWin) };
  const r = commit(st => (d.mode === 'result' ? M.enterResult(st, d.eventId, d.matchId, input, opts)
    : M.updateMatch(st, d.eventId, d.matchId, input, opts)), m => {
    const st = uni();
    const reign = st.reigns.find(x => x.matchId === m.id);
    const saved = d.mode === 'result' ? 'Result saved' : 'Result corrected';
    if (!reign) return saved;
    return `${saved} — ${M.holderName(st, reign.holder)} ${reign.holder.type === 'team' ? 'hold' : 'holds'} the ${M.titleById(st, reign.titleId).name}`;
  });
  if (r.ok) closeSheet();
}

export function uvMClear() {
  const d = md;
  const st = uni();
  const linked = st.reigns.find(x => x.matchId === d.matchId);
  confirmThen('Clear this result?',
    'The match stays on the card, booked, as if it hadn’t been played yet. It comes off everyone’s record.'
    + (linked ? ` The ${M.titleById(st, linked.titleId).name} goes back to whoever held it before.` : ''),
    'Clear result', () => { if (commit(s => M.clearResult(s, d.eventId, d.matchId), 'Result cleared — booked again').ok) closeSheet(); });
}

export function uvMDelete() {
  const d = md;
  const st = uni();
  const m = matchOf(d.eventId, d.matchId);
  const linked = st.reigns.find(x => x.matchId === d.matchId);
  confirmThen('Take this match off the card?',
    (m.status === 'played' ? 'Its result comes off everyone’s record.' : 'It hasn’t been played, so nothing else changes.')
    + (linked ? ` The ${M.titleById(st, linked.titleId).name} goes back to whoever held it before.` : ''),
    'Take it off', () => { if (commit(s => M.deleteMatch(s, d.eventId, d.matchId), 'Match removed').ok) closeSheet(); });
}

// ================================================================ season dates

export function uvSeasonDates(id) {
  openSheet(() => {
    const s = M.seasonById(uni(), id);
    if (!s) return null;
    return {
      title: 'Season dates',
      body: `
        <p class="uv-p">Pin ${esc(s.name)} to the calendar so every show gets a date — match it to your WWE 2K25 Universe
          calendar. Pick any day in week 1; weeks run Monday to Sunday.</p>
        ${field('Week 1 includes', `<input id="uvSeasonStart" class="uv-in" type="date" value="${esc(s.start || '')}">`, 'wide')}
        ${s.start ? `<p class="uv-p">Week 1 is the week of ${esc(isoText(M.calendarDate(uni(), id, 1, 0)))}.</p>` : ''}
        <div class="uv-btn pri full" onclick="uvSaveSeasonStart('${id}')">Save</div>
        ${s.start ? `<div class="uv-btn full" onclick="uvClearSeasonStart('${id}')">Go back to plain weeks</div>` : ''}`,
    };
  });
}
export function uvSaveSeasonStart(id) {
  const v = document.getElementById('uvSeasonStart').value;
  if (!v) { toast('Pick a date first.', true); return; }
  if (commit(st => M.setSeasonStart(st, id, v), 'Dates set').ok) closeSheet();
}
export function uvClearSeasonStart(id) {
  if (commit(st => M.setSeasonStart(st, id, ''), 'Back to plain weeks').ok) closeSheet();
}

