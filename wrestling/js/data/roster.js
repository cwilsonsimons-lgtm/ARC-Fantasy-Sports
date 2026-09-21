// The starting roster: fourteen wrestlers, and nothing that has happened yet.
//
// A new save is a BLANK SLATE. Every record is 0-0, nobody holds a title, no
// grudges or friendships exist, and not one person has an opinion about the GM.
// The first show is genuinely the first show.
//
// What is authored here is who these people ARE, not what they have done:
// personality, ambition, ability, where they sit on the card, which way their
// career is pointing, and what they are paid. Those are starting conditions.
// Everything else - records, rankings, relationships, memories, morale, trust,
// championships - is written by play, which is the point. Two saves of this
// roster should tell different stories, and they cannot do that if the
// interesting history is baked in before anyone wrestles.
//
// The characters still differ sharply from the first minute. Halloran is a
// superstar's ego stranded on the lower card. Lund has the professionalism and
// none of the standing to refuse anything. Wren has almost no patience. None of
// that needs a backstory to be true.
//
// Two things here are groupings rather than numbers, and both are still
// character rather than history: which way the crowd is meant to take somebody
// (`alignment`), and who they run with (`FACTIONS`). A stable exists on day one
// the same way a main eventer does. Note that faction membership carries no
// relationship values at all - on a new save the Syndicate think nothing of
// each other, and they still back each other up, because that is what a stable
// is and it is a different reason from friendship.

import { CAREER_STATUS, TRAJECTORY, ALIGNMENT } from '../models/wrestler.js';
import * as store from '../core/store.js';

const { ROOKIE, JOBBER, LOWER_CARD, MIDCARD, UPPER_MIDCARD, MAIN_EVENT, SUPERSTAR } = CAREER_STATUS;
const { RISING, STEADY, DECLINING } = TRAJECTORY;
const { FACE, HEEL, TWEENER } = ALIGNMENT;

