// WWE 2K Universe — schema.
//
// Everything that happens in the universe is an event. Events are append-only
// and immutable; nothing is ever updated in place. Current state (who holds a
// belt, who is on which brand, win/loss records, who is aligned with whom) is
// never stored — it is folded out of the event log on demand by project.js.
// Editing history therefore means writing a correction, then replaying.
//
// THE ONE INVARIANT THAT MAKES CORRECTIONS SAFE:
//
//   An event's `effects` must be a pure function of its own `participants` and
//   `data`. Never look at surrounding state when building them.
//
// If an effect baked in a fact about the world at the time it was written ("the
// belt moves from Cody to Roman"), then voiding some earlier event would leave
// that stale premise behind and the replay would drift. So effects state only
// what the event itself asserts ("the belt is now on Roman"), and the projector
// works out the consequences against whatever state the replay has reached.
// Void the match where Cody won the belt and every later reign still lines up.
//
// The write-time question "did the title change hands here?" is a question for
// the *author* (and card.js answers it for them by looking at current state),
// not for the effect builder.

// ------------------------------------------------------------------ vocabulary

export const GENDERS = ['male', 'female', 'other'];

// Status is the roster flag the player sets in Universe mode. 'injured' is
// derived from injury events rather than typed, but lives in the same field.
export const STATUSES = ['active', 'relegation-flagged', 'promotion-flagged', 'free agent', 'injured', 'released'];

export const ALIGNMENTS = ['face', 'heel', 'tweener'];

export const GROUP_KINDS = ['tagTeam', 'faction', 'alliance'];

export const DIVISIONS = ['mens', 'womens', 'tag', 'mixed', 'unisex'];

// How a match ended. Anything not in this list is kept as a free-text note.
export const DECISIONS = ['pinfall', 'submission', 'dq', 'countout', 'ko', 'stoppage', 'draw', 'no contest'];

// Recognised match types. Unknown types are allowed through as free text — the
// game keeps adding stipulations and a hard list would only get in the way.
export const MATCH_TYPES = [
  'singles', 'tag', 'six-man tag', 'eight-man tag', 'triple threat', 'fatal four-way',
  'battle royal', 'royal rumble', 'gauntlet', 'ladder', 'tables', 'chairs', 'tlc',
  'steel cage', 'hell in a cell', 'elimination chamber', 'last man standing',
  'extreme rules', 'no disqualification', 'submission', 'iron man', 'casket', 'ambulance',
];

// Participant roles, per event type. `side` groups participants into corners:
// same side = partners, different side = opponents.
export const ROLES = [
  'competitor', 'winner', 'loser', 'attacker', 'victim', 'speaker', 'target',
  'member', 'leader', 'champion', 'challenger', 'subject', 'partner',
];

// The complete set of state deltas an event may declare. project.js has one
// handler per kind; adding an event type usually means reusing these, not
// growing the list.
export const EFFECT_KINDS = [
  'record.win', 'record.loss', 'record.draw',
  'title.award', 'title.vacate', 'title.defense',
  'roster.brand', 'roster.status', 'roster.align',
  'contract.start', 'contract.end',
  'injury.start', 'injury.end',
  'group.form', 'group.join', 'group.leave', 'group.dissolve',
  'feud.heat',
  'show.open',
];

export const ENTITY_PREFIX = { wrestler: 'w', brand: 'b', championship: 'c', group: 'g' };

// ------------------------------------------------------------------ ids

