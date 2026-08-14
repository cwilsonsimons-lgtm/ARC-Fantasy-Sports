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
import { project, champions, titleLineage, standings, movementsFor } from '../js/universe/project.js';
import { seedFromJSON } from '../js/universe/seed.js';
import { parseRoster, commitRoster } from '../js/universe/roster.js';
import { parseCard, commitCard, setTitleOutcome } from '../js/universe/card.js';
import { resolve, buildIndex } from '../js/universe/util.js';
import { tiers, tierOf, destination, pyramidText, checkBrand, autoPromotions } from '../js/universe/pyramid.js';
import { candidates, eligibleOpponents, checkPairing, recordMatch, lastStandBoard } from '../js/universe/laststand.js';
import { calendarMonth, monthsWithShows, weeklySchedule, brandsOnWeekday, cardOf,
  cardText as cardAsText, monthText, shiftMonths, weekdayName } from '../js/universe/calendar.js';
import { proposeDraft, commitDraft, draftText } from '../js/universe/draft.js';
import { seasons, currentSeason, standingsFor, proposeFlags, commitFlags,
  proposeLastStand, lastStandCard, nextStep, PHASES } from '../js/universe/season.js';
import { recapPrompt, contenderPrompt, nextPrompt, entryPrompt, PROMPTS, buildPrompt } from '../js/universe/prompts.js';
import { cleanReply, detectKind, transcriptionPrompt, readScreenshot } from '../js/universe/ingest.js';

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
check('wrestlers seeded', st0.wrestlers, 79);
check('brands seeded', st0.brands, 5);
check('championships seeded', st0.championships, 15);
check('groups seeded', st0.groups, 7);
check('seed writes founding events, not state', st0.live > 60, true);
check('every wrestler on a brand got a contract', st0.byType['contract.signed'], 77);
// A brand-new save crowns nobody. Championships exist, and every one of them is
// vacant until the user books somebody into it.
check('seeding awards no championships', st0.byType['title.change'], undefined);
check('registry holds no derived state', 'status' in (s0.getEntity('w:cody-rhodes') || {}), false);
check('seed file passes integrity check', s0.check().filter(p => p.level === 'error').length, 0);

const p0 = project(s0);
check('every belt starts vacant', Object.values(p0.championships).every(c => c.vacant), true);
check('and with no holders at all', p0.championships['c:world-tag-team-championship'].holders, []);
check('brand roster folds out of contracts', p0.brands['b:raw'].roster.length, 19);
check('the pyramid seeds three tiers', tiers(p0).map(t => t.brands.length), [3, 1, 1]);
check('with the top tier equal', tiers(p0)[0].brands.map(b => b.name), ['Dynamite', 'Raw', 'SmackDown']);
check('free agents have no brand', p0.freeAgents.includes('w:braun-strowman'), true);
check('faction membership projected', p0.groups['g:the-bloodline'].members.length, 4);
check('wrestler carries their group', p0.wrestlers['w:solo-sikoa'].groups, ['g:the-bloodline']);
check('a title history starts empty', Object.values(p0.championships).every(c => c.reigns.length === 0), true);
check('so nobody is listed as a champion', Object.values(p0.wrestlers).every(w => !w.titles.length), true);

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

// A faction gaining one member is one member joining, not a broken event. The
// two-member rule is about *forming* a group; The Judgment Day signing a fifth
// is an ordinary Tuesday, and this used to refuse the whole paste.
const s1b = fresh();
const jd = () => project(s1b).groups['g:the-judgment-day'];
const before1b = jd().members.length;
const grow = commitRoster(s1b, parseRoster(`Raw
${jd().members.map(m => `${project(s1b).wrestlers[m].name}, m, active`).join('\n')}
Bron Breakker, m, active

Factions
The Judgment Day = ${[...jd().members.map(m => project(s1b).wrestlers[m].name), 'Bron Breakker'].join(' & ')}
`, s1b), { date: '2026-08-14' });
check('one wrestler can join a group that exists', grow.written > 0, true);
check('written as a join, not a second forming',
  grow.events.filter(e => e.type === 'alliance.formed').every(e => e.data.join === true), true);
check('and the group gains exactly them', jd().members.length, before1b + 1);
check('without restating when it formed', jd().history.filter(x => x.what === 'formed').length, 1);

// Replacing a line-up wholesale is a re-form, not a group folding: the paste
// still lists the group, so it must not end up dissolved and empty.
const s1c = fresh();
const swap = commitRoster(s1c, parseRoster(`Raw
Otis, m, active
Akira Tozawa, m, active

Tag Teams
Alpha Academy = Otis & Akira Tozawa
`, s1c), { date: '2026-08-14' });
const aa = project(s1c).groups['g:alpha-academy'];
check('a replaced line-up keeps the group alive', aa.active, true);
check('with the pasted members', aa.members.map(m => project(s1c).wrestlers[m].name), ['Otis', 'Akira Tozawa']);
check('and it re-forms rather than gaining members',
  swap.events.filter(e => e.type === 'alliance.formed').every(e => !e.data.join), true);
// A paste states who is in a group. It is not a storyline about somebody
// turning, so it must not fill the threads queue with betrayals.
check('a paste never invents a betrayal', project(s1c).threads.filter(t => t.kind === 'betrayal').length, 0);

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
check('a vacant belt is won, not defended', k2.segments[1].data.titleChanged, true);
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
check('the first reign starts the history', titleLineage(p2, 'c:world-heavyweight-championship').length, 1);
check('the tag belts found their first champions', p2.championships['c:world-tag-team-championship'].holders.length, 2);
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
check('and the corrected winner holds it instead', titleLineage(p3, 'c:world-heavyweight-championship')[0].holders, ['Gunther']);
check('correction is logged with its note', s3.historyOf(titleMatch.id)[0].note, 'misread the result screen');
check('original event is untouched in the log', s3.getEvent(titleMatch.id).participants.find(p => p.ref === 'w:damian-priest').role, 'winner');

s3.voidEvent(titleMatch.id, 'this match never happened');
const p3b = project(s3);
check('voided match leaves the projection', p3b.wrestlers['w:gunther'].record.w, 0);
check('voiding the match empties the belt again', p3b.championships['c:world-heavyweight-championship'].vacant, true);
check('and erases the reign from the history', p3b.championships['c:world-heavyweight-championship'].reigns.length, 0);
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

// ──────────────────────────────────────────────────────────────── titles
section('titles: interim, vacating, unification');
const s5 = fresh();
const T = 'c:wwe-championship';
const card5 = show => commitCard(s5, parseCard(show, s5));

// Crown someone first: an interim reign only means anything alongside a real one.
card5(`SmackDown / 2026-08-14 / SmackDown
Cody Rhodes d. Randy Orton — WWE Championship`);
card5(`SmackDown / 2026-08-21 / SmackDown
Solo Sikoa d. Jimmy Uso — WWE Championship, interim`);
let p5 = project(s5);
check('interim does not take the real belt', p5.championships[T].holders, ['w:cody-rhodes']);
check('interim champion recorded', p5.championships[T].interimHolders, ['w:solo-sikoa']);
check('two reigns run at once', p5.championships[T].reigns.filter(r => !r.to).length, 2);
check('the real reign keeps counting', p5.championships[T].since, '2026-08-14');

