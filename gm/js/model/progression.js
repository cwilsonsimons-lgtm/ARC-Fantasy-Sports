// What the GM has become, as distinct from what the GM has done.
//
// `state.gmRecord` is a record of every call and how the room read it. This is
// the other half: the level, the points, and the list of things bought with
// them. They are kept apart deliberately — authorityValue() reads the record
// and must never have to know the tree exists.
//
// XP pays for running the building, not for producing good television. The
// executive's grade is in here, capped hard, because the moment grade dominates
// XP the optimal play becomes "book the two best workers every week and ignore
// everybody else", which is the game this one is specifically not.
//
// Nothing here mutates anything outside `state.gm` except awardXp, which is
// called once, from endShow.
import {
  UPGRADES, upgrade, trustNeeded, standingNeeded,
} from '../data/upgrades.js';

export const MAX_LEVEL = 30;
export const STARTING_POINTS = 3;
export const POINTS_PER_LEVEL = 2;
export const MILESTONE_LEVELS = [5, 10, 15, 20, 25, 30];
export const MILESTONE_POINTS = 3;
export const CAPSTONE_SLOTS = 4;

// The grade is worth something and is not worth much. Fifteen percent of a
// strong week, which is roughly what one good match ought to be worth next to
// a night where nobody walked out.
const GRADE_XP = { A: 30, B: 15, C: 5, D: 0 };
const RULING_XP = { fair: 18, harsh: 12, weak: 6, gaveIn: 4 };
const WITNESSED_BONUS = 6;

export function createProgression() {
  return { level: 1, xp: 0, points: STARTING_POINTS, spent: [], doctrines: [], log: null };
}

export function progression(state) {
  if (!state.gm) state.gm = createProgression();
  return state.gm;
}

// ── levels ──────────────────────────────────────────────────────────────────

export function xpToNext(level) {
  return level >= MAX_LEVEL ? Infinity : 120 + 45 * (level - 1);
}

export function levelProgress(state) {
  const gm = progression(state);
  const need = xpToNext(gm.level);
  return {
    level: gm.level,
    xp: gm.xp,
    need: need === Infinity ? 0 : need,
    share: need === Infinity ? 1 : Math.min(1, gm.xp / need),
    capped: gm.level >= MAX_LEVEL,
  };
}

function pointsFor(level) {
  return POINTS_PER_LEVEL + (MILESTONE_LEVELS.includes(level) ? MILESTONE_POINTS : 0);
}

// Everything a GM would have been handed on the way to a level. Used by the
// migration, which has to invent a plausible history for a save that predates
// the tree.
export function pointsEarnedBy(level) {
  let total = STARTING_POINTS;
  for (let n = 2; n <= level; n += 1) total += pointsFor(n);
  return total;
}

// ── what a week was worth ───────────────────────────────────────────────────

// Read off the journal rather than counted up as things happen. One source of
// truth, and it survives a migration: a save that arrives without an XP tally
// can have its last night re-read instead of guessed at.
export function xpForShow(state, review) {
  const night = state.journal || [];
  const lines = [];
  const add = (label, xp) => { if (xp > 0) lines.push({ label, xp }); };

  let rulings = 0;
  let witnessed = 0;
  for (const entry of night) {
    if (entry.type !== 'ruling') continue;
    const read = entry.data && entry.data.read;
    rulings += RULING_XP[read] !== undefined ? RULING_XP[read] : 0;
    // Late is the tell for a ruling made on something reported rather than
    // seen. Being in the room is the most repeatable XP in the game and it is
    // paid for standing in the right place, which is the whole backstage layer.
    if (!(entry.data && entry.data.late)) witnessed += WITNESSED_BONUS;
  }
  add('Rulings made', rulings);
  add('Seen it happen yourself', witnessed);

  add('Ties formed under your watch', night.filter(e => e.type === 'tie-formed').length * 15);
  add('Championship changed hands', night.filter(e => e.type === 'title-change').length * 20);

  if (review) {
    if (review.timing === 'on-time') add('Show ran on time', 20);
    if (review.timing !== 'light') add('Window filled', 15);
    if (review.rosterUse === 'broad') add('Used the roster', 20);
    if (!review.breaches) add('Nothing advertised went unhonoured', 15);
    add('Network grade — ' + review.grade, GRADE_XP[review.grade] || 0);
  }

  // Everybody in the building laid eyes on you. Rare, and the clearest single
  // statement that the GM was actually at work.
  const inBuilding = Object.keys(state.whereabouts || {}).length;
  const seen = (state.sawYou || []).length;
  if (inBuilding && seen >= inBuilding) add('Every one of them saw you', 25);

  return { total: lines.reduce((n, l) => n + l.xp, 0), lines };
}

