// Checks the wrestling GM prototype two ways, because they catch different
// things.
//
// First it plays whole seasons headlessly against the model layer and asserts
// on what the locker room ends up like — the distributions, and whether each of
// the eleven traits actually changes an outcome. A trait that only shows on a
// card is decoration, and nothing but a simulation will tell you which ones
// those are.
//
// Then it plays the real thing in a browser: books cards, answers incidents,
// advances weeks, opens a card, and reloads. Every crash this prototype has had
// was found by playing it rather than by a staged test, so the second half
// drives the actual buttons.
//
//   node tools/gm-check.mjs            both
//   node tools/gm-check.mjs --model    the simulation only, no browser
//
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GM = path.join(ROOT, 'gm', 'js');
const PORT = 8137;

const failures = [];
function check(ok, what, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(what);
}

const mod = name => import(path.join(GM, name));

// ---------------------------------------------------------------- simulation

const { makeRng } = await mod('model/random.js');
const { generateRoster, generatePromotion } = await mod('model/generate.js');
const { makeAirSchedule } = await mod('model/calendar.js');
const titleModel = await mod('model/titles.js');
const { seedTitles } = titleModel;
const gameModel = await mod('model/game.js');
const { createMatch, createBout, createSegment, addItem, remainingMinutes } = await mod('model/show.js');
const { sidesOf } = await mod('model/matches.js');
const { shapeName } = await mod('data/shapes.js');
const { resetIds } = await mod('ids.js');
const { bookable } = await mod('model/morale.js');
const { trait, TRAITS } = await mod('model/traits.js');
const { gmStandingValue } = await mod('model/memory.js');
const { relationshipsOf } = await mod('model/relationships.js');
const { threadsFor } = await mod('model/threads.js');

const WEEKS = 40;
const RUNS = 12;

// One randomly-booked season, played end to end.
function playSeason(seed) {
  resetIds();
  const rng = makeRng(seed);
  const state = {
    version: 16, seed, rng: seed,
    ...gameModel.createGame({
      wrestlers: generateRoster(rng),
      promotion: generatePromotion(rng),
      air: makeAirSchedule(rng),
      titles: [],
    }),
  };
  state.titles = seedTitles(state.wrestlers, rng);

  const pick = makeRng(seed ^ 0x5f5f);
  const beats = {
    save: 0, hesitation: 0, nobody: 0, balked: 0, escalation: 0,
    'broke-it-up': 0, noticed: 0, 'tie-formed': 0,
    attack: 0, brawl: 0, ambush: 0, 'cheap-shot': 0, 'submission-held': 0,
    'faction-beatdown': 0, handshake: 0, 'handshake-refused': 0, 'stare-down': 0,
    'champion-challenge': 0,
  };
  const per = new Map(state.wrestlers.map(w => [w.id, { saves: 0, attacks: 0, envy: 0, brave: 0 }]));
  const extra = { matches: 0, crews: 0, ties: [], shapes: new Map(), falls: [] };
  const ring = id => {
    const w = state.wrestlers.find(x => x.id === id);
    return w ? w.stats.inRing : 50;
  };

  for (let week = 0; week < WEEKS; week += 1) {
    // Booked the way a card actually gets booked: mostly singles, with tag
    // matches and multi-person segments in the mix. That matters more than it
    // looks — a card of nothing but one-on-one matches and solo promos never
    // puts two people on the same side of anything, so relationships that are
    // supposed to grow out of shared time have nothing to grow from.
    let guard = 0;
    while (remainingMinutes(state.show, state.broadcast) >= 12 && guard++ < 12) {
      const fit = state.wrestlers.filter(bookable);
      if (fit.length < 4) break;
      const draw = pick();

      if (draw < 0.16) {
        const ids = [...new Set([0, 1, 2].map(() => fit[Math.floor(pick() * fit.length)].id))];
        addItem(state.show, createSegment({ participants: ids, name: 'Promo', plannedMinutes: 8 }));
      } else if (draw < 0.34) {
        // Every shape the game can make, so none goes unexercised: tag matches
        // of two to four a side, multi-ways of three to eight, the occasional
        // handicap, and a battle royal with whoever is available.
        const arrangements = [
          [2, 2], [3, 3], [4, 4], [2, 2, 2], [2, 1], [3, 1],
          [1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1],
          [1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1, 1],
        ];
        const royal = pick() < 0.12;
        const sides = royal
          ? new Array(Math.min(fit.length, 3 + Math.floor(pick() * 14))).fill(1)
          : arrangements[Math.floor(pick() * arrangements.length)];
        const wanted = sides.reduce((sum, n) => sum + n, 0);

        if (fit.length >= wanted) {
          const pool = [];
          while (pool.length < wanted) {
            const id = fit[Math.floor(pick() * fit.length)].id;
            if (!pool.includes(id)) pool.push(id);
          }
          const teams = [];
          let at = 0;
          for (const size of sides) { teams.push(pool.slice(at, at + size)); at += size; }
          const bout = createBout({
            teams, matchTypeId: royal ? 'battle-royal' : 'singles', plannedMinutes: 0,
          });
          if (bout && addItem(state.show, bout)) {
            const name = shapeName(bout.sides, bout.matchType) || 'Singles';
            extra.shapes.set(name, (extra.shapes.get(name) || 0) + 1);
          }
        }
      } else {
        const a = fit[Math.floor(pick() * fit.length)];
        const rest = fit.filter(w => w !== a);
        const b = rest[Math.floor(pick() * rest.length)];
        if (!a || !b) break;
        // With a stipulation some of the time, because two of the things the
        // bell can produce only exist inside one.
        const stipulation = draw < 0.42 ? 'submission' : draw < 0.5 ? 'hardcore' : 'singles';
        addItem(state.show, createMatch({
          wrestlerAId: a.id, wrestlerBId: b.id, plannedMinutes: 12, matchTypeId: stipulation,
        }));
      }
    }
    if (!state.show.items.length) { gameModel.advanceWeek(state); continue; }

    gameModel.startShow(state);
    for (let step = 0; step < 60 && state.phase === 'live'; step += 1) {
      if (state.pendingIncident) {
        const options = gameModel.availableResponses(state);
        gameModel.resolveIncidentResponse(state, options[Math.floor(pick() * options.length)].id);
        continue;
      }
      if (!gameModel.completeSegment(state)) break;
    }

    for (const entry of state.journal) {
      if (entry.type in beats) beats[entry.type] += 1;
      if (entry.type === 'save' || entry.type === 'escalation') {
        per.get(entry.data.saverId).saves += 1;
        // Going in against somebody who can plainly handle you is the thing
        // courage actually governs. Counting every save instead dilutes it with
        // all the ones anybody would have made.
        if (ring(entry.data.aggressorId) > ring(entry.data.saverId)) {
          per.get(entry.data.saverId).brave += 1;
        }
      }
      if (entry.type === 'attack' || entry.type === 'brawl' || entry.type === 'ambush') {
        per.get(entry.data.aggressorId).attacks += 1;
      }
      if (entry.type === 'noticed') per.get(entry.data.wrestlerId).envy += 1;
      // A run-in with company: the faction arrived rather than sent somebody.
      if (entry.data && entry.data.withIds) extra.crews += 1;
      if (entry.type === 'tie-formed') extra.ties.push(entry.data.kind);
    }
    // Every result, with the shape it came out of: who won, and how many the
    // result actually went against.
    for (const result of state.broadcast.results) {
      const item = state.show.items.find(i => i.id === result.itemId);
      if (!item || item.type !== 'match' || !result.winnerIds) continue;
      extra.falls.push({
        sides: sidesOf(item).length,
        people: item.participants.length,
        winners: result.winnerIds.length,
        fell: (result.fallIds || []).length,
      });
    }
    extra.matches += state.broadcast.results.filter(result => {
      const item = state.show.items.find(i => i.id === result.itemId);
      return Boolean(item) && item.type === 'match';
    }).length;
    gameModel.advanceWeek(state);
  }
  return { state, beats, per, extra };
}

