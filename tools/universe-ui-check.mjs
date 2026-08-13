#!/usr/bin/env node
// Interaction checks for the Universe dashboard.
//
// Usage: node tools/universe-ui-check.mjs [url]     (defaults to the dist build)
//
// tools/universe-check.mjs already proves the data layer replays correctly.
// This proves the page in front of it: that typing a card previews it, saving
// writes it, and — the one that matters — that correcting a result from the log
// moves the roster and the belts on every other tab. State that only looks
// right until you switch tabs is the failure mode worth catching here.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const url = process.argv[2] || 'file://' + process.cwd() + '/dist/universe.html';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + String(e).split('\n')[0]));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 120)); });

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.evaluate(`localStorage.clear()`);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);

let pass = 0, fail = 0;
const failures = [];
async function check(label, code, want) {
  const got = await page.evaluate(code).catch(e => 'ERR: ' + e.message);
  const ok = typeof want === 'function' ? want(got) : JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(46)} ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
  if (!ok) failures.push(label);
  await page.waitForTimeout(60);
}
const tab = id => `document.querySelector('[data-tab=${id}]').click()`;

// ---------------------------------------------------------------- boot
await check('seeds itself on first load', `UNIVERSE.store.stats().wrestlers`, 53);
await check('seed wrote events, not state', `UNIVERSE.store.stats().live > 60`, true);
await check('tabs render', `document.querySelectorAll('.tab').length`, 5);
await check('lands on the entry tab', `document.querySelector('.tab.on').dataset.tab`, 'tonight');
await check('card box is focused for typing', `document.activeElement.id`, 'cardText');

// ---------------------------------------------------------------- roster
await check('roster tab draws a table per brand', `${tab('roster')};
  document.querySelectorAll('#pane-roster table').length`, 5);
await check('Raw roster is populated', `[...document.querySelectorAll('#pane-roster .brandhead')]
  .map(e => e.querySelector('.nm').textContent)`, r => r[0] === 'Raw');
await check('free agents are listed apart', `[...document.querySelectorAll('#pane-roster .brandhead .nm')]
  .map(e => e.textContent).includes('Free agents')`, true);
await check('roster shows title chips', `document.querySelectorAll('#pane-roster .chip.title').length > 8`, true);
await check('roster shows a relegation flag', `document.querySelectorAll('#pane-roster .chip.down').length`, 1);

// ---------------------------------------------------------------- titles
await check('titles tab lists every belt', `${tab('titles')};
  document.querySelectorAll('.belt').length`, 10);
await check('champion shown on the belt', `document.querySelector('.belt .holder').textContent.trim()`, 'Cody Rhodes');
await check('belt opens its lineage', `document.querySelector('.belt').click();
  document.querySelector('#sheet').classList.contains('on')`, true);
await check('lineage sheet has the reign', `document.querySelectorAll('#sheetBody tbody tr').length`, 1);
await check('escape closes the sheet', `document.getElementById('sheetClose').click();
  document.querySelector('#sheet').classList.contains('on')`, false);

// ---------------------------------------------------------------- card entry
const CARD = `Monday Night Raw / 2026-08-17 / Raw
Damian Priest d. Gunther — World Heavyweight Championship, steel cage
The War Raiders d. Alpha Academy (tag, World Tag Team Championship)
Rhea d. Liv (submission)
* Solo Sikoa attacks Cody Rhodes after the main event`;

