// The valuation model.
//
// Market value (0-10,000, the KeepTradeCut scale) comes from production above replacement,
// stretched over the seasons a player has left at his position and age. Each team then sees
// that value through its own lens:
//
//   value(team, asset) = market
//                      × hype      how hard this manager chases a hot (or cold) streak
//                      × need      how thin the team is at the position, and whether he'd start
//                      × window    contenders pay for production now, rebuilders for youth and picks
//                      × endowment managers overrate their own players
//                      × learned   what their rejected and accepted trades have shown
//                      × nudge     anything you've told the desk by hand
import type { Group, League, Learned, Pick, Player, Pos, Settings, Team, TeamTraits } from './types';
import { POSITIONS } from './types';

// ---------- market value ----------

/** Points per game a free-agent level starter gives you, in this 10-team superflex league. */
export const REPLACEMENT: Record<Pos, number> = { QB: 14, RB: 7.5, WR: 7.5, TE: 5.5 };

/** Share of peak production a player keeps at a given age. */
export function retention(pos: Pos, age: number): number {
  const curves: Record<Pos, [number, number[]]> = {
    // [last peak age, retention for each year past it]
    RB: [25, [0.95, 0.88, 0.78, 0.66, 0.52, 0.4, 0.3]],
    WR: [27, [0.96, 0.9, 0.82, 0.72, 0.6, 0.48, 0.36]],
    TE: [28, [0.95, 0.88, 0.78, 0.66, 0.54, 0.42]],
    QB: [32, [0.95, 0.88, 0.8, 0.7, 0.6, 0.45]],
  };
  const [peak, tail] = curves[pos];
  if (age <= peak) return 1;
  const i = Math.floor(age - peak) - 1;
  return i < tail.length ? tail[i] : tail[tail.length - 1] * 0.75;
}

/** Seasons of value left: next five years, discounted, with growth for players under 25. */
export function seasonsLeft(pos: Pos, age: number): number {
  let total = 0;
  for (let y = 0; y < 5; y++) {
    const grow = 1 + 0.07 * Math.min(y, Math.max(0, 25 - age));
    total += Math.pow(0.82, y) * retention(pos, age + y) * grow;
  }
  return total;
}

const K = 23;
export const toScale = (raw: number) => Math.round(10000 * (1 - Math.exp(-Math.max(0, raw) / K)));

/** Raw dynasty score for a player who scores `ppg`. */
export function rawScore(p: Pick0, ppg: number): number {
  const above = Math.max(0, ppg - REPLACEMENT[p.pos]);
  let raw = above * seasonsLeft(p.pos, p.age);
  // Early draft capital props up a young player who hasn't produced yet.
  if (p.ovr && p.age <= 24) raw = Math.max(raw, 14 * Math.exp(-(p.ovr - 1) / 45));
  return raw;
}
type Pick0 = { pos: Pos; age: number; ovr?: number };

/** The market blends the hot streak and the longer run half and half. */
export const MARKET_RECENCY = 0.5;
export const perceivedPpg = (p: Player, recency: number) => p.base + recency * (p.form - p.base);

export function modelPlayerValue(p: Player, recency = MARKET_RECENCY): number {
  return toScale(rawScore(p, perceivedPpg(p, recency)));
}

export const PICK_ROUND_VALUE = [5200, 2300, 1000, 400];

/** 0 = best record (latest pick) .. 1 = worst record (earliest pick). */
function slotShare(league: League, teamId: string): number {
  const n = league.teams.length;
  const t = league.teams.find((x) => x.id === teamId);
  if (!t || n < 2) return 0.5;
  return (t.standing - 1) / (n - 1);
}

export function pickSlotLabel(league: League, pick: Pick): string {
  if (pick.season !== league.season) return '';
  const s = slotShare(league, pick.orig);
  return s >= 0.7 ? 'Early' : s <= 0.3 ? 'Late' : 'Mid';
}

export function modelPickValue(league: League, pick: Pick): number {
  const base = PICK_ROUND_VALUE[pick.round - 1] ?? 200;
  const spread = pick.round === 1 ? 0.3 : pick.round === 2 ? 0.15 : 0.1;
  const years = pick.season - league.season;
  // The further out, the less anyone trusts the projected slot, and the more it's discounted.
  const slot = 1 + spread * (2 * slotShare(league, pick.orig) - 1) * (years <= 0 ? 1 : years === 1 ? 0.5 : 0);
  const discount = years <= 0 ? 1 : years === 1 ? 0.92 : 0.85;
  return Math.round(base * slot * discount);
}

export type MarketSource = 'you' | 'ktc' | 'model';

/** Market value before your own edits: the KTC paste if there is one, else the model. */
export function defaultMarket(league: League, settings: Settings, id: string): number {
  const o = settings.market[id];
  if (o != null) return o;
  const p = league.players[id];
  if (p) return modelPlayerValue(p);
  const k = league.picks[id];
  if (k) return modelPickValue(league, k);
  return 0;
}

