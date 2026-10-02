// The fictional league: 16 teams, ~14 notable players each, and the weekly
// performance model that drives popularity — breakouts, slumps, injuries,
// retirements and each spring's rookie class.
import type { GameState, Player, Pos, Team } from './types';
import { makeRng, type Rng } from './rng';

export const START_YEAR = 2026;
export const WEEKS_PER_YEAR = 52;
export const SEASON_WEEKS = 18;
export const DRAFT_WEEK = 34;

export const TEAMS: Team[] = [
  { id: 'ATL', city: 'Atlantic City', name: 'Admirals', abbr: 'ACA', primary: '#0b3d91', secondary: '#f2c14e', market: 0.55 },
  { id: 'BIR', city: 'Birmingham', name: 'Forge', abbr: 'BIR', primary: '#8c1c13', secondary: '#2b2b2b', market: 0.45 },
  { id: 'BOI', city: 'Boise', name: 'Peregrines', abbr: 'BOI', primary: '#1f6f50', secondary: '#e9c46a', market: 0.3 },
  { id: 'CHI', city: 'Chicago', name: 'Stockyards', abbr: 'CHS', primary: '#5b2333', secondary: '#c9a227', market: 0.9 },
  { id: 'DEN', city: 'Denver', name: 'Thunderheads', abbr: 'DEN', primary: '#3d348b', secondary: '#f7b801', market: 0.65 },
  { id: 'HOU', city: 'Houston', name: 'Roughnecks', abbr: 'HOU', primary: '#d1495b', secondary: '#00798c', market: 0.8 },
  { id: 'KCI', city: 'Kansas City', name: 'Monarchs', abbr: 'KCM', primary: '#6a0dad', secondary: '#ffd166', market: 0.6 },
  { id: 'LBC', city: 'Long Beach', name: 'Breakers', abbr: 'LBB', primary: '#0081a7', secondary: '#fed9b7', market: 0.75 },
  { id: 'MEM', city: 'Memphis', name: 'Kings', abbr: 'MEM', primary: '#2d3047', secondary: '#e0a458', market: 0.5 },
  { id: 'NOR', city: 'Norfolk', name: 'Ironclads', abbr: 'NOR', primary: '#33415c', secondary: '#c5c3c6', market: 0.4 },
  { id: 'OAK', city: 'Oakland', name: 'Redwoods', abbr: 'OAK', primary: '#386641', secondary: '#bc4749', market: 0.7 },
  { id: 'PIT', city: 'Pittsburgh', name: 'Smelters', abbr: 'PIT', primary: '#222222', secondary: '#f4a261', market: 0.7 },
  { id: 'SAC', city: 'Sacramento', name: 'Gold Rush', abbr: 'SAC', primary: '#b8860b', secondary: '#14213d', market: 0.45 },
  { id: 'SAN', city: 'San Antonio', name: 'Vaqueros', abbr: 'SAV', primary: '#9a031e', secondary: '#e36414', market: 0.6 },
  { id: 'TAC', city: 'Tacoma', name: 'Timberwolves', abbr: 'TAC', primary: '#264653', secondary: '#2a9d8f', market: 0.4 },
  { id: 'TUL', city: 'Tulsa', name: 'Drillers', abbr: 'TUL', primary: '#e76f51', secondary: '#264653', market: 0.35 },
];

const FIRST = ['Ace', 'Marcus', 'Deshawn', 'Tyler', 'Jalen', 'Cody', 'Malik', 'Brock', 'Isaiah', 'Trey', 'Quinton', 'Dante',
  'Elijah', 'Rashad', 'Colt', 'Nico', 'Darius', 'Owen', 'Xavier', 'Bryce', 'Luca', 'Terrell', 'Grady', 'Amari', 'Mason',
  'Devonte', 'Cam', 'Jace', 'Rory', 'Kendrick', 'Zeke', 'Tobias', 'Andre', 'Wes', 'Keon', 'Silas', 'Rhett', 'Jamal',
  'Beau', 'Kai', 'Lamar', 'Theo', 'Dorian', 'Hollis', 'Emmitt', 'Jaylin', 'Marlon', 'Reid', 'Tavon', 'Gideon'];
