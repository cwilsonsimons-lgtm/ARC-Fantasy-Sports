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
import * as RL from '../js/universe/relations.js';
import * as DR from '../js/universe/director.js';
import { incidentText } from '../js/universe/ui.js';
import { bookingSample, sampleCycle } from './universe-sample.mjs';
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
// the story director rolls a random seed the first time it runs, so the sections that
// aren't about it run with it off; the story section brings its own seeded universe
await js(`uvStoryOn('off')`);
await page.waitForTimeout(100);

// ================================================================ open
await check('opens straight into the app', () => js(`[document.title, document.querySelector('.uv-tab.on').textContent]`),
  ['Universe — WWE 2K25 companion', 'Roster']);
await check('nothing of the fantasy app on the page', () => js(`[
  !!document.querySelector('.phone, .nav, .shift, .drawer, #hint, .mk'),
  ['showTab', 'openMarkets', 'renderWeek', 'LG'].filter(n => n in window)]`), [false, []]);
await check('starts empty, five shows + All + Unassigned', () => js(`[
  document.querySelectorAll('#uvBody .uv-row').length,
  [...document.querySelectorAll('#uvBody .uv-pill')].map(p => p.textContent.trim())]`),
  r => r[0] === 0 && r[1].join('|') === 'All0|Raw0|SmackDown0|Dynamite0|NXT0|Evolve0|Unassigned0');
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
}, [11, 2, 2, 3, 4, 0, 0]);
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
  [['Singles', 'Tag', 'Title reigns'], ['Story', 'Personality', 'Relationships', 'Championships', 'Tag teams & partners', 'Career history', 'Results']]);
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
  js(`[...document.querySelectorAll('#uvBody .uv-pill .n')].map(e => +e.textContent)`), [11, 4, 0, 3, 4, 0, 0]);

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
  ['Mon Raw | Not planned', 'Tue NXT | Not planned', 'Wed Dynamite | Not planned', 'Wed Evolve | Not planned', 'Fri SmackDown | Not planned']]);
await check('pin the season to real dates', async () => {
  await body.locator('.uv-card-f span', { hasText: 'Set dates' }).click();
  await settle();
  await page.fill('#uvSeasonStart', '2026-01-07');                   // a Wednesday: week 1 is 5–11 Jan
  await btn(sheet, 'Save').click();
  await settle();
  return [(await saved()).seasons[0].start, await js(`document.querySelector('.uv-weeknav .s').textContent`),
    await js(`[...document.querySelectorAll('#uvBody .uv-night .dt span')].map(e => e.textContent)`)];
}, ['2026-01-07', 'This week · 19 Jan – 25 Jan 2026', ['19 Jan', '20 Jan', '21 Jan', '21 Jan', '23 Jan']]);
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
  true, '3/0', 'Result saved — Cody Rhodes holds the World Heavyweight Championship. Gunther holds a grudge against Cody Rhodes (+1 more)'])
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
}, [['Mon Raw | Not planned', 'Tue NXT | Not planned', 'Wed Dynamite | Not planned', 'Wed Evolve | Not planned', 'Fri SmackDown | Not planned',
  'Sat WrestleMania | 1 result in'], [':', 'W3:-,-,-,-,-,complete', 'W2:partial,-,-,-,-,-', 'W1:-,-,-,-,-,-']]);

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
  [['Mon Raw | Not planned', 'Tue NXT | Not planned', 'Wed Dynamite | Not planned', 'Wed Evolve | Not planned', 'Fri SmackDown | Not planned'], 'This week']);
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
}, [true, 'Season 2 · Week 1', 'Calendar', 5]);

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
}, [0, 1, 0, ['Not planned', 'Not planned', 'Not planned', 'Not planned', 'Not planned']]);
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
  M.setStory(st, { on: false });                         // the standings are under test here, not the story
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
}, [['None', 'World Heavyweight Championship'], 'D', 'Result saved — D holds the World Heavyweight Championship. A holds a grudge against D (+1 more)']);
await check('saved universe is sound after all that', sound, []);

// ================================================================ season transition: relegation
// Season 1, week 4. Wins before WrestleMania (Saturday, week 4), all against N1:
//   Raw        R1 0 (one loss), R2 1, R3 1, R4 2, R5 2 (+1 at WrestleMania), R6 4
//   SmackDown  S1 0, S2 0 (a loss each), S3 1, S4 2, S5 5
//   Dynamite   D1 1, D2 1, D3 1
function relegationWorld() {
  const st = M.createUniverse();
  M.setStory(st, { on: false });
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
}, ['WrestleMania ends the season Start the season transition: relegation, promotion and the draft', 'transition', 1,
  ['Raw: 1 decision for you', 'SmackDown: ready to book', 'Dynamite: 1 decision for you',
    'NXT: 0 champions eligible; no qualifiers picked', 'Transfer window: not open — 0 eligible']]);
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
}, [0, [], ['Raw: ready to book', 'SmackDown: ready to book', 'Dynamite: no relegation this year',
  'NXT: 0 champions eligible; no qualifiers picked', 'Transfer window: not open — 0 eligible']]);
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

// ================================================================ a complete post-WrestleMania cycle
// The relegation world, plus NXT before WrestleMania: prospects NA (3 wins),
// NB (2), NC (2), ND (1); NChamp holds the NXT Championship; Prospects (NT1 &
// NT2) hold the NXT Tag Team Championship.
function cycleWorld() {
  const st = relegationWorld();
  M.setWeek(st, 2);
  const [NA, NB, NC, ND, NChamp, NT1, NT2] = ['NA', 'NB', 'NC', 'ND', 'NChamp', 'NT1', 'NT2'].map(n => M.addWrestler(st, { name: n, showId: 'nxt' }));
  const n1 = st.wrestlers.find(w => w.name === 'N1');
  const house = st.events.find(e => e.showId === 'nxt');
  [[NA, 3], [NB, 2], [NC, 2], [ND, 1]].forEach(([w, n]) => {
    for (let i = 0; i < n; i++) M.recordMatch(st, house.id, { sides: [{ wrestlers: [w.id] }, { wrestlers: [n1.id] }], winner: 0 });
  });
  const title = M.addTitle(st, { name: 'NXT Championship', showId: 'nxt' });
  const tag = M.addTitle(st, { name: 'NXT Tag Team Championship', showId: 'nxt', kind: 'tag' });
  const team = M.addTeam(st, { name: 'Prospects', members: [NT1.id, NT2.id] });
  M.setChampion(st, title.id, { type: 'wrestler', id: NChamp.id });
  M.setChampion(st, tag.id, { type: 'team', id: team.id });
  M.setWeek(st, 4);
  M.startTransition(st, st.events.find(e => e.name === 'WrestleMania').id);
  M.setWeek(st, 5);
  return st;
}
const part = async k => { await page.click(`[data-part=${k}]`); await page.waitForTimeout(150); };
const who = n => saved().then(u => u.wrestlers.find(w => w.name === n));
await check('cycle: the transition covers relegation, NXT and the transfer window', async () => {
  await noSheet();
  const file = join(dir, 'cycle.json');
  await writeFile(file, JSON.stringify(cycleWorld()));
  await page.click('#uvDataBtn');
  await settle();
  await page.setInputFiles('#uvImport', file);
  await page.waitForTimeout(200);
  await confirmYes();
  await closeSheet();
  await page.click('#uvTabs [data-uvtab=calendar]');
  await page.click('.uv-card-row');
  await page.waitForTimeout(150);
  return js(`[...document.querySelectorAll('.uv-trsum span')].map(e => e.textContent.replace(/\\s+/g, ' ').trim())`);
}, ['Raw: 1 decision for you', 'SmackDown: ready to book', 'Dynamite: 1 decision for you',
  'NXT: 3 champions eligible; no qualifiers picked', 'Transfer window: not open — 3 eligible']);
await check('cycle 1: Raw relegation — R1 goes down to NXT', async () => {
  await trShow('raw').locator('.uv-tw[data-w]', { hasText: 'R3' }).click();
  await page.waitForTimeout(120);
  await trShow('raw').locator('.uv-btn', { hasText: 'Plan it' }).click();
  await page.waitForTimeout(120);
  await trShow('raw').locator('.uv-btn.pri').click();
  await page.waitForTimeout(150);
  await trShow('raw').locator('.uv-trnight').click();
  await page.waitForTimeout(150);
  await btn(mc(0), 'Enter result').click();
  await settle();
  await page.selectOption('#uvMResult', { label: 'R3 won' });
  await btn(sheet, 'Save the result').click();
  await settle();
  return [(await toast()).t, (await who('R1')).showId];
}, ['Result saved — R1 relegated to NXT', 'nxt']);
await check('cycle 2: NXT’s season records suggest the qualifiers; you pick', async () => {
  await body.locator('.uv-trlink').click();
  await page.waitForTimeout(150);
  await part('promotion');
  const rows = await js(`[...document.querySelectorAll('.uv-trshow .uv-tw[data-w]')].map(r => ${TEXT}(r.querySelector('.nm')))`);
  await body.locator('.uv-trcount .uv-link', { hasText: 'Pick them' }).click();
  await page.waitForTimeout(150);
  const u = await saved();
  return [rows.slice(0, 5), u.transitions[0].parts[0].qualifiers.picked.map(id => u.wrestlers.find(w => w.id === id).name),
    await js(`[...document.querySelectorAll('.uv-pair .vs')].map(v => v.firstElementChild.textContent + ' v ' + (v.querySelector('select') ? v.querySelector('select').selectedOptions[0].textContent : ''))`)];
}, [['1 NA Suggested', '2 NB Suggested', '2 NC Suggested', '4 ND Suggested', '5 N1'], ['NA', 'NB', 'NC', 'ND'], ['NA v NB', 'NC v ND']]);
await check('you can override the suggestions', async () => {
  await body.locator('.uv-trshow .uv-tw[data-w]', { hasText: 'N1' }).click();
  await page.waitForTimeout(120);
  const flag = await js(`[...document.querySelectorAll('.uv-trshow .uv-flag.decide')].map(${TEXT})`);
  await body.locator('.uv-trshow .uv-tw[data-w]', { hasText: 'N1' }).click();
  await page.waitForTimeout(120);
  return [flag, (await saved()).transitions[0].parts[0].qualifiers.picked.length];
}, [['Your decision An odd number in the qualifiers (5): N1 has no opponent. Add or take someone out, or change the pairings.'], 4]);
await check('book the qualifiers on NXT’s first show after WrestleMania', async () => {
  await body.locator('.uv-trnight .uv-btn', { hasText: 'Plan it' }).click();
  await page.waitForTimeout(150);
  await body.locator('.uv-trshow .uv-btn.pri').click();
  await page.waitForTimeout(150);
  const u = await saved();
  const ev = u.events.find(e => e.name === 'NXT · Week 5');
  return [(await toast()).t, ev.matches.map(m => `${m.stip}:${!!m.qualifier}`), ev.at.day];
}, ['2 qualifying matches booked on NXT · Week 5', ['Qualifying match:true', 'Qualifying match:true'], 1]);
await check('a qualifier win makes the winner eligible — and moves nobody', async () => {
  await body.locator('.uv-trnight').first().click();
  await page.waitForTimeout(150);
  await btn(mc(0), 'Enter result').click();
  await settle();
  const note = await js(`/the winner becomes draft eligible when you save — nobody moves/.test(document.getElementById('uvSheetBody').textContent)`);
  await page.selectOption('#uvMResult', { label: 'NA won' });
  await btn(sheet, 'Save the result').click();
  await settle();
  await btn(mc(1), 'Enter result').click();
  await settle();
  await page.selectOption('#uvMResult', 'draw');
  await btn(sheet, 'Save the result').click();
  await settle();
  const u = await saved();
  return [note, (await toast()).t, u.eligibility.map(e => `${u.wrestlers.find(w => w.id === e.wrestler).name}:${e.source}`), (await who('NA')).showId];
}, [true, 'Result saved', ['NA:qualifier'], 'nxt']);
await check('a qualifier without a winner is your decision: send both through', async () => {
  await body.locator('.uv-trlink').click();
  await page.waitForTimeout(150);
  const flag = await js(`[...document.querySelectorAll('.uv-trshow .uv-flag.decide')].map(${TEXT})`);
  await body.locator('.uv-pair .uv-btn', { hasText: 'Decide…' }).click();
  await settle();
  await sheet.locator('.uv-check', { hasText: 'NC goes through' }).locator('input').check();
  await sheet.locator('.uv-check', { hasText: 'ND goes through' }).locator('input').check();
  await page.fill('#uvQDNote', 'Both earned it');
  await sheet.locator('.uv-btn.pri').click();
  await settle();
  const u = await saved();
  return [flag, u.eligibility.filter(e => e.source === 'decision').map(e => `${u.wrestlers.find(w => w.id === e.wrestler).name}:${e.note}`)];
}, [['Your decision NC vs ND ended in a draw. Book a rematch, or decide who (if anyone) qualifies.'], ['NC:Both earned it', 'ND:Both earned it']]);
await check('cycle 3: open the transfer window — the champions are fixed as eligible', async () => {
  await part('window');
  await btn(body, 'Open the transfer window').click();
  await settle();
  await confirmYes();
  const u = await saved();
  return [u.eligibility.filter(e => e.source === 'champion').map(e => u.wrestlers.find(w => w.id === e.wrestler).name),
    await js(`[...document.querySelectorAll('.uv-els .uv-el')].map(r => r.querySelector('.nm').textContent.replace(/\\s+/g, ' ').trim())`),
    await js(`[...document.querySelectorAll('.uv-wtile')].map(t => t.querySelector('b').textContent + ' ' + t.querySelector('.n').textContent)`)];
}, [['NChamp', 'NT1', 'NT2'], ['NA Qualifier', 'NC Your call', 'NChamp Champion', 'ND Your call', 'NT1 Champion', 'NT2 Champion'],
  ['Raw 5', 'SmackDown 5', 'Dynamite 3']]);
