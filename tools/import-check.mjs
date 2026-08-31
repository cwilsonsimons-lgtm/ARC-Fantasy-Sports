// Drives the Sleeper import end to end and asserts what actually landed.
//
// Sleeper is unreachable here, so every run exercises the demo fallback — which
// is the point: the fallback runs the same buildImport() transform as a live
// import, so what this proves about the mapping holds for both.
//
// Usage: node tools/import-check.mjs [path-to-html]
import { chromium } from 'playwright';

const target = process.argv[2] || '/home/user/ARC-Fantasy-Sports/prototype/app.html';
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
await page.route('**/*', r => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));

const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto('file://' + target, { waitUntil: 'load' });
await page.waitForTimeout(500);

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};
const ev = code => page.evaluate(code);

console.log('\nthe flow');
await ev(`openImport()`);
check('import view opens', await ev(`document.querySelector('.view.on').dataset.view === 'import'`));
check('step 1 asks for a username', await ev(`!!document.getElementById('impUser')`));
check('go button starts disabled', await ev(`document.getElementById('impGo').classList.contains('off')`));

await ev(`importSetUser('someone')`);
check('typing enables the button', await ev(`!document.getElementById('impGo').classList.contains('off')`));

await ev(`importFind()`);
await page.waitForFunction(`!impState().busy`, null, { timeout: 20000 });
check('falls back to demo when Sleeper is unreachable', await ev(`impState().demo === true`));
check('fallback is disclosed, not silent', await ev(`/demo/i.test(document.getElementById('importBody').textContent)`));
check('a league is offered', await ev(`document.querySelectorAll('.imp-lg').length === 1`));

await ev(`importPickLeague('demo')`);
await page.waitForFunction(`!impState().busy && impState().step === 2`, null, { timeout: 20000 });

console.log('\nwhat the transform produced');
const b = await ev(`({
  teams: Object.keys(impState().built.teams).length,
  rows: impState().built.rowCount,
  unmatched: impState().built.unmatched.length,
  scored: Object.keys(impState().built.scoring).filter(k => impState().built.scoring[k]).length,
  missed: impState().built.missedScoring,
  tx: impState().built.tx.length,
  myKey: impState().built.myKey,
  dynasty: impState().built.dynasty,
  rec: impState().built.teams[impState().built.myKey].rec,
  ppr: impState().built.scoring.rec,
  passTD: impState().built.scoring.passTD,
  pa0: impState().built.scoring.pa0,
  starterSlots: (impState().built.rosters[impState().built.myKey] || []).filter(p => p.group === 'STARTERS').map(p => p.slot)
})`);
console.log('   ', JSON.stringify(b));
check('12 teams came across', b.teams === 12, `got ${b.teams}`);
check('rosters are populated', b.rows > 150, `${b.rows} rows`);
check('half-PPR carried over', b.ppr === 0.5, `rec = ${b.ppr}`);
check('passing TD carried over', b.passTD === 4, `passTD = ${b.passTD}`);
check('defence scoring carried over', b.pa0 === 10, `pa0 = ${b.pa0}`);
check('dynasty read from settings.type', b.dynasty === true);
check('records came across', /^\d+-\d+$/.test(b.rec), b.rec);
check('transactions came across', b.tx === 3, `${b.tx} moves`);
check('starters keep their slot labels', b.starterSlots.includes('FLEX') && b.starterSlots.includes('K'), b.starterSlots.join(','));
check('unmatched players are reported, not hidden', b.unmatched > 0, `${b.unmatched}`);
check('unmappable scoring rules are reported', b.missed.length === 2, b.missed.join(','));
check('only real rules are set', b.scored > 20 && b.scored < 40, `${b.scored} rules`);

console.log('\nwriting it into the app');
await ev(`importRun()`);
await page.waitForFunction(`impState().step === 3`, null, { timeout: 20000 });
check('lands on the done screen', await ev(`!!document.querySelector('.imp-done')`));
await ev(`importFinish()`);
await page.waitForTimeout(400);

