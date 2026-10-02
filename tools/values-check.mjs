// Checks for League Values (values.html).
//
// Part 1 replays the model in Node against hand-built events and asserts the
// direction and size of each kind of move. Part 2 drives the page in Chromium
// with Sleeper and Dynasty Daddy faked at the network layer, so it runs offline
// and the numbers are known.
//
// Usage: node tools/values-check.mjs   (starts its own server)

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { replay, pickKey, buildFormat, DEFAULT_PARAMS } from '../js/values/model.js';
import { parseDynastyDaddy, mergeSnapshots } from '../js/values/baseline.js';
import { leaguePoints, describeScoring } from '../js/values/scoring.js';
import { parseTrades, weekEnd } from '../js/values/sleeper.js';

let failed = 0, passed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}
const DAY = 86400000;

// ---- part 1: model ---------------------------------------------------------
console.log('model');

const T0 = Date.UTC(2026, 8, 1);
const players = {
  wr1: { name: 'Young WR', pos: 'WR', age: 22 },
  rb1: { name: 'Vet RB', pos: 'RB', age: 28 },
  wr2: { name: 'Other young WR', pos: 'WR', age: 23 },
  te1: { name: 'Target TE', pos: 'TE', age: 26 },
  te2: { name: 'Blocking TE', pos: 'TE', age: 26 },
  qb1: { name: 'QB', pos: 'QB', age: 27 },
};
const snap = { date: T0, values: { wr1: 5000, rb1: 6000, wr2: 4000, te1: 3000, te2: 3000, qb1: 7000, [pickKey(2027, 1)]: 3500 } };

{
  const m0 = replay({ snapshots: [snap], players, now: T0 + 10 * DAY });
  check('no evidence: league value equals Dynasty Daddy', Math.abs(m0.value('wr1') - 5000) < 1e-6);

  const trade = { id: 't1', date: T0 + DAY, sides: [{ roster: 1, gets: ['wr1'] }, { roster: 2, gets: ['rb1'] }] };
  const m = replay({ snapshots: [snap], players, trades: [trade], now: T0 + 2 * DAY });
  const wr = m.value('wr1'), rb = m.value('rb1');
  check('accepted 5000-for-6000 raises the cheaper side', wr > 5000, `wr1=${wr.toFixed(0)}`);
  check('… and lowers the dearer side', rb < 6000, `rb1=${rb.toFixed(0)}`);
  check('… without closing the whole gap in one trade', rb / wr > 1.05, `ratio ${(rb / wr).toFixed(3)}`);
  check('… and spreads a little to similar players', m.value('wr2') > 4000 && m.value('wr2') < 4000 * (wr / 5000));
  check('… and explains itself', m.reasons('wr1').length === 1 && m.reasons('wr1')[0].kind === 'trade');

  const later = replay({ snapshots: [snap], players, trades: [trade], now: T0 + 400 * DAY });
  check('trade learning fades without new evidence', later.value('wr1') - 5000 < (wr - 5000) * 0.3);

  const ignored = replay({ snapshots: [snap], players, trades: [{ ...trade, ignored: true }], now: T0 + 2 * DAY });
  check('ignored trades teach nothing', Math.abs(ignored.value('wr1') - 5000) < 1e-6);

  const three = { id: 't3', date: T0 + DAY, sides: [{ roster: 1, gets: ['wr1'] }, { roster: 2, gets: ['rb1'] }, { roster: 3, gets: ['qb1'] }] };
  const m3 = replay({ snapshots: [snap], players, trades: [three], now: T0 + 2 * DAY });
  check('3-team trade pulls extremes toward each other', m3.value('qb1') < 7000 && m3.value('wr1') > 5000);
}

{
  // Rejected: wr2 (4000) offered for te1 (3000). Model had the receiver winning
  // by 33%, they said no — so te1 is worth more to this league than DD says.
  const rj = { id: 'r1', date: T0 + DAY, proposerGives: ['wr2'], receiverGives: ['te1'] };
  const m = replay({ snapshots: [snap], players, rejected: [rj], now: T0 + 2 * DAY });
  check('rejected lopsided offer raises the refused asset', m.value('te1') > 3000);
  check('… and lowers what was offered', m.value('wr2') < 4000);
  const fair = { id: 'r2', date: T0 + DAY, proposerGives: ['te2'], receiverGives: ['te1'] };
  const mf = replay({ snapshots: [snap], players, rejected: [fair], now: T0 + 2 * DAY });
  check('rejecting an even swap teaches nothing', Math.abs(mf.value('te1') - 3000) < 1e-6);
}

