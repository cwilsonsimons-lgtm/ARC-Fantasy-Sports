// Championships.
//
// A belt changes hands here and nowhere else, so there is exactly one path a
// title can travel and exactly one place to look when it ends up somewhere
// surprising. Like every other system, this one subscribes rather than being
// called: a title match resolved from the live show, from "run the rest of the
// card", or from a test all move the belt the same way.

import * as store from '../core/store.js';
import { EVENT_TYPES } from '../core/events.js';
import { SEGMENT_KINDS } from '../models/segment.js';
import { championIds, canChangeHands, currentReign, isVacant } from '../models/title.js';
import { contenderFor } from './rankings.js';

/** A title win is one of the loudest things that can happen to a wrestler. */
const TITLE_WIN_MOMENTUM = 25;

function rememberTitleWin(winnerId, { titleName, beatenIds, cause }) {
  const w = store.getWrestler(winnerId);
  store.updateWrestlerState(winnerId, {
    momentum: w.state.momentum + TITLE_WIN_MOMENTUM,
    morale: w.state.morale + 12,
    mood: 'confident',
  }, { reason: `Won the ${titleName}`, cause });

  store.addMemory(winnerId, {
    type: 'title_win',
    summary: beatenIds.length
      ? `Won the ${titleName} from ${beatenIds.map(store.nameOf).join(' & ')}`
      : `Won the ${titleName}`,
    aboutIds: beatenIds,
    weight: 92, floor: 50, decayPerDay: 0.08, scar: true,
  }, { cause });
}

function rememberTitleLoss(loserId, { titleName, winnerIds, reignDays, defenses, cause }) {
  const w = store.getWrestler(loserId);
  store.updateWrestlerState(loserId, {
    momentum: w.state.momentum - 15,
    morale: w.state.morale - (6 + w.identity.ego / 15),
    mood: 'frustrated',
  }, { reason: `Lost the ${titleName}`, cause });

  store.addMemory(loserId, {
    type: 'title_loss',
    summary: `Lost the ${titleName} to ${winnerIds.map(store.nameOf).join(' & ')} after ${reignDays} days and ${defenses} defence${defenses === 1 ? '' : 's'}`,
    aboutIds: winnerIds,
    weight: 96, floor: 55, decayPerDay: 0.06, scar: true,
  }, { cause });
}

function resolveTitleMatch(event) {
  const segment = store.getSegment(event.segmentId);
  if (!segment || !segment.titleId || segment.kind !== SEGMENT_KINDS.MATCH) return;

  const title = store.getTitle(segment.titleId);
  if (!title) return;

  const { winnerIds = [], loserIds = [], finish } = event.data;
  const holders = championIds(title);
  const day = store.today();

  // Nobody won, or it did not end in a way that can move a belt: the champion
  // keeps it. A countout or a disqualification is a defence, not a title change.
  const decisive = winnerIds.length > 0 && canChangeHands(finish);
  const championWon = winnerIds.some((id) => holders.includes(id));

  if (isVacant(title)) {
    // A vacant title on the line: whoever wins it decisively becomes champion.
    if (!decisive) return;
    const won = store.awardTitle(title.id, winnerIds, {
      atShowId: event.showId, atSegmentId: event.segmentId,
      reason: 'Won the vacant title', cause: event.id,
    });
    winnerIds.forEach((id) => rememberTitleWin(id, {
      titleName: title.shortName, beatenIds: loserIds, cause: won.id,
    }));
    return;
  }

  if (!decisive || championWon) {
    const defence = store.recordDefense(title.id, {
      againstIds: loserIds.length ? loserIds : winnerIds,
      atShowId: event.showId, atSegmentId: event.segmentId, cause: event.id,
    });
    // A champion who survived on a technicality still survived, and knows it.
    if (defence && !championWon) {
      for (const id of holders) {
        store.addMemory(id, {
          type: 'lucky_escape',
          summary: `Kept the ${title.shortName} title without winning the match`,
          aboutIds: winnerIds,
          weight: 45, floor: 8, decayPerDay: 0.5,
        }, { cause: defence.id });
      }
    }
    return;
  }

  // The belt moves.
  const reign = currentReign(title);
  const reignDays = reign ? Math.max(0, day - reign.wonOnDay) : 0;
  const defenses = reign ? reign.defenses : 0;

  const won = store.awardTitle(title.id, winnerIds, {
    atShowId: event.showId, atSegmentId: event.segmentId,
    reason: 'Won it in the ring', cause: event.id,
  });

  winnerIds.forEach((id) => rememberTitleWin(id, {
    titleName: title.shortName, beatenIds: holders, cause: won.id,
  }));
  holders.forEach((id) => rememberTitleLoss(id, {
    titleName: title.shortName, winnerIds, reignDays, defenses, cause: won.id,
  }));
}

/**
 * Keep each belt's #1 contender in step with the rankings.
 * Announced only when it actually changes, so the log reads as news.
 */
function refreshContenders(event) {
  for (const title of store.allTitles()) {
    const next = contenderFor(title.id);
    const nextId = next?.id ?? null;
    if (nextId === title.contenderId) continue;
    const previousId = title.contenderId;
    title.contenderId = nextId;
    if (!nextId) continue;

    store.emit(EVENT_TYPES.CONTENDER_CHANGED, {
      summary: `${store.nameOf(nextId)} is the new #1 contender for the ${title.shortName} title`,
      subjects: [nextId, previousId, title.id].filter(Boolean),
      cause: event?.id ?? null,
      data: { titleId: title.id, contenderId: nextId, previousId, rank: next.standing.rank },
    });
  }
}

export function install() {
  store.on(EVENT_TYPES.SEGMENT_COMPLETED, resolveTitleMatch);
  store.on(EVENT_TYPES.RANKING_UPDATED, refreshContenders);
}

export { refreshContenders };
