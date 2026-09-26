// Interaction checks for the WWE Universe section.
//
// Usage: node tools/universe-check.mjs [url]      (defaults to the dist build)
//        npm run check:universe
//
// Drives the section the way the owner would - nav taps, typing, selects,
// confirm boxes, profile pages and Back, a real file download and upload -
// and asserts on what landed in localStorage rather than on the DOM alone.
// Every snapshot of the saved universe is also run through the model's own
// validate(), so a screen that leaves the data inconsistent fails here even
// if it looks right.
//
// Layout is checked by geometry as well: focusing a field inside a sheet that
// is still sliding in used to scroll the overflow:hidden .phone, dragging the
// whole app up. DOM assertions never saw it.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate, wrestlerRecord, teamRecord } from '../js/universe/model.js';

const url = process.argv[2] || 'file://' + process.cwd() + '/dist/index.html';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 436, height: 920 } });
page.setDefaultTimeout(4000);           // a missing element should fail fast, not after 30s
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
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(50)} ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
  await page.waitForTimeout(80);
}
const js = code => page.evaluate(code);
const saved = () => js(`JSON.parse(localStorage.getItem('wwe_universe_v1'))`);
const sound = async () => { const u = await saved(); return u ? validate(u) : ['nothing saved']; };
const toast = () => js(`(()=>{const h=document.getElementById('uvHint');return {t:h.textContent,bad:h.classList.contains('bad')}})()`);
const sheet = page.locator('#uvSheetBody');
const body = page.locator('#uvBody');
const settle = () => page.waitForTimeout(380);           // sheet slide / confirm box
const confirmYes = async () => { await page.click('#uvConfirmYes'); await settle(); };
const closeSheet = async () => { await page.click('.uv-scrim', { position: { x: 200, y: 60 } }); await settle(); };
const W = async name => (await saved()).wrestlers.find(w => w.name === name);
const T = async name => (await saved()).teams.find(t => t.name === name);
// a button by its exact label ("Add" is not "Add wrestlers"), or by a pattern
const reEsc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const btn = (where, text) => where.locator('.uv-btn', { hasText: text instanceof RegExp ? text : new RegExp(`^\\s*${reEsc(text)}\\s*$`) });
const fixRow = text => body.locator('.uv-fixrow', { hasText: text });
const pageName = () => js(`(document.querySelector('.uv-page .uv-prof-id .nm') || document.querySelector('.uv-page .uv-champ-card .k') || {}).textContent || null`);
const pageKind = () => js(`(document.querySelector('.uv-page') || {dataset:{}}).dataset.page || null`);
const recs = () => js(`[...document.querySelectorAll('.uv-page .uv-rec')].map(r => r.querySelector('.k').textContent + ' ' + r.querySelector('.v').textContent)`);
const openRow = async (text, tab) => {
  await noSheet();
  if (tab) await page.click(`#uvTabs [data-uvtab=${tab}]`);
  await body.locator('.uv-row', { hasText: text }).first().click();
  await page.waitForTimeout(120);
};
const openEvent = async name => {
  await noSheet();
  await page.click('#uvTabs [data-uvtab=history]');
  await body.locator('.uv-row', { hasText: name }).click();
  await settle();
};
const side = i => sheet.locator('.uv-sidebox').nth(i);
// textContent glues neighbouring elements together; this keeps a space between them
const TEXT = `(el => { const t = n => n.nodeType === 3 ? n.textContent : n.children.length ? [...n.childNodes].map(t).join(' ') : n.textContent;
  return t(el).replace(/\\s+/g, ' ').trim(); })`;
const sheetOpen = () => js(`document.body.classList.contains('uv-sheet-open')`);
const noSheet = async () => { if (await sheetOpen()) await closeSheet(); };

