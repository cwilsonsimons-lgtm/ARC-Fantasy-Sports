// Tier 9 checks: who else gets involved, why, and what it costs them.
//
// The brief's own example is the shape this suite is built around:
//
//   A attacks B -> C saves B -> D attacks C -> the GM hears -> relationships move
//
// Every motive in here reads a number an earlier tier owns, so most of these
// checks are really checks that Tier 9 did not quietly invent a second
// personality system.
//
// Usage: node tools/wgm-reaction-check.mjs
import * as store from '../wrestling/js/core/store.js';
import * as persist from '../wrestling/js/core/persist.js';
import { SCHEMA_VERSION } from '../wrestling/js/core/store.js';
import * as runner from '../wrestling/js/systems/showRunner.js';
import * as booking from '../wrestling/js/systems/booking.js';
import { installSystems } from '../wrestling/js/systems/index.js';
import { seedRoster, seedFactions, FACTIONS } from '../wrestling/js/data/roster.js';
import { seedTitles } from '../wrestling/js/data/titles.js';
import { checkState } from '../wrestling/js/core/invariants.js';
import { EVENT_TYPES, VISIBILITY } from '../wrestling/js/core/events.js';
import { INCIDENT_KINDS, INCIDENT_STATUS, RESPONSES } from '../wrestling/js/models/incident.js';
import {
  REACTION_KINDS, REACTION_KEYS, MOTIVES, MOTIVE_LABEL, validateReaction,
} from '../wrestling/js/models/reaction.js';
import {
  react, reactLate, perform, flushDue, pullToward, nerveFor, candidatesFor,
  actChance, chainIds, inAnOpenIncident,
  PULL_FLOOR, STOOD_BY_FLOOR, LATE_FLOOR, MAX_CHAIN_DEPTH, MAX_REACTORS, NERVE_FLOOR,
} from '../wrestling/js/systems/reactions.js';
import { respond } from '../wrestling/js/systems/incidents.js';
import { MEMORY_TYPES } from '../wrestling/js/models/memory.js';
import { ALIGNMENT, ALIGNMENT_LABEL, isFace } from '../wrestling/js/models/wrestler.js';
import { validateFaction } from '../wrestling/js/models/faction.js';
import { runCard } from './lib/fixtures.mjs';

