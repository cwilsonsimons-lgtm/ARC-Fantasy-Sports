// The starting roster: fourteen hand-authored wrestlers.
//
// Composition follows the prototype spec in the design foundation - two main
// event, four upper midcard, four midcard, four lower card and rookies - and
// every one arrives with relationships and memories already in place, so the
// locker room has history from the first show rather than a month in.
//
// Status runs from rookie to superstar and is the strongest single input to
// whether a behaviour is believable: Lund has the professionalism and none of
// the standing to refuse anything, while Croft has enough of both to refuse
// almost anything. Halloran is the interesting case - a superstar's ego on a
// lower-card wrestler's standing.
//
// Relationships are written by `key` here and resolved to real IDs by
// seedRoster(). They are DIRECTED: Wren's view of Croft and Croft's view of
// Wren are separate numbers, and in several cases below they disagree sharply.
// That is deliberate. One man carrying a grudge the other never noticed
// starting is the seed of most of the stories this game is meant to produce.

import { CAREER_STATUS, TRAJECTORY } from '../models/wrestler.js';
import * as store from '../core/store.js';

const { ROOKIE, JOBBER, LOWER_CARD, MIDCARD, UPPER_MIDCARD, MAIN_EVENT, SUPERSTAR } = CAREER_STATUS;
const { RISING, STEADY, DECLINING } = TRAJECTORY;