// the app must never be dragged out of place, whatever is open
const anchored = () => js(`(() => {
  const ph = document.querySelector('.phone'), uv = document.getElementById('uv');
  const a = ph.getBoundingClientRect(), b = uv.getBoundingClientRect();
  return { bodyY: document.body.getBoundingClientRect().y | 0, phoneScroll: ph.scrollTop + ph.scrollLeft,
    covers: Math.abs(a.top + ph.clientTop - b.top) < 1.5 && Math.abs(a.left + ph.clientLeft - b.left) < 1.5 };
})()`);
const isAnchored = r => r && r.bodyY === 0 && r.phoneScroll === 0 && r.covers;

const fantasyBefore = await js(`[localStorage.getItem('cbd_team_v1'), localStorage.getItem('arc_markets_v1')]`);

// ================================================================ open
await check('opens from the app nav', async () => {
  await page.click('.nav .nv[data-nav=universe]');
  return js(`document.body.classList.contains('universe')`);
}, true);
await check('app nav has 5 items', () => js(`document.querySelectorAll('.nav .nv').length`), 5);
await check('starts empty, four shows + All + Unassigned', () => js(`[
  document.querySelectorAll('#uvBody .uv-row').length,
  [...document.querySelectorAll('#uvBody .uv-pill')].map(p => p.textContent.trim())]`),
  r => r[0] === 0 && r[1].join('|') === 'All0|Raw0|SmackDown0|Dynamite0|NXT0|Unassigned0');
await check('Season 1, Week 1 on the clock', () => js(`document.getElementById('uvClock').textContent`), 'Season 1 · Week 1');
await check('layout anchored', anchored, isAnchored);

// ================================================================ add wrestlers
await check('Add opens the sheet on screen', async () => {
  await btn(body, 'Add').click();
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
  await closeSheet();
  return js(`[...document.querySelectorAll('#uvBody .uv-pill .n')].map(e => +e.textContent)`);
}, [11, 2, 2, 3, 4, 0]);
await check('filtering by show', async () => {
  await body.locator('.uv-pill', { hasText: 'Dynamite' }).click();
  return js(`[...document.querySelectorAll('#uvBody .uv-row .nm')].map(e => e.textContent)`);
}, ['Kenny Omega', 'Mercedes Moné', 'Will Ospreay']);
await check('search keeps focus while it filters', async () => {
  await body.locator('.uv-pill', { hasText: 'All' }).click();
  await page.click('#uvQ');
  await page.keyboard.type('rh');
  const r = [await js(`[...document.querySelectorAll('#uvBody .uv-row .nm')].map(e => e.textContent)`), await js(`document.activeElement.id`)];
  await page.fill('#uvQ', '');
  await js(`uvRosterSearch('')`);
  return r;
}, [['Cody Rhodes', 'Rhea Ripley'], 'uvQ']);

// ================================================================ wrestler profile + moving
await check('a row opens the wrestler’s profile page', async () => {
  await js(`document.getElementById('uvScroll').scrollTop = 180`);
  await openRow('Rhea Ripley');
  return [await pageKind(), await pageName(), await js(`document.querySelector('.uv-back').textContent.trim()`),
    await js(`document.querySelector('.uv-page .uv-prof-id .show').textContent.trim()`)];
}, ['wrestler', 'Rhea Ripley', 'Roster', 'NXT']);
await check('profile shows records, titles, teams, career, results', () => js(`[
  [...document.querySelectorAll('.uv-page .uv-rec .k')].map(e => e.textContent),
  [...document.querySelectorAll('.uv-page .uv-sec .t')].map(e => e.textContent)]`),
  [['Singles', 'Tag', 'Title reigns'], ['Championships', 'Tag teams & partners', 'Career history', 'Results']]);
await check('Move show: pick a show, dated, with a note', async () => {
  await btn(body, 'Move show').click();
  await settle();
  await sheet.locator('.uv-tile[data-show=raw]').click();
  await sheet.locator('.uv-f', { hasText: 'Note' }).locator('input').fill('Called up');
  await btn(sheet, 'Move to Raw').click();
  await settle();
  const u = await saved();
  const w = u.wrestlers.find(x => x.name === 'Rhea Ripley');
  const mv = u.moves.filter(m => m.wrestler === w.id).map(m => `${m.from}>${m.to}:${m.note}`);
  return [w.showId, mv, await js(`document.querySelector('.uv-page .uv-prof-id .show').textContent.trim()`),
    await js(`document.body.classList.contains('uv-sheet-open')`)];
}, ['raw', ['null>nxt:', 'nxt>raw:Called up'], 'Raw', false]);
await check('career history shows the move', () => js(`${TEXT}(document.querySelector('.uv-page .uv-tl'))`),
  r => /S1 · W1 Moved from NXT to Raw — Called up/.test(r));
