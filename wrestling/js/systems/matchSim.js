// The match simulation.
//
// The GM assigns a time LIMIT. This decides what happens inside it, including
// when it ends. A fifteen-minute limit can finish at ninety seconds, at seven
// minutes, or run the full distance to a time-limit draw, and the GM finds out
// at the same moment the audience does.
//
// Tier 1 keeps this deliberately plain: stats, momentum, condition, chemistry
// and RNG. No interference, no injuries, no refusals, no overrides of the
// finish beyond the explicit one the player can ask for.
//
// It is a pure function of (segment, wrestler lookup, rng). It reads no module
// state and writes nothing, so it can be run a thousand times in a test to see
// whether the numbers behave.

import { sides, FINISHES } from '../models/segment.js';
import { formatOf } from './formats.js';
import { SEGMENT_KINDS } from '../models/segment.js';
import { relationshipTo } from '../models/wrestler.js';

/** The clock ticks in half-minutes. Fine enough to feel live, coarse enough to read. */
export const BEAT_SEC = 30;

/**
 * How sharply strength converts into wins. Tuned so that across the roster
 * spread a main-eventer beats a jobber about 97 times in 100, beats a
 * midcarder about 84, and splits roughly evenly with another main-eventer.
 */
export const WIN_EXPONENT = 6;

/**
 * How hard this wrestler is to beat tonight.
 * Ability is most of it; momentum and condition are the levers that make the
 * same card play differently in week six than it did in week one.
 */
export function ringStrength(w) {
  const base = 0.50 * w.ability.workRate + 0.30 * w.ability.starPower + 0.20 * w.ability.durability;
  const momentum = w.state.momentum * 0.12;          // -12 .. +12
  const condition = 0.75 + 0.25 * (w.state.condition / 100);
  return Math.max(5, (base + momentum) * condition);
}

/** A side is its best wrestler plus a fraction of everyone else standing with them. */
export function sideStrength(ids, get) {
  const each = ids.map((id) => ringStrength(get(id))).sort((a, b) => b - a);
  return each[0] + each.slice(1).reduce((t, v) => t + v * 0.30, 0);
}

/**
 * How much these people have going on with each other, 0..1.
 * Strong feeling in EITHER direction raises the ceiling: two men who hate each
 * other have a better match than two who have no opinion.
 */
export function chemistry(participantIds, get) {
  if (participantIds.length < 2) return 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < participantIds.length; i++) {
    for (let j = i + 1; j < participantIds.length; j++) {
      const a = get(participantIds[i]);
      const b = get(participantIds[j]);
      total += (Math.abs(relationshipTo(a, participantIds[j])) + Math.abs(relationshipTo(b, participantIds[i]))) / 2;
      pairs++;
    }
  }
  return pairs ? Math.min(1, total / pairs / 100) : 0;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * When does it end?
 *
 * Each beat gets a chance of producing a finish. The chances are shaped so that
 * the total across the match is roughly constant however long the limit is -
 * otherwise a five-minute limit would end in a draw half the time - while the
 * SHAPE still says something. An even match clusters its finish late; a
 * mismatch spreads earlier, which is what a squash looks like from the outside.
 */
function finishHazards(beats, gap) {
  // An even match builds: the finish bunches in the last third, and a sudden
  // two-minute ending between equals is rare. A lopsided one flattens out, so a
  // squash can end almost anywhere - which is what a squash looks like.
  const shape = 2.8 - 1.6 * gap;
  // The flat term is the chance of it ending at any moment regardless of how
  // long it has gone. Small on purpose: too much of it and the assigned limit
  // stops meaning anything, because every match becomes a coin flip per minute.
  const flat = 0.05 + 0.10 * gap;
  // More time on the clock means more chances to put someone away, so a long
  // limit reaches a finish more reliably and a short one draws more often -
  // which is the right way round for a five-minute challenge.
  const budget = (2.9 + 0.9 * gap) * (1 + 0.25 * Math.log(beats / 20));
  const weights = [];
  for (let i = 1; i <= beats; i++) weights.push(flat + Math.pow(i / beats, shape));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => clamp((budget * w) / total, 0, 0.85));
}

function pickFinish(rng, gap) {
  // A lopsided match is likelier to end cleanly; an even one strays more often.
  return rng.weighted([
    [FINISHES.PINFALL, 60 + 15 * gap],
    [FINISHES.SUBMISSION, 20],
    [FINISHES.COUNTOUT, 8 - 3 * gap],
    [FINISHES.DQ, 7 - 2 * gap],
  ]);
}

function qualityOf({ workAvg, charismaAvg, starAvg, competitiveness, chem, conditionAvg, actualSec, rng }) {
  let q = 0.42 * workAvg + 0.12 * charismaAvg + 0.10 * starAvg;
  q += 16 * competitiveness;
  q += 8 * chem;
  q *= 0.85 + 0.15 * (conditionAvg / 100);
  // Time on the clock. A squash rates low however good the people in it are,
  // because that is what a squash is.
  q += actualSec < 90
    ? -20 + (actualSec / 90) * 8
    : -4 + 12 * Math.min(1, actualSec / 600);
  q += rng.range(-6, 6);
  return Math.round(clamp(q, 1, 100));
}

/**
 * Run a segment.
 * Returns the result shape `store.completeSegment` expects. Writes nothing.
 */
