// Save slots.
//
// Each save is a separate world with its own promotion, its own roster and its
// own ids, kept under its own storage key. An index lists them and remembers
// which one is open. The generator is seeded, so a save carries the seed that
// produced its roster and could be rebuilt from it.
import { resetIds, primeIds } from './ids.js';
import { makeRng, randomSeed } from './model/random.js';
import { generateRoster, generatePromotion } from './model/generate.js';
import { makeAirSchedule } from './model/calendar.js';
import { seedTitles } from './model/titles.js';
import { createGame } from './model/game.js';

const INDEX_KEY = 'wgm_index_v1';
const SAVE_PREFIX = 'wgm_save_';
const LEGACY_KEY = 'wgm_v1';

export const STATE_VERSION = 18;

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // storage full or blocked; the session keeps running in memory
  }
}

export function readIndex() {
  const index = read(INDEX_KEY);
  if (index && Array.isArray(index.saves)) return index;
  return { version: 1, currentId: null, saves: [] };
}

function writeIndex(index) {
  write(INDEX_KEY, index);
}

function saveKey(id) {
  return SAVE_PREFIX + id;
}

function newId() {
  return Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

export function listSaves() {
  return readIndex().saves;
}

export function currentSaveId() {
  return readIndex().currentId;
}

// Builds a whole world: a promotion, a roster, and the history that existed
// before the player took the job.
// `setup` is what the new-save screen produced, or null for a straight roll.
// Everything it does not say is still decided by the seed, which is what keeps
// a shared setup code short and what makes two people with the same code get
// the same locker room.
export function createSave(seedOrSetup = randomSeed()) {
  const setup = typeof seedOrSetup === 'object' && seedOrSetup ? seedOrSetup : null;
  const seed = setup ? setup.seed : seedOrSetup;

  resetIds();
  const rng = makeRng(seed);
  const rolled = generatePromotion(rng);
  const air = makeAirSchedule(rng);
  const promotion = {
    promotion: (setup && setup.promotion) || rolled.promotion,
    show: (setup && setup.show) || rolled.show,
  };
  if (setup && setup.airNight) air.airNight = setup.airNight;

  const wrestlers = applyRosterEdits(generateRoster(rng, setup && setup.rosterSize), setup);
  const titles = seedTitles(wrestlers, rng, setup && setup.titles);

  const state = {
    version: STATE_VERSION, seed, rng: seed,
    setup: setup ? { ...setup } : null,
    ...createGame({ wrestlers, promotion, air, titles, setup }),
  };

  const id = newId();
  write(saveKey(id), state);

  const index = readIndex();
  index.saves.unshift({
    id,
    seed,
    name: promotion.promotion,
    show: promotion.show,
    week: 1,
    roster: wrestlers.length,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  index.currentId = id;
  writeIndex(index);

  return { id, state };
}

// The edits a setup carries, applied on top of the generated roster. Dropping
// somebody happens last so the indexes in `edits` still line up with what the
// player was looking at when they made them.
function applyRosterEdits(wrestlers, setup) {
  if (!setup) return wrestlers;

  const edited = wrestlers.map((wrestler, index) => {
    const edit = setup.edits && setup.edits[index];
    if (!edit) return wrestler;
    const next = { ...wrestler };
    if (edit.name) next.name = edit.name;
    if (edit.gender) next.gender = edit.gender;
    if (edit.alignment) next.alignment = edit.alignment;
    if (edit.role) next.role = edit.role;
    if (edit.bio !== undefined) next.bio = edit.bio;
    return next;
  });

  const dropped = new Set(setup.dropped || []);
  const kept = edited.filter((_, index) => !dropped.has(index));
  // Never hand back an empty locker room, whatever the code asked for.
  return kept.length >= 4 ? kept : edited;
}

export function loadSave(id) {
  const state = read(saveKey(id));
  if (!state) return null;
  resetIds();
  primeIds(collectIds(state));
  return state;
}

export function writeSave(id, state) {
  write(saveKey(id), state);

  const index = readIndex();
  const entry = index.saves.find(s => s.id === id);
  if (entry) {
    entry.week = state.week;
    entry.roster = state.wrestlers.length;
    entry.updatedAt = Date.now();
    writeIndex(index);
  }
}

export function setCurrent(id) {
  const index = readIndex();
  index.currentId = id;
  writeIndex(index);
}

export function deleteSave(id) {
  try {
    localStorage.removeItem(saveKey(id));
  } catch {
    // nothing to do; the index entry still goes
  }
  const index = readIndex();
  index.saves = index.saves.filter(s => s.id !== id);
  if (index.currentId === id) index.currentId = index.saves.length ? index.saves[0].id : null;
  writeIndex(index);
  return index.currentId;
}

export function deleteEverything() {
  for (const entry of listSaves()) {
    try {
      localStorage.removeItem(saveKey(entry.id));
    } catch {
      // keep going
    }
  }
  try {
    localStorage.removeItem(INDEX_KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // ignore
  }
}

// Every id in a save, so the counter resumes above the highest one in use.
export function collectIds(state) {
  const ids = [];
  for (const w of state.wrestlers || []) {
    ids.push(w.id);
    for (const g of w.grudges || []) ids.push(g.id);
  }
  if (state.show) {
    ids.push(state.show.id);
    for (const item of state.show.items || []) ids.push(item.id);
  }
  for (const entry of state.journal || []) ids.push(entry.id);
  return ids;
}

// A game played before saves existed lived under one key. Rather than stranding
// it, fold it in as the first slot.
export function adoptLegacySave(upgrade) {
  const legacy = read(LEGACY_KEY);
  if (!legacy) return false;

  const state = upgrade(legacy);
  if (!state) return false;

  const id = newId();
  write(saveKey(id), state);

  const index = readIndex();
  index.saves.unshift({
    id,
    seed: state.seed || null,
    name: (state.promotion && state.promotion.promotion) || 'Your first save',
    show: (state.promotion && state.promotion.show) || 'Weekly Show',
    week: state.week || 1,
    roster: (state.wrestlers || []).length,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  if (!index.currentId) index.currentId = id;
  writeIndex(index);

  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // ignore
  }
  return true;
}
