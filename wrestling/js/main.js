// Entry point. Wires the screens and actions to the store, and boots.
//
// Layering, top to bottom:
//   ui/      renders the store and calls its actions. Holds no game state.
//   core/    owns the world. DOM-free, so tools/wgm-check.mjs runs it in node.
//   models/  pure entity factories and derived reads.
//
// Nothing below the ui layer imports anything above it, which is why the whole
// simulation can be exercised headlessly.

import * as store from './core/store.js';
import * as persist from './core/persist.js';
import * as clock from './core/clock.js';
import { checkState } from './core/invariants.js';
import { seedRoster } from './data/roster.js';
import { FINISHES, sides } from './models/segment.js';
import {
  registerScreen, registerActions, bindEvents, render, go, toast,
  renderHeader, setWhenFormatter,
} from './ui/shell.js';

import rosterScreen from './ui/screens/roster.js';
import wrestlerScreen from './ui/screens/wrestler.js';
import calendarScreen from './ui/screens/calendar.js';
import showScreen from './ui/screens/show.js';
import logScreen, { setFilter } from './ui/screens/log.js';
import savesScreen from './ui/screens/saves.js';

registerScreen('roster', rosterScreen);
registerScreen('calendar', calendarScreen);
registerScreen('show', showScreen);
registerScreen('log', logScreen);
registerScreen('saves', savesScreen);
registerScreen('wrestler', wrestlerScreen);

setWhenFormatter((state) =>
  `${clock.formatDate(state.calendar)} · ${clock.formatGameTime(state.calendar.day)}`);

/** Re-render the current screen and the header after anything that moves the world. */
function refresh(message) {
  renderHeader(store.isLoaded() ? store.getState() : null);
  render();
  if (message) toast(message);
}