export function simulateSegment(segment, { get, rng }) {
  const format = formatOf(segment.format);
  const bySide = sides(segment);
  const sideKeys = Object.keys(bySide);
  const everyone = segment.participants.map((p) => p.wrestlerId);

  if (format.kind !== SEGMENT_KINDS.MATCH || sideKeys.length < 2 || !everyone.length) {
    return simulateTalking(segment, everyone, { get, rng });
  }

  // --- who is stronger tonight ---
  const strengths = sideKeys.map((k) => sideStrength(bySide[k], get));
  const high = Math.max(...strengths);
  const low = Math.min(...strengths);
  const gap = high > 0 ? clamp((high - low) / high, 0, 1) : 0;

  // --- when does it end ---
  const beats = Math.max(2, Math.floor(segment.timeLimitSec / BEAT_SEC));
  const hazards = finishHazards(beats, gap);
  const log = [];
  let endedAtBeat = null;
  let control = sideKeys[strengths.indexOf(high)];

  log.push({ atSec: 0, text: 'The bell rings.' });

  for (let i = 0; i < beats; i++) {
    const atSec = (i + 1) * BEAT_SEC;

    // Control passes around. The weaker side has to work for it, so the
    // commentary tracks the same numbers the finish does.
    if (rng.chance(0.18)) {
      const others = sideKeys.filter((k) => k !== control);
      const next = rng.weighted(others.map((k) => [k, strengths[sideKeys.indexOf(k)]]));
      if (next) {
        control = next;
        log.push({ atSec, text: `${nameSide(bySide[control], get)} take over.` });
      }
    } else if (i > beats * 0.4 && rng.chance(0.12)) {
      log.push({ atSec, text: `Near fall for ${nameSide(bySide[control], get)}.` });
    }

    if (rng.chance(hazards[i])) { endedAtBeat = i + 1; break; }
  }

  // --- the outcome ---
  const wentLong = endedAtBeat == null;
  const actualSec = wentLong
    ? segment.timeLimitSec
    : Math.min(segment.timeLimitSec, endedAtBeat * BEAT_SEC + rng.range(0, BEAT_SEC - 1));

  let finish;
  let winnerIds = [];
  let loserIds = [];

  if (wentLong) {
    finish = FINISHES.TIME_LIMIT_DRAW;
    log.push({ atSec: actualSec, text: 'Time limit expires. We have a draw.' });
  } else {
    finish = pickFinish(rng, gap);
    // Better wrestlers win more. The exponent is what keeps an upset a genuine
    // tail rather than a coin flip: it puts a main-eventer past 95% against a
    // jobber while leaving two comparable stars near even.
    const winnerSide = rng.weighted(sideKeys.map((k, i) => [k, Math.pow(strengths[i], WIN_EXPONENT)]));
    winnerIds = bySide[winnerSide];
    loserIds = sideKeys.filter((k) => k !== winnerSide).flatMap((k) => bySide[k]);
    log.push({ atSec: actualSec, text: `${nameSide(winnerIds, get)} wins by ${finish.replace(/_/g, ' ')}.` });
  }

  const people = everyone.map(get);
  const quality = qualityOf({
    workAvg: mean(people.map((w) => w.ability.workRate)),
    charismaAvg: mean(people.map((w) => w.ability.charisma)),
    starAvg: mean(people.map((w) => w.ability.starPower)),
    competitiveness: 1 - gap,
    chem: chemistry(everyone, get),
    conditionAvg: mean(people.map((w) => w.state.condition)),
    actualSec, rng,
  });

  return { finish, winnerIds, loserIds, actualSec, quality, beats: trimLog(log), overridden: false };
}

/** Promos, interviews and angles: they run, they are good or they are not. */
function simulateTalking(segment, everyone, { get, rng }) {
  const people = everyone.map(get).filter(Boolean);
  const actualSec = Math.round(segment.timeLimitSec * rng.range(70, 100) / 100);
  const chem = chemistry(everyone, get);
  let q = 0.55 * mean(people.map((w) => w.ability.charisma))
        + 0.12 * mean(people.map((w) => w.ability.starPower))
        + 10 * chem
        + rng.range(-7, 7);
  return {
    finish: FINISHES.SEGMENT_END,
    winnerIds: [],
    loserIds: [],
    actualSec,
    quality: Math.round(clamp(q, 1, 100)),
    beats: [{ atSec: actualSec, text: `${nameSide(everyone, get)} wraps it up.` }],
    overridden: false,
  };
}

function nameSide(ids, get) {
  return ids.map((id) => get(id)?.shortName || id).join(' & ');
}

/** Keep the beat log readable: the open, the finish, and a few moments between. */
function trimLog(log, max = 8) {
  if (log.length <= max) return log;
  const first = log[0];
  const last = log[log.length - 1];
  const middle = log.slice(1, -1);
  const step = middle.length / (max - 2);
  const kept = [];
  for (let i = 0; i < max - 2; i++) kept.push(middle[Math.floor(i * step)]);
  return [first, ...kept, last];
}

/**
 * The player's override. Forces a winner and keeps everything else the
 * simulation produced, so the match still has a real duration and rating.
 */
export function applyOverride(result, segment, winnerSideKey) {
  const bySide = sides(segment);
  if (!bySide[winnerSideKey]) return result;
  const winnerIds = bySide[winnerSideKey];
  const loserIds = Object.keys(bySide).filter((k) => k !== winnerSideKey).flatMap((k) => bySide[k]);
  const finish = result.finish === FINISHES.TIME_LIMIT_DRAW ? FINISHES.PINFALL : result.finish;
  return { ...result, finish, winnerIds, loserIds, overridden: true };
}
