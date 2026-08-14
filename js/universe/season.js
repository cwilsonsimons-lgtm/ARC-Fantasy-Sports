// WWE 2K Universe — the season, promotion and relegation.
//
// A season runs from one Last Stand to the next, because Last Stand is where
// the brand moves happen: the year's booking is settled there and everything
// resets the next day. Before the first Last Stand, the season starts at the
// universe's start date. Seasons are therefore derived from the log like
// everything else — no season entity to keep in step, and voiding a Last Stand
// merges the two seasons either side of it back into one.
//
// The shape of the year:
//
//   ... regular shows ...  WrestleMania  →  flags go up
//                          Last Stand    →  flagged names fight, brands change
//                          next season
//
// Standings are win totals inside the current season window, ordered by points,
// then win rate, then matches wrestled — so among a group who all sit on zero,
// the one who was barely booked sinks to the bottom rather than whoever happens
// to come last alphabetically.
//
// The lists read the pyramid (pyramid.js) rather than naming brands: every brand
// with a rung below it puts its bottom names on the relegation list, every brand
// with a rung above it puts its top names on the promotion list, and a brand in
// the middle of a three-tier pyramid does both. Lists are built per gender
// because the matches are. Champions are never relegated — holding a belt is the
// one thing that keeps you up.

import { tiers, tierOf, canBePromoted, canBeRelegated, destination } from './pyramid.js';

export const DEFAULTS = {
  relegatePerBrand: 1,      // per gender, per brand that has a tier below it
  promotePerBrand: 2,       // per gender, per brand that has a tier above it
};

// ------------------------------------------------------------------ windows

// Every season boundary in the log, oldest first.
export function seasons(state) {
  const stands = state.ples.filter(p => p.kind === 'lastStand').sort((a, b) => (a.date < b.date ? -1 : 1));
  const manias = state.ples.filter(p => p.kind === 'wrestlemania');
  const start = state.startDate || (state.events.length ? state.events[0].date : state.asOf);

  const bounds = [];
  let from = start;
  stands.forEach(s => { bounds.push({ from, to: s.date, closedBy: s }); from = nextDay(s.date); });
  bounds.push({ from, to: null, closedBy: null });          // the season in progress

  return bounds.map((b, i) => ({
    n: i + 1,
    from: b.from,
    to: b.to,
    current: !b.to,
    lastStand: b.closedBy || null,
    // The WrestleMania inside this window, if it has happened yet.
    wrestlemania: manias.find(m => m.date >= b.from && (!b.to || m.date <= b.to)) || null,
  }));
}

export const currentSeason = state => seasons(state).slice(-1)[0];
export const seasonAt = (state, date) => seasons(state).find(s => date >= s.from && (!s.to || date <= s.to)) || currentSeason(state);

const nextDay = iso => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

// ------------------------------------------------------------------ standings

// Win totals inside a window. The all-time record on a wrestler is cumulative;
// standings are the season's, so they are counted here rather than stored.
export function standingsFor(state, { from, to = null, brandId = null } = {}) {
  const tally = {};
  const bump = (ref, key) => {
    if (!state.wrestlers[ref]) return;
    const t = tally[ref] || (tally[ref] = { id: ref, name: state.wrestlers[ref].name, w: 0, l: 0, d: 0, matches: 0, titleMatches: 0 });
    t[key] += 1;
    t.matches += 1;
  };

  state.events.forEach(ev => {
    if (ev.type !== 'match') return;
    if (ev.date < from) return;
    if (to && ev.date > to) return;
    (ev.effects || []).forEach(fx => {
      if (fx.kind === 'record.win') bump(fx.subject, 'w');
      else if (fx.kind === 'record.loss') bump(fx.subject, 'l');
      else if (fx.kind === 'record.draw') bump(fx.subject, 'd');
      if (fx.titleId && tally[fx.subject]) tally[fx.subject].titleMatches += 1;
    });
  });

  return Object.values(tally)
    .map(t => ({
      ...t,
      brandId: state.wrestlers[t.id].brandId,
      gender: state.wrestlers[t.id].gender,
      points: t.w * 3 + t.d,
      winPct: t.matches ? t.w / t.matches : 0,
    }))
    .filter(t => (brandId ? t.brandId === brandId : true))
    .sort((a, b) => b.points - a.points || b.winPct - a.winPct || b.matches - a.matches || a.name.localeCompare(b.name));
}

