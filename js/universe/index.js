// Universe — the app shell: start-up, tabs, the page stack, and the
// save-file sheet.
import * as M from './model.js';
import { SCHEMA_VERSION, activeSeason, createUniverse, summary } from './model.js';
import { STORAGE_KEY, exportUniverse, importUniverse, lastExported, listRestorePoints, noteExported, readRestorePoint } from './persist.js';
import {
  adoptUniverse, answerConfirm, bootUniverse, browserStorage, clearPages, closeSheet, confirmThen, currentPage, dropPage, keepRestore, lastSaveFailed,
  loadState, onSaved, openSheet, paintSheet, popPage, previousPage, pushPage, replaceUniverse, sheetShowing, toast, uni,
} from './app.js';
import { createCloud } from './cloud.js';
import {
  uvCalFollow, uvCalGo, uvCalendarView, uvFollowActiveSeason, uvHistoryView, uvRosterMode, uvRosterView, uvTeamsView, uvTitlesView, uvUpNext,
  uvViewSeason,
} from './views.js';
import * as RL from './relations.js';
import { uvTrPart, uvTransitionSummary } from './relegation.js';
import { uvPageView } from './pages.js';
import { uvRankFor, uvRankingsView } from './ranks.js';
import { ICON, esc } from './ui.js';

const TABS = [['calendar', 'Calendar'], ['roster', 'Roster'], ['teams', 'Teams'], ['titles', 'Titles'], ['rankings', 'Rankings'],
  ['history', 'History']];
const VIEWS = { calendar: uvCalendarView, roster: uvRosterView, teams: uvTeamsView, titles: uvTitlesView, rankings: uvRankingsView,
  history: uvHistoryView };
let tab = 'calendar';
let cloud = null;            // the claude.ai copy, when published as an artifact

/** Load the saved universe and draw the app. Warns once if the save had problems. */
export function initUniverse() {
  bootUniverse(paint);
  // a new universe starts where it needs filling in: the roster
  if (!uni().wrestlers.length) tab = 'roster';
  paint();
  const L = loadState();
  if (L.status === 'recovered' || L.readOnly || L.problems.length) {
    toast('There was a problem loading your saved universe — see the save menu.', true);
  }
  startCloud();
}

// Only a published artifact has window.claude; opened as a file, this is skipped.
function startCloud() {
  const c = window.claude;
  if (!c || typeof c.use !== 'function') return;
  let store = null;
  try { store = window.localStorage; } catch (e) { /* blocked: the claude.ai copy is all there is */ }
  cloud = createCloud({ claude: c, storage: store, current: uni, adopt: adoptUniverse, onStatus: cloudChanged, toast });
  onSaved(st => cloud.changed(st));
  document.addEventListener('visibilitychange', () => { if (document.hidden) cloud.flush(); });
  cloud.start();
}
// a status change repaints only what shows it, never a form being typed in
function cloudChanged() {
  paintDataBtn();
  if (sheetShowing(dataSheet)) paintSheet();
}
function paintDataBtn() {
  const L = loadState();
  const cloudBad = cloud && cloud.status().mode === 'error';
  document.getElementById('uvDataBtn').classList.toggle('warn',
    cloudBad || lastSaveFailed() || L.readOnly || L.status === 'recovered' || L.problems.length > 0);
}

function paint() {
  const st = uni();
  const body = document.getElementById('uvBody');
  if (!st || !body) return;
  const s = activeSeason(st);
  document.getElementById('uvClock').textContent = `${s.name} · Week ${s.week}`;
  document.getElementById('uvTabs').innerHTML = TABS.map(([k, lb]) =>
    `<div class="uv-tab${k === tab ? ' on' : ''}" data-uvtab="${k}" onclick="uvTab('${k}')">${lb}</div>`).join('');
  // a profile page, if one is open - dropping any whose record has gone
  let page = currentPage(), out = null;
  while (page && !(out = uvPageView(page.kind, page.id))) { dropPage(); page = currentPage(); }
  if (page) {
    page.title = out.title;
    const back = previousPage() ? previousPage().title : TABS.find(([k]) => k === tab)[1];
    body.innerHTML = `<div class="uv-back" onclick="uvBack()">${ICON.left}<span>${esc(back)}</span></div>`
      + `<div class="uv-page" data-page="${page.kind}">${out.body}</div>`;
  } else {
    body.innerHTML = VIEWS[tab]();
  }
  paintDataBtn();
}

export function uvTab(k) {
  tab = k;
  if (k === 'calendar') uvCalFollow();       // the calendar tab always opens on this week
  clearPages();
  paint();
  document.getElementById('uvScroll').scrollTop = 0;
}
export function uvCloseSheet() { closeSheet(); }

