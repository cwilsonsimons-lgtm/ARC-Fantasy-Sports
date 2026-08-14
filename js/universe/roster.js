// WWE 2K Universe — roster import.
//
// You paste the roster; this reads it. There is no field order to remember and
// no template to fill in, because the parser classifies each field by what it
// *is* rather than where it sits: "Raw" is a brand wherever it appears on the
// line, "f" is a gender, "relegation" is a status. All of these are the same
// wrestler:
//
//   Rhea Ripley, Raw, female, active
//   Rhea Ripley | f | RAW
//   Rhea Ripley (female) - active
//
// and under a `RAW` section header, the brand can be left off entirely.
//
// Import is a *sync*, not an insert. It diffs the paste against the universe as
// it currently stands and writes only the events that account for the
// difference — a contract for someone new, a brand.transfer for someone who
// moved, a status.change for a new flag. Pasting the same roster twice writes
// nothing the second time, so it is safe to re-paste the whole list after every
// draft instead of trying to remember what changed.

import { STATUSES, GENDERS, entityId } from './schema.js';
import { buildIndex, resolve, norm, table, heading, plural } from './util.js';
import { project } from './project.js';

// ------------------------------------------------------------------ vocabulary

const GENDER_WORDS = {
  m: 'male', male: 'male', men: 'male', mens: 'male', man: 'male', guy: 'male',
  f: 'female', female: 'female', women: 'female', womens: 'female', woman: 'female', w: 'female',
  other: 'other', nb: 'other', x: 'other',
};

const STATUS_WORDS = {
  active: 'active', act: 'active', a: 'active', roster: 'active',
  relegation: 'relegation-flagged', relegated: 'relegation-flagged', rel: 'relegation-flagged',
  'relegation flagged': 'relegation-flagged', demote: 'relegation-flagged', demotion: 'relegation-flagged',
  down: 'relegation-flagged', drop: 'relegation-flagged',
  promotion: 'promotion-flagged', promoted: 'promotion-flagged', promote: 'promotion-flagged',
  promo: 'promotion-flagged', 'promotion flagged': 'promotion-flagged', callup: 'promotion-flagged',
  'call up': 'promotion-flagged', up: 'promotion-flagged',
  fa: 'free agent', free: 'free agent', 'free agent': 'free agent', freeagent: 'free agent',
  unsigned: 'free agent', 'no contract': 'free agent',
  injured: 'injured', hurt: 'injured', out: 'injured',
  released: 'released', cut: 'released', gone: 'released',
};

const ALIGN_WORDS = { face: 'face', babyface: 'face', good: 'face', heel: 'heel', bad: 'heel', tweener: 'tweener', neutral: 'tweener' };

const GROUP_PREFIX = /^(tag\s*team|tag|team|faction|stable|group|alliance)s?\s*[:\-—–]\s*/i;
const SECTION_GROUPS = { 'tag teams': 'tagTeam', 'tag team': 'tagTeam', teams: 'tagTeam', factions: 'faction', stables: 'faction', groups: 'alliance', alliances: 'alliance' };
const FREE_AGENT_SECTION = /^(free\s*agents?|unsigned|no\s*contract)$/i;

// ------------------------------------------------------------------ parsing

// Fields are separated by pipes, tabs, semicolons, commas, or a spaced dash.
// A spaced dash only — so "Jean-Paul Levesque" survives intact.
function splitFields(line) {
  const out = [];
  const parens = [];
  // Bracketed asides are pulled out first but appended last, so the name stays
  // the first field in "Rhea Ripley (female) - active".
  const rest = line.replace(/\(([^)]*)\)/g, (_, inner) => { parens.push(inner.trim()); return ' '; });
  rest.split(/\s*[|\t;]\s*|\s*,\s*|\s+[-–—]\s+/).forEach(f => { const t = f.trim(); if (t) out.push(t); });
  return out.concat(parens.filter(Boolean));
}

