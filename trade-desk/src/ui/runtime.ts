// Talks to the claude.ai page runtime: the db capability (where everything is saved) and the
// mcp capability (the StatsDeck connector, which reads the Sleeper league).
import type { League, RankingWeek, Settings, Snapshot, TradeLog } from '../core/types';
import { emptySettings } from '../core/types';
import type { Point } from '../core/history';
import { buildLeague, dataOf, tradesFromPayload } from '../core/statsdeck';

type Unsub = () => void;
interface Snap { exists: boolean; id: string; data(): any; metadata: { fromCache: boolean } }
interface QSnap { docs: Snap[]; metadata: { fromCache: boolean } }
interface DocRef { get(): Promise<Snap>; set(d: object): Promise<void>; delete(): Promise<void>; onSnapshot(n: (s: Snap) => void, e?: (err: any) => void): Unsub }
interface ColRef { doc(id: string): DocRef; onSnapshot(n: (s: QSnap) => void, e?: (err: any) => void): Unsub }
export interface DB { doc(p: string): DocRef; collection(p: string): ColRef }
interface MCP { callTool(server: string, tool: string, input?: unknown): Promise<{ payload?: unknown }> }

declare global {
  interface Window { claude?: { use(name: string): Promise<any> } }
}

export const SERVER = 'StatsDeck';

export async function useCapability<T>(name: string): Promise<T | null> {
  try {
    return (await window.claude?.use(name)) ?? null;
  } catch {
    return null;
  }
}

/** Document ids can't hold every character a trade or player id might; keep them tame. */
export const docId = (s: string) => s.replace(/[^A-Za-z0-9_\-.~:@+]/g, '_').slice(0, 180);

export interface Data {
  league: League | null;
  settings: Settings;
  trades: TradeLog[];
  history: Snapshot[];
  rebuilt: Record<string, Point[]>;
  rankings: RankingWeek[];
}

export interface Status {
  phase: 'loading' | 'ready' | 'slow' | 'nodb' | 'error';
  message?: string;
  /** read-only after a refused write */
  readOnly?: boolean;
}

/**
 * Subscribes once to every document the desk reads. `onData` gets the whole picture each time
 * anything changes.
 */
export function subscribe(db: DB, onData: (d: Partial<Data>) => void, onStatus: (s: Status) => void): Unsub {
  const unsubs: Unsub[] = [];
  let confirmed = false;
  const timer = setTimeout(() => {
    if (!confirmed) onStatus({ phase: 'slow', message: "Your saved league hasn't loaded yet. It may be out of date until it does." });
  }, 10000);
  const fail = (e: any) => {
    clearTimeout(timer);
    onStatus({ phase: 'error', message: e?.code === 'revoked' ? 'This page no longer has access to its saved data.' : 'Saved data could not be read.' });
  };
  const confirm = (fromCache: boolean) => {
    if (!fromCache && !confirmed) {
      confirmed = true;
      clearTimeout(timer);
      onStatus({ phase: 'ready' });
    }
  };
  unsubs.push(
    db.doc('league/current').onSnapshot((s) => {
      onData({ league: s.exists ? (s.data() as League) : null });
      confirm(s.metadata.fromCache);
    }, fail),
    db.doc('league/settings').onSnapshot((s) => {
      onData({ settings: s.exists ? { ...emptySettings(), ...(s.data() as Settings) } : emptySettings() });
    }, fail),
    db.collection('trades').onSnapshot((q) => {
      onData({ trades: q.docs.map((d) => d.data() as TradeLog) });
    }, fail),
    db.collection('history').onSnapshot((q) => {
      onData({ history: q.docs.map((d) => d.data() as Snapshot) });
    }, fail),
    db.collection('rankings').onSnapshot((q) => {
      onData({ rankings: q.docs.map((d) => d.data() as RankingWeek) });
    }, fail),
    db.collection('rebuilt').onSnapshot((q) => {
      const r: Record<string, Point[]> = {};
      for (const d of q.docs) {
        const x = d.data() as { id: string; points: Point[] };
        if (x?.id) r[x.id] = x.points;
      }
      onData({ rebuilt: r });
    }, fail),
  );
  return () => {
    clearTimeout(timer);
    unsubs.forEach((u) => u());
  };
}

