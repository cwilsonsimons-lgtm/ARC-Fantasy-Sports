// WWE 2K Universe — storage.
//
// The store is three lists and a registry:
//
//   entities     who exists (wrestlers, brands, belts, tag teams, factions)
//   events       what happened, append-only, never edited in place
//   corrections  what you got wrong, also append-only
//
// Nothing derived is persisted. `effectiveEvents()` folds the correction log
// over the raw event log and hands back the history as it now stands; project.js
// turns that into current state. So an edit or a void is one small append, and
// every downstream number recalculates on the next read — there is no cache to
// invalidate and no partially-updated state to repair.
//
// Amending re-runs the event through its type's effect builder, so a corrected
// event never keeps the consequences of what you originally typed. Change a
// match's winner and the win/loss records, the title reign and the streak all
// move with it.
//
// Storage is a two-method adapter (`load`, `save`) so the same code runs against
// memory in tests, localStorage in the browser, and a JSON file under Node.

import { EVENT_TYPES, validateEvent, validateEntity, deriveEffects, entityId, entityKind, pad, isDate } from './schema.js';

export const SCHEMA_VERSION = 1;
export const STORE_KEY = 'arc_universe_v1';

const KINDS = { wrestler: 'wrestlers', brand: 'brands', championship: 'championships', group: 'groups', ple: 'ples' };
const clone = o => JSON.parse(JSON.stringify(o));
const nowISO = () => new Date().toISOString();

export function emptyDoc(name = 'Universe') {
  return {
    meta: { version: SCHEMA_VERSION, name, seq: 0, cxSeq: 0, createdAt: nowISO(), updatedAt: nowISO() },
    // A new save opens on a clean 28-day cycle with nothing on it: the calendar
    // is a structure, the schedule is the user's.
    calendar: { start: null, cycleDays: 28 },
    entities: { wrestlers: {}, brands: {}, championships: {}, groups: {}, ples: {} },
    events: [],
    corrections: [],
  };
}

// ------------------------------------------------------------------ adapters

export function memoryAdapter(doc = null) {
  let held = doc ? clone(doc) : null;
  return { load: () => (held ? clone(held) : null), save: d => { held = clone(d); } };
}

export function localStorageAdapter(key = STORE_KEY) {
  return {
    load() { try { return JSON.parse(localStorage.getItem(key)) || null; } catch (e) { return null; } },
    save(doc) { try { localStorage.setItem(key, JSON.stringify(doc)); return true; } catch (e) { return false; } },
  };
}

// ------------------------------------------------------------------ errors

