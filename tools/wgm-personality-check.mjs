// Tier 4 checks: personality, career status, and whether the behaviour the data
// implies is believable.
//
// The rule under test throughout: STANDING BUYS THE RIGHT TO SAY NO. A rookie
// jobber rarely refuses whatever their ego; a top star can refuse almost
// anything. Everything else is personality shading around that.
//
// Usage: node tools/wgm-personality-check.mjs
import * as store from '../wrestling/js/core/store.js';
import * as persist from '../wrestling/js/core/persist.js';
import { SCHEMA_VERSION } from '../wrestling/js/core/store.js';
import { installSystems } from '../wrestling/js/systems/index.js';
import { seedRoster } from '../wrestling/js/data/roster.js';
import { seedTitles } from '../wrestling/js/data/titles.js';
import { checkState } from '../wrestling/js/core/invariants.js';
import {
  regard, regardSegment, refusalFloor, RESPONSE, expectedMinutes,
} from '../wrestling/js/systems/disposition.js';
import {
  TRAITS, CAREER_STATUS, CAREER_ORDER, CAREER_RANK, TRAJECTORY, statusRank, standingWeight,
} from '../wrestling/js/models/wrestler.js';
import { establishHistory, crownChampion } from './lib/fixtures.mjs';

let passed = 0; const failures = [];
const check = (label, fn) => {
  try { const d = fn(); passed++; console.log(`  ok  ${label}${d ? `  ${d}` : ''}`); }
  catch (e) { failures.push(`${label}: ${e.message}`); console.log(`FAIL  ${label}\n      ${e.message}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`); };

installSystems();
store.newGame({ seed: 'personality', gmName: 'P', brandName: 'T', scheduleBlocks: 1 });
const k = seedRoster();
establishHistory(store, k);
const titles = seedTitles(store);
crownChampion(store, titles.world.id, k.croft, 112);
crownChampion(store, titles.national.id, k.delacroix, 43);

const W = (key) => store.getWrestler(k[key]);
const OPENER_VS_JOBBER = { opponentIds: [k.lund], timeLimitSec: 360, cardIndex: 0, cardLength: 5 };

console.log('\nTier 4: personality and status\n');
console.log('the data');

check('every wrestler carries all ten traits', () => {
  for (const w of store.allWrestlers()) {
    for (const trait of TRAITS) {
      assert(Number.isFinite(w.identity.traits[trait]), `${w.name} is missing ${trait}`);
      const v = w.identity.traits[trait];
      assert(v >= 0 && v <= 100, `${w.name}.${trait} is ${v}, outside 0-100`);
    }
  }
  return TRAITS.join(', ');
});

check('ego and ambition sit apart from the traits', () => {
  for (const w of store.allWrestlers()) {
    assert(Number.isFinite(w.identity.ego), `${w.name} has no ego`);
    assert(Number.isFinite(w.identity.ambition), `${w.name} has no ambition`);
    assert(!('ego' in w.identity.traits), 'ego leaked into the trait list');
  }
  return 'what they want, kept separate from how they are';
});

check('career status runs rookie to superstar and the roster uses the range', () => {
  eq(CAREER_ORDER.length, 7, 'rungs on the card');
  const used = new Set(store.allWrestlers().map((w) => w.standing.careerStatus));
  const missing = CAREER_ORDER.filter((s) => !used.has(s));
  assert(missing.length <= 1, `roster leaves ${missing.join(', ')} unused`);
  const counts = CAREER_ORDER.map((s) =>
    `${s.replace('_', ' ')} ${store.allWrestlers().filter((w) => w.standing.careerStatus === s).length}`);
  return counts.join(', ');
});

check('trajectory is separate from position on the card', () => {
  const halloran = W('halloran');
  eq(halloran.standing.careerStatus, CAREER_STATUS.LOWER_CARD, 'Halloran position');
  eq(halloran.standing.trajectory, TRAJECTORY.DECLINING, 'Halloran trajectory');
  const kovac = W('kovac');
  eq(kovac.standing.trajectory, TRAJECTORY.RISING, 'Kovac trajectory');
  return 'a faded star and a rising rookie can share a rung and mean different things';
});

console.log('\nstanding buys the right to say no');

check('the refusal floor falls as status rises', () => {
  const floors = CAREER_ORDER.map((status) => refusalFloor({ standing: { careerStatus: status } }));
  for (let i = 1; i < floors.length; i++) {
    assert(floors[i] < floors[i - 1], `${CAREER_ORDER[i]} does not have more room to refuse than ${CAREER_ORDER[i - 1]}`);
  }
  return CAREER_ORDER.map((s, i) => `${s.split('_')[0]} ${Math.round(floors[i])}`).join(' > ');
});

check('a rookie accepts the worst booking on the card', () => {
  for (const key of ['ruiz', 'kovac']) {
    const r = regard(k[key], OPENER_VS_JOBBER);
    assert(r.likely === RESPONSE.ACCEPT, `${W(key).name} responded "${r.likely}"`);
  }
  const r = regard(k.ruiz, OPENER_VS_JOBBER);
  return `${W('ruiz').name} at ${r.willingness}, floor ${r.floor}`;
});

check('a superstar refuses the same booking', () => {
  const r = regard(k.croft, OPENER_VS_JOBBER);
  eq(r.likely, RESPONSE.REFUSE, `${W('croft').name} responded`);
  assert(r.floor < 15, `a superstar's floor is ${r.floor}, too high to refuse anything`);
  return `${W('croft').name} at ${r.willingness}, floor ${r.floor}`;
});

check('a jobber with a superstar\'s ego still cannot refuse', () => {
  // Give Lund Croft's ego and see whether standing still holds him in place.
  const lund = W('lund');
  const realEgo = lund.identity.ego;
  lund.identity.ego = 95;
  const r = regard(k.lund, OPENER_VS_JOBBER);
  lund.identity.ego = realEgo;
  assert(r.likely === RESPONSE.ACCEPT || r.likely === RESPONSE.GRUDGING,
    `a jobber with ego 95 responded "${r.likely}"`);
  return `ego 95 on a jobber still lands at ${r.willingness}, floor ${r.floor}`;
});

check('the floor is doing real work, not decoration', () => {
  const held = store.allWrestlers()
    .map((w) => ({ w, r: regard(w.id, OPENER_VS_JOBBER) }))
    .filter(({ r }) => r.heldUpByStanding);
  assert(held.length >= 3, `only ${held.length} wrestlers are held up by standing`);
  const worst = held.sort((a, b) => a.r.raw - b.r.raw)[0];
  return `${held.length} wrestlers want to refuse and cannot, worst is ${worst.w.name} (raw ${worst.r.raw}, held at ${worst.r.willingness})`;
});

check('a high ego on low standing is the character it should be', () => {
  // Halloran: a superstar's ego stranded on the lower card.
  const r = regard(k.halloran, OPENER_VS_JOBBER);
  assert(r.heldUpByStanding, 'Halloran is not being held up by standing');
  assert(r.raw < 40, `Halloran's raw willingness is ${r.raw}, he should hate this`);
  assert(r.likely !== RESPONSE.REFUSE, 'a lower-card wrestler should not be refusing');
  const reason = r.reasons.find((x) => x.floor);
  assert(reason, 'no reason given for holding him up');
  return `raw ${r.raw}, held at ${r.willingness}: "${reason.text}"`;
});

console.log('\npersonality separates people on the same rung');

check('two upper-midcarders answer the same ask differently', () => {
  const a = regard(k.okonkwo, OPENER_VS_JOBBER);
  const b = regard(k.delacroix, OPENER_VS_JOBBER);
  eq(statusRank(W('okonkwo')), statusRank(W('delacroix')), 'same status');
  assert(Math.abs(a.raw - b.raw) > 20, `raw willingness differs by only ${Math.abs(a.raw - b.raw)}`);
  return `${W('okonkwo').name} ${a.raw} vs ${W('delacroix').name} ${b.raw}, same rung`;
});

check('professionalism and respect for authority raise willingness', () => {
  const pike = regard(k.pike, OPENER_VS_JOBBER);     // prof 96, authority 90, ego 30
  const bloom = regard(k.bloom, OPENER_VS_JOBBER);   // prof 50, authority 40, ego 69
  eq(statusRank(W('pike')), statusRank(W('bloom')), 'same status');
  assert(pike.raw > bloom.raw + 25, `${pike.raw} vs ${bloom.raw} is too close`);
  return `${W('pike').name} ${pike.raw}, ${W('bloom').name} ${bloom.raw}`;
});

check('ego is what pushes back', () => {
  const croft = W('croft');
  const real = croft.identity.ego;
  croft.identity.ego = 20;
  const humble = regard(k.croft, OPENER_VS_JOBBER).raw;
  croft.identity.ego = 95;
  const proud = regard(k.croft, OPENER_VS_JOBBER).raw;
  croft.identity.ego = real;
  assert(humble > proud, `ego 20 gave ${humble}, ego 95 gave ${proud}`);
  return `same superstar, ego 20 -> ${humble}, ego 95 -> ${proud}`;
});

console.log('\nthe ask matters as much as the person');

check('the same wrestler answers different asks differently', () => {
  const opener = regard(k.vance, OPENER_VS_JOBBER);
  const main = regard(k.vance, {
    opponentIds: [k.croft], timeLimitSec: 1200, cardIndex: 4, cardLength: 5, titleId: titles.world.id,
  });
  assert(main.willingness > opener.willingness + 40, `${opener.willingness} vs ${main.willingness}`);
  return `${W('vance').name}: opening against a jobber ${opener.willingness}, main-event title shot ${main.willingness}`;
});

check('where they are on the card is a statement they read', () => {
  const ask = { opponentIds: [k.pike], timeLimitSec: 900 };
  const opener = regard(k.croft, { ...ask, cardIndex: 0, cardLength: 5 });
  const main = regard(k.croft, { ...ask, cardIndex: 4, cardLength: 5 });
  assert(main.raw > opener.raw + 15, `opener ${opener.raw}, main event ${main.raw}`);
  return `${W('croft').name} opening ${opener.raw}, main-eventing ${main.raw}`;
});

check('the time limit is a statement too', () => {
  const ask = { opponentIds: [k.pike], cardIndex: 3, cardLength: 5 };
  const short = regard(k.croft, { ...ask, timeLimitSec: 240 });
  const proper = regard(k.croft, { ...ask, timeLimitSec: 1200 });
  assert(proper.raw > short.raw + 10, `4 minutes ${short.raw}, 20 minutes ${proper.raw}`);
  return `${W('croft').name}: 4 minutes ${short.raw}, 20 minutes ${proper.raw} (expects about ${Math.round(expectedMinutes(W('croft')))})`;
});

check('courage is what decides who wants the long dangerous match', () => {
  const ask = { opponentIds: [k.kane], timeLimitSec: 35 * 60, cardIndex: 4, cardLength: 5 };
  const brave = regard(k.sparrow, ask);    // courage 92
  const careful = regard(k.halloran, ask); // courage 20
  const braveReason = brave.reasons.find((r) => r.text.includes('longer match'));
  const carefulReason = careful.reasons.find((r) => r.text.includes('longer match'));
  assert(!braveReason || Math.abs(braveReason.delta) < Math.abs(carefulReason.delta),
    'courage made no difference to a 35-minute match');
  return `${W('sparrow').name} barely minds, ${W('halloran').name} takes ${carefulReason.delta}`;
});

check('ambition makes a title shot wanted by almost everyone', () => {
  const ask = { opponentIds: [k.croft], timeLimitSec: 1200, cardIndex: 4, cardLength: 5, titleId: titles.world.id };
  const refusing = store.allWrestlers()
    .filter((w) => w.id !== k.croft)
    .map((w) => regard(w.id, ask))
    .filter((r) => r.likely === RESPONSE.REFUSE || r.likely === RESPONSE.PUSH_BACK);
  eq(refusing.length, 0, `${refusing.length} wrestlers turned down a world title shot`);
  return 'nobody on the roster turns down a shot at the World title';
});

check('a grudge makes a wrestler want the match, not duck it', () => {
  // Wren carries a scar about Croft. Compare facing Croft with facing a
  // stranger of the same standing.
  const base = { timeLimitSec: 900, cardIndex: 3, cardLength: 5 };
  const grudge = regard(k.wren, { ...base, opponentIds: [k.croft] });
  const stranger = regard(k.wren, { ...base, opponentIds: [k.vance] });
  const line = grudge.reasons.find((r) => r.text.includes('something to settle'));
  assert(line, 'no grudge reason was given');
  assert(line.delta > 0, `the grudge made him want it less (${line.delta})`);
  return `"${line.text}" is worth ${line.delta > 0 ? '+' : ''}${line.delta}`;
});

check('being teamed with someone they dislike is held against you', () => {
  const together = regard(k.okonkwo, {
    opponentIds: [k.kane], partnerIds: [k.delacroix], formatKey: 'tag',
    timeLimitSec: 900, cardIndex: 3, cardLength: 5,
  });
  const line = together.reasons.find((r) => /does not want to be in a team/i.test(r.text));
  assert(line, 'teaming someone with a wrestler they resent drew no reaction');
  return `"${line.text}" (${line.delta})`;
});

console.log('\nlegibility and purity');

check('every judgement shows its working', () => {
  for (const w of store.allWrestlers()) {
    const r = regard(w.id, OPENER_VS_JOBBER);
    assert(r.reasons.length >= 2, `${w.name} got only ${r.reasons.length} reason(s)`);
    for (const reason of r.reasons) {
      assert(typeof reason.text === 'string' && reason.text.length > 5, 'an empty reason');
      assert(Number.isFinite(reason.delta), 'a reason with no weight');
    }
  }
  const sample = regard(k.croft, OPENER_VS_JOBBER);
  return `${W('croft').name}: ${sample.reasons.slice(0, 2).map((r) => `"${r.text}" ${r.delta}`).join(', ')}`;
});

check('asking how somebody feels changes nothing', () => {
  const before = JSON.stringify(store.getState());
  const logBefore = store.getState().log.length;
  for (const w of store.allWrestlers()) {
    regard(w.id, OPENER_VS_JOBBER);
    regard(w.id, { opponentIds: [k.croft], timeLimitSec: 1200, cardIndex: 4, cardLength: 5, titleId: titles.world.id });
  }
  eq(store.getState().log.length, logBefore, 'events were emitted');
  eq(JSON.stringify(store.getState()), before, 'state was mutated');
  return '28 judgements, no events, no state change';
});

check('a whole segment can be read at once', () => {
  const show = store.allShows()[0];
  const seg = store.bookSegment({
    showId: show.id, format: 'tag', kind: 'match', name: 'test',
    timeLimitSec: 900,
    participants: [
      { wrestlerId: k.croft, side: 'a' }, { wrestlerId: k.halloran, side: 'a' },
      { wrestlerId: k.lund, side: 'b' }, { wrestlerId: k.ruiz, side: 'b' },
    ],
  });
  const views = regardSegment(seg, { cardIndex: 0, cardLength: 4 });
  eq(views.length, 4, 'one view per participant');
  const byId = Object.fromEntries(views.map((v) => [v.wrestlerId, v]));
  assert(byId[k.croft].willingness < byId[k.ruiz].willingness,
    'the superstar is happier about this than the rookie');
  return views.map((v) => `${store.getWrestler(v.wrestlerId).shortName} ${v.willingness}`).join(', ');
});

console.log('\npersistence');

check('a v3 save migrates its statuses and traits forward', () => {
  const envelope = JSON.parse(persist.toJSON({ label: 'v3' }));
  envelope.schemaVersion = 3;
  const ids = Object.keys(envelope.state.wrestlers);
  // Rebuild a v3-shaped roster: old statuses, old trait list.
  envelope.state.wrestlers[ids[0]].standing.careerStatus = 'veteran';
  envelope.state.wrestlers[ids[1]].standing.careerStatus = 'declining';
  for (const w of Object.values(envelope.state.wrestlers)) {
    delete w.standing.trajectory;
    w.identity.traits = {
      professionalism: w.identity.traits.professionalism,
      volatility: w.identity.traits.volatility,
      loyalty: w.identity.traits.loyalty,
      vindictiveness: w.identity.traits.vindictiveness,
      sociability: w.identity.traits.sociability,
      riskAversion: 70,
    };
  }
  store.reset();
  persist.deserialize(envelope);
  const state = store.getState();
  eq(state.meta.schemaVersion, SCHEMA_VERSION, 'schema after migration');

  const wasVeteran = state.wrestlers[ids[0]];
  const wasDeclining = state.wrestlers[ids[1]];
  eq(wasVeteran.standing.careerStatus, CAREER_STATUS.UPPER_MIDCARD, 'veteran maps to');
  eq(wasDeclining.standing.careerStatus, CAREER_STATUS.LOWER_CARD, 'declining maps to');
  eq(wasDeclining.standing.trajectory, TRAJECTORY.DECLINING, 'declining keeps its direction');

  for (const w of Object.values(state.wrestlers)) {
    assert(w.identity.traits.riskAversion === undefined, 'riskAversion survived');
    eq(w.identity.traits.courage, 30, 'riskAversion 70 should invert to courage 30');
    for (const trait of TRAITS) {
      assert(Number.isFinite(w.identity.traits[trait]), `${w.name} missing ${trait} after migration`);
    }
  }
  const problems = checkState(state);
  assert(!problems.length, `migrated state is not sound:\n      - ${problems.join('\n      - ')}`);
  return `v3 -> v${SCHEMA_VERSION}, statuses remapped, riskAversion 70 inverted to courage 30`;
});

check('the invariant checker catches a bad status or a missing trait', () => {
  const state = store.getState();
  const w = Object.values(state.wrestlers)[0];
  const realStatus = w.standing.careerStatus;
  w.standing.careerStatus = 'jabroni';
  assert(checkState(state).some((p) => p.includes('unknown career status')), 'a bogus status went unnoticed');
  w.standing.careerStatus = realStatus;

  const realCourage = w.identity.traits.courage;
  delete w.identity.traits.courage;
  assert(checkState(state).some((p) => p.includes('missing the "courage" trait')), 'a missing trait went unnoticed');
  w.identity.traits.courage = realCourage;
  return 'unknown status and missing trait both reported';
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) { for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
