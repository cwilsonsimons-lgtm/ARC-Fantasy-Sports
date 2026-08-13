#!/usr/bin/env node
// WWE 2K Universe — command line.
//
// The data layer has no UI yet, so this is how you drive it. Everything reads
// and writes one JSON file (data/universe.json by default; --file or
// UNIVERSE_FILE to point elsewhere).
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
import { project, champions, titleLineage, standings, injuryList, expiringContracts, timelineFor, days } from '../js/universe/project.js';
import { seedFromJSON, exportSeed } from '../js/universe/seed.js';
import { parseRoster, commitRoster, brandTable, importReport } from '../js/universe/roster.js';
import { parseCard, commitCard, renderCard } from '../js/universe/card.js';
import { buildIndex, resolve as resolveName, table, heading, plural } from '../js/universe/util.js';

// ------------------------------------------------------------------ args

const argv = process.argv.slice(2);
const cmd = argv.shift();
const BOOLEAN_FLAGS = ['dry', 'fresh', 'force', 'all', 'seed'];
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
    const result = commitRoster(store, parsed, { date, dryRun: !!flags.dry });
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
    });
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
    console.log(heading(`${hit.name} — lineage`));
    console.log(table(titleLineage(state, hit.id), [
      { label: '#', align: 'right', get: r => r.n },
      { label: 'Champion', get: r => r.holders.join(' & ') },
      { label: 'Won', get: r => r.from },
      { label: 'Lost', get: r => r.to || '—' },
      { label: 'Days', align: 'right', get: r => r.days },
      { label: 'Def.', align: 'right', get: r => r.defenses },
      { label: 'How', get: r => [r.reason, r.endReason].filter(Boolean).join(' → ') },
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
  roster <file|-> [--date D] [--dry]     import or re-sync a pasted roster
  brands [--as-of D]                     who is on each brand
  card <file|-> [--dry] [--date D]       enter a show's card
  show [showId]                          print a saved card (default: latest)
  shows                                  every show
  state [--as-of D] [--within N]         champions, records, injuries, contracts, feuds
  titles [name]                          title lineage
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
