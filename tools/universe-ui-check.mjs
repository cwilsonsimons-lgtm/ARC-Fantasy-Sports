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
await check('tabs render', `document.querySelectorAll('.tab').length`, 9);
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
await check('belt opens its own page', `document.querySelector('.belt').click();
  document.querySelector('#pane-title').classList.contains('on')`, true);
await check('title page names the belt', `document.querySelector('#pane-title .pagehead .nm').textContent`, 'WWE Championship');
await check('title page lists the lineage', `document.querySelectorAll('#pane-title tbody tr').length`, 1);
await check('and links back to the belts', `document.querySelector('#pane-title [data-tab=titles]').click();
  document.querySelector('.tab.on').dataset.tab`, 'titles');

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

// ---------------------------------------------------------------- titles, threads, heat
// Everything below covers a second card: an interim reign, a contender match,
// a betrayal inside a faction, a save, and a vacated belt.
const CARD2 = `SmackDown / 2026-08-21 / SmackDown
Solo Sikoa d. Randy Orton — WWE Championship, interim
LA Knight d. Kevin Owens, Drew McIntyre — contender, WWE Championship
* Jacob Fatu attacks Jey Uso after the main event
* Jimmy Uso saves Jey Uso from Jacob Fatu
promise: Randy Orton — WWE Championship
vacate: United States Championship`;

await page.evaluate(tab('tonight'));
await type(CARD2);
await check('interim match reads as interim', `document.querySelector('#cardPreview tbody tr').textContent.includes('interim')`, true);
await check('contender match is not a title match', `document.querySelectorAll('#cardPreview tbody tr')[1].textContent.includes('#1 contender')`, true);
await check('save line parsed', `document.querySelectorAll('#cardPreview tbody tr')[3].textContent.includes('saves')`, true);
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
await check('reign day count is shown', `
  const w = UNIVERSE.app.state.wrestlers['w:cody-rhodes'], r = w.titleHistory[0];
  const want = Math.round((new Date(UNIVERSE.app.state.asOf) - new Date(r.from)) / 86400000);
  const t = [...document.querySelectorAll('#pane-wrestler table')]
    .find(x => x.textContent.includes('WWE Championship'));
  t.textContent.includes(String(want)) && want > 100`, true);
await check('profile timeline lists appearances', `UNIVERSE.app.detailId = 'w:jey-uso'; UNIVERSE.render();
  document.querySelectorAll('#pane-wrestler table').length >= 3`, true);
await check('and a reign links to the belt page', `UNIVERSE.app.detailId = 'w:cody-rhodes'; UNIVERSE.render();
  document.querySelector('#pane-wrestler [data-belt]').click();
  document.querySelector('#pane-title .pagehead .nm').textContent`, 'WWE Championship');

// ---------------------------------------------------------------- season
await check('season tab shows standings', `${tab('season')};
  document.querySelectorAll('#pane-season .brandhead').length`, 3);
await check('season 1 is in progress', `document.querySelector('#pane-season .pagehead .nm').textContent`, 'Season 1');
await check('no WrestleMania yet', `document.querySelector('#pane-season .pagehead').textContent
  .includes('has not happened yet')`, true);

await page.evaluate(tab('tonight'));
await type(`WrestleMania 43 / 2027-04-04 / Raw
Cody Rhodes d. Roman Reigns — WWE Championship`);
await check('WrestleMania is recognised from the name', `document.getElementById('cardSave').click();
  UNIVERSE.app.state.shows.slice(-1)[0].ple`, 'wrestlemania');
await check('and the season knows', `${tab('season')};
  document.querySelector('#pane-season .pagehead').textContent.includes('lists are due')`, true);

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

await check('booking Last Stand writes a card', `document.getElementById('lastStandPropose').click();
  document.getElementById('lastStandText').value.split('\\n').filter(l => / vs /.test(l)).length`, 4);
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
await check('and clears the flags of everyone who fought', `${tab('season')};
  document.querySelector('#pane-season .pagehead .nm').textContent`, 'Season 2');

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
await check('so the previous reign closed properly', `UNIVERSE.app.state.championships['c:intercontinental-championship'].reigns.length`, 2);
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

// Stills for eyeballing the result. snapshots/ is gitignored.
await mkdir('snapshots', { recursive: true });
await page.evaluate(tab('tonight'));
await type(CARD);
await page.screenshot({ path: 'snapshots/universe-entry.png' });
await page.evaluate(tab('roster'));
await page.screenshot({ path: 'snapshots/universe-roster.png' });
await page.evaluate(tab('titles'));
await page.screenshot({ path: 'snapshots/universe-titles.png' });
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
await browser.close();

console.log(`\n${pass} passed, ${fail} failed, ${errors.length} page errors`);
if (failures.length) console.log('failed: ' + failures.join(', '));
if (errors.length) console.log(errors.slice(0, 8).join('\n'));
process.exit(fail || errors.length ? 1 : 0);
