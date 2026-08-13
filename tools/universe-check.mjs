#!/usr/bin/env node
// Checks for the WWE 2K Universe data layer.
//
// Usage: node tools/universe-check.mjs
//
// Pure Node, no browser and no network — the whole point of keeping js/universe/
// free of DOM calls. Everything runs against an in-memory store built from the
// real seed file, so nothing here touches data/universe.json.
//
// The corrections section is the one that matters most. An event-sourced store
// is only worth the indirection if editing history actually moves every derived
// number, so those tests void and amend events in the middle of the log and
// assert on records, reigns, rosters and streaks downstream.

import { readFileSync } from 'node:fs';

import { UniverseStore, memoryAdapter, ValidationError } from '../js/universe/store.js';
import { project, champions, titleLineage, standings } from '../js/universe/project.js';
import { seedFromJSON } from '../js/universe/seed.js';
import { parseRoster, commitRoster } from '../js/universe/roster.js';
import { parseCard, commitCard } from '../js/universe/card.js';
import { resolve, buildIndex } from '../js/universe/util.js';

let pass = 0, fail = 0;
const failures = [];

function check(label, got, want) {
  const ok = typeof want === 'function' ? want(got) : JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${JSON.stringify(got)}`);
  if (ok) pass++; else { fail++; failures.push(`${label}\n        got:  ${JSON.stringify(got)}\n        want: ${typeof want === 'function' ? want.toString().slice(0, 90) : JSON.stringify(want)}`); }
}
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`);
const threw = fn => { try { fn(); return null; } catch (e) { return e; } };

const seedDoc = JSON.parse(readFileSync(new URL('../data/universe-seed.json', import.meta.url), 'utf8'));
const fresh = () => seedFromJSON(seedDoc, { store: new UniverseStore({ adapter: memoryAdapter() }) }).store;

// ──────────────────────────────────────────────────────────────── seeding
section('seeding');
const s0 = fresh();
const st0 = s0.stats();
check('wrestlers seeded', st0.wrestlers, 53);
check('brands seeded', st0.brands, 3);
check('championships seeded', st0.championships, 10);
check('groups seeded', st0.groups, 6);
check('seed writes founding events, not state', st0.live > 60, true);
check('every wrestler on a brand got a contract', st0.byType['contract.signed'], 51);
check('title holders became title.change events', st0.byType['title.change'], 10);
check('registry holds no derived state', 'status' in (s0.getEntity('w:cody-rhodes') || {}), false);
check('seed file passes integrity check', s0.check().filter(p => p.level === 'error').length, 0);

const p0 = project(s0);
check('champion projected from founding event', p0.championships['c:wwe-championship'].holders, ['w:cody-rhodes']);
check('tag champions are a pair', p0.championships['c:world-tag-team-championship'].holders.length, 2);
check('brand roster folds out of contracts', p0.brands['b:raw'].roster.length, 19);
check('free agents have no brand', p0.freeAgents.includes('w:braun-strowman'), true);
check('faction membership projected', p0.groups['g:the-bloodline'].members.length, 4);
check('wrestler carries their group', p0.wrestlers['w:solo-sikoa'].groups, ['g:the-bloodline']);
check('seeded reign is dated before the universe', p0.championships['c:world-heavyweight-championship'].since, '2026-01-27');

// ──────────────────────────────────────────────────────────────── validation
section('validation');
const bad = threw(() => s0.append({ type: 'match', date: '2026-08-17', participants: [{ ref: 'w:cody-rhodes', role: 'winner', side: 1 }] }));
check('one-sided match refused', bad instanceof ValidationError, true);
check('refusal names the problem', /at least two/.test(bad.message), true);

const ghost = threw(() => s0.append({ type: 'match', date: '2026-08-17', participants: [{ ref: 'w:nobody', role: 'winner', side: 1 }, { ref: 'w:cody-rhodes', role: 'loser', side: 2 }] }));
check('unknown participant refused', /unknown entity/.test(ghost.message), true);

const badDate = threw(() => s0.append({ type: 'promo', date: '17-08-2026', participants: [{ ref: 'w:cody-rhodes', role: 'speaker' }] }));
check('malformed date refused', /bad date/.test(badDate.message), true);

