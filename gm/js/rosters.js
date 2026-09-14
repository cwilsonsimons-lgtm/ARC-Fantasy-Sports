// The locker-room library.
//
// Saves are worlds and are deleted with the world. This is the shelf beside
// them: rosters you have kept, which outlive the promotion they came from and
// can be dropped into a new one. Save a roster at week sixty and start a fresh
// promotion with the same people and none of the history.
//
// Stored the same way saves are — an index plus one key per entry — so a
// twenty-eight person locker room is not re-parsed every time the list is
// drawn.
import { nextId } from './ids.js';
import { toRosterFile, fromRosterFile, valid, describe } from './model/roster-file.js';

const INDEX_KEY = 'wgm_rosters_v1';
const ROSTER_PREFIX = 'wgm_roster_';

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
    // A locker room with photos in it can be large enough to fill the quota.
    // Failing to save is a thing the interface has to be able to say.
    return false;
  }
}

function readIndex() {
  const index = read(INDEX_KEY);
  return index && Array.isArray(index.rosters) ? index : { rosters: [] };
}

function writeIndex(index) {
  return write(INDEX_KEY, index);
}

const keyFor = id => ROSTER_PREFIX + id;

// ---------------------------------------------------------------- the shelf

export function listRosters() {
  return readIndex().rosters;
}

export function readRoster(id) {
  const file = read(keyFor(id));
  return valid(file) ? file : null;
}

// Keeps a roster taken from live wrestlers. Returns the index entry, or null
// if it could not be written.
export function saveRoster(wrestlers, name, source = '') {
  const file = toRosterFile(wrestlers, name || 'Locker room');
  return keepFile(file, source);
}

// Keeps a roster that arrived as a file — pasted in, or handed over.
export function keepFile(file, source = '') {
  if (!valid(file)) return null;

  const id = nextId('lr');
  if (!write(keyFor(id), file)) return null;

  const entry = {
    id,
    name: file.name || 'Locker room',
    count: file.wrestlers.length,
    teams: (file.ties || []).filter(t => t.tie === 'tag-team').length,
    source,
    createdAt: file.createdAt || Date.now(),
  };

  const index = readIndex();
  index.rosters.unshift(entry);
  if (!writeIndex(index)) {
    try { localStorage.removeItem(keyFor(id)); } catch { /* nothing to undo */ }
    return null;
  }
  return entry;
}

export function renameRoster(id, name) {
  const file = readRoster(id);
  if (!file) return false;
  file.name = name;
  if (!write(keyFor(id), file)) return false;

  const index = readIndex();
  const entry = index.rosters.find(r => r.id === id);
  if (entry) entry.name = name;
  return writeIndex(index);
}

export function removeRoster(id) {
  try { localStorage.removeItem(keyFor(id)); } catch { /* already gone */ }
  const index = readIndex();
  index.rosters = index.rosters.filter(r => r.id !== id);
  return writeIndex(index);
}

// Whole wrestlers, ready to be handed to a new save. Ids are minted here, so
// this must be called inside the same id scope the save is being built in.
export function hydrate(id) {
  const file = readRoster(id);
  return file ? fromRosterFile(file) : null;
}

export { describe };