export class ValidationError extends Error {
  constructor(errors, what = 'input') {
    super(`${what} failed validation:\n  - ${errors.join('\n  - ')}`);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

// ------------------------------------------------------------------ the store

export class UniverseStore {
  constructor({ adapter = memoryAdapter(), name = 'Universe', autosave = true } = {}) {
    this.adapter = adapter;
    this.autosave = autosave;
    this.doc = adapter.load() || emptyDoc(name);
    migrate(this.doc);
  }

  // -- persistence ---------------------------------------------------------
  save() {
    this.doc.meta.updatedAt = nowISO();
    return this.adapter.save(this.doc) !== false;
  }
  touch() { if (this.autosave) this.save(); }
  toJSON() { return clone(this.doc); }

  static fromJSON(doc, opts = {}) {
    const s = new UniverseStore({ ...opts, adapter: memoryAdapter(doc) });
    return s;
  }

  // -- entities ------------------------------------------------------------
  bucket(kind) {
    const b = KINDS[kind];
    if (!b) throw new Error(`unknown entity kind: ${kind}`);
    return this.doc.entities[b];
  }

  addEntity(kind, rec, { id = null, upsert = false } = {}) {
    const errors = validateEntity(kind, rec);
    if (errors.length) throw new ValidationError(errors, `${kind} "${rec.name || '?'}"`);
    const eid = id || rec.id || entityId(kind, rec.name);
    const bucket = this.bucket(kind);
    if (bucket[eid] && !upsert) throw new ValidationError([`${kind} ${eid} already exists`], 'entity');
    // No `kind` marker on the record: a group carries its own `kind`
    // (tagTeam / faction / alliance) and the entity kind is already in the id
    // prefix, so writing one here would quietly clobber the other.
    bucket[eid] = { ...(bucket[eid] || {}), ...rec, id: eid };
    this.touch();
    return bucket[eid];
  }

  getEntity(id) {
    if (!id) return null;
    for (const b of Object.values(this.doc.entities)) if (b[id]) return b[id];
    return null;
  }

  entitiesOf(kind) { return Object.values(this.bucket(kind)); }

  // Every id the log is allowed to point at.
  knownIds() {
    const set = new Set();
    Object.values(this.doc.entities).forEach(b => Object.keys(b).forEach(id => set.add(id)));
    return set;
  }

  // Entity edits go through the same correction log as events, so the audit
  // trail is one list rather than two.
  amendEntity(id, patch, note = '') {
    const rec = this.getEntity(id);
    if (!rec) throw new ValidationError([`no such entity: ${id}`], 'correction');
    const kind = entityKind(id);
    const merged = { ...rec, ...patch, id: rec.id };
    const errors = validateEntity(kind, merged);
    if (errors.length) throw new ValidationError(errors, `amended ${kind}`);
    this.bucket(kind)[id] = merged;
    const cx = this.logCorrection({ target: 'entity', targetId: id, op: 'amend', patch, note });
    this.touch();
    return cx;
  }

  // Removing an entity is only ever right for one that nothing points at — a
  // belt created by mistake, a brand nobody was signed to. Anything the log has
  // touched must stay, or the log would refer to something that never existed.
  // Callers decide what "touched" means for their kind; this enforces the floor.
  removeEntity(id, note = '') {
    const rec = this.getEntity(id);
    if (!rec) throw new ValidationError([`no such entity: ${id}`], 'correction');
    const used = this.doc.events.find(e =>
      e.participants.some(p => p.ref === id)
      || Object.values(e.data || {}).includes(id)
      || (e.effects || []).some(fx => Object.values(fx).includes(id)));
    if (used) throw new ValidationError([`${id} is referenced by ${used.id} — it cannot be removed`], 'entity');

    delete this.bucket(entityKind(id))[id];
    const cx = this.logCorrection({ target: 'entity', targetId: id, op: 'remove', patch: rec, note });
    this.touch();
    return cx;
  }

  // -- events --------------------------------------------------------------

  // Turn loose input into a full event envelope. Shared by append() and by the
  // amend path, which is what keeps effects in step with corrected data.
  buildEvent(input, id, seq) {
    const type = input.type;
    if (!EVENT_TYPES[type]) throw new ValidationError([`unknown event type: ${type}`], 'event');
    const ev = {
      id, seq, type,
      date: input.date,
      showId: input.showId || null,
      cardOrder: input.cardOrder == null ? null : input.cardOrder,
      participants: (input.participants || []).map(p => ({
        ref: p.ref, role: p.role || 'subject', side: p.side == null ? null : p.side,
        ...(p.note ? { note: p.note } : {}),
      })),
      data: { ...(input.data || {}) },
      effects: [],
      note: input.note || '',
      source: input.source || 'manual',
      causeId: input.causeId || null,
      createdAt: input.createdAt || nowISO(),
    };
    ev.effects = deriveEffects(ev);
    return ev;
  }

  nextEventId(type, seq) { return `${type === 'show' ? 'sh' : 'ev'}_${pad(seq)}`; }

  append(input, { validate = true } = {}) {
    const [ev] = this.appendBatch([input], { validate });
    return ev;
  }

  // All-or-nothing: a card that fails halfway through leaves nothing behind.
  // Later events in the batch may reference entities created earlier in it.
  appendBatch(inputs, { validate = true } = {}) {
    const known = this.knownIds();
    const staged = [];
    const errors = [];
    let seq = this.doc.meta.seq;

    inputs.forEach((input, i) => {
      seq += 1;
      const id = input.id || this.nextEventId(input.type, seq);
      let ev;
      try { ev = this.buildEvent(input, id, seq); }
      catch (e) { errors.push(`event ${i + 1}: ${e.errors ? e.errors.join('; ') : e.message}`); return; }
      if (validate) {
        const errs = validateEvent(ev, known);
        errs.forEach(m => errors.push(`event ${i + 1} (${ev.type} ${ev.date}): ${m}`));
      }
      staged.push(ev);
    });

    if (errors.length) throw new ValidationError(errors, `${inputs.length} event(s)`);

    this.doc.events.push(...staged);
    this.doc.meta.seq = seq;
    this.touch();
    return staged;
  }

  getEvent(id) { return this.doc.events.find(e => e.id === id) || null; }

  // -- corrections ---------------------------------------------------------

  logCorrection({ target, targetId, op, patch = null, note = '' }) {
    this.doc.meta.cxSeq += 1;
    const cx = {
      id: `cx_${pad(this.doc.meta.cxSeq)}`,
      at: nowISO(), target, targetId, op,
      ...(patch ? { patch: clone(patch) } : {}),
      note,
    };
    this.doc.corrections.push(cx);
    return cx;
  }

  // Edit an event. The patch merges into the raw event; effects are rebuilt
  // from the merged result rather than patched, so the consequences of the old
  // version cannot survive. Validation runs against the merged event, so a bad
  // correction is refused before it reaches the log.
  amendEvent(id, patch, note = '') {
    const raw = this.getEvent(id);
    if (!raw) throw new ValidationError([`no such event: ${id}`], 'correction');
    const merged = mergeEvent(this.applied(raw), patch);
    const rebuilt = this.buildEvent(merged, raw.id, raw.seq);
    const errs = validateEvent(rebuilt, this.knownIds());
    if (errs.length) throw new ValidationError(errs, `amended ${raw.type} ${id}`);
    const cx = this.logCorrection({ target: 'event', targetId: id, op: 'amend', patch, note });
    this.touch();
    return cx;
  }

  voidEvent(id, note = '') {
    if (!this.getEvent(id)) throw new ValidationError([`no such event: ${id}`], 'correction');
    const cx = this.logCorrection({ target: 'event', targetId: id, op: 'void', note });
    this.touch();
    return cx;
  }

  restoreEvent(id, note = '') {
    if (!this.getEvent(id)) throw new ValidationError([`no such event: ${id}`], 'correction');
    const cx = this.logCorrection({ target: 'event', targetId: id, op: 'restore', note });
    this.touch();
    return cx;
  }

  // Every correction aimed at one event or entity, oldest first.
  historyOf(targetId) { return this.doc.corrections.filter(c => c.targetId === targetId); }

  // -- the corrected stream ------------------------------------------------

  // One event with its amendments applied (still including voided events —
  // callers that want the live history use effectiveEvents()).
  applied(raw) {
    const patches = this.doc.corrections.filter(c => c.target === 'event' && c.targetId === raw.id && c.op === 'amend');
    if (!patches.length) return raw;
    let out = raw;
    patches.forEach(c => { out = mergeEvent(out, c.patch); });
    out = this.buildEvent(out, raw.id, raw.seq);
    out.amended = patches.length;
    return out;
  }

  isVoided(id) {
    let voided = false;
    this.doc.corrections.forEach(c => {
      if (c.target !== 'event' || c.targetId !== id) return;
      if (c.op === 'void') voided = true;
      if (c.op === 'restore') voided = false;
    });
    return voided;
  }

  // History as it now stands: amended, voids dropped, in the order things
  // happened. Date first, then insertion order — so several matches typed in
  // on the same night stay in the order you typed them.
  effectiveEvents({ asOf = null, includeVoided = false } = {}) {
    let out = this.doc.events
      .filter(e => includeVoided || !this.isVoided(e.id))
      .map(e => {
        const ev = this.applied(e);
        return includeVoided && this.isVoided(e.id) ? { ...ev, voided: true } : ev;
      });
    if (asOf) out = out.filter(e => e.date <= asOf);
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));
  }