export function marketValue(league: League, settings: Settings, id: string): number {
  return settings.consensus?.[id] ?? defaultMarket(league, settings, id);
}

export function marketSource(settings: Settings, id: string): MarketSource {
  return settings.consensus?.[id] != null ? 'you' : settings.market[id] != null ? 'ktc' : 'model';
}

// ---------- team context ----------

/** How much each depth slot at a position counts toward a team's strength there. */
const DEPTH: Record<Pos, number[]> = {
  QB: [1, 0.9, 0.2],
  RB: [1, 0.9, 0.6, 0.2],
  WR: [1, 0.95, 0.85, 0.5, 0.2],
  TE: [1, 0.3],
};

function weighted(values: number[], pos: Pos): number {
  const w = DEPTH[pos];
  return [...values].sort((a, b) => b - a).reduce((s, v, i) => s + v * (w[i] ?? 0), 0);
}

export interface TeamContext {
  team: Team;
  /** market values of rostered players by position */
  byPos: Record<Pos, { id: string; v: number }[]>;
  strength: Record<Pos, number>;
  /** strength relative to the league average at that position (1 = average) */
  ratio: Record<Pos, number>;
  /** +1 all-in contender .. -1 full rebuild */
  window: number;
  traits: Required<Omit<TeamTraits, 'manager' | 'window'>> & { manager?: string };
}

export interface Valuer {
  league: League;
  settings: Settings;
  learned: Learned;
  market: (id: string) => number;
  ctx: Record<string, TeamContext>;
  me: string;
  /** Team `t`'s value for asset `id`. */
  value: (t: string, id: string) => number;
  /** The same, with each factor so the UI can say why. */
  explain: (t: string, id: string) => Factors;
}

export interface Factors {
  market: number;
  hype: number;
  need: number;
  window: number;
  endowment: number;
  learned: number;
  nudge: number;
  value: number;
  /** What the factors alone give, before your own ranking replaces it. */
  auto: number;
  /** true when `value` is your own ranking (only ever for your team) */
  set?: boolean;
}

export function groupOf(league: League, id: string): Group {
  return league.players[id]?.pos ?? 'PICK';
}

/** How far a contender/rebuilder lean moves a value (at the extremes). */
export const WINDOW_PULL = 0.1;
/** How far being thin (or stacked) at a position moves a value. */
export const NEED_PULL = 0.15;

const DEFAULT_TRAITS = { recency: MARKET_RECENCY, endowment: 0.08 };

