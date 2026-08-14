// WWE 2K Universe — seeding from JSON.
//
// A seed file is written in names, not ids: "brand": "Raw", "members": ["Jey Uso"].
// Everything is resolved to entity ids on the way in, so the file stays
// hand-editable and a typo is a validation error rather than a dangling ref.
//
// The important choice here: seeding does not write "initial state", because
// there is no such thing in an event-sourced store. It writes the *founding
// events* — a contract for every wrestler on a brand, an alliance.formed for
// every tag team and faction, a title.change for whoever already holds a belt.
// Day one of the universe is therefore ordinary history: you can void the
// founding contract of a wrestler you added by mistake, and the roster
// recalculates exactly the way it would for anything else.

import { UniverseStore, ValidationError } from './store.js';
import { entityId, isDate } from './schema.js';
import { project } from './project.js';
import { buildIndex, resolve } from './util.js';

const arr = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

export function seedFromJSON(doc, { store = null, adapter = null, startDate = null } = {}) {
  const s = store || new UniverseStore(adapter ? { adapter } : {});
  const errors = [], warnings = [];
  const start = doc.startDate || startDate || new Date().toISOString().slice(0, 10);
  if (!isDate(start)) throw new ValidationError([`bad startDate: ${start}`], 'seed');

  s.doc.meta.name = doc.name || s.doc.meta.name;
  s.doc.meta.startDate = start;

  // -- registry ------------------------------------------------------------
  // Brands go in without their parent links, because a parent may appear later
  // in the file than the brand that names it. The links are resolved in a second
  // pass once every brand exists.
  arr(doc.brands).forEach(b => {
    const rec = typeof b === 'string' ? { name: b } : { ...b };
    delete rec.parent;
    delete rec.parentId;
    if (rec.tier != null) rec.tier = Number(rec.tier);
    try { s.addEntity('brand', rec, { upsert: true }); } catch (e) { errors.push(msg(e)); }
  });

  const brandIdx = buildIndex(s, 'brand');

  arr(doc.brands).forEach(b => {
    if (typeof b === 'string') return;
    const parent = b.parent || b.parentId;
    if (!parent) return;
    const self = resolve(brandIdx, b.name);
    const up = resolve(brandIdx, parent);
    if (!self.ok) return;
    if (!up.ok) { errors.push(`brand "${b.name}": unknown parent brand "${parent}"`); return; }
    s.bucket('brand')[self.id].parentId = up.id;
  });
  const brandRef = (name, where) => {
    if (name == null || name === '') return null;
    const r = resolve(brandIdx, name);
    if (!r.ok) { errors.push(`${where}: unknown brand "${name}"${r.candidates.length ? ` (did you mean ${r.candidates.join(', ')}?)` : ''}`); return null; }
    return r.id;
  };

  arr(doc.championships).forEach(c => {
    const rec = typeof c === 'string' ? { name: c } : { ...c };
    const brand = rec.brand || rec.brandId;
    delete rec.brand;
    rec.brandId = brandRef(brand, `championship "${rec.name}"`);
    rec.division = rec.division || (rec.teamSize > 1 ? 'tag' : 'unisex');
    try { s.addEntity('championship', rec, { upsert: true }); } catch (e) { errors.push(msg(e)); }
  });

  arr(doc.wrestlers).forEach(w => {
    const rec = typeof w === 'string' ? { name: w } : { ...w };
    // brand/status are read below to write founding events; they must not be
    // stored on the record, or they would shadow the log forever.
    if (!brandRef(rec.brand || rec.brandId, `wrestler "${rec.name}"`) && (rec.brand || rec.brandId)) return;
    ['brand', 'brandId', 'status', 'signedOn', 'expires'].forEach(k => delete rec[k]);
    try { s.addEntity('wrestler', rec, { upsert: true }); } catch (e) { errors.push(msg(e)); }
  });

  const wIdx = buildIndex(s, 'wrestler');
  const wrestlerRef = (name, where) => {
    const r = resolve(wIdx, name);
    if (!r.ok) { errors.push(`${where}: ${r.reason === 'ambiguous' ? `"${name}" matches ${r.candidates.join(', ')}` : `unknown wrestler "${name}"`}`); return null; }
    return r.id;
  };

  const groups = [];
  const addGroup = (g, kind) => {
    const rec = { ...g, kind: g.kind || kind };
    const where = `${kind} "${rec.name}"`;
    rec.brandId = brandRef(rec.brand || rec.brandId, where);
    delete rec.brand;
    rec.memberIds = arr(rec.members || rec.memberIds).map(m => wrestlerRef(m, where)).filter(Boolean);
    if (rec.leader) { rec.leaderId = wrestlerRef(rec.leader, where); delete rec.leader; }
    delete rec.members;
    try { groups.push(s.addEntity('group', rec, { upsert: true })); } catch (e) { errors.push(msg(e)); }
  };
  arr(doc.tagTeams).forEach(g => addGroup(g, 'tagTeam'));
  arr(doc.factions).forEach(g => addGroup(g, 'faction'));
  arr(doc.groups).forEach(g => addGroup(g, g.kind || 'alliance'));

  if (errors.length) throw new ValidationError(errors, 'seed registry');

  // -- founding events -----------------------------------------------------
  const founding = [];

  arr(doc.wrestlers).forEach(w => {
    const rec = typeof w === 'string' ? { name: w } : w;
    const id = entityId('wrestler', rec.name);
    const brandId = brandRef(rec.brand || rec.brandId, `wrestler "${rec.name}"`);
    const status = rec.status || (brandId ? 'active' : 'free agent');
    if (brandId) {
      founding.push({
        type: 'contract.signed', date: rec.signedOn || start, source: 'seed',
        participants: [{ ref: id, role: 'subject' }],
        data: { brandId, expires: rec.expires || null, status: status === 'free agent' ? 'active' : status },
        note: 'founding roster',
      });
    }
    if (!brandId || status === 'free agent') {
      founding.push({
        type: 'status.change', date: start, source: 'seed',
        participants: [{ ref: id, role: 'subject' }],
        data: { status: brandId ? status : 'free agent', reason: 'founding roster' },
      });
    }
  });

  groups.forEach(g => {
    if (!g.memberIds || g.memberIds.length < 2) {
      if (g.memberIds && g.memberIds.length < 2) warnings.push(`${g.kind} "${g.name}" has fewer than two members — no alliance event written`);
      return;
    }
    founding.push({
      type: 'alliance.formed', date: g.formedOn || start, source: 'seed',
      participants: g.memberIds.map(m => ({ ref: m, role: m === g.leaderId ? 'leader' : 'member' })),
      data: { groupId: g.id, groupKind: g.kind, name: g.name, brandId: g.brandId || null },
      note: 'founding alliance',
    });
  });

  arr(doc.titleHolders).forEach(t => {
    const cIdx = buildIndex(s, 'championship');
    const r = resolve(cIdx, t.title || t.titleId);
    if (!r.ok) { errors.push(`title holder: unknown championship "${t.title || t.titleId}"`); return; }
    const holders = arr(t.holders || t.holder).map(h => wrestlerRef(h, `holder of "${t.title}"`)).filter(Boolean);
    if (!holders.length) return;
    founding.push({
      type: 'title.change', date: t.since || start, source: 'seed',
      participants: holders.map(h => ({ ref: h, role: 'champion' })),
      data: { titleId: r.id, reason: 'awarded' },
      note: t.note || 'reign in progress at universe start',
    });
  });

  if (errors.length) throw new ValidationError(errors, 'seed events');

  // Founding events are written in date order so a seed with staggered dates
  // (a reign that started before the universe did) still replays cleanly.
  founding.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  s.appendBatch(founding);

  // -- explicit history ----------------------------------------------------
  const written = arr(doc.events).map((e, i) => resolveEventRefs(s, e, `events[${i}]`, errors));
  if (errors.length) throw new ValidationError(errors, 'seed history');
  if (written.length) s.appendBatch(written);

  s.save();
  return { store: s, report: { ...s.stats(), founding: founding.length, history: written.length, warnings } };
}