const beats = {
  save: 0, hesitation: 0, nobody: 0, balked: 0, escalation: 0,
  'broke-it-up': 0, noticed: 0, 'tie-formed': 0,
  attack: 0, brawl: 0, ambush: 0, 'cheap-shot': 0, 'submission-held': 0,
  'faction-beatdown': 0, handshake: 0, 'handshake-refused': 0, 'stare-down': 0,
  'champion-challenge': 0,
};
const rows = [];
const morales = [];
const ties = new Map();
const shapes = new Map();
const falls = [];
let matchCount = 0;
let crewCount = 0;
let sound = true;

for (let run = 0; run < RUNS; run += 1) {
  const { state, beats: b, per, extra } = playSeason(3000 + run * 104729);
  for (const key of Object.keys(beats)) beats[key] += b[key];
  matchCount += extra.matches;
  crewCount += extra.crews;
  for (const kind of extra.ties) ties.set(kind, (ties.get(kind) || 0) + 1);
  for (const [shape, n] of extra.shapes) shapes.set(shape, (shapes.get(shape) || 0) + n);
  falls.push(...extra.falls);
  for (const w of state.wrestlers) {
    morales.push(w.morale);
    if (!Number.isFinite(w.morale) || w.morale < 0 || w.morale > 100) sound = false;
    if (TRAITS.some(t => !Number.isFinite(trait(w, t.key)))) sound = false;
    if ((w.memories || []).some(m => !Number.isFinite(m.weight) || !Number.isFinite(m.fade))) sound = false;
    if (relationshipsOf(state.wrestlers, w).some(r => !r.label || !r.note)) sound = false;
    rows.push({
      t: Object.fromEntries(TRAITS.map(x => [x.key, trait(w, x.key)])),
      ...per.get(w.id),
      grudges: (w.grudges || []).length,
      threads: threadsFor(state, w.id, 99).length,
      // What they are still carrying, not how many rows the ledger has — the
      // row count saturates against the cap once a season is long enough, and
      // then it has stopped measuring anything.
      carrying: (w.memories || [])
        .filter(m => m.weight < 0)
        .reduce((sum, m) => sum + Math.abs(m.weight * m.fade), 0),
      standing: gmStandingValue(w, state.week),
      morale: w.morale,
    });
  }
}

console.log(`\n${RUNS} seasons of ${WEEKS} weeks, ${rows.length} wrestlers\n`);
check(sound, 'every wrestler comes out of a season structurally sound');

// The three outcomes of somebody being put hands on should all be common. Any
// one of them swallowing the others means the reaction engine has stopped
// asking a question. Counted across every kind that runs the chain, not only
// the post-match attack — a backstage ambush is the same question asked in a
// room with far fewer people in it to answer.
const hands = beats.attack + beats.brawl + beats.ambush;
const share = key => beats[key] / Math.max(1, hands);
for (const key of ['save', 'hesitation', 'nobody']) {
  const pct = share(key);
  check(pct >= 0.12 && pct <= 0.6, `"${key}" is a common outcome when somebody gets jumped`, `${Math.round(pct * 100)}%`);
}
// A chain that never runs past one save is not a chain, and one that always
// does is a riot. Both ends of that are failures, so the check wants a rate
// rather than a ceiling.
const chainRate = beats.escalation / Math.max(1, beats.save);
check(chainRate > 0.02 && chainRate < 0.5,
  'a save sometimes turns into a chain, and usually does not',
  `${beats.escalation} escalations from ${beats.save} saves`);
check(beats['broke-it-up'] > 0,
  'somebody sometimes walks between them and ends it',
  `${beats['broke-it-up']} broken up`);
check(beats.balked > 0,
  'somebody with every reason sometimes does not move',
  `${beats.balked} balked`);
check(crewCount > 0, 'a faction sometimes arrives together', `${crewCount} run-ins with company`);

// The bell has to be a moment with several possible outcomes — and most matches
// still have to end with two people walking to the back, or none of the others
// mean anything.
const MOMENT_KINDS = ['handshake', 'handshake-refused', 'stare-down', 'champion-challenge',
  'cheap-shot', 'attack', 'submission-held', 'faction-beatdown'];
const moments = MOMENT_KINDS.reduce((sum, key) => sum + beats[key], 0);
const momentRate = moments / Math.max(1, matchCount);
check(momentRate > 0.2 && momentRate < 0.6,
  'something happens after some matches and not most',
  `${Math.round(momentRate * 100)}% of ${matchCount} matches`);
const seen = MOMENT_KINDS.filter(key => beats[key] > 0);
check(seen.length >= 6, 'the bell produces most of its outcomes',
  seen.map(k => `${k}:${beats[k]}`).join(' '));

// Relationships have to be able to become something the game will name, and
// the game has to end up with feuds it can point at.
check(ties.size > 0, 'ties form on their own',
  [...ties].map(([k, v]) => `${k}:${v}`).join(' ') || 'none formed');
// ---- shapes ----
//
// Every arrangement has to be bookable, resolve to exactly one winning side,
// and put the result against exactly one side — which is the whole point of a
// multi-way: three people do not win it and only one of them loses it.
check(shapes.size >= 8, 'every shape the game offers gets booked',
  [...shapes].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
check(shapes.has('Battle Royal'), 'battle royals happen', `${shapes.get('Battle Royal') || 0} of them`);
check(shapes.has('Handicap'), 'a side can be outnumbered', `${shapes.get('Handicap') || 0} handicap matches`);

const biggest = falls.reduce((most, f) => Math.max(most, f.people), 0);
check(biggest >= 9, 'a match can hold more people than a tag match', `biggest held ${biggest}`);
check(falls.every(f => f.winners >= 1), 'every match has a winning side');
check(falls.every(f => f.fell >= 1), 'every result goes against somebody');
// One *side* takes the fall, not one person — a three-way tag has two people
// on the losing end of it. What has to hold is that fewer people were beaten
// than failed to win, which is the whole point of booking a multi-way.
const multiWay = falls.filter(f => f.sides > 2);
check(multiWay.length > 0 && multiWay.every(f => f.fell < f.people - f.winners),
  'in a multi-way, not winning is not the same as losing',
  `${multiWay.length} multi-way results, fewer beaten than beaten-to-it`);

// A singles belt in a ring of four is a real thing, and it falls out of the
// shape model rather than needing a rule of its own.
{
  const probe = playSeason(999);
  const belt = (probe.state.titles || []).find(t => t.holders === 1 && !t.gender);
  const four = probe.state.wrestlers.slice(0, 4).map(w => w.id);
  const asFourWay = titleModel.titlesForMatch(probe.state, four, [1, 1, 1, 1]);
  const asTag = titleModel.titlesForMatch(probe.state, four, [2, 2]);
  check(!belt || asFourWay.some(t => t.id === belt.id),
    'a singles belt can be defended in a fatal four-way');
  check(!asTag.some(t => t.holders === 1),
    'and a singles belt cannot be defended in a tag match');
}

const inThreads = rows.filter(r => r.threads > 0).length;
check(inThreads > rows.length * 0.1, 'the game notices feuds it can name',
  `${inThreads} of ${rows.length} wrestlers in a live thread`);

// Morale should sit in a spread around the baselines, not pin at either end.
morales.sort((a, b) => a - b);
const q = p => morales[Math.floor(morales.length * p)];
check(q(0.5) > 35 && q(0.5) < 70, 'morale settles near the middle rather than drifting to an end', `median ${q(0.5)}`);
check(q(0.9) - q(0.1) > 20, 'the room is a spread of moods, not one mood', `p10 ${q(0.1)} .. p90 ${q(0.9)}`);

// Every trait has to change something measurable.
function correlate(key, field) {
  const xs = rows.map(r => r.t[key]);
  const ys = rows.map(r => r[field]);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy || 1);
}

