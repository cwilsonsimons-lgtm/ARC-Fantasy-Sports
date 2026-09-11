// Who wins.
//
// The world runs on hard kayfabe: wrestling is a real contest, so the GM books
// the match but does not decide the result. In-ring ability sets the odds and
// the rest is the night. That is what makes a hidden stat worth learning — and
// it is the one function to change if the GM should pick winners instead.
import { byId } from './wrestlers.js';
import { aptitudeOf } from './match-types.js';

const UPSET_FLOOR = 0.12; // nobody is ever a certainty

// The two sides of a match. A singles match is two teams of one; a tag match
// splits the participants down the middle. Nothing else splits them.
export function teamsOf(item) {
  if (item.tag) return [item.participants.slice(0, 2), item.participants.slice(2, 4)];
  return [[item.participants[0]], [item.participants[1]]];
}

function teamPower(wrestlers, ids, matchTypeId) {
  // Aptitude in this stipulation, not general ability: a technician who is
  // excellent inside a cage is favoured there whether or not she wants to be.
  const values = ids
    .map(id => byId(wrestlers, id))
    .filter(Boolean)
    .map(w => aptitudeOf(w, matchTypeId));
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Returns the winning side as a list of ids, so a tag title can change hands.
export function decideWinner(wrestlers, item, roll = Math.random()) {
  if (item.type !== 'match') return [];

  const [teamA, teamB] = teamsOf(item);
  if (!teamA.length || !teamB.length) return [];
  if ([...teamA, ...teamB].some(id => !byId(wrestlers, id))) return [];

  const aPower = Math.max(1, teamPower(wrestlers, teamA, item.matchType));
  const bPower = Math.max(1, teamPower(wrestlers, teamB, item.matchType));
  let chanceA = aPower / (aPower + bPower);
  chanceA = Math.min(1 - UPSET_FLOOR, Math.max(UPSET_FLOOR, chanceA));

  return roll < chanceA ? teamA : teamB;
}

export function applyOutcome(wrestlers, item, winnerIds) {
  if (!winnerIds || !winnerIds.length) return;
  const winners = new Set(winnerIds);
  for (const id of item.participants) {
    const w = byId(wrestlers, id);
    if (!w) continue;
    if (winners.has(id)) w.record.wins += 1;
    else w.record.losses += 1;
  }
}

export function winRate(wrestler) {
  const { wins, losses } = wrestler.record;
  const total = wins + losses;
  return total ? wins / total : null;
}
