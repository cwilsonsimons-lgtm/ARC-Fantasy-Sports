// Who steps in, and why.
//
// When something happens to someone, every other wrestler in the building gets
// a look at it. Most do nothing. The ones who act do it for a reason, and the
// reason is the interesting part — a save is never "IF face THEN save". It is a
// sum of competing pulls:
//
//   pulls      friendship, a debt owed, hatred of the attacker, principle,
//              self-interest, respect, faction loyalty, ambition
//   deterrents fear of the attacker, spite toward the victim, being busy
//
// Score above the acting line and they go. Score in the band below it and they
// come out, think about it, and go back — which damages a relationship far more
// than never moving at all. Below that and they stand there.
//
// Nobody reacting is a result, not an absence of one.
import { byId } from './wrestlers.js';

// Tuned against a few thousand simulated matches. The targets are that a save
// is common but not automatic, that hesitating and nobody-moving are both real
// outcomes rather than rounding errors, and that a full locker-room brawl is
// the rare spectacular result instead of the norm.
export const ACT_AT = 26;
export const HESITATE_AT = 19;
const MAX_DEPTH = 3;
const DEPTH_PENALTY = 14; // each link in a chain is much harder to justify than the last

export const MOTIVES = {
  alliance: 'friendship',
  faction: 'faction loyalty',
  debt: 'a debt',
  revenge: 'revenge',
  morality: 'principle',
  interest: 'self-interest',
  respect: 'respect',
  ambition: 'ambition',
};

function bond(wrestler, otherId) {
  return wrestler.relationships[otherId] || { matches: 0, segments: 0, owed: 0 };
}

function grudgesAgainst(wrestler, targetId) {
  return wrestler.grudges.filter(g => g.targetId === targetId).length;
}

// Anybody the candidate is scheduled with later tonight is somebody they need
// standing up.
function sharesLaterItem(state, candidateId, otherId, fromIndex) {
  return state.show.items.slice(fromIndex + 1).some(item =>
    item.participants.includes(candidateId) && item.participants.includes(otherId)
  );
}

function isBusyLater(state, candidateId, fromIndex) {
  return state.show.items.slice(fromIndex + 1).some(item => item.participants.includes(candidateId));
}

// Returns the strongest reason this wrestler has to get involved, and the net
// pull. A negative or small total means they stay where they are.
export function weigh(state, { victimId, aggressorId, fromIndex = 0 }, candidate) {
  const victim = byId(state.wrestlers, victimId);
  const aggressor = byId(state.wrestlers, aggressorId);
  if (!victim || !aggressor) return null;

  const toVictim = bond(candidate, victimId);
  const toAggressor = bond(candidate, aggressorId);

  let total = 0;
  let best = null;
  const pull = (motive, value) => {
    if (value <= 0) return;
    total += value;
    if (!best || value > best.value) best = { motive, value };
  };

  // They have stood beside this person before. Past a certain depth it stops
  // being friendship and starts being a faction, so the two are exclusive and
  // both get to be somebody's stated reason.
  if (toVictim.segments >= 4) pull('faction', toVictim.segments * 4);
  else pull('alliance', toVictim.segments * 5);
  // They were helped once, and that is remembered.
  pull('debt', (toVictim.owed || 0) * 15);
  // They would cross the building to get at the attacker.
  pull('revenge', toAggressor.matches * 3 + grudgesAgainst(candidate, aggressorId) * 13);
  // Some people just think it is wrong.
  // A principled veteran will go for somebody they have never spoken to. An
  // ordinary babyface needs a reason of their own on top of this.
  //
  // And principle is not blind: almost nobody crosses the building out of
  // simple decency for a heel who has it coming. That is what makes "nobody
  // moved" a situational story about who the victim is, rather than a dice
  // roll — get jumped as a hated heel and you find out how alone you are.
  const worthSaving = victim.alignment === 'Face' ? 1 : victim.alignment === 'Neutral' ? 0.55 : 0.15;
  pull('morality', candidate.alignment === 'Face' ? (6 + candidate.stats.professionalism / 8) * worthSaving : 0);
  // They need this person upright for their own match.
  pull('interest', sharesLaterItem(state, candidate.id, victimId, fromIndex) ? 19 : 0);
  // They barely know them, but they know what they have done.
  pull('respect', victim.role === 'Main event' ? 7 : victim.role === 'Upper card' ? 4 : 0);
  // A chance to be in something that matters, for somebody who needs one.
  pull('ambition', candidate.stats.ambition > 70 ? (candidate.stats.ambition - 60) / 3 + candidate.weeksOffCard * 3 : 0);

  // Fear of whoever is doing the beating, sharpened by a lack of professionalism.
  let fear = Math.max(0, aggressor.stats.inRing - candidate.stats.inRing) / 4;
  if (candidate.stats.professionalism < 40) fear *= 1.6;
  // They think the victim has it coming.
  const spite = (candidate.alignment === 'Heel' ? toVictim.matches * 2 : 0)
    + grudgesAgainst(candidate, victimId) * 13;
  // They have somewhere to be.
  const busy = isBusyLater(state, candidate.id, fromIndex) ? 5 : 0;

  total -= fear + spite + busy;
  return { candidate, total, motive: best ? best.motive : 'morality' };
}

// Everyone who could plausibly see it: fit wrestlers who are not already in it.
function candidates(state, involved) {
  return state.wrestlers.filter(w => w.status === 'Available' && !involved.has(w.id));
}

// One pass: who acts, and who came out and thought better of it.
export function resolveReaction(state, event, involved, depth = 0) {
  if (depth >= MAX_DEPTH) return { actor: null, hesitator: null };

  const threshold = ACT_AT + depth * DEPTH_PENALTY;
  const weighed = candidates(state, involved)
    .map(candidate => weigh(state, event, candidate))
    .filter(Boolean)
    .sort((a, b) => b.total - a.total);

  const actor = weighed.find(entry => entry.total >= threshold) || null;
  // The nearly-did is only interesting when nobody actually went.
  const hesitator = actor
    ? null
    : weighed.find(entry => entry.total >= HESITATE_AT) || null;

  return { actor, hesitator };
}
