// Headless integrity check for the wrestling GM foundation.
//
// The core is deliberately DOM-free so this can run under plain node. It proves
// the rules the architecture depends on: one wrestler entity, IDs that resolve
// everywhere, a log that only grows, and a save that restores the world exactly.
//
// Usage: node tools/wgm-check.mjs
import * as store from '../wrestling/js/core/store.js';
import * as persist from '../wrestling/js/core/persist.js';
import * as ids from '../wrestling/js/core/ids.js';
import * as clock from '../wrestling/js/core/clock.js';
import { EVENT_TYPES } from '../wrestling/js/core/events.js';
import { checkState, findDuplicateWrestlers } from '../wrestling/js/core/invariants.js';
import { seedRoster } from '../wrestling/js/data/roster.js';
import { SEGMENT_KINDS, FINISHES } from '../wrestling/js/models/segment.js';
import { relationshipTo, memoryWeightOn } from '../wrestling/js/models/wrestler.js';

let passed = 0;
const failures = [];

function check(label, fn) {
  try {
    const detail = fn();
    passed++;
    console.log(`  ok  ${label}${detail ? `  ${detail}` : ''}`);
  } catch (err) {
    failures.push(`${label}: ${err.message}`);
    console.log(`FAIL  ${label}\n      ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);
}

console.log('\nwrestling GM foundation check\n');

// --- game creation ---------------------------------------------------------
console.log('game and roster');
store.newGame({ seed: 'check-seed', gmName: 'Test GM', brandName: 'Test Brand', scheduleBlocks: 3 });
const keys = seedRoster();

check('roster is created', () => {
  eq(store.allWrestlers().length, 14, 'roster size');
  return '14 wrestlers';
});

check('every wrestler ID is unique and well formed', () => {
  const all = store.allWrestlers().map((w) => w.id);
  eq(new Set(all).size, all.length, 'duplicate wrestler ids');
  for (const id of all) assert(ids.isId(id, 'wrestler'), `${id} is not a wrestler id`);
  return `${keys.croft} .. ${keys.kovac}`;
});

check('IDs are unique across every registry', () => {
  const s = store.getState();
  const all = [
    ...Object.keys(s.wrestlers), ...Object.keys(s.shows),
    ...Object.keys(s.segments), ...s.log.map((e) => e.id),
    ...s.calendar.entries.map((e) => e.id),
  ];
  eq(new Set(all).size, all.length, 'an ID is used twice');
  return `${all.length} ids`;
});

// --- the one-entity rule ---------------------------------------------------
console.log('\nthe single wrestler entity');

check('relationships are directed, not mirrored', () => {
  const wren = store.getWrestler(keys.wren);
  const croft = store.getWrestler(keys.croft);
  eq(relationshipTo(wren, keys.croft), -62, "Wren's view of Croft");
  eq(relationshipTo(croft, keys.wren), 5, "Croft's view of Wren");
  return 'Wren -62 -> Croft, Croft +5 -> Wren';
});

check('a change through one system is visible from every other', () => {
  const id = keys.okonkwo;
  const before = store.getWrestler(id).state.morale;
  store.updateWrestlerState(id, { morale: before - 20 }, { reason: 'left off the card' });
  // Same entity reached three different ways.
  eq(store.getWrestler(id).state.morale, before - 20, 'via getWrestler');
  eq(store.allWrestlers().find((w) => w.id === id).state.morale, before - 20, 'via allWrestlers');
  eq(store.getState().wrestlers[id].state.morale, before - 20, 'via raw state');
  return `morale ${before} -> ${before - 20}`;
});

check('the duplicate-wrestler detector catches a planted copy', () => {
  const s = store.getState();
  eq(findDuplicateWrestlers(s).length, 0, 'clean state should have no duplicates');
  const planted = { ...store.getWrestler(keys.pike) };
  s.segments.__planted = { cachedWrestler: planted };
  const found = findDuplicateWrestlers(s);
  delete s.segments.__planted;
  assert(found.length === 1, `expected 1 duplicate, got ${found.length}`);
  assert(found[0].includes('store the wrestler id instead'), 'unhelpful message');
  return found[0].slice(0, 58) + '...';
});

// --- calendar --------------------------------------------------------------
console.log('\ncalendar');

check('three blocks produce the TV/TV/TV/PLE shape', () => {
  const shows = store.allShows();
  eq(shows.length, 12, 'shows scheduled');
  eq(shows.filter((s) => s.kind === 'tv').length, 9, 'TV shows');
  eq(shows.filter((s) => s.kind === 'ple').length, 3, 'PLEs');
  return '9 TV, 3 PLE over 3 months';
});

check('scheduled days are strictly ascending and dated', () => {
  const cal = store.getState().calendar;
  for (let i = 1; i < cal.entries.length; i++) {
    assert(cal.entries[i].day > cal.entries[i - 1].day, `entry ${i} is not after the previous`);
  }
  const first = cal.entries[0];
  return `first: ${clock.formatDate(cal, first.day)} (${clock.formatGameTime(first.day)})`;
});

check('advancing time fires the entries it passes', () => {
  const seen = [];
  const stop = store.on(EVENT_TYPES.CALENDAR_DUE, (e) => seen.push(e.data.entryId));
  store.advanceToNextShow();
  stop();
  eq(seen.length, 1, 'due events');
  return `day ${store.today()}, ${seen[0]} is due`;
});

// --- booking ---------------------------------------------------------------
console.log('\nshows, segments and time limits');

const firstShow = store.allShows()[0];
let mainEvent;

check('a segment holds participant IDs, never wrestler objects', () => {
  mainEvent = store.bookSegment({
    showId: firstShow.id,
    kind: SEGMENT_KINDS.MATCH,
    name: 'Wren vs Croft',
    timeLimitSec: 15 * 60,
    participants: [
      { wrestlerId: keys.wren, side: 'a' },
      { wrestlerId: keys.croft, side: 'b' },
    ],
  });
  for (const p of mainEvent.participants) {
    assert(typeof p.wrestlerId === 'string', 'participant is not an ID');
    assert(ids.isId(p.wrestlerId, 'wrestler'), 'participant is not a wrestler ID');
  }
  eq(findDuplicateWrestlers(store.getState()).length, 0, 'booking duplicated a wrestler');
  return `${mainEvent.id} -> ${mainEvent.participants.map((p) => p.wrestlerId).join(' vs ')}`;
});

check('the show tracks booked time against its budget', () => {
  store.bookSegment({
    showId: firstShow.id, kind: SEGMENT_KINDS.PROMO, name: 'Opening promo',
    timeLimitSec: 6 * 60, participants: [{ wrestlerId: keys.vance, side: 'a' }],
  });
  const show = store.getShow(firstShow.id);
  eq(show.result.bookedSec, 21 * 60, 'booked seconds');
  eq(show.timeBudgetSec - show.result.bookedSec, 39 * 60, 'remaining budget');
  return `booked 21:00 of ${show.timeBudgetSec / 60}:00`;
});

check('a match records what it actually ran, separate from its limit', () => {
  store.startShow(firstShow.id);
  store.completeSegment(mainEvent.id, {
    finish: FINISHES.PINFALL,
    winnerIds: [keys.wren],
    loserIds: [keys.croft],
    actualSec: 142,
  });
  const seg = store.getSegment(mainEvent.id);
  eq(seg.timeLimitSec, 900, 'assigned limit');
  eq(seg.result.actualSec, 142, 'actual runtime');
  return 'limit 15:00, ran 2:22, 12:38 of television to fill';
});

// --- the event log ---------------------------------------------------------
console.log('\nevent log');

check('the log is append-only and sequential', () => {
  const log = store.getState().log;
  log.forEach((e, i) => eq(e.seq, i + 1, `log[${i}] sequence`));
  return `${log.length} events`;
});

check('one wrestler\'s whole history is a single lookup', () => {
  const history = store.historyOf(keys.croft);
  assert(history.length >= 3, `expected several events for Croft, got ${history.length}`);
  const types = new Set(history.map((e) => e.type));
  assert(types.has(EVENT_TYPES.WRESTLER_CREATED), 'missing creation');
  assert(types.has(EVENT_TYPES.SEGMENT_BOOKED), 'missing booking');
  assert(types.has(EVENT_TYPES.SEGMENT_COMPLETED), 'missing result');
  return `${history.length} events touching ${keys.croft}`;
});

check('consequences chain back to their cause', () => {
  const advanced = store.queryLog({ type: EVENT_TYPES.CALENDAR_ADVANCED }).pop();
  const due = store.queryLog({ type: EVENT_TYPES.CALENDAR_DUE }).pop();
  eq(due.causeId, advanced.id, 'due event cause');
  const chain = store.causeChain(due.id);
  assert(chain.length >= 2, 'cause chain too short');
  return chain.map((e) => e.type).join(' <- ');
});

check('a listener can react to an action and emit its own event', () => {
  const stop = store.on(EVENT_TYPES.SEGMENT_COMPLETED, (e) => {
    for (const id of e.data.loserIds) {
      store.addMemory(id, {
        type: 'loss', summary: `Lost on ${store.getShow(e.showId).name}`,
        aboutIds: e.data.winnerIds, weight: 40,
      }, { cause: e.id });
    }
  });
  const before = store.getWrestler(keys.mabry).memory.length;
  const seg = store.bookSegment({
    showId: firstShow.id, kind: SEGMENT_KINDS.MATCH, name: 'Kane vs Mabry',
    timeLimitSec: 8 * 60,
    participants: [{ wrestlerId: keys.kane, side: 'a' }, { wrestlerId: keys.mabry, side: 'b' }],
  });
  store.completeSegment(seg.id, {
    finish: FINISHES.PINFALL, winnerIds: [keys.kane], loserIds: [keys.mabry], actualSec: 380,
  });
  stop();
  eq(store.getWrestler(keys.mabry).memory.length, before + 1, 'memory was not added by the listener');
  return 'segment.completed -> wrestler.memory.added';
});

check('unregistered event types are rejected', () => {
  let threw = false;
  try { store.emit('some.made.up.type', {}); } catch { threw = true; }
  assert(threw, 'an unregistered event type was accepted');
  return 'EVENT_TYPES is the only vocabulary';
});

// --- memory ----------------------------------------------------------------
console.log('\nmemory');

check('memory decays toward a floor, and scars hold', () => {
  const wren = store.getWrestler(keys.wren);
  const scar = wren.memory.find((m) => m.scar);
  const ordinary = wren.memory.find((m) => !m.scar);
  const far = 4000;
  eq(memoryWeightOn(scar, scar.day), 85, 'scar today');
  eq(memoryWeightOn(scar, scar.day + far), scar.floor, 'scar after years');
  assert(memoryWeightOn(scar, scar.day + far) > memoryWeightOn(ordinary, ordinary.day + far),
    'a scar should outlast an ordinary memory');
  return `scar settles at ${scar.floor}, ordinary at ${ordinary.floor}`;
});

// --- integrity -------------------------------------------------------------
console.log('\nintegrity');

check('the live state passes every invariant', () => {
  const problems = checkState(store.getState());
  assert(problems.length === 0, `\n      - ${problems.join('\n      - ')}`);
  return 'no dangling refs, no duplicates, log sound';
});

check('a dangling reference is caught', () => {
  const s = store.getState();
  const seg = s.segments[mainEvent.id];
  seg.participants.push({ wrestlerId: 'w_9999', side: 'b', role: 'competitor' });
  const problems = checkState(s);
  seg.participants.pop();
  assert(problems.some((p) => p.includes('w_9999')), 'missing wrestler was not reported');
  return 'points at missing wrestler "w_9999"';
});

// --- save and load ---------------------------------------------------------
console.log('\nsave and load');

const beforeJSON = persist.toJSON({ label: 'check' });
const beforeState = JSON.parse(JSON.stringify(store.getState()));
const beforeRng = store.getRng().getState();
const nextIdBefore = ids.peek('wrestler');

check('a save round-trips to an identical world', () => {
  store.reset();
  persist.fromJSON(beforeJSON);
  const after = store.getState();
  // The load itself appends a game.loaded event, so compare everything before it.
  const trimmed = { ...after, log: after.log.slice(0, beforeState.log.length) };
  eq(JSON.stringify(trimmed), JSON.stringify(beforeState), 'state differs after reload');
  return `${after.log.length - beforeState.log.length} event appended by the load itself`;
});

check('ID counters survive, so a reload cannot mint a collision', () => {
  eq(ids.peek('wrestler'), nextIdBefore, 'next wrestler id');
  const fresh = store.addWrestler({ name: 'Post Load Signing' });
  assert(!beforeState.wrestlers[fresh.id], `${fresh.id} collided with an existing wrestler`);
  return `next id after reload is ${fresh.id}`;
});

check('the RNG resumes exactly where it stopped', () => {
  store.reset();
  persist.fromJSON(beforeJSON);
  const resumed = store.getRng().getState();
  eq(JSON.stringify(resumed), JSON.stringify(beforeRng), 'rng state differs');
  const a = store.getRng().float();
  store.reset();
  persist.fromJSON(beforeJSON);
  const b = store.getRng().float();
  eq(a, b, 'two loads of one save produced different rolls');
  return `both loads rolled ${a.toFixed(6)}`;
});

check('a corrupted save is refused rather than half-loaded', () => {
  const broken = JSON.parse(beforeJSON);
  broken.state.segments[mainEvent.id].participants[0].wrestlerId = 'w_4242';
  let threw = '';
  try { persist.fromJSON(JSON.stringify(broken)); } catch (err) { threw = err.message; }
  assert(threw.includes('integrity'), `expected an integrity refusal, got: ${threw || 'no error'}`);
  return 'load refused, existing game untouched';
});

check('a save from a newer build is refused', () => {
  const future = JSON.parse(beforeJSON);
  future.schemaVersion = 99;
  let threw = '';
  try { persist.fromJSON(JSON.stringify(future)); } catch (err) { threw = err.message; }
  assert(threw.includes('newer version'), `expected a version refusal, got: ${threw || 'no error'}`);
  return 'refuses v99 against this build';
});

check('slot save and load work through the storage adapter', () => {
  store.reset();
  persist.fromJSON(beforeJSON);
  const saved = persist.save('slot1', { label: 'Check slot' });
  assert(saved.ok, `save failed: ${saved.error}`);
  const list = persist.listSaves();
  assert(list.some((s) => s.slot === 'slot1'), 'slot missing from index');
  store.reset();
  const loaded = persist.load('slot1');
  assert(loaded.ok, `load failed: ${loaded.error}`);
  eq(store.allWrestlers().length, 14, 'roster after slot load');
  return `slot1: ${list[0].summary.rosterSize} wrestlers, day ${list[0].summary.day}`;
});

// --- report ----------------------------------------------------------------
console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
