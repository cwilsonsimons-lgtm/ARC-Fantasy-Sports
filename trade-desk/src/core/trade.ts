// Trades: how a team adds up a package, how likely it is to say yes, and what its
// past answers teach us.
import type { Group, League, Learned, Settings, TradeLog } from './types';
import { buildValuer, clamp, groupOf, type Valuer } from './model';

/**
 * Package value. Two 5,000s are not a 10,000: the side getting the best player wins
 * consolidation trades, so values add on a power curve (p = 1.3, about KTC's feel).
 */
export const P_NORM = 1.3;
export function packageValue(values: number[]): number {
  const s = values.reduce((a, v) => a + Math.pow(Math.max(0, v), P_NORM), 0);
  return s > 0 ? Math.pow(s, 1 / P_NORM) : 0;
}

/** Default edge a manager wants before saying yes: 3% of the trade's size. */
export const BASE_MARGIN = 0.03;

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export interface Side {
  team: string;
  /** what this team gives up */
  give: string[];
  /** what this team receives */
  get: string[];
}

export interface Read {
  giveValue: number;
  getValue: number;
  /** getValue - giveValue in this team's eyes */
  edge: number;
  /** chance this team says yes */
  p: number;
  z: number;
  size: number;
  scale: number;
  margin: number;
}

/** How `side.team` sees the deal. */
export function readTrade(v: Valuer, side: Side): Read {
  const giveValue = packageValue(side.give.map((id) => v.value(side.team, id)));
  const getValue = packageValue(side.get.map((id) => v.value(side.team, id)));
  const size = Math.max(giveValue, getValue);
  const scale = 0.06 * size + 150;
  const margin = BASE_MARGIN + (v.learned.margin[side.team] ?? 0);
  const z = (getValue - giveValue - margin * size) / scale;
  return { giveValue, getValue, edge: getValue - giveValue, p: sigmoid(z), z, size, scale, margin };
}

/** The same deal from my side: what I give is what they get. */
export function mySide(v: Valuer, theirs: Side): Side {
  return { team: v.me, give: theirs.get, get: theirs.give };
}

export function likelihoodLabel(p: number): string {
  if (p >= 0.8) return 'Likely yes';
  if (p >= 0.6) return 'Leaning yes';
  if (p >= 0.4) return 'Coin flip';
  if (p >= 0.2) return 'Leaning no';
  return 'Likely no';
}

// ---------- learning ----------

export interface Observation {
  team: string;
  give: string[];
  get: string[];
  /** 1 = the team said yes (or proposed it), 0 = no */
  y: 0 | 1;
  /** weight: recent answers count more, and hype fades */
  w: number;
}

export const HALF_LIFE_DAYS = 60;

export function observationsFrom(logs: TradeLog[], now: Date): Observation[] {
  const out: Observation[] = [];
  for (const l of logs) {
    const days = Math.max(0, (now.getTime() - new Date(l.ts).getTime()) / 86400000);
    const w = Math.pow(0.5, days / HALF_LIFE_DAYS);
    if (!l.give.length && !l.get.length) continue;
    switch (l.outcome) {
      case 'rejected':
      case 'countered':
        out.push({ team: l.team, give: l.give, get: l.get, y: 0, w });
        break;
      case 'accepted':
      case 'offered':
        out.push({ team: l.team, give: l.give, get: l.get, y: 1, w });
        break;
      case 'completed':
        // Both managers clicked accept.
        out.push({ team: l.team, give: l.give, get: l.get, y: 1, w });
        if (l.with) out.push({ team: l.with, give: l.get, get: l.give, y: 1, w });
        break;
      case 'pending':
        break;
    }
  }
  return out;
}

/** Prior strength: how far one answer can move a value. Larger = more skeptical. */
const L2_ASSET = 12;
const L2_GROUP = 60;
const L2_MARGIN = 300;

/**
 * Fit per-team adjustments to the trade log by regularized logistic regression.
 * A rejection says "what you offered was worth less to me than what you asked for":
 * the asked-for pieces go up in that team's eyes, the offered pieces go down, in proportion
 * to how much of each side they made up. An acceptance says the opposite. Everything is
 * refit from scratch from the full log, so deleting a log entry undoes its effect.
 */