let passed = 0; const failures = [];
const check = (label, fn) => {
  try { const d = fn(); passed++; console.log(`  ok  ${label}${d ? `  ${d}` : ''}`); }
  catch (e) { failures.push(`${label}: ${e.message}`); console.log(`FAIL  ${label}\n      ${e.message}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`); };
const throws = (fn, m) => { try { fn(); } catch { return; } throw new Error(m); };

console.log('\nTier 9: reaction chains\n');

let k;
function fresh(seed = 'reactions') {
  store.reset();
  installSystems();
  store.newGame({ seed, gmName: 'R', brandName: 'Friday Night', scheduleBlocks: 3 });
  k = seedRoster();
  seedFactions(k);
  seedTitles(store);
  return k;
}

/** Put people in a room with the GM watching, so nothing is missed. */
function gather(ids, room = 'locker_room') {
  for (const w of store.allWrestlers()) store.placeWrestler(w.id, 'catering');
  for (const id of ids) store.placeWrestler(id, room);
  store.moveGm(room);
}

function jump(aId, bId, { severity = 60, room = 'locker_room', kind = INCIDENT_KINDS.FIGHT } = {}) {
  return store.raiseIncident({
    kind, locationId: room,
    participantIds: [aId, bId], instigatorId: aId, targetId: bId,
    severity,
    reasons: [{ label: 'staged', detail: 'for the test', weight: severity }],
    summary: `${store.nameOf(aId)} jumps ${store.nameOf(bId)}`,
  });
}

/** Make two people genuinely close, both ways. */
function bond(aId, bId, amount = 70) {
  store.adjustRelationship(aId, bId, { affinity: amount, trust: amount }, { reason: 'test setup' });
  store.adjustRelationship(bId, aId, { affinity: amount, trust: amount }, { reason: 'test setup' });
}

/** Close everything, so the next staged incident starts from a clean room. */
function settleAll() {
  for (const incident of store.openIncidents()) {
    store.resolveIncident(incident.id, { response: RESPONSES.IGNORE, summary: 'test cleanup' });
  }
  store.clearPendingReactions();
}

function feud(aId, bId, amount = 85) {
  store.adjustRelationship(aId, bId, { hostility: amount }, { reason: 'test setup' });
  store.adjustRelationship(bId, aId, { hostility: amount }, { reason: 'test setup' });
}

fresh();

// --- the new authored facts ----------------------------------------------

check('everybody has an alignment, and it matches how they behave', () => {
  const byAlignment = {};
  for (const w of store.allWrestlers()) {
    assert(Object.values(ALIGNMENT).includes(w.identity.alignment),
      `${w.name} has alignment "${w.identity.alignment}"`);
    (byAlignment[w.identity.alignment] ||= []).push(w);
  }
  // Not a rule the code enforces, but a claim the roster should keep: the
  // babyfaces are not the jealous ones.
  const faceJealousy = byAlignment.face.reduce((t, w) => t + w.identity.traits.jealousy, 0)
    / byAlignment.face.length;
  const heelJealousy = byAlignment.heel.reduce((t, w) => t + w.identity.traits.jealousy, 0)
    / byAlignment.heel.length;
  assert(heelJealousy > faceJealousy + 20,
    `heels average ${heelJealousy.toFixed(0)} jealousy against faces' ${faceJealousy.toFixed(0)}`);
  return Object.entries(byAlignment)
    .map(([a, ws]) => `${ALIGNMENT_LABEL[a]} ${ws.length}`).join(', ');
});

check('a faction is membership and nothing else', () => {
  const factions = store.allFactions();
  eq(factions.length, FACTIONS.length, 'factions seeded');
  for (const f of factions) {
    eq(validateFaction(f).length, 0, validateFaction(f).join(', '));
    assert(f.memberIds.includes(f.leaderId), `${f.name} has an absentee leader`);
    // The whole point: a stable is NOT a shorthand for friendship.
    for (const a of f.memberIds) {
      for (const b of f.memberIds) {
        if (a === b) continue;
        const rel = store.getWrestler(a).ties.relationships[b];
        assert(!rel || (rel.affinity === 0 && rel.hostility === 0),
          `${store.nameOf(a)} already has an opinion of stablemate ${store.nameOf(b)}`);
      }
    }
  }
  return factions.map((f) => `${f.name} (${f.memberIds.length})`).join(', ');
});

check('nobody is in two stables', () => {
  const seen = new Set();
  for (const f of store.allFactions()) {
    for (const id of f.memberIds) {
      assert(!seen.has(id), `${store.nameOf(id)} is in two factions`);
      seen.add(id);
    }
  }
  eq(store.factionOf(k.croft).name, 'The Syndicate', 'Croft runs with');
  assert(store.sameFaction(k.croft, k.wren), 'Croft and Wren should be stablemates');
  assert(!store.sameFaction(k.croft, k.kane), 'Croft and Kane should not be');
  eq(store.factionOf(k.bloom), null, 'Bloom runs alone');
  return `${seen.size} of ${store.allWrestlers().length} run with somebody`;
});

check('a faction needs a name and two people', () => {
  throws(() => store.formFaction({ memberIds: [k.bloom, k.kovac] }), 'a nameless faction was accepted');
  throws(() => store.formFaction({ name: 'Solo', memberIds: [k.bloom] }), 'a faction of one was accepted');
});

// --- motive ---------------------------------------------------------------

check('every motive reads a number an earlier tier already owns', () => {
  fresh();
  const sparrow = store.getWrestler(k.sparrow);

  // Nothing has happened, so nothing but the authored facts should pull.
  const cold = pullToward(sparrow, k.vance);
  const coldMotives = new Set(cold.reasons.map((r) => r.motive));
  assert(!coldMotives.has(MOTIVES.ALLY), 'affinity pulled on a blank slate');
  assert(coldMotives.has(MOTIVES.CODE), 'two babyfaces should feel the code');

  // Now give Tier 5 something to say.
  bond(k.sparrow, k.vance, 70);
  const warm = pullToward(store.getWrestler(k.sparrow), k.vance);
  assert(warm.score > cold.score, `affinity did not register: ${cold.score} -> ${warm.score}`);
  assert(warm.reasons.some((r) => r.motive === MOTIVES.ALLY), 'no ally motive');

  // And Tier 5's other direction.
  feud(k.sparrow, k.wren, 80);
  const against = pullToward(store.getWrestler(k.sparrow), k.wren);
  assert(against.score < 0, `hostility should pull the other way, got ${against.score}`);
  assert(against.reasons.some((r) => r.motive === MOTIVES.RIVALRY), 'no rivalry motive');

  for (const r of [...warm.reasons, ...against.reasons]) {
    assert(!r.motive || r.motive in MOTIVE_LABEL, `unknown motive "${r.motive}"`);
  }
  return `cold ${Math.round(cold.score)}, bonded ${Math.round(warm.score)}, feuding ${Math.round(against.score)}`;
});

check('a stable is its own reason, separate from liking each other', () => {
  fresh();
  const wren = store.getWrestler(k.wren);
  const toStablemate = pullToward(wren, k.croft);
  const toStranger = pullToward(wren, k.bloom);

  assert(toStablemate.reasons.some((r) => r.motive === MOTIVES.FACTION), 'no faction motive');
  assert(!toStablemate.reasons.some((r) => r.motive === MOTIVES.ALLY),
    'faction should not be pretending to be affinity');
  assert(toStablemate.score > toStranger.score + 20,
    `stablemate ${toStablemate.score} against stranger ${toStranger.score}`);
  // And it counts for more when it is the leader.
  const toLeader = pullToward(store.getWrestler(k.delacroix), k.croft);
  const toPeer = pullToward(store.getWrestler(k.delacroix), k.wren);
  assert(toLeader.score > toPeer.score, 'backing the leader should weigh more');
  return `stablemate ${Math.round(toStablemate.score)}, leader ${Math.round(toLeader.score)}, stranger ${Math.round(toStranger.score)}`;
});

check('babyfaces feel the code and heels do not', () => {
  fresh();
  const faceToFace = pullToward(store.getWrestler(k.sparrow), k.pike);
  const heelToFace = pullToward(store.getWrestler(k.mabry), k.pike);
  assert(faceToFace.reasons.some((r) => r.motive === MOTIVES.CODE), 'no code between two babyfaces');
  assert(!heelToFace.reasons.some((r) => r.motive === MOTIVES.CODE), 'a heel felt the code');
  assert(isFace(store.getWrestler(k.sparrow)) && !isFace(store.getWrestler(k.mabry)), 'alignment');
  return `face to face ${Math.round(faceToFace.score)}, heel to face ${Math.round(heelToFace.score)}`;
});

check('nerve is courage against how bad it is', () => {
  fresh();
  const brave = store.getWrestler(k.sparrow);   // courage 92
  const timid = store.getWrestler(k.halloran);  // courage 20
  const row = { kind: INCIDENT_KINDS.ARGUMENT, severity: 30 };
  const brawl = { kind: INCIDENT_KINDS.FIGHT, severity: 85 };

  assert(nerveFor(brave, row) > nerveFor(timid, row), 'courage did not tell');
  assert(nerveFor(brave, brawl) < nerveFor(brave, row), 'a brawl should be harder than a row');
  assert(nerveFor(timid, brawl) < NERVE_FLOOR,
    `a coward should not have the nerve for a brawl, got ${nerveFor(timid, brawl)}`);
  return `${brave.shortName} ${nerveFor(brave, row)}/${nerveFor(brave, brawl)}, `
    + `${timid.shortName} ${nerveFor(timid, row)}/${nerveFor(timid, brawl)}`;
});

check('somebody fully committed is a near certainty, not a coin flip', () => {
  const committed = { score: 80, nerve: 60 };
  const halfhearted = { score: 30, nerve: 40 };
  assert(actChance(committed) > 0.85, `committed only acts ${actChance(committed)} of the time`);
  assert(actChance(halfhearted) < 0.45, `half-hearted acts ${actChance(halfhearted)} of the time`);
  return `committed ${Math.round(actChance(committed) * 100)}%, half-hearted ${Math.round(actChance(halfhearted) * 100)}%`;
});

// --- the room is the gate -------------------------------------------------

check('you cannot save somebody in a room you are not in', () => {
  fresh();
  bond(k.sparrow, k.vance, 90);
  gather([k.croft, k.vance], 'locker_room');
  store.placeWrestler(k.sparrow, 'parking');

  const incident = jump(k.croft, k.vance);
  const names = candidatesFor(incident).map((c) => c.wrestler.id);
  assert(!names.includes(k.sparrow), 'somebody two rooms away was offered as a candidate');
  const acted = incident.reactions.filter((r) => r.wrestlerId === k.sparrow && r.tick != null);
  eq(acted.length, 0, 'they saved somebody from across the building');
  return 'the room is the gate';
});

// --- the brief's own chain ------------------------------------------------

check('A attacks B, C saves B, D goes after C', () => {
  fresh('brief-example');
  // The relationships the chain needs, all of them Tier 5 data.
  feud(k.croft, k.vance, 80);       // A and B
  bond(k.sparrow, k.vance, 75);     // C will not watch B get jumped
  feud(k.kovac, k.sparrow, 85);     // D has a problem with C
  // Kovac deliberately: he runs with nobody, so he has no reason to get
  // involved at the root and is still free when the chain reaches C, and he has
  // the nerve for it. Somebody braver than Mabry, who at courage 55 sits just
  // under the floor for a fight and would wait instead - which is its own
  // correct answer, and a different test.
  eq(store.factionOf(k.kovac), null, 'the test needs D unaffiliated');
  gather([k.croft, k.vance, k.sparrow, k.kovac]);

  const root = jump(k.croft, k.vance, { severity: 62 });
  const all = [root, ...store.allIncidents().filter((i) => i.chainDepth > 0)];
  const reactions = all.flatMap((i) => i.reactions.filter((r) => r.tick != null));

  const save = reactions.find((r) => r.kind === REACTION_KINDS.SAVE);
  assert(save, 'nobody pulled anybody out of anything');
  const counter = reactions.find((r) =>
    (r.kind === REACTION_KINDS.INTERFERE || r.kind === REACTION_KINDS.JOIN)
    && r.wrestlerId !== save.wrestlerId);
  assert(counter, 'nobody came back at the saver');
  assert(counter.againstId === save.wrestlerId || counter.forId !== save.wrestlerId,
    'the counter-attack should not be on the saver\'s side');

  const spawned = store.allIncidents().filter((i) => i.chainDepth > 0);
  assert(spawned.length, 'the chain never produced a second incident');
  eq(spawned[0].causeIncidentId, root.id, 'the second link should point at the first');

  // And the GM, who was standing there, knows about all of it.
  for (const inc of all) {
    assert(inc.discoveredTick != null || inc.locationId !== store.gmLocation(),
      `${inc.id} happened in front of the GM and they did not notice`);
  }
  return `${store.nameOf(save.wrestlerId)} saved ${store.nameOf(save.forId)}, `
    + `then ${store.nameOf(counter.wrestlerId)} ${counter.kind === 'join' ? 'piled in' : 'went after them'}`;
});

check('a save makes a friend of the saved and an enemy of the aggressor', () => {
  const chain = store.allIncidents();
  const save = chain.flatMap((i) => i.reactions)
    .find((r) => r.kind === REACTION_KINDS.SAVE && r.tick != null);
  assert(save, 'no save to check');

  const savedBy = store.getWrestler(save.forId).ties.relationships[save.wrestlerId];
  assert(savedBy, 'the saved person has no opinion of the saver');
  assert(savedBy.affinity > 0, `affinity did not move: ${savedBy.affinity}`);
  assert(savedBy.trust > 50, `trust did not move: ${savedBy.trust}`);
  assert(store.getWrestler(save.forId).memory
    .some((m) => m.type === MEMORY_TYPES.SAVE.key && m.aboutIds.includes(save.wrestlerId)),
    'a save should be remembered');

  const incident = store.getIncident(save.incidentId);
  const aggressor = incident.participantIds.find((id) => id !== save.forId);
  const aggressorView = store.getWrestler(aggressor).ties.relationships[save.wrestlerId];
  assert(aggressorView && aggressorView.hostility > 0,
    'getting in the way should make you a problem');
  return `saved: affinity ${savedBy.affinity}, trust ${savedBy.trust}; `
    + `aggressor: hostility ${aggressorView.hostility}`;
});

check('the whole chain is in the log and can be walked from either end', () => {
  const spawned = store.allIncidents().find((i) => i.chainDepth > 0);
  assert(spawned, 'nothing was spawned');
  const chain = store.incidentChain(spawned.id);
  assert(chain.length >= 2, `chain is ${chain.length} long`);
  eq(chain[0].chainDepth, 0, 'a chain should start at the root');
  eq(chain[chain.length - 1].id, spawned.id, 'and end where it was asked about');
  for (let i = 1; i < chain.length; i++) {
    eq(chain[i].causeIncidentId, chain[i - 1].id, 'the links should join up');
    assert(chain[i].chainDepth > chain[i - 1].chainDepth, 'depth should increase');
  }
  const back = store.incidentsCausedBy(chain[0].id);
  assert(back.some((i) => i.id === chain[1].id), 'the chain does not walk forwards');

  const logged = store.queryLog({ type: EVENT_TYPES.INCIDENT_REACTION });
  assert(logged.length, 'no reaction reached the log');
  for (const e of logged) {
    eq(e.visibility, VISIBILITY.BACKSTAGE, 'a reaction is a backstage thing');
    assert(e.data.incidentId && e.data.reactionId, 'the event does not name what it is about');
  }
  return `${chain.length} links, ${logged.length} reactions logged`;
});

check('a chain is a line, and nobody is in two fights at once', () => {
  for (const inc of store.allIncidents()) {
    const children = store.incidentsCausedBy(inc.id);
    assert(children.length <= 1,
      `${inc.id} spawned ${children.length} incidents at once, which is a riot`);
  }
  // Every open between-people incident should involve different people, unless
  // they are links in the same chain.
  for (const a of store.openIncidents()) {
    const mine = chainIds(a);
    for (const id of a.participantIds) {
      assert(!inAnOpenIncident(id, mine),
        `${store.nameOf(id)} is in two unrelated fights`);
    }
  }
  const depths = store.allIncidents().map((i) => i.chainDepth);
  assert(Math.max(...depths) < MAX_CHAIN_DEPTH, `a chain ran to depth ${Math.max(...depths)}`);
  return `deepest chain: ${Math.max(...depths) + 1} links, cap is ${MAX_CHAIN_DEPTH}`;
});

// --- not helping ----------------------------------------------------------

check('a coward with every reason to help still does not', () => {
  fresh('coward');
  // Halloran: courage 20. Give him every motive in the book.
  bond(k.halloran, k.mabry, 95);
  gather([k.croft, k.mabry, k.halloran]);
  const incident = jump(k.croft, k.mabry, { severity: 88 });

  const his = incident.reactions.find((r) => r.wrestlerId === k.halloran);
  assert(his, `${store.nameOf(k.halloran)} did not register at all`);
  assert(his.kind === REACTION_KINDS.AVOIDED || his.kind === REACTION_KINDS.STOOD_BY,
    `a man with courage 20 waded into a crisis: ${his.kind}`);
  assert(his.nerve < NERVE_FLOOR, `nerve was ${his.nerve}`);
  assert(his.reasons.some((r) => /stomach|better of it/i.test(r.label || '')),
    'no reason given for not moving');
  return `${his.kind}, nerve ${his.nerve} against a floor of ${NERVE_FLOOR}`;
});

check('an ally who stands there is remembered for it', () => {
  fresh('stood-by');
  const watcher = store.getWrestler(k.croft);    // courage 25
  bond(k.croft, k.wren, 80);
  gather([k.vance, k.wren, k.croft]);

  let incident = null;
  for (let i = 0; i < 40 && !incident; i++) {
    settleAll();
    const candidate = jump(k.vance, k.wren, { severity: 80 });
    if (candidate.reactions.some((r) => r.wrestlerId === k.croft
      && r.kind === REACTION_KINDS.STOOD_BY)) incident = candidate;
  }
  if (!incident) return 'he moved every time, which a courage of 25 makes unlikely but allows';

  const letDown = store.getWrestler(k.wren);
  assert(letDown.memory.some((m) => m.type === MEMORY_TYPES.STOOD_BY.key
    && m.aboutIds.includes(k.croft)), 'standing there was not remembered');
  assert(letDown.ties.relationships[k.croft].trust < 80,
    `trust should have fallen, is ${letDown.ties.relationships[k.croft].trust}`);
  const mem = letDown.memory.find((m) => m.type === MEMORY_TYPES.STOOD_BY.key);
  assert(mem.scar, 'watching a friend get jumped should scar');
  return mem.summary;
});

check('somebody with no real reason to help is not a story', () => {
  fresh('bystander');
  // Two strangers, and a third with nothing to do with either of them.
  gather([k.mabry, k.kovac, k.bloom]);
  const incident = jump(k.mabry, k.kovac, { severity: 40 });
  const bloom = incident.reactions.find((r) => r.wrestlerId === k.bloom);
  if (bloom) {
    assert(bloom.score >= STOOD_BY_FLOOR || bloom.kind !== REACTION_KINDS.STOOD_BY,
      `a passing acquaintance was recorded as standing by at pull ${bloom.score}`);
  }
  return `below ${STOOD_BY_FLOOR} pull, nothing is written down`;
});

// --- piling in ------------------------------------------------------------

check('a stablemate piles in and makes it worse', () => {
  fresh('faction-join');
  gather([k.croft, k.vance, k.wren, k.delacroix]);
  let joined = null;
  for (let i = 0; i < 40 && !joined; i++) {
    settleAll();
    const incident = jump(k.croft, k.vance, { severity: 55 });
    joined = incident.reactions.find((r) => r.kind === REACTION_KINDS.JOIN && r.tick != null);
  }
  assert(joined, 'no stablemate ever piled in');

  const incident = store.getIncident(joined.incidentId);
  assert(incident.participantIds.includes(joined.wrestlerId), 'a joiner should be in it');
  assert(joined.reasons.some((r) => r.motive === MOTIVES.FACTION), 'not for the stable');
  const escalated = store.queryLog({ type: EVENT_TYPES.INCIDENT_ESCALATED, newestFirst: true, limit: 1 })[0];
  assert(escalated, 'piling in did not escalate anything');
  assert(escalated.data.to > escalated.data.from,
    `severity went ${escalated.data.from} -> ${escalated.data.to}`);
  return `${store.nameOf(joined.wrestlerId)} in for ${store.nameOf(joined.forId)}, `
    + `severity ${escalated.data.from} -> ${escalated.data.to}`;
});

check('a friend piling in against you is a betrayal, not a row', () => {
  fresh('betrayal');
  // Bloom is close to Kovac, and runs with nobody - so make her back a stablemate
  // of the other side instead. Delacroix is in the Syndicate with Croft.
  bond(k.delacroix, k.vance, 70);
  gather([k.croft, k.vance, k.delacroix]);

  let betrayal = null;
  for (let i = 0; i < 60 && !betrayal; i++) {
    settleAll();
    const incident = jump(k.croft, k.vance, { severity: 60 });
    const join = incident.reactions.find((r) => r.kind === REACTION_KINDS.JOIN
      && r.tick != null && r.forId === k.croft);
    if (join && store.getWrestler(k.vance).memory.some((m) => m.type === MEMORY_TYPES.BETRAYAL.key)) {
      betrayal = join;
    }
  }
  if (!betrayal) return 'the stable never chose itself over the friendship, which is allowed';

  const vance = store.getWrestler(k.vance);
  const rel = vance.ties.relationships[k.delacroix];
  assert(rel.affinity < 40, `affinity should have collapsed, is ${rel.affinity}`);
  const mem = vance.memory.find((m) => m.type === MEMORY_TYPES.BETRAYAL.key);
  assert(mem.scar, 'a betrayal should scar');
  return mem.summary;
});

// --- delayed --------------------------------------------------------------

check('somebody elsewhere in the building hears and comes', () => {
  fresh('late');
  bond(k.sparrow, k.vance, 95);
  gather([k.croft, k.vance], 'locker_room');
  store.placeWrestler(k.sparrow, 'parking');   // two doors away

  let late = null;
  for (let i = 0; i < 40 && !late; i++) {
    settleAll();
    const incident = jump(k.croft, k.vance, { severity: 55 });
    late = incident.reactions.find((r) => r.wrestlerId === k.sparrow);
  }
  assert(late, `${store.nameOf(k.sparrow)} never came`);
  assert(late.dueTick > late.raisedTick,
    'somebody two rooms away arrived instantly');
  eq(late.tick, null, 'they should not have acted yet');
  assert(late.score >= LATE_FLOOR, `crossing the building at pull ${late.score}`);
  assert(late.reasons.some((r) => /heard about it/i.test(r.label || '')), 'no reason for the delay');

  // And when the night moves on, they arrive.
  store.advanceTick(late.dueTick - store.tick());
  const done = flushDue();
  assert(done.some((d) => d.reaction.id === late.id), 'they never turned up');
  assert(store.findReaction(late.id).tick != null, 'the reaction was not committed');
  return `arrived ${late.dueTick - late.raisedTick}s later from Parking`;
});

check('getting there after it is over is its own answer', () => {
  fresh('too-late');
  bond(k.sparrow, k.vance, 95);
  gather([k.croft, k.vance], 'locker_room');
  store.placeWrestler(k.sparrow, 'parking');

  let late = null; let incident = null;
  for (let i = 0; i < 40 && !late; i++) {
    settleAll();
    incident = jump(k.croft, k.vance, { severity: 55 });
    late = incident.reactions.find((r) => r.wrestlerId === k.sparrow && r.dueTick > r.raisedTick);
  }
  assert(late, 'nobody was on their way');

  // Security gets there first.
  store.discoverIncident(incident.id);
  respond(incident.id, RESPONSES.SECURITY);
  store.advanceTick(late.dueTick - store.tick() + 10);
  const done = flushDue();

  assert(!done.some((d) => d.reaction.id === late.id), 'they swung at a fight that was over');
  assert(store.findReaction(late.id).tick != null, 'the reaction should still be closed off');
  eq(store.pendingReactions().some((r) => r.id === late.id), false, 'it should be off the queue');
  return 'arrived to find it already broken up';
});

check('the night ending spends whatever anybody was saving up', () => {
  fresh('night-end');
  const show = runner.currentShow();
  const free = booking.availableFor(show.id).map((w) => w.id);
  for (let i = 0; i + 1 < free.length && i < 6; i += 2) {
    store.bookSegment({
      showId: show.id, format: 'singles', kind: 'match',
      name: `${store.nameOf(free[i])} vs ${store.nameOf(free[i + 1])}`,
      timeLimitSec: 12 * 60,
      participants: [{ wrestlerId: free[i], side: 'a' }, { wrestlerId: free[i + 1], side: 'b' }],
    });
  }
  runner.goLive(show.id);
  bond(k.sparrow, k.vance, 95);
  gather([k.croft, k.vance], 'locker_room');
  store.placeWrestler(k.sparrow, 'parking');
  jump(k.croft, k.vance, { severity: 55 });

  runCard(store, runner, show.id);
  runner.goOffAir(show.id);
  eq(store.pendingReactions().length, 0, 'somebody is still queued after the show ended');
  return 'nothing carries over to next week';
});

// --- the whole thing over a season ---------------------------------------

check('the room reacts often enough to matter and not so often it is a riot', () => {
  const kinds = {}; const motives = {}; const depths = {};
  let shows = 0; let incidents = 0; let reactions = 0; let delayed = 0;

  for (const seed of ['r1', 'r2', 'r3', 'r4', 'r5']) {
    fresh(seed);
    for (let week = 0; week < 8; week++) {
      const show = runner.currentShow();
      const free = booking.availableFor(show.id).map((w) => w.id);
      for (let i = 0; i + 1 < free.length && i < 8; i += 2) {
        store.bookSegment({
          showId: show.id, format: 'singles', kind: 'match',
          name: `${store.nameOf(free[i])} vs ${store.nameOf(free[i + 1])}`,
          timeLimitSec: 12 * 60,
          participants: [{ wrestlerId: free[i], side: 'a' }, { wrestlerId: free[i + 1], side: 'b' }],
        });
      }
      runner.goLive(show.id);
      runCard(store, runner, show.id);
      runner.goOffAir(show.id);
      shows++;
      if (!runner.nextWeek()) { store.scheduleProgramming(1); runner.nextWeek(); }
    }
    for (const i of store.allIncidents()) {
      incidents++;
      depths[i.chainDepth] = (depths[i.chainDepth] || 0) + 1;
      for (const r of i.reactions) {
        reactions++;
        kinds[r.kind] = (kinds[r.kind] || 0) + 1;
        if (r.dueTick > r.raisedTick) delayed++;
        for (const reason of r.reasons) {
          if (reason.motive) motives[reason.motive] = (motives[reason.motive] || 0) + 1;
        }
      }
    }
  }

  const perShow = reactions / shows;
  assert(perShow > 0.5 && perShow < 4,
    `${perShow.toFixed(2)} reactions a show is not a locker room`);
  assert(Object.keys(kinds).length >= 4,
    `only ${Object.keys(kinds).length} of ${REACTION_KEYS.length} reaction kinds ever happened`);
  assert(Object.keys(motives).length >= 4,
    `only ${Object.keys(motives).length} motives ever fired: ${Object.keys(motives).join(', ')}`);
  assert(delayed > 0, 'nothing was ever delayed');
  assert((depths[1] || 0) > 0, 'nothing ever chained');
  assert(!Object.keys(depths).some((d) => Number(d) >= MAX_CHAIN_DEPTH), 'a chain ran past the cap');

  return `${perShow.toFixed(2)}/show over ${shows} shows, ${delayed} delayed, `
    + `depths ${JSON.stringify(depths)}, `
    + Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([x, n]) => `${x} ${n}`).join(' ');
});

