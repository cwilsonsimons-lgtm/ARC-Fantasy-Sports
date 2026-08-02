// Interaction checks for the league hub, chat-owned trades and notifications.
//
// Mirrors tools/markets-check.mjs: drive the real app in a real browser and
// assert what a user would see. Several assertions are about what is *absent* —
// league chrome on the hub, roster data leaking into a seeded league — because
// those are the failures a content-only check sails past.
//
// Usage: npm start (in one shell), then node tools/hub-check.mjs
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://127.0.0.1:8080/index.html';
let pass = 0, fail = 0;
const errs = [];

function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ||
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
// Player headshots come from nfl.com. Abort them up front the way pixel-diff
// does, so an offline run fails deterministically instead of sprinkling
// resource errors through the console and drowning real ones.
await page.route('**/*', r =>
  /^http:\/\/127\.0\.0\.1:8080\//.test(r.request().url()) ? r.continue() : r.abort());
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => {
  if (m.type() !== 'error') return;
  if (/Failed to load resource/.test(m.text())) return;   // aborted remote asset
  errs.push(m.text());
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

const view = () => page.$eval('.view.on', v => v.dataset.view);
const vis = sel => page.$eval(sel, e => getComputedStyle(e).display !== 'none').catch(() => false);

console.log('\nA1 — home hub');
ok('opens on the hub', await view() === 'home');
ok('hub renders four leagues', (await page.$$('.hb-row')).length === 4);
ok('.leaguebar hidden on the hub', !(await vis('.leaguebar')));
ok('.tabs hidden on the hub', !(await vis('.tabs')));
ok('no "tap a league" copy',
  !(await page.$eval('#homeBody', e => /tap (a|any) league/i.test(e.textContent))));
ok('a score line renders', (await page.$$('.hb-line')).length >= 1);
ok('a win% pill renders', (await page.$$('.hb-pct')).length >= 1);
// City Boys Dynasty derives its own status, so before the draft runs it is
// pre-draft too — two countdowns, not one.
ok('pre-draft rows count down instead of scoring', (await page.$$('.hb-clock')).length === 2);
ok('the mocked pre-draft league is one of them',
  await page.$eval('.hb-row[data-league="midway"]', e => !!e.querySelector('.hb-clock')));
ok('mid-season and complete leagues score instead',
  await page.$eval('.hb-row[data-league="sunday"]', e => !!e.querySelector('.hb-line')) &&
  await page.$eval('.hb-row[data-league="hallmark"]', e => !!e.querySelector('.hb-line')));

// reorder persists
const before = await page.$$eval('.hb-row', rs => rs.map(r => r.dataset.league));
await page.evaluate(() => window.setLeagueOrder(['sunday', 'cbd', 'midway', 'hallmark']));
await page.evaluate(() => window.renderHome());
const after = await page.$$eval('.hb-row', rs => rs.map(r => r.dataset.league));
ok('order is applied and persisted', after[0] === 'sunday' && before[0] !== after[0]);
ok('order survives a reload', await page.reload({ waitUntil: 'networkidle' })
  .then(() => page.waitForTimeout(300))
  .then(() => page.$$eval('.hb-row', rs => rs[0].dataset.league)) === 'sunday');

console.log('\nA1 — entering a league');
await page.evaluate(() => window.openLeague('cbd'));
await page.waitForTimeout(200);
ok('real league enters its own view', ['matchup', 'draft'].includes(await view()));
ok('.leaguebar returns inside a league', await vis('.leaguebar') || await view() === 'matchup');
ok('drawer carries a hub return',
  await page.$eval('#rail', e => /Leagues/.test(e.textContent)));
await page.evaluate(() => window.goHome());
await page.waitForTimeout(150);
ok('hub return works', await view() === 'home');

await page.evaluate(() => window.openLeague('sunday'));
await page.waitForTimeout(250);
ok('seeded league opens its matchup', await view() === 'matchup');
ok('seeded league draws its own teams',
  await page.$eval('#userHero', e => /Rondo|Pylon/.test(e.textContent)));
ok('seeded league does not leak the real league',
  !(await page.$eval('#userHero', e => /UGF Pandas/.test(e.textContent))));
ok('seeded league renders standings',
  await page.$eval('#userLineup', e => e.querySelectorAll('.stand-row').length >= 8));
ok('seeded league hides the real week stepper',
  !(await page.$eval('.view[data-view="matchup"] .mrow', e => getComputedStyle(e).display !== 'none')));

// A seeded league must not write to the real one. Both of these leaked before:
// S.week was reassigned, and the shared matchup containers kept seeded markup.
await page.evaluate(() => window.openLeague('cbd'));
await page.waitForTimeout(300);
await page.evaluate(() => window.showTab('matchup'));
await page.waitForTimeout(250);
ok('seeded league left the real week alone',
  await page.$eval('.view[data-view="matchup"] [data-weeklabel]', e => e.textContent) === 'Week 1');
ok('returning to the real league repaints its own matchup',
  await page.$eval('#userHero', e => /UGF Pandas/.test(e.textContent)));
ok('no seeded team survives the return',
  !(await page.$eval('#userHero', e => /Rondo|Pylon/.test(e.textContent))));

// a roster opened inside a seeded league goes back to that league
await page.evaluate(() => window.openLeague('hallmark'));
await page.waitForTimeout(250);
await page.evaluate(() => window.openSeededTeam('hallmark', 'tinsel'));
await page.waitForTimeout(200);
ok('seeded roster opens read-only',
  await page.$eval('#teamBody', e => /Tinsel Town/.test(e.textContent)) &&
  (await page.$$('#teamBody .tv-drop')).length === 0);
await page.evaluate(() => window.teamBack());
await page.waitForTimeout(250);
ok('back returns to the seeded league',
  await page.$eval('#userHero', e => /Garland|Mistletoe/.test(e.textContent)));
await page.evaluate(() => window.openLeague('cbd'));
await page.waitForTimeout(250);

console.log('\ncreate league');
await page.evaluate(() => { window.goHome(); });
await page.waitForTimeout(200);
ok('create entry sits under the leagues',
  await page.$eval('#homeBody', e => {
    const list = e.querySelector('.hb-list'), nu = e.querySelector('.hb-new');
    return !!nu && (list.compareDocumentPosition(nu) & Node.DOCUMENT_POSITION_FOLLOWING) > 0;
  }));
await page.evaluate(() => window.openCreateLeague());
await page.waitForTimeout(200);
ok('wizard opens on step 1', await view() === 'create'
  && await page.$eval('.wiz-step', e => /STEP 1 OF 6/.test(e.textContent)));
ok('six progress segments', (await page.$$('.wiz-seg')).length === 6);
ok('next is blocked until the step is valid',
  await page.$eval('#wizNext', e => e.classList.contains('off')));
// drive the whole wizard
await page.evaluate(() => {
  window.wizName('Test League');
  window.wizPick('source', 'default');
  window.wizPick('type', 'dynasty');
  window.wizPick('size', 12);
  window.wizPick('draftType', 'snake');
  window.wizPick('draftWhen', 'now');
  window.wizGo(5);
});
await page.waitForTimeout(200);
ok('review lists every choice',
  await page.$eval('#createBody', e => /Test League/.test(e.textContent)
    && /Dynasty/.test(e.textContent) && /Snake/.test(e.textContent)
    && /Start now/.test(e.textContent)));
ok('draft timing is on the draft step',
  await page.evaluate(() => { window.wizGo(4);
    return /Rolling hourly/.test(document.getElementById('createBody').textContent); }));
await page.evaluate(() => { window.wizGo(5); window.wizCreate(); });
await page.waitForTimeout(300);
ok('creating lands back on the hub', await view() === 'home');
ok('the new league is on the hub',
  await page.$eval('#homeBody', e => /Test League/.test(e.textContent)));
ok('it counts managers rather than scoring', (await page.$$('.hb-join')).length === 1);
ok('wizard state is cleared after creating',
  await page.evaluate(() => !window.store.createLeague));
ok('it survives a reload',
  await page.reload({ waitUntil: 'networkidle' }).then(() => page.waitForTimeout(300))
    .then(() => page.$eval('#homeBody', e => /Test League/.test(e.textContent))));

console.log('\ninvites and the waiting room');
const newId = await page.evaluate(() => window.myLeagues()[0].id);
await page.evaluate(id => window.openLeague(id), newId);
await page.waitForTimeout(250);
ok('opening it shows the waiting room',
  (await page.$$('.dr-wait')).length === 1 && await view() === 'wait');
// it has no stadium stage, so it must keep the league bar rather than borrow
// the matchup view's stage mode, which hides it
ok('waiting room keeps the league bar', await vis('.leaguebar'));
ok('and drops the league tabs', !(await vis('.tabs')));
ok('roll call has a row per team',
  await page.$eval('#waitBody', e => e.querySelectorAll('.rc-row').length === 12));
ok('start draft is blocked until it fills',
  await page.$eval('.wiz-btn.primary', e => e.classList.contains('off')));
await page.evaluate(id => window.openInvite(id), newId);
await page.waitForTimeout(200);
ok('invite link is generated',
  await page.$eval('#invLink', e => /^https:\/\/arc\.app\/join\/\w+$/.test(e.value)));
await page.evaluate(id => { for (let i = 0; i < 11; i++) window.simulateJoin(id); }, newId);
await page.waitForTimeout(250);
ok('joins fill the roll call',
  await page.$eval('.dr-wait-s', e => /12 of 12/.test(e.textContent)));
ok('start draft unlocks when full',
  !(await page.$eval('.wiz-btn.primary', e => e.classList.contains('off'))));

console.log('\ntable standings');
await page.evaluate(() => { window.openLeague('cbd'); });
await page.waitForTimeout(250);
await page.evaluate(() => { window.setLeague('standings', 'table'); window.showTab('standings'); });
await page.waitForTimeout(250);
ok('table mode swaps the columns',
  await page.$eval('#standBody', e => /W-D-L/.test(e.textContent) && /PTS/.test(e.textContent)));
ok('sorted on points, not rank',
  await page.evaluate(() => {
    const pts = [...document.querySelectorAll('#standBody .st-c.df b')].map(e => +e.textContent);
    return pts.length > 1 && pts.every((v, i) => i === 0 || pts[i - 1] >= v);
  }));
await page.evaluate(() => { window.setLeague('standings', 'record'); window.showTab('standings'); });
await page.waitForTimeout(200);
ok('record mode restores W-L',
  await page.$eval('#standBody', e => /W-L/.test(e.textContent) && !/W-D-L/.test(e.textContent)));

console.log('\nleague crest');
await page.evaluate(() => { window.openSettings(); window.setSetTab('general'); });
await page.waitForTimeout(200);
ok('crest card is in league settings', (await page.$$('.set-crest')).length === 1);
ok('upload is commissioner-gated',
  await page.evaluate(() => {
    const before = !!document.querySelector('.set-crestrow .set-btn');
    window.togglePreviewAsMember();
    const after = !!document.querySelector('.set-crestrow .set-btn');
    window.togglePreviewAsMember();
    return before && !after;
  }));
ok('an uploaded crest reaches the hub',
  await page.evaluate(() => {
    const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    window.store.leagueLogos = window.store.leagueLogos || {};
    window.store.leagueLogos.cbd = px;
    window.goHome(); window.renderHome();
    return !!document.querySelector('.hb-row[data-league="cbd"] .hb-crest img');
  }));

console.log('\nthe Arc mark');
ok('the mark is drawn once, as vector',
  await page.evaluate(() => {
    window.openMarkets();
    const m = document.querySelectorAll('.mk-mark');
    return m.length === 1 && m[0].tagName.toLowerCase() === 'svg';
  }));
await page.evaluate(() => { window.closeMarkets(); window.openLeague('cbd'); });
await page.waitForTimeout(250);

console.log('\nA2 — chat owns trades');
await page.evaluate(() => window.openChat());
await page.waitForTimeout(250);
ok('chat opens (and pulls back to the real league)', await view() === 'chat');
ok('seeded messages render', (await page.$$('.cm')).length >= 4);
ok('trade cards render inline', (await page.$$('.tc')).length >= 2);
ok('a proposed card is actionable', (await page.$$('.tc-acts')).length >= 2);
ok('a counter note renders',
  await page.$eval('#chatBody', e => /add a second and a fourth/.test(e.textContent)));
ok('a conditional pick shows its clause',
  await page.$eval('#chatBody', e => /1st if .*championship/i.test(e.textContent)));

// send a message
await page.fill('#chInput', 'testing one two');
await page.click('.ch-send');
await page.waitForTimeout(150);
ok('sending appends to the log',
  await page.$eval('#chatBody', e => /testing one two/.test(e.textContent)));

// one-to-one thread
await page.evaluate(() => window.openThread('radiator'));
await page.waitForTimeout(200);
ok('thread opens on the same view', await view() === 'chat');
ok('thread filters to that manager',
  await page.$eval('#chatBody', e => !/waiver order posted/.test(e.textContent)));

console.log('\nA2 — trade builder');
await page.evaluate(() => window.buildTrade('pandas', 'radiator'));
await page.waitForTimeout(250);
ok('builder opens', await view() === 'trade');
ok('two asset columns', (await page.$$('.tb-col')).length === 2);
ok('picks sit alongside players', (await page.$$('.as-pick')).length >= 6);
ok('evaluator strip is docked', (await page.$$('.tb-eval')).length === 1);
const evalBefore = await page.$eval('.tb-eval', e => e.className);
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.tb-col')][0].querySelectorAll('.tb-row')[0];
  row.click();
});
await page.waitForTimeout(150);
ok('tapping an asset moves it in', (await page.$$('.tb-row.on')).length >= 1);
ok('evaluator recomputes', await page.$eval('.tb-eval', e => e.className) !== evalBefore);
ok('evaluator shows both totals',
  await page.$eval('.tb-nums', e => e.querySelectorAll('span').length === 2));