const after = await ev(`(() => {
  const lg = activeLeague();
  return {
    id: lg.id, imported: !!lg.imported, teams: Object.keys(lg.teams || {}).length,
    view: document.querySelector('.view.on').dataset.view,
    roster: (seededRoster(lg, lg.myTeamKey) || []).length,
    score: leagueScore(lg),
    tx: txLog(lg.id).length,
    scoring: (store.scoringByLeague[lg.id] || {}).rec
  };
})()`);
console.log('   ', JSON.stringify(after));
check('the imported league is the active one', after.imported === true);
check('it opens on a real screen', ['league','standings','matchup','team'].includes(after.view), after.view);
check('its roster is the imported one', after.roster > 10, `${after.roster} players`);
check('its score is real, not a seeded hash', after.score && after.score.ms > 0, JSON.stringify(after.score));
check('its scoring is stored per league', after.scoring === 0.5);
check('its transactions are stored per league', after.tx === 3);

console.log('\nit survives a reload');
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);
const reloaded = await ev(`(() => {
  const l = orderedLeagues();
  const im = l.find(x => x.imported);
  return { first: l[0] && l[0].id, imported: !!im, tag: document.querySelector('.hb-src') ? document.querySelector('.hb-src').textContent : null,
           roster: im ? (seededRoster(im, im.myTeamKey) || []).length : 0 };
})()`);
console.log('   ', JSON.stringify(reloaded));
check('it is still on the hub after reload', reloaded.imported === true);
check('it sits at the top of the hub', reloaded.first && reloaded.first.startsWith('sl'), reloaded.first);
check('it is tagged as imported', reloaded.tag === 'DEMO', String(reloaded.tag));
check('its roster survived', reloaded.roster > 10, `${reloaded.roster}`);

console.log('\nthe rest of the app still works');
await ev(`goHome();openLeague('cbd')`);
await page.waitForTimeout(300);
check('the real league still opens', await ev(`activeLeague().id === 'cbd'`));
await ev(`showTab('standings')`);
await page.waitForTimeout(200);
check('standings still render', await ev(`document.getElementById('standBody').children.length > 0`));
await ev(`openMarkets()`);
await page.waitForTimeout(300);
check('markets still opens', await ev(`document.body.classList.contains('markets')|| !!document.querySelector('#mk')`));
await ev(`closeMarkets()`);

// ---------------------------------------------------------------------------
// The live path. Sleeper is unreachable from here, so a fake one is served to
// the page: the app's own fetch code runs unchanged against Sleeper-shaped
// JSON. This is what proves the live branch works, not just the fallback.
// ---------------------------------------------------------------------------
console.log('\nagainst a stand-in Sleeper');
const page2 = await browser.newPage({ viewport: { width: 420, height: 900 } });
const errors2 = [];
page2.on('pageerror', e => errors2.push(String(e)));