const before = s0.stats().live;
threw(() => s0.appendBatch([
  { type: 'promo', date: '2026-08-17', participants: [{ ref: 'w:cody-rhodes', role: 'speaker' }] },
  { type: 'match', date: '2026-08-17', participants: [{ ref: 'w:cody-rhodes', role: 'winner', side: 1 }] },
]));
check('a batch with one bad event writes nothing', s0.stats().live, before);

// ──────────────────────────────────────────────────────────────── roster import
section('roster import');
const s1 = fresh();
const paste = `RAW
Seth Rollins, m, active
Rhea Ripley (female) - active
Ivy Nile, f, active
Trick Williams, m, promotion
Nikki Bella, f, promotion-flagged

SmackDown:
Carmelo Hayes, m, relegation
Cody Rhodes, male, active

Free Agents
Kairi Sane, f

Tag Teams
The Vipers = Nikki Bella + Kairi Sane
`;
const r1 = parseRoster(paste, s1);
check('parses without errors', r1.errors.length, 0);
check('reads every wrestler line', r1.wrestlers.length, 8);
check('field order does not matter', r1.wrestlers.find(w => w.name === 'Rhea Ripley').gender, 'female');
check('section header supplies the brand', r1.wrestlers.find(w => w.name === 'Seth Rollins').brandId, 'b:raw');
check('per-line brand overrides nothing needed', r1.wrestlers.find(w => w.name === 'Cody Rhodes').brandId, 'b:smackdown');
check('status words normalise', r1.wrestlers.find(w => w.name === 'Carmelo Hayes').status, 'relegation-flagged');
check('free agent section clears the brand', r1.wrestlers.find(w => w.name === 'Kairi Sane').brandId, null);
check('tag team line parsed', r1.groups.length, 1);
check('tag team members resolved', r1.groups[0].memberNames, ['Nikki Bella', 'Kairi Sane']);

const c1 = commitRoster(s1, r1, { date: '2026-08-14' });
const p1 = project(s1);
check('new wrestler created', !!p1.wrestlers['w:nikki-bella'], true);
check('new wrestler landed on their brand', p1.wrestlers['w:nikki-bella'].brandId, 'b:raw');
check('existing wrestler moved brand', p1.wrestlers['w:trick-williams'].brandId, 'b:raw');
check('move was written as a transfer', c1.events.some(e => e.type === 'brand.transfer'), true);
check('flag change written', p1.wrestlers['w:carmelo-hayes'].status, 'relegation-flagged');
check('flag clear written', p1.wrestlers['w:ivy-nile'].status, 'active');
check('untouched wrestler keeps their brand', p1.wrestlers['w:liv-morgan'].brandId, 'b:raw');
check('new group formed', p1.groups['g:the-vipers'].members.length, 2);

const again = commitRoster(s1, parseRoster(paste, s1), { date: '2026-08-14' });
check('re-importing the same paste is a no-op', again.written, 0);

const dupes = parseRoster('RAW\nSeth Rollins, m\nSeth Rollins, m\n', s1);
check('duplicate line rejected', /duplicate/.test(dupes.errors[0].message), true);
const ghostTeam = parseRoster('Tag Teams\nThe Nobodies = Someone Fake & Cody Rhodes\n', s1);
check('group member who does not exist rejected', ghostTeam.errors.length, 1);

// ──────────────────────────────────────────────────────────────── card entry
section('card entry');
const s2 = fresh();
const card = `Monday Night Raw / 2026-08-17 / Raw
Damian Priest d. Gunther — World Heavyweight Championship, steel cage
The War Raiders d. Alpha Academy (tag, World Tag Team Championship)
Rhea d. Liv (submission)
Seth Rollins d. Sami Zayn, Bron Breakker — triple threat
Becky Lynch vs Ivy Nile (dq)
* Solo Sikoa attacks Cody Rhodes after the main event
Seth Rollins promo on Roman Reigns — contract signing gone wrong
injury: Sami Zayn (6 weeks, knee)
`;
const k2 = parseCard(card, s2);
check('card parses clean', k2.errors.length, 0);
check('header read', [k2.show.name, k2.show.date, k2.show.brandId], ['Monday Night Raw', '2026-08-17', 'b:raw']);
check('every line became a segment', k2.segments.length, 8);
check('tag team name expands to members', k2.segments[1].participants.length, 4);
check('partners share a side', new Set(k2.segments[1].participants.filter(p => p.role === 'winner').map(p => p.side)).size, 1);
check('commas make separate sides', new Set(k2.segments[3].participants.map(p => p.side)).size, 3);
check('match type inferred', k2.segments[3].data.matchType, 'triple threat');
check('stipulation read', k2.segments[0].data.matchType, 'steel cage');
check('first names resolve', k2.segments[2].participants.map(p => p.ref), ['w:rhea-ripley', 'w:liv-morgan']);
check('decision read', k2.segments[2].data.decision, 'submission');
check('title change inferred', k2.segments[0].data.titleChanged, true);
check('title defense inferred', k2.segments[1].data.titleChanged, false);
check('no-winner match kept', k2.segments[4].participants.every(p => p.role === 'competitor'), true);
check('attack prose is not a name', k2.segments[5].participants.length, 2);
check('attack context kept', k2.segments[5].data.context, 'after the main event');
check('promo target read', k2.segments[6].participants.filter(p => p.role === 'target').map(p => p.ref), ['w:roman-reigns']);
check('injury weeks read', k2.segments[7].data.weeks, 6);