  // -- integrity -----------------------------------------------------------

  // Cheap consistency pass: dangling refs, bad dates, events that no longer
  // validate because an entity was renamed or removed under them.
  check() {
    const known = this.knownIds();
    const problems = [];
    this.doc.events.forEach(e => {
      if (this.isVoided(e.id)) return;
      const ev = this.applied(e);
      validateEvent(ev, known).forEach(m => problems.push({ level: 'error', id: ev.id, message: m }));
    });
    this.doc.corrections.forEach(c => {
      // A removal is the one correction whose target is *meant* to be gone.
      if (c.op === 'remove') return;
      const exists = c.target === 'event' ? !!this.getEvent(c.targetId) : !!this.getEntity(c.targetId);
      if (!exists) problems.push({ level: 'error', id: c.id, message: `correction targets missing ${c.target} ${c.targetId}` });
    });
    Object.values(this.doc.entities.groups || {}).forEach(g => {
      (g.memberIds || []).forEach(m => {
        if (!known.has(m)) problems.push({ level: 'warn', id: g.id, message: `group member ${m} is not in the registry` });
      });
    });
    if (!isDate(this.doc.meta.startDate || '2000-01-01')) problems.push({ level: 'warn', id: 'meta', message: 'meta.startDate is not a date' });
    return problems;
  }

  stats() {
    const byType = {};
    this.effectiveEvents().forEach(e => { byType[e.type] = (byType[e.type] || 0) + 1; });
    return {
      wrestlers: Object.keys(this.doc.entities.wrestlers).length,
      brands: Object.keys(this.doc.entities.brands).length,
      championships: Object.keys(this.doc.entities.championships).length,
      groups: Object.keys(this.doc.entities.groups).length,
      events: this.doc.events.length,
      live: this.effectiveEvents().length,
      voided: this.doc.events.filter(e => this.isVoided(e.id)).length,
      corrections: this.doc.corrections.length,
      byType,
    };
  }
}

// Patches merge one level into `data` (so you can change just the winner or
// just the title) and replace `participants` wholesale (a half-replaced roster
// of a match is never what anyone means). A null value clears a data field.
function mergeEvent(ev, patch) {
  if (!patch) return ev;
  const out = { ...ev, ...patch };
  out.data = { ...(ev.data || {}) };
  Object.entries(patch.data || {}).forEach(([k, v]) => {
    if (v === null) delete out.data[k]; else out.data[k] = v;
  });
  out.participants = patch.participants ? patch.participants : ev.participants;
  return out;
}

function migrate(doc) {
  doc.meta = doc.meta || {};
  doc.meta.version = doc.meta.version || SCHEMA_VERSION;
  doc.meta.seq = doc.meta.seq || 0;
  doc.meta.cxSeq = doc.meta.cxSeq || 0;
  doc.entities = doc.entities || {};
  Object.values(KINDS).forEach(b => { doc.entities[b] = doc.entities[b] || {}; });
  // A save written before the 28-day cycle existed simply has not anchored it
  // yet; calendar.js picks the anchor off the log the first time it is asked.
  doc.calendar = { cycleDays: 28, start: null, ...(doc.calendar || {}) };
  doc.events = doc.events || [];
  doc.corrections = doc.corrections || [];
  return doc;
}

export { mergeEvent, clone };
