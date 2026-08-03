import { ALL_RULES, RULE_BY_KEY } from './data/scoring-rules.js';
import { DEFAULT_PRESET, presetValues } from './data/scoring-presets.js';
import { activeLeagueId, myLeagues } from './leagues.js';
import { isCommish } from './settings.js';
import { saveStore, store } from './store.js';

// ======================= SCORING ENGINE =======================
//
// No point value lives in here. The engine walks the catalog, looks each rule's
// key up in the stat line, and multiplies by whatever the league has stored.
// That is the whole of it — which is why a new rule needs a row in the catalog
// and nothing else: `scoreStats` will pick it up the next time it runs.
//
// Storage is the app's guarded localStorage wrapper, which is this prototype's
// database. Scoring is per league, like everything else above league scope:
//
//   store.scoringByLeague[leagueId] = {ruleKey: value}

export function scoringBag(id){
  const lid = id || activeLeagueId();
  if (!store.scoringByLeague) store.scoringByLeague = {};
  if (!store.scoringByLeague[lid]) {
    // a league created by the wizard carries its own copy; anything else starts
    // from the default preset rather than from whatever was last edited
    const mine = myLeagues().find(l => l.id === lid);
    store.scoringByLeague[lid] = Object.assign(
      presetValues(DEFAULT_PRESET),
      (mine && mine.scoring) || {}
    );
    if (!store.scoringPreset) store.scoringPreset = {};
    if (!store.scoringPreset[lid]) store.scoringPreset[lid] = DEFAULT_PRESET;
    saveStore();
  }
  return store.scoringByLeague[lid];
}
export function scoreValue(k){ const v = scoringBag()[k]; return typeof v === 'number' ? v : 0; }
// Writes are commissioner-only, gated here rather than in the UI so a stray
// inline onclick cannot get round it — the same rule `setLeague` and `setSlot`
// follow over in settings.js.
export function setScoreValue(k, v){
  if (!isCommish() || !RULE_BY_KEY[k]) return;
  const n = Math.round((+v || 0) * 10000) / 10000;
  scoringBag()[k] = Math.max(-100, Math.min(100, n));
  saveStore();
}
export function activePreset(){
  const lid = activeLeagueId();
  return (store.scoringPreset || {})[lid] || DEFAULT_PRESET;
}
export function applyPreset(id){
  if (!isCommish()) return;
  const lid = activeLeagueId();
  store.scoringByLeague = store.scoringByLeague || {};
  store.scoringPreset = store.scoringPreset || {};
  store.scoringByLeague[lid] = presetValues(id);
  store.scoringPreset[lid] = id;
  saveStore();
}
/** Reset restores the preset the league is on, not a global default. */
export function resetScoringToPreset(){ applyPreset(activePreset()); }

/** True when the league has edited away from its preset. */
export function isDirty(){
  const base = presetValues(activePreset()), cur = scoringBag();
  return ALL_RULES.some(r => (cur[r.k] || 0) !== (base[r.k] || 0));
}

// ---------------------------------------------------------------- favourites
export function favourites(){
  if (!store.scoringFavs) store.scoringFavs = [];
  return store.scoringFavs;
}
export function isFav(k){ return favourites().indexOf(k) > -1; }
export function toggleFav(k){
  const f = favourites(), i = f.indexOf(k);
  if (i > -1) f.splice(i, 1); else f.push(k);
  saveStore();
}

// ---------------------------------------------------------------- search
/** Matches label, category, group and the help text, so "touchdown" finds every
 *  touchdown rule wherever it lives. */
export function searchRules(q){
  q = (q || '').trim().toLowerCase();
  if (!q) return null;
  return ALL_RULES.filter(r =>
    r.lb.toLowerCase().includes(q) ||
    r.catLb.toLowerCase().includes(q) ||
    r.group.toLowerCase().includes(q) ||
    (r.help || '').toLowerCase().includes(q));
}

// ---------------------------------------------------------------- the engine
/**
 * Turn one stat line into points.
 *
 * `stats` is a flat object keyed the same way the catalog is — `passYd`, `rec`,
 * `defSack` and so on. Anything the catalog knows about and the stat line
 * carries gets multiplied by the league's value; anything else contributes
 * nothing. Bonuses are counted by the stat line too (`bRec100: 1`), so a rule
 * that fires once is simply a stat that equals one.
 *
 * `pos` is only needed for the position-scoped rules (TE premium and the
 * first-down bonuses), which apply on top of the general rule.
 */