export const STARTING_ROSTER = [
  // ---------------------------------------------------------------- main event
  {
    key: 'croft',
    name: 'Damien Croft',
    careerStatus: SUPERSTAR,
    trajectory: STEADY,
    identity: {
      ego: 92, ambition: 78,
      traits: { professionalism: 80, respectForAuthority: 30, patience: 65, loyalty: 35, jealousy: 78, vindictiveness: 70, aggression: 45, courage: 25, volatility: 25, sociability: 40 },
    },
    ability: { workRate: 84, charisma: 88, durability: 70, starPower: 94 },
    standing: { wins: 41, losses: 12, draws: 3, streak: { type: 'W', count: 3 } },
    state: { morale: 74, momentum: 45, mood: 'confident' },
    ties: { gm: { trust: 45, respect: 38 } },
    contract: { salary: 480000, expiresOnDay: 620 },
    relationships: { vance: -40, wren: 5, delacroix: 25, mabry: -5 },
    memory: [
      {
        type: 'career', weight: 70, floor: 45, decayPerDay: 0.2, scar: true,
        aboutKeys: ['vance'],
        summary: 'Vance went over me clean in front of the largest crowd of my career',
      },
    ],
  },
  {
    key: 'vance',
    name: 'Ruby Vance',
    careerStatus: MAIN_EVENT,
    trajectory: RISING,
    identity: {
      ego: 80, ambition: 95,
      traits: { professionalism: 62, respectForAuthority: 45, patience: 30, loyalty: 55, jealousy: 50, vindictiveness: 60, aggression: 72, courage: 78, volatility: 72, sociability: 70 },
    },
    ability: { workRate: 89, charisma: 82, durability: 74, starPower: 86 },
    standing: { wins: 33, losses: 15, draws: 2, streak: { type: 'W', count: 1 } },
    state: { morale: 81, momentum: 55, mood: 'confident' },
    ties: { gm: { trust: 60, respect: 55 } },
    contract: { salary: 410000, expiresOnDay: 340 },
    relationships: { croft: -45, okonkwo: 35, sparrow: 40 },
    memory: [
      {
        type: 'career', weight: 80, floor: 50, decayPerDay: 0.15, scar: true,
        aboutKeys: ['croft'],
        summary: 'Beat Croft clean for the top spot and he has not spoken to me since',
      },
    ],
  },

  // ------------------------------------------------------------ upper midcard
  {
    key: 'wren',
    name: 'Tobias Wren',
    careerStatus: UPPER_MIDCARD,
    trajectory: RISING,
    identity: {
      ego: 74, ambition: 88,
      traits: { professionalism: 70, respectForAuthority: 25, patience: 18, loyalty: 40, jealousy: 85, vindictiveness: 82, aggression: 66, courage: 60, volatility: 58, sociability: 35 },
    },
    ability: { workRate: 91, charisma: 58, durability: 78, starPower: 62 },
    standing: { wins: 28, losses: 9, draws: 1, streak: { type: 'W', count: 6 } },
    state: { morale: 44, momentum: 62, mood: 'frustrated' },
    ties: { gm: { trust: 22, respect: 40 } },
    contract: { salary: 185000, expiresOnDay: 210 },
    relationships: { croft: -62, pike: 45, delacroix: -20 },
    memory: [
      {
        type: 'gm_promise_broken', weight: 85, floor: 55, decayPerDay: 0.1, scar: true,
        aboutKeys: ['croft'],
        summary: 'Told I was next in line, then watched Croft get the shot with a worse record',
      },
      {
        type: 'standing', weight: 60, floor: 20, decayPerDay: 0.4,
        aboutKeys: [],
        summary: 'Six straight wins and still opening the show',
      },
    ],
  },
  {
    key: 'okonkwo',
    name: 'Sable Okonkwo',
    careerStatus: UPPER_MIDCARD,
    trajectory: RISING,
    identity: {
      ego: 58, ambition: 90,
      traits: { professionalism: 85, respectForAuthority: 70, patience: 62, loyalty: 72, jealousy: 30, vindictiveness: 45, aggression: 40, courage: 70, volatility: 40, sociability: 66 },
    },
    ability: { workRate: 82, charisma: 79, durability: 80, starPower: 71 },
    standing: { wins: 24, losses: 11, draws: 0, streak: { type: 'L', count: 1 } },
    state: { morale: 68, momentum: 20, mood: 'focused' },
    ties: { gm: { trust: 70, respect: 62 } },
    contract: { salary: 165000, expiresOnDay: 480 },
    relationships: { delacroix: -68, vance: 40, kane: 30 },
    memory: [
      {
        type: 'cheated', weight: 88, floor: 50, decayPerDay: 0.12, scar: true,
        aboutKeys: ['delacroix'],
        summary: 'Delacroix had a fistful of tights and the referee never saw it',
      },
    ],
  },
  {
    key: 'kane',
    name: 'Marcus Kane',
    careerStatus: UPPER_MIDCARD,
    trajectory: STEADY,
    identity: {
      ego: 38, ambition: 52,
      traits: { professionalism: 94, respectForAuthority: 82, patience: 80, loyalty: 90, jealousy: 12, vindictiveness: 20, aggression: 25, courage: 55, volatility: 18, sociability: 75 },
    },
    ability: { workRate: 73, charisma: 66, durability: 92, starPower: 68 },
    standing: { wins: 31, losses: 19, draws: 4, streak: { type: 'W', count: 2 } },
    state: { morale: 79, momentum: 25, mood: 'content' },
    ties: { gm: { trust: 78, respect: 70 } },
    contract: { salary: 150000, expiresOnDay: 700 },
    relationships: { pike: 58, ruiz: 48, okonkwo: 30, halloran: -15 },
    memory: [
      {
        type: 'kindness', weight: 55, floor: 25, decayPerDay: 0.2,
        aboutKeys: ['ruiz'],
        summary: 'Ruiz stayed behind to help me to the back after a bad landing',
      },
    ],
  },
  {
    key: 'delacroix',
    name: 'Iris Delacroix',
    careerStatus: UPPER_MIDCARD,
    trajectory: RISING,
    identity: {
      ego: 81, ambition: 84,
      traits: { professionalism: 45, respectForAuthority: 35, patience: 40, loyalty: 25, jealousy: 80, vindictiveness: 88, aggression: 70, courage: 45, volatility: 66, sociability: 58 },
    },
    ability: { workRate: 76, charisma: 85, durability: 65, starPower: 74 },
    standing: { wins: 26, losses: 14, draws: 1, streak: { type: 'W', count: 4 } },
    state: { morale: 72, momentum: 48, mood: 'confident' },
    ties: { gm: { trust: 38, respect: 44 } },
    contract: { salary: 172000, expiresOnDay: 400 },
    relationships: { okonkwo: -18, croft: 30, bloom: -35 },
    memory: [],
  },

  // ------------------------------------------------------------------ midcard
  {
    key: 'pike',
    name: 'Jonah Pike',
    careerStatus: MIDCARD,
    trajectory: STEADY,
    identity: {
      ego: 30, ambition: 48,
      traits: { professionalism: 96, respectForAuthority: 90, patience: 88, loyalty: 85, jealousy: 10, vindictiveness: 18, aggression: 20, courage: 60, volatility: 12, sociability: 62 },
    },
    ability: { workRate: 78, charisma: 52, durability: 84, starPower: 44 },
    standing: { wins: 18, losses: 27, draws: 2, streak: { type: 'L', count: 3 } },
    state: { morale: 61, momentum: -30, mood: 'content' },
    ties: { gm: { trust: 82, respect: 66 } },
    contract: { salary: 95000, expiresOnDay: 560 },
    relationships: { kane: 58, wren: 45, lund: 40 },
    memory: [],
  },
  {
    key: 'bloom',
    name: 'Cassidy Bloom',
    careerStatus: MIDCARD,
    trajectory: STEADY,
    identity: {
      ego: 69, ambition: 74,
      traits: { professionalism: 50, respectForAuthority: 40, patience: 35, loyalty: 48, jealousy: 72, vindictiveness: 55, aggression: 58, courage: 50, volatility: 78, sociability: 88 },
    },
    ability: { workRate: 55, charisma: 91, durability: 62, starPower: 70 },
    standing: { wins: 15, losses: 20, draws: 1, streak: { type: 'W', count: 1 } },
    state: { morale: 66, momentum: 10, mood: 'restless' },
    ties: { gm: { trust: 52, respect: 48 } },
    contract: { salary: 88000, expiresOnDay: 300 },
    relationships: { sparrow: 52, delacroix: -35 },
    memory: [],
  },
  {
    key: 'halloran',
    name: 'Viktor Halloran',
    careerStatus: LOWER_CARD,
    trajectory: DECLINING,
    identity: {
      ego: 77, ambition: 40,
      traits: { professionalism: 68, respectForAuthority: 28, patience: 22, loyalty: 42, jealousy: 88, vindictiveness: 74, aggression: 62, courage: 20, volatility: 62, sociability: 45 },
    },
    ability: { workRate: 70, charisma: 74, durability: 48, starPower: 58 },
    standing: { wins: 52, losses: 48, draws: 6, streak: { type: 'L', count: 4 } },
    state: { morale: 38, momentum: -55, mood: 'frustrated' },
    ties: { gm: { trust: 40, respect: 30 } },
    contract: { salary: 210000, expiresOnDay: 180 },
    relationships: { sparrow: -32, ruiz: -28, kane: -15, croft: 20 },
    memory: [
      {
        type: 'career', weight: 75, floor: 45, decayPerDay: 0.1, scar: true,
        aboutKeys: [],
        summary: 'Told my main event days were behind me, by someone who never had any',
      },
    ],
  },
  {
    key: 'sparrow',
    name: 'Nia Sparrow',
    careerStatus: MIDCARD,
    trajectory: RISING,
    identity: {
      ego: 52, ambition: 80,
      traits: { professionalism: 72, respectForAuthority: 65, patience: 55, loyalty: 65, jealousy: 28, vindictiveness: 30, aggression: 45, courage: 92, volatility: 55, sociability: 70 },
    },
    ability: { workRate: 86, charisma: 68, durability: 41, starPower: 63 },
    standing: { wins: 21, losses: 16, draws: 0, streak: { type: 'W', count: 2 } },
    state: { morale: 73, momentum: 35, condition: 82, mood: 'confident' },
    ties: { gm: { trust: 64, respect: 58 } },
    contract: { salary: 105000, expiresOnDay: 520 },
    relationships: { bloom: 52, vance: 40, halloran: -30 },
    memory: [
      {
        type: 'injury', weight: 50, floor: 20, decayPerDay: 0.3,
        aboutKeys: [],
        summary: 'Landed badly off the top rope and worked six weeks hurt rather than lose the spot',
      },
    ],
  },

  // -------------------------------------------------------- lower card, rookies
  {
    key: 'ruiz',
    name: 'Deacon Ruiz',
    careerStatus: ROOKIE,
    trajectory: RISING,
    identity: {
      ego: 28, ambition: 76,
      traits: { professionalism: 80, respectForAuthority: 88, patience: 70, loyalty: 78, jealousy: 18, vindictiveness: 22, aggression: 30, courage: 75, volatility: 35, sociability: 72 },
    },
    ability: { workRate: 61, charisma: 55, durability: 72, starPower: 38 },
    standing: { wins: 4, losses: 11, draws: 0, streak: { type: 'L', count: 2 } },
    state: { morale: 70, momentum: -15, mood: 'focused' },
    ties: { gm: { trust: 74, respect: 60 } },
    contract: { salary: 42000, expiresOnDay: 380 },
    relationships: { kane: 62, halloran: -20, lund: 35 },
    memory: [],
  },
  {
    key: 'lund',
    name: 'Perry Lund',
    careerStatus: JOBBER,
    trajectory: STEADY,
    identity: {
      ego: 22, ambition: 34,
      traits: { professionalism: 92, respectForAuthority: 95, patience: 90, loyalty: 70, jealousy: 8, vindictiveness: 15, aggression: 12, courage: 62, volatility: 15, sociability: 80 },
    },
    ability: { workRate: 58, charisma: 44, durability: 76, starPower: 24 },
    standing: { wins: 3, losses: 34, draws: 1, streak: { type: 'L', count: 9 } },
    state: { morale: 55, momentum: -60, mood: 'content' },
    ties: { gm: { trust: 80, respect: 55 } },
    contract: { salary: 36000, expiresOnDay: 300 },
    relationships: { pike: 40, ruiz: 35, mabry: 30 },
    memory: [],
  },
  {
    key: 'mabry',
    name: 'Trent Mabry',
    careerStatus: LOWER_CARD,
    trajectory: STEADY,
    identity: {
      ego: 60, ambition: 68,
      traits: { professionalism: 58, respectForAuthority: 32, patience: 25, loyalty: 38, jealousy: 82, vindictiveness: 80, aggression: 55, courage: 55, volatility: 64, sociability: 42 },
    },
    ability: { workRate: 64, charisma: 49, durability: 70, starPower: 30 },
    standing: { wins: 5, losses: 29, draws: 0, streak: { type: 'L', count: 6 } },
    state: { morale: 34, momentum: -58, mood: 'frustrated' },
    ties: { gm: { trust: 30, respect: 35 } },
    contract: { salary: 38000, expiresOnDay: 250 },
    relationships: { croft: -44, lund: 30, halloran: 25 },
    memory: [
      {
        type: 'humiliation', weight: 78, floor: 42, decayPerDay: 0.15, scar: true,
        aboutKeys: ['croft'],
        summary: 'Croft beat me in forty seconds and did not bother learning my name',
      },
    ],
  },
  {
    key: 'kovac',
    name: 'Ines Kovac',
    careerStatus: ROOKIE,
    trajectory: RISING,
    identity: {
      ego: 44, ambition: 92,
      traits: { professionalism: 66, respectForAuthority: 58, patience: 28, loyalty: 50, jealousy: 55, vindictiveness: 40, aggression: 60, courage: 80, volatility: 70, sociability: 48 },
    },
    ability: { workRate: 69, charisma: 62, durability: 68, starPower: 45 },
    standing: { wins: 6, losses: 7, draws: 0, streak: { type: 'W', count: 1 } },
    state: { morale: 76, momentum: 22, mood: 'confident' },
    ties: { gm: { trust: 68, respect: 64 } },
    contract: { salary: 48000, expiresOnDay: 420 },
    relationships: { okonkwo: 42, wren: -25 },
    memory: [],
  },
];

/**
 * Create the roster and wire up its history.
 *
 * Two passes, because relationships are written by key and can point forwards:
 * everyone has to exist before anyone can have an opinion about them.
 */
export function seedRoster(roster = STARTING_ROSTER) {
  const idByKey = new Map();

  for (const spec of roster) {
    const { key, relationships, memory, ...rest } = spec;
    const wrestler = store.addWrestler(rest);
    idByKey.set(key, wrestler.id);
  }

  const resolve = (key) => {
    const id = idByKey.get(key);
    if (!id) throw new Error(`Roster references unknown wrestler key "${key}"`);
    return id;
  };

  for (const spec of roster) {
    const id = resolve(spec.key);
    const relationships = {};
    for (const [key, value] of Object.entries(spec.relationships || {})) {
      relationships[resolve(key)] = value;
    }
    const memory = (spec.memory || []).map(({ aboutKeys = [], ...m }) => ({
      ...m,
      aboutIds: aboutKeys.map(resolve),
    }));
    if (Object.keys(relationships).length || memory.length) {
      store.setBackstory(id, { relationships, memory });
    }
  }

  return Object.fromEntries(idByKey);
}
