#!/usr/bin/env node
// WWE 2K Universe — command line.
//
// The other front end. universe.html is the dashboard; this drives the same
// data layer from a terminal, which is faster for bulk loading and better for
// inspecting. Everything reads and writes one JSON file (data/universe.json by
// default; --file or UNIVERSE_FILE to point elsewhere).
//
//   node tools/universe.mjs seed data/universe-seed.json --fresh
//   node tools/universe.mjs roster roster.txt          # or - for stdin
//   node tools/universe.mjs brands
//   node tools/universe.mjs card card.txt --dry        # preview before saving
//   node tools/universe.mjs card card.txt
//   node tools/universe.mjs state
//   node tools/universe.mjs titles "WWE Championship"
//   node tools/universe.mjs log --limit 20
//   node tools/universe.mjs amend ev_0042 winner="Cody Rhodes"
//   node tools/universe.mjs void ev_0042 "wrong show"
//
// Pasting is the normal way in: `node tools/universe.mjs card -` reads until
// EOF, so you can paste a card straight from the couch and hit ctrl-D.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';

import { UniverseStore } from '../js/universe/store.js';
import { project, champions, titleLineage, titleMatches, standings, injuryList, expiringContracts,
  timelineFor, days, describeThread, activeRivalries, activeAlliances } from '../js/universe/project.js';
import { seedFromJSON, exportSeed } from '../js/universe/seed.js';
import { parseRoster, commitRoster, brandTable, importReport } from '../js/universe/roster.js';
import { parseCard, commitCard, renderCard } from '../js/universe/card.js';
import { buildIndex, resolve as resolveName, table, heading, plural } from '../js/universe/util.js';
import { currentSeason, seasons, brandStandings, proposeFlags, commitFlags,
  proposeLastStand, lastStandCard, nextStep, PHASES, PHASE_LABEL } from '../js/universe/season.js';
import { buildPrompt, PROMPTS } from '../js/universe/prompts.js';
import { tiers, brandCard, pyramidText, checkBrand } from '../js/universe/pyramid.js';
import { proposeDraft, commitDraft, draftText } from '../js/universe/draft.js';
import { lastStandBoard } from '../js/universe/laststand.js';
import { beltsByBrand, saveChampionship, retireChampionship, deleteChampionship,
  autoPromoteDefault, DIVISION_LABEL } from '../js/universe/championships.js';
import { cycleText, cardText, cyclesWithShows, weeklySchedule, currentCycle, cycleOf,
  calendarStart, setCalendarStart, startPreview, firstWeekOfMay, weekdayName } from '../js/universe/calendar.js';
import { allPLEs, savePLE, movePLE, deletePLE, orderProblems, scheduleText, SPECIAL_SHORT } from '../js/universe/ples.js';

// ------------------------------------------------------------------ args

const argv = process.argv.slice(2);
const cmd = argv.shift();
const BOOLEAN_FLAGS = ['dry', 'fresh', 'force', 'all', 'seed', 'commit', 'board', 'add-only',
  'auto-promote', 'no-auto-promote', 'retire', 'unretire', 'delete', 'retired'];
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { positional.push(a); continue; }
  const [k, v] = [a.slice(2, (a + '=').indexOf('=')), a.includes('=') ? a.slice(a.indexOf('=') + 1) : undefined];
  if (v !== undefined) flags[k] = v;
  else if (!BOOLEAN_FLAGS.includes(k) && argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
  else flags[k] = true;
}

const FILE = resolvePath(flags.file || process.env.UNIVERSE_FILE || 'data/universe.json');
const die = (msg, code = 1) => { console.error(msg); process.exit(code); };

// ------------------------------------------------------------------ storage

// The Node half of the adapter contract from store.js. It lives here rather
// than in js/universe/ so the module tree stays free of node: imports and can
// be bundled for the browser untouched.
function fileAdapter(path) {
  return {
    load() { try { return JSON.parse(readFileSync(path, 'utf8')); } catch (e) { return null; } },
    save(doc) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
      return true;
    },
  };
}

const openStore = ({ mustExist = true } = {}) => {
  if (mustExist && !existsSync(FILE)) die(`no universe at ${FILE}\nrun: node tools/universe.mjs seed data/universe-seed.json --fresh`);
  return new UniverseStore({ adapter: fileAdapter(FILE) });
};

const readInput = src => {
  if (!src) die('expected a file path, or - to read stdin');
  if (src === '-') return readFileSync(0, 'utf8');
  if (!existsSync(src)) die(`no such file: ${src}`);
  return readFileSync(src, 'utf8');
};

const problems = (list, label) => {
  if (!list.length) return false;
  console.error(`\n${label}:`);
  list.forEach(p => console.error(`  line ${p.lineNo}: ${p.message}\n    ${p.line.trim()}`));
  return true;
};

// ------------------------------------------------------------------ commands

