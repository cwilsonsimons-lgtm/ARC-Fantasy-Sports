// Interaction checks for the WWE Universe section.
//
// Usage: node tools/universe-check.mjs [url]      (defaults to the dist build)
//        npm run check:universe
//
// Drives the section the way the owner would - nav taps, typing, selects,
// confirm boxes, a real file download and upload - and asserts on what landed
// in localStorage rather than on the DOM alone. Every snapshot of the saved
// universe is also run through the model's own validate(), so a screen that
// leaves the data inconsistent fails here even if it looks right.
//
// Layout is checked by geometry as well: focusing a field inside a sheet that
// is still sliding in used to scroll the overflow:hidden .phone, dragging the
// whole app up. DOM assertions never saw it.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate } from '../js/universe/model.js';

const url = process.argv[2] || 'file://' + process.cwd() + '/dist/index.html';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 436, height: 920 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + String(e).split('\n')[0]));
// remote headshots and fonts never resolve in a sandbox; they are not under test
await page.route('**', r => (/^(file|data|blob):/.test(r.request().url()) || /127\.0\.0\.1|localhost/.test(r.request().url())
  ? r.continue() : r.abort()));

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.evaluate(`localStorage.clear()`);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);

let pass = 0, fail = 0;
async function check(label, fn, want) {
  let got;
  try { got = await fn(); } catch (e) { got = 'ERR: ' + String(e.message).split('\n')[0]; }
  const ok = typeof want === 'function' ? !!want(got) : JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(44)} ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
  await page.waitForTimeout(80);
}
const js = code => page.evaluate(code);
const saved = () => js(`JSON.parse(localStorage.getItem('wwe_universe_v1'))`);
const sound = async () => { const u = await saved(); return u ? validate(u) : ['nothing saved']; };
const toast = () => js(`(()=>{const h=document.getElementById('uvHint');return {t:h.textContent,bad:h.classList.contains('bad')}})()`);
const sheet = page.locator('#uvSheetBody');
const settle = () => page.waitForTimeout(380);           // sheet slide / confirm box
const confirmYes = async () => { await page.click('#uvConfirmYes'); await settle(); };
const idOf = async name => (await saved()).wrestlers.find(w => w.name === name).id;

// the app must never be dragged out of place, whatever is open
const anchored = () => js(`(() => {
  const ph = document.querySelector('.phone'), uv = document.getElementById('uv');
  const a = ph.getBoundingClientRect(), b = uv.getBoundingClientRect();
  return { bodyY: document.body.getBoundingClientRect().y | 0, phoneScroll: ph.scrollTop,
    covers: Math.abs(a.top + ph.clientTop - b.top) < 1.5 && Math.abs(a.left + ph.clientLeft - b.left) < 1.5 };
})()`);
const isAnchored = r => r && r.bodyY === 0 && r.phoneScroll === 0 && r.covers;

const fantasyBefore = await js(`[localStorage.getItem('cbd_team_v1'), localStorage.getItem('arc_markets_v1')]`);

// ---------------------------------------------------------------- open
await check('opens from the app nav', async () => {
  await page.click('.nav .nv[data-nav=universe]');
  return js(`document.body.classList.contains('universe')`);
}, true);
await check('app nav has 5 items', () => js(`document.querySelectorAll('.nav .nv').length`), 5);
await check('starts empty, four shows + All + Unassigned', () => js(`[
  document.querySelectorAll('#uvBody .uv-row').length,
  [...document.querySelectorAll('#uvBody .uv-pill')].map(p => p.firstChild.nodeType===3 ? p.textContent.trim() : p.textContent.trim())]`),
  r => r[0] === 0 && r[1].join('|') === 'All0|Raw0|SmackDown0|Dynamite0|NXT0|Unassigned0');
await check('Season 1, Week 1 on the clock', () => js(`document.getElementById('uvClock').textContent`), 'Season 1 · Week 1');
await check('layout anchored', anchored, isAnchored);

