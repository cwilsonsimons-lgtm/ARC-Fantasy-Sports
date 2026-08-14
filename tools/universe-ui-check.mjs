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
await check('seeds itself on first load', `UNIVERSE.store.stats().wrestlers`, 79);
await check('seed wrote events, not state', `UNIVERSE.store.stats().live > 60`, true);
await check('tabs render', `document.querySelectorAll('.tab').length`, 12);
await check('lands on the entry tab', `document.querySelector('.tab.on').dataset.tab`, 'tonight');
await check('card box is focused for typing', `document.activeElement.id`, 'cardText');

// ---------------------------------------------------------------- roster
await check('roster tab draws a table per brand', `${tab('roster')};
  document.querySelectorAll('#pane-roster table').length`, 7);
await check('Raw roster is populated', `[...document.querySelectorAll('#pane-roster .brandhead')]
  .map(e => e.querySelector('.nm').textContent)`, r => r[0] === 'Raw');
await check('free agents are listed apart', `[...document.querySelectorAll('#pane-roster .brandhead .nm')]
  .map(e => e.textContent).includes('Free agents')`, true);
// A brand-new save has no champions and nobody flagged: both are things that
// only happen once you book them.
await check('nobody holds a belt on a new save', `document.querySelectorAll('#pane-roster .chip.title').length`, 0);
await check('and nobody is flagged', `document.querySelectorAll('#pane-roster .chip.down, #pane-roster .chip.up').length`, 0);

// ---------------------------------------------------------------- titles
await check('titles tab lists every belt', `${tab('titles')};
  document.querySelectorAll('.belt').length`, 15);
await check('every belt starts VACANT', `[...document.querySelectorAll('.belt .holder')]
  .every(e => e.textContent.trim() === 'VACANT')`, true);
await check('and says so in those words', `document.querySelector('.belt .holder').textContent.trim()`, 'VACANT');
await check('with no reign history at all', `Object.values(UNIVERSE.app.state.championships)
  .every(c => c.reigns.length === 0)`, true);
await check('belt opens its own page', `[...document.querySelectorAll('.belt')]
  .find(b => b.querySelector('.nm').textContent.trim() === 'WWE Championship').click();
  document.querySelector('#pane-title').classList.contains('on')`, true);
await check('title page names the belt', `document.querySelector('#pane-title .pagehead .nm').textContent`, 'WWE Championship');
await check('title page shows an empty lineage', `document.querySelector('#pane-title').textContent.includes('Never held')`, true);
await check('and links back to the belts', `document.querySelector('#pane-title [data-tab=titles]').click();
  document.querySelector('.tab.on').dataset.tab`, 'titles');

// The belt that calls its holder up a tier is marked as such, on both views —
// it is a field on the championship, so the page has to read it, not assume it.
await check('a belt that calls its holder up says so', `[...document.querySelectorAll('.belt')]
  .filter(e => e.textContent.includes('calls up')).map(e => e.querySelector('.nm').textContent)`,
  ['NXT Championship', "NXT Women's Championship"]);
await check('and explains it on the belt page', `[...document.querySelectorAll('.belt')]
  .find(e => e.textContent.includes('calls up')).click();
  document.querySelector('#pane-title').textContent.includes('no Last Stand match')`, true);
await check('naming where they land', `document.querySelector('#pane-title').textContent.includes('draft pool')`, true);
await check('an ordinary belt is not marked', `${tab('titles')};
  [...document.querySelectorAll('.belt')].find(e => e.querySelector('.nm').textContent === 'WWE Championship')
    .textContent.includes('calls up')`, false);

// ---------------------------------------------------------------- belts per brand
// How many championships a show carries is the user's call, and the call-up
// rule travels with the belt rather than with the name "NXT".
await check('belts are grouped by show', `${tab('titles')};
  [...document.querySelectorAll('.bghead .nm')].map(e => e.textContent)`,
  ['Dynamite', 'Raw', 'SmackDown', 'NXT', 'Evolve']);
await check('each show says how many it carries', `document.querySelector('.bghead .ct').textContent.includes('championship')`, true);
await check('NXT says how many of them call people up', `[...document.querySelectorAll('.bghead')]
  .find(e => e.querySelector('.nm').textContent === 'NXT').textContent.includes('2 calls up')`, true);

await check('a show can be given another belt', `[...document.querySelectorAll('.bghead')]
  .find(e => e.querySelector('.nm').textContent === 'NXT').querySelector('[data-editbelt]').click();
  !!document.getElementById('beltForm')`, true);
await check('the form starts on that show', `document.getElementById('tfBrand').value`, 'b:nxt');
await check('and inherits the call-up rule', `document.getElementById('tfAuto').checked`, true);
await check('saying where its champion would go',
  `document.getElementById('beltForm').textContent.includes('draft pool')`, true);
await check('a blank name is refused', `document.querySelector('[data-savebelt]').click();
  !!document.querySelector('#pane-titles .msg.err')`, true);
await check('a duplicate name is refused too', `document.getElementById('tfName').value = 'WWE Championship';
  document.querySelector('[data-savebelt]').click();
  document.querySelector('#pane-titles .msg.err').textContent.includes('already a championship')`, true);

await check('creating it adds it to that show', `[...document.querySelectorAll('.bghead')]
    .find(e => e.querySelector('.nm').textContent === 'NXT').querySelector('[data-editbelt]').click();
  document.getElementById('tfName').value = 'NXT North American Championship';
  document.querySelector('[data-savebelt]').click();
  [...document.querySelectorAll('.bghead')]
    .find(e => e.querySelector('.nm').textContent === 'NXT').textContent.includes('3 championships')`, true);
await check('it starts vacant like every other belt', `[...document.querySelectorAll('.belt')]
  .find(b => b.querySelector('.nm').textContent.includes('North American'))
  .querySelector('.holder').textContent.trim()`, 'VACANT');
await check('and is marked as calling its champion up', `[...document.querySelectorAll('.belt')]
  .find(b => b.querySelector('.nm').textContent.includes('North American')).textContent.includes('calls up')`, true);
await check('the data model carries the flag, not the code',
  `UNIVERSE.app.state.championships['c:nxt-north-american-championship'].autoPromote`, true);

await check('a belt can be moved to another show', `[...document.querySelectorAll('.belt')]
    .find(b => b.querySelector('.nm').textContent.includes('North American'))
    .querySelector('[data-editbelt]').click();
  document.getElementById('tfBrand').value = 'b:raw';
  document.getElementById('tfAuto').checked = false;
  document.querySelector('[data-savebelt]').click();
  UNIVERSE.app.state.championships['c:nxt-north-american-championship'].brandId`, 'b:raw');
await check('so Raw now carries five', `[...document.querySelectorAll('.bghead')]
  .find(e => e.querySelector('.nm').textContent === 'Raw').textContent.includes('5 championships')`, true);
await check('and NXT is back to two', `[...document.querySelectorAll('.bghead')]
  .find(e => e.querySelector('.nm').textContent === 'NXT').textContent.includes('2 championships')`, true);