const EFFECTS = [
  ['courage', 'saves', 1, 'nerve sends people into a fight'],
  ['loyalty', 'saves', 1, "a friend's trouble is their business"],
  ['selfishness', 'saves', -1, 'and somebody selfish stays out of it'],
  ['aggression', 'attacks', 1, 'aggression starts fights'],
  ['professionalism', 'attacks', -1, 'professionalism prevents them'],
  ['patience', 'attacks', -1, 'so does patience'],
  ['jealousy', 'envy', 1, "jealousy notices somebody else's night"],
  ['vindictiveness', 'grudges', 1, 'vindictiveness holds a position longer'],
  ['vindictiveness', 'carrying', 1, 'and is still carrying more of what caused it'],
  ['authority', 'standing', 1, 'respect for the office softens your rulings'],
  ['ego', 'morale', -1, 'a big ego reads the same year worse'],
  ['ambition', 'morale', -1, 'and so does ambition'],
];
const MIN_R = 0.08;
for (const [key, field, sign, why] of EFFECTS) {
  const r = correlate(key, field);
  check(r * sign >= MIN_R, `${key} does something: ${why}`, `r=${r.toFixed(3)}`);
}

// ---- the GM board ----
//
// The tree is mostly gates, and a gate is worth testing in both directions:
// the thing is unavailable, then you buy the thing, then it is available.
{
  const prog = await mod('model/progression.js');
  const unlocks = await mod('model/unlocks.js');
  const cat = await mod('data/upgrades.js');
  const netw = await mod('model/network.js');

  const catalogue = cat.UPGRADES;
  check(catalogue.length === 113, 'the whole catalogue is on the board',
    `${catalogue.length} upgrades, ${catalogue.reduce((n, u) => n + u.cost, 0)} points`);
  check(catalogue.every(u => (u.requires || []).every(r => cat.upgrade(r))),
    'every prerequisite names an upgrade that exists');
  check(catalogue.every(u => (u.excludes || []).every(r => cat.upgrade(r))),
    'and so does every exclusion');
  // A built upgrade whose prerequisite is not built could never be bought.
  const orphan = catalogue.filter(u => u.built && (u.requires || []).some(r => !cat.upgrade(r).built));
  check(orphan.length === 0, 'nothing built is stranded behind something unbuilt',
    orphan.map(u => u.name).join(', ') || 'none');

  const fresh = playSeason(4242).state;
  fresh.gm = prog.createProgression();

  check(prog.progression(fresh).points === 3, 'a new GM starts with three points');
  check(unlocks.shapesFor(fresh).length === 0, 'and cannot book anything but a singles match');
  check(unlocks.stipulationsFor(fresh).length === 1, 'with no stipulation to put on it');
  check(unlocks.broadcastMinutes(fresh) === 60, 'on an hour of television');
  check(netw.runtimeFor(fresh) === 60, 'which is what the show is built against');

  // Buying is the only way points leave the pool, and it obeys the gates.
  check(!prog.canBuy(fresh, 'fatal-four-way'), 'a level-4 upgrade is out of reach at level 1');
  check(prog.blockers(fresh, 'fatal-four-way').length >= 2,
    'and the board can say exactly why', prog.blockers(fresh, 'fatal-four-way').map(b => b[0]).join(', '));
  check(prog.buy(fresh, 'tag-team-wrestling'), 'a level-1 upgrade can be bought');
  check(prog.progression(fresh).points === 2, 'and it costs what it says');
  check(unlocks.shapesFor(fresh).some(p => p.id === 'tag'), 'tag team wrestling appears on the builder');
  check(!prog.buy(fresh, 'tag-team-wrestling'), 'nothing can be bought twice');

  // The broadcast ladder is trust to open and a point to take.
  fresh.network.trust = 40;
  check(!prog.canBuy(fresh, 'expanded-broadcast-ii'),
    'ninety minutes needs the rung below it first');
  prog.awardXp(fresh, 5000);
  check(prog.progression(fresh).level > 1, 'XP levels a GM up', `level ${fresh.gm.level}`);
  prog.buy(fresh, 'expanded-broadcast-i');
  prog.buy(fresh, 'expanded-broadcast-ii');
  check(unlocks.broadcastMinutes(fresh) === 90, 'and buying the rungs lengthens the show');
  check(netw.awardTrust(fresh, 'A').promoted === null,
    'trust on its own no longer promotes anybody');

  // Championship slots the same way.
  const before = titleModel.slotsEarned(fresh);
  prog.buy(fresh, 'the-second-belt');
  check(titleModel.slotsEarned(fresh) === before + 1, 'a belt bought is a belt sanctioned');

  // XP is not mostly the grade. That is the whole design constraint, so it is
  // worth a test rather than a comment.
  const busy = playSeason(77).state;
  busy.journal = [
    { type: 'ruling', data: { read: 'fair' } },
    { type: 'ruling', data: { read: 'fair' } },
    { type: 'ruling', data: { read: 'harsh' } },
    { type: 'tie-formed', data: {} },
  ];
  const earned = prog.xpForShow(busy, { grade: 'A', timing: 'on-time', rosterUse: 'broad', breaches: 0 });
  const gradeShare = 30 / earned.total;
  check(gradeShare < 0.2, 'the network grade is a small slice of a week',
    `${Math.round(gradeShare * 100)}% of ${earned.total} XP`);
  const quiet = prog.xpForShow(busy, { grade: 'D', timing: 'long', rosterUse: 'thin', breaches: 1 });
  check(quiet.total > 0, 'and a bad night still teaches you something', `${quiet.total} XP`);
  check(prog.awardXp(busy, -50).gained === 0, 'XP never goes backwards');

  // The tag ladder relaxes, and refuses with a sentence rather than a boolean.
  const pair = playSeason(31).state;
  pair.gm = prog.createProgression();
  prog.buy(pair, 'tag-team-wrestling');
  const strangers = [pair.wrestlers[0].id, pair.wrestlers[1].id];
  const refusal = unlocks.teamRefusal(pair, pair.wrestlers, strangers);
  check(typeof refusal === 'string' || refusal === null,
    'the tag gate answers in words, not a boolean');
  // A seeded tag team is exactly who a level-1 GM is allowed to book.
  const unit = pair.wrestlers.find(w =>
    Object.values(w.relationships || {}).some(r => r.tie === 'tag-team'));
  if (unit) {
    const mate = Object.entries(unit.relationships).find(([, r]) => r.tie === 'tag-team')[0];
    check(unlocks.teamRefusal(pair, pair.wrestlers, [unit.id, mate]) === null,
      'a team that already exists can be booked from day one');
  }
}

