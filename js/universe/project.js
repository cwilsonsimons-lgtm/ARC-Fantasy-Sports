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

import { entityKind } from './schema.js';

const DAY = 86400000;
export const days = (from, to) => Math.max(0, Math.round((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / DAY));
const feudKey = (a, b) => [a, b].sort().join('|');
const todayISO = () => new Date().toISOString().slice(0, 10);

export function project(store, { asOf = null } = {}) {
  const events = store.effectiveEvents({ asOf });
  const at = asOf || todayISO();

  const state = {
    asOf: at,
    wrestlers: {}, brands: {}, championships: {}, groups: {},
    shows: [], showsById: {}, feuds: {}, events,
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
      ...c, holders: [], vacant: true, since: null, reigns: [], totalDefenses: 0, retired: !!c.retiredOn,
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
  });

  // ---------------------------------------------------------------- settle
  Object.values(state.championships).forEach(c => {
    const cur = c.reigns[c.reigns.length - 1];
    if (cur && !cur.to) cur.days = days(cur.from, at);
    c.since = cur && !cur.to ? cur.from : null;
    c.daysHeld = cur && !cur.to ? cur.days : 0;
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
  state.feuds = Object.values(state.feuds).sort((a, b) => b.heat - a.heat || (a.last < b.last ? 1 : -1));
  Object.values(state.brands).forEach(b => b.roster.sort((x, y) => state.wrestlers[x].name.localeCompare(state.wrestlers[y].name)));

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
      const show = { id: fx.showId, name: fx.name, date: ev.date, brandId: fx.brandId, segments: [] };
      state.shows.push(show);
      state.showsById[show.id] = show;
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
      const cur = c.reigns[c.reigns.length - 1];
      const same = cur && !cur.to && sameSet(cur.holders, fx.holders);
      if (same) {
        // The belt ends up where it already was — one continuous reign, not a
        // new one. This is the shape a corrected match takes: the event still
        // says "the title changed hands", but the replay knows better. If it
        // was a match, the champion just defended, so count it as such rather
        // than letting the correction quietly lose a defense.
        if (ev.type === 'match') { cur.defenses += 1; c.totalDefenses += 1; }
        break;
      }
      if (cur && !cur.to) { cur.to = ev.date; cur.days = days(cur.from, ev.date); }
      c.reigns.push({ holders: [...fx.holders], from: ev.date, to: null, days: 0, defenses: 0, reason: fx.reason || 'won', eventId: ev.id });
      c.holders = [...fx.holders];
      c.vacant = false;
      fx.holders.forEach(h => {
        const w = W(h);
        if (w) w.titleHistory.push({ titleId: fx.titleId, from: ev.date, to: null, eventId: ev.id });
      });
      break;
    }

    case 'title.vacate': {
      const c = state.championships[fx.titleId];
      if (!c) break;
      const cur = c.reigns[c.reigns.length - 1];
      if (cur && !cur.to) {
        cur.to = ev.date; cur.days = days(cur.from, ev.date); cur.endReason = fx.reason || 'vacated';
        cur.holders.forEach(h => closeTitleHistory(W(h), fx.titleId, ev.date));
      }
      c.holders = []; c.vacant = true;
      if (fx.reason === 'retired') c.retired = true;
      break;
    }

    case 'title.defense': {
      const c = state.championships[fx.titleId];
      if (!c) break;
      const cur = c.reigns[c.reigns.length - 1];
      if (cur && !cur.to) { cur.defenses += 1; c.totalDefenses += 1; }
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

    case 'feud.heat': {
      // A feud is an unordered pair, so it is stored in a canonical order —
      // otherwise "Cody vs Solo" and "Solo vs Cody" would drift apart depending
      // on who happened to be the attacker.
      const [a, b] = [fx.a, fx.b].sort();
      const key = feudKey(a, b);
      const f = state.feuds[key] || (state.feuds[key] = { a, b, heat: 0, meetings: 0, last: null });
      f.heat += fx.points;
      f.meetings += 1;
      f.last = ev.date;
      break;
    }
  }
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

  if (ev.type === 'match') {
    const winner = ev.participants.find(p => p.role === 'winner');
    const nums = [...new Set(ev.participants.map(p => p.side))].sort();
    const corners = nums.map(side);
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
  } else {
    out.text = `${ev.type}: ${ev.participants.map(p => nm(p.ref)).join(', ')}`;
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

export function standings(state, brandId = null) {
  return Object.values(state.wrestlers)
    .filter(w => (brandId ? w.brandId === brandId : true) && w.record.total > 0)
    .sort((a, b) => b.record.w - a.record.w || b.winPct - a.winPct || a.name.localeCompare(b.name));
}

export function champions(state) {
  return Object.values(state.championships)
    .filter(c => !c.retired)
    .map(c => ({
      titleId: c.id, name: c.name, brandId: c.brandId, vacant: c.vacant,
      holders: c.holders.map(h => (state.wrestlers[h] ? state.wrestlers[h].name : h)),
      since: c.since, days: c.daysHeld,
      defenses: c.reigns.length ? c.reigns[c.reigns.length - 1].defenses : 0,
    }));
}

export function titleLineage(state, titleId) {
  const c = state.championships[titleId];
  if (!c) return [];
  return c.reigns.map((r, i) => ({
    n: i + 1,
    holders: r.holders.map(h => (state.wrestlers[h] ? state.wrestlers[h].name : h)),
    from: r.from, to: r.to, days: r.days, defenses: r.defenses, reason: r.reason, endReason: r.endReason || null,
  }));
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