export const STARTING_ROSTER = [
  {
    key: 'croft',
    name: 'Damien Croft',
    careerStatus: SUPERSTAR,
    trajectory: STEADY,
    identity: {
      ego: 92, ambition: 78, alignment: HEEL,
      traits: { professionalism: 80, respectForAuthority: 30, patience: 65, loyalty: 35, jealousy: 78, vindictiveness: 70, aggression: 45, courage: 25, volatility: 25, sociability: 40 },
    },
    ability: { workRate: 84, charisma: 88, durability: 70, starPower: 94 },
    contract: { salary: 480000, expiresOnDay: 620 },
  },
  {
    key: 'vance',
    name: 'Ruby Vance',
    careerStatus: MAIN_EVENT,
    trajectory: RISING,
    identity: {
      ego: 80, ambition: 95, alignment: FACE,
      traits: { professionalism: 62, respectForAuthority: 45, patience: 30, loyalty: 55, jealousy: 50, vindictiveness: 60, aggression: 72, courage: 78, volatility: 72, sociability: 70 },
    },
    ability: { workRate: 89, charisma: 82, durability: 74, starPower: 86 },
    contract: { salary: 410000, expiresOnDay: 340 },
  },
  {
    key: 'wren',
    name: 'Tobias Wren',
    careerStatus: UPPER_MIDCARD,
    trajectory: RISING,
    identity: {
      ego: 74, ambition: 88, alignment: HEEL,
      traits: { professionalism: 70, respectForAuthority: 25, patience: 18, loyalty: 40, jealousy: 85, vindictiveness: 82, aggression: 66, courage: 60, volatility: 58, sociability: 35 },
    },
    ability: { workRate: 91, charisma: 58, durability: 78, starPower: 62 },
    contract: { salary: 185000, expiresOnDay: 210 },
  },
  {
    key: 'okonkwo',
    name: 'Sable Okonkwo',
    careerStatus: UPPER_MIDCARD,
    trajectory: RISING,
    identity: {
      ego: 58, ambition: 90, alignment: FACE,
      traits: { professionalism: 85, respectForAuthority: 70, patience: 62, loyalty: 72, jealousy: 30, vindictiveness: 45, aggression: 40, courage: 70, volatility: 40, sociability: 66 },
    },
    ability: { workRate: 82, charisma: 79, durability: 80, starPower: 71 },
    contract: { salary: 165000, expiresOnDay: 480 },
  },
  {
    key: 'kane',
    name: 'Marcus Kane',
    careerStatus: UPPER_MIDCARD,
    trajectory: STEADY,
    identity: {
      ego: 38, ambition: 52, alignment: FACE,
      traits: { professionalism: 94, respectForAuthority: 82, patience: 80, loyalty: 90, jealousy: 12, vindictiveness: 20, aggression: 25, courage: 55, volatility: 18, sociability: 75 },
    },
    ability: { workRate: 73, charisma: 66, durability: 92, starPower: 68 },
    contract: { salary: 150000, expiresOnDay: 700 },
  },
  {
    key: 'delacroix',
    name: 'Iris Delacroix',
    careerStatus: UPPER_MIDCARD,
    trajectory: RISING,
    identity: {
      ego: 81, ambition: 84, alignment: HEEL,
      traits: { professionalism: 45, respectForAuthority: 35, patience: 40, loyalty: 25, jealousy: 80, vindictiveness: 88, aggression: 70, courage: 45, volatility: 66, sociability: 58 },
    },
    ability: { workRate: 76, charisma: 85, durability: 65, starPower: 74 },
    contract: { salary: 172000, expiresOnDay: 400 },
  },
  {
    key: 'pike',
    name: 'Jonah Pike',
    careerStatus: MIDCARD,
    trajectory: STEADY,
    identity: {
      ego: 30, ambition: 48, alignment: FACE,
      traits: { professionalism: 96, respectForAuthority: 90, patience: 88, loyalty: 85, jealousy: 10, vindictiveness: 18, aggression: 20, courage: 60, volatility: 12, sociability: 62 },
    },
    ability: { workRate: 78, charisma: 52, durability: 84, starPower: 44 },
    contract: { salary: 95000, expiresOnDay: 560 },
  },
  {
    key: 'bloom',
    name: 'Cassidy Bloom',
    careerStatus: MIDCARD,
    trajectory: STEADY,
    identity: {
      ego: 69, ambition: 74, alignment: TWEENER,
      traits: { professionalism: 50, respectForAuthority: 40, patience: 35, loyalty: 48, jealousy: 72, vindictiveness: 55, aggression: 58, courage: 50, volatility: 78, sociability: 88 },
    },
    ability: { workRate: 55, charisma: 91, durability: 62, starPower: 70 },
    contract: { salary: 88000, expiresOnDay: 300 },
  },
  {
    key: 'halloran',
    name: 'Viktor Halloran',
    careerStatus: LOWER_CARD,
    trajectory: DECLINING,
    identity: {
      ego: 77, ambition: 40, alignment: HEEL,
      traits: { professionalism: 68, respectForAuthority: 28, patience: 22, loyalty: 42, jealousy: 88, vindictiveness: 74, aggression: 62, courage: 20, volatility: 62, sociability: 45 },
    },
    ability: { workRate: 70, charisma: 74, durability: 48, starPower: 58 },
    contract: { salary: 210000, expiresOnDay: 180 },
  },
  {
    key: 'sparrow',
    name: 'Nia Sparrow',
    careerStatus: MIDCARD,
    trajectory: RISING,
    identity: {
      ego: 52, ambition: 80, alignment: FACE,
      traits: { professionalism: 72, respectForAuthority: 65, patience: 55, loyalty: 65, jealousy: 28, vindictiveness: 30, aggression: 45, courage: 92, volatility: 55, sociability: 70 },
    },
    ability: { workRate: 86, charisma: 68, durability: 41, starPower: 63 },
    contract: { salary: 105000, expiresOnDay: 520 },
  },
  {
    key: 'ruiz',
    name: 'Deacon Ruiz',
    careerStatus: ROOKIE,
    trajectory: RISING,
    identity: {
      ego: 28, ambition: 76, alignment: FACE,
      traits: { professionalism: 80, respectForAuthority: 88, patience: 70, loyalty: 78, jealousy: 18, vindictiveness: 22, aggression: 30, courage: 75, volatility: 35, sociability: 72 },
    },
    ability: { workRate: 61, charisma: 55, durability: 72, starPower: 38 },
    contract: { salary: 42000, expiresOnDay: 380 },
  },
  {
    key: 'lund',
    name: 'Perry Lund',
    careerStatus: JOBBER,
    trajectory: STEADY,
    identity: {
      ego: 22, ambition: 34, alignment: FACE,
      traits: { professionalism: 92, respectForAuthority: 95, patience: 90, loyalty: 70, jealousy: 8, vindictiveness: 15, aggression: 12, courage: 62, volatility: 15, sociability: 80 },
    },
    ability: { workRate: 58, charisma: 44, durability: 76, starPower: 24 },
    contract: { salary: 36000, expiresOnDay: 300 },
  },
  {
    key: 'mabry',
    name: 'Trent Mabry',
    careerStatus: LOWER_CARD,
    trajectory: STEADY,
    identity: {
      ego: 60, ambition: 68, alignment: HEEL,
      traits: { professionalism: 58, respectForAuthority: 32, patience: 25, loyalty: 38, jealousy: 82, vindictiveness: 80, aggression: 55, courage: 55, volatility: 64, sociability: 42 },
    },
    ability: { workRate: 64, charisma: 49, durability: 70, starPower: 30 },
    contract: { salary: 38000, expiresOnDay: 250 },
  },
  {
    key: 'kovac',
    name: 'Ines Kovac',
    careerStatus: ROOKIE,
    trajectory: RISING,
    identity: {
      ego: 44, ambition: 92, alignment: TWEENER,
      traits: { professionalism: 66, respectForAuthority: 58, patience: 28, loyalty: 50, jealousy: 55, vindictiveness: 40, aggression: 60, courage: 80, volatility: 70, sociability: 48 },
    },
    ability: { workRate: 69, charisma: 62, durability: 68, starPower: 45 },
    contract: { salary: 48000, expiresOnDay: 420 },
  },
];

/**
 * Put the roster in the building.
 *
 * One pass, because there is no backstory to resolve: nobody starts with an
 * opinion of anybody. Returns a key-to-id map so callers can still refer to
 * people by name.
 */
export function seedRoster(roster = STARTING_ROSTER) {
  const idByKey = {};
  for (const spec of roster) {
    const { key, ...rest } = spec;
    idByKey[key] = store.addWrestler(rest).id;
  }
  return idByKey;
}

/**
 * Who runs with whom on day one.
 *
 * Membership only. No affinity, no shared history, no promises - just the fact
 * that these three come out together, which Tier 9 reads as its own reason to
 * get involved when one of them is in something.
 */
export const FACTIONS = [
  {
    name: 'The Syndicate',
    shortName: 'Syndicate',
    leader: 'croft',
    members: ['croft', 'wren', 'delacroix'],
  },
  {
    name: 'The Iron Union',
    shortName: 'Iron Union',
    leader: 'kane',
    members: ['kane', 'pike', 'lund'],
  },
];

export function seedFactions(idByKey) {
  return FACTIONS.map((f) => store.formFaction({
    name: f.name,
    shortName: f.shortName,
    leaderId: idByKey[f.leader],
    memberIds: f.members.map((k) => idByKey[k]),
  }));
}