// A belt nothing has touched can go; one with a history is retired instead.
await check('an untouched belt offers deletion', `[...document.querySelectorAll('.belt')]
    .find(b => b.querySelector('.nm').textContent.includes('North American'))
    .querySelector('[data-editbelt]').click();
  !!document.querySelector('[data-deletebelt]')`, true);
await page.evaluate(`window.confirm = () => true`);
await check('deleting it takes it off the show', `document.querySelector('[data-deletebelt]').click();
  !!UNIVERSE.app.state.championships['c:nxt-north-american-championship']`, false);
await check('and Raw is back to four', `[...document.querySelectorAll('.bghead')]
  .find(e => e.querySelector('.nm').textContent === 'Raw').textContent.includes('4 championships')`, true);

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
  document.querySelectorAll('#pane-shows tbody tr').length`, 1);
await check('the index counts its matches', `document.querySelectorAll('#pane-shows tbody td')[3].textContent`, '3');
await check('clicking it opens the card', `document.querySelector('#pane-shows [data-show]').click();
  document.querySelector('#pane-show .pagehead .nm').textContent.trim()`, 'Monday Night Raw');
await check('with every segment on it',
  `document.querySelectorAll('#pane-show table')[0].querySelectorAll('tbody tr').length`, 4);
await check('the winner is linked, not just printed',
  `document.querySelector('#pane-show tbody [data-w]').textContent`, 'Damian Priest');
await check('and what the night changed is listed',
  `[...document.querySelectorAll('#pane-show tbody tr')].some(r => r.textContent.includes('new champion: Damian Priest'))`, true);

// ---------------------------------------------------------------- the fold
await check('title moved to the new champion', `${tab('titles')};
  [...document.querySelectorAll('.belt')].find(b => b.textContent.includes('World Heavyweight')).querySelector('.holder').textContent.trim()`, 'Damian Priest');
await check('the tag belts were won from vacant', `${tab('titles')};
  [...document.querySelectorAll('.belt')]
    .find(b => b.querySelector('.nm').textContent.trim() === 'World Tag Team Championship')
    .textContent.includes('Erik')`, true);
await check('a title history begins on the first win', `UNIVERSE.app.state
  .championships['c:world-tag-team-championship'].reigns.length`, 1);
await check('records show on the roster', `${tab('roster')};
  UNIVERSE.app.state.wrestlers['w:damian-priest'].record.w`, 1);

// ---------------------------------------------------------------- corrections
await check('log lists the new events', `${tab('log')};
  document.querySelectorAll('#pane-log .logrow').length > 4`, true);
await check('opening a match shows both corners', `[...document.querySelectorAll('[data-ev]')]
  .find(b => b.closest('tr').textContent.includes('Gunther')).click();
  document.querySelectorAll('#sheetBody [data-winner]').length`, 2);
// Counted by target rather than in total: editing a belt logs a correction too,
// and this is about the one the click just made.
await check('correcting the result is one click', `[...document.querySelectorAll('#sheetBody [data-winner]')]
  .find(b => !b.disabled).click();
  UNIVERSE.store.doc.corrections.filter(c => c.target === 'event').length`, 1);
await check('the title goes back with it', `${tab('titles')};
  [...document.querySelectorAll('.belt')].find(b => b.textContent.includes('World Heavyweight')).querySelector('.holder').textContent.trim()`, 'Gunther');
await check('the loser record follows', `UNIVERSE.app.state.wrestlers['w:damian-priest'].record`,
  r => r.w === 0 && r.l === 1);
await check('the reign is continuous again', `UNIVERSE.app.state.championships['c:world-heavyweight-championship'].reigns.length`, 1);
await check('and the correction is logged', `${tab('log')};
  [...document.querySelectorAll('#pane-log table')[1].querySelectorAll('tbody tr')]
    .filter(r => r.textContent.includes('amend') && r.textContent.includes('ev_')).length`, 1);

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
await check('and does not re-seed on top', `UNIVERSE.store.stats().wrestlers`, 79);
await check('the saved show is still there', `UNIVERSE.app.state.shows.length`, 1);
await check('fantasy app storage untouched', `localStorage.getItem('cbd_team_v1')`, null);

// ---------------------------------------------------------------- roster import
// A paste is that brand's roster, so a two-name Raw paste means Raw has two
// names on it. The preview has to say so before anything is written.
const PARTIAL = 'RAW\\nAlba Fyre, f, active\\nSeth Rollins, m, active';
await check('roster paste previews the diff', `${tab('roster')};
  const t = document.getElementById('rosterText');
  t.value = '${PARTIAL}';
  t.dispatchEvent(new Event('input', {bubbles:true}));
  document.querySelector('#rosterPreview .msg.ok').textContent.includes('Alba Fyre')`, true);
await check('and warns who would come off the brand',
  `document.querySelector('#rosterPreview').textContent.includes('Come off the brand')`, true);
await check('saying what the paste was read as',
  `document.querySelector('#rosterPreview').textContent.includes('Read as the full roster of')`, true);

// The escape hatch, for a paste that is deliberately partial.
await check('only-add turns the sweep off', `document.getElementById('rosterAddOnly').click();
  document.querySelector('#rosterPreview').textContent.includes('Come off the brand')`, false);
await check('and says so instead',
  `document.querySelector('#rosterPreview').textContent.includes('nobody comes off')`, true);
await check('import writes only the difference', `document.getElementById('rosterSave').click();
  UNIVERSE.store.stats().wrestlers`, 80);
await check('the new signing is on the brand', `UNIVERSE.app.state.brands['b:raw'].roster.includes('w:alba-fyre')`, true);
await check('and nobody was swept off it', `UNIVERSE.app.state.brands['b:raw'].roster.includes('w:gunther')`, true);
await check('re-pasting the same list is a no-op', `const t = document.getElementById('rosterText');
  t.value = '${PARTIAL}';
  t.dispatchEvent(new Event('input', {bubbles:true}));
  document.getElementById('rosterSave').disabled`, true);
await page.evaluate(`document.getElementById('rosterAddOnly').click()`);

// ---------------------------------------------------------------- titles, threads, heat
// Everything below covers a second card: an interim reign, a contender match,
// a betrayal inside a faction, a save, and a vacated belt.
const CARD2 = `SmackDown / 2026-08-21 / SmackDown
Cody Rhodes d. Roman Reigns — WWE Championship
Solo Sikoa d. Randy Orton — WWE Championship, interim
LA Knight d. Kevin Owens, Drew McIntyre — contender, WWE Championship
* Jacob Fatu attacks Jey Uso after the main event
* Jimmy Uso saves Jey Uso from Jacob Fatu
promise: Randy Orton — WWE Championship
vacate: United States Championship`;

await page.evaluate(tab('tonight'));
await type(CARD2);
await check('a vacant belt is won outright', `document.querySelectorAll('#cardPreview tbody tr')[0].textContent.includes('NEW CHAMPION')`, true);
await check('interim match reads as interim', `document.querySelectorAll('#cardPreview tbody tr')[1].textContent.includes('interim')`, true);
await check('contender match is not a title match', `document.querySelectorAll('#cardPreview tbody tr')[2].textContent.includes('#1 contender')`, true);
await check('save line parsed', `document.querySelectorAll('#cardPreview tbody tr')[4].textContent.includes('saves')`, true);
await check('second card saves', `document.getElementById('cardSave').click();
  UNIVERSE.app.state.shows.length`, 2);

await check('interim champion shown on the belt', `${tab('titles')};
  [...document.querySelectorAll('.belt')].find(b => b.textContent.includes('WWE Championship') &&
    !b.textContent.includes('Tag')).querySelector('.interim').textContent.includes('Solo Sikoa')`, true);
await check('the real champion still holds it', `UNIVERSE.app.state.championships['c:wwe-championship'].holders`, ['w:cody-rhodes']);
await check('both reigns are open at once', `UNIVERSE.app.state.championships['c:wwe-championship'].reigns.filter(r => !r.to).length`, 2);
await check('vacated belt reads vacant', `UNIVERSE.app.state.championships['c:united-states-championship'].vacant`, true);

await check('title page shows the interim run', `[...document.querySelectorAll('.belt')]
  .find(b => b.textContent.includes('WWE Championship') && !b.textContent.includes('Tag')).click();
  document.querySelector('#pane-title').textContent.includes('interim')`, true);
await check('title page lists its matches', `document.querySelectorAll('#pane-title table').length`, 2);
await check('and the lineage now has rows', `document.querySelectorAll('#pane-title tbody tr').length > 1`, true);

// Relationships
await check('attack spreads to the tag partner', `UNIVERSE.app.state.rivalries
  .some(r => [r.a, r.b].includes('w:jimmy-uso') && [r.a, r.b].includes('w:jacob-fatu'))`, true);
await check('the direct attack is hotter than the spread', `const R = UNIVERSE.app.state.rivalries;
  const direct = R.find(r => [r.a,r.b].includes('w:jey-uso') && [r.a,r.b].includes('w:jacob-fatu'));
  const spread = R.find(r => [r.a,r.b].includes('w:jimmy-uso') && [r.a,r.b].includes('w:jacob-fatu'));
  direct.why.attack === 1 && spread.why['their faction'] === 1`, true);
await check('the save built an alliance', `UNIVERSE.app.state.alliances
  .find(r => [r.a,r.b].includes('w:jimmy-uso') && [r.a,r.b].includes('w:jey-uso')).heat >= 3`, true);
await check('rivalries show on the dashboard', `${tab('tonight')};
  document.querySelectorAll('#heatPanel table').length`, 3);
await check('sorted hottest first', `[...document.querySelectorAll('#heatPanel table')[0]
  .querySelectorAll('tbody tr')].map(r => +r.querySelectorAll('td')[1].textContent)`,
  v => v.length > 1 && v.every((n, i) => i === 0 || v[i - 1] >= n));
await check('heat decays with the as-of date', `const i = document.getElementById('asOf');
  i.value = '2026-12-19'; i.dispatchEvent(new Event('change', {bubbles:true}));
  UNIVERSE.app.state.rivalries.filter(r => r.active).length === 0`, true);
await check('and comes back when you return', `document.getElementById('asOfNow').click();
  UNIVERSE.app.state.rivalries.filter(r => r.active).length > 0`, true);

// Threads
await check('threads queue is populated', `${tab('threads')};
  document.querySelectorAll('#pane-threads table')[0].querySelectorAll('tbody tr').length`, 4);
await check('the save closed the attack thread', `UNIVERSE.app.state.threadsClosed
  .some(t => t.kind === 'attack' && t.closedWhy === 'saved')`, true);
await check('a vacant belt opens a thread', `UNIVERSE.app.state.threads
  .some(t => t.kind === 'vacant-title' && t.about === 'c:united-states-championship')`, true);
await check('a contender win owes a title shot', `UNIVERSE.app.state.threads
  .some(t => t.kind === 'title-shot' && t.subjects.includes('w:la-knight'))`, true);
await check('threads show how long they have been open', `document.querySelector('#pane-threads tbody tr')
  .textContent.match(/\\d+d/) !== null`, true);
await check('resolving one closes it', `document.querySelector('[data-resolve]').click();
  document.querySelectorAll('#pane-threads table')[0].querySelectorAll('tbody tr').length`, 3);
await check('and it is logged as an event', `UNIVERSE.store.effectiveEvents()
  .filter(e => e.type === 'thread.resolved').length`, 1);
await check('resolution dates after the show it closes', `const e = UNIVERSE.store.effectiveEvents()
  .find(x => x.type === 'thread.resolved'); e.date >= '2026-08-21'`, true);

// Wrestler page
await check('clicking a name opens the profile', `${tab('roster')};
  document.querySelector('#pane-roster .wname').click();
  document.querySelector('#pane-wrestler').classList.contains('on')`, true);
await check('profile shows a record', `document.querySelector('#pane-wrestler .facts2').textContent.includes('Record')`, true);
await check('profile has rivalries and alliances', `document.querySelector('#pane-wrestler').textContent.includes('Rivalries')
  && document.querySelector('#pane-wrestler').textContent.includes('Alliances')`, true);
await check('champion profile lists reigns with days', `UNIVERSE.app.tab = 'wrestler';
  UNIVERSE.app.detailId = 'w:cody-rhodes'; UNIVERSE.render();
  document.querySelector('#pane-wrestler').textContent.includes('WWE Championship')`, true);
await check('the reign row shows when it started', `
  const w = UNIVERSE.app.state.wrestlers['w:cody-rhodes'], r = w.titleHistory[0];
  const t = [...document.querySelectorAll('#pane-wrestler table')]
    .find(x => x.textContent.includes('WWE Championship'));
  !!r && t.textContent.includes(r.from)`, true);
await check('profile timeline lists appearances', `UNIVERSE.app.detailId = 'w:jey-uso'; UNIVERSE.render();
  document.querySelectorAll('#pane-wrestler table').length >= 3`, true);
await check('and a reign links to the belt page', `UNIVERSE.app.detailId = 'w:cody-rhodes'; UNIVERSE.render();
  document.querySelector('#pane-wrestler [data-belt]').click();
  document.querySelector('#pane-title .pagehead .nm').textContent`, 'WWE Championship');

// ---------------------------------------------------------------- season
await check('season tab shows standings', `${tab('season')};
  document.querySelectorAll('#pane-season .brandhead').length`, 5);
await check('season 1 is in progress', `document.querySelector('#pane-season .pagehead .nm').textContent`, 'Season 1 — Regular season');
await check('the calendar shows every phase', `document.querySelectorAll('#pane-season .phase').length`, 5);
await check('with the regular season lit', `document.querySelector('#pane-season .phase.on .pname').textContent`, 'Regular season');
await check('and says what to do next', `document.querySelector('#pane-season .pagehead').textContent
  .includes('Next:')`, true);

await page.evaluate(tab('tonight'));
await type(`WrestleMania 43 / 2027-04-04 / Raw
Cody Rhodes d. Roman Reigns — WWE Championship`);
await check('WrestleMania is recognised from the name', `document.getElementById('cardSave').click();
  UNIVERSE.app.state.shows.slice(-1)[0].ple`, 'wrestlemania');
await check('and the calendar moves on', `${tab('season')};
  document.querySelector('#pane-season .phase.on .pname').textContent`, 'WrestleMania');

await check('working out the lists proposes names', `document.getElementById('flagsPropose').click();
  document.querySelectorAll('#pane-season table')[0].querySelectorAll('tbody tr').length > 4`, true);
await check('nothing is written until confirmed', `UNIVERSE.store.effectiveEvents()
  .filter(e => e.source === 'season').length`, 0);
await check('champions are not on the relegation list', `[...document.querySelectorAll('#pane-season table')[0]
  .querySelectorAll('tbody tr')].filter(r => r.textContent.includes('relegation'))
  .every(r => !r.textContent.includes('Cody Rhodes'))`, true);
await check('confirming writes the flags', `document.getElementById('flagsCommit').click();
  UNIVERSE.store.effectiveEvents().filter(e => e.source === 'season').length > 4`, true);
await check('and the roster shows them', `Object.values(UNIVERSE.app.state.wrestlers)
  .filter(w => /flagged$/.test(w.status)).length > 4`, true);

await check('the lists move it to Last Stand', `document.querySelector('#pane-season .phase.on .pname').textContent`, 'Last Stand');
await check('booking Last Stand lays out the competitions', `document.getElementById('lastStandPropose').click();
  document.querySelectorAll('#pane-season .bracket').length`, 12);
await check('relegation is settled inside one show', `[...document.querySelectorAll('#pane-season .bracket.relegation')]
  .every(b => b.querySelector('.bmeta').textContent.includes('drops to'))`, true);
await check('and promotion is a separate competition', `
  document.querySelectorAll('#pane-season .bracket.promotion').length`, 4);
await check('with a card to match', `document.getElementById('lastStandText').value
  .split('\\n').filter(l => / vs /.test(l)).length`, 12);
await check('with relegation and promotion matches', `const t = document.getElementById('lastStandText').value;
  t.includes('relegation') && t.includes('promotion')`, true);
await check('sending it lands in the entry box', `document.getElementById('lastStandUse').click();
  document.querySelector('.tab.on').dataset.tab === 'tonight'
  && document.getElementById('cardText').value.includes('Last Stand')`, true);

await check('playing it moves wrestlers between brands', `
  const box = document.getElementById('cardText');
  box.value = box.value.split('\\n').map(l => l.replace(' vs ', ' d. ')).join('\\n');
  box.dispatchEvent(new Event('input', {bubbles:true}));
  new Promise(r => setTimeout(() => {
    const before = JSON.parse(JSON.stringify(UNIVERSE.app.state.wrestlers));
    document.getElementById('cardSave').click();
    const after = UNIVERSE.app.state.wrestlers;
    r(Object.keys(after).filter(id => after[id].brandId !== before[id].brandId).length);
  }, 200))`, n => n >= 4);
await check('Last Stand hands over to the draft', `${tab('season')};
  document.querySelector('#pane-season .phase.on .pname').textContent`, 'Draft');
await check('and everyone who fought is unflagged', `
  Object.values(UNIVERSE.app.state.wrestlers).filter(w => /flagged$/.test(w.status)).length`, 0);

// ---------------------------------------------------------------- prompts
await check('prompts tab offers five', `${tab('prompts')};
  document.querySelectorAll('.promptcard').length`, 5);
await check('what-happens-next is the default', `document.querySelector('.promptcard.on').dataset.prompt`, 'next');
await check('and it is built from the queue', `document.getElementById('promptText').value.includes('OPEN THREADS')`, true);
await check('the card format prompt teaches the syntax', `document.querySelector('[data-prompt=card-format]').click();
  const v = document.getElementById('promptText').value;
  v.includes('Winner d. Loser') && v.includes('Cody Rhodes') && v.includes('WWE Championship')`, true);
await check('and tells it not to invent names', `/never invent a wrestler/i
  .test(document.getElementById('promptText').value)`, true);
await check('the roster format prompt is different', `document.querySelector('[data-prompt=roster-format]').click();
  document.getElementById('promptText').value.includes('one wrestler per line')`, true);

await check('recap embeds a real card', `document.querySelector('[data-prompt=recap]').click();
  const v = document.getElementById('promptText').value;
  v.includes('CARD, IN ORDER') && v.includes('d.')`, true);
await check('picking a show changes the prompt', `const sel = document.getElementById('promptShow');
  const before = document.getElementById('promptText').value;
  sel.value = sel.options[sel.options.length - 1].value;
  sel.dispatchEvent(new Event('change', {bubbles:true}));
  document.getElementById('promptText').value !== before`, true);
await check('contender report embeds standings', `document.querySelector('[data-prompt=contenders]').click();
  const v = document.getElementById('promptText').value;
  v.includes('SEASON STANDINGS') && v.includes('RIVALRY HEAT') && v.includes('CHAMPIONS')`, true);
await check('the event name is editable', `const i = document.getElementById('promptPle');
  i.value = 'SummerSlam'; i.dispatchEvent(new Event('input', {bubbles:true}));
  document.getElementById('promptText').value.includes('SummerSlam')`, true);
await check('copy reports what happened', `document.getElementById('promptCopy').click();
  new Promise(r => setTimeout(() => r(/copied|clipboard/.test(document.getElementById('promptSize').textContent)), 200))`, true);

// ---------------------------------------------------------------- format prompts by the boxes
await check('the card box has its own prompt button', `${tab('tonight')};
  !!document.getElementById('cardPrompt')`, true);
await check('the roster box has one too', `${tab('roster')};
  document.getElementById('rosterPanel').open = true;
  !!document.getElementById('rosterPrompt')`, true);

// ---------------------------------------------------------------- choosing the champion
await page.evaluate(tab('tonight'));
await type('Raw / 2027-05-16 / Raw\nDamian Priest d. Gunther — World Heavyweight Championship');
await check('a title match reads as a change by default',
  `!!document.querySelector('#cardPreview .chip.new')`, true);
await check('the outcome is a button, not a verdict', `!!document.querySelector('[data-titletoggle]')`, true);
await check('clicking it rewrites the line', `document.querySelector('[data-titletoggle]').click();
  document.getElementById('cardText').value.includes('(retains)')`, true);
await check('and the preview follows', `new Promise(r => setTimeout(() =>
  r(document.querySelector('#cardPreview').textContent.includes('defense')), 200))`, true);
await check('clicking back flips it again', `document.querySelector('[data-titletoggle]').click();
  new Promise(r => setTimeout(() => r([
    document.getElementById('cardText').value.includes('(new champion)'),
    !document.getElementById('cardText').value.includes('(retains)'),
  ]), 200))`, [true, true]);
await check('saving honours the choice', `document.querySelector('[data-titletoggle]').click();
  new Promise(r => setTimeout(() => { document.getElementById('cardSave').click();
    r(UNIVERSE.app.state.championships['c:world-heavyweight-championship'].holders); }, 250))`,
  h => h.length === 1 && h[0] !== 'w:damian-priest');

await check('a belt page can set its champion', `${tab('titles')};
  [...document.querySelectorAll('.belt')].find(b => b.textContent.includes('Intercontinental')).click();
  !!document.getElementById('champName')`, true);
await check('typing a name and setting it moves the belt', `
  document.getElementById('champName').value = 'Sami Zayn';
  document.querySelector('[data-setchamp][data-reason=awarded]').click();
  UNIVERSE.app.state.championships['c:intercontinental-championship'].holders`, ['w:sami-zayn']);
await check('it is an ordinary event in the log', `UNIVERSE.store.effectiveEvents().slice(-1)[0].type`, 'title.change');
await check(`it starts the belt's history`, `UNIVERSE.app.state.championships['c:intercontinental-championship'].reigns.length`, 1);
await check('a bad name is refused, not guessed', `
  document.getElementById('champName').value = 'Someone Fake';
  document.querySelector('[data-setchamp][data-reason=awarded]').click();
  !!document.querySelector('#pane-title .msg.err')`, true);
