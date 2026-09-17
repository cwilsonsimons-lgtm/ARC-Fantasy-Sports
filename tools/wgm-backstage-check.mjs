// Tier 7 checks: the building, where everybody is standing, and how news finds
// the GM - late, second hand, or not at all.
//
// Usage: node tools/wgm-backstage-check.mjs
import * as store from '../wrestling/js/core/store.js';
import * as persist from '../wrestling/js/core/persist.js';
import { SCHEMA_VERSION, NOTIFICATION_LIMIT } from '../wrestling/js/core/store.js';
import * as runner from '../wrestling/js/systems/showRunner.js';
import { installSystems } from '../wrestling/js/systems/index.js';
import { seedRoster } from '../wrestling/js/data/roster.js';
import { seedTitles } from '../wrestling/js/data/titles.js';
import { checkState } from '../wrestling/js/core/invariants.js';
import { EVENT_TYPES, VISIBILITY } from '../wrestling/js/core/events.js';
import {
  LOCATIONS, LOCATION_IDS, NEIGHBOURS, SECONDS_PER_HOP,
  hops, travelSeconds, route, isLocation, isOnAir, locationName, locationShort,
} from '../wrestling/js/models/location.js';
import {
  RELIABILITY, RELIABILITY_LABEL, RELIABILITY_SCORE,
  confidenceOf, lateness, validateNotification,
} from '../wrestling/js/models/notification.js';
import {
  report, willingnessToTell, bestTeller, TELL_THRESHOLD,
  BASE_DELAY_SEC, DELAY_PER_HOP_SEC, MAX_AWARENESS_CUT, awareness,
} from '../wrestling/js/systems/notifications.js';
import { openDoors } from '../wrestling/js/systems/backstage.js';
import { HEALTH } from '../wrestling/js/models/wrestler.js';

