// The ten seconds after the bell.
//
// A match ends and the two of them are still standing there in front of an
// audience. What they do next is the most legible thing either of them does all
// night, and it is decided by who they are: a pro offers a hand, somebody with
// an ego leaves it hanging, somebody vindictive keeps the hold on a beat too
// long, and a man with three friends in the back does not settle anything one
// against one.
//
// Most outcomes are colour and resolve themselves here — a memory each way, a
// nudge to the record, sometimes something left on the table for next week.
// Only the ones where somebody gets hurt are handed to the GM, because only
// those are the GM's problem.
import { byId } from './wrestlers.js';
import { createEntry } from './journal.js';
import { trait, lean } from './traits.js';
import { remember } from './memory.js';
import { relationship, ensurePair } from './relationships.js';
import { teamsOf } from './matches.js';
import { roomOf, peopleIn } from './backstage.js';
import { activeTitles, heldBy } from './titles.js';
import { noteThread } from './threads.js';
import { createOpportunity } from './opportunities.js';
import { moment, isColour, INJURY_WEEKS } from '../data/post-match.js';
import { nextId } from '../ids.js';

// Something happens after roughly this share of matches. The rest end with two
// people walking to the back, which has to stay the commonest outcome or none
// of the others mean anything.
const SOMETHING_HAPPENS = 0.46;

function grudgesBetween(a, b) {
  return (a.grudges || []).filter(g => g.targetId === b.id).length
    + (b.grudges || []).filter(g => g.targetId === a.id).length;
}

// Who is standing there, for the moments that need an audience.
function othersAt(state, ids) {
  const room = roomOf(state, ids[0]) || 'gorilla';
  return peopleIn(state, room).filter(w => !ids.includes(w.id));
}

function factionWith(state, wrestler, exclude) {
  return Object.entries(wrestler.relationships || {})
    .filter(([id, rel]) => rel.tie === 'faction' && !exclude.includes(id))
    .map(([id]) => byId(state.wrestlers, id))
    .filter(other => other && roomOf(state, other.id));
}

// A champion of the right division who is in the building and was not in the
// match. The belt in the aisle is a challenge whether or not anybody says so.
function watchingChampion(state, winner, involved) {
  for (const title of activeTitles(state)) {
    if (title.holders !== 1) continue;
    if (title.gender && title.gender !== winner.gender) continue;
    for (const id of title.championIds) {
      if (involved.includes(id)) continue;
      const champion = byId(state.wrestlers, id);
      if (champion && roomOf(state, id)) return { champion, title };
    }
  }
  return null;
}

// ---------------------------------------------------------------- the slate

// Each moment, how likely it is between these two specifically. A weight of
// zero means it is not a thing these two people would do, which is what keeps
// a handshake out of a blood feud and a faction beatdown out of a match between
// two loners.
function slate(state, { winner, loser, item, involved }) {
  const heat = grudgesBetween(winner, loser) * 4 + relationship(winner, loser.id).matches;
  const bothHeel = winner.alignment === 'Heel' && loser.alignment === 'Heel';
  const manners = (trait(winner, 'professionalism') + trait(loser, 'professionalism')) / 2;
  const crew = factionWith(state, loser, involved).length
    || factionWith(state, winner, involved).length;
  const champion = watchingChampion(state, winner, involved);

  return [
    {
      id: 'handshake',
      // Two people who can take a loss, with nothing between them.
      weight: heat > 3 ? 0 : Math.max(0, (manners - 45) / 12) * (bothHeel ? 0.3 : 1),
    },
    {
      id: 'handshake-refused',
      // Somebody has to offer, and somebody has to be too proud to take it.
      weight: trait(winner, 'professionalism') > 55 || trait(loser, 'professionalism') > 55
        ? 0.5 + lean(loser, 'ego') * 1.2 + heat * 0.15
        : 0,
    },
    {
      id: 'stare-down',
      // History, and neither of them willing to be the one who swings.
      weight: 0.4 + heat * 0.35
        + Math.max(0, lean(loser, 'patience')) * 0.8
        - Math.max(0, lean(loser, 'aggression')) * 0.4,
    },
    {
      id: 'champion-challenge',
      weight: champion ? 0.7 + (winner.role === 'Main event' || winner.role === 'Upper card' ? 0.8 : 0) : 0,
    },
    {
      id: 'cheap-shot',
      // The shot somebody takes when they have not got the nerve for the rest.
      weight: 0.5 + lean(loser, 'aggression') * 0.9 + heat * 0.1
        - Math.max(0, lean(loser, 'courage')) * 0.4,
    },
    {
      id: 'attack',
      weight: 0.6 + lean(loser, 'aggression') * 1.1 + heat * 0.25
        + (loser.alignment === 'Heel' ? 0.3 : 0)
        - lean(loser, 'professionalism') * 0.6,
    },
    {
      id: 'submission-held',
      // Only in a match won by making somebody quit, and only by somebody who
      // wanted to make a point of it.
      weight: item.matchType === 'submission'
        ? 0.8 + lean(winner, 'vindictiveness') * 1.4 + heat * 0.2
        : 0,
    },
    {
      id: 'faction-beatdown',
      weight: crew >= 2 ? 0.5 + heat * 0.2 + lean(winner, 'aggression') * 0.5 : 0,
    },
  ];
}

