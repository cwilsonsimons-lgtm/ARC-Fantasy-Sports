// Shared shapes. Everything stored in the db is one of these, so keep them plain JSON.

export type Pos = 'QB' | 'RB' | 'WR' | 'TE';
export const POSITIONS: Pos[] = ['QB', 'RB', 'WR', 'TE'];
/** Groups a team can lean towards or away from. Picks count as their own group. */
export type Group = Pos | 'PICK';
export const GROUPS: Group[] = ['QB', 'RB', 'WR', 'TE', 'PICK'];

export type Slot = 'start' | 'bench' | 'taxi' | 'ir';

export interface Player {
  id: string; // "p:<sleeper id>"
  name: string;
  pos: Pos;
  age: number;
  nfl: string;
  rookie: boolean;
  /** Recency-weighted points per game (StatsDeck form score, half-life about 3.4 games). */
  form: number;
  /** Longer-run points per game, backed out of form and the trajectory delta. */
  base: number;
  /** form/base - 1: positive when the player is running hot. */
  trend: number;
  slot: Slot;
  inj?: string;
  /** Overall draft pick for players whose value still leans on draft capital. */
  ovr?: number;
}

export interface Pick {
  id: string; // "k:<season>-<round>-<original team id>"
  season: number;
  round: number;
  orig: string; // original team id
}

export interface Team {
  id: string;
  name: string;
  wins: number;
  losses: number;
  /** 1 = first place. */
  standing: number;
  me?: boolean;
}

export interface League {
  name: string;
  asOf: string; // ISO time the rosters were read
  season: number; // the next rookie draft
  teams: Team[];
  players: Record<string, Player>;
  picks: Record<string, Pick>;
  /** asset id -> team id */
  owner: Record<string, string>;
}

/**
 * rejected  you offered it, they said no
 * countered they said no and sent something else back (log their version as `offered`)
 * accepted  they said yes
 * offered   they proposed it to you, so they'd take it
 * pending   sent, no answer yet (teaches nothing)
 * completed a trade that went through on Sleeper
 */
export type Outcome = 'rejected' | 'accepted' | 'countered' | 'offered' | 'pending' | 'completed';

/**
 * One offer or trade, always written from the point of view of `team`, the other side:
 * `give` is what `team` would give up, `get` what `team` would receive.
 * For a completed trade between two other teams, `with` names the second team.
 */
export interface TradeLog {
  id: string;
  ts: string;
  team: string;
  with: string; // the counterparty team id (usually me)
  give: string[];
  get: string[];
  outcome: Outcome;
  source: 'manual' | 'sleeper';
  note?: string;
  /** For a countered offer: the counter they sent back, as another log id. */
  counterOf?: string;
}

/** A manual nudge: "this manager loves this player" (+0.2 = values him 20% higher). */
export interface Nudge {
  team: string;
  asset: string;
  pct: number;
}

export interface TeamTraits {
  /** 0 = only longer-run production matters, 1 = only the hot streak. Market is 0.5. */
  recency?: number;
  /** Extra value the manager places on his own players (0.1 = 10%). */
  endowment?: number;
  /** Override for the contender (+1) / rebuilder (-1) read. */
  window?: number;
  /** Short name of the manager, e.g. "Jake". */
  manager?: string;
}

export interface Settings {
  traits: Record<string, TeamTraits>;
  nudges: Nudge[];
  /** Market value overrides by asset id, e.g. pasted from KeepTradeCut. */
  market: Record<string, number>;
  marketAsOf?: string;
  marketSource?: string;
}

export const emptySettings = (): Settings => ({ traits: {}, nudges: [], market: {} });

/** What the learner took from the trade log, per team. All on a log scale. */
export interface Learned {
  /** asset id -> log multiplier */
  asset: Record<string, Record<string, number>>;
  /** group -> log multiplier */
  group: Record<string, Partial<Record<Group, number>>>;
  /** extra edge a team wants before it says yes, as a share of the trade's size */
  margin: Record<string, number>;
  observations: number;
}

export const emptyLearned = (): Learned => ({ asset: {}, group: {}, margin: {}, observations: 0 });

/** A dated read of values: market plus every team's view. */
export interface Snapshot {
  date: string; // YYYY-MM-DD
  ts: string;
  market: Record<string, number>;
  teams: Record<string, Record<string, number>>;
}
