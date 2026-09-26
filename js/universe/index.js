// Universe — the app shell: start-up, tabs, the page stack, and the
// save-file sheet.
import { SCHEMA_VERSION, activeSeason, createUniverse, summary } from './model.js';
import { STORAGE_KEY, exportUniverse, importUniverse } from './persist.js';
import {
  adoptUniverse, answerConfirm, bootUniverse, clearPages, closeSheet, confirmThen, currentPage, dropPage, lastSaveFailed,
  loadState, onSaved, openSheet, paintSheet, popPage, previousPage, replaceUniverse, sheetShowing, toast, uni,
} from './app.js';
import { createCloud } from './cloud.js';
import { uvCalFollow, uvCalendarView, uvFollowActiveSeason, uvHistoryView, uvRosterView, uvTeamsView, uvTitlesView } from './views.js';
import { uvPageView } from './pages.js';
import { ICON, esc } from './ui.js';

const TABS = [['calendar', 'Calendar'], ['roster', 'Roster'], ['teams', 'Teams'], ['titles', 'Titles'], ['history', 'History']];
const VIEWS = { calendar: uvCalendarView, roster: uvRosterView, teams: uvTeamsView, titles: uvTitlesView, history: uvHistoryView };
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
      <div class="uv-btn bad full" onclick="uvReset()">Start a new universe…</div>
      <div class="fine">This records what happens in your WWE 2K25 Universe Mode. It never decides a result or
        controls the game. Stored under ${esc(STORAGE_KEY)}, format v${SCHEMA_VERSION}.</div>`,
  };
}

export async function uvExport() {
  const st = uni();
  const s = activeSeason(st);
  const name = `wwe-universe-season${s.number}-week${s.week}.json`;
  if (cloud) {
    // a published page can't start a download itself; claude.ai asks the viewer
    const r = await cloud.exportFile(name, exportUniverse(st));
    if (r === 'saved') toast('Save file downloaded');
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
  toast('Save file downloaded');
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
      `The file has ${n.wrestlers} wrestlers, ${n.titles} titles and ${n.events} events. Everything here now is replaced — export first if you want to keep it.`,
      'Replace', () => {
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
    'This deletes every wrestler, team, title, season and result here. It cannot be undone — export first if you might want it back.',
    'Delete everything', () => {
      uvFollowActiveSeason();
      clearPages();
      replaceUniverse(createUniverse());
      closeSheet();
      toast('New universe started');
    });
}
