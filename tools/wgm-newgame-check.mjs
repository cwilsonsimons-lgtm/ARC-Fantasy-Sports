// A new save is a blank slate.
//
// Nothing has happened yet: every record is 0-0, no belt has an owner, nobody
// holds an opinion about anybody, and not one person has a view of the GM. The
// only thing authored is who these people ARE - personality, ability, where
// they sit on the card, what they are paid.
//
// This suite exists so that stops being an accident. It is easy to add a
// flourish to the starting roster months from now and quietly hand every save
// the same opening story.
//
// Usage: node tools/wgm-newgame-check.mjs
import * as store from '../wrestling/js/core/store.js';
import { installSystems } from '../wrestling/js/systems/index.js';
import { seedRoster, STARTING_ROSTER } from '../wrestling/js/data/roster.js';
import { seedTitles } from '../wrestling/js/data/titles.js';
import { checkState } from '../wrestling/js/core/invariants.js';
import { EVENT_TYPES } from '../wrestling/js/core/events.js';
import { isVacant } from '../wrestling/js/models/title.js';
import { TRAITS, CAREER_ORDER } from '../wrestling/js/models/wrestler.js';
import { AXIS_RANGE } from '../wrestling/js/models/relationship.js';
import * as rankings from '../wrestling/js/systems/rankings.js';
import { wantsOf } from '../wrestling/js/systems/requests.js';

