// Interaction checks for the matchup-graphic builder.
//
// Usage: node tools/builder-check.mjs [url]      (defaults to the dist build)
//
// Most of these assert what ends up *on the canvas*, because that is the whole
// product and none of it is in the DOM. Two exist because of specific traps:
// canvas text measures against whatever face has loaded at the moment it draws,
// so a graphic painted before the webfonts arrive keeps the fallback's line
// breaks forever; and rebuilding the panel on every keystroke drops focus, which
// on a phone closes the keyboard mid-score.
import { chromium } from 'playwright';

const url = process.argv[2] || 'file://' + process.cwd() + '/dist/builder.html';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ||
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + String(e).split('\n')[0]));

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.evaluate(`localStorage.clear()`);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

let pass = 0, fail = 0;
async function check(label, code, want) {
  const got = await page.evaluate(code).catch(e => 'ERR: ' + e.message);
  const ok = typeof want === 'function' ? want(got) : JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(34)} ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
  await page.waitForTimeout(80);
}

// how much of the canvas is not the background — a cheap way to assert that
// something was actually painted where we think it was
const inkIn = (x, y, w, h) => `(() => {
  const c = document.getElementById('stage');
  const d = c.getContext('2d').getImageData(${x}, ${y}, ${w}, ${h}).data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i+1] + d[i+2] > 210) lit++;
  return Math.round(lit / (d.length / 4) * 100);
})()`;

// ---- first run ----
await check('starts on the graphic tab', `document.querySelector('.tab.on').textContent`, 'GRAPHIC');
await check('canvas is the full-size stage', `(()=>{const c=document.getElementById('stage');
  return [c.width, c.height];})()`, [1370, 770]);
await check('schedule is prefilled', `document.querySelectorAll('.stage-wrap .chip').length`, n => n >= 5);
await check('every team is pickable', `document.querySelectorAll('[data-in=teamA] option').length`, 11);

// ---- picking a matchup ----
await check('a matchup loads both sides', `(()=>{document.querySelector('.stage-wrap .chip').click();
  return [document.querySelector('[data-in=teamA]').value,
          document.querySelector('[data-in=teamB]').value].filter(Boolean).length;})()`, 2);
// both crests are painted even though nobody has uploaded a logo
await check('left crest is drawn', inkIn(280, 180, 130, 130), n => n > 5);
await check('right crest is drawn', inkIn(960, 180, 130, 130), n => n > 5);
await check('name plates are drawn', inkIn(24, 22, 500, 74), n => n > 3);

// ---- scores drive the numbers ----
await check('scores tab has a row per game', `(()=>{document.querySelector('[data-tab=scores]').click();
  return document.querySelectorAll('.score-row').length;})()`, 5);
await check('typing a score keeps focus', `(()=>{
  const el = document.querySelector('.in.num'); el.focus();
  el.value = '123.4'; el.dispatchEvent(new Event('input', {bubbles:true}));
  return document.activeElement === el;})()`, true);
await check('standings pick it up live', `document.querySelectorAll('.stand-row').length`, 10);
// half a result is not a result: a game counts only once both scores are in,
// or a Sunday afternoon of typing would leave everyone 0-1 against the median.
await check('one score alone counts nothing', `[...document.querySelectorAll('.stand-row')]
  .every(r => r.textContent.includes('0-0'))`, true);
await check('both scores make a result', `(()=>{
  const el = document.querySelectorAll('.in.num')[1];
  el.value = '99.1'; el.dispatchEvent(new Event('input', {bubbles:true}));
  return [...document.querySelectorAll('.stand-row')].some(r => r.textContent.includes('2-0'));})()`, true);

// ---- captions ----
await check('suggestions come from the season', `(()=>{
  document.querySelector('[data-tab=graphic]').click();
  document.querySelector('[data-act=suggest]').click();
  return document.querySelectorAll('.btn.line').length;})()`, n => n > 0);
await check('a suggestion fills the caption', `(()=>{
  document.querySelector('.btn.line').click();
  return document.querySelector('[data-in=blurbA]').value.length;})()`, n => n > 10);
await check('the caption reaches the canvas', inkIn(582, 430, 206, 300), n => n > 1);

// ---- fonts ----
// Every face the graphic uses is embedded, so this must hold with no network.
await check('team faces are loaded', `(async()=>{await document.fonts.ready;
  return document.fonts.check('400 40px "Bungee"') && document.fonts.check('700 40px "Oswald"');})()`, true);

// ---- export ----
await check('export produces a 2x PNG', `(()=>{document.getElementById('exportBtn').click();
  const src = document.querySelector('#modal img').src;
  return src.startsWith('data:image/png') && src.length > 50000;})()`, true);
await check('export drops the editing chrome', `(()=>{
  document.querySelector('[data-act=closeModal]').click();
  return document.getElementById('modal').hidden;})()`, true);

// ---- persistence ----
await check('the league is saved', `!!localStorage.getItem('cbd_builder_v1')`, true);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
await check('scores survive a reload', `(()=>{document.querySelector('[data-tab=scores]').click();
  return document.querySelector('.in.num').value;})()`, '123.4');
await check('the matchup survives too', `(()=>{document.querySelector('[data-tab=graphic]').click();
  return !!document.querySelector('[data-in=teamA]').value;})()`, true);

console.log(`\n${pass} passed, ${fail} failed${errors.length ? '\n' + errors.join('\n') : ''}`);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
