// The open save, and the only place that writes it.
//
// All game state is one serialisable object belonging to one save slot. Every
// mutation goes through commit(), which runs the change, persists it and
// notifies subscribers. Future systems mutate through the same door as the
// buttons do.
import {
  STATE_VERSION, readIndex, listSaves, currentSaveId, createSave, loadSave,
  writeSave, setCurrent, deleteSave, deleteEverything, adoptLegacySave,
} from './saves.js';
import { TIERS } from './model/network.js';
import { makeAirSchedule } from './model/calendar.js';
import { TRAITS } from './model/traits.js';

let state = null;
let saveId = null;
const listeners = new Set();

// Upgrades a save written by an older build rather than discarding it.
function upgrade(saved) {
  if (!saved) return null;

  if (saved.version === 1) {
    saved.week = 1;
    saved.journal = [];
    saved.phase = !saved.broadcast ? 'prep'
      : saved.broadcast.status === 'complete' ? 'after'
      : 'live';
    saved.version = 2;
  }

  if (saved.version === 2) {
    for (const w of saved.wrestlers || []) {
      if (w.archetype === undefined) w.archetype = 'Roster member';
      if (w.morale === undefined) w.morale = 55;
      if (w.weeksOffCard === undefined) w.weeksOffCard = 0;
      if (!Array.isArray(w.grudges)) w.grudges = [];
    }
    saved.version = 3;
  }

  if (saved.version === 3) {
    for (const w of saved.wrestlers || []) {
      if (w.role === undefined) w.role = 'Midcard';
      if (w.bio === undefined) w.bio = '';
      if (w.photo === undefined) w.photo = null;
      if (!w.stats) w.stats = { inRing: 50, charisma: 50, ambition: 50, ego: 50, professionalism: 50 };
      if (!w.record) w.record = { wins: 0, losses: 0 };
      if (w.familiarity === undefined) w.familiarity = 0;
      if (!w.relationships) w.relationships = {};
    }
    saved.version = 4;
  }

  if (saved.version === 4) {
    for (const w of saved.wrestlers || []) {
      if (!w.matchTypes) w.matchTypes = {};
    }
    for (const item of (saved.show && saved.show.items) || []) {
      if (item.type === 'match' && !item.matchType) item.matchType = 'singles';
    }
    saved.version = 5;
  }

  if (saved.version === 5) {
    if (!saved.promotion) {
      saved.promotion = {
        promotion: 'Your first promotion',
        show: (saved.show && saved.show.name) || 'Weekly Show',
      };
    }
    saved.version = 6;
  }

  if (saved.version === 6) {
    // The show's generator position, so incidents roll the same way after a
    // reload instead of being re-rolled from scratch.
    if (saved.rng === undefined) saved.rng = saved.seed || 20260101;
    saved.version = 7;
  }

  if (saved.version === 7) {
    if (saved.pendingIncident === undefined) saved.pendingIncident = null;
    if (!saved.opportunities) saved.opportunities = [];
    if (!saved.gmRecord) saved.gmRecord = { harsh: 0, weak: 0, fair: 0, ignored: 0, booked: 0 };
    saved.version = 8;
  }

  if (saved.version === 8) {
    if (saved.lastReview === undefined) saved.lastReview = null;
    if (!saved.network) {
      // Existing saves keep the window they already had; the tier is read back
      // out of it so nobody's two-hour show shrinks to an hour on upgrade.
      const minutes = (saved.show && saved.show.runtimeMinutes) || 60;
      let tier = 0;
      for (let i = 0; i < TIERS.length; i += 1) {
        if (TIERS[i].minutes <= minutes) tier = i;
      }
      saved.network = { trust: TIERS[tier].trust, tier };
    }
    saved.version = 9;
  }

  if (saved.version === 9) {
    if (!saved.scheduled) saved.scheduled = [];
    if (!saved.history) saved.history = [];
    if (saved.breaches === undefined) saved.breaches = 0;
    saved.version = 10;
  }

  if (saved.version === 10) {
    // Weeks were only integers before this. Give older saves a first air date
    // so their existing week numbers land on real days.
    if (!saved.startDate) {
      const air = makeAirSchedule(() => 0.2); // Tuesdays, for everything that came before
      saved.startDate = air.startDate;
      saved.airNight = air.airNight;
    }
    saved.version = 11;
  }

  if (saved.version === 11) {
    // Older saves get the three base belts, vacant — crowning them is the
    // player's to do rather than something the upgrade decides for them.
    if (!saved.titles) saved.titles = [];
    for (const item of (saved.show && saved.show.items) || []) {
      if (item.type === 'match') {
        if (item.titleId === undefined) item.titleId = null;
        if (item.tag === undefined) item.tag = false;
      }
    }
    saved.version = 12;
  }

  if (saved.version === 12) {
    // Personality splits off from ability. Three traits were living in `stats`
    // where they did not belong; they move across with their values intact
    // rather than being rerolled, because a save's people should not change
    // character on upgrade. The other eight start in the ordinary middle — a
    // roster that has been played for forty weeks keeps its history, and the
    // new dimensions simply begin as unremarkable.
    for (const w of saved.wrestlers || []) {
      const stats = w.stats || (w.stats = {});
      w.traits = w.traits || {};
      for (const { key } of TRAITS) {
        if (Number.isFinite(w.traits[key])) continue;
        w.traits[key] = Number.isFinite(stats[key]) ? stats[key] : 50;
      }
      delete stats.ambition;
      delete stats.ego;
      delete stats.professionalism;

      // Morale exists; the account of it does not. Rather than invent memories
      // for things that already happened, the ledger starts empty and the mood
      // they already had becomes their natural level — so nobody's temper
      // changes on upgrade, and everything from here on is measured from it.
      if (!Array.isArray(w.memories)) w.memories = [];
      if (!Number.isFinite(w.baseline)) w.baseline = Number.isFinite(w.morale) ? w.morale : 55;

      for (const rel of Object.values(w.relationships || {})) {
        if (rel.owed === undefined) rel.owed = 0;
        if (rel.tie === undefined) rel.tie = null;
      }
    }
    saved.version = 13;
  }

  if (saved.version === 13) {
    // The backstage layer. A save mid-show has nobody placed in the building
    // and no clock, so the night it is in the middle of runs out its remaining
    // segments with the GM at the curtain and everyone simply present — the
    // reaction engine falls back to that when `whereabouts` is empty, which is
    // exactly the pre-Tier-3 behaviour. The next show places everybody
    // properly.
    if (!saved.location) saved.location = 'gorilla';
    if (!saved.whereabouts) saved.whereabouts = {};
    if (saved.clock === undefined) saved.clock = null;
    if (!Array.isArray(saved.alerts)) saved.alerts = [];
    if (!Array.isArray(saved.missed)) saved.missed = [];
    if (!Array.isArray(saved.deferred)) saved.deferred = [];
    if (!Array.isArray(saved.spokenTo)) saved.spokenTo = [];
    if (!saved.security) saved.security = { used: 0 };

    saved.gmRecord = saved.gmRecord || {};
    for (const key of ['harsh', 'weak', 'fair', 'ignored', 'booked', 'gaveIn', 'delayed', 'missed']) {
      if (saved.gmRecord[key] === undefined) saved.gmRecord[key] = 0;
    }
    saved.version = 14;
  }

  if (saved.version === 14) {
    // Threads are a reading of what has already happened rather than a store of
    // anything, so an upgraded save starts with none and builds them from the
    // week it is upgraded on. The history is still in the archived journals;
    // it simply is not retro-read, because a feud the game noticed halfway
    // through is a stranger thing than one it started watching today.
    if (!Array.isArray(saved.threads)) saved.threads = [];
    for (const w of saved.wrestlers || []) {
      if (w.injuredUntil === undefined) w.injuredUntil = null;
      for (const rel of Object.values(w.relationships || {})) {
        // Team-ups used to be filed as ordinary matches — your own tag partner
        // read as a rival you kept meeting — so an existing save has no record
        // of who partnered whom. It starts at nought and builds from here
        // rather than being guessed at out of the archive.
        if (rel.teamed === undefined) rel.teamed = 0;
      }
    }
    saved.version = 15;
  }

  return saved.version === STATE_VERSION ? saved : null;
}