function draw(state, context, roll) {
  const entries = slate(state, context).filter(e => e.weight > 0);
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  if (!total) return null;
  if (roll() > SOMETHING_HAPPENS) return null;

  let pick = roll() * total;
  for (const entry of entries) {
    pick -= entry.weight;
    if (pick <= 0) return entry.id;
  }
  return entries[entries.length - 1].id;
}

// ---------------------------------------------------------------- resolution

// Returns `{ kind, incident }`. `incident` is null for everything that is only
// a moment; when it is set, the caller hands it to the GM the same way it hands
// over anything else that happened in a room.
export function resolvePostMatch(state, item, result, index, roll) {
  if (item.type !== 'match' || !result.winnerIds || !result.winnerIds.length) return null;

  const sides = teamsOf(item);
  const winningSide = result.winnerIds;
  const winners = new Set(winningSide);

  // Whoever the result went against, which in a multi-way is one specific
  // person rather than everyone who did not win. They are the one with a
  // problem, so they are the one the bell is about.
  const losingSide = (result.fallIds && result.fallIds.length
    ? result.fallIds
    : (sides.find(side => !side.some(id => winners.has(id))) || []))
    .filter(id => byId(state.wrestlers, id));
  if (!losingSide.length) return null;

  const winner = byId(state.wrestlers, winningSide[0]);
  const loser = byId(state.wrestlers, losingSide[0]);
  if (!winner || !loser) return null;

  // Everybody in it, not just the two the moment is about — a beatdown should
  // not recruit somebody who was standing in the same match.
  const involved = item.participants.slice();
  const kind = draw(state, { winner, loser, item, involved }, roll);
  if (!kind) return null;

  // Every one of these is a thing that happened between two named people, so it
  // all goes on their record whether or not it needed a decision.
  noteThread(state, winner.id, loser.id, kind, result.at || 0);

  const context = { state, item, result, index, winner, loser, involved, roll };
  const handler = HANDLERS[kind];
  return handler ? handler(context) : null;
}

function push(state, type, at, data) {
  state.journal.push(createEntry({ week: state.week, at, type, data }));
}

