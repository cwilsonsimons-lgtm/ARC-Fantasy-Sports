// Persistence for League Values. Its own localStorage keys — nothing here is
// shared with the fantasy app or Arc Markets.
//
//   league_values_v1         what the user owns: league id, rejected offers,
//                            ignored trades, model settings, value snapshots
//   league_values_cache_v1   what can be re-downloaded from Sleeper

const KEY = 'league_values_v1';
const CACHE = 'league_values_cache_v1';

const blank = () => ({
  leagueId: '',
  seasons: 2,
  ddUrl: '',
  params: {},
  snapshots: [],
  rejected: [],
  ignored: [],
});

const blankCache = () => ({
  leagues: [],      // Sleeper league objects, newest season first
  users: {},        // league id -> users
  rosters: [],      // current season rosters
  players: {},
  playersAt: 0,
  trades: {},       // league id -> parsed trades
  weeks: {},        // "season:week" -> { end, label, pts }
  scoringHash: '',
  syncedAt: 0,
});

function read(key, make) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...make(), ...JSON.parse(raw) } : make();
  } catch {
    return make();
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const data = read(KEY, blank);
export const cache = read(CACHE, blankCache);

export const save = () => write(KEY, data);
export const saveCache = () => write(CACHE, cache);

export function resetCache() {
  Object.assign(cache, blankCache());
  saveCache();
}

export function exportAll() {
  return JSON.stringify({ kind: 'league-values-backup', version: 1, data }, null, 1);
}

export function importAll(text) {
  const parsed = JSON.parse(text);
  if (parsed?.kind !== 'league-values-backup') throw new Error('Not a League Values backup file');
  Object.assign(data, blank(), parsed.data);
  save();
}