export function fitLearned(league: League, settings: Settings, logs: TradeLog[], now = new Date(), iters = 400): Learned {
  // Your own answers aren't modelled: the desk shows your values straight.
  const me = league.teams.find((t) => t.me)?.id;
  const obs = observationsFrom(logs, now).filter((o) => o.team !== me && league.teams.some((t) => t.id === o.team));
  const learned: Learned = { asset: {}, group: {}, margin: {}, observations: obs.length };
  if (!obs.length) return learned;
  const base = buildValuer(league, settings, { asset: {}, group: {}, margin: {}, observations: 0 });

  // Values without anything learned: the fit adjusts on top of these.
  const baseValue = (t: string, id: string) => base.value(t, id);
  const theta = (t: string, id: string) => learned.asset[t]?.[id] ?? 0;
  const phi = (t: string, g: Group) => learned.group[t]?.[g] ?? 0;
  const valueOf = (t: string, id: string) => baseValue(t, id) * Math.exp(theta(t, id) + phi(t, groupOf(league, id)));

  const lr = 0.01;
  for (let it = 0; it < iters; it++) {
    const gA: Record<string, Record<string, number>> = {};
    const gG: Record<string, Record<string, number>> = {};
    const gM: Record<string, number> = {};
    for (const o of obs) {
      const gv = o.give.map((id) => valueOf(o.team, id));
      const rv = o.get.map((id) => valueOf(o.team, id));
      const G = packageValue(gv);
      const R = packageValue(rv);
      const size = Math.max(G, R, 1);
      const scale = 0.06 * size + 150;
      const m = BASE_MARGIN + (learned.margin[o.team] ?? 0);
      const z = (R - G - m * size) / scale;
      const dz = o.w * (sigmoid(z) - o.y); // dLoss/dz
      const add = (ids: string[], vals: number[], P: number, sign: number) => {
        ids.forEach((id, i) => {
          if (P <= 0) return;
          const dzdlog = (sign * vals[i] * Math.pow(vals[i] / P, P_NORM - 1)) / scale;
          ((gA[o.team] ??= {})[id] ??= 0);
          gA[o.team][id] += dz * dzdlog;
          const g = groupOf(league, id);
          ((gG[o.team] ??= {})[g] ??= 0);
          gG[o.team][g] += dz * dzdlog;
        });
      };
      add(o.get, rv, R, +1);
      add(o.give, gv, G, -1);
      gM[o.team] = (gM[o.team] ?? 0) + dz * (-size / scale);
    }
    for (const [t, ids] of Object.entries(gA)) {
      const row = (learned.asset[t] ??= {});
      for (const [id, g] of Object.entries(ids)) {
        const cur = row[id] ?? 0;
        row[id] = clamp(cur - lr * (g + L2_ASSET * cur), -1.2, 1.2);
      }
    }
    for (const [t, gs] of Object.entries(gG)) {
      const row = (learned.group[t] ??= {});
      for (const [g, grad] of Object.entries(gs) as [Group, number][]) {
        const cur = row[g] ?? 0;
        row[g] = clamp(cur - lr * 0.3 * (grad + L2_GROUP * cur), -0.5, 0.5);
      }
    }
    for (const [t, grad] of Object.entries(gM)) {
      const cur = learned.margin[t] ?? 0;
      learned.margin[t] = clamp(cur - lr * 0.002 * (grad + L2_MARGIN * cur), -0.05, 0.15);
    }
  }
  // Drop the noise so the stored doc stays small.
  for (const row of Object.values(learned.asset)) for (const [k, x] of Object.entries(row)) if (Math.abs(x) < 0.005) delete row[k];
  for (const row of Object.values(learned.group)) for (const [k, x] of Object.entries(row)) if (Math.abs(x as number) < 0.005) delete (row as Record<string, number>)[k];
  for (const [k, x] of Object.entries(learned.margin)) if (Math.abs(x) < 0.002) delete learned.margin[k];
  return learned;
}

// ---------- finding trades ----------

export interface Proposal {
  side: Side; // from the other team's point of view
  them: Read;
  mine: Read;
}