const type = async text => {
  await page.evaluate(t => {
    const box = document.getElementById('cardText');
    box.value = t;
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
  await page.waitForTimeout(120);
};

await page.evaluate(tab('tonight'));
await type('Raw / 2026-08-17 / Raw\nNobody Real d. Cody Rhodes');
await check('unknown name blocks the save', `document.getElementById('cardSave').disabled`, true);
await check('and says which line is wrong', `document.querySelector('#cardPreview .msg.err').textContent.includes('line 2')`, true);

await type('Raw / 2026-08-17 / Raw\nUso d. Cody Rhodes');
await check('ambiguous name blocks the save', `document.getElementById('cardSave').disabled`, true);
await check('and offers the candidates', `/Jimmy Uso|Jey Uso/.test(document.querySelector('#cardPreview').textContent)`, true);

await type(CARD);
await check('good card previews every segment', `document.querySelectorAll('#cardPreview tbody tr').length`, 4);
await check('team name expanded in the preview', `document.querySelectorAll('#cardPreview tbody tr')[1].textContent.includes('Erik')`, true);
await check('title change flagged in the preview', `!!document.querySelector('#cardPreview .chip.new')`, true);
await check('save is enabled', `document.getElementById('cardSave').disabled`, false);

await check('saving writes the card', `document.getElementById('cardSave').click();
  UNIVERSE.store.stats().byType.match`, 3);
await check('box is cleared for the next show', `document.getElementById('cardText').value`, '');
await check('and it says what was saved', `!!document.querySelector('#pane-tonight .msg.ok')`, true);
await check('show appears on the shows tab', `${tab('shows')};
  document.querySelectorAll('#pane-shows .card').length`, 1);
await check('with every segment on the card', `document.querySelectorAll('#pane-shows tbody tr').length`, 4);

// ---------------------------------------------------------------- the fold
await check('title moved to the new champion', `${tab('titles')};
  [...document.querySelectorAll('.belt')].find(b => b.textContent.includes('World Heavyweight')).querySelector('.holder').textContent.trim()`, 'Damian Priest');
await check('defense counted on the tag belts', `[...document.querySelectorAll('.belt')]
  .find(b => b.textContent.includes('World Tag Team')).textContent.includes('1 defense')`, true);
await check('records show on the roster', `${tab('roster')};
  UNIVERSE.app.state.wrestlers['w:damian-priest'].record.w`, 1);

// ---------------------------------------------------------------- corrections
await check('log lists the new events', `${tab('log')};
  document.querySelectorAll('#pane-log .logrow').length > 4`, true);
await check('opening a match shows both corners', `[...document.querySelectorAll('[data-ev]')]
  .find(b => b.closest('tr').textContent.includes('Gunther')).click();
  document.querySelectorAll('#sheetBody [data-winner]').length`, 2);
await check('correcting the result is one click', `[...document.querySelectorAll('#sheetBody [data-winner]')]
  .find(b => !b.disabled).click();
  UNIVERSE.store.doc.corrections.length`, 1);
await check('the title goes back with it', `${tab('titles')};
  [...document.querySelectorAll('.belt')].find(b => b.textContent.includes('World Heavyweight')).querySelector('.holder').textContent.trim()`, 'Gunther');
await check('the loser record follows', `UNIVERSE.app.state.wrestlers['w:damian-priest'].record`,
  r => r.w === 0 && r.l === 1);
await check('the reign is continuous again', `UNIVERSE.app.state.championships['c:world-heavyweight-championship'].reigns.length`, 1);
await check('and the correction is logged', `${tab('log')};
  document.querySelectorAll('#pane-log table')[1].querySelectorAll('tbody tr').length`, 1);

await check('voiding an event greys it out', `document.querySelector('[data-void]').click();
  document.querySelectorAll('#pane-log .logrow.voided').length`, 1);
await check('voided event drops out of the fold', `UNIVERSE.store.stats().voided`, 1);
await check('restoring brings it back', `document.querySelector('[data-restore]').click();
  UNIVERSE.store.stats().voided`, 0);

// ---------------------------------------------------------------- time travel
await check('as-of date rewinds the whole page', `const i = document.getElementById('asOf');
  i.value = '2026-08-16'; i.dispatchEvent(new Event('change', {bubbles:true}));
  UNIVERSE.app.state.wrestlers['w:damian-priest'].record.total`, 0);
await check('past state is marked in the header', `document.getElementById('asOfWrap').classList.contains('past')`, true);
await check('back to now restores it', `document.getElementById('asOfNow').click();
  UNIVERSE.app.state.wrestlers['w:damian-priest'].record.total`, 1);

// ---------------------------------------------------------------- persistence
await check('everything survives a reload', `localStorage.getItem('arc_universe_v1').length > 1000`, true);
const beforeReload = await page.evaluate(`({ events: UNIVERSE.store.stats().live, cx: UNIVERSE.store.doc.corrections.length })`);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);
await check('reload keeps every event', `UNIVERSE.store.stats().live`, beforeReload.events);
await check('reload keeps every correction', `UNIVERSE.store.doc.corrections.length`, beforeReload.cx);
await check('and does not re-seed on top', `UNIVERSE.store.stats().wrestlers`, 53);
await check('the saved show is still there', `UNIVERSE.app.state.shows.length`, 1);
await check('fantasy app storage untouched', `localStorage.getItem('cbd_team_v1')`, null);

// ---------------------------------------------------------------- roster import
await check('roster paste previews the diff', `${tab('roster')};
  const t = document.getElementById('rosterText');
  t.value = 'RAW\\nAlba Fyre, f, active\\nSeth Rollins, m, active';
  t.dispatchEvent(new Event('input', {bubbles:true}));
  document.querySelector('#rosterPreview .msg.ok').textContent.includes('Alba Fyre')`, true);
await check('import writes only the difference', `document.getElementById('rosterSave').click();
  UNIVERSE.store.stats().wrestlers`, 54);
await check('the new signing is on the brand', `UNIVERSE.app.state.brands['b:raw'].roster.includes('w:alba-fyre')`, true);
await check('re-pasting the same list is a no-op', `const t = document.getElementById('rosterText');
  t.value = 'RAW\\nAlba Fyre, f, active\\nSeth Rollins, m, active';
  t.dispatchEvent(new Event('input', {bubbles:true}));
  document.getElementById('rosterSave').disabled`, true);

// Stills for eyeballing the result. snapshots/ is gitignored.
await mkdir('snapshots', { recursive: true });
await page.evaluate(tab('tonight'));
await type(CARD);
await page.screenshot({ path: 'snapshots/universe-entry.png' });
await page.evaluate(tab('roster'));
await page.screenshot({ path: 'snapshots/universe-roster.png' });
await page.evaluate(tab('titles'));
await page.screenshot({ path: 'snapshots/universe-titles.png' });
await browser.close();

console.log(`\n${pass} passed, ${fail} failed, ${errors.length} page errors`);
if (failures.length) console.log('failed: ' + failures.join(', '));
if (errors.length) console.log(errors.slice(0, 8).join('\n'));
process.exit(fail || errors.length ? 1 : 0);