// Turn an event written in names into one written in ids. Used by the seeder and
// by anything else that accepts hand-authored JSON.
export function resolveEventRefs(store, input, where = 'event', errors = []) {
  const wIdx = buildIndex(store, 'wrestler');
  const cIdx = buildIndex(store, 'championship');
  const bIdx = buildIndex(store, 'brand');
  const gIdx = buildIndex(store, 'group');

  const pickFrom = (idx, name, label) => {
    if (name == null || name === '') return null;
    const r = resolve(idx, name);
    if (!r.ok) {
      errors.push(`${where}: ${r.reason === 'ambiguous' ? `"${name}" matches ${r.candidates.join(', ')}` : `unknown ${label} "${name}"`}`);
      return null;
    }
    return r.id;
  };

  const out = { ...input, data: { ...(input.data || {}) } };
  out.participants = arr(input.participants).map(p => {
    const raw = typeof p === 'string' ? { ref: p } : { ...p };
    const id = store.getEntity(raw.ref) ? raw.ref
      : (pickFrom(wIdx, raw.ref, 'wrestler') || pickFrom(gIdx, raw.ref, 'group'));
    return { ...raw, ref: id };
  }).filter(p => p.ref);

  if (out.data.title && !out.data.titleId) { out.data.titleId = pickFrom(cIdx, out.data.title, 'championship'); delete out.data.title; }
  if (out.data.brand && !out.data.brandId) { out.data.brandId = pickFrom(bIdx, out.data.brand, 'brand'); delete out.data.brand; }
  if (out.data.toBrand && !out.data.toBrandId) { out.data.toBrandId = pickFrom(bIdx, out.data.toBrand, 'brand'); delete out.data.toBrand; }
  if (out.data.group && !out.data.groupId) { out.data.groupId = pickFrom(gIdx, out.data.group, 'group'); delete out.data.group; }
  return out;
}