await check('Fix a mistake: undo last move', async () => {
  await fixRow('Undo last move').click();
  await settle();
  const msg = await js(`document.getElementById('uvConfirmText').textContent`);
  await confirmYes();
  const w = await W('Rhea Ripley');
  const u = await saved();
  return [/moving from NXT to Raw/.test(msg), w.showId, u.moves.filter(m => m.wrestler === w.id).length];
}, [true, 'nxt', 1]);
await check('edit details: a taken name is refused and reverts', async () => {
  await btn(body, 'Edit').click();
  await settle();
  const name = sheet.locator('input.uv-in').first();
  await name.fill('Iyo Sky');
  await name.press('Tab');
  await page.waitForTimeout(150);
  return [(await saved()).wrestlers.filter(w => w.name === 'Iyo Sky').length,
    await js(`document.querySelector('#uvSheetBody input.uv-in').value`), (await toast()).bad];
}, [1, 'Rhea Ripley', true]);
await check('edit details: alignment saves as you go', async () => {
  await sheet.locator('.uv-f', { hasText: 'Alignment' }).locator('select').selectOption('heel');
  await page.waitForTimeout(120);
  return [(await W('Rhea Ripley')).alignment, (await toast()).t];
}, ['heel', 'Saved']);
await check('layout anchored w/ page and sheet', anchored, isAnchored);
await check('Back returns to the roster, same scroll', async () => {
  await closeSheet();
  await page.click('.uv-back');
  await page.waitForTimeout(150);
  return [await pageKind(), await js(`document.getElementById('uvScroll').scrollTop`)];
}, r => r[0] === null && Math.abs(r[1] - 180) <= 2);

await check('select mode moves several wrestlers at once', async () => {
  await btn(body, 'Select').click();
  await openRow('Jey Uso');
  await openRow('Seth Rollins');
  const bar = await js(`document.querySelector('.uv-selbar span').textContent`);
  await btn(body, /^\s*Move to…/).click();
  await settle();
  await sheet.locator('.uv-tile[data-show=raw]').click();
  await btn(sheet, 'Move to Raw').click();
  await settle();
  const u = await saved();
  return [bar, ['Jey Uso', 'Seth Rollins'].map(n => u.wrestlers.find(w => w.name === n).showId),
    await js(`!!document.querySelector('.uv-selbar')`), (await toast()).t];
}, ['2 selected', ['raw', 'raw'], false, '2 wrestlers → Raw']);
await check('a show can be emptied; sizes stay unequal', () =>
  js(`[...document.querySelectorAll('#uvBody .uv-pill .n')].map(e => +e.textContent)`), [11, 4, 0, 3, 4, 0]);

// ================================================================ tag teams
await check('a new team opens its own page', async () => {
  await page.click('#uvTabs [data-uvtab=teams]');
  await btn(body, 'New team').click();
  await settle();
  await page.fill('#uvTeamName', 'The Elite Two');
  await page.selectOption('#uvSheetBody select >> nth=0', { label: 'Kenny Omega' });
  await page.selectOption('#uvSheetBody select >> nth=1', { label: 'Will Ospreay' });
  await sheet.getByText('Create team').click();
  await page.waitForTimeout(150);
  const t = await T('The Elite Two');
  return [t && t.members.length, await pageKind(), await pageName(), await js(`document.querySelector('.uv-back').textContent.trim()`)];
}, [2, 'team', 'The Elite Two', 'Teams']);
await check('a split team is flagged', async () => {
  await page.click('.uv-back');
  await btn(body, 'New team').click();
  await settle();
  await page.fill('#uvTeamName', 'Odd Couple');
  await page.selectOption('#uvSheetBody select >> nth=0', { label: 'Iyo Sky' });
  await page.selectOption('#uvSheetBody select >> nth=1', { label: 'Cody Rhodes' });
  await sheet.getByText('Create team').click();
  await page.waitForTimeout(150);
  const onPage = await js(`/Split across shows/.test(document.querySelector('.uv-page .uv-prof').textContent)`);
  await page.click('.uv-back');
  return [onPage, await js(`[...document.querySelectorAll('#uvBody .uv-row')].map(r => r.querySelector('.nm').textContent.trim() + (r.querySelector('.uv-tag.warn') ? ':split' : ''))`)];
}, [true, ['Odd Couple:split', 'The Elite Two']]);

