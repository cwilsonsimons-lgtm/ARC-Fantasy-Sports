// What the tree actually opens.
//
// One file so that every "can I do this yet" question has a single answer, and
// so that model/progression.js can stay about points and levels without
// importing half the game. Everything here takes state and returns a fact.
//
// The rule for adding to this file: an upgrade earns an entry here on the day
// it starts changing something. Until then it lives in data/upgrades.js
// without `built`, sits on the board greyed out, and nothing consults it.
import { has } from './progression.js';
import { PRESETS } from '../data/shapes.js';
import { MATCH_TYPES } from '../data/match-types.js';
import { byId } from './wrestlers.js';
import { relationship, rapport } from './relationships.js';
import { feelingToward } from './memory.js';

// ── booking ─────────────────────────────────────────────────────────────────

// Every shape and every stipulation, from week one.
//
// These used to be purchases on the Booking branch. They are not any more: a
// GM who cannot book a tag match is not a GM, and locking the vocabulary of
// the job behind a skill tree bought a tutorial beat at the cost of the
// fantasy. The branch expands what you can *carry* — roster, show length,
// championships, how far ahead you can advertise — not what a match can be.
export function shapesFor() {
  return PRESETS;
}

export function canBuildShapes() {
  return true;
}

export function stipulationsFor() {
  return MATCH_TYPES;
}

export function canUseStipulation() {
  return true;
}

export function canCustomiseShape() {
  return true;
}

// ── who may be put on a side together ───────────────────────────────────────

// The ladder relaxes as the branch is bought, which is the point: a new GM can
// only team people who already work together, and by the late game can put
// anybody with anybody and take what comes.
// The bottom rung has no upgrade on it. Booking a tag match is part of the
// job, so what the branch buys is not the match — it is permission to put
// two people together who would not naturally go. The ladder relaxes from a
// pair who already work as a unit all the way to anybody at all.
export const TEAM_GATES = [
  { id: 'forced-partnership', floor: 0, warmth: false,
    say: 'Anybody, regardless.' },
  { id: 'just-get-along', floor: 0, warmth: true,
    say: 'Any pair who feel warmly toward one another.' },
  { id: 'working-relationship', floor: 3, warmth: false,
    say: 'A pair with some history together.' },
  { id: null, floor: 6, warmth: false, tie: true,
    say: 'A pair who already work as a unit.' },
];

export function teamGate(state) {
  return TEAM_GATES.find(g => g.id === null || has(state, g.id)) || null;
}

export function teamGateSay(state) {
  const gate = teamGate(state);
  return gate ? gate.say : 'A pair who already work as a unit.';
}

// Whether a side of two or more may be put together. Returns null when it may,
// and the reason when it may not, so the caller can print it without knowing
// the ladder.
export function teamRefusal(state, wrestlers, sideIds) {
  const ids = sideIds.filter(Boolean);
  if (ids.length < 2) return null;
  const gate = teamGate(state);
  if (!gate) return 'You cannot put two people on the same side yet.';

  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = byId(wrestlers, ids[i]);
      const b = byId(wrestlers, ids[j]);
      if (!a || !b) continue;
      const rel = relationship(a, b.id);
      if (gate.tie && rel && rel.tie) continue;
      if (gate.warmth) {
        if (feelingToward(a, b.id) > 0 || feelingToward(b, a.id) > 0) continue;
        return `${a.name} and ${b.name} have no warmth between them. ${gate.say}`;
      }
      if (rapport(rel) >= gate.floor) continue;
      return `${a.name} and ${b.name} have not worked together enough. ${gate.say}`;
    }
  }
  return null;
}

// ── production ──────────────────────────────────────────────────────────────

export function showsStopwatch(state) {
  return has(state, 'stopwatch');
}

// Where the show finishes if everything left on the card runs as booked.
//
// The totals block already says how much of the window is gone; that is the
// network's arithmetic and everybody gets it. What a stopwatch at Gorilla
// actually tells you is whether the rest of the card is going to fit, which is
// the number you can still do something about.
export function projectedFinish(show, broadcast) {
  if (!broadcast) return null;
  const aired = new Set(broadcast.results.map(r => r.itemId));
  const toCome = (show.items || [])
    .filter(item => !aired.has(item.id))
    .reduce((n, item) => n + (item.plannedMinutes || 0), 0);
  const elapsed = broadcast.results.reduce((n, r) => n + r.actualMinutes, 0);
  return { toCome, finishAt: elapsed + toCome, over: elapsed + toCome - show.runtimeMinutes };
}

// ── corporate ───────────────────────────────────────────────────────────────

// The broadcast ladder. Trust makes a rung available; a point buys it. Head
// office offering you ninety minutes and you taking ninety minutes are two
// different decisions, and the second one competes with everything else on the
// board.
export const BROADCAST_RUNGS = [
  { id: 'three-hour-show', minutes: 180 },
  { id: '150-minute-broadcast', minutes: 150 },
  { id: '120-minute-broadcast', minutes: 120 },
  { id: 'expanded-broadcast-iii', minutes: 105 },
  { id: 'expanded-broadcast-ii', minutes: 90 },
  { id: 'expanded-broadcast-i', minutes: 75 },
];

export const BASE_MINUTES = 60;

export function broadcastMinutes(state) {
  const rung = BROADCAST_RUNGS.find(r => has(state, r.id));
  return rung ? rung.minutes : BASE_MINUTES;
}

// Championship slots beyond the three you start with, one per belt bought.
const BELT_UPGRADES = ['the-second-belt', 'the-third-belt', 'the-fourth-belt'];

export function beltSlots(state) {
  return BELT_UPGRADES.filter(id => has(state, id)).length;
}

export function nextBelt(state) {
  return BELT_UPGRADES.find(id => !has(state, id)) || null;
}

// ── reading people ──────────────────────────────────────────────────────────

export function readsMemories(state) {
  return has(state, 'know-your-locker-room');
}

export function readsGrudgeSource(state) {
  return has(state, 'read-the-grudge');
}

export function readsProportionality(state) {
  return has(state, 'read-the-room');
}

export function tracksWarnings(state) {
  return has(state, 'paper-trail');
}

// ── scouting ────────────────────────────────────────────────────────────────

// Scouting does not invent a second way of knowing people. It buys familiarity,
// which model/stats.js already turns into readings that sharpen over time —
// so a background check is a shortcut through the same door, not a new one.
export const BACKGROUND_CHECK_FAMILIARITY = 22;
export const DEEP_DIVE_FAMILIARITY = 80;

export function canBackgroundCheck(state) {
  return has(state, 'background-check');
}

export function checksLeft(state) {
  return canBackgroundCheck(state) && !(state.gmChecks || []).includes(state.week) ? 1 : 0;
}

// Tape study is the one that changes how a reading is produced rather than how
// much of it you have: you can watch somebody wrestle without ever meeting
// them, so ability reads sooner than it otherwise would.
export function studiesTape(state) {
  return has(state, 'tape-study');
}

export function readsInjuries(state) {
  return has(state, 'injury-history');
}
