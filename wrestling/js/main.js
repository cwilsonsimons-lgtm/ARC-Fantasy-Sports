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
import { seedTitles } from './data/titles.js';
import { installSystems } from './systems/index.js';
import * as runner from './systems/showRunner.js';
import * as booking from './systems/booking.js';
import * as rankings from './systems/rankings.js';
import { formatOf, slotsFor, autoName } from './systems/formats.js';
import { locationName, locationShort } from './models/location.js';
import {
  registerScreen, registerActions, bindEvents, render, go, toast,
  renderHeader, setWhenFormatter, setChipProvider, chip,
} from './ui/shell.js';

import rosterScreen from './ui/screens/roster.js';
import wrestlerScreen from './ui/screens/wrestler.js';
import calendarScreen from './ui/screens/calendar.js';
import showScreen from './ui/screens/show.js';
import logScreen, { setFilter } from './ui/screens/log.js';
import savesScreen from './ui/screens/saves.js';
import { draft, setDraftFormat, setOverride, setDraftTitle } from './ui/screens/show.js';
import titlesScreen from './ui/screens/titles.js';
import lockerRoomScreen from './ui/screens/lockerroom.js';
import backstageScreen from './ui/screens/backstage.js';
import troubleScreen from './ui/screens/trouble.js';
import requestsScreen from './ui/screens/requests.js';
import { denyRequest as refuseRequest } from './systems/requests.js';
import * as incidents from './systems/incidents.js';
import * as playback from './ui/playback.js';
import { setRailText, setRailOnly } from './ui/rosterRail.js';

// Registration order is nav order, and nav order is the weekly loop:
// look at the roster, book the show, run it, then move the calendar on.
registerScreen('roster', rosterScreen);
registerScreen('show', showScreen);
registerScreen('backstage', backstageScreen);
registerScreen('trouble', troubleScreen);
registerScreen('requests', requestsScreen);
registerScreen('titles', titlesScreen);
registerScreen('lockerroom', lockerRoomScreen);
registerScreen('calendar', calendarScreen);
registerScreen('log', logScreen);
registerScreen('saves', savesScreen);
registerScreen('wrestler', wrestlerScreen);

setWhenFormatter((state) =>
  `${clock.formatDate(state.calendar)} · ${clock.formatGameTime(state.calendar.day)}`);

// The status chips. Every one is a number the game really keeps.
setChipProvider((state) => {
  const roster = store.allWrestlers();
  const morale = roster.length
    ? Math.round(roster.reduce((t, w) => t + w.state.morale, 0) / roster.length) : 0;
  const open = store.openRequests().length;
  const unheard = store.unreadNotifications().length;
  const waiting = store.answerableIncidents().length;
  const heldTitles = store.allTitles().filter((t) => t.lineage.some((r) => r.lostOnDay == null)).length;
  const day = state.calendar.day;

  return [
    chip({ icon: 'roster', value: roster.length, caption: 'Roster' }),
    chip({
      icon: 'morale', tone: morale >= 55 ? 'green' : morale >= 35 ? 'amber' : '',
      value: morale, caption: 'Locker room',
    }),
    chip({ icon: 'belt', tone: 'amber', value: `${heldTitles}/${store.allTitles().length}`, caption: 'Titles held' }),
    chip({ icon: 'mail', tone: open ? 'violet' : '', value: open, caption: 'Requests', badge: open || null }),
    chip({
      icon: 'ear', tone: unheard ? 'blue' : 'dim',
      value: locationShort(store.gmLocation()), caption: 'Backstage',
      badge: unheard || null,
    }),
    chip({
      icon: 'flare', tone: waiting ? 'red' : 'dim',
      value: waiting, caption: 'Trouble', badge: waiting || null,
    }),
    chip({
      icon: 'cal',
      value: `Week ${clock.weekOf(day)}`,
      caption: clock.formatDate(state.calendar, day),
    }),
  ].join('');
});

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
    seedTitles(store);
    rankings.refresh();
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
  railSearch({ value }) {
    setRailText(value);
    render();
  },

  railOnly({ arg }) {
    setRailOnly(arg);
    render();
  },

  changeFormat({ value }) {
    setDraftFormat(value);
    render();
  },

  changeTitle({ value }) {
    setDraftTitle(value);
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

    const titleId = draft.titleId || null;
    const verdict = booking.validate(showId, draft.format, participants.map((p) => p.wrestlerId), { titleId });
    if (!verdict.ok) return toast(verdict.problems[0]);

    const typed = form.querySelector('#segName')?.value.trim();
    const limitMin = Math.max(1, Number(form.querySelector('#segLimit')?.value) || 10);

    try {
      store.bookSegment({
        showId,
        format: draft.format,
        kind: format.kind,
        titleId,
        name: typed || autoName(draft.format, participants, store.nameOf),
        timeLimitSec: limitMin * 60,
        participants,
      });
      setDraftTitle('');
      // Booking past the contender is allowed, and worth saying out loud.
      refresh(verdict.warnings.length ? verdict.warnings[0] : 'Added to the card');
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
    const held = runner.blockedBy(id);
    if (held) {
      go('show');
      return toast(`${store.nameOf(held.incident.instigatorId)} will not go out. Deal with it first.`);
    }
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
    const held = runner.blockedBy(id);
    refresh(held
      ? `Ran ${steps.length}, then ${store.nameOf(held.incident.instigatorId)} would not go out`
      : `Ran the last ${steps.length} segment${steps.length === 1 ? '' : 's'}`);
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

  // --- backstage ---------------------------------------------------------
  /**
   * Walk somewhere. The clock moves, which is the only reason this is a
   * decision rather than a menu: anything that happens while you are in the
   * corridor happens without you.
   */
  walkTo({ room }) {
    const before = store.gmLocation();
    if (room === before) return;
    try {
      const walk = store.moveGm(room);
      const landed = store.deliverDueNotifications({ cause: walk.event?.id || null });
      refresh(landed.length
        ? `${locationName(room)}, ${mmssShort(walk.seconds)} later. ${landed.length} thing${landed.length === 1 ? '' : 's'} caught up with you`
        : `${locationName(room)}, ${mmssShort(walk.seconds)} later`);
    } catch (err) {
      toast(err.message);
    }
  },

  /**
   * Answer an incident. The system decides what it costs; this only reports it.
   */
  respondTo({ id, response }) {
    const incident = store.getIncident(id);
    if (!incident) return toast('That is no longer open');
    try {
      const out = incidents.respond(id, response);
      refresh(out.landed
        ? out.summary
        : `${out.summary}. Try something else.`);
    } catch (err) {
      toast(err.message);
    }
  },

  readNews({ id }) {
    store.markNotificationRead(id);
    render();
  },

  markAllNews() {
    store.markAllNotificationsRead();
    render();
  },

  denyRequest({ id }) {
    const request = store.getRequest(id);
    refuseRequest(id, { reason: 'Told no by the GM' });
    refresh(request ? `${store.nameOf(request.wrestlerId)} was told no` : 'Refused');
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
window.WGM = { store, persist, clock, checkState, seedRoster, seedTitles, runner, booking, rankings };