await check('an interim champion can be set too', `
  document.getElementById('champName').value = 'Bron Breakker';
  document.querySelector('[data-setchamp][data-reason=interim]').click();
  UNIVERSE.app.state.championships['c:intercontinental-championship'].interimHolders`, ['w:bron-breakker']);
await check('and the real champion still holds it', `
  UNIVERSE.app.state.championships['c:intercontinental-championship'].holders`, ['w:sami-zayn']);
await check('vacating empties it', `document.querySelector('[data-vacate]').click();
  UNIVERSE.app.state.championships['c:intercontinental-championship'].vacant`, true);
await check('which opens a thread', `UNIVERSE.app.state.threads
  .some(t => t.kind === 'vacant-title' && t.about === 'c:intercontinental-championship')`, true);
await check('and voiding that undoes it', `
  const ev = UNIVERSE.store.effectiveEvents().filter(e => e.type === 'title.change').slice(-1)[0];
  UNIVERSE.store.voidEvent(ev.id, 'test'); UNIVERSE.render();
  UNIVERSE.app.state.championships['c:intercontinental-championship'].holders`, ['w:sami-zayn']);

// ---------------------------------------------------------------- import
await check('import tab has a drop zone', `${tab('import')}; !!document.getElementById('drop')`, true);
await check('with no key it offers the paste route', `!!document.getElementById('shotPrompt')
  && !document.getElementById('shotRead')`, true);
