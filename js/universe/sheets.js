// WWE Universe — the bottom sheets for creating things, and for events and
// their results: add wrestlers, new team, new title, seasons, events, and the
// result form (which records a new result or corrects one in place).
//
// Form sheets keep a draft here until the owner saves it, so a save that's
// refused keeps everything they typed. Profiles and their edits live in
// pages.js and edits.js.
import * as M from './model.js';
import {
  ICON, LABEL, empty, esc, field, labelPairs, matchLine, matchMeta, options, select,
  showColor, showName, showPairs, teamOptions, titleOptions, wrestlerOptions,
} from './ui.js';
import { closeSheet, commit, confirmThen, focusField, openSheet, paintSheet, toast, uni } from './app.js';
import { uvFollowActiveSeason, uvRosterShow } from './views.js';
import { uvOpenTeam, uvOpenTitle } from './pages.js';

const none = text => `<div class="uv-none">${esc(text)}</div>`;
const alignPairs = () => [['', 'Not set'], ...labelPairs(LABEL.alignment)];

// ---------------------------------------------------------------- add wrestlers

let add = null;

export function uvAddWrestler() {
  add = { mode: 'one', name: '', list: '', showId: uvRosterShow(), origin: 'WWE', gender: 'male', alignment: '', result: '' };
  openSheet(addSheet);
  focusField('uvAddName');
}

function addSheet() {
  const st = uni();
  const d = add;
  const seg = (k, lb) => `<div class="${d.mode === k ? 'on' : ''}" onclick="uvAddMode('${k}')">${lb}</div>`;
  const main = d.mode === 'one'
    ? field('Name', `<input id="uvAddName" class="uv-in" maxlength="60" value="${esc(d.name)}" placeholder="e.g. Cody Rhodes"
        oninput="uvAddSet('name',this.value)" onkeydown="if(event.key==='Enter')uvAddSave()">`, 'wide')
    : field('Names — one per line', `<textarea id="uvAddList" class="uv-in" rows="7" oninput="uvAddSet('list',this.value)"
        placeholder="Cody Rhodes&#10;Kenny Omega&#10;Iyo Sky">${esc(d.list)}</textarea>`, 'wide');
  return {
    title: 'Add wrestlers',
    body: `
      <div class="uv-seg">${seg('one', 'One at a time')}${seg('list', 'Paste a list')}</div>
      ${main}
      <p class="uv-p">${d.mode === 'one'
        ? 'These stay set between adds, so a whole show goes in quickly.'
        : 'Everyone in the list gets these details. Change any of them afterwards.'}</p>
      <div class="uv-grid">
        ${field('Show', select(`uvAddSet('showId',this.value)`, options(showPairs(st, 'Unassigned'), d.showId)))}
        ${field('Comes from', select(`uvAddSet('origin',this.value)`, options(labelPairs(LABEL.origin), d.origin)))}
        ${field('Division', select(`uvAddSet('gender',this.value)`, options(labelPairs(LABEL.gender), d.gender)))}
        ${field('Alignment', select(`uvAddSet('alignment',this.value)`, options(alignPairs(), d.alignment)))}
      </div>
      ${d.result ? `<div class="uv-note warn">${esc(d.result)}</div>` : ''}
      <div class="uv-btn pri full" onclick="uvAddSave()">${d.mode === 'one' ? 'Add wrestler' : 'Add everyone'}</div>`,
  };
}