check('the locker room does not quietly drift apart', () => {
  // The failure this guards against: every bystander accruing a grudge against
  // every other bystander until the whole roster hates each other for reasons
  // nobody could name.
  let n = 0; let sum = 0; let cold = 0;
  for (const w of store.allWrestlers()) {
    for (const rel of Object.values(w.ties.relationships)) {
      n++; sum += rel.affinity;
      if (rel.affinity < -25) cold++;
    }
  }
  if (!n) return 'nobody formed an opinion, which is its own problem for another day';
  const mean = sum / n;
  assert(mean > -25, `mean affinity across the room is ${mean.toFixed(1)}`);
  assert(cold / n < 0.5, `${Math.round((cold / n) * 100)}% of the room actively dislikes each other`);
  return `${n} opinions, mean affinity ${mean.toFixed(1)}, ${cold} of them cold`;
});

// --- persistence ----------------------------------------------------------

check('factions and reactions survive a save and a load', () => {
  const before = store.allIncidents()
    .map((i) => `${i.id}:${i.chainDepth}:${i.causeIncidentId || '-'}:${i.reactions.map((r) => `${r.kind}/${r.wrestlerId}/${r.tick}`).join('|')}`)
    .join(';');
  const factionsBefore = store.allFactions().map((f) => `${f.id}:${f.memberIds.join(',')}`).join(';');

  const json = persist.toJSON({ label: 'reactions' });
  store.reset();
  persist.fromJSON(json);

  const after = store.allIncidents()
    .map((i) => `${i.id}:${i.chainDepth}:${i.causeIncidentId || '-'}:${i.reactions.map((r) => `${r.kind}/${r.wrestlerId}/${r.tick}`).join('|')}`)
    .join(';');
  eq(after, before, 'reactions differ after reload');
  eq(store.allFactions().map((f) => `${f.id}:${f.memberIds.join(',')}`).join(';'), factionsBefore,
    'factions differ after reload');
  return `${store.allFactions().length} factions, `
    + `${store.allIncidents().reduce((t, i) => t + i.reactions.length, 0)} reactions restored`;
});