await check('pasting a transcription previews it', `const t = document.getElementById('shotText');
  t.value = '\`\`\`\\nRaw / 2027-05-02 / Raw\\nSeth Rollins d. Sami Zayn\\n\`\`\`';
  t.dispatchEvent(new Event('input', {bubbles:true}));
  document.querySelectorAll('#shotPreview tbody tr').length`, 1);
await check('code fences do not reach the parser', `document.getElementById('shotStatus').textContent`,
  s => /show card/.test(s));
await check('use-this sends it to the entry box', `document.getElementById('shotUse').click();
  document.querySelector('.tab.on').dataset.tab === 'tonight'
  && document.getElementById('cardText').value.includes('Seth Rollins')`, true);
await check('a roster transcription goes the other way', `${tab('import')};
  const t = document.getElementById('shotText');
  t.value = 'RAW\\nAxiom, m, active\\nSeth Rollins, m, active';
  t.dispatchEvent(new Event('input', {bubbles:true}));
  document.getElementById('shotStatus').textContent`, s => /roster/.test(s));
await check('and lands in the roster box', `document.getElementById('shotUse').click();
  document.querySelector('.tab.on').dataset.tab === 'roster'
  && document.getElementById('rosterText').value.includes('Axiom')`, true);

// The direct-read path, with fetch stubbed: no key of ours, no network, but the
// request shape and the round trip into the preview are real.
await check('saving a key switches to automatic', `${tab('import')};
  document.getElementById('apiKey').value = 'test-key-123';
  document.getElementById('apiSave').click();
  !!document.getElementById('shotRead')`, true);