// ================================================================ titles
async function newTitle(name, show, kind, division) {
  await page.click('#uvTabs [data-uvtab=titles]');
  await btn(body, 'New title').click();
  await settle();
  await page.fill('#uvTitleName', name);
  await page.selectOption('#uvSheetBody select >> nth=0', show);
  await page.selectOption('#uvSheetBody select >> nth=1', kind);
  await page.selectOption('#uvSheetBody select >> nth=2', division);
  await sheet.getByText('Create championship').click();
  await page.waitForTimeout(150);
}
await check('create a title; crown a champion from its page', async () => {
  await newTitle('World Heavyweight Championship', 'raw', 'singles', 'men');
  const kind = await pageKind();
  await btn(body, /^\s*Crown…/).click();
  await settle();
  await page.selectOption('#uvCrownPick', { label: 'Gunther' });
  await btn(sheet, 'Crown').click();
  await settle();
  const u = await saved();
  const r = u.reigns.find(x => x.end === null);
  return [kind, r && u.wrestlers.find(w => w.id === r.holder.id).name,
    await js(`document.querySelector('.uv-page .uv-champ-card .h').textContent`)];
}, ['title', 'Gunther', 'Gunther']);
await check('a tag title only offers tag teams', async () => {
  await newTitle('AEW World Tag Team Championship', 'dynamite', 'tag', 'men');
  await btn(body, /^\s*Crown…/).click();
  await settle();
  const opts = await js(`[...document.querySelectorAll('#uvCrownPick option')].map(o => o.textContent)`);
  await closeSheet();
  return opts;
}, ['— Pick the new champions —', 'Odd Couple', 'The Elite Two']);
await check('Titles tab: champion, reign length, vacancy', async () => {
  await page.click('#uvTabs [data-uvtab=titles]');
  return js(`[...document.querySelectorAll('#uvBody .uv-row')].map(r => ${TEXT}(r.querySelector('.uv-champ')))`);
}, ['Gunther under a week · since S1 · W1', 'Vacant']);

// ================================================================ events + results
await check('Next week advances the clock', async () => {
  await page.click('#uvTabs [data-uvtab=history]');
  await btn(body, 'Next week').click();
  await btn(body, 'Next week').click();
  return [await js(`document.getElementById('uvClock').textContent`), (await saved()).seasons[0].week];
}, ['Season 1 · Week 3', 3]);
await check('a weekly event names itself', async () => {
  await btn(body, 'New event').click();
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
  await side(0).locator('select').nth(1).selectOption({ label: 'Gunther' });
  await side(1).locator('select').nth(1).selectOption({ label: 'Cody Rhodes' });
  await sheet.locator('.uv-f', { hasText: 'Result' }).locator('select').selectOption({ label: 'Cody Rhodes won' });
  await sheet.locator('.uv-f', { hasText: 'Finish' }).locator('select').selectOption('pinfall');
  await sheet.locator('.uv-f', { hasText: 'Championship' }).locator('select').selectOption({ label: 'World Heavyweight Championship' });
  await sheet.locator('.uv-check input').check();
  await sheet.locator('.uv-f', { hasText: 'Stipulation' }).locator('input').fill('Last Man Standing');
  await sheet.getByText('Save result').click();
  await page.waitForTimeout(200);
  const u = await saved();
  const m = u.events[0].matches[0];
  const r = u.reigns.find(x => x.end === null && x.titleId === u.titles[0].id);
  return [m.outcome, m.winner, m.finish, m.stip, u.wrestlers.find(w => w.id === r.holder.id).name,
    r.eventId === u.events[0].id && r.matchId === m.id, r.start.week, (await toast()).t];
}, ['win', 1, 'pinfall', 'Last Man Standing', 'Cody Rhodes', true, 3,
  'Result saved — Cody Rhodes holds the World Heavyweight Championship']);