function combos<T>(items: T[], k: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (acc.length === k) return void out.push(acc.slice());
    for (let i = start; i < items.length; i++) {
      acc.push(items[i]);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return out;
}

export interface FindOptions {
  /** minimum chance they say yes */
  minP?: number;
  /** assets of mine I won't move */
  keep?: string[];
  maxPieces?: number;
  limit?: number;
}

/**
 * What could I offer `team` for `want`? Searches my roster for packages they'd likely take,
 * ranked by how little they cost me in my own eyes. Pieces they value more than I do come first,
 * which is where the free value lives.
 */
export function findOffers(v: Valuer, team: string, want: string[], opts: FindOptions = {}): Proposal[] {
  const minP = opts.minP ?? 0.55;
  const keep = new Set(opts.keep ?? []);
  const mine = Object.entries(v.league.owner)
    .filter(([id, t]) => t === v.me && !keep.has(id) && !want.includes(id))
    .map(([id]) => id)
    .filter((id) => v.market(id) >= 150);
  // Rank by how much more they like it than I do, then keep the top of the list.
  const ranked = mine
    .map((id) => ({ id, them: v.value(team, id), me: v.value(v.me, id) }))
    .sort((a, b) => b.them - b.me * 0.85 - (a.them - a.me * 0.85))
    .slice(0, 22)
    .map((x) => x.id);
  const out: Proposal[] = [];
  const maxPieces = opts.maxPieces ?? 3;
  for (let k = 1; k <= maxPieces; k++) {
    for (const give of combos(ranked, k)) {
      const side: Side = { team, give: want, get: give };
      const them = readTrade(v, side);
      if (them.p < minP) continue;
      out.push({ side, them, mine: readTrade(v, mySide(v, side)) });
    }
  }
  // Best for me first; drop packages that are a strict superset of a better one.
  out.sort((a, b) => b.mine.edge - a.mine.edge);
  const picked: Proposal[] = [];
  for (const o of out) {
    if (picked.some((q) => q.side.get.every((id) => o.side.get.includes(id)))) continue;
    picked.push(o);
    if (picked.length >= (opts.limit ?? 6)) break;
  }
  return picked;
}

export interface Fix {
  kind: 'add' | 'ask';
  id: string;
  read: Read;
  mine: Read;
}

/**
 * Nudge a deal over the line: if they'd likely say no, the cheapest piece of mine that gets it
 * to a yes; if they'd say yes easily, the best extra piece of theirs I could still ask for.
 */
export function balance(v: Valuer, side: Side, target = 0.6): Fix[] {
  const now = readTrade(v, side);
  const fixes: Fix[] = [];
  if (now.p < target) {
    const mine = Object.entries(v.league.owner)
      .filter(([id, t]) => t === v.me && !side.get.includes(id))
      .map(([id]) => id);
    for (const id of mine) {
      const s2: Side = { ...side, get: [...side.get, id] };
      const r = readTrade(v, s2);
      if (r.p >= target) fixes.push({ kind: 'add', id, read: r, mine: readTrade(v, mySide(v, s2)) });
    }
    fixes.sort((a, b) => b.mine.edge - a.mine.edge);
  } else {
    const theirs = Object.entries(v.league.owner)
      .filter(([id, t]) => t === side.team && !side.give.includes(id))
      .map(([id]) => id);
    for (const id of theirs) {
      const s2: Side = { ...side, give: [...side.give, id] };
      const r = readTrade(v, s2);
      if (r.p >= target) fixes.push({ kind: 'ask', id, read: r, mine: readTrade(v, mySide(v, s2)) });
    }
    fixes.sort((a, b) => b.mine.edge - a.mine.edge);
  }
  return fixes.slice(0, 4);
}

export interface BuyerRead {
  id: string;
  mine: number;
  market: number;
  best: { team: string; value: number }[];
}

/** For each of my assets, who values it most. A team that loves him is where to sell. */
export function buyers(v: Valuer): BuyerRead[] {
  return Object.entries(v.league.owner)
    .filter(([, t]) => t === v.me)
    .map(([id]) => {
      const best = v.league.teams
        .filter((t) => t.id !== v.me)
        .map((t) => ({ team: t.id, value: v.value(t.id, id) }))
        .sort((a, b) => b.value - a.value);
      return { id, mine: v.value(v.me, id), market: v.market(id), best };
    })
    .sort((a, b) => b.market - a.market);
}