// ---------------------------------------------------------------- add wrestlers
await check('Add opens the sheet on screen', async () => {
  await page.click('#uvBody .uv-bar .uv-btn.pri');
  await settle();
  return js(`(()=>{const r=document.getElementById('uvSheet').getBoundingClientRect();return r.y>0&&r.y<innerHeight})()`);
}, true);
await check('focusing the name field does not drag the app', anchored, isAnchored);
await check('typing + Enter adds, field clears for the next', async () => {
  await page.selectOption('#uvSheetBody select >> nth=0', 'raw');
  await page.keyboard.type('Cody Rhodes');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  await page.keyboard.type('Gunther');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  const u = await saved();
  return [u.wrestlers.map(w => `${w.name}@${w.showId}`), await js(`document.activeElement.id + ':' + document.activeElement.value`)];
}, [['Cody Rhodes@raw', 'Gunther@raw'], 'uvAddName:']);
await check('duplicate name is refused with a reason', async () => {
  await page.keyboard.type('gunther');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  return [(await saved()).wrestlers.length, await toast(), await js(`document.getElementById('uvAddName').value`)];
}, r => r[0] === 2 && r[1].bad && /already a wrestler called Gunther/.test(r[1].t) && r[2] === 'gunther');
await check('pasted list: adds, skips dupes, keeps them', async () => {
  await sheet.getByText('Paste a list').click();
  await page.selectOption('#uvSheetBody select >> nth=0', 'dynamite');
  await page.selectOption('#uvSheetBody select >> nth=1', 'AEW');
  await page.fill('#uvAddList', 'Kenny Omega\nWill Ospreay\n\nMercedes Moné\nCody Rhodes\nKenny Omega');
  await sheet.getByText('Add everyone').click();
  await page.waitForTimeout(150);
  const u = await saved();
  return [u.wrestlers.filter(w => w.showId === 'dynamite' && w.origin === 'AEW').map(w => w.name),
    await js(`document.getElementById('uvAddList').value`)];
}, [['Kenny Omega', 'Will Ospreay', 'Mercedes Moné'], 'Cody Rhodes\nKenny Omega']);
await check('more for SmackDown and NXT', async () => {
  await page.selectOption('#uvSheetBody select >> nth=0', 'smackdown');
  await page.selectOption('#uvSheetBody select >> nth=1', 'WWE');
  await page.fill('#uvAddList', 'Jey Uso\nSeth Rollins');
  await sheet.getByText('Add everyone').click();
  await page.selectOption('#uvSheetBody select >> nth=0', 'nxt');
  await page.selectOption('#uvSheetBody select >> nth=1', 'NXT');
  await page.selectOption('#uvSheetBody select >> nth=2', 'female');
  await page.fill('#uvAddList', 'Iyo Sky\nRhea Ripley\nRoxanne Perez\nGiulia');
  await sheet.getByText('Add everyone').click();
  await page.waitForTimeout(150);
  return (await saved()).wrestlers.length;
}, 11);
await check('saved universe is sound', sound, []);

await check('pills show unequal show sizes', async () => {
  await page.click('.uv-scrim', { position: { x: 200, y: 60 } });
  await settle();
  return js(`[...document.querySelectorAll('#uvBody .uv-pill .n')].map(e => +e.textContent)`);
}, [11, 2, 2, 3, 4, 0]);
await check('filtering by show', async () => {
  await page.locator('#uvBody .uv-pill', { hasText: 'Dynamite' }).click();
  return js(`[...document.querySelectorAll('#uvBody .uv-row .nm')].map(e => e.textContent)`);
}, ['Kenny Omega', 'Mercedes Moné', 'Will Ospreay']);
await check('search keeps focus while it filters', async () => {
  await page.locator('#uvBody .uv-pill', { hasText: 'All' }).click();
  await page.click('#uvQ');
  await page.keyboard.type('rh');
  return [await js(`[...document.querySelectorAll('#uvBody .uv-row .nm')].map(e => e.textContent)`),
    await js(`document.activeElement.id`)];
}, [['Cody Rhodes', 'Rhea Ripley'], 'uvQ']);

