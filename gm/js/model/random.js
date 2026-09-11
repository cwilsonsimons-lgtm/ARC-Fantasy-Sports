// A small seeded generator, so a save's roster can be rebuilt from its seed and
// a test can assert exact output. Math.random would make both impossible.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

// Inclusive integer range.
export function range(rng, low, high) {
  return low + Math.floor(rng() * (high - low + 1));
}

export function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

// Fisher-Yates on a copy.
export function shuffle(rng, list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Draw n distinct items without replacement.
export function sample(rng, list, n) {
  return shuffle(rng, list).slice(0, n);
}

export function chance(rng, probability) {
  return rng() < probability;
}