export const writes = {
  settings: (db: DB, s: Settings) => db.doc('league/settings').set(s as any),
  league: (db: DB, l: League) => db.doc('league/current').set(l as any),
  trade: (db: DB, t: TradeLog) => db.collection('trades').doc(docId(t.id)).set(t as any),
  dropTrade: (db: DB, id: string) => db.collection('trades').doc(docId(id)).delete(),
  snapshot: (db: DB, s: Snapshot) => db.collection('history').doc(s.date).set(s as any),
  ranking: (db: DB, w: RankingWeek) => db.collection('rankings').doc(w.week).set(w as any),
  rebuilt: (db: DB, id: string, points: Point[]) => db.collection('rebuilt').doc(docId(id)).set({ id, points }),
};

// ---------- StatsDeck ----------

export class SyncError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/** Turn a connector failure into something a person can act on. */
export function explainMcp(e: any): string {
  switch (e?.code) {
    case 'server_not_connected':
    case 'selection_required':
      return 'Add StatsDeck in claude.ai Settings → Connectors, then sync again.';
    case 'needs_reauth':
      return 'Reconnect StatsDeck in claude.ai Settings → Connectors, then sync again.';
    case 'not_in_manifest':
    case 'approval_required':
    case 'consent_required':
      return 'This page needs your OK to use StatsDeck. Sync again and allow it when asked.';
    case 'blocked_by_policy':
      return "Your organization's settings block StatsDeck here.";
    case 'server_unavailable':
    case 'rate_limited':
      return 'StatsDeck is busy. Try again in a minute.';
    case 'tool_error':
      return 'StatsDeck answered with an error: ' + String(e?.message ?? '').slice(0, 160);
    default:
      return e instanceof SyncError ? e.message : 'StatsDeck could not be reached. Try again in a minute.';
  }
}

async function call(mcp: MCP, tool: string, input: object = {}) {
  const r = await mcp.callTool(SERVER, tool, input);
  return r.payload;
}

/** A team name the connector can't tell apart from another: try its most distinctive word. */
async function teamPayload(mcp: MCP, name: string, all: string[]) {
  const first = await call(mcp, 'get_league_team', { team_query: name });
  if (!dataOf(first).needs_pick) return first;
  const others = all.filter((n) => n !== name).join(' ').toLowerCase();
  const words = name.split(/\s+/).filter((w) => w.length > 2).sort((a, b) => b.length - a.length);
  for (const w of words) {
    const clean = w.replace(/[’']s$/i, '').replace(/[’']/g, '');
    if (others.includes(clean.toLowerCase())) continue;
    const p = await call(mcp, 'get_league_team', { team_query: clean });
    if (!dataOf(p).needs_pick && dataOf(p).team_name === name) return p;
  }
  throw new SyncError('ambiguous', `StatsDeck couldn't pick out "${name}" from the other teams.`);
}

export interface SyncResult {
  league: League;
  trades: TradeLog[];
}

export async function syncFromStatsDeck(onStep: (s: string) => void): Promise<SyncResult> {
  const mcp = await useCapability<MCP>('mcp');
  if (!mcp) throw new SyncError('no_mcp', 'Syncing works on claude.ai with the StatsDeck connector added.');
  onStep('Reading standings');
  const standings = await call(mcp, 'get_standings');
  const names: string[] = (dataOf(standings).standings ?? []).map((r: any) => r.team_name);
  if (!names.length) throw new SyncError('empty', 'StatsDeck has no league connected. Connect your Sleeper league in StatsDeck first.');
  onStep('Reading your roster');
  const mine = await call(mcp, 'get_my_roster', { refresh: true });
  const myName: string = dataOf(mine).team_name;
  const rosters: unknown[] = [mine];
  let n = 1;
  for (const name of names) {
    if (name === myName) continue;
    onStep(`Reading rosters (${++n} of ${names.length})`);
    rosters.push(await teamPayload(mcp, name, names));
  }
  onStep('Reading league trades');
  const asOf = new Date().toISOString();
  const league = buildLeague(standings, rosters, myName, asOf);
  const trades = tradesFromPayload(await call(mcp, 'get_trades'), league);
  return { league, trades };
}

export async function playerGames(name: string): Promise<unknown> {
  const mcp = await useCapability<MCP>('mcp');
  if (!mcp) throw new SyncError('no_mcp', 'Rebuilding works on claude.ai with the StatsDeck connector added.');
  return call(mcp, 'get_player_stats', { player_name: name, timeframe: 'recent', last_n: 17 });
}