// Standings per brand for the season in progress, including wrestlers who have
// not wrestled — sitting at zero is exactly what gets you relegated.
export function brandStandings(state, season = null) {
  const s = season || currentSeason(state);
  const rows = standingsFor(state, { from: s.from, to: s.to });
  const byId = new Map(rows.map(r => [r.id, r]));

  return Object.values(state.brands).map(b => ({
    ...b,
    season: s,
    table: b.roster.map(id => byId.get(id) || {
      id, name: state.wrestlers[id].name, w: 0, l: 0, d: 0, matches: 0, titleMatches: 0,
      brandId: b.id, gender: state.wrestlers[id].gender, points: 0, winPct: 0,
    }).sort((a, b2) => b2.points - a.points || b2.winPct - a.winPct || b2.matches - a.matches || a.name.localeCompare(b2.name)),
  }));
}

// ------------------------------------------------------------------ flags

const championSet = state => {
  const set = new Set();
  Object.values(state.championships).forEach(c => {
    c.holders.forEach(h => set.add(h));
    c.interimHolders.forEach(h => set.add(h));
  });
  return set;
};

// Who should go on each list. Returns proposals, not events — flagging is a
// booking decision, so it is shown first and written only when confirmed.
export function proposeFlags(state, opts = {}) {
  const { relegatePerBrand, promotePerBrand } = { ...DEFAULTS, ...opts };
  const season = opts.season || currentSeason(state);
  const champs = championSet(state);
  const standings = brandStandings(state, season);
  const genders = ['male', 'female'];

  // Selection is per brand, as the rule says: the bottom of each brand goes on
  // the relegation list, the top of each on the promotion list. Every brand with
  // a rung beneath it can relegate and every brand with a rung above it can
  // promote, so the middle of a three-tier pyramid does both. No brand is named
  // anywhere in here — it all comes from the pyramid.
  const groups = new Map();     // tier|gender|flag  ->  { picked, bench }
  const key = (tier, gender, flag) => `${tier}|${gender}|${flag}`;

  standings.forEach(b => {
    const tier = tierOf(state, b.id);
    [
      ['relegation-flagged', canBeRelegated(state, b.id), relegatePerBrand],
      ['promotion-flagged', canBePromoted(state, b.id), promotePerBrand],
    ].forEach(([flag, allowed, perBrand]) => {
      if (!allowed) return;
      const relegation = flag === 'relegation-flagged';

      genders.forEach(g => {
        // Worst-first for relegation, best-first for promotion. Champions are
        // never candidates for relegation — holding a belt is what keeps you up.
        const ordered = b.table
          .filter(r => r.gender === g && !(relegation && champs.has(r.id)));
        const queue = relegation ? ordered.slice().reverse() : ordered;

        const row = r => ({
          id: r.id, name: r.name, gender: g, flag,
          from: b.id, fromName: b.name, tier,
          toward: destination(state, b.id, relegation ? 'relegation' : 'promotion'),
          points: r.points, record: `${r.w}-${r.l}-${r.d}`,
          why: relegation
            ? `bottom of ${b.name}${r.matches ? '' : ' (no matches all season)'}`
            : `top of ${b.name}`,
        });

        const k = key(tier, g, flag);
        if (!groups.has(k)) groups.set(k, { picked: [], bench: [], brands: new Set() });
        const grp = groups.get(k);
        grp.brands.add(b.id);
        queue.slice(0, perBrand).forEach(r => grp.picked.push(row(r)));
        queue.slice(perBrand).forEach(r => grp.bench.push(row(r)));
      });
    });
  });

  // Balancing. These names exist to face each other at Last Stand, so an odd
  // list leaves somebody with no opponent — and pairing them across a tier or a
  // gender would change what the match is for. So an odd list is evened out:
  // where a tier has several brands, the safest name is spared; where a tier has
  // only one brand there is nobody to spare against, so the next name down is
  // called up instead. Without this a three-brand tier flags three per gender
  // and one of them always has nobody to fight.
  const out = [];
  groups.forEach(grp => {
    const picked = grp.picked.slice();
    if (picked.length % 2 === 1) {
      if (grp.brands.size > 1) {
        // Spare the one with the weakest claim to being there.
        const relegation = picked[0].flag === 'relegation-flagged';
        picked.sort((a, b) => (relegation ? a.points - b.points : b.points - a.points));
        picked.pop();
      } else if (grp.bench.length) {
        picked.push(grp.bench[0]);
      } else {
        picked.pop();                      // nobody left to call up
      }
    }
    out.push(...picked);
  });

  // Anyone already carrying the flag they would be given needs no event.
  return out.map(p => ({ ...p, alreadyFlagged: state.wrestlers[p.id].status === p.flag }));
}