// ---------------------------------------------------------------- getting around
//
// One place to reach everything: the header's Go to sheet, with where each
// thing stands right now. Every destination starts from its tab, so Back
// always leads somewhere sensible.

/** Go somewhere: a tab, or a page opened from its tab. */
export function uvGo(where, arg = '') {
  closeSheet();
  const st = uni();
  switch (where) {
    case 'show': uvTab('calendar'); pushPage('event', arg); return;
    case 'week': {
      const [season, week] = String(arg).split(':');
      if (season && season !== activeSeason(st).id) { uvViewSeason(season); uvTab('history'); return; }
      uvTab('calendar'); uvCalGo(Number(week)); return;
    }
    case 'relations': uvRosterMode('relations'); uvTab('roster'); return;
    case 'roster': uvRosterMode('wrestlers'); uvTab('roster'); return;
    case 'rankings': uvRankFor(arg || null); uvTab('rankings'); return;
    case 'balance': uvRankFor(arg || null, 'balance'); uvTab('rankings'); return;
    case 'story': uvTab('calendar'); pushPage('story', 'all'); return;
    case 'transition': {
      const [id, part] = String(arg).split(':');
      uvTab('calendar');
      if (part) uvTrPart(part);
      pushPage('transition', id);
      return;
    }
    case 'save': uvData(); return;
    default: uvTab(where);
  }
}

export function uvGoSheet() { openSheet(goSheet); }

function goSheet() {
  const st = uni();
  const s = activeSeason(st);
  const next = uvUpNext(st);
  const count = id => st.wrestlers.filter(w => w.showId === id).length;
  const held = st.titles.filter(t => t.active && M.currentReign(st, t.id));
  const active = st.titles.filter(t => t.active);
  const rels = [...RL.relationships(st).rels.values()].filter(r => r.active);
  const waiting = st.story.suggestions.filter(x => x.status === 'open' && !M.suggestionProblem(st, x)).length;
  const played = st.events.filter(e => e.at.season === s.id).reduce((n, e) => n + e.matches.filter(m => m.status === 'played').length, 0);
  const tr = [...st.transitions].sort((a, b) => M.seasonById(st, b.season).number - M.seasonById(st, a.season).number)[0];
  const trWin = tr && tr.window && !tr.window.closed;
  const row = (go, icon, head, sub, cls = '') => `<div class="uv-go ${cls}" onclick="${go}">${icon}<div><b>${esc(head)}</b>
    <span>${esc(sub)}</span></div>${ICON.right}</div>`;
  const how = [['uvHowRanked', 'Rankings'], ['uvHowBalance', 'Booking balance'], ['uvHowRelegation', 'Relegation'],
    ['uvHowPromotion', 'NXT promotion & draft'], ['uvHowRelations', 'Relationships'], ['uvHowStory', 'Story engine']];
  return {
    title: 'Go to',
    body: `
      <div class="uv-gos">
        ${next ? row(`uvGo('show','${next.event.id}')`, ICON.cal, `Up next: ${next.event.name}`, next.text, 'hot')
          : row(`uvGo('calendar')`, ICON.cal, 'Up next', 'Nothing planned from this week on — plan a show')}
        ${row(`uvGo('calendar')`, ICON.cal, 'This week’s shows', `${s.name} · Week ${s.week} — cards and results`)}
        ${row(`uvGo('history')`, ICON.list, 'Results', `${played} result${played === 1 ? '' : 's'} this season, show by show`)}
        ${row(`uvGo('roster')`, ICON.user, 'Rosters', st.shows.map(x => `${x.name} ${count(x.id)}`).join(' · '))}
        ${row(`uvGo('teams')`, ICON.team, 'Tag teams', `${st.teams.filter(t => t.active).length} active`)}
        ${row(`uvGo('titles')`, ICON.belt, 'Champions', active.length ? `${held.length} of ${active.length} titles held — `
          + held.slice(0, 2).map(t => `${t.name}: ${M.holderName(st, M.currentReign(st, t.id).holder)}`).join(' · ') : 'No titles yet')}
        ${row(`uvGo('rankings')`, ICON.list, 'Rankings', 'Standings by show, singles and tag')}
        ${row(`uvGo('balance')`, ICON.list, 'Booking balance', 'Who’s short of matches on each show')}
        ${row(`uvGo('relations')`, ICON.team, 'Relationships', `${rels.length} now — ${rels.filter(r => r.kind === 'grudge').length} grudges, ${rels.filter(r => r.kind === 'rivals').length} rivalries`)}
        ${row(`uvGo('story')`, ICON.star, 'Story suggestions', st.story.on ? (waiting ? `${waiting} waiting for you` : 'Nothing waiting') : 'Switched off')}
        ${tr ? row(`uvGo('transition','${tr.id}:${tr.window ? 'window' : 'relegation'}')`, ICON.move,
          trWin ? 'Transfer window — open' : tr.window ? `${M.seasonById(st, tr.season).name} transition · transfer window` : `${M.seasonById(st, tr.season).name} transition`,
          uvTransitionSummary(st, tr).map(x => `${x.label}: ${x.text}`).join(' · '), trWin ? 'hot' : '')
          : row(`uvGo('calendar')`, ICON.move, 'Season transition', 'Starts from WrestleMania, on its show page — relegation, NXT promotion, the draft')}
        ${row(`uvGo('save')`, ICON.save, 'Save & backup', 'Export, import, restore points')}
      </div>
      <div class="uv-sub flush" style="margin-top:14px">How it works</div>
      <div class="uv-pills tight">${how.map(([fn, lb]) => `<div class="uv-pill" onclick="${fn}()">${esc(lb)}</div>`).join('')}</div>`,
  };
}
export function uvBack() { popPage(); }
export function uvConfirmYes() { answerConfirm(true); }
export function uvConfirmNo() { answerConfirm(false); }