export function uvAddSet(k, v) { if (add) add[k] = v; }
export function uvAddMode(mode) {
  add.mode = mode;
  add.result = '';
  paintSheet();
  focusField(mode === 'one' ? 'uvAddName' : 'uvAddList');
}
export function uvAddSave() {
  const d = add;
  if (!d) return;
  const shared = { showId: d.showId, origin: d.origin, gender: d.gender, alignment: d.alignment };
  if (d.mode === 'one') {
    const r = commit(st => M.addWrestler(st, { ...shared, name: d.name }),
      w => `Added ${w.name}${w.showId ? ` to ${showName(uni(), w.showId)}` : ''}`);
    if (r.ok) { d.name = ''; paintSheet(); focusField('uvAddName'); }
    return;
  }
  const names = d.list.split('\n').filter(n => n.trim());
  if (!names.length) { toast('Paste at least one name.', true); return; }
  const r = commit(st => M.addWrestlers(st, names, shared),
    res => `Added ${res.added.length} wrestler${res.added.length === 1 ? '' : 's'}`);
  if (!r.ok) return;
  const skipped = r.value.skipped;
  d.list = skipped.map(s => s.name).join('\n');     // leave only what didn't go in
  d.result = skipped.length ? `Not added (left in the box): ${skipped.map(s => s.reason).join(' ')}` : '';
  paintSheet();
}

// ================================================================ tag teams

let teamDraft = null;

export function uvNewTeam() {
  teamDraft = { name: '', members: ['', ''] };
  openSheet(newTeamSheet);
  focusField('uvTeamName');
}

function newTeamSheet() {
  const st = uni();
  const d = teamDraft;
  if (st.wrestlers.length < 2) {
    return { title: 'New tag team', body: empty(ICON.team, 'Add wrestlers first', 'A tag team needs at least two wrestlers on the roster.') };
  }
  return {
    title: 'New tag team',
    body: `
      ${field('Team name', `<input id="uvTeamName" class="uv-in" maxlength="60" value="${esc(d.name)}" placeholder="e.g. The New Day"
        oninput="uvTeamDraftName(this.value)">`, 'wide')}
      <h4>Members</h4>
      ${d.members.map((m, i) => `<div class="uv-pick">${select(`uvTeamDraftMember(${i},this.value)`, wrestlerOptions(st, m))}
        ${d.members.length > 2 ? `<div class="uv-ic sm" onclick="uvTeamDraftDrop(${i})">${ICON.x}</div>` : ''}</div>`).join('')}
      <div class="uv-add" onclick="uvTeamDraftAdd()">${ICON.plus}Add a member</div>
      <div class="uv-btn pri full" onclick="uvCreateTeam()">Create team</div>`,
  };
}

export function uvTeamDraftName(v) { teamDraft.name = v; }
export function uvTeamDraftMember(i, v) { teamDraft.members[i] = v; }
export function uvTeamDraftAdd() { teamDraft.members.push(''); paintSheet(); }
export function uvTeamDraftDrop(i) { teamDraft.members.splice(i, 1); paintSheet(); }
export function uvCreateTeam() {
  const d = teamDraft;
  const r = commit(st => M.addTeam(st, { name: d.name, members: d.members }), t => `${t.name} formed`);
  if (r.ok) uvOpenTeam(r.value.id);
}

// ================================================================ championships

let titleDraft = null;

export function uvNewTitle() {
  titleDraft = { name: '', showId: '', kind: 'singles', division: 'open' };
  openSheet(newTitleSheet);
  focusField('uvTitleName');
}

function newTitleSheet() {
  const st = uni();
  const d = titleDraft;
  const set = k => `uvTitleDraft('${k}',this.value)`;
  return {
    title: 'New championship',
    body: `
      ${field('Name', `<input id="uvTitleName" class="uv-in" maxlength="60" value="${esc(d.name)}"
        placeholder="e.g. Intercontinental Championship" oninput="${set('name')}">`, 'wide')}
      <div class="uv-grid" style="margin-top:10px">
        ${field('Show', select(set('showId'), options(showPairs(st, 'No brand'), d.showId)), 'wide')}
        ${field('Type', select(set('kind'), options(labelPairs(LABEL.kind), d.kind)))}
        ${field('Division', select(set('division'), options(labelPairs(LABEL.division), d.division)))}
      </div>
      <div class="uv-btn pri full" onclick="uvCreateTitle()">Create championship</div>`,
  };
}

export function uvTitleDraft(k, v) { titleDraft[k] = v; }
export function uvCreateTitle() {
  const r = commit(st => M.addTitle(st, titleDraft), t => `${t.name} created`);
  if (r.ok) uvOpenTitle(r.value.id);
}

