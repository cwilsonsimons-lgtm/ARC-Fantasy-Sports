// Checks the commissioner permission split: everyone reads, only the
// commissioner writes, and only the commissioner sees the extra tab.
import { chromium } from 'playwright';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
await p.route('**', r => (new URL(r.request().url()).protocol === 'file:' ? r.continue() : r.abort()));
await p.goto('file://' + process.argv[2], { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(700);
const shots = process.argv.slice(3);

const snap = () => p.evaluate(`(()=>{
  const q = s => [...document.querySelectorAll(s)];
  return {
    tabs: q('.set-tab').map(e => e.textContent.trim()),
    ctls: q('#settingsBody .set-ctl').length,
    disabled: q('#settingsBody .set-ctl:disabled').length,
    btns: q('#settingsBody .set-btn').map(e => e.textContent.trim()),
    banner: (document.querySelector('.set-ro-t') || {}).textContent || null,
    sub: document.querySelector('.set-sub').textContent.trim(),
  };
})()`);

const ok = (label, cond) => console.log((cond ? '  ok   ' : '  FAIL ') + label);

await p.evaluate(`openSettings()`); await p.waitForTimeout(250);
console.log('--- commissioner (you own the role) ---');
let s = await snap(); console.log(JSON.stringify(s));
ok('Commissioner tab present', s.tabs.some(t=>/Commissioner/.test(t)));
ok('nothing disabled', s.disabled === 0 && s.ctls > 0);

await p.evaluate(`setSetTab('commish')`); await p.waitForTimeout(250);
if (shots[0]) await p.screenshot({ path: shots[0] });

// --- flip to the member view -------------------------------------------
await p.evaluate(`togglePreviewAsMember()`); await p.waitForTimeout(250);
console.log('--- previewing as a member ---');
s = await snap(); console.log(JSON.stringify(s));
ok('Commissioner tab hidden', !s.tabs.some(t=>/Commissioner/.test(t)));
ok('kicked off the commish tab', true);
ok('every control disabled', s.ctls > 0 && s.disabled === s.ctls);
ok('banner shown', /Previewing/.test(s.banner || ''));
if (shots[1]) await p.screenshot({ path: shots[1] });

for (const t of ['general', 'roster', 'scoring', 'matchups']) {
  await p.evaluate(`setSetTab('${t}')`); await p.waitForTimeout(150);
  const v = await snap();
  ok(`${t}: ${v.ctls} controls, all disabled, ${v.btns.length} buttons`,
     v.disabled === v.ctls && v.btns.length === 0);
}
await p.evaluate(`setSetTab('general')`); await p.waitForTimeout(150);

// writes must not land
const before = await p.evaluate(`LG().type`);
await p.evaluate(`setLeague('type','redraft')`); await p.waitForTimeout(150);
ok('setLeague blocked', (await p.evaluate(`LG().type`)) === before);
const sc = await p.evaluate(`SC().rec`);
await p.evaluate(`setScoring('rec','0.5')`); await p.waitForTimeout(150);
ok('setScoring blocked', (await p.evaluate(`SC().rec`)) === sc);
const bench = await p.evaluate(`SLOTS().bench`);
await p.evaluate(`setSlot('bench','3')`); await p.waitForTimeout(150);
ok('setSlot blocked', (await p.evaluate(`SLOTS().bench`)) === bench);
await p.evaluate(`resetScoring()`); await p.waitForTimeout(150);
ok('resetScoring blocked', (await p.evaluate(`SC().rec`)) === sc);
await p.evaluate(`clearAllBackdrops()`); await p.waitForTimeout(150);
ok('setCommish blocked from member view', (await p.evaluate(`(setCommish('barzal'), LG().commish)`)) === 'pandas');

// --- back, then hand the role to someone else --------------------------
await p.evaluate(`togglePreviewAsMember()`); await p.waitForTimeout(200);
ok('back to commissioner', (await snap()).tabs.some(t=>/Commissioner/.test(t)));
await p.evaluate(`setSetTab('commish');setCommish('barzal')`); await p.waitForTimeout(250);
ok('transfer asks first', (await p.evaluate(`LG().commish`)) === 'pandas'
  && /Make Luke commissioner/.test(await p.evaluate(`document.getElementById('confirmTitle').textContent`)));
await p.evaluate(`closeConfirm()`); await p.waitForTimeout(150);
ok('cancel keeps the role', (await p.evaluate(`LG().commish`)) === 'pandas');
await p.evaluate(`setCommish('barzal')`); await p.waitForTimeout(200);
await p.evaluate(`doConfirm()`); await p.waitForTimeout(250);
console.log('--- role handed to Barzal ---');
s = await snap(); console.log(JSON.stringify(s));
ok('commish stored', (await p.evaluate(`LG().commish`)) === 'barzal');
ok('tab gone', !s.tabs.some(t=>/Commissioner/.test(t)));
ok('bounced to General', s.tabs.length === 4);
ok('every control disabled', s.ctls > 0 && s.disabled === s.ctls);
ok('banner names the commissioner', /Only Luke/.test(await p.evaluate(`document.querySelector('.set-ro-s').textContent`)));
ok('no take-it-back button', !(await p.evaluate(`!!document.querySelector('.set-ro-btn')`)));
if (shots[2]) await p.screenshot({ path: shots[2] });

// survives a reload
await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
await p.evaluate(`openSettings()`); await p.waitForTimeout(250);
ok('persisted across reload', (await p.evaluate(`LG().commish`)) === 'barzal'
  && !(await snap()).tabs.some(t=>/Commissioner/.test(t)));

console.log(errs.length ? 'PAGE ERRORS:\n' + errs.join('\n') : 'no page errors');
await b.close();