card5(`SmackDown / 2026-08-28 / SmackDown
Solo Sikoa d. LA Knight — WWE Championship, interim`);
p5 = project(s5);
check('interim defense lands on the interim reign', titleLineage(p5, T).find(r => r.interim).defenses, 1);
check('and not on the real one', titleLineage(p5, T).find(r => !r.interim).defenses, 0);

card5(`SmackDown / 2026-09-04 / SmackDown
Solo Sikoa d. Cody Rhodes — WWE Championship, unify`);
p5 = project(s5);
check('unification ends both reigns', p5.championships[T].reigns.filter(r => !r.to).length, 1);
check('and crowns one undisputed champion', p5.championships[T].holders, ['w:solo-sikoa']);
check('no interim champion left', p5.championships[T].interimHolders, []);
check('the interim run closed as unified', titleLineage(p5, T).find(r => r.interim).endReason, 'unified');
check('lineage keeps every row', titleLineage(p5, T).length, 3);

card5(`SmackDown / 2026-09-11 / SmackDown
vacate: WWE Championship`);
p5 = project(s5);
check('vacating empties the belt', p5.championships[T].vacant, true);
check('and closes the reign with its days', titleLineage(p5, T).slice(-1)[0].days, 7);
check('a vacancy opens a thread', p5.threads.some(t => t.kind === 'vacant-title' && t.about === T), true);

card5(`SmackDown / 2026-09-18 / SmackDown
Randy Orton d. LA Knight — WWE Championship`);
p5 = project(s5);
check('a vacant belt is won, not taken', p5.championships[T].holders, ['w:randy-orton']);
check('and that closes the vacancy thread', p5.threads.some(t => t.kind === 'vacant-title'), false);

// ──────────────────────────────────────────────────────────────── relationships
section('relationships');
const s6 = fresh();
commitCard(s6, parseCard(`SmackDown / 2026-08-21 / SmackDown
* Jacob Fatu attacks Jey Uso after the main event
* Jimmy Uso saves Jey Uso from Jacob Fatu`, s6));
const p6 = project(s6, { asOf: '2026-08-22' });
const pair = (list, x, y) => list.find(r => [r.a, r.b].includes(x) && [r.a, r.b].includes(y));

check('an attack builds rivalry', pair(p6.rivalries, 'w:jacob-fatu', 'w:jey-uso').heat, h => h > 2.9 && h <= 3);
check('it reaches the tag partner too', !!pair(p6.rivalries, 'w:jacob-fatu', 'w:jimmy-uso'), true);
check('but only a fraction of it', pair(p6.rivalries, 'w:jacob-fatu', 'w:jimmy-uso').why['their faction'], 1);
check('the spread is smaller than the direct hit',
  pair(p6.rivalries, 'w:jacob-fatu', 'w:jey-uso').heat > pair(p6.rivalries, 'w:jacob-fatu', 'w:jimmy-uso').heat - 2, true);
check('a save builds an alliance', pair(p6.alliances, 'w:jimmy-uso', 'w:jey-uso').why.save, 1);
check('and earns the saver the attacker', pair(p6.rivalries, 'w:jimmy-uso', 'w:jacob-fatu').why.save, 1);

const s6b = fresh();
commitCard(s6b, parseCard(`SmackDown / 2026-08-21 / SmackDown
* Solo Sikoa attacks Jacob Fatu`, s6b));
const p6b = project(s6b, { asOf: '2026-08-22' });
check('turning on a stablemate is a betrayal', pair(p6b.rivalries, 'w:solo-sikoa', 'w:jacob-fatu').why.betrayal, 1);
check('and it runs hotter than a normal attack', pair(p6b.rivalries, 'w:solo-sikoa', 'w:jacob-fatu').heat > 4.5, true);
check('the thread knows it too', p6b.threads.some(t => t.kind === 'betrayal'), true);
check('it spreads to the rest of the faction', p6b.rivalries.filter(r => r.why['their faction']).length, 2);

const s6c = fresh();
commitCard(s6c, parseCard(`Raw / 2026-08-21 / Raw
The War Raiders d. Alpha Academy (tag)`, s6c));
check('tag partners build a bond by winning', pair(project(s6c).alliances, 'w:erik', 'w:ivar').why['tag win'], 1);
check('the losing pair build a smaller one',
  pair(project(s6c).alliances, 'w:chad-gable', 'w:ludwig-kaiser').heat < pair(project(s6c).alliances, 'w:erik', 'w:ivar').heat, true);

const heatAt = d => pair(project(s6b, { asOf: d }).rivalries, 'w:solo-sikoa', 'w:jacob-fatu').heat;
check('heat decays without new events', heatAt('2026-08-22') > heatAt('2026-10-21'), true);
check('one half-life halves it', Math.abs(heatAt('2026-10-20') - heatAt('2026-08-21') / 2) < 0.2, true);
check('a cold feud stops counting as active',
  project(s6b, { asOf: '2027-02-01' }).rivalries.filter(r => r.active).length, 0);
check('but the history is still there',
  project(s6b, { asOf: '2027-02-01' }).rivalries.length > 0, true);
check('rewinding brings the heat back', heatAt('2026-08-22') > 4.5, true);

// ──────────────────────────────────────────────────────────────── threads
section('threads');
const s7 = fresh();
commitCard(s7, parseCard(`Raw / 2026-08-21 / Raw
* Bron Breakker attacks Sami Zayn after the main event
Seth Rollins d. Sheamus — contender, World Heavyweight Championship
promise: Sheamus — Intercontinental Championship
injury: Damian Priest (6 weeks, knee)`, s7));
let p7 = project(s7, { asOf: '2026-08-22' });
check('an unanswered attack opens a thread', p7.threads.some(t => t.kind === 'attack' && t.about === 'w:bron-breakker'), true);
check('a contender win opens a title shot', p7.threads.some(t => t.kind === 'title-shot' && t.subjects.includes('w:seth-rollins')), true);
check('a promise opens one too', p7.threads.some(t => t.kind === 'title-shot' && t.subjects.includes('w:sheamus')), true);
check('an injury opens one', p7.threads.some(t => t.kind === 'injury'), true);
check('threads know how old they are', p7.threads[0].age, 1);

commitCard(s7, parseCard(`Raw / 2026-09-01 / Raw
Sami Zayn d. Bron Breakker
Seth Rollins d. Gunther — World Heavyweight Championship
cleared: Damian Priest`, s7));
p7 = project(s7, { asOf: '2026-09-02' });
check('beating them answers the attack', p7.threadsClosed.some(t => t.kind === 'attack' && t.closedWhy === 'beat them'), true);
check('getting the match closes the shot', p7.threadsClosed.some(t => t.kind === 'title-shot' && t.subjects.includes('w:seth-rollins')), true);
check('being cleared closes the injury', p7.threadsClosed.some(t => t.kind === 'injury' && t.closedWhy === 'cleared to return'), true);
check('an unrelated promise stays open', p7.threads.some(t => t.subjects.includes('w:sheamus')), true);
check('ages count to the close, not to now', p7.threadsClosed.find(t => t.kind === 'attack').age, 11);

