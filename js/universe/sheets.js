// WWE Universe — the bottom sheets: every place something is created or edited.
//
// Two kinds. Record sheets (a wrestler, team, title, event) render straight
// from the universe and save each field as it changes. Form sheets (add
// wrestlers, new team, record a result...) keep a draft here until the owner
// saves it, so a rejected save keeps what they typed.
import * as M from './model.js';
import {
  ICON, LABEL, avatar, empty, esc, field, labelPairs, matchLine, matchMeta, options, select,
  showColor, showName, showPairs, stampLabel, teamOptions, titleOptions, wrestlerOptions,
} from './ui.js';
import { closeSheet, commit, confirmThen, focusField, openSheet, paintSheet, toast, uni } from './app.js';
import { uvFollowActiveSeason, uvHolderLink, uvRosterShow } from './views.js';

const fine = text => `<div class="fine">${esc(text)}</div>`;
const none = text => `<div class="uv-none">${esc(text)}</div>`;
const eventName = (st, id) => (M.eventById(st, id) || { name: '(deleted event)' }).name;
const alignPairs = () => [['', 'Not set'], ...labelPairs(LABEL.alignment)];

// ================================================================ wrestlers

export function uvOpenWrestler(id) {
  openSheet(() => {
    const st = uni();
    const w = M.wrestlerById(st, id);
    if (!w) return null;
    const set = k => `uvSetWrestler('${id}','${k}',this.value)`;
    const held = M.titlesOfWrestler(st, id);
    const teams = M.teamsOf(st, id);
    const matches = M.matchesOf(st, id);
    const moves = M.movesOf(st, id).reverse();
    const refs = M.wrestlerRefs(st, id);
    const facts = [w.origin, LABEL.gender[w.gender], w.alignment && LABEL.alignment[w.alignment],
      w.status === 'injured' && 'Injured'].filter(Boolean).join(' · ');

    return {
      title: esc(w.name),
      body: `
        <div class="uv-hero">${avatar(st, w, 'lg')}<div>
          <div class="k" style="color:${showColor(st, w.showId)}">${esc(showName(st, w.showId))}</div>
          <div class="s">${esc(facts)}</div></div></div>
        <div class="uv-grid">
          ${field('Show', select(`uvAssign('${id}',this.value)`, options(showPairs(st, 'Unassigned'), w.showId || '')))}
          ${field('Status', select(set('status'), options(labelPairs(LABEL.status), w.status)))}
          ${field('Name', `<input class="uv-in" maxlength="60" value="${esc(w.name)}" onchange="${set('name')}">`, 'wide')}
          ${field('Gender', select(set('gender'), options(labelPairs(LABEL.gender), w.gender)))}
          ${field('Comes from', select(set('origin'), options(labelPairs(LABEL.origin), w.origin)))}
          ${field('Alignment', select(set('alignment'), options(alignPairs(), w.alignment || '')))}
          ${field('Notes', `<textarea class="uv-in" rows="2" maxlength="2000" onchange="${set('notes')}">${esc(w.notes)}</textarea>`, 'wide')}
        </div>

        <h4>Championships</h4>
        ${held.length ? held.map(h => `<div class="uv-li" onclick="uvOpenTitle('${h.title.id}')">${ICON.belt}
          <span>${esc(h.title.name)}${h.team ? ` <span class="uv-muted">with ${esc(h.team.name)}</span>` : ''}</span></div>`).join('')
          : none('None right now.')}

        <h4>Tag teams</h4>
        ${teams.length ? teams.map(t => `<div class="uv-li" onclick="uvOpenTeam('${t.id}')">${ICON.team}
          <span>${esc(t.name)}${t.active ? '' : ' <span class="uv-muted">(disbanded)</span>'}</span></div>`).join('')
          : none('Not on a team.')}

        <h4>Matches${matches.length ? ` · ${matches.length}` : ''}</h4>
        ${matches.length ? matches.slice(0, 30).map(x => {
          const r = M.resultFor(x.match, x.side);
          return `<div class="uv-li" onclick="uvOpenEvent('${x.event.id}')"><span class="uv-res ${r}">${r}</span>
            <span>${matchLine(st, x.match)}<span class="uv-muted d">${esc(x.event.name)} · ${stampLabel(st, x.event.at)}</span></span></div>`;
        }).join('') : none('No results recorded yet.')}

        <h4>Roster history</h4>
        ${moves.length ? moves.map(m => `<div class="uv-li plain"><span class="w">${stampLabel(st, m.at)}</span>
          <span>${m.from ? `${esc(showName(st, m.from))} → ` : 'Joined '}${esc(showName(st, m.to))}${m.note ? ` <span class="uv-muted">— ${esc(m.note)}</span>` : ''}</span></div>`).join('')
          : none('Never assigned to a show.')}

        ${refs.length ? fine(`${w.name} is part of the history (${refs.join(', ')}), so they can't be deleted. Leave them unassigned instead.`)
          : `<div class="uv-btn bad full" onclick="uvDeleteWrestler('${id}')">Delete wrestler</div>`}`,
    };
  });
}

export function uvSetWrestler(id, key, value) {
  commit(st => M.updateWrestler(st, id, { [key]: value }));
}
export function uvAssign(id, showId) {
  commit(st => M.assignWrestler(st, id, showId),
    mv => mv && `${M.wrestlerById(uni(), id).name} → ${showName(uni(), mv.to)}`);
}
export function uvDeleteWrestler(id) {
  const w = M.wrestlerById(uni(), id);
  confirmThen(`Delete ${w.name}?`, 'They have no history yet, so nothing else changes. Use this for someone added by mistake.', 'Delete',
    () => { if (commit(st => M.deleteWrestler(st, id), `${w.name} deleted`).ok) closeSheet(); });
}

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
        ${field('Gender', select(`uvAddSet('gender',this.value)`, options(labelPairs(LABEL.gender), d.gender)))}
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

export function uvOpenTeam(id) {
  openSheet(() => {
    const st = uni();
    const t = M.teamById(st, id);
    if (!t) return null;
    const shows = M.teamShows(st, t);
    const reigns = st.reigns.filter(r => r.holder.type === 'team' && r.holder.id === id)
      .sort((a, b) => b.start.seq - a.start.seq);
    const refs = M.teamRefs(st, id);
    const memberPick = (m, i) => `<div class="uv-pick">${select(`uvSetTeamMember('${id}',${i},this.value)`, wrestlerOptions(st, m))}
      ${t.members.length > 2 ? `<div class="uv-ic sm" onclick="uvDropTeamMember('${id}',${i})">${ICON.x}</div>` : ''}</div>`;

    return {
      title: esc(t.name),
      body: `
        <div class="uv-hero"><span class="uv-av lg sq">${ICON.team}</span><div>
          <div class="k">${t.active ? 'Active' : 'Disbanded'}</div>
          <div class="s">Formed ${stampLabel(st, t.formed)}${t.disbanded ? ` · disbanded ${stampLabel(st, t.disbanded)}` : ''}</div></div></div>
        ${shows.length > 1 ? `<div class="uv-note warn">The members are on different shows: ${shows.map(s => esc(showName(st, s))).join(', ')}.</div>` : ''}
        ${field('Team name', `<input class="uv-in" maxlength="60" value="${esc(t.name)}" onchange="uvSetTeamName('${id}',this.value)">`, 'wide')}

        <h4>Members</h4>
        ${t.members.map(memberPick).join('')}
        <div class="uv-pick">${select(`uvAddTeamMember('${id}',this.value)`, wrestlerOptions(st, '', '+ Add a member'))}</div>

        <h4>Title reigns</h4>
        ${reigns.length ? reigns.map(r => reignLi(st, r, 'title')).join('') : none('No title reigns yet.')}

        <div class="uv-btn full" onclick="uvTeamActive('${id}',${!t.active})">${t.active ? 'Disband team' : 'Reunite team'}</div>
        ${refs.length ? fine(`${t.name} are part of the history (${refs.join(', ')}), so they can't be deleted. Disband them instead.`)
          : `<div class="uv-btn bad full" onclick="uvDeleteTeam('${id}')">Delete team</div>`}`,
    };
  });
}

const withMembers = (id, fn) => st => {
  const members = [...M.teamById(st, id).members];
  fn(members);
  return M.updateTeam(st, id, { members });
};
export function uvSetTeamName(id, v) { commit(st => M.updateTeam(st, id, { name: v })); }
export function uvSetTeamMember(id, i, v) { commit(withMembers(id, m => { m[i] = v; })); }
export function uvDropTeamMember(id, i) { commit(withMembers(id, m => { m.splice(i, 1); })); }
export function uvAddTeamMember(id, v) { if (v) commit(withMembers(id, m => { m.push(v); })); }
export function uvTeamActive(id, active) {
  commit(st => M.setTeamActive(st, id, active), t => `${t.name} ${active ? 'reunited' : 'disbanded'}`);
}
export function uvDeleteTeam(id) {
  const t = M.teamById(uni(), id);
  confirmThen(`Delete ${t.name}?`, 'They have no history yet. Use this for a team added by mistake.', 'Delete',
    () => { if (commit(st => M.deleteTeam(st, id), `${t.name} deleted`).ok) closeSheet(); });
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

function reignLi(st, r, show) {
  const who = show === 'title' ? `<span class="uv-link" onclick="uvOpenTitle('${r.titleId}')">${esc((M.titleById(st, r.titleId) || {}).name || '?')}</span>`
    : uvHolderLink(st, r.holder);
  const span = `${stampLabel(st, r.start)} → ${r.end ? stampLabel(st, r.end) + (r.vacated ? ' (vacated)' : '') : 'now'}`;
  const where = r.eventId ? ` · ${esc(eventName(st, r.eventId))}` : '';
  return `<div class="uv-li plain">${ICON.belt}<span>${who}<span class="uv-muted d">${span}${where}</span></span></div>`;
}

export function uvOpenTitle(id) {
  openSheet(() => {
    const st = uni();
    const t = M.titleById(st, id);
    if (!t) return null;
    const cur = M.currentReign(st, id);
    const reigns = M.titleReigns(st, id).reverse();
    const refs = M.titleRefs(st, id);
    const set = k => `uvSetTitle('${id}','${k}',this.value)`;
    const pool = t.kind === 'tag' ? teamOptions(st, '', '— Pick the new champions —') : wrestlerOptions(st, '', '— Pick the new champion —');

    return {
      title: esc(t.name),
      body: `
        <div class="uv-champ-card" style="--c:${showColor(st, t.showId)}">
          <div class="k">${!t.active ? 'Retired' : cur ? (t.kind === 'tag' ? 'Champions' : 'Champion') : 'Vacant'}</div>
          <div class="h">${cur ? uvHolderLink(st, cur.holder) : '—'}</div>
          ${cur ? `<div class="s">Since ${stampLabel(st, cur.start)}${cur.eventId ? ` · ${esc(eventName(st, cur.eventId))}` : ''}</div>` : ''}
          <div class="s">${esc(showName(st, t.showId, 'No brand'))} · ${esc(LABEL.division[t.division])} · ${esc(LABEL.kind[t.kind])}</div>
        </div>

        ${t.active ? `
          <h4>Crown a new champion</h4>
          <div class="uv-pick"><select id="uvCrownPick" class="uv-in">${pool}</select>
            <div class="uv-btn pri" onclick="uvCrown('${id}')">Crown</div></div>
          <p class="uv-p">When a title changes hands on a show, record the result on that event instead, so the reign is dated to it.</p>` : ''}
        ${cur || reigns.length ? `<div class="uv-row2">
          ${cur ? `<div class="uv-btn" onclick="uvVacate('${id}')">Vacate</div>` : ''}
          ${reigns.length ? `<div class="uv-btn" onclick="uvUndoTitle('${id}')">Undo last change</div>` : ''}</div>` : ''}

        <h4>Title history${reigns.length ? ` · ${reigns.length} reign${reigns.length === 1 ? '' : 's'}` : ''}</h4>
        ${reigns.length ? reigns.map(r => reignLi(st, r, 'holder')).join('') : none('Never held.')}

        <h4>Details</h4>
        ${field('Name', `<input class="uv-in" maxlength="60" value="${esc(t.name)}" onchange="${set('name')}">`, 'wide')}
        <div class="uv-grid" style="margin-top:10px">
          ${field('Show', select(set('showId'), options(showPairs(st, 'No brand'), t.showId || '')), 'wide')}
          ${field('Division', select(set('division'), options(labelPairs(LABEL.division), t.division)))}
          ${field('Type', select(set('kind'), options(labelPairs(LABEL.kind), t.kind), reigns.length ? ' disabled' : ''))}
        </div>
        <div class="uv-btn full" onclick="uvRetireTitle('${id}',${!t.active})">${t.active ? 'Retire title' : 'Bring title back'}</div>
        ${refs.length ? fine(`The ${t.name} has history (${refs.join(', ')}), so it can't be deleted. Retire it instead.`)
          : `<div class="uv-btn bad full" onclick="uvDeleteTitle('${id}')">Delete title</div>`}`,
    };
  });
}

export function uvSetTitle(id, key, value) { commit(st => M.updateTitle(st, id, { [key]: value })); }
export function uvRetireTitle(id, active) {
  commit(st => M.updateTitle(st, id, { active }), t => `${t.name} ${active ? 'is back' : 'retired'}`);
}
export function uvCrown(id) {
  const pick = document.getElementById('uvCrownPick');
  const t = M.titleById(uni(), id);
  if (!pick || !pick.value) { toast(`Pick the new champion${t.kind === 'tag' ? 's' : ''} first.`, true); return; }
  const holder = { type: t.kind === 'tag' ? 'team' : 'wrestler', id: pick.value };
  commit(st => M.setChampion(st, id, holder), r => `${M.holderName(uni(), r.holder)} — new ${t.name} champion${t.kind === 'tag' ? 's' : ''}`);
}
export function uvVacate(id) {
  const t = M.titleById(uni(), id);
  confirmThen(`Vacate the ${t.name}?`, 'The current reign ends this week. Undo brings it back if this was a mistake.', 'Vacate',
    () => commit(st => M.vacateTitle(st, id), `The ${t.name} is vacant`));
}
export function uvUndoTitle(id) {
  const st = uni();
  const t = M.titleById(st, id);
  const reigns = M.titleReigns(st, id);
  const last = reigns[reigns.length - 1];
  const what = last.end ? `the ${t.name} being vacated` : `${M.holderName(st, last.holder)} winning the ${t.name}`;
  confirmThen('Undo the last title change?', `This takes back ${what}. The result itself, if there was one, stays recorded.`, 'Undo',
    () => commit(s => M.undoTitleChange(s, id), 'Title change undone'));
}
export function uvDeleteTitle(id) {
  const t = M.titleById(uni(), id);
  confirmThen(`Delete the ${t.name}?`, 'It has no history yet. Use this for a title added by mistake.', 'Delete',
    () => { if (commit(st => M.deleteTitle(st, id), `${t.name} deleted`).ok) closeSheet(); });
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
    const weekFixed = st.reigns.some(r => r.eventId === id);
    const set = k => `uvSetEvent('${id}','${k}',this.value)`;
    const results = e.matches.map((m, i) => {
      const reign = st.reigns.find(r => r.matchId === m.id);
      const meta = matchMeta(st, m, reign);
      return `<div class="uv-match"><span class="i">${i + 1}</span><div class="b"><div>${matchLine(st, m)}</div>
        ${meta ? `<div class="uv-muted d">${meta}</div>` : ''}${m.notes ? `<div class="uv-muted d">${esc(m.notes)}</div>` : ''}</div>
        <div class="uv-ic sm" onclick="uvDeleteMatch('${id}','${m.id}')" title="Delete result">${ICON.x}</div></div>`;
    }).join('');

    return {
      title: esc(e.name),
      body: `
        <div class="uv-hero"><span class="uv-av lg sq" style="--c:${showColor(st, e.showId)}">${ICON.cal}</span><div>
          <div class="k">${esc(LABEL.event[e.kind])}</div>
          <div class="s">${esc(e.showId ? showName(st, e.showId) : 'All shows')} · ${esc(season.name)} · Week ${e.at.week}</div></div></div>

        <h4>Results${e.matches.length ? ` · ${e.matches.length}` : ''}</h4>
        ${results || none('No results recorded yet.')}
        <div class="uv-btn pri full" onclick="uvRecordResult('${id}')">${ICON.plus}Record a result</div>

        <h4>Details</h4>
        ${field('Name', `<input class="uv-in" maxlength="60" value="${esc(e.name)}" onchange="${set('name')}">`, 'wide')}
        <div class="uv-grid" style="margin-top:10px">
          ${field('Show', select(set('showId'), options(showPairs(st, e.kind === 'ple' ? 'All shows' : ''), e.showId || '')))}
          ${field('Week', `<input class="uv-in" type="number" min="1" max="999" inputmode="numeric" value="${e.at.week}"
            onchange="${set('week')}"${weekFixed ? ' disabled title="A title changed hands here"' : ''}>`)}
          ${field('Notes', `<textarea class="uv-in" rows="2" maxlength="2000" onchange="${set('notes')}">${esc(e.notes)}</textarea>`, 'wide')}
        </div>
        <div class="uv-btn bad full" onclick="uvDeleteEvent('${id}')">Delete event</div>`,
    };
  });
}

export function uvSetEvent(id, key, value) { commit(st => M.updateEvent(st, id, { [key]: value })); }
export function uvDeleteEvent(id) {
  const e = M.eventById(uni(), id);
  const n = e.matches.length;
  confirmThen(`Delete ${e.name}?`, n ? `Its ${n} recorded result${n === 1 ? '' : 's'} will be deleted with it.` : 'It has no results yet.', 'Delete',
    () => { if (commit(st => M.deleteEvent(st, id), `${e.name} deleted`).ok) closeSheet(); });
}
export function uvDeleteMatch(eventId, matchId) {
  confirmThen('Delete this result?', 'The match is removed from the event and from everyone’s history.', 'Delete',
    () => commit(st => M.deleteMatch(st, eventId, matchId), 'Result deleted'));
}

// ---------------------------------------------------------------- record a result

let md = null;
const blankSide = () => ({ team: '', wrestlers: [''] });

export function uvRecordResult(eventId) {
  md = { eventId, sides: [blankSide(), blankSide()], result: '0', finish: '', titleId: '', titleChange: false, stip: '', notes: '' };
  openSheet(matchSheet);
}

function matchSheet() {
  const st = uni();
  const e = M.eventById(st, md.eventId);
  if (!e) return null;
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
  const hasTeams = st.teams.some(t => t.active);

  const sides = md.sides.map((s, i) => `<div class="uv-sidebox">
      <div class="h"><span>Side ${i + 1}</span>${md.sides.length > 2 ? `<span class="uv-link" onclick="uvMDropSide(${i})">Remove</span>` : ''}</div>
      ${hasTeams ? `<div class="uv-pick">${select(`uvMTeam(${i},this.value)`, teamOptions(st, s.team, 'Not as a tag team'))}</div>` : ''}
      ${s.wrestlers.map((w, j) => `<div class="uv-pick">${select(`uvMWrestler(${i},${j},this.value)`, wrestlerOptions(st, w))}
        ${s.wrestlers.length > 1 ? `<div class="uv-ic sm" onclick="uvMDropWrestler(${i},${j})">${ICON.x}</div>` : ''}</div>`).join('')}
      <div class="uv-add" onclick="uvMAddWrestler(${i})">${ICON.plus}Add a partner</div>
    </div>`).join('');

  return {
    title: 'Record a result',
    body: `
      <p class="uv-p">${esc(e.name)} — enter what happened in the game.</p>
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
      <div class="uv-btn pri full" onclick="uvSaveResult()">Save result</div>`,
  };
}

export function uvMTeam(i, teamId) {
  const side = md.sides[i];
  side.team = teamId;
  const team = teamId && M.teamById(uni(), teamId);
  if (team) side.wrestlers = [...team.members];
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
  const r = commit(st => M.recordMatch(st, d.eventId, input, { titleChange: !!(d.titleId && d.titleChange) }), m => {
    const st = uni();
    const reign = st.reigns.find(x => x.matchId === m.id);
    if (!reign) return 'Result saved';
    const verb = reign.holder.type === 'team' ? 'win' : 'wins';
    return `Result saved — ${M.holderName(st, reign.holder)} ${verb} the ${M.titleById(st, reign.titleId).name}`;
  });
  if (r.ok) uvOpenEvent(d.eventId);
}
