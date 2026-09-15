// What happens between wrestlers.
//
// This is the connective tissue. Every match that gets worked moves how the
// people in it see each other, across all four axes, weighted by who they are:
// a vindictive wrestler takes a loss as a debt, a professional takes it as a
// loss. Nothing here decides anything - it records what the ring did to the
// locker room, so that later systems have a locker room to read.
//
// Like every system, it subscribes rather than being called.

import * as store from '../core/store.js';
import { EVENT_TYPES } from '../core/events.js';
import { SEGMENT_KINDS, FINISHES } from '../models/segment.js';
import { CAREER_RANK, relationshipWith } from '../models/wrestler.js';
import { sideOf } from '../models/segment.js';
import { MEMORY_TYPES } from '../models/memory.js';

const rankOf = (id) => CAREER_RANK[store.getWrestler(id)?.standing.careerStatus] ?? 3;
const trait = (id, name) => store.getWrestler(id)?.identity.traits[name] ?? 50;

/**
 * How many times these two have already been on OPPOSITE sides of a match.
 *
 * Standing next to someone as their tag partner is not a meeting for the
 * purposes of building a feud, and counting it as one made teaming with
 * somebody quietly generate heat toward them.
 */
function priorMeetings(aId, bId) {
  return store.queryLog({ type: EVENT_TYPES.MATCH_RESULT, subjectId: aId })
    .filter((e) => {
      if (!(e.data.participantIds || []).includes(bId)) return false;
      const segment = store.getSegment(e.segmentId);
      if (!segment) return false;
      const a = sideOf(segment, aId);
      const b = sideOf(segment, bId);
      return a != null && b != null && a !== b;
    })
    .length;
}

/**
 * A loss moves four things at once, and personality decides how much of each.
 * Respect is the objective one: beating someone above you earns it, beating
 * someone below you does not.
 */
function loserTowardWinner(loserId, winnerIds, event, { meetings }) {
  const gap = rankOf(winnerIds[0]) - rankOf(loserId);   // positive: they were above me
  const vindictive = trait(loserId, 'vindictiveness') / 100;
  const jealous = trait(loserId, 'jealousy') / 100;
  const professional = trait(loserId, 'professionalism') / 100;
  const titled = !!event.data.titleId;
  const upset = gap < 0;

  // Familiarity is what turns a series of matches into a feud, and it has to
  // outpace the cooling in upkeep.js or nothing would ever reach the rivalry
  // threshold. Booking two people against each other repeatedly is the GM's
  // most direct way of manufacturing heat, which is exactly what the design
  // foundation says it should be.
  const familiarity = Math.min(5, meetings) * 4.5;

  for (const winnerId of winnerIds) {
    const deltas = {
      // Losing to someone better is respectable. Losing to someone beneath you
      // is not, and the sting is jealousy rather than admiration.
      respect: upset ? -6 - jealous * 6 : 3 + gap * 2,
      hostility: (upset ? 12 : 5) * (0.5 + vindictive) + familiarity + (titled ? 6 : 0),
      affinity: -(upset ? 6 : 3) * (0.4 + vindictive) * (1.2 - professional * 0.5),
      trust: upset ? -3 : -1,
    };
    store.adjustRelationship(loserId, winnerId, deltas, {
      type: upset ? 'upset_loss' : 'loss',
      reason: upset
        ? `Beaten by ${store.nameOf(winnerId)}, who should not have beaten them`
        : `Beaten by ${store.nameOf(winnerId)}`,
      cause: event.id,
    });
  }
}

/** Winning tells you less about someone than losing to them does. */
function winnerTowardLoser(winnerId, loserIds, event, { competitive, meetings }) {
  // The winner gets drawn into it too, just less: they are not the one with
  // something to prove.
  const familiarity = Math.min(5, meetings) * 2.5;
  const aggression = trait(winnerId, 'aggression') / 100;

  for (const loserId of loserIds) {
    const gap = rankOf(loserId) - rankOf(winnerId);
    store.adjustRelationship(winnerId, loserId, {
      respect: competitive ? 4 + Math.max(0, gap) * 2 : -2,
      hostility: 3 * (0.5 + aggression) + familiarity,
      affinity: -1,
    }, {
      type: 'win',
      reason: `Beat ${store.nameOf(loserId)}`,
      cause: event.id,
    });
  }
}

