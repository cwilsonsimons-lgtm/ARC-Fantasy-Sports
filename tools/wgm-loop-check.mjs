// Tier 1 loop check: Roster -> Booking -> Live Show -> Results -> Next Week.
//
// Runs four weeks of television headlessly and asserts the loop closes: every
// result lands on the record, the clock diverges from the plan, condition falls
// and recovers, and a save taken mid-show resumes mid-show.
//
// Usage: node tools/wgm-loop-check.mjs
import * as store from '../wrestling/js/core/store.js';
import { SCHEMA_VERSION } from '../wrestling/js/core/store.js';
import * as persist from '../wrestling/js/core/persist.js';
import * as runner from '../wrestling/js/systems/showRunner.js';
import { installSystems } from '../wrestling/js/systems/index.js';
import { seedRoster } from '../wrestling/js/data/roster.js';
import { checkState } from '../wrestling/js/core/invariants.js';
import { FORMATS, autoName, slotsFor } from '../wrestling/js/systems/formats.js';
import { EVENT_TYPES } from '../wrestling/js/core/events.js';
import { recordOf, streakLabel } from '../wrestling/js/models/wrestler.js';
import * as booking from '../wrestling/js/systems/booking.js';
import { establishHistory, crownChampion } from './lib/fixtures.mjs';