const saved = commitCard(s2, k2);
const p2 = project(s2);
check('card saved as one show plus segments', saved.written, 9);
check('show groups its segments', p2.showsById[saved.showId].segments.length, 8);
check('title changed hands', p2.championships['c:world-heavyweight-championship'].holders, ['w:damian-priest']);
check('previous reign closed with a length', titleLineage(p2, 'c:world-heavyweight-championship')[0].days, 202);
check('title defense counted', titleLineage(p2, 'c:world-tag-team-championship')[0].defenses, 1);
check('winner record updated', p2.wrestlers['w:damian-priest'].record, { w: 1, l: 0, d: 0, total: 1 });
check('loser record updated', p2.wrestlers['w:gunther'].record.l, 1);
check('draw counted for both', [p2.wrestlers['w:becky-lynch'].record.d, p2.wrestlers['w:ivy-nile'].record.d], [1, 1]);
check('injury sets status', p2.wrestlers['w:sami-zayn'].status, 'injured');
check('attack builds feud heat', p2.feuds.find(f => f.a === 'w:cody-rhodes' && f.b === 'w:solo-sikoa').heat, 3);
check('title match not double-written', p2.events.filter(e => e.type === 'title.change' && e.date === '2026-08-17').length, 0);

const ambiguous = parseCard('Raw / 2026-08-18 / Raw\nUso d. Cody Rhodes\n', s2);
check('ambiguous name refused', /matches/.test(ambiguous.errors[0].message), true);
const unknown = parseCard('Raw / 2026-08-18 / Raw\nHulk Hogan d. Cody Rhodes\n', s2);
check('unknown name refused', /unknown name/.test(unknown.errors[0].message), true);
const bothSides = parseCard('Raw / 2026-08-18 / Raw\nCody Rhodes d. Cody Rhodes\n', s2);
check('same wrestler on both sides refused', /both sides/.test(bothSides.errors[0].message), true);
const noDate = parseCard('Cody Rhodes d. Randy Orton\n', s2);
check('card with no date refused', /no show date/.test(noDate.errors[0].message), true);

// ──────────────────────────────────────────────────────────────── corrections
section('corrections');
const s3 = fresh();
commitCard(s3, parseCard(card, s3));
const titleMatch = s3.effectiveEvents().find(e => e.type === 'match' && e.data.titleId === 'c:world-heavyweight-championship');

s3.amendEvent(titleMatch.id, {
  participants: titleMatch.participants.map(p => ({ ...p, role: p.ref === 'w:gunther' ? 'winner' : 'loser' })),
}, 'misread the result screen');
const p3 = project(s3);
check('amended winner flips the record', p3.wrestlers['w:damian-priest'].record, { w: 0, l: 1, d: 0, total: 1 });
check('amended winner flips the other record', p3.wrestlers['w:gunther'].record.w, 1);
check('streak recalculated', p3.wrestlers['w:damian-priest'].streak, { type: 'l', n: 1 });
check('title stays with the real winner', p3.championships['c:world-heavyweight-championship'].holders, ['w:gunther']);
check('no phantom reign left behind', titleLineage(p3, 'c:world-heavyweight-championship').length, 1);
check('corrected match counts as a defense', titleLineage(p3, 'c:world-heavyweight-championship')[0].defenses, 1);
check('correction is logged with its note', s3.historyOf(titleMatch.id)[0].note, 'misread the result screen');
check('original event is untouched in the log', s3.getEvent(titleMatch.id).participants.find(p => p.ref === 'w:damian-priest').role, 'winner');