export function buildValuer(league: League, settings: Settings, learned: Learned): Valuer {
  const cache = new Map<string, number>();
  const market = (id: string) => {
    let v = cache.get(id);
    if (v == null) cache.set(id, (v = marketValue(league, settings, id)));
    return v;
  };
  const me = league.teams.find((t) => t.me)?.id ?? league.teams[0]?.id ?? '';

  const ctx: Record<string, TeamContext> = {};
  for (const team of league.teams) {
    const byPos = { QB: [], RB: [], WR: [], TE: [] } as TeamContext['byPos'];
    for (const [id, owner] of Object.entries(league.owner)) {
      const p = league.players[id];
      if (owner === team.id && p) byPos[p.pos].push({ id, v: market(id) });
    }
    const strength = {} as Record<Pos, number>;
    for (const pos of POSITIONS) strength[pos] = weighted(byPos[pos].map((x) => x.v), pos);
    const tr = settings.traits[team.id] ?? {};
    const isMe = team.id === me;
    ctx[team.id] = {
      team,
      byPos,
      strength,
      ratio: {} as Record<Pos, number>,
      window: 0,
      traits: {
        recency: tr.recency ?? DEFAULT_TRAITS.recency,
        // You are the one person the desk shouldn't flatter.
        endowment: tr.endowment ?? (isMe ? 0 : DEFAULT_TRAITS.endowment),
        manager: tr.manager,
      },
    };
  }
  const teams = Object.values(ctx);
  for (const pos of POSITIONS) {
    const avg = teams.reduce((s, c) => s + c.strength[pos], 0) / Math.max(1, teams.length) || 1;
    for (const c of teams) c.ratio[pos] = c.strength[pos] / avg;
  }
  const totals = teams.map((c) => POSITIONS.reduce((s, p) => s + c.strength[p], 0));
  for (const c of teams) {
    const total = POSITIONS.reduce((s, p) => s + c.strength[p], 0);
    const below = totals.filter((x) => x < total).length;
    const pct = teams.length > 1 ? below / (teams.length - 1) : 0.5;
    const games = c.team.wins + c.team.losses;
    const winPct = games ? c.team.wins / games : 0.5;
    const read = 0.5 * (2 * winPct - 1) + 0.5 * (2 * pct - 1);
    const override = settings.traits[c.team.id]?.window;
    c.window = clamp(override ?? read, -1, 1);
  }

  const nudges = new Map<string, number>();
  for (const n of settings.nudges) nudges.set(n.team + '|' + n.asset, n.pct);

  const explain = (t: string, id: string): Factors => {
    const m = market(id);
    const c = ctx[t];
    const f: Factors = { market: m, hype: 1, need: 1, window: 1, endowment: 1, learned: 1, nudge: 1, value: m, auto: m };
    if (!c) return f;
    const p = league.players[id];
    const owner = league.owner[id];
    const own = owner === t;
    if (p) {
      // Owners believe their guy's hot streak and shrug off his slump.
      let r = c.traits.recency;
      if (own && t !== me) r += p.trend >= 0 ? 0.25 : -0.25;
      r = clamp(r, 0, 1);
      if (r !== MARKET_RECENCY) {
        const mine = modelPlayerValue(p, r);
        const mkt = modelPlayerValue(p, MARKET_RECENCY);
        f.hype = mkt > 150 ? clamp(mine / mkt, 0.5, 2) : 1 + (mine - mkt) / 1000;
      }
      f.need = needFactor(c, p.pos, id, m);
      // A young player already producing is a win-now piece too; only unproven youth is a rebuild asset.
      let phase = agePhase(p);
      if (phase < 0 && perceivedPpg(p, MARKET_RECENCY) >= REPLACEMENT[p.pos] + 4) phase *= 0.3;
      f.window = 1 + WINDOW_PULL * c.window * phase;
    } else {
      const k = league.picks[id];
      const years = k ? k.season - league.season : 0;
      f.window = 1 + WINDOW_PULL * c.window * (years <= 0 ? -0.8 : -1);
    }
    if (own) f.endowment = 1 + c.traits.endowment;
    const g = groupOf(league, id);
    const la = learned.asset[t]?.[id] ?? 0;
    const lg = learned.group[t]?.[g] ?? 0;
    f.learned = Math.exp(la + lg);
    f.nudge = 1 + (nudges.get(t + '|' + id) ?? 0);
    f.value = f.auto = Math.round(m * f.hype * f.need * f.window * f.endowment * f.learned * f.nudge);
    const ranked = t === me ? settings.mine?.[id] : undefined;
    if (ranked != null) {
      f.value = ranked;
      f.set = true;
    }
    return f;
  };

  const vcache = new Map<string, number>();
  const value = (t: string, id: string) => {
    const key = t + '|' + id;
    let v = vcache.get(key);
    if (v == null) vcache.set(key, (v = explain(t, id).value));
    return v;
  };

  return { league, settings, learned, market, ctx, me, value, explain };
}

/**
 * Thin at a position: pays more. And a player who'd start for you is worth more to you than
 * the same player as your WR6.
 */
function needFactor(c: TeamContext, pos: Pos, id: string, v: number): number {
  const need = clamp(1 + NEED_PULL * (1 - c.ratio[pos]), 0.88, 1.15);
  if (v <= 0) return need;
  const others = c.byPos[pos].filter((x) => x.id !== id).map((x) => x.v);
  const without = weighted(others, pos);
  const withHim = weighted([...others, v], pos);
  const share = clamp((withHim - without) / v, 0, 1);
  return need * (0.92 + 0.08 * share);
}

/** -1 = a rebuilder's dream (young), +1 = a contender's piece (veteran producing now). */
export function agePhase(p: Player): number {
  const shift = p.pos === 'RB' ? 0 : p.pos === 'QB' ? 5 : 2;
  const a = p.age - shift;
  if (a <= 23) return -1;
  if (a <= 24) return -0.5;
  if (a <= 25) return -0.2;
  if (a <= 26) return 0.2;
  if (a <= 27) return 0.6;
  return 1;
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function windowLabel(w: number): string {
  if (w >= 0.45) return 'Contending';
  if (w >= 0.1) return 'Fringe contender';
  if (w > -0.1) return 'Middle';
  if (w > -0.45) return 'Retooling';
  return 'Rebuilding';
}

export function assetName(league: League, id: string): string {
  const p = league.players[id];
  if (p) return p.name;
  const k = league.picks[id];
  if (!k) return id;
  const slot = pickSlotLabel(league, k);
  const ord = ['1st', '2nd', '3rd', '4th'][k.round - 1] ?? `R${k.round}`;
  return `${k.season} ${slot ? slot + ' ' : ''}${ord}`;
}

export function assetSub(league: League, id: string): string {
  const p = league.players[id];
  if (p) return `${p.pos} · ${p.nfl} · ${p.age}`;
  const k = league.picks[id];
  if (!k) return '';
  const t = league.teams.find((x) => x.id === k.orig);
  return `Pick · ${t ? t.name + "'s" : 'unknown'}`;
}