// conditions are picks-only
const condOnPlayer = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.tb-row.on')];
  return rows.some(r => r.querySelector('.as-pl') && r.querySelector('.tb-cond'));
});
ok('players cannot carry a condition', !condOnPlayer);

console.log('\nA2 — accept posts a poll');
await page.evaluate(() => window.openChat());
await page.waitForTimeout(200);
const tradeId = await page.evaluate(() =>
  (window.chatLog() || []).filter(m => m.kind === 'trade' && m.trade.to === 'pandas')[0].id);
await page.evaluate(id => window.acceptTrade(id), tradeId);
await page.waitForTimeout(250);
ok('accepted status shows', (await page.$$('.tc-st.acc')).length >= 1);
ok('system message posted',
  await page.$eval('#chatBody', e => /completed a trade/.test(e.textContent)));
ok('poll auto-attached', (await page.$$('.pl')).length >= 1);
ok('poll asks who won',
  await page.$eval('.pl-q', e => /who won this trade/i.test(e.textContent)));
ok('poll has three options', (await page.$$('.pl .pl-opt')).length === 3);
ok('poll renders bars', (await page.$$('.pl-opt i')).length === 3);
await page.click('.pl-opt');
await page.waitForTimeout(150);
ok('voting registers', (await page.$$('.pl-opt.on')).length === 1);