function classify(field, brandIdx) {
  const n = norm(field);
  if (GENDER_WORDS[n]) return { kind: 'gender', value: GENDER_WORDS[n] };
  if (STATUS_WORDS[n]) return { kind: 'status', value: STATUS_WORDS[n] };
  if (ALIGN_WORDS[n]) return { kind: 'alignment', value: ALIGN_WORDS[n] };
  if (STATUSES.includes(n)) return { kind: 'status', value: n };
  if (GENDERS.includes(n)) return { kind: 'gender', value: n };
  const b = resolve(brandIdx, field);
  if (b.ok) return { kind: 'brand', value: b.id, label: b.name };
  if (/^\d{1,3}$/.test(n)) return { kind: 'overall', value: +n };
  return { kind: 'unknown', value: field };
}

// Split a group line into name and members:
//   "The Usos = Jimmy Uso & Jey Uso"   "The Bloodline: Roman Reigns, Solo Sikoa"
//   "The Judgment Day (Balor, Priest)"
function splitGroup(text) {
  const paren = text.match(/^([^(]+)\(([^)]*)\)\s*$/);
  if (paren) return { name: paren[1].trim(), members: paren[2] };
  const m = text.match(/^(.+?)\s*[=:]\s*(.+)$/) || text.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return m ? { name: m[1].trim(), members: m[2] } : { name: text.trim(), members: '' };
}

const splitMembers = s => s.split(/\s*[&+,]\s*|\s+and\s+/i).map(t => t.trim()).filter(Boolean);