// Real names out of the app's own table, so the mapping has something to hit.
await page2.route('**/*', r => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
await page2.goto('file://' + target, { waitUntil: 'load' });
await page2.waitForTimeout(400);
const names = await page2.evaluate(`NFL_PLAYERS.slice(0, 8).map(p => ({ id: p.id, full: p.full, pos: p.pos, tm: p.tm }))`);

const dict = {};
names.forEach(p => {
  dict[p.id] = { player_id: p.id, position: p.pos, team: p.tm,
    first_name: p.full.split(' ')[0], last_name: p.full.split(' ').slice(1).join(' ') };
});
dict['KC'] = { player_id: 'KC', position: 'DEF', team: 'KC', first_name: 'Kansas City', last_name: 'Chiefs' };
const ids = names.map(p => p.id);

const fake = {
  '/v1/state/nfl': { season: '2025', week: 5 },
  '/v1/user/chrisw': { user_id: 'u1', display_name: 'chrisw', avatar: null },
  '/v1/user/u1/leagues/nfl/2025': [{
    league_id: 'L1', name: 'Stand-In League', season: '2025', total_rosters: 2,
    settings: { type: 0, leg: 5 }, status: 'in_season', avatar: null
  }],
  '/v1/league/L1': {
    league_id: 'L1', name: 'Stand-In League', season: '2025', status: 'in_season',
    total_rosters: 2, avatar: null,
    roster_positions: ['QB', 'RB', 'WR', 'FLEX', 'DEF', 'BN', 'BN'],
    settings: { type: 0, leg: 5 },
    scoring_settings: { rec: 1, pass_td: 4, rush_yd: 0.1, pts_allow_0: 10, made_up_rule: 3 }
  },
  '/v1/league/L1/users': [
    { user_id: 'u1', display_name: 'chrisw', metadata: { team_name: 'My Squad' }, avatar: null },
    { user_id: 'u2', display_name: 'rival', metadata: { team_name: 'Their Squad' }, avatar: null }
  ],
  '/v1/league/L1/rosters': [
    { roster_id: 1, owner_id: 'u1', starters: [ids[0], ids[1], ids[2], ids[3], 'KC'],
      players: ids.slice(0, 5).concat(['KC']), settings: { wins: 3, losses: 2, ties: 0, fpts: 512, fpts_decimal: 30 } },
    { roster_id: 2, owner_id: 'u2', starters: [ids[4], ids[5], ids[6], ids[7], 'KC'],
      players: ids.slice(4, 8).concat(['KC']), settings: { wins: 2, losses: 3, ties: 0, fpts: 488, fpts_decimal: 10 } }
  ],
  '/v1/players/nfl': dict
};

let served = 0, notFound = false;
await page2.unroute('**/*');
await page2.route('**/*', route => {
  const url = route.request().url();
  if (url.startsWith('file:')) return route.continue();
  if (!url.startsWith('https://api.sleeper.app')) return route.abort();
  const path = url.replace('https://api.sleeper.app', '');
  if (notFound && path.startsWith('/v1/user/')) {
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  }
  if (path.startsWith('/v1/league/L1/transactions/')) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  }
  const hit = fake[path];
  if (hit === undefined) return route.fulfill({ status: 404, contentType: 'application/json', body: 'null' });
  served++;
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hit) });
});

const ev2 = code => page2.evaluate(code);
await ev2(`openImport();importSetUser('chrisw');importFind()`);
await page2.waitForFunction(`!impState().busy`, null, { timeout: 20000 });
check('a live lookup does not fall back to demo', await ev2(`impState().demo === false`));
check('the live account is named on screen', await ev2(`/chrisw/.test(document.getElementById('importBody').textContent)`));
check('the live league is listed', await ev2(`/Stand-In League/.test(document.getElementById('importBody').textContent)`));

await ev2(`importPickLeague('L1')`);
await page2.waitForFunction(`impState().step === 2 && !impState().busy`, null, { timeout: 20000 });
const live = await ev2(`({
  teams: Object.keys(impState().built.teams).length,
  mine: impState().built.teams[impState().built.myKey].n,
  rec: impState().built.teams[impState().built.myKey].rec,
  rows: impState().built.rowCount,
  unmatched: impState().built.unmatched.length,
  missed: impState().built.missedScoring,
  ppr: impState().built.scoring.rec,
  dynasty: impState().built.dynasty,
  slots: impState().built.rosters[impState().built.myKey].filter(p => p.group === 'STARTERS').map(p => p.slot)
})`);
console.log('   ', JSON.stringify(live));
check('both live teams came across', live.teams === 2, `${live.teams}`);
check('owner_id picked the right team', live.mine === 'My Squad', live.mine);
check('the live record is read', live.rec === '3-2', live.rec);
check('full PPR read from the live league', live.ppr === 1, `${live.ppr}`);
check('redraft read from settings.type', live.dynasty === false);
check('only the defence failed to match', live.unmatched === 2, `${live.unmatched}`);
check('the invented rule is reported', live.missed.join() === 'made_up_rule', live.missed.join());
check('live starters keep their slots', live.slots.join() === 'QB,RB,WR,FLEX,DEF', live.slots.join());
check('the page really fetched Sleeper', served >= 5, `${served} calls served`);

console.log('\na username that is not there');
notFound = true;
await ev2(`openImport();importSetUser('nobodyhere');importFind()`);
await page2.waitForFunction(`!impState().busy`, null, { timeout: 20000 });
check('a 404 does not become demo data', await ev2(`impState().demo === false`));
check('it stays on the username step', await ev2(`impState().step === 0`));
check('it says the account is not there', await ev2(`/No Sleeper account called/.test(document.getElementById('importBody').textContent)`));
errors.push(...errors2);

console.log(`\n${pass} passed, ${fail} failed`);
console.log(errors.length ? `page errors:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
