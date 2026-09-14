// Save and load.
//
// A save is the whole world: state, the ID counters, and the RNG position. The
// counters matter because without them a reloaded game would mint `w_0003` a
// second time; the RNG position matters because without it, reloading changes
// what happens next and the design's promise that a save develops its own way
// stops being true.
//
// Storage is injected rather than assumed, so the core stays DOM-free and the
// same code runs under the headless check in tools/.

import * as ids from './ids.js';
import { G, installState, emit, SCHEMA_VERSION } from './store.js';
import { EVENT_TYPES } from './events.js';
import { checkState } from './invariants.js';

export const SAVE_FORMAT = 'wgm-save';
export const SAVE_PREFIX = 'wgm_save_';
export const SAVE_INDEX_KEY = 'wgm_saves';

/** In-memory fallback so saving never throws where localStorage is absent. */
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}

let storage = (() => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('wgm_probe', '1');
      localStorage.removeItem('wgm_probe');
      return localStorage;
    }
  } catch { /* private mode, quota, or no DOM */ }
  return memoryStorage();
})();

export function setStorage(next) { storage = next; }

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

/**
 * Keyed by the version being migrated FROM. Each returns the state at version
 * key+1. Adding a field to a model means adding a migration here, so an old
 * save keeps loading instead of failing in a way nobody notices until later.
 */
export const MIGRATIONS = {
  // v1 -> v2: segments gained a `format` key (Tier 1 match types). Saves from
  // v1 only ever held singles matches and plain segments, so the format is
  // recoverable from the kind.
  1: (state) => {
    for (const segment of Object.values(state.segments)) {
      if (!segment.format) {
        segment.format = segment.kind === 'match' ? 'singles' : segment.kind;
      }
    }
    return state;
  },
};

export function migrate(state, fromVersion) {
  let v = fromVersion;
  let out = state;
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`No migration from schema v${v} to v${v + 1}`);
    out = step(out);
    v += 1;
  }
  out.meta.schemaVersion = SCHEMA_VERSION;
  return out;
}

// ---------------------------------------------------------------------------
// Serialise / deserialise
// ---------------------------------------------------------------------------

/** The full save envelope, as a plain object. */
export function serialize({ label = '', slot = 'auto' } = {}) {
  if (!G.state) throw new Error('Nothing to save: no game loaded');
  return {
    format: SAVE_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    slot,
    label,
    summary: saveSummary(),
    counters: ids.exportCounters(),
    rng: G.rng.getState(),
    state: G.state,
  };
}

/** Small header shown in the save list without parsing the whole file. */
export function saveSummary() {
  const s = G.state;
  return {
    gmName: s.meta.gmName,
    brandName: s.meta.brandName,
    day: s.calendar.day,
    rosterSize: Object.keys(s.wrestlers).length,
    showsRun: Object.values(s.shows).filter((x) => x.status === 'complete').length,
    events: s.log.length,
  };
}

export function toJSON(opts) {
  return JSON.stringify(serialize(opts));
}

/**
 * Restore a save envelope into the live game.
 * Refuses a save from a newer build rather than loading it half-understood.
 */
export function deserialize(envelope, { validate = true } = {}) {
  if (!envelope || envelope.format !== SAVE_FORMAT) {
    throw new Error('Not a wrestling GM save file');
  }
  if (envelope.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `Save is from a newer version (v${envelope.schemaVersion}, this build reads v${SCHEMA_VERSION})`
    );
  }
  const state = envelope.schemaVersion < SCHEMA_VERSION
    ? migrate(envelope.state, envelope.schemaVersion)
    : envelope.state;

  if (validate) {
    const problems = checkState(state);
    if (problems.length) {
      throw new Error(`Save failed integrity checks:\n- ${problems.join('\n- ')}`);
    }
  }

  ids.importCounters(envelope.counters || {});
  installState(state, envelope.rng, { seed: state.meta.seed });
  emit(EVENT_TYPES.GAME_LOADED, {
    summary: `Loaded ${envelope.label || envelope.slot || 'save'}`,
    data: { savedAt: envelope.savedAt, schemaVersion: envelope.schemaVersion },
  });
  return G.state;
}

export function fromJSON(text, opts) {
  return deserialize(JSON.parse(text), opts);
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

function readIndex() {
  try { return JSON.parse(storage.getItem(SAVE_INDEX_KEY)) || {}; }
  catch { return {}; }
}

function writeIndex(index) {
  try { storage.setItem(SAVE_INDEX_KEY, JSON.stringify(index)); return true; }
  catch { return false; }
}

/**
 * Write to a slot. Returns `{ok, error}` rather than throwing, because a full
 * or blocked quota is a normal condition the UI has to report, not a crash.
 */
export function save(slot = 'auto', { label = '' } = {}) {
  try {
    const envelope = serialize({ slot, label });
    storage.setItem(SAVE_PREFIX + slot, JSON.stringify(envelope));
    const index = readIndex();
    index[slot] = {
      slot, label,
      savedAt: envelope.savedAt,
      schemaVersion: envelope.schemaVersion,
      summary: envelope.summary,
    };
    writeIndex(index);
    emit(EVENT_TYPES.GAME_SAVED, { summary: `Saved to ${slot}`, data: { slot, label } });
    return { ok: true, slot, savedAt: envelope.savedAt };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function load(slot = 'auto') {
  const raw = storage.getItem(SAVE_PREFIX + slot);
  if (!raw) return { ok: false, error: `No save in slot "${slot}"` };
  try {
    fromJSON(raw);
    return { ok: true, slot };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function listSaves() {
  return Object.values(readIndex()).sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}

export function deleteSave(slot) {
  try {
    storage.removeItem(SAVE_PREFIX + slot);
    const index = readIndex();
    delete index[slot];
    writeIndex(index);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function hasSave(slot) {
  return storage.getItem(SAVE_PREFIX + slot) != null;
}
