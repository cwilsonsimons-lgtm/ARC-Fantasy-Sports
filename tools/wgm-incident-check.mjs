// Tier 8 checks: incidents, the eight answers, and what each one costs.
//
// The distribution checks at the bottom are measurements rather than
// assertions of taste: the design asks for "almost every show has some chaos,
// and most of it is small", so the suite runs forty shows and checks the shape
// of what came out.
//
// Usage: node tools/wgm-incident-check.mjs
import * as store from '../wrestling/js/core/store.js';
import * as persist from '../wrestling/js/core/persist.js';
import { SCHEMA_VERSION } from '../wrestling/js/core/store.js';
import * as runner from '../wrestling/js/systems/showRunner.js';
import * as booking from '../wrestling/js/systems/booking.js';
import { installSystems } from '../wrestling/js/systems/index.js';
import { seedRoster } from '../wrestling/js/data/roster.js';
import { seedTitles } from '../wrestling/js/data/titles.js';
import { checkState } from '../wrestling/js/core/invariants.js';
import { EVENT_TYPES, VISIBILITY } from '../wrestling/js/core/events.js';
import {
  INCIDENT_KINDS, INCIDENT_KEYS, INCIDENT_SPECS, INCIDENT_STATUS,
  RESPONSES, RESPONSE_KEYS, RESPONSE_SPECS, SUSPENSION_DAYS,
  severityLabel, isAnswerable, validateIncident,
} from '../wrestling/js/models/incident.js';
import {
  respond, canRespond, optionsFor, chanceOf, frictionBetween, grievancePressure,
  meetingPressure, checkFriction, checkRefusal, LAPSE_MATTERS_ABOVE, MAX_PER_SHOW,
} from '../wrestling/js/systems/incidents.js';
import { MEMORY_TYPES } from '../wrestling/js/models/memory.js';
import { SEGMENT_STATUS } from '../wrestling/js/models/segment.js';
import { isSuspended, canBeBooked } from '../wrestling/js/models/wrestler.js';
import { establishHistory, clearTheWay, runCard } from './lib/fixtures.mjs';

