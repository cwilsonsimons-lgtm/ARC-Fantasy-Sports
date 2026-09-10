// Roster lookups. Pure functions over the wrestler list — no DOM, no storage.

export const GENDERS = ['Male', 'Female'];
export const ALIGNMENTS = ['Face', 'Heel', 'Neutral'];
export const STATUSES = ['Available', 'Injured', 'Unavailable'];

export function byId(wrestlers, id) {
  return wrestlers.find(w => w.id === id) || null;
}

// Names are resolved at display time rather than copied into show items, so a
// wrestler is only ever stored once and edits to them propagate everywhere.
export function nameOf(wrestlers, id) {
  const w = byId(wrestlers, id);
  return w ? w.name : '(unknown wrestler)';
}

export function namesOf(wrestlers, ids) {
  return ids.map(id => nameOf(wrestlers, id));
}
