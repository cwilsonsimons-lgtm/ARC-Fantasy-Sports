// Model + render checks for the three contract charts in Arc Markets.
//
// Usage: node tools/charts-check.mjs [url]        (defaults to the dist build)
//
// The invariants worth guarding are the ones that would break quietly: a game
// log that no longer adds up to the season projection, and a price history whose
// right-hand edge disagrees with the price on the row it was opened from. Both
// still draw a perfectly nice chart while being wrong.
import { chromium } from 'playwright';

const url = process.argv[2] || 'file://' + process.cwd() + '/dist/index.html';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ||
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
// remote headshots and fonts never resolve in a sandbox; they are not under test
await page.route('**', r =>
  (new URL(r.request().url()).protocol === 'file:' ? r.continue() : r.abort()));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(700);

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label.padEnd(32)}${detail === undefined ? '' : JSON.stringify(detail)}`);
};

await page.evaluate(`openMarkets()`);
await page.waitForTimeout(250);

// ---------------------------------------------------------------- the model
const model = await page.evaluate(`(()=>{
  const bad = { sum: [], quote: [], monotonic: [] };
  MARKET.forEach(p => {
    const log = gameLog(p);
    const sum = log.reduce((n,g)=>n+g.pts,0);
    if (Math.abs(sum - p.sproj) > 0.6) bad.sum.push(p.name);          // season adds up
    const days = priceDays(p);
    if (Math.abs(days[days.length-1].v - p.price) > 0.005) bad.quote.push(p.name);
    const c = careerSeries(p);
    if (Math.abs(c[c.length-1].price - p.price) > 0.005) bad.monotonic.push(p.name);
    if (log.some(g => g.pts < 0)) bad.sum.push(p.name + ' (negative week)');
  });
  return { n: MARKET.length, ...bad };
})()`);
ok('game log sums to projection', model.sum.length === 0, model.sum.slice(0, 3));
ok('price history ends at quote', model.quote.length === 0, model.quote.slice(0, 3));
ok('career ends at quote', model.monotonic.length === 0, model.monotonic.slice(0, 3));
ok('every contract covered', model.n > 100, model.n);

// determinism: the same player must chart the same season on a second read
ok('game log is stable', await page.evaluate(
  `JSON.stringify(gameLog(MARKET[3])) === JSON.stringify(gameLog(MARKET[3]))`));

// The row sparkline, the sheet header spark and the price chart must be the
// same season. Re-derive the spark from the path and compare against the
// stored one; and check the path's last step is exactly the quoted day move.
const sparks = await p2(page);
async function p2(pg) {
  return pg.evaluate(`(()=>{
    const norm = vs => { const lo=Math.min(...vs), hi=Math.max(...vs), s=hi-lo||1;
      return vs.map(v=>Math.round(((v-lo)/s)*100)/100); };
    const bad = { shape: [], move: [], tone: [] };
    MARKET.forEach(m => {
      const days = priceDays(m), n = 24;
      const want = norm(Array.from({length:n}, (_,i) =>
        days[Math.round((i/(n-1))*(days.length-1))].v));
      if (JSON.stringify(want) !== JSON.stringify(m.spark)) bad.shape.push(m.name);
      const step = Math.round((days[days.length-1].v - days[days.length-2].v)*100)/100;
      if (Math.abs(step - m.change) > 0.011) bad.move.push(m.name+' '+step+' vs '+m.change);
      if (m.seasonUp !== (days[days.length-1].v >= days[0].v)) bad.tone.push(m.name);
    });
    return bad;
  })()`);
}
ok('spark is the season path', sparks.shape.length === 0, sparks.shape.slice(0, 3));
ok('path lands the day move', sparks.move.length === 0, sparks.move.slice(0, 3));
ok('spark tone tracks season', sparks.tone.length === 0, sparks.tone.slice(0, 3));

// -------------------------------------------------------- trend column modes
// Each mode has to draw for every row, not just the ones with tidy numbers.
for (const [mode, label, marks] of [
  ['price', 'PRICE',  'polyline'],
  ['five',  'LAST 5', 'rect'],
  ['pace',  'PACE',   'polyline'],
]) {
  await page.evaluate(`mkThumb('${mode}')`);
  await page.waitForTimeout(200);
  const v = await page.evaluate(`(()=>{
    const rows = [...document.querySelectorAll('#mkMarket .mk-row')];
    return { rows: rows.length,
             drawn: rows.filter(r => r.querySelector('svg.spark ${marks}')).length,
             header: document.querySelector('#mkMarket .mk-th span:nth-child(3)').textContent.trim(),
             on: document.querySelector('.mk-seg .sg.on').textContent.trim() };
  })()`);
  ok(`thumb ${mode}`, v.rows > 100 && v.drawn === v.rows && v.header === label, v);
}
ok('thumb choice persists', await (async () => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.evaluate(`openMarkets()`);
  await page.waitForTimeout(250);
  return (await page.evaluate(`document.querySelector('.mk-seg .sg.on').textContent.trim()`)) === 'Pace';
})());
await page.evaluate(`mkThumb('price')`);
await page.waitForTimeout(150);

// ---------------------------------------------------------------- rendering
const id = await page.evaluate(`MARKET[0].id`);
await page.evaluate(`mkOpenPlayer('${id}')`);
await page.waitForTimeout(300);
ok('three charts render', await page.evaluate(`document.querySelectorAll('#mkCharts .mkc').length`) === 3);

for (const [range, min] of [['week', 7], ['five', 35], ['season', 20], ['career', 2]]) {
  await page.evaluate(`mkRange('${id}','${range}')`);
  await page.waitForTimeout(150);
  const v = await page.evaluate(`(()=>{
    const h = document.querySelector('#mkCharts [data-mkc="price"]');
    const labels = [...h.querySelectorAll('.mkc-x span')].map(s=>s.textContent);
    return { pts: h.querySelector('polyline').getAttribute('points').trim().split(/\\s+/).length,
             on: h.querySelector('.mkc-rg.on').textContent.trim(),
             labels,
             dupes: labels.filter((l,i)=>l===labels[i+1]).length,
             blocks: document.querySelectorAll('#mkCharts .mkc').length };
  })()`);
  ok(`range ${range}`, v.pts >= min && v.blocks === 3 && v.dupes === 0, v);
}

// the range buttons must swap one chart, not rebuild the sheet
ok('range keeps the sheet open',
   await page.evaluate(`document.body.classList.contains('mk-sheet-open')`));

// The app's bottom nav paints over the sheet, so scrolling to the end has to
// leave the last element above it - not merely inside the scroll box.
async function bottomOut(label) {
  await page.evaluate(`(()=>{const s=document.querySelector('.mk-sheet');s.scrollTop=s.scrollHeight;})()`);
  await page.waitForTimeout(300);
  const v = await page.evaluate(`(()=>{
    const s = document.querySelector('.mk-sheet');
    const navTop = document.querySelector('.nav').getBoundingClientRect().top;
    const kids = [...s.querySelectorAll('.mk-sheet .bd > *')];
    const last = kids[kids.length - 1].getBoundingClientRect();
    return { atBottom: s.scrollTop + s.clientHeight >= s.scrollHeight - 1,
             clears: last.bottom <= navTop + 1,
             lastBottom: Math.round(last.bottom), navTop: Math.round(navTop) };
  })()`);
  ok(label, v.atBottom && v.clears, v);
}
await bottomOut('contract scrolls clear of nav');
await page.evaluate(`mkAbout()`);
await page.waitForTimeout(300);
await bottomOut('about scrolls clear of nav');
await page.evaluate(`mkOpenPlayer('${id}')`);
await page.waitForTimeout(250);

// ---------------------------------------------------------------- edges
// The extremes are where a chart breaks: a player miles behind his price draws
// the gap the other way, and a rookie has almost no career to draw.
const edges = await page.evaluate(`(()=>{
  const s = MARKET.map(m=>({id:m.id,name:m.name,exp:m.exp,ahead:paceData(m).ahead}));
  return { worst: [...s].sort((a,b)=>a.ahead-b.ahead)[0],
           best:  [...s].sort((a,b)=>b.ahead-a.ahead)[0],
           rook:  s.filter(x=>x.exp<=1)[0] };
})()`);
for (const [k, who] of Object.entries(edges)) {
  await page.evaluate(`mkOpenPlayer('${who.id}')`);
  await page.waitForTimeout(250);
  const v = await page.evaluate(`(()=>{
    const pace = document.querySelectorAll('#mkCharts .mkc')[2];
    return { blocks: document.querySelectorAll('#mkCharts .mkc').length,
             bars: document.querySelectorAll('.mkc-bar').length,
             tone: pace.querySelector('.mkc-verdict').className.replace('mkc-verdict ',''),
             verdict: pace.querySelector('.mkc-verdict').textContent.replace(/\\s+/g,' ').trim() };
  })()`);
  const wantTone = who.ahead >= 0 ? 'up' : 'down';
  ok(`${k}: ${who.name}`, v.blocks === 3 && v.bars === 5 && v.tone === wantTone, v.verdict);
}

console.log(`\n${pass} passed, ${fail} failed, ${errs.length} page errors`);
if (errs.length) console.log(errs.join('\n'));
await browser.close();
process.exit(fail || errs.length ? 1 : 0);