// ---------------------------------------------------------------- one wrestler
await check('row opens the wrestler sheet', async () => {
  await page.locator('#uvBody .uv-row', { hasText: 'Rhea Ripley' }).click();
  await settle();
  return js(`document.getElementById('uvSheetTitle').textContent`);
}, 'Rhea Ripley');
await check('moving shows is recorded as history', async () => {
  await page.selectOption('#uvSheetBody select >> nth=0', 'raw');
  await page.locator('#uvSheetBody .uv-f', { hasText: 'Alignment' }).locator('select').selectOption('heel');
  const u = await saved();
  const w = u.wrestlers.find(x => x.name === 'Rhea Ripley');
  return [w.showId, w.alignment, u.moves.filter(m => m.wrestler === w.id).map(m => `${m.from}>${m.to}`),
    await js(`[...document.querySelectorAll('#uvSheetBody .uv-li.plain')].length`)];
}, ['raw', 'heel', ['null>nxt', 'nxt>raw'], 2]);
await check('rename to a taken name reverts', async () => {
  const name = page.locator('#uvSheetBody input.uv-in').first();
  await name.fill('Iyo Sky');
  await name.press('Tab');
  await page.waitForTimeout(120);
  return [(await saved()).wrestlers.filter(w => w.name === 'Iyo Sky').length,
    await js(`document.querySelector('#uvSheetBody input.uv-in').value`), (await toast()).bad];
}, [1, 'Rhea Ripley', true]);
await check('layout anchored w/ sheet', anchored, isAnchored);

// ---------------------------------------------------------------- tag teams
await check('create a team from the Teams tab', async () => {
  await page.click('.uv-scrim', { position: { x: 200, y: 60 } });
  await settle();
  await page.click('#uvTabs [data-uvtab=teams]');
  await page.locator('#uvBody .uv-btn', { hasText: 'New team' }).click();
  await settle();
  await page.fill('#uvTeamName', 'The Elite Two');
  await page.selectOption('#uvSheetBody select >> nth=0', { label: 'Kenny Omega' });
  await page.selectOption('#uvSheetBody select >> nth=1', { label: 'Will Ospreay' });
  await sheet.getByText('Create team').click();
  await page.waitForTimeout(150);
  const t = (await saved()).teams[0];
  return [t && t.name, t && t.members.length, await js(`document.getElementById('uvSheetTitle').textContent`)];
}, ['The Elite Two', 2, 'The Elite Two']);
await check('a split team is flagged', async () => {
  await page.click('.uv-scrim', { position: { x: 200, y: 60 } });
  await settle();
  await page.locator('#uvBody .uv-btn', { hasText: 'New team' }).click();
  await settle();
  await page.fill('#uvTeamName', 'Odd Couple');
  await page.selectOption('#uvSheetBody select >> nth=0', { label: 'Jey Uso' });
  await page.selectOption('#uvSheetBody select >> nth=1', { label: 'Cody Rhodes' });
  await sheet.getByText('Create team').click();
  await page.waitForTimeout(150);
  await page.click('.uv-scrim', { position: { x: 200, y: 60 } });
  await settle();
  return js(`[...document.querySelectorAll('#uvBody .uv-row')].map(r => r.querySelector('.nm').textContent + (r.querySelector('.uv-tag.warn') ? ':split' : ''))`);
}, ['Odd Couple:split', 'The Elite Two']);

// ---------------------------------------------------------------- titles
async function newTitle(name, show, kind, division) {
  await page.click('#uvTabs [data-uvtab=titles]');
  await page.locator('#uvBody .uv-btn', { hasText: 'New title' }).click();
  await settle();
  await page.fill('#uvTitleName', name);
  await page.selectOption('#uvSheetBody select >> nth=0', show);
  await page.selectOption('#uvSheetBody select >> nth=1', kind);
  await page.selectOption('#uvSheetBody select >> nth=2', division);
  await sheet.getByText('Create championship').click();
  await page.waitForTimeout(150);
}
await check('create a singles title and crown a champion', async () => {
  await newTitle('World Heavyweight Championship', 'raw', 'singles', 'men');
  await page.selectOption('#uvCrownPick', { label: 'Gunther' });
  await sheet.getByText('Crown', { exact: true }).click();
  await page.waitForTimeout(150);
  const u = await saved();
  const r = u.reigns.find(x => x.end === null);
  return [u.titles[0].name, r && u.wrestlers.find(w => w.id === r.holder.id).name,
    await js(`document.querySelector('#uvSheetBody .uv-champ-card .h').textContent`)];
}, ['World Heavyweight Championship', 'Gunther', 'Gunther']);
await check('a tag title only offers tag teams', async () => {
  await page.click('.uv-scrim', { position: { x: 200, y: 60 } });
  await settle();
  await newTitle('AEW World Tag Team Championship', 'dynamite', 'tag', 'men');
  return js(`[...document.querySelectorAll('#uvCrownPick option')].map(o => o.textContent)`);
}, ['— Pick the new champions —', 'Odd Couple', 'The Elite Two']);
await check('Titles tab shows champion and vacancy', async () => {
  await page.click('.uv-scrim', { position: { x: 200, y: 60 } });
  await settle();
  return js(`[...document.querySelectorAll('#uvBody .uv-row')].map(r => r.querySelector('.uv-champ .h').textContent)`);
}, ['Gunther', 'Vacant']);