const HANDLERS = {
  // ---- colour ----

  handshake({ state, winner, loser, result }) {
    push(state, 'handshake', result.at || 0, { winnerId: winner.id, loserId: loser.id });
    bothWays(state, winner, loser, 3, 'handshake');
    grow(winner, loser, 'segments', 1);
    return { kind: 'handshake', incident: null };
  },

  'handshake-refused'({ state, winner, loser, result, involved }) {
    // The hand goes out from whichever of them has the manners for it.
    const offerer = trait(winner, 'professionalism') >= trait(loser, 'professionalism') ? winner : loser;
    const refuser = offerer === winner ? loser : winner;
    push(state, 'handshake-refused', result.at || 0, { offererId: offerer.id, refuserId: refuser.id });

    remember(state, offerer, { source: 'peer', weight: -4, targetId: refuser.id, detail: 'left-hanging' });
    for (const bystander of othersAt(state, involved)) {
      remember(state, bystander, { source: 'peer', weight: -1, targetId: refuser.id, detail: 'saw-it' });
    }
    grow(offerer, refuser, 'matches', 1);
    offer(state, refuser, offerer, 'a hand left hanging');
    return { kind: 'handshake-refused', incident: null };
  },

  'stare-down'({ state, winner, loser, result }) {
    push(state, 'stare-down', result.at || 0, { aId: winner.id, bId: loser.id });
    bothWays(state, winner, loser, -2, 'stare-down');
    grow(winner, loser, 'matches', 1);
    offer(state, winner, loser, 'whatever that was after the bell');
    return { kind: 'stare-down', incident: null };
  },

  'champion-challenge'({ state, winner, loser, result, involved }) {
    const found = watchingChampion(state, winner, involved);
    if (!found) return null;
    const { champion, title } = found;
    push(state, 'champion-challenge', result.at || 0, {
      championId: champion.id, challengerId: winner.id, titleId: title.id,
    });
    noteThread(state, champion.id, winner.id, 'stare-down', result.at || 0);
    remember(state, winner, { source: 'title', weight: 4, targetId: champion.id, detail: 'in-the-picture' });
    remember(state, champion, { source: 'peer', weight: -2, targetId: winner.id, detail: 'came-for-me' });
    grow(champion, winner, 'matches', 1);
    offer(state, winner, champion, `the ${title.name}`);
    return { kind: 'champion-challenge', incident: null };
  },

  // ---- the ones that need an answer ----

  'cheap-shot'({ state, winner, loser, result, index, item }) {
    // Over in a second, which is why nobody gets the chance to come out for it.
    return {
      kind: 'cheap-shot',
      incident: {
        id: nextId('inc'), kind: 'cheap-shot', itemId: item.id, index,
        aggressorId: loser.id, victimId: winner.id,
        locationId: 'gorilla', onCamera: true,
        severity: 'minor', demand: null, atGm: false, at: result.at || 0,
      },
    };
  },

  attack({ state, winner, loser, result, index, item, roll }) {
    // Usually the one who just lost. Sometimes the winner making a statement.
    const aggressor = roll() < 0.72 ? loser : winner;
    const victim = aggressor === loser ? winner : loser;
    return {
      kind: 'attack',
      incident: {
        id: nextId('inc'), kind: 'attack', itemId: item.id, index,
        aggressorId: aggressor.id, victimId: victim.id,
        locationId: 'gorilla', onCamera: true,
        severity: 'major', demand: null, atGm: false, at: result.at || 0,
      },
    };
  },

  'submission-held'({ state, winner, loser, result, index, item, roll }) {
    const weeks = INJURY_WEEKS[0]
      + Math.floor(roll() * (INJURY_WEEKS[1] - INJURY_WEEKS[0] + 1));
    loser.status = 'Injured';
    loser.injuredUntil = state.week + weeks;
    delete (state.whereabouts || {})[loser.id];

    push(state, 'submission-held', result.at || 0, {
      winnerId: winner.id, loserId: loser.id, weeks, matchType: item.matchType,
    });
    return {
      kind: 'submission-held',
      incident: {
        id: nextId('inc'), kind: 'submission-held', itemId: item.id, index,
        aggressorId: winner.id, victimId: loser.id,
        locationId: 'gorilla', onCamera: true,
        severity: 'major', demand: null, atGm: false, at: result.at || 0,
        injuryWeeks: weeks,
      },
    };
  },

  'faction-beatdown'({ state, winner, loser, result, index, item, involved }) {
    // Whichever of them has people, and whichever of them does not.
    const winnerCrew = factionWith(state, winner, involved);
    const loserCrew = factionWith(state, loser, involved);
    const [lead, crew, target] = winnerCrew.length >= 2
      ? [winner, winnerCrew, loser]
      : [loser, loserCrew, winner];
    if (crew.length < 2) return null;

    return {
      kind: 'faction-beatdown',
      incident: {
        id: nextId('inc'), kind: 'faction-beatdown', itemId: item.id, index,
        aggressorId: lead.id, victimId: target.id,
        crewIds: crew.map(w => w.id),
        locationId: 'gorilla', onCamera: true,
        severity: 'critical', demand: null, atGm: false, at: result.at || 0,
      },
    };
  },
};

// ---------------------------------------------------------------- helpers

function bothWays(state, a, b, weight, detail) {
  remember(state, a, { source: 'peer', weight, targetId: b.id, detail });
  remember(state, b, { source: 'peer', weight, targetId: a.id, detail });
}

function grow(a, b, kind, amount) {
  ensurePair(a, b.id)[kind] += amount;
  ensurePair(b, a.id)[kind] += amount;
}

// Something left on the table. Not a promise — the GM never said anything —
// just a thing the audience saw that could be a match.
function offer(state, aggressor, victim, reason) {
  createOpportunity(state, {
    aggressorId: aggressor.id, victimId: victim.id, reason, promised: false,
  });
}

export { isColour, moment };