export function scoreStats(stats, opts){
  opts = opts || {};
  const bag = opts.scoring || scoringBag();
  const pos = opts.pos || null;
  let total = 0;
  const lines = [];
  ALL_RULES.forEach(r => {
    const n = +stats[r.k] || 0;
    if (!n) return;
    const v = +bag[r.k] || 0;
    if (!v) return;
    const pts = n * v;
    total += pts;
    lines.push({ k: r.k, lb: r.lb, n, v, pts: Math.round(pts * 100) / 100 });
  });
  // position-scoped extras: catches and first downs the general rules already
  // counted, paid again at the position rate
  const posRec = { RB:'recRB', WR:'recWR', TE:'recTE' }[pos];
  if (posRec && stats.rec) {
    const v = +bag[posRec] || 0;
    if (v) { const pts = stats.rec * v; total += pts;
      lines.push({ k: posRec, lb: RULE_BY_KEY[posRec].lb, n: stats.rec, v, pts: Math.round(pts * 100) / 100 }); }
  }
  const posFD = { QB:'fdQB', RB:'fdRB', WR:'fdWR', TE:'fdTE' }[pos];
  const fdCount = (+stats.passFD || 0) + (+stats.rushFD || 0) + (+stats.recFD || 0);
  if (posFD && fdCount) {
    const v = +bag[posFD] || 0;
    if (v) { const pts = fdCount * v; total += pts;
      lines.push({ k: posFD, lb: RULE_BY_KEY[posFD].lb, n: fdCount, v, pts: Math.round(pts * 100) / 100 }); }
  }
  return { total: Math.round(total * 100) / 100, lines };
}

/**
 * A deterministic stat line for a player and week, shaped by position and sized
 * to their projection. The prototype has no play-by-play, so this is what the
 * engine is given to chew on — same player, same week, same line every time.
 */
export function statLineFor(p, week){
  const key = (p && (p.id || p.n)) || '';
  let h = 2166136261; const s = key + '#' + (week || 1);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  const r = n => ((h = Math.imul(h ^ (h >>> 15), 2246822507)) >>> 0) % n;
  const proj = Math.max(0, +p.proj || 0);
  const pos = p.pos || 'WR';
  const out = {};
  if (pos === 'QB') {
    out.passYd = Math.round(proj * 11 + r(60));
    out.passTD = Math.round(proj / 9);
    out.passComp = Math.round(out.passYd / 11);
    out.passAtt = out.passComp + 8 + r(8);
    out.passInc = out.passAtt - out.passComp;
    out.passInt = r(10) < 4 ? 1 : 0;
    out.passFD = Math.round(out.passComp * 0.45);
    out.rushYd = r(30);
    out.rushAtt = 2 + r(4);
    out.passSacked = r(4);
    if (out.passYd >= 400) out.bPass400 = 1; else if (out.passYd >= 300) out.bPass300 = 1;
    if (out.passComp >= 25) out.bComp25 = 1;
  } else if (pos === 'RB') {
    out.rushYd = Math.round(proj * 4.5 + r(25));
    out.rushAtt = Math.round(out.rushYd / 4.3) + 1;
    out.rushTD = r(10) < 5 ? 1 : 0;
    out.rec = 1 + r(5);
    out.recYd = out.rec * (5 + r(7));
    out.rushFD = Math.round(out.rushAtt * 0.22);
    out.recFD = Math.round(out.rec * 0.5);
    if (out.rushYd >= 200) out.bRush200 = 1; else if (out.rushYd >= 100) out.bRush100 = 1;
    if (out.rushAtt >= 20) out.bCarry20 = 1;
  } else {
    out.rec = Math.max(1, Math.round(proj / 3));
    out.recYd = Math.round(proj * 6 + r(20));
    out.recTD = r(10) < 4 ? 1 : 0;
    out.recFD = Math.round(out.rec * 0.6);
    if (out.recYd >= 200) out.bRec200 = 1; else if (out.recYd >= 100) out.bRec100 = 1;
  }
  const comb = (out.rushYd || 0) + (out.recYd || 0);
  if (pos !== 'QB') { if (comb >= 200) out.bComb200 = 1; else if (comb >= 100) out.bComb100 = 1; }
  if (r(20) === 0) { out.fum = 1; out.fumLost = 1; }
  return out;
}

/** What this player would score this week under the league's current settings. */
export function scorePlayer(p, week){
  return scoreStats(statLineFor(p, week), { pos: p && p.pos });
}