// Turn accepted proposals into events.
export function commitFlags(store, proposals, { date, dryRun = false } = {}) {
  const events = proposals.filter(p => !p.alreadyFlagged).map(p => ({
    type: 'status.change', date, source: 'season',
    participants: [{ ref: p.id, role: 'subject' }],
    data: { status: p.flag, reason: p.why },
    note: `${p.flag === 'relegation-flagged' ? 'relegation' : 'promotion'} list`,
  }));
  if (dryRun || !events.length) return { events, written: 0 };
  const written = store.appendBatch(events);
  store.save();
  return { events: written, written: written.length };
}

// ------------------------------------------------------------------ Last Stand

// Pair the flagged names off. Relegation faces relegation, promotion faces
// promotion, and never across genders — so the pairings are built per gender
// out of each list separately.
export function proposeLastStand(state, opts = {}) {
  const matches = [], unpaired = [];

  // Flagged names only face others going the same way, from the same rung of
  // the pyramid, and of the same gender. Pairing a Raw name against an NXT name
  // in a relegation match would be two different stakes in one match.
  tiers(state).forEach(({ tier }) => {
    ['relegation-flagged', 'promotion-flagged'].forEach(flag => {
      const stakes = flag === 'relegation-flagged' ? 'relegation' : 'promotion';
      ['male', 'female'].forEach(gender => {
        const pool = Object.values(state.wrestlers).filter(w =>
          w.status === flag && w.gender === gender && tierOf(state, w.brandId) === tier);

        for (let i = 0; i + 1 < pool.length; i += 2) {
          matches.push({
            stakes, gender, tier,
            a: pool[i], b: pool[i + 1],
            toBrandId: destination(state, pool[i].brandId, stakes),
          });
        }
        // An odd one out is reported rather than quietly dropped or paired
        // across a boundary that would change what the match means.
        if (pool.length % 2 === 1) unpaired.push(pool[pool.length - 1]);
      });
    });
  });

  return { matches, unpaired, date: opts.date || null };
}

// Where the moved wrestler lands — one rung up or down from wherever they
// currently are, resolved by the pyramid. card.js calls this at write time so
// the answer is stored on the event rather than recomputed later.
export function destinationFor(state, stakes, wrestlers = []) {
  const from = wrestlers.map(w => w.brandId).find(Boolean);
  if (!from) return null;
  return destination(state, from, stakes);
}

// The proposal as card shorthand, ready to paste into the entry box — the point
// being that nothing here writes events behind your back. You still book it.
export function lastStandCard(state, proposal, { name = 'Last Stand', date, brandId = null } = {}) {
  const lines = [
    `${name} / ${date || proposal.date || state.asOf}${brandId && state.brands[brandId] ? ` / ${state.brands[brandId].name}` : ''}`,
    '// replace "vs" with "d." once you have played each one — winner on the left',
  ];
  proposal.matches.forEach(m => {
    const to = state.brands[m.toBrandId] ? state.brands[m.toBrandId].name : '?';
    lines.push(`${m.a.name} vs ${m.b.name} — ${m.stakes} to ${to}`);
  });
  return lines.join('\n');
}

export { championSet };