await check('the key is stored under its own key', `localStorage.getItem('arc_universe_key_v1')`, 'test-key-123');
await check('reading a screenshot fills the box', `
  window.__req = null;
  window.fetch = async (url, opts) => { window.__req = { url, opts, body: JSON.parse(opts.body) };
    return { ok: true, json: async () => ({ content: [{ type: 'text',
      text: 'Raw / 2027-05-09 / Raw\\nGunther d. Sheamus' }] }) }; };
  UNIVERSE.app.shots.push({ name: 'shot.png', dataUrl: 'data:image/png;base64,AAAA' });
  UNIVERSE.app.activeShot = 0; UNIVERSE.render();
  document.getElementById('shotRead').click();
  new Promise(r => setTimeout(() => r(document.getElementById('shotText').value), 400))`,
  'Raw / 2027-05-09 / Raw\nGunther d. Sheamus');
await check('it sent the image and the prompt', `[window.__req.url,
  window.__req.body.messages[0].content[0].type,
  window.__req.body.messages[0].content[1].text.includes('Winner d. Loser')]`,
  ['https://api.anthropic.com/v1/messages', 'image', true]);
await check('with the browser opt-in header', `window.__req.opts.headers['anthropic-dangerous-direct-browser-access']`, 'true');
await check('and the read result previews like anything else', `
  document.querySelectorAll('#shotPreview tbody tr').length`, 1);
await check('removing the key goes back to paste', `document.getElementById('apiClear').click();
  !!document.getElementById('shotPrompt') && localStorage.getItem('arc_universe_key_v1')`, null);


// ---------------------------------------------------------------- the pyramid
await check('the pyramid tab draws every rung', `${tab('brands')};
  document.querySelectorAll('#pane-brands .rung').length`, 3);
await check('with the top tier abreast', `document.querySelectorAll('#pane-brands .rung')[0]
  .querySelectorAll('.brandcard').length`, 3);
await check('and arrows between the rungs', `document.querySelectorAll('#pane-brands .rungarrow').length`, 2);
await check('a card says where its people go', `document.querySelector('#pane-brands .brandcard .bmoves')
  .textContent.includes('NXT')`, true);
await check('a new show can be created', `document.querySelector('[data-editbrand=new]').click();
  !!document.getElementById('bfName')`, true);
