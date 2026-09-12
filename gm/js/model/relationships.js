// Who has history with whom, and what kind.
//
// Two things feed a relationship and they work differently.
//
// Most of it is *counted* off the card. Two people who keep meeting in the ring
// become rivals; two people who keep standing together become allies. Nobody
// declares that — it accumulates, and the player watches it happen.
//
//   wrestler.relationships[otherId] = { matches, segments, teamed, owed, tie }
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
  allies: { label: 'Allies', tone: 'good', note: 'This one built itself, out of who kept turning up for whom.' },
  'bad-blood': { label: 'Bad blood', tone: 'bad', note: 'Something from before you got here.' },
};

// Creates the record if it is not there, and returns it. Anything that writes
// to a relationship goes through this, so a half-built record can never exist.
export function ensurePair(wrestler, otherId) {
  if (!wrestler.relationships[otherId]) {
    wrestler.relationships[otherId] = { matches: 0, segments: 0, teamed: 0, owed: 0, tie: null };
  }
  const rel = wrestler.relationships[otherId];
  // Records written before debts, ties and team-ups existed have none of them,
  // and `undefined + 1` is NaN, which would silently poison every later read.
  if (rel.owed === undefined) rel.owed = 0;
  if (rel.teamed === undefined) rel.teamed = 0;
  if (rel.tie === undefined) rel.tie = null;
  return rel;
}

export function relationship(wrestler, otherId) {
  return (wrestler.relationships && wrestler.relationships[otherId])
    || { matches: 0, segments: 0, teamed: 0, owed: 0, tie: null };
}

export function note(wrestlers, aId, bId, kind, amount = 1) {
  if (aId === bId) return;
  const a = byId(wrestlers, aId);
  const b = byId(wrestlers, bId);
  if (!a || !b) return;
  ensurePair(a, bId)[kind] += amount;
  ensurePair(b, aId)[kind] += amount;
}