const LAST = ['Malone', 'Okafor', 'Vance', 'Brightwater', 'Castellano', 'Pruitt', 'Holloway', 'Kingsley', 'Dunmore', 'Achebe',
  'Ridley', 'Fontaine', 'Gatewood', 'Merriweather', 'Lockhart', 'Sorensen', 'Baptiste', 'Whitfield', 'Ashby', 'Calloway',
  'Mbeki', 'Hargrove', 'Stroud', 'Delacroix', 'Pennington', 'Rourke', 'Tillman', 'Osei', 'Larkspur', 'Bannister', 'Crowder',
  'Ellery', 'Faulkner', 'Greer', 'Ingram', 'Jessup', 'Kowalski', 'Langford', 'Moreau', 'Nakamura', 'Odom', 'Paxton',
  'Quarles', 'Redmond', 'Saltzman', 'Truitt', 'Underhill', 'Varga', 'Winslow', 'Yarbrough', 'Zeller', 'Abernathy',
  'Blackwood', 'Cobb', 'Draper', 'Easley', 'Fairchild', 'Goins', 'Huxley', 'Iverson'];

const ROSTER: Pos[] = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'DL', 'DL', 'LB', 'LB', 'CB', 'S', 'K'];

/** How much fans care about a position, added to popularity targets. */
export const POS_APPEAL: Record<Pos, number> = { QB: 14, RB: 6, WR: 8, TE: 0, DL: -6, LB: -6, CB: -4, S: -7, K: -22 };

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function weekOfYear(week: number) {
  return ((week - 1) % WEEKS_PER_YEAR) + 1;
}
export function seasonYear(week: number) {
  return START_YEAR + Math.floor((week - 1) / WEEKS_PER_YEAR);
}
export function isGameWeek(week: number) {
  return weekOfYear(week) <= SEASON_WEEKS;
}
/** Calendar date of the Monday of a game week. Week 1 is 7 Sep 2026. */
export function weekDate(week: number) {
  const d = new Date(Date.UTC(2026, 8, 7 + (week - 1) * 7));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
export function weekLabel(week: number) {
  const wy = weekOfYear(week);
  const y = seasonYear(week);
  if (wy <= SEASON_WEEKS) return `${y} season · Wk ${wy}`;
  if (wy <= 22) return `${y} playoffs`;
  return `${y + 1} offseason`;
}

export function playerName(p: Player) {
  return `${p.first} ${p.last}`;
}

function makePlayer(rng: Rng, id: string, teamId: string, pos: Pos, year: number, rookie: boolean, used: Set<string>): Player {
  let first = '';
  let last = '';
  for (let tries = 0; tries < 50; tries++) {
    first = rng.pick(FIRST);
    last = rng.pick(LAST);
    if (!used.has(first + last)) break;
  }
  used.add(first + last);
  const age = rookie ? rng.int(21, 23) : rng.int(23, 34);
  const rookieYear = rookie ? year : year - (age - 22) - rng.int(0, 1);
  // Talent: a few stars, many role players.
  const skill = clamp(Math.round(rng.normal(rookie ? 60 : 66, 12)), 30, 97);
  const potential = clamp(Math.round(skill + (age < 26 ? Math.abs(rng.normal(8, 8)) : rng.normal(0, 3))), skill, 99);
  const popularity = clamp(Math.round(skill * 0.75 + POS_APPEAL[pos] + rng.normal(0, 8) + (rookie ? 6 : 0)), 3, 99);
  return {
    id,
    first,
    last,
    teamId,
    pos,
    jersey: pos === 'QB' ? rng.int(1, 19) : pos === 'K' ? rng.int(1, 9) : rng.int(10, 99),
    age,
    rookieYear,
    skill,
    potential,
    form: clamp(Math.round(skill + rng.normal(0, 5)), 20, 99),
    popularity,
    status: 'active',
    injuryWeeks: 0,
    slumpWeeks: 0,
    season: { games: 0, yards: 0, tds: 0 },
    hist: [],
  };
}

export function createLeague(seed: number): { teams: Team[]; players: Record<string, Player>; nextId: number } {
  const rng = makeRng(seed ^ 0x51ed);
  const players: Record<string, Player> = {};
  const used = new Set<string>();
  let n = 1;
  for (const t of TEAMS) {
    ROSTER.forEach((pos, i) => {
      const rookie = (i === 1 || i === 4) ? rng.chance(0.55) : rng.chance(0.08);
      const id = `p${n++}`;
      players[id] = makePlayer(rng, id, t.id, pos, START_YEAR, rookie, used);
    });
  }
  // Seed a handful of established superstars so the market has headliners.
  const ids = Object.keys(players);
  for (let i = 0; i < 6; i++) {
    const p = players[rng.pick(ids)];
    p.skill = rng.int(90, 97);
    p.potential = Math.max(p.potential, p.skill);
    p.form = p.skill;
    p.popularity = clamp(p.skill + POS_APPEAL[p.pos] / 2, 0, 99);
  }
  return { teams: TEAMS.map((t) => ({ ...t })), players, nextId: n };
}

export interface LeagueEvent {
  kind: 'breakout' | 'slump' | 'injury' | 'season-ending' | 'return' | 'retired' | 'rookie-class' | 'big-game';
  playerId?: string;
  detail: string;
}

/** Advance every player one week. Mutates state.players; returns notable events. */
export function simulateLeagueWeek(state: GameState, rng: Rng): LeagueEvent[] {
  const events: LeagueEvent[] = [];
  const week = state.week;
  const wy = weekOfYear(week);
  const year = seasonYear(week);
  const inSeason = isGameWeek(week);

  if (wy === 1) for (const p of Object.values(state.players)) p.season = { games: 0, yards: 0, tds: 0 };

  for (const p of Object.values(state.players)) {
    if (p.status === 'retired') {
      p.popularity = clamp(p.popularity * 0.985, 0, 100);
      continue;
    }
    const team = state.teams.find((t) => t.id === p.teamId)!;
    if (inSeason) {
      if (p.status === 'injured') {
        p.injuryWeeks--;
        p.popularity -= 0.5;
        if (p.injuryWeeks <= 0) {
          p.status = 'active';
          p.injuryWeeks = 0;
          if (p.popularity > 55) events.push({ kind: 'return', playerId: p.id, detail: 'returns from injury' });
        }
      } else {
        const slump = p.slumpWeeks > 0 ? 14 : 0;
        if (p.slumpWeeks > 0) p.slumpWeeks--;
        const perf = clamp(p.skill + rng.normal(0, 11) - slump, 0, 100);
        p.form = p.form * 0.68 + perf * 0.32;
        p.season.games++;
        const yardsBase: Partial<Record<Pos, number>> = { QB: 250, RB: 80, WR: 70, TE: 45 };
        const yb = yardsBase[p.pos] ?? 0;
        if (yb) p.season.yards += Math.max(0, Math.round(yb * (perf / 70) + rng.normal(0, yb * 0.2)));
        p.season.tds += rng.poisson(p.pos === 'QB' ? (perf / 70) * 1.8 : yb ? (perf / 70) * 0.45 : 0.05);
        if (perf > 95 && p.popularity > 45 && rng.chance(0.35)) {
          events.push({ kind: 'big-game', playerId: p.id, detail: 'posts a monster game' });
          p.popularity += 2;
        }
        // Development and events.
        if (p.potential > p.skill) p.skill += (p.potential - p.skill) * 0.012;
        if (p.age <= 25 && p.potential - p.skill > 4 && rng.chance(0.012)) {
          const jump = rng.int(7, 13);
          p.skill = clamp(p.skill + jump, 0, 99);
          p.potential = Math.max(p.potential, p.skill);
          p.form = clamp(p.form + jump, 0, 100);
          events.push({ kind: 'breakout', playerId: p.id, detail: 'breaks out' });
        } else if (p.slumpWeeks === 0 && rng.chance(0.014)) {
          p.slumpWeeks = rng.int(3, 5);
          if (p.popularity > 50) events.push({ kind: 'slump', playerId: p.id, detail: 'falls into a slump' });
        }
        if (rng.chance(0.02)) {
          const severe = rng.chance(0.12);
          p.status = 'injured';
          p.injuryWeeks = severe ? 30 : rng.int(1, 6);
          if (severe) p.popularity -= 6;
          if (p.popularity > 45 || severe) {
            events.push({ kind: severe ? 'season-ending' : 'injury', playerId: p.id, detail: severe ? 'suffers a season-ending injury' : `is out ${p.injuryWeeks} week${p.injuryWeeks > 1 ? 's' : ''}` });
          }
        }
      }
    } else {
      // Offseason: injuries heal, form drifts back toward talent.
      if (p.status === 'injured') {
        p.injuryWeeks -= 1;
        if (p.injuryWeeks <= 0) {
          p.status = 'active';
          p.injuryWeeks = 0;
        }
      }
      p.form = p.form * 0.95 + p.skill * 0.05;
    }
    const rookieBuzz = p.rookieYear >= year ? 6 : 0;
    const target = 0.5 * p.form + 0.3 * p.skill + POS_APPEAL[p.pos] + team.market * 12 + rookieBuzz - 4;
    p.popularity = clamp(p.popularity + (target - p.popularity) * (inSeason ? 0.1 : 0.03) + rng.normal(0, 0.8), 1, 99);
    p.hist.push({ w: week, pop: Math.round(p.popularity * 10) / 10, form: Math.round(p.form * 10) / 10 });
    if (p.hist.length > 104) p.hist.shift();
  }

  if (wy === DRAFT_WEEK) {
    const used = new Set(Object.values(state.players).map((p) => p.first + p.last));
    const names: string[] = [];
    for (const t of state.teams) {
      const pos = rng.pick(['QB', 'RB', 'WR', 'WR', 'TE', 'DL', 'LB', 'CB'] as Pos[]);
      const id = `p${state.nextId++}`;
      const p = makePlayer(rng, id, t.id, pos, year + 1, true, used);
      p.age = rng.int(21, 22);
      state.players[id] = p;
      names.push(`${p.first} ${p.last} (${pos}, ${t.abbr})`);
    }
    const top = Object.values(state.players).filter((p) => p.rookieYear === year + 1).sort((a, b) => b.popularity - a.popularity)[0];
    events.push({ kind: 'rookie-class', playerId: top?.id, detail: `The ${year + 1} rookie class arrives. Headliner: ${top ? playerName(top) : '—'}.` });
  }

  if (wy === WEEKS_PER_YEAR) {
    for (const p of Object.values(state.players)) {
      if (p.status === 'retired') continue;
      p.age++;
      if (p.age > 29) p.skill = clamp(p.skill - rng.int(0, 4), 20, 99);
      const pRetire = p.age >= 33 ? 0.25 + 0.12 * (p.age - 33) : p.age > 30 && p.skill < 50 ? 0.2 : 0;
      if (rng.chance(pRetire)) {
        p.status = 'retired';
        if (p.skill > 82) p.popularity = clamp(p.popularity + 4, 0, 99);
        if (p.popularity > 50) events.push({ kind: 'retired', playerId: p.id, detail: 'retires' });
      }
    }
  }
  return events;
}
