// Live view of the shared `lookup` collection (measurements Claude looked up) and
// the `requests` collection (names waiting to be looked up). Only available inside
// claude.ai; the standalone file simply has no lookup.
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { buildIndex, lookupId, type LookupEntry, type LookupIndex } from '../core/lookup';
import type { RawValues } from '../core/importer';

interface Snap { docs: { id: string; data(): Record<string, unknown> | undefined }[] }
interface Col { onSnapshot(next: (s: Snap) => void, err?: (e: unknown) => void): () => void; doc(id: string): { set(d: Record<string, unknown>): Promise<void> } }
interface Db { collection(path: string): Col & { limit(n: number): Col } }

export interface LookupStore {
  available: boolean;
  index: LookupIndex;
  count: number;
  pending: Set<string>; // lookup ids waiting for Claude
  /** Saves names for Claude to look up. Resolves how many were newly requested. */
  request(rows: Pick<RawValues, 'name' | 'position' | 'college'>[]): Promise<number>;
}

const empty: LookupStore = { available: false, index: new Map(), count: 0, pending: new Set(), request: async () => 0 };
const LookupContext = createContext<LookupStore>(empty);
export const useLookup = () => useContext(LookupContext);

export function LookupProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<Db | null>(null);
  const [entries, setEntries] = useState<LookupEntry[]>([]);
  const [pending, setPending] = useState<Set<string>>(new Set());

  useEffect(() => {
    const host = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
    if (!host || typeof host.use !== 'function') return;
    let stop: (() => void)[] = [];
    let cancelled = false;
    host.use('db').then((d) => {
      if (cancelled || !d) return;
      const store = d as Db;
      setDb(store);
      stop = [
        store.collection('lookup').limit(1000).onSnapshot((s) => setEntries(s.docs.map((x) => x.data() as unknown as LookupEntry)), () => {}),
        store.collection('requests').limit(1000).onSnapshot((s) => setPending(new Set(s.docs.map((x) => x.id))), () => {}),
      ];
    });
    return () => { cancelled = true; stop.forEach((f) => f()); };
  }, []);

  const value = useMemo<LookupStore>(() => {
    if (!db) return empty;
    const index = buildIndex(entries);
    return {
      available: true,
      index,
      count: entries.length,
      pending,
      request: async (rows) => {
        let n = 0;
        for (const r of rows) {
          const id = lookupId(r.name);
          if (pending.has(id)) continue;
          // One write at a time; each is its own document.
          await db.collection('requests').doc(id).set({
            name: r.name.trim(),
            ...(r.position.trim() ? { position: r.position.trim() } : {}),
            ...(r.college.trim() ? { school: r.college.trim() } : {}),
            requestedAt: new Date().toISOString(),
          });
          n++;
        }
        return n;
      },
    };
  }, [db, entries, pending]);

  return <LookupContext.Provider value={value}>{children}</LookupContext.Provider>;
}
