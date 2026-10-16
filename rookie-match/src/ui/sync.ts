// Account sync for the claude.ai artifact build. The page keeps working from
// browser storage on its own; when it runs inside claude.ai with the `db` and
// `user` capabilities, everything is also kept in the viewer's private
// data/users/<id>/ space, so it follows them between devices.
//
// Layout (documents are capped at 256 KiB, so each workspace gets its own):
//   data/users/<id>/meta                     { version, activeWorkspaceId, workspaceIds, settings, savedAt }
//   data/users/<id>/meta/workspaces/<wsId>   { workspace }
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { validateState, type AppState, type Workspace } from '../core/state';
import type { Store } from './common';

export type SyncStatus =
  | { mode: 'checking' }
  | { mode: 'local'; reason: 'standalone' | 'signed-out' | 'unavailable' }
  | { mode: 'cloud'; saving: boolean; error?: string };

/* Minimal shapes of the capability surface this file uses (see db.d.ts / user.d.ts). */
interface DocSnap { exists: boolean; data(): Record<string, unknown> | undefined }
interface DocRef { get(): Promise<DocSnap>; set(d: Record<string, unknown>): Promise<void>; delete(): Promise<void>; collection(p: string): ColRef }
interface ColRef { doc(id: string): DocRef }
interface Db { doc(path: string): DocRef }
interface User { id(): Promise<string | null> }
interface ClaudeHost { use(name: string): Promise<unknown> }

export const SyncContext = createContext<SyncStatus>({ mode: 'local', reason: 'standalone' });
export const useSyncStatus = () => useContext(SyncContext);

const claudeHost = (): ClaudeHost | null => {
  const c = (window as unknown as { claude?: ClaudeHost }).claude;
  return c && typeof c.use === 'function' ? c : null;
};

export const inClaude = () => claudeHost() !== null;

const LOCAL_SAVED_AT = 'rookie_match_v1_saved_at';
export function readLocalSavedAt(): number {
  try { return Number(localStorage.getItem(LOCAL_SAVED_AT)) || 0; } catch { return 0; }
}
export function writeLocalSavedAt(t: number) {
  try { localStorage.setItem(LOCAL_SAVED_AT, String(t)); } catch { /* storage blocked */ }
}

type Meta = { version: 1; activeWorkspaceId: string; workspaceIds: string[]; settings: AppState['settings']; savedAt: number };

const errText = (e: unknown) => {
  const code = (e as { code?: string })?.code;
  if (code === 'quota_exceeded' || code === 'invalid_argument') {
    return 'A workspace is too large to save to your account (each can hold roughly 1,000 prospects). Remove some prospects or split them into another workspace. Your changes are still saved in this browser.';
  }
  return 'Couldn\'t save to your account just now. Your changes are saved in this browser and will be retried on the next change.';
};

/**
 * Loads the account copy once, then mirrors every state change to it.
 * `onCloudLoad` replaces the in-memory state when the account copy is newer.
 */
export function useCloudSync(store: Store, onCloudLoad: (s: AppState, savedAt: number) => void): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(() => (inClaude() ? { mode: 'checking' } : { mode: 'local', reason: 'standalone' }));
  const ctx = useRef<{ meta: DocRef; ws: ColRef } | null>(null);
  const written = useRef<{ meta: string; ws: Map<string, string> }>({ meta: '', ws: new Map() });
  const ready = useRef(false);
  const busy = useRef(false);
  const again = useRef(false);
  const latest = useRef(store.state);
  latest.current = store.state;

  const metaBody = (s: AppState) => ({ version: 1, activeWorkspaceId: s.activeWorkspaceId, workspaceIds: s.workspaces.map((w) => w.id), settings: s.settings });

  async function flush() {
    const c = ctx.current;
    if (!c || !ready.current) return;
    if (busy.current) { again.current = true; return; }
    busy.current = true;
    try {
      do {
        again.current = false;
        const s = latest.current;
        const wsJson = new Map(s.workspaces.map((w) => [w.id, JSON.stringify(w)]));
        const metaJson = JSON.stringify(metaBody(s));
        const changed = [...wsJson].filter(([id, j]) => written.current.ws.get(id) !== j);
        const removed = [...written.current.ws.keys()].filter((id) => !wsJson.has(id));
        if (!changed.length && !removed.length && metaJson === written.current.meta) break;
        setStatus({ mode: 'cloud', saving: true });
        // One write at a time per document; workspaces first so meta never lists a missing one.
        for (const [id, j] of changed) {
          await c.ws.doc(id).set({ workspace: JSON.parse(j) as Record<string, unknown> });
          written.current.ws.set(id, j);
        }
        const meta: Meta = { ...(metaBody(s) as Omit<Meta, 'savedAt'>), savedAt: Date.now() };
        await c.meta.set(meta as unknown as Record<string, unknown>);
        written.current.meta = metaJson;
        for (const id of removed) {
          await c.ws.doc(id).delete();
          written.current.ws.delete(id);
        }
      } while (again.current);
      setStatus({ mode: 'cloud', saving: false });
    } catch (e) {
      setStatus({ mode: 'cloud', saving: false, error: errText(e) });
    } finally {
      busy.current = false;
    }
  }

  // Connect and load once.
  useEffect(() => {
    const host = claudeHost();
    if (!host) return;
    let cancelled = false;
    (async () => {
      const [db, user] = (await Promise.all([host.use('db'), host.use('user')])) as [Db | null, User | null];
      if (cancelled) return;
      if (!db || !user) { setStatus({ mode: 'local', reason: 'unavailable' }); return; }
      const uid = await user.id();
      if (cancelled) return;
      if (!uid) { setStatus({ mode: 'local', reason: 'signed-out' }); return; }
      const meta = db.doc(`data/users/${uid}/meta`);
      const ws = meta.collection('workspaces');
      try {
        const snap = await meta.get();
        if (cancelled) return;
        const m = snap.exists ? (snap.data() as unknown as Meta) : null;
        if (m && Array.isArray(m.workspaceIds)) {
          const docs = await Promise.all(m.workspaceIds.map((id) => ws.doc(id).get()));
          const workspaces = docs.map((d) => (d.exists ? (d.data()!.workspace as Workspace) : null)).filter((w): w is Workspace => !!w);
          const cloud = { version: 1 as const, activeWorkspaceId: m.activeWorkspaceId, workspaces, settings: m.settings } as AppState;
          const problems = validateState(cloud);
          if (problems.length) {
            // Never overwrite an account copy we can't read; keep working locally.
            setStatus({ mode: 'local', reason: 'unavailable' });
            return;
          }
          written.current = { meta: JSON.stringify(metaBody(cloud)), ws: new Map(workspaces.map((w) => [w.id, JSON.stringify(w)])) };
          if ((m.savedAt ?? 0) >= readLocalSavedAt()) {
            latest.current = cloud; // the flush below must compare against the account copy, not the stale local one
            onCloudLoad(cloud, m.savedAt ?? 0);
          }
        }
        ctx.current = { meta, ws };
        ready.current = true;
        setStatus({ mode: 'cloud', saving: false });
        void flush(); // pushes local changes that are newer than the account copy (or the first copy)
      } catch {
        if (!cancelled) setStatus({ mode: 'local', reason: 'unavailable' });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror changes, coalescing bursts of edits into one write per pause.
  useEffect(() => {
    if (!ready.current) return;
    const t = setTimeout(() => { void flush(); }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.state]);

  return status;
}