export function parseRoster(text, store, { defaultStatus = 'active' } = {}) {
  const brandIdx = buildIndex(store, 'brand');
  const wrestlers = [], groups = [], errors = [], warnings = [];
  let section = null;            // current brand id from a section header
  let sectionLabel = null;
  let groupSection = null;       // 'tagTeam' | 'faction' | null
  const seen = new Map();

  const fail = (lineNo, line, message) => errors.push({ lineNo, line, message });
  const warn = (lineNo, line, message) => warnings.push({ lineNo, line, message });

  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const lineNo = i + 1;
    let line = raw.replace(/\s+$/, '');
    if (!line.trim() || /^([-=*_#]{3,}|\/\/)/.test(line.trim())) return;         // blank or a rule
    line = line.replace(/^\s*(?:[#>*•\-–—]+\s*)+/, '').trim();                    // bullets and markdown headers
    if (!line) return;

    const bare = line.replace(/[:：]\s*$/, '').trim();

    // -- section headers ---------------------------------------------------
    const asGroupSection = SECTION_GROUPS[norm(bare)];
    if (asGroupSection && !/[=(]/.test(line)) { groupSection = asGroupSection; return; }
    if (FREE_AGENT_SECTION.test(bare)) { section = null; sectionLabel = 'Free agents'; groupSection = null; return; }
    if (!/[|,=(]/.test(line) && splitFields(bare).length === 1) {
      const b = resolve(brandIdx, bare);
      if (b.ok) { section = b.id; sectionLabel = b.name; groupSection = null; return; }
    }

    // -- groups ------------------------------------------------------------
    const prefixed = GROUP_PREFIX.exec(line);
    if (prefixed || (groupSection && /[=(:]|\s+&\s+/.test(line))) {
      const kind = prefixed
        ? (/faction|stable/i.test(prefixed[1]) ? 'faction' : /alliance|group/i.test(prefixed[1]) ? 'alliance' : 'tagTeam')
        : groupSection;
      const body = prefixed ? line.slice(prefixed[0].length) : line;
      const { name, members } = splitGroup(body);
      const list = splitMembers(members);
      if (!name) { fail(lineNo, raw, 'group has no name'); return; }
      if (list.length < 2) { fail(lineNo, raw, `group "${name}" needs at least two members (write "Name = A & B")`); return; }
      groups.push({ name, kind, members: list, brandId: section, lineNo, line: raw });
      return;
    }

    // -- wrestlers ---------------------------------------------------------
    const fields = splitFields(line);
    const name = fields.shift();
    if (!name || name.length < 2) { fail(lineNo, raw, 'no name on this line'); return; }

    const rec = { name, gender: null, brandId: section, status: null, alignment: null, overall: null, lineNo, line: raw };
    fields.forEach(f => {
      const c = classify(f, brandIdx);
      if (c.kind === 'unknown') warn(lineNo, raw, `ignored unrecognised field "${c.value}"`);
      else if (c.kind === 'brand') rec.brandId = c.value;
      else rec[c.kind] = c.value;
    });

    if (!rec.status) rec.status = rec.brandId ? defaultStatus : 'free agent';
    if (rec.status === 'free agent') rec.brandId = null;
    if (!rec.gender) warn(lineNo, raw, `no gender given for "${name}"`);
    if (!rec.brandId && rec.status !== 'free agent' && rec.status !== 'released') {
      warn(lineNo, raw, `no brand for "${name}" — filed as a free agent`);
      rec.status = 'free agent';
    }

    const key = norm(name);
    if (seen.has(key)) { fail(lineNo, raw, `duplicate: "${name}" already appears on line ${seen.get(key)}`); return; }
    seen.set(key, lineNo);
    wrestlers.push(rec);
  });

  // -- group members must exist, in the paste or already in the universe ----
  const pasted = new Map(wrestlers.map(w => [norm(w.name), w.name]));
  const wIdx = buildIndex(store, 'wrestler');
  groups.forEach(g => {
    g.memberNames = g.members.map(m => {
      if (pasted.has(norm(m))) return pasted.get(norm(m));
      const r = resolve(wIdx, m);
      if (r.ok) return r.name;
      errors.push({ lineNo: g.lineNo, line: g.line, message: `${g.kind} "${g.name}": "${m}" is not in this roster or the universe${r.candidates && r.candidates.length ? ` (did you mean ${r.candidates.join(', ')}?)` : ''}` });
      return null;
    }).filter(Boolean);
  });

  return { wrestlers, groups, errors, warnings, sectionLabel };
}

// ------------------------------------------------------------------ commit

// Diff the parsed roster against current state and write only what differs.
// Returns the events written (or that *would* be written, with dryRun).
export function commitRoster(store, parsed, { date = new Date().toISOString().slice(0, 10), dryRun = false } = {}) {
  if (parsed.errors.length) {
    const e = new Error(`roster has ${plural(parsed.errors.length, 'error')} — nothing was imported`);
    e.errors = parsed.errors;
    throw e;
  }

  const before = project(store);
  const created = { wrestlers: [], groups: [] };
  const events = [];
  const summary = { added: [], moved: [], flagged: [], unchanged: [], groupsFormed: [], groupsChanged: [] };

  // -- wrestlers -----------------------------------------------------------
  parsed.wrestlers.forEach(r => {
    const idx = buildIndex(store, 'wrestler');
    const hit = resolve(idx, r.name);
    const existing = hit.ok ? before.wrestlers[hit.id] : null;

    if (!existing) {
      const rec = { name: r.name, gender: r.gender || undefined, alignment: r.alignment || undefined, overall: r.overall || undefined };
      const id = entityId('wrestler', r.name);
      if (!dryRun) store.addEntity('wrestler', rec, { upsert: true });
      created.wrestlers.push({ id, ...rec, brandId: r.brandId, status: r.status });
      summary.added.push({ id, name: r.name, brandId: r.brandId, brandName: brandName(before, r.brandId), status: r.status });

      if (r.brandId) {
        events.push({
          type: 'contract.signed', date, source: 'roster-import',
          participants: [{ ref: id, role: 'subject' }],
          data: { brandId: r.brandId, status: r.status === 'free agent' ? 'active' : r.status },
          note: 'roster import',
        });
      } else {
        events.push({
          type: 'status.change', date, source: 'roster-import',
          participants: [{ ref: id, role: 'subject' }],
          data: { status: r.status, reason: 'roster import' },
        });
      }
      return;
    }

    const id = hit.id;
    let touched = false;

    // Registry facts (gender, alignment) are corrections, not events — they
    // describe who someone is, not something that happened.
    const patch = {};
    if (r.gender && r.gender !== existing.gender) patch.gender = r.gender;
    if (r.alignment && r.alignment !== existing.alignment) patch.alignment = r.alignment;
    if (Object.keys(patch).length && !dryRun) store.amendEntity(id, patch, 'roster import');

    if (r.brandId && r.brandId !== existing.brandId) {
      const reason = r.status === 'promotion-flagged' || existing.status === 'promotion-flagged' ? 'promotion'
        : r.status === 'relegation-flagged' || existing.status === 'relegation-flagged' ? 'relegation' : 'draft';
      events.push({
        type: existing.contract ? 'brand.transfer' : 'contract.signed', date, source: 'roster-import',
        participants: [{ ref: id, role: 'subject' }],
        data: existing.contract
          ? { toBrandId: r.brandId, fromBrandId: existing.brandId || null, reason }
          : { brandId: r.brandId, status: 'active' },
        note: 'roster import',
      });
      summary.moved.push({
        id, name: existing.name, from: existing.brandId, to: r.brandId, reason,
        fromName: brandName(before, existing.brandId), toName: brandName(before, r.brandId),
      });
      touched = true;
    }

    // The paste is the desired state: a status event is written whenever the
    // text disagrees with the projection, and not otherwise. Re-importing the
    // same text therefore writes nothing at all.
    const wantStatus = r.status;
    if (wantStatus && wantStatus !== existing.status) {
      if (wantStatus === 'free agent' && existing.contract) {
        events.push({
          type: 'contract.expired', date, source: 'roster-import',
          participants: [{ ref: id, role: 'subject' }],
          data: { reason: 'roster import' },
        });
      } else {
        events.push({
          type: 'status.change', date, source: 'roster-import',
          participants: [{ ref: id, role: 'subject' }],
          data: { status: wantStatus, reason: 'roster import' },
        });
      }
      summary.flagged.push({ id, name: existing.name, from: existing.status, to: wantStatus });
      touched = true;
    }

    if (!touched && !Object.keys(patch).length) summary.unchanged.push({ id, name: existing.name });
  });

  // -- groups --------------------------------------------------------------
  parsed.groups.forEach(g => {
    const wIdx = buildIndex(store, 'wrestler');
    const memberIds = g.memberNames.map(n => {
      const r = resolve(wIdx, n);
      return r.ok ? r.id : entityId('wrestler', n);
    });
    const gIdx = buildIndex(store, 'group');
    const hit = resolve(gIdx, g.name);
    const existing = hit.ok ? before.groups[hit.id] : null;
    const gid = hit.ok ? hit.id : entityId('group', g.name);

    if (!existing) {
      if (!dryRun) store.addEntity('group', { name: g.name, kind: g.kind, brandId: g.brandId || undefined }, { id: gid, upsert: true });
      created.groups.push({ id: gid, name: g.name, kind: g.kind, memberIds });
      events.push({
        type: 'alliance.formed', date, source: 'roster-import',
        participants: memberIds.map(m => ({ ref: m, role: 'member' })),
        data: { groupId: gid, groupKind: g.kind, name: g.name, brandId: g.brandId || null },
        note: 'roster import',
      });
      summary.groupsFormed.push({ id: gid, name: g.name, kind: g.kind, members: memberIds.length });
      return;
    }

    const now = new Set(existing.members);
    const want = new Set(memberIds);
    const gone = [...now].filter(m => !want.has(m));
    const joined = [...want].filter(m => !now.has(m));
    if (gone.length) {
      events.push({
        type: 'alliance.broken', date, source: 'roster-import',
        participants: gone.map(m => ({ ref: m, role: 'member' })),
        data: {
          groupId: gid, reason: 'roster import',
          // The paste still lists this group, so it only folds if nobody is
          // left in it afterwards.
          dissolve: gone.length === now.size && !joined.length,
          // And a corrected line-up is not a walkout: a paste states who is in
          // the group, it does not tell a story about somebody turning. Type a
          // card if you want the betrayal.
          betrayal: false,
        },
      });
    }
    if (joined.length) {
      // A group that had split up — or that this very paste just emptied —
      // re-forms with its whole line-up; one that is already going simply gains
      // a member. Writing the second as a forming event would restate the
      // group's founding every time somebody joined.
      const reform = !existing.active || gone.length === now.size;
      events.push({
        type: 'alliance.formed', date, source: 'roster-import',
        participants: (reform ? memberIds : joined).map(m => ({ ref: m, role: 'member' })),
        data: {
          groupId: gid, groupKind: existing.kind, name: existing.name,
          brandId: g.brandId || existing.brandId || null,
          ...(reform ? {} : { join: true }),
        },
      });
    }
    if (gone.length || joined.length) summary.groupsChanged.push({ id: gid, name: existing.name, joined: joined.length, left: gone.length });
  });

  if (dryRun) return { events, summary, created, written: 0 };

  // Entities for anyone created above must exist before the batch validates.
  created.wrestlers.forEach(w => { if (!store.getEntity(w.id)) store.addEntity('wrestler', { name: w.name }, { id: w.id, upsert: true }); });
  const written = events.length ? store.appendBatch(events) : [];
  store.save();
  return { events: written, summary, created, written: written.length };
}

// ------------------------------------------------------------------ the table

// Who is on each brand, as plain text. This is the "show me" half of the import
// and the first real read of the projection.
export function brandTable(state, { showRecord = true } = {}) {
  const out = [];
  const flag = w => (w.status === 'active' ? '' : w.status === 'promotion-flagged' ? '↑ promotion'
    : w.status === 'relegation-flagged' ? '↓ relegation' : w.status);

  const cols = [
    { label: 'Wrestler', get: w => w.name },
    { label: 'G', get: w => (w.gender === 'female' ? 'F' : w.gender === 'male' ? 'M' : w.gender ? '·' : '?') },
    { label: 'Status', get: flag },
    ...(showRecord ? [{ label: 'W-L-D', align: 'right', get: w => (w.record.total ? `${w.record.w}-${w.record.l}-${w.record.d}` : '—') }] : []),
    { label: 'Titles', get: w => w.titles.map(t => (state.championships[t] ? state.championships[t].name : t)).join(', ') },
    { label: 'Group', get: w => w.groups.map(g => (state.groups[g] ? state.groups[g].name : g)).join(', ') },
  ];

  Object.values(state.brands).forEach(b => {
    const roster = b.roster.map(id => state.wrestlers[id]);
    const m = roster.filter(w => w.gender === 'male').length;
    const f = roster.filter(w => w.gender === 'female').length;
    out.push(heading(`${b.name}  —  ${plural(roster.length, 'wrestler')} (${m}M / ${f}F)`));
    out.push(table(roster, cols, { indent: '  ' }));
  });

  const fa = state.freeAgents.map(id => state.wrestlers[id]);
  if (fa.length) {
    out.push(heading(`Free agents  —  ${plural(fa.length, 'wrestler')}`));
    out.push(table(fa, cols, { indent: '  ' }));
  }

  const groups = Object.values(state.groups).filter(g => g.active && g.members.length);
  if (groups.length) {
    out.push(heading(`Tag teams & factions  —  ${groups.length}`));
    out.push(table(groups, [
      { label: 'Name', get: g => g.name },
      { label: 'Kind', get: g => (g.kind === 'tagTeam' ? 'tag team' : g.kind) },
      { label: 'Brand', get: g => (g.brandId && state.brands[g.brandId] ? state.brands[g.brandId].name : '—') },
      { label: 'Members', get: g => g.members.map(m => (state.wrestlers[m] ? state.wrestlers[m].name : m)).join(', ') },
    ], { indent: '  ' }));
  }

  return out.join('\n');
}

const brandName = (state, id) => (id && state.brands[id] ? state.brands[id].name : null);

// A short account of what an import actually did.
export function importReport(result) {
  const { summary } = result;
  const bits = [];
  const list = (label, rows, fmt) => { if (rows.length) bits.push(`${label} (${rows.length}): ${rows.map(fmt).join(', ')}`); };
  list('Added', summary.added, r => `${r.name}${r.brandName ? ` (${r.brandName})` : ' (free agent)'}`);
  list('Moved', summary.moved, r => `${r.name}: ${r.fromName || 'free agent'} → ${r.toName} [${r.reason}]`);
  list('Flagged', summary.flagged, r => `${r.name} ${r.from} → ${r.to}`);
  list('Groups formed', summary.groupsFormed, r => r.name);
  list('Groups changed', summary.groupsChanged, r => `${r.name} (+${r.joined}/-${r.left})`);
  if (summary.unchanged.length) bits.push(`Unchanged: ${summary.unchanged.length}`);
  bits.push(`${plural(result.written != null ? result.written : result.events.length, 'event')} written`);
  return bits.join('\n');
}