{
  // Scoring format: TEP + first downs. te1 catches 6/wk, te2 catches 2/wk.
  const scoring = { rec: 1, rec_yd: 0.1, rec_td: 6, bonus_rec_te: 0.5, rec_fd: 0.5, pass_td: 6, pass_yd: 0.04, rush_yd: 0.1, rush_fd: 0.5 };
  const line = (rec, yd, fd) => ({ rec, rec_yd: yd, rec_fd: fd, bonus_rec_te: rec, pts_ppr: rec + yd * 0.1 });
  check('league points dot product', leaguePoints(line(6, 60, 3), scoring) === 6 + 6 + 3 + 1.5);
  const weeks = [1, 2, 3, 4].map(w => ({
    end: T0 + w * 7 * DAY, label: `wk ${w}`,
    pts: {
      te1: [leaguePoints(line(6, 60, 3), scoring), 12, null],
      te2: [leaguePoints(line(2, 40, 1), scoring), 6, null],
      wr1: [leaguePoints({ rec: 5, rec_yd: 80, rec_fd: 4 }, scoring), 13, null],
    },
  }));
  const f = buildFormat(weeks, players, DEFAULT_PARAMS);
  check('no format edge before week 1 is final', f('te1', T0).pos === 0);
  const te = f('te1', T0 + 30 * DAY), wr = f('wr1', T0 + 30 * DAY);
  check('TE premium lifts TEs relative to WRs', te.pos > wr.pos, `te ${te.pos.toFixed(3)} wr ${wr.pos.toFixed(3)}`);
  check('high-volume TE gains on low-volume TE', f('te1', T0 + 30 * DAY).player > f('te2', T0 + 30 * DAY).player);
}

{
  // Form: 30 points on a 15 projection nudges up, small.
  const weeks = [{ end: T0 + 7 * DAY, label: 'wk 1', pts: { wr1: [30, 30, 15] } }];
  const m = replay({ snapshots: [snap], players, weeks, now: T0 + 8 * DAY }, { formatPosWeight: 0, formatPlayerWeight: 0 });
  const v = m.value('wr1');
  check('big week nudges value up a little', v > 5000 && v < 5100, v.toFixed(0));
}

{
  // Dynasty Daddy parsing.
  const rows = [
    { sleeper_id: '4984', full_name: 'Josh Allen', position: 'QB', trade_value: 6000, sf_trade_value: 9500 },
    { position: 'PI', first_name: '2027', last_name: 'Early 1st', trade_value: 4000, sf_trade_value: 4200 },
    { position: 'PI', first_name: '2027', last_name: 'Mid 1st', trade_value: 3500, sf_trade_value: 3700 },
    { position: 'PI', first_name: '2027', last_name: 'Late 1st', trade_value: 3000, sf_trade_value: 3200 },
  ];
  const [s] = parseDynastyDaddy(rows, { superflex: true, fallbackDate: T0 });
  check('DD: superflex value by sleeper id', s.values['4984'] === 9500);
  check('DD: pick valued as mid slot', s.values[pickKey(2027, 1)] === 3700);
  const [s1] = parseDynastyDaddy(rows, { superflex: false, fallbackDate: T0 });
  check('DD: 1QB uses trade_value', s1.values['4984'] === 6000);
  const hist = parseDynastyDaddy(rows.map((r, i) => ({ ...r, date: new Date(T0 + (i % 2) * DAY).toISOString() })));
  check('DD: dated rows become separate snapshots', hist.length === 2);
  const merged = mergeSnapshots([], Array.from({ length: 60 }, (_, i) => ({ date: T0 + i * DAY, values: { a: i } })), T0 + 59 * DAY);
  check('old snapshots thin to weekly', merged.length < 35 && merged[merged.length - 1].values.a === 59, `${merged.length}`);
}

