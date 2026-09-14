// What a result does to the people in it.
//
// This is the "save results" half of the weekly loop. It subscribes to
// `segment.completed` rather than being called by the show runner, which means
// a result recorded from anywhere - the live show, a future simulation of a
// rival brand, a debug console - updates the record the same way.
//
// Tier 1 scope: records, streaks, momentum, morale, ring wear, and a memory of
// what happened. No relationship changes, no grudges, no refusals. Those are
// reactions, and reactions are the next tier.

import * as store from '../core/store.js';
import { EVENT_TYPES } from '../core/events.js';
import { SEGMENT_KINDS, FINISHES } from '../models/segment.js';
import { CAREER_RANK } from '../models/wrestler.js';

/** W3 becomes W4; a loss after a win streak becomes L1. */
function nextStreak(streak, type) {
  return streak && streak.type === type
    ? { type, count: streak.count + 1 }
    : { type, count: 1 };
}

/** Ring time costs condition, and it costs a fragile wrestler more. */
function conditionCost(wrestler, actualSec) {
  const minutes = actualSec / 60;
  return minutes * (1.6 - wrestler.ability.durability / 100);
}

function recordWin(id, event, opponentIds) {
  const w = store.getWrestler(id);
  store.updateStanding(id, {
    wins: w.standing.wins + 1,
    streak: nextStreak(w.standing.streak, 'W'),
  }, { reason: `Beat ${opponentIds.map(store.nameOf).join(' & ')}`, cause: event.id });

  store.updateWrestlerState(id, {
    momentum: w.state.momentum + 14,
    morale: w.state.morale + 4,
    condition: w.state.condition - conditionCost(w, event.data.actualSec),
  }, { reason: 'Won their match', cause: event.id });

  store.addMemory(id, {
    type: 'win',
    summary: `Beat ${opponentIds.map(store.nameOf).join(' & ')}`,
    aboutIds: opponentIds,
    weight: 20, floor: 2, decayPerDay: 0.9,
  }, { cause: event.id });
}

function recordLoss(id, event, winnerIds) {
  const w = store.getWrestler(id);
  store.updateStanding(id, {
    losses: w.standing.losses + 1,
    streak: nextStreak(w.standing.streak, 'L'),
  }, { reason: `Lost to ${winnerIds.map(store.nameOf).join(' & ')}`, cause: event.id });

  // A big ego takes a loss harder. Same event, different person, different cost.
  const moraleHit = 3 + w.identity.ego / 20;
  store.updateWrestlerState(id, {
    momentum: w.state.momentum - 12,
    morale: w.state.morale - moraleHit,
    condition: w.state.condition - conditionCost(w, event.data.actualSec),
  }, { reason: 'Lost their match', cause: event.id });

  // Losing to someone beneath you is the kind of thing that stays with a person.
  const mine = CAREER_RANK[w.standing.careerStatus] ?? 2;
  const theirs = Math.max(...winnerIds.map((id2) => CAREER_RANK[store.getWrestler(id2).standing.careerStatus] ?? 2));
  const upset = mine - theirs;
  store.addMemory(id, {
    type: upset > 0 ? 'upset_loss' : 'loss',
    summary: upset > 0
      ? `Lost to ${winnerIds.map(store.nameOf).join(' & ')}, who should not have beaten me`
      : `Lost to ${winnerIds.map(store.nameOf).join(' & ')}`,
    aboutIds: winnerIds,
    weight: 25 + w.identity.ego / 5 + Math.max(0, upset) * 12,
    floor: upset > 0 ? 12 : 2,
    decayPerDay: 0.8,
    scar: upset > 1,
  }, { cause: event.id });
}

function recordDraw(id, event, otherIds) {
  const w = store.getWrestler(id);
  store.updateStanding(id, {
    draws: w.standing.draws + 1,
    streak: nextStreak(w.standing.streak, 'D'),
  }, { reason: 'Went to a time-limit draw', cause: event.id });

  store.updateWrestlerState(id, {
    momentum: w.state.momentum + 2,
    morale: w.state.morale + 1,
    condition: w.state.condition - conditionCost(w, event.data.actualSec),
  }, { reason: 'Went the distance', cause: event.id });

  store.addMemory(id, {
    type: 'draw',
    summary: `Went the full limit with ${otherIds.map(store.nameOf).join(' & ')} and settled nothing`,
    aboutIds: otherIds,
    weight: 22, floor: 4, decayPerDay: 0.7,
  }, { cause: event.id });
}

/** Non-match segments still take something out of you, just much less. */
function recordAppearance(id, event) {
  const w = store.getWrestler(id);
  store.updateWrestlerState(id, {
    condition: w.state.condition - event.data.actualSec / 60 * 0.3,
  }, { reason: 'Worked a segment', cause: event.id });
}

export function install() {
  store.on(EVENT_TYPES.SEGMENT_COMPLETED, (event) => {
    const segment = store.getSegment(event.segmentId);
    if (!segment) return;

    const { winnerIds = [], loserIds = [] } = event.data;
    const everyone = segment.participants.map((p) => p.wrestlerId);

    if (segment.kind !== SEGMENT_KINDS.MATCH) {
      everyone.forEach((id) => recordAppearance(id, event));
      return;
    }

    if (event.data.finish === FINISHES.TIME_LIMIT_DRAW) {
      everyone.forEach((id) => recordDraw(id, event, everyone.filter((o) => o !== id)));
    } else {
      winnerIds.forEach((id) => recordWin(id, event, loserIds));
      loserIds.forEach((id) => recordLoss(id, event, winnerIds));
    }

    store.emit(EVENT_TYPES.MATCH_RESULT, {
      summary: winnerIds.length
        ? `${winnerIds.map(store.nameOf).join(' & ')} def. ${loserIds.map(store.nameOf).join(' & ')}`
        : `${everyone.map(store.nameOf).join(' & ')} fought to a draw`,
      subjects: everyone,
      showId: event.showId,
      segmentId: event.segmentId,
      cause: event.id,
      data: {
        finish: event.data.finish,
        winnerIds, loserIds,
        // Everyone who was in it, so the ranking can be recomputed from the log
        // alone without going back to the segment.
        participantIds: everyone,
        titleId: segment.titleId || null,
        actualSec: event.data.actualSec,
        quality: segment.result.quality,
        overridden: event.data.overridden,
      },
    });
  });
}