await check('the form offers the team two members could be', async () => {
  await sheet.getByText('Record a result').click();
  await settle();
  await side(0).locator('select').nth(1).selectOption({ label: 'Kenny Omega' });
  await side(0).locator('.uv-add').click();
  await side(0).locator('select').nth(2).selectOption({ label: 'Will Ospreay' });
  const hint = await side(0).locator('.uv-hint').textContent();
  await side(0).locator('.uv-hint').click();
  const team = await side(0).locator('select').nth(0).evaluate(s => s.options[s.selectedIndex].text);
  await side(1).locator('select').nth(1).selectOption({ label: 'Jey Uso' });
  await side(1).locator('.uv-add').click();
  await side(1).locator('select').nth(2).selectOption({ label: 'Seth Rollins' });
  await sheet.locator('.uv-f', { hasText: 'Result' }).locator('select').selectOption('draw');
  await sheet.getByText('Save result').click();
  await page.waitForTimeout(200);
  const m = (await saved()).events[0].matches[1];
  return [/Wrestling as The Elite Two/.test(hint), team, m.outcome, !!m.sides[0].team, !!m.sides[1].team];
}, [true, 'The Elite Two', 'draw', true, false]);
await check('a bad result is refused, form kept', async () => {
  await sheet.getByText('Record a result').click();
  await settle();
  await side(0).locator('select').nth(1).selectOption({ label: 'Giulia' });
  await sheet.getByText('Save result').click();
  await page.waitForTimeout(150);
  const r = [(await saved()).events[0].matches.length, await toast(), await js(`document.getElementById('uvSheetTitle').textContent`)];
  await closeSheet();
  return r;
}, r => r[0] === 2 && r[1].bad && /Side 2 has nobody/.test(r[1].t) && r[2] === 'Record a result');

