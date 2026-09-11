// Builds a roster from a seed.
//
// An archetype supplies the shape — stat ranges, opinions about stipulations, a
// couple of bio openers — and this rolls an individual inside it. Two wrestlers
// built from the same archetype in different saves share a silhouette and
// nothing else: different name, different numbers, different opinions, and a
// different place in the social graph.
import { range, pick, sample, shuffle, chance } from './random.js';
import { nextId } from '../ids.js';
import { ARCHETYPES, COLOUR } from '../data/archetypes.js';
import { FIRST_NAMES, SURNAMES, RING_NAMES, promotionNames } from '../data/names.js';

const ROSTER_MIN = 14;
const ROSTER_MAX = 18;
const MAX_RARE = 2; // monsters and cult leaders punctuate a roster, they do not fill it
// Most wrestlers read clearly as one thing or the other. A roster that is a
// third neutral reads as a roster nobody has booked.
const ALIGNMENTS = ['Face', 'Face', 'Face', 'Heel', 'Heel', 'Heel', 'Neutral'];
const RARE = new Set(['monster', 'cult-leader']);

function rollRange(rng, [low, high]) {
  return range(rng, low, high);
}

// Every archetype once, common ones twice, so a save omits some and doubles
// others instead of always fielding one of each.
function archetypePool() {
  const pool = [];
  for (const archetype of ARCHETYPES) {
    pool.push(archetype);
    if (!RARE.has(archetype.id)) pool.push(archetype);
  }
  return pool;
}

function chooseArchetypes(rng, size) {
  let chosen = sample(rng, archetypePool(), size);

  // Cap the strange ones, and make sure somebody can main event.
  const common = shuffle(rng, ARCHETYPES.filter(a => !RARE.has(a.id)));
  let rareSeen = 0;
  chosen = chosen.map(archetype => {
    if (!RARE.has(archetype.id)) return archetype;
    rareSeen += 1;
    return rareSeen <= MAX_RARE ? archetype : pick(rng, common);
  });

  if (!chosen.some(a => a.role === 'Main event')) {
    chosen[0] = pick(rng, ARCHETYPES.filter(a => a.role === 'Main event'));
  }
  return chosen;
}

// First names and surnames are both kept unique across a roster, not just the
// full name — two people called Greer reads like a generator, not a locker room.
function buildName(rng, archetype, gender, used) {
  if (archetype.ringName && chance(rng, 0.8)) {
    const moniker = RING_NAMES.find(n => !used.full.has(n));
    if (moniker) {
      used.full.add(moniker);
      return moniker;
    }
  }

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const first = pick(rng, FIRST_NAMES[gender]);
    const last = pick(rng, SURNAMES);
    if (used.first.has(first) || used.last.has(last)) continue;
    used.first.add(first);
    used.last.add(last);
    used.full.add(`${first} ${last}`);
    return `${first} ${last}`;
  }

  // Pools are large enough that this should never run, but a duplicate name
  // would break every lookup that goes by name.
  const fallback = `${pick(rng, FIRST_NAMES[gender])} ${pick(rng, SURNAMES)} ${used.full.size}`;
  used.full.add(fallback);
  return fallback;
}

function buildBio(rng, archetype) {
  const opener = pick(rng, archetype.openers).replace('{years}', String(range(rng, 6, 19)));
  return `${opener} ${pick(rng, COLOUR)}`;
}

function buildStats(rng, archetype) {
  const stats = {};
  for (const [key, band] of Object.entries(archetype.stats)) {
    stats[key] = rollRange(rng, band);
  }
  return stats;
}

function buildTastes(rng, archetype) {
  const tastes = {};
  for (const [typeId, spec] of Object.entries(archetype.tastes || {})) {
    const entry = { taste: rollRange(rng, spec.taste) };
    if (spec.aptitude) entry.aptitude = rollRange(rng, spec.aptitude);
    tastes[typeId] = entry;
  }
  return tastes;
}

export function generateRoster(rng) {
  const size = range(rng, ROSTER_MIN, ROSTER_MAX);
  const archetypes = chooseArchetypes(rng, size);
  const usedNames = { first: new Set(), last: new Set(), full: new Set() };

  const wrestlers = archetypes.map(archetype => {
    const gender = chance(rng, 0.45) ? 'Female' : 'Male';
    return {
      id: nextId('w'),
      name: buildName(rng, archetype, gender, usedNames),
      gender,
      alignment: pick(rng, ALIGNMENTS),
      status: 'Available',
      archetype: archetype.label,
      archetypeId: archetype.id,
      role: archetype.role,
      bio: buildBio(rng, archetype),
      photo: null,
      morale: range(rng, 42, 70),
      weeksOffCard: 0,
      grudges: [],
      stats: buildStats(rng, archetype),
      matchTypes: buildTastes(rng, archetype),
      record: { wins: 0, losses: 0 },
      familiarity: 0,
      relationships: {},
    };
  });

  applyStatuses(rng, wrestlers);
  seedHistory(rng, wrestlers);
  return wrestlers;
}

// A roster is never fully fit. One or two people are unavailable to you from
// day one, which means the card is short before you have booked anything.
function applyStatuses(rng, wrestlers) {
  const benched = sample(rng, wrestlers, range(rng, 1, 2));
  benched.forEach((wrestler, index) => {
    wrestler.status = index === 0 ? 'Injured' : 'Unavailable';
  });
}

function link(a, b, kind, count) {
  if (!a.relationships[b.id]) a.relationships[b.id] = { matches: 0, segments: 0 };
  if (!b.relationships[a.id]) b.relationships[a.id] = { matches: 0, segments: 0 };
  a.relationships[b.id][kind] += count;
  b.relationships[a.id][kind] += count;
}

// History from before you took the job: standing rivalries, a couple of teams,
// and whatever the cult leader has been building.
function seedHistory(rng, wrestlers) {
  const rivalCount = range(rng, 2, 4);
  for (let i = 0; i < rivalCount; i += 1) {
    const [a, b] = sample(rng, wrestlers, 2);
    if (a && b && a !== b) link(a, b, 'matches', range(rng, 3, 8));
  }

  const teamCount = range(rng, 2, 3);
  for (let i = 0; i < teamCount; i += 1) {
    const [a, b] = sample(rng, wrestlers, 2);
    if (a && b && a !== b) link(a, b, 'segments', range(rng, 3, 6));
  }

  const leader = wrestlers.find(w => w.archetypeId === 'cult-leader');
  if (leader) {
    const followers = sample(rng, wrestlers.filter(w => w !== leader), 2);
    for (const follower of followers) link(leader, follower, 'segments', range(rng, 2, 5));
  }
}

export function generatePromotion(rng) {
  return promotionNames(rng, pick);
}
