// Draft board: every pick shows the player's name, for the commissioner too.
// (The chat's .cm style once matched commissioner cells and squeezed names to
// a sliver; the page-wide .empty padded empty cells taller than filled ones.)
import { chromium } from 'playwright';
const OUT = process.argv[2] || '.';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
await p.route('**', r => (new URL(r.request().url()).protocol === 'file:' ? r.continue() : r.abort()));
await p.clock.setFixedTime(new Date('2026-10-11T15:55:00Z'));
await p.goto('file://' + new URL('../1stPrototype.html', import.meta.url).pathname, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(700);
const ok = (l, c, x) => console.log((c ? '  ok   ' : '  FAIL ') + l + (x ? '  ' + x : ''));
await p.evaluate(() => {
  const id = 'lgwork', teams = [];
  for (let i = 0; i < 10; i++) teams.push(newTeam(i, i ? null : 'You'));
  myLeagues().push({ id, name: 'Work Fantasy League', created: Date.now(), invite: 'x', joined: 10, teams, league: Object.assign({}, LEAGUE_DEFAULTS, { teams: 10, commish: 't0' }), scoring: Object.assign({}, SCORING_DEFAULTS), slots: Object.assign({}, SLOT_DEFAULTS) });
  store.leagueOrder.push(id); saveStore(); startCreatedDraft(id);
});
await p.waitForTimeout(400);
for (let i = 0; i < 16; i++) await p.evaluate(() => { const pl = autoPick(onClockTeam()); commitPick(pl.id, { auto: true, ts: Date.now() }); });
await p.evaluate(() => renderDraft());
await p.waitForTimeout(400);
const cells = await p.evaluate(() => [...document.querySelectorAll('.dg-cell')].map((c) => {
  const f = c.querySelector('.dg-f'), l = c.querySelector('.dg-l');
  return { pick: c.dataset.pick != null, cm: c.classList.contains('dg-cm'), h: c.getBoundingClientRect().height, fw: f ? f.getBoundingClientRect().width : 0, lw: l ? l.getBoundingClientRect().width : 0, name: f ? f.textContent + ' ' + l.textContent : '' };
}));
const picks = cells.filter((c) => c.pick);
ok(`commissioner's board: ${picks.length} picks, each shows the name full width`, picks.length === 16 && picks.every((c) => c.cm && c.fw > 60 && c.lw > 60), picks.slice(0, 4).map((c) => c.name).join(', '));
ok('empty and filled cells are the same height', new Set(cells.map((c) => Math.round(c.h))).size === 1, [...new Set(cells.map((c) => Math.round(c.h)))].join(' / '));
await p.locator('.dg-scroll').scrollIntoViewIfNeeded();
await p.screenshot({ path: OUT + '/draft-board.png' });
console.log('errors:', errs.length ? errs : 'none');
await b.close();
