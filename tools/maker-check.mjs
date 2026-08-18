// Checks for the matchup screen maker.
//
// Usage: node tools/maker-check.mjs [url]      (defaults to the dist build)
//
// Several of these read pixels rather than the DOM, because the thing that
// actually goes wrong in a layout tool is geometry: a name that overflows its
// plate, a note that runs off the canvas, a mirrored slot that is two pixels
// out. None of that shows up in a text assertion - the canvas is the product.
import { chromium } from 'playwright';

const url = process.argv[2] || 'file://' + process.cwd() + '/dist/maker.html';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ||
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });

const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + String(e).split('\n')[0]));
page.on('dialog', d => d.accept());

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.evaluate(`localStorage.clear()`);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.MK && MK.state.teams.length', null, { timeout: 15000 });
await page.waitForTimeout(500);

let pass = 0, fail = 0;
async function check(label, code, want) {
  const got = await page.evaluate(code).catch(e => 'ERR: ' + e.message);
  const ok = typeof want === 'function' ? want(got) : JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(38)} ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

// Where a slot actually put ink, as fractions of the canvas. The background is
// opaque, so this diffs the drawn canvas against the same template with every
// slot hidden - what is left is exactly what that slot painted.
const INK = `(a, b) => {
  const ca = a.getContext('2d').getImageData(0, 0, a.width, a.height).data;
  const cb = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const i = (y * a.width + x) * 4;
    const d = Math.abs(ca[i] - cb[i]) + Math.abs(ca[i+1] - cb[i+1]) + Math.abs(ca[i+2] - cb[i+2]);
    if (d > 24) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0 / a.width, y: y0 / a.height, r: x1 / a.width, b: y1 / a.height };
}`;

// A season with known results, so every derived number has one right answer.
await page.evaluate(`(() => {
  const S = MK.state;
  const ids = S.teams.map(t => t.id);
  S.schedule = { 1: [], 2: [] };
  // Two teams, three weeks of results we can check by hand.
  S.schedule[1].push(Object.assign(MK.newGame(ids[0], ids[1]), { as: 100, bs: 90, final: true }));
  S.schedule[1].push(Object.assign(MK.newGame(ids[2], ids[3]), { as: 120, bs: 130, final: true }));
  S.schedule[2].push(Object.assign(MK.newGame(ids[0], ids[2]), { as: 110, bs: 150, final: true }));
  S.schedule[2].push(Object.assign(MK.newGame(ids[1], ids[3]), { as: 80,  bs: 70,  final: true }));
  S.schedule[3] = [Object.assign(MK.newGame(ids[0], ids[1]), { noteA: 'a note that is long enough to need wrapping across several lines', noteB: 'short' })];
  S.week = 3;
  MK.save(); MK.refresh();
})()`);

console.log('\n-- data --');
await check('league seeded from the app', `MK.state.teams.length`, 10);
await check('a default template exists', `MK.state.templates.length`, 1);
await check('template has its slots', `MK.tpl(MK.state.defaultTpl).slots.length`, n => n >= 12);
await check('record from results', `MK.stats(2).rows.get(MK.state.teams[0].id).record`, '1-1');
await check('points for', `MK.stats(2).rows.get(MK.state.teams[0].id).pf`, 210);
await check('average points', `MK.stats(2).rows.get(MK.state.teams[0].id).ppg`, 105);
await check('streak', `MK.stats(2).rows.get(MK.state.teams[2].id).streak`, 'W1');
await check('unplayed teams show 0-0', `MK.stats(2).rows.get(MK.state.teams[9].id).record`, '0-0');
await check('rank sorts by wins then PF', `MK.stats(2).order.slice(0,2).map(r => r.record)`, ['1-1', '1-1']);
await check('ties break on points for',
  `(()=>{const o=MK.stats(2).order.filter(r=>r.gp);return o[0].pf >= o[1].pf;})()`, true);

// A preview screen shows the records the teams walk in with; a recap shows the
// week just played. Getting this backwards is the mistake the tool exists to
// stop, so it is asserted both ways.
await check('preview stats exclude this week',
  `MK.context(MK.state.schedule[2][0], 2, { includeWeek: false }).sa.record`, '1-0');
await check('recap stats include this week',
  `MK.context(MK.state.schedule[2][0], 2, { includeWeek: true }).sa.record`, '1-1');

await check('tokens resolve',
  `MK.resolve('{{team}} {{record}} {{ppg}}', 'a', MK.context(MK.state.schedule[2][0], 2, {}))`,
  s => /^\S.* 1-0 100\.00$/.test(s));
await check('score token is blank until final',
  `MK.resolve('{{score}}', 'a', MK.context(MK.state.schedule[3][0], 3, {}))`, '');

