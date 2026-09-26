// WWE Universe — the bottom sheets for creating things: add wrestlers, new
// team, new title, and the season controls. Shows, their match cards and the
// result form live in card.js.
//
// Form sheets keep a draft here until the owner saves it, so a save that's
// refused keeps everything they typed. Profiles and their edits live in
// pages.js and edits.js.
import * as M from './model.js';
import { ICON, LABEL, empty, esc, field, labelPairs, options, select, showName, showPairs, wrestlerOptions } from './ui.js';
import { closeSheet, commit, confirmThen, focusField, openSheet, paintSheet, toast, uni } from './app.js';
import { uvCalFollow, uvFollowActiveSeason, uvRosterShow } from './views.js';
import { uvOpenTeam, uvOpenTitle } from './pages.js';

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
  uvCalFollow();
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
