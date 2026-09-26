// WWE Universe — saving, loading, export and import.
//
// The universe lives under its own localStorage key. Universe is a separate
// app from the fantasy league in this repository, but opened from the same
// place - both as local files in Chrome, say - the two share one browser
// storage area, so the fantasy keys (cbd_team_v1, arc_markets_v1) are never
// read or written here. Storage is passed in rather than reached for, so the
// same code runs against a stand-in under Node.
//
// The one rule that matters: a save that can't be read is never overwritten.
// It is copied aside first, and if even that fails the caller is told to stay
// read-only, so whatever went wrong can still be recovered by hand.
import { UniverseError, createUniverse, migrate, validate } from './model.js';

export const STORAGE_KEY = 'wwe_universe_v1';

/**
 * Returns { state, status, problems, backupKey, readOnly }.
 *   status 'new'         - nothing saved yet; a fresh universe
 *   status 'loaded'      - read back; `problems` lists anything inconsistent
 *   status 'recovered'   - the save was unreadable; it was copied to `backupKey`
 *                          and a fresh universe started in its place
 *   status 'unavailable' - storage itself can't be used (blocked or disabled)
 */
export function loadUniverse(storage) {
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch (e) {
    return { state: createUniverse(), status: 'unavailable', problems: [], backupKey: null, readOnly: false };
  }
  if (raw == null) return { state: createUniverse(), status: 'new', problems: [], backupKey: null, readOnly: false };

  try {
    const state = migrate(JSON.parse(raw));
    return { state, status: 'loaded', problems: validate(state), backupKey: null, readOnly: false };
  } catch (e) {
    const backupKey = setAside(storage, raw);
    return {
      state: createUniverse(), status: 'recovered', problems: [String((e && e.message) || e)],
      backupKey,
      // nowhere safe to put the old save - don't let the next save destroy it
      readOnly: !backupKey,
    };
  }
}

function setAside(storage, raw) {
  try {
    for (let i = 1; i < 100; i++) {
      const key = `${STORAGE_KEY}:unreadable-${i}`;
      const there = storage.getItem(key);
      if (there === raw) return key;              // already kept on an earlier load
      if (there == null) { storage.setItem(key, raw); return key; }
    }
  } catch (e) { /* quota or blocked: fall through */ }
  return null;
}

/**
 * Returns false if the write failed (storage full or blocked). Restore points
 * share the browser's storage, so when it's full they give way - oldest
 * first - before the universe itself ever fails to save.
 */
export function saveUniverse(storage, state) {
  const text = JSON.stringify(state);
  for (;;) {
    try {
      storage.setItem(STORAGE_KEY, text);
      return true;
    } catch (e) {
      if (!dropOldestRestorePoint(storage)) return false;
    }
  }
}

// ---------------------------------------------------------------- restore points
//
// Copies of the universe kept in this browser: taken automatically before an
// import, a reset or a restore replaces it, and when the week moves on (only
// the newest of those is kept), or by hand. An index of what's kept lives
// under RESTORE_KEY; each copy under its own key. They're a safety net for
// this browser only - a save file is still the real backup.

export const RESTORE_KEY = `${STORAGE_KEY}:restore`;
export const EXPORTED_KEY = `${STORAGE_KEY}:exported`;
export const MAX_RESTORE = 4;
const pointKey = id => `${RESTORE_KEY}:${id}`;

function readIndex(storage) {
  try {
    const list = JSON.parse(storage.getItem(RESTORE_KEY) || '[]');
    return Array.isArray(list) ? list.filter(p => p && Number.isInteger(p.id)) : [];
  } catch (e) {
    return [];
  }
}
function writeIndex(storage, list) { storage.setItem(RESTORE_KEY, JSON.stringify(list)); }

/** What's kept, newest first: [{ id, label, kind, when, clock, counts }]. */
export function listRestorePoints(storage) {
  return readIndex(storage).sort((a, b) => b.id - a.id);
}

function dropOldestRestorePoint(storage) {
  try {
    const list = readIndex(storage).sort((a, b) => a.id - b.id);
    if (!list.length) return false;
    storage.removeItem(pointKey(list[0].id));
    writeIndex(storage, list.slice(1));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Keep a copy of `state`. `kind` is 'weekly' (only the newest weekly copy is
 * kept), 'import', 'reset', 'restore' or 'manual'; `when` is an ISO time from
 * the caller. At most MAX_RESTORE are kept, oldest dropped first. Returns
 * false - changing nothing that matters - if there's no room.
 */
export function keepRestorePoint(storage, state, { label, kind = 'manual', when = '', clock = '', counts = null } = {}) {
  let list;
  try {
    list = readIndex(storage);
    writeIndex(storage, list);                   // storage that takes no writes at all: leave what's kept alone
  } catch (e) {
    return false;
  }
  const drop = p => { storage.removeItem(pointKey(p.id)); list = list.filter(x => x !== p); };
  const oldest = () => list.reduce((a, b) => (a.id < b.id ? a : b));
  let kept = false;
  try {
    if (kind === 'weekly') list.filter(p => p.kind === 'weekly').forEach(drop);
    while (list.length >= MAX_RESTORE) drop(oldest());
    const id = list.reduce((n, p) => Math.max(n, p.id), 0) + 1;
    const data = JSON.stringify(state);
    for (;;) {
      try {
        storage.setItem(pointKey(id), data);
        break;
      } catch (e) {
        if (!list.length) throw e;
        drop(oldest());                          // a newer copy is worth more than the oldest
      }
    }
    list.push({ id, label: String(label || 'Restore point'), kind, when: String(when), clock: String(clock), counts });
    kept = true;
  } catch (e) { /* no room for this one */ }
  try { writeIndex(storage, list); } catch (e) { return false; }   // the index always matches what's really kept
  return kept;
}

/** A kept copy, checked exactly like an imported save file. Throws a UniverseError if it can't be used. */
export function readRestorePoint(storage, id) {
  let text = null;
  try { text = storage.getItem(pointKey(id)); } catch (e) { /* blocked */ }
  if (text == null) throw new UniverseError('That restore point is no longer in this browser.');
  return importUniverse(text);
}

/** When a save file was last exported from this browser - an ISO time, or null. */
export function lastExported(storage) {
  try { return storage.getItem(EXPORTED_KEY); } catch (e) { return null; }
}
export function noteExported(storage, when) {
  try { storage.setItem(EXPORTED_KEY, String(when)); } catch (e) { /* not worth failing an export over */ }
}

/** The whole universe as a readable JSON file. */
export function exportUniverse(state) {
  return JSON.stringify(state, null, 2) + '\n';
}

/**
 * Parse a save file. Throws a UniverseError - and changes nothing - unless the
 * file is a universe this version understands and its data is fully sound.
 */
export function importUniverse(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new UniverseError('That file is not a universe save (it is not valid JSON).');
  }
  const state = migrate(data);
  const problems = validate(state);
  if (problems.length) {
    const more = problems.length > 3 ? ` (and ${problems.length - 3} more)` : '';
    throw new UniverseError(`That save has ${problems.length} problem${problems.length > 1 ? 's' : ''}: ${problems.slice(0, 3).join(' ')}${more}`);
  }
  return state;
}