// The inverse: the registry as a seed file, for backing up or forking a
// universe. History is not included — use store.toJSON() for that.
// Brands, statuses and memberships come from the projection rather than the
// registry, so an exported seed describes the universe as it stands now — feed
// it back in and you get the same rosters, not the ones you started with.
export function exportSeed(store, state = null) {
  const st = state || project(store);
  const name = id => (store.getEntity(id) || {}).name || id;
  const groups = Object.values(st.groups);
  const champs = Object.values(st.championships);
  return {
    name: store.doc.meta.name,
    startDate: store.doc.meta.startDate || null,
    brands: store.entitiesOf('brand').map(b => ({ name: b.name, color: b.color || undefined })),
    championships: store.entitiesOf('championship').map(c => ({ name: c.name, brand: c.brandId ? name(c.brandId) : undefined, division: c.division })),
    wrestlers: Object.values(st.wrestlers).map(w => ({
      name: w.name, gender: w.gender || undefined, brand: w.brandId ? name(w.brandId) : undefined,
      status: w.status, alignment: w.alignment || undefined,
    })),
    tagTeams: groups.filter(g => g.kind === 'tagTeam' && g.active).map(g => ({ name: g.name, members: g.members.map(name), brand: g.brandId ? name(g.brandId) : undefined })),
    factions: groups.filter(g => g.kind === 'faction' && g.active).map(g => ({ name: g.name, members: g.members.map(name), leader: g.leaderId ? name(g.leaderId) : undefined })),
    titleHolders: champs.filter(c => !c.vacant).map(c => ({ title: c.name, holders: c.holders.map(name), since: c.since })),
  };
}

const msg = e => (e.errors ? e.errors.join('; ') : e.message);