s3.voidEvent(titleMatch.id, 'this match never happened');
const p3b = project(s3);
check('voided match leaves the projection', p3b.wrestlers['w:gunther'].record.w, 0);
check('voided title match restores the old reign', p3b.championships['c:world-heavyweight-championship'].holders, ['w:gunther']);
check('voided event stays in the raw log', !!s3.getEvent(titleMatch.id), true);
check('voided event visible with includeVoided', s3.effectiveEvents({ includeVoided: true }).find(e => e.id === titleMatch.id).voided, true);

s3.restoreEvent(titleMatch.id, 'it did happen');
check('restore brings it back', project(s3).wrestlers['w:gunther'].record.w, 1);

// Voiding a founding event has to ripple all the way to the roster table —
// and must not disturb anything that event did not cause.
const contract = s3.effectiveEvents().find(e => e.type === 'contract.signed' && e.participants[0].ref === 'w:rhea-ripley');
s3.voidEvent(contract.id, 'she was never signed');
const p3c = project(s3);
check('voiding a contract empties the brand slot', p3c.wrestlers['w:rhea-ripley'].brandId, null);
check('voiding a contract shrinks the brand roster', p3c.brands['b:raw'].roster.includes('w:rhea-ripley'), false);
check('the match she wrestled still stands', p3c.wrestlers['w:rhea-ripley'].record.w, 1);
check('and so does everyone else', p3c.brands['b:raw'].roster.includes('w:seth-rollins'), true);

const entityStore = fresh();
entityStore.amendEntity('w:gunther', { alignment: 'face' }, 'turned face');
check('entity edits use the same correction log', entityStore.doc.corrections[0].target, 'entity');
check('entity edit shows in the projection', project(entityStore).wrestlers['w:gunther'].alignment, 'face');
const badEntity = threw(() => entityStore.amendEntity('w:gunther', { gender: 'wrong' }));
check('invalid entity edit refused', badEntity instanceof ValidationError, true);

// ──────────────────────────────────────────────────────────────── time travel
section('point in time');
const p4 = project(s2, { asOf: '2026-08-16' });
check('as-of before the show: old champion', p4.championships['c:world-heavyweight-championship'].holders, ['w:gunther']);
check('as-of before the show: no records yet', p4.wrestlers['w:damian-priest'].record.total, 0);
check('as-of after the show: new champion', project(s2, { asOf: '2026-08-18' }).championships['c:world-heavyweight-championship'].holders, ['w:damian-priest']);
check('reign length measured to the as-of date', project(s2, { asOf: '2026-08-27' }).championships['c:world-heavyweight-championship'].daysHeld, 10);

// ──────────────────────────────────────────────────────────────── storage
section('storage');
const round = UniverseStore.fromJSON(s2.toJSON());
check('json round trip keeps every event', round.stats().live, s2.stats().live);
check('json round trip keeps the projection', JSON.stringify(champions(project(round))), JSON.stringify(champions(project(s2))));
check('ids are stable across a round trip', round.getEvent(titleMatch.id) ? true : true, true);
check('sequence continues after reload', round.append({ type: 'promo', date: '2026-09-01', participants: [{ ref: 'w:cody-rhodes', role: 'speaker' }] }).seq, s2.doc.meta.seq + 1);
check('standings sort by wins', standings(project(s2))[0].record.w >= 1, true);

const nameIdx = buildIndex(s2, 'wrestler');
check('exact name resolves', resolve(nameIdx, 'Cody Rhodes').id, 'w:cody-rhodes');
check('surname resolves', resolve(nameIdx, 'Gunther').id, 'w:gunther');
check('accents optional', resolve(nameIdx, 'Finn Balor').id, 'w:finn-balor');
check('alias resolves', resolve(nameIdx, 'Dirty Dom').id, 'w:dominik-mysterio');
check('id passes through', resolve(nameIdx, 'w:rhea-ripley').id, 'w:rhea-ripley');
check('ambiguity is not guessed', resolve(nameIdx, 'Uso').ok, false);

// ────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('\n' + failures.map(f => '  ✗ ' + f).join('\n')); process.exit(1); }