await check('draft a champion: the title question waits for you', async () => {
  await body.locator('.uv-el.tap', { hasText: 'NChamp' }).click();
  await settle();
  await sheet.locator('.uv-tile[data-show=raw]').click();
  const before = await sheet.locator('.uv-btn.pri').textContent();
  await sheet.locator('.uv-tq .uv-seg div', { hasText: 'Vacate it' }).click();
  const after = await sheet.locator('.uv-btn.pri').textContent();
  await sheet.locator('.uv-btn.pri').click();
  await settle();
  const u = await saved();
  const title = u.titles.find(t => t.name === 'NXT Championship');
  return [before, after, (await toast()).t, (await who('NChamp')).showId, u.reigns.some(r => r.titleId === title.id && !r.end)];
}, ['Keep or vacate each title first', 'Draft NChamp to Raw', 'Pick 1: NChamp to Raw', 'raw', false]);
await check('draft a tag champion: whether the partner comes is your call', async () => {
  await body.locator('.uv-el.tap', { hasText: 'NT1' }).click();
  await settle();
  await sheet.locator('.uv-tile[data-show=smackdown]').click();
  await sheet.locator('.uv-check', { hasText: 'Bring NT2 too' }).locator('input').check();
  await sheet.locator('.uv-tq .uv-seg div', { hasText: 'Keep it' }).click();
  await sheet.locator('.uv-btn.pri').click();
  await settle();
  const u = await saved();
  const tag = u.titles.find(t => t.name === 'NXT Tag Team Championship');
  return [(await toast()).t, (await who('NT1')).showId, (await who('NT2')).showId, u.reigns.some(r => r.titleId === tag.id && !r.end)];
}, ['Pick 2: NT1 & NT2 to SmackDown', 'smackdown', 'smackdown', true]);
await check('each show drafts as many as you like: NA to Dynamite', async () => {
  await body.locator('.uv-el.tap', { hasText: 'NA' }).click();
  await settle();
  await sheet.locator('.uv-tile[data-show=dynamite]').click();
  await sheet.locator('.uv-btn.pri').click();
  await settle();
  return js(`[...document.querySelectorAll('.uv-wtile')].map(t => t.querySelector('b').textContent + ' ' + t.querySelector('.n').textContent + ' ' + t.querySelector('.ch').textContent)`);
}, ['Raw 6 +1 drafted · −1 relegated', 'SmackDown 7 +2 drafted', 'Dynamite 4 +1 drafted']);
await check('end the window with eligible wrestlers left undrafted', async () => {
  await btn(body, /End the transfer window/).click();
  await settle();
  const msg = await js(`document.getElementById('uvConfirmText').textContent`);
  await confirmYes();
  const u = await saved();
  return [msg, u.transitions[0].window.undrafted.map(id => u.wrestlers.find(w => w.id === id).name),
    await js(`${TEXT}(document.querySelector('.uv-flag.top.ok'))`), (await who('NC')).showId];
}, ['NC, ND stay where they are, undrafted — and that’s kept on record.', ['NC', 'ND'],
  'The window closed in week 5: 4 wrestlers drafted, 2 eligible wrestlers left where they were (NC, ND).', 'nxt']);
await check('every transfer since WrestleMania, in order, and why', () => js(`[...document.querySelectorAll('.uv-page .uv-tls .uv-tl .x')].map(e => e.textContent.replace(/\\s+/g, ' ').trim())`),
  ['R1 Raw → NXT — relegated', 'NChamp NXT → Raw — draft pick 1', 'NT1 NXT → SmackDown — draft pick 2', 'NT2 NXT → SmackDown — draft pick 2',
    'NA NXT → Dynamite — draft pick 3']);
