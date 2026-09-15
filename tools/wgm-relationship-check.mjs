// Tier 5 checks: relationships, the GM's own standing, and memory.
//
// Usage: node tools/wgm-relationship-check.mjs
import * as store from '../wrestling/js/core/store.js';
import * as persist from '../wrestling/js/core/persist.js';
import { SCHEMA_VERSION, MEMORY_LIMIT } from '../wrestling/js/core/store.js';
import * as runner from '../wrestling/js/systems/showRunner.js';
import { installSystems } from '../wrestling/js/systems/index.js';
import { seedRoster } from '../wrestling/js/data/roster.js';
import { seedTitles } from '../wrestling/js/data/titles.js';
import { checkState } from '../wrestling/js/core/invariants.js';
import { EVENT_TYPES } from '../wrestling/js/core/events.js';
import { FINISHES } from '../wrestling/js/models/segment.js';
import {
  AXES, describe, isRival, isAlly, RIVAL_THRESHOLD, HISTORY_LIMIT,
} from '../wrestling/js/models/relationship.js';
import { MEMORY_TYPES, MEMORY_KEYS, isKnownMemoryType } from '../wrestling/js/models/memory.js';
import { relationshipWith, rivalsOf, memoryWeightOn } from '../wrestling/js/models/wrestler.js';
import { establishHistory, crownChampion } from './lib/fixtures.mjs';