let passed = 0; const failures = [];
const check = (label, fn) => {
  try { const d = fn(); passed++; console.log(`  ok  ${label}${d ? `  ${d}` : ''}`); }
  catch (e) { failures.push(`${label}: ${e.message}`); console.log(`FAIL  ${label}\n      ${e.message}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`); };
const throws = (fn, m) => {
  try { fn(); } catch { return; }
  throw new Error(m);
};

installSystems();
store.newGame({ seed: 'backstage', gmName: 'B', brandName: 'Friday Night', scheduleBlocks: 2 });
const k = seedRoster();
seedTitles(store);

function bookCard(show, pairs) {
  for (const [a, b, min] of pairs) {
    store.bookSegment({
      showId: show.id, format: 'singles', kind: 'match',
      name: `${store.nameOf(a)} vs ${store.nameOf(b)}`, timeLimitSec: min * 60,
      participants: [{ wrestlerId: a, side: 'a' }, { wrestlerId: b, side: 'b' }],
    });
  }
}

console.log('\nTier 7: the building\n');

// --- the graph ------------------------------------------------------------

check('nine rooms, each with a name, a short name and a blurb', () => {
  eq(LOCATION_IDS.length, 9, 'room count');
  for (const id of LOCATION_IDS) {
    assert(LOCATIONS[id].name, `${id} has no name`);
    assert(locationShort(id), `${id} has no short name`);
    assert(LOCATIONS[id].blurb, `${id} has no blurb`);
    eq(LOCATIONS[id].id, id, `${id} disagrees with its own key`);
  }
  return LOCATION_IDS.map(locationShort).join(', ');
});

check('every room reaches every other room', () => {
  for (const a of LOCATION_IDS) {
    for (const b of LOCATION_IDS) {
      assert(Number.isFinite(hops(a, b)), `${a} cannot reach ${b}`);
    }
  }
  const worst = LOCATION_IDS.flatMap((a) => LOCATION_IDS.map((b) => hops(a, b)));
  return `longest walk is ${Math.max(...worst)} doors`;
});

check('the hallway is the hub', () => {
  assert(LOCATIONS.hallway.hub, 'the hallway does not claim to be the hub');
  eq(NEIGHBOURS.hallway.length, 8, 'hallway neighbours');
  for (const id of LOCATION_IDS) {
    if (id === 'hallway') continue;
    assert(NEIGHBOURS[id].includes('hallway'), `${id} does not open onto the hallway`);
  }
  return 'every room opens onto it';
});

check('distance is symmetric and zero to yourself', () => {
  for (const a of LOCATION_IDS) {
    eq(hops(a, a), 0, `${a} to itself`);
    for (const b of LOCATION_IDS) eq(hops(a, b), hops(b, a), `${a}<->${b} is not symmetric`);
  }
});

check('an unknown room is unreachable rather than adjacent', () => {
  eq(hops('gorilla', 'car_park'), Infinity, 'hops to nowhere');
  eq(travelSeconds('gorilla', 'car_park'), Infinity, 'seconds to nowhere');
  eq(route('gorilla', 'car_park').length, 0, 'route to nowhere');
  assert(!isLocation('car_park'), 'car_park should not be a room');
});

check('the curtain is two doors from the locker room', () => {
  eq(hops('gorilla', 'locker_room'), 2, 'gorilla to locker room');
  eq(travelSeconds('gorilla', 'locker_room'), 2 * SECONDS_PER_HOP, 'seconds');
  const via = route('gorilla', 'locker_room');
  eq(via.length, 3, 'route length');
  eq(via[0], 'gorilla', 'route starts where you are');
  eq(via[2], 'locker_room', 'route ends where you are going');
  eq(via[1], 'hallway', 'route goes through the hallway');
  return `${via.map(locationName).join(' -> ')} in ${travelSeconds('gorilla', 'locker_room')}s`;
});

check('a route is always one longer than its door count', () => {
  for (const a of LOCATION_IDS) {
    for (const b of LOCATION_IDS) {
      const path = route(a, b);
      eq(path.length, hops(a, b) + 1, `${a} -> ${b}`);
      eq(path[0], a, `${a} -> ${b} starts wrong`);
      eq(path[path.length - 1], b, `${a} -> ${b} ends wrong`);
    }
  }
});

check('the show can only be run from the curtain or the truck', () => {
  const onAir = LOCATION_IDS.filter(isOnAir);
  eq(onAir.join(','), 'gorilla,production', 'on-air rooms');
  return onAir.map(locationName).join(' and ');
});

// --- who is standing where ------------------------------------------------

check('everybody exists somewhere the moment they are signed', () => {
  const roster = store.allWrestlers();
  for (const w of roster) {
    assert(isLocation(store.locationOf(w.id)), `${w.name} is nowhere`);
  }
  const counted = LOCATION_IDS.reduce((t, id) => t + store.whoIsIn(id).length, 0);
  eq(counted, roster.length, 'the rooms should partition the roster exactly once');
  return `${roster.length} placed, none twice`;
});

check('the GM starts at their own desk with the clock at zero', () => {
  eq(store.gmLocation(), 'gm_office', 'starting room');
  eq(store.tick(), 0, 'starting clock');
});

check('placing somewhere that is not a room is refused', () => {
  throws(() => store.placeWrestler(k.croft, 'ringside'), 'an unknown room was accepted');
  throws(() => store.moveGm('ringside'), 'the GM walked somewhere that does not exist');
});

check('placing people is quiet by default and loud on request', () => {
  const before = store.queryLog({ type: EVENT_TYPES.WRESTLER_MOVED }).length;
  store.placeWrestler(k.pike, 'catering');
  eq(store.queryLog({ type: EVENT_TYPES.WRESTLER_MOVED }).length, before,
    'a silent move should log nothing');
  store.placeWrestler(k.pike, 'medical', { silent: false, reason: 'Pike limps to Medical' });
  const after = store.queryLog({ type: EVENT_TYPES.WRESTLER_MOVED, newestFirst: true, limit: 1 });
  eq(after.length, 1, 'a loud move should log');
  eq(after[0].locationId, 'medical', 'the event should know the room');
  eq(after[0].visibility, VISIBILITY.BACKSTAGE, 'moving about is a backstage thing');
  return after[0].summary;
});

// --- walking --------------------------------------------------------------

check('walking costs exactly its distance in time', () => {
  store.placeWrestler(k.pike, 'locker_room');
  const before = store.tick();
  const walk = store.moveGm('production');
  eq(walk.from, 'gm_office', 'walked from');
  eq(walk.to, 'production', 'walked to');
  eq(walk.seconds, travelSeconds('gm_office', 'production'), 'walk cost');
  eq(store.tick(), before + walk.seconds, 'the clock should move with you');
  eq(walk.via.join(' '), 'gm_office hallway production', 'route taken');
  return `${walk.seconds}s via ${walk.via.map(locationName).join(' -> ')}`;
});

check('walking logs where you went and how you got there', () => {
  const moved = store.queryLog({ type: EVENT_TYPES.GM_MOVED, newestFirst: true, limit: 1 })[0];
  assert(moved, 'the walk was not logged');
  eq(moved.data.to, 'production', 'logged destination');
  eq(moved.data.seconds, travelSeconds('gm_office', 'production'), 'logged cost');
  assert(Array.isArray(moved.data.via) && moved.data.via.length === 3, 'logged route');
});

check('walking to the room you are already in is free and silent', () => {
  const before = store.tick();
  const logged = store.queryLog({ type: EVENT_TYPES.GM_MOVED }).length;
  const walk = store.moveGm('production');
  eq(walk.seconds, 0, 'standing still should cost nothing');
  eq(store.tick(), before, 'the clock should not move');
  eq(store.queryLog({ type: EVENT_TYPES.GM_MOVED }).length, logged, 'nothing to log');
});

// --- the four questions ---------------------------------------------------

check('something in your own room, you see yourself', () => {
  store.moveGm('catering');
  const before = store.deliveredNotifications().length;
  const event = store.emit(EVENT_TYPES.WRESTLER_RELATION, {
    summary: 'A row in catering',
    newsSummary: 'there was a row in catering',
    subjects: [k.kane],
    locationId: 'catering',
    visibility: VISIBILITY.BACKSTAGE,
  });
  const landed = store.deliveredNotifications();
  eq(landed.length, before + 1, 'being in the room should tell you at once');
  const note = landed[landed.length - 1];
  eq(note.reliability, RELIABILITY.WITNESSED, 'you saw it');
  eq(note.sourceWrestlerId, null, 'nobody had to tell you');
  eq(note.deliveredTick, store.tick(), 'no delay');
  eq(lateness(note), 0, 'no lateness');
  eq(note.eventId, event.id, 'the notification should point back at the event');
  return `${RELIABILITY_LABEL[note.reliability]}, ${confidenceOf(note)}% confidence`;
});

check('something across the building has to travel', () => {
  store.moveGm('gm_office');
  store.placeWrestler(k.bloom, 'parking');
  const pendingBefore = store.pendingNotifications().length;
  store.emit(EVENT_TYPES.WRESTLER_RELATION, {
    summary: 'Words in the loading bay',
    newsSummary: 'there were words in the loading bay',
    subjects: [k.bloom],
    locationId: 'parking',
    visibility: VISIBILITY.BACKSTAGE,
  });
  const pending = store.pendingNotifications();
  eq(pending.length, pendingBefore + 1, 'the news should be in transit, not in hand');
  const note = pending[pending.length - 1];
  assert(note.dueTick > store.tick(), 'news should not arrive before you could hear it');
  eq(note.sourceWrestlerId, k.bloom, 'somebody has to be the one telling you');
  assert(note.reliability !== RELIABILITY.WITNESSED, 'you were not there');
  return `${note.dueTick - store.tick()}s away, ${RELIABILITY_LABEL[note.reliability]}`;
});

check('the further away it happens, the longer it takes to reach you', () => {
  const delays = [];
  for (const room of ['gm_office', 'hallway', 'parking']) {
    store.moveGm('gm_office');
    store.placeWrestler(k.lund, room);
    const before = store.notifications().length;
    store.emit(EVENT_TYPES.WRESTLER_RELATION, {
      summary: `Something in ${locationName(room)}`,
      newsSummary: `something happened in ${locationName(room)}`,
      subjects: [k.lund], locationId: room, visibility: VISIBILITY.BACKSTAGE,
    });
    const note = store.notifications()[before];
    assert(note, `no notification raised for ${room}`);
    delays.push([room, note.dueTick - note.raisedTick]);
  }
  eq(delays[0][1], 0, 'your own room is immediate');
  assert(delays[1][1] > 0, 'next door should still take a moment');
  assert(delays[2][1] > delays[1][1],
    `two doors (${delays[2][1]}s) should be slower than one (${delays[1][1]}s)`);
  return delays.map(([r, d]) => `${locationShort(r)} ${d}s`).join(', ');
});

check('an empty room keeps its secret', () => {
  store.moveGm('gm_office');
  for (const w of store.allWrestlers()) store.placeWrestler(w.id, 'locker_room');
  const before = store.queryLog({ type: EVENT_TYPES.NEWS_MISSED }).length;
  const pending = store.pendingNotifications().length;
  store.emit(EVENT_TYPES.WRESTLER_RELATION, {
    summary: 'Something in the truck',
    newsSummary: 'something happened in the truck',
    subjects: [], locationId: 'production', visibility: VISIBILITY.BACKSTAGE,
  });
  const missed = store.queryLog({ type: EVENT_TYPES.NEWS_MISSED, newestFirst: true, limit: 1 });
  eq(store.queryLog({ type: EVENT_TYPES.NEWS_MISSED }).length, before + 1, 'it should be logged as missed');
  eq(missed[0].data.reason, 'no_witnesses', 'reason');
  eq(store.pendingNotifications().length, pending, 'nothing should be in transit');
  return missed[0].summary;
});

check('somebody who will not talk to you tells you nothing', () => {
  store.moveGm('gm_office');
  const sulker = store.getWrestler(k.halloran);
  const saved = { trust: sulker.ties.gm.trust, respect: sulker.ties.gm.respect, soc: sulker.identity.traits.sociability };
  sulker.ties.gm.trust = 0;
  sulker.ties.gm.respect = 0;
  sulker.identity.traits.sociability = 0;
  for (const w of store.allWrestlers()) store.placeWrestler(w.id, 'locker_room');
  store.placeWrestler(sulker.id, 'medical');
  assert(willingnessToTell(sulker) < TELL_THRESHOLD,
    `willingness ${willingnessToTell(sulker)} should be below ${TELL_THRESHOLD}`);

  const before = store.queryLog({ type: EVENT_TYPES.NEWS_MISSED }).length;
  store.emit(EVENT_TYPES.WRESTLER_RELATION, {
    summary: 'Something in medical',
    newsSummary: 'something happened in medical',
    subjects: [sulker.id], locationId: 'medical', visibility: VISIBILITY.BACKSTAGE,
  });
  const missed = store.queryLog({ type: EVENT_TYPES.NEWS_MISSED, newestFirst: true, limit: 1 })[0];
  eq(store.queryLog({ type: EVENT_TYPES.NEWS_MISSED }).length, before + 1, 'missed count');
  eq(missed.data.reason, 'nobody_would_tell', 'reason');
  eq(missed.data.closestTeller, sulker.id, 'the closest teller should be named');

  Object.assign(sulker.ties.gm, { trust: saved.trust, respect: saved.respect });
  sulker.identity.traits.sociability = saved.soc;
  return `${sulker.name} kept it to themselves`;
});

check('a public event is not backstage news at all', () => {
  const before = store.notifications().length;
  store.emit(EVENT_TYPES.WRESTLER_RELATION, {
    summary: 'Something that happened on camera',
    subjects: [k.kane], locationId: 'gorilla', visibility: VISIBILITY.PUBLIC,
  });
  eq(store.notifications().length, before, 'public events need no notification');
  eq(report({ visibility: VISIBILITY.PUBLIC, locationId: 'gorilla' }), null, 'report should decline it');
  eq(report({ visibility: VISIBILITY.BACKSTAGE, locationId: null }), null, 'nor should a roomless event');
});

check('being better wired in shortens every delay', () => {
  const measure = () => {
    store.moveGm('gm_office');
    for (const w of store.allWrestlers()) store.placeWrestler(w.id, 'parking');
    const before = store.notifications().length;
    store.emit(EVENT_TYPES.WRESTLER_RELATION, {
      summary: 'Something out back', newsSummary: 'something happened out back',
      subjects: [], locationId: 'parking', visibility: VISIBILITY.BACKSTAGE,
    });
    const note = store.notifications()[before];
    return note ? note.dueTick - note.raisedTick : null;
  };
  eq(awareness(), 0, 'awareness starts at nothing');
  const slow = measure();
  store.setBackstageAwareness(100);
  eq(awareness(), 100, 'awareness after raising it');
  const fast = measure();
  store.setBackstageAwareness(0);
  assert(slow != null && fast != null, 'both probes should have produced news');
  assert(fast < slow, `${fast}s should be quicker than ${slow}s`);
  const expected = Math.round(slow * (1 - MAX_AWARENESS_CUT));
  assert(Math.abs(fast - expected) <= 1, `expected about ${expected}s, got ${fast}s`);
  return `${slow}s -> ${fast}s at full awareness`;
});

check('the delay formula is the one the screen quotes', () => {
  eq(BASE_DELAY_SEC + 2 * DELAY_PER_HOP_SEC, 90 + 220, 'two doors at zero awareness');
  assert(MAX_AWARENESS_CUT > 0 && MAX_AWARENESS_CUT < 1, 'the cut should be a fraction');
});

check('willingness to talk is trust, sociability and respect, nothing else', () => {
  const w = store.getWrestler(k.kane);
  const saved = { t: w.ties.gm.trust, r: w.ties.gm.respect, s: w.identity.traits.sociability };
  w.ties.gm.trust = 100; w.ties.gm.respect = 100; w.identity.traits.sociability = 100;
  eq(willingnessToTell(w), 100, 'everything at full');
  w.ties.gm.trust = 0; w.ties.gm.respect = 0; w.identity.traits.sociability = 0;
  eq(willingnessToTell(w), 0, 'everything at nothing');
  Object.assign(w.ties.gm, { trust: saved.t, respect: saved.r });
  w.identity.traits.sociability = saved.s;
});

check('the best teller in a room is the one most likely to come and find you', () => {
  for (const w of store.allWrestlers()) store.placeWrestler(w.id, 'locker_room');
  const best = bestTeller('locker_room');
  assert(best, 'somebody should be willing');
  const top = store.whoIsIn('locker_room')
    .map((w) => willingnessToTell(w)).sort((a, b) => b - a)[0];
  eq(best.willingness, top, 'the best teller should be the most willing');
  eq(bestTeller('locker_room', { exclude: [best.w.id] }).w.id !== best.w.id, true,
    'excluding somebody should pick somebody else');
  eq(bestTeller('parking'), null, 'an empty room has no teller');
  return `${best.w.name} at ${best.willingness}`;
});

check('news is told as it would be heard, not as it was written down', () => {
  store.moveGm('gm_office');
  for (const w of store.allWrestlers()) store.placeWrestler(w.id, 'catering');
  const before = store.notifications().length;
  store.adjustRelationship(k.croft, k.vance, { hostility: 12 }, { reason: 'Beat Ruby Vance' });
  const note = store.notifications()[before];
  assert(note, 'a soured relationship should be news');
  assert(/Damien Croft/.test(note.summary),
    `a name should keep its capital: "${note.summary}"`);
  assert(!/\bdamien\b/.test(note.summary), `lowercased a name: "${note.summary}"`);
  assert(!/^Beat /.test(note.summary), `told as a log line: "${note.summary}"`);
  return note.summary;
});

check('a hedged line still reads as a sentence', () => {
  store.moveGm('gm_office');
  for (const w of store.allWrestlers()) store.placeWrestler(w.id, 'parking');
  const before = store.notifications().length;
  store.emit(EVENT_TYPES.WRESTLER_RELATION, {
    summary: 'Something out back',
    newsSummary: 'something happened out back',
    subjects: [], locationId: 'parking', visibility: VISIBILITY.BACKSTAGE,
  });
  const note = store.notifications()[before];
  assert(note, 'news should have been raised');
  assert(/something happened out back$/.test(note.summary),
    `an ordinary word should fold into the sentence: "${note.summary}"`);
  return note.summary;
});

check('confidence falls as the news travels', () => {
  const order = [RELIABILITY.WITNESSED, RELIABILITY.FIRSTHAND, RELIABILITY.SECONDHAND, RELIABILITY.RUMOUR];
  for (let i = 1; i < order.length; i++) {
    assert(RELIABILITY_SCORE[order[i]] < RELIABILITY_SCORE[order[i - 1]],
      `${order[i]} should be worth less than ${order[i - 1]}`);
    assert(RELIABILITY_LABEL[order[i]], `${order[i]} has no label`);
  }
  return order.map((r) => `${RELIABILITY_LABEL[r]} ${RELIABILITY_SCORE[r]}%`).join(', ');
});

check('no notification ever claims to have arrived before it happened', () => {
  for (const n of store.notifications()) {
    const problems = validateNotification(n);
    assert(!problems.length, `${n.id}: ${problems.join(', ')}`);
    if (n.deliveredTick != null) {
      assert(n.deliveredTick >= n.raisedTick, `${n.id} was delivered before it happened`);
    }
  }
  return `${store.notifications().length} checked`;
});

// --- reading it -----------------------------------------------------------

check('unread news becomes read, one at a time or all at once', () => {
  store.moveGm('gm_office');
  for (const w of store.allWrestlers()) store.placeWrestler(w.id, 'gm_office');
  store.emit(EVENT_TYPES.WRESTLER_RELATION, {
    summary: 'A word at your desk', newsSummary: 'somebody had a word at your desk',
    subjects: [], locationId: 'gm_office', visibility: VISIBILITY.BACKSTAGE,
  });
  const unread = store.unreadNotifications();
  assert(unread.length >= 1, 'something should be unread');
  store.markNotificationRead(unread[0].id);
  assert(unread[0].read, 'marking one should stick');
  store.markAllNotificationsRead();
  eq(store.unreadNotifications().length, 0, 'marking all should leave nothing unread');
  eq(store.markNotificationRead('nt-nope'), undefined, 'an unknown id should be harmless');
  return `${store.deliveredNotifications().length} delivered, all read`;
});

check('delivery is announced, with how late it was', () => {
  store.moveGm('gm_office');
  for (const w of store.allWrestlers()) store.placeWrestler(w.id, 'parking');
  store.emit(EVENT_TYPES.WRESTLER_RELATION, {
    summary: 'A late word', newsSummary: 'there was a late word out back',
    subjects: [k.bloom], locationId: 'parking', visibility: VISIBILITY.BACKSTAGE,
  });
  const pending = store.pendingNotifications();
  const note = pending[pending.length - 1];
  assert(note, 'something should be in transit');
  store.advanceTick(note.dueTick - store.tick());
  const landed = store.deliverDueNotifications();
  assert(landed.some((n) => n.id === note.id), 'it should have landed');
  const reached = store.queryLog({ type: EVENT_TYPES.NEWS_REACHED_GM, newestFirst: true, limit: 1 })[0];
  eq(reached.data.notificationId, note.id, 'the event should name the notification');
  assert(reached.data.lateBySec > 0, 'it should say how late it was');
  eq(reached.data.reliability, note.reliability, 'and how much to believe it');
  return `${reached.data.lateBySec}s late`;
});

check('the save keeps only so much news', () => {
  const before = store.notifications().length;
  for (let i = 0; i < NOTIFICATION_LIMIT + 20; i++) {
    store.scheduleNotification({
      locationId: 'catering', aboutIds: [], reliability: RELIABILITY.RUMOUR,
      dueTick: store.tick() + 10, summary: `filler ${i}`,
    });
  }
  eq(store.notifications().length, NOTIFICATION_LIMIT,
    `the list should be trimmed back to its cap`);
  assert(store.notifications().some((n) => /^filler /.test(n.summary)),
    'the newest news should be the news that survives');
  return `${before} + ${NOTIFICATION_LIMIT + 20} raised, ${store.notifications().length} kept`;
});

check('a notification with nothing to say is refused', () => {
  throws(() => store.scheduleNotification({ locationId: 'catering', dueTick: 0 }),
    'a notification with no summary was accepted');
});

// --- the building during a show -------------------------------------------

check('the doors open with the roster spread out and the opener at the curtain', () => {
  const show = runner.currentShow();
  bookCard(show, [
    [k.croft, k.vance, 15], [k.wren, k.okonkwo, 14],
    [k.kane, k.pike, 12], [k.sparrow, k.bloom, 13],
  ]);
  const injured = store.getWrestler(k.ruiz);
  injured.state.health.status = HEALTH.INJURED;

  runner.goLive(show.id);
  eq(store.tick(), 0, 'the night should start at zero');
  const opener = store.segmentsOfShow(show.id)[0];
  for (const p of opener.participants) {
    eq(store.locationOf(p.wrestlerId), 'gorilla', `${store.nameOf(p.wrestlerId)} should be at the curtain`);
  }
  eq(store.locationOf(injured.id), 'medical', 'the injured should be in medical');
  const occupied = LOCATION_IDS.filter((id) => store.whoIsIn(id).length);
  assert(occupied.length >= 3, `the building should not clump: ${occupied.length} room(s) in use`);
  injured.state.health.status = HEALTH.HEALTHY;
  return occupied.map((id) => `${locationShort(id)} ${store.whoIsIn(id).length}`).join(', ');
});

check('running a segment moves the night on and the people with it', () => {
  const show = runner.currentShow();
  const before = store.tick();
  const step = runner.runNext(show.id);
  assert(step, 'a segment should have run');
  eq(store.tick(), before + step.result.actualSec, 'the clock should follow the match');
  const next = store.segmentsOfShow(show.id).find((s) => s.status === 'booked');
  for (const p of next.participants) {
    eq(store.locationOf(p.wrestlerId), 'gorilla', `${store.nameOf(p.wrestlerId)} should be up next`);
  }
  for (const p of step.segment.participants) {
    assert(store.locationOf(p.wrestlerId) !== 'gorilla',
      `${store.nameOf(p.wrestlerId)} should have come back through the curtain`);
  }
  return `${Math.round(step.result.actualSec)}s run, clock at ${store.tick()}s`;
});

check('walking during a show lets whatever is waiting catch up with you', () => {
  const show = runner.currentShow();
  store.moveGm('gm_office');
  for (const w of store.allWrestlers()) store.placeWrestler(w.id, 'catering');
  store.emit(EVENT_TYPES.WRESTLER_RELATION, {
    summary: 'A row in catering', newsSummary: 'there was a row in catering',
    subjects: [], locationId: 'catering', visibility: VISIBILITY.BACKSTAGE,
  });
  const note = store.pendingNotifications().slice(-1)[0];
  assert(note, 'something should be in transit');
  // A walk long enough for the news to catch up.
  store.advanceTick(note.dueTick - store.tick());
  store.moveGm('hallway');
  assert(note.deliveredTick != null, 'the news should have found you on arrival');
  runner.runRest(show.id);
  return `caught up after ${note.deliveredTick - note.raisedTick}s`;
});

check('the building empties when the show goes off the air', () => {
  const show = runner.currentShow();
  const before = store.tick();
  runner.goOffAir(show.id);
  assert(store.tick() > before, 'the night should run on past the last match');
  eq(store.whoIsIn('gorilla').length, 0, 'nobody should still be at the curtain');
  const problems = checkState(store.getState());
  assert(!problems.length, `state is not sound:\n      - ${problems.join('\n      - ')}`);
  return `clock at ${store.tick()}s, everybody scattered`;
});

check('a fresh night starts the clock over', () => {
  assert(runner.nextWeek() || (store.scheduleProgramming(1) && runner.nextWeek()),
    'there should be another show');
  const show = runner.currentShow();
  bookCard(show, [[k.croft, k.kane, 12]]);
  runner.goLive(show.id);
  eq(store.tick(), 0, 'a new night is a new clock');
  runner.runRest(show.id);
  runner.goOffAir(show.id);
});

// --- persistence ----------------------------------------------------------

check('the building survives a save and a load', () => {
  store.moveGm('interview_area');
  const places = Object.fromEntries(store.allWrestlers().map((w) => [w.id, store.locationOf(w.id)]));
  const clock = store.tick();
  const notes = store.notifications().length;
  const json = persist.toJSON({ label: 'backstage' });
  store.reset();
  persist.fromJSON(json);
  eq(store.gmLocation(), 'interview_area', 'the GM should be where they were');
  eq(store.tick(), clock, 'the clock should survive');
  eq(store.notifications().length, notes, 'the news should survive');
  for (const [id, where] of Object.entries(places)) {
    eq(store.locationOf(id), where, `${store.nameOf(id)} moved across the save`);
  }
  return `${Object.keys(places).length} people, ${notes} notifications`;
});

check('a save from before the building puts everybody somewhere', () => {
  const envelope = JSON.parse(persist.toJSON({ label: 'old' }));
  envelope.schemaVersion = 6;
  envelope.state.meta.schemaVersion = 6;
  delete envelope.state.backstage;
  delete envelope.state.meta.backstageAwareness;
  for (const e of envelope.state.log) {
    delete e.locationId; delete e.visibility; delete e.tick; delete e.newsSummary;
  }
  store.reset();
  persist.deserialize(envelope);
  const state = store.getState();
  eq(state.meta.schemaVersion, SCHEMA_VERSION, 'schema after migration');
  eq(state.backstage.gmLocation, 'gm_office', 'the GM should be at their desk');
  eq(state.backstage.tick, 0, 'the clock should start over');
  eq(state.meta.backstageAwareness, 0, 'awareness should default to nothing');
  for (const id of Object.keys(state.wrestlers)) {
    assert(isLocation(state.backstage.wrestlers[id]), `${id} is nowhere after migration`);
  }
  for (const e of state.log) {
    assert(e.visibility === 'public', `an old event should read as public, not ${e.visibility}`);
  }
  const problems = checkState(state);
  assert(!problems.length, `migrated state is not sound:\n      - ${problems.join('\n      - ')}`);
  return `v6 -> v${SCHEMA_VERSION}: ${Object.keys(state.wrestlers).length} placed`;
});

check('the invariants insist everybody is standing somewhere', () => {
  const state = store.getState();
  const victim = Object.keys(state.wrestlers)[0];
  const saved = state.backstage.wrestlers[victim];
  delete state.backstage.wrestlers[victim];
  const problems = checkState(state);
  assert(problems.some((p) => /not anywhere|nowhere/i.test(p)),
    `a missing location should be caught, got:\n      - ${problems.join('\n      - ')}`);
  state.backstage.wrestlers[victim] = saved;
  eq(checkState(state).length, 0, 'putting them back should settle it');
  return problems.find((p) => /not anywhere|nowhere/i.test(p));
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) { for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
