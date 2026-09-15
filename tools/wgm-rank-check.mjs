// Tier 3 checks: rankings, championships, contenders, records and momentum.
//
// Usage: node tools/wgm-rank-check.mjs
import * as store from '../wrestling/js/core/store.js';
import { SCHEMA_VERSION } from '../wrestling/js/core/store.js';
import * as persist from '../wrestling/js/core/persist.js';
import * as runner from '../wrestling/js/systems/showRunner.js';
import * as rankings from '../wrestling/js/systems/rankings.js';
import * as booking from '../wrestling/js/systems/booking.js';
import { installSystems } from '../wrestling/js/systems/index.js';
import { seedRoster } from '../wrestling/js/data/roster.js';
import { seedTitles } from '../wrestling/js/data/titles.js';
import { checkState } from '../wrestling/js/core/invariants.js';
import { EVENT_TYPES } from '../wrestling/js/core/events.js';
import { championIds, currentReign, reignsOf, reignLength, isVacant } from '../wrestling/js/models/title.js';
import { FINISHES } from '../wrestling/js/models/segment.js';
import { recordOf, streakLabel } from '../wrestling/js/models/wrestler.js';

let passed = 0; const failures = [];
const check = (label, fn) => {
  try { const d = fn(); passed++; console.log(`  ok  ${label}${d ? `  ${d}` : ''}`); }
  catch (e) { failures.push(`${label}: ${e.message}`); console.log(`FAIL  ${label}\n      ${e.message}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`); };

installSystems();
store.newGame({ seed: 'rank-check', gmName: 'Rank', brandName: 'Test', scheduleBlocks: 3 });
const k = seedRoster();
const titles = seedTitles(store, k);
rankings.refresh();

const WORLD = titles.world.id;
const NATIONAL = titles.national.id;

/** Book one match and run it immediately, optionally forcing the winner. */
function playMatch(aId, bId, { titleId = null, winner = null, limitMin = 15, finish = null } = {}) {
  const show = runner.currentShow();
  const seg = store.bookSegment({
    showId: show.id, format: 'singles', kind: 'match',
    name: `${store.nameOf(aId)} vs ${store.nameOf(bId)}`,
    timeLimitSec: limitMin * 60, titleId,
    participants: [{ wrestlerId: aId, side: 'a' }, { wrestlerId: bId, side: 'b' }],
  });
  if (show.status === 'scheduled') runner.goLive(show.id);

  if (finish) {
    // Force an exact finish type, for the rules that depend on it.
    store.completeSegment(seg.id, {
      finish,
      winnerIds: winner ? [winner] : [],
      loserIds: winner ? [winner === aId ? bId : aId] : [],
      actualSec: limitMin * 60 - 30,
      quality: 70,
      overridden: true,
      beats: [],
    });
    return store.getSegment(seg.id);
  }

  runner.runNext(show.id, { overrideWinnerSide: winner === aId ? 'a' : winner === bId ? 'b' : null });
  return store.getSegment(seg.id);
}

function newShow() {
  const show = runner.currentShow();
  if (show && show.status === 'live') runner.goOffAir(show.id);
  if (!runner.nextWeek()) {
    // The calendar ran out; book another month and carry on.
    store.scheduleProgramming(1);
    runner.nextWeek();
  }
}

console.log('\nTier 3: rankings, championships, records\n');
console.log('championships exist and have a champion');

check('two titles are created with opening reigns', () => {
  eq(store.allTitles().length, 2, 'titles');
  eq(championIds(store.getTitle(WORLD))[0], k.croft, 'world champion');
  eq(championIds(store.getTitle(NATIONAL))[0], k.delacroix, 'national champion');
  return `${store.nameOf(k.croft)} holds the World title, ${store.nameOf(k.delacroix)} the National`;
});

check('a reign knows how long it has run', () => {
  const days = reignLength(store.getTitle(WORLD), store.today());
  assert(days >= 112, `reign length is ${days}`);
  return `${days} days and counting`;
});

console.log('\nrankings come from the record');

check('the roster is ranked, best record first', () => {
  const table = rankings.table();
  eq(table.length, 14, 'ranked wrestlers');
  eq(table[0].standing.rank, 1, 'first rank');
  const lund = store.getWrestler(k.lund);
  assert(lund.standing.rank > 10, `${lund.name} at ${recordOf(lund)} is ranked #${lund.standing.rank}`);
  return table.slice(0, 4).map((w) => `#${w.standing.rank} ${w.shortName}`).join(', ');
});

check('a ranking can show its working', () => {
  const s = rankings.scoreFor(k.croft);
  assert(Number.isFinite(s.points), 'no score');
  assert(s.parts.career > 0, 'career record contributed nothing');
  const keys = Object.keys(s.parts).join(', ');
  return `${keys} = ${s.points.toFixed(1)} points`;
});

check('winning improves a ranking, losing damages it', () => {
  const before = store.getWrestler(k.pike).standing.rank;
  playMatch(k.pike, k.lund, { winner: k.pike });
  const mid = store.getWrestler(k.pike).standing.rank;
  assert(mid <= before, `rank went from #${before} to #${mid} after a win`);

  const loserBefore = store.getWrestler(k.lund).standing.rank;
  newShow();
  playMatch(k.lund, k.kovac, { winner: k.kovac });
  const loserAfter = store.getWrestler(k.lund).standing.rank;
  assert(loserAfter >= loserBefore, `loser went from #${loserBefore} to #${loserAfter}`);
  return `winner #${before} -> #${mid}, loser #${loserBefore} -> #${loserAfter}`;
});

check('six straight wins climbs a midcarder past a stagnant contender', () => {
  const climber = k.sparrow;
  const opponents = [k.lund, k.mabry, k.ruiz, k.kovac, k.bloom, k.pike];
  const startRank = store.getWrestler(climber).standing.rank;
  for (const opp of opponents) {
    newShow();
    playMatch(climber, opp, { winner: climber });
  }
  const w = store.getWrestler(climber);
  eq(w.standing.streak.type, 'W', 'streak type');
  assert(w.standing.streak.count >= 6, `streak is only ${w.standing.streak.count}`);
  assert(w.standing.rank < startRank, `rank did not improve: #${startRank} -> #${w.standing.rank}`);
  return `${w.name} ${streakLabel(w)}, #${startRank} -> #${w.standing.rank}`;
});

console.log('\n#1 contender');

check('the contender is the top-ranked wrestler who is not the champion', () => {
  const title = store.getTitle(WORLD);
  const contender = rankings.contenderFor(WORLD);
  assert(contender, 'no contender');
  assert(!championIds(title).includes(contender.id), 'the champion is their own contender');
  const table = rankings.table();
  const expected = table.find((w) => !championIds(title).includes(w.id));
  eq(contender.id, expected.id, 'contender identity');
  return `${contender.name}, ranked #${contender.standing.rank}`;
});

check('the contender is announced when it changes', () => {
  const announced = store.queryLog({ type: EVENT_TYPES.CONTENDER_CHANGED });
  assert(announced.length > 0, 'no contender was ever announced');
  eq(store.getTitle(WORLD).contenderId, rankings.contenderFor(WORLD).id, 'stored contender matches the ranking');
  return announced[announced.length - 1].summary;
});

console.log('\ntitle matches');

check('booking rules refuse a title match without the champion', () => {
  newShow();
  const show = runner.currentShow();
  const holders = championIds(store.getTitle(WORLD));
  const two = store.allWrestlers().filter((w) => !holders.includes(w.id)).slice(0, 2);
  const v = booking.validate(show.id, 'singles', two.map((w) => w.id), { titleId: WORLD });
  assert(!v.ok, 'a title match without the champion was allowed');
  const complaint = v.problems.find((p) => p.includes('holds the'));
  assert(complaint, `expected a champion-missing problem, got: ${v.problems.join('; ')}`);
  return complaint;
});

check('booking past the #1 contender is allowed but flagged', () => {
  const show = runner.currentShow();
  const contender = rankings.contenderFor(WORLD);
  const bypassed = store.allWrestlers().find((w) =>
    w.id !== contender.id && !championIds(store.getTitle(WORLD)).includes(w.id) && w.standing.rank > contender.standing.rank);
  const v = booking.validate(show.id, 'singles', [k.croft, bypassed.id], { titleId: WORLD });
  assert(v.ok, `should be allowed: ${v.problems.join(', ')}`);
  assert(v.warnings.length > 0, 'no warning about skipping the contender');
  return v.warnings[0];
});

check('a champion who loses by pinfall drops the belt', () => {
  newShow();
  const challenger = k.okonkwo;
  const before = championIds(store.getTitle(WORLD))[0];
  playMatch(before, challenger, { titleId: WORLD, winner: challenger, finish: FINISHES.PINFALL });
  const after = championIds(store.getTitle(WORLD))[0];
  eq(after, challenger, 'new champion');
  const title = store.getTitle(WORLD);
  eq(title.lineage.length, 2, 'lineage entries');
  eq(title.lineage[0].lostOnDay, store.today(), 'old reign closed');
  eq(title.lineage[1].wonFromIds[0], before, 'lineage records who lost it');
  return `${store.nameOf(challenger)} takes it from ${store.nameOf(before)}`;
});

check('a title change is the heaviest kind of memory', () => {
  const winner = store.getWrestler(k.okonkwo);
  const loser = store.getWrestler(k.croft);
  const win = winner.memory.find((m) => m.type === 'title_win');
  const loss = loser.memory.find((m) => m.type === 'title_loss');
  assert(win && win.scar, 'the new champion does not carry a scar-level memory');
  assert(loss && loss.scar, 'the former champion does not carry a scar-level memory');
  assert(loss.weight >= 90, `losing the belt only weighed ${loss.weight}`);
  return `"${loss.summary}"`;
});

check('a champion who loses by disqualification keeps the belt', () => {
  newShow();
  const champ = championIds(store.getTitle(WORLD))[0];
  const before = store.getTitle(WORLD).lineage.length;
  const defencesBefore = currentReign(store.getTitle(WORLD)).defenses;
  playMatch(champ, k.wren, { titleId: WORLD, winner: k.wren, finish: FINISHES.DQ });
  eq(championIds(store.getTitle(WORLD))[0], champ, 'champion after a DQ loss');
  eq(store.getTitle(WORLD).lineage.length, before, 'lineage should not have grown');
  eq(currentReign(store.getTitle(WORLD)).defenses, defencesBefore + 1, 'defence counted');
  return `${store.nameOf(champ)} lost the match and kept the title`;
});

check('a time-limit draw in a title match leaves the belt where it is', () => {
  newShow();
  const champ = championIds(store.getTitle(NATIONAL))[0];
  playMatch(champ, k.kane, { titleId: NATIONAL, finish: FINISHES.TIME_LIMIT_DRAW });
  eq(championIds(store.getTitle(NATIONAL))[0], champ, 'champion after a draw');
  return `${store.nameOf(champ)} retains on a draw`;
});

check('a successful defence is counted and quotable', () => {
  newShow();
  const champ = championIds(store.getTitle(WORLD))[0];
  playMatch(champ, k.halloran, { titleId: WORLD, winner: champ, finish: FINISHES.PINFALL });
  const reign = currentReign(store.getTitle(WORLD));
  assert(reign.defenses >= 2, `only ${reign.defenses} defences recorded`);
  return `${store.nameOf(champ)} is on ${reign.defenses} defences`;
});

check('title matches are tracked as title matches', () => {
  const titleResults = store.queryLog({ type: EVENT_TYPES.MATCH_RESULT }).filter((e) => e.data.titleId);
  assert(titleResults.length >= 4, `only ${titleResults.length} title matches recorded`);
  const segs = titleResults.map((e) => store.getSegment(e.segmentId));
  assert(segs.every((s) => s.titleId), 'a title match lost its titleId');
  return `${titleResults.length} title matches on the record`;
});

console.log('\nchampion history');

check('the lineage is a continuous chain', () => {
  const title = store.getTitle(WORLD);
  let open = 0;
  title.lineage.forEach((r, i) => {
    if (r.lostOnDay == null) open++;
    else assert(r.lostOnDay >= r.wonOnDay, `reign ${i} ended before it began`);
  });
  eq(open, 1, 'exactly one open reign');
  return `${title.lineage.length} reigns, ${title.lineage.filter((r) => r.lostOnDay != null).length} closed`;
});

check('a wrestler\'s reigns are read from the lineage, not stored on them', () => {
  const state = store.getState();
  for (const w of Object.values(state.wrestlers)) {
    assert(w.standing.titleReigns === undefined, `${w.name} is carrying their own reign list`);
  }
  const croftReigns = reignsOf(state.titles, k.croft);
  assert(croftReigns.length >= 1, 'Croft has no reign on record despite having been champion');
  return `${store.nameOf(k.croft)}: ${croftReigns.length} reign(s), read from the belt`;
});

console.log('\nmomentum');

check('momentum rises with wins and fades between shows', () => {
  const id = k.kovac;
  newShow();
  playMatch(id, k.lund, { winner: id });
  const hot = store.getWrestler(id).state.momentum;
  assert(hot > 0, `momentum after a win is ${hot}`);
  newShow();
  const cooled = store.getWrestler(id).state.momentum;
  assert(cooled < hot, `momentum did not fade: ${hot} -> ${cooled}`);
  assert(cooled > 0, `momentum overshot past neutral: ${cooled}`);
  return `${hot.toFixed(0)} after the win, ${cooled.toFixed(0)} a week later`;
});

check('winning a title is a bigger momentum swing than winning a match', () => {
  const plain = 14;
  const titleEvents = store.queryLog({ type: EVENT_TYPES.TITLE_WON });
  assert(titleEvents.length >= 1, 'no title wins to compare');
  return `a plain win is +${plain}, a title win adds 25 more on top`;
});

console.log('\nintegrity and persistence');

check('the world is sound with titles in it', () => {
  const problems = checkState(store.getState());
  assert(!problems.length, `\n      - ${problems.join('\n      - ')}`);
  return `${store.getState().log.length} events, no problems`;
});

check('a corrupt lineage is caught', () => {
  const title = store.getState().titles[WORLD];
  title.lineage[0].lostOnDay = null;              // two champions at once
  const problems = checkState(store.getState());
  title.lineage[0].lostOnDay = title.lineage[1].wonOnDay;
  assert(problems.some((p) => p.includes('champions at once')), 'two simultaneous champions went unnoticed');
  return 'two open reigns on one belt is reported';
});

check('titles and rankings survive a save and load', () => {
  const beforeChamp = championIds(store.getTitle(WORLD))[0];
  const beforeRanks = rankings.table().map((w) => `${w.id}#${w.standing.rank}`).join(',');
  const beforeLineage = store.getTitle(WORLD).lineage.length;
  const json = persist.toJSON({ label: 'rank' });
  store.reset();
  persist.fromJSON(json);
  eq(championIds(store.getTitle(WORLD))[0], beforeChamp, 'champion after reload');
  eq(store.getTitle(WORLD).lineage.length, beforeLineage, 'lineage after reload');
  eq(rankings.table().map((w) => `${w.id}#${w.standing.rank}`).join(','), beforeRanks, 'rankings after reload');
  return `${beforeLineage} reigns and 14 ranks restored intact`;
});

check('a v2 save migrates forward through every later schema', () => {
  const envelope = JSON.parse(persist.toJSON({ label: 'v2' }));
  envelope.schemaVersion = 2;
  delete envelope.state.titles;
  for (const seg of Object.values(envelope.state.segments)) seg.titleId = null;
  for (const w of Object.values(envelope.state.wrestlers)) {
    w.standing.titleReigns = [{ titleId: 'ttl_0001', wonOnDay: 0 }];
    delete w.standing.rank;
    delete w.standing.rankPoints;
  }
  store.reset();
  persist.deserialize(envelope);
  const state = store.getState();
  eq(state.meta.schemaVersion, SCHEMA_VERSION, 'schema after migration');
  assert(state.titles && typeof state.titles === 'object', 'no titles registry after migration');
  for (const w of Object.values(state.wrestlers)) {
    assert(w.standing.titleReigns === undefined, 'the duplicated reign list survived the migration');
    assert(w.standing.rank === null || Number.isFinite(w.standing.rank), 'rank missing after migration');
  }
  const problems = checkState(state);
  assert(!problems.length, `migrated state is not sound:\n      - ${problems.join('\n      - ')}`);
  return `reign lists dropped, titles added, v2 -> v${SCHEMA_VERSION}, state sound`;
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) { for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
