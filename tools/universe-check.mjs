// Interaction checks for Universe, the standalone WWE 2K25 companion app.
//
// Usage: node tools/universe-check.mjs [url]      (defaults to dist/universe.html)
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
// is still sliding in scrolls the overflow:hidden app column, dragging the
// whole app up. DOM assertions never see it.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as M from '../js/universe/model.js';
import * as SD from '../js/universe/standings.js';
const { validate, wrestlerRecord, teamRecord } = M;

const url = process.argv[2] || 'file://' + process.cwd() + '/dist/universe.html';
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

// Local files can share one browser storage area with the fantasy app, so plant
// what it would have saved and prove Universe never touches it.
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.evaluate(`localStorage.clear();
  localStorage.setItem('cbd_team_v1', '{"team":{"name":"UGF Pandas"}}');
  localStorage.setItem('arc_markets_v1', '{"watch":["00-0036900"]}')`);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(600);

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
// a show's page, from the calendar - `week` picks another week from the season grid
const openShow = async (name, week) => {
  await noSheet();
  await page.click('#uvTabs [data-uvtab=calendar]');
  if (week) await body.locator('.uv-gr', { has: page.locator('.w', { hasText: new RegExp(`^W${week}$`) }) }).click();
  await body.locator('.uv-night[data-ev]', { hasText: name }).click();
  await page.waitForTimeout(120);
};
const evTitle = () => js(`(document.querySelector('.uv-page .uv-evhead .nm') || {}).textContent || null`);
const mc = i => body.locator('.uv-page .uv-mc').nth(i);
const cards = () => js(`[...document.querySelectorAll('.uv-page .uv-mc-body')].map(b => ${TEXT}(b))`);
// the calendar's nights: "Mon Raw · Week 3 | 2 of 3 results in"
const nights = () => js(`[...document.querySelectorAll('#uvBody .uv-night')].map(r => r.querySelector('.dt b').textContent + ' '
  + r.querySelector('.nm').textContent.trim() + ' | ' + r.querySelector('.sub').textContent.trim())`);
// the shows listed in History, newest first
const shows = () => js(`[...document.querySelectorAll('#uvBody .uv-hev .nm')].map(e => e.textContent.trim())`);
const side = i => sheet.locator('.uv-sidebox').nth(i);
// textContent glues neighbouring elements together; this keeps a space between them
const TEXT = `(el => { const t = n => n.nodeType === 3 ? n.textContent : n.children.length ? [...n.childNodes].map(t).join(' ') : n.textContent;
  return t(el).replace(/\\s+/g, ' ').trim(); })`;
const sheetOpen = () => js(`document.body.classList.contains('uv-sheet-open')`);
const noSheet = async () => { if (await sheetOpen()) await closeSheet(); };

// the app must never be dragged out of place, whatever is open
const anchored = () => js(`(() => {
  const ph = document.querySelector('.uv-app'), uv = document.getElementById('uv');
  const a = ph.getBoundingClientRect(), b = uv.getBoundingClientRect();
  return { bodyY: document.body.getBoundingClientRect().y | 0, frameScroll: ph.scrollTop + ph.scrollLeft,
    covers: Math.abs(a.top + ph.clientTop - b.top) < 1.5 && Math.abs(a.left + ph.clientLeft - b.left) < 1.5 };
})()`);
const isAnchored = r => r && r.bodyY === 0 && r.frameScroll === 0 && r.covers;

const fantasyBefore = await js(`[localStorage.getItem('cbd_team_v1'), localStorage.getItem('arc_markets_v1')]`);

// ================================================================ open
await check('opens straight into the app', () => js(`[document.title, document.querySelector('.uv-tab.on').textContent]`),
  ['Universe — WWE 2K25 companion', 'Roster']);
await check('nothing of the fantasy app on the page', () => js(`[
  !!document.querySelector('.phone, .nav, .shift, .drawer, #hint, .mk'),
  ['showTab', 'openMarkets', 'renderWeek', 'LG'].filter(n => n in window)]`), [false, []]);
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

// ================================================================ calendar
await check('the calendar: each show on its own night, not yet planned', async () => {
  await noSheet();
  await page.click('#uvTabs [data-uvtab=calendar]');
  await btn(body, 'Next week').click();
  await btn(body, 'Next week').click();
  return [await js(`document.getElementById('uvClock').textContent`), (await saved()).seasons[0].week,
    await js(`document.querySelector('.uv-weeknav .t').textContent`), await nights()];
}, ['Season 1 · Week 3', 3, 'Week 3',
  ['Mon Raw | Not planned', 'Tue NXT | Not planned', 'Wed Dynamite | Not planned', 'Fri SmackDown | Not planned']]);
await check('pin the season to real dates', async () => {
  await body.locator('.uv-card-f span', { hasText: 'Set dates' }).click();
  await settle();
  await page.fill('#uvSeasonStart', '2026-01-07');                   // a Wednesday: week 1 is 5–11 Jan
  await btn(sheet, 'Save').click();
  await settle();
  return [(await saved()).seasons[0].start, await js(`document.querySelector('.uv-weeknav .s').textContent`),
    await js(`[...document.querySelectorAll('#uvBody .uv-night .dt span')].map(e => e.textContent)`)];
}, ['2026-01-07', 'This week · 19 Jan – 25 Jan 2026', ['19 Jan', '20 Jan', '21 Jan', '23 Jan']]);
await check('Plan puts Raw on the calendar and opens its card', async () => {
  await body.locator('.uv-night[data-plan=raw]').locator('.uv-btn').click();
  await page.waitForTimeout(150);
  const e = (await saved()).events[0];
  return [e.name, e.at.week, e.at.day, e.matches.length, await pageKind(), await evTitle(),
    await js(`document.querySelector('.uv-evhead .s').textContent`), await js(`document.querySelector('.uv-back').textContent.trim()`)];
}, ['Raw · Week 3', 3, 0, 0, 'event', 'Raw · Week 3', 'Monday 19 Jan 2026 · week 3 · Season 1', 'Calendar']);

// ================================================================ booking, then results
await check('book a title match: it counts for nothing until it’s played', async () => {
  await btn(body, 'Book a match').click();
  await settle();
  await side(0).locator('select[data-w="0"]').selectOption({ label: 'Gunther' });
  await side(1).locator('select[data-w="0"]').selectOption({ label: 'Cody Rhodes' });
  await page.selectOption('#uvMTitle', { label: 'World Heavyweight Championship' });
  await page.fill('#uvMStip', 'Last Man Standing');
  await btn(sheet, 'Add to the card').click();
  await settle();
  const u = await saved();
  const m = u.events[0].matches[0];
  const cur = u.reigns.find(x => x.end === null && x.titleId === u.titles[0].id);
  return [m.status, m.outcome, m.winner, m.stip, u.wrestlers.find(w => w.id === cur.holder.id).name,
    wrestlerRecord(u, (await W('Cody Rhodes')).id).singles, await cards(), (await toast()).t, await sheetOpen()];
}, ['scheduled', null, null, 'Last Man Standing', 'Gunther', { w: 0, l: 0, d: 0, nc: 0 }, ['Gunther vs Cody Rhodes'], 'Match booked', false]);
await check('the result form starts blank and won’t guess a winner', async () => {
  await btn(mc(0), 'Enter result').click();
  await settle();
  const r = [await js(`document.getElementById('uvSheetTitle').textContent`), await js(`document.getElementById('uvMResult').value`),
    await js(`document.getElementById('uvMResult').selectedOptions[0].textContent`), await js(`!!document.getElementById('uvMTitleChange')`),
    await js(`${TEXT}(document.querySelector('#uvSheetBody .uv-mc-sum'))`)];
  await btn(sheet, 'Save the result').click();
  await page.waitForTimeout(150);
  return [...r, await toast(), (await saved()).events[0].matches[0].status];
}, r => r[0] === 'Enter the result' && r[1] === '' && r[2] === '— Pick the result —' && r[3] === false
  && r[4] === 'Singles World Heavyweight Championship Last Man Standing Gunther vs Cody Rhodes'
  && r[5].bad && /Enter the result: who won, a draw, or a no contest/.test(r[5].t) && r[6] === 'scheduled');