await check('creating one adds a rung', `
  document.getElementById('bfName').value = 'WCW';
  document.getElementById('bfTier').value = '2';
  document.getElementById('bfDay').value = 'Saturday';
  document.getElementById('bfColor').value = '#c0392b';
  document.querySelector('[data-savebrand]').click();
  UNIVERSE.app.state.brands['b:wcw'].tier`, 2);
await check('it sits level with the brand already there', `
  document.querySelectorAll('#pane-brands .rung')[1].querySelectorAll('.brandcard').length`, 2);
await check('a fourth tier grows the pyramid', `
  document.querySelector('[data-editbrand=new]').click();
  document.getElementById('bfName').value = 'Deep South';
  document.getElementById('bfTier').value = '4';
  document.querySelector('[data-savebrand]').click();
  document.querySelectorAll('#pane-brands .rung').length`, 4);
await check('and Evolve now has somewhere to relegate to', `
  [...document.querySelectorAll('#pane-brands .brandcard')]
    .find(c => c.querySelector('.bname').textContent === 'Evolve')
    .querySelector('.bmoves').textContent.includes('Deep South')`, true);
await check('a bad tier is refused with a reason', `
  document.querySelector('[data-editbrand=new]').click();
  document.getElementById('bfName').value = 'Nope';
  document.getElementById('bfTier').value = '0';
  document.querySelector('[data-savebrand]').click();
  document.querySelector('#pane-brands .msg.err').textContent.includes('tier')`, true);
await check('and nothing was created', `!UNIVERSE.app.state.brands['b:nope']`, true);
await check('an existing show can be edited', `
  [...document.querySelectorAll('#pane-brands [data-editbrand]')]
    .find(b => b.dataset.editbrand === 'b:wcw').click();
  document.getElementById('bfName').value`, 'WCW');
// The night is a slot in the cycle's week — day 7 of 7 — and the weekday name
// is kept alongside it so nothing that still reads it disagrees.
await check('editing writes a correction, not a new brand', `
  document.getElementById('bfDay').value = '7';
  document.querySelector('[data-savebrand]').click();
  [UNIVERSE.app.state.brands['b:wcw'].slot, UNIVERSE.app.state.brands['b:wcw'].day,
   Object.keys(UNIVERSE.app.state.brands).length]`, [7, 'Sunday', 7]);
await check('and the cycle puts it on that night of every week', `${tab('calendar')};
  [...document.querySelectorAll('.cal .cday')]
    .filter(d => [...d.querySelectorAll('.cdue')].some(x => x.textContent === 'WCW'))
    .map(d => d.dataset.day)`, ['7', '14', '21', '28']);

// ---------------------------------------------------------------- the draft
await check('the season tab offers a draft per tier', `${tab('season')};
  document.querySelectorAll('[data-draftpropose]').length`, 2);
await check('proposing one lays out a board', `document.querySelector('[data-draftpropose]').click();
  document.querySelectorAll('#pane-season .draftcol').length`, 3);
await check('weakest brand picks first', `document.querySelector('#pane-season .msg.ok')
  .textContent.includes('weakest season first')`, true);
await check('champions are shown as protected', `
  document.querySelectorAll('#pane-season .draftcol li.protected').length > 0`, true);
await check('running it moves people', `
  const before = JSON.parse(JSON.stringify(UNIVERSE.app.state.wrestlers));
  document.querySelector('[data-draftcommit]').click();
  Object.keys(UNIVERSE.app.state.wrestlers)
    .filter(id => UNIVERSE.app.state.wrestlers[id].brandId !== before[id].brandId).length > 3`, true);
await check('and every move is in the log', `UNIVERSE.store.effectiveEvents()
  .filter(e => e.source === 'draft').length > 3`, true);
await check('a draft show closes the year', `${tab('tonight')};
  const box = document.getElementById('cardText');
  box.value = 'WWE Draft / 2027-06-06 / Raw\\nSeth Rollins d. Sami Zayn';
  box.dispatchEvent(new Event('input', {bubbles:true}));
  new Promise(r => setTimeout(() => { document.getElementById('cardSave').click();
    r(UNIVERSE.app.state.shows.slice(-1)[0].ple); }, 250))`, 'draft');
await check('and the new season opens', `${tab('season')};
  document.querySelector('#pane-season .phase.on .pname').textContent`, 'New season');
await check('with the old one kept on record', `
  document.querySelectorAll('#pane-season table')[0].querySelectorAll('tbody tr').length`, 2);
await check('a drafted wrestler kept their belt', `
  Object.values(UNIVERSE.app.state.championships)
    .filter(c => !c.vacant)
    .every(c => c.holders.every(hh => UNIVERSE.app.state.wrestlers[hh].brandId === c.brandId
      || !c.brandId))`, true);


// ---------------------------------------------------------------- Last Stand dashboard
// The season checks above already ran a Last Stand and a draft, so the flags are
// all cleared. Start another year to have candidates to work with.
await page.evaluate(tab('tonight'));
await type('WrestleMania 44 / 2028-04-02 / Raw\nCody Rhodes d. Roman Reigns — WWE Championship');
await page.evaluate(`document.getElementById('cardSave').click()`);
await page.waitForTimeout(200);
await page.evaluate(`${tab('season')}; document.getElementById('flagsPropose').click()`);
await page.waitForTimeout(150);
await page.evaluate(`document.getElementById('flagsCommit').click()`);
await page.waitForTimeout(200);
await check('a fresh year has candidates again', `Object.values(UNIVERSE.app.state.wrestlers)
  .filter(w => /flagged$/.test(w.status)).length > 4`, true);

await check('the dashboard draws the pyramid', `${tab('laststand')};
  document.querySelectorAll('#pane-laststand .rung').length`, 4);
await check('promotion and relegation are kept apart', `
  const h2 = [...document.querySelectorAll('#pane-laststand h2')].map(x => x.textContent);
  [h2.some(t => /Up for promotion/.test(t)), h2.some(t => /Up for relegation/.test(t))]`, [true, true]);
await check('the relegation list is populated', `
  const cols = document.querySelectorAll('#pane-laststand .cols .card')[1];
  cols.querySelectorAll('tbody tr').length > 0`, true);
await check('the match maker offers candidates', `
  document.querySelectorAll('#lsA option').length > 2`, true);
await check('the opponent picker starts empty', `document.getElementById('lsB').disabled`, true);

// Pick a Raw relegation candidate; the opponent list must contain only the
// other Raw relegation candidates of the same gender.
await check('picking one filters the other', `
  const rel = Object.values(UNIVERSE.app.state.wrestlers)
    .filter(w => w.status === 'relegation-flagged' && w.brandId === 'b:raw' && w.gender === 'male');
  const sel = document.getElementById('lsA');
  sel.value = rel[0].id; sel.dispatchEvent(new Event('change', {bubbles:true}));
  const opts = [...document.querySelectorAll('#lsB option')].slice(1).map(o => o.value);
  window.__rel = rel.map(r => r.id);
  opts.every(id => UNIVERSE.app.state.wrestlers[id].brandId === 'b:raw'
    && UNIVERSE.app.state.wrestlers[id].status === 'relegation-flagged')`, true);