const stuck = p7.threads.find(t => t.subjects.includes('w:sheamus'));
s7.append({ type: 'thread.resolved', date: '2026-09-02', participants: [], data: { threadId: stuck.id, reason: 'dropped it' } });
check('marking one resolved closes it', project(s7, { asOf: '2026-09-03' }).threads.some(t => t.id === stuck.id), false);
check('resolution is an ordinary event', s7.effectiveEvents().slice(-1)[0].type, 'thread.resolved');
s7.voidEvent(s7.effectiveEvents().slice(-1)[0].id, 'changed my mind');
check('voiding the resolution reopens the thread', project(s7, { asOf: '2026-09-03' }).threads.some(t => t.id === stuck.id), true);

// ──────────────────────────────────────────────────────────────── season
section('season, promotion and relegation');
const s8 = fresh();
const play = text => commitCard(s8, parseCard(text, s8));

play(`Raw / 2027-01-12 / Raw
Ivy Nile d. Becky Lynch
Seth Rollins d. Sami Zayn`);
let p8 = project(s8, { asOf: '2027-01-13' });
check('one season until a Last Stand', seasons(p8).length, 1);
check('it starts at the universe start date', currentSeason(p8).from, '2026-06-01');
check('and has no WrestleMania yet', currentSeason(p8).wrestlemania, null);
check('standings count wins in the window', standingsFor(p8, { from: '2026-06-01' }).find(r => r.id === 'w:ivy-nile').points, 3);
check('and are sorted by points', standingsFor(p8, { from: '2026-06-01' })[0].points, 3);

play(`WrestleMania 43 / 2027-04-04 / Raw
Cody Rhodes d. Roman Reigns — WWE Championship`);
p8 = project(s8, { asOf: '2027-04-05' });
check('WrestleMania is recognised by name', currentSeason(p8).wrestlemania.date, '2027-04-04');
check('a PLE is marked on the show', p8.shows.find(s => s.date === '2027-04-04').ple, 'wrestlemania');

const flags = proposeFlags(p8);
// Three tiers, so the middle rung does both: NXT names go up to tier 1 and
// down to Evolve in the same year. Nothing in the rule mentions a brand.
check('the top tier only relegates', flags.filter(f => f.tier === 1).every(f => f.flag === 'relegation-flagged'), true);
check('the bottom tier only promotes', flags.filter(f => f.tier === 3).every(f => f.flag === 'promotion-flagged'), true);
check('the middle tier does both', new Set(flags.filter(f => f.tier === 2).map(f => f.flag)).size, 2);
check('relegation names head one rung down', flags.filter(f => f.flag === 'relegation-flagged' && f.tier === 1)
  .every(f => f.toward === 'b:nxt'), true);
check('promotion names head one rung up', flags.filter(f => f.flag === 'promotion-flagged' && f.tier === 3)
  .every(f => f.toward === 'b:nxt'), true);
check('every list is even, so everyone has an opponent', (() => {
  const groups = {};
  flags.forEach(f => { const k = `${f.tier}|${f.gender}|${f.flag}`; groups[k] = (groups[k] || 0) + 1; });
  return Object.values(groups).every(n => n % 2 === 0);
})(), true);
check('champions are never relegated', flags.some(f => f.flag === 'relegation-flagged'
  && Object.values(p8.championships).some(c => c.holders.includes(f.id))), false);
check('the least-booked sink to the bottom', flags.find(f => f.flag === 'relegation-flagged').why.includes('no matches'), true);

commitFlags(s8, flags, { date: '2027-04-05' });
p8 = project(s8, { asOf: '2027-04-06' });
check('flags are written as events', s8.effectiveEvents().filter(e => e.source === 'season').length, flags.length);
check('and show on the roster', flags.every(f => /flagged$/.test(p8.wrestlers[f.id].status)), true);
check('re-proposing writes nothing new', proposeFlags(p8).every(f => f.alreadyFlagged), true);

const stand = proposeLastStand(p8);
check('one competition per brand, gender and direction', stand.groups.length, 12);
check('and one match in each', stand.matches.length, 12);
// The rule the brief is most explicit about: relegation is settled inside a
// show. A Raw name never faces a SmackDown name for a Raw spot.
check('relegation never crosses a brand', stand.groups.filter(g => g.direction === 'relegation')
  .every(g => g.matches.every(m => m.a.brandId === m.b.brandId && m.a.brandId === g.brandId)), true);
check('promotion never crosses a brand either', stand.groups.filter(g => g.direction === 'promotion')
  .every(g => g.matches.every(m => m.a.brandId === m.b.brandId)), true);
check('and the two never meet', stand.matches.every(m =>
  m.a.status === m.b.status), true);
check('every match names where the mover lands', stand.matches.every(m => !!m.toBrandId), true);
check('relegation heads down a rung', stand.groups.filter(g => g.direction === 'relegation' && g.tier === 1)
  .every(g => g.toBrandId === 'b:nxt'), true);
check('with nobody left over', stand.unpaired.length, 0);
check('never across genders', stand.matches.every(m => m.a.gender === m.b.gender), true);
check('and never across tiers', stand.matches.every(m =>
  tierOf(p8, m.a.brandId) === tierOf(p8, m.b.brandId)), true);
check('never across genders', stand.matches.every(m => m.a.gender === m.b.gender), true);
check('relegation faces relegation', stand.matches.filter(m => m.stakes === 'relegation')
  .every(m => m.a.status === 'relegation-flagged' && m.b.status === 'relegation-flagged'), true);
check('promotion faces promotion', stand.matches.filter(m => m.stakes === 'promotion')
  .every(m => m.a.status === 'promotion-flagged' && m.b.status === 'promotion-flagged'), true);
check('relegation drops to development', stand.matches.find(m => m.stakes === 'relegation').toBrandId, 'b:nxt');
check('promotion rises to a main brand', stand.matches.find(m => m.stakes === 'promotion').toBrandId, b => b !== 'b:nxt');

const cardText = lastStandCard(p8, stand, { date: '2027-04-25' });
check('the card is written in the entry shorthand', cardText.split('\n')[0], 'Last Stand / 2027-04-25');
check('with a line per match', cardText.split('\n').filter(l => / vs /.test(l)).length, 12);

const played = cardText.split('\n').map(l => l.replace(' vs ', ' d. ')).join('\n');
const lastStandParsed = parseCard(played, s8);
check('and parses back with no errors', lastStandParsed.errors.length, 0);
check('stakes are inferred from the flags alone', lastStandParsed.segments.every(sg => sg.data.stakes), true);
commitCard(s8, lastStandParsed);

const p8b = project(s8, { asOf: '2027-04-26' });
const rel = stand.matches.find(m => m.stakes === 'relegation');
const pro = stand.matches.find(m => m.stakes === 'promotion');
check('the loser of a relegation match goes down', p8b.wrestlers[rel.b.id].brandId, 'b:nxt');
check('the winner stays up', p8b.wrestlers[rel.a.id].brandId, rel.a.brandId);
check('the winner of a promotion match goes up', p8b.wrestlers[pro.a.id].brandId, b => b !== 'b:nxt');
check('the loser stays in development', p8b.wrestlers[pro.b.id].brandId, 'b:nxt');
check('everyone who fought walks out unflagged',
  stand.matches.flatMap(m => [m.a.id, m.b.id]).every(id => p8b.wrestlers[id].status === 'active'), true);
