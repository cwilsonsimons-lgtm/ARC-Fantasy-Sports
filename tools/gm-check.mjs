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
const { createMatch, createSegment, addItem, remainingMinutes } = await mod('model/show.js');
const { resetIds } = await mod('ids.js');
const { bookable } = await mod('model/morale.js');
const { trait, TRAITS } = await mod('model/traits.js');
const { gmStandingValue } = await mod('model/memory.js');
const { relationshipsOf } = await mod('model/relationships.js');

const WEEKS = 40;
const RUNS = 12;

// One randomly-booked season, played end to end.
function playSeason(seed) {
  resetIds();
  const rng = makeRng(seed);
  const state = {
    version: 13, seed, rng: seed,
    ...gameModel.createGame({
      wrestlers: generateRoster(rng),
      promotion: generatePromotion(rng),
      air: makeAirSchedule(rng),
      titles: [],
    }),
  };
  state.titles = seedTitles(state.wrestlers, rng);

  const pick = makeRng(seed ^ 0x5f5f);
  const beats = { save: 0, hesitation: 0, nobody: 0, escalation: 0, attack: 0, noticed: 0 };
  const per = new Map(state.wrestlers.map(w => [w.id, { saves: 0, attacks: 0, envy: 0 }]));

  for (let week = 0; week < WEEKS; week += 1) {
    let guard = 0;
    while (remainingMinutes(state.show, state.broadcast) >= 12 && guard++ < 12) {
      const fit = state.wrestlers.filter(bookable);
      if (fit.length < 2) break;
      const a = fit[Math.floor(pick() * fit.length)];
      const rest = fit.filter(w => w !== a);
      const b = rest[Math.floor(pick() * rest.length)];
      if (!a || !b) break;
      if (pick() < 0.25) addItem(state.show, createSegment({ participants: [a.id], name: 'Promo', plannedMinutes: 6 }));
      else addItem(state.show, createMatch({ wrestlerAId: a.id, wrestlerBId: b.id, plannedMinutes: 12 }));
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
      if (entry.type === 'save' || entry.type === 'escalation') per.get(entry.data.saverId).saves += 1;
      if (entry.type === 'attack') per.get(entry.data.aggressorId).attacks += 1;
      if (entry.type === 'noticed') per.get(entry.data.wrestlerId).envy += 1;
    }
    gameModel.advanceWeek(state);
  }
  return { state, beats, per };
}

const beats = { save: 0, hesitation: 0, nobody: 0, escalation: 0, attack: 0, noticed: 0 };
const rows = [];
const morales = [];
let sound = true;

for (let run = 0; run < RUNS; run += 1) {
  const { state, beats: b, per } = playSeason(3000 + run * 104729);
  for (const key of Object.keys(beats)) beats[key] += b[key];
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
      memories: (w.memories || []).length,
      standing: gmStandingValue(w, state.week),
      morale: w.morale,
    });
  }
}

console.log(`\n${RUNS} seasons of ${WEEKS} weeks, ${rows.length} wrestlers\n`);
check(sound, 'every wrestler comes out of a season structurally sound');

// The three outcomes of an attack should all be common. Any one of them
// swallowing the others means the reaction engine has stopped asking a question.
const share = key => beats[key] / Math.max(1, beats.attack);
for (const key of ['save', 'hesitation', 'nobody']) {
  const pct = share(key);
  check(pct >= 0.15 && pct <= 0.55, `"${key}" is a common outcome of an attack`, `${Math.round(pct * 100)}%`);
}
check(beats.escalation / Math.max(1, beats.save) < 0.5,
  'a locker-room brawl is the rare result, not the norm',
  `${beats.escalation} escalations from ${beats.save} saves`);

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
  ['vindictiveness', 'memories', 1, 'and holds the memory behind it longer'],
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

  for (let step = 0; step < 40; step += 1) {
    const answer = page.locator('.decision button').first();
    if (await answer.count() && await answer.isEnabled()) {
      await answer.click();
      await page.waitForTimeout(100);
      continue;
    }
    const next = page.getByRole('button', { name: /complete segment/i }).first();
    if (await next.count() && await next.isEnabled()) {
      await next.click();
      await page.waitForTimeout(100);
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
  };
});
check(migrated.version === 13, 'an older save is upgraded and written back', `version ${migrated.version}`);
check(migrated.carried, 'the three moved traits keep their values');
check(migrated.filled, 'the eight new traits are filled in');
check(migrated.baseline, 'upgraded wrestlers get a natural level');
check(migrated.owed, 'old relationship records are backfilled');
check(errors.length === 0, 'no script errors overall', errors.slice(0, 2).join(' | '));

await browser.close();
server.kill();

console.log(failures.length ? `\n${failures.length} FAILING:\n- ${failures.join('\n- ')}` : '\nall green');
process.exit(failures.length ? 1 : 0);
