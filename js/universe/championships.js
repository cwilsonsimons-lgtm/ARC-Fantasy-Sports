// WWE 2K Universe — the championships a brand carries.
//
// How many belts a show has is the user's decision, not the seed's: a brand can
// carry one, or six, or none at all, and belts can be added, renamed, moved to
// another show, retired, or deleted outright if they were a mistake.
//
// Two rules are worth stating because they are what stops this being a plain
// list editor:
//
//   A belt with history is RETIRED, never deleted. Its lineage is somebody's
//   career. Deleting is only offered for a belt nothing in the log has touched.
//
//   `autoPromote` is a field on the belt, so "the champion goes up at the
//   offseason" belongs to whichever belt the user says — and a new belt on a
//   brand that already calls its champions up inherits that by default, which
//   is what keeps a second NXT title behaving like the first.

import { DIVISIONS } from './schema.js';
import { tierOf, canBePromoted, destination } from './pyramid.js';

export const DIVISION_LABEL = {
  mens: "men's", womens: "women's", tag: 'tag team', mixed: 'mixed tag', unisex: 'unisex',
};

// A tag belt is held by a team; everything else by one wrestler.
export const defaultTeamSize = division => (division === 'tag' || division === 'mixed' ? 2 : 1);

// ------------------------------------------------------------------ validation

export function checkChampionship(state, rec, { id = null } = {}) {
  const errors = [];
  const name = String(rec.name || '').trim();

  if (!name) errors.push('a championship needs a name');
  if (rec.division && !DIVISIONS.includes(rec.division)) errors.push(`unknown division: ${rec.division}`);
  if (rec.brandId && !state.brands[rec.brandId]) errors.push('that brand does not exist');
  if (rec.teamSize != null && (!Number.isFinite(Number(rec.teamSize)) || Number(rec.teamSize) < 1)) {
    errors.push('team size must be 1 or more');
  }

  // Two belts with the same name make every card ambiguous — the parser would
  // have no way to tell which one a match was for.
  const clash = Object.values(state.championships)
    .find(c => c.id !== id && c.name.toLowerCase() === name.toLowerCase());
  if (clash) errors.push(`there is already a championship called ${clash.name}`);

  // A call-up needs somewhere to call people up to.
  if (rec.autoPromote) {
    if (!rec.brandId) errors.push('a belt with no brand cannot call anybody up — give it a show first');
    else if (!canBePromoted(state, rec.brandId)) {
      errors.push(`${state.brands[rec.brandId].name} is on the top tier, so its champion has nowhere to be called up to`);
    }
  }
  return errors;
}

// ------------------------------------------------------------------ reading

// Can this belt be deleted outright, or does it have a history to keep? The
// answer is "has the log ever mentioned it", which is the only honest test.
export function beltUsage(state, id) {
  const events = state.events.filter(e =>
    e.data.titleId === id || e.data.contender === id
    || (e.effects || []).some(fx => fx.titleId === id));
  const belt = state.championships[id];
  return {
    events: events.length,
    reigns: belt ? belt.reigns.length : 0,
    firstDate: events.length ? events[0].date : null,
    deletable: !events.length && !(belt && belt.reigns.length),
  };
}

export function beltCard(state, id) {
  const c = state.championships[id];
  if (!c) return null;
  const usage = beltUsage(state, id);
  const up = c.brandId && canBePromoted(state, c.brandId) ? destination(state, c.brandId, 'promotion') : null;
  return {
    ...c,
    brandName: c.brandId && state.brands[c.brandId] ? state.brands[c.brandId].name : null,
    tier: c.brandId ? tierOf(state, c.brandId) : null,
    divisionLabel: DIVISION_LABEL[c.division] || c.division || '—',
    usage,
    promotesTo: up,
    promotesToName: up && state.brands[up] ? state.brands[up].name : null,
  };
}

