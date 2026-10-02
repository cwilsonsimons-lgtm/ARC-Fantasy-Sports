// The league valuation model. Pure functions only — no DOM, no fetch, no storage —
// so tools/values-check.mjs can replay it in Node.
//
// A player's league value is the Dynasty Daddy value on that date, scaled by
// three learned or derived factors (all kept in log space, so they add):
//
//   league = dd × exp(trade + group + form + format)
//
//   trade   per-player, learned from accepted and rejected trades
//   group   per position/age bucket, learned from the same trades — spreads what
//           the league is telling us to similar players, since one 10-team league
//           only makes a few dozen trades a year
//   form    per-player, nudged weekly by points scored vs expectation
//   format  derived, not learned: how much this league's scoring (first downs,
//           6pt pass TD, TE premium, tiered PPR) pays the player relative to
//           plain PPR, which is what the market values assume
//
// Learned factors decay toward zero over time, so a value with no fresh evidence
// drifts back to consensus instead of freezing on one old trade.

export const DEFAULT_PARAMS = {
  tradeRate: 0.25,       // share of a trade's value gap closed by one trade
  rejectRate: 0.10,      // same, for a rejected offer that the model thought was fair
  rejectMargin: 0.05,    // a rejection only teaches if the model had the rejecting side winning by this much
  groupShare: 0.3,       // share of a trade adjustment that goes to the player's group
  maxStep: 0.15,         // cap on one event's move for one player (log ≈ ±15%)
  maxGap: 0.5,           // gaps beyond this (≈65%) are clipped: dump trades shouldn't dominate
  consolidation: 1.2,    // >1 means one great player is worth more than two good ones summing the same
  halfLifeDays: 150,     // per-player learned factors halve in this many days without evidence
  groupHalfLifeDays: 365,
  formRate: 0.015,       // weekly form nudge per unit of (actual − expected)/expected
  formHalfLifeDays: 60,
  formatPosWeight: 0.5,  // how strongly a position's scoring edge moves its values
  formatPlayerWeight: 1.0,
  minGames: 4,           // format edge is shrunk toward the position by games/(games+minGames)
  formatWindow: 17,      // format edge reads the most recent this-many weeks, so it follows the season
};

const DAY = 86400000;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// ---- assets and groups -----------------------------------------------------

export const pickKey = (season, round) => `pick:${season}:${round}`;
export const isPick = key => key.startsWith('pick:');
export function pickLabel(key) {
  const [, season, round] = key.split(':');
  return `${season} ${ordinal(+round)}`;
}
export const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

const AGE_BANDS = { QB: [26, 32], RB: [24, 27], WR: [24, 29], TE: [25, 30] };

// Position/age bucket used to share trade evidence between similar players.
export function groupOf(key, player) {
  if (isPick(key)) {
    const round = +key.split(':')[2];
    return round === 1 ? 'PICK1' : round === 2 ? 'PICK2' : 'PICK3+';
  }
  const pos = player?.pos;
  const bands = AGE_BANDS[pos];
  if (!bands) return pos || 'OTHER';
  const age = player.age;
  if (age == null) return pos + ':prime';
  return pos + (age < bands[0] ? ':young' : age < bands[1] ? ':prime' : ':vet');
}

export function groupLabel(g) {
  if (g.startsWith('PICK')) return g === 'PICK1' ? '1st-round picks' : g === 'PICK2' ? '2nd-round picks' : 'Later picks';
  const [pos, band] = g.split(':');
  return band ? `${band[0].toUpperCase() + band.slice(1)} ${pos}s` : pos;
}

// ---- baseline (Dynasty Daddy) ------------------------------------------------

// snapshots: [{ date: ms, values: { key: value } }] sorted by date.
// Returns the latest snapshot on or before t, else the earliest one.
export function snapshotAt(snapshots, t) {
  if (!snapshots.length) return null;
  let best = snapshots[0];
  for (const s of snapshots) {
    if (s.date <= t) best = s; else break;
  }
  return best;
}

// Value floor for anything the market doesn't list (deep bench, kickers).
export function floorOf(snap) {
  let max = 0;
  for (const k in snap.values) if (snap.values[k] > max) max = snap.values[k];
  return Math.max(1, Math.round(max * 0.005));
}

// Baseline value of one asset in a snapshot. Picks fall back to the nearest
// listed season for that round, since the market only lists a few years out.
export function baseValue(snap, key) {
  if (!snap) return 0;
  const v = snap.values[key];
  if (v != null) return v;
  if (isPick(key)) {
    const [, season, round] = key.split(':');
    let best = null, bestDist = Infinity;
    for (const k in snap.values) {
      if (!isPick(k)) continue;
      const [, s, r] = k.split(':');
      if (r !== round) continue;
      const d = Math.abs(+s - +season);
      if (d < bestDist) { best = snap.values[k]; bestDist = d; }
    }
    if (best != null) return best;
  }
  return floorOf(snap);
}

