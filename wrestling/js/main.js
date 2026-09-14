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
import { installSystems } from './systems/index.js';
import * as runner from './systems/showRunner.js';
import * as booking from './systems/booking.js';
import { formatOf, slotsFor, autoName } from './systems/formats.js';
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
import { draft, setDraftFormat, setOverride } from './ui/screens/show.js';
import * as playback from './ui/playback.js';

// Registration order is nav order, and nav order is the weekly loop:
// look at the roster, book the show, run it, then move the calendar on.
registerScreen('roster', rosterScreen);
registerScreen('show', showScreen);
registerScreen('calendar', calendarScreen);
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
    go('show');
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
  changeFormat({ value }) {
    setDraftFormat(value);
    render();
  },

  bookSegment({ show: showId }, form) {
    const format = formatOf(draft.format);
    const slots = slotsFor(draft.format);

    // Read one select per slot, in the order the format declares them.
    const participants = slots.map((slot, i) => ({
      wrestlerId: form.querySelector(`#slot${i}`)?.value || '',
      side: slot.side,
    })).filter((p) => p.wrestlerId);

    const verdict = booking.validate(showId, draft.format, participants.map((p) => p.wrestlerId));
    if (!verdict.ok) return toast(verdict.problems[0]);

    const typed = form.querySelector('#segName')?.value.trim();
    const limitMin = Math.max(1, Number(form.querySelector('#segLimit')?.value) || 10);

    try {
      store.bookSegment({
        showId,
        format: draft.format,
        kind: format.kind,
        name: typed || autoName(draft.format, participants, store.nameOf),
        timeLimitSec: limitMin * 60,
        participants,
      });
      refresh('Added to the card');
    } catch (err) {
      toast(err.message);
    }
  },

  cutSegment({ id }) {
    store.cutSegment(id, { reason: 'Cut for time' });
    refresh('Cut from the card');
  },

  // --- running the show --------------------------------------------------
  goLive({ id }) {
    try {
      playback.stop();
      runner.goLive(id);
      refresh('On the air');
    } catch (err) {
      toast(err.message);
    }
  },

  changeOverride({ value }) {
    setOverride(value);
  },

  /**
   * Work out the next segment, then play it out on screen. Nothing is recorded
   * until the clock reaches the finish, so the card behind the panel cannot
   * give the result away.
   */
  runNext({ id }) {
    const step = runner.previewNext(id, { overrideWinnerSide: draft.overrideSide || null });
    setOverride('');
    if (!step) return refresh('The card is done');

    playback.start(step, (result) => {
      runner.commitResult(step.segment.id, result);
      const delta = result.actualSec - step.segment.timeLimitSec;
      refresh(delta < -30
        ? `${step.segment.name} ended ${mmssShort(-delta)} inside its limit`
        : `${step.segment.name} went the distance`);
    });
    render();
  },

  playbackSkip() { playback.skip(); },
  playbackSpeed({ value }) { playback.setSpeed(value); },

  runRest({ id }) {
    playback.stop();
    const steps = runner.runRest(id);
    refresh(`Ran the last ${steps.length} segment${steps.length === 1 ? '' : 's'}`);
  },

  goOffAir({ id }) {
    playback.stop();
    const show = runner.goOffAir(id);
    // Pin the route to this show, or "This week" would skip straight past the
    // results to next week's empty card.
    go(`show/${id}`);
    refresh(`${show.name} rated ${show.result.rating}`);
  },

  nextWeek() {
    playback.stop();
    const show = runner.nextWeek();
    if (!show) return toast('Nothing left on the calendar');
    go(`show/${show.id}`);
    refresh(`${show.name}, ${store.getState().calendar.day} days in`);
  },

  // --- log ---------------------------------------------------------------
  filterLog({ value }) {
    setFilter(value);
    render();
  },
});

/** "6:30" from 390 seconds, for toasts. */
function mmssShort(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// --- boot ------------------------------------------------------------------

// Systems subscribe to the event log once, here. They keep working across a new
// game or a save load, so nothing needs re-installing later.
installSystems();

bindEvents();

// Pick up an autosave if one is there, so a refresh does not lose the game.
const resumed = persist.hasSave('auto') && persist.load('auto').ok;
if (!resumed && !location.hash) location.hash = '#/saves';

// Autosave whenever the world moves in a way worth not losing.
store.on('show.completed', () => persist.save('auto', { label: 'Autosave' }));
store.on('calendar.advanced', () => persist.save('auto', { label: 'Autosave' }));
store.on('segment.completed', () => persist.save('auto', { label: 'Autosave' }));

renderHeader(store.isLoaded() ? store.getState() : null);
render();

// A console handle, for poking at the model while developing.
window.WGM = { store, persist, clock, checkState, seedRoster, runner, booking };