/**
 * A disqualification means somebody broke the rules to avoid losing, and the
 * other man knows exactly what happened. This is the single biggest
 * relationship swing available without a betrayal system.
 */
function recordCheating(victimId, cheaterIds, event) {
  const vindictive = trait(victimId, 'vindictiveness') / 100;
  for (const cheaterId of cheaterIds) {
    store.adjustRelationship(victimId, cheaterId, {
      hostility: 18 * (0.6 + vindictive),
      respect: -14,
      trust: -20,
      affinity: -12 * (0.5 + vindictive),
    }, {
      type: MEMORY_TYPES.CHEATED.key,
      reason: `${store.nameOf(cheaterId)} took the disqualification rather than lose`,
      cause: event.id,
    });
    store.addMemory(victimId, {
      type: MEMORY_TYPES.CHEATED.key,
      summary: `${store.nameOf(cheaterId)} got themselves disqualified rather than be beaten`,
      aboutIds: [cheaterId],
    }, { cause: event.id });
  }
}

/** Working a tag match together is an opinion about your partner. */
function recordTeaming(segment, event) {
  const bySide = {};
  for (const p of segment.participants) (bySide[p.side] ||= []).push(p.wrestlerId);

  for (const ids of Object.values(bySide)) {
    if (ids.length < 2) continue;
    const won = ids.some((id) => (event.data.winnerIds || []).includes(id));

    for (const id of ids) {
      for (const partnerId of ids) {
        if (id === partnerId) continue;
        const existing = relationshipWith(store.getWrestler(id), partnerId);
        const loyal = trait(id, 'loyalty') / 100;

        if (won) {
          store.adjustRelationship(id, partnerId, {
            affinity: 5 * (0.5 + loyal), trust: 4, respect: 3,
          }, { type: MEMORY_TYPES.TEAMED_WELL.key, reason: `Won alongside ${store.nameOf(partnerId)}`, cause: event.id });
        } else {
          // Losing with someone you already resent confirms what you thought.
          const sour = existing.affinity < -20 || existing.hostility > 40;
          store.adjustRelationship(id, partnerId, {
            affinity: sour ? -7 : -2,
            trust: sour ? -6 : -2,
            hostility: sour ? 6 : 1,
          }, { type: MEMORY_TYPES.TEAMED_BADLY.key, reason: `Lost alongside ${store.nameOf(partnerId)}`, cause: event.id });

          if (sour) {
            store.addMemory(id, {
              type: MEMORY_TYPES.TEAMED_BADLY.key,
              summary: `Was made to team with ${store.nameOf(partnerId)}, and they lost`,
              aboutIds: [partnerId],
            }, { cause: event.id });
          }
        }
      }
    }
  }
}

export function install() {
  store.on(EVENT_TYPES.MATCH_RESULT, (event) => {
    const segment = store.getSegment(event.segmentId);
    if (!segment || segment.kind !== SEGMENT_KINDS.MATCH) return;

    const { winnerIds = [], loserIds = [], participantIds = [], finish } = event.data;
    const competitive = event.data.actualSec >= segment.timeLimitSec * 0.5;

    // A disqualification: whoever "won" it was cheated out of a clean finish.
    if (finish === FINISHES.DQ && winnerIds.length && loserIds.length) {
      for (const victimId of winnerIds) recordCheating(victimId, loserIds, event);
    }

    for (const loserId of loserIds) {
      loserTowardWinner(loserId, winnerIds, event, {
        meetings: priorMeetings(loserId, winnerIds[0]),
      });
    }
    for (const winnerId of winnerIds) {
      winnerTowardLoser(winnerId, loserIds, event, {
        competitive,
        meetings: loserIds.length ? priorMeetings(winnerId, loserIds[0]) : 0,
      });
    }

    // A draw settles nothing, which is its own kind of heat.
    if (finish === FINISHES.TIME_LIMIT_DRAW) {
      for (const id of participantIds) {
        for (const otherId of participantIds) {
          if (id === otherId) continue;
          store.adjustRelationship(id, otherId, {
            respect: 6, hostility: 5 + Math.min(3, priorMeetings(id, otherId)) * 2,
          }, { type: 'draw', reason: `Went the distance with ${store.nameOf(otherId)} and settled nothing`, cause: event.id });
        }
      }
    }

    recordTeaming(segment, event);
  });
}