// ---------------------------------------------------------------- seasons + events + results
await check('Next week advances the clock', async () => {
  await page.click('#uvTabs [data-uvtab=history]');
  await page.locator('#uvBody .uv-btn', { hasText: 'Next week' }).click();
  await page.locator('#uvBody .uv-btn', { hasText: 'Next week' }).click();
  return [await js(`document.getElementById('uvClock').textContent`), (await saved()).seasons[0].week];
}, ['Season 1 · Week 3', 3]);
await check('a weekly event names itself', async () => {
  await page.locator('#uvBody .uv-btn', { hasText: 'New event' }).click();
  await settle();
  await page.selectOption('#uvSheetBody select >> nth=0', 'raw');
  await sheet.getByText('Create event').click();
  await page.waitForTimeout(150);
  const e = (await saved()).events[0];
  return [e.name, e.at.week, await js(`document.getElementById('uvSheetTitle').textContent`)];
}, ['Raw · Week 3', 3, 'Raw · Week 3']);
await check('record a title change from the result form', async () => {
  await sheet.getByText('Record a result').click();
  await settle();
  const side = i => page.locator('#uvSheetBody .uv-sidebox').nth(i);
  await side(0).locator('select').nth(1).selectOption({ label: 'Gunther' });
  await side(1).locator('select').nth(1).selectOption({ label: 'Cody Rhodes' });
  await page.locator('#uvSheetBody .uv-f', { hasText: 'Result' }).locator('select').selectOption({ label: 'Cody Rhodes won' });
  await page.locator('#uvSheetBody .uv-f', { hasText: 'Finish' }).locator('select').selectOption('pinfall');
  await page.locator('#uvSheetBody .uv-f', { hasText: 'Championship' }).locator('select').selectOption({ label: 'World Heavyweight Championship' });
  await page.locator('#uvSheetBody .uv-check input').check();
  await page.locator('#uvSheetBody .uv-f', { hasText: 'Stipulation' }).locator('input').fill('Last Man Standing');
  await sheet.getByText('Save result').click();
  await page.waitForTimeout(200);
  const u = await saved();
  const m = u.events[0].matches[0];
  const r = u.reigns.find(x => x.end === null && x.titleId === u.titles[0].id);
  return [m.outcome, m.winner, m.finish, m.stip, u.wrestlers.find(w => w.id === r.holder.id).name,
    r.eventId === u.events[0].id && r.matchId === m.id, r.start.week, (await toast()).t];
}, ['win', 1, 'pinfall', 'Last Man Standing', 'Cody Rhodes', true, 3,
  'Result saved — Cody Rhodes wins the World Heavyweight Championship']);