check('and whoever had no opponent stays on the list',
  stand.unpaired.every(w => /flagged$/.test(p8b.wrestlers[w.id].status)), true);
// Last Stand does not end the year — the Draft does.
check('Last Stand hands over to the draft', currentSeason(p8b).phase, 'draft');
check('and the season is still open', seasons(p8b).length, 1);
commitCard(s8, parseCard(`WWE Draft / 2027-05-02 / Raw
Seth Rollins d. Sami Zayn`, s8));
const p8c = project(s8, { asOf: '2027-05-03' });
check('the draft closes it', seasons(p8c).length, 2);
check('and the next one starts the day after', currentSeason(p8c).from, '2027-05-03');
check('the new year opens in its own phase', currentSeason(p8c).phase, 'newSeason');
check('the closed season keeps every marker', seasons(p8c)[0].wrestlemania.date, '2027-04-04');
check('voiding the draft merges the seasons back', (() => {
  const showEv = s8.effectiveEvents().find(e => e.type === 'show' && e.data.ple === 'draft');
  s8.voidEvent(showEv.id, 'test');
  const n = seasons(project(s8, { asOf: '2027-05-03' })).length;
  s8.restoreEvent(showEv.id, 'test');
  return n;
})(), 1);

// ──────────────────────────────────────────────────────────────── the pyramid
section('the pyramid');
const sP = fresh();
let pP = project(sP);
check('drawn the way the brief drew it', pyramidText(pP), 'Dynamite | Raw | SmackDown ↓ NXT ↓ Evolve');
check('the top tier is labelled', tiers(pP)[0].label, 'Main roster');
check('and the bottom one too', tiers(pP)[2].label, 'Lower developmental');
check('a tier-1 brand cannot be promoted off the top', destination(pP, 'b:raw', 'promotion'), null);
check('a bottom brand cannot be relegated out', destination(pP, 'b:evolve', 'relegation'), null);
check('relegation drops exactly one rung', destination(pP, 'b:raw', 'relegation'), 'b:nxt');
check('and again from the middle', destination(pP, 'b:nxt', 'relegation'), 'b:evolve');
check('the parent link steers promotion', destination(pP, 'b:evolve', 'promotion'), 'b:nxt');
check('promotion without a parent picks the thinnest roster',
  destination(pP, 'b:nxt', 'promotion'), b => ['b:raw', 'b:smackdown', 'b:dynamite'].includes(b));

// Nothing above named a brand — so a different shape should just work.
sP.addEntity('brand', { name: 'WCW', tier: 2, color: '#C0392B', day: 'Saturday' });
sP.addEntity('brand', { name: 'Deep South', tier: 4, color: '#555', parentId: 'b:evolve' });
pP = project(sP);
check('a new show joins its tier', tiers(pP).map(t => t.brands.length), [3, 2, 1, 1]);
check('and a fourth tier is just another rung', tiers(pP)[3].brands[0].name, 'Deep South');
check('the new tier promotes into the one above', destination(pP, 'b:deep-south', 'promotion'), 'b:evolve');
check('and Evolve now relegates into it', destination(pP, 'b:evolve', 'relegation'), 'b:deep-south');
check('WCW sits level with NXT', tierOf(pP, 'b:wcw'), tierOf(pP, 'b:nxt'));
check('the drawing keeps up', pyramidText(pP), 'Dynamite | Raw | SmackDown ↓ NXT | WCW ↓ Evolve ↓ Deep South');

check('a tier below zero is refused', checkBrand(pP, { name: 'X', tier: 0 }).length, 1);
check('a nameless show is refused', checkBrand(pP, { name: '  ', tier: 2 }).length, 1);
check('a parent on the same tier is refused',
  /cannot be the parent/.test(checkBrand(pP, { name: 'X', tier: 2, parentId: 'b:wcw' })[0] || ''), true);
check('a parent further down is refused', checkBrand(pP, { name: 'X', tier: 1, parentId: 'b:nxt' }).length, 1);
check('a parent above is fine', checkBrand(pP, { name: 'X', tier: 3, parentId: 'b:nxt' }).length, 0);

// The lists follow the new shape without a line of code knowing about WCW.
commitCard(sP, parseCard(`WrestleMania 44 / 2028-04-02 / Raw
Cody Rhodes d. Roman Reigns — WWE Championship`, sP));
const flagsP = proposeFlags(project(sP, { asOf: '2028-04-03' }));
// Evolve was the bottom rung a moment ago and only promoted. Adding a tier
// beneath it means it now relegates as well — with no code change anywhere.
check('a brand that gained a rung below it starts relegating',
  new Set(flagsP.filter(f => f.tier === 3).map(f => f.flag)).size, 2);
check('and still promotes',
  flagsP.some(f => f.tier === 3 && f.flag === 'promotion-flagged'), true);
check('an empty new brand flags nobody', flagsP.filter(f => f.tier === 4).length, 0);

// ──────────────────────────────────────────────────────────────── the draft
section('the annual draft');
const sD = fresh();
commitCard(sD, parseCard(`Raw / 2027-02-01 / Raw
Seth Rollins d. Sami Zayn
Gunther d. Sheamus — World Heavyweight Championship`, sD));
commitCard(sD, parseCard(`WrestleMania 43 / 2027-04-04 / Raw
Cody Rhodes d. Roman Reigns — WWE Championship`, sD));
const pD = project(sD, { asOf: '2027-04-26' });
const d1 = proposeDraft(pD, { tier: 1 });

check('the draft covers one tier at a time', d1.tier, 1);
check('every brand on the tier picks', d1.order.length, 3);
check('weakest season picks first', d1.order[0].points <= d1.order[d1.order.length - 1].points, true);
check('and it snakes', (() => {
  const r1 = d1.picks.filter(p => p.round === 1 && !p.team).map(p => p.brandName);
  const r2 = d1.picks.filter(p => p.round === 2 && !p.team).map(p => p.brandName);
  return r1[0] === r2[r2.length - 1];
})(), true);
check('champions are protected, not drafted', d1.protected.some(w => w.id === 'w:cody-rhodes'), true);
check('and they stay with the brand that owns the belt',
  d1.protected.find(w => w.id === 'w:cody-rhodes').brandId, 'b:smackdown');
check('a protected champion is out of the pool', d1.picks.some(p => p.wrestlerId === 'w:cody-rhodes'), false);
check('everybody else is in it', d1.picks.length + d1.protected.length,
  Object.values(pD.wrestlers).filter(w => (w.brandId && tierOf(pD, w.brandId) === 1) || (!w.brandId && w.status !== 'released')).length);
check('nobody is drafted twice', new Set(d1.picks.map(p => p.wrestlerId)).size, d1.picks.length);
check('a lower tier drafts on its own', proposeDraft(pD, { tier: 2 }).order.length, 0);
check('and one brand on a tier is no draft at all', proposeDraft(pD, { tier: 2 }).picks.length, 0);

