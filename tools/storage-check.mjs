// Proves an uploaded picture can no longer stop the app saving anything else.
//
// The bug: every uploaded image lived in the same localStorage key as the app
// state, and that key was rewritten whole on every change. Thirty-eight
// backdrops filled the origin's ~5 MB, after which importing a league or
// switching a trade partner failed too — memory and disk silently diverged.
//
// Usage: node tools/storage-check.mjs [path-to-html]
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

// A noisy image, so the JPEG encoder cannot cheat its way under the cap.
const makeImage = `(async (dim, mime, q, cap) => {
  const c = document.createElement('canvas'); c.width = 1600; c.height = 1200;
  const x = c.getContext('2d'); const d = x.createImageData(1600, 1200);
  for (let i = 0; i < d.data.length; i += 4) {
    d.data[i] = (i * 7) % 256; d.data[i+1] = (i * 13) % 256; d.data[i+2] = (i * 29) % 256; d.data[i+3] = 255;
  }
  x.putImageData(d, 0, 0);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.95));
  const file = new File([blob], 'x.jpg', { type: 'image/jpeg' });
  return await new Promise(res => processImage(file, dim, mime, q, res, cap));
})`;

console.log('\nan upload is bounded');
const sizes = await ev(`(async () => ({
  backdrop: (await ${makeImage}(900, 'image/jpeg', 0.8, 110 * 1024)).length,
  photo: (await ${makeImage}(384, 'image/jpeg', 0.82, 40 * 1024)).length,
  logo: (await ${makeImage}(256, 'image/png', 0.92, 64 * 1024)).length
}))()`);
console.log('   ', JSON.stringify(sizes));
check('a backdrop stays under its cap', sizes.backdrop <= 110 * 1024, `${sizes.backdrop}`);
check('a player photo stays under its cap', sizes.photo <= 40 * 1024, `${sizes.photo}`);
check('a logo stays under its cap', sizes.logo <= 64 * 1024, `${sizes.logo}`);
check('the backdrop shrank from the old 135 KB', sizes.backdrop < 135000, `${sizes.backdrop}`);

console.log('\nstate and pictures live apart');
await ev(`store.activeLeague = 'sunday'; saveStore()`);
const split = await ev(`(async () => {
  const url = await ${makeImage}(900, 'image/jpeg', 0.8, 110 * 1024);
  store.backdrops = store.backdrops || {}; store.backdrops.k1 = url;
  saveStore();
  return {
    stateChars: (localStorage.getItem('cbd_team_v1') || '').length,
    imageChars: (localStorage.getItem('cbd_images_v1') || '').length,
    stateHasDataUrl: /data:image/.test(localStorage.getItem('cbd_team_v1') || ''),
    stillInMemory: /^data:image/.test(store.backdrops.k1 || '')
  };
})()`);
console.log('   ', JSON.stringify(split));
check('the picture is not in the state blob', split.stateHasDataUrl === false);
check('the state blob stays small', split.stateChars < 100000, `${split.stateChars}`);
check('the picture is in its own key', split.imageChars > 50000, `${split.imageChars}`);
check('the app still reads it as a data URL', split.stillInMemory === true);

console.log('\nfilling it with pictures no longer blocks the app');
const fill = await ev(`(async () => {
  const url = await ${makeImage}(900, 'image/jpeg', 0.8, 110 * 1024);
  for (let i = 0; i < 120; i++) { store.backdrops['fake' + i] = url; saveStore(); }
  return {
    kept: Object.keys(store.backdrops).length,
    imageChars: (localStorage.getItem('cbd_images_v1') || '').length,
    warned: document.getElementById('saveWarn') ? document.getElementById('saveWarn').dataset.kind : null
  };
})()`);
console.log('   ', JSON.stringify(fill));
check('pictures are capped at the budget, not the quota', fill.imageChars < 3.2 * 1024 * 1024, `${fill.imageChars}`);
check('the oldest were evicted rather than everything breaking', fill.kept < 120, `${fill.kept} kept`);
check('eviction is reported honestly', fill.warned === 'evicted', String(fill.warned));