await check('layout anchored w/ the result form open', anchored, isAnchored);
await check('enter what the CPU did: a title change, and who took the fall', async () => {
  await page.selectOption('#uvMResult', { label: 'Cody Rhodes won' });
  await page.selectOption('#uvMFinish', 'pinfall');
  await page.selectOption('#uvMOn', { label: 'Gunther' });
  await page.check('#uvMTitleChange');
  await page.fill('#uvMNotes', 'Three Cross Rhodes');
  await btn(sheet, 'Save the result').click();
  await settle();
  const u = await saved();
  const m = u.events[0].matches[0];
  const r = u.reigns.find(x => x.end === null && x.titleId === u.titles[0].id);
  const name = id => id && u.wrestlers.find(w => w.id === id).name;
  return [m.status, m.outcome, m.winner, m.finish, name(m.fall.by), name(m.fall.on), m.notes, name(r.holder.id),
    r.eventId === u.events[0].id && r.matchId === m.id, `${r.start.week}/${r.start.day}`, (await toast()).t,
    await js(`${TEXT}(document.querySelector('.uv-page .uv-mc'))`)];
}, r => JSON.stringify(r.slice(0, 11)) === JSON.stringify(['played', 'win', 1, 'pinfall', null, 'Gunther', 'Three Cross Rhodes', 'Cody Rhodes',
  true, '3/0', 'Result saved — Cody Rhodes holds the World Heavyweight Championship'])
  && /Cody Rhodes def\. Gunther Pinfall · Cody Rhodes pinned Gunther New World Heavyweight Championship champion Three Cross Rhodes Correct/.test(r[11]));
await check('a tag match: the form offers the team two members could be', async () => {
  await btn(body, 'Book a match').click();
  await settle();
  await sheet.locator('.uv-pill', { hasText: /^Tag team$/ }).click();
  await side(0).locator('select[data-w="0"]').selectOption({ label: 'Kenny Omega' });
  await side(0).locator('select[data-w="1"]').selectOption({ label: 'Will Ospreay' });
  const hint = await side(0).locator('.uv-hint').textContent();
  await side(0).locator('.uv-hint').click();
  const team = await side(0).locator('select[data-team]').evaluate(s => s.options[s.selectedIndex].text);
  await side(1).locator('select[data-w="0"]').selectOption({ label: 'Jey Uso' });
  await side(1).locator('select[data-w="1"]').selectOption({ label: 'Seth Rollins' });
  await btn(sheet, 'Add, and enter its result').click();
  await settle();
  const title = await js(`document.getElementById('uvSheetTitle').textContent`);
  await page.selectOption('#uvMResult', 'draw');
  await btn(sheet, 'Save the result').click();
  await settle();
  const m = (await saved()).events[0].matches[1];
  return [/Wrestling as The Elite Two/.test(hint), team, title, m.status, m.outcome, m.winner, !!m.sides[0].team, !!m.sides[1].team];
}, [true, 'The Elite Two', 'Enter the result', 'played', 'draw', null, true, false]);
await check('a triple threat ends in a no contest', async () => {
  await btn(body, 'Book a match').click();
  await settle();
  await sheet.locator('.uv-pill', { hasText: /^Triple threat$/ }).click();
  for (const [i, n] of [[0, 'Iyo Sky'], [1, 'Rhea Ripley'], [2, 'Roxanne Perez']]) {
    await side(i).locator('select[data-w="0"]').selectOption({ label: n });
  }
  await btn(sheet, 'Add, and enter its result').click();
  await settle();
  await page.selectOption('#uvMResult', 'nc');
  await btn(sheet, 'Save the result').click();
  await settle();
  const m = (await saved()).events[0].matches[2];
  return [m.outcome, m.winner, m.sides.length, await mc(2).locator('.uv-chip.kind').textContent(), await js(`${TEXT}(document.querySelectorAll('.uv-page .uv-mc-body')[2])`)];
}, ['nc', null, 3, 'Triple threat', 'Iyo Sky vs Rhea Ripley vs Roxanne Perez — No contest']);
await check('a booking with an empty side is refused, form kept', async () => {
  await btn(body, 'Book a match').click();
  await settle();
  await side(0).locator('select[data-w="0"]').selectOption({ label: 'Giulia' });
  await btn(sheet, 'Add to the card').click();
  await page.waitForTimeout(150);
  return [(await saved()).events[0].matches.length, await toast(), await js(`document.getElementById('uvSheetTitle').textContent`),
    await side(0).locator('select[data-w="0"]').evaluate(s => s.options[s.selectedIndex].text)];
}, r => r[0] === 3 && r[1].bad && /Side 2 has nobody/.test(r[1].t) && r[2] === 'Book a match' && r[3] === 'Giulia');
await check('a handicap match left booked: card and calendar say where it stands', async () => {
  await sheet.locator('.uv-pill', { hasText: /^Handicap 1-on-2$/ }).click();
  await side(1).locator('select[data-w="0"]').selectOption({ label: 'Iyo Sky' });
  await side(1).locator('select[data-w="1"]').selectOption({ label: 'Rhea Ripley' });
  await btn(sheet, 'Add to the card').click();
  await settle();
  const head = await js(`${TEXT}(document.querySelector('.uv-evhead .st'))`);
  const kind = await mc(3).locator('.uv-chip.kind').textContent();
  await page.click('.uv-back');
  return [head, kind, (await nights())[0], await js(`document.querySelector('.uv-gr.now .uv-cell').className`)];
}, ['3 of 4 results in', 'Handicap 1-on-2', 'Mon Raw · Week 3 | 3 of 4 results in', 'uv-cell partial']);
await check('a booked wrestler’s page lists the match, with no record for it', async () => {
  await openRow('Giulia', 'roster');
  return [(await recs())[0], await js(`[...document.querySelectorAll('.uv-page .uv-sec .t')].map(e => e.textContent)`),
    await js(`${TEXT}(document.querySelector('.uv-page .uv-li'))`)];
}, r => r[0] === 'Singles 0–0–0' && r[1][0] === 'Booked' && /^vs Giulia vs Iyo Sky & Rhea Ripley Raw · Week 3 · Mon 19 Jan 2026 Handicap 1-on-2$/.test(r[2]));
await check('…and opens the show it’s booked on', async () => {
  await body.locator('.uv-page .uv-li').first().click();
  await page.waitForTimeout(120);
  return [await pageKind(), await evTitle(), await js(`document.querySelector('.uv-back').textContent.trim()`)];
}, ['event', 'Raw · Week 3', 'Giulia']);