await check('the draft stays on each wrestler’s page', async () => {
  await openRow('NChamp', 'roster');
  const champ = await js(`[...document.querySelectorAll('.uv-page .uv-relrec')].map(${TEXT})`);
  await openRow('ND', 'roster');
  const nd = await js(`[...document.querySelectorAll('.uv-page .uv-relrec')].map(${TEXT})`);
  return [champ, nd];
}, r => /^Drafted to Raw from NXT · pick 1 · S1 · W5 Eligible: held the NXT Championship\. Vacated the NXT Championship\.$/.test(r[0][0])
  && /^Draft eligible · Season 1 owner's decision after a qualifier with NC \(Both earned it\)\. Left undrafted when the transfer window closed\.$/.test(r[1][0]));
await check('reopen, undo a pick: they go back, and so does the title', async () => {
  await body.locator('.uv-page .uv-relrec').first().click();
  await page.waitForTimeout(150);
  await part('window');
  await body.locator('.uv-fixrow', { hasText: 'Reopen the transfer window' }).click();
  await page.waitForTimeout(150);
  await body.locator('.uv-pick-row', { hasText: 'NChamp' }).locator('.uv-link', { hasText: 'Undo' }).click();
  await settle();
  await confirmYes();
  const u = await saved();
  const title = u.titles.find(t => t.name === 'NXT Championship');
  const r = u.reigns.find(x => x.titleId === title.id && !x.end);
  return [(await who('NChamp')).showId, r && u.wrestlers.find(w => w.id === r.holder.id).name, u.drafts.length];
}, ['nxt', 'NChamp', 3]);
await check('saved universe is sound after the whole cycle', sound, []);

// ================================================================ personalities and relationships
// Raw, week 1: Gunther beats Jey twice; Sami & Kevin draw with Seth & Jey four
// times. Week 2: a Raw episode with the same tag match booked, no result yet.
function relationsWorld() {
  const st = M.createUniverse();
  M.setStory(st, { on: false });
  const [Jey, Gunther, Sami, Kevin, Seth] = ['Jey', 'Gunther', 'Sami', 'Kevin', 'Seth'].map(n => M.addWrestler(st, { name: n, showId: 'raw' }));
  const ev1 = M.addEvent(st, { showId: 'raw' });
  for (let i = 0; i < 2; i++) M.recordMatch(st, ev1.id, { sides: [{ wrestlers: [Gunther.id] }, { wrestlers: [Jey.id] }], winner: 0 });
  const tag = { sides: [{ wrestlers: [Sami.id, Kevin.id] }, { wrestlers: [Seth.id, Jey.id] }] };
  for (let i = 0; i < 4; i++) M.recordMatch(st, ev1.id, { ...tag, outcome: 'draw' });
  M.setWeek(st, 2);
  const ev2 = M.addEvent(st, { showId: 'raw' });
  M.bookMatch(st, ev2.id, { sides: [{ wrestlers: [Gunther.id] }, { wrestlers: [Jey.id] }] });
  M.bookMatch(st, ev2.id, tag);
  return st;
}
const secs = () => js(`[...document.querySelectorAll('.uv-page .uv-sec .t')].map(e => e.textContent)`);
const building = () => js(`[...document.querySelectorAll('.uv-page .uv-bu')].map(${TEXT})`);
const ents = where => js(`[...document.querySelectorAll('${where} .uv-ent')].map(e => [e.querySelector('.c').textContent.trim(),
  e.querySelector('.r').textContent.trim(), e.classList.contains('ignored'), e.classList.contains('own')])`);
const nowRels = () => js(`[...document.querySelectorAll('.uv-page .uv-relnow .nm')].map(e => e.textContent.trim())`);
const derived = async () => { const u = await saved(); return { u, d: RL.relationships(u) }; };
const idOf = async n => (await W(n)).id;

await check('relationships: a fresh world, nothing set yet', async () => {
  await noSheet();
  const file = join(dir, 'relations.json');
  await writeFile(file, JSON.stringify(relationsWorld()));
  await page.click('#uvDataBtn');
  await settle();
  await page.setInputFiles('#uvImport', file);
  await page.waitForTimeout(200);
  await confirmYes();
  await closeSheet();
  await openRow('Jey', 'roster');
  return [await pageName(), await js(`${TEXT}(document.querySelector('.uv-page .uv-sec + .uv-none'))`), await building()];
}, ['Jey', 'No traits set. Traits shape how relationships grow — and only you change them.',
  ['2/3 Lost to Gunther the last 2 times — 1 more in a row makes a grudge', '4/5 Teamed with Seth 4 times — allies at 5']]);
await check('every trait is on show, with what it does', async () => {
  await btn(body, 'Edit personality').click();
  await settle();
  return js(`[...document.querySelectorAll('#uvSheetBody .uv-trait')].map(t => t.querySelector('b').textContent)`);
}, ['Ambitious', 'Loyal', 'Opportunistic', 'Hot-headed', 'Patient', 'Proud', 'Cowardly', 'Respectful']);
await check('a first personality counts from the start, and says what it will change', async () => {
  await sheet.locator('.uv-trait[data-trait=hot-headed]').click();
  await page.waitForTimeout(100);
  return [await js(`document.querySelector('#uvSheetBody .uv-seg .on').dataset.v`),
    await js(`[...document.querySelectorAll('#uvSheetBody .uv-prev span')].map(e => e.textContent)`)];
}, ['start', ['Jey holds a grudge against Gunther']]);
await check('saving it: the trait is logged from the start, the grudge follows', async () => {
  await btn(sheet, 'Save').click();
  await settle();
  const u = await saved();
  const jey = u.wrestlers.find(w => w.name === 'Jey');
  return [(await toast()).t, jey.traits, u.traitLog.map(e => [e.trait, e.on, e.at])];
}, ['Personality saved — Jey holds a grudge against Gunther', ['hot-headed'], [['hot-headed', true, null]]]);
await check('the profile lists the relationship and the trait', () => js(`[
  ${TEXT}(document.querySelector('.uv-page .uv-relrow')),
  [...document.querySelectorAll('.uv-page .uv-traits.read .uv-trait b')].map(e => e.textContent),
  ${TEXT}(document.querySelector('.uv-page .uv-tls .uv-tl'))]`),
  ['GU Gunther Grudge Jey holds a grudge against Gunther since S1 · W1', ['Hot-headed'], 'Start Hot-headed from the start']);
await check('the pair page: what’s between them, and why', async () => {
  await body.locator('.uv-relrow').first().click();
  await page.waitForTimeout(150);
  const { u, d } = await derived();
  const want = RL.pairView(u, await idOf('Jey'), await idOf('Gunther'), d).entries.map(e => RL.entryText(u, e));
  return [await pageKind(), await nowRels(), JSON.stringify((await ents('.uv-page')).map(([c, r]) => ({ cause: c, result: r.replace(/^→ /, '') })))
    === JSON.stringify(want), (await ents('.uv-page'))[0]];
}, r => r[0] === 'pair' && r[1].join() === 'Jey holds a grudge against Gunther' && r[2]
  && /^Jey lost to Gunther for the 2nd time running at /.test(r[3][0]) && r[3][1] === '→ Jey holds a grudge against Gunther' && !r[3][2]);
await check('an automatic change can be ignored — it stays, crossed out', async () => {
  await page.locator('.uv-page .uv-ent .uv-link', { hasText: /^Ignore$/ }).click();
  await settle();
  await confirmYes();
  const u = await saved();
  return [(await toast()).t, await nowRels(), (await ents('.uv-page')).map(e => e[2]), u.relEdits.map(e => e.action)];
}, ['Ignored — Jey lets the grudge against Gunther go', [], [true], ['dismiss']]);
await check('…and counted again', async () => {
  await page.locator('.uv-page .uv-ent .uv-link', { hasText: 'Count it again' }).click();
  await page.waitForTimeout(150);
  return [(await toast()).t, await nowRels(), (await saved()).relEdits.length];
}, ['Counted again — Jey holds a grudge against Gunther', ['Jey holds a grudge against Gunther'], 0]);
await check('the owner starts a rivalry from the start, with a reason', async () => {
  await btn(body, 'Change…').click();
  await settle();
  await sheet.locator('.uv-pill[data-kind=rivals]').click();
  await page.waitForTimeout(80);
  await sheet.locator('.uv-seg div[data-v="2"]').click();
  await sheet.locator('.uv-seg div[data-v=start]').click();
  await page.fill('#uvRelNote', 'Old enemies');
  await page.waitForTimeout(80);
  const prev = await js(`[...document.querySelectorAll('#uvSheetBody .uv-prev span')].map(e => e.textContent)`);
  await btn(sheet, 'Save').click();
  await settle();
  const u = await saved();
  return [prev.length, (await toast()).t.replace(/Gunther and Jey|Jey and Gunther/, 'X'), u.relEdits.map(e => [e.action, e.kind, e.level, e.at, e.note]),
    (await ents('.uv-page')).filter(e => e[3]).map(e => e[0])];
}, [1, 'Saved — X are rivals (heat 2)', [['form', 'rivals', 2, null, 'Old enemies']], ['Your change, counted from the start — Old enemies']]);
await check('the owner’s change can be taken back', async () => {
  await page.locator('.uv-page .uv-ent.own .uv-link', { hasText: 'Take back' }).click();
  await settle();
  await confirmYes();
  return [(await saved()).relEdits.length, await nowRels()];
}, [0, ['Jey holds a grudge against Gunther']]);
await check('a show’s incidents: record an interference in a booked match', async () => {
  await body.locator('.uv-ent .uv-link', { hasText: 'Open the show' }).first().click();   // week 1
  await page.waitForTimeout(120);
  await openShow('Raw', 2);
  await btn(body, 'Record something yourself').click();
  await settle();
  await sheet.locator('.uv-pill[data-v=interference]').click();
  await page.waitForTimeout(80);
  const u = await saved();
  const ev = u.events.find(e => e.at.week === 2);
  await page.selectOption('#uvIcMatch', ev.matches[0].id);
  await page.selectOption('#uvSheetBody select[data-by="0"]', await idOf('Seth'));
  await page.selectOption('#uvSheetBody select[data-on="0"]', await idOf('Gunther'));
  await sheet.locator('.uv-sidebox', { hasText: 'Helping' }).locator('.uv-add').click();
  await page.waitForTimeout(80);
  await page.selectOption('#uvSheetBody select[data-helped="0"]', await idOf('Jey'));
  await page.waitForTimeout(80);
  return js(`[...document.querySelectorAll('#uvSheetBody .uv-prev span')].map(e => e.textContent).sort()`);
}, r => r.length === 2 && r[0] === 'Gunther holds a grudge against Seth' && /^(Jey and Seth|Seth and Jey) are allies$/.test(r[1]));
await check('recorded: on the show, with what it changed', async () => {
  await btn(sheet, 'Record it').click();
  await settle();
  const u = await saved();
  const inc = u.events.find(e => e.at.week === 2).incidents;
  return [(await toast()).t, inc.map(i => [i.kind, i.by.length, i.on.length, i.helped.length, !!i.match]),
    await js(`[...document.querySelectorAll('.uv-page .uv-wh')].map(${TEXT})`), (await ents('.uv-page')).length, await sound(),
    inc[0] && inc[0].phase];
}, ['Incident recorded — Gunther holds a grudge against Seth (+1 more)', [['interference', 1, 1, 1, true]],
  ['Interference Seth interfered against Gunther, helping Jey Recorded by you · Match 1: Gunther vs Jey'], 2, [], 'post']);
await check('edit it into an attack: the alliance goes, the grudge stays', async () => {
  await body.locator('.uv-wh').click();
  await settle();
  await sheet.locator('[data-edit]').click();
  await settle();
  await sheet.locator('.uv-pill[data-v=attack]').click();
  await page.waitForTimeout(80);
  await btn(sheet, 'Save the incident').click();
  await settle();
  const { u, d } = await derived();
  const allies = [...d.rels.values()].filter(r => r.active && r.kind === 'allies').length;
  return [u.events.find(e => e.at.week === 2).incidents.map(i => [i.kind, i.helped.length]), allies,
    await js(`${TEXT}(document.querySelector('.uv-page .uv-wh .nm'))`)];
}, [[['attack', 0]], 0, 'Seth attacked Gunther']);
await check('deleting it takes back what it did', async () => {
  await body.locator('.uv-wh').click();
  await settle();
  await sheet.locator('[data-edit]').click();
  await settle();
  await btn(sheet, 'Delete the incident').click();
  await settle();
  await confirmYes();
  const { u, d } = await derived();
  return [(await toast()).t, u.events.find(e => e.at.week === 2).incidents.length,
    [...d.rels.values()].filter(r => r.active).map(r => RL.relText(u, r))];
}, ['Incident deleted — Gunther lets the grudge against Seth go', 0, ['Jey holds a grudge against Gunther']]);
await check('a result says what it did to relationships', async () => {
  await mc(1).locator('.uv-btn', { hasText: 'Enter result' }).click();
  await settle();
  await page.selectOption('#uvMResult', 'draw');
  await btn(sheet, 'Save the result').click();
  await settle();
  return (await toast()).t;
}, r => /^Result saved — (Kevin and Sami|Sami and Kevin|Jey and Seth|Seth and Jey) are allies \(\+1 more\)$/.test(r));
await check('the Roster tab lists every relationship, with filters', async () => {
  await page.click('#uvTabs [data-uvtab=roster]');
  await body.locator('.uv-seg [data-mode=relations]').click();
  await page.waitForTimeout(120);
  const all = await js(`[...document.querySelectorAll('#uvBody .uv-pill')].map(p => p.textContent.trim())`);
  await body.locator('.uv-pill[data-kind=allies]').click();
  await page.waitForTimeout(100);
  return [all, await js(`[...document.querySelectorAll('#uvBody .uv-row[data-rel]')].length`),
    await js(`document.querySelectorAll('#uvBody .uv-ents .uv-ent').length`)];
}, [['All3', 'Grudge1', 'Rivals0', 'Allies2', 'Friends0', 'Former partners0'], 2, 3]);
await check('a later trait change is dated to this week, never rewriting the past', async () => {
  await body.locator('.uv-pill[data-kind=grudge]').click();
  await page.waitForTimeout(100);
  await body.locator('.uv-row[data-rel]').first().click();
  await page.waitForTimeout(120);
  await body.locator('.uv-pairhead .p', { hasText: 'Jey' }).click();
  await page.waitForTimeout(120);
  await btn(body, 'Edit personality').click();
  await settle();
  const since = await js(`document.querySelector('#uvSheetBody .uv-seg .on') && document.querySelector('#uvSheetBody .uv-seg .on').dataset.v`);
  await sheet.locator('.uv-trait[data-trait=loyal]').click();
  await page.waitForTimeout(80);
  const since2 = await js(`document.querySelector('#uvSheetBody .uv-seg .on').dataset.v`);
  await page.fill('#uvTraitNote', 'Found his family');
  await btn(sheet, 'Save').click();
  await settle();
  const u = await saved();
  return [since, since2, u.wrestlers.find(w => w.name === 'Jey').traits, u.traitLog.map(e => [e.trait, e.at && e.at.week, e.note]),
    await js(`[...document.querySelectorAll('.uv-page .uv-tls')].map(${TEXT})[0]`)];
}, [null, 'now', ['loyal', 'hot-headed'], [['hot-headed', null, ''], ['loyal', 2, 'Found his family']],
  'S1 · W2 Became loyal — Found his family Start Hot-headed from the start']);
await check('How relationships work explains every rule', async () => {
  await page.locator('.uv-page .uv-link', { hasText: 'How relationships work' }).click();
  await settle();
  return js(`[...document.querySelectorAll('#uvSheetBody .uv-calc span')].map(e => e.textContent)`);
}, ['Losses', 'Title', '#1 contender', 'Betrayal', 'Interference', 'Attack', 'Save', 'Brawl', 'Challenge', 'Alliance', 'Tension', 'Truce', 'Walk-out',
  'Teammates', 'Distrust', 'Teaming', 'Split', 'Losses', 'Tag title', 'Incidents']);
await check('saved universe is sound after the relationship edits', sound, []);
await check('layout anchored', async () => { await closeSheet(); return anchored(); }, isAnchored);

// ---------------------------------------------------------------- tag teams: trust inside, relationships between
// Raw, week 1: Judgment Day beat KO & Sami three times running, as teams; then
// Kevin and Sami clash. New Day are on the show too, with nothing between them yet.
function teamRelationsWorld() {
  const st = M.createUniverse();
  M.setStory(st, { on: false });
  const [Sami, Kevin, Finn, Damian, Kofi, Xavier] = ['Sami', 'Kevin', 'Finn', 'Damian', 'Kofi', 'Xavier'].map(n => M.addWrestler(st, { name: n, showId: 'raw' }));
  const ko = M.addTeam(st, { name: 'KO & Sami', members: [Sami.id, Kevin.id] });
  const jd = M.addTeam(st, { name: 'Judgment Day', members: [Finn.id, Damian.id] });
  M.addTeam(st, { name: 'New Day', members: [Kofi.id, Xavier.id] });
  const ev = M.addEvent(st, { showId: 'raw' });
  for (let i = 0; i < 3; i++) {
    M.recordMatch(st, ev.id, { sides: [{ team: jd.id, wrestlers: [Finn.id, Damian.id] }, { team: ko.id, wrestlers: [Sami.id, Kevin.id] }], winner: 0 });
  }
  M.recordIncident(st, ev.id, { kind: 'tension', by: [Kevin.id], on: [Sami.id], team: ko.id });
  return st;
}
const teamRels = () => js(`[...document.querySelectorAll('.uv-page [data-teamrel]')].map(e => ${TEXT}(e.querySelector('.uv-rl > span:not(.uv-rk):not(.uv-lv)')))`);
const trust = () => js(`[...document.querySelectorAll('.uv-page [data-trust]')].map(e => [e.querySelector('.nm').textContent.trim(), e.querySelector('.sub').textContent.trim()])`);
await check('tag teams: teammates trust each other until given a reason not to; teams have relationships of their own', async () => {
  await noSheet();
  const file = join(dir, 'team-relations.json');
  await writeFile(file, JSON.stringify(teamRelationsWorld()));
  await page.click('#uvDataBtn');
  await settle();
  await page.setInputFiles('#uvImport', file);
  await page.waitForTimeout(200);
  await confirmYes();
  await closeSheet();
  await openRow('KO & Sami', 'teams');
  return [(await secs()).filter(t => /Trust|Relationships/.test(t)), await trust(), await teamRels()];
}, [['Trust inside the team', 'Relationships with other teams'], [['Sami & Kevin', 'Trust slipping — allies at strength 2']],
  ['KO & Sami hold a grudge against Judgment Day since S1 · W1']]);
await check('the owner makes two teams allies: the preview, the save', async () => {
  await btn(body, 'Add or change a relationship').click();
  await settle();
  await page.selectOption('#uvTeamRelB', (await T('New Day')).id);
  await page.waitForTimeout(80);
  await sheet.locator('.uv-pill[data-kind=allies]').click();
  await page.waitForTimeout(80);
  await sheet.locator('.uv-seg div[data-v="2"]').click();
  await page.waitForTimeout(80);
  const reach = await js(`${TEXT}(document.querySelector('#uvSheetBody .uv-note'))`);
  const prev = await js(`[...document.querySelectorAll('#uvSheetBody .uv-prev span')].map(e => e.textContent)`);
  await btn(sheet, 'Save').click();
  await settle();
  const u = await saved();
  return [reach, prev, (await toast()).t, u.relEdits.map(e => [e.teams, e.action, e.kind, e.level]), await teamRels()];
}, r => Array.isArray(r) && /^Not now: KO & Sami and New Day are not allies\. It extends to every pair of their members: Sami, Kevin with Kofi, Xavier/.test(r[0])
  && r[1].join() === 'KO & Sami and New Day are allies (strength 2)' && r[2] === 'Saved — KO & Sami and New Day are allies (strength 2)'
  && JSON.stringify(r[3]) === JSON.stringify([[true, 'form', 'allies', 2]]) && r[4].length === 2 && r[4][1].startsWith('KO & Sami and New Day are allies'));
await check('…and it reaches their members: a wrestler’s page says it’s through their teams', async () => {
  await page.click('#uvTabs [data-uvtab=roster]');
  await body.locator('.uv-seg [data-mode=wrestlers]').click();
  await page.waitForTimeout(100);
  await openRow('Kofi');
  return js(`[...document.querySelectorAll('.uv-page .uv-relrow .uv-rl')].map(${TEXT})`);
}, r => Array.isArray(r) && r.length === 3 && r[0] === 'Allies Kofi and Xavier are allies since S1 · W1'          // teammates: their own, at 3
  && r.slice(1).every(t => /^Allies Kofi and (Sami|Kevin) are allies through KO & Sami and New Day since S1 · W1$/.test(t)));
await check('the pair page: through their teams, and the teams’ timeline', async () => {
  await body.locator(`.uv-relrow[data-pair="${await idOf('Sami')}"]`).click();
  await page.waitForTimeout(150);
  const sub = await js(`${TEXT}(document.querySelector('.uv-page .uv-relnow .sub'))`);
  return [await nowRels(), sub, (await ents('.uv-page')).map(e => [e[1], e[3]])];
}, r => Array.isArray(r) && r[0].join() === 'Kofi and Sami are allies' && /^strength 2 of 3 · through KO & Sami and New Day · since S1 · W1$/.test(r[1])
  && JSON.stringify(r[2]) === JSON.stringify([['→ KO & Sami and New Day are allies (strength 2)', true]]));
await check('the teams’ own timeline, on the team page: the owner’s change taken back', async () => {
  await openRow('KO & Sami', 'teams');
  await page.locator('.uv-page .uv-ent.own .uv-link', { hasText: 'Take back' }).click();
  await settle();
  await confirmYes();
  return [(await toast()).t, (await saved()).relEdits.length, await teamRels()];
}, ['Taken back — KO & Sami and New Day are no longer allies', 0, ['KO & Sami hold a grudge against Judgment Day since S1 · W1']]);
await check('an automatic change between teams can be ignored, and counted again', async () => {
  await page.locator('.uv-page .uv-ent .uv-link', { hasText: /^Ignore$/ }).first().click();
  await settle();
  await confirmYes();
  const ignored = [(await toast()).t, await teamRels(), (await saved()).relEdits.map(e => [e.action, e.teams])];
  await page.locator('.uv-page .uv-ent .uv-link', { hasText: 'Count it again' }).click();
  await page.waitForTimeout(150);
  return [...ignored, (await toast()).t];
}, ['Ignored — KO & Sami let the grudge against Judgment Day go', [], [['dismiss', false]], 'Counted again — KO & Sami hold a grudge against Judgment Day']);
await check('the Roster tab lists relationships between teams, below the wrestlers', async () => {
  await page.click('#uvTabs [data-uvtab=roster]');
  await body.locator('.uv-seg [data-mode=relations]').click();
  await page.waitForTimeout(120);
  await body.locator('.uv-pill[data-kind=""]').click();
  await page.waitForTimeout(100);
  return [(await js(`[...document.querySelectorAll('#uvBody .uv-sec .t')].map(e => e.textContent)`)).includes('Between tag teams'),
    await js(`[...document.querySelectorAll('#uvBody .uv-row[data-teamrel] .nm')].map(${TEXT})`)];
}, [true, ['KO & Sami → Judgment Day']]);
await check('saved universe is sound after the team relationship edits', sound, []);

// ---------------------------------------------------------------- #1 contender's matches
// Raw, week 1: Gunther holds the World Heavyweight Championship; Cody, Seth
// (ambitious) and Jey want it. Nothing booked yet.
function contenderWorld() {
  const st = M.createUniverse();
  M.setStory(st, { on: false });
  const [Gunther, , Seth] = ['Gunther', 'Cody', 'Seth', 'Jey'].map(n => M.addWrestler(st, { name: n, showId: 'raw' }));
  M.setTraits(st, Seth.id, ['ambitious'], { since: 'start' });
  const t = M.addTitle(st, { name: 'World Heavyweight Championship', showId: 'raw', division: 'men' });
  M.setChampion(st, t.id, { type: 'wrestler', id: Gunther.id });
  M.addEvent(st, { showId: 'raw' });
  return st;
}
await check('a #1 contender’s match: booked from the match form, one or the other with a title', async () => {
  await noSheet();
  const file = join(dir, 'contender.json');
  await writeFile(file, JSON.stringify(contenderWorld()));
  await page.click('#uvDataBtn');
  await settle();
  await page.setInputFiles('#uvImport', file);
  await page.waitForTimeout(200);
  await confirmYes();
  await closeSheet();
  await openShow('Raw');
  await btn(body, 'Book a match').click();
  await settle();
  await side(0).locator('select[data-w="0"]').selectOption({ label: 'Cody' });
  await side(1).locator('select[data-w="0"]').selectOption({ label: 'Seth' });
  await page.selectOption('#uvMTitle', { label: 'World Heavyweight Championship' });
  await page.waitForTimeout(60);
  await page.selectOption('#uvMContender', { label: 'World Heavyweight Championship' });
  await page.waitForTimeout(80);
  const form = [await js(`document.getElementById('uvMTitle').value`), await js(`[...document.querySelectorAll('#uvSheetBody .fine')].map(e => e.textContent.replace(/\\s+/g, ' ').trim())[0]`)];
  await btn(sheet, 'Add to the card').click();
  await settle();
  const u = await saved();
  const m = u.events[0].matches[0];
  return [...form, m.contender === u.titles[0].id, m.titleId, await js(`[...document.querySelectorAll('.uv-page .uv-mc .uv-chip')].map(e => e.textContent)`),
    await js(`${TEXT}(document.querySelector('.uv-page .uv-mc .uv-mc-d'))`)];
}, r => Array.isArray(r) && r[0] === '' && /^The winner becomes #1 contender for the World Heavyweight Championship — next in line for a shot\. Losing it counts like losing the title/.test(r[1])
  && r[2] === true && r[3] === null && r[4].includes('#1 contender · World Heavyweight Championship')
  && r[5] === 'The winner is next in line for the World Heavyweight Championship. Losing it counts like losing the title.');
await check('the champion can’t be in a #1 contender’s match for their own title', async () => {
  await btn(body, 'Book a match').click();
  await settle();
  await side(0).locator('select[data-w="0"]').selectOption({ label: 'Gunther' });
  await side(1).locator('select[data-w="0"]').selectOption({ label: 'Jey' });
  await page.selectOption('#uvMContender', { label: 'World Heavyweight Championship' });
  await page.waitForTimeout(60);
  await btn(sheet, 'Add to the card').click();
  await page.waitForTimeout(150);
  const t = await toast();
  await closeSheet();
  return [t.bad, t.t, (await saved()).events[0].matches.length];
}, [true, 'Gunther holds the World Heavyweight Championship — a #1 contender’s match is for the challengers.', 1]);
await check('its result: the winner is #1 contender, and losing it counts like losing the title', async () => {
  await btn(mc(0), 'Enter result').click();
  await settle();
  const chipsOnForm = await js(`[...document.querySelectorAll('#uvSheetBody .uv-mc-sum .uv-chip')].map(e => e.textContent)`);
  await page.selectOption('#uvMResult', '0');
  await page.waitForTimeout(60);
  const box = await js(`!!document.getElementById('uvMTitleChange')`);
  await btn(sheet, 'Save the result').click();
  await settle();
  const { u, d } = await derived();
  const [cody, seth] = [(await W('Cody')).id, (await W('Seth')).id];
  const g = d.rels.get(RL.relKey('grudge', seth, cody)), rv = d.rels.get(RL.relKey('rivals', seth, cody));
  return [chipsOnForm.includes('#1 contender · World Heavyweight Championship'), box, (await toast()).t, g && g.active && g.level, rv && rv.active,
    await js(`${TEXT}(document.querySelector('.uv-page .uv-mc .uv-mc-d.uv-gold'))`), M.numberOneContender(u, u.titles[0].id).holder.id === cody];
}, r => Array.isArray(r) && r[0] && r[1] === false && /^Result saved — Cody is #1 contender for the World Heavyweight Championship\. /.test(r[2])
  && r[3] === 2 && r[4] === true && r[5] === 'Cody earned a shot at the World Heavyweight Championship' && r[6]);
await check('the title page names the #1 contender, and so does their own page', async () => {
  await openRow('World Heavyweight Championship', 'titles');
  const title = await js(`${TEXT}(document.querySelector('.uv-page [data-contender]'))`);
  await page.click('#uvTabs [data-uvtab=roster]');
  await body.locator('.uv-seg [data-mode=wrestlers]').click();
  await page.waitForTimeout(100);
  await openRow('Cody');
  return [title, await js(`[...document.querySelectorAll('.uv-page .uv-prof-id .tags .uv-tag')].map(e => e.textContent)`)];
}, r => Array.isArray(r) && /^#1 contender: Cody — won the #1 contender’s match at Raw · Week 1\. Next in line for a shot/.test(r[0])
  && r[1].includes('#1 contender · World Heavyweight Championship'));
await check('their title shot uses it up — whatever the result', async () => {
  await openShow('Raw');
  await btn(body, 'Book a match').click();
  await settle();
  await side(0).locator('select[data-w="0"]').selectOption({ label: 'Gunther' });
  await side(1).locator('select[data-w="0"]').selectOption({ label: 'Cody' });
  await page.selectOption('#uvMTitle', { label: 'World Heavyweight Championship' });
  await btn(sheet, 'Add, and enter its result').click();
  await settle();
  await page.selectOption('#uvMResult', '0');
  await page.waitForTimeout(60);
  await btn(sheet, 'Save the result').click();
  await settle();
  await openRow('World Heavyweight Championship', 'titles');
  return js(`${TEXT}(document.querySelector('.uv-page [data-contender]'))`);
}, r => /^No #1 contender right now\./.test(r));
await check('saved universe is sound after the #1 contender’s matches', sound, []);

// ================================================================ the story director
// Raw, week 1, the director on at a wild pace with a known seed: two results
// in, and Jey Uso vs Gunther for the world title still booked. Gunther is
// hot-headed and holds a grudge against Jey; Jey and Seth are friends; Kevin
// Owens and Sami Zayn are a team. The director has already been through what
// happens before the show. The draw is seeded, so what it does next is known
// in advance: each check works it out with the director itself, on a copy of
// what's saved, and then does it through the screens.
const STORY_SEED = 3859;
function storyWorld(seed) {
  const st = M.createUniverse();
  M.setStory(st, { pace: 'wild' });
  M.seedStory(st, seed);
  const [G, J, Sa, K, Se, N] = ['Gunther', 'Jey Uso', 'Sami Zayn', 'Kevin Owens', 'Seth Rollins', 'Akira Tozawa'].map(n => M.addWrestler(st, { name: n, showId: 'raw' }));
  M.setTraits(st, G.id, ['hot-headed', 'ambitious'], { since: 'start' });
  M.setTraits(st, K.id, ['opportunistic'], { since: 'start' });
  const title = M.addTitle(st, { name: 'World Heavyweight Championship', showId: 'raw', division: 'men' });
  M.setChampion(st, title.id, { type: 'wrestler', id: G.id });
  const team = M.addTeam(st, { name: 'KO & Sami', members: [Sa.id, K.id] });
  M.editRelationship(st, { action: 'form', kind: 'friends', a: J.id, b: Se.id, level: 2, since: 'start' });
  M.editRelationship(st, { action: 'form', kind: 'grudge', a: G.id, b: J.id, level: 2, since: 'start' });
  const ev = M.addEvent(st, { showId: 'raw' });
  DR.tick(st);                                                     // before the show: it's the next one up
  M.recordMatch(st, ev.id, { sides: [{ wrestlers: [Se.id] }, { wrestlers: [N.id] }], winner: 0 });
  M.recordMatch(st, ev.id, { sides: [{ team: team.id, wrestlers: [Sa.id, K.id] }, { wrestlers: [Se.id, N.id] }], winner: 1 });
  const m = M.bookMatch(st, ev.id, { sides: [{ wrestlers: [J.id] }, { wrestlers: [G.id] }], titleId: title.id });
  return { st, ev, m, title, G, J };
}
const sw = storyWorld(STORY_SEED);
const SEED = sw.st.story.seed;                                     // as the model keeps it
const copyOf = u => JSON.parse(JSON.stringify(u));
const madeBy = (u, roll) => u.events.flatMap(e => e.incidents.filter(i => i.story === roll.id));
const lastRoll = (u, eventId, phase) => u.story.rolls.filter(r => r.event === eventId && r.phase === phase).pop();
const savedStory = async () => (await saved()).story;
const feedRows = where => js(`[...document.querySelectorAll('${where} .uv-wh[data-wh]')].map(r => ({ kind: r.dataset.kind,
  nm: r.querySelector('.nm').textContent, sub: (r.querySelector('.sub') || { textContent: '' }).textContent }))`);
const row = kind => page.locator(`.uv-page .uv-wh[data-kind=${kind}]`).first();
// the feed's events, newest first, as the screens group them: one decision (an attack and its save) is one event
const names = (u, ids) => ids.map(id => M.wrestlerById(u, id).name).join(' & ');
function storyGroups(u) {
  const out = [];
  [...u.events].sort((a, b) => M.compareStamps(u, b.at, a.at)).forEach(ev => {
    const list = [];
    ev.incidents.forEach(i => {
      const last = list[list.length - 1];
      if (i.story && last && last.story === i.story && JSON.stringify(last.cause) === JSON.stringify(i.cause)) last.incs.push(i);
      else list.push({ story: i.story, cause: i.cause, phase: i.phase === 'pre' ? 'pre' : 'post', incs: [i] });
    });
    out.push(...list.filter(g => g.phase === 'post'), ...list.filter(g => g.phase === 'pre'));
  });
  return out.map(g => [incidentText(u, g.incs[0]), ...g.incs.slice(1).map(i => (i.kind === 'save' ? `${names(u, i.by)} made the save`
    : i.kind === 'turn' ? `${names(u, i.by)} turned ${i.turn.to}` : i.kind === 'breakup' ? `${M.teamById(u, i.team).name} split` : incidentText(u, i)))].join(' — '));
}
const importState = async (st, name) => {
  await noSheet();
  const file = join(dir, name);
  await writeFile(file, JSON.stringify(st));
  await page.click('#uvDataBtn');
  await settle();
  await page.setInputFiles('#uvImport', file);
  await page.waitForTimeout(200);
  await confirmYes();
  await closeSheet();
};

await check('story: before the show is done already — after waits for the results', async () => {
  await importState(sw.st, 'story.json');
  await openShow('Raw');
  return [await js(`[...document.querySelectorAll('.uv-page .uv-sec .t')].map(e => e.textContent)`),
    await js(`[...document.querySelectorAll('.uv-page .uv-runl')].map(${TEXT})`), (await savedStory()).rolls.map(r => r.phase)];
}, r => r[0].join('|').startsWith('Before the show|The card|During & after') && r[2].join() === 'pre'
  && /^Nothing happened before the show\. The director’s log$/.test(r[1][0]) && /^Once every result is in — or the week is over —/.test(r[1][1]));
let before1 = null, pred1 = null;
await check('the last result goes in: the director follows it by itself, and the toast says what happened', async () => {
  before1 = await saved();
  pred1 = copyOf(before1);
  M.enterResult(pred1, sw.ev.id, sw.m.id, { sides: sw.m.sides, outcome: 'win', winner: 0, titleId: sw.title.id }, { titleChange: true });
  DR.tick(pred1);
  await mc(2).locator('.uv-btn', { hasText: 'Enter result' }).click();
  await settle();
  await page.selectOption('#uvMResult', '0');
  await page.check('#uvMTitleChange');
  await btn(sheet, 'Save the result').click();
  await settle();
  const u = await saved();
  const want = madeBy(pred1, lastRoll(pred1, sw.ev.id, 'post'));
  const t = (await toast()).t;
  return [t.startsWith('Result saved — Jey Uso holds the World Heavyweight Championship'),
    t.endsWith(` · After Raw · Week 1: ${storyGroups(pred1)[0]} (+1 more)`),
    madeBy(u, lastRoll(u, sw.ev.id, 'post')).map(i => i.kind), want.map(i => i.kind), u.story.seed];
}, r => r[0] && r[1] && JSON.stringify(r[2]) === JSON.stringify(r[3]) && r[2].includes('save') && r[4] === SEED);
await check('it’s canon on the show, with causes — the result, the title and the rosters exactly as entered', async () => {
  const u = await saved();
  const ev = u.events.find(e => e.id === sw.ev.id);
  const made = madeBy(u, lastRoll(u, sw.ev.id, 'post'));
  return [ev.matches.map(m => [m.status, m.winner]), M.currentReign(u, sw.title.id).holder.id === sw.J.id, u.reigns.length - before1.reigns.length,
    u.moves.length - before1.moves.length, made.every(i => i.phase === 'post' && i.cause.length > 0), (await feedRows('.uv-page')).map(x => x.nm),
    storyGroups(u), await sound()];
}, r => JSON.stringify(r[0]) === '[["played",0],["played",1],["played",0]]' && r[1] && r[2] === 1 && r[3] === 0 && r[4]
  && r[5].length === 2 && JSON.stringify(r[5]) === JSON.stringify(r[6]) && r[7].length === 0);
await check('tap an event: why it happened, what it changed, its chance and draw', async () => {
  await row('save').click();
  await settle();
  const u = await saved();
  const inc = u.events.find(e => e.id === sw.ev.id).incidents.find(i => i.kind === 'save');
  const why = [...inc.cause.filter(w => !/^Less likely/.test(w)), ...inc.cause.filter(w => /^Less likely/.test(w))];
  return [await js(`document.getElementById('uvSheetTitle').textContent`),
    JSON.stringify(await js(`[...document.querySelectorAll('#uvSheetBody [data-why] li')].map(e => e.textContent)`)) === JSON.stringify(why),
    await js(`[...document.querySelectorAll('#uvSheetBody [data-fx] li')].map(e => e.textContent)`), await js(`${TEXT}(document.querySelector('#uvSheetBody .uv-odds'))`)];
}, r => r[0] === 'Save' && r[1] && r[2].length >= 2 && r[2].every(x => !/No relationship/.test(x)) && /^Chance \d+(\.\d+)?% · drew 0\.\d{4} · See the whole run$/.test(r[3]));
await check('the director’s log: the seed, every possibility, its chance and draw', async () => {
  await sheet.locator('.uv-odds .uv-link').click();
  await settle();
  const roll = lastRoll(await saved(), sw.ev.id, 'post');
  return [await js(`[...document.querySelectorAll('#uvSheetBody .uv-logh b')].map(e => e.textContent)`),
    await js(`document.querySelectorAll('#uvSheetBody .uv-log > div').length`), await js(`document.querySelectorAll('#uvSheetBody .uv-log > div.on').length`),
    roll.considered.length, roll.considered.filter(k => k.picked).length,
    roll.considered.every(k => k.draw === DR.draw(SEED, sw.ev.id, 'post', 0, k.key))];
}, r => r[0][0] === String(SEED) && r[0][1] === 'first' && r[0][2] === 'Wild' && r[1] === r[3] && r[2] === 2 && r[4] === 2 && r[5]);
await check('edit what the director did: it stays, marked as edited by you', async () => {
  await closeSheet();
  await row('tension').click();
  await settle();
  await sheet.locator('[data-edit]').first().click();
  await settle();
  const intro = await js(`document.querySelector('#uvSheetBody .uv-p').textContent`);
  await page.fill('#uvIcNote', 'Argued in the locker room');
  await btn(sheet, 'Save the incident').click();
  await settle();
  const inc = (await saved()).events.find(e => e.id === sw.ev.id).incidents.find(i => i.kind === 'tension');
  return [/the story director recorded this/.test(intro), inc.edited, inc.note, !!inc.story,
    (await feedRows('.uv-page')).find(x => x.kind === 'tension').sub.includes('Edited by you')];
}, [true, true, 'Argued in the locker room', true, true]);
await check('undo an event: it comes off, and so does what it did to relationships', async () => {
  const pred = copyOf(await saved());
  const ev = pred.events.find(e => e.id === sw.ev.id);
  ev.incidents.filter(i => ['attack', 'save'].includes(i.kind) && i.story).forEach(i => M.deleteIncident(pred, ev.id, i.id));
  const want = [...RL.relationships(pred).rels.values()].filter(r => r.active).map(r => RL.relText(pred, r)).sort();
  await row('save').click();
  await settle();
  await btn(sheet, /^\s*Undo it/).click();
  await settle();
  await confirmYes();
  const { u, d } = await derived();
  return [(await toast()).t.startsWith('Undone'), u.events.find(e => e.id === sw.ev.id).incidents.map(i => i.kind),
    lastRoll(u, sw.ev.id, 'post').made.length, JSON.stringify([...d.rels.values()].filter(r => r.active).map(r => RL.relText(u, r)).sort()) === JSON.stringify(want),
    (await feedRows('.uv-page')).map(x => x.kind)];
}, [true, ['tension'], 1, true, ['tension']]);
await check('run it again: the next draw, just as reproducible', async () => {
  const u0 = await saved();
  const old = lastRoll(u0, sw.ev.id, 'post');
  const pred = copyOf(u0);
  const r = DR.rerun(pred, old.id);
  await body.locator(`.uv-runl[data-run="${old.id}"] .uv-link`, { hasText: 'Run it again' }).click();
  await settle();
  await confirmYes();
  const u = await saved();
  const now = lastRoll(u, sw.ev.id, 'post');
  return [(await toast()).t.startsWith('Ran again'), u.story.rolls.find(x => x.id === old.id).undone, now.nonce,
    madeBy(u, now).map(i => [i.kind, i.cause.length > 0]), madeBy(pred, r).map(i => [i.kind, true]), await sound()];
}, r => r[0] && r[1] === true && r[2] === 1 && JSON.stringify(r[3]) === JSON.stringify(r[4]) && r[3].some(x => x[0] === 'challenge') && !r[5].length);
await check('a title challenge can be booked — the form filled in, booked, never decided', async () => {
  await row('challenge').click();
  await settle();
  const label = await js(`${TEXT}(document.querySelector('#uvSheetBody [data-book]'))`);
  await sheet.locator('[data-book]').click();
  await settle();
  const form = [await js(`document.getElementById('uvSheetTitle').textContent`), await js(`document.getElementById('uvMTitle').selectedOptions[0].textContent`)];
  await btn(sheet, 'Add to the card').click();
  await settle();
  const u = await saved();
  const w2 = u.events.find(e => e.at.week === 2 && e.showId === 'raw');
  const inc = u.events.find(e => e.id === sw.ev.id).incidents.find(i => i.kind === 'challenge');
  return [label, form, w2 && w2.matches.map(m => [m.titleId === sw.title.id, m.status, m.outcome, m.winner,
    JSON.stringify(m.sides.map(sd => sd.wrestlers)) === JSON.stringify([inc.by, inc.on])]), u.story.rolls.length];
}, r => r[0] === 'Book the title match on Raw · Week 2' && JSON.stringify(r[1]) === '["Book a match","World Heavyweight Championship"]'
  && JSON.stringify(r[2]) === '[[true,"scheduled",null,null,true]]' && r[3] === 3);
let pred2 = null;
await check('Next week: the next show is up, and what happens before it has happened', async () => {
  pred2 = copyOf(await saved());
  M.setWeek(pred2, 2);
  DR.tick(pred2);
  await noSheet();
  await page.click('#uvTabs [data-uvtab=calendar]');
  await body.locator('.uv-btn', { hasText: 'Next week' }).click();
  await page.waitForTimeout(150);
  const u = await saved();
  const w2 = u.events.find(e => e.at.week === 2 && e.showId === 'raw');
  const pre = lastRoll(u, w2.id, 'pre');
  const t = (await toast()).t;
  const want = madeBy(pred2, lastRoll(pred2, w2.id, 'pre'));
  return [pre && pre.phase, madeBy(u, pre).map(i => i.kind), want.map(i => i.kind),
    want.length ? t.startsWith(`Week 2 · Before Raw · Week 2: ${incidentText(pred2, want[0])}`) : t === 'Week 2', w2.matches[0].status];
}, r => r[0] === 'pre' && JSON.stringify(r[1]) === JSON.stringify(r[2]) && r[3] && r[4] === 'scheduled');
await check('the calendar shows what happened lately', async () => {
  const u = await saved();
  return [await js(`[...document.querySelectorAll('#uvBody [data-story] .wh')].map(e => e.textContent)`), storyGroups(u).slice(0, 3)];
}, r => r[0].length > 0 && JSON.stringify(r[0]) === JSON.stringify(r[1]));
await check('What happened: the whole feed a week at a time, with filters, and the director’s log', async () => {
  await body.locator('[data-story]').click();
  await page.waitForTimeout(150);
  const u = await saved();
  const all = (await feedRows('.uv-page [data-feed]')).map(x => x.nm);
  const weeks = await js(`[...document.querySelectorAll('.uv-page [data-feed] .uv-sub')].map(e => e.textContent)`);
  await body.locator('.uv-pill[data-only=post]').click();
  await page.waitForTimeout(100);
  const post = await feedRows('.uv-page [data-feed]');
  await body.locator('.uv-pill[data-only=yours]').click();
  await page.waitForTimeout(100);
  const yours = await feedRows('.uv-page [data-feed]');
  await body.locator('.uv-pill[data-only=""]').click();
  await page.waitForTimeout(100);
  return [await pageKind(), JSON.stringify(all) === JSON.stringify(storyGroups(u)), weeks.at(-1), post.every(x => x.sub.startsWith('After ')) && post.length > 0,
    yours.length, await js(`document.querySelectorAll('.uv-page [data-log]').length`), u.story.rolls.length];
}, r => r[0] === 'story' && r[1] && r[2] === 'Week 1' && r[3] && r[4] === 0 && r[5] === r[6]);
await check('pace, and on or off: switched back on, it starts from this week', async () => {
  await body.locator('.uv-storyhead .uv-seg div[data-v=quiet]').click();
  await page.waitForTimeout(100);
  const pace = (await savedStory()).pace;
  await body.locator('.uv-storyhead .uv-seg div[data-v=off]').click();
  await page.waitForTimeout(100);
  const off = [(await savedStory()).on, await js(`document.querySelectorAll('.uv-storyhead .uv-seg').length`)];
  await body.locator('.uv-storyhead .uv-seg div[data-v=on]').click();
  await page.waitForTimeout(100);
  const sto = await savedStory();
  await body.locator('.uv-storyhead .uv-seg div[data-v=wild]').click();
  await page.waitForTimeout(100);
  return [pace, off, sto.on, sto.since.week, (await savedStory()).pace];
}, ['quiet', [false, 1], true, 2, 'wild']);
await check('How the story director works: every kind, and what it never does', async () => {
  await body.locator('.uv-storyhead .uv-link', { hasText: 'How it works' }).click();
  await settle();
  const t = await js(`${TEXT}(document.getElementById('uvSheetBody'))`);
  return [/never enters, invents or changes a match or its winner/.test(t), /never hands out a title/.test(t),
    /never moves anyone between shows/.test(t), /Reproducible/.test(t), /Big moments are earned/.test(t)];
}, [true, true, true, true, true]);
await check('a wrestler’s page: their goal, momentum and story', async () => {
  await closeSheet();
  await js(`uvRosterMode('wrestlers')`);
  await openRow('Jey Uso', 'roster');
  const u = await saved();
  return [await js(`(() => { const s = document.querySelector('.uv-page .uv-story1'); return [s.dataset.goal, s.dataset.momentum]; })()`),
    DR.goalOf(u, sw.J.id), DR.momentumOf(u, sw.J.id).label, (await feedRows('.uv-page')).length > 0];
}, r => r[0][0] === 'Keep the World Heavyweight Championship' && r[0][0] === r[1] && r[0][1] === r[2] && r[3]);
await check('your own turn, before the show: recorded as yours — and undone, the alignment goes back', async () => {
  await noSheet();
  await openShow('Raw', 2);
  await btn(body, 'Record something yourself').click();
  await settle();
  await sheet.locator('.uv-pill[data-v=turn]').click();
  await page.waitForTimeout(80);
  await page.selectOption('#uvSheetBody select[data-by="0"]', sw.G.id);
  await page.waitForTimeout(80);
  await page.selectOption('#uvIcTo', 'face');
  await page.waitForTimeout(80);
  const phase = await js(`document.querySelector('#uvSheetBody .uv-seg .on').dataset.v`);
  await btn(sheet, 'Record it').click();
  await settle();
  const a = (await saved()).wrestlers.find(w => w.id === sw.G.id).alignment;
  const shown = (await feedRows('.uv-page [data-phase=pre]')).find(x => x.kind === 'turn');
  await row('turn').click();
  await settle();
  await btn(sheet, /^\s*Undo it/).click();
  await settle();
  await confirmYes();
  const u = await saved();
  return [phase, a, shown && [shown.nm, shown.sub], u.wrestlers.find(w => w.id === sw.G.id).alignment,
    u.events.flatMap(e => e.incidents).filter(i => i.kind === 'turn').length, await sound()];
}, ['pre', 'face', ['Gunther turned face', 'Recorded by you'], null, 0, []]);
await check('layout anchored', anchored, isAnchored);

// ================================================================ a whole season, end to end
// The shared sample season (universe-sample.mjs): four weeks, WrestleMania,
// relegation on Raw, SmackDown and Dynamite, NXT qualifiers and a draft. Week
// 6 is under way: Raw planned, SmackDown with a match booked.
const sample = sampleCycle();
M.setWeek(sample.st, 6);
const raw6 = M.addEvent(sample.st, { showId: 'raw' });
const sd6 = M.addEvent(sample.st, { showId: 'smackdown' });
M.bookMatch(sample.st, sd6.id, { sides: [{ wrestlers: [sample.W('Solo').id] }, { wrestlers: [sample.W('Bron').id] }] });
const goTo = async label => {
  await noSheet();
  await page.click('#uvGoBtn');
  await settle();
  await sheet.locator('.uv-go', { has: page.locator('b', { hasText: label }) }).first().click();
  await page.waitForTimeout(200);
};
const activeTab = () => js(`document.querySelector('.uv-tab.on').dataset.uvtab`);

await check('season: imported, it opens on today’s show', async () => {
  await noSheet();
  const file = join(dir, 'sample.json');
  await writeFile(file, JSON.stringify(sample.st));
  await page.click('#uvDataBtn');
  await settle();
  await page.setInputFiles('#uvImport', file);
  await page.waitForTimeout(200);
  await confirmYes();
  await closeSheet();
  await page.click('#uvTabs [data-uvtab=calendar]');
  return js(`(() => { const u = document.querySelector('.uv-upnext'); return [u.dataset.upnext, ${TEXT}(u)]; })()`);
}, r => r[0] === raw6.id && /^Up next Raw · Week 6 Mon · Week 6 · Planned — nothing booked yet/.test(r[1]));
await check('Go to lists every destination, with where each stands', async () => {
  await page.click('#uvGoBtn');
  await settle();
  return js(`[...document.querySelectorAll('#uvSheetBody .uv-go')].map(g => g.querySelector('b').textContent + ' | ' + g.querySelector('span').textContent)`);
}, r => r.length === 14 && r[0] === 'Up next: Raw · Week 6 | Planned — nothing booked yet'
  && r.includes('Rosters | Raw 9 · SmackDown 6 · Dynamite 5 · NXT 7 · Evolve 0')
  && r.some(x => /^Season 1 transition · transfer window \| Raw: done — 1 to NXT/.test(x))
  && r.includes('Tiers & transfers | 1 Main roster · 2 NXT · 3 Evolve')
  && r[12] === 'Auto booker | Draft a card for any show — each show’s size and kinds of match' && r[13].startsWith('Save & backup'));
await check('Go to reaches champions, relationships, rankings, story and the transfer window', async () => {
  const seen = [];
  await closeSheet();
  await goTo('Champions'); seen.push(await activeTab());
  await goTo('Relationships'); seen.push(`${await activeTab()}:${await js(`document.querySelector('.uv-seg [data-mode].on').dataset.mode`)}`);
  await goTo('Booking balance'); seen.push(`${await activeTab()}:${await js(`document.querySelector('#uvBody .uv-seg .on').textContent`)}`);
  await goTo('What happened'); seen.push(await pageKind());
  await goTo('transfer window'); seen.push(`${await pageKind()}:${await js(`document.querySelector('[data-part].on').dataset.part`)}`);
  await goTo('Rosters'); seen.push(`${await activeTab()}:${await js(`document.querySelector('.uv-seg [data-mode].on').dataset.mode`)}`);
  return seen;
}, ['titles', 'roster:relations', 'rankings:Booking balance', 'story', 'transition:window', 'roster:wrestlers']);
await check('from a show, the shows either side are a tap away — and Back is one step', async () => {
  await goTo('Up next');
  const a = await evTitle();
  await body.locator('.uv-evnav .p').click();
  await page.waitForTimeout(150);
  const b = await evTitle();
  await body.locator('.uv-evnav .n').click();
  await page.waitForTimeout(150);
  const c = await evTitle();
  await page.click('.uv-back');
  await page.waitForTimeout(150);
  return [a, b, c, await pageKind(), await activeTab()];
}, ['Raw · Week 6', 'SmackDown · Week 5', 'Raw · Week 6', null, 'calendar']);
await check('a wrestler’s ranking leads to their show’s table', async () => {
  await openRow('Cody', 'roster');
  const line = await js(`document.querySelector('.uv-page .uv-ranklink').textContent.trim()`);
  await body.locator('.uv-ranklink').click();
  await page.waitForTimeout(150);
  const t = SD.standings(sample.st, { showId: 'raw', period: SD.periodOf(sample.st, sample.st.seasons[0].id) });
  const rank = t.ranked.find(r => r.name === 'Cody').rank;
  return [line === `Ranked ${rank}${rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th'} of 9 on Raw in Season 1 singles`,
    await activeTab(), await js(`document.querySelector('#uvBody .uv-pill.on').textContent.trim()`)];
}, [true, 'rankings', 'Raw']);
await check('correcting an old result: the relegation stands, and the transition page says what moved', async () => {
  await openShow('Dynamite', 1);
  await mc(0).locator('.uv-btn', { hasText: 'Correct' }).click();
  await settle();
  await page.selectOption('#uvMResult', '1');                                     // Darby beat Hangman after all
  await btn(sheet, 'Save the correction').click();
  await settle();
  await goTo('transfer window');
  await page.click('[data-part=relegation]');
  await page.waitForTimeout(150);
  const flags = await trFlags('dynamite');
  const u = await saved();
  return [flags.some(f => /^Since the relegation matches were booked, corrected results changed the win totals: Darby 0 → 1, Hangman 2 → 1\./.test(f)),
    flags.some(f => /^Picked by you/.test(f)), u.relegations.find(r => r.show === 'dynamite').wins, await sound()];
}, [true, false, 1, []]);
await check('a title correction that leaves the history odd is pointed out, not hidden', async () => {
  await openShow('WrestleMania', 4);
  await mc(0).locator('.uv-btn', { hasText: 'Correct' }).click();
  await settle();
  await page.selectOption('#uvMResult', '1');                                     // Cody retained at WrestleMania
  await page.uncheck('#uvMTitleChange');
  await btn(sheet, 'Save the correction').click();
  await settle();
  await openShow('Raw', 2);
  await mc(0).locator('.uv-btn', { hasText: 'Correct' }).click();
  await settle();
  await page.selectOption('#uvMResult', '1');                                     // and Gunther never lost it in week 2
  await page.uncheck('#uvMTitleChange');
  await btn(sheet, 'Save the correction').click();
  await settle();
  const t = (await toast()).t;
  await openRow('World', 'titles');
  return [t, await js(`[...document.querySelectorAll('.uv-page [data-check]')].map(e => e.textContent.trim())`), await sound()];
}, r => r[0].startsWith('Result corrected — Check the World history: 1 thing doesn’t add up')
  && JSON.stringify(r[1]) === JSON.stringify(["The World match at Raw · Week 3 didn't include the champion of the day, Gunther. Check that result."])
  && !r[2].length);
await check('a qualifier can’t change under a closed transfer window', async () => {
  await openShow('NXT', 5);
  await mc(0).locator('.uv-btn', { hasText: 'Correct' }).click();
  await settle();
  const cur = await js(`document.getElementById('uvMResult').value`);
  await page.selectOption('#uvMResult', cur === '0' ? '1' : '0');
  await btn(sheet, 'Save the correction').click();
  await settle();
  const t = await toast();
  await closeSheet();
  return [t.bad, /transfer window has closed/.test(t.t)];
}, [true, true]);
await check('restore points: kept on import and when the week moves on — and the week can be undone', async () => {
  await page.click('#uvTabs [data-uvtab=calendar]');
  await body.locator('.uv-btn', { hasText: 'Next week' }).click();
  await page.waitForTimeout(150);
  const week7 = (await saved()).seasons[0].week;
  await page.click('#uvDataBtn');
  await settle();
  const points = await js(`[...document.querySelectorAll('#uvSheetBody [data-restore] b')].map(e => e.textContent)`);
  await sheet.locator('[data-restore]', { hasText: 'End of Season 1 · Week 6' }).click();
  await page.waitForTimeout(100);
  await confirmYes();
  return [week7, points.slice(0, 2), points.length <= 4, (await saved()).seasons[0].week, await js(`document.getElementById('uvClock').textContent`), await sound()];
}, [7, ['End of Season 1 · Week 6', 'Before importing sample.json'], true, 6, 'Season 1 · Week 6', []]);
await check('the save sheet remembers the last export', async () => {
  await page.click('#uvDataBtn');
  await settle();
  const before = await js(`(document.querySelector('#uvSheetBody .uv-savenote') || {}).textContent || ''`);
  const dl = page.waitForEvent('download');
  await btn(sheet, 'Export').click();
  await dl;
  await page.waitForTimeout(150);
  const after = await js(`document.querySelector('#uvSheetBody .uv-savenote').textContent`);
  const points = await js(`[...document.querySelectorAll('#uvSheetBody [data-restore] b')].map(e => e.textContent)`);
  await closeSheet();
  return [/^(No save file exported|Last save file exported)/.test(before), after, points[0]];
}, [true, 'Last save file exported just now from this browser.', 'Before restoring “End of Season 1 · Week 6”']);

// ================================================================ searching the long dropdowns
// Every wrestler (or team) dropdown with a long list has a search beside it.
// The sample season is loaded: Raw · Week 6 is planned.
const hits = () => js(`[...document.querySelectorAll('#uvSheetBody .uv-findhit')].map(b => [b.querySelector('b').textContent,
  (b.querySelector('span') || { textContent: '' }).textContent])`);
await check('a long dropdown has a search beside it: typing narrows it, Enter takes the best match', async () => {
  await openShow('Raw');
  await btn(body, 'Book a match').click();
  await settle();
  const buttons = await js(`document.querySelectorAll('#uvSheetBody .uv-find-btn').length`);
  await sheet.locator('.uv-sidebox').nth(0).locator('.uv-find-btn').click();
  await page.keyboard.type('gun');
  await page.waitForTimeout(80);
  const found = await hits();
  const typing = await js(`document.activeElement && document.activeElement.type`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  return [buttons, found, typing, await js(`document.querySelector('#uvSheetBody select[data-w="0"]').selectedOptions[0].textContent`),
    await js(`document.querySelectorAll('#uvSheetBody .uv-findbox').length`), await anchored()];
}, r => r[0] === 2 && JSON.stringify(r[1]) === '[["Gunther","Raw"]]' && r[2] === 'search' && r[3] === 'Gunther' && r[4] === 0 && isAnchored(r[5]));
await check('tap a match to pick it — the booking saves exactly who was picked', async () => {
  await sheet.locator('.uv-sidebox').nth(1).locator('.uv-find-btn').click();
  await page.keyboard.type('JE');
  await page.waitForTimeout(80);
  const found = await hits();
  await sheet.locator('.uv-findhit', { has: page.locator('span', { hasText: 'Raw' }) }).click();
  await page.waitForTimeout(120);
  await btn(sheet, 'Add to the card').click();
  await settle();
  const u = await saved();
  const m = u.events.find(e => e.id === raw6.id).matches.at(-1);
  return [found, m.sides.map(sd => sd.wrestlers.map(id => M.wrestlerById(u, id).name)), m.status, m.winner, await sound()];
}, [[['Jey', 'Raw'], ['Je', 'NXT']], [['Gunther'], ['Jey']], 'scheduled', null, []]);
await check('the search offers only what its dropdown does, and Escape closes it', async () => {
  await js(`uvRelSheet('${sample.W('Cody').id}')`);
  await settle();
  await sheet.locator('.uv-find', { has: page.locator('#uvRelB') }).locator('.uv-find-btn').click();
  await page.keyboard.type('cody');                                 // the other wrestler can't be Cody himself
  await page.waitForTimeout(80);
  const none = await js(`document.querySelector('#uvSheetBody .uv-findres').textContent`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  const closed = [await js(`document.querySelectorAll('#uvSheetBody .uv-findbox').length`), await sheetOpen()];
  await closeSheet();
  return [none, closed];
}, ['Nobody by that name in this list', [0, true]]);
await check('the other long pickers have it too: a team’s members, an incident, a new champion', async () => {
  const count = async open => { await js(open); await settle(); const n = await js(`document.querySelectorAll('#uvSheetBody .uv-find-btn').length`); await closeSheet(); return n; };
  const team = sample.st.teams[0], title = sample.st.titles.find(t => t.kind === 'singles');
  return [await count(`uvNewTeam()`), await count(`uvIncident('${raw6.id}')`), await count(`uvLineup('${team.id}')`), await count(`uvCrownSheet('${title.id}')`)];
}, r => r.every(n => n >= 1));

// ================================================================ tiers & transfers
// The sample season is loaded: its transition (WrestleMania, week 4) is done,
// with the tiers and rules it started with. Evolve is tier 3, empty.
const tierPage = () => js(`[...document.querySelectorAll('.uv-page .uv-tier[data-tier]')].map(t =>
  t.querySelector('.h b').textContent + ': ' + [...t.querySelectorAll('.uv-trow .nm')].map(n => n.textContent).join(', '))`);
const connLines = id => js(`[...document.querySelectorAll('.uv-page .uv-conn[data-link="${id}"] .uv-rules > div')].map(${TEXT})`);
await check('Tiers & transfers: the tiers top down, and the rules between each two', async () => {
  await goTo('Tiers & transfers');
  return [await pageKind(), await tierPage(), await connLines('link-main-nxt'), await connLines('link-nxt-evolve'),
    await js(`${TEXT}(document.querySelector('.uv-page .uv-conn[data-link="link-nxt-evolve"] .uv-flag'))`)];
}, r => r[0] === 'tiers' && JSON.stringify(r[1]) === JSON.stringify(['Main roster: Raw, SmackDown, Dynamite', 'NXT: NXT', 'Evolve: Evolve'])
  && /^Relegation after WrestleMania, the 2 with the fewest wins on each of Raw, SmackDown and Dynamite face each other; losers go down to NXT right away/.test(r[2][0])
  && r[2][2] === 'NXT champions draft eligible' && r[2][3] === 'Their titles your call at each move'
  && r[3][0] === 'Relegation off' && r[3][2] === 'Evolve champions move up by themselves at the transfer window' && r[3][3] === 'Their titles vacated'
  && r[3][4] === 'Moving up to NXT' && /^Not carried out yet: champions moving up by themselves/.test(r[4]));
await check('edit a connection’s rules: saved as you go, checked as a whole — the transition already done keeps its own', async () => {
  await body.locator('.uv-conn[data-link="link-main-nxt"] .uv-btn', { hasText: 'Edit the rules' }).click();
  await settle();
  await sheet.locator('.uv-trcount .uv-ic').nth(1).click();                         // 3 candidates a show
  await page.waitForTimeout(100);
  await sheet.locator('[data-rule="titles"] [data-v="vacate"]').click();
  await page.waitForTimeout(100);
  await sheet.locator('[data-rule="champions"] [data-v="automatic"]').click();        // no set show to move up to: refused, nothing changes
  await page.waitForTimeout(100);
  const refused = (await toast());
  const u = await saved();
  const l = u.links.find(x => x.id === 'link-main-nxt');
  await closeSheet();
  return [l.rules.relegation.candidates, l.rules.titles, l.rules.champions, refused.bad, refused.t, u.transitions[0].parts[0].rules.titles,
    u.transitions[0].parts[0].rules.relegation.candidates, await sound()];
}, r => r[0] === 3 && r[1] === 'vacate' && r[2] === 'eligible' && r[3] === true && /Pick the show in Main roster they move up to/.test(r[4])
  && r[5] === 'ask' && r[6] === 2 && r[7].length === 0);
await check('add a fourth tier: it connects to the one above with nothing switched on', async () => {
  await btn(body, 'Add a tier').click();
  await page.waitForTimeout(150);
  const u = await saved();
  const t4 = u.tiers[3];
  const link = u.links.find(l => l.upper === 'tier-evolve' && l.lower === t4.id);
  return [(await toast()).t, u.tiers.map(t => t.name), link && [link.rules.relegation.on, link.rules.qualifiers.on, link.rules.champions],
    link && (await connLines(link.id))[0]];
}, ['Tier 4 added at the bottom — set its connection’s rules', ['Main roster', 'NXT', 'Evolve', 'Tier 4'], [false, false, 'eligible'], 'Relegation off']);
let lfgId = null;
await check('add a show to the new tier; the connection’s destinations follow it', async () => {
  await btn(body, 'Add a show').click();
  await settle();
  await page.fill('#uvShowName', 'LFG');
  await page.selectOption('#uvShowDay', '3');
  const t4 = (await saved()).tiers[3];
  await page.selectOption('#uvShowTierPick', t4.id);
  await btn(sheet, 'Add the show').click();
  await settle();
  const u = await saved();
  const lfg = u.shows.find(x => x.name === 'LFG');
  lfgId = lfg.id;
  const link = u.links.find(l => l.lower === t4.id);
  return [lfg.day, u.tiers[3].shows, link.rules.relegation.to, (await tierPage())[3]];
}, r => r[0] === 3 && r[1].length === 1 && r[1][0] === lfgId && r[2] === lfgId && r[3] === 'Tier 4: LFG');
await check('switch on the new connection’s relegation and qualifiers — no new code, just rules', async () => {
  const link = (await saved()).links.find(l => l.upper === 'tier-evolve');
  await body.locator(`.uv-conn[data-link="${link.id}"] .uv-btn`, { hasText: 'Edit the rules' }).click();
  await settle();
  await sheet.locator('[data-rule="relegation.on"] [data-v="true"]').click();
  await page.waitForTimeout(100);
  await sheet.locator('[data-rule="qualifiers.on"] [data-v="true"]').click();
  await page.waitForTimeout(100);
  const r = (await saved()).links.find(l => l.id === link.id).rules;
  await closeSheet();
  return [r.relegation.on, r.relegation.to === lfgId, r.qualifiers.on, (await connLines(link.id)).slice(0, 2)];
}, r => r[0] && r[1] && r[2] && /^Relegation after WrestleMania, the 2 with the fewest wins on each of Evolve face each other; losers go down to LFG/.test(r[3][0])
  && /^Qualifying matches on LFG after WrestleMania; winners become draft eligible/.test(r[3][1]));
await check('reorder the lower tiers, rename one, move a show out and back — tier 1 keeps a show', async () => {
  const t4 = (await saved()).tiers[3];
  await body.locator(`.uv-tier[data-tier="${t4.id}"] .uv-ic[title="Move up"]`).click();
  await page.waitForTimeout(120);
  const order = (await saved()).tiers.map(t => t.name);
  await body.locator(`.uv-tier[data-tier="${t4.id}"] .uv-ic[title="Move down"]`).click();
  await page.waitForTimeout(120);
  await body.locator(`.uv-tier[data-tier="${t4.id}"] .uv-ic[title="Rename"]`).click();
  await settle();
  await page.fill('#uvTierName', 'Indies');
  await btn(sheet, 'Save').click();
  await settle();
  await page.selectOption(`select[data-tier-of="${lfgId}"]`, '');
  await page.waitForTimeout(120);
  const none = await js(`[...document.querySelectorAll('.uv-page .uv-tier.none .uv-trow .nm')].map(e => e.textContent)`);
  await page.selectOption(`select[data-tier-of="${lfgId}"]`, t4.id);
  await page.waitForTimeout(120);
  const u = await saved();
  return [order, u.tiers.map(t => t.name), none, u.tiers[3].shows.includes(lfgId), await sound()];
}, [['Main roster', 'NXT', 'Tier 4', 'Evolve'], ['Main roster', 'NXT', 'Evolve', 'Indies'], ['LFG'], true, []]);
await check('a new season transition includes the new connection, and keeps a copy of the rules', async () => {
  const u = await saved();
  const st = JSON.parse(JSON.stringify(u));
  // a WrestleMania in a later season, started in the model on a copy - what the page would do
  M.startNextSeason(st);
  const wm = M.addEvent(st, { kind: 'ple', name: 'WrestleMania 2', week: 1 });
  const tr = M.startTransition(st, wm.id);
  return [tr.parts.map(p => `${p.lowerName}→${p.upperName}`), M.relegationShows(st, tr).map(x => x.name), tr.parts[0].rules.titles, tr.shows.raw.count];
}, [['NXT→Main roster', 'Evolve→NXT', 'Indies→Evolve'], ['Raw', 'SmackDown', 'Dynamite', 'Evolve'], 'vacate', 3]);
await check('remove the tier: its show stays, in no tier; an unused show can be deleted', async () => {
  const t4 = (await saved()).tiers[3];
  await body.locator(`.uv-tier[data-tier="${t4.id}"] .uv-ic[title="Remove"]`).click();
  await settle();
  await confirmYes();
  const after = await saved();
  await body.locator('.uv-tier.none .uv-trow .uv-main', { hasText: 'LFG' }).click();
  await settle();
  await btn(sheet, 'Delete the show').click();
  await settle();
  await confirmYes();
  const u = await saved();
  return [after.tiers.map(t => t.name), after.shows.some(x => x.id === lfgId), u.shows.some(x => x.id === lfgId), u.links.length, await sound()];
}, [['Main roster', 'NXT', 'Evolve'], true, false, 2, []]);
await check('the transition page shows the tiers and rules it keeps', async () => {
  const tr = (await saved()).transitions[0];
  await js(`uvOpenTransition('${tr.id}')`);
  await page.waitForTimeout(150);
  await body.locator('[data-part=rules]').click();
  await page.waitForTimeout(120);
  const cards = await js(`[...document.querySelectorAll('.uv-page .uv-conn[data-conn] .h b')].map(e => e.textContent)`);
  const lines = await js(`[...document.querySelectorAll('.uv-page .uv-conn[data-conn="link-main-nxt"] .uv-rules > div')].map(${TEXT})`);
  await body.locator('[data-part=relegation]').click();
  await page.waitForTimeout(80);
  return [cards, lines[3]];
}, [['Main roster ⇄ NXT', 'NXT ⇄ Evolve'], 'Their titles your call at each move']);
await check('a version 8 save imports whole: its transition, records and rules as they were, under the tiers', async () => {
  // the sample season as version 8 wrote it: four shows, no tiers, promotion on the transition
  const old = JSON.parse(JSON.stringify(sampleCycle().st));
  old.version = 8;
  delete old.tiers; delete old.links;
  old.shows = old.shows.filter(x => x.id !== 'evolve');
  old.transitions.forEach(t => { t.promotion = t.parts[0].qualifiers; delete t.parts; });
  old.events.forEach(e => e.matches.forEach(m => { if (m.qualifier) delete m.qualifier.link; }));
  old.eligibility.forEach(x => { delete x.link; });
  old.drafts.forEach(x => { delete x.link; x.titles.forEach(d => { delete d.rule; }); });
  old.relegations.forEach(x => { delete x.link; delete x.to; });
  await importState(old, 'v8.json');
  const u = await saved();
  const t = u.transitions[0];
  return [u.version, u.tiers.map(x => x.shows.join('+')), t.parts.length, JSON.stringify(t.parts[0].qualifiers) === JSON.stringify(old.transitions[0].promotion),
    u.relegations.map(r => r.to), u.drafts.length === old.drafts.length && u.eligibility.length === old.eligibility.length, await sound()];
}, [M.SCHEMA_VERSION, ['raw+smackdown+dynamite', 'nxt', 'evolve'], 1, true, ['nxt', 'nxt', 'nxt'], true, []]);
await check('layout anchored', anchored, isAnchored);

// ================================================================ the auto booker
// The booking sample (universe-sample.mjs): week 5 to book on every show, each
// with a story going on - feuds, friends, factions, an upset, someone never
// booked, a call-up, one injured and one away - plus LFG, a show added later
// in a tier of its own.
const bk = bookingSample();
const draftOn = (u, showId) => u.events.find(e => e.kind === 'weekly' && e.showId === showId && e.at.week === 5);
const people = m => m.sides.flatMap(sd => sd.wrestlers);
const dmCards = () => js(`[...document.querySelectorAll('.uv-page .uv-mc.draft')].map(c => ({ id: c.dataset.dm,
  st: c.querySelector('.st').textContent, why: (c.querySelector('.uv-why') || {}).textContent || '' }))`);
const dmCard = i => body.locator('.uv-page .uv-mc.draft').nth(i);
await check('auto booker: draft week 5 — every show planned and drafted, LFG too, and nothing booked', async () => {
  await importState(bk.st, 'booking.json');
  await page.click('#uvTabs [data-uvtab=calendar]');
  await body.locator('.uv-weekdraft').click();
  await settle();
  const rows = await js(`[...document.querySelectorAll('#uvSheetBody .uv-planrow .nm')].map(e => e.textContent)`);
  await btn(sheet, /^\s*Draft 6 cards\s*$/).click();
  await settle();
  const u = await saved();
  const wk = u.events.filter(e => e.at.week === 5 && e.kind === 'weekly');
  const nights = await js(`[...document.querySelectorAll('.uv-night[data-ev] .sub')].map(e => e.textContent)`);
  return [rows, (await toast()).t, wk.length, wk.every(e => e.draft && e.draft.matches.length && !e.matches.length), nights[0], await sound()];
}, r => JSON.stringify(r[0]) === JSON.stringify(['Raw · Week 5', 'NXT · Week 5', 'Dynamite · Week 5', 'Evolve · Week 5', 'LFG · Week 5', 'SmackDown · Week 5'])
  && /^6 cards drafted — each waits on its show’s page until you book it/.test(r[1]) && r[2] === 6 && r[3] === true
  && r[4] === 'Draft card: 6 matches — not booked yet' && r[5].length === 0);
await check('a show’s draft: every match with why, nobody twice, nobody injured, away or on another show', async () => {
  await openShow('Raw');
  const u = await saved();
  const ev = draftOn(u, 'raw');
  const ids = ev.draft.matches.flatMap(people);
  const names = ids.map(id => u.wrestlers.find(w => w.id === id));
  const cards = await dmCards();
  return [await js(`${TEXT}(document.querySelector('.uv-evhead .st'))`), cards.length, cards.every(c => /^Why /.test(c.why)),
    new Set(ids).size === ids.length, names.every(w => w.showId === 'raw' && w.status === 'active'),
    ev.draft.matches.every(m => m.auto && m.auto.why.length && m.outcome === undefined)];
}, ['Draft card waiting — nothing booked yet', 6, true, true, true, true]);
let rawDraft = null;
await check('edit a drafted match: saved to the draft as yours, marked changed', async () => {
  await dmCard(1).locator('.uv-btn', { hasText: 'Edit' }).click();
  await settle();
  const title = await js(`document.getElementById('uvSheetTitle').textContent`);
  const why = await js(`${TEXT}(document.querySelector('#uvSheetBody .uv-why'))`);
  await sheet.locator('#uvMStip').fill('Ladder');
  await btn(sheet, 'Save to the draft').click();
  await settle();
  rawDraft = draftOn(await saved(), 'raw').draft;
  return [title, /^Drafted because /.test(why), rawDraft.matches[1].stip, rawDraft.matches[1].auto.edited, (await dmCards())[1].st, (await toast()).t];
}, ['Edit the draft match', true, 'Ladder', true, 'Draft · changed', 'Saved to the draft']);
await check('take one off and move one: it won’t be drawn again for this show', async () => {
  const gone = rawDraft.matches[3], first = rawDraft.matches[0].id;
  await dmCard(3).locator('.uv-ic[title="Take it off the draft"]').click();
  await page.waitForTimeout(120);
  await dmCard(0).locator('.uv-ic[title="Move down"]').click();
  await page.waitForTimeout(120);
  const d = draftOn(await saved(), 'raw').draft;
  rawDraft = d;
  return [d.matches.length, d.passed.includes(gone.auto.key), d.matches[1].id === first, await sound()];
}, [5, true, true, []]);
await check('draw one match again: something else in the same place, the rest untouched', async () => {
  const before = rawDraft.matches;
  await dmCard(2).locator('.uv-btn', { hasText: 'Draw again' }).click();
  await page.waitForTimeout(150);
  const t = await toast();
  const after = draftOn(await saved(), 'raw').draft;
  const same = i => JSON.stringify(after.matches[i]) === JSON.stringify(before[i]);
  rawDraft = after;
  return [/^Drawn again — /.test(t.t), after.matches.length, after.matches[2].id !== before[2].id, after.matches[2].auto.key !== before[2].auto.key,
    after.passed.includes(before[2].auto.key), [0, 1, 3, 4].every(same), await sound()];
}, [true, 5, true, true, true, true, []]);
await check('add your own match: on the draft as yours, flagged where it needs a look', async () => {
  await body.locator('.uv-page .uv-add', { hasText: 'Add your own match' }).click();
  await settle();
  await side(0).locator('select[data-w="0"]').selectOption({ label: 'Punk' });
  await side(1).locator('select[data-w="0"]').selectOption({ label: 'Idle' });
  await btn(sheet, 'Add to the draft').click();
  await settle();
  const d = draftOn(await saved(), 'raw').draft;
  rawDraft = d;
  const cards = await dmCards();
  const warn = await js(`${TEXT}(document.querySelector('.uv-page .uv-mc.draft.own .uv-mc-d.warn'))`);
  return [d.matches.length, d.matches[5].auto, cards[5].st, warn, await sound()];
}, r => r[0] === 6 && r[1] === null && r[2] === 'Draft · yours' && /Punk is injured/.test(r[3]) && r[4].length === 0);
await check('not at this show: marked out, and their drafted matches drawn again without them', async () => {
  const u = await saved();
  const auto = rawDraft.matches.find(m => m.auto && !m.auto.edited);
  const who = u.wrestlers.find(w => w.id === people(auto)[0]);
  await body.locator('.uv-draft-out .uv-link', { hasText: 'Change' }).click();
  await settle();
  await sheet.locator('.uv-check', { hasText: new RegExp(`^\\s*${who.name}\\s*$`) }).locator('input').check();
  await btn(sheet, 'Save').click();
  await settle();
  const d = draftOn(await saved(), 'raw').draft;
  rawDraft = d;
  return [d.out, d.matches.filter(m => m.auto && !m.auto.edited).some(m => people(m).includes(who.id)), await js(`${TEXT}(document.querySelector('.uv-draft-out'))`), who.name];
}, r => r[0].length === 1 && r[1] === false && r[2] === `Not at this show: ${r[3]} Change`);
await check('draw the rest again: what you changed or added stays, where it was', async () => {
  const keep = rawDraft.matches.map((m, i) => [m, i]).filter(([m]) => !m.auto || m.auto.edited);
  await btn(body, /Draw the rest again/).click();
  await settle();
  const msg = await js(`document.getElementById('uvConfirmText').textContent`);
  await confirmYes();
  const d = draftOn(await saved(), 'raw').draft;
  rawDraft = d;
  return [/The 2 matches you changed or added stay as they are/.test(msg), d.nonce, keep.every(([m, i]) => d.matches[i] && d.matches[i].id === m.id),
    d.matches.filter(m => m.auto && !m.auto.edited).every(m => !people(m).some(id => d.out.includes(id))), await sound()];
}, [true, 1, true, true, []]);
await check('book this card: exactly the draft goes on the card, no results, each keeping why', async () => {
  const draft = JSON.parse(JSON.stringify(rawDraft.matches));
  await btn(body, /Book this card/).click();
  await settle();
  await confirmYes();
  const ev = draftOn(await saved(), 'raw');
  const lines = await js(`[...document.querySelectorAll('.uv-page .uv-mc.scheduled .uv-why')].map(e => e.textContent)`);
  return [ev.draft, ev.matches.length, ev.matches.every((m, i) => JSON.stringify([m.sides, m.titleId, m.stip, m.notes])
      === JSON.stringify([draft[i].sides, draft[i].titleId, draft[i].stip, draft[i].notes])),
    ev.matches.every(m => m.status === 'scheduled' && m.outcome === null && m.winner === null),
    ev.matches.map(m => (m.auto ? (m.auto.edited ? 'changed' : 'auto') : 'own')).join(','), lines.length, /^Auto-booked /.test(lines[0] || ''),
    (await toast()).t, await sound()];
}, r => r[0] === null && r[1] === 6 && r[2] && r[3] && /changed/.test(r[4]) && /own/.test(r[4]) && r[5] === 5 && r[6]
  && r[7] === '6 matches booked on Raw · Week 5' && r[8].length === 0);
await check('settings: each show its own card size and kinds — SmackDown down to 4, no singles', async () => {
  await goTo('Auto booker');
  const rows = await js(`[...document.querySelectorAll('.uv-page [data-booker]')].map(r => r.dataset.booker + ': ' + r.querySelector('.sub').textContent)`);
  await body.locator('[data-booker="smackdown"]').click();
  await settle();
  for (let i = 0; i < 2; i++) { await sheet.locator('[data-set="size"] .uv-ic').first().click(); await page.waitForTimeout(80); }
  await sheet.locator('[data-set="mix.singles"] [data-v="never"]').click();
  await page.waitForTimeout(80);
  await closeSheet();
  const u = await saved();
  return [rows, u.booker.shows.smackdown, await sound()];
}, r => r[0].length === 7 && r[0][0] === 'raw: 6 a week · 8 at a PLE · up to 1 title match · stipulations: settling feuds'
  && r[0].some(x => x.startsWith(`${bk.lfg.id}: 4 a week · 6 at a PLE`)) && r[0][6].startsWith('all: 10 matches')
  && JSON.stringify(r[1]) === JSON.stringify({ size: 4, mix: { singles: 'never' } }) && r[2].length === 0);
await check('SmackDown drawn again by its new settings: no singles — as many matches as 8 men and 4 women make', async () => {
  await openShow('SmackDown');
  await btn(body, /Draw the rest again/).click();
  await settle();
  await confirmYes();
  const u = await saved();
  const d = draftOn(u, 'smackdown').draft;
  return [d.matches.length, d.matches.map(m => M.matchKind(m).key).filter(k => k === 'singles').length, await sound()];
}, [3, 0, []]);
await check('discard a draft, then draft the card again from the show’s page', async () => {
  await openShow('NXT');
  await body.locator('.uv-draft-foot .uv-link', { hasText: 'Discard the draft' }).click();
  await settle();
  await confirmYes();
  const gone = draftOn(await saved(), 'nxt').draft;
  const row = await js(`${TEXT}(document.querySelector('.uv-page .uv-autorow'))`);
  await body.locator('.uv-page .uv-autorow').click();
  await page.waitForTimeout(150);
  const d = draftOn(await saved(), 'nxt').draft;
  const vacant = d.matches.find(m => m.titleId === bk.C.nxt.id);
  return [gone, /^Draft the card The auto booker suggests 5 matches/.test(row), d.matches.length, !!vacant && vacant.notes, await sound()];
}, [null, true, 4, 'For the vacant NXT Championship', []]);
await check('a version 9 save imports with nothing drafted and every show on its tier’s defaults', async () => {
  const old = JSON.parse(JSON.stringify(bookingSample().st));
  old.version = 9;
  delete old.booker;
  old.events.forEach(e => { delete e.draft; e.matches.forEach(m => { delete m.auto; }); });
  await importState(old, 'v9.json');
  const u = await saved();
  return [u.version, u.booker, u.events.every(e => e.draft === null && e.matches.every(m => m.auto === null)), await sound()];
}, [M.SCHEMA_VERSION, { shows: {}, all: {} }, true, []]);
await check('layout anchored', anchored, isAnchored);

// ================================================================ the booker reads the story
// The booking sample again, with a story on record after Raw week 4: Gunther
// attacked Cody, and Jey made the save. No premium live event ahead.
const sk = bookingSample();
M.deleteEvent(sk.st, sk.backlash.id);
const sk4 = sk.st.events.find(e => e.showId === 'raw' && e.at.week === 4);
const skAttack = M.recordIncident(sk.st, sk4.id, { kind: 'attack', by: [sk.id('Gunther')], on: [sk.id('Cody')], phase: 'post' });
M.recordIncident(sk.st, sk4.id, { kind: 'save', by: [sk.id('Jey')], on: [sk.id('Gunther')], helped: [sk.id('Cody')], phase: 'post' });
const whys = () => js(`[...document.querySelectorAll('.uv-page .uv-mc.draft .uv-why')].map(${TEXT})`);
await check('the story reaches the draft: the attack is why — and every match says why', async () => {
  await importState(sk.st, 'story-booking.json');
  await page.click('#uvTabs [data-uvtab=calendar]');
  await body.locator('.uv-weekdraft').click();
  await settle();
  await btn(sheet, /Draft \d+ cards/).click();
  await settle();
  await openShow('Raw');
  const w = await whys();
  const ev = draftOn(await saved(), 'raw');
  const revenge = ev.draft.matches.find(m => m.auto && m.auto.why[0].startsWith('Revenge: Gunther attacked Cody last week'));
  return [w.some(x => x.startsWith('Why Revenge: Gunther attacked Cody last week')), w.length === ev.draft.matches.length,
    !!revenge && revenge.auto.events.includes(skAttack.id), await sound()];
}, [true, true, true, []]);
await check('a story event after the draft: the draft says what’s new, and drawing the rest again takes it in', async () => {
  await btn(body, 'Record something yourself').click();
  await settle();
  await sheet.locator('.uv-pill[data-v=confrontation]').click();
  await page.waitForTimeout(80);
  await page.selectOption('#uvSheetBody select[data-by="0"]', await idOf('Becky'));
  await page.selectOption('#uvSheetBody select[data-on="0"]', await idOf('Rhea'));
  await page.waitForTimeout(80);
  const pre = await js(`(document.querySelector('#uvSheetBody .uv-seg .on') || { dataset: {} }).dataset.v`);
  if (pre !== 'pre') await sheet.locator('.uv-seg [data-v=pre]').click();
  await btn(sheet, 'Record it').click();
  await settle();
  const note = await js(`${TEXT}(document.querySelector('.uv-page .uv-draft-since'))`);
  await body.locator('.uv-draft-since .uv-link', { hasText: 'Draw the rest again' }).click();
  await settle();
  await confirmYes();
  const ev = draftOn(await saved(), 'raw');
  const tonight = ev.draft.matches.find(m => m.auto && m.auto.why[0] === 'Becky confronted Rhea before the show tonight — the match is tonight');
  return [/^Since this draft: Becky confronted Rhea \(Raw · Week 5, before the show\)\. Draw the rest again/.test(note), !!tonight,
    await js(`!!document.querySelector('.uv-page .uv-draft-since')`), await sound()];
}, [true, true, false, []]);
await check('storylines: on the auto booker page, and on the page for the two of them — with who stands with whom, and why', async () => {
  await goTo('Auto booker');
  const rows = await js(`[...document.querySelectorAll('.uv-page [data-story]')].map(${TEXT})`);
  const cg = rows.find(r => /^Cody vs Gunther /.test(r));
  await body.locator('.uv-page [data-story]', { hasText: /^\s*Cody vs Gunther/ }).first().click();
  await page.waitForTimeout(150);
  const block = await js(`${TEXT}(document.querySelector('.uv-page [data-storyline]'))`);
  return [!!cg && /heat \d/.test(cg), await pageKind(), /Standing with Cody: Jey — made the save for Cody against Gunther at Raw · Week 4/.test(block), block];
}, r => r[0] && r[1] === 'pair' && r[2]);
await check('undo the story event: the drafted match it followed says so', async () => {
  await openShow('Raw', 4);
  await page.locator('.uv-page .uv-wh[data-kind=attack]').first().click();
  await settle();
  await btn(sheet, /^\s*Undo it/).click();
  await settle();
  await confirmYes();
  const gone = !(await saved()).events.some(e => e.incidents.some(x => x.id === skAttack.id));
  await openShow('Raw', 5);
  const warns = await js(`[...document.querySelectorAll('.uv-page .uv-mc.draft .uv-mc-d.warn')].map(${TEXT})`);
  return [gone, warns.some(w => /The story event it followed has been undone/.test(w)), await sound()];
}, [true, true, []]);
await check('layout anchored', anchored, isAnchored);

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
