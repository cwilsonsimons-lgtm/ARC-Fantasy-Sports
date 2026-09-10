// The single source of truth, and the only place that writes to storage.
//
// All game state is one serialisable object. Every mutation goes through
// commit(), which runs the change, saves, then notifies subscribers. Future
// systems (incidents, morale, messages from bosses) mutate through the same
// door as the buttons do, so nothing has to be re-plumbed to add them.
import { primeIds } from './ids.js';
import { seedRoster } from './data/roster-seed.js';
import { createShow } from './model/show.js';

const KEY = 'wgm_v1';
const VERSION = 1;

let state = null;
const listeners = new Set();

function freshState() {
  return {
    version: VERSION,
    wrestlers: seedRoster(),
    show: createShow({ name: 'Weekly Show' }),
    broadcast: null,
  };
}

// Every id in the save, so the id counter resumes above the highest one used.
function collectIds(s) {
  const ids = [];
  for (const w of s.wrestlers || []) ids.push(w.id);
  if (s.show) {
    ids.push(s.show.id);
    for (const it of s.show.items || []) ids.push(it.id);
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

  if (saved && saved.version === VERSION) {
    primeIds(collectIds(saved));
    state = saved;
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
