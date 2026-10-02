// Seeded randomness. Every random decision in the simulation flows through an
// Rng built from (game seed, a tag, the week, and a counter stored in the save),
// so a saved game replays identically and two games with the same seed and the
// same player actions produce byte-identical state.

export interface Rng {
  next(): number; // [0, 1)
  int(lo: number, hi: number): number; // inclusive
  normal(mean?: number, sd?: number): number;
  pick<T>(xs: readonly T[]): T;
  chance(p: number): boolean;
  poisson(lambda: number): number;
  shuffle<T>(xs: T[]): T[];
}

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0 || 0x9e3779b9;
  const next = () => {
    // mulberry32
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare: number | null = null;
  const rng: Rng = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    normal(mean = 0, sd = 1) {
      if (spare !== null) {
        const v = spare;
        spare = null;
        return mean + sd * v;
      }
      let u = 0;
      let v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return mean + sd * r * Math.cos(2 * Math.PI * v);
    },
    pick: (xs) => xs[Math.floor(next() * xs.length)],
    chance: (p) => next() < p,
    poisson(lambda) {
      if (lambda <= 0) return 0;
      if (lambda > 40) return Math.max(0, Math.round(rng.normal(lambda, Math.sqrt(lambda))));
      const L = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= next();
      } while (p > L);
      return k - 1;
    },
    shuffle(xs) {
      for (let i = xs.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [xs[i], xs[j]] = [xs[j], xs[i]];
      }
      return xs;
    },
  };
  return rng;
}

/** Number of successes when drawing n items without replacement from N items, K of which are successes. */
export function hypergeometric(rng: Rng, N: number, K: number, n: number): number {
  if (n <= 0 || K <= 0) return 0;
  if (K >= N) return n;
  if (n >= N) return K;
  const lo = Math.max(0, n - (N - K));
  const hi = Math.min(n, K);
  if (lo === hi) return lo;
  if (n <= 60) {
    let k = 0;
    let Nr = N;
    let Kr = K;
    for (let i = 0; i < n; i++) {
      if (rng.next() * Nr < Kr) {
        k++;
        Kr--;
      }
      Nr--;
    }
    return k;
  }
  // Normal approximation with the finite-population correction, clamped to the feasible range.
  const p = K / N;
  const mean = n * p;
  const sd = Math.sqrt(n * p * (1 - p) * ((N - n) / Math.max(1, N - 1)));
  const x = Math.round(rng.normal(mean, sd));
  return Math.min(hi, Math.max(lo, x));
}

/** Draw m items without replacement from a multiset with the given counts. Returns how many of each were drawn. */
export function multiHypergeometric(rng: Rng, counts: number[], m: number): number[] {
  let N = 0;
  for (const c of counts) N += c;
  if (m > N) throw new Error(`Cannot draw ${m} items from a pool of ${N}`);
  const out = new Array(counts.length).fill(0);
  let remaining = m;
  for (let i = 0; i < counts.length && remaining > 0; i++) {
    const K = counts[i];
    if (K === 0) continue;
    const x = i === counts.length - 1 ? remaining : hypergeometric(rng, N, K, remaining);
    out[i] = x;
    remaining -= x;
    N -= K;
  }
  // If trailing types were empty, `remaining` is already zero by construction of the bounds.
  if (remaining !== 0) {
    // The last non-empty bucket must absorb it; this only happens when the final index is empty.
    for (let i = counts.length - 1; i >= 0 && remaining > 0; i--) {
      const room = counts[i] - out[i];
      const t = Math.min(room, remaining);
      out[i] += t;
      remaining -= t;
    }
  }
  return out;
}