// ---------------------------------------------------------------- save file

export function uvData() { openSheet(dataSheet); }

function dataSheet() {
  const st = uni();
  const n = summary(st);
  const L = loadState();
  const stat = (k, v) => `<div class="uv-stat"><div class="v">${v}</div><div class="k">${k}</div></div>`;
  const notes = [];
  const cs = cloud ? cloud.status() : { mode: 'off' };
  if (cs.mode === 'error') {
    notes.push(['bad', cs.message]);
  } else if (cs.mode === 'connecting') {
    notes.push(['ok', 'Connecting to your claude.ai account…']);
  } else if (cs.mode !== 'off') {
    notes.push(['ok', 'Saved to your claude.ai account after every change, so it’s the same on any device you open this page on.']);
  } else if (L.readOnly) {
    notes.push(['bad', 'Your saved universe could not be read, and there was no room to keep a copy of it, so nothing is being saved over it. Export this universe or free up browser storage, then reload.']);
  } else if (lastSaveFailed()) {
    notes.push(['bad', 'The last change could not be saved — this browser’s storage is full or blocked. Export a save file so nothing is lost.']);
  } else if (L.status === 'unavailable') {
    notes.push(['bad', 'This browser is blocking storage (private mode?), so the universe will be gone when the page closes. Export a save file to keep it.']);
  } else {
    notes.push(['ok', 'Saved automatically in this browser after every change.']);
  }
  if (L.status === 'recovered' && L.backupKey) {
    notes.push(['warn', `An earlier save could not be read (${L.problems[0]}). It was kept in this browser’s storage under “${L.backupKey}”, and a new universe was started.`]);
  } else if (L.status === 'loaded' && L.problems.length) {
    notes.push(['warn', `The saved universe loaded with ${L.problems.length} inconsistenc${L.problems.length === 1 ? 'y' : 'ies'}: ${L.problems.slice(0, 3).join(' ')}`]);
  }
  return {
    title: 'Universe save',
    body: `
      <div class="uv-stats">${stat('Wrestlers', n.wrestlers)}${stat('Tag teams', n.teams)}${stat('Titles', n.titles)}
        ${stat('Events', n.events)}${stat('Results', n.matches)}${stat('Booked', n.booked)}</div>
      ${notes.map(([cls, text]) => `<div class="uv-note ${cls}">${esc(text)}</div>`).join('')}
      <p class="uv-p" style="margin-top:12px">${cs.mode === 'off'
        ? 'Your universe lives in this browser only. A save file is its backup, and how you move it to another browser or device — export one every so often.'
        : 'A save file is a backup you keep yourself, and how you move the universe to the app opened as a file — export one every so often.'}</p>
      <div class="uv-row2">
        <div class="uv-btn pri" onclick="uvExport()">${ICON.save}Export</div>
        <div class="uv-btn" onclick="uvImportPick()">Import…</div>
      </div>
      ${exportedLine()}
      ${restoreSection()}
      <div class="uv-btn bad full" onclick="uvReset()">Start a new universe…</div>
      <div class="fine">This records what happens in your WWE 2K25 Universe Mode. It never decides a result or
        controls the game. Stored under ${esc(STORAGE_KEY)}, format v${SCHEMA_VERSION}.</div>`,
  };
}

// how long ago an ISO time was, in words
function ago(iso) {
  const t = Date.parse(iso);
  if (!t) return '';
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 2) return 'just now';
  if (min < 60) return `${min} minutes ago`;
  const h = Math.round(min / 60);
  if (h < 36) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}
