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

// How a belt can move. `interim` runs a parallel reign while the real champion
// is out; `unified` ends it, merging the interim run into the main lineage.
export const TITLE_REASONS = ['won', 'awarded', 'vacated', 'stripped', 'retired', 'interim', 'unified'];

// Premium live events the season system cares about. WrestleMania closes the
// year's booking and triggers the flagging; Last Stand is where the flagged
// names settle it. Everything else is just a show with a big name.
export const PLES = ['wrestlemania', 'lastStand', 'draft', 'royalRumble', 'summerslam', 'survivorSeries', 'moneyInTheBank', 'other'];

// What a Last Stand match is playing for. The loser of a relegation match goes
// down a tier; the winner of a promotion match goes up one.
export const STAKES = ['relegation', 'promotion'];

// Days a brand can air on. Free text is allowed too — this is only what the
// pickers offer.
export const SHOW_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

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
  'title.award', 'title.vacate', 'title.defense', 'title.interim', 'title.unify',
  'roster.brand', 'roster.status', 'roster.align',
  'contract.start', 'contract.end',
  'injury.start', 'injury.end',
  'group.form', 'group.join', 'group.leave', 'group.dissolve',
  'rivalry.heat', 'alliance.bond',
  'thread.open', 'thread.close',
  'show.open',
];

// Relationship weights. Effects carry these numbers; the projector decays them
// from each event's own date, so nothing needs recomputing when time passes.
// A rivalry is an unordered pair — "Cody and Solo have heat" rather than "Cody
// wants Solo". Directional heat would need two numbers per pair and, so far,
// nothing in the dashboard would read the difference.
export const HEAT = {
  attack: 3,          // the loudest single act
  betrayal: 5,        // turning on your own runs hotter than attacking a stranger
  promo: 2,
  match: 1.5,         // a decided match — somebody got beaten
  draw: 0.75,         // nobody settled anything
  title: 1,           // added on top when a belt is on the line
  saveRival: 2,       // making the save earns you the attacker
  spread: 0.35,       // fraction passed to the victim's partners and faction
};

export const BOND = {
  formed: 4,
  tagWin: 2,
  tagLoss: 0.75,      // losing together still builds something
  save: 3,
};

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
  // A brand is a show *and* a rung on the pyramid. `tier` is an ordinary number
  // — 1 is the top, and there is no maximum, so a universe can be two rungs deep
  // or six. `parentId` is the optional "develops for" link: an Evolve that feeds
  // NXT specifically rather than the tier above in general.
  brand: {
    fields: {
      name: 'string', abbr: 'string?', color: 'string?', logo: 'string?',
      tier: 'number?', day: 'string?', parentId: 'ref?', note: 'string?',
    },
    required: ['name'],
  },
  // `autoPromote` is the one exception to Last Stand: holding this belt after
  // WrestleMania is itself a call-up, so the champion goes into the draft pool
  // for the tier above without having to win a promotion match. It is a field
  // rather than a hardcoded "NXT Championship" so a custom pyramid can put the
  // designation on whichever belt plays that role.
  championship: {
    fields: {
      name: 'string', brandId: 'ref?', division: 'enum:DIVISIONS', teamSize: 'number?',
      activeFrom: 'date?', retiredOn: 'date?', autoPromote: 'boolean?', note: 'string?',
    },
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
//
// Only the direct pair is emitted here. Spreading heat to the victim's partners
// and faction is the projector's job, because who they were standing with is a
// fact about the world at that moment, not about this event — and effects that
// look at the world go stale the moment history is corrected.
const heat = (ev, points, why) => {
  const s = sides(ev);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    for (let j = i + 1; j < s.length; j++) {
      s[i].refs.forEach(a => s[j].refs.forEach(b => {
        out.push({ kind: 'rivalry.heat', a, b, points, why });
      }));
    }
  }
  return out;
};

