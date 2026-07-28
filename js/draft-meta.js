// Draft metadata: badges, reactions, and the settings a commissioner controls.
//
// The point of this file is permanence. A pick is not just "who went where" - it
// is who was on the clock, how long they took, whether the board thought it was a
// steal, and what the league said about it at the time. Years later that is the
// part people actually reopen a draft to see, so it is stored with the pick
// rather than left in a chat log.
import { store, saveStore } from './store.js';
import { T, MY_TEAM } from './data/teams.js';
import { NFL_BY_ID } from './data/nfl-players.js';
import { DRAFT_ORDER } from './clock.js';

// ---------------------------------------------------------------- settings
export const REACTIONS = [
  ['👍', 'Great Pick'], ['🔥', 'Love It'], ['😂', 'Reach'], ['😬', 'Bold'],
  ['💎', 'Steal'], ['🤯', 'WTF'], ['❤️', 'Favorite'], ['👏', 'Nice'],
];

const CFG_DEFAULTS = {
  clutchSec: 5,        // pick submitted faster than this earns the clutch badge
  clutchIcon: '⚡',     // commissioner may swap for any emoji
  autoIcon: '🕒',
  reachIcon: '🔥',
  stealIcon: '💎',
  reachBy: 12,         // picks taken this far ahead of ADP
  stealBy: 12,         // …or this far past it
  badges: { auto: true, clutch: true, reach: true, steal: true },
};

export function draftCfg(){
  if(!store.draft) store.draft = { picks: [] };
  store.draft.cfg = Object.assign({}, CFG_DEFAULTS, store.draft.cfg || {});
  store.draft.cfg.badges = Object.assign({}, CFG_DEFAULTS.badges, store.draft.cfg.badges || {});
  return store.draft.cfg;
}
export function setDraftCfg(k, v){
  const c = draftCfg();
  if (k.indexOf('badges.') === 0) c.badges[k.slice(7)] = v; else c[k] = v;
  saveStore();
}

// ---------------------------------------------------------------- migration
// v1 stored picks as bare player-id strings. Lift them to records so they can
// carry history; anything already migrated passes through untouched.
export function migrateDraft(){
  if(!store.draft) store.draft = { picks: [] };
  const p = store.draft.picks || [];
  if (p.length && typeof p[0] === 'string') {
    store.draft.picks = p.map(id => ({ id, ts: null, ms: null, auto: true, react: {} }));
    saveStore();
  }
  store.draft.picks.forEach(r => { r.react = r.react || {}; });
}

// ---------------------------------------------------------------- badges
/** Badges earned by one pick. `overall` is its zero-based position in the draft. */
export function pickBadges(rec, overall){
  const c = draftCfg(), out = [];
  if(!rec) return out;
  const p = NFL_BY_ID[rec.id];
  const adp = p && p.adp < 999 ? p.adp : null;

  if (c.badges.auto && rec.auto) out.push({ k:'auto', icon:c.autoIcon, label:'Auto pick' });
  if (c.badges.clutch && !rec.auto && rec.ms != null && rec.ms <= c.clutchSec * 1000)
    out.push({ k:'clutch', icon:c.clutchIcon, label:`Under ${c.clutchSec}s` });
  if (adp != null){
    const fell = adp - (overall + 1);         // + = slid past expectation
    if (c.badges.steal && fell >= c.stealBy)
      out.push({ k:'steal', icon:c.stealIcon, label:`Steal · ${Math.round(fell)} past ADP` });
    if (c.badges.reach && -fell >= c.reachBy)
      out.push({ k:'reach', icon:c.reachIcon, label:`Reach · ${Math.round(-fell)} ahead of ADP` });
  }
  return out;
}

// ---------------------------------------------------------------- reactions
/** Reactions stay editable only until the next pick lands, then lock forever. */
export function reactionsOpen(overall, totalPicks){
  return overall >= totalPicks - 1;
}

export function setReaction(rec, teamKey, emoji){
  if(!rec) return;
  rec.react = rec.react || {};
  if (rec.react[teamKey] === emoji) delete rec.react[teamKey];   // tap again to clear
  else rec.react[teamKey] = emoji;
  saveStore();
}

/** [[emoji, count, [teamKey…]], …] ordered by count. */
export function reactionTally(rec){
  const by = {};
  Object.entries((rec && rec.react) || {}).forEach(([team, e]) => {
    (by[e] = by[e] || []).push(team);
  });
  return Object.entries(by)
    .map(([e, teams]) => [e, teams.length, teams])
    .sort((a, b) => b[1] - a[1]);
}

// Seeded league chatter on older picks, so a replayed draft has the texture of
// draft night rather than an empty board. The user's own reaction is never
// seeded - that one is always theirs to give.
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
export function seedReactions(rec, overall){
  if(!rec || rec.seeded) return;
  rec.seeded = true;
  rec.react = rec.react || {};
  const badges = pickBadges(rec, overall).map(b => b.k);
  const loud = badges.includes('steal') || badges.includes('reach');
  let h = hash(rec.id + '#' + overall);
  const roll = () => (h = Math.imul(h ^ (h >>> 15), h | 1) >>> 0) / 4294967296;
  if (!loud && roll() > 0.45) return;                 // most ordinary picks pass without comment
  const others = DRAFT_ORDER.filter(k => k !== MY_TEAM && T[k]);
  const n = 1 + Math.floor(roll() * (loud ? 4 : 2));
  for (let i = 0; i < n; i++){
    const who = others[Math.floor(roll() * others.length)];
    const pool = badges.includes('steal') ? ['💎','🔥','👏','👍']
               : badges.includes('reach') ? ['😂','😬','🤯','👍']
               : ['👍','👏','🔥','😬'];
    rec.react[who] = pool[Math.floor(roll() * pool.length)];
  }
}
