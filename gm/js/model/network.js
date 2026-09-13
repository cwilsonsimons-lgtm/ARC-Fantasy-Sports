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
import { broadcastMinutes } from './unlocks.js';

export const TIERS = [
  { minutes: 60, trust: 0, label: 'The hour' },
  { minutes: 75, trust: 6, label: 'Fifteen more' },
  { minutes: 90, trust: 15, label: 'Ninety minutes' },
  { minutes: 105, trust: 27, label: 'The long show' },
  { minutes: 120, trust: 42, label: 'Two full hours' },
];

const AWARD = { A: 4, B: 2, C: 0, D: -3 };

export function createNetwork() {
  return { trust: 0, tier: 0 };
}

// Which rung the show is actually on, worked out from what has been bought
// rather than from a stored index. Trust decides what head office will *offer*;
// a point on the Corporate branch is what takes them up on it.
export function tierOf(state) {
  const minutes = broadcastMinutes(state);
  let tier = TIERS[0];
  for (const rung of TIERS) if (rung.minutes <= minutes) tier = rung;
  return tier;
}

export function runtimeFor(state) {
  return broadcastMinutes(state);
}

// The next rung up, whether or not it can be afforded — the booking screen
// shows it as the thing trust is being earned toward.
export function nextTier(state) {
  const minutes = broadcastMinutes(state);
  return TIERS.find(rung => rung.minutes > minutes) || null;
}

// Called once, when the show comes off the air. Returns what changed so the
// post-show can say it plainly.
// The longest window the network would sign off on at this much trust, which
// is not the same as the one being broadcast.
function offeredTier(trust) {
  let offered = null;
  for (const rung of TIERS) if (trust >= rung.trust) offered = rung;
  return offered;
}

export function awardTrust(state, grade, multiplier = 1) {
  const delta = (AWARD[grade] !== undefined ? AWARD[grade] : 0) * multiplier;
  const before = state.network.trust;
  const fromMinutes = runtimeFor(state);

  const wasOffered = offeredTier(before);
  state.network.trust = Math.max(0, state.network.trust + delta);

  // Trust no longer promotes anybody. What it does is open a rung on the
  // Corporate branch, and crossing that line is worth saying out loud even
  // though nothing has changed on the card yet.
  const nowOffered = offeredTier(state.network.trust);
  const offered = nowOffered && nowOffered !== wasOffered ? nowOffered : null;

  return { delta, offered, promoted: null, demoted: false, fromMinutes };
}
