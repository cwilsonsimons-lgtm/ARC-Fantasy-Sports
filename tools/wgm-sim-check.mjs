// Match simulation checks.
//
// The simulation is a pure function, so its behaviour can be measured rather
// than eyeballed. These assertions lock in the properties the design depends
// on: the GM sets a ceiling and not a duration, better wrestlers win without it
// being a foregone conclusion, and an upset is a real tail.
//
// Usage: node tools/wgm-sim-check.mjs
import { createRng } from '../wrestling/js/core/rng.js';
import { simulateSegment, applyOverride, ringStrength } from '../wrestling/js/systems/matchSim.js';

let passed = 0; const failures = [];
const check = (label, fn) => {
  try { const d = fn(); passed++; console.log(`  ok  ${label}${d ? `  ${d}` : ''}`); }
  catch (e) { failures.push(`${label}: ${e.message}`); console.log(`FAIL  ${label}\n      ${e.message}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const pct = (n) => `${(n * 100).toFixed(1)}%`;

const wrestler = (id, { work = 70, star = 70, dur = 75, cha = 65, momentum = 0, condition = 100 } = {}) => ({
  id, shortName: id,
  ability: { workRate: work, starPower: star, durability: dur, charisma: cha },
  state: { momentum, condition },
  ties: { relationships: {} },
});

const ACE = wrestler('Ace', { work: 88, star: 92, dur: 75 });
const STAR = wrestler('Star', { work: 85, star: 84, dur: 74 });
const MID = wrestler('Mid', { work: 70, star: 55, dur: 72 });
const JOBBER = wrestler('Jobber', { work: 55, star: 24, dur: 70 });

function match(a, b, limitMin) {
  return {
    id: 'sg_test', format: 'singles', kind: 'match', timeLimitSec: limitMin * 60,
    participants: [{ wrestlerId: a.id, side: 'a' }, { wrestlerId: b.id, side: 'b' }],
  };
}

function runMany(a, b, limitMin, n = 6000, seed = 'sim-check') {
  const rng = createRng(seed);
  const roster = { [a.id]: a, [b.id]: b };
  const get = (id) => roster[id];
  const seg = match(a, b, limitMin);
  const out = { aWins: 0, bWins: 0, draws: 0, durations: [], qualities: [], overLimit: 0 };
  for (let i = 0; i < n; i++) {
    const { result } = simulateSegment(seg, { get, rng });
    if (result.actualSec > seg.timeLimitSec) out.overLimit++;
    if (result.finish === 'time_limit_draw') out.draws++;
    else if (result.winnerIds.includes(a.id)) out.aWins++;
    else out.bWins++;
    out.durations.push(result.actualSec);
    out.qualities.push(result.quality);
  }
  out.n = n;
  out.decided = out.aWins + out.bWins;
  out.aRate = out.decided ? out.aWins / out.decided : 0;
  out.drawRate = out.draws / n;
  out.avgQuality = out.qualities.reduce((x, y) => x + y, 0) / n;
  return out;
}

console.log('\nmatch simulation check\n');
console.log('the GM sets a ceiling, not a duration');

check('a 15-minute limit can end almost any minute', () => {
  const r = runMany(ACE, STAR, 15, 20000);
  const buckets = new Array(15).fill(0);
  for (const d of r.durations) if (d < 900) buckets[Math.floor(d / 60)]++;
  const empty = buckets.map((n, i) => (n === 0 ? i : -1)).filter((i) => i >= 0);
  assert(empty.length === 0, `no match ever finished in minute(s) ${empty.join(', ')}`);
  return `every minute 0-14 reachable, plus ${pct(r.drawRate)} going the distance`;
});

check('the specific example from the brief holds', () => {
  const r = runMany(ACE, STAR, 15, 20000);
  const inMinute = (m) => r.durations.filter((d) => d >= m * 60 && d < (m + 1) * 60).length / r.n;
  const min2 = inMinute(1), min8 = inMinute(7), min14 = inMinute(13);
  for (const [name, v] of [['minute 2', min2], ['minute 8', min8], ['minute 14', min14]]) {
    assert(v > 0.01, `${name} only happens ${pct(v)} of the time, which is too rare to feel possible`);
  }
  assert(r.drawRate > 0.005, `the limit is reached only ${pct(r.drawRate)} of the time`);
  return `min 2 ${pct(min2)}, min 8 ${pct(min8)}, min 14 ${pct(min14)}, full limit ${pct(r.drawRate)}`;
});

check('a match never runs past its limit', () => {
  for (const limit of [3, 5, 10, 15, 20, 30]) {
    const r = runMany(ACE, STAR, limit, 2000);
    assert(r.overLimit === 0, `${r.overLimit} matches exceeded a ${limit}-minute limit`);
  }
  return 'checked at 3, 5, 10, 15, 20 and 30 minutes';
});

check('the finish bunches late between equals and spreads early in a mismatch', () => {
  const even = runMany(ACE, STAR, 15, 6000);
  const lopsided = runMany(ACE, JOBBER, 15, 6000);
  const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const mEven = median(even.durations), mLop = median(lopsided.durations);
  assert(mEven > mLop, `even median ${mEven}s should be later than mismatch median ${mLop}s`);
  return `even ${(mEven / 60).toFixed(1)}min, mismatch ${(mLop / 60).toFixed(1)}min`;
});

check('longer limits reach a finish more often', () => {
  const short = runMany(ACE, STAR, 5, 8000).drawRate;
  const long = runMany(ACE, STAR, 30, 8000).drawRate;
  assert(short > long, `a 5-minute limit draws ${pct(short)}, a 30-minute one ${pct(long)}`);
  return `5min draws ${pct(short)}, 30min draws ${pct(long)}`;
});

console.log('\nwho wins');

check('a main eventer beats a jobber almost always, but not quite', () => {
  const r = runMany(ACE, JOBBER, 15, 8000);
  assert(r.aRate > 0.93, `only ${pct(r.aRate)} - the jobber wins too often`);
  assert(r.aRate < 0.995, `${pct(r.aRate)} - the upset has been squeezed out entirely`);
  return `${pct(r.aRate)}, so the jobber still steals one now and then`;
});

check('a main eventer beats a midcarder clearly but not certainly', () => {
  const r = runMany(ACE, MID, 15, 8000);
  assert(r.aRate > 0.72 && r.aRate < 0.93, `${pct(r.aRate)} is outside a believable range`);
  return pct(r.aRate);
});

check('two comparable stars are close to even', () => {
  const r = runMany(ACE, STAR, 15, 8000);
  assert(r.aRate > 0.5 && r.aRate < 0.68, `${pct(r.aRate)} is too lopsided for two stars`);
  return `${pct(r.aRate)} to the slightly better wrestler`;
});

check('momentum moves the result without deciding it', () => {
  const flat = runMany(ACE, STAR, 15, 8000).aRate;
  const hot = runMany(ACE, { ...STAR, state: { momentum: 70, condition: 100 } }, 15, 8000).aRate;
  const cold = runMany(ACE, { ...STAR, state: { momentum: -70, condition: 100 } }, 15, 8000).aRate;
  assert(hot < flat && flat < cold, `momentum had no ordered effect: hot ${pct(hot)}, flat ${pct(flat)}, cold ${pct(cold)}`);
  assert(cold - hot < 0.45, 'momentum is swamping ability');
  return `opponent hot ${pct(hot)} / level ${pct(flat)} / cold ${pct(cold)}`;
});

check('a tired wrestler is easier to beat', () => {
  const fresh = runMany(ACE, STAR, 15, 8000).aRate;
  const spent = runMany({ ...ACE, state: { momentum: 0, condition: 30 } }, STAR, 15, 8000).aRate;
  assert(spent < fresh - 0.05, `condition barely mattered: fresh ${pct(fresh)}, spent ${pct(spent)}`);
  return `fresh ${pct(fresh)}, worn down ${pct(spent)}`;
});

console.log('\nrating and override');

check('better matches rate higher than squashes', () => {
  const good = runMany(ACE, STAR, 15, 4000).avgQuality;
  const squash = runMany(ACE, JOBBER, 15, 4000).avgQuality;
  assert(good > squash + 8, `${good.toFixed(0)} vs ${squash.toFixed(0)} is too close`);
  return `two stars rate ${good.toFixed(0)}, a mismatch ${squash.toFixed(0)}`;
});

check('the override forces the winner and keeps everything else', () => {
  const rng = createRng('override');
  const roster = { Ace: ACE, Jobber: JOBBER };
  const seg = match(ACE, JOBBER, 15);
  let forced = 0;
  for (let i = 0; i < 400; i++) {
    const { result } = simulateSegment(seg, { get: (id) => roster[id], rng });
    const over = applyOverride(result, seg, 'b');
    assert(over.winnerIds.includes('Jobber'), 'the override did not take');
    assert(over.loserIds.includes('Ace'), 'the loser was not updated');
    assert(over.actualSec === result.actualSec, 'the override changed the duration');
    assert(over.quality === result.quality, 'the override changed the rating');
    assert(over.overridden === true, 'the override was not flagged');
    assert(over.finish !== 'time_limit_draw', 'a forced winner cannot also be a draw');
    forced++;
  }
  return `${forced} forced finishes kept their duration and rating`;
});

console.log('\nplayback timeline');

check('the timeline opens at the bell and closes on the finish', () => {
  const rng = createRng('timeline');
  const roster = { Ace: ACE, Star: STAR };
  const seg = match(ACE, STAR, 15);
  for (let i = 0; i < 300; i++) {
    const { result, timeline } = simulateSegment(seg, { get: (id) => roster[id], rng });
    assert(timeline.length >= 2, 'a match with no beats');
    assert(timeline[0].atSec === 0, 'the timeline does not start at the bell');
    const last = timeline[timeline.length - 1];
    assert(last.kind === 'finish', 'the timeline does not end on the finish');
    assert(last.atSec === result.actualSec, 'the finish beat is not at the finish');
    for (let j = 1; j < timeline.length; j++) {
      assert(timeline[j].atSec >= timeline[j - 1].atSec, 'the timeline goes backwards');
      assert(timeline[j].atSec <= result.actualSec, 'a beat happens after the match ended');
    }
    assert(result.beats.length <= 8, `${result.beats.length} beats stored, which will bloat saves`);
  }
  return '300 matches: ordered, bounded, and trimmed to 8 stored beats';
});

console.log('\ndeterminism');

check('the same seed gives the same match', () => {
  const once = runMany(ACE, STAR, 15, 300, 'same-seed');
  const twice = runMany(ACE, STAR, 15, 300, 'same-seed');
  assert(JSON.stringify(once.durations) === JSON.stringify(twice.durations), 'durations diverged');
  assert(JSON.stringify(once.qualities) === JSON.stringify(twice.qualities), 'ratings diverged');
  const other = runMany(ACE, STAR, 15, 300, 'different-seed');
  assert(JSON.stringify(once.durations) !== JSON.stringify(other.durations), 'a different seed gave an identical show');
  return 'same seed reproduces, a different seed does not';
});

check('strength ordering matches the roster hierarchy', () => {
  const order = [ACE, STAR, MID, JOBBER].map(ringStrength);
  for (let i = 1; i < order.length; i++) {
    assert(order[i] < order[i - 1], 'the hierarchy is not monotonic');
  }
  return order.map((v) => v.toFixed(0)).join(' > ');
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) { for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