console.log('\nthe reported symptoms, with storage under pressure');
const ordinary = await ev(`(() => {
  store.activeLeague = 'midway';
  const ok = saveStore();
  const onDisk = (JSON.parse(localStorage.getItem('cbd_team_v1') || '{}')).activeLeague;
  return { ok, onDisk, inMemory: store.activeLeague };
})()`);
console.log('   ', JSON.stringify(ordinary));
check('an ordinary change still saves', ordinary.ok === true);
check('disk agrees with memory', ordinary.onDisk === ordinary.inMemory, JSON.stringify(ordinary));

await ev(`document.getElementById('saveWarn') && document.getElementById('saveWarn').remove()`);
// The repo's own build predates the Sleeper import, so this leg only runs where
// the feature exists; the storage behaviour it proves is checked either way.
const hasImport = await ev(`typeof openImport === 'function'`);
const imported = !hasImport ? null : await ev(`(async () => {
  openImport(); importSetUser('someone'); importFind();
  for (let i = 0; i < 60 && impState().busy; i++) await new Promise(r => setTimeout(r, 100));
  importPickLeague('demo');
  for (let i = 0; i < 60 && impState().step !== 2; i++) await new Promise(r => setTimeout(r, 100));
  importRun();
  for (let i = 0; i < 60 && impState().step !== 3; i++) await new Promise(r => setTimeout(r, 100));
  const id = impState().newId;
  return { id, onDisk: ((JSON.parse(localStorage.getItem('cbd_team_v1') || '{}')).imported || []).length,
           warn: document.getElementById('saveWarn') ? document.getElementById('saveWarn').dataset.kind : null };
})()`);
console.log('   ', JSON.stringify(imported));
if (imported) {
  check('a league import persists with storage full of pictures', imported.onDisk === 1, JSON.stringify(imported));
  check('no storage warning during the import', imported.warn === null, String(imported.warn));
} else {
  console.log('  skip this build has no import feature');
}

console.log('\npictures survive a reload');
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);
const after = await ev(`(() => ({
  backdrops: Object.keys(store.backdrops || {}).length,
  looksLikeImage: /^data:image/.test(Object.values(store.backdrops || {})[0] || ''),
  imported: (store.imported || []).length,
  activeLeague: store.activeLeague
}))()`);
console.log('   ', JSON.stringify(after));
check('backdrops come back', after.backdrops > 0, `${after.backdrops}`);
check('they come back as usable images', after.looksLikeImage === true);
if (imported) check('the imported league came back too', after.imported === 1, `${after.imported}`);

console.log('\nthe warning text matches the failure');
// Fill the origin from outside the app so the state save genuinely fails, and
// read what the user is actually shown.
const warned = await ev(`(() => {
  document.getElementById('saveWarn') && document.getElementById('saveWarn').remove();
  const blob = 'x'.repeat(512 * 1024);
  let n = 0;
  try { for (; n < 40; n++) localStorage.setItem('ballast' + n, blob); } catch (e) {}
  // Stuffing the origin is not enough on its own — the small state blob still
  // fits in the room its old copy occupied, which is the point of the split.
  // Making the state itself oversized is what forces the failure path.
  store._oversized = 'x'.repeat(6 * 1024 * 1024);
  store.activeLeague = 'hallmark';
  const ok = saveStore();
  delete store._oversized;
  const el = document.getElementById('saveWarn');
  const text = el ? el.textContent : '';
  for (let i = 0; i <= n; i++) localStorage.removeItem('ballast' + i);
  return { ok, text };
})()`);
console.log('   ', JSON.stringify(warned));
check('a state too big to store is reported', warned.ok === false && warned.text.length > 0, JSON.stringify(warned));
check('the message no longer blames photos for it', !/photo|picture/i.test(warned.text), warned.text);
check('it names what really happened', /out of storage/i.test(warned.text), warned.text);

console.log(`\n${pass} passed, ${fail} failed`);
console.log(errors.length ? `page errors:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
