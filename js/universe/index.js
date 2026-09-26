// WWE Universe — section shell: open/close, tabs, and the save-file sheet.
//
// Like Arc Markets, this is a separate section rather than a fantasy screen:
// it covers the phone above the app's own bottom nav, keeps its own
// localStorage key, and touches the fantasy app only at the seam - opening it
// adds a class to <body>, closing it hands control back to the home tab.
import { SCHEMA_VERSION, activeSeason, createUniverse, summary } from './model.js';
import { STORAGE_KEY, exportUniverse, importUniverse } from './persist.js';
import {
  answerConfirm, bootUniverse, closeSheet, confirmThen, lastSaveFailed, loadState, openSheet,
  replaceUniverse, toast, uni,
} from './app.js';
import { uvFollowActiveSeason, uvHistoryView, uvRosterView, uvTeamsView, uvTitlesView } from './views.js';
import { ICON, esc } from './ui.js';

const TABS = [['roster', 'Roster'], ['teams', 'Teams'], ['titles', 'Titles'], ['history', 'History']];
const VIEWS = { roster: uvRosterView, teams: uvTeamsView, titles: uvTitlesView, history: uvHistoryView };
let tab = 'roster';
let warnedOnOpen = false;

export function initUniverse() { bootUniverse(paint); }

function paint() {
  const st = uni();
  const body = document.getElementById('uvBody');
  if (!st || !body) return;
  const s = activeSeason(st);
  document.getElementById('uvClock').textContent = `${s.name} · Week ${s.week}`;
  document.getElementById('uvTabs').innerHTML = TABS.map(([k, lb]) =>
    `<div class="uv-tab${k === tab ? ' on' : ''}" data-uvtab="${k}" onclick="uvTab('${k}')">${lb}</div>`).join('');
  body.innerHTML = VIEWS[tab]();
  const L = loadState();
  document.getElementById('uvDataBtn').classList.toggle('warn',
    lastSaveFailed() || L.readOnly || L.status === 'recovered' || L.problems.length > 0);
}

export function openUniverse() {
  document.body.classList.add('universe');
  paint();
  const L = loadState();
  if (!warnedOnOpen && (L.status === 'recovered' || L.readOnly || L.problems.length)) {
    warnedOnOpen = true;
    toast('There was a problem loading your saved universe — see the save menu.', true);
  }
}

/** Leave the universe and go back to the fantasy app. */
export function closeUniverse() {
  if (!document.body.classList.contains('universe')) return;   // also called by the other nav items
  document.body.classList.remove('universe');
  closeSheet();
  answerConfirm(false);
  window.showTab && window.showTab(window.homeTab ? window.homeTab() : 'matchup');
}

export function uvTab(k) {
  tab = k;
  paint();
  document.getElementById('uvScroll').scrollTop = 0;
}
export function uvCloseSheet() { closeSheet(); }
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
  if (L.readOnly) {
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
        ${stat('Events', n.events)}${stat('Results', n.matches)}${stat('Seasons', n.seasons)}</div>
      ${notes.map(([cls, text]) => `<div class="uv-note ${cls}">${esc(text)}</div>`).join('')}
      <p class="uv-p" style="margin-top:12px">Your universe lives in this browser only. A save file is its backup, and how you move it
        to another browser or device — export one every so often.</p>
      <div class="uv-row2">
        <div class="uv-btn pri" onclick="uvExport()">${ICON.save}Export</div>
        <div class="uv-btn" onclick="uvImportPick()">Import…</div>
      </div>
      <div class="uv-btn bad full" onclick="uvReset()">Start a new universe…</div>
      <div class="fine">This records what happens in your WWE 2K25 Universe Mode. It never decides a result or
        controls the game. Stored under ${esc(STORAGE_KEY)}, format v${SCHEMA_VERSION}.</div>`,
  };
}

export function uvExport() {
  const st = uni();
  const s = activeSeason(st);
  const blob = new Blob([exportUniverse(st)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `wwe-universe-season${s.number}-week${s.week}.json`;
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
      replaceUniverse(createUniverse());
      closeSheet();
      toast('New universe started');
    });
}
