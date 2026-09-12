// Who wins.
//
// The world runs on hard kayfabe: wrestling is a real contest, so the GM books
// the match but does not decide the result. Ability sets the odds and the rest
// is the night. That is what makes a hidden stat worth learning — and this is
// the one file to change if the GM should pick winners instead.
import { byId } from './wrestlers.js';
import { aptitudeOf } from './match-types.js';
import { chaosOf } from '../data/match-types.js';
import { isMultiWay } from '../data/shapes.js';

// How the participants divide. A match used to carry a boolean and slice at
// index two, which is why nothing bigger than four people could exist; the
// sizes are on the item now and this is still the only place they are read.
export function sidesOf(item) {
  if (Array.isArray(item.sides) && item.sides.length >= 2) return item.sides;
  // A save written before shapes existed. The migration fills these in, so this
  // is only ever reached by something hand-built in a test.
  return item.tag && item.participants.length >= 4 ? [2, 2] : [1, 1];
}

// The sides of a match, in order. Nothing else splits the participants.
export function teamsOf(item) {
  const sides = sidesOf(item);
  const teams = [];
  let at = 0;
  for (const size of sides) {
    teams.push(item.participants.slice(at, at + size));
    at += size;
  }
  return teams.filter(team => team.length);
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

function powersOf(wrestlers, teams, matchTypeId) {
  return teams.map(team => Math.max(1, teamPower(wrestlers, team, matchTypeId)));
}

function everyoneReal(wrestlers, teams) {
  return teams.every(team => team.every(id => byId(wrestlers, id)));
}

// Returns the winning side as a list of ids, so a tag title can change hands.
//
// With more than two sides this is a weighted draw rather than a coin with a
// floor on it: ability still decides most of it, and the rest is the chaos of
// how many people are in the ring. Eighteen of them over the top rope is nearly
// a lottery, and it should be.
export function decideWinner(wrestlers, item, roll = Math.random()) {
  if (item.type !== 'match') return [];

  const teams = teamsOf(item);
  if (teams.length < 2 || !everyoneReal(wrestlers, teams)) return [];

  const powers = powersOf(wrestlers, teams, item.matchType);
  const total = powers.reduce((sum, power) => sum + power, 0);
  const chaos = chaosOf(item.matchType, teams.length);
  const share = powers.map(power => (1 - chaos) * (power / total) + chaos / teams.length);

  let pick = roll;
  for (let i = 0; i < teams.length; i += 1) {
    pick -= share[i];
    if (pick <= 0) return teams[i];
  }
  return teams[teams.length - 1];
}

// Which side the result goes against.
//
// A singles or tag match has one losing side and that is the end of it. In a
// multi-way only one person takes the fall, and it is usually whoever was least
// able to avoid it — so a fatal four-way costs three people the win and only
// one of them a defeat. **That is what multi-man matches are for**: booking
// somebody into one is how you use them without putting a loss on them.
//
// A battle royal inverts it. Nobody is pinned, so the name against the result
// is whoever was still standing at the end, which is the strongest of the ones
// who did not win.
export function decideFall(wrestlers, item, winnerIds, roll = Math.random()) {
  const teams = teamsOf(item);
  if (teams.length < 2) return [];

  const winning = new Set(winnerIds || []);
  const losers = teams.filter(team => !team.some(id => winning.has(id)));
  if (!losers.length) return [];
  if (losers.length === 1) return losers[0];

  const powers = powersOf(wrestlers, losers, item.matchType);

  if (item.matchType === 'battle-royal') {
    let best = 0;
    for (let i = 1; i < losers.length; i += 1) if (powers[i] > powers[best]) best = i;
    return losers[best];
  }

  // Inverted weights: the least able side is the likeliest to be the one
  // covered, without ever being a certainty.
  const highest = Math.max(...powers);
  const weights = powers.map(power => Math.max(1, highest - power + 8));
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  let pick = roll * total;
  for (let i = 0; i < losers.length; i += 1) {
    pick -= weights[i];
    if (pick <= 0) return losers[i];
  }
  return losers[losers.length - 1];
}

// Winners get the win; only the side that took the fall gets the defeat.
// Everybody else in a multi-way was in it and did not win it, which is a
// different thing and is not recorded as a loss.
export function applyOutcome(wrestlers, item, winnerIds, fallIds = null) {
  if (!winnerIds || !winnerIds.length) return;
  const winners = new Set(winnerIds);
  const beaten = new Set(fallIds || []);
  const multi = isMultiWay(sidesOf(item));

  for (const id of item.participants) {
    const w = byId(wrestlers, id);
    if (!w) continue;
    if (winners.has(id)) w.record.wins += 1;
    else if (!multi || beaten.has(id)) w.record.losses += 1;
  }
}

export function winRate(wrestler) {
  const { wins, losses } = wrestler.record;
  const total = wins + losses;
  return total ? wins / total : null;
}