registerActions({
  // --- lifecycle ---------------------------------------------------------
  newGame(_data, form) {
    const f = new FormData(form);
    store.newGame({
      seed: (f.get('seed') || '').trim() || `seed-${Date.now()}`,
      gmName: f.get('gmName') || 'New GM',
      brandName: f.get('brandName') || 'Weekly Showcase',
      mode: f.get('mode') || 'sandbox',
      scheduleBlocks: 3,
    });
    seedRoster();
    go('roster');
    refresh('New game started with 14 wrestlers and three months booked');
  },

  saveSlot() {
    const slot = document.getElementById('slotName')?.value.trim() || 'slot1';
    const label = document.getElementById('slotLabel')?.value.trim() || '';
    const result = persist.save(slot, { label });
    refresh(result.ok ? `Saved to ${slot}` : `Save failed: ${result.error}`);
  },

  loadSlot({ slot }) {
    const result = persist.load(slot);
    if (!result.ok) return toast(`Load failed: ${result.error}`);
    go('roster');
    refresh(`Loaded ${slot}`);
  },

  deleteSlot({ slot }) {
    persist.deleteSave(slot);
    refresh(`Deleted ${slot}`);
  },

  async exportSave() {
    const json = persist.toJSON({ label: 'export' });
    try {
      await navigator.clipboard.writeText(json);
      toast(`Copied ${(json.length / 1024).toFixed(0)} KB to the clipboard`);
    } catch {
      window.prompt('Copy this save:', json);
    }
  },

  importSave() {
    const text = window.prompt('Paste a save:');
    if (!text) return;
    try {
      persist.fromJSON(text);
      go('roster');
      refresh('Save imported');
    } catch (err) {
      toast(err.message);
    }
  },

  checkState() {
    const problems = checkState(store.getState());
    refresh(problems.length ? `${problems.length} integrity problem(s)` : 'State is sound');
  },

  // --- calendar ----------------------------------------------------------
  advance({ days }) {
    const { to } = store.advanceDays(Number(days) || 1);
    refresh(`Now day ${to}`);
  },

  advanceToShow() {
    const moved = store.advanceToNextShow();
    if (!moved) return toast('Nothing left on the calendar');
    const entry = store.getState().calendar.entries.find((e) => e.day === moved.to);
    refresh(entry ? `${entry.label} is today` : `Now day ${moved.to}`);
  },

  scheduleMore() {
    const added = store.scheduleProgramming(1);
    refresh(`Scheduled ${added.length} more shows`);
  },

  // --- booking -----------------------------------------------------------
  bookSegment({ show: showId }, form) {
    const f = new FormData(form);
    const participants = [];
    if (f.get('a')) participants.push({ wrestlerId: f.get('a'), side: 'a' });
    if (f.get('b')) participants.push({ wrestlerId: f.get('b'), side: 'b' });
    if (participants.length === 2 && participants[0].wrestlerId === participants[1].wrestlerId) {
      return toast('A wrestler cannot face themselves');
    }
    try {
      store.bookSegment({
        showId,
        kind: f.get('kind'),
        name: (f.get('name') || '').trim(),
        timeLimitSec: Math.max(1, Number(f.get('limit')) || 10) * 60,
        participants,
      });
      refresh('Booked');
    } catch (err) {
      toast(err.message);
    }
  },

  cutSegment({ id }) {
    store.cutSegment(id, { reason: 'Cut for time' });
    refresh('Cut from the card');
  },

  startShow({ id }) {
    store.startShow(id);
    refresh('Live');
  },

  completeShow({ id }) {
    store.completeShow(id);
    refresh('Off the air');
  },

  /**
   * PLACEHOLDER, not the match simulation.
   *
   * It picks a duration and a winner with flat randomness and reads no wrestler
   * stat at all, precisely so it cannot be mistaken for the real thing. Its only
   * job is to exercise completeSegment so the event chain and the time
   * bookkeeping can be seen working. The simulation described in the design
   * foundation replaces this wholesale.
   */
  runSegment({ id }) {
    const seg = store.getSegment(id);
    const rng = store.getRng();
    const bySide = sides(seg);
    const sideKeys = Object.keys(bySide);
    const ranFull = rng.chance(0.15);
    const actualSec = ranFull ? seg.timeLimitSec : rng.range(20, Math.max(25, seg.timeLimitSec));

    let finish = FINISHES.SEGMENT_END;
    let winnerIds = [];
    let loserIds = [];
    if (seg.kind === 'match' && sideKeys.length >= 2) {
      if (ranFull) {
        finish = FINISHES.TIME_LIMIT_DRAW;
      } else {
        finish = rng.pick([FINISHES.PINFALL, FINISHES.SUBMISSION, FINISHES.COUNTOUT, FINISHES.DQ]);
        const winSide = rng.pick(sideKeys);
        winnerIds = bySide[winSide];
        loserIds = sideKeys.filter((k) => k !== winSide).flatMap((k) => bySide[k]);
      }
    }
    store.completeSegment(id, { finish, winnerIds, loserIds, actualSec });
    const delta = actualSec - seg.timeLimitSec;
    refresh(delta < 0
      ? `Ran ${Math.round(-delta / 60)} minutes short of its limit`
      : 'Went the distance');
  },

  // --- log ---------------------------------------------------------------
  filterLog({ value }) {
    setFilter(value);
    render();
  },
});

// --- boot ------------------------------------------------------------------

bindEvents();

// Pick up an autosave if one is there, so a refresh does not lose the game.
const resumed = persist.hasSave('auto') && persist.load('auto').ok;
if (!resumed && !location.hash) location.hash = '#/saves';

// Autosave whenever the world moves in a way worth not losing.
store.on('show.completed', () => persist.save('auto', { label: 'Autosave' }));
store.on('calendar.advanced', () => persist.save('auto', { label: 'Autosave' }));

renderHeader(store.isLoaded() ? store.getState() : null);
render();

// A console handle, for poking at the model while developing.
window.WGM = { store, persist, clock, checkState, seedRoster };
