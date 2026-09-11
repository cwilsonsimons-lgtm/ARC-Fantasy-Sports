// Who wins.
//
// The world runs on hard kayfabe: wrestling is a real contest, so the GM books
// the match but does not decide the result. In-ring ability sets the odds and
// the rest is the night. That is what makes a hidden stat worth learning — and
// it is the one function to change if the GM should pick winners instead.
import { byId } from './wrestlers.js';
import { aptitudeOf } from './match-types.js';

const UPSET_FLOOR = 0.12; // nobody is ever a certainty

export function decideWinner(wrestlers, item, roll = Math.random()) {
  if (item.type !== 'match' || item.participants.length !== 2) return null;

  const [aId, bId] = item.participants;
  const a = byId(wrestlers, aId);
  const b = byId(wrestlers, bId);
  if (!a || !b) return null;

  // Aptitude in this stipulation, not general ability: a technician who is
  // excellent inside a cage is favoured there whether or not she wants to be.
  const aPower = Math.max(1, aptitudeOf(a, item.matchType));
  const bPower = Math.max(1, aptitudeOf(b, item.matchType));
  let chanceA = aPower / (aPower + bPower);
  chanceA = Math.min(1 - UPSET_FLOOR, Math.max(UPSET_FLOOR, chanceA));

  return roll < chanceA ? aId : bId;
}

export function applyOutcome(wrestlers, item, winnerId) {
  if (!winnerId) return;
  for (const id of item.participants) {
    const w = byId(wrestlers, id);
    if (!w) continue;
    if (id === winnerId) w.record.wins += 1;
    else w.record.losses += 1;
  }
}

export function winRate(wrestler) {
  const { wins, losses } = wrestler.record;
  const total = wins + losses;
  return total ? wins / total : null;
}