check('a save from before any of this loads clean', () => {
  const envelope = JSON.parse(persist.toJSON({ label: 'v8' }));
  envelope.schemaVersion = 8;
  envelope.state.meta.schemaVersion = 8;
  delete envelope.state.factions;
  delete envelope.state.pendingReactions;
  for (const w of Object.values(envelope.state.wrestlers)) delete w.identity.alignment;
  for (const inc of Object.values(envelope.state.incidents)) {
    delete inc.reactions; delete inc.causeIncidentId; delete inc.chainDepth;
  }
  store.reset();
  persist.deserialize(envelope);
  const state = store.getState();

  eq(state.meta.schemaVersion, SCHEMA_VERSION, 'schema after migration');
  eq(Object.keys(state.factions).length, 0, 'a v8 save has no factions');
  eq(state.pendingReactions.length, 0, 'nothing should be queued');
  for (const w of Object.values(state.wrestlers)) {
    eq(w.identity.alignment, ALIGNMENT.TWEENER, `${w.id} should default to tweener, not be guessed at`);
  }
  for (const inc of Object.values(state.incidents)) {
    eq(inc.reactions.length, 0, `${inc.id} invented reactions`);
    eq(inc.chainDepth, 0, `${inc.id} invented a depth`);
  }
  const problems = checkState(state);
  assert(!problems.length, `migrated state is not sound:\n      - ${problems.join('\n      - ')}`);
  return `v8 -> v${SCHEMA_VERSION}: ${Object.keys(state.wrestlers).length} wrestlers made tweeners`;
});

