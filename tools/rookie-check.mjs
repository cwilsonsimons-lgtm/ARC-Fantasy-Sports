// Checks that the rookie class is ranked, badged and draftable.
//
// The projections come from tools/rookie-projections.py; this asserts what the
// app does with them, which is the part a data change can silently get wrong.
//
// Usage: node tools/rookie-check.mjs [path-to-html]
import { chromium } from 'playwright';

const target = process.argv[2] || '/home/user/ARC-Fantasy-Sports/prototype/app.html';
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
await page.route('**/*', r => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto('file://' + target, { waitUntil: 'load' });
await page.waitForTimeout(500);

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};
const ev = c => page.evaluate(c);

console.log('\nthe pool itself');
const pool = await ev(`(() => {
  const rk = NFL_PLAYERS.filter(p => p.exp === 0);
  const projs = new Set(rk.map(p => p.sproj));
  const adps = NFL_PLAYERS.map(p => p.adp).sort((a,b) => a-b);
  return {
    total: NFL_PLAYERS.length, rookies: rk.length, distinctProj: projs.size,
    bestAdp: Math.min(...rk.map(p => p.adp)),
    inTop100: rk.filter(p => p.adp <= 100).length,
    contiguous: adps.every((v, i) => v === i + 1),
    topRookie: rk.slice().sort((a,b) => a.adp - b.adp)[0]
  };
})()`);
console.log('   ', JSON.stringify(pool));
check('the pool is still whole', pool.total === 895, `${pool.total}`);
check('ADP is a clean 1..N with no gaps or ties', pool.contiguous === true);
check('rookies no longer share three projections', pool.distinctProj > 60, `${pool.distinctProj} distinct`);
check('the best rookie is draftable early', pool.bestAdp < 40, `ADP ${pool.bestAdp}`);
check('the class is spread, not stacked in the top 100', pool.inTop100 > 2 && pool.inTop100 < 30, `${pool.inTop100}`);
check('a real first-rounder leads the class', pool.topRookie.sproj > 150, JSON.stringify(pool.topRookie));

console.log('\nprojections track draft capital');
// ADP is value over replacement, so a lower projection legitimately outranks a
// higher one at a different position — a QB worth 210 sits behind a WR worth
// 140. Within a position there is no such excuse: more points has to mean a
// better pick, and an inversion there means a rookie was slotted wrongly.
const shape = await ev(`(() => {
  const byPos = {}, bad = [];
  NFL_PLAYERS.forEach(p => (byPos[p.pos] = byPos[p.pos] || []).push(p));
  Object.values(byPos).forEach(list => {
    list.sort((a, b) => a.adp - b.adp);
    list.forEach((p, i) => {
      if (i && list[i-1].sproj < p.sproj - 0.05) bad.push(list[i-1].full + ' over ' + p.full);
    });
  });
  const rk = NFL_PLAYERS.filter(p => p.exp === 0).slice().sort((a,b) => a.adp - b.adp);
  const wr = rk.filter(p => p.pos === 'WR');
  return { inversions: bad.length, sample: bad.slice(0, 3),
           firstWr: wr[0] && wr[0].sproj, lastWr: wr[wr.length-1] && wr[wr.length-1].sproj };
})()`);
console.log('   ', JSON.stringify(shape));
check('no player outranks a better projection at its own position', shape.inversions === 0, shape.sample.join('; '));
check('the top WR far outprojects the last', shape.firstWr > shape.lastWr * 5, `${shape.firstWr} vs ${shape.lastWr}`);

console.log('\nwhere a manager actually sees them');
await ev(`openLeague('cbd');showTab('draft')`);
await page.waitForTimeout(400);
const board = await ev(`(() => {
  const rows = [...document.querySelectorAll('#draftList .dr-row')];
  return { rows: rows.length, badges: rows.filter(r => r.querySelector('.rk-badge')).length,
           firstBadged: rows.findIndex(r => r.querySelector('.rk-badge')) };
})()`);
console.log('   ', JSON.stringify(board));
check('the draft board renders', board.rows > 20, `${board.rows} rows`);
check('rookies are badged on the board', board.badges > 0, `${board.badges}`);
check('a rookie appears high on the board', board.firstBadged >= 0 && board.firstBadged < 40, `row ${board.firstBadged}`);

await ev(`toggleDrawer();selectRail('available');setAvailPos('WR')`);
await page.waitForTimeout(400);
const avail = await ev(`(() => {
  const rows = [...document.querySelectorAll('#panelList .ld-row')];
  return { rows: rows.length, badges: rows.filter(r => r.querySelector('.rk-badge')).length };
})()`);
check('the available list badges rookies too', avail.badges > 0, JSON.stringify(avail));
await ev(`toggleDrawer()`);

console.log('\na rookie-only startup actually drafts rookies');
const rookieDraft = await ev(`(() => {
  const before = draftBoard().length;
  const wasPool = LG().draftPool;
  LG().draftPool = 'rookies';
  const list = draftBoard();
  const allRookies = list.every(p => p.exp === 0);
  const auto = autoPick('pandas');
  LG().draftPool = wasPool;
  const restored = draftBoard().length;
  return { before, rookieOnly: list.length, allRookies, autoIsRookie: auto ? auto.exp === 0 : null, restored };
})()`);
console.log('   ', JSON.stringify(rookieDraft));
check('the rookie pool filters the board', rookieDraft.rookieOnly < rookieDraft.before && rookieDraft.rookieOnly > 100, JSON.stringify(rookieDraft));
check('nothing but rookies is offered', rookieDraft.allRookies === true);
check('the bots draft rookies too', rookieDraft.autoIsRookie === true);
check('clearing the setting restores the full board', rookieDraft.restored === rookieDraft.before);

console.log('\nnothing else moved');
await ev(`showTab('team')`); await page.waitForTimeout(300);
check('the team sheet still renders', await ev(`document.getElementById('teamBody').children.length > 0`));
await ev(`openMarkets()`); await page.waitForTimeout(400);
check('markets still lists contracts', await ev(`document.querySelectorAll('#mkRows > *').length > 5`));
await ev(`closeMarkets()`);

console.log(`\n${pass} passed, ${fail} failed`);
console.log(errors.length ? `page errors:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
