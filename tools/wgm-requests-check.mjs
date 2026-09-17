// Tier 6 checks: satisfaction, wants, and the requests they turn into.
//
// The rule under test: a request comes from the record, never from a dice roll.
// Every one has to be traceable to a ranking, a memory, a relationship, a pay
// packet or a card position.
//
// Usage: node tools/wgm-requests-check.mjs
import * as store from '../wrestling/js/core/store.js';
import * as persist from '../wrestling/js/core/persist.js';
import { SCHEMA_VERSION } from '../wrestling/js/core/store.js';
import * as runner from '../wrestling/js/systems/showRunner.js';
import { installSystems } from '../wrestling/js/systems/index.js';
import { seedRoster } from '../wrestling/js/data/roster.js';
import { seedTitles } from '../wrestling/js/data/titles.js';
import { checkState } from '../wrestling/js/core/invariants.js';
import { EVENT_TYPES } from '../wrestling/js/core/events.js';
import { FINISHES } from '../wrestling/js/models/segment.js';
import { MEMORY_TYPES } from '../wrestling/js/models/memory.js';
import {
  REQUEST_KINDS, REQUEST_STATUS, PERSON_KINDS,
} from '../wrestling/js/models/request.js';
import {
  satisfactionOf, DIMENSIONS, championshipAmbition, moraleTarget,
} from '../wrestling/js/systems/satisfaction.js';
import {
  wantsOf, voicedWantsOf, voiceThreshold, generateRequests, denyRequest,
  MAX_OPEN_PER_WRESTLER, MAX_NEW_PER_SHOW,
} from '../wrestling/js/systems/requests.js';
import { statusRank } from '../wrestling/js/models/wrestler.js';
import { establishHistory, crownChampion } from './lib/fixtures.mjs';

