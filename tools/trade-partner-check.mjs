// Trading with any team, from wherever you are, and the trade graphic setting
// every team name in that team's own font and colour.
//
// Builder: Trade (trade block) opens with a row of every other team and no
// partner until one is tapped; tapping another team switches the partner (and
// drops what was picked from the last one); a team page has a Trade button, a
// player on another team has "Trade for", another team's player on the block
// has "Make an offer"; back returns to where the trade was started.
// Graphic: the team headings over each side, the wordmarks, and a pick's
// "via <team>" are drawn in that team's font and colour.
import { chromium } from 'playwright';
const OUT = process.argv[2] || '.';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
await p.route('**', r => new URL(r.request().url()).protocol === 'file:' ? r.continue() : r.abort());
// Wednesday of week 4: before any kickoff, so nobody is locked
await p.clock.setFixedTime(new Date('2026-09-30T16:00:00Z'));
await p.goto('file://' + new URL('../1stPrototype.html', import.meta.url).pathname, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(800);
const ok = (l, c, x) => console.log((c ? '  ok   ' : '  FAIL ') + l + (x ? '  ' + x : ''));
const builder = () => p.evaluate(() => ({
  view: currentViewName(),
  chips: document.querySelectorAll('#tradeBody .tb-team').length,
  on: (document.querySelector('#tradeBody .tb-team.on') || { dataset: {} }).dataset.team || null,
  cols: document.querySelectorAll('#tradeBody .tb-col').length,
  heads: [...document.querySelectorAll('#tradeBody .tb-ch')].map((e) => e.textContent),
  get: [...document.querySelectorAll('#tradeBody .tb-col:nth-child(2) .tb-row.on .as-nm')].map((e) => e.textContent),
  give: [...document.querySelectorAll('#tradeBody .tb-col:nth-child(1) .tb-row.on .as-nm')].map((e) => e.textContent),
  send: !document.querySelector('#tradeBody .tb-send.dis'),
  prompt: !!document.querySelector('#tradeBody .tb-pick')
}));

await p.evaluate(() => { openLeague('cbd'); autoDraftAll(); showTab('matchup'); });
await p.waitForTimeout(400);
const L = await p.evaluate(() => {
  const keys = Object.keys(T), others = keys.filter((k) => k !== MY_TEAM);
  // three other teams, each with its own font and colour
  const [a, b2, c] = others;
  Object.assign(T[a], { font: 'marker', c: '#FF7A1A' });
  Object.assign(T[b2], { font: 'slab', c: '#3FC4FF' });
  Object.assign(T[c], { font: 'bungee', c: '#F5D90A' });
  applyTeamFonts();
  return { me: MY_TEAM, a, b: b2, c, names: Object.fromEntries(keys.map((k) => [k, T[k].n])), n: keys.length };
});

// 1. Trade from the trade block: the teams first, no partner picked for you
await p.evaluate(() => { toggleDrawer(); renderPanel('trades'); });
await p.waitForTimeout(300);
await p.locator('#panel .tbk-go').click();
await p.waitForTimeout(300);
let s = await builder();
ok(`Trade opens on a row of every other team (${s.chips}), none chosen yet`, s.view === 'trade' && s.chips === L.n - 1 && !s.on && s.cols === 0 && s.prompt && !s.send);
await p.screenshot({ path: OUT + '/trade-pick-team.png' });
await p.locator(`#tradeBody .tb-team[data-team="${L.a}"]`).click();
await p.waitForTimeout(250);
s = await builder();
ok('tapping a team shows their players and picks beside yours', s.on === L.a && s.cols === 2 && s.heads[1] === L.names[L.a] && s.heads[0] === L.names[L.me] && s.send, s.heads.join(' | '));
const fonts = await p.evaluate((a) => ({
  head: getComputedStyle(document.querySelectorAll('#tradeBody .tb-ch')[1]).fontFamily,
  title: [...document.querySelectorAll('#tradeBody .tb-title b')].map((e) => [e.textContent, getComputedStyle(e).fontFamily, getComputedStyle(e).color]),
  chip: getComputedStyle(document.querySelector(`#tradeBody .tb-team[data-team="${a}"] .tb-tn`)).fontFamily
}), L.a);
ok('their name is in their font, in the column, the title and the team row', /Permanent Marker/.test(fonts.head) && /Permanent Marker/.test(fonts.title[1][1]) && /Permanent Marker/.test(fonts.chip) && fonts.title[1][2] === 'rgb(255, 122, 26)', fonts.title.map((x) => x.join(' / ')).join(' ; '));
await p.screenshot({ path: OUT + '/trade-with.png' });
// pick something of theirs and something of mine, then switch partners
await p.locator('#tradeBody .tb-col').nth(1).locator('.tb-row[data-aid^="pl:"] .tb-v').first().click();
await p.locator('#tradeBody .tb-col').nth(0).locator('.tb-row[data-aid^="pl:"] .tb-v').first().click();
await p.waitForTimeout(150);
const before = await builder();
await p.locator(`#tradeBody .tb-team[data-team="${L.b}"]`).click();
await p.waitForTimeout(250);
s = await builder();
ok('switching to another team keeps what you give and drops what the last team was giving', before.get.length === 1 && s.on === L.b && s.heads[1] === L.names[L.b] && s.get.length === 0 && s.give.join() === before.give.join(), `kept ${s.give.join()}`);
await p.locator('#tradeBody .tb-back').click();
await p.waitForTimeout(250);
ok('back returns to the screen the trade was started from', await p.evaluate(() => currentViewName()) === 'matchup');

// 2. A team page has a Trade button
await p.evaluate((c) => openTeam(c), L.c);
await p.waitForTimeout(300);
ok('another team\'s page has a Trade button; your own does not', await p.locator('.tv-trade').count() === 1 && await p.evaluate((me) => { openTeam(me); return document.querySelectorAll('.tv-trade').length; }, L.me) === 0);
await p.evaluate((c) => openTeam(c), L.c);
await p.waitForTimeout(250);
await p.screenshot({ path: OUT + '/trade-team-page.png' });
await p.locator('.tv-trade').click();
await p.waitForTimeout(250);
s = await builder();
ok('it opens the builder with that team', s.on === L.c && s.cols === 2 && s.heads[1] === L.names[L.c]);
await p.locator('#tradeBody .tb-back').click();
await p.waitForTimeout(250);
ok('back returns to that team\'s page', await p.evaluate((n) => currentViewName() === 'team' && !!document.querySelector('.tv-name') && document.querySelector('.tv-name').textContent === n, L.names[L.c]));

// 3. A player on another team: Trade for him
const target = await p.evaluate((a) => { const pl = rosterFor(a)[0]; return { key: pKeyOf(pl), n: pl.n }; }, L.a);
await p.evaluate((k) => openPlayer(k), target.key);
await p.waitForTimeout(300);
ok('another team\'s player has "Trade for"', await p.locator('.pc-act.trd').count() === 1);
await p.locator('.pc-act.trd').click();
await p.waitForTimeout(250);
s = await builder();
ok('it opens the builder with his team, and him already in it', s.on === L.a && s.get.length === 1 && s.get[0] === target.n, s.get.join());
await p.locator('#tradeBody .tb-back').click();
await p.waitForTimeout(250);
ok('back returns to his card', await p.evaluate(() => currentViewName()) === 'player');
const mine = await p.evaluate((me) => { const pl = rosterFor(me)[0]; openPlayer(pKeyOf(pl)); return document.querySelectorAll('.pc-act.trd').length; }, L.me);
const fa = await p.evaluate(() => { const q = freeAgents('ALL')[0]; if (!q) return 0; openPlayer(pKeyOf(q)); return document.querySelectorAll('.pc-act.trd').length; });
ok('your own players and free agents have no "Trade for"', mine === 0 && fa === 0);

// 4. Another team's player on the trade block: Make an offer
const blk = await p.evaluate((b2) => { const pl = rosterFor(b2)[1]; const k = pKeyOf(pl); tradeBlockBag()[k] = { wants: ['RB depth'], listedAt: Date.now() }; showTab('matchup'); toggleDrawer(); renderPanel('trades'); selectBlockPlayer(k); return { key: k, n: pl.n }; }, L.b);
await p.waitForTimeout(300);
ok('their player on the block has "Make an offer"', await p.locator('#panel .tbk-offer').count() === 1);
await p.locator('#panel .tbk-offer').click();
await p.waitForTimeout(250);
s = await builder();
ok('it opens the builder with his team and him in it', s.on === L.b && s.get.length === 1 && s.get[0] === blk.n);
// a counter-offer stays with the team that offered
await p.evaluate((a) => buildTrade(MY_TEAM, a, { counterOf: 'x' }), L.a);
ok('a counter-offer has no team row (it stays with the team that offered)', await p.locator('#tradeBody .tb-with').count() === 0);
await p.evaluate(() => cancelTrade());

// 5. A graphic is only for an accepted trade: not an offer, not a counter
const art = await p.evaluate(({ a, b2, c }) => {
  const pa = rosterFor(a)[0], pb = rosterFor(b2)[0];
  const asPl = (q) => ({ kind: 'player', player: { id: q.id, n: q.n, full: q.full, pos: q.pos, tm: q.tm } });
  // b2 sends a pick that was c's, so the graphic says "via <c>"
  const m = postTrade({ from: a, to: b2, status: 'proposed', note: '', give: [asPl(pa)], get: [asPl(pb), { kind: 'pick', pick: { year: 2027, round: 2, originalTeam: c } }] });
  return m.id;
}, { a: L.a, b2: L.b, c: L.c });
const card = (st) => p.evaluate(({ id, st }) => {
  const m = findMsg(id);
  if (st) m.trade.status = st;
  openChat();
  const el = [...document.querySelectorAll('#chatBody .tc')].pop();
  return { st: m.trade.status, art: el ? el.querySelectorAll('.tc-art').length : -1 };
}, { id: art, st });
const offer = await card(), counter = await card('countered');
ok('an offer and a counter-offer have no "Create graphic"', offer.art === 0 && counter.art === 0, JSON.stringify([offer, counter]));
await p.evaluate((id) => openTradeArt(id), art);
await p.waitForTimeout(300);
ok('and a graphic cannot be opened for one any other way', await p.evaluate(() => currentViewName()) !== 'tradeart');
const agreed = await card('review'), done = await card('accepted');
ok('once accepted (under review, or processed) the card offers it', agreed.art === 1 && done.art === 1);
await p.locator('#chatBody .tc').last().locator('.tc-art').click();
await p.waitForTimeout(1500);
ok('and it opens', await p.evaluate(() => currentViewName()) === 'tradeart');

// 6. The graphic: every team name in that team's font and colour
const t = await p.evaluate(() => tradeArtLayout().texts);
const heads = t.filter((x) => x.role === 'team'), marks = t.filter((x) => x.role === 'wordmark'), refs = t.filter((x) => x.role === 'team-ref');
const fam = { [L.a]: 'Permanent Marker', [L.b]: 'Alfa Slab One', [L.c]: 'Bungee' };
const col = { [L.a]: '#ff7a1a', [L.b]: '#3fc4ff', [L.c]: '#f5d90a' };
const sideKey = (i) => t.find((x) => x.side === i && x.role === 'team') ? (i === 0 ? L.a : L.b) : null;
ok('each side\'s heading is in that team\'s font and colour', heads.length === 2 && heads.every((h, i) => h.font.includes(fam[sideKey(i)]) && h.color.toLowerCase() === col[sideKey(i)]), heads.map((h) => `${h.text}: ${h.font} ${h.color}`).join(' | '));
ok('so are the wordmarks under the crests', marks.length >= 2 && marks.every((m) => m.font.includes(fam[sideKey(m.side)]) && m.color.toLowerCase() === col[sideKey(m.side)]));
ok('a pick\'s "via <team>" names that team in its font and colour', refs.length === 1 && refs[0].team === L.c && refs[0].font.includes('Bungee') && refs[0].color.toLowerCase() === col[L.c] && t.some((x) => x.role === 'meta' && /^via /.test(x.text)), refs.map((r) => `${r.text}: ${r.font} ${r.color}`).join());
const ed = await p.evaluate(() => ({
  sides: [...document.querySelectorAll('.ta-sn')].map((e) => [e.textContent, getComputedStyle(e).fontFamily]),
  title: [...document.querySelectorAll('.ta-title span b')].map((e) => [e.textContent, getComputedStyle(e).fontFamily])
}));
ok('the editor\'s team labels and title use their fonts too', ed.sides.length === 2 && ed.title.length === 2 && ed.sides.concat(ed.title).every(([n, f]) => /Permanent Marker|Alfa Slab One/.test(f)), ed.title.map((x) => x.join(': ')).join(' | '));
await p.screenshot({ path: OUT + '/trade-graphic-fonts.png', fullPage: false });
const png = await p.evaluate(() => { const c = document.querySelector('#taBody canvas'); return c ? c.toDataURL('image/png') : null; });
if (png) (await import('fs')).writeFileSync(OUT + '/trade-graphic.png', Buffer.from(png.split(',')[1], 'base64'));
console.log('errors:', errs.length ? errs : 'none');
await b.close();
