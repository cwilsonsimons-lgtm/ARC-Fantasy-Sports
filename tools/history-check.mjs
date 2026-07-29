// Checks the past-season Leaders data and rail.
//
// Usage: node tools/history-check.mjs [url]      (defaults to the dist build)
//
// The spot values below are real NFL regular-season PPR totals. They are here so
// that a regenerated dataset that quietly changed scoring, mixed in the
// postseason, or shifted a season fails loudly rather than looking plausible.
import { chromium } from 'playwright';

const SPOT = [
  [2019, 'Christian McCaffrey', 471.2, 'RB'],
  [2019, 'Lamar Jackson',       415.7, 'QB'],
  [2020, 'Alvin Kamara',        377.8, 'RB'],
  [2024, 'Lamar Jackson',       430.4, 'QB'],
  [2024, "Ja'Marr Chase",       403.0, 'WR'],
];

const url = process.argv[2] || 'file://' + process.cwd() + '/dist/index.html';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ||
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.route('**', r =>
  (new URL(r.request().url()).protocol === 'file:' ? r.continue() : r.abort()));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(700);

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label.padEnd(38)}${detail === undefined ? '' : JSON.stringify(detail)}`);
};

// ---------------------------------------------------------------- the data
const shape = await page.evaluate(`(()=>{
  const bad = [];
  HIST_SEASONS.forEach(y => {
    const rows = histSeason(y);
    ['QB','RB','WR','TE'].forEach(p => {
      const n = rows.filter(r => r.pos === p).length;
      if (n !== 40) bad.push(y + ' ' + p + '=' + n);
    });
    rows.forEach(r => {
      if (!(r.g >= 1 && r.g <= 17)) bad.push(y + ' ' + r.name + ' games=' + r.g);
      if (!(r.ppr >= r.std - 0.05)) bad.push(y + ' ' + r.name + ' ppr<std');
    });
    for (let i = 1; i < rows.length; i++)
      if (rows[i].ppr > rows[i-1].ppr + 0.001) { bad.push(y + ' unsorted at ' + i); break; }
  });
  return { seasons: HIST_SEASONS, rows: HIST_SEASONS.reduce((n,y)=>n+histSeason(y).length,0), bad };
})()`);
ok('six seasons shipped', shape.seasons.length === 6, shape.seasons);
ok('40 per position per season', shape.bad.length === 0, shape.bad.slice(0, 4));
ok('960 rows total', shape.rows === 960, shape.rows);

for (const [year, name, ppr, pos] of SPOT) {
  const r = await page.evaluate(`histSeason(${year}).find(r => r.name === ${JSON.stringify(name)})`);
  ok(`${year} ${name}`, r && Math.abs(r.ppr - ppr) < 0.05 && r.pos === pos,
     r && { ppr: r.ppr, pos: r.pos, g: r.g });
}

// ---------------------------------------------------------------- the rail
await page.evaluate(`toggleDrawer();selectRail('leaders')`);
await page.waitForTimeout(400);
const scopes = await page.evaluate(
  `[...[...document.querySelectorAll('.panel-hd select')][1].options].map(o=>o.text)`);
ok('scope list offers past seasons', [2019, 2024].every(y => scopes.includes(String(y))),
   scopes.slice(-7));

const read = () => page.evaluate(`(()=>{
  const rows = [...document.querySelectorAll('#panelList .ld-row')];
  return { n: rows.length,
    top: rows.slice(0,3).map(r => r.querySelector('.ld-nm').textContent + ' ' +
                                  r.querySelector('.ld-pt').textContent),
    vals: rows.map(r => +r.querySelector('.ld-pt').textContent),
    note: (document.querySelector('.ld-note')||{}).textContent || '',
    metrics: [...[...document.querySelectorAll('.panel-hd select')][0].options].map(o=>o.text),
    gone: rows.filter(r => r.classList.contains('ld-gone')).length,
    inits: document.querySelectorAll('#panelList .ld-init').length };
})()`);

await page.evaluate(`setLeaderScope('2024')`); await page.waitForTimeout(250);
let v = await read();
ok('2024 leaders render', v.n === 100 && /Lamar Jackson 430.4/.test(v.top[0]), v.top);
ok('metrics swap to past-season set', v.metrics.join('/') === 'PPR/Per game/Standard', v.metrics);
ok('note names the season', v.note.includes('2024'), v.note);

// the note has to restamp when only the year changes
await page.evaluate(`setLeaderScope('2019')`); await page.waitForTimeout(250);
v = await read();
ok('2019 leaders render', /Christian McCaffrey 471.2/.test(v.top[0]), v.top);
ok('note follows the year', v.note.includes('2019') && !v.note.includes('2024'), v.note);
ok('retired players are inert', v.gone > 0 && v.gone === v.inits, { gone: v.gone, inits: v.inits });

// each metric has to re-sort, not just relabel
for (const [metric, label] of [['ppr','PPR'], ['ppg','Per game'], ['std','Standard']]) {
  await page.evaluate(`setLeaderMetric('${metric}')`); await page.waitForTimeout(200);
  v = await read();
  const sorted = v.vals.every((x, i) => i === 0 || x <= v.vals[i-1] + 0.001);
  ok(`${label} sorts descending`, sorted, v.top);
}

await page.evaluate(`setLeaderPos('TE')`); await page.waitForTimeout(200);
v = await read();
ok('position filter applies', v.n === 40, v.top);
await page.evaluate(`setLeaderPos('ALL');onPanelSearch('leaders','kelce')`); await page.waitForTimeout(250);
v = await read();
ok('search applies', v.n === 1 && v.top[0].startsWith('Travis Kelce'), v.top);

await page.evaluate(`clearPanelSearch('leaders');setLeaderScope('season')`); await page.waitForTimeout(250);
v = await read();
ok('live season restored', v.metrics.join('/') === 'Proj/Points' && v.note === '', v.metrics);

console.log(`\n${pass} passed, ${fail} failed, ${errs.length} page errors`);
if (errs.length) console.log(errs.join('\n'));
await browser.close();
process.exit(fail || errs.length ? 1 : 0);