{
  const tx = [{ type: 'trade', status: 'complete', transaction_id: 9, created: T0, roster_ids: [1, 2],
    adds: { p1: 1, p2: 2 }, drops: { p1: 2, p2: 1 }, draft_picks: [{ season: '2027', round: 2, roster_id: 2, previous_owner_id: 2, owner_id: 1 }] },
    { type: 'waiver', status: 'complete', transaction_id: 10, roster_ids: [1], adds: { p3: 1 } },
    { type: 'trade', status: 'failed', transaction_id: 11, roster_ids: [1, 2], adds: { p4: 1 } }];
  const t = parseTrades(tx, pickKey);
  check('Sleeper: only completed trades', t.length === 1);
  check('Sleeper: picks follow owner_id', t[0].sides.find(s => s.roster === 1).gets.includes(pickKey(2027, 2)));
  check('week 1 of 2026 ends Tue Sep 15', new Date(weekEnd(2026, 1)).toISOString().startsWith('2026-09-15'));
  const desc = describeScoring({ total_rosters: 10, roster_positions: ['QB', 'SUPER_FLEX'], scoring_settings: { pass_td: 6, rec_0_4: 0.5, rec_5_9: 1, bonus_rec_te: 0.5, rec_fd: 0.5, rush_fd: 0.5 } });
  check('scoring summary', ['10 teams', 'Superflex', '6pt pass TD', 'Tiered PPR', 'TE premium +0.5'].every(x => desc.includes(x)) && desc.some(x => x.startsWith('First downs')), desc.join(', '));
}

// ---- part 2: page ----------------------------------------------------------
console.log('page');

const PORT = 8093;
const server = spawn(process.execPath, ['tools/serve.mjs', '.', String(PORT)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 400));

const NOW = Date.UTC(2026, 9, 2, 15);
const scoring = { pass_td: 6, pass_yd: 0.04, rec_0_4: 0.5, rec_5_9: 0.75, rec_10_19: 1, rec_20p: 1.25, rec_yd: 0.1, rec_td: 6, rush_yd: 0.1, rush_td: 6, bonus_rec_te: 0.5, rec_fd: 0.5, rush_fd: 0.5, pass_fd: 0.25 };
const fakePlayers = {};
const dd = [];
const POS = ['QB', 'RB', 'WR', 'TE'];
for (let i = 1; i <= 80; i++) {
  const pos = POS[i % 4];
  fakePlayers[String(i)] = { full_name: `${pos} Player${i}`, position: pos, fantasy_positions: [pos], team: 'KC', age: 21 + (i % 12), status: 'Active' };
  dd.push({ sleeper_id: String(i), full_name: `${pos} Player${i}`, position: pos, trade_value: 9000 - i * 90, sf_trade_value: (pos === 'QB' ? 10500 : 9000) - i * 90 });
}
for (const y of [2027, 2028]) for (const r of [1, 2, 3]) for (const tier of ['Early', 'Mid', 'Late'])
  dd.push({ position: 'PI', first_name: String(y), last_name: `${tier} ${['1st', '2nd', '3rd'][r - 1]}`, trade_value: 4000 / r, sf_trade_value: 4200 / r });

