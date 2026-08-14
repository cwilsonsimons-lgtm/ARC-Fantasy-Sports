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
  // Per brand, per gender, per direction. Two candidates and one spot is the
  // brief's own example: two Evolve names face each other, the winner goes up.
  // Raise candidates to four and the group becomes a bracket — semi-finals and
  // a final — with nothing else changing.
  candidatesPerBrand: 2,
  spots: 1,
};

// ------------------------------------------------------------------ windows

// The year, in order:
//
//     regular season ... WrestleMania → Last Stand → Draft → new season
//
// WrestleMania ends the wrestling season and starts the offseason; Last Stand
// settles who moves between tiers; the Draft reshuffles what is left; and the
// season closes when the Draft does, so the next one opens with the rosters the
// draft produced.
//
// A save that never runs a draft is not left stuck in one endless year: a
// Last Stand followed by another WrestleMania closes the season too. Everything
// is derived from the PLE markers on shows, so a season's whole shape — and
// every past season's — comes out of the log with nothing stored.
export const PHASES = ['regular', 'wrestlemania', 'lastStand', 'draft', 'newSeason'];

export const PHASE_LABEL = {
  regular: 'Regular season',
  wrestlemania: 'WrestleMania',
  lastStand: 'Last Stand',
  draft: 'Draft',
  newSeason: 'New season',
  complete: 'Complete',
};

// Every season boundary in the log, oldest first.
export function seasons(state) {
  const ples = state.ples.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const start = state.startDate || (state.events.length ? state.events[0].date : state.asOf);

  const out = [];
  let open = { from: start, wrestlemania: null, lastStand: null, draft: null };

  const close = (to, closedBy) => {
    out.push({ ...open, to, closedBy });
    open = { from: nextDay(to), wrestlemania: null, lastStand: null, draft: null };
  };

  ples.forEach(p => {
    if (p.kind === 'wrestlemania') {
      // A second WrestleMania with no draft in between still means a new year.
      if (open.wrestlemania && open.lastStand) close(open.lastStand.date, 'lastStand');
      open.wrestlemania = open.wrestlemania || p;
    } else if (p.kind === 'lastStand') {
      open.lastStand = open.lastStand || p;
    } else if (p.kind === 'draft') {
      open.draft = p;
      close(p.date, 'draft');
    }
  });
  out.push({ ...open, to: null, closedBy: null });

  return out.map((b, i, all) => {
    const season = { ...b, n: i + 1, current: !b.to };
    season.phase = phaseFor(state, season, all[i - 1]);
    season.phaseLabel = PHASE_LABEL[season.phase];
    return season;
  });
}

// Which part of the year this season is in. A finished season is 'complete';
// the one in progress walks regular → wrestlemania → lastStand → draft, and
// sits in 'newSeason' until the first show of the year is booked.
function phaseFor(state, season, previous) {
  if (season.to) return 'complete';
  if (!season.wrestlemania) {
    const bookedSince = state.shows.some(sh => sh.date >= season.from);
    // Straight out of a draft with nothing booked yet: the new year has not
    // actually started, it has only been set up.
    if (previous && previous.closedBy === 'draft' && !bookedSince) return 'newSeason';
    return 'regular';
  }
  if (!season.lastStand) {
    const flagged = Object.values(state.wrestlers).some(w => /flagged$/.test(w.status));
    return flagged ? 'lastStand' : 'wrestlemania';
  }
  return 'draft';
}

// What the app is waiting for next, in words — the Season tab reads this out.
export function nextStep(state, season = null) {
  const s = season || currentSeason(state);
  return {
    regular: { do: 'Book the season', then: 'WrestleMania ends it' },
    wrestlemania: { do: 'Work out the promotion and relegation lists', then: 'Last Stand settles them' },
    lastStand: { do: 'Book Last Stand', then: 'the Draft follows' },
    draft: { do: 'Run the Draft, tier by tier', then: 'the new season begins' },
    newSeason: { do: 'Book the first show of the year', then: 'the regular season is under way' },
    complete: { do: 'Nothing — this year is done', then: '' },
  }[s.phase];
}

