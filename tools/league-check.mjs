// Checks the league median, the league logo's geometry and stacking, the draft
// clock's new home, the trade block flow, and the schedule a record opens.
//
// The logo checks assert geometry rather than DOM, because the bug they exist
// to catch is a visual one: a crest that measures fine in the markup but is
// anchored to the wrong box lands off-centre and over the team names.
//
//   node tools/league-check.mjs /abs/path/to/dist/index.html [shot.png ...]
import { chromium } from 'playwright';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
await p.route('**', r => (new URL(r.request().url()).protocol === 'file:' ? r.continue() : r.abort()));
await p.goto('file://' + process.argv[2], { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(700);
const shots = process.argv.slice(3);
let fails = 0;
const ok = (label, cond) => { if (!cond) fails++; console.log((cond ? '  ok   ' : '  FAIL ') + label); };
const ev = js => p.evaluate(js);

// ---------------------------------------------------------------- 26/33 logo
// Centre the card, the VS, the score and the logo, and compare. A logo anchored
// to the wrong ancestor fails on dx; one drawn over the sides fails on paint.
const geom = sel => ev(`(()=>{
  const card = document.querySelector('${sel}');
  if(!card) return null;
  const box = e => { const r = e.getBoundingClientRect();
    return { cx: r.left + r.width/2, cy: r.top + r.height/2, w: r.width, h: r.height, r }; };
  const lg = card.querySelector('.sh-league'), vs = card.querySelector('.sh-vs'),
        sc = card.querySelector('.sh-score'), sides = [...card.querySelectorAll('.sh-tn')];
  if(!lg || !vs || !sc) return null;
  const c = box(card), l = box(lg), v = box(vs), s = box(sc);
  // who paints at the logo's centre: the top element there must not be the logo
  const top = document.elementFromPoint(l.cx, l.cy);
  const overName = sides.some(n => { const r = n.getBoundingClientRect();
    return l.r.right > r.left && l.r.left < r.right && l.r.bottom > r.top && l.r.top < r.bottom
      && getComputedStyle(n).visibility !== 'hidden'; });
  const zLogo = +getComputedStyle(lg).zIndex || 0;
  const zSide = +getComputedStyle(card.querySelector('.sh-side,.ms-side')).zIndex || 0;
  const zCent = +getComputedStyle(card.querySelector('.sh-center,.ms-center')).zIndex || 0;
  return { dxCard: Math.abs(l.cx - c.cx), dxVs: Math.abs(l.cx - v.cx), dxScore: Math.abs(l.cx - s.cx),
           dyBand: Math.abs(l.cy - (v.cy + s.cy)/2), w: l.w, cardW: c.w,
           topTag: top ? top.className : null, overName, zLogo, zSide, zCent };
})()`);

// the draft is the landing screen before it has run, so the matchup screens have
// to be shown before anything on them can be measured
for (const [label, sel, show] of [['stage', '.mstage', `showView('matchup')`],
                                  ['card', '.sh', `showLeagueView()`]]) {
  await ev(show); await p.waitForTimeout(120);
  const g = await geom(sel);
  ok(`${label}: league logo present`, !!g);
  if (!g) continue;
  console.log('    ' + JSON.stringify(g));
  ok(`${label}: centred on the card (dx ${g.dxCard.toFixed(2)}px)`, g.dxCard < 1);
  ok(`${label}: centred on VS + score (dx ${g.dxVs.toFixed(2)}/${g.dxScore.toFixed(2)}px)`,
     g.dxVs < 1 && g.dxScore < 1);
  ok(`${label}: sitting on the VS/score band (dy ${g.dyBand.toFixed(1)}px)`, g.dyBand < 26);
  ok(`${label}: narrower than the card`, g.w < g.cardW * 0.55);
  ok(`${label}: layer order logo < centre < sides (${g.zLogo}<${g.zCent}<${g.zSide})`,
     g.zLogo < g.zCent && g.zCent < g.zSide);
  ok(`${label}: nothing of the logo paints over a team name`, !g.overName || g.zLogo < g.zSide);
}
// team-name length must not move it: the longest name in the league vs the shortest
const shift = await ev(`(()=>{
  showView('matchup');
  const cx = () => { const l = document.querySelector('.mstage .sh-league').getBoundingClientRect();
    return l.left + l.width/2; };
  const was = T.pandas.n, before = cx();
  T.pandas.n = 'A'; renderUserMatchup(); const short = cx();
  T.pandas.n = 'Wildly Overlong Team Name That Runs On'; renderUserMatchup(); const long = cx();
  T.pandas.n = was; renderUserMatchup();
  return { before, short, long };
})()`);
ok(`independent of team-name length (${shift.short.toFixed(1)} vs ${shift.long.toFixed(1)})`,
   Math.abs(shift.short - shift.long) < 1);
if (shots[0]) await p.screenshot({ path: shots[0] });

// ---------------------------------------------------------------- 30 serial
const serial = await ev(`(()=>{ openPlayer(Object.keys(pIdx())[0]);
  return document.getElementById('playerBody').textContent; })()`);
ok('no ###/500 serial on the player card', !/\/\s*500/.test(serial) && !/CARD\s*#/.test(serial));

// ---------------------------------------------------------------- 28 block
const block = await ev(`(()=>{
  const key = pKeyOf(collectSide('a')[0] || {n:'x'});
  openPlayer(key); addToTradeBlock(key);
  const sheetOpen = document.getElementById('tbSheet').classList.contains('show');
  pickLookingFor('RB Depth'); saveLookingFor();
  const card = document.getElementById('playerBody').textContent;
  selectRail('trades');
  const rail = document.getElementById('panel').textContent;
  return { key, sheetOpen, listed: onBlock(key), want: blockWant(key), card, rail };
})()`);
ok('the sheet opens as part of adding, not on a second screen', block.sheetOpen);
ok('player is listed', block.listed);
ok('what they want is saved', block.want === 'RB Depth');
ok('the ask shows on the card', /Looking for/i.test(block.card) && /RB Depth/.test(block.card));
ok('the Trades rail lists the block', /RB Depth/.test(block.rail));
if (shots[1]) await p.screenshot({ path: shots[1] });
const skipped = await ev(`(()=>{
  const key = pKeyOf(collectSide('a')[1] || {n:'y'});
  openPlayer(key); addToTradeBlock(key); skipLookingFor();
  return { listed: onBlock(key), want: blockWant(key) };
})()`);
ok('skipping still lists the player', skipped.listed && skipped.want === '');

// ---------------------------------------------------------------- 24 clock
const clock = await ev(`(()=>{ showTab('draft');
  const card = document.querySelector('.dr-clock');
  const t = document.getElementById('drTimer');
  return { inCard: !!(card && card.contains(t)), separate: !!document.getElementById('dgTimer'),
    text: t ? t.textContent.trim() : null, pick: (card.querySelector('.pk')||{}).textContent,
    size: t ? parseFloat(getComputedStyle(t).fontSize) : 0,
    nameSize: parseFloat(getComputedStyle(card.querySelector('.nm')).fontSize) };
})()`);
console.log('    ' + JSON.stringify(clock));
ok('the timer is inside the Current Pick card', clock.inCard);
ok('no separate timer over the board', !clock.separate);
ok('it counts in mm:ss', /^\d{2}:\d{2}$/.test(clock.text || ''));
ok('the pick label reads round.pick', /^Pick \d+\.\d{2}$/.test((clock.pick || '').trim()));
ok('it is one of the loudest things on the card', clock.size >= clock.nameSize * 1.5);

// ---------------------------------------------------------------- 23 median
const off = await ev(`(()=>{ showView('matchup'); renderUserMatchup();
  return { strip: !!document.querySelector('.med-strip'),
           cols: [...document.querySelectorAll('.stand-row.head .st-c')].map(e=>e.textContent.trim()),
           rec: recLabel('pandas') };
})()`);
ok('median off by default — no strip', !off.strip);
ok('median off — no MED column', !off.cols.includes('MED'));

const on = await ev(`(()=>{ setLeague('median','1',1); showView('matchup'); renderUserMatchup();
  const strip = document.querySelector('.med-strip');
  renderStandings();
  return { strip: !!strip, chips: strip ? strip.querySelectorAll('.med-chip').length : 0,
    labels: strip ? [...strip.querySelectorAll('.med-res small')].map(e=>e.textContent) : [],
    cols: [...document.querySelectorAll('.stand-row.head .st-c')].map(e=>e.textContent.trim()),
    median: leagueMedian(1), stored: LG().median };
})()`);
console.log('    ' + JSON.stringify(on));
ok('median on — the matchup shows a median strip', on.strip);
ok('both results, both teams', on.chips === 4 && on.labels.join(',') === 'H2H,MED,H2H,MED');
ok('standings gain a MED column', on.cols.includes('MED'));
if (shots[2]) await p.screenshot({ path: shots[2] });

// Records, once a week has actually been played. The seeded season is entirely
// unplayed, so the week is played for real: draft the league, run the game clock
// to the final whistle for the user's own matchup, and score the other four from
// the same GAMES table the app reads.
const rec = await ev(`(()=>{
  autoDraftAll();
  store.simIdx = 99; recomputeLT();          // every kickoff passed: all games final
  const pts = [180,20,170,30,160,40,150,50];
  let i = 0;
  GAMES.forEach(g => { if(g.me) return; g.as = pts[i++]; g.xs = pts[i++]; });
  renderWeek();
  const scores = weekScores(1);
  const sorted = Object.values(scores).slice().sort((a,b)=>a-b);
  const expect = Math.round(((sorted[4]+sorted[5])/2)*10)/10;   // worked out independently
  const med = leagueMedian(1);
  const top = teamRecord('barzal'), bot = teamRecord('dakyard');
  const h2hOnly = teamRecord('barzal',{h2hOnly:true});
  const medOnly = teamRecord('barzal',{medianOnly:true});
  setLeague('median','0',1);
  const offRec = teamRecord('barzal'), offBot = teamRecord('dakyard');
  setLeague('median','1',1);
  return { scores, med, expect, top, bot, h2hOnly, medOnly, offRec, offBot };
})()`);
console.log('    ' + JSON.stringify(rec));
ok(`the median is the middle pair of the ten scores (${rec.med} = ${rec.expect})`, rec.med === rec.expect);
ok('top scorer banks both wins', rec.top.w === 2 && rec.top.l === 0);
ok('bottom scorer takes both losses', rec.bot.w === 0 && rec.bot.l === 2);
ok('head-to-head alone is one result', rec.h2hOnly.w === 1 && rec.h2hOnly.l === 0);
ok('the median alone is the other', rec.medOnly.w === 1 && rec.medOnly.l === 0);
ok('turning it off drops back to one result each',
   rec.offRec.w === 1 && rec.offRec.l === 0 && rec.offBot.w === 0 && rec.offBot.l === 1);

// migration: a league saved before the setting existed loads with it off
const migrated = await ev(`(()=>{
  const saved = JSON.parse(JSON.stringify(store.league));
  delete store.league.median; delete store.league.logo;
  store.league = Object.assign({}, LEAGUE_DEFAULTS, store.league);
  const after = { median: store.league.median, logo: store.league.logo };
  store.league = saved; return after;
})()`);
ok('an older save migrates with the median off', !+migrated.median);

// ---------------------------------------------------------------- 29 schedule
const sched = await ev(`(()=>{ showView('matchup'); renderUserMatchup();
  const rec = document.querySelector('.mstage .rec-tap');
  rec.click();
  const body = document.getElementById('scheduleBody');
  const row = body.querySelector('.sc-row');
  return { open: document.querySelector('.view[data-view="schedule"]').classList.contains('on'),
    weeks: body.querySelectorAll('.sc-row').length,
    hasOpp: !!row.querySelector('.sc-vs'), hasResult: !!row.querySelector('.sc-verdict'),
    hasScore: !!row.querySelector('.sc-score'), hasPts: !!row.querySelector('.sc-pts'),
    hasRec: !!row.querySelector('.sc-rec'), hasMed: !!row.querySelector('.sc-med'),
    text: row.textContent.replace(/\\s+/g,' ').trim() };
})()`);
console.log('    ' + JSON.stringify(sched));
ok('tapping a record opens the schedule', sched.open);
ok('one row per week', sched.weeks === 14);
ok('opponent, result, score, points and running record', sched.hasOpp && sched.hasResult
   && sched.hasScore && sched.hasPts && sched.hasRec);
ok('the median result is on each week too', sched.hasMed);
if (shots[3]) await p.screenshot({ path: shots[3] });

await ev(`setLeague('median','0',1)`);
ok('no page errors', errs.length === 0);
if (errs.length) console.log(errs.join('\n'));
await b.close();
console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
process.exit(fails ? 1 : 0);
