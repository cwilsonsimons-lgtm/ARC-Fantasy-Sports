// A locker room you can take with you.
//
// Saves are worlds: a promotion, a roster, weeks of history, grudges, and ids
// that only mean anything inside that one save. A roster *file* is the other
// thing — the people, without any of the world they were in. It is what you
// hand to a new promotion, or to somebody else.
//
// So the conversion is deliberately lossy in one direction. Everything a
// wrestler *is* travels: their name, what they can do, who they are, what they
// like working, and the teams and mentorships that make the locker room a
// shape rather than a list. Everything that happened *to* them stays behind —
// memories, grudges, morale, familiarity, the record, who they were feuding
// with. A roster arriving in a new promotion has not met you yet.
//
// Relationships travel by index rather than by id, because ids are per-save.
import { TRAITS } from './traits.js';
import { nextId } from '../ids.js';

export const ROSTER_FILE_VERSION = 1;

// The ties worth carrying. A tag team is part of who two people are; a rivalry
// is something that happened, and the new promotion has not had it happen yet.
const TRAVELLING_TIES = new Set(['tag-team', 'allies', 'mentor', 'student', 'romance']);

// ---------------------------------------------------------------- writing

export function toRosterFile(wrestlers, name = 'Locker room') {
  const list = (wrestlers || []).filter(Boolean);
  const index = new Map(list.map((w, i) => [w.id, i]));

  const people = list.map(w => ({
    name: w.name,
    gender: w.gender,
    alignment: w.alignment,
    role: w.role,
    archetype: w.archetype,
    archetypeId: w.archetypeId || null,
    bio: w.bio || '',
    photo: w.photo || null,
    baseline: w.baseline,
    stats: { ...w.stats },
    traits: { ...w.traits },
    matchTypes: w.matchTypes ? JSON.parse(JSON.stringify(w.matchTypes)) : {},
    record: { wins: (w.record && w.record.wins) || 0, losses: (w.record && w.record.losses) || 0 },
  }));

  // One entry per pair rather than two, so a team does not arrive twice.
  const ties = [];
  const seen = new Set();
  list.forEach((w, i) => {
    for (const [otherId, rel] of Object.entries(w.relationships || {})) {
      if (!rel || !TRAVELLING_TIES.has(rel.tie)) continue;
      const j = index.get(otherId);
      if (j === undefined) continue;
      const key = i < j ? `${i}|${j}` : `${j}|${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // mentor/student is the one tie that is not the same thing from both
      // sides, so it is stored from the senior end and rebuilt from there.
      const mentorFirst = rel.tie === 'student';
      ties.push({
        a: mentorFirst ? j : i,
        b: mentorFirst ? i : j,
        tie: rel.tie === 'student' ? 'mentor' : rel.tie,
        segments: rel.segments || 0,
      });
    }
  });

  return {
    v: ROSTER_FILE_VERSION,
    name,
    createdAt: Date.now(),
    count: people.length,
    wrestlers: people,
    ties,
  };
}

// ---------------------------------------------------------------- reading

// Turns the file back into whole wrestlers. Every field the game expects is
// present whether or not the file carried it, so a hand-edited or older file
// cannot produce a half-built person.
export function fromRosterFile(file) {
  if (!valid(file)) return null;

  const people = file.wrestlers.map(w => {
    const traits = {};
    for (const spec of TRAITS) {
      const value = w.traits ? w.traits[spec.key] : undefined;
      traits[spec.key] = clamp(Number.isFinite(value) ? value : 50);
    }
    const baseline = Number.isFinite(w.baseline) ? clamp(w.baseline) : 55;
    return {
      id: nextId('w'),
      name: String(w.name || 'Unnamed'),
      gender: w.gender === 'Female' ? 'Female' : 'Male',
      alignment: ['Face', 'Heel', 'Neutral'].includes(w.alignment) ? w.alignment : 'Neutral',
      status: 'Available',
      archetype: String(w.archetype || 'Roster member'),
      archetypeId: w.archetypeId || null,
      role: ['Main event', 'Upper card', 'Midcard', 'Opener', 'Prospect'].includes(w.role)
        ? w.role : 'Midcard',
      bio: String(w.bio || ''),
      photo: w.photo || null,
      baseline,
      morale: baseline,
      weeksOffCard: 0,
      grudges: [],
      stats: {
        inRing: clamp(Number.isFinite(w.stats && w.stats.inRing) ? w.stats.inRing : 55),
        charisma: clamp(Number.isFinite(w.stats && w.stats.charisma) ? w.stats.charisma : 55),
      },
      traits,
      matchTypes: w.matchTypes && typeof w.matchTypes === 'object' ? w.matchTypes : {},
      record: {
        wins: whole(w.record && w.record.wins),
        losses: whole(w.record && w.record.losses),
      },
      // They have not met you. Everything about how well you know them, and
      // everything they are carrying, starts from nothing.
      familiarity: 0,
      relationships: {},
      memories: [],
      injuries: [],
      warnings: 0,
    };
  });

  for (const tie of file.ties || []) {
    const a = people[tie.a];
    const b = people[tie.b];
    if (!a || !b || a === b) continue;
    link(a, b, tie.segments || 3);
    if (tie.tie === 'mentor') {
      a.relationships[b.id].tie = 'mentor';
      b.relationships[a.id].tie = 'student';
    } else {
      a.relationships[b.id].tie = tie.tie;
      b.relationships[a.id].tie = tie.tie;
    }
  }

  return people;
}

function link(a, b, segments) {
  a.relationships[b.id] = a.relationships[b.id]
    || { matches: 0, segments: 0, owed: 0, teamed: 0, tie: null };
  b.relationships[a.id] = b.relationships[a.id]
    || { matches: 0, segments: 0, owed: 0, teamed: 0, tie: null };
  a.relationships[b.id].segments += segments;
  b.relationships[a.id].segments += segments;
}

function clamp(n) {
  return Math.max(0, Math.min(99, Math.round(n)));
}

function whole(n) {
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

// A file from a future build, or one somebody has mangled, is refused with a
// sentence rather than half-loaded.
export function valid(file) {
  if (!file || typeof file !== 'object') return false;
  if (file.v !== ROSTER_FILE_VERSION) return false;
  if (!Array.isArray(file.wrestlers) || !file.wrestlers.length) return false;
  if (file.wrestlers.length > 200) return false;
  return file.wrestlers.every(w => w && typeof w.name === 'string' && w.name.trim());
}

export function describe(file) {
  if (!valid(file)) return 'Not a locker room this build understands.';
  const teams = (file.ties || []).filter(t => t.tie === 'tag-team').length;
  const parts = [`${file.wrestlers.length} wrestlers`];
  if (teams) parts.push(`${teams} team${teams === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------- as text

// Plain JSON rather than base64. A locker room is something somebody may want
// to open, hand-edit, diff or keep in a file, and there is nothing in it worth
// hiding.
export function toText(file) {
  return JSON.stringify(file, null, 1);
}

export function fromText(text) {
  try {
    const parsed = JSON.parse(String(text).trim());
    return valid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
