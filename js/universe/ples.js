// WWE 2K Universe — premium live events.
//
// A PLE is a thing that exists with a place on the 28-day cycle, not a date in
// a calendar somebody else wrote. Three decisions shape this file:
//
//   IT IS AN ENTITY, NOT AN EVENT. "SummerSlam happens on day 21" is a fact
//   about your universe, the way a brand or a belt is; "SummerSlam 2027 was
//   held and Cody beat Roman" is what happened, and that stays in the log. So
//   moving a PLE rewrites no history — the shows you already played keep their
//   dates and their cards.
//
//   BRANDS ARE A LIST. A PLE belongs to one brand, several, or all of them, so
//   `brandIds` is an array and never a single `brandId`. Survivor Series being
//   Raw *and* SmackDown is the ordinary case, not a special one.
//
//   ORDER IS KNOWLEDGE, PLACEMENT IS YOURS. The offseason runs WrestleMania →
//   Last Stand → Draft, and this file knows that. It will tell you when your
//   schedule contradicts it. It will not move anything for you, and nothing
//   here has an opinion about which day any PLE lands on.

import { CYCLE_DAYS, PLE_SPECIALS, PLE_TYPES, SPECIAL_ORDER, entityId } from './schema.js';
import { weekOfDay, dayLabel } from './calendar.js';

// The rule's own name, for anywhere it is shown to a human. The key is what
// the code reads; this is what it is called.
export const SPECIAL_SHORT = { wrestlemania: 'WrestleMania', lastStand: 'Last Stand', draft: 'Draft' };

export const SPECIAL_LABEL = {
  wrestlemania: 'WrestleMania — ends the season',
  lastStand: 'Last Stand — settles promotion and relegation',
  draft: 'Draft — reshuffles each tier, and opens the new season',
};

// ------------------------------------------------------------------ reading

const brandsOf = (state, rec) => (rec.brandIds || [])
  .map(id => state.brands[id])
  .filter(Boolean);

export function pleCard(state, rec) {
  const brands = brandsOf(state, rec);
  return {
    ...rec,
    day: Number(rec.day),
    week: weekOfDay(Number(rec.day)),
    dayLabel: dayLabel(Number(rec.day)),
    brands,
    brandNames: brands.map(b => b.name),
    // "RAW + SMACKDOWN", or an honest blank rather than a guess.
    brandLine: brands.length ? brands.map(b => b.name).join(' + ') : null,
    color: rec.color || (brands.length === 1 && brands[0].color) || null,
    isSpecial: rec.type === 'special' && !!rec.special,
  };
}

export function allPLEs(state) {
  return Object.values(state.ples || {})
    .map(p => pleCard(state, p))
    .sort((a, b) => a.day - b.day || a.name.localeCompare(b.name));
}

// Everything on one day of the cycle. Several PLEs can share a day — the card
// two brands run on the same night is a normal thing to book.
export const plesOnDay = (state, day, { brandId = null } = {}) =>
  allPLEs(state).filter(p => p.day === Number(day) && (!brandId || (p.brandIds || []).includes(brandId)));

// §39: a PLE shows up under any brand it is assigned to. Raw + SmackDown
// appears when filtering either, and never when filtering Dynamite.
export const plesForBrand = (state, brandId) =>
  allPLEs(state).filter(p => (p.brandIds || []).includes(brandId));

export const pleBySpecial = (state, special) =>
  allPLEs(state).find(p => p.type === 'special' && p.special === special) || null;

// ------------------------------------------------------------------ validation

export function checkPLE(state, rec, { id = null } = {}) {
  const errors = [];
  const warnings = [];
  const name = String(rec.name || '').trim();
  const day = Number(rec.day);

  if (!name) errors.push('a PLE needs a name');
  if (!Number.isInteger(day) || day < 1 || day > CYCLE_DAYS) errors.push(`the day has to be between 1 and ${CYCLE_DAYS}`);
  if (rec.type && !PLE_TYPES.includes(rec.type)) errors.push(`unknown PLE type: ${rec.type}`);
  if (rec.type === 'special' && !PLE_SPECIALS.includes(rec.special)) {
    errors.push(`a special event has to be one of: ${PLE_SPECIALS.join(', ')}`);
  }
  if (rec.special && rec.type !== 'special') errors.push('give it the special type, or clear the rule it carries');

  (rec.brandIds || []).forEach(b => { if (!state.brands[b]) errors.push(`unknown brand: ${b}`); });

  const clash = Object.values(state.ples || {})
    .find(p => p.id !== id && p.name.toLowerCase() === name.toLowerCase());
  if (clash) errors.push(`there is already a PLE called ${clash.name}`);

  // Two events carrying the same rule would leave the season machinery unable
  // to say which one was meant.
  if (rec.type === 'special' && rec.special) {
    const taken = Object.values(state.ples || {})
      .find(p => p.id !== id && p.type === 'special' && p.special === rec.special);
    if (taken) errors.push(`${taken.name} is already your ${rec.special} — one event carries each rule`);
  }

  // Warnings, never blocks: where a PLE lands is the user's business (§42).
  if (!(rec.brandIds || []).length) warnings.push('no brands assigned — nobody is on this show yet');

  return { errors, warnings };
}

