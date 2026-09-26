// WWE Universe — the sheets behind the profile pages: editing details,
// moving shows, team line-ups, crowning and correcting champions, merging a
// duplicate, and the undo and delete actions.
//
// Every change goes through commit(), so one that's refused leaves everything
// as it was and says why. Every undo and delete says exactly what it will
// take back before it does.
import * as M from './model.js';
import {
  LABEL, esc, field, labelPairs, options, select, showColor, showName, showPairs, stampLabel, teamOptions,
  weeksText, wrestlerOptions,
} from './ui.js';
import { closeSheet, commit, confirmThen, focusField, openSheet, paintSheet, toast, uni } from './app.js';
import { uvEndSelect } from './views.js';

const alignPairs = () => [['', 'Not set'], ...labelPairs(LABEL.alignment)];
const weekInput = (value, handler, extra = '') =>
  `<input class="uv-in" type="number" min="1" max="999" inputmode="numeric" value="${esc(value)}" oninput="${handler}"${extra}>`;
const thisWeek = () => String(M.activeSeason(uni()).week);

// ================================================================ wrestlers

export function uvEditWrestler(id) {
  openSheet(() => {
    const st = uni();
    const w = M.wrestlerById(st, id);
    if (!w) return null;
    const set = k => `uvSetWrestler('${id}','${k}',this.value)`;
    return {
      title: 'Edit details',
      body: `
        <div class="uv-grid">
          ${field('Name', `<input class="uv-in" maxlength="60" value="${esc(w.name)}" onchange="${set('name')}">`, 'wide')}
          ${field('Division', select(set('gender'), options(labelPairs(LABEL.gender), w.gender)))}
          ${field('Comes from', select(set('origin'), options(labelPairs(LABEL.origin), w.origin)))}
          ${field('Alignment', select(set('alignment'), options(alignPairs(), w.alignment || '')))}
          ${field('Status', select(set('status'), options(labelPairs(LABEL.status), w.status)))}
          ${field('Notes', `<textarea class="uv-in" rows="3" maxlength="2000" onchange="${set('notes')}">${esc(w.notes)}</textarea>`, 'wide')}
        </div>
        <p class="uv-p">Each change saves as you make it. To change shows use <b>Move show</b>, which keeps the move in their history.</p>
        <div class="uv-btn full" onclick="uvCloseSheet()">Done</div>`,
    };
  });
}
export function uvSetWrestler(id, key, value) {
  commit(st => M.updateWrestler(st, id, { [key]: value }), 'Saved');
}

// ---------------------------------------------------------------- move show

let mv = null;

/** Move one wrestler or several - from a profile, or the roster's select mode. */
export function uvMoveWrestlers(ids) {
  mv = { ids: [...ids], to: null, week: thisWeek(), note: '' };
  openSheet(moveSheet);
}