// ================================================================ seasons

export function uvStepWeek(d) {
  const week = M.activeSeason(uni()).week + d;
  if (week < 1) return;
  commit(st => M.setWeek(st, week), `Week ${week}`);
}
export function uvNextSeason() {
  const st = uni();
  const cur = M.activeSeason(st);
  const next = Math.max(...st.seasons.map(s => s.number)) + 1;
  confirmThen(`Start Season ${next}?`,
    `${cur.name} ends at week ${cur.week}. Rosters, tag teams and champions all carry over; its events stay in the history.`,
    `Start Season ${next}`, () => {
      uvFollowActiveSeason();
      commit(s => M.startNextSeason(s), s => `${s.name} has begun`);
    });
}
export function uvRenameSeason(id) {
  openSheet(() => {
    const s = M.seasonById(uni(), id);
    if (!s) return null;
    return {
      title: 'Rename season',
      body: `${field('Name', `<input id="uvSeasonName" class="uv-in" maxlength="60" value="${esc(s.name)}"
          placeholder="Season ${s.number}" onkeydown="if(event.key==='Enter')uvSaveSeasonName('${id}')">`, 'wide')}
        <p class="uv-p">Leave it empty to go back to “Season ${s.number}”.</p>
        <div class="uv-btn pri full" onclick="uvSaveSeasonName('${id}')">Save</div>`,
    };
  });
  focusField('uvSeasonName');
}
export function uvSaveSeasonName(id) {
  const v = document.getElementById('uvSeasonName').value;
  if (commit(st => M.renameSeason(st, id, v), 'Season renamed').ok) closeSheet();
}

// ================================================================ events

let eventDraft = null;

export function uvNewEvent() {
  const st = uni();
  eventDraft = { kind: 'weekly', showId: st.shows[0].id, week: String(M.activeSeason(st).week), name: '' };
  openSheet(newEventSheet);
}

function newEventSheet() {
  const st = uni();
  const d = eventDraft;
  const seg = (k, lb) => `<div class="${d.kind === k ? 'on' : ''}" onclick="uvEventKind('${k}')">${lb}</div>`;
  const auto = d.kind === 'weekly' && d.showId ? `${showName(st, d.showId)} · Week ${d.week || '?'}` : 'e.g. WrestleMania';
  return {
    title: 'New event',
    body: `
      <div class="uv-seg">${seg('weekly', 'Weekly show')}${seg('ple', 'Premium live event')}</div>
      <div class="uv-grid">
        ${field('Show', select(`uvEventDraft('showId',this.value)`, options(showPairs(st, d.kind === 'ple' ? 'All shows' : ''), d.showId)))}
        ${field('Week', `<input class="uv-in" type="number" min="1" max="999" inputmode="numeric" value="${esc(d.week)}"
          onchange="uvEventDraft('week',this.value)">`)}
        ${field(d.kind === 'ple' ? 'Name' : 'Name (optional)', `<input id="uvEventName" class="uv-in" maxlength="60" value="${esc(d.name)}"
          placeholder="${esc(auto)}" oninput="uvEventDraftName(this.value)">`, 'wide')}
      </div>
      <div class="uv-btn pri full" onclick="uvCreateEvent()">Create event</div>`,
  };
}

export function uvEventKind(k) {
  eventDraft.kind = k;
  if (k === 'weekly' && !eventDraft.showId) eventDraft.showId = uni().shows[0].id;
  paintSheet();
}
export function uvEventDraft(k, v) { eventDraft[k] = v; paintSheet(); }
export function uvEventDraftName(v) { eventDraft.name = v; }
export function uvCreateEvent() {
  const d = eventDraft;
  const r = commit(st => M.addEvent(st, { kind: d.kind, showId: d.showId, week: d.week, name: d.name }), e => `${e.name} added`);
  if (r.ok) uvOpenEvent(r.value.id);
}