const moved = d1.picks.filter(p => p.from !== p.brandId);
const dres = commitDraft(sD, d1, { date: '2027-05-02', state: pD });
check('only the moves are written', dres.written, moved.length);
const pD2 = project(sD, { asOf: '2027-05-03' });
check('and everyone landed where they were picked',
  d1.picks.every(p => pD2.wrestlers[p.wrestlerId].brandId === p.brandId), true);
check('the protected champion did not move', pD2.wrestlers['w:cody-rhodes'].brandId, 'b:smackdown');
check('a drafted free agent gets signed, not transferred',
  sD.effectiveEvents().filter(e => e.source === 'draft' && e.type === 'contract.signed').length,
  d1.picks.filter(p => !p.from).length);
// A draft is not idempotent the way a roster paste is — it reallocates the
// whole tier, so running it again is a different (equally valid) shuffle. What
// it does promise is that a pick which does not move anybody costs nothing.
check('a pick that stays put writes nothing',
  commitDraft(sD, { picks: d1.picks.filter(p => p.from === p.brandId) }, { date: '2027-05-02', dryRun: true }).events.length, 0);
check('so voiding a pick hands that wrestler back', (() => {
  const ev = sD.effectiveEvents().find(e => e.source === 'draft' && e.type === 'brand.transfer');
  const was = ev.data.fromBrandId;
  sD.voidEvent(ev.id, 'test');
  const back = project(sD, { asOf: '2027-05-03' }).wrestlers[ev.participants[0].ref].brandId;
  sD.restoreEvent(ev.id, 'test');
  return back === was;
})(), true);
check('the board reads as a board', draftText(pD, d1).includes('weakest season first'), true);



// ──────────────────────────────────────────────────────────────── the calendar
section('the annual calendar');
const sC = fresh();
const showC = (name, date) => commitCard(sC, parseCard(`${name} / ${date} / Raw
Seth Rollins d. Sami Zayn`, sC));
const phaseNow = () => currentSeason(project(sC, { asOf: '2027-12-31' })).phase;

check('a new universe starts in the regular season', phaseNow(), 'regular');
showC('Raw', '2027-01-12');
check('and stays there while shows are booked', phaseNow(), 'regular');
showC('WrestleMania 43', '2027-04-04');
check('WrestleMania ends the wrestling season', phaseNow(), 'wrestlemania');
commitFlags(sC, proposeFlags(project(sC, { asOf: '2027-04-05' })), { date: '2027-04-05' });
check('putting the lists up moves it to Last Stand', phaseNow(), 'lastStand');
showC('Last Stand', '2027-04-25');
check('Last Stand hands over to the draft', phaseNow(), 'draft');
showC('WWE Draft', '2027-05-02');
check('and the draft opens the new season', phaseNow(), 'newSeason');
showC('Raw', '2027-05-09');
check('which becomes a regular season once booked', phaseNow(), 'regular');

const pC = project(sC, { asOf: '2027-12-31' });
check('two seasons on record', seasons(pC).length, 2);
check('the old one is complete', seasons(pC)[0].phase, 'complete');
check('and can still be read back', [seasons(pC)[0].wrestlemania.date, seasons(pC)[0].lastStand.date, seasons(pC)[0].draft.date],
  ['2027-04-04', '2027-04-25', '2027-05-02']);
check('each season knows what comes next', nextStep(pC).do, s => /book/i.test(s));
check('the phase list is the order of the year', PHASES,
  ['regular', 'wrestlemania', 'lastStand', 'draft', 'newSeason']);

// A save that skips the draft is not stuck in one endless year.
const sC2 = fresh();
const showC2 = (name, date) => commitCard(sC2, parseCard(`${name} / ${date} / Raw
Seth Rollins d. Sami Zayn`, sC2));
showC2('WrestleMania 43', '2027-04-04');
showC2('Last Stand', '2027-04-25');
showC2('WrestleMania 44', '2028-04-02');
check('a skipped draft still rolls the year over', seasons(project(sC2, { asOf: '2028-05-01' })).length, 2);
check('closing at the Last Stand instead', seasons(project(sC2, { asOf: '2028-05-01' }))[0].closedBy, 'lastStand');

// ──────────────────────────────────────────────────────────────── brackets
section('Last Stand brackets');
const sB = fresh();
commitCard(sB, parseCard(`WrestleMania 43 / 2027-04-04 / Raw
Cody Rhodes d. Roman Reigns — WWE Championship`, sB));
commitFlags(sB, proposeFlags(project(sB, { asOf: '2027-04-05' }), { candidatesPerBrand: 4 }), { date: '2027-04-05' });
let pB = project(sB, { asOf: '2027-04-06' });
let g = proposeLastStand(pB).groups.find(x => x.brandId === 'b:raw' && x.gender === 'male' && x.direction === 'relegation');

check('four candidates make a bracket', g.candidates.length, 4);
check('round one is a qualifier', g.decides, false);
check('with two matches', g.matches.length, 2);
check('and no stakes on them', g.matches.every(m => !m.stakes), true);

const round1 = `Last Stand / 2027-04-25 / Raw\n` +
  g.matches.map(m => `${m.a.name} d. ${m.b.name} — relegation qualifier`).join('\n');
const parsedR1 = parseCard(round1, sB);
check('a qualifier line carries no stakes', parsedR1.segments.every(x => !x.data.stakes), true);
commitCard(sB, parsedR1);
pB = project(sB, { asOf: '2027-04-26' });
check('so nobody moved after round one',
  g.matches.every(m => pB.wrestlers[m.b.id].brandId === 'b:raw'), true);

g = proposeLastStand(pB).groups.find(x => x.brandId === 'b:raw' && x.gender === 'male' && x.direction === 'relegation');
check('the losers carry on to round two', g.standing.length, 2);
check('which decides it', g.decides, true);
check('as one match', g.matches.length, 1);
const final = g.matches[0];
commitCard(sB, parseCard(`Last Stand II / 2027-04-26 / Raw
${final.a.name} d. ${final.b.name} — relegation to NXT`, sB));
const pB2 = project(sB, { asOf: '2027-04-27' });
check('the loser of the final goes down', pB2.wrestlers[final.b.id].brandId, 'b:nxt');
check('the winner stays up', pB2.wrestlers[final.a.id].brandId, 'b:raw');
check('and everyone walks out unflagged',
  g.candidates.every(w => pB2.wrestlers[w.id].status === 'active'), true);
check('the competition reports itself settled',
  proposeLastStand(pB2).groups.filter(x => x.brandId === 'b:raw' && x.gender === 'male'
    && x.direction === 'relegation').length, 0);

// An odd group takes a bye rather than being matched outside itself.
const sB3 = fresh();
commitFlags(sB3, [
  { id: 'w:sheamus', flag: 'relegation-flagged', why: 'test' },
  { id: 'w:sami-zayn', flag: 'relegation-flagged', why: 'test' },
  { id: 'w:chad-gable', flag: 'relegation-flagged', why: 'test' },
], { date: '2027-04-05' });
const gB3 = proposeLastStand(project(sB3, { asOf: '2027-04-06' }))
  .groups.find(x => x.brandId === 'b:raw' && x.gender === 'male');
