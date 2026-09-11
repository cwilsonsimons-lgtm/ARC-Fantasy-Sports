// How much television you are trusted with.
//
// You start with an hour. That is deliberately not enough — a roster of fifteen
// and five slots means somebody sits at home in week one, before you have made
// a single mistake. Minutes are the thing you earn, and the executive's grade
// is what earns them.
//
// A tier, once reached, is kept. Trust itself can fall, which stalls progress
// rather than reversing it; making the window shrink again is a one-line change
// to keepTier below if that is the game you want.
export const TIERS = [
  { minutes: 60, trust: 0, label: 'The hour' },
  { minutes: 75, trust: 6, label: 'Fifteen more' },
  { minutes: 90, trust: 15, label: 'Ninety minutes' },
  { minutes: 105, trust: 27, label: 'The long show' },
  { minutes: 120, trust: 42, label: 'Two full hours' },
];

const AWARD = { A: 4, B: 2, C: 0, D: -3 };

const keepTier = true; // a tier once earned is not taken back

export function createNetwork() {
  return { trust: 0, tier: 0 };
}

export function tierOf(state) {
  return TIERS[Math.min(state.network.tier, TIERS.length - 1)];
}

export function runtimeFor(state) {
  return tierOf(state).minutes;
}

export function nextTier(state) {
  return TIERS[state.network.tier + 1] || null;
}

// Called once, when the show comes off the air. Returns what changed so the
// post-show can say it plainly.
export function awardTrust(state, grade) {
  const delta = AWARD[grade] !== undefined ? AWARD[grade] : 0;
  const before = state.network.tier;
  const fromMinutes = TIERS[before].minutes;

  state.network.trust = Math.max(0, state.network.trust + delta);

  let promoted = null;
  let next = nextTier(state);
  while (next && state.network.trust >= next.trust) {
    state.network.tier += 1;
    promoted = next;
    next = nextTier(state);
  }

  if (!keepTier) {
    while (state.network.tier > 0 && state.network.trust < TIERS[state.network.tier].trust) {
      state.network.tier -= 1;
    }
  }

  return { delta, promoted, demoted: state.network.tier < before, fromMinutes };
}