export function slug(s) {
  return String(s == null ? '' : s)
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function entityId(kind, name) {
  const p = ENTITY_PREFIX[kind];
  if (!p) throw new Error(`unknown entity kind: ${kind}`);
  return `${p}:${slug(name)}`;
}

export function entityKind(id) {
  const p = String(id || '').split(':')[0];
  return Object.keys(ENTITY_PREFIX).find(k => ENTITY_PREFIX[k] === p) || null;
}

export const pad = (n, w = 4) => String(n).padStart(w, '0');

// ------------------------------------------------------------------ entities
//
// The registry answers "who exists" and holds facts that do not change with
// time (identity, gender, the name a belt was created under). Anything that
// *does* change — brand, status, membership, who holds what — is deliberately
// absent here and comes from the event fold. A wrestler record's `brandId` and
// `status` are seeds only: roster.js turns them into the contract and transfer
// events that establish the same thing as history.

export const ENTITY_SPECS = {
  // Note what is NOT here: brand, status, titles, record, stable. Those move
  // with time, so they belong to the log. A seed file may write `brand` and
  // `status` for convenience, but seed.js turns them into contract and status
  // events and drops them before the record is stored — otherwise a registry
  // value would shadow the events and a voided contract could not take a
  // wrestler off the roster.
  wrestler: {
    fields: { name: 'string', gender: 'enum:GENDERS', alignment: 'enum:ALIGNMENTS', debut: 'date?', aliases: 'array?', overall: 'number?', note: 'string?' },
    required: ['name'],
  },
  brand: {
    fields: { name: 'string', color: 'string?', tier: 'number?', note: 'string?' },
    required: ['name'],
  },
  championship: {
    fields: { name: 'string', brandId: 'ref?', division: 'enum:DIVISIONS', teamSize: 'number?', activeFrom: 'date?', retiredOn: 'date?', note: 'string?' },
    required: ['name'],
  },
  group: {
    fields: { name: 'string', kind: 'enum:GROUP_KINDS', memberIds: 'array?', leaderId: 'ref?', brandId: 'ref?', formedOn: 'date?', note: 'string?' },
    required: ['name', 'kind'],
  },
};

export const ENUMS = { GENDERS, STATUSES, ALIGNMENTS, GROUP_KINDS, DIVISIONS, DECISIONS };

// ------------------------------------------------------------------ helpers

const err = (list, msg) => { list.push(msg); return list; };
const asArray = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
const refsOf = (ev, ...roles) => ev.participants.filter(p => roles.includes(p.role)).map(p => p.ref);
const sides = ev => {
  const by = new Map();
  ev.participants.forEach(p => {
    const k = p.side == null ? 0 : p.side;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(p.ref);
  });
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([side, refs]) => ({ side, refs }));
};

// Heat is the only thing attacks and promos leave behind. Without it those two
// event types would be write-only — recorded but invisible to every view.
const heat = (ev, points) => {
  const s = sides(ev);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    for (let j = i + 1; j < s.length; j++) {
      s[i].refs.forEach(a => s[j].refs.forEach(b => {
        out.push({ kind: 'feud.heat', a, b, points });
      }));
    }
  }
  return out;
};

// ------------------------------------------------------------------ event types
//
// Each type declares:
//   roles     — participant roles it accepts
//   required  — data fields that must be present
//   validate  — extra checks beyond the generic envelope checks
//   effects   — pure (participants, data) -> effect list

