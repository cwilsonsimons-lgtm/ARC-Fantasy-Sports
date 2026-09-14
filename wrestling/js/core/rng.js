// Seeded random number generation.
//
// Included in the foundation because the save system is meaningless without it:
// if the generator is not part of the save, loading a game changes what happens
// next, and the design's promise that "every save develops differently" turns
// into "every reload develops differently".
//
// This is infrastructure, not the RNG *policy*. The four-stage pipeline from the
// design foundation (eligibility, weighting, roll, receipt) belongs to the
// systems that will sit on top of this.

const MASK = 0xffffffff;

/** Hash a string seed into four 32-bit words. */
function seedWords(seed) {
  let h1 = 1779033703 ^ seed.length;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = Math.imul(h2 ^ k, 597399067);
    h2 = Math.imul(h3 ^ k, 2869860233);
    h3 = Math.imul(h4 ^ k, 951274213);
    h4 = Math.imul(h1 ^ k, 2716044179);
  }
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** sfc32: small, fast, well-distributed, and trivially serializable. */
export function createRng(seed = String(Date.now())) {
  let [a, b, c, d] = typeof seed === 'string' ? seedWords(seed) : seed;
  let draws = 0;

  function next() {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    draws++;
    return (t >>> 0) / (MASK + 1);
  }

  return {
    /** Float in [0, 1). */
    float: next,
    /** Integer in [0, n). */
    int: (n) => Math.floor(next() * n),
    /** Integer in [min, max], inclusive. */
    range: (min, max) => min + Math.floor(next() * (max - min + 1)),
    /** True with probability p. */
    chance: (p) => next() < p,
    /** Uniform pick. */
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /**
     * Weighted pick from `{key: weight}` or `[[value, weight], ...]`.
     * Zero and negative weights are treated as ineligible, which is how the
     * design's eligibility stage is meant to express "not in the draw at all".
     */
    weighted(entries) {
      const pairs = Array.isArray(entries) ? entries : Object.entries(entries);
      let total = 0;
      for (const [, w] of pairs) if (w > 0) total += w;
      if (total <= 0) return null;
      let roll = next() * total;
      for (const [value, w] of pairs) {
        if (w <= 0) continue;
        roll -= w;
        if (roll <= 0) return value;
      }
      return pairs[pairs.length - 1][0];
    },
    /** Fisher-Yates, returns a new array. */
    shuffle(arr) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    /** Serializable generator state, carried in the save file. */
    getState: () => ({ a: a >>> 0, b: b >>> 0, c: c >>> 0, d: d >>> 0, draws }),
    setState(s) {
      a = s.a >>> 0; b = s.b >>> 0; c = s.c >>> 0; d = s.d >>> 0;
      draws = s.draws || 0;
    },
  };
}