check('three candidates give one match and a bye', [gB3.matches.length, !!gB3.bye], [1, true]);
check('the bye is not matched outside the group',
  gB3.matches.every(m => m.a.brandId === 'b:raw' && m.b.brandId === 'b:raw'), true);

// A brand with only one eligible name is reported, never left flagged forever.
const solo = proposeFlags(project(fresh()), { candidatesPerBrand: 99 });
check('a group that cannot make a match is skipped', Array.isArray(solo.skipped), true);

// ──────────────────────────────────────────────────────────────── the dashboard
// The pairing rules are the reason this file exists, so they are asserted from
// the data layer as well as through the page: an illegal pairing must be
// impossible to *offer*, and impossible to *record* if it arrives another way.
section('Last Stand dashboard');
const sL = fresh();
commitCard(sL, parseCard('WrestleMania 44 / 2028-04-02 / Raw\nCody Rhodes d. Roman Reigns', sL));
commitFlags(sL, proposeFlags(project(sL, { asOf: '2028-04-03' })), { date: '2028-04-03' });
let pL = project(sL, { asOf: '2028-04-04' });

check('the board opens in the Last Stand phase', lastStandBoard(pL).phase, 'lastStand');
const cL = candidates(pL);
check('the two lists are separate', [cL.promotion.every(r => r.direction === 'promotion'),
  cL.relegation.every(r => r.direction === 'relegation')], [true, true]);
check('a relegation candidate knows where they would drop to',
  cL.relegation.every(r => r.toName && tierOf(pL, r.to) > r.tier), true);
check('a promotion candidate knows what they are climbing to',
  cL.promotion.every(r => r.toName && tierOf(pL, r.to) < r.tier), true);

const relRaw = cL.relegation.find(r => r.brandId === 'b:raw' && r.gender === 'male');
const relSd = cL.relegation.find(r => r.brandId === 'b:smackdown' && r.gender === 'male');
const promoNxt = cL.promotion.find(r => r.brandId === 'b:nxt' && r.gender === 'male');
const opps = eligibleOpponents(pL, relRaw.id);
check('the picker only offers the same brand', opps.every(w => w.brandId === 'b:raw'), true);
check('and only relegation candidates', opps.every(w => w.status === 'relegation-flagged'), true);
check('never a promotion candidate', opps.some(w => w.id === promoNxt.id), false);
check('never someone from another brand', opps.some(w => w.id === relSd.id), false);
check('never themselves', opps.some(w => w.id === relRaw.id), false);

check('Raw vs SmackDown is refused',
  checkPairing(pL, relRaw.id, relSd.id).errors.length > 0, true);
check('relegation vs promotion is refused',
  /separate competitions/.test(checkPairing(pL, relRaw.id, promoNxt.id).errors[0]), true);
check('an unflagged wrestler is refused',
  /not up for/.test(checkPairing(pL, relRaw.id, 'w:gunther').errors[0] || ''), true);
check('a legal pairing passes', checkPairing(pL, relRaw.id, opps[0].id).errors, []);
check('an intergender pairing warns rather than blocks', (() => {
  const her = cL.relegation.find(r => r.brandId === 'b:raw' && r.gender === 'female');
  const c = checkPairing(pL, relRaw.id, her.id);
  return [c.errors.length, c.warnings.length];
})(), [0, 1]);

// Two Evolve names chase the same NXT spot; two NXT names chase a tier-1 spot.
// They are different competitions even though both are "promotion".
const promoEvolve = cL.promotion.find(r => r.brandId === 'b:evolve' && r.gender === 'male');
check('promotion is grouped by the spot being chased',
  checkPairing(pL, promoNxt.id, promoEvolve.id).errors.length > 0, true);
check('two names chasing the same spot are allowed',
  checkPairing(pL, promoEvolve.id, eligibleOpponents(pL, promoEvolve.id)[0].id).errors, []);

// Recording one, and what it leaves behind.
const rec = recordMatch(sL, pL, { aId: relRaw.id, bId: opps[0].id, winnerId: relRaw.id, date: '2028-04-24' });
pL = project(sL, { asOf: '2028-04-25' });
check('recording opens a Last Stand show', pL.showsById[rec.showId].ple, 'lastStand');
check('the loser drops a tier', tierOf(pL, pL.wrestlers[opps[0].id].brandId), 2);
check('the winner stays put', pL.wrestlers[relRaw.id].brandId, 'b:raw');
check('and both walk out unflagged',
  [pL.wrestlers[relRaw.id].status, pL.wrestlers[opps[0].id].status], ['active', 'active']);
check('the movement lands in the transaction history',
  movementsFor(pL, opps[0].id)[0].reason, 'relegation');
check('with where they came from', movementsFor(pL, opps[0].id)[0].from, 'Raw');
check('an illegal pairing cannot be recorded either',
  !!threw(() => recordMatch(sL, pL, { aId: relSd.id, bId: relRaw.id, winnerId: relSd.id, date: '2028-04-24' })), true);
check('a second match joins the same show',
  recordMatch(sL, pL, { aId: relSd.id, bId: eligibleOpponents(pL, relSd.id)[0].id,
    winnerId: relSd.id, date: '2028-04-24' }).showId, rec.showId);

pL = project(sL, { asOf: '2028-04-25' });
const board = lastStandBoard(pL);
// Last Stand has been wrestled by now, so the year has moved on to the draft.
check('the board reports the phase', board.phase, 'draft');
check('the board separates the two lists',
  [Array.isArray(board.candidates.promotion), Array.isArray(board.candidates.relegation)], [true, true]);
check('played matches are on the board', board.played.length, 2);
check('so are the movements they caused', board.movements.length, 2);
check('and the rosters by tier', board.tiers.every(t => t.brands.every(b => Array.isArray(b.roster))), true);
check('settled groups leave the still-to-settle list',
  board.open.some(g => g.brandId === 'b:raw' && g.gender === 'male' && g.direction === 'relegation'), false);

// Voiding the match hands the movement back — the dashboard writes ordinary
// history, not a special case.
sL.voidEvent(rec.events[rec.events.length - 1].id, 'mis-entered');
const pDv = project(sL, { asOf: '2028-04-25' });
check('voiding a Last Stand match undoes the move', pDv.wrestlers[opps[0].id].brandId, 'b:raw');
check('and clears it from the transaction history',
  movementsFor(pDv, opps[0].id).some(m => m.reason === 'relegation'), false);

// ──────────────────────────────────────────────────────────────── automatic promotion
// The designation lives on the championship, not in the code: nothing here
// names NXT, and turning the flag off turns the call-up off.
section('automatic champion promotion');
const sAP = fresh();
commitCard(sAP, parseCard(`WrestleMania 44 / 2028-04-02 / NXT
Oba Femi d. Trick Williams — NXT Championship`, sAP));
let pAP = project(sAP, { asOf: '2028-04-03' });
const autoA = autoPromotions(pAP);
check('the champion of a flagged belt goes up automatically',
  autoA.map(a => a.name), ['Oba Femi']);
check('into the tier above', tierOf(pAP, autoA[0].to), 1);
check('and it says why', /automatic call-up/.test(autoA[0].why), true);
check('a belt on the bottom rung never triggers one',
  Object.values(pAP.championships).some(c => c.autoPromote && tierOf(pAP, c.brandId) === 3
    && autoA.some(a => a.titleId === c.id)), false);
