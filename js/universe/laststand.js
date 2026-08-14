// WWE 2K Universe — the Last Stand dashboard.
//
// Everything the offseason needs in one place: who is up for promotion, who is
// up for relegation, who went up automatically, what has been booked, what has
// been settled, and every roster movement it produced.
//
// The rules this file exists to enforce, because they are easy to break by hand
// and expensive to notice later:
//
//   RELEGATION is settled inside one show. A Raw name up for relegation may
//   only face another Raw name who is also up for relegation. Never Raw vs
//   SmackDown, never Raw vs NXT, never against somebody who is not a candidate.
//
//   PROMOTION is settled between wrestlers competing for the same destination.
//   Two Evolve names fight for the NXT spot; two NXT names fight for the main
//   roster spot. A promotion candidate is never paired with anybody who is not
//   also chasing that same spot.
//
// The pickers are built from `eligibleOpponents`, so an illegal pairing cannot
// be selected in the first place; `checkPairing` is the same rule stated as a
// guard, for anything that arrives another way.
//
// Nothing here names a brand or a tier. The groups come out of the pyramid, so
// the identical code settles Raw↔NXT and Evolve↔Deep South.

import { tiers, tierOf, destination, canBePromoted, autoPromotions } from './pyramid.js';
import { currentSeason, proposeLastStand } from './season.js';

const isFlagged = w => /flagged$/.test(w.status);
const dirOf = w => (w.status === 'relegation-flagged' ? 'relegation' : 'promotion');

// ------------------------------------------------------------------ auto promotion

const autoIds = state => new Set(autoPromotions(state).map(a => a.id));

// ------------------------------------------------------------------ candidates

// Everyone carrying a flag, split the way the competitions are: relegation by
// brand, promotion by the spot being chased.
export function candidates(state) {
  const auto = autoIds(state);
  const relegation = [];
  const promotion = [];

  Object.values(state.wrestlers).forEach(w => {
    if (!isFlagged(w) || !w.brandId) return;
    const direction = dirOf(w);
    const to = destination(state, w.brandId, direction);
    const row = {
      id: w.id, name: w.name, gender: w.gender, direction,
      brandId: w.brandId, brandName: state.brands[w.brandId] ? state.brands[w.brandId].name : w.brandId,
      tier: tierOf(state, w.brandId),
      to, toName: state.brands[to] ? state.brands[to].name : null,
      // A champion who is already going up does not also have to fight for it.
      automatic: auto.has(w.id),
    };
    (direction === 'relegation' ? relegation : promotion).push(row);
  });

  const sort = rows => rows.sort((a, b) => a.tier - b.tier || a.brandName.localeCompare(b.brandName)
    || a.gender.localeCompare(b.gender) || a.name.localeCompare(b.name));
  return { relegation: sort(relegation), promotion: sort(promotion) };
}

// The competition a wrestler belongs to. Relegation is keyed by their brand,
// because the brand's spot is what is at stake; promotion by the destination,
// because the spot up there is.
export function groupKeyFor(state, w) {
  const direction = dirOf(w);
  return direction === 'relegation'
    ? `relegation|${w.brandId}|${w.gender}`
    : `promotion|${destination(state, w.brandId, 'promotion')}|${w.gender}`;
}