export function uvOpenEvent(id) {
  openSheet(() => {
    const st = uni();
    const e = M.eventById(st, id);
    if (!e) return null;
    const season = M.seasonById(st, e.at.season);
    const changed = st.reigns.filter(r => r.eventId === id);
    const set = k => `uvSetEvent('${id}','${k}',this.value)`;
    const results = e.matches.map((m, i) => {
      const reign = st.reigns.find(r => r.matchId === m.id);
      const meta = matchMeta(st, m, reign);
      return `<div class="uv-match" onclick="uvEditResult('${id}','${m.id}')"><span class="i">${i + 1}</span><div class="b"><div>${matchLine(st, m)}</div>
        ${meta ? `<div class="uv-muted d">${meta}</div>` : ''}${m.notes ? `<div class="uv-muted d">${esc(m.notes)}</div>` : ''}</div>
        <span class="uv-chev">${ICON.edit}</span></div>`;
    }).join('');

    return {
      title: esc(e.name),
      body: `
        <div class="uv-hero"><span class="uv-av lg sq" style="--c:${showColor(st, e.showId)}">${ICON.cal}</span><div>
          <div class="k">${esc(LABEL.event[e.kind])}</div>
          <div class="s">${esc(e.showId ? showName(st, e.showId) : 'All shows')} · ${esc(season.name)} · Week ${e.at.week}</div></div></div>

        <h4>Results${e.matches.length ? ` · ${e.matches.length}` : ''}</h4>
        ${results ? results + '<div class="fine">Tap a result to correct it. It’s changed in place — nothing else on the card moves.</div>'
          : none('No results recorded yet.')}
        <div class="uv-btn pri full" onclick="uvRecordResult('${id}')">${ICON.plus}Record a result</div>

        <h4>Details</h4>
        ${field('Name', `<input class="uv-in" maxlength="60" value="${esc(e.name)}" onchange="${set('name')}">`, 'wide')}
        <div class="uv-grid" style="margin-top:10px">
          ${field('Show', select(set('showId'), options(showPairs(st, e.kind === 'ple' ? 'All shows' : ''), e.showId || '')))}
          ${field('Week', `<input class="uv-in" type="number" min="1" max="999" inputmode="numeric" value="${e.at.week}" onchange="${set('week')}">`)}
          ${field('Notes', `<textarea class="uv-in" rows="2" maxlength="2000" onchange="${set('notes')}">${esc(e.notes)}</textarea>`, 'wide')}
        </div>
        ${changed.length ? `<div class="fine">A title changed hands here, so a new week moves that title change with it — as long as the title’s history still reads in order.</div>` : ''}
        <div class="uv-btn bad full" onclick="uvDeleteEvent('${id}')">Delete event</div>`,
    };
  });
}

export function uvSetEvent(id, key, value) { commit(st => M.updateEvent(st, id, { [key]: value }), 'Saved'); }
export function uvDeleteEvent(id) {
  const st = uni();
  const e = M.eventById(st, id);
  const n = e.matches.length;
  const titles = st.reigns.filter(r => r.eventId === id).map(r => M.titleById(st, r.titleId).name);
  confirmThen(`Delete ${e.name}?`,
    (n ? `Its ${n} recorded result${n === 1 ? '' : 's'} will be deleted with it.` : 'It has no results yet.')
    + (titles.length ? ` The ${titles.join(' and the ')} will go back to whoever held ${titles.length === 1 ? 'it' : 'them'} before.` : ''),
    'Delete', () => { if (commit(s => M.deleteEvent(s, id), `${e.name} deleted`).ok) closeSheet(); });
}

// ---------------------------------------------------------------- record or correct a result

let md = null;
const blankSide = () => ({ team: '', wrestlers: [''] });

export function uvRecordResult(eventId) {
  md = { eventId, matchId: null, sides: [blankSide(), blankSide()], result: '0', finish: '', titleId: '', titleChange: false, stip: '', notes: '' };
  openSheet(matchSheet);
}

