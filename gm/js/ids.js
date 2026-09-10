// Unique ids for every entity that other systems will need to point at.
//
// Ids look like "w_3" / "si_12". They are prefixed so a stray id is readable in
// a console dump, and monotonic so they are never reused within a save. Future
// systems (relationships, incidents, meeting requests, storylines) will store
// these ids, so a wrestler or show item must keep the same id for its lifetime.
let seq = 0;

// Called once at load with every id already present in the save, so a reload
// never hands out an id that is already in use.
export function primeIds(existingIds) {
  for (const id of existingIds) {
    const n = Number(String(id).split('_')[1]);
    if (Number.isFinite(n) && n > seq) seq = n;
  }
}

export function nextId(prefix) {
  return `${prefix}_${++seq}`;
}
