// WWE Universe — saving, loading, export and import.
//
// The universe lives under its own localStorage key, apart from the fantasy
// league (cbd_team_v1) and Arc Markets (arc_markets_v1); neither is read or
// written here. Storage is passed in rather than reached for, so the same code
// runs against a stand-in under Node.
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

/** Returns false if the write failed (storage full or blocked). */
export function saveUniverse(storage, state) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    return false;
  }
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
