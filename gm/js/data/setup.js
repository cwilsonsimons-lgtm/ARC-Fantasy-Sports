// What a promotion is before anybody has wrestled in it.
//
// A setup is a small, serialisable description of a starting position: the
// promotion's name, the GM's level, the belts on the wall, the money in the
// account, and the roster. Everything else about a save is generated from the
// seed, which is why a setup stays short enough to paste into a message.
//
// That is the whole trick behind sharing one. The roster is not carried as
// twenty wrestlers with eleven traits each — it is carried as a seed, plus the
// edits made on top of it. Two people with the same code get the same locker
// room down to who is already injured.
import { BASE_TITLES, UNLOCKABLE_TITLES } from './titles.js';

export const SETUP_VERSION = 1;

export const ROSTER_RANGE = { min: 8, max: 30 };
export const LEVEL_RANGE = { min: 1, max: 30 };

// Money is a starting position, not a difficulty setting with a name. The
// labels say what the number means in weeks of wages rather than calling one
// of them 'normal', because which of these is hard depends on how big a roster
// you put on top of it.
export const BUDGET_PRESETS = [
  { id: 'shoestring', label: 'Shoestring', amount: 40000,
    note: 'A few weeks of wages and nothing behind it.' },
  { id: 'modest', label: 'Modest', amount: 120000,
    note: 'Room to be wrong about one or two things.' },
  { id: 'backed', label: 'Backed', amount: 300000,
    note: 'Somebody upstairs believes in this.' },
  { id: 'flush', label: 'Flush', amount: 750000,
    note: 'The money is not the problem. The people are.' },
];

export const AIR_NIGHTS = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];

export const ALL_TITLES = [...BASE_TITLES, ...UNLOCKABLE_TITLES];

export function titleTemplateFor(key) {
  return ALL_TITLES.find(t => t.key === key) || null;
}

export function defaultSetup(seed) {
  return {
    v: SETUP_VERSION,
    seed,
    promotion: null,      // filled from the seed, then editable
    show: null,
    airNight: null,
    level: 1,
    budget: BUDGET_PRESETS[1].amount,
    titles: BASE_TITLES.map(t => t.key),
    rosterSize: 16,
    // Sparse: only the wrestlers actually changed appear here, keyed by their
    // index in the generated roster. A setup with no edits is a handful of
    // fields and a seed.
    edits: {},
    dropped: [],
  };
}

// ---------------------------------------------------------------- sharing

// Base64 of the JSON, URL-safe. Not encryption and not meant to be — somebody
// who wants to read a setup code should be able to, and somebody who wants to
// hand-edit one has earned it.
export function encodeSetup(setup) {
  const json = JSON.stringify(compact(setup));
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeSetup(code) {
  try {
    const padded = code.trim().replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return valid(parsed) ? fill(parsed) : null;
  } catch {
    return null;
  }
}

// Anything left at its default is dropped before encoding, so a code for a
// lightly-tweaked promotion stays short.
function compact(setup) {
  const base = defaultSetup(setup.seed);
  const out = { v: SETUP_VERSION, seed: setup.seed };
  for (const key of Object.keys(base)) {
    if (key === 'v' || key === 'seed') continue;
    const value = setup[key];
    if (JSON.stringify(value) === JSON.stringify(base[key])) continue;
    if (value === null || value === undefined) continue;
    out[key] = value;
  }
  return out;
}

function fill(parsed) {
  return { ...defaultSetup(parsed.seed), ...parsed };
}

// A code from a future build, or one somebody has mangled, should be refused
// with a sentence rather than crashing the screen it was pasted into.
function valid(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  if (parsed.v !== SETUP_VERSION) return false;
  if (!Number.isFinite(parsed.seed)) return false;
  if (parsed.level !== undefined
    && (!Number.isFinite(parsed.level) || parsed.level < LEVEL_RANGE.min || parsed.level > LEVEL_RANGE.max)) return false;
  if (parsed.budget !== undefined && (!Number.isFinite(parsed.budget) || parsed.budget < 0)) return false;
  if (parsed.rosterSize !== undefined
    && (!Number.isFinite(parsed.rosterSize) || parsed.rosterSize < ROSTER_RANGE.min || parsed.rosterSize > ROSTER_RANGE.max)) return false;
  if (parsed.titles !== undefined
    && (!Array.isArray(parsed.titles) || parsed.titles.some(k => !titleTemplateFor(k)))) return false;
  return true;
}
