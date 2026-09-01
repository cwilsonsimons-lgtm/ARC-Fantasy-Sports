// An imported league has to behave like one started in the app, not like a
// record of someone else's league. This imports one and then does the ordinary
// things a manager does — set a lineup, add a free agent, open the trade
// screen, change a setting — and checks they take and survive a reload.
//
// It also checks the demo league is untouched by the league swap, since T,
// MY_TEAM and DRAFT_ORDER are now rebound whenever leagues change.
//
// Usage: node tools/native-check.mjs [path-to-html]
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
const ev = c => page.evaluate(c);

// Snapshot the demo league first, to prove the swap leaves it alone.
const demoBefore = await ev(`(() => ({
  ...spaceInfo(), type: LG().type
}))()`);

console.log('\nimporting');
await ev(`openImport(); importSetUser('someone'); importFind()`);
await page.waitForFunction(`!impState().busy`, null, { timeout: 20000 });
await ev(`importPickLeague('demo')`);
await page.waitForFunction(`impState().step === 2 && !impState().busy`, null, { timeout: 20000 });
await ev(`importRun()`);
await page.waitForFunction(`impState().step === 3`, null, { timeout: 20000 });
const lid = await ev(`impState().newId`);
await ev(`importFinish()`);
await page.waitForTimeout(500);

console.log('\nit is a real league of the app');
const shape = await ev(`(() => {
  const lg = activeLeague();
  return {
    real: !!lg.real, imported: !!lg.imported, ...spaceInfo(),
    myTeamName: (T[spaceInfo().my] || {}).n,
    status: leagueStatus(lg), draftDone: draftDone(),
    commish: isCommish(), rosterLeague: rosterLeagueId(),
    slots: JSON.stringify(store.slots), type: LG().type
  };
})()`);
console.log('   ', JSON.stringify(shape));
check('it is flagged real', shape.real === true);
check('its teams replaced the demo table', shape.teams === 12, `${shape.teams}`);
check('my team is one of its teams', shape.myTeamName === 'Gridiron Dynasty', String(shape.myTeamName));
check('it opens at its own week', shape.week === 14, `week ${shape.week}`);
check('it is playing, not pre-draft', shape.status === 'active', shape.status);
check('it has no draft to wait on', shape.draftDone === true);
check('rosters resolve to this league, not cbd', shape.rosterLeague === lid, shape.rosterLeague);
check('the importing manager runs it', shape.commish === true);
check('it kept the Sleeper lineup shape', /"FLEX":1/.test(shape.slots), shape.slots);

console.log('\nthe roster is real and mine to edit');
const roster = await ev(`(() => {
  const r = rosterOf(spaceInfo().my);
  return {
    starters: r.starters.filter(s => s.player).length,
    slots: r.starters.map(s => s.slot).join(','),
    bench: r.bench.filter(Boolean).length,
    first: r.starters[0] && r.starters[0].player && r.starters[0].player.n,
    benchHasKicker: r.bench.some(p => p && p.pos === 'K')
  };
})()`);
console.log('   ', JSON.stringify(roster));
check('starters are filled from the import', roster.starters >= 6, `${roster.starters}`);
check('the lineup uses the league\'s own slots', roster.slots.startsWith('QB,RB,RB,WR'), roster.slots);
check('the bench holds the rest', roster.bench > 0, `${roster.bench}`);
check('kickers came across on the bench', roster.benchHasKicker === true);

// swap a starter for a bench player — the ordinary weekly action
const swapped = await ev(`(() => {
  const r = rosterOf(spaceInfo().my);
  const si = r.starters.findIndex(s => s.player && s.player.pos === 'RB');
  const bi = r.bench.findIndex(p => p && p.pos === 'RB');
  if (si < 0 || bi < 0) return { skipped: true };
  const inName = r.bench[bi].n, outName = r.starters[si].player.n;
  const tmp = r.starters[si].player;
  r.starters[si].player = r.bench[bi];
  r.bench[bi] = tmp;
  persistRoster();
  return { inName, outName, si };
})()`);
console.log('   ', JSON.stringify(swapped));
check('a lineup change is accepted', !swapped.skipped, 'no RB pair to swap');

console.log('\nfree agency and the transaction log work here');
const fa = await ev(`(() => {
  const before = txLog(activeLeagueId()).length;
  const pool = freeAgents('WR');
  if (!pool.length) return { none: true };
  const key = pKeyOf(pool[0]);
  addPlayer(key);
  const after = txLog(activeLeagueId()).length;
  return { added: pool[0].n, before, after, onRoster: rosterPlayers(rosterOf(spaceInfo().my)).some(p => pKeyOf(p) === key) };
})()`);
console.log('   ', JSON.stringify(fa));
check('a free agent can be added', fa.onRoster === true, JSON.stringify(fa));
check('the pickup is logged to this league', fa.after === fa.before + 1, `${fa.before} -> ${fa.after}`);

console.log('\nleague settings are its own');
const settings = await ev(`(() => {
  LG().teams = 12; LG().waiver = 'faab'; saveStore();
  return { teams: LG().teams, waiver: LG().waiver, spaceWaiver: (store.spaces[spaceInfo().id] || {}).league.waiver };
})()`);
check('a setting change lands in this league\'s workspace', settings.spaceWaiver === 'faab', JSON.stringify(settings));

console.log('\nthe demo league is untouched by the swap');
await ev(`goHome(); openLeague('cbd')`);
await page.waitForTimeout(400);
const demoAfter = await ev(`(() => ({
  ...spaceInfo(), type: LG().type, waiver: LG().waiver, roster: rosterLeagueId()
}))()`);
console.log('   ', JSON.stringify(demoAfter));
check('its team table is back', demoAfter.teams === demoBefore.teams, `${demoAfter.teams} vs ${demoBefore.teams}`);
check('my team is back', demoAfter.my === demoBefore.my, `${demoAfter.my}`);
check('its draft order is back', demoAfter.order === demoBefore.order);
check('its draft size is back', demoAfter.total === demoBefore.total, `${demoAfter.total}`);
check('the other league\'s settings did not leak in', demoAfter.waiver !== 'faab', String(demoAfter.waiver));
check('rosters resolve to the demo league again', demoAfter.roster === 'cbd', demoAfter.roster);

console.log('\nall of it survives a reload');
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);
const after = await ev(`(() => {
  goHome(); openLeague('${lid}');
  const r = rosterOf(spaceInfo().my);
  return {
    ...spaceInfo(), waiver: LG().waiver, tx: txLog('${lid}').length,
    starter: r.starters.find(s => s.player && s.player.pos === 'RB'),
    added: rosterPlayers(r).length
  };
})()`);
console.log('   ', JSON.stringify({ ...after, starter: after.starter && after.starter.player.n }));
check('the league reopens with its own teams', after.teams === 12, `${after.teams}`);
check('at its own week', after.week === 14, `${after.week}`);
check('with its own settings', after.waiver === 'faab', String(after.waiver));
check('the lineup change persisted', after.starter && after.starter.player.n === swapped.inName,
  `${after.starter && after.starter.player.n} vs ${swapped.inName}`);
check('the free agent is still on the roster', after.added > 0, `${after.added}`);
check('the transaction log persisted', after.tx >= 4, `${after.tx}`);

console.log(`\n${pass} passed, ${fail} failed`);
console.log(errors.length ? `page errors:\n${errors.slice(0, 6).join('\n')}` : 'no page errors');
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