// Record every pairing on a show item.
//
// A tag match has to be split by side, and for a long time it was not: everyone
// in the match was recorded as everyone else's opponent, which made your own
// tag partner read as a rival you kept meeting. Same side is time spent
// together, and the team-up is counted separately from ordinary shared
// segments — two people booked as a team six times are a team, and nothing else
// in the record says that as plainly.
export function noteItem(wrestlers, item) {
  const ids = item.participants;

  if (item.type === 'match' && item.tag && ids.length >= 4) {
    const sides = [ids.slice(0, 2), ids.slice(2, 4)];
    for (const side of sides) {
      for (let i = 0; i < side.length; i += 1) {
        for (let j = i + 1; j < side.length; j += 1) {
          note(wrestlers, side[i], side[j], 'segments');
          note(wrestlers, side[i], side[j], 'teamed');
        }
      }
    }
    for (const a of sides[0]) {
      for (const b of sides[1]) note(wrestlers, a, b, 'matches');
    }
    return;
  }

  const kind = item.type === 'match' ? 'matches' : 'segments';
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

// ---------------------------------------------------------------- ties forming

// Generation names a handful of ties at the start, and until now that was the
// whole list — everything afterwards was counts. But a pair who keep turning up
// for each other are not "two people with a high segment count"; at some point
// they are a unit, and the game should be willing to say so.
//
// Three things happen when the week turns.
// How close two people have to read before the game is willing to name it.
//
// Scored rather than a checklist, and that is the whole difference: the first
// version wanted five shared segments *and* a debt *and* mutual warmth, which
// is three uncommon things at once and therefore never happened. Several routes
// lead to the same place now — being booked as a team, standing together, or
// one of them turning up when it counted — because in a locker room they all do.
const CLOSE_AT = 10;
const TEAM_AT = 2;           // team-ups before "allies" is the wrong word for it
const FACTION_TRIO = 3;      // mutually tied people before it is a faction
// And how far shared enemies alone will take a pair. Deliberately below the
// ally bar: having the same problem with somebody puts two people in the same
// conversation, and it is not by itself enough to make them a unit.
const DRIFT_CAP = 4;

function grudgeTargets(wrestler) {
  return new Set((wrestler.grudges || []).filter(g => g.targetId).map(g => g.targetId));
}

// Whether these two actually get on, as opposed to whether either of them is
// carrying a filed grievance.
//
// Using the grudge list as a hard block looked right and was wrong: over a
// season nearly every pair with enough shared history to qualify has also been
// booked against each other and picked something up, so nothing ever formed.
// What matters is the *balance* — somebody who turned up for you when it
// counted has outweighed an old score, and the memory ledger already knows
// that, so the question is asked of it rather than of a flag.
function warmBothWays(a, b) {
  return feelingToward(a, b.id) > 0 && feelingToward(b, a.id) > 0;
}

// How much of a unit two people read as. Every term is something that actually
// happened between them.
export function closeness(rel) {
  return (rel.segments || 0)
    + (rel.teamed || 0) * 2
    + (rel.owed || 0) * 4;
}

// Called when the week turns. Returns what formed, for the journal — the point
// of this tier is that the game tells the player about the stories it noticed
// rather than quietly keeping them to itself.
export function formTies(state) {
  const formed = [];
  drift(state);

  for (const wrestler of state.wrestlers) {
    for (const [otherId, rel] of Object.entries(wrestler.relationships || {})) {
      if (rel.tie) continue;
      const other = byId(state.wrestlers, otherId);
      if (!other || !warmBothWays(wrestler, other)) continue;
      if (closeness(rel) < CLOSE_AT) continue;

      // A pair who keep being booked as a team are a team. A pair who have only
      // ever stood beside each other are allies, which is a different thing and
      // reads differently on the card.
      const tie = (rel.teamed || 0) >= TEAM_AT ? 'tag-team' : 'allies';
      ensurePair(wrestler, otherId).tie = tie;
      ensurePair(other, wrestler.id).tie = tie;
      formed.push({ kind: tie, ids: [wrestler.id, otherId] });
    }
  }

  formed.push(...formFactions(state));
  return formed;
}

// Two people who both cannot stand the same third person find they have
// something in common. Nobody decided it; it is just what happens in a locker
// room, and it is the quietest way a faction starts.
function drift(state) {
  for (let i = 0; i < state.wrestlers.length; i += 1) {
    const a = state.wrestlers[i];
    const aEnemies = grudgeTargets(a);
    if (!aEnemies.size) continue;

    for (let j = i + 1; j < state.wrestlers.length; j += 1) {
      const b = state.wrestlers[j];
      if (feelingToward(a, b.id) < 0 || feelingToward(b, a.id) < 0) continue;
      const shared = [...grudgeTargets(b)].filter(id => aEnemies.has(id) && id !== a.id && id !== b.id);
      if (!shared.length) continue;

      const rel = ensurePair(a, b.id);
      ensurePair(b, a.id);
      // Only up to a point. Shared enemies bring people into the same
      // conversation; they do not make anybody a tag team on their own.
      if (rel.segments >= DRIFT_CAP) continue;
      note(state.wrestlers, a.id, b.id, 'segments', 1);
    }
  }
}

// Three people tied to each other in a ring is not three friendships. Promoting
// it says so, and the reaction engine then treats them as a unit — which is the
// difference between three allies and a faction that arrives together.
function formFactions(state) {
  const formed = [];
  const friendly = wrestler => Object.entries(wrestler.relationships || {})
    .filter(([, rel]) => rel.tie === 'allies' || rel.tie === 'tag-team')
    .map(([id]) => id);

  for (const a of state.wrestlers) {
    const aFriends = friendly(a);
    if (aFriends.length < FACTION_TRIO - 1) continue;

    for (let i = 0; i < aFriends.length; i += 1) {
      for (let j = i + 1; j < aFriends.length; j += 1) {
        const b = byId(state.wrestlers, aFriends[i]);
        const c = byId(state.wrestlers, aFriends[j]);
        if (!b || !c) continue;
        // The third side has to exist too, or it is one person with two friends.
        const bc = relationship(b, c.id);
        if (bc.tie !== 'allies' && bc.tie !== 'tag-team') continue;

        for (const [x, y] of [[a, b], [a, c], [b, c]]) {
          ensurePair(x, y.id).tie = 'faction';
          ensurePair(y, x.id).tie = 'faction';
        }
        formed.push({ kind: 'faction', ids: [a.id, b.id, c.id] });
        return formed; // one at a time; a roster of factions is a roster of nothing
      }
    }
  }
  return formed;
}

// Whoever this wrestler would count as theirs, for anything that asks "who
// takes this personally on their behalf".
export function alliesOf(wrestlers, wrestler, minimum = 2) {
  return Object.entries(wrestler.relationships || {})
    .filter(([, rel]) => rel.segments >= minimum || (rel.tie && rel.tie !== 'bad-blood'))
    .map(([id, rel]) => ({ ally: byId(wrestlers, id), weight: rel.segments + (rel.tie ? 4 : 0), tie: rel.tie }))
    .filter(entry => entry.ally);
}