// ================================================================ correcting results
await check('a wrong result is corrected in place', async () => {
  const before = (await saved()).events[0].matches.map(m => m.id);
  await btn(mc(1), 'Correct').click();
  await settle();
  const title = await js(`document.getElementById('uvSheetTitle').textContent`);
  const was = await js(`document.getElementById('uvMResult').value`);
  await page.selectOption('#uvMResult', { label: 'The Elite Two won' });
  await btn(sheet, 'Save the correction').click();
  await settle();
  const u = await saved();
  return [title, was, JSON.stringify(u.events[0].matches.map(m => m.id)) === JSON.stringify(before),
    u.events[0].matches[1].outcome, u.events[0].matches[1].winner, (await toast()).t];
}, ['Correct the result', 'draw', true, 'win', 0, 'Result corrected']);
await check('a later title change pins an earlier one', async () => {
  await openRow('World Heavyweight', 'titles');
  await btn(body, /^\s*Crown…/).click();
  await settle();
  await page.selectOption('#uvCrownPick', { label: 'Seth Rollins' });
  await btn(sheet, 'Crown').click();
  await settle();
  await openShow('Raw · Week 3');
  await btn(mc(0), 'Correct').click();
  await settle();
  await page.uncheck('#uvMTitleChange');
  const before = JSON.stringify(await saved());
  await btn(sheet, 'Save the correction').click();
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
  await openShow('Raw · Week 3');
  await btn(mc(0), 'Correct').click();
  await settle();
  await page.uncheck('#uvMTitleChange');
  await btn(sheet, 'Save the correction').click();
  await settle();
  const u = await saved();
  const m = u.events[0].matches[0];
  const cur = u.reigns.find(x => x.end === null && x.titleId === u.titles[0].id);
  return [/Seth Rollins winning/.test(msg), u.wrestlers.find(w => w.id === cur.holder.id).name, m.titleId === u.titles[0].id, m.winner];
}, [true, 'Gunther', true, 1]);
await check('and the title change can be put back', async () => {
  await btn(mc(0), 'Correct').click();
  await settle();
  await page.check('#uvMTitleChange');
  await btn(sheet, 'Save the correction').click();
  await settle();
  const u = await saved();
  const cur = u.reigns.find(x => x.end === null && x.titleId === u.titles[0].id);
  return u.wrestlers.find(w => w.id === cur.holder.id).name;
}, 'Cody Rhodes');
await check('a new night and week carry the show’s title change with it', async () => {
  await btn(body, 'Details').click();
  await settle();
  await page.selectOption('#uvEvDay', '1');                            // Tuesday
  await page.fill('#uvEvWeek', '2');
  await page.press('#uvEvWeek', 'Tab');
  await page.waitForTimeout(150);
  await closeSheet();
  const u = await saved();
  const [g, c] = u.reigns.filter(r => r.titleId === u.titles[0].id).sort((a, b) => a.start.seq - b.start.seq);
  return [u.events[0].name, u.events[0].at.week, u.events[0].at.day, `${c.start.week}/${c.start.day}`, `${g.end.week}/${g.end.day}`,
    g.start.week, await evTitle()];
}, ['Raw · Week 2', 2, 1, '2/1', '2/1', 1, 'Raw · Week 2']);
await check('clearing a result keeps it booked and hands the belt back', async () => {
  await btn(mc(0), 'Correct').click();
  await settle();
  await btn(sheet, 'Clear the result — keep it booked').click();
  await settle();
  const msg = await js(`document.getElementById('uvConfirmText').textContent`);
  await confirmYes();
  const u = await saved();
  const m = u.events[0].matches[0];
  const cur = u.reigns.find(x => x.end === null && x.titleId === u.titles[0].id);
  return [/goes back to whoever held it before/.test(msg), m.status, m.outcome, m.winner, m.fall, m.titleId === u.titles[0].id,
    u.wrestlers.find(w => w.id === cur.holder.id).name, wrestlerRecord(u, (await W('Cody Rhodes')).id).singles,
    await btn(mc(0), 'Enter result').count()];
}, [true, 'scheduled', null, null, null, true, 'Gunther', { w: 0, l: 0, d: 0, nc: 0 }, 1]);
await check('a booked match can be taken off the card', async () => {
  await btn(mc(3), 'Edit').click();
  await settle();
  await btn(sheet, 'Take it off the card').click();
  await settle();
  const msg = await js(`document.getElementById('uvConfirmText').textContent`);
  await confirmYes();
  return [/hasn’t been played, so nothing else changes/.test(msg), (await saved()).events[0].matches.length,
    await js(`${TEXT}(document.querySelector('.uv-evhead .st'))`)];
}, [true, 3, '2 of 3 results in']);
await check('the running order can be changed', async () => {
  const ids = async () => (await saved()).events[0].matches.map(m => m.id);
  const before = await ids();
  await mc(0).locator('.uv-ic[title="Move up"]').click();
  const t = (await toast()).t;
  await mc(0).locator('.uv-ic[title="Move down"]').click();
  await page.waitForTimeout(120);
  const after = await ids();
  await mc(0).locator('.uv-ic[title="Move down"]').click();          // and back
  return [t, after[0] === before[1] && after[1] === before[0], JSON.stringify(await ids()) === JSON.stringify(before)];
}, ['Already first on the card', true, true]);