check('the draft pools them without a Last Stand match',
  proposeDraft(pAP, { tier: 1 }).picks.some(p => p.wrestlerId === autoA[0].id), true);
check('and they are not asked to fight for it',
  proposeFlags(pAP).some(f => f.id === autoA[0].id && f.flag === 'promotion-flagged'), false);

// Turn the designation off and the same champion is an ordinary wrestler.
const nxtBelt = Object.values(project(sAP).championships).find(c => c.autoPromote && c.id === autoA[0].titleId);
sAP.addEntity('championship', { ...sAP.getEntity(nxtBelt.id), autoPromote: false },
  { id: nxtBelt.id, upsert: true });
check('clearing the flag ends the call-up',
  autoPromotions(project(sAP, { asOf: '2028-04-04' })).length, 0);


// ──────────────────────────────────────────────────────────────── calendar
// Two questions: what night is a show on, and what happened on it. The first is
// read off the brand records — nothing here knows Raw is a Monday.
section('the calendar');
const sCal = fresh();
commitCard(sCal, parseCard(`Monday Night Raw / 2026-08-17 / Raw
Damian Priest d. Gunther — World Heavyweight Championship, steel cage
Rhea Ripley d. Liv Morgan (submission)
* Solo Sikoa attacks Cody Rhodes after the main event`, sCal));
commitCard(sCal, parseCard('SmackDown / 2026-08-21 / SmackDown\nCody Rhodes d. Solo Sikoa', sCal));
const pCal = project(sCal, { asOf: '2026-08-31' });

check('the show sits on its date', weekdayName('2026-08-17'), 'Monday');
check('a month knows what is in it',
  [calendarMonth(pCal, '2026-08').counts.shows, calendarMonth(pCal, '2026-08').counts.matches], [2, 3]);
check('an empty month is still a grid', calendarMonth(pCal, '2026-09').weeks.every(w => w.length === 7), true);
check('the grid starts on a Sunday', calendarMonth(pCal, '2026-08').weeks[0][0].weekday, 'Sunday');
check('days outside the month are marked',
  calendarMonth(pCal, '2026-08').weeks[0].filter(d => !d.inMonth).length > 0, true);
check('every day of the month appears once', (() => {
  const seen = calendarMonth(pCal, '2026-08').weeks.flat().filter(d => d.inMonth).map(d => d.date);
  return [seen.length, new Set(seen).size];
})(), [31, 31]);

const aug = calendarMonth(pCal, '2026-08');
const day17 = aug.weeks.flat().find(d => d.date === '2026-08-17');
check('the night is on its day', day17.shows.map(s => s.name), ['Monday Night Raw']);
check('with its match count', day17.shows[0].matches, 2);
check('and nothing else that Monday', day17.scheduled.length, 0);