const rosters = Array.from({ length: 10 }, (_, i) => ({ roster_id: i + 1, owner_id: 'u' + (i + 1), players: Array.from({ length: 8 }, (_, j) => String(i * 8 + j + 1)) }));
const users = rosters.map(r => ({ user_id: r.owner_id, display_name: `owner${r.roster_id}`, metadata: { team_name: `Team ${String.fromCharCode(64 + r.roster_id)}` } }));
const leagues = {
  L26: { league_id: 'L26', name: 'City Boys Dynasty', season: '2026', status: 'in_season', previous_league_id: 'L25', total_rosters: 10, roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX'], scoring_settings: scoring, settings: { type: 2 } },
  L25: { league_id: 'L25', name: 'City Boys Dynasty', season: '2025', status: 'complete', previous_league_id: null, total_rosters: 10, roster_positions: [], scoring_settings: scoring, settings: { type: 2 } },
};
// Week 3, 2026: Team A gets Player6 + a 2027 2nd, Team B gets Player9.
const trades = {
  'L26:3': [{ type: 'trade', status: 'complete', transaction_id: 501, created: Date.UTC(2026, 8, 24), status_updated: Date.UTC(2026, 8, 24),
    roster_ids: [1, 2], adds: { '6': 1, '9': 2 }, drops: { '6': 2, '9': 1 }, draft_picks: [{ season: '2027', round: 2, roster_id: 2, previous_owner_id: 2, owner_id: 1 }] }],
};
const statLine = (pid, w) => {
  const pos = fakePlayers[pid].position, k = +pid;
  if (pos === 'QB') return { gp: 1, pass_yd: 250 + k, pass_td: 2, pass_fd: 12, rush_yd: 20, pts_ppr: 20 + k / 10 };
  if (pos === 'RB') return { gp: 1, rush_yd: 70 + k, rush_td: w % 2, rush_fd: 4, rec: 3, rec_0_4: 0, rec_5_9: 3, rec_yd: 20, pts_ppr: 13 + 6 * (w % 2) };
  const rec = pos === 'TE' ? 7 : 5;
  return { gp: 1, rec, rec_10_19: rec, rec_yd: 70, rec_td: w % 3 === 0 ? 1 : 0, rec_fd: 4, bonus_rec_te: pos === 'TE' ? rec : 0, pts_ppr: rec + 7 + (w % 3 === 0 ? 6 : 0) };
};
const weekStats = w => Object.fromEntries(Object.keys(fakePlayers).map(id => [id, statLine(id, w)]));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ||
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });
await page.addInitScript(now => { const D = Date; Date.now = () => now; globalThis.Date = class extends D { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }; }, NOW);

let ddMode = 'block';
await page.route('https://api.sleeper.app/**', route => {
  const u = new URL(route.request().url()).pathname.replace('/v1', '');
  let m, body;
  if (u === '/state/nfl') body = { season: '2026', week: 5, season_type: 'regular' };
  else if ((m = u.match(/^\/league\/(\w+)$/))) body = leagues[m[1]];
  else if ((m = u.match(/^\/league\/(\w+)\/users$/))) body = users;
  else if ((m = u.match(/^\/league\/(\w+)\/rosters$/))) body = rosters;
  else if ((m = u.match(/^\/league\/(\w+)\/transactions\/(\d+)$/))) body = trades[`${m[1]}:${m[2]}`] || [];
  else if (u === '/players/nfl') body = fakePlayers;
  else if ((m = u.match(/^\/stats\/nfl\/regular\/(\d+)\/(\d+)$/))) body = weekStats(+m[2]);
  else if ((m = u.match(/^\/projections\/nfl\/regular\/(\d+)\/(\d+)$/))) body = {};
  if (!body) return route.fulfill({ status: 404, body: 'not found' });
  route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
});
await page.route('https://dynasty-daddy.com/**', route => ddMode === 'block'
  ? route.abort('failed')
  : route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(dd) }));

await page.goto(`http://127.0.0.1:${PORT}/values.html`);
check('fresh visit lands on Setup', await page.locator('#pane-setup.on').isVisible());

await page.fill('#s-league', 'L26');
await page.click('#s-save');
await page.waitForFunction(() => document.querySelector('#lv-league').textContent.includes('City Boys'));
const pills = await page.locator('#s-scoring span').allTextContents();
check('scoring detected from Sleeper', ['Superflex', '6pt pass TD', 'Tiered PPR', 'TE premium +0.5', '10 teams'].every(p => pills.includes(p)), pills.join(' | '));

// Direct fetch blocked → falls back to paste.
await page.click('#dd-fetch');
await page.waitForTimeout(200);
check('blocked fetch explains the paste fallback', errors.some(e => e.includes('Paste the values')));
errors.length = 0;
check('paste box opens', await page.locator('.lv-details').evaluate(d => d.open));
await page.fill('#dd-paste', JSON.stringify(dd));
await page.click('#dd-import');
check('pasted values stored', (await page.locator('#dd-status').textContent()).includes('1 snapshot'));
// The 3-month history endpoint: same rows, dated, values drifting.
const history = [60, 40, 20].flatMap(ago => dd.map(r => ({ ...r, sf_trade_value: r.sf_trade_value - ago * 5,
  date: new Date(NOW - ago * DAY).toISOString() })));
