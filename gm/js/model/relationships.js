// Who has history with whom, and what kind.
//
// Two things feed a relationship and they work differently.
//
// Most of it is *counted* off the card. Two people who keep meeting in the ring
// become rivals; two people who keep standing together become allies. Nobody
// declares that — it accumulates, and the player watches it happen.
//
//   wrestler.relationships[otherId] = { matches, segments, owed, tie }
//
// The rest is *named*: a tag team, a faction, a mentor and their student, two
// people whose lives are tangled up together, an old score from before the
// player took the job. Those cannot be counted into existence, so generation
// names them once and everything downstream reads the name.
//
// Symmetric by construction — both sides are written together — with one
// exception: mentor and student are the same relationship seen from two ends.
import { byId } from './wrestlers.js';
import { feelingToward } from './memory.js';

// A named tie outranks anything the counts would have said.
export const TIES = {
  'tag-team': { label: 'Tag partner', tone: 'good', note: 'They come as a unit.' },
  faction: { label: 'Faction', tone: 'good', note: 'You go after one, you go after all of them.' },
  mentor: { label: 'Brought them up', tone: 'good', note: 'Their opinion of you carries weight with this one.' },
  student: { label: 'Came up under them', tone: 'good', note: 'Still looks to them.' },
  romance: { label: 'Involved', tone: 'good', note: 'Every booking involving either of them is heavier than it looks.' },
  'bad-blood': { label: 'Bad blood', tone: 'bad', note: 'Something from before you got here.' },
};

function pair(wrestler, otherId) {
  if (!wrestler.relationships[otherId]) {
    wrestler.relationships[otherId] = { matches: 0, segments: 0, owed: 0, tie: null };
  }
  const rel = wrestler.relationships[otherId];
  // Records written before debts and ties existed have neither, and
  // `undefined + 1` is NaN, which would silently poison every later read.
  if (rel.owed === undefined) rel.owed = 0;
  if (rel.tie === undefined) rel.tie = null;
  return rel;
}

export function relationship(wrestler, otherId) {
  return (wrestler.relationships && wrestler.relationships[otherId])
    || { matches: 0, segments: 0, owed: 0, tie: null };
}

export function note(wrestlers, aId, bId, kind) {
  if (aId === bId) return;
  const a = byId(wrestlers, aId);
  const b = byId(wrestlers, bId);
  if (!a || !b) return;
  pair(a, bId)[kind] += 1;
  pair(b, aId)[kind] += 1;
}

// Record every pairing on a show item: opponents in a match, team-mates in a
// segment.
export function noteItem(wrestlers, item) {
  const kind = item.type === 'match' ? 'matches' : 'segments';
  const ids = item.participants;
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      note(wrestlers, ids[i], ids[j], kind);
    }
  }
}

// ---------- reading one ----------

const RESPECT_AT = 12;
const DISTRUST_AT = -12;

function grudgesToward(wrestler, otherId) {
  return (wrestler.grudges || []).filter(g => g.targetId === otherId);
}