export const EVENT_TYPES = {
  show: {
    label: 'Show',
    roles: ['subject'],
    required: ['name'],
    validate: () => [],
    effects: ev => [{ kind: 'show.open', showId: ev.id, name: ev.data.name, brandId: ev.data.brandId || null }],
  },

  match: {
    label: 'Match',
    roles: ['competitor', 'winner', 'loser'],
    required: [],
    validate: ev => {
      const e = [];
      if (ev.participants.length < 2) err(e, 'a match needs at least two participants');
      const s = sides(ev);
      if (s.length < 2) err(e, 'a match needs at least two sides (use distinct `side` values)');
      const winners = ev.participants.filter(p => p.role === 'winner');
      const wSides = new Set(winners.map(p => p.side));
      if (wSides.size > 1) err(e, 'winners span more than one side');
      // A match with nobody's hand raised is fine — double DQ, double countout,
      // draw, thrown out — but only if the finish says so. Silence means the
      // winner was forgotten.
      if (!winners.length && !ev.data.decision) {
        err(e, 'no winner — write "A d. B", or give a finish (draw, no contest, dq, countout)');
      }
      return e;
    },
    effects: ev => {
      const out = [];
      const s = sides(ev);
      const winSide = ev.participants.find(p => p.role === 'winner');
      const titleId = ev.data.titleId || null;
      const drawn = !winSide;

      s.forEach(({ side, refs }) => {
        const won = !drawn && side === winSide.side;
        refs.forEach(ref => out.push({
          kind: drawn ? 'record.draw' : won ? 'record.win' : 'record.loss',
          subject: ref,
          vs: s.filter(o => o.side !== side).flatMap(o => o.refs),
          titleId, matchType: ev.data.matchType || null,
        }));
      });

      // A title match either moves the belt or is a defense. Which one it is was
      // settled by the author at write time and recorded in data.titleChanged;
      // the effect merely states the outcome, so a replay after a correction
      // upstream still reads cleanly.
      if (titleId && !drawn) {
        if (ev.data.titleChanged) {
          out.push({ kind: 'title.award', titleId, holders: winSide ? s.find(x => x.side === winSide.side).refs : [], reason: 'won' });
        } else {
          out.push({ kind: 'title.defense', titleId, holders: s.find(x => x.side === winSide.side).refs });
        }
      }
      if (titleId && drawn && ev.data.titleVacated) out.push({ kind: 'title.vacate', titleId, reason: ev.data.decision || 'draw' });

      return out.concat(heat(ev, 1));
    },
  },

  attack: {
    label: 'Attack',
    roles: ['attacker', 'victim'],
    required: [],
    validate: ev => {
      const e = [];
      if (!refsOf(ev, 'attacker').length) err(e, 'an attack needs at least one attacker');
      if (!refsOf(ev, 'victim').length) err(e, 'an attack needs at least one victim');
      return e;
    },
    effects: ev => {
      // attacker/victim already imply opposing corners; give them sides so the
      // shared heat helper can pair them up.
      const shaped = { participants: ev.participants.map(p => ({ ...p, side: p.role === 'attacker' ? 1 : 2 })) };
      return heat(shaped, 3);
    },
  },

  promo: {
    label: 'Promo',
    roles: ['speaker', 'target'],
    required: [],
    validate: ev => (refsOf(ev, 'speaker').length ? [] : ['a promo needs at least one speaker']),
    effects: ev => {
      if (!refsOf(ev, 'target').length) return [];
      const shaped = { participants: ev.participants.map(p => ({ ...p, side: p.role === 'speaker' ? 1 : 2 })) };
      return heat(shaped, 2);
    },
  },

  'alliance.formed': {
    label: 'Alliance formed',
    roles: ['member', 'leader'],
    required: ['groupId'],
    validate: ev => {
      const e = [];
      if (ev.participants.length < 2) err(e, 'an alliance needs at least two members');
      if (ev.data.groupKind && !GROUP_KINDS.includes(ev.data.groupKind)) err(e, `unknown group kind: ${ev.data.groupKind}`);
      return e;
    },
    effects: ev => {
      const out = [{
        kind: 'group.form', groupId: ev.data.groupId,
        name: ev.data.name || null, groupKind: ev.data.groupKind || 'alliance',
        leaderId: refsOf(ev, 'leader')[0] || null, brandId: ev.data.brandId || null,
      }];
      ev.participants.forEach(p => out.push({ kind: 'group.join', groupId: ev.data.groupId, subject: p.ref }));
      return out;
    },
  },

  'alliance.broken': {
    label: 'Alliance broken',
    roles: ['member'],
    required: ['groupId'],
    validate: () => [],
    effects: ev => {
      const leaving = ev.participants.map(p => p.ref);
      const out = leaving.map(ref => ({ kind: 'group.leave', groupId: ev.data.groupId, subject: ref }));
      // No named leavers, or an explicit flag, means the whole thing folds.
      if (!leaving.length || ev.data.dissolve) {
        out.push({ kind: 'group.dissolve', groupId: ev.data.groupId, reason: ev.data.reason || null });
      }
      return out;
    },
  },

  'title.change': {
    label: 'Title change',
    roles: ['champion', 'challenger'],
    required: ['titleId'],
    validate: ev => {
      const e = [];
      const reason = ev.data.reason || 'won';
      const holders = refsOf(ev, 'champion');
      if (!['won', 'awarded', 'vacated', 'stripped', 'retired'].includes(reason)) err(e, `unknown title change reason: ${reason}`);
      if (['won', 'awarded'].includes(reason) && !holders.length) err(e, `a title ${reason} needs at least one champion participant`);
      return e;
    },
    effects: ev => {
      const reason = ev.data.reason || 'won';
      const holders = refsOf(ev, 'champion');
      if (['vacated', 'stripped', 'retired'].includes(reason)) {
        return [{ kind: 'title.vacate', titleId: ev.data.titleId, reason }];
      }
      return [{ kind: 'title.award', titleId: ev.data.titleId, holders, reason }];
    },
  },

  injury: {
    label: 'Injury',
    roles: ['subject'],
    required: [],
    validate: ev => (refsOf(ev, 'subject').length ? [] : ['an injury needs a subject']),
    effects: ev => refsOf(ev, 'subject').flatMap(ref => [
      { kind: 'injury.start', subject: ref, severity: ev.data.severity || null, weeks: ev.data.weeks || null, expectedReturn: ev.data.expectedReturn || null, description: ev.data.description || null },
      { kind: 'roster.status', subject: ref, status: 'injured' },
    ]),
  },

  'injury.cleared': {
    label: 'Injury cleared',
    roles: ['subject'],
    required: [],
    validate: ev => (refsOf(ev, 'subject').length ? [] : ['a clearance needs a subject']),
    effects: ev => refsOf(ev, 'subject').flatMap(ref => [
      { kind: 'injury.end', subject: ref },
      { kind: 'roster.status', subject: ref, status: ev.data.status || 'active' },
    ]),
  },

  'contract.signed': {
    label: 'Contract signed',
    roles: ['subject'],
    required: [],
    validate: ev => (refsOf(ev, 'subject').length ? [] : ['a contract needs a subject']),
    effects: ev => refsOf(ev, 'subject').flatMap(ref => {
      const out = [{ kind: 'contract.start', subject: ref, brandId: ev.data.brandId || null, expires: ev.data.expires || null, terms: ev.data.terms || null }];
      if (ev.data.brandId) out.push({ kind: 'roster.brand', subject: ref, brandId: ev.data.brandId });
      out.push({ kind: 'roster.status', subject: ref, status: ev.data.status || 'active' });
      return out;
    }),
  },

  'contract.expired': {
    label: 'Contract expired',
    roles: ['subject'],
    required: [],
    validate: ev => (refsOf(ev, 'subject').length ? [] : ['a contract expiry needs a subject']),
    effects: ev => refsOf(ev, 'subject').flatMap(ref => [
      { kind: 'contract.end', subject: ref, reason: ev.data.reason || 'expired' },
      { kind: 'roster.brand', subject: ref, brandId: null },
      { kind: 'roster.status', subject: ref, status: ev.data.released ? 'released' : 'free agent' },
    ]),
  },

  'brand.transfer': {
    label: 'Brand transfer',
    roles: ['subject'],
    required: ['toBrandId'],
    validate: ev => (refsOf(ev, 'subject').length ? [] : ['a transfer needs a subject']),
    effects: ev => refsOf(ev, 'subject').flatMap(ref => {
      const out = [{ kind: 'roster.brand', subject: ref, brandId: ev.data.toBrandId, reason: ev.data.reason || null }];
      // A move does not touch the roster flag unless the author says so. It is
      // tempting to have a promotion clear the promotion flag automatically,
      // but then a re-pasted roster that still reads "promotion" would flip the
      // flag back on every import and never settle. The paste is the desired
      // state; only an explicit data.status changes it.
      if (ev.data.status) out.push({ kind: 'roster.status', subject: ref, status: ev.data.status });
      return out;
    }),
  },

  'status.change': {
    label: 'Status change',
    roles: ['subject'],
    required: ['status'],
    validate: ev => {
      const e = [];
      if (!refsOf(ev, 'subject').length) err(e, 'a status change needs a subject');
      if (!STATUSES.includes(ev.data.status)) err(e, `unknown status: ${ev.data.status}`);
      return e;
    },
    effects: ev => refsOf(ev, 'subject').map(ref => ({ kind: 'roster.status', subject: ref, status: ev.data.status, reason: ev.data.reason || null })),
  },
};

