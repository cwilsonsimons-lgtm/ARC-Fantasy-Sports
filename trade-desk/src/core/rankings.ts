// Editing a ranking: moving an asset to a rank means giving it a value between its new neighbours.

export interface Ranked {
  id: string;
  value: number;
  name: string;
}

export const MAX_VALUE = 10000;
export const clampValue = (v: number) => Math.round(Math.min(MAX_VALUE, Math.max(0, v)));

/** Highest value first; ties broken by name so the order never jumps around. */
export const byValue = (a: Ranked, b: Ranked) => b.value - a.value || a.name.localeCompare(b.name);

/**
 * The value that puts `id` at `rank` (1 = top) in `list`, given everyone else keeps theirs.
 * Halfway between the two neighbours; past either end, a step beyond the last one.
 */
export function valueForRank(list: Ranked[], id: string, rank: number): number {
  const others = list.filter((r) => r.id !== id).sort(byValue);
  const i = Math.max(0, Math.min(others.length, Math.round(rank) - 1));
  const above = others[i - 1];
  const below = others[i];
  if (!above && !below) return list.find((r) => r.id === id)?.value ?? 0;
  if (!above) return clampValue(Math.max(below.value + 50, below.value));
  if (!below) return clampValue(above.value - 50);
  return clampValue((above.value + below.value) / 2);
}