function moveSheet() {
  const st = uni();
  const ws = mv.ids.map(id => M.wrestlerById(st, id)).filter(Boolean);
  if (!ws.length) return null;
  const counts = M.rosterCounts(st);
  const one = ws.length === 1 ? ws[0] : null;
  const tile = (id, name) => {
    const here = one && (one.showId || '') === id;
    return `<div class="uv-tile${mv.to === id ? ' on' : ''}${here ? ' here' : ''}" style="--c:${id ? showColor(st, id) : '#5E6979'}"
      data-show="${id}" onclick="uvMoveTo('${id}')"><span class="uv-dot"></span><b>${esc(name)}</b>
      <span>${counts[id]} wrestler${counts[id] === 1 ? '' : 's'}${here ? ' · here now' : ''}</span></div>`;
  };
  return {
    title: one ? `Move ${esc(one.name)}` : `Move ${ws.length} wrestlers`,
    body: `
      <p class="uv-p">${one ? `Now on <b>${esc(showName(st, one.showId))}</b>.`
        : esc(ws.map(w => w.name).join(', ')) + '.'} Results, titles and teams stay exactly as they are — the move is added to ${one ? 'their' : 'each one’s'} history. Shows have no size limit.</p>
      <div class="uv-tiles">${st.shows.map(s => tile(s.id, s.name)).join('')}${tile('', 'Unassigned')}</div>
      <div class="uv-grid" style="margin-top:12px">
        ${field('Week', weekInput(mv.week, "uvMoveSet('week',this.value)"))}
        ${field('Note (optional)', `<input class="uv-in" maxlength="60" value="${esc(mv.note)}" placeholder="e.g. Traded"
          oninput="uvMoveSet('note',this.value)">`)}
      </div>
      <div class="uv-btn pri full${mv.to === null ? ' off' : ''}" onclick="uvMoveSave()">${mv.to === null ? 'Pick a show'
        : `Move to ${esc(showName(st, mv.to || null))}`}</div>`,
  };
}
export function uvMoveTo(id) { mv.to = id; paintSheet(); }
export function uvMoveSet(k, v) { mv[k] = v; }
export function uvMoveSave() {
  const d = mv;
  if (!d || d.to === null) { toast('Pick a show first.', true); return; }
  const where = () => showName(uni(), d.to || null);
  const r = commit(st => M.assignWrestlers(st, d.ids, d.to, d.note, { week: d.week }), moves => {
    if (!moves.length) return `Already on ${where()}`;
    return moves.length === 1 ? `${M.wrestlerById(uni(), moves[0].wrestler).name} → ${where()}` : `${moves.length} wrestlers → ${where()}`;
  });
  if (r.ok) { closeSheet(); uvEndSelect(); }
}

export function uvUndoMove(id) {
  const st = uni();
  const w = M.wrestlerById(st, id);
  const moves = M.movesOf(st, id);
  const last = moves[moves.length - 1];
  if (!last) return;
  const from = showName(st, last.from), to = showName(st, last.to);
  confirmThen('Undo the last move?',
    `This takes back ${w.name} ${last.from ? `moving from ${from} to ${to}` : `joining ${to}`} (${stampLabel(st, last.at)}), `
    + `so they're back ${last.from ? `on ${from}` : 'unassigned'}. Their results and earlier moves don't change.`,
    'Undo move', () => commit(s => M.undoLastMove(s, id), `${w.name} is back ${last.from ? `on ${from}` : 'unassigned'}`));
}

export function uvDeleteWrestler(id) {
  const w = M.wrestlerById(uni(), id);
  confirmThen(`Delete ${w.name}?`, 'They have no history yet, so nothing else changes. Use this for someone added by mistake.', 'Delete',
    () => commit(st => M.deleteWrestler(st, id), `${w.name} deleted`));
}

// ---------------------------------------------------------------- merge a duplicate

export function uvMergeInto(keepId) {
  openSheet(() => {
    const st = uni();
    const keep = M.wrestlerById(st, keepId);
    if (!keep) return null;
    return {
      title: 'Merge a duplicate',
      body: `
        <p class="uv-p">For the same wrestler entered twice. Pick the duplicate of <b>${esc(keep.name)}</b>: everything it
          did — results, team spells, title reigns — becomes ${esc(keep.name)}’s, and the duplicate is removed.
          Its roster moves are dropped; ${esc(keep.name)}’s own show history is kept.</p>
        ${field('The duplicate', `<select id="uvMergePick" class="uv-in">${wrestlerOptions(st, '', '— Pick the duplicate —', [keepId])}</select>`, 'wide')}
        <div class="uv-btn pri full" onclick="uvMergeSave('${keepId}')">Merge into ${esc(keep.name)}</div>
        <div class="fine">It’s refused if the two were ever in the same match or on the same team — then they can’t be the same person.</div>`,
    };
  });
}
export function uvMergeSave(keepId) {
  const st = uni();
  const dupId = (document.getElementById('uvMergePick') || {}).value;
  if (!dupId) { toast('Pick the duplicate first.', true); return; }
  const keep = M.wrestlerById(st, keepId), dup = M.wrestlerById(st, dupId);
  confirmThen(`Merge ${dup.name} into ${keep.name}?`,
    `${dup.name} is removed and everything they did becomes ${keep.name}’s. This can’t be undone — export a save first if you’re unsure.`,
    'Merge', () => { if (commit(s => M.mergeWrestlers(s, keepId, dupId), `${dup.name} merged into ${keep.name}`).ok) closeSheet(); });
}