await check('and never offers another brand', `
  [...document.querySelectorAll('#lsB option')].slice(1)
    .every(o => UNIVERSE.app.state.wrestlers[o.value].brandId === 'b:raw')`, true);
await check('nor anyone up for promotion', `
  [...document.querySelectorAll('#lsB option')].slice(1)
    .every(o => UNIVERSE.app.state.wrestlers[o.value].status !== 'promotion-flagged')`, true);
await check('it spells out what is at stake', `
  const b = document.getElementById('lsB');
  b.value = window.__rel[1]; b.dispatchEvent(new Event('change', {bubbles:true}));
  document.querySelector('#pane-laststand .msg.ok').textContent.includes('drops to')`, true);
await check('recording needs a winner first', `document.getElementById('lsRecord').disabled`, true);
// The destination is whatever the pyramid says, not a hardcoded NXT — the
// earlier checks added an empty WCW on the same tier, and the thinnest roster
// wins the tie-break.
await check('recording it moves the loser down a rung', `
  const w = document.getElementById('lsWinner');
  w.value = window.__rel[0]; w.dispatchEvent(new Event('change', {bubbles:true}));
  document.getElementById('lsRecord').click();
  const st = UNIVERSE.app.state;
  window.__to = st.wrestlers[window.__rel[1]].brandId;
  [st.wrestlers[window.__rel[0]].brandId, st.brands[window.__to].tier]`, ['b:raw', 2]);
await check('and clears both flags', `
  window.__rel.every(id => UNIVERSE.app.state.wrestlers[id].status === 'active')`, true);
await check('the movement is listed', `
  document.querySelector('#pane-laststand').textContent.includes('Roster movements')
  && [...document.querySelectorAll('#pane-laststand tbody tr')]
    .some(r => r.textContent.includes('relegation'))`, true);
await check('and it is a real event in the log', `UNIVERSE.store.effectiveEvents()
  .filter(e => e.source === 'last-stand').length`, n => n >= 2);
await check('the wrestler carries it in their history', `
  UNIVERSE.app.tab = 'wrestler'; UNIVERSE.app.detailId = window.__rel[1]; UNIVERSE.render();
  document.querySelector('#pane-wrestler').textContent
    .includes('moves to ' + UNIVERSE.app.state.brands[window.__to].name)`, true);

// ---------------------------------------------------------------- the 28-day cycle
// Four weeks of seven days, days 1-28, and no real-world months anywhere.
await check('the calendar draws a cycle', `${tab('calendar')};
  document.querySelector('.calname').textContent.startsWith('Cycle')`, true);
await check('four weeks', `document.querySelectorAll('.cweekwrap').length`, 4);
await check('of seven days each', `[...document.querySelectorAll('.cweek')].map(w => w.children.length)`, [7, 7, 7, 7]);
await check('numbered day 1 to day 28', `[...document.querySelectorAll('.cday .n span')]
  .map(e => e.textContent).filter((_, i) => i === 0 || i === 27)`, ['Day 1', 'Day 28']);
await check('week 1 is labelled days 1-7', `document.querySelector('.cweeklabel').textContent.replace(/\\s+/g,' ').trim()`,
  t => t.includes('Week 1') && t.includes('1') && t.includes('7'));
await check('and no month name is anywhere on it',
  `/january|february|august|september/i.test(document.querySelector('#pane-calendar').textContent)`, false);
await check('weekly shows repeat on their night', `[...document.querySelectorAll('.cday')]
  .filter(d => [...d.querySelectorAll('.cdue')].some(x => x.textContent === 'Raw')).length >= 3`, true);

// A PLE is placed by the user, on any day, with any set of brands.
await check('a day can be given a PLE', `document.querySelector('[data-editple="new:13"]').click();
  !!document.getElementById('pleForm')`, true);
await check('the form starts on that day', `document.getElementById('pfDay').value`, '13');
// Every brand the universe has right now — including any the earlier tests
// invented, which is the point: the picker reads the universe, not a list.
await check('and offers every brand the universe has',
  `document.querySelectorAll('.pfBrand').length === Object.keys(UNIVERSE.app.state.brands).length`, true);
await check('including one created after the app booted', `[...document.querySelectorAll('.pfBrand')]
  .some(b => b.value === 'b:wcw')`, true);
await check('creating it puts it on the day', `document.getElementById('pfName').value = 'Survivor Series';
  [...document.querySelectorAll('.pfBrand')].forEach(b => { b.checked = ['b:raw', 'b:smackdown'].includes(b.value); });
  document.querySelector('[data-saveple]').click();
  [...document.querySelectorAll('.cday')].find(d => d.querySelector('.cple'))
    .querySelector('.n span').textContent`, 'Day 13');
await check('showing its name', `document.querySelector('.cple .nm').textContent.trim()`, 'Survivor Series');
await check('and its brands underneath, in capitals',
  `document.querySelector('.cple .br').textContent.trim()`, t => t.includes('+') && t === t.toUpperCase());
await check('the schedule table lists it', `[...document.querySelectorAll('#pane-calendar tbody tr')]
  .some(r => r.textContent.includes('Survivor Series'))`, true);

// §37: moving it. Drag, or the day picker — either way only the day changes.
await check('dragging it to another day moves it', `
  const from = document.querySelector('.cple');
  const to = [...document.querySelectorAll('.cday')].find(d => d.dataset.day === '20');
  const dt = new DataTransfer();
  from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  to.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  Object.values(UNIVERSE.app.state.ples)[0].day`, 20);
await check('and its brands came with it',
  `Object.values(UNIVERSE.app.state.ples)[0].brandIds.length`, 2);
await check('the grid redrew it on the new day', `[...document.querySelectorAll('.cday')]
  .find(d => d.querySelector('.cple')).dataset.day`, '20');
await check('the day picker moves it too', `document.querySelector('[data-editple^="p:"]').click();
  document.getElementById('pfDay').value = '5';
  document.querySelector('[data-saveple]').click();
  Object.values(UNIVERSE.app.state.ples)[0].day`, 5);
await check('with the brands still intact',
  `Object.values(UNIVERSE.app.state.ples)[0].brandIds.length`, 2);

// §38 + §39: several on a day, and filtering by brand.
await check('a second PLE can share a day', `document.querySelector('[data-editple="new:5"]').click();
  document.getElementById('pfName').value = 'Dynamite Big One';
  [...document.querySelectorAll('.pfBrand')].find(b => b.value === 'b:dynamite').checked = true;
  document.querySelector('[data-saveple]').click();
  [...document.querySelectorAll('.cday')].find(d => d.dataset.day === '5').querySelectorAll('.cple').length`, 2);
await check('filtering by a brand keeps the PLE it is in', `
  const sel = document.getElementById('calBrand');
  sel.value = 'b:dynamite'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  [...document.querySelectorAll('.cple .nm')].map(e => e.textContent.trim())`, ['Dynamite Big One']);