// ================================================================ correcting results
await check('a wrong result is corrected in place', async () => {
  await openEvent('Raw · Week 3');
  const before = (await saved()).events[0].matches.map(m => m.id);
  await sheet.locator('.uv-match').nth(1).click();
  await settle();
  const title = await js(`document.getElementById('uvSheetTitle').textContent`);
  await sheet.locator('.uv-f', { hasText: 'Result' }).locator('select').selectOption({ label: 'The Elite Two won' });
  await sheet.getByText('Save correction').click();
  await page.waitForTimeout(200);
  const u = await saved();
  return [title, JSON.stringify(u.events[0].matches.map(m => m.id)) === JSON.stringify(before),
    u.events[0].matches[1].outcome, u.events[0].matches[1].winner, (await toast()).t];
}, ['Correct a result', true, 'win', 0, 'Result corrected']);
await check('a later title change pins an earlier one', async () => {
  await openRow('World Heavyweight', 'titles');
  await btn(body, /^\s*Crown…/).click();
  await settle();
  await page.selectOption('#uvCrownPick', { label: 'Seth Rollins' });
  await btn(sheet, 'Crown').click();
  await settle();
  await openEvent('Raw · Week 3');
  await sheet.locator('.uv-match').nth(0).click();
  await settle();
  await sheet.locator('.uv-check input').uncheck();
  const before = JSON.stringify(await saved());
  await sheet.getByText('Save correction').click();
  await page.waitForTimeout(150);
  const r = [await toast(), JSON.stringify(await saved()) === before];
  await closeSheet();
  return r;
}, r => r[0].bad && /changed hands or been vacated since this match/.test(r[0].t) && r[1]);
await check('undo on the title page, then the correction goes through', async () => {
  await openRow('World Heavyweight', 'titles');
  await fixRow('Undo last change').click();
  await settle();
  const msg = await js(`document.getElementById('uvConfirmText').textContent`);
  await confirmYes();
  await openEvent('Raw · Week 3');
  await sheet.locator('.uv-match').nth(0).click();
  await settle();
  await sheet.locator('.uv-check input').uncheck();
  await sheet.getByText('Save correction').click();
  await page.waitForTimeout(200);
  const u = await saved();
  const cur = u.reigns.find(x => x.end === null && x.titleId === u.titles[0].id);
  return [/Seth Rollins winning/.test(msg), u.wrestlers.find(w => w.id === cur.holder.id).name, u.events[0].matches[0].titleId === u.titles[0].id];
}, [true, 'Gunther', true]);
await check('and the title change can be put back', async () => {
  await sheet.locator('.uv-match').nth(0).click();
  await settle();
  await sheet.locator('.uv-check input').check();
  await sheet.getByText('Save correction').click();
  await page.waitForTimeout(200);
  const u = await saved();
  const cur = u.reigns.find(x => x.end === null && x.titleId === u.titles[0].id);
  return u.wrestlers.find(w => w.id === cur.holder.id).name;
}, 'Cody Rhodes');
await check('an event’s week carries its title change with it', async () => {
  const wk = sheet.locator('.uv-f', { hasText: 'Week' }).locator('input');
  await wk.fill('2');
  await wk.press('Tab');
  await page.waitForTimeout(150);
  const u = await saved();
  const [g, c] = u.reigns.filter(r => r.titleId === u.titles[0].id).sort((a, b) => a.start.seq - b.start.seq);
  return [u.events[0].at.week, c.start.week, g.end.week, g.start.week];
}, [2, 2, 2, 1]);
await check('deleting a title-changing result hands the belt back', async () => {
  await sheet.locator('.uv-match').nth(0).click();
  await settle();
  await sheet.getByText('Delete this result').click();
  await settle();
  const msg = await js(`document.getElementById('uvConfirmText').textContent`);
  await confirmYes();
  const u = await saved();
  const cur = u.reigns.find(x => x.end === null && x.titleId === u.titles[0].id);
  return [/goes back to whoever held it before/.test(msg), u.events[0].matches.length, u.wrestlers.find(w => w.id === cur.holder.id).name];
}, [true, 1, 'Gunther']);

// ================================================================ records
await check('singles, tag and team records are counted apart', async () => {
  await sheet.getByText('Record a result').click();                  // Kenny def. Will in singles
  await settle();
  await side(0).locator('select').nth(1).selectOption({ label: 'Kenny Omega' });
  await side(1).locator('select').nth(1).selectOption({ label: 'Will Ospreay' });
  await sheet.getByText('Save result').click();
  await page.waitForTimeout(200);
  await closeSheet();
  await openRow('Kenny Omega', 'roster');
  const kenny = await recs();
  const card = await js(`${TEXT}([...document.querySelectorAll('.uv-page .uv-row')].find(r => /The Elite Two/.test(r.textContent)).querySelector('.uv-champ'))`);
  const u = await saved();
  const k = await W('Kenny Omega'), w = await W('Will Ospreay'), t = await T('The Elite Two');
  return [kenny, card, wrestlerRecord(u, w.id).singles, teamRecord(u, t.id), wrestlerRecord(u, k.id).tag];
}, [['Singles 1–0–0', 'Tag 1–0–0', 'Title reigns 0'], '1–0–0 as the team', { w: 0, l: 1, d: 0, nc: 0 },
  { w: 1, l: 0, d: 0, nc: 0 }, { w: 1, l: 0, d: 0, nc: 0 }]);
await check('the team page shows only its own record', async () => {
  await body.locator('.uv-page .uv-row', { hasText: 'The Elite Two' }).click();
  await page.waitForTimeout(120);
  return [await pageName(), (await recs())[0], await js(`document.querySelector('.uv-back').textContent.trim()`)];
}, ['The Elite Two', 'Team record 1–0–0', 'Kenny Omega']);