// Partners in the same corner build a bond.
const bond = (refs, points, why) => {
  const out = [];
  for (let i = 0; i < refs.length; i++) {
    for (let j = i + 1; j < refs.length; j++) {
      out.push({ kind: 'alliance.bond', a: refs[i], b: refs[j], points, why });
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
    validate: ev => (ev.data.ple && !PLES.includes(ev.data.ple) ? [`unknown premium live event: ${ev.data.ple}`] : []),
    effects: ev => [{
      kind: 'show.open', showId: ev.id, name: ev.data.name,
      brandId: ev.data.brandId || null, ple: ev.data.ple || null,
    }],
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
        // Partners who went to war together come out of it closer.
        if (refs.length > 1) out.push(...bond(refs, won ? BOND.tagWin : BOND.tagLoss, won ? 'tag win' : 'tag loss'));
      });

      // A title match either moves the belt or is a defense. Which one it is was
      // settled by the author at write time and recorded in data.titleChanged;
      // the effect merely states the outcome, so a replay after a correction
      // upstream still reads cleanly.
      const winners = winSide ? s.find(x => x.side === winSide.side).refs : [];
      if (titleId && !drawn) {
        if (ev.data.unify) out.push({ kind: 'title.unify', titleId, holders: winners });
        else if (ev.data.interim) out.push({ kind: 'title.interim', titleId, holders: winners, reason: 'won' });
        else if (ev.data.titleChanged) out.push({ kind: 'title.award', titleId, holders: winners, reason: 'won' });
        else out.push({ kind: 'title.defense', titleId, holders: winners });
      }
      if (titleId && drawn && ev.data.titleVacated) out.push({ kind: 'title.vacate', titleId, reason: ev.data.decision || 'draw' });

      // Last Stand: the match that moves someone between brands. Which way it
      // moves them, and to which brand, was settled by the author at write time
      // (card.js reads the flags and the roster sizes) — so this stays a pure
      // statement of outcome and survives any correction upstream.
      if (ev.data.stakes && !drawn) {
        const losers = s.filter(x => x.side !== winSide.side).flatMap(x => x.refs);
        const moved = ev.data.stakes === 'relegation' ? losers : winners;
        moved.forEach(ref => out.push({
          kind: 'roster.brand', subject: ref, brandId: ev.data.toBrandId || null, reason: ev.data.stakes,
        }));
        // Everyone in the match walks out unflagged: it has been settled.
        [...winners, ...losers].forEach(ref => out.push({ kind: 'roster.status', subject: ref, status: 'active' }));
      }

      // A Last Stand qualifier moves nobody, but half the group is now out of
      // the running: the winner of a relegation qualifier is safe, the loser of
      // a promotion qualifier is done. Clearing their flag here is what stops a
      // survivor carrying a marker into next year that nothing can remove.
      if (ev.data.qualifier && typeof ev.data.qualifier === 'string' && !drawn) {
        const losers = s.filter(x => x.side !== winSide.side).flatMap(x => x.refs);
        const settled = ev.data.qualifier === 'relegation' ? winners : losers;
        settled.forEach(ref => out.push({ kind: 'roster.status', subject: ref, status: 'active' }));
      }

      // Winning a number-one contender match is a promise the universe now owes
      // you, so it opens a thread that stays open until you get the match.
      if (ev.data.contender && winners.length) {
        out.push({
          kind: 'thread.open', threadId: `th_${ev.id}`, threadKind: 'title-shot',
          subjects: winners, about: ev.data.contender === true ? titleId : ev.data.contender,
          text: 'earned a title shot',
        });
      }

      const points = (drawn ? HEAT.draw : HEAT.match) + (titleId ? HEAT.title : 0);
      return out.concat(heat(ev, points, drawn ? 'draw' : 'match'));
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
      const victims = refsOf(ev, 'victim');
      return [
        ...heat(shaped, HEAT.attack, 'attack'),
        // Being jumped is a question: does anyone answer it? The thread stays
        // open until the victim hits back or the author waves it off.
        {
          kind: 'thread.open', threadId: `th_${ev.id}`, threadKind: 'attack',
          subjects: victims, about: refsOf(ev, 'attacker')[0] || null,
          text: 'attacked with no response yet',
        },
      ];
    },
  },

  // Somebody runs down to break up a beating. Costs one line to enter and is
  // the cleanest signal in the whole model that two people are on the same side.
  save: {
    label: 'Save',
    roles: ['subject', 'victim', 'attacker'],
    required: [],
    validate: ev => {
      const e = [];
      if (!refsOf(ev, 'subject').length) err(e, 'a save needs someone making it');
      if (!refsOf(ev, 'victim').length) err(e, 'a save needs someone being saved');
      return e;
    },
    effects: ev => {
      const savers = refsOf(ev, 'subject');
      const saved = refsOf(ev, 'victim');
      const from = refsOf(ev, 'attacker');
      const out = [];
      savers.forEach(a => saved.forEach(b => out.push({ kind: 'alliance.bond', a, b, points: BOND.save, why: 'save' })));
      savers.forEach(a => from.forEach(b => out.push({ kind: 'rivalry.heat', a, b, points: HEAT.saveRival, why: 'save' })));
      // Making the save answers the beating it interrupted.
      if (from.length) out.push({ kind: 'thread.close', match: { threadKind: 'attack', subject: saved[0], about: from[0] }, why: 'saved' });
      return out;
    },
  },

  // An explicit thread, for the ones no event implies — a promised title shot,
  // a challenge issued, anything you want the queue to keep nagging you about.
  'thread.open': {
    label: 'Thread opened',
    roles: ['subject', 'target'],
    required: ['text'],
    validate: ev => (ev.participants.length ? [] : ['a thread needs at least one wrestler']),
    effects: ev => [{
      kind: 'thread.open', threadId: `th_${ev.id}`,
      threadKind: ev.data.threadKind || 'promise',
      subjects: refsOf(ev, 'subject'),
      about: ev.data.about || refsOf(ev, 'target')[0] || null,
      text: ev.data.text,
    }],
  },

  'thread.resolved': {
    label: 'Thread resolved',
    roles: ['subject'],
    required: ['threadId'],
    validate: () => [],
    effects: ev => [{ kind: 'thread.close', threadId: ev.data.threadId, why: ev.data.reason || 'marked resolved' }],
  },

  promo: {
    label: 'Promo',
    roles: ['speaker', 'target'],
    required: [],
    validate: ev => (refsOf(ev, 'speaker').length ? [] : ['a promo needs at least one speaker']),
    effects: ev => {
      if (!refsOf(ev, 'target').length) return [];
      const shaped = { participants: ev.participants.map(p => ({ ...p, side: p.role === 'speaker' ? 1 : 2 })) };
      return heat(shaped, HEAT.promo, 'promo');
    },
  },

  'alliance.formed': {
    label: 'Alliance formed',
    roles: ['member', 'leader'],
    required: ['groupId'],
    // Two things wear this type: a group coming into existence, and somebody
    // walking into one that already exists. `data.join` says which — and one
    // person joining The Judgment Day is an ordinary Tuesday, not a broken
    // event, so the two-member rule only applies to the first case.
    validate: ev => {
      const e = [];
      if (ev.data.join) {
        if (!ev.participants.length) err(e, 'nobody is joining');
      } else if (ev.participants.length < 2) {
        err(e, 'an alliance needs at least two members (set join for somebody joining one that already exists)');
      }
      if (ev.data.groupKind && !GROUP_KINDS.includes(ev.data.groupKind)) err(e, `unknown group kind: ${ev.data.groupKind}`);
      return e;
    },
    effects: ev => {
      const out = [];
      // A join must not re-form the group: forming restates its name, its kind
      // and its founding date, and would quietly revive one that had split up.
      if (!ev.data.join) {
        out.push({
          kind: 'group.form', groupId: ev.data.groupId,
          name: ev.data.name || null, groupKind: ev.data.groupKind || 'alliance',
          leaderId: refsOf(ev, 'leader')[0] || null, brandId: ev.data.brandId || null,
        });
      }
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
      // A walkout is unfinished business. Who it is against depends on who was
      // left standing in the group, which only the replay knows.
      if (leaving.length && ev.data.betrayal !== false) {
        out.push({
          kind: 'thread.open', threadId: `th_${ev.id}`, threadKind: 'betrayal',
          subjects: leaving, about: ev.data.groupId,
          text: ev.data.reason || 'walked out',
        });
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
      if (!TITLE_REASONS.includes(reason)) err(e, `unknown title change reason: ${reason} (want ${TITLE_REASONS.join(', ')})`);
      if (['won', 'awarded', 'interim', 'unified'].includes(reason) && !holders.length) err(e, `a title ${reason} needs at least one champion participant`);
      return e;
    },
    effects: ev => {
      const reason = ev.data.reason || 'won';
      const holders = refsOf(ev, 'champion');
      const titleId = ev.data.titleId;

      if (['vacated', 'stripped', 'retired'].includes(reason)) {
        return [
          { kind: 'title.vacate', titleId, reason },
          // An empty belt is the most open question there is.
          ...(reason === 'retired' ? [] : [{
            kind: 'thread.open', threadId: `th_${ev.id}`, threadKind: 'vacant-title',
            subjects: [], about: titleId, text: `vacated — needs a new champion`,
          }]),
        ];
      }
      if (reason === 'interim') return [{ kind: 'title.interim', titleId, holders, reason }];
      if (reason === 'unified') return [{ kind: 'title.unify', titleId, holders }];
      return [{ kind: 'title.award', titleId, holders, reason }];
    },
  },

  injury: {
    label: 'Injury',
    roles: ['subject'],
    required: [],
    validate: ev => (refsOf(ev, 'subject').length ? [] : ['an injury needs a subject']),
    effects: ev => [
      ...refsOf(ev, 'subject').flatMap(ref => [
        { kind: 'injury.start', subject: ref, severity: ev.data.severity || null, weeks: ev.data.weeks || null, expectedReturn: ev.data.expectedReturn || null, description: ev.data.description || null },
        { kind: 'roster.status', subject: ref, status: 'injured' },
      ]),
      // Somebody is out. That is a booking problem until they are cleared.
      {
        kind: 'thread.open', threadId: `th_${ev.id}`, threadKind: 'injury',
        subjects: refsOf(ev, 'subject'), about: null,
        text: ev.data.description || (ev.data.weeks ? `out ${ev.data.weeks} weeks` : 'injured'),
      },
    ],
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
    else if (t === 'boolean' && typeof v !== 'boolean') err(e, `${kind}.${field}: expected true or false`);
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