export function load() {
  adoptLegacySave(upgrade);

  const index = readIndex();
  if (!index.currentId) return null;

  const raw = loadSave(index.currentId);
  // upgrade() mutates in place, so the stored version has to be read first or
  // the write-back below never fires and the save stays old on disk.
  const wasVersion = raw ? raw.version : null;
  const upgraded = upgrade(raw);
  if (!upgraded) return null;

  saveId = index.currentId;
  state = upgraded;
  if (wasVersion !== STATE_VERSION) writeSave(saveId, state);
  return state;
}

export function getState() {
  return state;
}

export function getSaveId() {
  return saveId;
}

export function save() {
  if (saveId) writeSave(saveId, state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  for (const fn of listeners) fn(state);
}

// The one write path.
export function commit(mutate) {
  mutate(state);
  save();
  notify();
}

export function saves() {
  return listSaves();
}

export function activeSaveId() {
  return currentSaveId();
}

export function startNewSave() {
  const created = createSave();
  saveId = created.id;
  state = created.state;
  notify();
  return created.id;
}

export function openSave(id) {
  const raw = loadSave(id);
  const wasVersion = raw ? raw.version : null;
  const upgraded = upgrade(raw);
  if (!upgraded) return false;
  setCurrent(id);
  saveId = id;
  state = upgraded;
  if (wasVersion !== STATE_VERSION) writeSave(saveId, state);
  notify();
  return true;
}

export function removeSave(id) {
  const nextId = deleteSave(id);
  if (saveId === id) {
    saveId = null;
    state = null;
    if (nextId) openSave(nextId);
  }
  notify();
}

export function resetAll() {
  deleteEverything();
  location.reload();
}