// Every brand with the belts it carries — the "how many championships does
// each show have" view. Brands with none are still listed, because "none" is a
// legitimate answer and one you may be about to change.
export function beltsByBrand(state, { includeRetired = false } = {}) {
  const belts = Object.values(state.championships)
    .filter(c => includeRetired || !c.retired)
    .map(c => beltCard(state, c.id));

  const rows = Object.values(state.brands)
    .sort((a, b) => (a.tier || 1) - (b.tier || 1) || a.name.localeCompare(b.name))
    .map(b => ({
      id: b.id, name: b.name, color: b.color || null, tier: b.tier || 1,
      belts: belts.filter(c => c.brandId === b.id).sort(sortBelts),
      autoPromotes: belts.filter(c => c.brandId === b.id && c.autoPromote).length,
    }));

  const loose = belts.filter(c => !c.brandId || !state.brands[c.brandId]).sort(sortBelts);
  if (loose.length) rows.push({ id: null, name: 'Unbranded', color: null, tier: null, belts: loose, autoPromotes: 0 });
  return rows.map(r => ({ ...r, count: r.belts.length }));
}

// World titles first, then by division, then by name — the order a title screen
// reads in, rather than whatever order they were created.
const DIV_ORDER = ['mens', 'unisex', 'womens', 'tag', 'mixed'];
const worldish = c => /world|universal|undisputed/i.test(c.name) || /^(wwe|aew|nxt|tna) championship$/i.test(c.name);
function sortBelts(a, b) {
  if (worldish(a) !== worldish(b)) return worldish(a) ? -1 : 1;
  const da = DIV_ORDER.indexOf(a.division), db = DIV_ORDER.indexOf(b.division);
  if (da !== db) return (da < 0 ? 99 : da) - (db < 0 ? 99 : db);
  return a.name.localeCompare(b.name);
}

// A new belt on a brand that already calls its champions up should do the same,
// or a second NXT title would quietly break the rule the first one follows.
export const autoPromoteDefault = (state, brandId) => !!brandId
  && canBePromoted(state, brandId)
  && Object.values(state.championships).some(c => c.brandId === brandId && c.autoPromote && !c.retired);

// ------------------------------------------------------------------ writing

// Create or update. Entity edits are corrections, not events: a belt's *name*
// is not something that happened, it is what the belt is. Who holds it stays in
// the log where it belongs.
export function saveChampionship(store, state, rec, { id = null } = {}) {
  const errors = checkChampionship(state, rec, { id });
  if (errors.length) { const e = new Error(errors[0]); e.errors = errors; throw e; }

  const clean = {
    name: String(rec.name).trim(),
    brandId: rec.brandId || undefined,
    division: rec.division || 'mens',
    teamSize: Number(rec.teamSize) || defaultTeamSize(rec.division || 'mens'),
    autoPromote: rec.autoPromote ? true : undefined,
    activeFrom: rec.activeFrom || undefined,
    retiredOn: rec.retiredOn || undefined,
    note: rec.note || undefined,
  };

  if (id) {
    const before = store.getEntity(id);
    // amendEntity merges, so a field being turned *off* has to be written as a
    // value rather than left out.
    store.amendEntity(id, {
      ...clean,
      brandId: clean.brandId || null,
      autoPromote: !!rec.autoPromote,
      retiredOn: clean.retiredOn || null,
    }, 'championship edited');
    store.save();
    return { id, created: false, before };
  }

  const made = store.addEntity('championship', clean);
  store.save();
  return { id: made.id, created: true, before: null };
}

// Retiring keeps everything: the lineage, the reigns, the day counts. It only
// takes the belt off the active list.
export function retireChampionship(store, state, id, { on = null, undo = false } = {}) {
  const c = state.championships[id];
  if (!c) throw new Error('no such championship');
  store.amendEntity(id, { retiredOn: undo ? null : (on || state.asOf) }, undo ? 'championship unretired' : 'championship retired');
  store.save();
  return { id, retired: !undo };
}

// Deleting is only for a belt that never happened. Anything the log has touched
// is retired instead — its history is somebody's career and is not ours to drop.
export function deleteChampionship(store, state, id) {
  const usage = beltUsage(state, id);
  if (!usage.deletable) {
    const e = new Error(`${state.championships[id].name} has been defended ${usage.events} times — retire it instead of deleting it`);
    e.errors = [e.message];
    throw e;
  }
  store.removeEntity(id, 'championship deleted — never contested');
  store.save();
  return { id, deleted: true };
}