await check('a tag team side fills in its members', async () => {
  await sheet.getByText('Record a result').click();
  await settle();
  const side = i => page.locator('#uvSheetBody .uv-sidebox').nth(i);
  await side(0).locator('select').nth(0).selectOption({ label: 'The Elite Two' });
  const filled = await side(0).locator('select').evaluateAll(s => s.slice(1).map(x => x.options[x.selectedIndex].text));
  await side(1).locator('select').nth(1).selectOption({ label: 'Jey Uso' });
  await side(1).locator('.uv-add').click();
  await side(1).locator('select').nth(2).selectOption({ label: 'Seth Rollins' });
  await page.locator('#uvSheetBody .uv-f', { hasText: 'Result' }).locator('select').selectOption('draw');
  await sheet.getByText('Save result').click();
  await page.waitForTimeout(200);
  const m = (await saved()).events[0].matches[1];
  return [filled, m.outcome, m.winner, m.sides.map(s => s.wrestlers.length), !!m.sides[0].team];
}, [['Kenny Omega', 'Will Ospreay'], 'draw', null, [2, 2], true]);
await check('a bad result is refused, form kept', async () => {
  await sheet.getByText('Record a result').click();
  await settle();
  await page.locator('#uvSheetBody .uv-sidebox').nth(0).locator('select').nth(1).selectOption({ label: 'Giulia' });
  await sheet.getByText('Save result').click();
  await page.waitForTimeout(150);
  return [(await saved()).events[0].matches.length, await toast(),
    await js(`document.getElementById('uvSheetTitle').textContent`)];
}, r => r[0] === 2 && r[1].bad && /Side 2 has nobody/.test(r[1].t) && r[2] === 'Record a result');
await check('event sheet lists results, marks the change', async () => {
  await page.click('.uv-scrim', { position: { x: 200, y: 60 } });
  await settle();
  await page.locator('#uvBody .uv-row', { hasText: 'Raw · Week 3' }).click();
  await settle();
  return js(`[...document.querySelectorAll('#uvSheetBody .uv-match')].map(m => m.textContent.replace(/\\s+/g,' ').trim())`);
}, r => r.length === 2 && /Cody Rhodes def\. Gunther/.test(r[0]) && /new champion/.test(r[0]) && /Draw/.test(r[1]));
await check('history guard: can’t delete a title-changing match', async () => {
  await page.locator('#uvSheetBody .uv-match').first().locator('.uv-ic').click();
  await confirmYes();
  return [(await saved()).events[0].matches.length, await toast()];
}, r => r[0] === 2 && r[1].bad && /Undo that title change first/.test(r[1].t));
await check('week is locked once a title changed there', () =>
  js(`document.querySelector('#uvSheetBody input[type=number]').disabled`), true);

await check('undo the title change from the title sheet', async () => {
  await page.click('.uv-scrim', { position: { x: 200, y: 60 } });
  await settle();
  await page.click('#uvTabs [data-uvtab=titles]');
  await page.locator('#uvBody .uv-row', { hasText: 'World Heavyweight' }).click();
  await settle();
  await sheet.getByText('Undo last change').click();
  await settle();
  const msg = await js(`document.getElementById('uvConfirmText').textContent`);
  await confirmYes();
  const u = await saved();
  const r = u.reigns.find(x => x.end === null && x.titleId === u.titles[0].id);
  return [/Cody Rhodes winning/.test(msg), u.wrestlers.find(w => w.id === r.holder.id).name, u.events[0].matches.length];
}, [true, 'Gunther', 2]);
await check('now the match can be deleted', async () => {
  await page.click('.uv-scrim', { position: { x: 200, y: 60 } });
  await settle();
  await page.click('#uvTabs [data-uvtab=history]');
  await page.locator('#uvBody .uv-row', { hasText: 'Raw · Week 3' }).click();
  await settle();
  await page.locator('#uvSheetBody .uv-match').first().locator('.uv-ic').click();
  await confirmYes();
  return (await saved()).events[0].matches.length;
}, 1);
await check('cancel leaves things alone', async () => {
  await page.locator('#uvSheetBody .uv-btn.bad', { hasText: 'Delete event' }).click();
  await settle();
  await page.locator('.uv-confirm .uv-btn', { hasText: 'Cancel' }).click();
  await settle();
  return [(await saved()).events.length, await js(`document.body.classList.contains('uv-confirm-open')`)];
}, [1, false]);
await check('start Season 2 after confirming', async () => {
  await page.click('.uv-scrim', { position: { x: 200, y: 60 } });
  await settle();
  await page.locator('#uvBody .uv-card-f span', { hasText: 'Start Season 2' }).click();
  await settle();
  await confirmYes();
  const u = await saved();
  return [u.seasons.map(s => `${s.name}:${s.status}:${s.week}`), await js(`document.getElementById('uvClock').textContent`)];
}, [['Season 1:complete:3', 'Season 2:active:1'], 'Season 2 · Week 1']);
await check('past season’s events still browsable', async () => {
  await page.locator('#uvBody .uv-pill', { hasText: 'Season 1' }).click();
  return js(`[...document.querySelectorAll('#uvBody .uv-row .nm')].map(e => e.textContent)`);
}, ['Raw · Week 3']);
await check('timeline, newest first', () => js(`[...document.querySelectorAll('#uvBody .uv-tl')].slice(0, 4)
  .map(e => [...e.children].map(c => c.textContent.trim()).join(' '))`),
  r => /^S2 · W1 Season 2 began/.test(r[0]) && /^S1 · W3 Season 1 ended after 3 weeks/.test(r[1]));