export const currentSeason = state => seasons(state).slice(-1)[0];
export const seasonAt = (state, date) => seasons(state).find(s => date >= s.from && (!s.to || date <= s.to)) || currentSeason(state);
export const phaseOf = state => currentSeason(state).phase;

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
  const { candidatesPerBrand } = { ...DEFAULTS, ...opts };
  const season = opts.season || currentSeason(state);
  const champs = championSet(state);
  const standings = brandStandings(state, season);
  const genders = ['male', 'female'];
  const out = [];
  const skipped = [];

  // Every brand with a rung beneath it can relegate, every brand with a rung
  // above it can promote, and on a three-tier pyramid the middle does both. The
  // groups are per brand and are never merged: a Raw name fighting relegation
  // faces another Raw name, because what is at stake is the Raw spot. No brand
  // is named anywhere in here — it all comes off the pyramid.
  standings.forEach(b => {
    const tier = tierOf(state, b.id);
    [
      ['relegation-flagged', canBeRelegated(state, b.id)],
      ['promotion-flagged', canBePromoted(state, b.id)],
    ].forEach(([flag, allowed]) => {
      if (!allowed) return;
      const relegation = flag === 'relegation-flagged';

      genders.forEach(g => {
        // Worst-first for relegation, best-first for promotion. A champion is
        // never a relegation candidate — holding a belt is what keeps you up.
        const ordered = b.table.filter(r => r.gender === g && !(relegation && champs.has(r.id)));
        const queue = relegation ? ordered.slice().reverse() : ordered;
        const picked = queue.slice(0, candidatesPerBrand);

        // One name alone has nobody to face, and flagging them would leave a
        // marker that nothing can ever clear. Say so instead.
        if (picked.length < 2) {
          if (picked.length) skipped.push({
            brandId: b.id, brandName: b.name, gender: g, flag, tier,
            why: `only ${picked.length} eligible on ${b.name}`,
          });
          return;
        }

        picked.forEach(r => out.push({
          id: r.id, name: r.name, gender: g, flag,
          from: b.id, fromName: b.name, tier,
          toward: destination(state, b.id, relegation ? 'relegation' : 'promotion'),
          points: r.points, record: `${r.w}-${r.l}-${r.d}`,
          why: relegation
            ? `bottom of ${b.name}${r.matches ? '' : ' (no matches all season)'}`
            : `top of ${b.name}`,
        }));
      });
    });
  });

  const proposals = out.map(p => ({ ...p, alreadyFlagged: state.wrestlers[p.id].status === p.flag }));
  proposals.skipped = skipped;
  return proposals;
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
  const { spots } = { ...DEFAULTS, ...opts };
  const season = opts.season || currentSeason(state);
  const groups = [];

  // Who is flagged, grouped by brand + gender + direction. Those three together
  // are the competition: a Raw relegation group settles the Raw spot, and its
  // members never meet a SmackDown name or a promotion candidate.
  const byGroup = new Map();
  Object.values(state.wrestlers).forEach(w => {
    if (!/flagged$/.test(w.status) || !w.brandId) return;
    const key = `${w.brandId}|${w.gender}|${w.status}`;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(w);
  });

  // Rounds already wrestled this year, so a bracket is picked up where it was
  // left rather than re-booked from the top.
  const played = state.events.filter(e =>
    e.type === 'match' && e.date >= season.from
    && state.showsById[e.showId] && state.showsById[e.showId].ple === 'lastStand');

  byGroup.forEach((candidates, key) => {
    const [brandId, gender, flag] = key.split('|');
    const direction = flag === 'relegation-flagged' ? 'relegation' : 'promotion';
    const toBrandId = destination(state, brandId, direction);

    // Walk the rounds already played. For promotion the losers drop out of the
    // running; for relegation the winners are safe and drop out, and whoever is
    // left is still in danger.
    let standing = candidates.slice();
    let roundsPlayed = 0;
    played.forEach(ev => {
      const involved = ev.participants.filter(p => standing.some(w => w.id === p.ref));
      if (involved.length < 2) return;
      const gone = ev.participants
        .filter(p => p.role === (direction === 'promotion' ? 'loser' : 'winner'))
        .map(p => p.ref);
      const before = standing.length;
      standing = standing.filter(w => !gone.includes(w.id));
      if (standing.length !== before) roundsPlayed += 1;
    });

    const group = {
      brandId, brandName: state.brands[brandId] ? state.brands[brandId].name : brandId,
      tier: tierOf(state, brandId), gender, direction, flag, spots, toBrandId,
      toBrandName: state.brands[toBrandId] ? state.brands[toBrandId].name : null,
      candidates, standing, matches: [], resolved: false, bye: null, decides: false,
      round: roundsPlayed + 1,
    };

    if (standing.length <= spots) {
      group.resolved = true;              // nobody left to beat: it has settled
      group.outcome = standing;
      groups.push(group);
      return;
    }

    // Pair the survivors. An odd one out takes a bye into the next round rather
    // than being dropped, or matched outside their own group.
    const pool = standing.slice();
    if (pool.length % 2 === 1) group.bye = pool.pop();

    // This round decides it when the survivors it leaves are exactly the number
    // of spots. Otherwise it is a qualifier and moves nobody — which is why a
    // semi-final does not relegate anybody.
    group.decides = Math.ceil(standing.length / 2) <= spots;

    for (let i = 0; i + 1 < pool.length; i += 2) {
      group.matches.push({
        a: pool[i], b: pool[i + 1],
        direction, gender, tier: group.tier, brandId, brandName: group.brandName,
        stakes: group.decides ? direction : null,
        toBrandId, toBrandName: group.toBrandName,
        round: group.round,
      });
    }
    groups.push(group);
  });

  groups.sort((a, b) => a.tier - b.tier || a.brandName.localeCompare(b.brandName)
    || a.direction.localeCompare(b.direction) || a.gender.localeCompare(b.gender));

  return {
    groups,
    matches: groups.flatMap(g => g.matches),
    resolved: groups.filter(g => g.resolved),
    byes: groups.filter(g => g.bye).map(g => ({ ...g.bye, brandName: g.brandName, direction: g.direction })),
    unpaired: [],
    date: opts.date || null,
  };
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

  proposal.groups.forEach(g => {
    if (!g.matches.length) return;
    lines.push(`// ${g.brandName} ${g.direction} (${g.gender}) — ${g.decides
      ? g.direction === 'relegation'
        ? `decides it: the loser drops to ${g.toBrandName}`
        : `decides it: the winner goes up to ${g.toBrandName}`
      : `round ${g.round}, nobody moves yet`}`);
    g.matches.forEach(m => lines.push(
      `${m.a.name} vs ${m.b.name} — ${m.stakes ? `${m.direction} to ${m.toBrandName}` : `${m.direction} qualifier`}`));
    if (g.bye) lines.push(`// ${g.bye.name} has a bye into the next round`);
  });

  return lines.join('\n');
}

export { championSet };