// ================================================================ records
await check('draws and no contests are kept apart from wins and losses', async () => {
  const u = await saved();
  const id = n => u.wrestlers.find(w => w.name === n).id;
  await openRow('Iyo Sky', 'roster');
  const tile = await js(`${TEXT}(document.querySelector('.uv-page .uv-rec'))`);
  return [tile, wrestlerRecord(u, id('Iyo Sky')).singles, wrestlerRecord(u, id('Seth Rollins')).tag, wrestlerRecord(u, id('Jey Uso')).tag];
}, ['Singles 0–0–0 1 match · 1 NC', { w: 0, l: 0, d: 0, nc: 1 }, { w: 0, l: 1, d: 0, nc: 0 }, { w: 0, l: 1, d: 0, nc: 0 }]);
await check('singles, tag and team records are counted apart', async () => {
  await openShow('Raw · Week 2', 2);
  await btn(body, 'Book a match').click();                           // Kenny def. Will in singles
  await settle();
  await side(0).locator('select[data-w="0"]').selectOption({ label: 'Kenny Omega' });
  await side(1).locator('select[data-w="0"]').selectOption({ label: 'Will Ospreay' });
  await btn(sheet, 'Add, and enter its result').click();
  await settle();
  await page.selectOption('#uvMResult', { label: 'Kenny Omega won' });
  await btn(sheet, 'Save the result').click();
  await settle();
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

// ================================================================ premium live events
await check('a premium live event goes on the calendar, on a Saturday', async () => {
  await noSheet();
  await page.click('#uvTabs [data-uvtab=calendar]');
  await body.locator('.uv-addrow').click();
  await settle();
  await page.fill('#uvPleName', 'WrestleMania');
  await btn(sheet, 'Add to the calendar').click();
  await settle();
  const e = (await saved()).events.find(x => x.name === 'WrestleMania');
  return [e.kind, e.showId, e.at.week, e.at.day, await pageKind(), await js(`document.querySelector('.uv-evhead .k').textContent`)];
}, ['ple', null, 3, 5, 'event', 'Premium live event · All shows']);
await check('a fatal 4-way: the winner is whoever you pick', async () => {
  await btn(body, 'Book a match').click();
  await settle();
  await sheet.locator('.uv-pill', { hasText: /^Fatal 4-way$/ }).click();
  for (const [i, n] of [[0, 'Seth Rollins'], [1, 'Jey Uso'], [2, 'Cody Rhodes'], [3, 'Kenny Omega']]) {
    await side(i).locator('select[data-w="0"]').selectOption({ label: n });
  }
  await btn(sheet, 'Add, and enter its result').click();
  await settle();
  await page.selectOption('#uvMResult', { label: 'Jey Uso won' });
  await page.selectOption('#uvMFinish', 'pinfall');
  await page.selectOption('#uvMOn', { label: 'Seth Rollins' });
  await btn(sheet, 'Save the result').click();
  await settle();
  const u = await saved();
  const m = u.events.find(x => x.name === 'WrestleMania').matches[0];
  const rec = n => wrestlerRecord(u, u.wrestlers.find(w => w.name === n).id).singles;
  return [m.winner, rec('Jey Uso'), rec('Seth Rollins'), rec('Cody Rhodes'), rec('Kenny Omega'),
    await js(`${TEXT}(document.querySelector('.uv-page .uv-mc .uv-mc-d'))`), await mc(0).locator('.uv-chip.kind').textContent()];
}, [1, { w: 1, l: 0, d: 0, nc: 0 }, { w: 0, l: 1, d: 0, nc: 0 }, { w: 0, l: 1, d: 0, nc: 0 }, { w: 1, l: 1, d: 0, nc: 0 },
  'Pinfall · Jey Uso pinned Seth Rollins', 'Fatal 4-way']);
await check('the calendar shows the week at a glance', async () => {
  await page.click('.uv-back');
  return [await nights(), await js(`[...document.querySelectorAll('.uv-gr')].map(r => r.querySelector('.w').textContent + ':'
    + [...r.querySelectorAll('.uv-cell')].map(c => c.className.replace('uv-cell', '').trim() || '-').join(','))`)];
}, [['Mon Raw | Not planned', 'Tue NXT | Not planned', 'Wed Dynamite | Not planned', 'Fri SmackDown | Not planned',
  'Sat WrestleMania | 1 result in'], [':', 'W3:-,-,-,-,complete', 'W2:partial,-,-,-,-', 'W1:-,-,-,-,-']]);

// ================================================================ history
await check('History: every result, newest show first', async () => {
  await page.click('#uvTabs [data-uvtab=history]');
  return [await js(`document.querySelector('.uv-count').textContent`), await shows(),
    await js(`[...document.querySelectorAll('#uvBody .uv-hms')].map(h => [...h.querySelectorAll('.uv-hm .l')].map(l => l.textContent.trim()))`)];
}, ['4 results on 2 shows', ['WrestleMania', 'Raw · Week 2'],
  [['Jey Uso def. Seth Rollins, Cody Rhodes, Kenny Omega'],
    ['The Elite Two def. Jey Uso & Seth Rollins', 'Iyo Sky vs Rhea Ripley vs Roxanne Perez — No contest', 'Kenny Omega def. Will Ospreay']]]);
await check('History: filter by show', async () => {
  const pick = async k => { await body.locator('.uv-pill', { hasText: k }).click(); return shows(); };
  const r = [await pick('Raw'), await pick('PLEs'), await pick('Dynamite'), await js(`document.querySelector('#uvBody .uv-empty .t').textContent`)];
  await pick('All shows');
  return r;
}, [['Raw · Week 2'], ['WrestleMania'], [], 'No results yet']);
await check('History: everything on one timeline', async () => {
  await body.locator('.uv-seg-page div', { hasText: 'Everything' }).click();
  const lines = await js(`[...document.querySelectorAll('#uvBody .uv-tl')].map(e => ${TEXT}(e))`);
  await body.locator('.uv-seg-page div', { hasText: 'Results' }).click();
  return [...lines.slice(0, 2), lines.find(l => /Raw · Week 2/.test(l))];
}, ['S1 · W3 WrestleMania Sat 24 Jan 2026 — 1 result', 'S1 · W3 Mercedes Moné joined The Elite Two',
  'S1 · W2 Raw · Week 2 Tue 13 Jan 2026 — 3 results, 1 still to enter']);

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
  await openShow('Raw · Week 2', 2);
  await btn(body, 'Book a match').click();
  await settle();
  await side(0).locator('select[data-w="0"]').selectOption({ label: 'Kenny Omgea' });
  await side(1).locator('select[data-w="0"]').selectOption({ label: 'Giulia' });
  await btn(sheet, 'Add, and enter its result').click();
  await settle();
  await page.selectOption('#uvMResult', { label: 'Kenny Omgea won' });
  await btn(sheet, 'Save the result').click();
  await settle();
  await openRow('Kenny Omega', 'roster');
  await fixRow('Merge a duplicate').click();
  await settle();
  await page.selectOption('#uvMergePick', { label: 'Kenny Omgea' });
  await btn(sheet, /^\s*Merge into/).click();
  await settle();
  await confirmYes();
  const u = await saved();
  return [!!u.wrestlers.find(w => w.name === 'Kenny Omgea'), (await recs())[0], validate(u)];
}, [false, 'Singles 2–1–0', []]);
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
  await page.click('#uvTabs [data-uvtab=calendar]');
  await body.locator('.uv-card-f span', { hasText: 'Start Season 2' }).click();
  await settle();
  await confirmYes();
  const u = await saved();
  return [u.seasons.map(s => `${s.name}:${s.status}:${s.week}`), await js(`document.getElementById('uvClock').textContent`)];
}, [['Season 1:complete:3', 'Season 2:active:1'], 'Season 2 · Week 1']);
await check('the calendar moves on to the new season', async () => [await nights(), await js(`document.querySelector('.uv-weeknav .s').textContent`)],
  [['Mon Raw | Not planned', 'Tue NXT | Not planned', 'Wed Dynamite | Not planned', 'Fri SmackDown | Not planned'], 'This week']);
await check('a past season’s results are still browsable', async () => {
  await page.click('#uvTabs [data-uvtab=history]');
  const now = await js(`document.querySelector('#uvBody .uv-empty .t').textContent`);
  await body.locator('.uv-pill', { hasText: 'Season 1' }).click();
  return [now, await shows()];
}, ['No results yet', ['WrestleMania', 'Raw · Week 2']]);
await check('timeline, newest first, season by season', async () => {
  await body.locator('.uv-seg-page div', { hasText: 'Everything' }).click();
  const tl = () => js(`[...document.querySelectorAll('#uvBody .uv-tl')].map(e => [...e.children].map(c => c.textContent.trim()).join(' '))`);
  const s1 = await tl();
  await body.locator('.uv-pill', { hasText: 'Season 2' }).click();
  const s2 = await tl();
  await body.locator('.uv-seg-page div', { hasText: 'Results' }).click();
  return [s1[0], s2];
}, r => /^S1 · W3 Season 1 ended after 3 weeks/.test(r[0]) && r[1].length === 1 && /^S2 · W1 Season 2 began/.test(r[1][0]));
await check('saved universe is still sound', sound, []);

