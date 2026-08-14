// WWE 2K Universe — projection.
//
// The fold. Takes the corrected event stream and replays it into current state:
// rosters, records, title reigns, group membership, injuries, contracts, feuds.
// Nothing here is persisted, and no state is ever mutated except the accumulator
// being built, so calling project() twice on the same store gives the same
// answer and voiding an event ten years back is just another replay.
//
// Cost is one pass over the log per call. A Universe save of a few thousand
// events replays in single-digit milliseconds, which is well inside "recompute
// on every read" territory — hence no cache, no invalidation, no drift.
//
// Pass `asOf` to stand at any point in history: `project(store, {asOf:'2026-01-01'})`
// answers "who held the belt in January" with the same code path as "now".

import { entityKind, HEAT } from './schema.js';

const DAY = 86400000;
export const days = (from, to) => Math.max(0, Math.round((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / DAY));
const feudKey = (a, b) => [a, b].sort().join('|');
const todayISO = () => new Date().toISOString().slice(0, 10);

// Relationships fade. A feud nobody has touched in three months is not a feud,
// and the dashboard should stop shouting about it — but the events that built
// it are still in the log and still count for the history.
//
// Each contribution decays from its own date, so this is a pure function of
// (log, asOf). Nothing is recomputed on a timer and nothing goes stale: move
// the as-of date back and the old heat comes back with it.
export const HALF_LIFE = { rivalry: 60, alliance: 90 };   // days
export const ACTIVE = { rivalry: 2, alliance: 2 };        // below this it is over
const decay = (points, age, halfLife) => points * Math.pow(0.5, Math.max(0, age) / halfLife);

export function project(store, { asOf = null } = {}) {
  const events = store.effectiveEvents({ asOf });
  const at = asOf || todayISO();

  const state = {
    asOf: at,
    startDate: store.doc.meta.startDate || null,
    wrestlers: {}, brands: {}, championships: {}, groups: {},
    shows: [], showsById: {}, ples: [], events,
    // Raw contributions, collected during the replay and totalled at the end so
    // decay is measured from each one's own date.
    ties: { rivalry: new Map(), alliance: new Map() },
    rivalries: [], alliances: [], threadsById: {}, threads: [],
    counts: { events: events.length },
  };

  // ---------------------------------------------------------------- seed from
  // the registry. Entities carry identity only — name, gender, alignment, the
  // division a belt was created for. Everything that moves with time is left
  // blank here and filled in by the replay below.
  store.entitiesOf('brand').forEach(b => {
    state.brands[b.id] = { ...b, roster: [], champions: [] };
  });
  store.entitiesOf('wrestler').forEach(w => {
    state.wrestlers[w.id] = {
      id: w.id, name: w.name, gender: w.gender || null, alignment: w.alignment || null,
      // Brand and status start empty on purpose. Every value they take comes
      // from an event, which is what lets a void or an amendment move them.
      brandId: null, lastBrandId: null, status: 'active',
      record: { w: 0, l: 0, d: 0 }, streak: { type: null, n: 0 },
      titles: [], titleHistory: [], groups: [],
      injury: null, injuries: [], contract: null, contracts: [],
      appearances: 0, lastSeen: null, debut: w.debut || null,
    };
  });
  store.entitiesOf('championship').forEach(c => {
    state.championships[c.id] = {
      ...c, holders: [], interimHolders: [], vacant: true, since: null,
      reigns: [], currentIndex: null, interimIndex: null,
      totalDefenses: 0, retired: !!c.retiredOn,
    };
  });
  store.entitiesOf('group').forEach(g => {
    state.groups[g.id] = {
      ...g, members: [...(g.memberIds || [])], active: false, formedOn: g.formedOn || null, brokenOn: null, history: [],
    };
    // A seeded group with members but no forming event still shows up, so a
    // roster import that lists tag teams reads correctly before any show.
    if ((g.memberIds || []).length) state.groups[g.id].active = true;
  });
  Object.values(state.groups).forEach(g => g.members.forEach(m => {
    if (state.wrestlers[m] && !state.wrestlers[m].groups.includes(g.id)) state.wrestlers[m].groups.push(g.id);
  }));

  // ---------------------------------------------------------------- replay
  events.forEach(ev => {
    ev.participants.forEach(p => {
      const w = state.wrestlers[p.ref];
      if (w) { w.appearances += 1; w.lastSeen = ev.date; }
    });
    if (ev.showId && state.showsById[ev.showId]) state.showsById[ev.showId].segments.push(summarize(ev, state));
    (ev.effects || []).forEach(fx => applyEffect(state, fx, ev));
    closeThreads(state, ev);
  });

  // ---------------------------------------------------------------- settle
  Object.values(state.championships).forEach(c => {
    c.reigns.forEach(r => { if (!r.to) r.days = days(r.from, at); });
    const main = mainReign(c), interim = interimReign(c);
    c.since = main ? main.from : null;
    c.daysHeld = main ? main.days : 0;
    c.defenses = main ? main.defenses : 0;
    c.holders = main ? main.holders : [];
    c.vacant = !main;
    c.interimHolders = interim ? interim.holders : [];
    c.interimSince = interim ? interim.from : null;
    c.longestReign = c.reigns.reduce((best, r) => (!best || r.days > best.days ? r : best), null);
  });

  Object.values(state.wrestlers).forEach(w => {
    if (w.brandId && state.brands[w.brandId]) state.brands[w.brandId].roster.push(w.id);
    if (w.injury && w.injury.expectedReturn && w.injury.expectedReturn <= at) w.injury.overdue = true;
    w.record.total = w.record.w + w.record.l + w.record.d;
    w.winPct = w.record.total ? w.record.w / w.record.total : 0;
  });

  Object.values(state.championships).forEach(c => {
    c.holders.forEach(h => {
      const w = state.wrestlers[h];
      if (w && !w.titles.includes(c.id)) w.titles.push(c.id);
    });
    const brand = c.brandId && state.brands[c.brandId];
    if (brand) brand.champions.push({ titleId: c.id, name: c.name, holders: c.holders });
  });

  state.freeAgents = Object.values(state.wrestlers).filter(w => !w.brandId).map(w => w.id);
  Object.values(state.brands).forEach(b => b.roster.sort((x, y) => state.wrestlers[x].name.localeCompare(state.wrestlers[y].name)));

  // Relationships: total each pair's contributions, each decayed from its own
  // date. A pair that has not been touched in months falls under the threshold
  // and stops being called active, without anything being deleted.
  const settleTies = (kind) => [...state.ties[kind].values()].map(t => {
    const heat = t.hits.reduce((sum, x) => sum + decay(x.points, days(x.date, at), HALF_LIFE[kind]), 0);
    const last = t.hits.reduce((m, x) => (x.date > m ? x.date : m), t.hits[0].date);
    const why = {};
    t.hits.forEach(x => { why[x.why || 'other'] = (why[x.why || 'other'] || 0) + 1; });
    return {
      a: t.a, b: t.b,
      heat: Math.round(heat * 10) / 10,
      peak: Math.round(t.hits.reduce((s, x) => s + x.points, 0) * 10) / 10,
      meetings: t.hits.length, last, why,
      active: heat >= ACTIVE[kind],
      hits: t.hits,
    };
  }).sort((x, y) => y.heat - x.heat || (x.last < y.last ? 1 : -1));

  state.rivalries = settleTies('rivalry');
  state.alliances = settleTies('alliance');
  state.feuds = state.rivalries;              // the name this used to go by

  // Per-wrestler shortcuts, so a profile page does not scan every pair.
  const attach = (list, field) => list.forEach(t => {
    [[t.a, t.b], [t.b, t.a]].forEach(([self, other]) => {
      const w = state.wrestlers[self];
      if (w) w[field].push({ with: other, heat: t.heat, meetings: t.meetings, last: t.last, active: t.active, why: t.why });
    });
  });
  Object.values(state.wrestlers).forEach(w => { w.rivals = []; w.allies = []; });
  attach(state.rivalries, 'rivals');
  attach(state.alliances, 'allies');

  // Threads, oldest first — the queue is a nag list, and the oldest nag wins.
  Object.values(state.threadsById).forEach(t => {
    t.age = days(t.opened, t.closed || at);
    t.stale = !t.closed && t.age > 60;
  });
  state.threads = Object.values(state.threadsById)
    .filter(t => !t.closed)
    .sort((a, b) => (a.opened < b.opened ? -1 : a.opened > b.opened ? 1 : 0));
  state.threadsClosed = Object.values(state.threadsById).filter(t => t.closed);

  return state;
}

// ------------------------------------------------------------------ effects
//
// One handler per effect kind from schema.js. This is the only place that knows
// how an assertion becomes state, which is why adding an event type rarely
// means touching the projector.

function applyEffect(state, fx, ev) {
  const W = ref => state.wrestlers[ref];
  switch (fx.kind) {
    case 'show.open': {
      const show = { id: fx.showId, name: fx.name, date: ev.date, brandId: fx.brandId, ple: fx.ple || null, segments: [] };
      state.shows.push(show);
      state.showsById[show.id] = show;
      if (show.ple) state.ples.push({ kind: show.ple, date: ev.date, showId: show.id, name: show.name });
      break;
    }

    case 'record.win':
    case 'record.loss':
    case 'record.draw': {
      const w = W(fx.subject);
      if (!w) break;
      const k = fx.kind === 'record.win' ? 'w' : fx.kind === 'record.loss' ? 'l' : 'd';
      w.record[k] += 1;
      const t = k === 'd' ? null : k;
      if (t && w.streak.type === t) w.streak.n += 1;
      else w.streak = { type: t, n: t ? 1 : 0 };
      break;
    }

    case 'title.award': {
      const c = state.championships[fx.titleId];
      if (!c) break;
      const cur = mainReign(c);
      if (cur && sameSet(cur.holders, fx.holders)) {
        // The belt ends up where it already was — one continuous reign, not a
        // new one. This is the shape a corrected match takes: the event still
        // says "the title changed hands", but the replay knows better. If it
        // was a match, the champion just defended, so count it as such rather
        // than letting the correction quietly lose a defense.
        if (ev.type === 'match') { cur.defenses += 1; c.totalDefenses += 1; }
        break;
      }
      closeReign(state, c, cur, ev.date, 'lost');
      openReign(state, c, fx.holders, ev, { reason: fx.reason || 'won' });
      break;
    }

    // An interim reign runs alongside the real one rather than replacing it —
    // that is the whole point of an interim belt. It gets its own row in the
    // lineage and its own defense count, and the main reign keeps ticking.
    case 'title.interim': {
      const c = state.championships[fx.titleId];
      if (!c) break;
      const open = interimReign(c);
      if (open && sameSet(open.holders, fx.holders)) { open.defenses += 1; c.totalDefenses += 1; break; }
      closeReign(state, c, open, ev.date, 'lost');
      openReign(state, c, fx.holders, ev, { reason: 'interim', interim: true });
      break;
    }

    // Unification ends both runs and starts one undisputed reign.
    case 'title.unify': {
      const c = state.championships[fx.titleId];
      if (!c) break;
      closeReign(state, c, interimReign(c), ev.date, 'unified');
      closeReign(state, c, mainReign(c), ev.date, 'unified');
      openReign(state, c, fx.holders, ev, { reason: 'unified' });
      break;
    }

    case 'title.vacate': {
      const c = state.championships[fx.titleId];
      if (!c) break;
      closeReign(state, c, mainReign(c), ev.date, fx.reason || 'vacated');
      c.holders = []; c.vacant = true;
      c.currentIndex = null;
      if (fx.reason === 'retired') {
        closeReign(state, c, interimReign(c), ev.date, 'retired');
        c.retired = true;
      }
      break;
    }

    case 'title.defense': {
      const c = state.championships[fx.titleId];
      if (!c) break;
      // Defenses land on whichever reign the defending champion is holding.
      const interim = interimReign(c);
      const r = interim && sameSet(interim.holders, fx.holders) ? interim : mainReign(c);
      if (r) { r.defenses += 1; c.totalDefenses += 1; }
      break;
    }

    case 'roster.brand': {
      const w = W(fx.subject);
      if (!w) break;
      if (w.brandId) w.lastBrandId = w.brandId;
      w.brandId = fx.brandId || null;
      break;
    }

    case 'roster.status': {
      const w = W(fx.subject);
      if (w) w.status = fx.status;
      break;
    }

    case 'roster.align': {
      const w = W(fx.subject);
      if (w) w.alignment = fx.alignment;
      break;
    }

    case 'contract.start': {
      const w = W(fx.subject);
      if (!w) break;
      w.contract = { since: ev.date, expires: fx.expires || null, brandId: fx.brandId || null, terms: fx.terms || null };
      w.contracts.push({ ...w.contract, eventId: ev.id });
      break;
    }

    case 'contract.end': {
      const w = W(fx.subject);
      if (!w) break;
      const last = w.contracts[w.contracts.length - 1];
      if (last && !last.endedOn) { last.endedOn = ev.date; last.reason = fx.reason || null; }
      w.contract = null;
      break;
    }

    case 'injury.start': {
      const w = W(fx.subject);
      if (!w) break;
      w.injury = { since: ev.date, severity: fx.severity, weeks: fx.weeks, expectedReturn: fx.expectedReturn, description: fx.description, eventId: ev.id };
      w.injuries.push(w.injury);
      break;
    }

    case 'injury.end': {
      const w = W(fx.subject);
      if (!w) break;
      const last = w.injuries[w.injuries.length - 1];
      if (last && !last.clearedOn) { last.clearedOn = ev.date; last.out = days(last.since, ev.date); }
      w.injury = null;
      break;
    }

    case 'group.form': {
      const g = state.groups[fx.groupId] || (state.groups[fx.groupId] = {
        id: fx.groupId, name: fx.name || fx.groupId, kind: fx.groupKind || 'alliance', members: [], history: [],
      });
      g.active = true;
      g.kind = fx.groupKind || g.kind;
      g.name = g.name || fx.name;
      g.leaderId = fx.leaderId || g.leaderId || null;
      g.brandId = fx.brandId || g.brandId || null;
      g.formedOn = g.formedOn || ev.date;
      g.brokenOn = null;
      g.history.push({ at: ev.date, what: 'formed', eventId: ev.id });
      break;
    }

    case 'group.join': {
      const g = state.groups[fx.groupId];
      if (!g) break;
      if (!g.members.includes(fx.subject)) g.members.push(fx.subject);
      const w = W(fx.subject);
      if (w && !w.groups.includes(fx.groupId)) w.groups.push(fx.groupId);
      break;
    }

    case 'group.leave': {
      const g = state.groups[fx.groupId];
      if (!g) break;
      g.members = g.members.filter(m => m !== fx.subject);
      g.history.push({ at: ev.date, what: 'left', who: fx.subject, eventId: ev.id });
      const w = W(fx.subject);
      if (w) w.groups = w.groups.filter(x => x !== fx.groupId);
      break;
    }

    case 'group.dissolve': {
      const g = state.groups[fx.groupId];
      if (!g) break;
      g.active = false;
      g.brokenOn = ev.date;
      g.history.push({ at: ev.date, what: 'dissolved', eventId: ev.id });
      g.members.forEach(m => { const w = W(m); if (w) w.groups = w.groups.filter(x => x !== fx.groupId); });
      g.formerMembers = [...g.members];
      g.members = [];
      break;
    }

    // 'feud.heat' is what this was called before rivalries and alliances were
    // split apart; saves written back then still replay.
    case 'feud.heat':
    case 'rivalry.heat': {
      // Turning on somebody you were standing beside is worth more than
      // attacking a stranger — and only the replay knows who was standing where.
      const betrayal = fx.why === 'attack' && shareGroup(state, fx.a, fx.b);
      addTie(state, 'rivalry', fx.a, fx.b, betrayal ? HEAT.betrayal : fx.points, ev, betrayal ? 'betrayal' : fx.why);

      // An attack is on everyone in the victim's corner, not just the victim.
      if (fx.why === 'attack') {
        groupmatesOf(state, fx.b).forEach(m => {
          if (m === fx.a || m === fx.b) return;
          addTie(state, 'rivalry', fx.a, m, fx.points * HEAT.spread, ev, 'their faction');
        });
      }
      break;
    }

    case 'alliance.bond':
      addTie(state, 'alliance', fx.a, fx.b, fx.points, ev, fx.why);
      break;

    case 'thread.open': {
      // An attack on a stablemate is not an attack, it is a betrayal.
      const turned = fx.threadKind === 'attack' && fx.subjects.length && fx.about
        && shareGroup(state, fx.subjects[0], fx.about);
      state.threadsById[fx.threadId] = {
        id: fx.threadId, kind: turned ? 'betrayal' : fx.threadKind,
        subjects: [...(fx.subjects || [])], about: fx.about || null,
        text: fx.text || '', opened: ev.date, eventId: ev.id, showId: ev.showId || null,
        closed: null, closedBy: null, closedWhy: null,
      };
      break;
    }

    case 'thread.close': {
      if (fx.threadId) { shutThread(state, fx.threadId, ev, fx.why); break; }
      if (fx.match) {
        const t = openThreads(state).reverse().find(x => x.kind === fx.match.threadKind
          && (!fx.match.subject || x.subjects.includes(fx.match.subject))
          && (!fx.match.about || x.about === fx.match.about));
        if (t) shutThread(state, t.id, ev, fx.why);
      }
      break;
    }
  }
}

// ------------------------------------------------------------------ reigns

const mainReign = c => (c.currentIndex != null && c.reigns[c.currentIndex] && !c.reigns[c.currentIndex].to ? c.reigns[c.currentIndex] : null);
const interimReign = c => (c.interimIndex != null && c.reigns[c.interimIndex] && !c.reigns[c.interimIndex].to ? c.reigns[c.interimIndex] : null);

function closeReign(state, c, reign, date, why) {
  if (!reign) return;
  reign.to = date;
  reign.days = days(reign.from, date);
  reign.endReason = why;
  reign.holders.forEach(h => closeTitleHistory(state.wrestlers[h], c.id, date));
  if (reign.interim) c.interimIndex = null; else c.currentIndex = null;
}

function openReign(state, c, holders, ev, { reason, interim = false }) {
  c.reigns.push({
    holders: [...holders], from: ev.date, to: null, days: 0, defenses: 0,
    reason, interim, eventId: ev.id,
  });
  const i = c.reigns.length - 1;
  if (interim) { c.interimIndex = i; c.interimHolders = [...holders]; }
  else { c.currentIndex = i; c.holders = [...holders]; c.vacant = false; }
  holders.forEach(h => {
    const w = state.wrestlers[h];
    if (w) w.titleHistory.push({ titleId: c.id, from: ev.date, to: null, interim, eventId: ev.id });
  });
}

// ------------------------------------------------------------------ ties

function addTie(state, kind, a, b, points, ev, why) {
  if (!a || !b || a === b || !points) return;
  const [x, y] = [a, b].sort();          // an unordered pair needs a canonical order
  const key = feudKey(x, y);
  const map = state.ties[kind];
  if (!map.has(key)) map.set(key, { a: x, b: y, hits: [] });
  map.get(key).hits.push({ points, date: ev.date, why, eventId: ev.id });
}

// Everyone currently sharing an active group with `ref` — their tag partner and
// their faction, which is exactly who an attack on them also lands on.
function groupmatesOf(state, ref) {
  const out = new Set();
  Object.values(state.groups).forEach(g => {
    if (!g.active || !g.members.includes(ref)) return;
    g.members.forEach(m => { if (m !== ref) out.add(m); });
  });
  return out;
}
const shareGroup = (state, a, b) => groupmatesOf(state, a).has(b);

// ------------------------------------------------------------------ threads

const openThreads = state => Object.values(state.threadsById).filter(t => !t.closed);

function shutThread(state, id, ev, why) {
  const t = state.threadsById[id];
  if (!t || t.closed) return;
  t.closed = ev.date;
  t.closedBy = ev.id;
  t.closedWhy = why || 'resolved';
}

// Threads that answer themselves. Called after every event: if what just
// happened settles an open question, the queue should not still be asking it.
function closeThreads(state, ev) {
  const open = openThreads(state);
  if (!open.length) return;

  if (ev.type === 'match') {
    const winners = ev.participants.filter(p => p.role === 'winner').map(p => p.ref);
    const losers = ev.participants.filter(p => p.role === 'loser').map(p => p.ref);
    const all = ev.participants.map(p => p.ref);
    open.forEach(t => {
      // Getting your hands on them in a match answers the beating.
      if ((t.kind === 'attack' || t.kind === 'betrayal') && t.about
        && t.subjects.some(s => winners.includes(s)) && losers.includes(t.about)) {
        shutThread(state, t.id, ev, 'beat them');
      }
      // A betrayal is answered by facing anyone left in the group.
      if (t.kind === 'betrayal' && t.about && state.groups[t.about]) {
        const left = state.groups[t.about].members;
        if (t.subjects.some(s => all.includes(s)) && left.some(m => all.includes(m))) {
          shutThread(state, t.id, ev, 'settled in the ring');
        }
      }
      // The promised shot happened.
      if (t.kind === 'title-shot' && ev.data.titleId && ev.data.titleId === t.about
        && t.subjects.some(s => all.includes(s))) {
        shutThread(state, t.id, ev, 'got the match');
      }
    });
  }

  if (ev.type === 'attack') {
    const attackers = ev.participants.filter(p => p.role === 'attacker').map(p => p.ref);
    const victims = ev.participants.filter(p => p.role === 'victim').map(p => p.ref);
    open.forEach(t => {
      if ((t.kind === 'attack' || t.kind === 'betrayal') && t.about
        && t.subjects.some(s => attackers.includes(s)) && victims.includes(t.about)) {
        shutThread(state, t.id, ev, 'hit them back');
      }
    });
  }

  if (ev.type === 'injury.cleared') {
    const back = ev.participants.map(p => p.ref);
    open.forEach(t => {
      if (t.kind === 'injury' && t.subjects.some(s => back.includes(s))) shutThread(state, t.id, ev, 'cleared to return');
    });
  }

  (ev.effects || []).forEach(fx => {
    if (fx.kind !== 'title.award' && fx.kind !== 'title.unify') return;
    open.forEach(t => {
      if (t.kind === 'vacant-title' && t.about === fx.titleId) shutThread(state, t.id, ev, 'new champion crowned');
      if (t.kind === 'title-shot' && t.about === fx.titleId && t.subjects.some(s => fx.holders.includes(s))) {
        shutThread(state, t.id, ev, 'won the belt');
      }
    });
  });
}

function closeTitleHistory(w, titleId, date) {
  if (!w) return;
  const r = [...w.titleHistory].reverse().find(t => t.titleId === titleId && !t.to);
  if (r) { r.to = date; r.days = days(r.from, date); }
}

const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

// A one-line description of an event, used for show cards and timelines.
function summarize(ev, state) {
  const nm = ref => (state.wrestlers[ref] ? state.wrestlers[ref].name : (state.groups[ref] ? state.groups[ref].name : ref));
  const side = n => ev.participants.filter(p => p.side === n).map(p => p.ref).map(nm).join(' & ');
  const out = { id: ev.id, type: ev.type, date: ev.date, order: ev.cardOrder, note: ev.note };
  // The refs as well as the text, so a view can link the names rather than
  // print them. `text` stays the plain-language version everything else uses.
  out.refs = ev.participants.map(p => p.ref);

  if (ev.type === 'match') {
    const winner = ev.participants.find(p => p.role === 'winner');
    const nums = [...new Set(ev.participants.map(p => p.side))].sort();
    const corners = nums.map(side);
    out.sides = nums.map(n => ({ side: n, refs: ev.participants.filter(p => p.side === n).map(p => p.ref) }));
    out.winnerSide = winner ? winner.side : null;
    out.matchType = ev.data.matchType || 'singles';
    out.titleId = ev.data.titleId || null;
    out.titleChanged = !!ev.data.titleChanged;
    out.decision = ev.data.decision || null;
    out.winner = winner ? side(winner.side) : null;
    out.text = winner
      ? `${side(winner.side)} def. ${corners.filter(c => c !== side(winner.side)).join(', ')}`
      : `${corners.join(' vs ')} (${ev.data.decision || 'no decision'})`;
    if (out.titleId && state.championships[out.titleId]) {
      out.text += ` — ${state.championships[out.titleId].name}${out.titleChanged ? ' (NEW CHAMPION)' : ''}`;
    }
  } else if (ev.type === 'attack') {
    out.text = `${ev.participants.filter(p => p.role === 'attacker').map(p => nm(p.ref)).join(' & ')} attacks ${ev.participants.filter(p => p.role === 'victim').map(p => nm(p.ref)).join(' & ')}`;
  } else if (ev.type === 'promo') {
    const t = ev.participants.filter(p => p.role === 'target').map(p => nm(p.ref));
    out.text = `${ev.participants.filter(p => p.role === 'speaker').map(p => nm(p.ref)).join(' & ')} promo${t.length ? ` on ${t.join(' & ')}` : ''}`;
  } else if (ev.type === 'save') {
    const from = ev.participants.filter(p => p.role === 'attacker').map(p => nm(p.ref));
    out.text = `${ev.participants.filter(p => p.role === 'subject').map(p => nm(p.ref)).join(' & ')} saves `
      + `${ev.participants.filter(p => p.role === 'victim').map(p => nm(p.ref)).join(' & ')}`
      + (from.length ? ` from ${from.join(' & ')}` : '');
  } else if (ev.type === 'thread.open') {
    out.text = `${ev.participants.map(p => nm(p.ref)).join(' & ')} — ${ev.data.text || 'unfinished business'}`;
  } else if (ev.type === 'title.change') {
    out.text = `${state.championships[ev.data.titleId] ? state.championships[ev.data.titleId].name : ev.data.titleId}`
      + ` ${ev.data.reason || 'changed'}${ev.participants.length ? ` — ${ev.participants.map(p => nm(p.ref)).join(' & ')}` : ''}`;
  } else {
    // The roster events read badly as "contract.signed: Jey Uso", and they are
    // most of what a quiet wrestler's timeline is made of.
    const who = ev.participants.map(p => nm(p.ref)).join(' & ');
    const brand = id => (state.brands[id] ? state.brands[id].name : id);
    const group = id => (state.groups[id] ? state.groups[id].name : id);
    out.text = {
      'alliance.formed': () => `${who} form ${group(ev.data.groupId)}`,
      'alliance.broken': () => (ev.data.dissolve || !ev.participants.length
        ? `${group(ev.data.groupId)} splits up`
        : `${who} leaves ${group(ev.data.groupId)}`),
      'contract.signed': () => `${who} signs with ${brand(ev.data.brandId)}`,
      'contract.expired': () => `${who} becomes a free agent`,
      'brand.transfer': () => `${who} moves to ${brand(ev.data.toBrandId)}${ev.data.reason ? ` (${ev.data.reason})` : ''}`,
      'status.change': () => `${who} flagged ${ev.data.status}`,
      injury: () => `${who} injured${ev.data.weeks ? ` — ${ev.data.weeks} weeks` : ''}${ev.data.description ? ` (${ev.data.description})` : ''}`,
      'injury.cleared': () => `${who} cleared to return`,
      'thread.resolved': () => `thread ${ev.data.threadId} resolved`,
      show: () => `${ev.data.name}`,
    }[ev.type]?.() || `${ev.type}: ${who}`;
  }
  return out;
}

// ------------------------------------------------------------------ views

// Everything one wrestler was involved in, newest first.
export function timelineFor(state, ref) {
  return state.events
    .filter(e => e.participants.some(p => p.ref === ref))
    .map(e => ({ ...summarize(e, state), role: e.participants.find(p => p.ref === ref).role }))
    .reverse();
}

// Every brand a wrestler has moved between, and why. The movement itself is
// usually an *effect* of something else — a Last Stand match, a draft pick, a
// contract — so a plain timeline shows the match and not the transfer. This
// reads the effects instead, which is what makes it a roster transaction
// history rather than a list of matches.
export function movementsFor(state, ref) {
  const out = [];
  state.events.forEach(e => {
    (e.effects || []).forEach(fx => {
      if (fx.subject !== ref) return;
      if (fx.kind === 'roster.brand') {
        out.push({
          date: e.date, eventId: e.id, kind: 'brand',
          to: fx.brandId, toName: fx.brandId && state.brands[fx.brandId] ? state.brands[fx.brandId].name : 'free agency',
          reason: fx.reason || (e.type === 'contract.signed' ? 'signed' : e.type === 'contract.expired' ? 'released' : 'moved'),
          showId: e.showId || null,
        });
      } else if (fx.kind === 'contract.end') {
        out.push({ date: e.date, eventId: e.id, kind: 'contract', to: null, toName: 'free agency', reason: fx.reason || 'contract ended' });
      }
    });
  });
  // Collapse the pair a contract expiry writes (brand cleared + contract ended)
  // into one row, since they are one thing happening.
  return out.filter((m, i) => !(m.kind === 'contract' && out[i - 1] && out[i - 1].eventId === m.eventId))
    .map((m, i, all) => ({ ...m, from: i ? all[i - 1].toName : null }))
    .reverse();
}

export function standings(state, brandId = null) {
  return Object.values(state.wrestlers)
    .filter(w => (brandId ? w.brandId === brandId : true) && w.record.total > 0)
    .sort((a, b) => b.record.w - a.record.w || b.winPct - a.winPct || a.name.localeCompare(b.name));
}

const nameOf = (state, id) => (state.wrestlers[id] ? state.wrestlers[id].name
  : state.groups[id] ? state.groups[id].name
  : state.championships[id] ? state.championships[id].name : id);

export function champions(state) {
  return Object.values(state.championships)
    .filter(c => !c.retired)
    .map(c => ({
      titleId: c.id, name: c.name, brandId: c.brandId, vacant: c.vacant,
      holders: c.holders.map(h => nameOf(state, h)),
      interim: c.interimHolders.map(h => nameOf(state, h)),
      since: c.since, days: c.daysHeld, defenses: c.defenses, reigns: c.reigns.length,
    }));
}

export function titleLineage(state, titleId) {
  const c = state.championships[titleId];
  if (!c) return [];
  return c.reigns.map((r, i) => ({
    n: i + 1,
    holders: r.holders.map(h => nameOf(state, h)),
    from: r.from, to: r.to, days: r.days, defenses: r.defenses,
    reason: r.reason, endReason: r.endReason || null, interim: !!r.interim,
    current: !r.to, eventId: r.eventId,
  }));
}

// Every match this belt has been on the line for.
export function titleMatches(state, titleId) {
  return state.events
    .filter(e => e.type === 'match' && e.data.titleId === titleId)
    .map(e => ({ ...summarize(e, state), date: e.date, showId: e.showId }))
    .reverse();
}

export const activeRivalries = (state, limit = 8) => state.rivalries.filter(r => r.active).slice(0, limit);
export const activeAlliances = (state, limit = 8) => state.alliances.filter(r => r.active).slice(0, limit);
export const threadQueue = state => state.threads;

// A thread rendered for reading: names resolved, age in days.
export function describeThread(state, t) {
  const who = t.subjects.map(s => nameOf(state, s)).join(' & ');
  const about = t.about ? nameOf(state, t.about) : null;
  const line = {
    attack: `${who} was attacked by ${about} and has not answered`,
    betrayal: `${who} turned on ${about}`,
    'title-shot': `${who} is owed a shot at the ${about}`,
    'vacant-title': `The ${about} is vacant`,
    injury: `${who} is on the shelf`,
    promise: `${who}${about ? ` → ${about}` : ''}`,
  }[t.kind] || `${who} — ${t.text}`;
  return { ...t, who, aboutName: about, line };
}

export function injuryList(state) {
  return Object.values(state.wrestlers).filter(w => w.injury)
    .map(w => ({ id: w.id, name: w.name, brandId: w.brandId, ...w.injury }));
}

export function expiringContracts(state, withinDays = 60) {
  const at = state.asOf;
  return Object.values(state.wrestlers)
    .filter(w => w.contract && w.contract.expires)
    .map(w => ({ id: w.id, name: w.name, brandId: w.brandId, expires: w.contract.expires, inDays: days(at, w.contract.expires) }))
    .filter(r => r.expires >= at && r.inDays <= withinDays)
    .sort((a, b) => a.inDays - b.inDays);
}

export { summarize, entityKind };