// XP never goes negative. Failure already costs trust, authority and morale;
// taking XP as well punishes one mistake three times and teaches the player to
// stop experimenting.
export function awardXp(state, amount, lines = []) {
  const gm = progression(state);
  const gained = Math.max(0, Math.round(amount));
  gm.xp += gained;

  const levels = [];
  let points = 0;
  while (gm.level < MAX_LEVEL && gm.xp >= xpToNext(gm.level)) {
    gm.xp -= xpToNext(gm.level);
    gm.level += 1;
    const award = pointsFor(gm.level);
    gm.points += award;
    points += award;
    levels.push({ level: gm.level, points: award });
  }
  if (gm.level >= MAX_LEVEL) gm.xp = 0;

  gm.log = { gained, lines, levels, points };
  return gm.log;
}

// ── owning things ───────────────────────────────────────────────────────────

export function has(state, id) {
  return progression(state).spent.includes(id);
}

export function owned(state) {
  return progression(state).spent.map(id => upgrade(id)).filter(Boolean);
}

export function capstonesHeld(state) {
  return owned(state).filter(u => u.tier === 'Capstones').length;
}

export function pointsSpent(state) {
  return owned(state).reduce((n, u) => n + u.cost, 0);
}

// Gone for good: excluded by something already bought, or shut by a doctrine.
// Kept separate from "locked" because the board draws them differently and the
// player is owed the difference between not yet and never.
export function cutReason(state, id) {
  const u = upgrade(id);
  if (!u || has(state, id)) return null;
  const gm = progression(state);

  for (const other of owned(state)) {
    if ((other.excludes || []).includes(id)) return 'Excluded by ' + other.name + '.';
    if ((u.excludes || []).includes(other.id)) return 'Excluded by ' + other.name + '.';
  }
  if (u.doctrine && gm.doctrines.length >= 2 && !gm.doctrines.includes(u.doctrine)) {
    return 'Doctrine: ' + u.doctrine + ' was never taken.';
  }
  if (u.shutBy && gm.doctrines.includes(u.shutBy)) {
    return 'Shut by Doctrine: ' + u.shutBy + '.';
  }
  return null;
}

// Everything standing between the GM and this upgrade, as pairs the UI can
// print without knowing the rules. An empty list means it can be bought now.
export function blockers(state, id, context = {}) {
  const u = upgrade(id);
  if (!u) return [['Unknown upgrade', id]];
  const gm = progression(state);
  const out = [];

  if (!u.built) out.push(['Not built yet', 'on the board, not in the game']);
  if (u.level > gm.level) out.push(['GM Level ' + u.level, 'you are ' + gm.level]);

  const trust = context.trust !== undefined ? context.trust : (state.network ? state.network.trust : 0);
  if (u.trust && trustNeeded(u.trust) > trust) {
    out.push(['Trust: ' + u.trust, 'you are at ' + trust]);
  }
  if (u.standing && context.standing !== undefined && standingNeeded(u.standing) > context.standing) {
    out.push(['Standing: ' + u.standing, 'not yet']);
  }
  for (const req of u.requires || []) {
    if (!has(state, req)) {
      const r = upgrade(req);
      out.push([r ? r.name : req, r ? r.cost + ' pts, unowned' : 'unowned']);
    }
  }
  if (u.tier === 'Capstones' && capstonesHeld(state) >= CAPSTONE_SLOTS) {
    out.push(['A capstone slot', 'all ' + CAPSTONE_SLOTS + ' are spent']);
  }
  if (u.cost > gm.points) out.push([u.cost + ' points', 'you have ' + gm.points]);
  return out;
}

export function canBuy(state, id, context) {
  // Owning it is the first reason not to sell it again. blockers() answers
  // "what stands in the way", and for something already bought the answer is
  // nothing, which is true and is not permission.
  if (has(state, id)) return false;
  return !cutReason(state, id) && blockers(state, id, context).length === 0;
}

// The only place points leave the pool.
export function buy(state, id, context) {
  if (!canBuy(state, id, context)) return false;
  const gm = progression(state);
  gm.points -= upgrade(id).cost;
  gm.spent.push(id);
  return true;
}

// ── the board's read on one node ────────────────────────────────────────────

export function statusOf(state, id, context) {
  if (has(state, id)) return 'owned';
  if (cutReason(state, id)) return 'cut';
  return blockers(state, id, context).length ? 'locked' : 'open';
}

// Every prerequisite of an upgrade, however deep, for tracing a path on the
// board. Cycles cannot happen in the catalogue but the guard is cheap.
export function chainFor(id, seen = new Set()) {
  if (seen.has(id)) return seen;
  seen.add(id);
  const u = upgrade(id);
  for (const req of (u && u.requires) || []) chainFor(req, seen);
  return seen;
}

// What the whole run costs from here, which is the number the player actually
// plans against.
export function runCost(state, id) {
  return [...chainFor(id)]
    .filter(x => !has(state, x))
    .reduce((n, x) => n + (upgrade(x) ? upgrade(x).cost : 0), 0);
}

export function branchProgress(state, branchId) {
  const all = UPGRADES.filter(u => u.branch === branchId);
  const mine = all.filter(u => has(state, u.id));
  return {
    owned: mine.length,
    total: all.length,
    points: mine.reduce((n, u) => n + u.cost, 0),
    cost: all.reduce((n, u) => n + u.cost, 0),
    built: all.filter(u => u.built).length,
  };
}