// ================================================================ persistence
const before = await saved();
await check('fantasy + Markets storage untouched', () => js(`[localStorage.getItem('cbd_team_v1'), localStorage.getItem('arc_markets_v1')]`),
  fantasyBefore);
await check('everything survives a reload', async () => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  return [JSON.stringify(await saved()) === JSON.stringify(before),
    await js(`document.getElementById('uvClock').textContent`),
    await js(`document.querySelector('.uv-tab.on').textContent`), (await nights()).length];
}, [true, 'Season 2 · Week 1', 'Calendar', 4]);

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
}, ['wwe-universe-season2-week1.json', true, M.SCHEMA_VERSION]);
await check('start a new universe (confirmed)', async () => {
  await sheet.getByText('Start a new universe').click();
  await settle();
  await confirmYes();
  const u = await saved();
  return [u.wrestlers.length, u.seasons.length, u.events.length, (await nights()).map(n => n.split(' | ')[1])];
}, [0, 1, 0, ['Not planned', 'Not planned', 'Not planned', 'Not planned']]);
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
}, [M.SCHEMA_VERSION, [], ['Singles 1–0–0', 'Tag 0–1–0', 'Title reigns 1']]);
await check('a v2 save (last stage) imports: every result kept, every show on its night', async () => {
  await noSheet();
  await page.click('#uvDataBtn');
  await settle();
  await page.setInputFiles('#uvImport', join(process.cwd(), 'tools/fixtures/universe-v2.json'));
  await page.waitForTimeout(200);
  await confirmYes();
  const u = await saved();
  await closeSheet();
  await openRow('Rhea Ripley', 'roster');
  const rhea = (await recs())[0];
  await page.click('#uvTabs [data-uvtab=history]');
  await body.locator('.uv-pill', { hasText: 'Season 1' }).click();
  return [u.version, validate(u), u.events.every(e => e.matches.every(m => m.status === 'played')), rhea, (await shows()).length > 0];
}, [M.SCHEMA_VERSION, [], true, 'Singles 2–0–0', true]);
await check('layout anchored after all that', async () => { await noSheet(); return anchored(); }, isAnchored);

// ================================================================ rankings and booking balance
// A known universe, imported the way the owner would. Season 1: E and C meet
// twice. Season 2, weeks 1-4 on Raw: A 4 matches, B 4, C 3, D 4, F 1, E 0; J
// arrives in week 3, K in week 4, L is injured; the women G 1, H 1, I 0. A
// holds the World Heavyweight Championship.
function rankingsWorld() {
  const st = M.createUniverse();
  const add = (n, show, gender = 'male') => M.addWrestler(st, { name: n, showId: show, gender });
  const [A, B, C, D, E, F] = ['A', 'B', 'C', 'D', 'E', 'F'].map(n => add(n, 'raw'));
  const J = add('J', 'smackdown'), K = add('K', 'nxt'), L = add('L', 'raw');
  const [G, H] = ['G', 'H', 'I'].map(n => add(n, 'raw', 'female'));
  M.updateWrestler(st, L.id, { status: 'injured' });
  const whc = M.addTitle(st, { name: 'World Heavyweight Championship', showId: 'raw' });
  const old = M.addEvent(st, { showId: 'raw' });
  M.recordMatch(st, old.id, { sides: [{ wrestlers: [E.id] }, { wrestlers: [C.id] }], winner: 0 });
  M.recordMatch(st, old.id, { sides: [{ wrestlers: [E.id] }, { wrestlers: [C.id] }], winner: 1 });
  M.startNextSeason(st);
  M.setChampion(st, whc.id, { type: 'wrestler', id: A.id });
  const weeks = { 1: [[A, B], [C, D]], 2: [[A, B], [C, D], [G, H]], 3: [[A, D], [B, F]], 4: [[A, D], [B, C]] };
  for (let wk = 1; wk <= 4; wk++) {
    M.setWeek(st, wk);
    if (wk === 3) M.assignWrestler(st, J.id, 'raw');
    if (wk === 4) M.assignWrestler(st, K.id, 'raw');
    const ev = M.addEvent(st, { showId: 'raw' });
    weeks[wk].forEach(([x, y]) => M.recordMatch(st, ev.id, { sides: [{ wrestlers: [x.id] }, { wrestlers: [y.id] }], winner: 0 }));
  }
  return st;
}
const rkRows = sel => js(`[...document.querySelectorAll('${sel} .uv-st:not(.hd)')].map(r => [r.querySelector('.rk').textContent,
  r.querySelector('.nm').textContent.trim(), r.querySelector('.rec b').textContent, r.querySelector('.pc').textContent])`);
await check('Rankings: import a known universe', async () => {
  await noSheet();
  const file = join(dir, 'rankings.json');
  await writeFile(file, JSON.stringify(rankingsWorld()));
  await page.click('#uvDataBtn');
  await settle();
  await page.setInputFiles('#uvImport', file);
  await page.waitForTimeout(200);
  await confirmYes();
  await closeSheet();
  await page.click('#uvTabs [data-uvtab=rankings]');
  return [await js(`document.querySelector('.uv-tab.on').textContent`), await js(`document.querySelector('.uv-rk-head b').textContent`)];
}, ['Rankings', 'Raw · Season 2']);
await check('standings: each division ranked as the model ranks it', async () => {
  const u = await saved();
  const want = SD.rankRows(SD.standings(u, { showId: 'raw', period: SD.periodOf(u, u.seasons[1].id) }).ranked
    .concat(SD.standings(u, { showId: 'raw', period: SD.periodOf(u, u.seasons[1].id) }).unranked).filter(r => r.gender === 'male'))
    .ranked.map(r => [String(r.rank), r.name, `${r.rec.w}–${r.rec.l}–${r.rec.d}`, `${Math.round(r.score * 100)}%`]);
  const got = await rkRows('#uvBody .uv-sts');
  return [JSON.stringify(got.slice(0, want.length)) === JSON.stringify(want), got.slice(0, 5)];
}, [true, [['1', 'A', '4–0–0', '83%'], ['2', 'C', '2–1–0', '60%'], ['3', 'B', '2–2–0', '50%'], ['4', 'F', '0–1–0', '33%'], ['5', 'D', '0–4–0', '17%']]]);
await check('standings: the champion is marked; the unranked are listed', async () => [
  await js(`!!document.querySelector('#uvBody .uv-st[data-id] .uv-belt')`),
  await js(`document.querySelector('#uvBody .uv-unr').textContent.replace(/\\s+/g, ' ').trim()`)],
  [true, 'Not ranked yet — no wins, losses or draws: E, J, K, L']);