// ================================================================ tag teams

export function uvRenameTeam(id) {
  openSheet(() => {
    const t = M.teamById(uni(), id);
    if (!t) return null;
    return {
      title: 'Rename the team',
      body: `${field('Team name', `<input id="uvTeamRename" class="uv-in" maxlength="60" value="${esc(t.name)}"
          onkeydown="if(event.key==='Enter')uvSaveTeamName('${id}')">`, 'wide')}
        <p class="uv-p">Past results and title reigns show the new name.</p>
        <div class="uv-btn pri full" onclick="uvSaveTeamName('${id}')">Save</div>`,
    };
  });
  focusField('uvTeamRename');
}
export function uvSaveTeamName(id) {
  const v = document.getElementById('uvTeamRename').value;
  if (commit(st => M.updateTeam(st, id, { name: v }), 'Team renamed').ok) closeSheet();
}

let lineWeek = '';

export function uvLineup(id) {
  lineWeek = thisWeek();
  openSheet(() => {
    const st = uni();
    const t = M.teamById(st, id);
    if (!t) return null;
    const spells = M.membershipsOf(st, id);
    const current = t.members.map(wid => spells.find(m => m.wrestler === wid && !m.end));
    const former = spells.filter(m => m.end).sort((a, b) => b.end.seq - a.end.seq);
    const name = m => esc(M.wrestlerById(st, m.wrestler).name);
    return {
      title: `${esc(t.name)} line-up`,
      body: `
        <p class="uv-p">Joining and leaving are dated and kept. Matches the team already wrestled keep the line-up they had.</p>
        ${field('Week of the change', weekInput(lineWeek, 'uvLineupWeek(this.value)'), 'wide')}
        <h4>Now</h4>
        ${current.map(m => `<div class="uv-li plain"><span>${name(m)}<span class="uv-muted d">since ${stampLabel(st, m.start)}</span></span>
          ${t.members.length > 2 ? `<div class="uv-btn sm" onclick="uvRemoveMember('${id}','${m.wrestler}')">Remove</div>` : ''}</div>`).join('')}
        ${t.members.length <= 2 ? '<div class="fine">A team needs two members: add the new partner before removing anyone.</div>' : ''}
        <h4>Add a member</h4>
        <div class="uv-pick"><select id="uvLineupPick" class="uv-in">${wrestlerOptions(st, '', '— Pick a wrestler —', t.members)}</select>
          <div class="uv-btn pri" onclick="uvAddMember('${id}')">Add</div></div>
        ${former.length ? `<h4>Former</h4>${former.map(m => `<div class="uv-li plain"><span>${name(m)}
          <span class="uv-muted d">${stampLabel(st, m.start)} → ${stampLabel(st, m.end)}</span></span></div>`).join('')}` : ''}
        <div class="uv-btn full" onclick="uvCloseSheet()">Done</div>`,
    };
  });
}
export function uvLineupWeek(v) { lineWeek = v; }
export function uvAddMember(teamId) {
  const wid = (document.getElementById('uvLineupPick') || {}).value;
  if (!wid) { toast('Pick who is joining.', true); return; }
  commit(st => M.addTeamMember(st, teamId, wid, { week: lineWeek }),
    () => `${M.wrestlerById(uni(), wid).name} joined ${M.teamById(uni(), teamId).name}`);
}
export function uvRemoveMember(teamId, wid) {
  commit(st => M.removeTeamMember(st, teamId, wid, { week: lineWeek }),
    () => `${M.wrestlerById(uni(), wid).name} left ${M.teamById(uni(), teamId).name}`);
}

export function uvTeamActive(id, active) {
  const t = M.teamById(uni(), id);
  const go = () => commit(st => M.setTeamActive(st, id, active), `${t.name} ${active ? 'reunited' : 'disbanded'}`);
  if (active) go();
  else confirmThen(`Disband ${t.name}?`, 'Their record and history stay. They can reunite later, and the members stay listed.', 'Disband', go);
}

