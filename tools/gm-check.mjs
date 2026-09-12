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
const { seedTitles } = await mod('model/titles.js');
const gameModel = await mod('model/game.js');
const { createMatch, createTagMatch, createSegment, addItem, remainingMinutes } = await mod('model/show.js');
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
    version: 15, seed, rng: seed,
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
  const extra = { matches: 0, crews: 0, ties: [] };
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
      } else if (draw < 0.3) {
        const four = [];
        while (four.length < 4) {
          const id = fit[Math.floor(pick() * fit.length)].id;
          if (!four.includes(id)) four.push(id);
        }
        addItem(state.show, createTagMatch({
          teamA: four.slice(0, 2), teamB: four.slice(2), plannedMinutes: 14,
        }));
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
let matchCount = 0;
let crewCount = 0;
let sound = true;

for (let run = 0; run < RUNS; run += 1) {
  const { state, beats: b, per, extra } = playSeason(3000 + run * 104729);
  for (const key of Object.keys(beats)) beats[key] += b[key];
  matchCount += extra.matches;
  crewCount += extra.crews;
  for (const kind of extra.ties) ties.set(kind, (ties.get(kind) || 0) + 1);
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

console.log('');
await page.goto(`http://127.0.0.1:${PORT}/gm/index.html`);
await page.waitForTimeout(400);
await page.getByRole('button', { name: /new save|start a new save/i }).first().click();
await page.waitForTimeout(300);
check(await page.getByRole('button', { name: 'Roster', exact: true }).count() > 0, 'a new save opens onto the roster');

const PLAY_WEEKS = 10;
let played = 0;
let talked = 0;
let walked = 0;
let spread = { placed: 0, rooms: 0, clock: 0 };
for (let week = 1; week <= PLAY_WEEKS; week += 1) {
  await page.getByRole('button', { name: 'Booking', exact: true }).click();
  await page.waitForTimeout(120);

  for (let i = 0; i < 5; i += 1) {
    // textContent, not innerText: the panel headings are uppercased in CSS and
    // innerText returns what is rendered.
    const free = await page.evaluate(() => {
      const booked = new Set([...document.querySelectorAll('table tbody tr td')]
        .flatMap(td => td.textContent.split(/,| vs\.? |&/).map(s => s.trim())));
      const panel = [...document.querySelectorAll('.panel')]
        .find(p => p.querySelector('h3')?.textContent.trim() === 'Add match');
      if (!panel) return null;
      const opts = [...panel.querySelectorAll('select')[0].options]
        .filter(o => o.value && !/\(/.test(o.text) && !booked.has(o.text));
      return opts.length >= 2 ? [opts[0].value, opts[1].value] : null;
    });
    if (!free) break;
    const selects = page.locator('.panel', { has: page.getByRole('heading', { name: 'Add match' }) }).locator('select');
    await selects.nth(0).selectOption(free[0]);
    await page.waitForTimeout(50);
    await selects.nth(1).selectOption(free[1]);
    await page.waitForTimeout(50);
    await page.getByRole('button', { name: 'Add match', exact: true }).click();
    await page.waitForTimeout(80);
  }

  const start = page.getByRole('button', { name: /^Start Show$/ }).first();
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

// The nights just played, read back off the save.
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
check(!/NAN|UNDEFINED|\[OBJECT/.test(shown), 'nothing on the card reads NaN or undefined');
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
check(migrated.version === 15, 'an older save is upgraded and written back', `version ${migrated.version}`);
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