console.log('\nA3 — notifications');
await page.evaluate(() => window.openNotifs());
await page.waitForTimeout(200);
ok('notification centre opens', await view() === 'notifs');
ok('trade notification generated',
  await page.$eval('#notifBody', e => /Trade accepted|Trade offer/.test(e.textContent)));
const waiverCount = await page.evaluate(() =>
  window.notifs().filter(n => n.type === 'waiver_open').length);
ok('exactly one waiver_open notification', waiverCount <= 1, `got ${waiverCount}`);
ok('bell carries an unread count',
  await page.evaluate(() => window.unreadNotifs()) >= 1);
await page.evaluate(() => window.markAllRead());
await page.waitForTimeout(120);
ok('mark-read clears the count', await page.evaluate(() => window.unreadNotifs()) === 0);

// no time-based prompts anywhere else
await page.evaluate(() => window.openLeague('cbd'));
await page.waitForTimeout(250);
// Scoped to the visible view: every view lives in `.scroll`, so reading the
// whole container would just find the notification centre's own copy.
const stray = await page.evaluate(() => {
  const seen = [];
  for (const v of document.querySelectorAll('.view.on')) {
    if (v.dataset.view === 'notifs') continue;
    if (/waivers open|recap ready|waivers close/i.test(v.textContent)) seen.push(v.dataset.view);
  }
  return seen;
});
ok('no waiver/recap banner outside the centre', stray.length === 0, stray.join(','));

console.log('\nA3 — settings toggles');
await page.evaluate(() => { window.openSettings(); window.setSetTab('notifs'); });
await page.waitForTimeout(200);
ok('alerts tab renders five toggles', (await page.$$('.set-tg')).length === 5);
await page.evaluate(() => window.setNotifPref('recap', 0));
await page.waitForTimeout(120);
ok('toggle persists', await page.evaluate(() => window.store.notifPrefs.recap) === false);
ok('a disabled type is not generated',
  await page.evaluate(() => {
    const before = window.notifs().length;
    window.pushNotif({ type: 'recap', title: 'x', body: '' });
    return window.notifs().length === before;
  }));
ok('alerts tab is not commissioner-gated',
  !(await page.$eval('#settingsBody', e => /Only .* can change these/.test(e.textContent))));

console.log('\nstorage');
ok('nothing writes raw localStorage outside the wrapper',
  await page.evaluate(() => Object.keys(localStorage).every(k =>
    k === 'cbd_team_v1' || k === 'arc_markets_v1')),
  await page.evaluate(() => Object.keys(localStorage).join(',')));

ok('no page errors', errs.length === 0, errs.slice(0, 4).join(' | '));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