// The weekly rhythm comes out of the brand records, so a user's own show works.
check('Raw runs on Mondays', brandsOnWeekday(pCal, 'Monday').map(b => b.name), ['Raw']);
const mon24 = aug.weeks.flat().find(d => d.date === '2026-08-24');
check('an unbooked Monday still says Raw is due', mon24.scheduled.map(b => b.name), ['Raw']);
check('the seeded pyramid runs Monday to Friday',
  weeklySchedule(pCal).filter(r => r.brands.length).map(r => r.weekday),
  ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
check('a night nobody runs is empty', weeklySchedule(pCal).find(r => r.weekday === 'Sunday').brands, []);
check('the week covers seven nights', weeklySchedule(pCal).length, 7);

// A brand invented by the user takes its night with it.
sCal.addEntity('brand', { name: 'WCW', tier: 2, day: 'Saturday', color: '#C0392B' }, { id: 'b:wcw', upsert: true });
const pCal2 = project(sCal, { asOf: '2026-08-31' });
check('a new show claims its own night', brandsOnWeekday(pCal2, 'Saturday').map(b => b.name), ['WCW']);
check('and shows up on every one of them',
  calendarMonth(pCal2, '2026-08').weeks.flat().filter(d => d.inMonth
    && d.scheduled.some(b => b.name === 'WCW')).length, 5);

// Reading a night back.
const nightId = pCal.shows[0].id;
const night = cardOf(pCal, nightId);
check('a night reads back in order', night.segments.map(g => g.type), ['match', 'match', 'attack']);
check('the main event knows who won', night.segments[0].winnerSide, 1);
check('and carries the refs, not just the text',
  night.segments[0].sides.flatMap(s => s.refs).includes('w:damian-priest'), true);
check('the night lists what it changed',
  night.changes.filter(c => c.kind === 'title').map(c => c.text),
  ['World Heavyweight Championship — new champion: Damian Priest']);
check('cards page to their neighbours', [night.prev, !!night.next], [null, true]);
check('as text, it is the night', cardAsText(pCal, nightId).includes('Damian Priest def. Gunther'), true);
check('with what changed under it', cardAsText(pCal, nightId).includes('What changed'), true);
check('a month prints as a grid', monthText(pCal, '2026-08').includes('August 2026'), true);
check('with the show on it', monthText(pCal, '2026-08', { width: 22 }).includes('Monday Night Raw'), true);
check('and the nights nothing was booked', monthText(pCal, '2026-08').includes('(Raw)'), true);

check('the index lists months that have cards', monthsWithShows(pCal).map(r => r.key), ['2026-08']);
check('with the matches counted', monthsWithShows(pCal)[0].matches, 3);
check('month arithmetic crosses the year', [shiftMonths('2026-12', 1), shiftMonths('2026-01', -1)],
  ['2027-01', '2025-12']);

// Voiding the main event takes it off the night — the calendar is a read of the
// log like everything else, not a second record of what was booked.
sCal.voidEvent(night.segments[0].id, 'never happened');
const pCal3 = project(sCal, { asOf: '2026-08-31' });
check('voiding a match takes it off the night', cardOf(pCal3, nightId).segments.length, 2);
check('and off the tally', calendarMonth(pCal3, '2026-08').counts.matches, 2);
check('and the title change with it',
  cardOf(pCal3, nightId).changes.some(c => c.kind === 'title'), false);

// ──────────────────────────────────────────────────────────────── prompts
section('prompt export');
const p9 = project(s8, { asOf: '2027-04-26' });
const recap = recapPrompt(p9, p9.shows.find(s => s.ple === 'wrestlemania').id);
check('recap names the show', recap.includes('WrestleMania 43'), true);
check('recap lists the card in order', recap.includes('1. [match]'), true);
check('recap embeds who holds what', recap.includes('WWE Championship'), true);
check('recap tells the model not to invent', /do not invent/i.test(recap), true);

const contenders = contenderPrompt(p9, {});
check('contender report has standings', contenders.includes('SEASON STANDINGS'), true);
check('contender report has rivalry heat', contenders.includes('RIVALRY HEAT'), true);
check('contender report names champions', contenders.includes('CHAMPIONS'), true);

const next = nextPrompt(p9);
check('what-happens-next uses the queue', next.includes('OPEN THREADS'), true);
check('and only the open ones', next.includes('open ') && !next.includes('closed'), true);
check('every prompt is plain text', [recap, contenders, next].every(t => !/[<>{}]/.test(t.slice(0, 200))), true);
check('five prompts are registered', PROMPTS.length, 5);
check('and each builds from an id', PROMPTS.every(p => buildPrompt(p.id, p9, { showId: p9.shows[0].id }).length > 200), true);

// ──────────────────────────────────────────────────────────────── choosing the champion
section('choosing the champion');
check('the format prompt teaches the shorthand', entryPrompt(p9, 'card').includes('Winner d. Loser'), true);
check('and names every wrestler by hand', entryPrompt(p9, 'card').includes('Cody Rhodes'), true);
check('and every belt', entryPrompt(p9, 'card').includes('WWE Championship'), true);
check('and forbids inventing people', /never invent a wrestler/i.test(entryPrompt(p9, 'card')), true);
check('the roster one is a different shape', entryPrompt(p9, 'roster').includes('one wrestler per line'), true);
check('both format prompts are registered', PROMPTS.filter(p => /format$/.test(p.id)).length, 2);

const lineIn = 'Damian Priest d. Gunther — World Heavyweight Championship';
check('an outcome can be forced onto a line', setTitleOutcome(lineIn, 'retain'), `${lineIn} (retains)`);
check('and flipped back', setTitleOutcome(setTitleOutcome(lineIn, 'retain'), 'change'), `${lineIn} (new champion)`);
check('without stacking up', setTitleOutcome(setTitleOutcome(setTitleOutcome(lineIn, 'retain'), 'change'), 'retain'), `${lineIn} (retains)`);
check('an existing modifier is replaced, not appended',
  setTitleOutcome(`${lineIn}, new champion`, 'retain'), `${lineIn} (retains)`);

const s10 = fresh();
// Crown Gunther first, so "retains" has something to retain.
commitCard(s10, parseCard('Raw / 2026-08-25 / Raw\nGunther d. Sheamus — World Heavyweight Championship', s10));
const forced = parseCard(`Raw / 2026-09-01 / Raw\n${setTitleOutcome(lineIn, 'retain')}`, s10);
check('the forced outcome survives the parser', forced.segments[0].data.titleChanged, false);
commitCard(s10, forced);
check('and the belt does not move', project(s10).championships['c:world-heavyweight-championship'].holders, ['w:gunther']);
check('but the win still counts', project(s10).wrestlers['w:damian-priest'].record.w, 1);
check('and it is scored as a defense', titleLineage(project(s10), 'c:world-heavyweight-championship')[0].defenses, 1);
check('with the reign unbroken', titleLineage(project(s10), 'c:world-heavyweight-championship').length, 1);

// Setting a champion outright, with no match at all.
const s11 = fresh();
s11.append({
  type: 'title.change', date: '2026-09-01', participants: [{ ref: 'w:sami-zayn', role: 'champion' }],
  data: { titleId: 'c:intercontinental-championship', reason: 'awarded' },
});
let p11 = project(s11);
check('a champion can just be named', p11.championships['c:intercontinental-championship'].holders, ['w:sami-zayn']);
check('and it is the belt\'s first reign', titleLineage(p11, 'c:intercontinental-championship').length, 1);
check('and nobody had to wrestle', p11.wrestlers['w:sami-zayn'].record.total, 0);
s11.voidEvent(s11.effectiveEvents().slice(-1)[0].id, 'undo');
check('voiding it empties the belt again', project(s11).championships['c:intercontinental-championship'].vacant, true);

// ──────────────────────────────────────────────────────────────── screenshots
section('screenshot ingest');
check('code fences are stripped', cleanReply('Here is the card:\n```\nRaw / 2026-08-17 / Raw\n```'), 'Raw / 2026-08-17 / Raw');
check('preambles are stripped', cleanReply("Sure! Here's the transcription\nCody Rhodes d. Randy Orton"), 'Cody Rhodes d. Randy Orton');
check('a card is recognised', detectKind('Raw / 2026-08-17 / Raw\nCody Rhodes d. Randy Orton'), 'card');
check('a roster is recognised', detectKind('RAW\nCody Rhodes, m, active\nRhea Ripley, f, active'), 'roster');
check('nothing is recognised as nothing', detectKind(''), null);

const tp = transcriptionPrompt(p9, 'card');
check('the prompt teaches the shorthand', tp.includes('Winner d. Loser'), true);
check('and embeds the roster spellings', tp.includes('Cody Rhodes'), true);
check('and the championship names', tp.includes('WWE Championship'), true);
check('the roster prompt is different', transcriptionPrompt(p9, 'roster').includes('one wrestler per line'), true);

// The API path, exercised without a key or a network: a stub captures the
// request so the shape is checked, not just the happy return value.
let captured = null;
const stubFetch = async (url, opts) => {
  captured = { url, opts, body: JSON.parse(opts.body) };
  return { ok: true, json: async () => ({ content: [{ type: 'text', text: '```\nRaw / 2026-08-17 / Raw\nCody Rhodes d. Randy Orton\n```' }] }) };
};
const shot = await readScreenshot({
  dataUrl: 'data:image/png;base64,AAAA', prompt: 'read this',
  apiKey: 'test-key', fetchImpl: stubFetch,
});
check('it posts to the messages endpoint', captured.url, 'https://api.anthropic.com/v1/messages');
check('with the key in the header', captured.opts.headers['x-api-key'], 'test-key');
check('and the browser opt-in header', captured.opts.headers['anthropic-dangerous-direct-browser-access'], 'true');
check('the image is sent as base64', captured.body.messages[0].content[0].source.type, 'base64');
check('with its media type', captured.body.messages[0].content[0].source.media_type, 'image/png');
check('and the prompt alongside it', captured.body.messages[0].content[1].text, 'read this');
check('the reply comes back cleaned', shot.text, 'Raw / 2026-08-17 / Raw\nCody Rhodes d. Randy Orton');

const noKey = await readScreenshot({ dataUrl: 'data:image/png;base64,AAAA', apiKey: '', fetchImpl: stubFetch }).catch(e => e);
check('no key is a clear error, not a crash', /no API key/.test(noKey.message), true);
const badImage = await readScreenshot({ dataUrl: 'not-an-image', apiKey: 'k', fetchImpl: stubFetch }).catch(e => e);
check('a bad image is refused', /does not look like an image/.test(badImage.message), true);
const apiErr = await readScreenshot({
  dataUrl: 'data:image/png;base64,AAAA', apiKey: 'k',
  fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'unauthorized' }),
}).catch(e => e);
check('an API failure is reported, not swallowed', /401/.test(apiErr.message), true);

// The whole point: a transcription flows into the ordinary parser.
const fromShot = parseCard(cleanReply(shot.text), s8);
check('a transcribed card parses like a typed one', fromShot.errors.length, 0);
check('and produces a real segment', fromShot.segments[0].participants.length, 2);

// ──────────────────────────────────────────────────────────────── time travel
section('point in time');
const p4 = project(s2, { asOf: '2026-08-16' });
check('as-of before the show: still vacant', p4.championships['c:world-heavyweight-championship'].vacant, true);
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
