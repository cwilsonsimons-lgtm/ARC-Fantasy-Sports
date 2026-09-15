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
import { relationshipWith } from '../models/wrestler.js';

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
 *
 * Two things raise a match's ceiling, and they are not the same thing. HEAT is
 * strong feeling in either direction - love or hatred both beat indifference.
 * RESPECT is whether they can actually work together. The best matches in
 * wrestling have both: two men who cannot stand each other and know exactly how
 * good the other one is.
 */
export function chemistry(participantIds, get) {
  if (participantIds.length < 2) return 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < participantIds.length; i++) {
    for (let j = i + 1; j < participantIds.length; j++) {
      const a = get(participantIds[i]);
      const b = get(participantIds[j]);
      const ab = relationshipWith(a, participantIds[j]);
      const ba = relationshipWith(b, participantIds[i]);
      const heat = (Math.abs(ab.affinity) + ab.hostility + Math.abs(ba.affinity) + ba.hostility) / 2;
      const respect = (ab.respect + ba.respect) / 2;
      total += clamp(heat * 0.006 + (respect - 50) * 0.006, 0, 1);
      pairs++;
    }
  }
  return pairs ? Math.min(1, total / pairs) : 0;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * Beat vocabulary. Small on purpose, and varied enough that one card does not
 * read the same line five times. These are punctuation for the clock, not
 * play-by-play: the match is the numbers, and this is what the GM sees of it.
 */
const PHRASES = {
  open: ['The bell rings.', 'Here we go.', 'They lock up.'],
  early: ['A feeling-out process early.', 'Neither wants to make the first mistake.', 'Cagey start.'],
  takeover: ['{X} takes over.', '{X} seizes control.', '{X} turns it around.'],
  pressing: ['{X} is grinding this down.', '{X} keeps the pressure on.', '{X} is in complete control.'],
  trouble: ['{X} is in real trouble now.', '{X} cannot get going.'],
  nearfall: ['Near fall for {X}.', 'That was almost it.', '{X} thought that was three.'],
  rally: ['{X} is fighting back.', 'The crowd is with {X}.'],
};

function phrase(rng, key, name) {
  return rng.pick(PHRASES[key]).replace('{X}', name);
}

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
  const timeline = [];
  let endedAtBeat = null;
  let control = sideKeys[strengths.indexOf(high)];
  let heldFor = 0;

  timeline.push({ atSec: 0, text: phrase(rng, 'open'), kind: 'open' });

  for (let i = 0; i < beats; i++) {
    const atSec = (i + 1) * BEAT_SEC;
    const fraction = (i + 1) / beats;
    const inControl = () => nameSide(bySide[control], get);

    // Control passes around. The weaker side has to work for it, so what the
    // GM reads tracks the same numbers the finish does.
    if (rng.chance(0.18)) {
      const others = sideKeys.filter((k) => k !== control);
      const next = rng.weighted(others.map((k) => [k, strengths[sideKeys.indexOf(k)]]));
      if (next && next !== control) {
        control = next;
        heldFor = 0;
        timeline.push({ atSec, text: phrase(rng, 'takeover', inControl()), kind: 'takeover' });
      }
    } else {
      heldFor++;
      if (fraction < 0.2 && i === 1) {
        timeline.push({ atSec, text: phrase(rng, 'early'), kind: 'colour' });
      } else if (fraction > 0.4 && rng.chance(0.12)) {
        timeline.push({ atSec, text: phrase(rng, 'nearfall', inControl()), kind: 'nearfall' });
      } else if (heldFor >= 5 && rng.chance(0.35)) {
        const losing = sideKeys.filter((k) => k !== control);
        timeline.push({
          atSec,
          text: rng.chance(0.5)
            ? phrase(rng, 'pressing', inControl())
            : phrase(rng, 'trouble', nameSide(bySide[rng.pick(losing)], get)),
          kind: 'colour',
        });
        heldFor = 0;
      }
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
    timeline.push({ atSec: actualSec, text: 'Time limit expires. We have a draw.', kind: 'finish' });
  } else {
    finish = pickFinish(rng, gap);
    // Better wrestlers win more. The exponent is what keeps an upset a genuine
    // tail rather than a coin flip: it puts a main-eventer past 95% against a
    // jobber while leaving two comparable stars near even.
    const winnerSide = rng.weighted(sideKeys.map((k, i) => [k, Math.pow(strengths[i], WIN_EXPONENT)]));
    winnerIds = bySide[winnerSide];
    loserIds = sideKeys.filter((k) => k !== winnerSide).flatMap((k) => bySide[k]);
    timeline.push({
      atSec: actualSec,
      text: `${nameSide(winnerIds, get)} wins by ${finish.replace(/_/g, ' ')}.`,
      kind: 'finish',
    });
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

  return {
    // What gets stored. `beats` is the trimmed highlight set kept in the save.
    result: { finish, winnerIds, loserIds, actualSec, quality, beats: trimLog(timeline), overridden: false },
    // The full feed, for watching it happen. Never stored: a season of these
    // would be most of the save file, and the highlights are the record.
    timeline,
  };
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
  const timeline = [
    { atSec: 0, text: `${nameSide(everyone, get)} has the microphone.`, kind: 'open' },
    { atSec: actualSec, text: `${nameSide(everyone, get)} wraps it up.`, kind: 'finish' },
  ];
  return {
    result: {
      finish: FINISHES.SEGMENT_END,
      winnerIds: [], loserIds: [],
      actualSec,
      quality: Math.round(clamp(q, 1, 100)),
      beats: timeline,
      overridden: false,
    },
    timeline,
  };
}

function nameSide(ids, get) {
  return ids.map((id) => get(id)?.shortName || id).join(' & ');
}

/** Keep the stored beat log readable: the open, the finish, a few moments between. */
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
