// Every player name on screen opens his player card; every team record opens
// that team's schedule. This walks the app's screens and sheets and reports
// any visible name or record that is not a link (data-pc / data-sched, or a
// row that itself opens the player).
import { chromium } from 'playwright';
import fs from 'fs';
const R = new URL('./fixtures/', import.meta.url).pathname;
const OUT = process.argv[2] || '.';
const VERBOSE = process.argv.includes('-v');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
const json = (r, f) => r.fulfill({ status: 200, contentType: 'application/json', body: f && fs.existsSync(f) ? fs.readFileSync(f) : '[]', headers: { 'access-control-allow-origin': '*' } });
await p.route('**', r => {
  const u = new URL(r.request().url());
  if (u.protocol === 'file:') return r.continue();
  if (u.hostname === 'api.sleeper.app') {
    const m = u.pathname.match(/^\/v1\/league\/(\d+)(?:\/(\w+)(?:\/(\d+))?)?$/);
    if (!m || m[1] !== '1312045587541020672') return r.fulfill({ status: 404, body: 'null' });
    const f = !m[2] ? 'league.json' : m[2] === 'matchups' ? `matchups_${m[3]}.json` : m[2] + '.json';
    return json(r, R + 'league/' + f);
  }
  if (u.hostname === 'api.sleeper.com') { const m = u.pathname.match(/\/(stats|projections)\/nfl\/2026\/(\d+)/); return json(r, m && R + 'live/' + (m[1] === 'stats' ? 'stats_' : 'proj_') + m[2] + '.json'); }
  if (u.hostname === 'site.api.espn.com') return json(r, R + 'live/' + (u.pathname.endsWith('/scoreboard') ? 'board_' + u.searchParams.get('week') : 'summary_' + u.searchParams.get('event')) + '.json');
  return r.abort();
});
await p.clock.setFixedTime(new Date('2026-10-04T19:22:00Z'));
await p.goto('file://' + new URL('../1stPrototype.html', import.meta.url).pathname, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(800);
const ok = (l, c, x) => console.log((c ? '  ok   ' : '  FAIL ') + l + (x ? '  ' + x : ''));

// in the page: find visible names and records that are not links
await p.addScriptTag({ content: `
window.__audit = function () {
  if (!window.__names) {
    const s = new Set();
    NFL_PLAYERS.forEach((q) => [q.full, q.n].forEach((n) => { if (n && /\\S\\s+\\S/.test(n)) s.add(n.replace(/\\s+/g, ' ').trim()); }));
    window.__names = s;
  }
  const NAMES = window.__names;
  const REC = /(^|[\\s\\xB7(])(\\d{1,2}-\\d{1,2}(?:-\\d{1,2})?)(?=$|[\\s\\xB7),])/g;
  const SKIP = 'script,style,select,option,input,textarea,canvas,svg,.rw-bub,.toast,#toast,.mk-root,[data-audit-skip]';
  const found = (txt) => {
    const out = new Set(), tk = txt.replace(/\\s+/g, ' ').trim().split(' ');
    for (let i = 0; i < tk.length; i++) for (let n = 2; n <= 4 && i + n <= tk.length; n++) {
      const c = tk.slice(i, i + n).join(' ').replace(/[,;:!?)]+$|'s$/g, '');
      if (NAMES.has(c)) out.add(c);
    }
    let m;
    REC.lastIndex = 0;
    while ((m = REC.exec(txt))) out.add('rec:' + m[2]);
    return out;
  };
  const visible = (el) => {
    if (!el.getClientRects().length) return false;
    const sh = el.closest('.sheet');
    if (sh && !sh.classList.contains('show')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const linked = (el, key) => {
    const isRec = key.startsWith('rec:');
    const sel = isRec ? '[data-sched]' : '[data-pc]';
    if (el.closest(sel)) return true;
    if (!isRec && el.closest('[onclick*="openPlayer("]')) return true;
    const want = isRec ? key.slice(4) : key;
    return [...el.querySelectorAll(sel)].some((l) => l.innerText.replace(/\\s+/g, ' ').includes(want));
  };
  const misses = [];
  // a name inside a hidden or skipped part (a closed sheet, a chart bubble)
  // belongs to that part, not to the page around it
  const walk = (el, off) => {
    const skip = off || (el.matches && el.matches(SKIP)) || !visible(el);
    const mine = found(el.innerText || el.textContent || '');
    if (!mine.size) return mine;
    const below = new Set();
    for (const c of el.children) walk(c, skip).forEach((k) => below.add(k));
    if (!skip) mine.forEach((k) => {
      if (below.has(k)) return;
      if (!linked(el, k)) misses.push({ k, cls: (el.className && el.className.baseVal == null ? el.className : '') + '', txt: el.innerText.replace(/\\s+/g, ' ').slice(0, 70) });
    });
    return mine;
  };
  walk(document.body);
  const seen = new Set();
  return misses.filter((m) => { const s = m.k + '|' + m.cls; if (seen.has(s)) return false; seen.add(s); return true; });
};` });

const report = [];
async function audit(label, fn, arg) {
  try {
    await p.evaluate(fn, arg);
  } catch (e) {
    console.log('  !!   ' + label + ': setup failed ' + String(e).split('\n').slice(0, VERBOSE ? 6 : 1).join(' / '));
    report.push({ label, m: [{ k: 'setup failed' }] });
    return;
  }
  await p.waitForTimeout(350);
  const m = await p.evaluate(() => window.__audit());
  report.push({ label, m });
  console.log(`  ${m.length ? 'MISS ' : 'ok   '} ${label}${m.length ? '  ' + m.length : ''}`);
  if (m.length && VERBOSE) m.slice(0, VERBOSE ? 400 : 12).forEach((x) => console.log(`         ${x.k.padEnd(22)} .${String(x.cls).split(' ')[0].padEnd(14)} ${x.txt}`));
  await p.screenshot({ path: `${OUT}/audit-${label.replace(/[^a-z0-9]+/gi, '-')}.png` });
}
const closeSheets = () => p.evaluate(() => document.querySelectorAll('.sheet.show, .sheet-scrim.show').forEach((e) => e.classList.remove('show')));

// ---------------------------------------------------------------- City Boys (built in), live week 4
await p.evaluate(() => { openLeague('cbd'); autoDraftAll(); });
await p.evaluate(() => liveRefresh(true));
await p.waitForFunction(() => LIVE.loaded['stats:4'] && LIVE.loaded['stats:3'], null, { timeout: 20000 });
await p.waitForTimeout(800);
await audit('cbd matchup', () => { pickWeek(4); showTab('matchup'); renderUserMatchup(); });
await audit('cbd matchup + chart', () => { const b = document.querySelector('[data-rw="userRewind"]'); if (b) b.click(); });
await audit('cbd all matchups', () => showLeagueView());
await audit('cbd other matchup', () => openDetail(1));
await audit('cbd standings', () => showTab('standings'));
await audit('cbd standings table', () => { LG().standings = 'table'; showTab('standings'); });
await audit('cbd standings kart', () => { LG().standings = 'kart'; showTab('standings'); });
await p.evaluate(() => { LG().standings = 'record'; });
await audit('cbd my team', () => showTab('team'));
await audit('cbd other team', () => openTeam(Object.keys(T)[3]));
await audit('cbd player card', () => openPlayer(rosterFor(MY_TEAM)[0].id));
const openIdx = () => p.evaluate(() => { const r = rosterOf(MY_TEAM); return { s: r.starters.findIndex((x) => x.player && !isLocked(x.player)), b: r.bench.findIndex((x) => x && !isLocked(x)) }; });
let idx = await openIdx();
await audit('cbd swap sheet', (i) => { showTab('matchup'); openSwap(i); if (!document.getElementById('swapSheet').classList.contains('show')) throw new Error('swap sheet did not open'); }, idx.s);
await closeSheets();
await audit('cbd bench swap', (j) => { openBenchSwap(j); if (!document.getElementById('swapSheet').classList.contains('show')) throw new Error('bench swap did not open'); }, idx.b);
await closeSheets();
await audit('cbd stats sheet', () => { const c = document.querySelector('#userLineup .st-pts.tap'); c && c.click(); });
await closeSheets();
await audit('cbd schedule sheet', () => openSchedule(MY_TEAM));
await closeSheets();
await audit('cbd drop sheet', () => confirmDrop(pKeyOf(rosterFor(MY_TEAM)[3])));
await closeSheets();
for (const rail of ['leaders', 'trending', 'available', 'trades']) await audit('cbd rail ' + rail, (r) => { if (!document.body.classList.contains('open')) toggleDrawer(); selectRail(r); }, rail);
await p.evaluate(() => { if (document.body.classList.contains('open')) toggleDrawer(); });
await audit('cbd trade builder', () => { const ks = Object.keys(T).filter((k) => k !== MY_TEAM); buildTrade(MY_TEAM, ks[0], {}); });
await audit('cbd chat with trades', () => {
  const ks = Object.keys(T).filter((k) => k !== MY_TEAM), a = rosterFor(MY_TEAM)[2], x = rosterFor(ks[1])[2];
  postTrade({ from: MY_TEAM, to: ks[1], status: 'proposed', note: '', give: [{ kind: 'player', player: { id: a.id, n: a.n } }], get: [{ kind: 'player', player: { id: x.id, n: x.n } }] });
  openChat();
});
await audit('cbd transactions', () => openLog());
await audit('cbd notifications', () => openNotifs());
for (const t of ['general', 'roster', 'schedule', 'matchups', 'history', 'drafts', 'playoffs', 'commish']) await audit('cbd settings ' + t, (k) => { openSettings(); setSetTab(k); }, t);
await audit('cbd commish rosters', () => { openSettings(); setSetTab('commish'); cmOpenRosters(); cmPickTeam(MY_TEAM); cmPickAction('switchPlayers'); });
await audit('cbd hub', () => goHome());

// ---------------------------------------------------------------- a created league, mid-draft
await audit('created league draft', () => {
  const id = 'lgwork', teams = [];
  for (let i = 0; i < 10; i++) teams.push(newTeam(i, i ? null : 'You'));
  myLeagues().push({ id, name: 'Work Fantasy League', created: Date.now(), invite: 'x', joined: 10, teams, league: Object.assign({}, LEAGUE_DEFAULTS, { teams: 10, commish: 't0' }), scoring: Object.assign({}, SCORING_DEFAULTS), slots: Object.assign({}, SLOT_DEFAULTS) });
  store.leagueOrder.push(id); saveStore(); startCreatedDraft(id);
  for (let i = 0; i < 16; i++) { const pl = autoPick(onClockTeam()); commitPick(pl.id, { auto: true, ts: Date.now() }); }
  renderDraft();
});
await audit('created pick detail', () => openPickDetail(2));
await closeSheets();
await audit('created slot menu', () => openSlotMenu(3));
await closeSheets();
await audit('created reactions', () => openReactionSheet(1));
await closeSheets();
await audit('created draft done', () => { openLeague('lgwork'); autoDraftAll(); showTab('matchup'); });
await audit('created draft history', () => { openSettings(); setSetTab('drafts'); });
await audit('created standings', () => showTab('standings'));
await audit('created hub', () => goHome());

// ---------------------------------------------------------------- the imported Sleeper league
await p.evaluate(() => goHome());
await p.locator('.hb-new', { hasText: 'Import from Sleeper' }).click();
await p.fill('#slId', '1312045587541020672');
await p.locator('#slFindBtn').click();
await p.waitForSelector('.sl-team');
await p.locator('.sl-team', { hasText: 'Jumpin' }).click();
await p.waitForFunction(() => lvState().at > 0, null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(2500);
await audit('sleeper matchup', () => { pickWeek(4); showTab('matchup'); renderUserMatchup(); });
await audit('sleeper all matchups', () => showLeagueView());
await audit('sleeper past matchup', () => { pickWeek(3); openDetail(0); });
await audit('sleeper standings', () => showTab('standings'));
await audit('sleeper team', () => showTab('team'));
await audit('sleeper hub', () => goHome());

// ---------------------------------------------------------------- the links themselves
await p.evaluate(() => { goHome(); openLeague('cbd'); pickWeek(4); showTab('matchup'); renderUserMatchup(); });
await p.waitForTimeout(400);
const view = () => p.evaluate(() => currentViewName());
const shown = (id) => p.evaluate((id) => document.getElementById(id).classList.contains('show'), id);
// a record opens that team's schedule; its wins and losses match the record
const recTxt = await p.locator('#userHero .sh-rec .rlk').first().innerText();
await p.locator('#userHero .sh-rec .rlk').first().click();
await p.waitForTimeout(350);
const sch = await p.evaluate(() => ({ rows: document.querySelectorAll('#schedBody .sch-row').length, w: document.querySelectorAll('#schedBody .sch-res.w').length, l: document.querySelectorAll('#schedBody .sch-res.l').length, t: document.querySelectorAll('#schedBody .sch-res.t').length, live: document.querySelectorAll('#schedBody .sch-res.live').length }));
const [rw, rl, rt] = recTxt.split('-').map(Number);
ok(`record ${recTxt} opens the schedule: ${sch.rows} weeks, ${sch.w} W ${sch.l} L, ${sch.live} live`, (await shown('schedSheet')) && sch.rows === 14 && sch.w === rw && sch.l === rl && sch.t === (rt || 0));
await p.screenshot({ path: `${OUT}/link-schedule.png` });
// a week in the schedule opens that week's matchup
await p.locator('#schedBody .sch-row').nth(2).click();
await p.waitForTimeout(400);
ok('a week in the schedule opens that matchup', !(await shown('schedSheet')) && (await p.evaluate(() => lvState().viewWeek)) === 3 && ['matchup', 'detail'].includes(await view()), await view());
// a name in a selection row opens the card; the rest of the row still selects, and Back returns as it was
await p.evaluate(() => { pickWeek(4); const ks = Object.keys(T).filter((k) => k !== MY_TEAM); buildTrade(MY_TEAM, ks[0], {}); });
await p.waitForTimeout(300);
const row = p.locator('#tradeBody .tb-col').first().locator('.tb-row').first();
await row.locator('.tb-v').click();
await p.waitForTimeout(200);
const sel = await p.evaluate(() => document.querySelectorAll('#tradeBody .tb-row.on').length);
const nm = await row.locator('.plk').innerText();
await row.locator('.plk').click();
await p.waitForTimeout(300);
const card = await p.evaluate(() => ({ v: currentViewName() }));
ok(`trade builder: the row still selects (${sel}), the name opens ${nm}'s card`, sel === 1 && card.v === 'player');
await p.evaluate(() => headerBack());
await p.waitForTimeout(300);
ok('Back returns to the trade, selection intact', (await view()) === 'trade' && (await p.evaluate(() => document.querySelectorAll('#tradeBody .tb-row.on').length)) === 1);
// a sheet steps aside for the card and comes back with Back
idx = await openIdx();
await p.evaluate((i) => { showTab('matchup'); renderUserMatchup(); openSwap(i); }, idx.s);
await p.waitForTimeout(300);
await p.locator('#swapSheet .plk').first().click();
await p.waitForTimeout(300);
const mid = { v: await view(), sheet: await shown('swapSheet') };
await p.evaluate(() => headerBack());
await p.waitForTimeout(300);
ok('swap sheet: name opens the card, Back brings the sheet back', mid.v === 'player' && !mid.sheet && (await view()) === 'matchup' && (await shown('swapSheet')));
await closeSheets();
// draft board: a tap on a name opens the card, a hold still reacts
await p.evaluate(() => {
  goHome();
  const id = 'lgw2', teams = [];
  for (let i = 0; i < 10; i++) teams.push(newTeam(i, i ? null : 'You'));
  myLeagues().push({ id, name: 'Draft Night', created: Date.now(), invite: 'x', joined: 10, teams, league: Object.assign({}, LEAGUE_DEFAULTS, { teams: 10, commish: 't0' }), scoring: Object.assign({}, SCORING_DEFAULTS), slots: Object.assign({}, SLOT_DEFAULTS) });
  store.leagueOrder.push(id); saveStore(); startCreatedDraft(id);
  for (let i = 0; i < 8; i++) { const pl = autoPick(onClockTeam()); commitPick(pl.id, { auto: true, ts: Date.now() }); }
  showTab('draft');
});
await p.waitForTimeout(400);
await p.locator('.dg-cell[data-pick] .plk').first().click();
await p.waitForTimeout(300);
const fromBoard = await view();
await p.evaluate(() => headerBack());
await p.waitForTimeout(300);
ok('draft board: a tap on a name opens the card, Back returns to the board', fromBoard === 'player' && (await view()) === 'draft', fromBoard);
// the latest pick is the one still open for reactions
await p.locator('.dg-cell[data-pick="7"] .plk').scrollIntoViewIfNeeded();
const cellBox = await p.locator('.dg-cell[data-pick="7"] .plk').boundingBox();
await p.mouse.move(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2);
await p.mouse.down();
await p.waitForTimeout(650);
await p.mouse.up();
await p.waitForTimeout(350);
const held = await p.evaluate(() => ({ v: currentViewName(), sheets: document.querySelectorAll('.sheet.show').length }));
ok('draft board: holding a pick still opens reactions, not the card', held.v === 'draft' && held.sheets === 1, JSON.stringify(held));
await closeSheets();
const total = report.reduce((n, r) => n + r.m.length, 0);
ok(`${report.length} screens: every visible player name and team record is a link`, total === 0, total ? `${total} misses` : '');
console.log('errors:', errs.length ? errs : 'none');
await b.close();
