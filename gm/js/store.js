// The single source of truth, and the only place that writes to storage.
//
// All game state is one serialisable object. Every mutation goes through
// commit(), which runs the change, saves, then notifies subscribers. Future
// systems (incidents, morale, messages from bosses) mutate through the same
// door as the buttons do, so nothing has to be re-plumbed to add them.
import { primeIds } from './ids.js';
import { createGame } from './model/game.js';

const KEY = 'wgm_v1';
const VERSION = 5;

let state = null;
const listeners = new Set();

function freshState() {
  return { version: VERSION, ...createGame() };
}

// Upgrade older saves in place rather than silently wiping the player's card.
function migrate(saved) {
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
      if (!w.stats) {
        w.stats = { inRing: 50, charisma: 50, ambition: 50, ego: 50, professionalism: 50 };
      }
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
  return saved;
}

// Every id in the save, so the id counter resumes above the highest one used.
function collectIds(s) {
  const ids = [];
  for (const w of s.wrestlers || []) ids.push(w.id);
  if (s.show) {
    ids.push(s.show.id);
    for (const it of s.show.items || []) ids.push(it.id);
  }
  for (const entry of s.journal || []) ids.push(entry.id);
  for (const w of s.wrestlers || []) {
    for (const g of w.grudges || []) ids.push(g.id);
  }
  return ids;
}

export function load() {
  let saved = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) saved = JSON.parse(raw);
  } catch {
    saved = null; // corrupt or unavailable storage: start clean rather than fail
  }

  const wasVersion = saved ? saved.version : null;
  if (saved) saved = migrate(saved);

  if (saved && saved.version === VERSION) {
    primeIds(collectIds(saved));
    state = saved;
    // Write the upgrade back now. Otherwise a player who loads and makes no
    // change leaves an old-shaped save on disk to be migrated again next time.
    if (wasVersion !== VERSION) save();
  } else {
    state = freshState();
    save();
  }
  return state;
}

export function getState() {
  return state;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked. The prototype keeps running in memory.
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  for (const fn of listeners) fn(state);
}

// The one write path. mutate(state) makes the change; commit persists and redraws.
export function commit(mutate) {
  mutate(state);
  save();
  notify();
}

export function resetAll() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  location.reload();
}