// ---- scoring format edge ---------------------------------------------------

const STARTER_POOL = { QB: 15, RB: 30, WR: 40, TE: 15 };

// weeks: [{ end: ms, pts: { id: [leaguePts, pprPts, projPts|null] } }] in date order.
// Returns a function (key, t) -> { pos, player } log factors using the most
// recent formatWindow weeks that had finished by t. Before any week finishes
// there is no edge.
export function buildFormat(weeks, players, params) {
  const cache = new Map();   // number of finished weeks -> computed table
  function table(n) {
    if (cache.has(n)) return cache.get(n);
    const tot = {};          // id -> [league, ppr, games]
    for (let i = Math.max(0, n - params.formatWindow); i < n; i++) {
      for (const id in weeks[i].pts) {
        const [l, p] = weeks[i].pts[id];
        if (!p && !l) continue;
        const t = tot[id] || (tot[id] = [0, 0, 0]);
        t[0] += l; t[1] += p; t[2]++;
      }
    }
    const byPos = {};
    for (const id in tot) {
      const pos = players[id]?.pos;
      if (!STARTER_POOL[pos] || tot[id][1] <= 0) continue;
      (byPos[pos] || (byPos[pos] = [])).push(tot[id]);
    }
    const posRatio = {};
    for (const pos in byPos) {
      const top = byPos[pos].sort((a, b) => b[1] - a[1]).slice(0, STARTER_POOL[pos]);
      const l = top.reduce((s, t) => s + t[0], 0), p = top.reduce((s, t) => s + t[1], 0);
      if (p > 0) posRatio[pos] = l / p;
    }
    const ratios = Object.values(posRatio);
    const mean = ratios.length ? Math.exp(ratios.reduce((s, r) => s + Math.log(r), 0) / ratios.length) : 1;
    const out = { tot, posRatio, mean };
    cache.set(n, out);
    return out;
  }
  return function format(key, t) {
    if (isPick(key)) return { pos: 0, player: 0 };
    let n = 0;
    while (n < weeks.length && weeks[n].end <= t) n++;
    if (!n) return { pos: 0, player: 0 };
    const { tot, posRatio, mean } = table(n);
    const pos = players[key]?.pos;
    const pr = posRatio[pos];
    if (!pr) return { pos: 0, player: 0 };
    const posTerm = params.formatPosWeight * Math.log(pr / mean);
    const mine = tot[key];
    let playerTerm = 0;
    if (mine && mine[1] >= 20) {
      const shrink = mine[2] / (mine[2] + params.minGames);
      playerTerm = clamp(params.formatPlayerWeight * shrink * Math.log((mine[0] / mine[1]) / pr), -0.25, 0.25);
    }
    return { pos: posTerm, player: playerTerm };
  };
}

// ---- replay ----------------------------------------------------------------

// Consolidation-aware package value: (Σ vᵢ^α)^(1/α).
function packageValue(vals, alpha) {
  if (!vals.length) return 0;
  return Math.pow(vals.reduce((s, v) => s + Math.pow(v, alpha), 0), 1 / alpha);
}