function exportedLine() {
  const s = browserStorage();
  const when = s && lastExported(s);
  const n = summary(uni()).matches;
  if (when) return `<div class="uv-savenote" data-exported="1">Last save file exported ${esc(ago(when))} from this browser.</div>`;
  return n ? `<div class="uv-savenote warn" data-exported="0">No save file exported from this browser yet — export one so ${n} result${n === 1 ? '' : 's'} can’t be lost.</div>` : '';
}
function restoreSection() {
  const s = browserStorage();
  if (!s) return '';
  const points = listRestorePoints(s);
  return `<div class="uv-sub flush" style="margin-top:14px">Restore points</div>
    <p class="uv-p">Copies kept in this browser — taken before an import, a reset or a restore, and each time the week moves on (the
      newest of those). Up to four; the oldest go first, and they give way if storage runs short.</p>
    ${points.length ? `<div class="uv-gos">${points.map(p => `<div class="uv-go" data-restore="${p.id}" onclick="uvRestorePoint(${p.id})">${ICON.undo}
      <div><b>${esc(p.label)}</b><span>${esc([p.clock, p.counts && `${p.counts.wrestlers} wrestlers, ${p.counts.results} results`, ago(p.when)].filter(Boolean).join(' · '))}</span></div>
      ${ICON.right}</div>`).join('')}</div>` : '<div class="uv-none">None yet.</div>'}
    <div class="uv-btn full" onclick="uvKeepRestore()">Keep a restore point now</div>`;
}
export function uvKeepRestore() {
  const ok = keepRestore('Kept by you', 'manual');
  paintSheet();
  toast(ok ? 'Restore point kept' : 'Couldn’t keep one — this browser’s storage is full or blocked', !ok);
}
export function uvRestorePoint(id) {
  const s = browserStorage();
  const p = s && listRestorePoints(s).find(x => x.id === id);
  if (!p) return;
  let state;
  try {
    state = readRestorePoint(s, id);
  } catch (e) {
    toast(e.message, true);
    return;
  }
  const n = summary(state);
  confirmThen(`Go back to “${p.label}”?`,
    `The universe goes back to how it was then (${p.clock}: ${n.wrestlers} wrestlers, ${n.matches} results). What you have now is kept as a restore point first, so this can be undone.`,
    'Restore', () => {
      keepRestore(`Before restoring “${p.label}”`, 'restore');
      uvFollowActiveSeason();
      clearPages();
      const saved = replaceUniverse(state);
      closeSheet();
      toast(saved ? `Restored — ${p.clock}` : 'Restored, but it could not be saved in this browser.', !saved);
    });
}

export async function uvExport() {
  const st = uni();
  const s = activeSeason(st);
  const name = `wwe-universe-season${s.number}-week${s.week}.json`;
  if (cloud) {
    // a published page can't start a download itself; claude.ai asks the viewer
    const r = await cloud.exportFile(name, exportUniverse(st));
    if (r === 'saved') {
      const store = browserStorage();
      if (store) noteExported(store, new Date().toISOString());
      toast('Save file downloaded');
      paintSheet();
    }
    else if (r !== 'declined') toast('Exporting isn’t available here — open the app as a file to export.', true);
    return;
  }
  const blob = new Blob([exportUniverse(st)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  const store = browserStorage();
  if (store) noteExported(store, new Date().toISOString());
  toast('Save file downloaded');
  paintSheet();
}

export function uvImportPick() { document.getElementById('uvImport').click(); }

export function uvImportFile(input) {
  const file = input.files && input.files[0];
  input.value = '';          // so choosing the same file again still fires
  if (!file) return;
  const reader = new FileReader();
  reader.onerror = () => toast('That file could not be read.', true);
  reader.onload = () => {
    let state;
    try {
      state = importUniverse(String(reader.result));
    } catch (e) {
      toast(e.message, true);
      return;
    }
    const n = summary(state);
    confirmThen('Replace this universe?',
      `The file has ${n.wrestlers} wrestlers, ${n.titles} titles and ${n.events} events. Everything here now is replaced — a restore point of it is kept in this browser first, and a save file keeps a copy of your own.`,
      'Replace', () => {
        keepRestore(`Before importing ${file.name}`.slice(0, 80), 'import');
        uvFollowActiveSeason();
        clearPages();                    // ids repeat across universes: never show a page for the wrong record
        const saved = replaceUniverse(state);
        toast(saved ? 'Universe imported' : 'Imported, but it could not be saved in this browser.', !saved);
      });
  };
  reader.readAsText(file);
}

export function uvReset() {
  confirmThen('Start a new universe?',
    'This deletes every wrestler, team, title, season and result here. A restore point of it is kept in this browser, so it can be brought back there — export a save file to keep a copy of your own.',
    'Delete everything', () => {
      keepRestore('Before starting a new universe', 'reset');
      uvFollowActiveSeason();
      clearPages();
      replaceUniverse(createUniverse());
      closeSheet();
      toast('New universe started');
    });
}