let passed = 0; const failures = [];
const check = (label, fn) => {
  try { const d = fn(); passed++; console.log(`  ok  ${label}${d ? `  ${d}` : ''}`); }
  catch (e) { failures.push(`${label}: ${e.message}`); console.log(`FAIL  ${label}\n      ${e.message}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`); };
const uniq = (xs) => [...new Set(xs)];

installSystems();
store.newGame({ seed: 'blank-slate', gmName: 'New GM', brandName: 'New Brand', scheduleBlocks: 3 });
const k = seedRoster();
const titles = seedTitles(store);
rankings.refresh();
const roster = store.allWrestlers();

console.log('\nA new save is a blank slate\n');
console.log('nothing has happened');

check('every record is 0-0', () => {
  for (const w of roster) {
    eq(w.standing.wins, 0, `${w.name} wins`);
    eq(w.standing.losses, 0, `${w.name} losses`);
    eq(w.standing.draws, 0, `${w.name} draws`);
    assert(!w.standing.streak.type, `${w.name} is on a ${w.standing.streak.type} streak`);
  }
  return `${roster.length} wrestlers, all 0-0, no streaks`;
});

check('nobody has an opinion about anybody', () => {
  const held = roster.reduce((t, w) => t + Object.keys(w.ties.relationships).length, 0);
  eq(held, 0, 'relationships on a fresh roster');
  return 'no allies, no enemies, no rivalries';
});

check('nobody remembers anything', () => {
  const memories = roster.reduce((t, w) => t + w.memory.length, 0);
  eq(memories, 0, 'memories on a fresh roster');
  return 'no grudges, no scars, nothing to quote at the GM';
});

check('nobody has a view of the GM yet', () => {
  const trust = uniq(roster.map((w) => w.ties.gm.trust));
  const respect = uniq(roster.map((w) => w.ties.gm.respect));
  eq(trust.length, 1, 'distinct trust values');
  eq(respect.length, 1, 'distinct respect values');
  eq(trust[0], AXIS_RANGE.trust.neutral, 'starting trust');
  eq(respect[0], AXIS_RANGE.respect.neutral, 'starting respect');
  return `everyone starts at ${trust[0]} trust and ${respect[0]} respect`;
});

check('everyone starts level on morale and momentum', () => {
  eq(uniq(roster.map((w) => w.state.momentum)).length, 1, 'distinct momentum values');
  eq(uniq(roster.map((w) => w.state.momentum))[0], 0, 'starting momentum');
  eq(uniq(roster.map((w) => w.state.condition))[0], 100, 'starting condition');
  const morale = uniq(roster.map((w) => w.state.morale));
  eq(morale.length, 1, 'distinct morale values');
  return `morale ${morale[0]}, momentum 0, condition 100, across the roster`;
});

check('every championship is vacant', () => {
  const all = store.allTitles();
  assert(all.length > 0, 'no titles exist at all');
  for (const t of all) {
    assert(isVacant(t), `${t.name} already has a champion`);
    eq(t.lineage.length, 0, `${t.name} lineage`);
  }
  return `${all.length} belts, nobody has held one`;
});

check('nobody is asking for anything yet', () => {
  eq(store.allRequests().length, 0, 'requests at game start');
  return 'the inbox is empty';
});

check('the log holds no history, only setup', () => {
  const historical = store.queryLog({
    types: [
      EVENT_TYPES.MATCH_RESULT, EVENT_TYPES.SEGMENT_COMPLETED, EVENT_TYPES.SHOW_COMPLETED,
      EVENT_TYPES.WRESTLER_RELATION, EVENT_TYPES.WRESTLER_MEMORY,
      EVENT_TYPES.TITLE_WON, EVENT_TYPES.REQUEST_MADE,
    ],
  });
  eq(historical.length, 0, 'events describing things that happened');
  return `${store.getState().log.length} events, all of them setup`;
});

console.log('\nwho they are is still authored');

check('personality, ability and standing all survive', () => {
  for (const w of roster) {
    for (const trait of TRAITS) {
      assert(Number.isFinite(w.identity.traits[trait]), `${w.name} lost ${trait}`);
    }
    assert(w.identity.ego > 0 && w.identity.ambition > 0, `${w.name} has no ego or ambition`);
    assert(w.ability.workRate > 0, `${w.name} has no ability`);
    assert(w.contract.salary > 0, `${w.name} is on no money`);
  }
  const egos = uniq(roster.map((w) => w.identity.ego));
  return `${egos.length} different egos, ${uniq(roster.map((w) => w.ability.starPower)).length} different star ratings`;
});

check('the roster still spans the card', () => {
  const used = uniq(roster.map((w) => w.standing.careerStatus));
  assert(used.length >= 6, `only ${used.length} rungs of the card are used`);
  return CAREER_ORDER.filter((s) => used.includes(s)).map((s) => s.replace('_', ' ')).join(', ');
});

check('the characters still differ sharply from minute one', () => {
  const lund = store.getWrestler(k.lund);
  const croft = store.getWrestler(k.croft);
  const halloran = store.getWrestler(k.halloran);
  assert(croft.identity.ego - lund.identity.ego > 50, 'the ego spread collapsed');
  assert(halloran.identity.ego > 70 && halloran.standing.careerStatus === 'lower_card',
    'Halloran is no longer a big ego on a small spot');
  assert(lund.identity.traits.professionalism > 85, 'Lund is no longer the professional');
  return `Croft ego ${croft.identity.ego} vs Lund ${lund.identity.ego}; Halloran ego ${halloran.identity.ego} on the lower card`;
});

console.log('\nthe game still works from nothing');

check('rankings order the roster sensibly with no results', () => {
  const table = rankings.table();
  eq(table.length, roster.length, 'ranked wrestlers');
  eq(uniq(table.map((w) => w.standing.rankPoints)).length, 1,
    'somebody has ranking points before anybody has wrestled');
  // With every score level, the tie-break should fall back to the card.
  assert(table[0].standing.careerStatus === 'superstar',
    `#1 is a ${table[0].standing.careerStatus}, not the top of the card`);
  assert(['rookie', 'jobber'].includes(table[table.length - 1].standing.careerStatus),
    `bottom of the rankings is a ${table[table.length - 1].standing.careerStatus}`);
  return `everyone on ${table[0].standing.rankPoints} points, ordered by the card: ${table.slice(0, 3).map((w) => w.shortName).join(', ')}`;
});

check('a vacant belt still has somebody chasing it', () => {
  const contender = rankings.contenderFor(titles.world.id);
  assert(contender, 'nobody is the #1 contender for a vacant title');
  return `${contender.name} is first in line for the ${titles.world.shortName} title`;
});

check('people still want things, from who they are rather than what happened', () => {
  const wanting = roster.filter((w) => wantsOf(w.id).length > 0);
  assert(wanting.length > 0, 'nobody on a blank-slate roster wants anything');
  for (const w of wanting) {
    for (const want of wantsOf(w.id)) {
      assert(want.reasons.length > 0, `${w.name}'s ${want.kind} has no reasons`);
    }
  }
  const sample = wantsOf(wanting[0].id)[0];
  return `${wanting.length} wrestlers want something, e.g. "${sample.text}"`;
});

check('the world is sound', () => {
  const problems = checkState(store.getState());
  assert(!problems.length, `\n      - ${problems.join('\n      - ')}`);
  return 'no dangling references, nothing malformed';
});

console.log('\nthe roster data itself carries no history');

check('the shipped roster declares no records, ties or memories', () => {
  const historical = ['standing', 'state', 'ties', 'relationships', 'memory'];
  for (const spec of STARTING_ROSTER) {
    for (const field of historical) {
      assert(spec[field] === undefined,
        `${spec.name} ships with a "${field}" block - that is history, and it belongs in a save`);
    }
  }
  return `${STARTING_ROSTER.length} entries, none carrying a past`;
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) { for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