export function uvUndoTeam(id) {
  const st = uni();
  const t = M.teamById(st, id);
  const c = M.lastTeamChange(st, id);
  if (!c) return;
  const w = c.m && M.wrestlerById(st, c.m.wrestler);
  const what = c.kind === 'disbanded' ? 'the team disbanding' : c.kind === 'reunited' ? 'the team reuniting'
    : `${w.name} ${c.kind === 'joined' ? 'joining' : 'leaving'}`;
  confirmThen('Undo the last line-up change?', `This takes back ${what} (${stampLabel(st, c.at)}). Nothing before it changes.`,
    'Undo', () => commit(s => M.undoTeamChange(s, id), `${t.name}: change undone`));
}

export function uvDeleteTeam(id) {
  const t = M.teamById(uni(), id);
  confirmThen(`Delete ${t.name}?`, 'They have no matches or titles yet. Use this for a team added by mistake.', 'Delete',
    () => commit(st => M.deleteTeam(st, id), `${t.name} deleted`));
}

// ================================================================ championships

export function uvCrownSheet(id) {
  openSheet(() => {
    const st = uni();
    const t = M.titleById(st, id);
    if (!t) return null;
    const pool = t.kind === 'tag' ? teamOptions(st, '', '— Pick the new champions —') : wrestlerOptions(st, '', '— Pick the new champion —');
    return {
      title: `Crown a new champion`,
      body: `
        <p class="uv-p">For the <b>${esc(t.name)}</b>, dated to this week. If it changed hands in a match, record it on that
          event’s result instead — then the reign is dated to the show and counts as won there.</p>
        ${field(t.kind === 'tag' ? 'New champions' : 'New champion', `<select id="uvCrownPick" class="uv-in">${pool}</select>`, 'wide')}
        <div style="margin-top:10px">${field('Note (optional)', `<input id="uvCrownNote" class="uv-in" maxlength="60" placeholder="e.g. Awarded, tournament">`, 'wide')}</div>
        <div class="uv-btn pri full" onclick="uvCrown('${id}')">Crown</div>`,
    };
  });
}
export function uvCrown(id) {
  const t = M.titleById(uni(), id);
  const pick = document.getElementById('uvCrownPick');
  if (!pick || !pick.value) { toast(`Pick the new champion${t.kind === 'tag' ? 's' : ''} first.`, true); return; }
  const note = (document.getElementById('uvCrownNote') || {}).value || '';
  const holder = { type: t.kind === 'tag' ? 'team' : 'wrestler', id: pick.value };
  const r = commit(st => M.setChampion(st, id, holder, { note }),
    reign => `${M.holderName(uni(), reign.holder)} — new ${t.name} champion${t.kind === 'tag' ? 's' : ''}`);
  if (r.ok) closeSheet();
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
  if (!last) return;
  const what = last.end ? `the ${t.name} being vacated (${stampLabel(st, last.end)})`
    : `${M.holderName(st, last.holder)} winning the ${t.name} (${stampLabel(st, last.start)})`;
  confirmThen('Undo the last title change?', `This takes back ${what}. If it came from a result, the result stays recorded as a title match.`,
    'Undo', () => commit(s => M.undoTitleChange(s, id), 'Title change undone'));
}

