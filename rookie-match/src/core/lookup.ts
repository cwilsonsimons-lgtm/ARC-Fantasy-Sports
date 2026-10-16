// Looked-up measurements. Claude finds a prospect's listed height and weight on
// the web (each entry keeps its source) and stores them in the artifact's shared
// `lookup` collection; imports then fill missing measurements from it. Nothing is
// filled unless the name matches, and the school too when both sides have one.
import { normName, type RawValues } from './importer';

export interface LookupEntry {
  name: string;
  position?: string;
  school?: string;
  height: string; // as listed, e.g. 6'3"
  weight: number;
  source: string; // e.g. "Tankathon profile"
  sourceUrl?: string;
}

/** Document id for a player in the `lookup` and `requests` collections. */
export const lookupId = (name: string) => normName(name).replace(/\s+/g, '-').slice(0, 120) || 'unnamed';

export type LookupIndex = Map<string, LookupEntry[]>;

export function buildIndex(entries: LookupEntry[]): LookupIndex {
  const idx: LookupIndex = new Map();
  for (const e of entries) {
    if (!e || typeof e.name !== 'string' || typeof e.height !== 'string' || typeof e.weight !== 'number') continue;
    const k = normName(e.name);
    idx.set(k, [...(idx.get(k) ?? []), e]);
  }
  return idx;
}

/** The single entry that fits this row, or null when none (or more than one) does. */
export function findEntry(raw: Pick<RawValues, 'name' | 'college'>, idx: LookupIndex): LookupEntry | null {
  const candidates = idx.get(normName(raw.name)) ?? [];
  const school = normName(raw.college);
  const fits = candidates.filter((e) => !school || !e.school || normName(e.school) === school);
  return fits.length === 1 ? fits[0] : null; // two players with one name and no school to tell them apart: don't guess
}

/** Fills a row's missing height and/or weight from the lookup. Values already on the row are kept. */
export function fillFromLookup(raw: RawValues, idx: LookupIndex): { raw: RawValues; entry: LookupEntry | null } {
  if (raw.height.trim() && raw.weight.trim()) return { raw, entry: null };
  const entry = findEntry(raw, idx);
  if (!entry) return { raw, entry: null };
  return {
    raw: { ...raw, height: raw.height.trim() || entry.height, weight: raw.weight.trim() || String(entry.weight) },
    entry,
  };
}