// ---- building a promotion ----
//
// A setup is a starting position you can hand to somebody else, so the thing
// worth testing is that it survives the round trip and that what it says
// actually reaches the save.
{
  const setupData = await mod('data/setup.js');
  const fin = await mod('model/finance.js');
  const prog = await mod('model/progression.js');
  const saves = await mod('saves.js');

  // btoa/atob are browser globals; the encoder needs them here too.
  globalThis.btoa ||= str => Buffer.from(str, 'binary').toString('base64');
  globalThis.atob ||= str => Buffer.from(str, 'base64').toString('binary');

  const plan = setupData.defaultSetup(90210);
  plan.promotion = 'Meridian Championship Wrestling';
  plan.show = 'Friday Night Meridian';
  plan.level = 12;
  plan.budget = 250000;
  plan.rosterSize = 22;
  plan.titles = ['world', 'womens', 'tag', 'television'];
  plan.edits = { 0: { name: 'Hollis Vane', role: 'Main event' } };
  plan.dropped = [3];

  const code = setupData.encodeSetup(plan);
  const back = setupData.decodeSetup(code);
  check(Boolean(back), 'a setup survives being turned into a code');
  check(back && back.seed === plan.seed && back.level === 12 && back.budget === 250000
    && back.rosterSize === 22 && back.titles.length === 4
    && back.edits[0].name === 'Hollis Vane' && back.dropped[0] === 3,
    'and comes back with everything that was set');
  check(setupData.decodeSetup('not a code at all') === null, 'a mangled code is refused, not obeyed');
  check(setupData.decodeSetup(setupData.encodeSetup({ ...plan, level: 99 })) === null,
    'and so is one asking for a level that does not exist');

  // The same code twice is the same locker room, which is the only reason
  // sharing one is worth anything.
  const first = saves.createSave(back).state;
  const second = saves.createSave(setupData.decodeSetup(code)).state;
  check(first.wrestlers.map(w => w.name).join('|') === second.wrestlers.map(w => w.name).join('|'),
    'two people who paste the same code get the same locker room',
    `${first.wrestlers.length} wrestlers`);

  check(first.promotion.promotion === 'Meridian Championship Wrestling', 'the name it was given reaches the save');
  check(first.wrestlers.length === 21, 'the roster is the size asked for, less anybody cut',
    `${first.wrestlers.length} of 22`);
  check(first.wrestlers[0].name === 'Hollis Vane', 'an edited wrestler arrives edited');

  // Full authorship: every stat and every trait, plus wrestlers who are not on
  // the seed at all. This is what recreating somebody else's roster needs.
  const authored = saves.createSave({
    ...back,
    rosterSize: 12,
    dropped: [],
    edits: {
      0: {
        name: 'Marcus Vane', archetype: 'Bloodline enforcer', role: 'Main event',
        alignment: 'Heel', gender: 'Male', status: 'Available',
        stats: { inRing: 94, charisma: 91 },
        traits: { ego: 97, loyalty: 12, patience: 8 },
        record: { wins: 61, losses: 4 },
      },
      1: { stats: { inRing: 88 } },
    },
    added: [
      { name: 'Etta Roux', role: 'Upper card', alignment: 'Face',
        archetype: 'Crowd favourite', stats: { inRing: 82, charisma: 90 } },
      { name: 'Bram Kessel', role: 'Opener' },
    ],
  }).state;

  const vane = authored.wrestlers.find(w => w.name === 'Marcus Vane');
  check(Boolean(vane), 'a fully authored wrestler reaches the save');
  check(vane && vane.stats.inRing === 94 && vane.stats.charisma === 91,
    'with the ability that was written', vane ? `${vane.stats.inRing}/${vane.stats.charisma}` : '');
  check(vane && vane.traits.ego === 97 && vane.traits.loyalty === 12,
    'and the personality');
  check(vane && vane.archetype === 'Bloodline enforcer',
    'an archetype that is not one of the seventeen is still an archetype');
  check(vane && Object.keys(vane.traits).length === 11,
    'and the traits nobody wrote are still all there',
    vane ? `${Object.keys(vane.traits).length} traits` : '');
  check(vane && vane.record.wins === 61 && vane.record.losses === 4,
    'a record can be written too');

  // Authoring is knowing. Writing personality reveals the person; writing only
  // ability reveals only the worker.
  const stats = await mod('model/stats.js');
  const abilityOnly = authored.wrestlers[1];
  check(vane && stats.personalityTier(vane) === 'known',
    'a wrestler whose personality you wrote is not a stranger');
  check(stats.knowledgeTier(abilityOnly) === 'known'
    && stats.personalityTier(abilityOnly) !== 'known',
    'writing only their ability tells you only what they can do');

  const roux = authored.wrestlers.find(w => w.name === 'Etta Roux');
  check(Boolean(roux) && roux.stats.charisma === 90,
    'a wrestler written from nothing joins the roster');
  check(roux && Object.keys(roux.traits).length === 11 && roux.traits.ego === 50,
    'built on a whole person, with the middle of every scale where nothing was said');
  check(authored.wrestlers.length === 14,
    'twelve rolled plus two written', `${authored.wrestlers.length} in the room`);
  const ids = new Set(authored.wrestlers.map(w => w.id));
  check(ids.size === authored.wrestlers.length, 'and nobody shares an id');

  // Belts get called whatever the promotion calls them.
  const renamed = saves.createSave({
    ...back,
    titles: ['world', 'tag'],
    titleNames: { world: 'Undisputed Heavyweight Championship', tag: 'World Tag Team Titles' },
  }).state;
  check(renamed.titles.some(t => t.name === 'Undisputed Heavyweight Championship'),
    'a championship can be called what you call it');
  const worldBelt = renamed.titles.find(t => t.key === 'world');
  check(worldBelt && worldBelt.holders === 1,
    'and renaming it does not change what it is');
  check(first.titles.length === 4, 'and the belts chosen are on the wall', `${first.titles.length} belts`);
  check(titleModel.slotsUsed(first) === 0,
    'a belt the promotion opened with has not spent a sanctioned slot');

  check(first.gm.level === 12 && first.gm.points === prog.pointsEarnedBy(12),
    'a GM who starts at twelve starts with twelve levels of points', `${first.gm.points} points`);
  check(first.gm.xp === 0 && first.gm.spent.length === 0,
    'and with nothing bought and nothing banked');

  // Money: the loop has to actually move, and the roster has to be what moves it.
  check(fin.budgetOf(first) === 250000, 'the budget asked for is the budget in the account');
  const small = saves.createSave({ ...back, rosterSize: 10, dropped: [] }).state;
  check(fin.wageBill(small.wrestlers) < fin.wageBill(first.wrestlers),
    'a smaller roster costs less to run',
    `${fin.money(fin.wageBill(small.wrestlers))} against ${fin.money(fin.wageBill(first.wrestlers))}`);

  const before = fin.budgetOf(first);
  first.journal = [];
  const moved = fin.settleWeek(first);
  check(moved.fee > 0 && moved.wages > 0 && fin.budgetOf(first) === before + moved.net,
    'the week settles and the balance moves', `${fin.money(moved.net)} a week`);
  check((first.journal || []).some(e => e.type === 'books-settled'),
    'and the books say so in the journal');

  // Overdrawn is a thing head office notices, which is the only teeth the
  // budget has until contracts exist.
  const broke = saves.createSave({ ...back, budget: 0 }).state;
  const clean = fin.standingPenalty(broke);
  broke.finance.budget = -200000;
  check(clean === 0 && fin.standingPenalty(broke) > 0,
    'an overdrawn promotion is one head office is being asked about',
    `${fin.standingPenalty(broke)} off their read of you`);
}