await check('round robin plays everyone once',
  `(()=>{const s=MK.roundRobin(MK.state.teams.map(t=>t.id), 9);
     const seen=new Set(); let dup=0;
     Object.values(s).forEach(w=>w.forEach(([a,b])=>{const k=[a,b].sort().join('|');
       if(seen.has(k)) dup++; seen.add(k);}));
     return [Object.keys(s).length, seen.size, dup];})()`, [9, 45, 0]);
await check('nobody plays twice in a week',
  `(()=>{const s=MK.roundRobin(MK.state.teams.map(t=>t.id), 9);
     return Object.values(s).every(w=>new Set(w.flat()).size === w.length*2);})()`, true);

console.log('\n-- rendering --');
await check('export canvas matches template size',
  `(()=>{const c=document.createElement('canvas');
     MK.draw(c,{tplId:MK.state.defaultTpl,game:MK.state.schedule[3][0],week:3,scale:1});
     const t=MK.tpl(MK.state.defaultTpl); return [c.width===t.w, c.height===t.h];})()`, [true, true]);
await check('preview scale keeps the aspect',
  `(()=>{const t=MK.tpl(MK.state.defaultTpl); const c=document.createElement('canvas');
     MK.draw(c,{tplId:t.id,game:MK.state.schedule[3][0],week:3,scale:.25});
     return Math.abs(c.width/c.height - t.w/t.h) < .01;})()`, true);

// Draw one slot on its own and prove the ink lands inside it. A 60-character
// team name in a plate sized for "UGF Pandas" is the case that has to shrink.
const soloInk = (slotId, name) => `(() => {
  const t = MK.tpl(MK.state.defaultTpl);
  const keep = t.slots.map(s => s.hidden);
  const team = MK.state.teams[0], oldName = team.name;
  ${name ? `team.name = ${JSON.stringify(name)};` : ''}
  const opts = { tplId: t.id, game: MK.state.schedule[3][0], week: 3, scale: 1 };
  const bare = document.createElement('canvas');
  t.slots.forEach(s => { s.hidden = true; });
  MK.draw(bare, opts);
  const one = document.createElement('canvas');
  t.slots.forEach(s => { s.hidden = s.id !== '${slotId}'; });
  MK.draw(one, opts);
  const ink = (${INK})(one, bare);
  const s = t.slots.find(x => x.id === '${slotId}');
  t.slots.forEach((x, i) => { x.hidden = keep[i]; });
  team.name = oldName;
  if (!ink) return 'no ink';
  const pad = 0.006;  // outline and shadow legitimately bleed past the box
  return { fits: ink.x >= s.x - pad && ink.r <= s.x + s.w + pad &&
                 ink.y >= s.y - pad && ink.b <= s.y + s.h + pad,
           fill: Math.round((ink.r - ink.x) / s.w * 100),
           rows: Math.round((ink.b - ink.y) / (s.h) * 100) };
})()`;

await check('a name stays inside its plate', soloInk('nameA'), r => r && r.fits === true);
await check('a very long name shrinks to fit',
  soloInk('nameA', 'The Mike Vick Memorial Dog House Appreciation Society'), r => r && r.fits === true);
await check('a wrapped note stays in its box', soloInk('noteA'), r => r && r.fits === true);
await check('the wrapped note fills its box', soloInk('noteA'), r => r && r.rows > 40);
// Auto-fit should use the box, not render timidly small in it. A width-bound
// name lands at ~100% plus the outline, which draws outward from the glyph.
await check('a name fills its box', soloInk('nameA'), r => r && r.fill >= 50 && r.fill <= 108);

await check('hidden slots draw nothing',
  `(()=>{const t=MK.tpl(MK.state.defaultTpl);
     const c1=document.createElement('canvas'), c2=document.createElement('canvas');
     MK.draw(c1,{tplId:t.id,game:MK.state.schedule[3][0],week:3,scale:.5});
     const a=c1.toDataURL();
     t.slots.forEach(s=>{s.hidden=true});
     MK.draw(c2,{tplId:t.id,game:MK.state.schedule[3][0],week:3,scale:.5});
     const b=c2.toDataURL();
     t.slots.forEach(s=>{s.hidden=false});
     return a !== b;})()`, true);

console.log('\n-- editor --');
await page.evaluate(`MK.showPane('template')`);
await page.waitForTimeout(400);
await check('a slot box per slot',
  `[document.querySelectorAll('#edOverlay .sbox').length, MK.tpl(MK.state.editTpl).slots.length]`,
  r => Array.isArray(r) && r[0] === r[1]);
await check('slot list renders', `document.querySelectorAll('#edSlots li').length`, n => n >= 12);

