// Persistence for the matchup builder.
//
// Everything lives in localStorage under its own keys, so the builder can be
// cleared without touching the app's save (`cbd_team_v1`). Three shapes:
//
//   cbd_builder_v1          the league: teams, weeks, entered scores, captions
//   cbd_builder_logos_v1    one bundle of every logo dataURL, keyed by team id
//   cbd_builder_player_*    one key per uploaded player cut-out (they are large)
//
// Logos are bundled rather than stored per team because they are read together
// on every load; player art is not, and lives in its own keys so a team with a
// dozen cut-outs does not have to be parsed to draw a graphic without them.
import { MY_TEAM, T } from '../data/teams.js';
import { store as appStore } from '../store.js';
import { DEFAULT_SLOTS, GAMES_PER_WEEK, WEEKS, leagueSchedule } from './data.js';

export const LEAGUE_KEY = 'cbd_builder_v1';
export const LOGOS_KEY = 'cbd_builder_logos_v1';
export const playerKey = (tid, pid) => `cbd_builder_player_${tid}_${pid}`;

export const emptyWeek = () =>
  Array.from({ length: GAMES_PER_WEEK }, () => ({ a: '', b: '', sa: '', sb: '', ba: '', bb: '' }));

// Teams come from the app's table; the builder only adds a player-art list.
// A new league starts on the app's own round-robin rather than empty — the first
// thing anyone wants is this week's matchup, not a blank schedule form.
export const freshLeague = () => applyLeagueSchedule({
  v: 1,
  teams: Object.keys(T).map((id) => ({
    id,
    name: T[id].n,
    color: T[id].c,
    font: T[id].font,
    players: [],
  })),
  weeks: Array.from({ length: WEEKS }, emptyWeek),
  logoSlots: structuredClone(DEFAULT_SLOTS),
});

export function loadLeague() {
  let lg = freshLeague();
  try {
    const raw = localStorage.getItem(LEAGUE_KEY);
    const parsed = raw && JSON.parse(raw);
    if (parsed && parsed.teams && parsed.teams.length) lg = parsed;
  } catch (e) { /* first run, or storage unavailable */ }
  return migrate(lg);
}

// Older saves are lifted rather than discarded: a season of entered scores is
// the one thing here that cannot be regenerated.
export function migrate(lg) {
  if (!lg.logoSlots) lg.logoSlots = structuredClone(DEFAULT_SLOTS);
  if (!lg.weeks || !lg.weeks.length) lg.weeks = Array.from({ length: WEEKS }, emptyWeek);
  while (lg.weeks.length < WEEKS) lg.weeks.push(emptyWeek());
  lg.weeks.forEach((wk) => {
    while (wk.length < GAMES_PER_WEEK) wk.push({ a: '', b: '', sa: '', sb: '', ba: '', bb: '' });
  });
  // A team added to the app since the last save appears here with no art.
  const known = new Set(lg.teams.map((t) => t.id));
  Object.keys(T).forEach((id) => {
    if (known.has(id)) return;
    lg.teams.push({ id, name: T[id].n, color: T[id].c, font: T[id].font, players: [] });
  });
  lg.teams.forEach((t) => { if (!t.players) t.players = []; });
  return lg;
}

let saveTimer = null;
let onSaveNote = () => {};
export function setSaveNotifier(fn) { onSaveNote = fn; }

export function persistLeague(lg) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (writeKey(LEAGUE_KEY, JSON.stringify(lg))) onSaveNote('Saved');
  }, 500);
}

// One place to turn a full quota into a message rather than a silent no-op.
export function writeKey(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    onSaveNote('Storage full — remove some uploaded art', true);
    return false;
  }
}
export function readKey(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
export function removeKey(key) {
  try { localStorage.removeItem(key); } catch (e) {}
}

// ---------- logo bundle ----------
export function loadLogoBundle() {
  let bundle = {};
  try {
    const raw = readKey(LOGOS_KEY);
    if (raw) bundle = JSON.parse(raw) || {};
  } catch (e) {}
  // The app saves the user's own crest under `store.team.logo` (Team ▸ crest).
  // Seed it here so a logo uploaded in the app already sits on the graphic.
  const mine = appStore && appStore.team && appStore.team.logo;
  if (mine && !bundle[MY_TEAM]) bundle[MY_TEAM] = mine;
  return bundle;
}
export function saveLogoBundle(bundle) {
  return writeKey(LOGOS_KEY, JSON.stringify(bundle));
}

// ---------- images ----------
export const dataUrlToImage = (url) =>
  new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });

// Read an uploaded file and hand back both a downscaled dataURL (for storage)
// and a decoded Image (for the canvas). Uploads off a phone are routinely 4 MB+;
// localStorage tops out around 5 MB for everything combined.
export function readImageFile(file, maxDim, mime = 'image/png', quality = 0.92) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onerror = () => resolve(null);
    r.onload = () => {
      const img = new Image();
      img.onerror = () => resolve(null);
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          const s = maxDim / Math.max(w, h);
          w = Math.max(1, Math.round(w * s));
          h = Math.max(1, Math.round(h * s));
        }
        let url = r.result;
        try {
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          url = c.toDataURL(mime, quality);
        } catch (e) { /* canvas blocked — keep the original */ }
        dataUrlToImage(url).then((decoded) => resolve({ url, img: decoded || img }));
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}

// ---------- schedule ----------
// Fill the weeks with the league's own round-robin, keeping any score or caption
// already entered for a pairing that has not changed.
export function applyLeagueSchedule(lg) {
  const sched = leagueSchedule();
  lg.weeks = sched.map((pairs, wi) =>
    pairs.map(([a, b], mi) => {
      const old = lg.weeks[wi] && lg.weeks[wi][mi];
      const same = old && ((old.a === a && old.b === b) || (old.a === b && old.b === a));
      return same ? old : { a, b, sa: '', sb: '', ba: '', bb: '' };
    })
  );
  return lg;
}