// ---- rivalries ----
//
// The tier's whole claim is that heat and hatred are different things, so the
// checks are mostly about them being able to come apart.
{
  const th = await mod('model/threads.js');
  const riv = await mod('model/rivalries.js');
  const promoData = await mod('data/promos.js');
  const promoModel = await mod('model/promos.js');

  const probe = playSeason(5150);
  const state = probe.state;

  // A pair who have only ever wrestled each other on television draw a crowd
  // and have no reason to dislike each other.
  const [a, b, c] = state.wrestlers.map(w => w.id);
  const clean = { id: 't1', a, b, startedWeek: 1, lastWeek: state.week, events: [] };
  for (let i = 0; i < 8; i += 1) clean.events.push({ week: state.week, type: 'match' });
  clean.events.push({ week: state.week, type: 'booked' });
  clean.events.push({ week: state.week, type: 'title-change' });
  const drawRead = th.readingOf(clean, state.week);
  check(drawRead.heat > drawRead.hatred * 2, 'working somebody often is heat without hatred',
    `heat ${drawRead.heat}, hatred ${drawRead.hatred}`);
  check(riv.quadrantOf(drawRead).id === 'draw', 'and the game calls it a draw',
    riv.quadrantOf(drawRead).label);

  // A pair whose whole history is backstage hate each other and nobody has
  // seen any of it. This is the case the old single number could not hold.
  const corridor = { id: 't2', a, b: c, startedWeek: 1, lastWeek: state.week, events: [] };
  for (let i = 0; i < 3; i += 1) corridor.events.push({ week: state.week, type: 'argument' });
  corridor.events.push({ week: state.week, type: 'abandoned' });
  corridor.events.push({ week: state.week, type: 'tag-dispute' });
  const bloodRead = th.readingOf(corridor, state.week);
  check(bloodRead.hatred > bloodRead.heat * 2, 'a corridor grudge is hatred without heat',
    `heat ${bloodRead.heat}, hatred ${bloodRead.hatred}`);
  check(riv.quadrantOf(bloodRead).id === 'blood', 'and the game calls it bad blood',
    riv.quadrantOf(bloodRead).label);

  // Crowds move on faster than people do.
  const old = { id: 't3', a, b, startedWeek: 1, lastWeek: 1, events: [
    { week: 1, type: 'attack' }, { week: 1, type: 'attack' }, { week: 1, type: 'abandoned' },
  ] };
  const fresh = th.readingOf(old, 1);
  const later = th.readingOf(old, 21);
  check(later.heat / fresh.heat < later.hatred / fresh.hatred,
    'twenty weeks on, the crowd has forgotten more of it than they have',
    `heat ${fresh.heat}->${later.heat}, hatred ${fresh.hatred}->${later.hatred}`);

  // Material is derived, so a pair with no history have nothing to say and a
  // pair with a long one have a list.
  const strangers = riv.ammoFor(state, a, b);
  state.threads = [corridor];
  const loaded = riv.ammoFor(state, a, c);
  check(loaded.length > 0, 'a rivalry with history unlocks something to say',
    `${loaded.length} pieces`);
  check(loaded.every(item => promoData.ammoSpec(item.kind)),
    'and every piece of it is a kind the game knows');
  check(loaded[0].heat + loaded[0].hatred <= loaded[loaded.length - 1].heat + loaded[loaded.length - 1].hatred,
    'listed gentlest first');
  check(Array.isArray(strangers), 'two strangers produce a list rather than an error',
    `${strangers.length} pieces`);

  // Intensity is a ladder in both directions.
  const rungs = promoData.INTENSITIES;
  check(rungs.length === 5, 'five rungs from calm to about to fight', rungs.map(r => r.label).join(' < '));
  check(rungs.every((r, i) => i === 0 || (r.heat > rungs[i - 1].heat && r.risk >= rungs[i - 1].risk)),
    'every rung is worth more and riskier than the one below it');

  // A promo is worth something, moves both axes, and can stop being a promo.
  let physical = 0;
  let totalHeat = 0;
  for (let i = 0; i < 400; i += 1) {
    const probeState = playSeason(6000 + i).state;
    const ids = probeState.wrestlers.map(w => w.id);
    const item = promoModel.createPromo({
      speakerId: ids[0], targetId: ids[1], plannedMinutes: 5,
      intensityId: 'explosive', ammo: [],
    });
    const rng = makeRng(900 + i);
    const said = promoModel.resolvePromo(probeState, item, 10, rng);
    if (!said) continue;
    totalHeat += said.heat;
    if (said.incident) physical += 1;
  }
  check(physical > 20 && physical < 340, 'an explosive promo sometimes stops being a promo',
    `${physical} of 400`);
  check(totalHeat > 0, 'and a promo is worth something to the crowd either way');

  // Anticipation is about what the GM built, not about who is in it.
  const twoStrangers = { id: 'i1', type: 'match', participants: [a, b], sides: [1, 1], plannedMinutes: 10 };
  state.threads = [];
  const cold = riv.anticipationFor(state, twoStrangers);
  state.threads = [{ ...clean, a, b }];
  const warm = riv.anticipationFor(state, twoStrangers);
  check(warm.value > cold.value, 'a match between people with a history is more wanted',
    `${cold.value} -> ${warm.value}`);
  const withBelt = riv.anticipationFor(state, { ...twoStrangers, titleId: 'x' });
  check(withBelt.value > warm.value, 'and a belt on the line is more wanted still',
    `${warm.value} -> ${withBelt.value}`);

  // Quality is mostly not ability, which is the argument the tier is making.
  const quality = riv.matchQuality(state, twoStrangers, warm);
  const flat = riv.matchQuality(state, twoStrangers, cold);
  check(quality && flat && quality.value > flat.value,
    'the same two people have a better match when people care',
    `${flat.value} -> ${quality.value}`);
  check(quality.crowd > 0 && quality.wrestling > 0,
    'and the reading says what it was made of',
    `ring ${quality.wrestling}, crowd ${quality.crowd}`);
  const rushed = riv.matchQuality(state, { ...twoStrangers, plannedMinutes: 3 }, warm);
  check(rushed.value < quality.value, 'four minutes is not enough for a finish to land',
    `${quality.value} -> ${rushed.value}`);
}

if (process.argv.includes('--model')) {
  console.log(failures.length ? `\n${failures.length} FAILING:\n- ${failures.join('\n- ')}` : '\nall green');
  process.exit(failures.length ? 1 : 0);
}

// ------------------------------------------------------------------- browser

const { chromium } = await import('playwright');
const server = spawn('node', [path.join(ROOT, 'tools', 'serve.mjs'), ROOT, String(PORT)], { stdio: 'ignore' });
await new Promise(resolve => setTimeout(resolve, 900));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH
    || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error' && !/favicon|status of 404/i.test(m.text())) errors.push(m.text()); });

let editorRatings = 0;
let writtenRows = 0;
let customArchetype = false;
let wroteFromNothing = false;
let rosterRows = 0;

console.log('');
await page.goto(`http://127.0.0.1:${PORT}/gm/index.html`);
await page.waitForTimeout(400);
// A promotion is built before it exists now, so the way in is the setup screen.
await page.getByRole('button', { name: 'Build a promotion', exact: true }).click();
await page.waitForTimeout(400);
check(await page.locator('.setup-view').count() > 0, 'the new-save screen builds a promotion first');

// The level dial has to pay out what the design says it pays out.
const levelInput = page.locator('.setup-panel input[type="range"]').first();
await levelInput.fill('12');
await page.waitForTimeout(150);
const pointsAt12 = await page.locator('.setup-read dd.big').first().textContent();
await levelInput.fill('1');
await page.waitForTimeout(150);
const pointsAt1 = await page.locator('.setup-read dd.big').first().textContent();
check(Number(pointsAt12) === 31 && Number(pointsAt1) === 3,
  'the starting level pays out the points that level would have earned',
  `level 1 → ${pointsAt1}, level 12 → ${pointsAt12}`);