check('the invariants refuse a reaction to something you are in', () => {
  fresh('invariants');
  gather([k.croft, k.vance, k.sparrow]);
  const incident = jump(k.croft, k.vance);
  const state = store.getState();
  state.incidents[incident.id].reactions.push({
    id: 'rx_9999', incidentId: incident.id, wrestlerId: k.croft,
    kind: REACTION_KINDS.SAVE, forId: k.vance, againstId: null,
    score: 50, nerve: 50, reasons: [], raisedTick: 0, dueTick: 0, tick: 0,
    spawnedIncidentId: null,
  });
  const problems = checkState(state);
  assert(problems.some((p) => /reacting to something they are in/.test(p)),
    `expected a complaint, got:\n      - ${problems.join('\n      - ')}`);
  state.incidents[incident.id].reactions.pop();
  eq(checkState(state).length, 0, 'putting it back should settle it');
  return problems.find((p) => /reacting to something they are in/.test(p));
});

check('the invariants refuse a chain that does not add up', () => {
  const state = store.getState();
  const [a] = Object.values(state.incidents);
  a.chainDepth = 2;
  const problems = checkState(state);
  assert(problems.some((p) => /no cause but sits at depth/.test(p)),
    `expected a complaint, got:\n      - ${problems.join('\n      - ')}`);
  a.chainDepth = 0;

  a.causeIncidentId = 'inc_9999';
  const dangling = checkState(state);
  assert(dangling.some((p) => /chain/.test(p)), 'a dangling parent was accepted');
  a.causeIncidentId = null;
  eq(checkState(state).length, 0, 'putting it back should settle it');
  return problems.find((p) => /no cause but sits at depth/.test(p));
});

check('the invariants refuse somebody in two stables', () => {
  const state = store.getState();
  state.factions.tm_9999 = {
    id: 'tm_9999', name: 'Overlap', shortName: 'Overlap',
    memberIds: [k.croft, k.bloom], leaderId: k.croft,
    formedOnDay: 0, disbandedOnDay: null,
  };
  const problems = checkState(state);
  assert(problems.some((p) => /more than one faction/.test(p)),
    `expected a complaint, got:\n      - ${problems.join('\n      - ')}`);
  delete state.factions.tm_9999;
  eq(checkState(state).length, 0, 'putting it back should settle it');
  return problems.find((p) => /more than one faction/.test(p));
});

check('the state is sound after a season of it', () => {
  const problems = checkState(store.getState());
  assert(!problems.length, `not sound:\n      - ${problems.join('\n      - ')}`);
  return 'no problems';
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) { for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