await check('saved universe is still sound', sound, []);

// ---------------------------------------------------------------- persistence
const before = await saved();
await check('fantasy + Markets storage untouched', () => js(`[localStorage.getItem('cbd_team_v1'), localStorage.getItem('arc_markets_v1')]`),
  fantasyBefore);
await check('everything survives a reload', async () => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.click('.nav .nv[data-nav=universe]');
  return [JSON.stringify(await saved()) === JSON.stringify(before),
    await js(`document.getElementById('uvClock').textContent`),
    await js(`document.querySelectorAll('#uvBody .uv-row').length`)];
}, [true, 'Season 2 · Week 1', 11]);

// ---------------------------------------------------------------- save file
const dir = await mkdtemp(join(tmpdir(), 'uv-'));
let exported;
await check('export downloads the whole universe', async () => {
  await page.click('#uvDataBtn');
  await settle();
  const [dl] = await Promise.all([page.waitForEvent('download'), sheet.locator('.uv-btn', { hasText: 'Export' }).click()]);
  exported = join(dir, dl.suggestedFilename());
  await dl.saveAs(exported);
  const file = JSON.parse(await readFile(exported, 'utf8'));
  return [dl.suggestedFilename(), JSON.stringify(file) === JSON.stringify(before)];
}, ['wwe-universe-season2-week1.json', true]);
await check('start a new universe (confirmed)', async () => {
  await sheet.getByText('Start a new universe').click();
  await settle();
  await confirmYes();
  const u = await saved();
  return [u.wrestlers.length, u.seasons.length, await js(`document.querySelectorAll('#uvBody .uv-row').length`)];
}, [0, 1, 0]);
await check('a file that isn’t a universe is refused', async () => {
  const junk = join(dir, 'junk.json');
  await writeFile(junk, JSON.stringify({ app: 'arc-markets', version: 1 }));
  await page.click('#uvDataBtn');
  await settle();
  await page.setInputFiles('#uvImport', junk);
  await page.waitForTimeout(200);
  return [await toast(), (await saved()).wrestlers.length, await js(`document.body.classList.contains('uv-confirm-open')`)];
}, r => r[0].bad && /not a WWE Universe save/.test(r[0].t) && r[1] === 0 && r[2] === false);
await check('import brings the export back exactly', async () => {
  await page.setInputFiles('#uvImport', exported);
  await page.waitForTimeout(200);
  await confirmYes();
  return [JSON.stringify(await saved()) === JSON.stringify(before), await js(`document.getElementById('uvClock').textContent`)];
}, [true, 'Season 2 · Week 1']);
await check('layout anchored after all that', anchored, isAnchored);

// ---------------------------------------------------------------- the seam
await check('Markets from Universe swaps sections', async () => {
  await page.click('.uv-scrim', { position: { x: 200, y: 60 } });
  await settle();
  await page.click('.nav .nv[data-nav=markets]');
  return js(`[document.body.classList.contains('markets'), document.body.classList.contains('universe')]`);
}, [true, false]);
await check('and back again', async () => {
  await page.click('.nav .nv[data-nav=universe]');
  return js(`[document.body.classList.contains('markets'), document.body.classList.contains('universe')]`);
}, [false, true]);
await check('Matchup leaves the universe', async () => {
  await page.click('.nav .nv[data-nav=matchup]');
  return js(`[document.body.classList.contains('universe'), !!document.querySelector('.view.on')]`);
}, [false, true]);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed, ${errors.length} page errors`);
if (errors.length) console.log(errors.join('\n'));
process.exit(fail || errors.length ? 1 : 0);