// A fourth belt, chosen rather than sanctioned.
await page.locator('.belt-pick', { hasText: 'Television Championship' }).locator('input[type="checkbox"]').check();
await page.waitForTimeout(150);

// And the code, which is the whole point of building one of these.
await page.getByRole('button', { name: 'Make a code', exact: true }).click();
await page.waitForTimeout(200);
const madeCode = (await page.locator('.share-code').first().inputValue()).trim();
check(madeCode.length > 8 && !/[^A-Za-z0-9_-]/.test(madeCode),
  'a promotion can be shared as a code', `${madeCode.length} characters`);

// The editor: every stat, on a real wrestler, driven the way a player would.
await page.getByRole('button', { name: 'Edit them one by one', exact: true }).click();
await page.waitForTimeout(200);
await page.locator('.setup-table tbody tr').first().getByRole('button', { name: 'Edit' }).click();
await page.waitForTimeout(250);
editorRatings = await page.locator('.editor .rating-row').count();

await page.locator('.editor .rating-row', { hasText: 'In-ring' }).locator('.rating-num').fill('94');
await page.locator('.editor .rating-row', { hasText: 'Ego' }).locator('.rating-num').fill('97');
await page.waitForTimeout(200);
writtenRows = await page.locator('.editor .rating-row.written').count();

// An archetype that is not one of the seventeen.
await page.locator('.editor select').last().selectOption({ label: 'Write your own...' });
await page.waitForTimeout(150);
customArchetype = await page.locator('.editor input[placeholder="Bloodline enforcer"]').count() > 0;

await page.getByRole('button', { name: 'Done', exact: true }).click();
await page.waitForTimeout(200);

await page.getByRole('button', { name: 'Write one from nothing', exact: true }).click();
await page.waitForTimeout(250);
wroteFromNothing = await page.locator('.editor').count() > 0;
await page.locator('.editor input[type="text"]').first().fill('Etta Roux');
await page.getByRole('button', { name: 'Done', exact: true }).click();
await page.waitForTimeout(200);
rosterRows = await page.locator('.setup-table tbody tr').count();

const promoName = await page.locator('.setup-panel input[type="text"]').first().inputValue();
await page.getByRole('button', { name: 'Take the job', exact: true }).click();
await page.waitForTimeout(400);
check(editorRatings === 13, 'the editor offers every rating a wrestler has',
  `${editorRatings} of 13`);
check(writtenRows === 2, 'a written rating is marked as written', `${writtenRows} marked`);
check(customArchetype, 'an archetype can be written rather than picked');
check(wroteFromNothing, 'a wrestler can be written from nothing');
check(rosterRows === 17, 'and joins the roster', `${rosterRows} rows`);

check(await page.getByRole('button', { name: 'Roster', exact: true }).count() > 0, 'a new save opens onto the roster');
check((await page.locator('#promo').textContent()).trim() === promoName.trim(),
  'the promotion is the one that was built', promoName);

const PLAY_WEEKS = 10;
let played = 0;
let talked = 0;
let walked = 0;
let lockedFirst = false;
let boardDrawn = 0;
let tracedTotal = '';
let tracedLit = 0;
let boughtOne = false;
let unlockedAfter = [];
let gateRefusal = '';
let intensitySteps = 0;
let promoOnCard = false;
let rosterPicks = 0;

const bookPanel = page.locator('.col-book');
const rosterPanel = page.locator('.col-roster');