// Mirroring is the whole reason these screens look symmetrical.
await check('mirror puts B opposite A', `(async () => {
  const t = MK.tpl(MK.state.editTpl);
  const a = t.slots.find(s => s.id === 'nameA');
  a.x = 0.037;
  MK.paintEditor();
  [...document.querySelectorAll('#edSlots li')].find(li => li.textContent.includes('Name A')).click();
  [...document.querySelectorAll('#edProps .btn')].find(b => /Mirror/.test(b.textContent)).click();
  const b = MK.tpl(MK.state.editTpl).slots.find(s => s.id === 'nameB');
  return Math.abs(b.x - (1 - a.x - a.w)) < 1e-9;
})()`, true);

await check('dragging a slot moves it', `(async () => {
  const slots = MK.tpl(MK.state.editTpl).slots;
  const i = slots.findIndex(s => s.id === 'nameA');
  const before = slots[i].x;
  const box = document.querySelectorAll('#edOverlay .sbox')[i];
  const r = box.getBoundingClientRect();
  const opts = { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, pointerId: 1 };
  box.dispatchEvent(new PointerEvent('pointerdown', opts));
  box.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, opts, { clientX: opts.clientX + 60, altKey: true })));
  box.dispatchEvent(new PointerEvent('pointerup', opts));
  const after = MK.tpl(MK.state.editTpl).slots.find(s => s.id === 'nameA').x;
  return after > before;
})()`, true);

console.log('\n-- background photos --');
// Importing a photo used to fail two ways without saying anything: a file the
// browser cannot decode (every iPhone HEIC) was stored and then never drawn,
// and with IndexedDB denied the whole import rejected silently.
const drop = (name, type, bytes) => `(async () => {
  const dt = new DataTransfer();
  dt.items.add(new File([new Uint8Array(${JSON.stringify(bytes)})], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} }));
  document.getElementById('edStage').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
  await new Promise(r => setTimeout(r, 700));
  return { photos: MK.state.photos.length, toast: document.getElementById('toast').textContent };
})()`;

await page.evaluate(`MK.showPane('template')`);
await page.waitForTimeout(300);
const before = await page.evaluate('MK.state.photos.length');

await check('a real photo dropped on the canvas', `(async () => {
  const c = document.createElement('canvas'); c.width = 640; c.height = 400;
  const x = c.getContext('2d'); x.fillStyle = '#247'; x.fillRect(0, 0, 640, 400);
  const png = await new Promise(r => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([png], 'stadium.png', { type: 'image/png' }));
  document.getElementById('edStage').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
  await new Promise(r => setTimeout(r, 800));
  const t = MK.tpl(MK.state.editTpl);
  return { inLibrary: MK.state.photos.some(p => p.name === 'stadium'),
           onTemplate: MK.state.photos.at(-1).id === t.bg,
           sized: t.w === 640 && t.h === 400 };
})()`, r => r && r.inLibrary && r.onTemplate && r.sized);

await check('a photo the browser cannot read is explained',
  drop('IMG_4821.HEIC', 'image/heic', [0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99]),
  r => r && /HEIC/.test(r.toast) && r.photos === before + 1);
await check('a non-image is turned away',
  drop('notes.txt', 'text/plain', [104, 105]),
  r => r && /not image files/.test(r.toast) && r.photos === before + 1);
await check('thumbnail per library photo',
  `[document.querySelectorAll('#edBgBar .bgtile').length, MK.state.photos.length + 1]`,
  r => Array.isArray(r) && r[0] === r[1]);
await check('a thumbnail swaps the background', `(async () => {
  const first = MK.state.photos[0].id;
  document.querySelectorAll('#edBgBar .bgtile')[1].click();
  await new Promise(r => setTimeout(r, 400));
  return MK.tpl(MK.state.editTpl).bg === first;
})()`, true);

console.log('\n-- persistence --');
const movedX = await page.evaluate(`MK.tpl(MK.state.editTpl).slots.find(s => s.id === 'nameA').x`);
await page.waitForTimeout(300);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.MK && MK.state.teams.length', null, { timeout: 15000 });
await check('slot positions survive a reload',
  `MK.tpl(MK.state.editTpl).slots.find(s => s.id === 'nameA').x`, x => Math.abs(x - movedX) < 1e-9);
await check('scores survive a reload', `MK.stats(2).rows.get(MK.state.teams[0].id).record`, '1-1');
await check('imported photos survive a reload',
  `MK.state.photos.filter(p => document.createElement('img') && p.name).length`, n => n >= 1);

console.log('\n-- screens --');
await page.evaluate(`MK.showPane('screens')`);
await page.waitForTimeout(600);
await check('one card per matchup',
  `[document.querySelectorAll('#screenGrid .shot').length, MK.state.schedule[MK.state.week].length]`,
  r => Array.isArray(r) && r[0] === r[1]);
await check('every card drew something',
  `[...document.querySelectorAll('#screenGrid canvas')].every(c => c.width > 100 && c.height > 100)`, true);

console.log(`\n${pass} passed, ${fail} failed` + (errors.length ? `\n${errors.join('\n')}` : ''));
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
