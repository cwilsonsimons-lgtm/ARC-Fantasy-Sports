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
