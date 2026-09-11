// Who has history with whom.
//
// There is no incident system yet, so relationships are not invented — they are
// counted off the card itself. Two people who keep meeting in the ring become
// rivals; two people who keep sharing a segment become allies. Both are stored
// as plain counts on each wrestler:
//
//   wrestler.relationships[otherId] = { matches, segments }
//
// Symmetric by construction — both sides are written together. When incidents
// exist they add to the same record rather than needing a new one.
import { byId } from './wrestlers.js';

function pair(wrestler, otherId) {
  if (!wrestler.relationships[otherId]) {
    wrestler.relationships[otherId] = { matches: 0, segments: 0, owed: 0 };
  }
  const rel = wrestler.relationships[otherId];
  // Records written before debts existed have no `owed`, and `undefined + 1`
  // is NaN, which would silently poison every later read of it.
  if (rel.owed === undefined) rel.owed = 0;
  return rel;
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
