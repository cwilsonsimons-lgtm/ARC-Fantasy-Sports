import { ALL_RULES } from './scoring-rules.js';

// ======================= PRESETS =======================
//
// Each preset is a sparse override: only the keys that platform actually turns
// on. Everything it does not set is zero, which is what `presetValues()` fills
// in — so a preset can never silently inherit a value from whatever was set
// before it.
//
// These reproduce each platform's *standard default* league. Their defaults are
// close to identical for offence and diverge mainly on kicking, defence and
// what they enable at all; none of them ship IDP or the long tail of
// distance-band bonuses turned on, so those stay at zero here rather than being
// invented.

const BASE_OFFENCE = {
  passYd:0.04, passTD:4, passInt:-2, pass2pt:2,
  rushYd:0.1, rushTD:6, rush2pt:2,
  recYd:0.1, recTD:6, rec2pt:2,
  fumLost:-2, fumTD:6,
  patMade:1, patMiss:-1,
  defTD:6, defSack:1, defInt:2, defFR:2, defSafety:2, defBlk:2,
  stTD:6, stpTD:6,
};

export const SCORING_PRESETS = [
  { id:'sleeper', lb:'Sleeper', values: Object.assign({}, BASE_OFFENCE, {
      rec:1,                                   // full PPR by default
      fgMade:3, fg40:1, fg50:2,                // 3 base, +1 at 40s, +2 at 50+
      fgMiss:-1,
      pa0:10, pa1:7, pa7:4, pa14:1, pa21:0, pa28:-1, pa35:-4,
    })},
  { id:'espn', lb:'ESPN', values: Object.assign({}, BASE_OFFENCE, {
      rec:0,                                   // ESPN standard is non-PPR
      passInt:-2,
      fg0:3, fg20:3, fg30:3, fg40:4, fg50:5, fg60:5,
      fgM0:-4, fgM20:-3, fgM30:-2,
      pa0:5, pa1:4, pa7:3, pa14:1, pa21:0, pa28:-1, pa35:-3,
      ya0:5, ya100:3, ya200:2, ya300:0, ya350:-1, ya400:-3, ya450:-5, ya500:-6, ya550:-7,
      defSack:2, defInt:2, defFR:2,
    })},
  { id:'yahoo', lb:'Yahoo', values: Object.assign({}, BASE_OFFENCE, {
      rec:0.5,                                 // Yahoo's default is half PPR
      passYd:0.04, passTD:4, passInt:-1,
      fgMade:3, fg0:3, fg20:3, fg30:3, fg40:4, fg50:5,
      patMade:1,
      pa0:10, pa1:7, pa7:4, pa14:1, pa21:0, pa28:-1, pa35:-4,
      defSack:1, defInt:2, defFR:2, defTD:6, defSafety:2, defBlk:2,
      stpKRYd:0, stpPRYd:0,
    })},
  { id:'nfl', lb:'NFL Fantasy', values: Object.assign({}, BASE_OFFENCE, {
      rec:0.5,
      passTD:4, passInt:-2,
      fgMade:3, fg50:5, fg40:4,
      patMade:1,
      pa0:10, pa1:7, pa7:4, pa14:1, pa21:0, pa28:-1, pa35:-4,
      defSack:1, defInt:2, defFR:2,
      stpKRYd:0.04, stpPRYd:0.04,
    })},
  { id:'cbs', lb:'CBS Sports', values: Object.assign({}, BASE_OFFENCE, {
      rec:0,
      passYd:0.04, passTD:4, passInt:-1,
      bPass300:3, bRush100:3, bRec100:3,        // CBS leans on yardage milestones
      fgMade:3, fg40:1, fg50:2,
      pa0:10, pa1:7, pa7:4, pa14:1, pa21:0, pa28:-1, pa35:-4,
      defSack:1, defInt:2, defFR:2,
    })},
];
export const PRESET_BY_ID = {};
SCORING_PRESETS.forEach(p => PRESET_BY_ID[p.id] = p);
export const DEFAULT_PRESET = 'sleeper';

/**
 * A complete value set for a preset: every rule in the catalog gets a number,
 * so switching preset never leaves a stale value behind from the last one.
 */
export function presetValues(id){
  const p = PRESET_BY_ID[id] || PRESET_BY_ID[DEFAULT_PRESET];
  const out = {};
  ALL_RULES.forEach(r => { out[r.k] = 0; });
  Object.keys(p.values).forEach(k => { if (k in out) out[k] = p.values[k]; });
  return out;
}
