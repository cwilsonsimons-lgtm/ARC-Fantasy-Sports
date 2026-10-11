// Matchup rows show a stat line once a game kicks off; tapping points opens
// the stats sheet. Real Sleeper league + real week 3/4 stats (fixtures).
import { chromium } from 'playwright';
import fs from 'fs';
const R = new URL('./fixtures/', import.meta.url).pathname;
const OUT = process.argv[2] || '.';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
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
await p.locator('.hb-new', { hasText: 'Import from Sleeper' }).click();
await p.fill('#slId', '1312045587541020672');
await p.locator('#slFindBtn').click();
await p.waitForSelector('.sl-team');
await p.locator('.sl-team', { hasText: 'Jumpin' }).click();
await p.waitForFunction(`lvState().at > 0`, null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(2500);

// raw Sleeper stat lines by "first last|pos"
const raw = {};
for (const w of [3, 4]) {
  raw[w] = {};
  JSON.parse(fs.readFileSync(R + `live/stats_${w}.json`)).forEach(r => { raw[w][(r.player.first_name + ' ' + r.player.last_name).toLowerCase()] = r.stats; });
}
const expect = (st, pos) => {
  const n = k => +st[k] || 0, td = k => n(k) ? ` ${n(k)} TD` : '';
  const g = {
    pass: n('pass_att') || n('pass_yd') || n('pass_td') ? `${n('pass_cmp')}/${n('pass_att')} ${n('pass_yd')} yd${td('pass_td')}${n('pass_int') ? ` ${n('pass_int')} INT` : ''}` : '',
    rush: n('rush_att') || n('rush_yd') || n('rush_td') ? `${n('rush_att')} car ${n('rush_yd')} yd${td('rush_td')}` : '',
    rec: n('rec') || n('rec_yd') || n('rec_td') ? `${n('rec')} rec ${n('rec_yd')} yd${td('rec_td')}` : n('rec_tgt') ? `0 rec (${n('rec_tgt')} tgt)` : ''
  };
  const order = pos === 'QB' ? ['pass', 'rush', 'rec'] : pos === 'RB' ? ['rush', 'rec', 'pass'] : ['rec', 'rush', 'pass'];
  const out = order.map(k => g[k]).filter(Boolean);
  const two = n('pass_2pt') + n('rush_2pt') + n('rec_2pt'), ret = n('fum_rec_td') + n('st_td');
  if (two) out.push(`${two} 2PT`);
  if (ret) out.push(`${ret} return TD`);
  if (n('fum_lost')) out.push(`${n('fum_lost')} FUM`);
  return out.join(' · ');
};

async function rows(root = '#userLineup') {
  return p.evaluate((root) => [...document.querySelectorAll(root + ' .st-row')].flatMap(r => {
    const sides = r.querySelectorAll('.st-side'), pts = r.querySelectorAll('.st-pts');
    return [0, 1].map(i => {
      const nm = sides[i] && sides[i].querySelector('.n .pk');
      if (!nm) return null;
      const g2 = sides[i].querySelector('.g2');
      return { n: nm.textContent, meta: sides[i].querySelector('.m').textContent, g2: g2 ? g2.textContent.replace(/\u00a0/g, ' ') : '', sl: !!(g2 && g2.classList.contains('sl')), live: !!(g2 && g2.querySelector('.pulse')), pts: pts[i] ? pts[i].firstChild.nodeValue : '', tap: !!(pts[i] && pts[i].classList.contains('tap')) };
    }).filter(Boolean);
  }), root);
}

// ---- live week 4 ----
await p.evaluate(() => { pickWeek(4); showView('matchup'); renderUserMatchup(); });
await p.waitForTimeout(400);
let R4 = await rows();
const st4 = await p.evaluate((names) => names.map(n => { const pl = Object.values(STAT_REF).find(x => x.n === n); return pl ? { n, pos: pl.pos, tm: pl.tm, played: lvPlayed(pl, 4), state: ((LIVE.games[4] || {})[pl.tm] || {}).state } : { n }; }), R4.map(r => r.n));
R4.forEach((r, i) => Object.assign(r, st4[i]));
R4.forEach(r => console.log('   wk4', (r.n || '').padEnd(20), (r.pos || '').padEnd(3), (r.state || '-').padEnd(5), r.sl ? 'STATS' : 'sched', r.live ? 'live' : '    ', r.pts.padStart(5), '|', r.g2));
const starters4 = R4.slice(0, 18);
ok('started players show a stat line, not the opponent', starters4.filter(r => r.state === 'in' || r.state === 'post').every(r => r.sl && !/ vs | @ /.test(r.g2)));
ok('players yet to kick off still show the opponent and time', starters4.filter(r => r.state === 'pre').every(r => !r.sl && /(vs|@) [A-Z]+/.test(r.g2)) && starters4.some(r => r.state === 'pre'));
ok('players in a live game carry the live dot', starters4.filter(r => r.state === 'in').every(r => r.live) && starters4.filter(r => r.state === 'post').every(r => !r.live));
let wrong = [];
R4.filter(r => r.sl && ['QB', 'RB', 'WR', 'TE'].includes(r.pos)).forEach(r => {
  const st = raw[4][r.n.toLowerCase()];
  const want = st ? expect(st, r.pos) || 'No stats yet' : null;
  if (want && want !== r.g2 && !(want === 'No stats yet' && /No stats/.test(r.g2))) wrong.push(r.n + ': ' + r.g2 + ' vs ' + want);
});
ok(`stat lines equal Sleeper's numbers (${R4.filter(r => r.sl).length} rows)`, !wrong.length, wrong.join('; '));
ok('every points cell is tappable', R4.every(r => r.tap));
await p.screenshot({ path: OUT + '/T1-week4-rows.png' });

// tap a started player's points
const target = starters4.find(r => r.state === 'in' && +r.pts > 5) || starters4.find(r => r.sl);
const idx = R4.indexOf(target);
const rowEl = p.locator('#userLineup .st-row').nth(Math.floor(idx / 2));
await rowEl.locator('.st-pts').nth(idx % 2).click();
await p.waitForTimeout(450);
const sh = await p.evaluate(() => {
  const s = document.getElementById('statSheet');
  const num = t => parseFloat(String(t).replace(/[^\d.-]/g, ''));
  return {
    show: s.classList.contains('show'), title: document.getElementById('statTitle').textContent,
    name: s.querySelector('.ss-n').textContent, when: (s.querySelector('.ss-g') || {}).textContent || '', tot: num(s.querySelector('.ss-tot b').textContent),
    rows: [...s.querySelectorAll('.ss-row:not(.tot)')].map(r => [r.querySelector('.l').textContent, r.querySelector('.c').textContent, num(r.querySelector('.v').textContent)]),
    total: num(s.querySelector('.ss-row.tot .v').textContent),
    box: [...s.querySelectorAll('.ss-box')].map(b => b.querySelector('.ss-bl').textContent + ': ' + [...b.querySelectorAll('.ss-cell')].map(c => c.querySelector('span').textContent + ' ' + c.querySelector('b').textContent).join(', ')),
    tds: [...s.querySelectorAll('.ss-td')].map(t => t.textContent)
  };
});
console.log(JSON.stringify(sh, null, 1));
ok('sheet opens for ' + target.n, sh.show && sh.name === target.n && /Week 4 stats/.test(sh.title));
ok('sheet total equals the row', Math.abs(sh.tot - +target.pts) < 0.051 && sh.total === sh.tot, sh.tot + ' vs ' + target.pts);
ok('itemized points add up to the total', Math.abs(sh.rows.reduce((n, r) => n + r[2], 0) - sh.total) < 0.03);
ok('game status and score shown', /^(Q\d|OT|Halftime|End|Final)/.test(sh.when) && / @ /.test(sh.when), sh.when);
const rs = raw[4][target.n.toLowerCase()] || {};
const boxTxt = sh.box.join(' | ');
const boxWant = [];
if (rs.rec || rs.rec_tgt) boxWant.push(`REC ${rs.rec || 0}`, `TGT ${rs.rec_tgt || 0}`, `YDS ${rs.rec_yd || 0}`);
if (rs.rush_att) boxWant.push(`CAR ${rs.rush_att}`);
if (rs.pass_att) boxWant.push(`C/ATT ${rs.pass_cmp || 0}/${rs.pass_att}`);
ok('box score uses the real numbers', boxWant.every(x => boxTxt.includes(x)), boxTxt);
await p.screenshot({ path: OUT + '/T2-sheet-live.png' });
await p.locator('#statScrim').click({ position: { x: 20, y: 40 } });
await p.waitForTimeout(400);
ok('tapping outside closes the sheet', !(await p.evaluate(() => document.getElementById('statSheet').classList.contains('show'))));

// a player who has not kicked off: projection sheet
const pre = starters4.find(r => r.state === 'pre');
const pi = R4.indexOf(pre);
await p.locator('#userLineup .st-row').nth(Math.floor(pi / 2)).locator('.st-pts').nth(pi % 2).click();
await p.waitForTimeout(450);
const shp = await p.evaluate(() => { const s = document.getElementById('statSheet'); return { title: document.getElementById('statTitle').textContent, when: (s.querySelector('.ss-g') || {}).textContent, rows: s.querySelectorAll('.ss-row:not(.tot)').length, tot: s.querySelector('.ss-tot b').textContent, sub: s.querySelector('.ss-tot span').textContent }; });
console.log(JSON.stringify(shp));
ok('before kickoff the sheet shows the projection and the matchup', /projection/i.test(shp.title) && /(vs|@) [A-Z]+/.test(shp.when) && shp.rows > 0, pre.n);
await p.screenshot({ path: OUT + '/T3-sheet-proj.png' });
await p.evaluate(() => closeStatSheet());

// ---- past week 3: every starter with a game is "played" ----
// a finished week opens as the full matchup (detail view)
await p.evaluate(() => { pickWeek(3); });
await p.waitForFunction(() => LIVE.plays[3] && Object.keys(LIVE.plays[3]).length > 4, null, { timeout: 15000 }).catch(() => {});
await p.waitForTimeout(800);
await p.evaluate(() => openDetail(0));
await p.waitForTimeout(500);
const R3 = await rows('#detailStarters');
const st3 = await p.evaluate((names) => names.map(n => { const pl = Object.values(STAT_REF).find(x => x.n === n); return pl ? { pos: pl.pos, bye: !weekGame(pl.tm, 3) } : {}; }), R3.map(r => r.n));
R3.forEach((r, i) => Object.assign(r, st3[i]));
R3.slice(0, 18).forEach(r => console.log('   wk3', r.n.padEnd(20), (r.pos || '').padEnd(3), r.pts.padStart(5), '|', r.g2));
ok(`week 3: every player with a game shows his stat line (${R3.length} players)`, R3.length > 20 && R3.filter(r => !r.bye).every(r => r.sl && !r.live));
wrong = [];
R3.filter(r => r.sl && ['QB', 'RB', 'WR', 'TE'].includes(r.pos)).forEach(r => {
  const st = raw[3][r.n.toLowerCase()];
  const want = st ? expect(st, r.pos) || 'No stats' : null;
  if (want && want !== r.g2) wrong.push(r.n + ': ' + r.g2 + ' vs ' + want);
});
ok(`week 3 stat lines equal Sleeper's (${R3.filter(r => r.sl).length} rows)`, !wrong.length, wrong.join('; '));
await p.screenshot({ path: OUT + '/T4-week3-rows.png' });
// a starter with a touchdown: the sheet lists it with its quarter and clock
const tdRow = R3.slice(0, 18).find(r => / TD/.test(r.g2));
if (tdRow) {
  const i3 = R3.indexOf(tdRow);
  await p.locator('#detailStarters .st-row').nth(Math.floor(i3 / 2)).locator('.st-pts').nth(i3 % 2).click();
  await p.waitForTimeout(450);
  const s3 = await p.evaluate(() => { const s = document.getElementById('statSheet'); const num = t => parseFloat(String(t).replace(/[^\d.-]/g, '')); return { tds: [...s.querySelectorAll('.ss-td')].map(t => t.textContent), when: (s.querySelector('.ss-g') || {}).textContent, rows: [...s.querySelectorAll('.ss-row:not(.tot)')].map(r => num(r.querySelector('.v').textContent)), total: num(s.querySelector('.ss-row.tot .v').textContent) }; });
  console.log(tdRow.n, JSON.stringify(s3));
  const nTd = (tdRow.g2.match(/(\d+) TD/g) || []).reduce((n, x) => n + parseInt(x), 0);
  ok(`${tdRow.n}: touchdowns listed with quarter and clock (${nTd} in his line)`, s3.tds.length === nTd && s3.tds.every(t => /^(Q\d \d+:\d\d|OT)/.test(t)), s3.tds.join(' / '));
  ok('final game reads Final with the score', /^Final/.test(s3.when) && / @ /.test(s3.when), s3.when);
  ok('itemized points add up', Math.abs(s3.rows.reduce((n, x) => n + x, 0) - s3.total) < 0.03);
  await p.screenshot({ path: OUT + '/T5-sheet-week3.png' });
  await p.evaluate(() => closeStatSheet());
}
// Other matchups (detail view) get the same rows
await p.evaluate(() => { pickWeek(3); openDetail(2); });
await p.waitForTimeout(500);
const det = await p.evaluate(() => ({ sl: document.querySelectorAll('#detailStarters .g2.sl').length, tap: document.querySelectorAll('#detailStarters .st-pts.tap').length }));
ok('other matchups show stat lines and tappable points', det.sl > 10 && det.tap > 10, JSON.stringify(det));
await p.locator('#detailStarters .st-pts.tap').first().click();
await p.waitForTimeout(400);
ok('sheet opens from another matchup', await p.evaluate(() => document.getElementById('statSheet').classList.contains('show')));
await p.evaluate(() => closeStatSheet());
console.log('errors:', errs.length ? errs : 'none');
await b.close();