const commands = {

  init() {
    if (existsSync(FILE) && !flags.force) die(`${FILE} already exists (use --force to replace it)`);
    const s = new UniverseStore({ adapter: fileAdapter(FILE), name: flags.name || 'Universe' });
    s.save();
    console.log(`created ${FILE}`);
  },

  seed() {
    const src = positional[0] || 'data/universe-seed.json';
    const doc = JSON.parse(readInput(src));
    if (flags.fresh && existsSync(FILE)) writeFileSync(FILE, JSON.stringify({}, null, 2));
    const store = new UniverseStore({ adapter: fileAdapter(FILE) });
    if (store.doc.events.length && !flags.fresh) die(`${FILE} already has ${store.doc.events.length} events — use --fresh to start over`);
    const { report } = seedFromJSON(doc, { store });
    console.log(`seeded ${FILE} from ${src}`);
    console.log(`  ${report.wrestlers} wrestlers, ${report.brands} brands, ${report.championships} championships, ${report.groups} groups`);
    console.log(`  ${report.founding} founding events, ${report.history} historical events`);
    report.warnings.forEach(w => console.log(`  warning: ${w}`));
  },

  roster() {
    const store = openStore();
    const text = readInput(positional[0] || '-');
    const parsed = parseRoster(text, store);
    if (problems(parsed.errors, 'Roster errors — nothing was imported')) process.exit(1);
    problems(parsed.warnings, 'Warnings');

    const date = flags.date || new Date().toISOString().slice(0, 10);
    const result = commitRoster(store, parsed, { date, dryRun: !!flags.dry, addOnly: !!flags['add-only'] });
    // The paste is the brand's roster, so say what that was taken to mean.
    result.summary.brands.forEach(b => console.log(flags['add-only']
      ? `${b.name}: ${plural(b.listed, 'name')} added to the ${b.had} already there (--add-only)`
      : `${b.name}: read as the full roster — ${plural(b.listed, 'name')} listed, ${b.had} before`
        + `${b.leaving ? `, ${b.leaving} coming off` : ''}`));
    console.log(`\n${flags.dry ? '(dry run) ' : ''}${importReport(result)}`);
    if (!flags.dry) console.log(brandTable(project(store)));
  },

  brands() {
    console.log(brandTable(project(openStore(), { asOf: flags['as-of'] || null })));
  },

  card() {
    const store = openStore();
    const text = readInput(positional[0] || '-');
    const parsed = parseCard(text, store, { date: flags.date || null });
    if (problems(parsed.errors, 'Card errors — nothing was saved')) process.exit(1);
    console.log(renderCard(parsed, store));
    if (flags.dry) { console.log('\n(dry run — nothing saved)'); return; }
    const result = commitCard(store, parsed);
    console.log(`\nsaved ${result.showId} — ${plural(result.written, 'event')}`);
  },

  show() {
    const store = openStore();
    const state = project(store);
    const id = positional[0];
    const shows = id ? state.shows.filter(s => s.id === id) : state.shows.slice(-1);
    if (!shows.length) die(id ? `no show ${id}` : 'no shows yet');
    shows.forEach(s => {
      const brand = state.brands[s.brandId];
      console.log(heading(`${s.name} — ${s.date}${brand ? ` — ${brand.name}` : ''}  [${s.id}]`));
      console.log(table(s.segments, [
        { label: '#', align: 'right', get: g => g.order || '' },
        { label: 'Type', get: g => g.type },
        { label: 'Segment', get: g => g.text },
        { label: 'Event', get: g => g.id },
      ], { indent: '  ' }));
      // What the night moved, so reading a card back does not mean reading the
      // whole log to work out what it did.
      const changes = cardText(state, s.id).split('What changed:')[1];
      if (changes) console.log(`  What changed:${changes}`);
    });
  },

  calendar() {
    const store = openStore();
    let state = project(store, { asOf: flags['as-of'] || null });

    // Where the universe begins. `--start may 2027` is the game's own answer.
    if (flags.start) {
      const m = /^(?:may\s+)?(\d{4})$/i.exec(String(flags.start).trim());
      const iso = m ? firstWeekOfMay(Number(m[1])) : String(flags.start).trim();
      const before = startPreview(state, iso);
      setCalendarStart(store, iso);
      state = project(store, { asOf: flags['as-of'] || null });
      console.log(`day 1 of cycle 1 is now ${weekdayName(iso)} ${iso}`);
      console.log(`  today is cycle ${before.now.cycle}, day ${before.now.day}`
        + `${before.cycles ? ` · ${plural(before.cards.length, 'card')} across cycles ${before.cycles[0]}–${before.cycles[1]}` : ''}`);
      // A start later than the save's own history is legal but rarely meant.
      if (before.now.cycle < 1) console.log('  note: that start is after today, so today lands before cycle 1');
    }

    // Only a typed --cycle is validated. A computed one can legitimately be
    // zero or negative: that is what a date before day 1 of cycle 1 means.
    if (flags.cycle !== undefined && !Number.isInteger(Number(flags.cycle))) {
      die(`--cycle wants a whole number, got: ${flags.cycle}`);
    }
    const cycle = flags.cycle !== undefined ? Number(flags.cycle) : currentCycle(state);

    console.log(heading('The 28-day cycle', '═'));
    console.log(`Day 1 of cycle 1: ${weekdayName(calendarStart(state))} ${calendarStart(state)}`);
    console.log(cycleText(state, cycle, { width: +(flags.width || 17), ples: allPLEs(state) }));

    console.log(heading('The week'));
    console.log(table(weeklySchedule(state).filter(r => r.brands.length), [
      { label: 'Night', get: r => `Day ${r.slot}` },
      { label: 'Also', get: r => r.weekday },
      { label: 'Shows', get: r => r.brands.map(b => b.name).join(', ') },
    ], { indent: '  ' }));

    const index = cyclesWithShows(state);
    if (index.length) {
      console.log(heading('Cycles on record'));
      console.log(table(index.slice(0, 24), [
        { label: 'Cycle', align: 'right', get: r => r.cycle },
        { label: 'Cards', align: 'right', get: r => r.shows },
        { label: 'Matches', align: 'right', get: r => r.matches },
        { label: 'PLEs', get: r => r.ples.join(', ') },
      ], { indent: '  ' }));
    }
  },

  ples() {
    const store = openStore();
    const state = project(store, { asOf: flags['as-of'] || null });
    const list = allPLEs(state);
    console.log(heading('The schedule', '═'));
    console.log(table(list, [
      { label: 'Day', align: 'right', get: p => p.day },
      { label: 'Week', align: 'right', get: p => p.week },
      { label: 'PLE', get: p => p.name },
      { label: 'Brands', get: p => p.brandLine || '—' },
      { label: 'Rule', get: p => (p.isSpecial ? SPECIAL_SHORT[p.special] || p.special : '') },
    ], { indent: '  ' }));
    orderProblems(state).forEach(x => console.log(`  note: ${x.message}`));
  },

  // Create, edit or move one PLE. Nothing here decides a day for you.
  ple() {
    const store = openStore();
    const state = project(store);
    const name = positional[0];
    if (!name) die('which PLE? e.g. node tools/universe.mjs ple "Survivor Series" --day 21 --brands "Raw, SmackDown"');

    const hit = resolveName(buildIndex(store, 'ple'), name);
    const existing = hit.ok ? state.ples[hit.id] : null;

    if (flags.delete) {
      if (!existing) die(`no PLE: ${name}`);
      deletePLE(store, state, existing.id);
      console.log(`deleted ${existing.name}`);
      return;
    }
    // Moving is its own path so it can say what it did *not* change.
    if (existing && flags.day !== undefined && Object.keys(flags).every(k => ['day', 'file'].includes(k))) {
      const res = movePLE(store, state, existing.id, Number(flags.day));
      console.log(`${existing.name}: day ${res.from} → day ${res.to}`);
      console.log(`  brands unchanged: ${(res.brandIds.map(b => state.brands[b] ? state.brands[b].name : b).join(' + ')) || 'none'}`);
      return;
    }

    let brandIds = existing ? (existing.brandIds || []) : [];
    if (flags.brands !== undefined) {
      brandIds = String(flags.brands === true ? '' : flags.brands)
        .split(',').map(x => x.trim()).filter(Boolean)
        .map(x => {
          if (/^all$/i.test(x)) return null;
          const b = resolveName(buildIndex(store, 'brand'), x);
          if (!b.ok) die(`unknown brand: ${x}`);
          return b.id;
        });
      if (brandIds.includes(null)) brandIds = Object.keys(state.brands);
    }

    const rec = {
      name: existing ? (flags.name || existing.name) : name,
      day: flags.day !== undefined ? Number(flags.day) : (existing ? existing.day : 1),
      brandIds,
      logo: flags.logo || (existing ? existing.logo : undefined),
      description: flags.description || (existing ? existing.description : undefined),
      type: flags.special ? 'special' : (existing ? existing.type : 'ple'),
      special: flags.special ? String(flags.special) : (existing ? existing.special : undefined),
    };

    const res = savePLE(store, state, rec, { id: existing ? existing.id : null });
    const after = project(store).ples[res.id];
    console.log(`${res.created ? 'created' : 'updated'} ${after.name} [${res.id}]`);
    console.log(`  day ${after.day} · ${(after.brandIds || []).map(b => state.brands[b] ? state.brands[b].name : b).join(' + ') || 'no brands'}`
      + `${after.special ? ` · ${SPECIAL_SHORT[after.special] || after.special}` : ''}`);
    res.warnings.forEach(w => console.log(`  note: ${w}`));
  },

  shows() {
    const state = project(openStore());
    console.log(table(state.shows, [
      { label: 'Date', get: s => s.date },
      { label: 'Show', get: s => s.name },
      { label: 'Brand', get: s => (state.brands[s.brandId] ? state.brands[s.brandId].name : '—') },
      { label: 'Segments', align: 'right', get: s => s.segments.length },
      { label: 'Id', get: s => s.id },
    ]));
  },

  state() {
    const store = openStore();
    const state = project(store, { asOf: flags['as-of'] || null });
    const st = store.stats();

    console.log(heading(`${store.doc.meta.name} — as of ${state.asOf}`, '═'));
    console.log(`  ${st.wrestlers} wrestlers · ${st.brands} brands · ${st.championships} championships · ${st.groups} groups`);
    console.log(`  ${st.live} live events (${st.voided} voided, ${st.corrections} corrections)`);

    console.log(heading('Champions'));
    console.log(table(champions(state), [
      { label: 'Championship', get: c => c.name },
      { label: 'Brand', get: c => (state.brands[c.brandId] ? state.brands[c.brandId].name : '—') },
      { label: 'Holder', get: c => (c.vacant ? '(vacant)' : c.holders.join(' & ')) },
      { label: 'Since', get: c => c.since || '—' },
      { label: 'Days', align: 'right', get: c => (c.since ? c.days : '') },
      { label: 'Def.', align: 'right', get: c => (c.since ? c.defenses : '') },
    ], { indent: '  ' }));

    const top = standings(state).slice(0, 10);
    if (top.length) {
      console.log(heading('Most wins'));
      console.log(table(top, [
        { label: 'Wrestler', get: w => w.name },
        { label: 'Brand', get: w => (state.brands[w.brandId] ? state.brands[w.brandId].name : 'free agent') },
        { label: 'W-L-D', align: 'right', get: w => `${w.record.w}-${w.record.l}-${w.record.d}` },
        { label: 'Streak', get: w => (w.streak.n ? `${w.streak.n}${w.streak.type === 'w' ? 'W' : 'L'}` : '—') },
      ], { indent: '  ' }));
    }

    const hurt = injuryList(state);
    if (hurt.length) {
      console.log(heading('Injured'));
      console.log(table(hurt, [
        { label: 'Wrestler', get: r => r.name },
        { label: 'Since', get: r => r.since },
        { label: 'Out', align: 'right', get: r => `${days(r.since, state.asOf)}d` },
        { label: 'Expected', get: r => r.expectedReturn || (r.weeks ? `${r.weeks} weeks` : '—') },
        { label: 'Detail', get: r => r.description || '' },
      ], { indent: '  ' }));
    }

    const exp = expiringContracts(state, +(flags.within || 90));
    if (exp.length) {
      console.log(heading(`Contracts expiring within ${flags.within || 90} days`));
      console.log(table(exp, [
        { label: 'Wrestler', get: r => r.name },
        { label: 'Expires', get: r => r.expires },
        { label: 'In', align: 'right', get: r => `${r.inDays}d` },
      ], { indent: '  ' }));
    }

    const feuds = state.feuds.slice(0, 8);
    if (feuds.length) {
      console.log(heading('Hottest feuds'));
      console.log(table(feuds, [
        { label: 'Feud', get: f => `${nameOf(state, f.a)} / ${nameOf(state, f.b)}` },
        { label: 'Heat', align: 'right', get: f => f.heat },
        { label: 'Meetings', align: 'right', get: f => f.meetings },
        { label: 'Last', get: f => f.last },
      ], { indent: '  ' }));
    }
  },

  titles() {
    const store = openStore();
    const state = project(store, { asOf: flags['as-of'] || null });
    if (!positional[0]) {
      console.log(table(champions(state), [
        { label: 'Championship', get: c => c.name },
        { label: 'Holder', get: c => (c.vacant ? '(vacant)' : c.holders.join(' & ')) },
        { label: 'Since', get: c => c.since || '—' },
        { label: 'Id', get: c => c.titleId },
      ]));
      return;
    }
    const hit = resolveName(buildIndex(store, 'championship'), positional[0]);
    if (!hit.ok) die(`unknown championship "${positional[0]}"${hit.candidates.length ? ` — did you mean ${hit.candidates.join(', ')}?` : ''}`);
    const c = state.championships[hit.id];
    console.log(heading(`${hit.name} — lineage`));
    console.log(`  ${c.vacant ? 'VACANT' : c.holders.map(x => nameOf(state, x)).join(' & ')}`
      + `${c.vacant ? '' : ` · ${c.daysHeld} days · ${plural(c.defenses, 'defense')}`}`
      + `${c.interimHolders.length ? `   (interim: ${c.interimHolders.map(x => nameOf(state, x)).join(' & ')} since ${c.interimSince})` : ''}`);
    console.log(table(titleLineage(state, hit.id), [
      { label: '#', align: 'right', get: r => r.n },
      { label: 'Champion', get: r => r.holders.join(' & ') + (r.interim ? ' (interim)' : '') },
      { label: 'Won', get: r => r.from },
      { label: 'Lost', get: r => r.to || (r.current ? 'current' : '—') },
      { label: 'Days', align: 'right', get: r => r.days },
      { label: 'Def.', align: 'right', get: r => r.defenses },
      { label: 'How', get: r => [r.reason, r.endReason].filter(Boolean).join(' → ') },
    ], { indent: '  ' }));

    const ms = titleMatches(state, hit.id);
    if (ms.length) {
      console.log(heading(`Title matches — ${plural(ms.length, 'match')}`));
      console.log(table(ms, [
        { label: 'Date', get: m => m.date },
        { label: 'Match', get: m => m.text },
        { label: '', get: m => (m.titleChanged ? 'title change' : '') },
      ], { indent: '  ' }));
    }
  },

  threads() {
    const store = openStore();
    const state = project(store, { asOf: flags['as-of'] || null });
    const open = state.threads.map(t => describeThread(state, t));
    console.log(heading(`Open threads — ${plural(open.length, 'thread')}`, '═'));
    console.log(table(open, [
      { label: 'Id', get: t => t.id },
      { label: 'Kind', get: t => t.kind },
      { label: 'Thread', get: t => t.line },
      { label: 'Since', get: t => t.opened },
      { label: 'Open', align: 'right', get: t => `${t.age}d` },
    ], { indent: '  ' }));

    if (flags.all) {
      const closed = state.threadsClosed.map(t => describeThread(state, t));
      console.log(heading(`Closed — ${plural(closed.length, 'thread')}`));
      console.log(table(closed, [
        { label: 'Kind', get: t => t.kind },
        { label: 'Thread', get: t => t.line },
        { label: 'Open for', align: 'right', get: t => `${t.age}d` },
        { label: 'Closed by', get: t => t.closedWhy },
      ], { indent: '  ' }));
    }
  },

  resolve() {
    const store = openStore();
    const id = positional.shift();
    const state = project(store);
    if (!state.threadsById[id]) die(`no such thread: ${id}\nrun: node tools/universe.mjs threads`);
    // Date it after the newest event, or a resolution could land before the
    // show that opened the thread and never close anything.
    const last = store.doc.events.reduce((m, e) => (e.date > m ? e.date : m), new Date().toISOString().slice(0, 10));
    const ev = store.append({
      type: 'thread.resolved', date: flags.date || last, source: 'cli',
      participants: [], data: { threadId: id, reason: positional.join(' ') || 'marked resolved' },
    });
    console.log(`${ev.id}: resolved ${id}`);
  },

  pyramid() {
    const store = openStore();
    const state = project(store, { asOf: flags['as-of'] || null });
    console.log(heading('The pyramid', '═'));
    console.log(`  ${pyramidText(state)}\n`);
    tiers(state).forEach(t => {
      console.log(heading(`Tier ${t.tier} — ${t.label}`));
      console.log(table(t.brands.map(b => brandCard(state, b.id)), [
        { label: 'Show', get: b => `${b.logo || '·'} ${b.name}` },
        { label: 'Day', get: b => b.day || '—' },
        { label: 'Roster', align: 'right', get: b => b.size },
        { label: 'Titles', align: 'right', get: b => b.championships.length },
        { label: 'Promotes to', get: b => (b.promotesTo ? state.brands[b.promotesTo].name : '—') },
        { label: 'Relegates to', get: b => (b.relegatesTo ? state.brands[b.relegatesTo].name : '—') },
        { label: 'Develops for', get: b => (b.parent ? b.parent.name : '') },
      ], { indent: '  ' }));
    });
  },

  brand() {
    const store = openStore();
    const state = project(store);
    const name = positional.join(' ');
    if (!name) die('usage: brand "<name>" [--tier N] [--day Monday] [--color #fff] [--logo x] [--parent "<brand>"]');

    const hit = resolveName(buildIndex(store, 'brand'), name);
    const rec = {};
    if (flags.tier != null && flags.tier !== true) rec.tier = Number(flags.tier);
    if (flags.day) rec.day = flags.day;
    if (flags.color) rec.color = flags.color;
    if (flags.logo) rec.logo = flags.logo;
    if (flags.abbr) rec.abbr = flags.abbr;
    if (flags.parent) {
      const up = resolveName(buildIndex(store, 'brand'), flags.parent);
      if (!up.ok) die(`unknown parent brand: ${flags.parent}`);
      rec.parentId = up.id;
    }

    if (hit.ok) {
      const problems = checkBrand(state, { ...state.brands[hit.id], ...rec }, { id: hit.id });
      if (problems.length) die(problems.join('\n'));
      store.amendEntity(hit.id, rec, 'edited from the cli');
      console.log(`updated ${hit.name}`);
    } else {
      const full = { name, tier: 1, ...rec };
      const problems = checkBrand(state, full);
      if (problems.length) die(problems.join('\n'));
      store.addEntity('brand', full);
      console.log(`created ${name} on tier ${full.tier}`);
    }
    console.log(`\n  ${pyramidText(project(store))}`);
  },

  draft() {
    const store = openStore();
    const state = project(store, { asOf: flags['as-of'] || null });
    const tier = flags.tier != null && flags.tier !== true ? Number(flags.tier) : (tiers(state)[0] || {}).tier;
    const proposal = proposeDraft(state, { tier });
    if (!proposal.picks.length) die(proposal.why || `nothing to draft on tier ${tier}`);

    console.log(draftText(state, proposal));
    if (!flags.commit) {
      const moving = proposal.picks.filter(p => p.from !== p.brandId).length;
      console.log(`\n(${plural(moving, 'wrestler')} would change brand — re-run with --commit)`);
      return;
    }
    const last = store.doc.events.reduce((m, e) => (e.date > m ? e.date : m), new Date().toISOString().slice(0, 10));
    const res = commitDraft(store, proposal, { date: flags.date || last, state });
    console.log(`\n${plural(res.written, 'move')} written`);
  },

  season() {
    const store = openStore();
    const state = project(store, { asOf: flags['as-of'] || null });
    const season = currentSeason(state);

    const step = nextStep(state, season);
    console.log(heading(`Season ${season.n} — ${season.phaseLabel}`, '═'));
    console.log(`  ${season.from} → ${season.to || 'in progress'}`);
    console.log('  ' + PHASES.map(ph => (ph === season.phase ? `[${PHASE_LABEL[ph]}]` : PHASE_LABEL[ph])).join('  →  '));
    console.log(`  next: ${step.do}${step.then ? ` — then ${step.then}` : ''}`);

    if (seasons(state).length > 1) {
      console.log(heading('Seasons on record'));
      console.log(table(seasons(state).slice().reverse(), [
        { label: '#', align: 'right', get: x => x.n },
        { label: 'From', get: x => x.from },
        { label: 'To', get: x => x.to || '—' },
        { label: 'WrestleMania', get: x => (x.wrestlemania ? x.wrestlemania.date : '—') },
        { label: 'Last Stand', get: x => (x.lastStand ? x.lastStand.date : '—') },
        { label: 'Draft', get: x => (x.draft ? x.draft.date : '—') },
        { label: 'Phase', get: x => x.phaseLabel },
      ], { indent: '  ' }));
    }

    brandStandings(state, season).forEach(b => {
      console.log(heading(`${b.name}  —  ${(b.tier || 1) > 1 ? 'development' : 'main roster'}`));
      console.log(table(b.table, [
        { label: 'Wrestler', get: r => r.name },
        { label: 'G', get: r => (r.gender === 'female' ? 'F' : r.gender === 'male' ? 'M' : '?') },
        { label: 'W-L-D', align: 'right', get: r => `${r.w}-${r.l}-${r.d}` },
        { label: 'Pts', align: 'right', get: r => r.points },
        { label: 'Title', align: 'right', get: r => r.titleMatches || '' },
        { label: '', get: r => (/flagged$/.test(state.wrestlers[r.id].status) ? state.wrestlers[r.id].status.replace('-flagged', '') : '') },
      ], { indent: '  ' }));
    });
  },

  flags() {
    const store = openStore();
    const state = project(store, { asOf: flags['as-of'] || null });
    const proposals = proposeFlags(state);

    console.log(heading('Proposed lists', '═'));
    console.log(table(proposals, [
      { label: 'Wrestler', get: p => p.name },
      { label: 'From', get: p => p.fromName },
      { label: 'G', get: p => (p.gender === 'female' ? 'F' : 'M') },
      { label: 'List', get: p => (p.flag === 'relegation-flagged' ? '↓ relegation' : '↑ promotion') },
      { label: 'Record', align: 'right', get: p => p.record },
      { label: 'Why', get: p => p.why },
      { label: '', get: p => (p.alreadyFlagged ? 'already flagged' : '') },
    ], { indent: '  ' }));

    if (!flags.commit) { console.log(`\n(nothing written — re-run with --commit)`); return; }
    const last = store.doc.events.reduce((m, e) => (e.date > m ? e.date : m), new Date().toISOString().slice(0, 10));
    const res = commitFlags(store, proposals, { date: flags.date || last });
    console.log(`\n${plural(res.written, 'flag')} written`);
  },

  laststand() {
    const store = openStore();
    const state = project(store, { asOf: flags['as-of'] || null });
    if (flags.board) return printLastStandBoard(state);

    const proposal = proposeLastStand(state);
    if (!proposal.matches.length) die('nobody is carrying a flag — run: node tools/universe.mjs flags --commit');

    const last = store.doc.events.reduce((m, e) => (e.date > m ? e.date : m), new Date().toISOString().slice(0, 10));
    console.log(lastStandCard(state, proposal, { date: flags.date || last }));
    if (proposal.resolved.length) {
      console.error(`\n# settled already: ${proposal.resolved.map(g =>
        `${g.brandName} ${g.direction} (${g.gender})`).join(', ')}`);
    }
    if (proposal.byes.length) {
      console.error(`# byes into the next round: ${proposal.byes.map(w => w.name).join(', ')}`);
    }
  },

  belts() {
    const store = openStore();
    const state = project(store, { asOf: flags['as-of'] || null });
    beltsByBrand(state, { includeRetired: !!flags.retired }).forEach(r => {
      console.log(heading(`${r.name} — ${plural(r.count, 'championship')}`
        + `${r.autoPromotes ? ` · ${r.autoPromotes} calls up` : ''}`));
      console.log(table(r.belts, [
        { label: 'Championship', get: c => c.name },
        { label: 'Division', get: c => c.divisionLabel },
        { label: 'Holder', get: c => (c.vacant ? 'VACANT' : c.holders.map(x => nameOf(state, x)).join(' & ')) },
        { label: 'Reigns', align: 'right', get: c => c.reigns.length },
        { label: '', get: c => [c.autoPromote ? `↑ calls up to ${c.promotesToName}` : '', c.retired ? 'retired' : ''].filter(Boolean).join(' · ') },
      ], { indent: '  ' }));
    });
  },

  // Create or edit one belt. The same command does both, like `brand`.
  belt() {
    const store = openStore();
    const state = project(store);
    const name = positional[0];
    if (!name) die('which championship? e.g. node tools/universe.mjs belt "NXT North American Championship" --brand NXT');

    const hit = resolveName(buildIndex(store, 'championship'), name);
    const existing = hit.ok ? state.championships[hit.id] : null;

    if (flags.delete) {
      if (!existing) die(`no championship: ${name}`);
      deleteChampionship(store, state, existing.id);
      console.log(`deleted ${existing.name}`);
      return;
    }
    if (flags.retire || flags.unretire) {
      if (!existing) die(`no championship: ${name}`);
      retireChampionship(store, state, existing.id, { undo: !!flags.unretire, on: flags.date || null });
      console.log(`${existing.name} ${flags.unretire ? 'is active again' : 'retired'}`);
      return;
    }

    let brandId = existing ? existing.brandId : null;
    if (flags.brand !== undefined) {
      if (flags.brand === '' || flags.brand === true) brandId = null;
      else {
        const b = resolveName(buildIndex(store, 'brand'), flags.brand);
        if (!b.ok) die(`unknown brand: ${flags.brand}`);
        brandId = b.id;
      }
    }

    const auto = flags['auto-promote'] ? true
      : flags['no-auto-promote'] ? false
      : existing ? !!existing.autoPromote : autoPromoteDefault(state, brandId);

    const rec = {
      name: existing ? (flags.name || existing.name) : name,
      brandId,
      division: flags.division || (existing ? existing.division : 'mens'),
      teamSize: flags['team-size'] ? Number(flags['team-size']) : (existing ? existing.teamSize : null),
      autoPromote: auto,
      retiredOn: existing ? existing.retiredOn : null,
    };

    const res = saveChampionship(store, state, rec, { id: existing ? existing.id : null });
    const after = project(store).championships[res.id];
    console.log(`${res.created ? 'created' : 'updated'} ${after.name} [${res.id}]`);
    console.log(`  ${DIVISION_LABEL[after.division] || after.division} · `
      + `${after.brandId && state.brands[after.brandId] ? state.brands[after.brandId].name : 'unbranded'}`
      + `${after.autoPromote ? ' · champion is called up at the offseason' : ''}`);
  },

  prompt() {
    const store = openStore();
    const state = project(store, { asOf: flags['as-of'] || null });
    const id = positional[0];
    if (!id) die(`which prompt?\n  ${PROMPTS.map(p => `${p.id.padEnd(12)} ${p.blurb}`).join('\n  ')}`);
    if (!PROMPTS.some(p => p.id === id)) die(`unknown prompt: ${id} (want ${PROMPTS.map(p => p.id).join(', ')})`);

    let showId = flags.show;
    if (id === 'recap' && !showId) showId = state.shows.length ? state.shows[state.shows.length - 1].id : null;
    let brandId = null;
    if (flags.brand) {
      const hit = resolveName(buildIndex(store, 'brand'), flags.brand);
      if (!hit.ok) die(`unknown brand: ${flags.brand}`);
      brandId = hit.id;
    }
    // Straight to stdout so it can be piped: `... prompt next | pbcopy`
    console.log(buildPrompt(id, state, { showId, brandId, ple: flags.ple }));
  },

  heat() {
    const store = openStore();
    const state = project(store, { asOf: flags['as-of'] || null });
    const limit = +(flags.limit || 12);

    console.log(heading(`Rivalries — as of ${state.asOf}`, '═'));
    console.log(table(state.rivalries.slice(0, limit), [
      { label: 'Feud', get: r => `${nameOf(state, r.a)} / ${nameOf(state, r.b)}` },
      { label: 'Heat', align: 'right', get: r => r.heat },
      { label: 'Peak', align: 'right', get: r => r.peak },
      { label: 'From', get: r => Object.entries(r.why).map(([k, n]) => `${k}${n > 1 ? `×${n}` : ''}`).join(', ') },
      { label: 'Last', get: r => r.last },
      { label: '', get: r => (r.active ? '' : 'cooled off') },
    ], { indent: '  ' }));

    console.log(heading('Alliances'));
    console.log(table(state.alliances.slice(0, limit), [
      { label: 'Pair', get: r => `${nameOf(state, r.a)} & ${nameOf(state, r.b)}` },
      { label: 'Bond', align: 'right', get: r => r.heat },
      { label: 'From', get: r => Object.entries(r.why).map(([k, n]) => `${k}${n > 1 ? `×${n}` : ''}`).join(', ') },
      { label: 'Last', get: r => r.last },
      { label: '', get: r => (r.active ? '' : 'cooled off') },
    ], { indent: '  ' }));
  },

  wrestler() {
    const store = openStore();
    const state = project(store);
    const hit = resolveName(buildIndex(store, 'wrestler'), positional.join(' '));
    if (!hit.ok) die(`no match for "${positional.join(' ')}"${hit.candidates.length ? ` — did you mean ${hit.candidates.join(', ')}?` : ''}`);
    const w = state.wrestlers[hit.id];
    console.log(heading(`${w.name}  [${w.id}]`, '═'));
    console.log(`  brand: ${w.brandId ? state.brands[w.brandId].name : 'free agent'}   status: ${w.status}   alignment: ${w.alignment || '—'}`);
    console.log(`  record: ${w.record.w}-${w.record.l}-${w.record.d}   streak: ${w.streak.n ? w.streak.n + (w.streak.type === 'w' ? 'W' : 'L') : '—'}   appearances: ${w.appearances}`);
    if (w.titles.length) console.log(`  holding: ${w.titles.map(t => state.championships[t].name).join(', ')}`);
    if (w.groups.length) console.log(`  groups: ${w.groups.map(g => state.groups[g].name).join(', ')}`);
    if (w.injury) console.log(`  injured since ${w.injury.since}${w.injury.description ? ` (${w.injury.description})` : ''}`);
    if (w.contract) console.log(`  contract since ${w.contract.since}${w.contract.expires ? `, expires ${w.contract.expires}` : ''}`);
    const tie = (label, rows) => {
      if (!rows.length) return;
      console.log(heading(label));
      console.log(table(rows.slice(0, 6), [
        { label: 'Who', get: r => nameOf(state, r.with) },
        { label: 'Heat', align: 'right', get: r => r.heat },
        { label: 'From', get: r => Object.keys(r.why).join(', ') },
        { label: 'Last', get: r => r.last },
        { label: '', get: r => (r.active ? '' : 'cooled off') },
      ], { indent: '  ' }));
    };
    tie('Rivalries', w.rivals);
    tie('Alliances', w.allies);

    const mine = state.threads.filter(t => t.subjects.includes(hit.id) || t.about === hit.id);
    if (mine.length) {
      console.log(heading('Open threads'));
      mine.map(t => describeThread(state, t)).forEach(t => console.log(`  ${t.line}  (${t.age}d, ${t.id})`));
    }

    if (w.titleHistory.length) {
      console.log(heading('Title reigns'));
      console.log(table(w.titleHistory.slice().reverse(), [
        { label: 'Championship', get: r => nameOf(state, r.titleId) + (r.interim ? ' (interim)' : '') },
        { label: 'Won', get: r => r.from },
        { label: 'Lost', get: r => r.to || 'current' },
        { label: 'Days', align: 'right', get: r => (r.to ? r.days : days(r.from, state.asOf)) },
      ], { indent: '  ' }));
    }

    const tl = timelineFor(state, hit.id).slice(0, +(flags.limit || 15));
    console.log(heading('Recent'));
    console.log(table(tl, [
      { label: 'Date', get: r => r.date },
      { label: 'Type', get: r => r.type },
      { label: 'What', get: r => r.text },
      { label: 'Event', get: r => r.id },
    ], { indent: '  ' }));
  },

  log() {
    const store = openStore();
    const limit = +(flags.limit || 25);
    let rows = store.effectiveEvents({ includeVoided: !!flags.all });
    if (flags.type) rows = rows.filter(e => e.type === flags.type);
    rows = rows.slice(-limit);
    const state = project(store);
    console.log(table(rows, [
      { label: 'Id', get: e => e.id },
      { label: 'Date', get: e => e.date },
      { label: 'Type', get: e => e.type },
      { label: 'Who', get: e => e.participants.map(p => nameOf(state, p.ref)).join(', ').slice(0, 60) },
      { label: 'Note', get: e => [e.voided ? 'VOIDED' : '', e.amended ? `amended×${e.amended}` : '', e.note].filter(Boolean).join(' · ').slice(0, 50) },
    ]));
    console.log(`\n${rows.length} of ${store.stats().live} live events`);
  },

  event() {
    const store = openStore();
    const id = positional[0];
    const raw = store.getEvent(id);
    if (!raw) die(`no such event: ${id}`);
    const ev = store.applied(raw);
    console.log(heading(`${ev.id} — ${ev.type} — ${ev.date}${store.isVoided(id) ? '  [VOIDED]' : ''}`, '═'));
    console.log(JSON.stringify(ev, null, 2));
    const cx = store.historyOf(id);
    if (cx.length) {
      console.log(heading('Corrections'));
      cx.forEach(c => console.log(`  ${c.id}  ${c.at.slice(0, 19)}  ${c.op}${c.note ? ` — ${c.note}` : ''}${c.patch ? `\n    ${JSON.stringify(c.patch)}` : ''}`));
    }
  },

  // amend ev_0042 date=2026-08-18 data.decision=dq winner="Cody Rhodes"
  amend() {
    const store = openStore();
    const id = positional.shift();
    const raw = store.getEvent(id);
    if (!raw) die(`no such event: ${id}`);
    const patch = {};
    positional.forEach(pair => {
      const eq = pair.indexOf('=');
      if (eq < 0) die(`expected key=value, got "${pair}"`);
      const key = pair.slice(0, eq), value = pair.slice(eq + 1);

      if (key === 'winner') {
        // The common correction: right match, wrong hand raised.
        const hit = resolveName(buildIndex(store, 'wrestler'), value);
        if (!hit.ok) die(`unknown wrestler "${value}"`);
        const side = (raw.participants.find(p => p.ref === hit.id) || {}).side;
        if (side == null) die(`${hit.name} is not in ${id}`);
        patch.participants = raw.participants.map(p => ({ ...p, role: p.side === side ? 'winner' : 'loser' }));
        return;
      }
      const cast = v => (v === 'true' ? true : v === 'false' ? false : v === 'null' ? null : /^-?\d+(\.\d+)?$/.test(v) ? +v : v);
      if (key.startsWith('data.')) { patch.data = patch.data || {}; patch.data[key.slice(5)] = cast(value); }
      else patch[key] = cast(value);
    });
    const cx = store.amendEvent(id, patch, flags.note || '');
    console.log(`${cx.id}: amended ${id}`);
    console.log(JSON.stringify(store.applied(store.getEvent(id)), null, 2));
    console.log('\nstate recalculates on the next read — nothing else to update');
  },

  void() {
    const store = openStore();
    const id = positional.shift();
    const cx = store.voidEvent(id, positional.join(' ') || flags.note || '');
    console.log(`${cx.id}: voided ${id} — it stays in the log, but drops out of every projection`);
  },

  restore() {
    const store = openStore();
    const id = positional.shift();
    const cx = store.restoreEvent(id, positional.join(' '));
    console.log(`${cx.id}: restored ${id}`);
  },

  corrections() {
    const store = openStore();
    console.log(table(store.doc.corrections, [
      { label: 'Id', get: c => c.id },
      { label: 'When', get: c => c.at.slice(0, 16).replace('T', ' ') },
      { label: 'Op', get: c => c.op },
      { label: 'Target', get: c => `${c.target} ${c.targetId}` },
      { label: 'Patch', get: c => (c.patch ? JSON.stringify(c.patch).slice(0, 60) : '') },
      { label: 'Note', get: c => c.note || '' },
    ]));
  },

  check() {
    const store = openStore();
    const found = store.check();
    if (!found.length) { console.log(`${FILE}: clean — ${store.stats().live} live events`); return; }
    found.forEach(p => console.log(`${p.level.toUpperCase()}  ${p.id}  ${p.message}`));
    process.exit(found.some(p => p.level === 'error') ? 1 : 0);
  },

  export() {
    const store = openStore();
    const out = flags.seed ? exportSeed(store) : store.toJSON();
    console.log(JSON.stringify(out, null, 2));
  },

  help() {
    console.log(`WWE 2K Universe — data layer CLI   (file: ${FILE})

  init [--name N] [--force]              start an empty universe
  seed <seed.json> [--fresh]             load brands/roster/titles as founding events
  roster <file|-> [--dry] [--add-only]   sync one brand's roster from a paste
  brands [--as-of D]                     who is on each brand
  card <file|-> [--dry] [--date D]       enter a show's card
  calendar [--cycle N] [--start DATE]    the 28-day cycle; --start "may 2027" sets day 1
  ples                                   every PLE on the cycle
  ple "<name>" [--day N] [--brands "A, B"|all] [--special lastStand] [--delete]
                                         create, edit or move one PLE
  show [showId]                          print a saved card (default: latest)
  shows                                  every show
  state [--as-of D] [--within N]         champions, records, injuries, contracts, feuds
  titles [name]                          title lineage, reigns and title matches
  belts [--retired]                      how many championships each show carries
  belt "<name>" [--brand B] [--division D] [--auto-promote|--no-auto-promote]
       [--retire|--unretire|--delete]    create or edit one championship
  pyramid [--as-of D]                    the brand pyramid, tier by tier
  brand "<name>" [--tier N] [--day D]    create or edit a show
  draft [--tier N] [--commit]            the annual draft for one tier
  season [--as-of D]                     standings and where the year has got to
  flags [--commit] [--date D]            work out the promotion/relegation lists
  laststand [--date D] [--board]         the Last Stand card, or the whole board
  prompt <recap|contenders|next>         a prompt with state embedded, to stdout
  threads [--all] [--as-of D]            open questions the log has not answered
  resolve <threadId> [note]              mark one closed
  heat [--limit N] [--as-of D]           rivalries and alliances, hottest first
  wrestler <name> [--limit N]            one wrestler's page
  log [--limit N] [--type T] [--all]     the event log
  event <id>                             one event and its corrections
  amend <id> key=value ...               correct an event (winner=Name works too)
  void <id> [note] / restore <id>        drop or reinstate an event
  corrections                            the correction log
  check                                  integrity pass
  export [--seed]                        dump the store, or just the registry

Global: --file PATH (or UNIVERSE_FILE) chooses the save file.`);
  },
};