await check('season and all-time records are kept apart', async () => {
  await body.locator('.uv-pill', { hasText: 'Season 1' }).click();
  const s1 = await rkRows('#uvBody .uv-sts');
  await body.locator('.uv-pill', { hasText: 'All time' }).click();
  const all = await rkRows('#uvBody .uv-sts');
  const row = (rows, n) => (rows.find(r => r[1] === n) || []).slice(2).join(' ');
  return [row(s1, 'C'), row(s1, 'E'), row(all, 'C'), row(all, 'E')];
}, ['1–1–0 50%', '1–1–0 50%', '3–2–0 57%', '1–1–0 50%']);
await check('How rankings work explains the score', async () => {
  await body.locator('.uv-rk-head .uv-link').click();
  await settle();
  const t = await js(`document.getElementById('uvSheetBody').textContent.replace(/\\s+/g, ' ')`);
  await closeSheet();
  return [/\(5 \+ 1\) ÷ \(5 \+ 2\) = 86%/.test(t), /never limit|never decide/.test(t)];
}, [true, true]);
await check('booking balance: who is short of matches, and why', async () => {
  await body.locator('.uv-seg-page div', { hasText: 'Booking balance' }).click();
  const cards = await js(`[...document.querySelectorAll('#uvBody .uv-short')].map(c => c.querySelector('.nm').textContent
    + ' | ' + c.querySelector('.uv-chip').textContent + ' | ' + c.querySelector('.s').textContent.replace(/\\s+/g, ' ').trim())`);
  return [await js(`document.querySelector('.uv-rk-head b').textContent`), await js(`${TEXT}(document.querySelector('.uv-bal-sum'))`), cards];
}, ['Raw · weeks 1–4 of Season 2', 'Men’s division typically 0.8 a week Women’s division typically 0.3 a week',
  ['E | Well below | 0 matches in 4 weeks on Raw — typical for the men’s division would be about 3. No matches in this period.',
    'F | Below | 1 match in 4 weeks on Raw — typical for the men’s division would be about 3. Last match: Raw · Week 3.']]);
await check('newcomers and the injured aren’t judged', async () => {
  const sub = n => js(`[...document.querySelectorAll('#uvBody .uv-bl')].find(r => r.querySelector('.nm') && r.querySelector('.nm').textContent === '${n}').querySelector('.sub').textContent`);
  return [await sub('K'), await sub('L'), await sub('J')];
}, ['Here 1 week — not judged yet', 'Injured — not counted', '0 matches in 2 weeks']);
await check('match ideas come with their reasons', () => js(`[...document.querySelectorAll('#uvBody .uv-short')][0].querySelectorAll('.uv-idea')`
  + `.length && [...[...document.querySelectorAll('#uvBody .uv-short')][0].querySelectorAll('.uv-idea')].map(i => i.querySelector('.vs b').textContent + ': ' + i.querySelector('.why').textContent)`),
  ['F: Both are short of matches · Fresh matchup: they’ve never met', 'C: Rivalry: met 2 times — E 1, C 1 · A shot at #2 C',
    'A: Fresh matchup: they’ve never met · A shot at #1 A · A holds the World Heavyweight Championship']);
await check('an idea opens the booking form filled in; nothing is booked until you add it', async () => {
  const before = (await saved()).events.flatMap(e => e.matches).length;
  await body.locator('.uv-short').first().locator('.uv-idea').first().locator('.uv-btn').click();
  await settle();
  const where = await js(`[...document.querySelectorAll('#uvSheetBody .uv-row .nm')].map(e => e.textContent)`);
  await sheet.locator('.uv-row', { hasText: 'Raw · Week 4' }).click();
  await settle();
  const form = [await js(`document.getElementById('uvSheetTitle').textContent`),
    await side(0).locator('select[data-w="0"]').evaluate(s => s.options[s.selectedIndex].text),
    await side(1).locator('select[data-w="0"]').evaluate(s => s.options[s.selectedIndex].text)];
  const untouched = (await saved()).events.flatMap(e => e.matches).length === before;
  await btn(sheet, 'Add to the card').click();
  await settle();
  const u = await saved();
  const m = u.events.find(e => e.name === 'Raw · Week 4').matches.find(x => x.status === 'scheduled');
  const name = id => u.wrestlers.find(w => w.id === id).name;
  return [where, form, untouched, m && m.sides.map(sd => name(sd.wrestlers[0])), m && m.outcome,
    await js(`[...document.querySelectorAll('#uvBody .uv-short')][0].textContent.includes('Already booked: Raw · Week 4')`)];
}, [['Raw · Week 4', 'Plan Raw · Week 5', 'Plan Raw · Week 6'], ['Book a match', 'E', 'F'], true, ['E', 'F'], null, true]);
await check('How booking balance works spells out the rule', async () => {
  await body.locator('.uv-rk-head .uv-link').click();
  await settle();
  const t = await js(`document.getElementById('uvSheetBody').textContent.replace(/\\s+/g, ' ')`);
  await closeSheet();
  return [/at most half the typical rate/.test(t), /at least 2 matches below/.test(t), /median/.test(t), /how big each show’s roster is/.test(t)];
}, [true, true, true, true]);
await check('the bottom of the standings can be booked for the world title, and win it', async () => {
  await openShow('Raw · Week 4');
  await btn(body, 'Book a match').click();
  await settle();
  await side(0).locator('select[data-w="0"]').selectOption({ label: 'D' });           // 0-4, ranked last
  await side(1).locator('select[data-w="0"]').selectOption({ label: 'A' });           // 4-0, the champion
  const titles = await js(`[...document.querySelectorAll('#uvMTitle option')].map(o => o.textContent)`);
  await page.selectOption('#uvMTitle', { label: 'World Heavyweight Championship' });
  await btn(sheet, 'Add, and enter its result').click();
  await settle();
  await page.selectOption('#uvMResult', { label: 'D won' });
  await page.check('#uvMTitleChange');
  await btn(sheet, 'Save the result').click();
  await settle();
  const u = await saved();
  const cur = u.reigns.find(r => r.end === null);
  return [titles, u.wrestlers.find(w => w.id === cur.holder.id).name, (await toast()).t];
}, [['None', 'World Heavyweight Championship'], 'D', 'Result saved — D holds the World Heavyweight Championship']);
await check('saved universe is sound after all that', sound, []);

