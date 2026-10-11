import { chromium } from 'playwright';
import fs from 'fs';
const R = new URL('./fixtures/', import.meta.url).pathname;
const OUT = process.argv[2] || '.';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
const errs = [], hits = {};
p.on('pageerror', e => errs.push(String(e)));
const json = (r, f) => r.fulfill({ status: 200, contentType: 'application/json', body: f && fs.existsSync(f) ? fs.readFileSync(f) : '[]', headers: { 'access-control-allow-origin': '*' } });
await p.route('**', r => {
  const u = new URL(r.request().url());
  if (u.protocol === 'file:') return r.continue();
  if (u.hostname === 'api.sleeper.app') {
    hits[u.pathname] = (hits[u.pathname] || 0) + 1;
    const m = u.pathname.match(/^\/v1\/league\/(\d+)(?:\/(\w+)(?:\/(\d+))?)?$/);
    if (!m || m[1] !== '1312045587541020672') return r.fulfill({ status: 404, body: 'null' });
    const f = !m[2] ? 'league.json' : m[2] === 'matchups' ? `matchups_${m[3]}.json` : m[2] + '.json';
    return json(r, R + 'league/' + f);
  }
  if (u.hostname === 'api.sleeper.com') { const m = u.pathname.match(/\/(stats|projections)\/nfl\/2026\/(\d+)/); return json(r, m && R + 'live/' + (m[1] === 'stats' ? 'stats_' : 'proj_') + m[2] + '.json'); }
  if (u.hostname === 'site.api.espn.com') return json(r, R + 'live/' + (u.pathname.endsWith('/scoreboard') ? 'board_' + u.searchParams.get('week') : 'summary_' + u.searchParams.get('event')) + '.json');
  return r.abort();
});
// the fixtures were captured on Sunday of week 4, mid-afternoon
await p.clock.setFixedTime(new Date('2026-10-04T19:22:00Z'));
await p.goto('file://' + new URL('../1stPrototype.html', import.meta.url).pathname, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(800);
const ok = (l, c, x) => console.log((c ? '  ok   ' : '  FAIL ') + l + (x ? '  ' + x : ''));
await p.locator('.hb-new', { hasText: 'Import from Sleeper' }).click();
await p.fill('#slId', '1312045587541020672');
await p.locator('#slFindBtn').click();
await p.waitForSelector('.sl-team');
await p.screenshot({ path: OUT + '/S1-pick-team.png' });
const list = await p.locator('.sl-team b').allInnerTexts();
ok('10 teams offered', list.length === 10, list.join(' | '));
await p.locator('.sl-team', { hasText: 'Jumpin' }).click();
await p.waitForFunction(`lvState().at > 0 && document.querySelector('.league-id .nm') && /City Boys/.test(document.querySelector('.league-id .nm').textContent)`, null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(2500);
const st = await p.evaluate(`(() => { const s = lvState(); const r = myLeagues().find(l => l.sleeper); return { s, name: r && r.name, teams: r && r.teams.map(t => t.n + ' ' + t.rec), me: r && r.teams[0].n, slots: r && r.slots, weeks: r && Object.keys(r.sleeper.pts || {}) }; })()`);
console.log(JSON.stringify(st));
ok('league imported as City Boys Dynasty', st.name === 'City Boys Dynasty');
ok('my team is Jumpin\' Uncs', /Jumpin/.test(st.me));
ok('records from Sleeper', st.teams.some(t => /\d+-\d+/.test(t) && !/ 0-0$/.test(t)));
ok('roster spots from Sleeper (2 FLEX, 1 SUPERFLEX, 15 bench, 5 taxi, 3 IR)', st.slots.FLEX === 2 && st.slots.SFLX === 1 && st.slots.bench === 15 && st.slots.taxi === 5 && st.slots.ir === 3, JSON.stringify(st.slots));
const raw = w => JSON.parse(fs.readFileSync(R + `league/matchups_${w}.json`));
const games = await p.evaluate(`[1,2,3,4].map(w => getGames(w).map(g => [g.a, g.as, g.x, g.xs]))`);
let allMatch = true;
[1, 2, 3, 4].forEach((w, i) => {
  const pts = {}; raw(w).forEach(m => pts['s' + m.roster_id] = Math.round(m.points * 100) / 100);
  games[i].forEach(g => { if (w < 4 && (Math.abs(g[1] - pts[g[0]]) > 0.01 || Math.abs(g[3] - pts[g[2]]) > 0.01)) { allMatch = false; console.log('   mismatch wk', w, g, pts[g[0]], pts[g[2]]); } });
  console.log('   week', w, JSON.stringify(games[i]));
});
ok('weeks 1-3: every team score is Sleeper\'s', allMatch);
const pair = raw(4), mine = pair.find(m => m.roster_id === 1), opp = pair.find(m => m.matchup_id === mine.matchup_id && m.roster_id !== 1);
const lt = await p.evaluate(`lvState().LT`);
console.log('live matchup', JSON.stringify(lt), 'sleeper', mine.points, opp.points);
ok('week 4 live score equals Sleeper\'s', Math.abs(lt.a - mine.points) < 0.15 && Math.abs(lt.x - opp.points) < 0.15);
const ro = await p.evaluate(`(() => { const r = rosterOf(MY_TEAM_KEY()); return null; })()`).catch(() => null);
const roster = await p.evaluate(`(() => { const k = myLeagues().find(l => l.sleeper).teams[0].key; const r = rosterOf(k); return { starters: r.starters.map(s => s.slot + ':' + (s.player ? s.player.n : '-')), bench: r.bench.filter(Boolean).length, taxi: r.taxi.filter(Boolean).map(x => x.n), ir: r.ir.filter(Boolean).map(x => x.n) }; })()`);
console.log(JSON.stringify(roster));
const rr = JSON.parse(fs.readFileSync(R + 'league/rosters.json')).find(x => x.roster_id === 1);
ok('roster sizes match Sleeper', roster.bench + roster.taxi.length + roster.ir.length + roster.starters.filter(s => !/-$/.test(s)).length === rr.players.length, `${rr.players.length} players`);
const um = await p.evaluate(() => { const r = myLeagues().find(l => l.sleeper); let n = 0; const miss = []; r.teams.forEach(t => { const ro = rosterOf(t.key); [ro.starters.map(x => x.player), ro.bench, ro.taxi, ro.ir].forEach(a => a.forEach(pl => { if (!pl) return; n++; if (String(pl.id).startsWith('sl:')) miss.push(pl.full + ' ' + pl.pos + ' ' + pl.tm); })); }); return { n, miss }; });
ok(`players linked to the app: ${um.n - um.miss.length}/${um.n}`, um.miss.length <= um.n * 0.03, um.miss.join(', '));

// League tab after import shows Sleeper's real pairings for the live week
await p.evaluate(`showTab('league')`).catch(() => {});
await p.waitForTimeout(400);
const tab = await p.evaluate(() => [...document.querySelectorAll('#leagueBody .lg-hero')].map(e => e.innerText.replace(/\s+/g, ' ')));
const names = await p.evaluate(() => { const r = myLeagues().find(l => l.sleeper); const n = {}; r.teams.forEach(t => n[t.key] = t.n); return n; });
const want = {}; raw(4).forEach(m => (want[m.matchup_id] = want[m.matchup_id] || []).push(names['s' + m.roster_id]));
const pairsOk = Object.values(want).every(([a, x]) => tab.some(t => t.includes(a.toUpperCase()) && t.includes(x.toUpperCase()) || t.includes(a) && t.includes(x)));
ok('League tab pairings = Sleeper week 4', pairsOk && tab.length === 5, tab.map(t => t.slice(0, 80)).join(' || '));
const odds = await p.evaluate(() => [3, 4, 5].map(w => getGames(w).map(g => `${g.as}:${g.xs} ${g.aw}%`)));
console.log('   odds wk3', JSON.stringify(odds[0])); console.log('   odds wk4', JSON.stringify(odds[1])); console.log('   odds wk5', JSON.stringify(odds[2]));
ok('finished week: winner 100%, loser 0%', odds[0].every(o => { const [a, x] = o.split(' ')[0].split(':').map(Number); const w = +o.split(' ')[1].replace('%', ''); return a > x ? w === 100 : a < x ? w === 0 : w === 50; }));
ok('live week: odds between 0 and 100, not all 50', odds[1].some(o => !/ 50%$/.test(o)));


// TD markers = real touchdowns (scored or thrown), every player, every matchup
const tdPlays = (w) => JSON.parse(fs.readFileSync(R + `live/board_${w}.json`)).events.flatMap((e) => {
  const f = R + `live/summary_${e.id}.json`;
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f)).scoringPlays.filter((x) => /touchdown/i.test(x.type.text)).map((x) => x.text) : [];
});
for (const w of [3, 4]) {
  await p.evaluate((w) => pickWeek(w), w);
  await p.waitForTimeout(1500);
  const res = await p.evaluate(({ w, plays }) => {
    const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.'’]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/\s+/g, ' ').trim();
    const bad = [], seen = [];
    let markers = 0, expected = 0;
    getGames(w).forEach((g) => {
      const ev = {};
      rewindSeries([g.a, g.x]).forEach((q) => q.ev.forEach((e) => { if (e.kind !== '2pt') ev[e.name] = (ev[e.name] || 0) + 1; }));
      [g.a, g.x].forEach((k) => weekStarters(k, w).forEach((pl) => {
        const full = norm((NFL_BY_ID[pl.id] || {}).full || pl.full || pl.n);
        const mine = plays.filter((t) => { const m = norm(t.replace(/\s*\(.*$/, '')); return m.indexOf(full + ' ') === 0 || new RegExp('pass from ' + full + '$').test(m); }).length;
        const got = ev[pl.n] || 0;
        markers += got; expected += mine;
        if (mine || got) seen.push(`${pl.n} ${got}/${mine}`);
        if (got !== mine) bad.push(`${pl.n}: ${got} markers, ${mine} real`);
      }));
    });
    return { markers, expected, bad, seen };
  }, { w, plays: tdPlays(w) });
  console.log(`   week ${w} TDs`, res.seen.join(', '));
  ok(`week ${w}: TD markers = real touchdowns (${res.markers}/${res.expected})`, res.bad.length === 0 && res.expected > 0, res.bad.join('; '));
}


// past week, imported league: the lineup is the one Sleeper recorded, and it adds up to the final
const wk3 = await p.evaluate(() => {
  pickWeek(3);
  const out = [];
  getGames(3).forEach((g, i) => {
    const html = fullStartersHTML(g.a, g.x, { phased: true });
    const d = document.createElement('div'); d.innerHTML = html;
    const cells = [...d.querySelector('.starters').querySelectorAll('.st-pts')];
    const sum = (side) => Math.round(cells.filter((c, j) => j % 2 === side).reduce((n, c) => n + parseFloat(c.firstChild.nodeValue), 0) * 100) / 100;
    out.push([g.as, sum(0), g.xs, sum(1)]);
  });
  return out;
});
console.log('   week 3 lineups vs finals', JSON.stringify(wk3));
ok('week 3: each team\'s listed starters add up to its final (within display rounding)', wk3.every((r) => Math.abs(r[0] - r[1]) < 0.6 && Math.abs(r[2] - r[3]) < 0.6));
// a touchdown marker's bubble names the play
await p.evaluate(() => { pickWeek(3); showTab('league'); });
await p.waitForTimeout(800);
await p.locator('#leagueBody .lg-spark').nth(3).click();
await p.waitForTimeout(800);
const pin = p.locator('#detailRewind .rw-pin').first();
const bb = await pin.boundingBox();
if (bb) { await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.mouse.down(); await p.mouse.up(); }
await p.waitForTimeout(300);
const bub = await p.evaluate(() => { const b = document.querySelector('#detailRewind .rw-bub'); return b && b.style.display !== 'none' ? b.innerText : null; });
ok('a TD marker shows the real play', !!bub && /Yd|yd/.test(bub), JSON.stringify(bub));
await p.evaluate(() => document.getElementById('detailRewind').scrollIntoView());
await p.screenshot({ path: OUT + '/S6-td-bubble.png' });
// every matchup has its own chart, ending on that game's score
for (const w of [3, 4]) {
  await p.evaluate((w) => { pickWeek(w); showTab('league'); }, w);
  await p.waitForTimeout(500);
  const sparks = await p.locator('#leagueBody .lg-spark').count();
  ok(`week ${w}: all ${sparks} matchups show a win-chance strip`, sparks === 5);
  const ends = await p.evaluate(() => getGames(lvState().viewWeek).map((g) => { const s = rewindSeries([g.a, g.x]); const e = s[s.length - 1]; return { g: [g.as, g.xs], e: e && [e.a, e.x, e.win], n: s.length }; }));
  console.log('   ', JSON.stringify(ends));
  ok(`week ${w}: each chart ends on its game's score`, ends.every((r) => r.e && Math.abs(r.e[0] - r.g[0]) < 0.11 && Math.abs(r.e[1] - r.g[1]) < 0.11));
  if (w === 3) ok('week 3: finished games end at 100/0', ends.every((r) => r.e[2] === (r.g[0] > r.g[1] ? 100 : 0)));
}
await p.locator('#leagueBody .lg-spark').nth(2).click();
await p.waitForTimeout(600);
const det = await p.evaluate(() => { const el = document.getElementById('detailRewind'); return { view: document.querySelector('.view.on').dataset.view, shown: el.style.display !== 'none', svg: !!el.querySelector('.rw-svg'), legend: el.querySelector('.rw-legend') ? el.querySelector('.rw-legend').innerText : '' }; });
ok('tapping a strip opens that matchup with its full chart', det.view === 'detail' && det.shown && det.svg, JSON.stringify(det));

// the other matchup's lineup follows its chart
const scrub = await p.evaluate(() => {
  const cells = [...document.querySelectorAll('#detailStarters .st-pts[data-n]')];
  const total = (side) => cells.filter((c, i) => i % 2 === side).slice(0, 10).reduce((n, c) => n + parseFloat(c.firstChild.nodeValue), 0);
  const head = document.querySelector('#detailStarters .starters .st-hd span:last-child');
  return { cells: cells.length, a: Math.round(total(0) * 10) / 10, x: Math.round(total(1) * 10) / 10, head: head && head.textContent };
});
ok('the matchup\'s lineup follows its chart (starters add up to the chart score)', scrub.cells >= 20 && Math.abs(scrub.a - 70.7) < 0.3 && Math.abs(scrub.x - 72.4) < 0.3, JSON.stringify(scrub));
const same = await p.evaluate(() => { const r = document.querySelector('#detailRewind .rw-read .w').textContent; const h = [...document.querySelectorAll('#detailHero .sh-pct')].map(e => e.textContent); return { chart: r, card: h }; });
ok('chart\'s win % now = the matchup card\'s', same.chart.startsWith(same.card[0]), JSON.stringify(same));
await p.screenshot({ path: OUT + '/S5-detail-chart.png' });
await p.evaluate(() => { showTab('league'); });
await p.waitForTimeout(400);
await p.evaluate(() => document.getElementById('scroll').scrollTop = 0);
await p.screenshot({ path: OUT + '/S4-all-matchups.png' });
await p.evaluate(`showView('matchup'); renderUserMatchup()`); await p.waitForTimeout(500);
await p.screenshot({ path: OUT + '/S2-matchup.png' });
await p.evaluate(`showTab('standings')`).catch(() => {}); await p.waitForTimeout(500);
await p.screenshot({ path: OUT + '/S3-league.png' });
console.log('sleeper requests', JSON.stringify(hits));
console.log('errors:', errs.length ? errs : 'none');
await b.close();