let passed = 0; const failures = [];
const check = (label, fn) => {
  try { const d = fn(); passed++; console.log(`  ok  ${label}${d ? `  ${d}` : ''}`); }
  catch (e) { failures.push(`${label}: ${e.message}`); console.log(`FAIL  ${label}\n      ${e.message}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`); };
const throws = (fn, m) => { try { fn(); } catch { return; } throw new Error(m); };

console.log('\nTier 8: backstage incidents\n');

installSystems();
store.newGame({ seed: 'incidents', gmName: 'I', brandName: 'Friday Night', scheduleBlocks: 3 });
const k = seedRoster();
establishHistory(store, k);
seedTitles(store);

function newShow() {
  const show = runner.currentShow();
  if (show && show.status === 'live') runner.goOffAir(show.id);
  if (!runner.nextWeek()) { store.scheduleProgramming(1); runner.nextWeek(); }
  return runner.currentShow();
}

function single(showId, a, b, min = 12) {
  return store.bookSegment({
    showId, format: 'singles', kind: 'match',
    name: `${store.nameOf(a)} vs ${store.nameOf(b)}`, timeLimitSec: min * 60,
    participants: [{ wrestlerId: a, side: 'a' }, { wrestlerId: b, side: 'b' }],
  });
}

/** Stand two people in a room with the GM, so anything between them is seen. */
function put(room, ids) {
  for (const id of ids) store.placeWrestler(id, room);
  store.moveGm(room);
}

/** Raise one directly, so the response tests do not depend on a roll. */
function stage(kind, ids, { severity = 40, room = 'catering', showId = null } = {}) {
  put(room, ids);
  const incident = store.raiseIncident({
    kind, locationId: room, showId,
    participantIds: ids,
    targetId: ids[1] || null,
    severity,
    reasons: [{ label: 'staged', detail: 'for the test', weight: 1 }],
  });
  store.discoverIncident(incident.id);
  return incident;
}

// --- the vocabulary -------------------------------------------------------

check('six kinds of trouble, each with a label and a noun', () => {
  eq(INCIDENT_KEYS.length, 6, 'incident kinds');
  for (const kind of INCIDENT_KEYS) {
    const spec = INCIDENT_SPECS[kind];
    assert(spec.label, `${kind} has no label`);
    assert(spec.noun, `${kind} has no noun`);
    assert(Number.isFinite(spec.baseSeverity), `${kind} has no base severity`);
  }
  return INCIDENT_KEYS.map((x) => INCIDENT_SPECS[x].label).join(', ');
});

check('eight answers, each with a cost', () => {
  eq(RESPONSE_KEYS.length, 8, 'responses');
  for (const key of RESPONSE_KEYS) {
    const spec = RESPONSE_SPECS[key];
    assert(spec.label, `${key} has no label`);
    assert(spec.blurb, `${key} has no blurb`);
    assert(Number.isFinite(spec.seconds), `${key} has no time cost`);
  }
  const present = RESPONSE_KEYS.filter((x) => RESPONSE_SPECS[x].needsPresence);
  eq(present.join(','), 'talk,mediate', 'the ones you have to be there for');
  return `${RESPONSE_KEYS.length} answers, ${present.length} of them need you in the room`;
});

check('the severity bands run friction to crisis', () => {
  eq(severityLabel(10), 'Friction', 'low');
  eq(severityLabel(40), 'Flare-up', 'middling');
  eq(severityLabel(60), 'Serious', 'high');
  eq(severityLabel(90), 'Crisis', 'top');
  return `${[10, 40, 60, 90].map((n) => `${n}=${severityLabel(n)}`).join(' ')}`;
});

check('an incident with nothing in it is refused', () => {
  throws(() => store.raiseIncident({ kind: 'argument', locationId: 'catering', participantIds: [] }),
    'an incident with no participants was accepted');
  throws(() => store.raiseIncident({ kind: 'argument', participantIds: [k.croft] }),
    'an incident with no location was accepted');
  throws(() => store.raiseIncident({ kind: 'sulking', locationId: 'catering', participantIds: [k.croft] }),
    'an unknown kind was accepted');
});

// --- what an incident carries ---------------------------------------------

check('an incident has participants, a place, a severity, a cause and its reasons', () => {
  const show = newShow();
  single(show.id, k.croft, k.vance);
  runner.goLive(show.id);

  const incident = stage(INCIDENT_KINDS.ARGUMENT, [k.kane, k.pike],
    { severity: 44, room: 'locker_room', showId: show.id });

  eq(incident.participantIds.length, 2, 'participants');
  eq(incident.locationId, 'locker_room', 'where');
  eq(incident.severity, 44, 'severity');
  assert(incident.causeEventId, 'no cause recorded');
  assert(incident.reasons.length, 'no reasons recorded');
  eq(incident.status, INCIDENT_STATUS.OPEN, 'status');
  eq(validateIncident(incident).length, 0, validateIncident(incident).join(', '));
  return `${store.nameOf(k.kane)} and ${store.nameOf(k.pike)}, ${severityLabel(44)}, in the Locker Room`;
});

check('it goes into the global log as a backstage event', () => {
  const started = store.queryLog({ type: EVENT_TYPES.INCIDENT_STARTED, newestFirst: true, limit: 1 })[0];
  assert(started, 'nothing was logged');
  eq(started.visibility, VISIBILITY.BACKSTAGE, 'an incident is a backstage thing');
  eq(started.locationId, 'locker_room', 'the event knows the room');
  assert(started.data.incidentId, 'the event does not name the incident');
  assert(started.data.reasons.length, 'the event does not carry the reasons');
  assert(started.newsSummary, 'no line written to be heard second hand');
  return started.summary;
});

check('an incident nobody mentions cannot be answered', () => {
  const show = runner.currentShow();
  // Two people alone in the car park, with the GM across the building.
  store.moveGm('gm_office');
  for (const w of store.allWrestlers()) store.placeWrestler(w.id, 'locker_room');
  store.placeWrestler(k.halloran, 'parking');
  store.placeWrestler(k.ruiz, 'parking');

  const incident = store.raiseIncident({
    kind: INCIDENT_KINDS.ARGUMENT, locationId: 'parking', showId: show.id,
    participantIds: [k.halloran, k.ruiz], severity: 40,
    reasons: [{ label: 'staged', detail: 'for the test' }],
  });
  eq(incident.discoveredTick, null, 'the GM should not know yet');
  assert(!isAnswerable(incident), 'an unknown incident should not be answerable');
  const verdict = canRespond(incident, RESPONSES.WARNING);
  assert(!verdict.ok, 'an unknown incident was answerable');
  eq(verdict.problems[0], 'You do not know about this', 'reason given');
  throws(() => respond(incident.id, RESPONSES.WARNING), 'answered an incident nobody had mentioned');
  return 'you cannot act on what nobody told you';
});

check('the news layer is what makes it answerable', () => {
  const before = store.answerableIncidents().length;
  const show = runner.currentShow();
  // This time the GM is standing right there.
  const incident = stage(INCIDENT_KINDS.ARGUMENT, [k.wren, k.okonkwo],
    { severity: 36, room: 'catering', showId: show.id });
  // Staged incidents are discovered by hand; prove the wiring does it too.
  const witnessed = store.raiseIncident({
    kind: INCIDENT_KINDS.COMPLAINT, locationId: 'catering', showId: show.id,
    participantIds: [k.bloom], severity: 25,
    reasons: [{ label: 'staged', detail: 'for the test' }],
  });
  store.placeWrestler(k.bloom, 'catering');
  assert(witnessed.discoveredTick != null,
    'the GM was in the room and still did not find out');
  assert(store.answerableIncidents().length > before, 'nothing became answerable');
  return `${store.answerableIncidents().length} answerable`;
});

// --- the answers ----------------------------------------------------------

check('ignoring it is a choice, and they notice', () => {
  const show = runner.currentShow();
  const incident = stage(INCIDENT_KINDS.ARGUMENT, [k.mabry, k.kovac],
    { severity: 62, showId: show.id });
  const before = store.getWrestler(k.mabry).ties.gm.respect;

  const out = respond(incident.id, RESPONSES.IGNORE);
  const after = store.getWrestler(k.mabry).ties.gm.respect;

  eq(store.getIncident(incident.id).status, INCIDENT_STATUS.RESOLVED, 'status');
  eq(store.getIncident(incident.id).response, RESPONSES.IGNORE, 'response recorded');
  assert(after < before, `respect did not move: ${before} -> ${after}`);
  assert(store.getWrestler(k.mabry).memory.some((m) => m.type === MEMORY_TYPES.LEFT_TO_IT.key),
    'a serious thing left alone should be remembered');
  return `${out.summary}, costing ${before - after} respect`;
});

check('small things left alone are forgotten, serious ones are not', () => {
  const show = runner.currentShow();
  const petty = stage(INCIDENT_KINDS.COMPLAINT, [k.lund], { severity: 20, showId: show.id });
  const beforeMem = store.getWrestler(k.lund).memory.length;
  respond(petty.id, RESPONSES.IGNORE);
  eq(store.getWrestler(k.lund).memory.length, beforeMem,
    'a grumble left alone should not become a grievance');
  assert(petty.severity < LAPSE_MATTERS_ABOVE,
    'the test needs a genuinely small incident');
  return `below ${LAPSE_MATTERS_ABOVE} severity, nothing is written down`;
});

check('talking to somebody means being in the room with them', () => {
  const show = runner.currentShow();
  const incident = stage(INCIDENT_KINDS.COMPLAINT, [k.sparrow], { room: 'medical', showId: show.id });
  store.moveGm('gm_office');
  const away = canRespond(incident, RESPONSES.TALK);
  assert(!away.ok, 'talked to somebody from across the building');
  assert(/not in Medical/.test(away.problems[0]), away.problems[0]);

  store.moveGm('medical');
  assert(canRespond(incident, RESPONSES.TALK).ok, 'could not talk to them in the same room');
  // Security does not need you there. That is the trade.
  const fight = stage(INCIDENT_KINDS.FIGHT, [k.kane, k.pike], { room: 'parking', showId: show.id });
  store.moveGm('gm_office');
  assert(canRespond(fight, RESPONSES.SECURITY).ok, 'security should not need you present');
  return 'talking needs you there, sending security does not';
});

check('crossing the building to talk costs the night clock', () => {
  const show = runner.currentShow();
  const incident = stage(INCIDENT_KINDS.COMPLAINT, [k.delacroix], { room: 'catering', showId: show.id });
  store.moveGm('gm_office');
  const start = store.tick();
  store.moveGm('catering');
  const walked = store.tick() - start;
  respond(incident.id, RESPONSES.TALK);
  const total = store.tick() - start;
  assert(walked > 0, 'the walk was free');
  eq(total, walked + RESPONSE_SPECS[RESPONSES.TALK].seconds, 'talking took the wrong time');
  return `${walked}s walking plus ${RESPONSE_SPECS[RESPONSES.TALK].seconds}s talking`;
});

check('mediating takes the heat out of it on both sides', () => {
  const show = runner.currentShow();
  // Make it winnable: two people who believe the GM and are hard to rile.
  for (const id of [k.wren, k.okonkwo]) {
    const w = store.getWrestler(id);
    w.ties.gm.trust = 95; w.ties.gm.respect = 90;
    w.identity.traits.professionalism = 90; w.identity.traits.volatility = 10;
  }
  store.adjustRelationship(k.wren, k.okonkwo, { hostility: 60 }, { reason: 'test setup' });
  store.adjustRelationship(k.okonkwo, k.wren, { hostility: 60 }, { reason: 'test setup' });
  const before = store.getWrestler(k.wren).ties.relationships[k.okonkwo].hostility;

  const incident = stage(INCIDENT_KINDS.ARGUMENT, [k.wren, k.okonkwo], { severity: 30, showId: show.id });
  assert(chanceOf(incident, RESPONSES.MEDIATE) > 0.5,
    `two reasonable people should be mediable, chance was ${chanceOf(incident, RESPONSES.MEDIATE)}`);

  let out;
  for (let i = 0; i < 40 && !(out && out.landed); i++) {
    const inc = stage(INCIDENT_KINDS.ARGUMENT, [k.wren, k.okonkwo], { severity: 30, showId: show.id });
    out = respond(inc.id, RESPONSES.MEDIATE);
    if (!out.landed) store.resolveIncident(inc.id, { response: 'ignore', summary: 'test cleanup' });
  }
  assert(out.landed, 'mediation never landed in forty tries');
  const after = store.getWrestler(k.wren).ties.relationships[k.okonkwo].hostility;
  assert(after < before, `heat did not come down: ${before} -> ${after}`);
  return `heat ${before} -> ${after}`;
});

check('talking people down is what trust is for', () => {
  const w = store.getWrestler(k.croft);
  const saved = { t: w.ties.gm.trust, r: w.ties.gm.respect,
    p: w.identity.traits.professionalism, v: w.identity.traits.volatility };
  const odds = (trust, respect, prof, vol, severity) => {
    w.ties.gm.trust = trust; w.ties.gm.respect = respect;
    w.identity.traits.professionalism = prof; w.identity.traits.volatility = vol;
    return chanceOf({ participantIds: [k.croft], severity }, RESPONSES.TALK);
  };

  const trustedSmall = odds(80, 75, 70, 30, 30);
  const trustedCrisis = odds(80, 75, 70, 30, 85);
  const ordinary = odds(50, 50, 55, 50, 45);
  const distrusted = odds(15, 15, 30, 80, 45);
  Object.assign(w.ties.gm, { trust: saved.t, respect: saved.r });
  w.identity.traits.professionalism = saved.p;
  w.identity.traits.volatility = saved.v;

  assert(trustedSmall > 0.7, `a trusted GM should usually settle a small row, got ${trustedSmall}`);
  assert(trustedCrisis < trustedSmall, 'a crisis should be harder than a row');
  assert(trustedCrisis > 0.3, `a trusted GM should have a real chance at a crisis, got ${trustedCrisis}`);
  assert(ordinary > 0.25 && ordinary < 0.6, `an ordinary GM should be a coin flip at best, got ${ordinary}`);
  assert(distrusted < 0.15, `a GM nobody believes should not talk anybody down, got ${distrusted}`);
  return `trusted ${Math.round(trustedSmall * 100)}% on a row and ${Math.round(trustedCrisis * 100)}% on a crisis, `
    + `ordinary ${Math.round(ordinary * 100)}%, distrusted ${Math.round(distrusted * 100)}%`;
});

check('security always works and is never forgiven', () => {
  const show = runner.currentShow();
  const incident = stage(INCIDENT_KINDS.FIGHT, [k.kane, k.pike], { severity: 70, showId: show.id });
  eq(chanceOf(incident, RESPONSES.SECURITY), 1, 'security should be certain');
  const trustBefore = store.getWrestler(k.kane).ties.gm.trust;
  const respectBefore = store.getWrestler(k.kane).ties.gm.respect;

  const out = respond(incident.id, RESPONSES.SECURITY);
  const w = store.getWrestler(k.kane);
  assert(out.landed, 'security failed');
  assert(w.ties.gm.trust < trustBefore, `trust did not fall: ${trustBefore} -> ${w.ties.gm.trust}`);
  assert(w.ties.gm.respect > respectBefore, 'they should at least respect that it worked');
  assert(w.memory.some((m) => m.type === MEMORY_TYPES.MANHANDLED.key), 'not remembered');
  return `trust ${trustBefore} -> ${w.ties.gm.trust}, respect ${respectBefore} -> ${w.ties.gm.respect}`;
});

check('a professional takes a warning; somebody who is not resents it', () => {
  const show = runner.currentShow();
  const pro = store.getWrestler(k.lund);
  const notPro = store.getWrestler(k.halloran);
  pro.identity.traits.professionalism = 90;
  notPro.identity.traits.professionalism = 20;

  const a = stage(INCIDENT_KINDS.COMPLAINT, [pro.id], { severity: 40, showId: show.id });
  const proRespectBefore = pro.ties.gm.respect;
  respond(a.id, RESPONSES.WARNING);
  const proDelta = pro.ties.gm.respect - proRespectBefore;

  const b = stage(INCIDENT_KINDS.COMPLAINT, [notPro.id], { severity: 40, showId: show.id });
  const badRespectBefore = notPro.ties.gm.respect;
  const badTrustBefore = notPro.ties.gm.trust;
  respond(b.id, RESPONSES.WARNING);

  assert(proDelta > 0, `the professional should respect it, got ${proDelta}`);
  assert(notPro.ties.gm.respect < badRespectBefore, 'the unprofessional one should not');
  assert(notPro.ties.gm.trust < badTrustBefore, 'and should trust you less for it');
  eq(pro.state.discipline.warnings > 0, true, 'the warning is on the record');
  return `professional ${proDelta >= 0 ? '+' : ''}${proDelta} respect, unprofessional ${notPro.ties.gm.respect - badRespectBefore}`;
});

check('a warning makes the next row less likely', () => {
  // Needs a pair with something between them to start with, or there is no
  // pressure for the warning to take off.
  store.adjustRelationship(k.kane, k.pike, { hostility: 70 }, { reason: 'test setup' });
  store.adjustRelationship(k.pike, k.kane, { hostility: 70 }, { reason: 'test setup' });
  const before = frictionBetween(k.kane, k.pike).score;
  assert(before > 20, `the test needs real pressure to start with, got ${before}`);

  store.setDiscipline(k.kane, { warnings: 2 }, { reason: 'test' });
  const after = frictionBetween(k.kane, k.pike).score;
  const reason = frictionBetween(k.kane, k.pike).reasons.find((r) => r.label === 'On a warning');
  store.setDiscipline(k.kane, { warnings: 0 }, { reason: 'test cleanup' });

  assert(after < before, `a warning did nothing: ${before} -> ${after}`);
  assert(reason, 'the warning is not shown as a reason');
  return `pressure ${Math.round(before)} -> ${Math.round(after)} with two warnings on the record`;
});

check('sending somebody home takes them off the rest of the card', () => {
  const show = newShow();
  single(show.id, k.croft, k.vance, 12);
  single(show.id, k.kane, k.pike, 10);
  single(show.id, k.bloom, k.sparrow, 10);
  runner.goLive(show.id);
  runCard(store, runner, show.id);   // clears any refusal in the way

  const show2 = newShow();
  single(show2.id, k.croft, k.vance, 12);
  const doomed = single(show2.id, k.kane, k.pike, 10);
  runner.goLive(show2.id);

  const incident = stage(INCIDENT_KINDS.FIGHT, [k.kane, k.pike], { severity: 80, showId: show2.id });
  const out = respond(incident.id, RESPONSES.EJECTION);

  eq(store.getSegment(doomed.id).status, SEGMENT_STATUS.CUT, 'their match should be off');
  assert(store.getWrestler(k.kane).memory.some((m) => m.type === MEMORY_TYPES.SENT_HOME.key),
    'not remembered');
  assert(out.effects.some((e) => /Cut from the card/.test(e.why || '')), 'the cut was not recorded');
  return out.summary;
});

check('a suspension keeps somebody off television', () => {
  const show = runner.currentShow();
  const incident = stage(INCIDENT_KINDS.FIGHT, [k.mabry, k.kovac], { severity: 85, showId: show.id });
  respond(incident.id, RESPONSES.SUSPENSION);

  const w = store.getWrestler(k.mabry);
  const until = w.state.discipline.suspendedUntilDay;
  eq(until, store.today() + SUSPENSION_DAYS, 'suspension length');
  assert(isSuspended(w, store.today()), 'not actually suspended');
  assert(!canBeBooked(w, store.today()), 'still bookable while suspended');
  assert(w.memory.some((m) => m.type === MEMORY_TYPES.SUSPENSION.key && m.scar),
    'a suspension should scar');

  const next = store.allShows().find((s) => s.status === 'scheduled');
  const verdict = booking.validate(next.id, 'singles', [k.mabry, k.croft]);
  assert(!verdict.ok, 'booking let a suspended wrestler on the card');
  assert(/suspended/.test(verdict.problems[0]), verdict.problems[0]);
  assert(!booking.availableFor(next.id).some((x) => x.id === k.mabry), 'still offered as available');
  return verdict.problems[0];
});

check('a suspension ends when it is served', () => {
  const w = store.getWrestler(k.mabry);
  const until = w.state.discipline.suspendedUntilDay;
  assert(until != null, 'not suspended');
  store.advanceToDay(until);
  eq(store.getWrestler(k.mabry).state.discipline.suspendedUntilDay, null, 'still suspended after serving it');
  assert(canBeBooked(store.getWrestler(k.mabry), store.today()), 'still not bookable');
  return `served in ${SUSPENSION_DAYS} days`;
});

check('putting it on television is the answer that costs them nothing', () => {
  const show = newShow();
  single(show.id, k.croft, k.lund, 12);
  runner.goLive(show.id);

  const incident = stage(INCIDENT_KINDS.CONFRONTATION, [k.bloom, k.sparrow],
    { severity: 55, showId: show.id });
  const moraleBefore = store.getWrestler(k.bloom).state.morale;
  const respectBefore = store.getWrestler(k.bloom).ties.gm.respect;

  const out = respond(incident.id, RESPONSES.BOOK_MATCH);
  const w = store.getWrestler(k.bloom);

  assert(out.effects.some((e) => e.segmentId), 'no match came out of it');
  const booked = store.getSegment(out.effects.find((e) => e.segmentId).segmentId);
  assert(booked, 'the segment does not exist');
  const ids = booked.participants.map((p) => p.wrestlerId).sort();
  eq(ids.join(','), [k.bloom, k.sparrow].sort().join(','), 'wrong people in it');
  assert(store.getShow(booked.showId).status === 'scheduled',
    'it should go on a future card, not tonight');
  assert(w.state.morale > moraleBefore, `morale did not rise: ${moraleBefore} -> ${w.state.morale}`);
  assert(w.ties.gm.respect > respectBefore, 'they should rate you more for it');
  return out.summary;
});

check('you cannot mediate a complaint or book a match out of one person', () => {
  const show = runner.currentShow();
  const solo = stage(INCIDENT_KINDS.COMPLAINT, [k.ruiz], { severity: 30, showId: show.id });
  for (const key of [RESPONSES.MEDIATE, RESPONSES.SECURITY, RESPONSES.BOOK_MATCH]) {
    assert(!canRespond(solo, key).ok, `${key} should not apply to one person`);
  }
  assert(canRespond(solo, RESPONSES.TALK).ok || canRespond(solo, RESPONSES.WARNING).ok,
    'nothing at all could be done about a complaint');
  return 'the answers that need two people are offered only when there are two';
});

check('a failed answer is spent and the rest are not', () => {
  const show = runner.currentShow();
  const w = store.getWrestler(k.ruiz);
  const saved = { t: w.ties.gm.trust, r: w.ties.gm.respect, v: w.identity.traits.volatility,
    p: w.identity.traits.professionalism };
  // Somebody who believes nothing you say, at a crisis. Talking is close to
  // hopeless here, which is the case worth testing.
  w.ties.gm.trust = 0; w.ties.gm.respect = 0;
  w.identity.traits.volatility = 100; w.identity.traits.professionalism = 0;

  let incident; let out;
  for (let i = 0; i < 60; i++) {
    incident = stage(INCIDENT_KINDS.COMPLAINT, [k.ruiz], { severity: 95, showId: show.id });
    out = respond(incident.id, RESPONSES.TALK);
    if (!out.landed) break;
    store.resolveIncident(incident.id, { response: RESPONSES.IGNORE, summary: 'test cleanup' });
  }
  const chance = chanceOf(incident, RESPONSES.TALK);
  Object.assign(w.ties.gm, { trust: saved.t, respect: saved.r });
  w.identity.traits.volatility = saved.v;
  w.identity.traits.professionalism = saved.p;

  assert(!out.landed, `talking never once failed at ${(chance * 100).toFixed(0)}% odds`);
  const still = store.getIncident(incident.id);
  eq(still.status, INCIDENT_STATUS.OPEN, 'a failed answer should leave it open');
  assert(!canRespond(still, RESPONSES.TALK).ok, 'talked at them twice');
  assert(canRespond(still, RESPONSES.WARNING).ok, 'a failure should leave other answers open');
  store.resolveIncident(incident.id, { response: RESPONSES.IGNORE, summary: 'test cleanup' });
  return `talking at ${(chance * 100).toFixed(0)}% failed, and is now spent`;
});

check('every answer is offered with its working shown', () => {
  const show = runner.currentShow();
  const incident = stage(INCIDENT_KINDS.ARGUMENT, [k.kane, k.pike], { severity: 50, showId: show.id });
  const options = optionsFor(incident.id);
  eq(options.length, 8, 'all eight should be listed');
  for (const o of options) {
    assert(o.label && o.blurb, `${o.key} is missing its text`);
    assert(o.chance > 0 && o.chance <= 1, `${o.key} has chance ${o.chance}`);
    assert(o.ok || o.problems.length, `${o.key} is unavailable with no reason given`);
  }
  const certain = options.filter((o) => o.chance === 1).map((o) => o.key);
  assert(certain.includes(RESPONSES.SECURITY), 'security should be certain');
  assert(!certain.includes(RESPONSES.TALK), 'talking should not be');
  store.resolveIncident(incident.id, { response: RESPONSES.IGNORE, summary: 'test cleanup' });
  return `${options.filter((o) => o.ok).length} of 8 available here`;
});

// --- refusal --------------------------------------------------------------

check('a refusal stops the match it is a refusal of', () => {
  const show = newShow();
  // An earlier test turned an incident into a match on a future card, and this
  // may be that card. Clear it so the refused match is the one the show is
  // actually waiting on.
  for (const seg of store.segmentsOfShow(show.id)) {
    store.cutSegment(seg.id, { reason: 'test setup: clearing the card' });
  }
  // A SUPERSTAR, deliberately. Tier 4's floor means a lower-card wrestler
  // essentially cannot get here however much they hate the booking, so asking
  // one to refuse would be testing the wrong thing.
  const seg = single(show.id, k.croft, k.ruiz, 6);
  runner.goLive(show.id);

  const w = store.getWrestler(k.croft);
  w.identity.ego = 100;
  w.identity.ambition = 100;
  w.state.morale = 5;
  w.ties.gm.trust = 0; w.ties.gm.respect = 0;

  let incident = null;
  for (let i = 0; i < 80 && !incident; i++) {
    store.unblockSegment(seg.id);
    incident = checkRefusal(store.getSegment(seg.id));
  }
  assert(incident, 'a superstar opening against a rookie for six minutes never once refused');

  eq(incident.kind, INCIDENT_KINDS.REFUSAL, 'kind');
  eq(incident.blocksSegmentId, seg.id, 'it should block its own match');
  eq(store.getSegment(seg.id).blockedByIncidentId, incident.id, 'the segment should know');
  const blocked = runner.blockedBy(show.id);
  assert(blocked, 'the show is not actually held up');
  throws(() => runner.previewNext(show.id), 'the blocked match ran anyway');

  const refused = store.queryLog({ type: EVENT_TYPES.BOOKING_REFUSED, newestFirst: true, limit: 1 })[0];
  assert(refused, 'the refusal was not logged');
  assert(Number.isFinite(refused.data.willingness), 'no willingness recorded');
  return `${store.nameOf(incident.instigatorId)} at willingness ${refused.data.willingness}, floor ${refused.data.floor}`;
});

check('a refusal always announces itself, so the show can never deadlock', () => {
  const show = runner.currentShow();
  const blocked = runner.blockedBy(show.id);
  if (!blocked) return 'nothing was blocking the card';
  // The GM must be able to act on it from wherever they are standing. If a
  // refusal went through the normal news layer, a GM alone in their office
  // could be left with a card that will not move and nothing to do about it.
  assert(blocked.incident.discoveredTick != null,
    'the card stopped and nobody told the GM why');
  store.moveGm('parking');
  const options = optionsFor(blocked.incident.id).filter((o) => o.ok);
  assert(options.length > 0,
    'a held-up card with no available answer is a dead end');
  assert(store.deliveredNotifications().some((n) => /will not go out/.test(n.summary)),
    'the stopped card did not reach the news feed');
  return `answerable from across the building: ${options.map((o) => o.label).join(', ')}`;
});

check('forcing the issue puts the match back on', () => {
  const show = runner.currentShow();
  const blocked = runner.blockedBy(show.id);
  if (!blocked) return 'nothing was blocking the card';
  store.discoverIncident(blocked.incident.id);
  respond(blocked.incident.id, RESPONSES.WARNING);
  eq(store.getSegment(blocked.segment.id).blockedByIncidentId, null, 'still blocked');
  assert(!runner.blockedBy(show.id), 'the show is still held up');
  assert(runner.runNext(show.id), 'the match still did not run');
  return `${blocked.segment.name} went ahead`;
});

check('taking the refusal at face value costs you the match', () => {
  const show = newShow();
  const seg = single(show.id, k.halloran, k.ruiz, 10);
  single(show.id, k.croft, k.vance, 12);
  runner.goLive(show.id);

  const incident = store.raiseIncident({
    kind: INCIDENT_KINDS.REFUSAL, locationId: store.locationOf(k.halloran),
    showId: show.id, segmentId: seg.id, blocksSegmentId: seg.id,
    participantIds: [k.halloran], severity: 60,
    reasons: [{ label: 'staged', detail: 'for the test' }],
  });
  store.blockSegment(seg.id, incident.id);
  store.discoverIncident(incident.id);

  respond(incident.id, RESPONSES.IGNORE);
  eq(store.getSegment(seg.id).status, SEGMENT_STATUS.CUT, 'the match should be off the card');
  assert(!runner.blockedBy(show.id), 'the show is still held up');
  return 'ignoring a refusal means the match never happens';
});

// --- the night ending -----------------------------------------------------

check('whatever is still open when the show ends stops being answerable', () => {
  const show = runner.currentShow();
  const known = stage(INCIDENT_KINDS.FIGHT, [k.kane, k.pike], { severity: 80, showId: show.id });
  const respectBefore = store.getWrestler(k.kane).ties.gm.respect;

  runCard(store, runner, show.id);
  runner.goOffAir(show.id);

  const after = store.getIncident(known.id);
  eq(after.status, INCIDENT_STATUS.UNRESOLVED, 'it should have lapsed, not resolved');
  eq(after.response, null, 'nothing was done, so nothing should be recorded');
  assert(store.getWrestler(k.kane).ties.gm.respect < respectBefore,
    'knowing about a crisis all night and doing nothing should cost something');
  const lapsed = store.queryLog({ type: EVENT_TYPES.INCIDENT_LAPSED, newestFirst: true, limit: 1 })[0];
  assert(lapsed, 'the lapse was not logged');
  return `${store.nameOf(k.kane)} lost ${respectBefore - store.getWrestler(k.kane).ties.gm.respect} respect over it`;
});

check('an incident the GM never heard about costs them nothing', () => {
  const show = newShow();
  single(show.id, k.croft, k.vance, 12);
  runner.goLive(show.id);

  store.moveGm('gm_office');
  for (const w of store.allWrestlers()) store.placeWrestler(w.id, 'locker_room');
  store.placeWrestler(k.halloran, 'parking');

  const hidden = store.raiseIncident({
    kind: INCIDENT_KINDS.COMPLAINT, locationId: 'parking', showId: show.id,
    participantIds: [k.halloran], severity: 80,
    reasons: [{ label: 'staged', detail: 'for the test' }],
  });
  // Nobody else was in the car park, so nobody can have mentioned it.
  eq(hidden.discoveredTick, null, 'somehow the GM found out');
  const before = store.getWrestler(k.halloran).ties.gm.respect;

  runCard(store, runner, show.id);
  runner.goOffAir(show.id);

  eq(store.getIncident(hidden.id).status, INCIDENT_STATUS.UNRESOLVED, 'status');
  eq(store.getWrestler(k.halloran).ties.gm.respect, before,
    'the GM was charged for something nobody told them about');
  return 'no news, no blame';
});

// --- persistence ----------------------------------------------------------

check('incidents survive a save and a load', () => {
  const before = store.allIncidents().map((i) =>
    `${i.id}:${i.kind}:${i.severity}:${i.status}:${i.response || '-'}`).join(';');
  const json = persist.toJSON({ label: 'incidents' });
  store.reset();
  persist.fromJSON(json);
  const after = store.allIncidents().map((i) =>
    `${i.id}:${i.kind}:${i.severity}:${i.status}:${i.response || '-'}`).join(';');
  eq(after, before, 'incidents differ after reload');
  return `${store.allIncidents().length} incidents restored exactly`;
});

check('a save from before any of this loads clean', () => {
  const envelope = JSON.parse(persist.toJSON({ label: 'v7' }));
  envelope.schemaVersion = 7;
  envelope.state.meta.schemaVersion = 7;
  delete envelope.state.incidents;
  for (const w of Object.values(envelope.state.wrestlers)) delete w.state.discipline;
  for (const seg of Object.values(envelope.state.segments)) {
    seg.blockedByIncidentId = 'inc_9999';   // a dangling reference by definition
  }
  store.reset();
  persist.deserialize(envelope);
  const state = store.getState();
  eq(state.meta.schemaVersion, SCHEMA_VERSION, 'schema after migration');
  eq(Object.keys(state.incidents).length, 0, 'a v7 save has no incidents');
  for (const w of Object.values(state.wrestlers)) {
    assert(w.state.discipline, `${w.id} has no disciplinary record`);
    eq(w.state.discipline.warnings, 0, 'warnings');
    eq(w.state.discipline.suspendedUntilDay, null, 'suspension');
  }
  for (const seg of Object.values(state.segments)) {
    eq(seg.blockedByIncidentId, null, `segment ${seg.id} kept a dangling block`);
  }
  const problems = checkState(state);
  assert(!problems.length, `migrated state is not sound:\n      - ${problems.join('\n      - ')}`);
  return `v7 -> v${SCHEMA_VERSION}: ${Object.keys(state.wrestlers).length} records created`;
});

check('the invariants catch a block on an incident that is already closed', () => {
  const state = store.getState();
  const segId = Object.keys(state.segments)[0];
  state.incidents.inc_0001 = {
    id: 'inc_0001', kind: 'argument', day: 1, tick: 0, locationId: 'catering',
    showId: null, segmentId: null, participantIds: [Object.keys(state.wrestlers)[0]],
    instigatorId: Object.keys(state.wrestlers)[0], targetId: null, severity: 40,
    causeEventId: null, reasons: [], status: INCIDENT_STATUS.RESOLVED,
    discoveredTick: 0, notificationId: null, response: RESPONSES.IGNORE,
    respondedOnTick: 0, attempted: [], outcome: null, blocksSegmentId: null,
  };
  state.segments[segId].blockedByIncidentId = 'inc_0001';
  const problems = checkState(state);
  assert(problems.some((p) => /already resolved/.test(p)),
    `expected a complaint about a stale block, got:\n      - ${problems.join('\n      - ')}`);

  state.segments[segId].blockedByIncidentId = null;
  delete state.incidents.inc_0001;
  eq(checkState(state).length, 0, 'putting it back should settle it');
  return problems.find((p) => /already resolved/.test(p));
});

check('the invariants refuse an incident answered without ever being heard', () => {
  const state = store.getState();
  const wid = Object.keys(state.wrestlers)[0];
  state.incidents.inc_0002 = {
    id: 'inc_0002', kind: 'complaint', day: 1, tick: 0, locationId: 'catering',
    showId: null, segmentId: null, participantIds: [wid], instigatorId: wid,
    targetId: null, severity: 30, causeEventId: null, reasons: [],
    status: INCIDENT_STATUS.RESOLVED, discoveredTick: null, notificationId: null,
    response: RESPONSES.TALK, respondedOnTick: 0, attempted: [], outcome: null,
    blocksSegmentId: null,
  };
  const problems = checkState(state);
  assert(problems.some((p) => /without ever reaching the GM/.test(p)),
    `expected a complaint, got:\n      - ${problems.join('\n      - ')}`);
  delete state.incidents.inc_0002;
  return problems.find((p) => /without ever reaching the GM/.test(p));
});

// --- the shape of a season ------------------------------------------------

check('almost every show has some chaos, and most of it is small', () => {
  const tally = {}; const severities = []; let shows = 0;
  let withSomething = 0;

  for (const seed of ['s1', 's2', 's3', 's4', 's5']) {
    store.reset();
    installSystems();
    store.newGame({ seed, gmName: 'G', brandName: 'T', scheduleBlocks: 3 });
    const kk = seedRoster();
    seedTitles(store);
    for (let week = 0; week < 8; week++) {
      const show = runner.currentShow();
      const free = booking.availableFor(show.id).map((w) => w.id);
      for (let i = 0; i + 1 < free.length && i < 8; i += 2) single(show.id, free[i], free[i + 1], 12);
      const before = store.allIncidents().length;
      runner.goLive(show.id);
      runCard(store, runner, show.id);
      runner.goOffAir(show.id);
      shows++;
      if (store.allIncidents().length > before) withSomething++;
      if (!runner.nextWeek()) { store.scheduleProgramming(1); runner.nextWeek(); }
    }
    for (const i of store.allIncidents()) {
      tally[i.kind] = (tally[i.kind] || 0) + 1;
      severities.push(i.severity);
    }
  }

  const total = severities.length;
  const perShow = total / shows;
  const bands = {};
  for (const s of severities) bands[severityLabel(s)] = (bands[severityLabel(s)] || 0) + 1;
  const small = ((bands.Friction || 0) + (bands['Flare-up'] || 0)) / total;

  assert(perShow > 1 && perShow < 4, `${perShow.toFixed(2)} incidents per show is not "some chaos"`);
  assert(withSomething / shows > 0.6,
    `only ${Math.round((withSomething / shows) * 100)}% of shows had anything happen`);
  assert(small > 0.65, `only ${Math.round(small * 100)}% of it was small`);
  assert((bands.Crisis || 0) / total < 0.15,
    `${Math.round(((bands.Crisis || 0) / total) * 100)}% crises is too many`);
  assert(Object.keys(tally).length >= 5, `only ${Object.keys(tally).length} kinds ever happened`);

  return `${perShow.toFixed(2)}/show over ${shows} shows, ${Math.round(small * 100)}% small, `
    + Object.entries(tally).sort((a, b) => b[1] - a[1])
      .map(([x, n]) => `${x} ${(n / shows).toFixed(2)}`).join(', ');
});

check('people do not start swinging more readily than they start shouting', () => {
  // Only incidents that START on their own. From Tier 9 a fight can also be
  // the second link in a chain - somebody pulled a man off and got rounded on
  // for it - and those say nothing about how readily anybody swings first.
  const tally = {};
  for (const i of store.allIncidents()) {
    if (i.chainDepth > 0) continue;
    tally[i.kind] = (tally[i.kind] || 0) + 1;
  }
  const rows = tally[INCIDENT_KINDS.ARGUMENT] || 0;
  const fights = tally[INCIDENT_KINDS.FIGHT] || 0;
  assert(fights <= rows,
    `${fights} fights against ${rows} arguments, neither out of a chain: people are swinging too readily`);
  const spawned = store.allIncidents().filter((i) => i.chainDepth > 0).length;
  return Object.entries(tally).map(([x, n]) => `${x} ${n}`).join(', ')
    + ` (plus ${spawned} out of chains)`;
});

check('every incident carries reasons that are not a dice roll', () => {
  const sample = store.allIncidents().filter((i) => i.reasons.length);
  assert(sample.length, 'no incident carried any reasons');
  const ratio = sample.length / store.allIncidents().length;
  assert(ratio > 0.85, `only ${Math.round(ratio * 100)}% of incidents explained themselves`);
  const one = sample[Math.floor(sample.length / 2)];
  return `${one.kind}: ${one.reasons.map((r) => r.label).join(', ')}`;
});

check('nothing raises more than the nightly cap', () => {
  const byShow = {};
  for (const i of store.allIncidents()) {
    if (!i.showId) continue;
    byShow[i.showId] = (byShow[i.showId] || 0) + 1;
  }
  const worst = Math.max(0, ...Object.values(byShow));
  assert(worst <= MAX_PER_SHOW, `one night produced ${worst}, cap is ${MAX_PER_SHOW}`);
  return `busiest night: ${worst} of ${MAX_PER_SHOW}`;
});

check('the state is sound after a season of it', () => {
  const problems = checkState(store.getState());
  assert(!problems.length, `not sound:\n      - ${problems.join('\n      - ')}`);
  return `${store.allIncidents().length} incidents, ${store.allWrestlers().length} wrestlers, no problems`;
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) { for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