let passed = 0; const failures = [];
const check = (label, fn) => {
  try { const d = fn(); passed++; console.log(`  ok  ${label}${d ? `  ${d}` : ''}`); }
  catch (e) { failures.push(`${label}: ${e.message}`); console.log(`FAIL  ${label}\n      ${e.message}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`); };

installSystems();
store.newGame({ seed: 'relationships', gmName: 'R', brandName: 'T', scheduleBlocks: 3 });
const k = seedRoster();
establishHistory(store, k);
const titles = seedTitles(store);
crownChampion(store, titles.world.id, k.croft, 112);
crownChampion(store, titles.national.id, k.delacroix, 43);

const rel = (fromKey, toKey) => relationshipWith(store.getWrestler(k[fromKey]), k[toKey]);
const memOf = (key, type) => store.getWrestler(k[key]).memory.filter((m) => m.type === type);

function newShow() {
  const show = runner.currentShow();
  if (show && show.status === 'live') runner.goOffAir(show.id);
  if (!runner.nextWeek()) { store.scheduleProgramming(1); runner.nextWeek(); }
}

function playMatch(aId, bId, { titleId = null, winner = null, finish = null, limitMin = 15, format = 'singles', extra = [] } = {}) {
  const show = runner.currentShow();
  const participants = extra.length ? extra : [{ wrestlerId: aId, side: 'a' }, { wrestlerId: bId, side: 'b' }];
  const seg = store.bookSegment({
    showId: show.id, format, kind: 'match',
    name: `${store.nameOf(aId)} vs ${store.nameOf(bId)}`,
    timeLimitSec: limitMin * 60, titleId, participants,
  });
  if (show.status === 'scheduled') runner.goLive(show.id);
  if (finish) {
    const winners = winner ? [winner] : [];
    const losers = winner ? participants.map((p) => p.wrestlerId).filter((id) => id !== winner) : [];
    store.completeSegment(seg.id, {
      finish, winnerIds: winners, loserIds: losers,
      actualSec: limitMin * 60 - 40, quality: 70, overridden: true, beats: [],
    });
  } else {
    runner.runNext(show.id, { overrideWinnerSide: winner === aId ? 'a' : winner === bId ? 'b' : null });
  }
  return store.getSegment(seg.id);
}

console.log('\nTier 5: relationships and memory\n');
console.log('the four axes');

check('a relationship carries four independent axes', () => {
  eq(AXES.length, 4, 'axes');
  const r = rel('wren', 'croft');
  for (const axis of AXES) assert(Number.isFinite(r[axis]), `${axis} missing`);
  return AXES.map((a) => `${a} ${rel('wren', 'croft')[a]}`).join(', ');
});

check('the authored roster\'s shorthand fans out sensibly', () => {
  const r = rel('wren', 'croft');     // authored as -62
  eq(r.affinity, -62, 'affinity');
  assert(r.hostility > 40, `hostility is only ${r.hostility}`);
  assert(r.trust < 30, `trust is ${r.trust}, should be low toward someone he resents`);
  return `affinity ${r.affinity}, hostility ${r.hostility}, respect ${r.respect}, trust ${r.trust}`;
});

check('respect and liking are genuinely separable', () => {
  store.adjustRelationship(k.pike, k.croft, { respect: 45, affinity: -50 }, { reason: 'test' });
  const r = rel('pike', 'croft');
  assert(r.respect >= 90 && r.affinity <= -45, `respect ${r.respect}, affinity ${r.affinity}`);
  return `${describe(r)}: rates him at ${r.respect}, cannot stand him at ${r.affinity}`;
});

check('a relationship has a one-phrase description', () => {
  const phrases = new Set();
  for (const w of store.allWrestlers()) {
    for (const otherId of Object.keys(w.ties.relationships)) {
      phrases.add(describe(relationshipWith(w, otherId)));
    }
  }
  assert(phrases.size >= 3, `only ${phrases.size} distinct descriptions across the roster`);
  return [...phrases].join(', ');
});

console.log('\nwhat a match does to the people in it');

check('losing raises the winner\'s standing in the loser\'s eyes', () => {
  const before = { ...rel('kovac', 'okonkwo') };
  playMatch(k.okonkwo, k.kovac, { winner: k.okonkwo, finish: FINISHES.PINFALL });
  const after = rel('kovac', 'okonkwo');
  assert(after.respect > before.respect, `respect ${before.respect} -> ${after.respect}`);
  assert(after.hostility > before.hostility, `hostility ${before.hostility} -> ${after.hostility}`);
  return `respect ${before.respect} -> ${after.respect}, hostility ${before.hostility} -> ${after.hostility}`;
});

check('losing to someone beneath you costs respect instead of earning it', () => {
  newShow();
  const before = { ...rel('croft', 'lund') };
  playMatch(k.croft, k.lund, { winner: k.lund, finish: FINISHES.PINFALL });
  const after = rel('croft', 'lund');
  assert(after.respect < before.respect, `respect ${before.respect} -> ${after.respect}, should fall`);
  assert(after.hostility - before.hostility > 8, `hostility only moved ${after.hostility - before.hostility}`);
  const mem = memOf('croft', MEMORY_TYPES.UPSET_LOSS.key);
  assert(mem.length > 0, 'no upset-loss memory');
  return `respect ${before.respect} -> ${after.respect}, hostility +${after.hostility - before.hostility}`;
});

check('relationships are directed, so one man can carry it alone', () => {
  const his = rel('croft', 'lund');
  const theirs = rel('lund', 'croft');
  assert(his.hostility !== theirs.hostility, 'both sides moved identically');
  return `Croft toward Lund ${his.hostility} hostility, Lund toward Croft ${theirs.hostility}`;
});

check('vindictiveness decides how much a loss is held against someone', () => {
  // Both losses on the same card, so no week of cooling separates them and the
  // only difference left is the person taking the loss.
  newShow();
  const beforeMabry = rel('mabry', 'kane').hostility;   // vindictiveness 80
  playMatch(k.kane, k.mabry, { winner: k.kane, finish: FINISHES.PINFALL });
  const mabry = rel('mabry', 'kane').hostility - beforeMabry;

  const beforePike = rel('pike', 'kane').hostility;     // vindictiveness 18
  playMatch(k.kane, k.pike, { winner: k.kane, finish: FINISHES.PINFALL });
  const pike = rel('pike', 'kane').hostility - beforePike;

  assert(mabry > pike, `vindictive ${mabry} vs professional ${pike}`);
  return `Mabry (vindictiveness 80) +${mabry} hostility, Pike (18) +${pike} from the same loss`;
});

check('a disqualification is remembered as being cheated', () => {
  newShow();
  const before = { ...rel('sparrow', 'delacroix') };
  playMatch(k.delacroix, k.sparrow, { winner: k.sparrow, finish: FINISHES.DQ });
  const after = rel('sparrow', 'delacroix');
  assert(after.trust < before.trust - 10, `trust ${before.trust} -> ${after.trust}`);
  assert(after.hostility > before.hostility + 10, `hostility ${before.hostility} -> ${after.hostility}`);
  const mem = memOf('sparrow', MEMORY_TYPES.CHEATED.key);
  assert(mem.length > 0, 'no cheated memory written');
  return `"${mem[mem.length - 1].summary}" - trust ${before.trust} -> ${after.trust}`;
});

check('a time-limit draw raises respect and leaves heat behind', () => {
  newShow();
  const before = { ...rel('vance', 'kane') };
  playMatch(k.vance, k.kane, { finish: FINISHES.TIME_LIMIT_DRAW });
  const after = rel('vance', 'kane');
  assert(after.respect > before.respect, `respect ${before.respect} -> ${after.respect}`);
  assert(after.hostility > before.hostility, `hostility ${before.hostility} -> ${after.hostility}`);
  return `respect +${after.respect - before.respect}, hostility +${after.hostility - before.hostility}`;
});

check('winning a tag match together brings partners closer', () => {
  newShow();
  const before = { ...rel('ruiz', 'bloom') };
  playMatch(k.ruiz, k.lund, {
    format: 'tag', winner: k.ruiz, finish: FINISHES.PINFALL,
    extra: [
      { wrestlerId: k.ruiz, side: 'a' }, { wrestlerId: k.bloom, side: 'a' },
      { wrestlerId: k.lund, side: 'b' }, { wrestlerId: k.mabry, side: 'b' },
    ],
  });
  const after = rel('ruiz', 'bloom');
  assert(after.affinity > before.affinity, `affinity ${before.affinity} -> ${after.affinity}`);
  assert(after.trust > before.trust, `trust ${before.trust} -> ${after.trust}`);
  return `affinity +${after.affinity - before.affinity}, trust +${after.trust - before.trust}`;
});

check('losing alongside someone you already resent confirms it', () => {
  newShow();
  const before = { ...rel('okonkwo', 'delacroix') };   // authored at -68
  playMatch(k.okonkwo, k.kane, {
    format: 'tag', winner: k.kane, finish: FINISHES.PINFALL,
    extra: [
      { wrestlerId: k.okonkwo, side: 'a' }, { wrestlerId: k.delacroix, side: 'a' },
      { wrestlerId: k.kane, side: 'b' }, { wrestlerId: k.pike, side: 'b' },
    ],
  });
  const after = rel('okonkwo', 'delacroix');
  assert(after.affinity < before.affinity, `affinity ${before.affinity} -> ${after.affinity}`);
  const mem = memOf('okonkwo', MEMORY_TYPES.TEAMED_BADLY.key);
  assert(mem.length > 0, 'no teamed-badly memory');
  return `"${mem[mem.length - 1].summary}"`;
});

console.log('\nrelationship history');

check('a relationship records what moved it, and stays bounded', () => {
  const r = rel('croft', 'lund');
  assert(r.history.length > 0, 'nothing recorded');
  const entry = r.history[r.history.length - 1];
  assert(entry.summary, 'a history entry with no summary');
  assert(entry.eventId, 'a history entry not linked to its event');
  assert(Object.keys(entry.deltas).length > 0, 'a history entry recording no change');
  for (const w of store.allWrestlers()) {
    for (const [, x] of Object.entries(w.ties.relationships)) {
      assert(x.history.length <= HISTORY_LIMIT, `history grew to ${x.history.length}`);
    }
  }
  return `"${entry.summary}" ${JSON.stringify(entry.deltas)}, capped at ${HISTORY_LIMIT}`;
});

check('nothing is logged when nothing actually moved', () => {
  const before = store.getState().log.length;
  // Kane already sits at maximum trust toward nobody; push an axis that is
  // already clamped and confirm the log stays quiet.
  store.adjustRelationship(k.kane, k.pike, { respect: 0, affinity: 0 }, { reason: 'no-op' });
  eq(store.getState().log.length, before, 'an empty change was logged');
  return 'a clamped or zero change emits no event';
});

console.log('\nthe GM is a character too');

check('cutting someone from the card costs trust and is remembered', () => {
  newShow();
  const show = runner.currentShow();
  const seg = store.bookSegment({
    showId: show.id, format: 'singles', kind: 'match', name: 'to be cut',
    timeLimitSec: 600,
    participants: [{ wrestlerId: k.halloran, side: 'a' }, { wrestlerId: k.lund, side: 'b' }],
  });
  const before = { ...store.getWrestler(k.halloran).ties.gm };
  store.cutSegment(seg.id, { reason: 'Cut for time' });
  const after = store.getWrestler(k.halloran).ties.gm;
  assert(after.trust < before.trust, `trust ${before.trust} -> ${after.trust}`);
  const mem = memOf('halloran', MEMORY_TYPES.CUT_FROM_SHOW.key);
  assert(mem.length > 0, 'no cut memory');
  return `"${mem[0].summary}" - trust ${before.trust} -> ${after.trust}`;
});

check('a title shot buys goodwill from whoever gets it', () => {
  const contenderId = store.getTitle(titles.world.id).contenderId;
  const before = { ...store.getWrestler(k.kane).ties.gm };
  playMatch(championIdOf(titles.world.id), k.kane, {
    titleId: titles.world.id, winner: championIdOf(titles.world.id), finish: FINISHES.PINFALL,
  });
  const after = store.getWrestler(k.kane).ties.gm;
  assert(after.trust > before.trust, `trust ${before.trust} -> ${after.trust}`);
  const mem = memOf('kane', MEMORY_TYPES.TITLE_SHOT.key);
  assert(mem.length > 0, 'no title-shot memory');
  return `"${mem[0].summary}" - trust ${before.trust} -> ${after.trust}`;
});

function championIdOf(titleId) {
  const t = store.getTitle(titleId);
  const reign = t.lineage[t.lineage.length - 1];
  return reign && reign.lostOnDay == null ? reign.wrestlerIds[0] : null;
}

check('passing over the #1 contender is noticed by the contender', () => {
  newShow();
  const title = store.getTitle(titles.world.id);
  const contenderId = title.contenderId;
  assert(contenderId, 'no contender to pass over');
  const champ = championIdOf(titles.world.id);
  const bypass = store.allWrestlers().find((w) =>
    w.id !== contenderId && w.id !== champ)?.id;
  const before = { ...store.getWrestler(contenderId).ties.gm };

  playMatch(champ, bypass, { titleId: titles.world.id, winner: champ, finish: FINISHES.PINFALL });

  const after = store.getWrestler(contenderId).ties.gm;
  // A GM who has already destroyed somebody's faith completely has nothing left
  // to take; what matters either way is that it is recorded and aimed somewhere.
  assert(after.trust < before.trust || before.trust === 0,
    `contender trust ${before.trust} -> ${after.trust}`);
  const w = store.getWrestler(contenderId);
  const mem = w.memory.filter((m) => m.type === MEMORY_TYPES.TITLE_SHOT_DENIED.key);
  assert(mem.length > 0, 'no denied-shot memory');
  // And the jealousy points at the person who got it, not only at the office.
  const towardBypass = relationshipWith(w, bypass);
  assert(towardBypass.hostility > 0, 'no heat toward whoever took the spot');
  return `${w.name}: "${mem[0].summary}", ${towardBypass.hostility} hostility toward ${store.nameOf(bypass)}`;
});

check('being left off television repeatedly is remembered', () => {
  // Run several shows with a tiny card so most of the roster sits at home.
  for (let i = 0; i < 4; i++) {
    newShow();
    playMatch(k.lund, k.ruiz, { winner: k.lund, finish: FINISHES.PINFALL, limitMin: 8 });
  }
  const overlooked = store.allWrestlers()
    .map((w) => ({ w, m: w.memory.filter((x) => x.type === MEMORY_TYPES.OVERLOOKED.key) }))
    .filter(({ m }) => m.length > 0);
  assert(overlooked.length > 0, 'nobody noticed being left off four shows running');
  const worst = overlooked.sort((a, b) => b.m.length - a.m.length)[0];
  return `${overlooked.length} wrestlers noticed; ${worst.w.name}: "${worst.m[worst.m.length - 1].summary}"`;
});

console.log('\nthe memory system');

check('the memory vocabulary is closed and checked', () => {
  assert(MEMORY_KEYS.length >= 20, `only ${MEMORY_KEYS.length} memory kinds`);
  assert(isKnownMemoryType('title_loss'), 'title_loss is not registered');
  assert(!isKnownMemoryType('made_up_thing'), 'an unregistered type was accepted');
  const state = store.getState();
  const w = Object.values(state.wrestlers).find((x) => x.memory.length);
  const realType = w.memory[0].type;
  w.memory[0].type = 'made_up_thing';
  const caught = checkState(state).some((p) => p.includes('unknown type'));
  w.memory[0].type = realType;
  assert(caught, 'an unknown memory type went unreported');
  return `${MEMORY_KEYS.length} registered kinds, unknown types rejected`;
});

check('a title changing hands writes the heaviest memories on both men', () => {
  newShow();
  const champ = championIdOf(titles.world.id);
  const challenger = store.allWrestlers().find((w) => w.id !== champ).id;
  playMatch(champ, challenger, { titleId: titles.world.id, winner: challenger, finish: FINISHES.PINFALL });
  const winMem = store.getWrestler(challenger).memory.filter((m) => m.type === MEMORY_TYPES.TITLE_WIN.key);
  const lossMem = store.getWrestler(champ).memory.filter((m) => m.type === MEMORY_TYPES.TITLE_LOSS.key);
  assert(winMem.length > 0, 'the new champion does not remember winning it');
  assert(lossMem.length > 0, 'the former champion does not remember losing it');
  assert(lossMem[0].scar && winMem[0].scar, 'a title change should scar both men');
  return `"${lossMem[0].summary}"`;
});

check('every event kind you asked to be remembered is either written or reserved', () => {
  const written = new Set();
  for (const w of store.allWrestlers()) for (const m of w.memory) written.add(m.type);
  const live = ['win', 'loss', 'upset_loss', 'cheated', 'title_win', 'title_loss',
    'title_shot', 'title_shot_denied', 'cut_from_show', 'overlooked'];
  const missing = live.filter((t) => !written.has(t));
  assert(!missing.length, `these should be written by play but are not: ${missing.join(', ')}`);
  const reserved = ['betrayal', 'save', 'gm_promise_broken', 'suspension']
    .filter((t) => isKnownMemoryType(t));
  return `written by play: ${live.length}; reserved with no system yet: ${reserved.join(', ')}`;
});

check('memory decays but scars hold', () => {
  const w = store.allWrestlers().find((x) => x.memory.some((m) => m.scar));
  const scar = w.memory.find((m) => m.scar);
  const ordinary = w.memory.find((m) => !m.scar);
  const far = 3000;
  assert(memoryWeightOn(scar, scar.day + far) >= 40, `a scar decayed to ${memoryWeightOn(scar, scar.day + far)}`);
  if (ordinary) {
    assert(memoryWeightOn(ordinary, ordinary.day + far) < memoryWeightOn(scar, scar.day + far),
      'an ordinary memory outlasted a scar');
  }
  return `${w.name}: scar settles at ${scar.floor}, ordinary at ${ordinary?.floor ?? '-'}`;
});

check('memory is capped, and scars survive the cull', () => {
  const victim = store.getWrestler(k.pike);
  const scarsBefore = victim.memory.filter((m) => m.scar).length;
  for (let i = 0; i < MEMORY_LIMIT + 20; i++) {
    store.addMemory(k.pike, { type: 'win', summary: `filler ${i}`, aboutIds: [] });
  }
  assert(victim.memory.length <= MEMORY_LIMIT, `memory grew to ${victim.memory.length}`);
  eq(victim.memory.filter((m) => m.scar).length, scarsBefore, 'a scar was pruned');
  return `capped at ${MEMORY_LIMIT}, ${scarsBefore} scars untouched`;
});

console.log('\nrivalries emerge from play');

check('repeated meetings turn into real heat without anyone authoring it', () => {
  // Two wrestlers with no authored relationship at all, put in a ring together
  // repeatedly with one of them going over each time.
  const a = k.sparrow, b = k.bloom;
  const startRel = relationshipWith(store.getWrestler(b), a);
  const startHostility = startRel.hostility;
  for (let i = 0; i < 5; i++) {
    newShow();
    playMatch(a, b, { winner: a, finish: i === 3 ? FINISHES.DQ : FINISHES.PINFALL });
  }
  const end = relationshipWith(store.getWrestler(b), a);
  assert(end.hostility > startHostility + 25,
    `hostility went ${startHostility} -> ${end.hostility}, not enough for a feud`);
  assert(isRival(end), `hostility ${end.hostility} is below the rivalry threshold of ${RIVAL_THRESHOLD}`);
  return `${store.nameOf(b)} toward ${store.nameOf(a)}: hostility ${startHostility} -> ${end.hostility}, "${describe(end)}"`;
});

check('rivalries are readable off the roster', () => {
  const withRivals = store.allWrestlers().filter((w) => rivalsOf(w).length > 0);
  assert(withRivals.length > 0, 'nobody on the roster has a rivalry');
  const sample = withRivals[0];
  return `${withRivals.length} wrestlers carry at least one live rivalry, e.g. ${sample.name} -> ${rivalsOf(sample).map(store.nameOf).join(', ')}`;
});

console.log('\nintegrity and persistence');

check('the world is sound with four-axis relationships in it', () => {
  const problems = checkState(store.getState());
  assert(!problems.length, `\n      - ${problems.join('\n      - ')}`);
  const rels = store.allWrestlers().reduce((t, w) => t + Object.keys(w.ties.relationships).length, 0);
  const mems = store.allWrestlers().reduce((t, w) => t + w.memory.length, 0);
  return `${rels} relationships, ${mems} memories, ${store.getState().log.length} events, no problems`;
});

check('a bad axis value is caught', () => {
  const state = store.getState();
  const w = Object.values(state.wrestlers).find((x) => Object.keys(x.ties.relationships).length);
  const otherId = Object.keys(w.ties.relationships)[0];
  w.ties.relationships[otherId].hostility = 400;
  const caught = checkState(state).some((p) => p.includes('hostility is 400'));
  w.ties.relationships[otherId].hostility = 50;
  assert(caught, 'an out-of-range axis went unreported');
  return 'out-of-range axis values are reported';
});

check('relationships and memory survive a save and load', () => {
  const before = store.allWrestlers().map((w) =>
    `${w.id}:${Object.entries(w.ties.relationships).map(([id, r]) => `${id}/${r.affinity}/${r.hostility}/${r.respect}/${r.trust}`).join('|')}:${w.memory.length}`).join(';');
  const json = persist.toJSON({ label: 'rel' });
  store.reset();
  persist.fromJSON(json);
  const after = store.allWrestlers().map((w) =>
    `${w.id}:${Object.entries(w.ties.relationships).map(([id, r]) => `${id}/${r.affinity}/${r.hostility}/${r.respect}/${r.trust}`).join('|')}:${w.memory.length}`).join(';');
  eq(after, before, 'relationships or memory differ after reload');
  return 'every axis and every memory restored exactly';
});

check('a v4 save fans its single values out into four axes', () => {
  const envelope = JSON.parse(persist.toJSON({ label: 'v4' }));
  envelope.schemaVersion = 4;
  const ids = Object.keys(envelope.state.wrestlers);
  for (const w of Object.values(envelope.state.wrestlers)) {
    w.ties.relationships = {};
  }
  envelope.state.wrestlers[ids[0]].ties.relationships[ids[1]] = {
    value: -60, lastChangedDay: 3, sourceEventIds: [],
  };
  envelope.state.wrestlers[ids[2]].ties.relationships[ids[3]] = {
    value: 50, lastChangedDay: 3, sourceEventIds: [],
  };
  store.reset();
  persist.deserialize(envelope);
  const state = store.getState();
  eq(state.meta.schemaVersion, SCHEMA_VERSION, 'schema after migration');
  const hostile = state.wrestlers[ids[0]].ties.relationships[ids[1]];
  const friendly = state.wrestlers[ids[2]].ties.relationships[ids[3]];
  eq(hostile.affinity, -60, 'affinity carried over');
  assert(hostile.hostility > 40, `hostility inferred as ${hostile.hostility}`);
  assert(hostile.trust < 30, `trust inferred as ${hostile.trust}`);
  eq(friendly.hostility, 0, 'a positive relationship should carry no heat');
  assert(friendly.trust > 60, `trust inferred as ${friendly.trust}`);
  const problems = checkState(state);
  assert(!problems.length, `migrated state is not sound:\n      - ${problems.join('\n      - ')}`);
  return `v4 -> v${SCHEMA_VERSION}: -60 became affinity -60 / hostility ${hostile.hostility} / trust ${hostile.trust}`;
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) { for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
