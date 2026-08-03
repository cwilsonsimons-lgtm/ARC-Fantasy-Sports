// Scoring settings and the engine behind them.
//
// The assertions that matter most are the ones about *not hardcoding*: that the
// engine reads the league's stored values rather than constants, that a rule
// added to the catalog needs no engine change, and that every rule the catalog
// declares is reachable in the UI.
//
// Usage: npm start (in one shell), then node tools/scoring-check.mjs
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://127.0.0.1:8080/index.html';
let pass = 0, fail = 0;
const errs = [];
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`); }
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ||
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.route('**/*', r =>
  /^http:\/\/127\.0\.0\.1:8080\//.test(r.request().url()) ? r.continue() : r.abort());
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => {
  if (m.type() !== 'error') return;
  if (/Failed to load resource/.test(m.text())) return;
  errs.push(m.text());
});
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const ev = (fn, arg) => page.evaluate(fn, arg);

console.log('\ncatalog');
ok('every category from the spec is present',
  await ev(() => {
    const want = ['Passing','Rushing','Receiving','Kicking','Team Defense','ST Defense',
                  'ST Player','IDP','Misc','Bonuses'];
    const got = window.SCORING_CATEGORIES.map(c => c.lb);
    return want.every(w => got.includes(w));
  }));
const count = await ev(() => window.ALL_RULES.length);
ok('the catalog is complete', count >= 140, count);
ok('every rule has a key, a label and help',
  await ev(() => window.ALL_RULES.every(r => r.k && r.lb && r.help && r.help.length > 10)));
ok('keys are unique',
  await ev(() => new Set(window.ALL_RULES.map(r => r.k)).size === window.ALL_RULES.length));
ok('yard rules are flagged and convert both ways',
  await ev(() => {
    const yd = window.ALL_RULES.filter(r => r.per === 'yd');
    return yd.length >= 8
      && window.yardsPerPoint(0.04) === 25
      && window.perYardFromYards(25) === 0.04
      && window.yardsPerPoint(0.1) === 10;
  }));

console.log('\nstorage, not constants');
await ev(() => window.openLeague('cbd'));
await page.waitForTimeout(200);
ok('values live in the store, keyed by league',
  await ev(() => {
    const bag = window.scoringBag();
    return !!window.store.scoringByLeague
      && window.store.scoringByLeague.cbd === bag
      && typeof bag.passYd === 'number';
  }));
ok('scoring is per league',
  await ev(() => {
    window.setScoreValue('rec', 1);
    const a = window.scoreValue('rec');
    window.openLeague('sunday');
    window.applyPreset('espn');            // ESPN default is non-PPR
    const b = window.scoreValue('rec');
    window.openLeague('cbd');
    const c = window.scoreValue('rec');
    return a === 1 && b === 0 && c === 1;
  }));
ok('negative, decimal and whole values all persist',
  await ev(() => {
    window.setScoreValue('passInt', -2.5);
    window.setScoreValue('rec', 0.5);
    window.setScoreValue('passTD', 6);
    return window.scoreValue('passInt') === -2.5 && window.scoreValue('rec') === 0.5
      && window.scoreValue('passTD') === 6;
  }));

console.log('\nthe engine reads settings, not constants');
ok('changing a value changes the score',
  await ev(() => {
    const stats = { rec: 8, recYd: 100, recTD: 1 };
    window.setScoreValue('rec', 0);
    const std = window.scoreStats(stats).total;
    window.setScoreValue('rec', 1);
    const ppr = window.scoreStats(stats).total;
    window.setScoreValue('rec', 0.5);
    const half = window.scoreStats(stats).total;
    return ppr - std === 8 && half - std === 4;
  }));
ok('yardage scores off the stored per-yard value',
  await ev(() => {
    window.setScoreValue('recYd', 0.1);
    const a = window.scoreStats({ recYd: 100 }).total;
    window.setScoreValue('recYd', 0.05);
    const b = window.scoreStats({ recYd: 100 }).total;
    return a === 10 && b === 5;
  }));
ok('a rule left at zero contributes nothing',
  await ev(() => {
    window.setScoreValue('passAtt', 0);
    return window.scoreStats({ passAtt: 40 }).total === 0;
  }));
ok('position bonuses stack on top of the general rule',
  await ev(() => {
    window.setScoreValue('rec', 1);
    window.setScoreValue('recTE', 0.5);
    const te = window.scoreStats({ rec: 6 }, { pos: 'TE' }).total;
    const wr = window.scoreStats({ rec: 6 }, { pos: 'WR' }).total;
    return te === 9 && wr === 6;
  }));
ok('the breakdown names every rule that fired',
  await ev(() => {
    const out = window.scoreStats({ rec: 5, recYd: 60, recTD: 1 }, { pos: 'WR' });
    return out.lines.length >= 3 && out.lines.every(l => l.lb && typeof l.pts === 'number')
      && Math.abs(out.lines.reduce((n, l) => n + l.pts, 0) - out.total) < 0.02;
  }));
// the point of a data-driven engine: a new rule needs no engine change
ok('a rule added to the catalog scores with no engine change',
  await ev(() => {
    window.ALL_RULES.push({ k:'__test', lb:'Test Rule', cat:'misc', catLb:'Misc',
                            group:'Miscellaneous', help:'x', step:0.01 });
    window.setScoreValue('__test', 3);          // rejected: not in RULE_BY_KEY
    window.RULE_BY_KEY.__test = window.ALL_RULES[window.ALL_RULES.length - 1];
    window.setScoreValue('__test', 3);
    const got = window.scoreStats({ __test: 2 }).total;
    window.ALL_RULES.pop(); delete window.RULE_BY_KEY.__test;
    return got === 6;
  }));

console.log('\npresets');
ok('five presets, each covering every rule',
  await ev(() => {
    const want = ['sleeper','espn','yahoo','nfl','cbs'];
    if (!want.every(id => window.PRESET_BY_ID[id])) return false;
    return want.every(id => {
      const v = window.presetValues(id);
      return window.ALL_RULES.every(r => typeof v[r.k] === 'number');
    });
  }));
ok('presets differ from each other',
  await ev(() => {
    const s = window.presetValues('sleeper'), e = window.presetValues('espn');
    return s.rec !== e.rec;
  }));
ok('picking a preset repopulates every value',
  await ev(() => {
    window.applyPreset('sleeper');
    const before = window.scoreValue('rec');
    window.applyPreset('espn');
    const after = window.scoreValue('rec');
    return before === 1 && after === 0 && window.activePreset() === 'espn';
  }));
ok('a preset leaves nothing stale from the last one',
  await ev(() => {
    window.applyPreset('espn');
    window.setScoreValue('idpSack', 4);       // not part of any preset
    window.applyPreset('sleeper');
    return window.scoreValue('idpSack') === 0;
  }));
ok('reset restores the selected preset, not a global default',
  await ev(() => {
    window.applyPreset('yahoo');
    const base = window.scoreValue('rec');
    window.setScoreValue('rec', 3);
    const dirty = window.isDirty();
    window.resetScoringToPreset();
    return base === 0.5 && dirty && window.scoreValue('rec') === 0.5
      && window.activePreset() === 'yahoo' && !window.isDirty();
  }));

console.log('\nsearch and favourites');
ok('search crosses categories',
  await ev(() => {
    const hits = window.searchRules('touchdown');
    const cats = new Set(hits.map(h => h.cat));
    return hits.length >= 8 && cats.size >= 4;
  }));
ok('search matches help text as well as labels',
  await ev(() => (window.searchRules('shutout') || []).some(r => r.k === 'pa0')));
ok('an empty query is not a search',
  await ev(() => window.searchRules('') === null));
ok('favourites persist and toggle',
  await ev(() => {
    window.toggleFav('rec');
    const on = window.isFav('rec') && window.store.scoringFavs.includes('rec');
    window.toggleFav('rec');
    return on && !window.isFav('rec');
  }));

console.log('\nthe UI is built from the catalog');
await ev(() => { window.openLeague('cbd'); window.openSettings(); window.setSetTab('scoring'); });
await page.waitForTimeout(400);
ok('scoring tab renders', (await page.$$('#scoringBody')).length === 1);
ok('a tab per category, plus favourites',
  (await page.$$('.sc-tab')).length === await ev(() => window.SCORING_CATEGORIES.length + 1));
ok('tabs scroll horizontally rather than wrapping',
  await ev(() => {
    const t = document.querySelector('.sc-tabs');
    return getComputedStyle(t).overflowX === 'auto' && t.scrollWidth > t.clientWidth;
  }));
ok('preset buttons render', (await page.$$('.sc-preset')).length === 5);
ok('every rule in a category is on screen',
  await ev(() => {
    window.setScoringTab('pass');
    const want = window.SCORING_CATEGORIES.find(c => c.id === 'pass')
      .groups.reduce((n, g) => n + g.rules.length, 0);
    return document.querySelectorAll('#scList .sc-row').length === want;
  }));
ok('every rule in the catalog is reachable through some tab',
  await ev(() => {
    const seen = new Set();
    window.SCORING_CATEGORIES.forEach(c => {
      window.setScoringTab(c.id);
      document.querySelectorAll('#scList .sc-row').forEach(r => seen.add(r.dataset.rule));
    });
    window.setScoringTab('pass');
    return seen.size === window.ALL_RULES.length;
  }));
ok('yard rules render as 1 point every N yards',
  await ev(() => {
    window.setScoringTab('pass');
    const row = document.querySelector('.sc-row[data-rule="passYd"]');
    return /1 point every/.test(row.textContent) && /per yard/.test(row.textContent)
      && !!row.querySelector('.sc-in.yd');
  }));
ok('editing the yards field stores the per-yard value',
  await ev(() => {
    window.setYardRule('passYd', 25);
    const a = window.scoreValue('passYd');
    window.setYardRule('passYd', 20);
    const b = window.scoreValue('passYd');
    return a === 0.04 && b === 0.05;
  }));
ok('every row has an info tooltip toggle',
  await ev(() => {
    const rows = [...document.querySelectorAll('#scList .sc-row')];
    return rows.length > 0 && rows.every(r => r.querySelector('.sc-info'));
  }));
ok('tapping info shows the explanation',
  await ev(() => {
    window.toggleTip('passYd');
    const row = document.querySelector('.sc-row[data-rule="passYd"]');
    const shown = !!row.querySelector('.sc-tip');
    window.toggleTip('passYd');
    return shown && !document.querySelector('.sc-row[data-rule="passYd"] .sc-tip');
  }));
ok('searching filters the list',
  await ev(() => {
    window.scoringSearch('touchdown');
    const n = document.querySelectorAll('#scList .sc-row').length;
    window.clearScoringSearch();
    return n >= 8 && n < window.ALL_RULES.length;
  }));
ok('starring puts a rule on the favourites tab',
  await ev(() => {
    window.toggleScoringFav('recTE');
    window.setScoringTab('fav');
    const on = !!document.querySelector('.sc-row[data-rule="recTE"]');
    window.toggleScoringFav('recTE');
    window.setScoringTab('pass');
    return on;
  }));
ok('the live example is scored by the same engine',
  await ev(() => {
    const read = () => +document.querySelector('.sc-prev-h b').textContent;
    window.setScoringTab('rec');
    window.setRuleValue('rec', 0);
    const a = read();
    window.setRuleValue('rec', 2);
    const b = read();
    window.setRuleValue('rec', 1);
    return b > a;
  }));
ok('members cannot edit, commissioners can',
  await ev(() => {
    const dis = () => [...document.querySelectorAll('#scList .sc-in')].every(i => i.disabled);
    window.togglePreviewAsMember();
    window.renderScoringBody();
    const asMember = dis();
    window.togglePreviewAsMember();
    window.renderScoringBody();
    const asCommish = dis();
    return asMember && !asCommish;
  }));

ok('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