const nameOf = (state, ref) => (state.wrestlers[ref] ? state.wrestlers[ref].name
  : state.groups[ref] ? state.groups[ref].name
  : state.championships[ref] ? state.championships[ref].name : ref);

// The dashboard's Last Stand tab, in a terminal. Promotion and relegation stay
// visibly apart here for the same reason they do on the page: they are separate
// competitions, and reading them as one list is how illegal pairings get booked.
function printLastStandBoard(state) {
  const b = lastStandBoard(state);

  console.log(heading(`Last Stand — season ${b.season.n} (${b.season.phaseLabel})`, '═'));
  console.log(`  ${pyramidText(state)}`);

  if (b.auto.length) {
    console.log(heading('Automatic call-ups — champions who skip the match'));
    console.log(table(b.auto, [
      { label: 'Wrestler', get: a => a.name },
      { label: 'Holding', get: a => a.titleName },
      { label: 'From', get: a => a.fromName || '—' },
      { label: 'Into', get: a => `${a.toName} draft pool` },
    ], { indent: '  ' }));
  }

  const cands = (rows, label) => {
    console.log(heading(label));
    if (!rows.length) { console.log('  nobody'); return; }
    console.log(table(rows, [
      { label: 'Wrestler', get: r => r.name },
      { label: 'G', get: r => (r.gender === 'female' ? 'F' : r.gender === 'male' ? 'M' : '?') },
      { label: 'Brand', get: r => r.brandName },
      { label: label[0] === '↑' ? 'Up to' : 'Down to', get: r => r.toName || '—' },
      { label: '', get: r => (r.automatic ? 'automatic' : '') },
    ], { indent: '  ' }));
  };
  cands(b.candidates.promotion, '↑ Promotion candidates');
  cands(b.candidates.relegation, '↓ Relegation candidates');

  if (b.open.length) {
    console.log(heading('Still to settle'));
    b.open.forEach(g => console.log(`  ${g.direction === 'relegation' ? '↓' : '↑'} ${g.brandName}`
      + ` ${g.gender === 'female' ? 'women' : 'men'} → ${g.toBrandName || '—'}`
      + ` — round ${g.round}, ${plural(g.standing.length, 'name')} standing,`
      + ` ${plural(g.matches.length, 'match', 'matches')} to book${g.decides ? '' : ' (qualifiers — nobody moves)'}`));
    console.log(`\n  card: node tools/universe.mjs laststand`);
  }

  if (b.played.length) {
    console.log(heading('Results'));
    console.log(table(b.played, [
      { label: 'Date', get: m => m.date },
      { label: 'Winner', get: m => m.winner },
      { label: 'Loser', get: m => m.loser },
      { label: 'For', get: m => (m.stakes ? `${m.stakes} — ${m.toName}` : `${m.qualifier} qualifier`) },
    ], { indent: '  ' }));
  }

  if (b.movements.length) {
    console.log(heading('Roster movements'));
    console.log(table(b.movements, [
      { label: 'Date', get: m => m.date },
      { label: 'Wrestler', get: m => m.name },
      { label: 'Moves to', get: m => m.toName },
      { label: 'Why', get: m => m.reason },
    ], { indent: '  ' }));
  } else if (b.played.length) {
    console.log('\n  nobody has moved yet — those were qualifiers');
  }
}

const fn = commands[cmd] || (cmd === '-h' || cmd === '--help' || !cmd ? commands.help : null);
if (!fn) die(`unknown command: ${cmd}\nrun: node tools/universe.mjs help`);

try {
  fn();
} catch (e) {
  if (e.errors) {
    // e.message already embeds the list for ValidationError; anything else
    // (roster/card errors) carries structured rows instead.
    if (e.name === 'ValidationError') console.error(e.message);
    else { console.error(e.message); e.errors.forEach(x => console.error(`  - ${typeof x === 'string' ? x : `line ${x.lineNo}: ${x.message}`}`)); }
    process.exit(1);
  }
  throw e;
}
