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

  // v2 -> v3: championships and rankings arrive. Titles are a new registry, and
  // a wrestler's reign list moves into the title's lineage where it belongs -
  // one reign, one home. Nothing is recoverable from a v2 save's reign stubs
  // (they never had a real title to point at), so they are dropped rather than
  // turned into a lineage that never happened.
  2: (state) => {
    state.titles = state.titles || {};
    for (const w of Object.values(state.wrestlers)) {
      delete w.standing.titleReigns;
      if (w.standing.rank === undefined) w.standing.rank = null;
      if (w.standing.rankPoints === undefined) w.standing.rankPoints = 0;
    }
    // No titles existed at v2, so any titleId anywhere is a dangling reference
    // by definition. Clear them rather than importing broken links.
    for (const seg of Object.values(state.segments)) {
      seg.titleId = null;
    }
    for (const r of Object.values(state.requests || {})) {
      r.titleId = null;
    }
    return state;
  },

  // v3 -> v4: personality and status.
  //
  // Career status gains lower_card and superstar and loses veteran and
  // declining, because those two described a career's DIRECTION rather than its
  // position on the card. That direction is not thrown away - it moves to the
  // new `trajectory` field, where it can say what it actually meant.
  //
  // riskAversion becomes courage, which is the same axis read the right way up,
  // so it is inverted rather than reset. The five genuinely new traits arrive
  // neutral, since a v3 save never had an opinion about them.
  3: (state) => {
    const STATUS_MAP = {
      veteran: ['upper_midcard', 'steady'],
      declining: ['lower_card', 'declining'],
    };
    const NEW_TRAITS = ['respectForAuthority', 'patience', 'jealousy', 'aggression'];

    for (const w of Object.values(state.wrestlers)) {
      const [mapped, trajectory] = STATUS_MAP[w.standing.careerStatus] || [];
      if (mapped) w.standing.careerStatus = mapped;
      if (w.standing.trajectory === undefined) w.standing.trajectory = trajectory || 'steady';

      const traits = w.identity.traits;
      if (traits.courage === undefined) {
        traits.courage = traits.riskAversion === undefined ? 50 : 100 - traits.riskAversion;
      }
      delete traits.riskAversion;
      for (const name of NEW_TRAITS) {
        if (traits[name] === undefined) traits[name] = 50;
      }
      if (traits.volatility === undefined) traits.volatility = 50;
      if (traits.sociability === undefined) traits.sociability = 50;
    }
    return state;
  },

  // v4 -> v5: a relationship stops being one number.
  //
  // The old `value` was the ally rating, so it becomes affinity directly. The
  // other three axes are inferred the same way the authored roster's shorthand
  // infers them: somebody you disliked carried heat and could not be relied on.
  // That is a guess, but it is the same guess the roster was written with, and
  // it beats resetting every relationship in the save to neutral.
  4: (state) => {
    for (const w of Object.values(state.wrestlers)) {
      const ties = w.ties.relationships || {};
      for (const [otherId, rel] of Object.entries(ties)) {
        if (rel.affinity !== undefined) continue;
        const value = rel.value ?? 0;
        ties[otherId] = {
          affinity: value,
          hostility: value < 0 ? Math.min(100, Math.round(-value * 0.8)) : 0,
          respect: 50,
          trust: Math.max(0, Math.min(100, Math.round(50 + value * 0.4))),
          lastChangedDay: rel.lastChangedDay ?? 0,
          history: [],
        };
      }
    }
    return state;
  },

  // v5 -> v6: the roster can ask for things. Nothing to convert - a save
  // written before requests existed simply has none.
  5: (state) => {
    state.requests = state.requests || {};
    return state;
  },

  // v6 -> v7: the building exists. A save written before it has nobody
  // anywhere, so everyone starts in the locker room and the GM at their desk.
  6: (state) => {
    if (state.meta.backstageAwareness === undefined) state.meta.backstageAwareness = 0;
    state.backstage = state.backstage || {
      gmLocation: 'gm_office',
      tick: 0,
      wrestlers: {},
      notifications: [],
    };
    for (const id of Object.keys(state.wrestlers)) {
      if (!state.backstage.wrestlers[id]) state.backstage.wrestlers[id] = 'locker_room';
    }
    // Events predating the backstage were all things the GM was present for.
    for (const e of state.log) {
      if (e.visibility === undefined) e.visibility = 'public';
      if (e.locationId === undefined) e.locationId = null;
      if (e.tick === undefined) e.tick = null;
    }
    return state;
  },

  // v7 -> v8: things can go wrong backstage now. A save written before this
  // has no incidents and nobody with a disciplinary record.
  7: (state) => {
    state.incidents = state.incidents || {};
    for (const w of Object.values(state.wrestlers)) {
      w.state.discipline = w.state.discipline || {
        warnings: 0, suspendedUntilDay: null, sentHomeFromShowId: null,
      };
    }
    // No incidents existed at v7, so any block on a segment is a dangling
    // reference by definition.
    for (const seg of Object.values(state.segments)) {
      seg.blockedByIncidentId = null;
    }
    return state;
  },

  // v8 -> v9: the rest of the room reacts now. A save written before this has
  // no factions, nobody queued to do anything, and no reactions on any
  // incident. Alignment is authored character, so everybody who predates it
  // starts as a tweener rather than being guessed at from their traits.
  8: (state) => {
    state.factions = state.factions || {};
    state.pendingReactions = [];
    for (const w of Object.values(state.wrestlers)) {
      if (!w.identity.alignment) w.identity.alignment = 'tweener';
    }
    for (const inc of Object.values(state.incidents || {})) {
      inc.reactions = inc.reactions || [];
      if (inc.causeIncidentId === undefined) inc.causeIncidentId = null;
      if (!Number.isFinite(inc.chainDepth)) inc.chainDepth = 0;
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