// What this one relationship actually is, from this wrestler's side of it.
// Named ties first, then the sharp counted states, then the mild ones — so a
// tag partner never reads as "has worked with" and an enemy never reads as a
// friendly acquaintance.
export function relationshipWith(wrestlers, wrestler, otherId) {
  const other = byId(wrestlers, otherId);
  if (!other) return null;

  const rel = relationship(wrestler, otherId);
  const grudges = grudgesToward(wrestler, otherId);
  const theirGrudges = grudgesToward(other, wrestler.id);
  const feeling = feelingToward(wrestler, otherId);

  const base = {
    wrestler: other,
    counts: rel,
    grudges: grudges.length,
    feeling,
    // How loudly this one should be listed. Named ties always come first.
    weight: (rel.tie ? 100 : 0) + rel.matches * 2 + rel.segments * 3
      + grudges.length * 8 + (rel.owed || 0) * 6,
  };

  if (rel.tie && TIES[rel.tie]) {
    return { ...base, type: rel.tie, ...TIES[rel.tie] };
  }

  if (grudges.length && theirGrudges.length) {
    return { ...base, type: 'enemy', label: 'Enemy', tone: 'bad', note: 'Neither of them is letting it go.' };
  }
  if (grudges.length) {
    return { ...base, type: 'grievance', label: 'Holds a grudge', tone: 'bad', note: grudgeNote(grudges[0]) };
  }
  if (theirGrudges.length) {
    return { ...base, type: 'resented', label: 'Resented by them', tone: 'warn', note: 'Whether or not this one has noticed.' };
  }
  if ((rel.owed || 0) > 0) {
    return { ...base, type: 'debt', label: 'Owes them', tone: 'good', note: 'They were there when it counted.' };
  }
  if (rel.matches >= 5) {
    return { ...base, type: 'rival', label: 'Rival', tone: 'warn', note: `${rel.matches} matches and counting.` };
  }
  if (rel.segments >= 5) {
    return { ...base, type: 'close-ally', label: 'Close ally', tone: 'good', note: 'Stands beside them as a matter of course.' };
  }
  if (rel.segments >= 2) {
    return { ...base, type: 'friendly', label: 'Friendly', tone: 'good', note: 'They get on.' };
  }
  if (feeling >= RESPECT_AT) {
    return { ...base, type: 'respect', label: 'Respects them', tone: 'good', note: 'Earned rather than given.' };
  }
  if (feeling <= DISTRUST_AT) {
    return { ...base, type: 'distrust', label: 'Distrusts them', tone: 'warn', note: 'Nothing said out loud.' };
  }
  if (rel.matches >= 1) {
    return { ...base, type: 'worked-with', label: 'Has worked with', tone: 'plain', note: `${rel.matches} ${rel.matches === 1 ? 'match' : 'matches'}.` };
  }
  if (rel.segments >= 1) {
    return { ...base, type: 'acquaintance', label: 'Acquainted', tone: 'plain', note: 'Shared a segment.' };
  }
  return null;
}

function grudgeNote(grudge) {
  if (grudge.type === 'attacked') return 'Was jumped by them.';
  if (grudge.type === 'abandoned') return 'Watched them decide not to help.';
  return 'Something between them.';
}

// Everyone this wrestler has an opinion about, loudest first.
export function relationshipsOf(wrestlers, wrestler, limit = 6) {
  const ids = new Set(Object.keys(wrestler.relationships || {}));
  for (const grudge of wrestler.grudges || []) {
    if (grudge.targetId) ids.add(grudge.targetId);
  }

  return [...ids]
    .map(id => relationshipWith(wrestlers, wrestler, id))
    .filter(Boolean)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
}

// ---------- the old counted reads, still used where a plain list is wanted ----------

function ranked(wrestlers, wrestler, kind, limit) {
  return Object.entries(wrestler.relationships || {})
    .filter(([, counts]) => counts[kind] > 0)
    .sort((a, b) => b[1][kind] - a[1][kind])
    .slice(0, limit)
    .map(([id, counts]) => ({ wrestler: byId(wrestlers, id), count: counts[kind] }))
    .filter(entry => entry.wrestler);
}

export function topRivals(wrestlers, wrestler, limit = 3) {
  return ranked(wrestlers, wrestler, 'matches', limit);
}

export function topAllies(wrestlers, wrestler, limit = 3) {
  return ranked(wrestlers, wrestler, 'segments', limit);
}

// Whoever this wrestler would count as theirs, for anything that asks "who
// takes this personally on their behalf".
export function alliesOf(wrestlers, wrestler, minimum = 2) {
  return Object.entries(wrestler.relationships || {})
    .filter(([, rel]) => rel.segments >= minimum || (rel.tie && rel.tie !== 'bad-blood'))
    .map(([id, rel]) => ({ ally: byId(wrestlers, id), weight: rel.segments + (rel.tie ? 4 : 0), tie: rel.tie }))
    .filter(entry => entry.ally);
}