let passed = 0; const failures = [];
const check = (label, fn) => {
  try { const d = fn(); passed++; console.log(`  ok  ${label}${d ? `  ${d}` : ''}`); }
  catch (e) { failures.push(`${label}: ${e.message}`); console.log(`FAIL  ${label}\n      ${e.message}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`); };

installSystems();
store.newGame({ seed: 'requests', gmName: 'Q', brandName: 'T', scheduleBlocks: 4 });
const k = seedRoster();
establishHistory(store, k);
const titles = seedTitles(store);
crownChampion(store, titles.world.id, k.croft, 112);
crownChampion(store, titles.national.id, k.delacroix, 43);

function runShow(book) {
  const show = runner.currentShow();
  book(show);
  if (show.segmentIds.length) {
    runner.goLive(show.id);
    runner.runRest(show.id);
  }
  runner.goOffAir(show.id);
  if (!runner.nextWeek()) { store.scheduleProgramming(1); runner.nextWeek(); }
  return show;
}
const single = (showId, a, b, min = 12, extra = {}) => store.bookSegment({
  showId, format: 'singles', kind: 'match', name: `${store.nameOf(a)} vs ${store.nameOf(b)}`,
  timeLimitSec: min * 60, participants: [{ wrestlerId: a, side: 'a' }, { wrestlerId: b, side: 'b' }], ...extra,
});

console.log('\nTier 6: morale, wants and complaints\n');
console.log('satisfaction');

check('satisfaction has six dimensions, each showing its working', () => {
  const s = satisfactionOf(k.croft);
  eq(Object.keys(s.dimensions).length, 6, 'dimensions');
  for (const key of DIMENSIONS) {
    assert(Number.isFinite(s.dimensions[key].score), `${key} has no score`);
    assert(s.dimensions[key].reasons.length > 0, `${key} gives no reasons`);
  }
  assert(Number.isFinite(s.overall), 'no overall');
  return DIMENSIONS.map((d) => `${d} ${Math.round(s.dimensions[d].score)}`).join(', ');
});

check('being used well scores better than being ignored', () => {
  // Three weeks where one man main-events every week and another never appears.
  for (let i = 0; i < 3; i++) {
    runShow((show) => {
      single(show.id, k.lund, k.ruiz, 6);
      single(show.id, k.okonkwo, k.kane, 18);
    });
  }
  const used = satisfactionOf(k.okonkwo);
  const ignored = satisfactionOf(k.bloom);
  assert(used.dimensions.booking.score > ignored.dimensions.booking.score + 20,
    `used ${used.dimensions.booking.score} vs ignored ${ignored.dimensions.booking.score}`);
  return `${store.nameOf(k.okonkwo)} booking ${Math.round(used.dimensions.booking.score)}, ${store.nameOf(k.bloom)} ${Math.round(ignored.dimensions.booking.score)}`;
});

check('television-time expectations scale with standing', () => {
  const star = satisfactionOf(k.croft).dimensions.tvTime.reasons[0];
  const rookie = satisfactionOf(k.ruiz).dimensions.tvTime.reasons[0];
  const wants = (t) => Number(String(t).match(/expects about (\d+)/)?.[1] ?? 0);
  assert(wants(star) > wants(rookie), `${wants(star)} vs ${wants(rookie)}`);
  return `a superstar expects ${wants(star)} minutes, a rookie ${wants(rookie)}`;
});

check('pay is judged against people at the same level', () => {
  const s = satisfactionOf(k.halloran).dimensions.contract;
  assert(s.reasons.some((r) => /others at their level|roster median/.test(r)), 'no comparison made');
  const rich = satisfactionOf(k.halloran).dimensions.contract.score;
  const poor = satisfactionOf(k.mabry).dimensions.contract.score;
  assert(rich !== poor, 'two very differently paid wrestlers scored identically');
  return `${store.nameOf(k.halloran)} ${Math.round(rich)}, ${store.nameOf(k.mabry)} ${Math.round(poor)}`;
});

check('championship ambition picks a belt they could plausibly hold', () => {
  const star = championshipAmbition(k.croft);
  const jobber = championshipAmbition(k.lund);
  assert(star && jobber, 'no ambition computed');
  eq(store.getTitle(star.titleId).tier, 'world', 'a superstar chases');
  assert(store.getTitle(jobber.titleId).tier !== 'world', 'a jobber should not be chasing the world title');
  return `${store.nameOf(k.croft)} -> ${store.getTitle(star.titleId).shortName}, ${store.nameOf(k.lund)} -> ${store.getTitle(jobber.titleId).shortName}`;
});

check('morale settles toward satisfaction rather than drifting', () => {
  const id = k.bloom;
  const w = store.getWrestler(id);
  const target = moraleTarget(id);
  store.updateWrestlerState(id, { morale: 95 }, { reason: 'test spike' });
  for (let i = 0; i < 3; i++) {
    runShow((show) => single(show.id, k.lund, k.ruiz, 6));
  }
  const after = store.getWrestler(id).state.morale;
  assert(after < 95, `morale stayed at ${after} despite a target of ${target}`);
  return `spiked to 95, settled to ${Math.round(after)} against a target near ${target}`;
});

console.log('\nwanting something, and saying it');

check('standing decides who speaks up', () => {
  const rookie = voiceThreshold(store.getWrestler(k.ruiz));
  const star = voiceThreshold(store.getWrestler(k.croft));
  assert(rookie > star + 20, `rookie ${Math.round(rookie)} vs superstar ${Math.round(star)}`);
  return `${store.nameOf(k.ruiz)} speaks at ${Math.round(rookie)}, ${store.nameOf(k.croft)} at ${Math.round(star)}`;
});

check('a rookie keeps wants to themselves that a star would voice', () => {
  const quiet = store.allWrestlers().filter((w) => {
    const th = voiceThreshold(w);
    return wantsOf(w.id).length > voicedWantsOf(w.id).length && statusRank(w) <= 1;
  });
  assert(quiet.length > 0, 'nobody on the lower card is swallowing anything');
  const w = quiet[0];
  const held = wantsOf(w.id).filter((x) => x.strength < voiceThreshold(w));
  return `${w.name} is sitting on ${held.length} want(s), the loudest at ${Math.round(held[0].strength)} against a threshold of ${Math.round(voiceThreshold(w))}`;
});

check('every want carries reasons drawn from the record', () => {
  let checked = 0;
  for (const w of store.allWrestlers()) {
    for (const want of wantsOf(w.id)) {
      assert(want.reasons.length > 0, `${w.name}'s ${want.kind} has no reasons`);
      for (const r of want.reasons) assert(typeof r === 'string' && r.length > 4, 'an empty reason');
      assert(want.text && want.text.includes(w.name), `${want.kind} has no readable text`);
      checked++;
    }
  }
  assert(checked > 10, `only ${checked} wants across the roster`);
  return `${checked} wants, all with stated reasons`;
});

check('wants are deterministic, not rolled', () => {
  const once = store.allWrestlers().map((w) =>
    wantsOf(w.id).map((x) => `${x.kind}:${Math.round(x.strength)}:${x.targetId || ''}`).join('|')).join(';');
  const twice = store.allWrestlers().map((w) =>
    wantsOf(w.id).map((x) => `${x.kind}:${Math.round(x.strength)}:${x.targetId || ''}`).join('|')).join(';');
  eq(twice, once, 'the same world produced different wants');
  return 'the same world state produces the same wants every time';
});

check('a title shot is only asked for by somebody with a case', () => {
  const asking = store.allWrestlers()
    .map((w) => ({ w, want: voicedWantsOf(w.id).find((x) => x.kind === REQUEST_KINDS.TITLE_SHOT) }))
    .filter((x) => x.want);
  for (const { w } of asking) {
    assert(w.standing.rank != null && w.standing.rank <= 8,
      `${w.name} is ranked #${w.standing.rank} and asking for a title shot`);
  }
  return asking.length
    ? asking.map(({ w }) => `${w.shortName} #${w.standing.rank}`).join(', ')
    : 'nobody currently has a case';
});

check('a grudge produces a request to face the person it is about', () => {
  const want = wantsOf(k.mabry).find((x) => x.kind === REQUEST_KINDS.MATCH_WITH);
  assert(want, `${store.nameOf(k.mabry)} has a humiliation memory and wants nothing from it`);
  eq(want.targetId, k.croft, 'the request points at');
  assert(want.reasons[0].includes('forty seconds'), `reason was "${want.reasons[0]}"`);
  return `"${want.text}" because "${want.reasons[0]}"`;
});

check('distrust produces a request to avoid, not to face', () => {
  // Sparrow is cheated by somebody she cannot fight back against.
  const shy = store.getWrestler(k.pike);   // aggression 20, courage 60
  store.adjustRelationship(k.pike, k.delacroix, { trust: -40, respect: -20, hostility: 10 },
    { reason: 'test: soured on them' });
  const want = wantsOf(k.pike).find((x) => x.kind === REQUEST_KINDS.AVOID);
  assert(want, 'low trust and low aggression produced no avoid request');
  eq(want.targetId, k.delacroix, 'avoid target');
  return `"${want.text}"`;
});

check('an aggressive wrestler asks to face their rival instead of ducking them', () => {
  store.adjustRelationship(k.vance, k.delacroix, { hostility: 70 }, { reason: 'test: bad blood' });
  const want = wantsOf(k.vance).find((x) => x.kind === REQUEST_KINDS.FACE_RIVAL);
  assert(want, 'high hostility and high aggression produced no face-rival request');
  eq(want.targetId, k.delacroix, 'rival');
  const avoid = wantsOf(k.vance).find((x) => x.kind === REQUEST_KINDS.AVOID);
  assert(!avoid || avoid.targetId !== k.delacroix, 'the same person is both faced and avoided');
  return `"${want.text}"`;
});

check('affinity and trust produce a request to team up', () => {
  const want = store.allWrestlers()
    .flatMap((w) => wantsOf(w.id))
    .find((x) => x.kind === REQUEST_KINDS.TAG_WITH);
  assert(want, 'nobody wants a partner');
  assert(want.targetId && store.getWrestler(want.targetId), 'the partner is not a real wrestler');
  return `"${want.text}"`;
});

check('a request about a person always names a real one', () => {
  generateRequests();
  for (const r of store.allRequests()) {
    if (!PERSON_KINDS.includes(r.kind)) continue;
    assert(r.targetId && store.getWrestler(r.targetId), `${r.kind} points at ${r.targetId}`);
  }
  return `${store.allRequests().length} requests made so far, all pointing at real people`;
});

console.log('\ngranting, refusing, ignoring');

check('booking what they asked for grants it and pays them back', () => {
  const open = store.openRequests().find((r) => r.kind === REQUEST_KINDS.MATCH_WITH || r.kind === REQUEST_KINDS.FACE_RIVAL);
  assert(open, 'no person-request open to grant');
  const w = store.getWrestler(open.wrestlerId);
  const before = { trust: w.ties.gm.trust, morale: w.state.morale };

  const show = runner.currentShow();
  single(show.id, open.wrestlerId, open.targetId, 14);

  const after = store.getRequest(open.id);
  eq(after.status, REQUEST_STATUS.GRANTED, 'status after booking it');
  const now = store.getWrestler(open.wrestlerId);
  assert(now.ties.gm.trust > before.trust, `trust ${before.trust} -> ${now.ties.gm.trust}`);
  const mem = now.memory.filter((m) => m.type === MEMORY_TYPES.REQUEST_GRANTED.key);
  assert(mem.length > 0, 'no memory of getting what they asked for');
  return `${w.name}: trust ${before.trust} -> ${now.ties.gm.trust}, "${mem[mem.length - 1].summary}"`;
});

check('refusing to their face costs less than never answering', () => {
  // Two requests of identical urgency from two people, so the only difference
  // being measured is how the GM handled it.
  const mk = (wrestlerId) => store.makeRequestFor({
    wrestlerId, kind: REQUEST_KINDS.MORE_TV_TIME,
    urgency: 60, strength: 60, reasons: ['test'], text: 'test ask',
  });
  const refused = mk(k.kane);
  const silent = mk(k.sparrow);

  const beforeRefused = store.getWrestler(k.kane).ties.gm.trust;
  denyRequest(refused.id, { reason: 'test denial' });
  const deniedCost = beforeRefused - store.getWrestler(k.kane).ties.gm.trust;

  const beforeSilent = store.getWrestler(k.sparrow).ties.gm.trust;
  runShow(() => {});   // never answered
  const ignoredCost = beforeSilent - store.getWrestler(k.sparrow).ties.gm.trust;

  eq(store.getRequest(refused.id).status, REQUEST_STATUS.DENIED, 'denied status');
  eq(store.getRequest(silent.id).status, REQUEST_STATUS.IGNORED, 'ignored status');
  assert(ignoredCost > deniedCost, `same urgency: denial cost ${deniedCost}, silence cost ${ignoredCost}`);
  return `at equal urgency, telling them no cost ${deniedCost} trust and silence cost ${ignoredCost}`;
});

check('being ignored makes somebody ask again, louder', () => {
  const ignored = store.allRequests().filter((r) => r.status === REQUEST_STATUS.IGNORED);
  assert(ignored.length > 0, 'nothing has been ignored yet');
  const sample = ignored[0];
  const again = wantsOf(sample.wrestlerId).find((x) => x.kind === sample.kind);
  if (!again) return 'the want has since been satisfied by other means';
  assert(again.strength >= sample.strength - 5, `re-ask is weaker: ${sample.strength} -> ${again.strength}`);
  return `${store.nameOf(sample.wrestlerId)}'s ${sample.kind} came back at ${Math.round(again.strength)} after ${sample.strength}`;
});

check('a straight refusal buys the GM some peace', () => {
  const denied = store.allRequests().find((r) => r.status === REQUEST_STATUS.DENIED);
  assert(denied, 'nothing has been denied');
  generateRequests();
  const reasked = store.openRequests().some((r) =>
    r.wrestlerId === denied.wrestlerId && r.kind === denied.kind);
  assert(!reasked, 'they asked again immediately after being told no');
  return 'nobody re-asks straight after a refusal';
});

check('booking the very thing they asked to avoid is worse than silence', () => {
  const w = store.getWrestler(k.pike);
  const request = store.makeRequestFor({
    wrestlerId: k.pike, kind: REQUEST_KINDS.AVOID, targetId: k.delacroix,
    urgency: 70, strength: 70, reasons: ['test'], text: 'test avoid',
  });
  const before = w.ties.gm.trust;
  const show = runner.currentShow();
  single(show.id, k.pike, k.delacroix, 10);
  const after = store.getRequest(request.id);
  eq(after.status, REQUEST_STATUS.IGNORED, 'status after booking it anyway');
  assert(store.getWrestler(k.pike).ties.gm.trust < before, 'it cost nothing');
  return `booked against the person they asked to avoid, trust ${before} -> ${store.getWrestler(k.pike).ties.gm.trust}`;
});

console.log('\nthe inbox stays manageable');

check('nobody floods the GM', () => {
  for (const w of store.allWrestlers()) {
    const open = store.openRequestsFor(w.id);
    assert(open.length <= MAX_OPEN_PER_WRESTLER,
      `${w.name} has ${open.length} open requests`);
  }
  return `at most ${MAX_OPEN_PER_WRESTLER} open per wrestler`;
});

check('a single show produces a readable number of new requests', () => {
  const before = store.allRequests().length;
  runShow((show) => single(show.id, k.kane, k.pike, 12));
  const made = store.allRequests().length - before;
  assert(made <= MAX_NEW_PER_SHOW, `${made} new requests in one week`);
  return `${made} new requests after a show, capped at ${MAX_NEW_PER_SHOW}`;
});

console.log('\nintegrity and persistence');

check('the world is sound with requests in it', () => {
  const problems = checkState(store.getState());
  assert(!problems.length, `\n      - ${problems.join('\n      - ')}`);
  const byStatus = {};
  for (const r of store.allRequests()) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  return Object.entries(byStatus).map(([s, n]) => `${n} ${s}`).join(', ');
});

check('a request with no reasons or a bad target is caught', () => {
  const state = store.getState();
  const r = Object.values(state.requests)[0];
  const realReasons = r.reasons;
  r.reasons = [];
  assert(checkState(state).some((p) => p.includes('no reasons given')), 'a reasonless request went unnoticed');
  r.reasons = realReasons;

  const realTarget = r.targetId;
  r.targetId = 'w_9999';
  assert(checkState(state).some((p) => p.includes('w_9999')), 'a dangling target went unnoticed');
  r.targetId = realTarget;
  return 'reasonless requests and dangling targets are both reported';
});

check('requests survive a save and load', () => {
  const before = store.allRequests()
    .map((r) => `${r.id}/${r.kind}/${r.status}/${r.urgency}/${r.targetId || ''}`).join(';');
  const json = persist.toJSON({ label: 'req' });
  store.reset();
  persist.fromJSON(json);
  eq(store.allRequests().map((r) => `${r.id}/${r.kind}/${r.status}/${r.urgency}/${r.targetId || ''}`).join(';'),
    before, 'requests differ after reload');
  return `${store.allRequests().length} requests restored exactly`;
});

check('a v5 save loads into a world that can ask for things', () => {
  const envelope = JSON.parse(persist.toJSON({ label: 'v5' }));
  envelope.schemaVersion = 5;
  delete envelope.state.requests;
  store.reset();
  persist.deserialize(envelope);
  const state = store.getState();
  eq(state.meta.schemaVersion, SCHEMA_VERSION, 'schema after migration');
  assert(state.requests && typeof state.requests === 'object', 'no requests registry after migration');
  eq(Object.keys(state.requests).length, 0, 'a v5 save should arrive with no requests');
  const made = generateRequests();
  assert(made.length > 0, 'a migrated save cannot generate requests');
  const problems = checkState(store.getState());
  assert(!problems.length, `migrated state is not sound:\n      - ${problems.join('\n      - ')}`);
  return `v5 -> v${SCHEMA_VERSION}, then ${made.length} requests generated straight away`;
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) { for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