// Available wrestlers who are not already somewhere on the card. Read off the
// rendered panels rather than the save, so the test sees what a player sees.
async function freeNames(target) {
  return target.evaluate(() => {
    const onCard = new Set();
    for (const link of document.querySelectorAll('.col-card .wlink')) {
      onCard.add(link.textContent.trim());
    }
    const out = [];
    for (const tr of document.querySelectorAll('.col-roster tbody tr.pick-row')) {
      const name = tr.querySelector('.wlink')?.textContent.trim();
      const status = tr.querySelector('.status-good');
      if (name && status && !onCard.has(name)) out.push(name);
    }
    return out;
  });
}
let spread = { placed: 0, rooms: 0, clock: 0 };
for (let week = 1; week <= PLAY_WEEKS; week += 1) {
  await page.getByRole('button', { name: 'Booking', exact: true }).click();
  await page.waitForTimeout(120);

  // Week 2 goes through the GM board, because every shape past one-on-one is
  // something you now have to buy. The gate is worth driving in both
  // directions: the builder says no, you buy the upgrade, the builder says yes.
  if (week === 2) {
    await bookPanel.getByRole('button', { name: 'Bigger match', exact: true }).click();
    await page.waitForTimeout(120);
    lockedFirst = await bookPanel.locator('.form-note').count() > 0;

    await page.getByRole('button', { name: 'GM Board', exact: true }).click();
    await page.waitForTimeout(200);

    const boardNodes = await page.locator('.tree-node').count();
    boardDrawn = boardNodes;
    // A capstone nobody can reach at level one, to prove the trace reads.
    await page.locator('.tree-node', { hasText: 'Three-Hour Show' }).first().click();
    await page.waitForTimeout(120);
    tracedTotal = (await page.locator('.trace-total').textContent().catch(() => '')) || '';
    tracedLit = await page.locator('.tree-node.lit').count();

    await page.locator('.tree-node', { hasText: 'Tag Team Wrestling' }).first().click();
    await page.waitForTimeout(120);
    await page.getByRole('button', { name: /^Buy — 1 point$/ }).click();
    await page.waitForTimeout(200);
    boughtOne = await page.locator('.tree-node.s-owned').count() > 0;

    await page.getByRole('button', { name: 'Booking', exact: true }).click();
    await page.waitForTimeout(150);
    await bookPanel.getByRole('button', { name: 'Bigger match', exact: true }).click();
    await page.waitForTimeout(120);
    unlockedAfter = await bookPanel.locator('.form-row select').first()
      .locator('option').allTextContents();

    // Two people the gate should refuse, plus one to fill the other side so the
    // shape is legal and the pairing is the only thing left to object to.
    // Picked by actually having no history rather than by taking the first two
    // rows — the roster seeds a tag team and a mentor pair, and either would
    // be a legal team and a silently passing test.
    const free = await freeNames(page);
    const strangers = await page.evaluate(names => {
      const index = JSON.parse(localStorage.getItem('wgm_index_v1'));
      const save = JSON.parse(localStorage.getItem('wgm_save_' + index.currentId));
      const by = new Map(save.wrestlers.map(w => [w.name, w]));
      const rapport = rel => !rel ? 0
        : (rel.matches || 0) + (rel.segments || 0) + (rel.teamed || 0) * 2 + (rel.owed || 0) * 4;
      for (let i = 0; i < names.length; i += 1) {
        for (let j = i + 1; j < names.length; j += 1) {
          const a = by.get(names[i]);
          const b = by.get(names[j]);
          if (!a || !b) continue;
          const rel = a.relationships[b.id];
          if (rel && (rel.tie || rapport(rel) >= 6)) continue;
          const third = names.find(n => n !== names[i] && n !== names[j]);
          if (third) return [names[i], names[j], third];
        }
      }
      return names.slice(0, 3);
    }, free);
    for (const name of strangers) {
      await rosterPanel.locator('tbody tr.pick-row', { hasText: name }).first().click();
      await page.waitForTimeout(60);
    }
    if (await page.locator('.overlay').count()) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(60);
    }
    await bookPanel.getByRole('button', { name: /^＋\s+Add / }).click();
    await page.waitForTimeout(150);
    gateRefusal = (await bookPanel.locator('.over').first().textContent().catch(() => '')) || '';

    // And a promo, which is the one segment where the GM sets the temperature
    // rather than the outcome.
    await bookPanel.getByRole('button', { name: 'Promo', exact: true }).click();
    await page.waitForTimeout(150);
    intensitySteps = await bookPanel.locator('.int-step').count();
    await bookPanel.locator('.int-step', { hasText: 'Hostile' }).click();
    await page.waitForTimeout(100);

    const talkers = (await freeNames(page)).slice(0, 2);
    for (const name of talkers) {
      await rosterPanel.locator('tbody tr.pick-row', { hasText: name }).first().click();
      await page.waitForTimeout(60);
    }
    if (await page.locator('.overlay').count()) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(60);
    }
    await bookPanel.getByRole('button', { name: /Add promo$/ }).click();
    await page.waitForTimeout(200);
    promoOnCard = await page.locator('.col-card').getByText('Promo', { exact: true }).count() > 0;

    await bookPanel.getByRole('button', { name: 'Match', exact: true }).click();
    await page.waitForTimeout(80);
  }

  // Four singles matches, booked by clicking rows in the roster panel — which
  // is the interaction the layout is built around, so it is the one worth
  // driving rather than reaching past into the selects.
  await bookPanel.getByRole('button', { name: 'Match', exact: true }).click();
  await page.waitForTimeout(80);

  for (let i = 0; i < 5; i += 1) {
    const free = await freeNames(page);
    if (free.length < 2) break;
    for (const name of free.slice(0, 2)) {
      await rosterPanel.locator('tbody tr.pick-row', { hasText: name }).first().click();
      await page.waitForTimeout(60);
    }
    if (await page.locator('.overlay').count()) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(60);
    }
    await bookPanel.getByRole('button', { name: /Add match$/ }).click();
    await page.waitForTimeout(90);
    rosterPicks += 1;
  }

  const start = page.getByRole('button', { name: /Start show$/i }).first();
  if (!(await start.count()) || !(await start.isEnabled())) break;
  await start.click();
  await page.waitForTimeout(150);

  // The building only holds people while a show is on, so this has to be read
  // now rather than from the save after the week turns.
  if (week === 1) {
    spread = await page.evaluate(() => {
      const index = JSON.parse(localStorage.getItem('wgm_index_v1'));
      const save = JSON.parse(localStorage.getItem('wgm_save_' + index.currentId));
      return {
        placed: Object.keys(save.whereabouts || {}).length,
        rooms: new Set(Object.values(save.whereabouts || {})).size,
        clock: save.clock && save.clock.segmentMinutes,
      };
    });
  }

  for (let step = 0; step < 80; step += 1) {
    // A stray click on a name opens a card, and a card over the page swallows
    // every other click. Clear it before doing anything else.
    if (await page.locator('.overlay').count()) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(60);
    }

    const answer = page.locator('.decision button').first();
    if (await answer.count() && await answer.isEnabled()) {
      await answer.click();
      await page.waitForTimeout(80);
      continue;
    }

    // Anything audible from the next room is worth the walk.
    const look = page.locator('.bs-alert button:not([disabled])').first();
    if (await look.count()) {
      await look.click();
      await page.waitForTimeout(80);
      continue;
    }

    // Spend some of the gap on the job. Alternate deliberately rather than
    // always taking the first thing offered — talking is always available in a
    // busy room, so a greedy loop would never once cross the building.
    if (step % 2 === 0) {
      const go = page.locator('.bs-go:not([disabled])');
      const count = await go.count();
      if (count) {
        await go.nth(Math.min(count - 1, step % 4)).click();
        await page.waitForTimeout(80);
        walked += 1;
        continue;
      }
    } else {
      const talk = page.locator('.bs-people button.btn:not([disabled])').first();
      if (await talk.count()) {
        await talk.click();
        await page.waitForTimeout(80);
        talked += 1;
        continue;
      }
    }

    const next = page.getByRole('button', { name: /^(Complete Segment|Let it run)$/ }).first();
    if (await next.count() && await next.isEnabled()) {
      await next.click();
      await page.waitForTimeout(90);
      continue;
    }
    break;
  }

  const advance = page.getByRole('button', { name: /^Start Week \d+$/ }).first();
  if (!(await advance.count())) break;
  await advance.click();
  await page.waitForTimeout(150);
  played = week;
}
check(played === PLAY_WEEKS, `${PLAY_WEEKS} weeks play through`, `got to ${played}`);
check(errors.length === 0, 'no script errors while playing', errors[0] || '');
check(walked > 0, 'the GM can cross the building', `${walked} moves`);
check(talked > 0, 'the GM can hear somebody out', `${talked} conversations`);
check(rosterPicks > 0, 'matches can be booked by clicking the roster', `${rosterPicks} booked that way`);

// The nights just played, read back off the save.
const archived = await page.evaluate(() => {
  const index = JSON.parse(localStorage.getItem('wgm_index_v1'));
  const save = JSON.parse(localStorage.getItem('wgm_save_' + index.currentId));
  const items = [];
  for (const week of [{ items: save.show.items }, ...(save.history || [])]) {
    for (const item of week.items || []) {
      if (item.type === 'match') items.push({ sides: item.sides, matchType: item.matchType, people: (item.participants || []).length });
    }
  }
  return items;
});
const shapeNames = [...new Set(archived.map(i => shapeName(i.sides, i.matchType) || 'Singles'))];
const biggestBout = archived.reduce((most, i) => Math.max(most, i.people), 0);

const night = await page.evaluate(() => {
  const index = JSON.parse(localStorage.getItem('wgm_index_v1'));
  const save = JSON.parse(localStorage.getItem('wgm_save_' + index.currentId));
  const kinds = new Set();
  for (const week of [{ journal: save.journal }, ...(save.history || [])]) {
    for (const entry of week.journal || []) kinds.add(entry.type);
  }
  return {
    location: save.location,
    placed: Object.keys(save.whereabouts || {}).length,
    rooms: new Set(Object.values(save.whereabouts || {})).size,
    kinds: [...kinds],
    threads: (save.threads || []).length,
    record: save.gmRecord,
  };
});
// Named on this side of the bridge: the shape names come from the model, which
// the page does not have loaded.
night.shapes = shapeNames;
night.biggest = biggestBout;
check(typeof night.location === 'string', 'the GM is somewhere specific', night.location);
check(night.kinds.includes('moved'), 'moving about is recorded');
check(night.kinds.includes('talked'), 'conversations are recorded');
const backstageKinds = ['argument', 'brawl', 'ambush', 'complaint', 'storm-in',
  'confrontation', 'refusal', 'walkout', 'tag-dispute', 'faction-dispute'];
const seenKinds = backstageKinds.filter(k => night.kinds.includes(k));
check(seenKinds.length >= 2, 'the building produces more than one kind of trouble', seenKinds.join(', '));
check(night.record && Number.isFinite(night.record.missed),
  'the record counts what happened with nobody in the room', `missed ${night.record.missed}`);

// The bell has to be doing something in the real thing too, not only in the
// simulation — and the game has to be keeping a reading of it.
const bellKinds = ['handshake', 'handshake-refused', 'stare-down', 'champion-challenge',
  'cheap-shot', 'attack', 'submission-held', 'faction-beatdown'];
const seenBell = bellKinds.filter(k => night.kinds.includes(k));
check(seenBell.length >= 2, 'the bell produces moments in the browser too', seenBell.join(', '));
check(night.threads > 0, 'the save is keeping threads', `${night.threads} pairs on the record`);