await page.fill('#dd-paste', JSON.stringify(history));
await page.click('#dd-import');
check('history import adds snapshots', (await page.locator('#dd-status').textContent()).includes('4 snapshots'));

await page.click('.lv-tab[data-tab="values"]');
const rows = await page.locator('#values-body tr').count();
await page.screenshot({ path: 'snapshots/values-table.png' }).catch(() => {});
check('values table lists players and picks', rows > 80, String(rows));
const qbTop = await page.locator('#values-body tr').first().locator('.lv-name').textContent();
check('superflex QB values used', qbTop.startsWith('QB'), qbTop);

// Team B received Player9 in the week-3 trade, so its sheet should cite it.
await page.fill('#f-search', 'Player9');
await page.locator('#values-body tr').first().click();
const sheet = await page.locator('#sheet-body').textContent();
check('player sheet explains trade move', sheet.includes('Trades involving this player') && /Traded|paid/.test(sheet), sheet.slice(0, 200));
check('sheet shows a chart', await page.locator('#sheet .lv-chart').count() === 1);
await page.screenshot({ path: 'snapshots/values-sheet.png' }).catch(() => {});
await page.click('#sheet-x');
await page.fill('#f-search', '');

await page.click('.lv-tab[data-tab="trades"]');
await page.screenshot({ path: 'snapshots/values-trades.png', fullPage: true }).catch(() => {});
check('trade log shows the Sleeper trade', (await page.locator('.lv-trade').count()) === 1);
check('trade verdict by DD', (await page.locator('.lv-trade-head').first().textContent()).includes('By Dynasty Daddy'));

// Log a rejected offer through the pickers.
const addAsset = async (sel, label) => { await page.fill(`${sel} input`, label); await page.locator(`${sel} input`).dispatchEvent('change'); };
await addAsset('#rj-offered', 'WR Player30 (WR, KC)');
await addAsset('#rj-asked', 'TE Player31 (TE, KC)');
check('picker adds assets', (await page.locator('#rj-offered .lv-asset').count()) === 1 && (await page.locator('#rj-asked .lv-asset').count()) === 1);
await page.click('#rj-add');
check('rejected offer listed', (await page.locator('.lv-tag.rej').count()) === 1);

// Ignore toggle round-trips.
await page.locator('[data-ignore]').click();
check('ignore marks trade', (await page.locator('.lv-trade.ignored').count()) === 1);
await page.locator('[data-ignore]').click();

await page.click('.lv-tab[data-tab="calc"]');
await addAsset('#calc-a', 'QB Player4 (QB, KC)');
await addAsset('#calc-b', '2027 1st');
await addAsset('#calc-b', 'RB Player5 (RB, KC)');
const verdict = await page.locator('.lv-verdict').textContent();
check('trade check gives a verdict', /This league: (Fair|Side [AB] wins)/.test(verdict), verdict);

// Persistence: reload keeps league, values, rejected offer.
await page.reload();
await page.click('.lv-tab[data-tab="trades"]');
check('state survives reload', (await page.locator('.lv-tag.rej').count()) === 1 && (await page.locator('.lv-trade').count()) === 2);

// Direct fetch works when allowed.
ddMode = 'allow';
await page.click('.lv-tab[data-tab="setup"]');
await page.click('#dd-fetch');
await page.waitForTimeout(200);
check('direct fetch path works when CORS allows it', (await page.locator('#lv-status').textContent()).includes('Loaded'));

// Separation from the fantasy app and Arc Markets.
const keys = await page.evaluate(() => Object.keys(localStorage));
check('only its own storage keys', keys.every(k => k.startsWith('league_values')), keys.join(','));

// Phone width: no horizontal scroll.
await page.setViewportSize({ width: 375, height: 800 });
await page.click('.lv-tab[data-tab="values"]');
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('no horizontal scroll at 375px', overflow <= 0, String(overflow));
await page.screenshot({ path: 'snapshots/values-phone.png' }).catch(() => {});

check('no page errors', errors.length === 0, errors.join(' | '));

await browser.close();
server.kill();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