// The offseason runs WrestleMania → Last Stand → Draft. If all three are placed
// and the days disagree with that, say so — and say it as a note, because a
// schedule that runs across two cycles is legitimate and only the user knows.
export function orderProblems(state) {
  const placed = SPECIAL_ORDER
    .map(k => ({ key: k, ple: pleBySpecial(state, k) }))
    .filter(x => x.ple);
  const out = [];
  for (let i = 1; i < placed.length; i++) {
    const prev = placed[i - 1], cur = placed[i];
    if (cur.ple.day <= prev.ple.day) {
      out.push({
        after: cur.key, before: prev.key,
        message: `${cur.ple.name} (day ${cur.ple.day}) is scheduled on or before ${prev.ple.name} (day ${prev.ple.day}),`
          + ` but ${cur.key} comes after ${prev.key} — fine if they are in different cycles, worth a look if not.`,
      });
    }
  }
  SPECIAL_ORDER.forEach(k => {
    if (!pleBySpecial(state, k)) out.push({ missing: k, message: `nothing is set as your ${k} yet` });
  });
  return out;
}

// ------------------------------------------------------------------ writing

const cleanRec = rec => ({
  name: String(rec.name).trim(),
  day: Number(rec.day),
  brandIds: [...new Set(rec.brandIds || [])],
  logo: rec.logo || undefined,
  color: rec.color || undefined,
  description: rec.description || undefined,
  type: rec.type === 'special' ? 'special' : 'ple',
  special: rec.type === 'special' ? rec.special : undefined,
  note: rec.note || undefined,
});

export function savePLE(store, state, rec, { id = null } = {}) {
  const { errors, warnings } = checkPLE(state, rec, { id });
  if (errors.length) { const e = new Error(errors[0]); e.errors = errors; throw e; }
  const clean = cleanRec(rec);

  if (id) {
    // amendEntity merges, so anything being *cleared* has to be written as a
    // value rather than left out.
    store.amendEntity(id, {
      ...clean,
      logo: clean.logo || null, color: clean.color || null,
      description: clean.description || null, special: clean.special || null,
    }, 'PLE edited');
    store.save();
    return { id, created: false, warnings };
  }
  const made = store.addEntity('ple', clean, { id: entityId('ple', clean.name) });
  store.save();
  return { id: made.id, created: true, warnings };
}

// Moving is the whole point of the schedule being data: the day changes and
// nothing else does — the brands, the rule it carries, its history all stay.
export function movePLE(store, state, id, day) {
  const rec = state.ples[id];
  if (!rec) throw new Error('no such PLE');
  const to = Number(day);
  if (!Number.isInteger(to) || to < 1 || to > CYCLE_DAYS) {
    const e = new Error(`the day has to be between 1 and ${CYCLE_DAYS}`);
    e.errors = [e.message];
    throw e;
  }
  store.amendEntity(id, { day: to }, `moved to day ${to}`);
  store.save();
  return { id, from: rec.day, to, brandIds: rec.brandIds || [] };
}

export function deletePLE(store, state, id) {
  const rec = state.ples[id];
  if (!rec) throw new Error('no such PLE');
  store.removeEntity(id, 'PLE deleted');
  store.save();
  return { id, name: rec.name };
}

// ------------------------------------------------------------------ text

export function scheduleText(state) {
  const list = allPLEs(state);
  if (!list.length) return 'Nothing scheduled — the cycle is empty.';
  return list.map(p => `Day ${String(p.day).padStart(2, ' ')} (week ${p.week})  ${p.name}`
    + `${p.brandLine ? `  — ${p.brandLine}` : ''}`
    + `${p.isSpecial ? `  [${p.special}]` : ''}`).join('\n');
}