// ================================================================ season transition: relegation
// Season 1, week 4. Wins before WrestleMania (Saturday, week 4), all against N1:
//   Raw        R1 0 (one loss), R2 1, R3 1, R4 2, R5 2 (+1 at WrestleMania), R6 4
//   SmackDown  S1 0, S2 0 (a loss each), S3 1, S4 2, S5 5
//   Dynamite   D1 1, D2 1, D3 1
function relegationWorld() {
  const st = M.createUniverse();
  const add = (n, show) => M.addWrestler(st, { name: n, showId: show });
  const rw = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'].map(n => add(n, 'raw'));
  const sw = ['S1', 'S2', 'S3', 'S4', 'S5'].map(n => add(n, 'smackdown'));
  const dw = ['D1', 'D2', 'D3'].map(n => add(n, 'dynamite'));
  const n1 = add('N1', 'nxt');
  const one = (x, y, winner) => ({ sides: [{ wrestlers: [x.id] }, { wrestlers: [y.id] }], winner });
  M.setWeek(st, 2);
  const house = M.addEvent(st, { showId: 'nxt' });
  [[rw[1], 1], [rw[2], 1], [rw[3], 2], [rw[4], 2], [rw[5], 4], [sw[2], 1], [sw[3], 2], [sw[4], 5], [dw[0], 1], [dw[1], 1], [dw[2], 1]]
    .forEach(([w, n]) => { for (let i = 0; i < n; i++) M.recordMatch(st, house.id, one(w, n1, 0)); });
  [rw[0], sw[0], sw[1]].forEach(w => M.recordMatch(st, house.id, one(w, n1, 1)));
  M.setWeek(st, 4);
  const wm = M.addEvent(st, { kind: 'ple', name: 'WrestleMania', week: 4 });
  M.recordMatch(st, wm.id, one(rw[4], n1, 0));
  return st;
}
const trRows = sid => js(`[...document.querySelectorAll('.uv-trshow[data-show=${sid}] .uv-tw[data-w]')].map(r =>
  r.querySelector('.nm').childNodes[0].textContent.trim() + ':' + r.querySelector('.w b').textContent + (r.classList.contains('on') ? '*' : '') + (r.classList.contains('tied') ? '~' : ''))`);
const trFlags = sid => js(`[...document.querySelectorAll('.uv-trshow[data-show=${sid}] .uv-flag')].map(${TEXT})`);
const trShow = sid => page.locator(`.uv-trshow[data-show=${sid}]`);
await check('relegation: WrestleMania on the calendar leads to the season transition', async () => {
  await noSheet();
  const file = join(dir, 'relegation.json');
  await writeFile(file, JSON.stringify(relegationWorld()));
  await page.click('#uvDataBtn');
  await settle();
  await page.setInputFiles('#uvImport', file);
  await page.waitForTimeout(200);
  await confirmYes();
  await closeSheet();
  await page.click('#uvTabs [data-uvtab=calendar]');
  const row = await js(`document.querySelector('.uv-card-row').textContent.replace(/\\s+/g, ' ').trim()`);
  await page.click('.uv-card-row');
  await page.waitForTimeout(150);
  return [row, await pageKind(), (await saved()).transitions.length,
    await js(`[...document.querySelectorAll('.uv-trsum span')].map(e => e.textContent.replace(/\\s+/g, ' ').trim())`)];
}, ['WrestleMania ends the season Start the season transition: relegation to NXT', 'transition', 1,
  ['Raw: 1 decision for you', 'SmackDown: ready to book', 'Dynamite: 1 decision for you']]);
await check('the season win totals behind the candidates, fewest first', async () => [await trRows('raw'), await trRows('smackdown')],
  [['R1:0*', 'R2:1~', 'R3:1~', 'R4:2', 'R5:3', 'R6:4'], ['S1:0*', 'S2:0*', 'S3:1', 'S4:2', 'S5:5']]);
await check('a tie at the cutoff waits for you, and so does booking', async () => [await trFlags('raw'),
  await trShow('raw').locator('.uv-btn.full').textContent()],
  [['Your decision R2 and R3 are tied on 1 win for the last candidate spot. Pick who\'s a candidate, or change the number.'],
    'Settle the decisions above to book']);
await check('you settle it: pick R3, and R1 v R3 is the pairing', async () => {
  await trShow('raw').locator('.uv-tw[data-w]', { hasText: 'R3' }).click();
  await page.waitForTimeout(150);
  return [await trRows('raw'), await trFlags('raw'), await js(`document.querySelector('.uv-trshow[data-show=raw] .uv-pair .vs').textContent.replace(/\\s+/g, ' ').trim()`)];
}, [['R1:0*', 'R2:1', 'R3:1*', 'R4:2', 'R5:3', 'R6:4'], ['Picked by you — added R3.'], 'R1 (0) vs R3 (1)']);
await check('an odd number is flagged, not settled for you', async () => {
  await trShow('smackdown').locator('.uv-trcount .uv-ic').nth(1).click();          // three candidates
  await page.waitForTimeout(150);
  const flags = await trFlags('smackdown');
  await trShow('smackdown').locator('.uv-trcount .uv-ic').nth(0).click();          // back to two
  await page.waitForTimeout(150);
  return [flags, await trFlags('smackdown')];
}, [['Your decision An odd number of candidates (3): S3 has no opponent. Add or take out a candidate, or change the pairings.'], []]);
await check('each show sets its own number: none for Dynamite this year', async () => {
  for (let i = 0; i < 2; i++) { await trShow('dynamite').locator('.uv-trcount .uv-ic').nth(0).click(); await page.waitForTimeout(120); }
  return [(await saved()).transitions[0].shows.dynamite.count, await trFlags('dynamite'),
    await js(`[...document.querySelectorAll('.uv-trsum span')].map(e => e.textContent.replace(/\\s+/g, ' ').trim())`)];
}, [0, [], ['Raw: ready to book', 'SmackDown: ready to book', 'Dynamite: no relegation this year']]);
await check('plan Raw’s first show after WrestleMania, and book the match there', async () => {
  await trShow('raw').locator('.uv-btn', { hasText: 'Plan it' }).click();
  await page.waitForTimeout(150);
  const night = await js(`document.querySelector('.uv-trshow[data-show=raw] .uv-trnight b').textContent`);
  await trShow('raw').locator('.uv-btn.pri').click();
  await page.waitForTimeout(150);
  const u = await saved();
  const ev = u.events.find(e => e.name === 'Raw · Week 5');
  const m = ev.matches[0];
  return [night, ev.at.day, m.status, m.stip, !!m.relegation, (await toast()).t,
    await js(`document.querySelector('.uv-trshow[data-show=raw] .uv-pst').textContent`)];
}, ['Raw · Week 5', 0, 'scheduled', 'Relegation match', true, '1 relegation match booked on Raw · Week 5', 'Booked — waiting for the result']);
await check('the relegation match on the card; its result form keeps the pairing', async () => {
  await trShow('raw').locator('.uv-trnight').click();
  await page.waitForTimeout(150);
  const chips = await js(`[...document.querySelectorAll('.uv-page .uv-mc .uv-chip')].map(c => c.textContent)`);
  await btn(mc(0), 'Enter result').click();
  await settle();
  return [chips, await js(`/loser moves to NXT as soon as you save/.test(document.getElementById('uvSheetBody').textContent)`),
    await js(`!!document.querySelector('#uvSheetBody .uv-add')`), await js(`document.getElementById('uvMResult').value`)];
}, [['Singles', 'Relegation'], true, false, '']);
await check('the loser moves to NXT the moment the result is saved', async () => {
  await page.selectOption('#uvMResult', { label: 'R3 won' });
  await btn(sheet, 'Save the result').click();
  await settle();
  const u = await saved();
  const w = n => u.wrestlers.find(x => x.name === n);
  const rec = u.relegations[0];
  return [(await toast()).t, w('R1').showId, w('R3').showId, rec && rec.show, rec && rec.reason,
    await js(`[...document.querySelectorAll('.uv-page .uv-mc-d')].map(e => e.textContent.trim()).includes('R1 relegated to NXT')`)];
}, ['Result saved — R1 relegated to NXT', 'nxt', 'raw', 'raw',
  'Lost the Raw relegation match to R3 at Raw · Week 5 (Season 1). A relegation candidate for the fewest wins: 0 wins in Season 1 up to WrestleMania — 1st fewest of 6 on Raw.',
  true]);
