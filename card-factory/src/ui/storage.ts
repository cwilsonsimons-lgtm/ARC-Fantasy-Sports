// Save slots. On claude.ai the game saves to the viewer's private cloud store
// (the artifact `db` capability, under data/users/<id>/). Anywhere else — a
// local file, a signed-out view — it falls back to browser storage. Each save
// is checksummed (see sim/save.ts) and large saves are split into chunks, with
// the slot's index document written last so a half-finished save is never
// mistaken for a complete one.
import type { GameState } from '../sim/types';
import { deserialize, metaFor, serialize, type SaveMeta } from '../sim/save';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    claude?: { use(name: string): Promise<any>; hot?: any };
  }
}

export const SLOTS = ['autosave', 'slot-1', 'slot-2', 'slot-3'] as const;
export type Slot = (typeof SLOTS)[number];
export const SLOT_LABEL: Record<Slot, string> = { autosave: 'Autosave', 'slot-1': 'Slot 1', 'slot-2': 'Slot 2', 'slot-3': 'Slot 3' };

export interface SaveStore {
  kind: 'cloud' | 'browser' | 'memory';
  describe: string;
  list(): Promise<SaveMeta[]>;
  write(slot: Slot, state: GameState): Promise<SaveMeta>;
  read(slot: Slot): Promise<GameState>;
  remove(slot: Slot): Promise<void>;
}

const PREFIX = 'foil-ink-v1:';
const memory = new Map<string, string>();

function lsGet(k: string): string | null {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return memory.get(k) ?? null;
  }
}
function lsSet(k: string, v: string) {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    memory.set(k, v);
  }
}
function lsDel(k: string) {
  try {
    window.localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
  memory.delete(k);
}

function browserWorks() {
  try {
    const k = PREFIX + 'probe';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function browserStore(): SaveStore {
  const ok = browserWorks();
  return {
    kind: ok ? 'browser' : 'memory',
    describe: ok ? 'Saved in this browser only.' : 'This browser blocks storage, so saves last only until you close the page. Use Export to keep a copy.',
    async list() {
      const out: SaveMeta[] = [];
      for (const s of SLOTS) {
        const m = lsGet(PREFIX + 'meta:' + s);
        if (m) {
          try {
            out.push(JSON.parse(m));
          } catch {
            /* skip corrupt meta */
          }
        }
      }
      return out;
    },
    async write(slot, state) {
      const text = serialize(state);
      const meta = metaFor(slot, state, text);
      lsSet(PREFIX + 'save:' + slot, text);
      lsSet(PREFIX + 'meta:' + slot, JSON.stringify(meta));
      return meta;
    },
    async read(slot) {
      const text = lsGet(PREFIX + 'save:' + slot);
      if (!text) throw new Error(`${SLOT_LABEL[slot]} is empty.`);
      return deserialize(text);
    },
    async remove(slot) {
      lsDel(PREFIX + 'save:' + slot);
      lsDel(PREFIX + 'meta:' + slot);
    },
  };
}

const CHUNK = 180_000;

export function cloudStore(db: any, uid: string): SaveStore {
  const coll = db.collection(`data/users/${uid}`);
  return {
    kind: 'cloud',
    describe: 'Saved to your private claude.ai storage. Only you can see these slots, on any device.',
    async list() {
      const snap = await coll.where('kind', '==', 'save-index').get();
      return snap.docs.map((d: any) => d.data().meta as SaveMeta).filter(Boolean);
    },
    async write(slot, state) {
      const text = serialize(state);
      const meta = metaFor(slot, state, text);
      const n = Math.ceil(text.length / CHUNK);
      // A fresh generation id keeps a new save from mixing with an older one's chunks.
      const gen = meta.checksum;
      for (let i = 0; i < n; i++) {
        await coll.doc(`${slot}.${gen}.${i}`).set({ kind: 'save-chunk', slot, gen, i, s: text.slice(i * CHUNK, (i + 1) * CHUNK) });
      }
      const prev = await coll.doc(`${slot}.index`).get();
      await coll.doc(`${slot}.index`).set({ kind: 'save-index', slot, gen, chunks: n, meta });
      // Clean up the previous generation after the new index is in place.
      if (prev.exists) {
        const old = prev.data();
        if (old.gen !== gen) for (let i = 0; i < old.chunks; i++) await coll.doc(`${slot}.${old.gen}.${i}`).delete().catch(() => undefined);
      }
      return meta;
    },
    async read(slot) {
      const idx = await coll.doc(`${slot}.index`).get();
      if (!idx.exists) throw new Error(`${SLOT_LABEL[slot]} is empty.`);
      const { gen, chunks } = idx.data();
      const parts: string[] = [];
      for (let i = 0; i < chunks; i++) {
        const c = await coll.doc(`${slot}.${gen}.${i}`).get();
        if (!c.exists) throw new Error(`${SLOT_LABEL[slot]} is incomplete (part ${i + 1} of ${chunks} is missing).`);
        parts.push(c.data().s);
      }
      return deserialize(parts.join(''));
    },
    async remove(slot) {
      const idx = await coll.doc(`${slot}.index`).get();
      if (!idx.exists) return;
      const { gen, chunks } = idx.data();
      await coll.doc(`${slot}.index`).delete();
      for (let i = 0; i < chunks; i++) await coll.doc(`${slot}.${gen}.${i}`).delete().catch(() => undefined);
    },
  };
}

/** Resolves the cloud store when this view can use it, otherwise null. */
export async function connectCloud(): Promise<SaveStore | null> {
  try {
    if (!window.claude?.use) return null;
    const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
    if (!db || !user) return null;
    const uid = await user.id();
    if (!uid) return null;
    // View-only members can read but not write their own subtree; keep them on browser saves.
    if ((await user.can?.('data.write')) === false) return null;
    return cloudStore(db, uid);
  } catch {
    return null;
  }
}

/** Mirror every write to the browser too, so a cloud outage never loses the latest game. */
export function mirrored(primary: SaveStore, backup: SaveStore): SaveStore {
  return {
    ...primary,
    async write(slot, state) {
      const local = await backup.write(slot, state).catch(() => null);
      try {
        return await primary.write(slot, state);
      } catch (e) {
        if (local) return local; // the browser copy still holds this save
        throw e;
      }
    },
    async read(slot) {
      try {
        return await primary.read(slot);
      } catch (e) {
        return backup.read(slot).catch(() => Promise.reject(e));
      }
    },
  };
}

export async function getDownloads(): Promise<any | null> {
  try {
    return window.claude?.use ? await window.claude.use('downloads') : null;
  } catch {
    return null;
  }
}