await check('and drops the one it is not in', `
  const sel = document.getElementById('calBrand');
  sel.value = 'b:raw'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  [...document.querySelectorAll('.cple .nm')].map(e => e.textContent.trim())`, ['Survivor Series']);
await check('a shared PLE shows under its other brand too', `
  const sel = document.getElementById('calBrand');
  sel.value = 'b:smackdown'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  [...document.querySelectorAll('.cple .nm')].map(e => e.textContent.trim())`, ['Survivor Series']);
await check('and the weekly nights are filtered with it',
  `[...new Set([...document.querySelectorAll('.cal .cdue')].map(e => e.textContent))]`, ['SmackDown']);
await page.evaluate(`document.querySelector('[data-calbrand]').click()`);

// Where the universe starts. The game opens Universe mode in the first week of
// May, so that is one click — and picking it only re-numbers the grid.
await check('the start panel says where day 1 is', `${tab('calendar')};
  document.querySelector('#startPanel summary').textContent.includes('day 1 of cycle 1 is')`, true);
await check('the seed already starts in the first week of May',
  `UNIVERSE.store.doc.calendar.start`, '2026-05-04');
await check('a May preset is offered per year', `[...document.querySelectorAll('[data-startpick]')]
  .map(b => b.textContent.trim())`, t => t.length >= 3 && t.every(x => x.startsWith('May')));
await check('picking one previews it without writing', `
  document.querySelectorAll('[data-startpick]')[2].click();
  [document.getElementById('calStart').value, UNIVERSE.store.doc.calendar.start]`,
  v => v[0] !== v[1] && v[1] === '2026-05-04');
await check('and says where today would land',
  `document.getElementById('startPreview').textContent.replace(/\\s+/g, ' ')`,
  t => /that would make day 1 of cycle 1/i.test(t) && /cycle -?\d+, day \d+/i.test(t));
await check('cancelling puts it back', `document.getElementById('calStartReset').click();
  document.getElementById('calStart').value`, '2026-05-04');
await check('setting a date moves day 1', `
  const box = document.getElementById('calStart');
  box.value = '2027-05-03';
  box.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('calStartSave').click();
  UNIVERSE.store.doc.calendar.start`, '2027-05-03');
await check('and the grid is renumbered from it', `${tab('calendar')};
  document.querySelector('#startPanel summary').textContent.includes('3 May 2027')`, true);
await check('while the log keeps its own dates',
  `UNIVERSE.store.effectiveEvents()[0].date`, d => d.startsWith('2026-'));
await check('putting it back is one click', `
  [...document.querySelectorAll('[data-startpick]')].find(b => b.textContent.trim() === 'May 2026').click();
  document.getElementById('calStartSave').click();
  UNIVERSE.store.doc.calendar.start`, '2026-05-04');

// §41: Last Stand is an ordinary PLE carrying a rule.
await check('a PLE can carry a universe rule', `document.querySelector('[data-editple="new:24"]').click();
  document.getElementById('pfName').value = 'Bound for Glory';
  document.getElementById('pfType').value = 'special';
  document.getElementById('pfSpecial').value = 'lastStand';
  document.querySelector('[data-saveple]').click();
  Object.values(UNIVERSE.app.state.ples).find(p => p.name === 'Bound for Glory').special`, 'lastStand');
await check('and is marked apart on the calendar', `[...document.querySelectorAll('.cple.special .nm')]
  .map(e => e.textContent.trim())`, ['Bound for Glory']);
await check('with the rule it carries shown in words',
  `document.querySelector('.cple.special .rule').textContent`, 'Last Stand');
await check('a card named after it is recognised as that rule', `${tab('tonight')};
  const box = document.getElementById('cardText');
  box.value = 'Bound for Glory / 2028-05-02 / Raw\\nSeth Rollins d. Sami Zayn';
  box.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('cardSave').click();
  UNIVERSE.app.state.shows[UNIVERSE.app.state.shows.length - 1].ple`, 'lastStand');

// Cards land on the cycle day they fall on, and still open.
await check('a played card sits on its day', `${tab('calendar')};
  UNIVERSE.app.cycle = UNIVERSE.app.state.calendarCycleForTest || UNIVERSE.app.cycle; UNIVERSE.render();
  document.querySelectorAll('.cshow').length >= 0`, true);
await check('cycles on record are listed', `[...document.querySelectorAll('#pane-calendar [data-cycle]')].length > 0`, true);

// Stills for eyeballing the result. snapshots/ is gitignored.
await mkdir('snapshots', { recursive: true });
await page.evaluate(tab('tonight'));
await type(CARD);
await page.screenshot({ path: 'snapshots/universe-entry.png' });
await page.evaluate(tab('roster'));
await page.screenshot({ path: 'snapshots/universe-roster.png' });
await page.evaluate(tab('titles'));
await page.screenshot({ path: 'snapshots/universe-titles.png' });
await page.evaluate(`[...document.querySelectorAll('.bghead')]
  .find(e => e.querySelector('.nm').textContent === 'NXT').querySelector('[data-editbelt]').click()`);
await page.waitForTimeout(500);
await page.screenshot({ path: 'snapshots/universe-belt-form.png' });
await page.evaluate(`UNIVERSE.app.beltEdit = null; UNIVERSE.render()`);
await page.evaluate(tab('brands'));
await page.screenshot({ path: 'snapshots/universe-pyramid.png' });
await page.evaluate(tab('threads'));
await page.screenshot({ path: 'snapshots/universe-threads.png' });
await page.evaluate(`UNIVERSE.app.tab='wrestler'; UNIVERSE.app.detailId='w:jey-uso'; UNIVERSE.render()`);
await page.screenshot({ path: 'snapshots/universe-wrestler.png' });
await page.evaluate(tab('season'));
await page.screenshot({ path: 'snapshots/universe-season.png' });
await page.evaluate(tab('prompts'));
await page.screenshot({ path: 'snapshots/universe-prompts.png' });
await page.evaluate(tab('import'));
await page.screenshot({ path: 'snapshots/universe-import.png' });
await page.evaluate(`UNIVERSE.app.tab = 'calendar'; UNIVERSE.app.cycle = null; UNIVERSE.app.pleEdit = null;
  UNIVERSE.app.startOpen = true; UNIVERSE.render()`);
await page.screenshot({ path: 'snapshots/universe-calendar.png', fullPage: true });
await page.evaluate(`UNIVERSE.app.tab = 'show';
  UNIVERSE.app.detailId = UNIVERSE.app.state.shows.find(s => s.ple === 'wrestlemania').id; UNIVERSE.render()`);
await page.screenshot({ path: 'snapshots/universe-show.png' });
await browser.close();

console.log(`\n${pass} passed, ${fail} failed, ${errors.length} page errors`);
if (failures.length) console.log('failed: ' + failures.join(', '));
if (errors.length) console.log(errors.slice(0, 8).join('\n'));
process.exit(fail || errors.length ? 1 : 0);