// ================================================================ line-ups
await check('line-up changes are dated and kept', async () => {
  await btn(body, 'Line-up').click();
  await settle();
  await page.selectOption('#uvLineupPick', { label: 'Mercedes Moné' });
  await btn(sheet, 'Add').click();
  await page.waitForTimeout(150);
  await sheet.locator('.uv-li', { hasText: 'Will Ospreay' }).locator('.uv-btn').click();
  await page.waitForTimeout(150);
  await closeSheet();
  const u = await saved();
  const t = u.teams.find(x => x.name === 'The Elite Two');
  const names = ids => ids.map(id => u.wrestlers.find(w => w.id === id).name).sort();
  const hist = await js(`[...document.querySelectorAll('.uv-page .uv-tl .x')].map(e => e.textContent.trim())`);
  return [names(t.members), u.memberships.filter(m => m.team === t.id).length, hist.slice(0, 2),
    await js(`/Former/.test(document.querySelector('.uv-page').textContent)`)];
}, [['Kenny Omega', 'Mercedes Moné'], 3, ['Will Ospreay left', 'Mercedes Moné joined'], true]);
await check('a former member keeps the team on their profile', async () => {
  await body.locator('.uv-page .uv-row', { hasText: 'Will Ospreay' }).click();
  await page.waitForTimeout(120);
  const row = await js(`${TEXT}([...document.querySelectorAll('.uv-page .uv-row')].find(r => /The Elite Two/.test(r.textContent)))`);
  await page.click('.uv-back');
  return [/Former/.test(row), /with Kenny Omega/.test(row), /1–0–0 as the team/.test(row), await pageName()];
}, [true, true, true, 'The Elite Two']);
await check('undo the last line-up change', async () => {
  await fixRow('Undo last change').click();
  await settle();
  const msg = await js(`document.getElementById('uvConfirmText').textContent`);
  await confirmYes();
  const t = await T('The Elite Two');
  return [/Will Ospreay leaving/.test(msg), t.members.length];
}, [true, 3]);

// ================================================================ reigns, merging, deleting
await check('correct an old reign from the title history', async () => {
  await openRow('World Heavyweight', 'titles');
  await body.locator('.uv-page .uv-row', { hasText: 'Gunther' }).click();
  await settle();
  await page.selectOption('#uvReignHolder', { label: 'Seth Rollins' });
  await page.fill('#uvReignNote', 'Tournament');
  await btn(sheet, 'Save correction').click();
  await settle();
  const u = await saved();
  const r = u.reigns.find(x => x.titleId === u.titles[0].id);
  return [u.wrestlers.find(w => w.id === r.holder.id).name, r.note, await js(`document.querySelector('.uv-page .uv-champ-card .h').textContent`)];
}, ['Seth Rollins', 'Tournament', 'Seth Rollins']);
await check('merge a duplicate: its results become the wrestler’s', async () => {
  await page.click('#uvTabs [data-uvtab=roster]');
  await btn(body, 'Add').click();
  await settle();
  await page.selectOption('#uvSheetBody select >> nth=0', 'dynamite');
  await page.keyboard.type('Kenny Omgea');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  await closeSheet();
  await openEvent('Raw · Week 3');
  await sheet.getByText('Record a result').click();
  await settle();
  await side(0).locator('select').nth(1).selectOption({ label: 'Kenny Omgea' });
  await side(1).locator('select').nth(1).selectOption({ label: 'Giulia' });
  await sheet.getByText('Save result').click();
  await page.waitForTimeout(150);
  await closeSheet();
  await openRow('Kenny Omega', 'roster');
  await fixRow('Merge a duplicate').click();
  await settle();
  await page.selectOption('#uvMergePick', { label: 'Kenny Omgea' });
  await btn(sheet, /^\s*Merge into/).click();
  await settle();
  await confirmYes();
  const u = await saved();
  return [!!u.wrestlers.find(w => w.name === 'Kenny Omgea'), (await recs())[0], validate(u)];
}, [false, 'Singles 2–0–0', []]);
await check('deleting a mistake returns to the list', async () => {
  await page.click('#uvTabs [data-uvtab=roster]');
  await btn(body, 'Add').click();
  await settle();
  await page.keyboard.type('Oops');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  await closeSheet();
  await openRow('Oops');
  await fixRow('Delete Oops').click();
  await settle();
  await confirmYes();
  return [await pageKind(), !!(await W('Oops')), (await toast()).t];
}, [null, false, 'Oops deleted']);