let passed = 0; const failures = [];
const check = (label, fn) => {
  try { const d = fn(); passed++; console.log(`  ok  ${label}${d ? `  ${d}` : ''}`); }
  catch (e) { failures.push(`${label}: ${e.message}`); console.log(`FAIL  ${label}\n      ${e.message}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`); };
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;

console.log('\nTier 1 loop check\n');

installSystems();
store.newGame({ seed: 'loop-check', gmName: 'Loop', brandName: 'Tuesday Night', scheduleBlocks: 2 });
const k = seedRoster();
establishHistory(store, k);

/** Book a plausible card: an opening promo, three matches, a main event. */
function bookCard(showId, week) {
  const pick = (n) => {
    const free = booking.availableFor(showId).map((w) => w.id);
    return store.getRng().shuffle(free).slice(0, n);
  };
  const card = [];
  const add = (format, participants, limitMin) => {
    const f = FORMATS[format];
    const parts = participants.map((wid, i) => {
      const slot = slotsFor(format)[i];
      return { wrestlerId: wid, side: slot.side };
    });
    card.push(store.bookSegment({
      showId, format, kind: f.kind,
      name: autoName(format, parts, store.nameOf),
      timeLimitSec: limitMin * 60,
      participants: parts,
    }));
  };
  add('promo', [k.vance], 6);
  add('singles', week % 2 ? [k.wren, k.croft] : [k.okonkwo, k.delacroix], 15);
  add('singles', pick(2), 10);
  add('tag', pick(4), 14);
  add('triple_threat', pick(3), 12);
  return card;
}

// --- week 1 ----------------------------------------------------------------
console.log('week 1');
const show1 = runner.currentShow();
check('a show is waiting to be booked', () => {
  assert(show1, 'no show');
  eq(show1.status, 'scheduled', 'status');
  return `${show1.name}, budget ${mmss(show1.timeBudgetSec)}`;
});

check('a card can be booked across several match types', () => {
  const card = bookCard(show1.id, 1);
  eq(card.length, 5, 'segments');
  const p = runner.progress(show1.id);
  eq(p.total, 5, 'card length');
  const formats = card.map((s) => s.format).join(', ');
  return `${formats} - ${mmss(p.bookedSec)} booked of ${mmss(p.budgetSec)}`;
});

check('participants are the right shape for their format', () => {
  for (const seg of store.segmentsOfShow(show1.id)) {
    const want = FORMATS[seg.format].sideSizes.reduce((a, b) => a + b, 0);
    eq(seg.participants.length, want, `${seg.format} participant count`);
  }
  return 'every format got the head count it declares';
});

check('the booking rules refuse a nonsense card', () => {
  const inAMatch = [...booking.alreadyWrestling(show1.id)][0];
  const busy = booking.validate(show1.id, 'singles', [inAMatch, k.lund]);
  assert(!busy.ok && busy.problems[0].includes('already in a match'), 'double-booking was allowed');
  const self = booking.validate(show1.id, 'singles', [k.lund, k.lund]);
  assert(!self.ok && self.problems[0].includes('cannot face themselves'), 'self-match was allowed');
  const short = booking.validate(show1.id, 'tag', [k.lund]);
  assert(!short.ok && short.problems[0].includes('needs 4 people'), 'short-handed tag was allowed');
  return 'double-booking, self-matches and wrong head counts all refused';
});

check('the card outlook warns that limits are a ceiling, not a plan', () => {
  const o = booking.cardOutlook(show1.id);
  assert(o.expectedSec < o.bookedSec, 'expected fill should be under the booked limits');
  return `booked ${mmss(o.bookedSec)}, expect about ${mmss(o.expectedSec)}, leaving ${mmss(o.expectedGapSec)} to fill`;
});

check('the show goes live and the card progresses one segment at a time', () => {
  runner.goLive(show1.id);
  eq(store.getShow(show1.id).status, 'live', 'status');
  const first = runner.runNext(show1.id);
  assert(first, 'nothing ran');
  eq(runner.progress(show1.id).doneCount, 1, 'segments done');
  assert(first.result.actualSec > 0, 'no duration');
  return `${first.segment.name} ran ${mmss(first.result.actualSec)} of ${mmss(first.segment.timeLimitSec)}`;
});

let week1Results;
check('the rest of the card runs and the night ends', () => {
  week1Results = runner.runRest(show1.id);
  const p = runner.progress(show1.id);
  assert(p.finished, 'card not finished');
  runner.goOffAir(show1.id);
  const show = store.getShow(show1.id);
  eq(show.status, 'complete', 'status');
  assert(show.result.rating > 0, 'no rating');
  return `rated ${show.result.rating}, ran ${mmss(show.result.actualSec)} of ${mmss(show.timeBudgetSec)} booked as ${mmss(show.result.bookedSec)}`;
});

check('the clock diverged from the plan', () => {
  const show = store.getShow(show1.id);
  const drift = show.result.actualSec - show.result.bookedSec;
  assert(drift !== 0, 'the card ran exactly to plan, which should be near impossible');
  return `${drift < 0 ? 'short by' : 'over by'} ${mmss(Math.abs(drift))}`;
});

check('results landed on the record', () => {
  const matches = store.segmentsOfShow(show1.id).filter((s) => s.kind === 'match');
  const winners = matches.flatMap((s) => s.result.winnerIds);
  assert(winners.length > 0, 'nobody won anything');
  for (const id of winners) {
    const w = store.getWrestler(id);
    assert(w.standing.wins > 0, `${w.name} won but has no wins recorded`);
    assert(w.standing.streak.type === 'W', `${w.name} won but is not on a W streak`);
  }
  const sample = store.getWrestler(winners[0]);
  return `${sample.name} now ${recordOf(sample)} (${streakLabel(sample)})`;
});

check('working the show cost condition', () => {
  const worked = [...new Set(store.segmentsOfShow(show1.id)
    .filter((s) => s.kind === 'match')
    .flatMap((s) => s.participants.map((p) => p.wrestlerId)))];
  const fresh = worked.filter((id) => store.getWrestler(id).state.condition >= 100);
  assert(fresh.length === 0, `still perfectly fresh after wrestling: ${fresh.map(store.nameOf).join(', ')}`);
  const worst = worked.sort((a, b) =>
    store.getWrestler(a).state.condition - store.getWrestler(b).state.condition)[0];
  const w = store.getWrestler(worst);
  return `${w.name} down to ${Math.round(w.state.condition)} condition`;
});

check('every result is in the log as a match result', () => {
  const recorded = store.queryLog({ type: EVENT_TYPES.MATCH_RESULT, showId: show1.id });
  const matches = store.segmentsOfShow(show1.id).filter((s) => s.kind === 'match');
  eq(recorded.length, matches.length, 'match result events');
  return recorded.map((e) => e.summary).slice(0, 2).join(' / ') + ' ...';
});

// --- next week -------------------------------------------------------------
console.log('\nnext week');
check('advancing to the next show rests the roster', () => {
  const before = store.allWrestlers().map((w) => w.state.condition);
  const show = runner.nextWeek();
  assert(show, 'no next show');
  const after = store.allWrestlers().map((w) => w.state.condition);
  assert(after.some((c, i) => c > before[i]), 'nobody recovered');
  return `now ${show.name}, day ${store.today()}`;
});

check('recovery is one log line per rest, not one per wrestler', () => {
  const recovery = store.queryLog({ type: EVENT_TYPES.WRESTLER_STATE })
    .filter((e) => e.data?.kind === 'condition_recovery');
  assert(recovery.length > 0, 'nobody recovered');
  const biggest = recovery.sort((a, b) => b.data.recovered.length - a.data.recovered.length)[0];
  assert(biggest.data.recovered.length > 1,
    'recovery is being logged one wrestler at a time');
  return `${recovery.length} rest period(s), the largest covering ${biggest.data.recovered.length} wrestlers in one line`;
});

// --- weeks 2-4 -------------------------------------------------------------
console.log('\nweeks 2 to 4');
for (let week = 2; week <= 4; week++) {
  const show = runner.currentShow();
  bookCard(show.id, week);
  runner.goLive(show.id);
  runner.runRest(show.id);
  runner.goOffAir(show.id);
  if (week < 4) runner.nextWeek();
}

check('four shows are in the books', () => {
  const done = store.allShows().filter((s) => s.status === 'complete');
  eq(done.length, 4, 'completed shows');
  return done.map((s) => `${s.result.rating}`).join(', ') + ' (ratings)';
});

check('records add up across the month', () => {
  const totalWins = store.allWrestlers().reduce((t, w) => t + w.standing.wins, 0);
  const totalLosses = store.allWrestlers().reduce((t, w) => t + w.standing.losses, 0);
  const startWins = 4 + 33 + 41 + 28 + 24 + 31 + 26 + 18 + 15 + 52 + 21 + 3 + 5 + 6;
  const startLosses = 11 + 15 + 12 + 9 + 11 + 19 + 14 + 27 + 20 + 48 + 16 + 34 + 29 + 7;
  const wonThisMonth = totalWins - startWins;
  const lostThisMonth = totalLosses - startLosses;
  assert(wonThisMonth > 0, 'nobody won anything all month');
  // Every decisive match adds at least one win and at least one loss.
  assert(lostThisMonth >= wonThisMonth, 'more wins recorded than losses, which cannot happen');
  return `${wonThisMonth} wins and ${lostThisMonth} losses recorded over four weeks`;
});

check('time-limit draws happen but stay uncommon', () => {
  const all = store.allShows().flatMap((s) => s.segmentIds).map(store.getSegment)
    .filter((s) => s.kind === 'match' && s.status === 'complete');
  const draws = all.filter((s) => s.result.finish === 'time_limit_draw');
  assert(all.length >= 12, 'not enough matches to judge');
  assert(draws.length / all.length < 0.25, `draw rate is ${draws.length}/${all.length}, too high`);
  return `${draws.length} of ${all.length} matches went the distance`;
});

check('booking to fill the hour rates better than under-booking', () => {
  // Same roster, same budget. The only difference is that the GM booked enough
  // limits to cover an hour of television once matches end early.
  runner.nextWeek();
  const show = runner.currentShow();
  let guard = 0;
  while (booking.cardOutlook(show.id).expectedGapSec > 120 && guard++ < 12) {
    const free = booking.availableFor(show.id).map((w) => w.id);
    if (free.length < 2) break;
    const pair = store.getRng().shuffle(free).slice(0, 2);
    const parts = pair.map((wid, i) => ({ wrestlerId: wid, side: slotsFor('singles')[i].side }));
    store.bookSegment({
      showId: show.id, format: 'singles', kind: 'match',
      name: autoName('singles', parts, store.nameOf),
      timeLimitSec: 14 * 60, participants: parts,
    });
  }
  const outlook = booking.cardOutlook(show.id);
  runner.goLive(show.id);
  runner.runRest(show.id);
  runner.goOffAir(show.id);
  const s2 = store.getShow(show.id);
  const fill = s2.result.actualSec / s2.timeBudgetSec;
  assert(fill > 0.8, `a properly booked card only filled ${(fill * 100).toFixed(0)}% of the hour`);
  const underBooked = store.allShows().filter((x) => x.status === 'complete' && x.id !== s2.id);
  const avgUnder = underBooked.reduce((t, x) => t + x.result.rating, 0) / underBooked.length;
  assert(s2.result.rating > avgUnder, `filled card rated ${s2.result.rating}, under-booked average ${avgUnder.toFixed(0)}`);
  return `booked ${mmss(outlook.bookedSec)} of limits, filled ${mmss(s2.result.actualSec)} of ${mmss(s2.timeBudgetSec)}, rated ${s2.result.rating} vs ${avgUnder.toFixed(0)} average`;
});

check('memories accumulated from results', () => {
  const withMemory = store.allWrestlers().filter((w) => w.memory.length > 0);
  assert(withMemory.length > 8, `only ${withMemory.length} wrestlers remember anything`);
  const most = store.allWrestlers().sort((a, b) => b.memory.length - a.memory.length)[0];
  return `${most.name} is carrying ${most.memory.length} memories`;
});

check('the world is still sound after a month', () => {
  const problems = checkState(store.getState());
  assert(!problems.length, `\n      - ${problems.join('\n      - ')}`);
  return `${store.getState().log.length} events, no integrity problems`;
});

// --- mid-show save ---------------------------------------------------------
console.log('\nsaving mid-show');
check('a save taken halfway through a card resumes halfway through', () => {
  runner.nextWeek();
  const show = runner.currentShow();
  bookCard(show.id, 5);
  runner.goLive(show.id);
  runner.runNext(show.id);
  runner.runNext(show.id);
  const before = runner.progress(show.id);
  eq(before.doneCount, 2, 'segments run before saving');

  const json = persist.toJSON({ label: 'mid-show' });
  store.reset();
  persist.fromJSON(json);

  const after = runner.progress(show.id);
  eq(after.doneCount, 2, 'segments done after reload');
  eq(store.getShow(show.id).status, 'live', 'show status after reload');
  const resumed = runner.runNext(show.id);
  assert(resumed, 'could not carry on after reload');
  eq(runner.progress(show.id).doneCount, 3, 'segments after resuming');
  return `resumed at segment 3 of ${after.total} and carried on`;
});

check('the schema migration chain brings a v1 save all the way forward', () => {
  const envelope = JSON.parse(persist.toJSON({ label: 'downgrade' }));
  envelope.schemaVersion = 1;
  delete envelope.state.titles;
  for (const seg of Object.values(envelope.state.segments)) delete seg.format;
  store.reset();
  persist.deserialize(envelope);
  const state = store.getState();
  const segs = Object.values(state.segments);
  assert(segs.every((s) => s.format), 'a segment came through without a format');
  assert(state.titles && typeof state.titles === 'object', 'no titles registry after migration');
  eq(state.meta.schemaVersion, SCHEMA_VERSION, 'schema version after migration');
  const problems = checkState(state);
  assert(!problems.length, `migrated state is not sound:\n      - ${problems.join('\n      - ')}`);
  return `${segs.length} segments given a format, titles added, v1 -> v${SCHEMA_VERSION}, state sound`;
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) { for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