// The shape builder, driven through its own controls.
check(lockedFirst, 'a new GM is told they can only book a singles match');
check(boardDrawn === 113, 'the whole board draws', `${boardDrawn} nodes`);
check(tracedLit > 1 && tracedLit < boardDrawn,
  'tracing a locked capstone lights its path and nothing else', `${tracedLit} of ${boardDrawn} lit`);
check(/Total from here: \d+ points/.test(tracedTotal),
  'and says what the whole run costs', tracedTotal.trim());
check(boughtOne, 'an upgrade can be bought from the board');
check(unlockedAfter.includes('Tag team'),
  'and the shape it opens turns up on the builder', unlockedAfter.join(', ') || 'nothing offered');
check(intensitySteps === 5, 'the promo builder offers the whole intensity ladder',
  `${intensitySteps} rungs`);
check(promoOnCard, 'a promo can be booked onto the card');

check(/have not worked together|no warmth/.test(gateRefusal),
  'the tag gate refuses two strangers by name', gateRefusal.trim() || 'no refusal shown');
// A GM who has bought one upgrade can put one kind of match on television, and
// the card should show exactly that rather than everything the engine can do.
check(night.biggest <= 2, 'a gated GM cannot get a multi-way onto the card',
  `biggest was ${night.biggest} people`);

await page.getByRole('button', { name: 'Roster', exact: true }).click();
await page.waitForTimeout(200);
await page.locator('button.wlink').first().click();
await page.waitForTimeout(300);

const card = page.locator('.card');
check(await card.count() > 0, 'a wrestler card opens');
const shown = (await card.innerText()).toUpperCase();
for (const heading of ['ABILITY', 'PERSONALITY', 'WHERE YOU STAND', 'WHAT IS ON THEIR MIND', 'STIPULATIONS', 'THE LOCKER ROOM']) {
  check(shown.includes(heading), `the card shows "${heading}"`);
}
// Word boundaries, not substrings: the name generator can produce "Brennan",
// which uppercases to something containing NAN and failed this check at random
// depending on who was on the roster.
check(!/\bNAN\b|\bUNDEFINED\b|\[OBJECT/.test(shown), 'nothing on the card reads NaN or undefined');
const traitRows = await page.locator('.traits li').count();
check(traitRows === 0 || traitRows === TRAITS.length,
  'personality is either withheld or shown in full', `${traitRows} rows`);

// Narrow. A fifth tab once overflowed here, so the check stays.
await page.setViewportSize({ width: 400, height: 900 });
await page.waitForTimeout(200);
check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  'the card does not scroll sideways at 400px');
await page.setViewportSize({ width: 1200, height: 900 });

// The save on disk.
const stored = await page.evaluate(() => {
  const index = JSON.parse(localStorage.getItem('wgm_index_v1'));
  const save = JSON.parse(localStorage.getItem('wgm_save_' + index.currentId));
  return {
    version: save.version,
    week: save.week,
    traits: save.wrestlers.every(w => w.traits && Number.isFinite(w.traits.jealousy)),
    baseline: save.wrestlers.every(w => Number.isFinite(w.baseline)),
    memories: save.wrestlers.some(w => (w.memories || []).length > 0),
    split: save.wrestlers.every(w => w.stats.ego === undefined && w.stats.ambition === undefined),
    ties: save.wrestlers.some(w => Object.values(w.relationships).some(r => r.tie)),
  };
});
check(stored.traits, 'every saved wrestler carries the full set of traits');
check(stored.baseline, 'every saved wrestler has a natural level');
check(stored.memories, 'memories are written to the save');
check(stored.split, 'personality no longer sits in stats');
check(stored.ties, 'named ties were seeded into the roster');
check(spread.rooms >= 3, 'the roster is spread across the building', `${spread.rooms} rooms, ${spread.placed} people`);
check(spread.clock > 0, 'the gap between segments is the segment', `${spread.clock} minutes`);

await page.reload();
await page.waitForTimeout(500);
const reloaded = await page.evaluate(() => {
  const index = JSON.parse(localStorage.getItem('wgm_index_v1'));
  return JSON.parse(localStorage.getItem('wgm_save_' + index.currentId)).week;
});
check(reloaded === stored.week, 'the week survives a reload', `${stored.week} -> ${reloaded}`);

// An older save must upgrade in place rather than being discarded — and the
// three traits that moved out of `stats` must keep their values.
await page.evaluate(() => {
  const index = JSON.parse(localStorage.getItem('wgm_index_v1'));
  const save = JSON.parse(localStorage.getItem('wgm_save_' + index.currentId));
  save.version = 12;
  delete save.location; delete save.whereabouts; delete save.clock;
  delete save.alerts; delete save.missed; delete save.deferred; delete save.spokenTo;
  delete save.security; delete save.threads;
  for (const w of save.wrestlers) {
    delete w.injuredUntil;
    for (const rel of Object.values(w.relationships)) delete rel.teamed;
  }
  save.gmRecord = { harsh: 1, weak: 0, fair: 2, ignored: 0, booked: 0 };
  for (const w of save.wrestlers) {
    w.stats = { inRing: w.stats.inRing, charisma: w.stats.charisma, ego: 77, ambition: 66, professionalism: 44 };
    delete w.traits; delete w.memories; delete w.baseline;
    for (const rel of Object.values(w.relationships)) { delete rel.owed; delete rel.tie; }
  }
  localStorage.setItem('wgm_save_' + index.currentId, JSON.stringify(save));
});
await page.reload();
await page.waitForTimeout(600);
const migrated = await page.evaluate(() => {
  const index = JSON.parse(localStorage.getItem('wgm_index_v1'));
  const save = JSON.parse(localStorage.getItem('wgm_save_' + index.currentId));
  return {
    version: save.version,
    carried: save.wrestlers.every(w => w.traits.ego === 77 && w.traits.ambition === 66 && w.traits.professionalism === 44),
    filled: save.wrestlers.every(w => Number.isFinite(w.traits.courage) && Number.isFinite(w.traits.loyalty)),
    baseline: save.wrestlers.every(w => Number.isFinite(w.baseline)),
    owed: save.wrestlers.every(w => Object.values(w.relationships).every(r => Number.isFinite(r.owed))),
    backstage: typeof save.location === 'string' && Array.isArray(save.alerts)
      && Array.isArray(save.missed) && Array.isArray(save.deferred),
    record: Boolean(save.gmRecord) && Number.isFinite(save.gmRecord.gaveIn)
      && Number.isFinite(save.gmRecord.missed) && save.gmRecord.fair === 2,
    threads: Array.isArray(save.threads),
    teamed: save.wrestlers.every(w =>
      Object.values(w.relationships).every(r => Number.isFinite(r.teamed))),
  };
});
check(migrated.version === 19, 'an older save is upgraded and written back', `version ${migrated.version}`);
check(migrated.threads && migrated.teamed, 'an upgraded save can start noticing stories');
check(migrated.backstage, 'an upgraded save gets a building to stand in');
check(migrated.record, 'the existing record survives and gains the new counts');
check(migrated.carried, 'the three moved traits keep their values');
check(migrated.filled, 'the eight new traits are filled in');
check(migrated.baseline, 'upgraded wrestlers get a natural level');
check(migrated.owed, 'old relationship records are backfilled');
check(errors.length === 0, 'no script errors overall', errors.slice(0, 2).join(' | '));

await browser.close();
server.kill();

console.log(failures.length ? `\n${failures.length} FAILING:\n- ${failures.join('\n- ')}` : '\nall green');
process.exit(failures.length ? 1 : 0);