/** Open a recorded result in the same form, filled in, to correct it in place. */
export function uvEditResult(eventId, matchId) {
  const st = uni();
  const m = M.eventById(st, eventId).matches.find(x => x.id === matchId);
  md = {
    eventId, matchId,
    sides: m.sides.map(sd => ({ team: sd.team || '', wrestlers: [...sd.wrestlers] })),
    result: m.outcome === 'win' ? String(m.winner) : m.outcome,
    finish: m.finish || '', titleId: m.titleId || '', titleChange: st.reigns.some(r => r.matchId === matchId),
    stip: m.stip, notes: m.notes,
  };
  openSheet(matchSheet);
}

// Registered teams a side could be wrestling as: every wrestler on the side
// is currently on the team. Offered, never assumed - it decides whose record
// the match goes on.
function teamGuesses(st, side) {
  const ids = side.wrestlers.filter(Boolean);
  if (side.team || ids.length < 2) return [];
  return st.teams.filter(t => t.active && ids.every(id => t.members.includes(id)));
}

function matchSheet() {
  const st = uni();
  const e = M.eventById(st, md.eventId);
  if (!e) return null;
  const editing = !!md.matchId;
  if (editing && !e.matches.some(m => m.id === md.matchId)) return null;
  if (st.wrestlers.length < 2) {
    return { title: 'Record a result', body: empty(ICON.user, 'Add wrestlers first', 'A match needs at least two wrestlers on the roster.') };
  }
  const label = (s, i) => {
    const team = s.team && M.teamById(st, s.team);
    const ids = s.wrestlers.filter(Boolean);
    return team ? team.name : ids.length ? ids.map(id => M.wrestlerById(st, id).name).join(' & ') : `Side ${i + 1}`;
  };
  const resultPairs = [...md.sides.map((s, i) => [String(i), `${label(s, i)} won`]), ['draw', 'Draw'], ['nc', 'No contest']];
  const title = md.titleId ? M.titleById(st, md.titleId) : null;
  const linked = editing ? st.reigns.find(r => r.matchId === md.matchId) : null;
  const hasTeams = st.teams.some(t => t.active) || md.sides.some(s => s.team);

  const sides = md.sides.map((s, i) => `<div class="uv-sidebox">
      <div class="h"><span>Side ${i + 1}</span>${md.sides.length > 2 ? `<span class="uv-link" onclick="uvMDropSide(${i})">Remove</span>` : ''}</div>
      ${hasTeams ? `<div class="uv-pick">${select(`uvMTeam(${i},this.value)`, teamOptions(st, s.team, 'Not as a tag team'))}</div>` : ''}
      ${s.wrestlers.map((w, j) => `<div class="uv-pick">${select(`uvMWrestler(${i},${j},this.value)`, wrestlerOptions(st, w))}
        ${s.wrestlers.length > 1 ? `<div class="uv-ic sm" onclick="uvMDropWrestler(${i},${j})">${ICON.x}</div>` : ''}</div>`).join('')}
      ${teamGuesses(st, s).map(t => `<div class="uv-hint" onclick="uvMTeam(${i},'${t.id}')">Wrestling as <b>${esc(t.name)}</b>?
        <span>Tap so it counts on their team record</span></div>`).join('')}
      <div class="uv-add" onclick="uvMAddWrestler(${i})">${ICON.plus}Add a partner</div>
    </div>`).join('');

  return {
    title: editing ? 'Correct a result' : 'Record a result',
    body: `
      <p class="uv-p">${esc(e.name)} — ${editing ? 'change whatever was entered wrong. It’s corrected in place: its spot on the card stays, and nothing else changes.'
        : 'enter what happened in the game.'}</p>
      ${linked ? `<div class="uv-note">This result changed the <b>${esc(M.titleById(st, linked.titleId).name)}</b>. Pick a different winner and
        that reign moves to them; untick the box and the belt goes back to the previous champion — as long as it hasn’t changed hands since.</div>` : ''}
      ${sides}
      <div class="uv-add" onclick="uvMAddSide()">${ICON.plus}Add another side</div>
      <div class="uv-grid" style="margin-top:14px">
        ${field('Result', select(`uvMSet('result',this.value)`, options(resultPairs, md.result)), 'wide')}
        ${field('Finish', select(`uvMSet('finish',this.value)`, options([['', '—'], ...labelPairs(LABEL.finish)], md.finish)))}
        ${field('Stipulation', `<input class="uv-in" maxlength="60" value="${esc(md.stip)}" placeholder="e.g. Ladder"
          oninput="uvMText('stip',this.value)">`)}
        ${field('Championship', select(`uvMSet('titleId',this.value)`, titleOptions(st, md.titleId)), 'wide')}
      </div>
      ${title ? `<label class="uv-check"><input type="checkbox"${md.titleChange ? ' checked' : ''} onchange="uvMSet('titleChange',this.checked)">
        <span>The title changed hands — the winner${title.kind === 'tag' ? 's are the new champions' : ' is the new champion'}</span></label>` : ''}
      ${field('Notes', `<input class="uv-in" maxlength="2000" value="${esc(md.notes)}" oninput="uvMText('notes',this.value)">`, 'wide')}
      <div class="uv-btn pri full" onclick="uvSaveResult()">${editing ? 'Save correction' : 'Save result'}</div>
      ${editing ? `<div class="uv-btn bad full" onclick="uvDeleteResult()">Delete this result</div>` : ''}`,
  };
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
export function uvMWrestler(i, j, v) { md.sides[i].wrestlers[j] = v; paintSheet(); }
export function uvMAddWrestler(i) { md.sides[i].wrestlers.push(''); paintSheet(); }
export function uvMDropWrestler(i, j) { md.sides[i].wrestlers.splice(j, 1); paintSheet(); }
export function uvMAddSide() { md.sides.push(blankSide()); paintSheet(); }
export function uvMDropSide(i) {
  md.sides.splice(i, 1);
  const w = Number(md.result);
  if (Number.isInteger(w)) md.result = w === i ? '0' : String(w > i ? w - 1 : w);
  paintSheet();
}
export function uvMSet(k, v) {
  md[k] = v;
  if (k === 'titleId' && !v) md.titleChange = false;
  paintSheet();
}
export function uvMText(k, v) { md[k] = v; }

export function uvSaveResult() {
  const d = md;
  const outcome = d.result === 'draw' || d.result === 'nc' ? d.result : 'win';
  const input = {
    sides: d.sides.map(s => ({ team: s.team || null, wrestlers: s.wrestlers.filter(Boolean) })),
    outcome, winner: outcome === 'win' ? Number(d.result) : null,
    finish: d.finish, titleId: d.titleId || null, stip: d.stip, notes: d.notes,
  };
  const opts = { titleChange: !!(d.titleId && d.titleChange) };
  const r = commit(st => (d.matchId ? M.updateMatch(st, d.eventId, d.matchId, input, opts) : M.recordMatch(st, d.eventId, input, opts)), m => {
    const st = uni();
    const reign = st.reigns.find(x => x.matchId === m.id);
    const saved = d.matchId ? 'Result corrected' : 'Result saved';
    if (!reign) return saved;
    const verb = reign.holder.type === 'team' ? 'hold' : 'holds';
    return `${saved} — ${M.holderName(st, reign.holder)} ${verb} the ${M.titleById(st, reign.titleId).name}`;
  });
  if (r.ok) uvOpenEvent(d.eventId);
}

export function uvDeleteResult() {
  const d = md;
  const st = uni();
  const linked = st.reigns.find(x => x.matchId === d.matchId);
  confirmThen('Delete this result?',
    'It’s removed from the event and from everyone’s record.'
    + (linked ? ` The ${M.titleById(st, linked.titleId).name} goes back to whoever held it before.` : ''),
    'Delete', () => { if (commit(s => M.deleteMatch(s, d.eventId, d.matchId), 'Result deleted').ok) uvOpenEvent(d.eventId); });
}
