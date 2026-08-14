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
// to come last alphabetically. Bottom of each main brand goes on the relegation
// list, top of the development brand on the promotion list, and the lists are
// built per gender because the matches are.
// Champions are never on the relegation list — holding a belt is the one thing
// that keeps you up.

export const DEFAULTS = {
  relegatePerBrand: 1,      // per gender, per main brand
  promotePerGender: 2,      // from development — they face each other, so two
};

const isMain = b => (b.tier || 1) === 1;
const isDev = b => (b.tier || 1) > 1;

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
  const { relegatePerBrand, promotePerGender } = { ...DEFAULTS, ...opts };
  const season = opts.season || currentSeason(state);
  const champs = championSet(state);
  const standings = brandStandings(state, season);
  const genders = ['male', 'female'];
  const out = [];

  standings.filter(b => isMain(b)).forEach(b => {
    genders.forEach(g => {
      const eligible = b.table.filter(r => r.gender === g && !champs.has(r.id));
      // Bottom of the brand: fewest points, worst record, most recently idle.
      eligible.slice(-relegatePerBrand).forEach(r => out.push({
        id: r.id, name: r.name, gender: g, flag: 'relegation-flagged',
        from: b.id, fromName: b.name, points: r.points, record: `${r.w}-${r.l}-${r.d}`,
        why: `bottom of ${b.name}${r.matches ? '' : ' (no matches all season)'}`,
      }));
    });
  });

  standings.filter(b => isDev(b)).forEach(b => {
    genders.forEach(g => {
      const eligible = b.table.filter(r => r.gender === g);
      eligible.slice(0, promotePerGender).forEach(r => out.push({
        id: r.id, name: r.name, gender: g, flag: 'promotion-flagged',
        from: b.id, fromName: b.name, points: r.points, record: `${r.w}-${r.l}-${r.d}`,
        why: `top of ${b.name}`,
      }));
    });
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
  const flagged = flag => Object.values(state.wrestlers).filter(w => w.status === flag);
  const matches = [];

  ['relegation-flagged', 'promotion-flagged'].forEach(flag => {
    const stakes = flag === 'relegation-flagged' ? 'relegation' : 'promotion';
    ['male', 'female'].forEach(gender => {
      const pool = flagged(flag).filter(w => w.gender === gender);
      // Two at a time. An odd one out is reported rather than quietly dropped.
      for (let i = 0; i + 1 < pool.length; i += 2) {
        matches.push({
          stakes, gender,
          a: pool[i], b: pool[i + 1],
          toBrandId: destinationFor(state, stakes, [pool[i], pool[i + 1]]),
        });
      }
      if (pool.length % 2 === 1) {
        matches.push({ stakes, gender, unpaired: pool[pool.length - 1] });
      }
    });
  });

  return {
    matches: matches.filter(m => !m.unpaired),
    unpaired: matches.filter(m => m.unpaired).map(m => m.unpaired),
    date: opts.date || null,
  };
}

// Where the moved wrestler lands. Relegation goes to the development brand;
// promotion goes to whichever main brand is thinnest, which keeps the two main
// rosters from drifting apart over a few seasons.
export function destinationFor(state, stakes, wrestlers = []) {
  const brands = Object.values(state.brands);
  if (stakes === 'relegation') {
    const dev = brands.filter(isDev).sort((a, b) => a.roster.length - b.roster.length);
    return dev.length ? dev[0].id : null;
  }
  const from = new Set(wrestlers.map(w => w.brandId));
  const main = brands.filter(b => isMain(b) && !from.has(b.id)).sort((a, b) => a.roster.length - b.roster.length);
  return main.length ? main[0].id : (brands.filter(isMain)[0] || {}).id || null;
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
    lines.push(`${m.a.name} vs ${m.b.name} — ${m.stakes}${m.stakes === 'promotion' ? ` to ${to}` : ''}`);
  });
  return lines.join('\n');
}

export { isMain, isDev, championSet };