export const EVENT_TYPE_NAMES = Object.keys(EVENT_TYPES);

// ------------------------------------------------------------------ validation

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDate(s) {
  if (!DATE_RE.test(String(s || ''))) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

// Generic envelope checks plus the type's own. `known` is an optional Set of
// entity ids used to catch references to wrestlers/belts that do not exist.
export function validateEvent(ev, known) {
  const e = [];
  const spec = EVENT_TYPES[ev.type];
  if (!spec) return [`unknown event type: ${ev.type}`];
  if (!isDate(ev.date)) err(e, `bad date: ${JSON.stringify(ev.date)} (want YYYY-MM-DD)`);
  if (!Array.isArray(ev.participants)) err(e, 'participants must be an array');
  else ev.participants.forEach((p, i) => {
    if (!p || !p.ref) err(e, `participant ${i} has no ref`);
    else if (known && !known.has(p.ref)) err(e, `participant ${i} refers to unknown entity ${p.ref}`);
    if (p && p.role && !spec.roles.includes(p.role)) err(e, `role "${p.role}" is not valid on a ${ev.type} (want ${spec.roles.join(', ')})`);
  });
  (spec.required || []).forEach(k => {
    if (ev.data[k] == null || ev.data[k] === '') err(e, `${ev.type} requires data.${k}`);
  });
  if (ev.data.titleId && known && !known.has(ev.data.titleId)) err(e, `unknown championship ${ev.data.titleId}`);
  if (ev.data.brandId && known && !known.has(ev.data.brandId)) err(e, `unknown brand ${ev.data.brandId}`);
  if (ev.data.toBrandId && known && !known.has(ev.data.toBrandId)) err(e, `unknown brand ${ev.data.toBrandId}`);
  if (Array.isArray(ev.participants)) spec.validate(ev).forEach(m => err(e, m));
  return e;
}

export function validateEntity(kind, rec) {
  const spec = ENTITY_SPECS[kind];
  const e = [];
  if (!spec) return [`unknown entity kind: ${kind}`];
  spec.required.forEach(k => { if (rec[k] == null || rec[k] === '') err(e, `${kind} requires ${k}`); });
  Object.entries(spec.fields).forEach(([field, type]) => {
    const v = rec[field];
    if (v == null || v === '') return;
    const optional = type.endsWith('?');
    const t = optional ? type.slice(0, -1) : type;
    if (t.startsWith('enum:')) {
      const list = ENUMS[t.slice(5)];
      if (list && !list.includes(v)) err(e, `${kind}.${field}: "${v}" is not one of ${list.join(', ')}`);
    } else if (t === 'date' && !isDate(v)) err(e, `${kind}.${field}: bad date ${JSON.stringify(v)}`);
    else if (t === 'number' && typeof v !== 'number') err(e, `${kind}.${field}: expected a number`);
    else if (t === 'array' && !Array.isArray(v)) err(e, `${kind}.${field}: expected an array`);
  });
  return e;
}

// Build the effect list for an event. Called on every write and on every
// amendment, so a corrected event never carries the old event's consequences.
export function deriveEffects(ev) {
  const spec = EVENT_TYPES[ev.type];
  if (!spec) return [];
  try { return spec.effects(ev) || []; } catch (e) { return []; }
}

export { asArray, sides, refsOf };