// Who this wrestler is allowed to face. This is what the second picker is built
// from, so an illegal pairing is never offered.
export function eligibleOpponents(state, id, { intergender = false } = {}) {
  const w = state.wrestlers[id];
  if (!w || !isFlagged(w) || !w.brandId) return [];
  const key = groupKeyFor(state, w);
  return Object.values(state.wrestlers)
    .filter(x => x.id !== id && isFlagged(x) && x.brandId
      && groupKeyFor(state, x) === key
      && (intergender || x.gender === w.gender))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The same rule as a guard. Errors block; the gender note is a warning, because
// an intergender Last Stand match is a strange booking rather than a broken one.
export function checkPairing(state, aId, bId) {
  const errors = [], warnings = [];
  const a = state.wrestlers[aId], b = state.wrestlers[bId];

  if (!a || !b) return { errors: ['pick two wrestlers'], warnings };
  if (aId === bId) return { errors: ['a wrestler cannot face themselves'], warnings };

  [a, b].forEach(w => {
    if (!isFlagged(w)) errors.push(`${w.name} is not up for promotion or relegation`);
  });
  if (errors.length) return { errors, warnings };

  if (dirOf(a) !== dirOf(b)) {
    errors.push(`${a.name} is up for ${dirOf(a)} and ${b.name} is up for ${dirOf(b)} — those are separate competitions`);
    return { errors, warnings };
  }

  const direction = dirOf(a);
  if (direction === 'relegation' && a.brandId !== b.brandId) {
    errors.push(`relegation is settled inside one show — ${a.name} is on ${nameOfBrand(state, a.brandId)}`
      + ` and ${b.name} is on ${nameOfBrand(state, b.brandId)}`);
  }
  if (direction === 'promotion') {
    const da = destination(state, a.brandId, 'promotion');
    const db = destination(state, b.brandId, 'promotion');
    if (da !== db) {
      errors.push(`${a.name} is fighting for a ${nameOfBrand(state, da)} spot and ${b.name} for a `
        + `${nameOfBrand(state, db)} spot — they are not competing for the same thing`);
    }
  }
  if (a.gender !== b.gender) warnings.push('this is an intergender match');

  return { errors, warnings, direction };
}

const nameOfBrand = (state, id) => (state.brands[id] ? state.brands[id].name : id || 'nowhere');

// ------------------------------------------------------------------ recording

// Does this match settle the competition, or is it a qualifier? It decides when
// the survivors it leaves are down to the number of spots — which for the
// default of one spot means "these two are the last ones standing".
export function pairingStakes(state, aId, bId, { spots = 1 } = {}) {
  const w = state.wrestlers[aId];
  if (!w) return { stakes: null, qualifier: null };
  const direction = dirOf(w);
  const standing = standingIn(state, aId);
  const decides = Math.ceil(standing.length / 2) <= spots;
  return decides
    ? { stakes: direction, qualifier: null, to: destination(state, w.brandId, direction) }
    : { stakes: null, qualifier: direction, to: destination(state, w.brandId, direction) };
}

// Who is still in this competition — the candidates minus anyone already
// knocked out by a Last Stand match this year.
export function standingIn(state, id) {
  const w = state.wrestlers[id];
  if (!w) return [];
  const proposal = proposeLastStand(state);
  const direction = dirOf(w);
  const group = proposal.groups.find(g => g.direction === direction
    && g.gender === w.gender
    && (direction === 'relegation' ? g.brandId === w.brandId : g.toBrandId === destination(state, w.brandId, 'promotion'))
    && g.standing.some(x => x.id === id));
  return group ? group.standing : [w];
}

// Record a Last Stand match: two candidates and a winner, straight into the
// log. The roster movement is the ordinary consequence of the event's effects,
// so it lands in the wrestler's history exactly like any other transfer and can
// be voided the same way.
export function recordMatch(store, state, { aId, bId, winnerId, date, showName = 'Last Stand', spots = 1 }) {
  const check = checkPairing(state, aId, bId);
  if (check.errors.length) { const e = new Error(check.errors[0]); e.errors = check.errors; throw e; }
  if (winnerId !== aId && winnerId !== bId) {
    const e = new Error('the winner has to be one of the two');
    e.errors = [e.message]; throw e;
  }

  const when = date || state.asOf;
  const { stakes, qualifier, to } = pairingStakes(state, aId, bId, { spots });
  const loserId = winnerId === aId ? bId : aId;

  // Reuse this year's Last Stand show if one is already open, so a night's
  // worth of matches sits on one card rather than scattering across shows.
  const season = currentSeason(state);
  const existing = state.shows.find(sh => sh.ple === 'lastStand' && sh.date >= season.from);
  const batch = [];
  let showId = existing ? existing.id : null;

  let seq = store.doc.meta.seq;
  const nextId = type => `${type === 'show' ? 'sh' : 'ev'}_${String(seq += 1).padStart(4, '0')}`;

  if (!showId) {
    showId = nextId('show');
    batch.push({
      id: showId, type: 'show', date: when, source: 'last-stand',
      participants: [], data: { name: showName, brandId: null, ple: 'lastStand' },
      note: 'opened from the Last Stand dashboard',
    });
  }

  const data = { matchType: 'singles' };
  if (stakes) { data.stakes = stakes; data.toBrandId = to; }
  if (qualifier) data.qualifier = qualifier;

  batch.push({
    id: nextId('match'), type: 'match', date: when, showId, source: 'last-stand',
    participants: [
      { ref: winnerId, role: 'winner', side: 1 },
      { ref: loserId, role: 'loser', side: 2 },
    ],
    data,
    note: stakes
      ? `${stakes} decider — ${stakes === 'relegation' ? 'loser drops' : 'winner goes up'} to ${nameOfBrand(state, to)}`
      : `${qualifier} qualifier`,
  });

  const written = store.appendBatch(batch);
  store.save();
  return { events: written, showId, stakes, qualifier, winnerId, loserId, to, warnings: check.warnings };
}

// ------------------------------------------------------------------ the board

// Everything the dashboard draws, in one call.
export function lastStandBoard(state, opts = {}) {
  const season = opts.season || currentSeason(state);
  const proposal = proposeLastStand(state, opts);
  const cand = candidates(state);
  const auto = autoPromotions(state);

  // Matches already wrestled this year on a Last Stand card.
  const played = state.events
    .filter(e => e.type === 'match' && e.date >= season.from
      && state.showsById[e.showId] && state.showsById[e.showId].ple === 'lastStand')
    .map(e => {
      const winner = e.participants.find(p => p.role === 'winner');
      const loser = e.participants.find(p => p.role === 'loser');
      const nm = ref => (state.wrestlers[ref] ? state.wrestlers[ref].name : ref);
      return {
        id: e.id, date: e.date,
        winner: winner ? nm(winner.ref) : null, winnerId: winner && winner.ref,
        loser: loser ? nm(loser.ref) : null, loserId: loser && loser.ref,
        stakes: e.data.stakes || null,
        qualifier: e.data.qualifier || null,
        toBrandId: e.data.toBrandId || null,
        toName: e.data.toBrandId ? nameOfBrand(state, e.data.toBrandId) : null,
      };
    });

  // The movements those matches produced, read back off the effects so what is
  // shown is what was actually written.
  const movements = state.events
    .filter(e => e.date >= season.from)
    .flatMap(e => (e.effects || [])
      .filter(fx => fx.kind === 'roster.brand' && ['promotion', 'relegation', 'draft'].includes(fx.reason))
      .map(fx => ({
        eventId: e.id, date: e.date, reason: fx.reason,
        id: fx.subject, name: state.wrestlers[fx.subject] ? state.wrestlers[fx.subject].name : fx.subject,
        to: fx.brandId, toName: nameOfBrand(state, fx.brandId),
      })));

  return {
    season, phase: season.phase, proposal, auto, movements, played,
    candidates: cand,
    tiers: tiers(state).map(t => ({
      ...t,
      brands: t.brands.map(b => ({
        ...b,
        roster: (state.brands[b.id].roster || []).map(id => state.wrestlers[id]),
      })),
    })),
    open: proposal.groups.filter(g => !g.resolved),
    settled: proposal.groups.filter(g => g.resolved),
  };
}

export { isFlagged, dirOf, nameOfBrand, autoPromotions };