await check('a corrected result swaps who goes down', async () => {
  await btn(mc(0), 'Correct').click();
  await settle();
  await page.selectOption('#uvMResult', { label: 'R1 won' });
  await btn(sheet, 'Save the correction').click();
  await settle();
  const u = await saved();
  const w = n => u.wrestlers.find(x => x.name === n);
  return [(await toast()).t, w('R1').showId, w('R3').showId, u.relegations.map(r => u.wrestlers.find(x => x.id === r.wrestler).name), await sound()];
}, ['Result corrected — R3 relegated to NXT', 'raw', 'nxt', ['R3'], []]);
await check('the record stays on the wrestler’s page, and on the transition', async () => {
  await openRow('R3', 'roster');
  const prof = await js(`${TEXT}(document.querySelector('.uv-page .uv-relrec'))`);
  await body.locator('.uv-page .uv-relrec').click();
  await page.waitForTimeout(150);
  return [prof, await pageKind(), await js(`document.querySelector('.uv-trshow[data-show=raw] .uv-relrec b').textContent`)];
}, r => /^Raw → NXT · S1 · W5 Lost the Raw relegation match to R1 at Raw · Week 5 \(Season 1\)\. Picked as a candidate by the owner, with 1 win in Season 1 up to WrestleMania \(joint 2nd fewest of 6 on Raw\)\.$/.test(r[0])
  && r[1] === 'transition' && r[2] === 'R3 → NXT');
await check('How relegation works explains the rule and what waits for you', async () => {
  await body.locator('.uv-link', { hasText: 'How relegation works' }).click();
  await settle();
  const t = await js(`document.getElementById('uvSheetBody').textContent.replace(/\\s+/g, ' ')`);
  await closeSheet();
  return [/fewest/.test(t), /Tie/.test(t) && /Odd/.test(t) && /Missing/.test(t) && /Draw/.test(t), /whatever their roster sizes/.test(t), /never does/.test(t)];
}, [true, true, true, true]);
await check('WrestleMania’s page links to its transition', async () => {
  await openShow('WrestleMania', 4);
  return js(`document.querySelector('.uv-trlink b').textContent`);
}, 'Season transition');
await check('saved universe is sound after relegation', sound, []);

// ================================================================ wider screens
await check('on a laptop it’s a centred column', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(150);
  return js(`(() => { const r = document.querySelector('.uv-app').getBoundingClientRect();
    return [r.width | 0, Math.round(r.left), r.height | 0]; })()`);
}, [560, 360, 900]);
await check('layout anchored at laptop width', anchored, isAnchored);

// ================================================================ published on claude.ai
// Published as an artifact, the page gets window.claude. A stand-in with the
// same shape keeps the database here in the script, so two separate browsers
// (each with its own empty storage) share it the way two devices would.
const cloudDocs = new Map(), cloudSaves = [];
async function artifactBrowser() {
  const ctx = await browser.newContext({ viewport: { width: 436, height: 920 } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(4000);
  p.on('pageerror', e => errors.push('artifact pageerror: ' + String(e).split('\n')[0]));
  await p.exposeFunction('__cloud', (op, path, data) => {
    if (op === 'get') return cloudDocs.has(path) ? cloudDocs.get(path) : null;
    if (op === 'set') cloudDocs.set(path, data);
    if (op === 'delete') cloudDocs.delete(path);
    if (op === 'download') cloudSaves.push({ filename: path, data });
    return null;
  });
  await p.addInitScript(() => {
    const call = (...a) => window.__cloud(...a);
    const snap = (path, v) => ({ id: path.split('/').pop(), exists: v != null, data: () => v, metadata: { fromCache: false, hasPendingWrites: false } });
    const doc = path => ({ path, get: async () => snap(path, await call('get', path)), set: async d => { await call('set', path, d); },
      delete: async () => { await call('delete', path); }, acquire: async () => ({ acquired: true }), onSnapshot: () => () => {} });
    const ns = { db: { doc, collection: c => ({ path: c, doc: id => doc(`${c}/${id}`) }) }, user: { id: async () => 'viewer-1' },
      downloads: { save: async r => { await call('download', r.filename, r.data); return { status: 'saved' }; } } };
    window.claude = { use: async n => ns[n] || null };
  });
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(600);
  return { ctx, p };
}
const cloudUniverse = () => {
  const m = cloudDocs.get('data/users/viewer-1/save');
  return m && JSON.parse(Array.from({ length: m.parts[m.slot] }, (_, i) => cloudDocs.get(`data/users/viewer-1/${m.slot}-${i}`).s).join(''));
};
const one = await artifactBrowser();
await check('as an artifact, a change is saved to the claude.ai account', async () => {
  const { p } = one;
  await p.locator('#uvBody .uv-btn', { hasText: /^\s*Add\s*$/ }).click();
  await p.waitForTimeout(380);
  await p.keyboard.type('Cody Rhodes');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(1300);                                        // changes go up after a short pause
  await p.click('.uv-scrim', { position: { x: 200, y: 60 } });
  await p.waitForTimeout(380);
  await p.click('#uvDataBtn');
  await p.waitForTimeout(380);
  const u = cloudUniverse();
  return [u && u.wrestlers.map(w => w.name), await p.evaluate(`document.querySelector('#uvSheetBody .uv-note').textContent`)];
}, [['Cody Rhodes'], 'Saved to your claude.ai account after every change, so it’s the same on any device you open this page on.']);
await check('Export goes through claude.ai’s save prompt', async () => {
  await one.p.locator('#uvSheetBody .uv-btn', { hasText: 'Export' }).click();
  await one.p.waitForTimeout(300);
  const f = cloudSaves[0];
  return [cloudSaves.length, f && f.filename, f && JSON.parse(f.data).wrestlers.length,
    await one.p.evaluate(`document.getElementById('uvHint').textContent`)];
}, [1, 'wwe-universe-season1-week1.json', 1, 'Save file downloaded']);
const two = await artifactBrowser();
await check('another browser opens the same universe from the account', () =>
  two.p.evaluate(`[...document.querySelectorAll('#uvBody .uv-row .nm')].map(e => e.textContent)`), ['Cody Rhodes']);
await check('the published build has no document wrapper, its title first', async () => {
  const art = await readFile(join(process.cwd(), 'dist/universe-artifact.html'), 'utf8');
  return [art.slice(0, 32), /<!doctype|<html|<head>|<body>/i.test(art.replace(/\/\*[\s\S]*?\*\//g, ''))];
}, ['<title>WWE 2K25 Universe</title>', false]);
await one.ctx.close();
await two.ctx.close();

await browser.close();
console.log(`\n${pass} passed, ${fail} failed, ${errors.length} page errors`);
if (errors.length) console.log(errors.join('\n'));
process.exit(fail || errors.length ? 1 : 0);