export function uvEditTitle(id) {
  openSheet(() => {
    const st = uni();
    const t = M.titleById(st, id);
    if (!t) return null;
    const set = k => `uvSetTitle('${id}','${k}',this.value)`;
    const hasHistory = st.reigns.some(r => r.titleId === id);
    return {
      title: 'Edit championship',
      body: `
        ${field('Name', `<input class="uv-in" maxlength="60" value="${esc(t.name)}" onchange="${set('name')}">`, 'wide')}
        <div class="uv-grid" style="margin-top:10px">
          ${field('Show', select(set('showId'), options(showPairs(st, 'No brand'), t.showId || '')), 'wide')}
          ${field('Division', select(set('division'), options(labelPairs(LABEL.division), t.division)))}
          ${field('Type', select(set('kind'), options(labelPairs(LABEL.kind), t.kind), hasHistory ? ' disabled' : ''))}
        </div>
        ${hasHistory ? '<div class="fine">It has a title history, so it can’t switch between singles and tag.</div>' : ''}
        <div class="uv-btn full" onclick="uvRetireTitle('${id}',${!t.active})">${t.active ? 'Retire title' : 'Bring title back'}</div>
        <div class="uv-btn full" onclick="uvCloseSheet()">Done</div>`,
    };
  });
}
export function uvSetTitle(id, key, value) { commit(st => M.updateTitle(st, id, { [key]: value }), 'Saved'); }
export function uvRetireTitle(id, active) {
  commit(st => M.updateTitle(st, id, { active }), t => `${t.name} ${active ? 'is back' : 'retired'}`);
}
export function uvDeleteTitle(id) {
  const t = M.titleById(uni(), id);
  confirmThen(`Delete the ${t.name}?`, 'It has no history yet. Use this for a title added by mistake.', 'Delete',
    () => commit(st => M.deleteTitle(st, id), `${t.name} deleted`));
}

// ---------------------------------------------------------------- correct one reign

export function uvEditReign(reignId) {
  openSheet(() => {
    const st = uni();
    const r = st.reigns.find(x => x.id === reignId);
    if (!r) return null;
    const t = M.titleById(st, r.titleId);
    const n = M.titleReigns(st, t.id).indexOf(r) + 1;
    const ev = r.eventId ? M.eventById(st, r.eventId) : null;
    const pool = t.kind === 'tag' ? teamOptions(st, r.holder.id, '— Pick —', !!r.end) : wrestlerOptions(st, r.holder.id, '— Pick —');
    const fromResult = !!r.matchId;
    return {
      title: `Reign ${n} · ${esc(t.name)}`,
      body: `
        <p class="uv-p"><b>${esc(M.holderName(st, r.holder))}</b>, ${stampLabel(st, r.start)} → ${r.end ? stampLabel(st, r.end) : 'now'}
          · ${weeksText(M.reignWeeks(st, r))} · ${M.defencesOf(st, r)} defence${M.defencesOf(st, r) === 1 ? '' : 's'}. Correcting it leaves every other reign as it is.</p>
        ${fromResult ? `<div class="uv-note">This reign came from a result at <b>${esc(ev.name)}</b>, so who won — and when — is
            fixed there. <span class="uv-link" onclick="uvOpenEvent('${ev.id}')">Open ${esc(ev.name)}</span></div>`
          : `<div class="uv-grid" style="margin-top:4px">
              ${field(t.kind === 'tag' ? 'Held by (team)' : 'Held by', `<select id="uvReignHolder" class="uv-in">${pool}</select>`, 'wide')}
              ${field('Began in week', weekInput(String(r.start.week), '', ` id="uvReignWeek"${ev ? ' disabled' : ''}`))}
            </div>`}
        <div style="margin-top:10px">${field('Note', `<input id="uvReignNote" class="uv-in" maxlength="60" value="${esc(r.note)}"
          placeholder="e.g. Awarded, cash-in">`, 'wide')}</div>
        <div class="uv-btn pri full" onclick="uvSaveReign('${reignId}')">Save correction</div>`,
    };
  });
}
export function uvSaveReign(reignId) {
  const st = uni();
  const r = st.reigns.find(x => x.id === reignId);
  const t = M.titleById(st, r.titleId);
  const patch = { note: document.getElementById('uvReignNote').value };
  const holderPick = document.getElementById('uvReignHolder');
  const weekPick = document.getElementById('uvReignWeek');
  if (holderPick) {
    if (!holderPick.value) { toast('Pick who held it.', true); return; }
    patch.holder = { type: t.kind === 'tag' ? 'team' : 'wrestler', id: holderPick.value };
  }
  if (weekPick && !weekPick.disabled) patch.week = weekPick.value;
  if (commit(s => M.updateReign(s, reignId, patch), 'Reign corrected').ok) closeSheet();
}