// ================================================================ seasons
await check('start Season 2 after confirming', async () => {
  await page.click('#uvTabs [data-uvtab=history]');
  await body.locator('.uv-card-f span', { hasText: 'Start Season 2' }).click();
  await settle();
  await confirmYes();
  const u = await saved();
  return [u.seasons.map(s => `${s.name}:${s.status}:${s.week}`), await js(`document.getElementById('uvClock').textContent`)];
}, [['Season 1:complete:3', 'Season 2:active:1'], 'Season 2 · Week 1']);
await check('past season’s events still browsable', async () => {
  await body.locator('.uv-pill', { hasText: 'Season 1' }).click();
  return js(`[...document.querySelectorAll('#uvBody .uv-row .nm')].map(e => e.textContent)`);
}, ['Raw · Week 3']);
await check('timeline, newest first', () => js(`[...document.querySelectorAll('#uvBody .uv-tl')].slice(0, 3)
  .map(e => [...e.children].map(c => c.textContent.trim()).join(' '))`),
  r => /^S2 · W1 Season 2 began/.test(r[0]) && /^S1 · W3 Season 1 ended after 3 weeks/.test(r[1]));
await check('saved universe is still sound', sound, []);

// ================================================================ persistence
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

// ================================================================ save file
const dir = await mkdtemp(join(tmpdir(), 'uv-'));
let exported;
await check('export downloads the whole universe', async () => {
  await page.click('#uvDataBtn');
  await settle();
  const [dl] = await Promise.all([page.waitForEvent('download'), btn(sheet, 'Export').click()]);
  exported = join(dir, dl.suggestedFilename());
  await dl.saveAs(exported);
  const file = JSON.parse(await readFile(exported, 'utf8'));
  return [dl.suggestedFilename(), JSON.stringify(file) === JSON.stringify(before), file.version];
}, ['wwe-universe-season2-week1.json', true, 2]);
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
await check('a v1 save from the last version imports and upgrades', async () => {
  await noSheet();
  await page.click('#uvDataBtn');
  await settle();
  await page.setInputFiles('#uvImport', join(process.cwd(), 'tools/fixtures/universe-v1.json'));
  await page.waitForTimeout(200);
  await confirmYes();
  const u = await saved();
  await closeSheet();
  await openRow('Jey Uso', 'roster');
  return [u.version, validate(u), await recs()];
}, [2, [], ['Singles 1–0–0', 'Tag 0–1–0', 'Title reigns 1']]);
await check('layout anchored after all that', async () => { await noSheet(); return anchored(); }, isAnchored);

// ================================================================ the seam
await check('Markets from Universe swaps sections', async () => {
  await page.click('.nav .nv[data-nav=markets]');
  return js(`[document.body.classList.contains('markets'), document.body.classList.contains('universe')]`);
}, [true, false]);
await check('and back again, to the list not a stale page', async () => {
  await page.click('.nav .nv[data-nav=universe]');
  return js(`[document.body.classList.contains('markets'), document.body.classList.contains('universe'), !!document.querySelector('.uv-page')]`);
}, [false, true, false]);
await check('Matchup leaves the universe', async () => {
  await page.click('.nav .nv[data-nav=matchup]');
  return js(`[document.body.classList.contains('universe'), !!document.querySelector('.view.on')]`);
}, [false, true]);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed, ${errors.length} page errors`);
if (errors.length) console.log(errors.join('\n'));
process.exit(fail || errors.length ? 1 : 0);
