// Running a show.
//
// The live half of the weekly loop: go on the air, work down the card one
// segment at a time, go off the air with a rating. The GM does not decide how
// long anything takes; they set the limits beforehand and then watch the clock
// diverge from the plan.
//
// Everything here is derived from the segments themselves, so a reload in the
// middle of a show picks up exactly where it left off with no extra state to
// keep in sync.

import * as store from '../core/store.js';
import { SHOW_STATUS } from '../models/show.js';
import { SEGMENT_STATUS } from '../models/segment.js';
import { simulateSegment, applyOverride } from './matchSim.js';

/** The next segment due to happen, or null when the card is done. */
export function nextSegment(showId) {
  return store.segmentsOfShow(showId).find((s) => s.status === SEGMENT_STATUS.BOOKED) || null;
}

/** Where the show is up to, and how the clock is doing against the budget. */
export function progress(showId) {
  const show = store.requireShow(showId);
  const segments = store.segmentsOfShow(showId);
  const done = segments.filter((s) => s.status === SEGMENT_STATUS.COMPLETE);
  const elapsedSec = done.reduce((t, s) => t + s.result.actualSec, 0);
  const bookedSec = segments.reduce((t, s) => t + s.timeLimitSec, 0);
  const remainingBookedSec = segments
    .filter((s) => s.status === SEGMENT_STATUS.BOOKED)
    .reduce((t, s) => t + s.timeLimitSec, 0);

  return {
    show,
    segments,
    doneCount: done.length,
    total: segments.length,
    elapsedSec,
    bookedSec,
    remainingBookedSec,
    budgetSec: show.timeBudgetSec,
    // What the night is projected to fill if everything left runs its full limit.
    projectedSec: elapsedSec + remainingBookedSec,
    // Positive means television still to fill, negative means over.
    slackSec: show.timeBudgetSec - (elapsedSec + remainingBookedSec),
    finished: done.length === segments.length && segments.length > 0,
  };
}

export function goLive(showId) {
  const show = store.requireShow(showId);
  if (show.status !== SHOW_STATUS.SCHEDULED) return show;
  if (!show.segmentIds.length) throw new Error('Nothing is booked on this card');

  // A show cannot air before its date. Whether the GM used the "next week"
  // button or simply walked into the booking screen and started, the calendar
  // catches up here, so the roster always gets the rest between shows.
  if (show.day > store.today()) store.advanceToDay(show.day);

  store.startShow(showId);
  return show;
}

/**
 * Work out what happens next, WITHOUT recording it.
 *
 * Split from committing so the UI can play the match out on screen before the
 * result exists anywhere the player can see. Nothing is written here, so a
 * reload mid-playback simply means the match has not happened yet.
 *
 * `overrideWinnerSide` is the player's override: they keep the duration and the
 * rating the simulation produced and force who goes over. If they do not use
 * it, they live with the result.
 */
export function previewNext(showId, { overrideWinnerSide = null } = {}) {
  const show = store.requireShow(showId);
  if (show.status !== SHOW_STATUS.LIVE) throw new Error('The show is not on the air');

  const segment = nextSegment(showId);
  if (!segment) return null;

  const { result, timeline } = simulateSegment(segment, {
    get: (id) => store.requireWrestler(id),
    rng: store.getRng(),
  });

  return {
    segment,
    timeline,
    result: overrideWinnerSide ? applyOverride(result, segment, overrideWinnerSide) : result,
  };
}

/** Put a previewed result into the books. */
export function commitResult(segmentId, result) {
  store.completeSegment(segmentId, result);
  return store.getSegment(segmentId);
}

/**
 * Simulate and record the next segment in one go. Used by "run the rest of the
 * card" and by the headless checks; the live screen previews and commits
 * separately so it can show the match happening.
 */
export function runNext(showId, opts) {
  const step = previewNext(showId, opts);
  if (!step) return null;
  commitResult(step.segment.id, step.result);
  return { segment: store.getSegment(step.segment.id), result: step.result, timeline: step.timeline };
}

/** Run everything left on the card in one go. */
export function runRest(showId) {
  const out = [];
  let step;
  while ((step = runNext(showId))) out.push(step);
  return out;
}

/**
 * Grade the night.
 *
 * Weighted by how long each segment held the air, because a great two-minute
 * match does less for a show than a great fifteen-minute one, with the main
 * event counting for a little extra. Then penalised for missing the budget in
 * either direction: dead air and an overrun are both the GM's problem.
 */
export function gradeShow(showId) {
  const { segments, elapsedSec, budgetSec } = progress(showId);
  const done = segments.filter((s) => s.status === SEGMENT_STATUS.COMPLETE && s.result.quality != null);
  if (!done.length) return 1;

  const totalSec = done.reduce((t, s) => t + s.result.actualSec, 0) || 1;
  const weighted = done.reduce((t, s) => t + s.result.quality * s.result.actualSec, 0) / totalSec;
  const finale = done[done.length - 1].result.quality;

  let rating = 0.85 * weighted + 0.15 * finale;
  const miss = Math.abs(1 - (elapsedSec / budgetSec));
  rating -= miss * 35;

  return Math.round(Math.max(1, Math.min(100, rating)));
}

export function goOffAir(showId) {
  const show = store.requireShow(showId);
  if (show.status !== SHOW_STATUS.LIVE) return show;
  const rating = gradeShow(showId);
  store.completeShow(showId, { rating });
  return store.getShow(showId);
}

/** The show the GM is working on: the first one not yet in the books. */
export function currentShow() {
  return store.allShows().find((s) => s.status !== SHOW_STATUS.COMPLETE) || null;
}

/** Move to the next show and hand back where the GM has landed. */
export function nextWeek() {
  const moved = store.advanceToNextShow();
  if (!moved) return null;
  return currentShow();
}