// Runs every event in date order and returns the model state plus a history
// that the UI uses for charts and "why did this move" explanations.
//
// input = {
//   snapshots, players, weeks,
//   trades:    [{ id, date, ignored, sides: [{ roster, gets: [key] }] }]   accepted (≥2 sides)
//   rejected:  [{ id, date, proposerGives: [key], receiverGives: [key] }]   offers the receiver turned down
//   now,
// }
export function replay(input, params = DEFAULT_PARAMS) {
  const P = { ...DEFAULT_PARAMS, ...params };
  const { snapshots, players = {}, weeks = [], now = Date.now() } = input;
  const trade = new Map(), form = new Map(), group = new Map();
  const reasons = new Map();       // key -> [{ date, kind, delta, ref, text }]
  const checkpoints = [];          // [{ date, trade: Map, form: Map, group: Map }]
  const evaluated = new Map();     // event id -> { date, sides: [{ dd, league }] , gap }
  const format = buildFormat(weeks, players, P);
  const groupFor = k => groupOf(k, players[k]);

  const log = (k, r) => { (reasons.get(k) || reasons.set(k, []).get(k)).push(r); };
  const add = (m, k, d) => { const v = (m.get(k) || 0) + d; if (Math.abs(v) < 1e-5) m.delete(k); else m.set(k, v); };

  function factor(k, t) {
    const f = format(k, t);
    return (trade.get(k) || 0) + (form.get(k) || 0) + (group.get(groupFor(k)) || 0) + f.pos + f.player;
  }
  function leagueValue(snap, k, t) { return baseValue(snap, k) * Math.exp(factor(k, t)); }

  let clock = null;
  function decayTo(t) {
    if (clock != null && t > clock) {
      const days = (t - clock) / DAY;
      const fp = Math.pow(0.5, days / P.halfLifeDays);
      const ff = Math.pow(0.5, days / P.formHalfLifeDays);
      const fg = Math.pow(0.5, days / P.groupHalfLifeDays);
      for (const [k, v] of trade) trade.set(k, v * fp);
      for (const [k, v] of form) form.set(k, v * ff);
      for (const [k, v] of group) group.set(k, v * fg);
    }
    if (clock == null || t > clock) clock = t;
  }
  function checkpoint(t) {
    checkpoints.push({ date: t, trade: new Map(trade), form: new Map(form), group: new Map(group) });
  }

  // Move a package's assets by `total` (log), split by each asset's weight.
  function nudge(keys, vals, total, t, kind, ref, text) {
    const pw = vals.map(v => Math.pow(v, P.consolidation));
    const sum = pw.reduce((s, v) => s + v, 0) || 1;
    keys.forEach((k, i) => {
      const d = clamp(total * pw[i] / sum, -P.maxStep, P.maxStep);
      if (!d) return;
      add(trade, k, d * (1 - P.groupShare));
      add(group, groupFor(k), d * P.groupShare / 4);   // a group is many players; one trade moves it gently
      log(k, { date: t, kind, delta: d, ref, text });
    });
  }

  const events = [];
  for (const tr of input.trades || []) events.push({ t: tr.date, kind: 'trade', ev: tr });
  for (const rj of input.rejected || []) events.push({ t: rj.date, kind: 'rejected', ev: rj });
  weeks.forEach((w, i) => events.push({ t: w.end, kind: 'week', ev: w, i }));
  for (const s of snapshots) events.push({ t: s.date, kind: 'snapshot' });
  const order = { snapshot: 0, week: 1, trade: 2, rejected: 3 };
  events.sort((a, b) => a.t - b.t || order[a.kind] - order[b.kind]);

  for (const e of events) {
    if (e.t > now) continue;
    decayTo(e.t);
    const snap = snapshotAt(snapshots, e.t);
    if (!snap) continue;

    if (e.kind === 'trade') {
      const tr = e.ev;
      const sides = tr.sides.map(s => {
        const dd = s.gets.map(k => baseValue(snap, k));
        const lv = s.gets.map(k => leagueValue(snap, k, e.t));
        return { gets: s.gets, dd, lv, ddPkg: packageValue(dd, P.consolidation), lvPkg: packageValue(lv, P.consolidation) };
      });
      const rec = { date: e.t, sides: sides.map(s => ({ dd: s.ddPkg, league: s.lvPkg })) };
      evaluated.set(tr.id, rec);
      if (tr.ignored || sides.length < 2 || sides.some(s => !s.gets.length)) { checkpoint(e.t); continue; }
      // Each side's package should be worth what the rest of the trade gave up for
      // it. Pairwise against the mean of the others generalises to 3-team deals.
      const n = sides.length;
      const logs = sides.map(s => Math.log(Math.max(s.lvPkg, 1)));
      const mean = logs.reduce((a, b) => a + b, 0) / n;
      sides.forEach((s, i) => {
        const gap = clamp(logs[i] - mean, -P.maxGap, P.maxGap);
        if (Math.abs(gap) < 0.01) return;
        const pct = Math.round((Math.exp(Math.abs(gap)) - 1) * 100);
        const text = gap > 0
          ? `Traded for less than the model had it worth (${pct}% gap)`
          : `The league paid ${pct}% more than the model had it worth`;
        nudge(s.gets, s.lv, -P.tradeRate * gap, e.t, 'trade', tr.id, text);
      });
      rec.gap = Math.log(Math.max(sides[0].ddPkg, 1)) - mean;
    } else if (e.kind === 'rejected') {
      const rj = e.ev;
      // The receiver turned down proposerGives in exchange for receiverGives, so
      // they valued what they'd give up more than what they'd get.
      const offered = rj.proposerGives, asked = rj.receiverGives;
      if (!offered?.length || !asked?.length) { checkpoint(e.t); continue; }
      const oLv = offered.map(k => leagueValue(snap, k, e.t)), aLv = asked.map(k => leagueValue(snap, k, e.t));
      const o = packageValue(oLv, P.consolidation), a = packageValue(aLv, P.consolidation);
      const gap = Math.log(o / a);
      evaluated.set(rj.id, { date: e.t, sides: [{ dd: packageValue(offered.map(k => baseValue(snap, k)), P.consolidation), league: o },
        { dd: packageValue(asked.map(k => baseValue(snap, k)), P.consolidation), league: a }], gap });
      if (gap > P.rejectMargin) {
        const g = clamp(gap, 0, P.maxGap);
        const pct = Math.round((Math.exp(g) - 1) * 100);
        nudge(offered, oLv, -P.rejectRate * g, e.t, 'rejected', rj.id, `Offered in a rejected deal the model had ${pct}% in the receiver's favour`);
        nudge(asked, aLv, P.rejectRate * g, e.t, 'rejected', rj.id, `Owner refused to sell at a ${pct}% premium`);
      }
    } else if (e.kind === 'week') {
      // Form: actual vs expectation under league scoring. Expectation is Sleeper's
      // projection, else the player's own average over prior weeks.
      const prior = weeks.slice(0, e.i);
      for (const id in e.ev.pts) {
        const [actual, , proj] = e.ev.pts[id];
        let expect = proj;
        if (!(expect > 0)) {
          const hist = prior.map(w => w.pts[id]?.[0]).filter(v => v != null);
          if (hist.length < 2) continue;
          expect = hist.reduce((a, b) => a + b, 0) / hist.length;
        }
        if (!(expect >= 3)) continue;          // fringe players: too noisy to read
        const resid = clamp((actual - expect) / Math.max(expect, 6), -1, 1.5);
        const d = P.formRate * resid;
        add(form, id, d);
        if (Math.abs(resid) >= 0.5) {
          log(id, { date: e.t, kind: 'form', delta: d, ref: e.ev.label,
            text: `${e.ev.label}: ${actual.toFixed(1)} pts vs ${expect.toFixed(1)} expected` });
        }
      }
    }
    checkpoint(e.t);
  }
  decayTo(now);
  checkpoint(now);

  return {
    params: P,
    now,
    format,
    // Full breakdown of one asset at time t (default now).
    explain(key, t = now) {
      const cp = checkpointAt(checkpoints, t);
      const snap = snapshotAt(snapshots, t);
      const f = format(key, t);
      const parts = {
        trade: cp?.trade.get(key) || 0,
        group: cp?.group.get(groupFor(key)) || 0,
        form: cp?.form.get(key) || 0,
        formatPos: f.pos,
        formatPlayer: f.player,
      };
      const total = parts.trade + parts.group + parts.form + parts.formatPos + parts.formatPlayer;
      const dd = baseValue(snap, key);
      return { dd, league: dd * Math.exp(total), total, parts, group: groupFor(key) };
    },
    value(key, t = now) { return this.explain(key, t).league; },
    // Value at every checkpoint since `from`. Walks checkpoints and snapshots
    // together rather than searching per point — this runs for every table row.
    // Nothing is charted before the first snapshot: there's no market number to
    // draw, and earlier trades were priced with that first snapshot as a stand-in.
    history(key, from = 0) {
      if (snapshots.length) from = Math.max(from, snapshots[0].date);
      const g = groupFor(key);
      const out = [];
      let si = 0;
      for (const cp of checkpoints) {
        if (cp.date < from) continue;
        while (si + 1 < snapshots.length && snapshots[si + 1].date <= cp.date) si++;
        const dd = baseValue(snapshots[si], key);
        const f = format(key, cp.date);
        const total = (cp.trade.get(key) || 0) + (cp.form.get(key) || 0) + (cp.group.get(g) || 0) + f.pos + f.player;
        out.push({ date: cp.date, dd, league: dd * Math.exp(total) });
      }
      return out;
    },
    reasons: k => reasons.get(k) || [],
    evaluated,
    groups: () => new Map(group),
  };
}

function checkpointAt(cps, t) {
  let best = null;
  for (const c of cps) { if (c.date <= t) best = c; else break; }
  return best;
}

// Trade-calculator helper: value both packages with the current model.
export function compare(model, a, b) {
  const P = model.params;
  const pkg = (keys, f) => packageValue(keys.map(f), P.consolidation);
  const ex = k => model.explain(k);
  return {
    a: { dd: pkg(a, k => ex(k).dd), league: pkg(a, k => ex(k).league) },
    b: { dd: pkg(b, k => ex(k).dd), league: pkg(b, k => ex(k).league) },
  };
}
