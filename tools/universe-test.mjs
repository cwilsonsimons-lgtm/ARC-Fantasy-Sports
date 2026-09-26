// Unit tests for the WWE Universe data layer (js/universe/model.js, persist.js).
//
// Usage: node --test tools/universe-test.mjs      (or: npm run test:universe)
//
// No browser needed - the model is pure and persistence takes its storage as an
// argument. Every test that changes the universe ends by asserting validate()
// finds nothing, so a mutation that leaves the data inconsistent fails here
// even when its own return value looks right.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/universe/model.js';
import { STORAGE_KEY, loadUniverse, saveUniverse, exportUniverse, importUniverse } from '../js/universe/persist.js';
import { createCloud } from '../js/universe/cloud.js';
import * as SD from '../js/universe/standings.js';

const sound = st => assert.deepEqual(M.validate(st), []);
const throwsUE = (fn, re) => assert.throws(fn, e => e instanceof M.UniverseError && (!re || re.test(e.message)));
const frozen = st => JSON.stringify(st);

/** A Storage stand-in: the same getItem/setItem surface, plus a switch to make writes fail. */
function memoryStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    full: false,
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem(k, v) { if (this.full) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    keys: () => [...m.keys()],
  };
}

// ---------------------------------------------------------------- seed

test('a new universe has the four shows and an active Season 1', () => {
  const st = M.createUniverse();
  assert.deepEqual(st.shows.map(s => s.name), ['Raw', 'SmackDown', 'Dynamite', 'NXT']);
  assert.deepEqual(st.shows.map(s => s.promotion), ['WWE', 'WWE', 'AEW', 'WWE']);
  const s = M.activeSeason(st);
  assert.equal(s.number, 1);
  assert.equal(s.week, 1);
  assert.equal(st.wrestlers.length, 0);
  sound(st);
});

// ---------------------------------------------------------------- wrestlers + rosters

test('rosters can be any size - nothing forces the shows to match', () => {
  const st = M.createUniverse();
  const sizes = { raw: 7, smackdown: 3, dynamite: 11, nxt: 0 };
  for (const [show, n] of Object.entries(sizes)) {
    for (let i = 0; i < n; i++) M.addWrestler(st, { name: `${show} ${i}`, showId: show });
  }
  M.addWrestler(st, { name: 'Free Agent' });
  assert.deepEqual(M.rosterCounts(st), { '': 1, raw: 7, smackdown: 3, dynamite: 11, nxt: 0 });
  assert.equal(M.rosterOf(st, 'dynamite').length, 11);
  assert.equal(M.rosterOf(st, null)[0].name, 'Free Agent');
  sound(st);
});

test('wrestlers from WWE, AEW and NXT can all be on any show', () => {
  const st = M.createUniverse();
  const a = M.addWrestler(st, { name: 'AEW Star', origin: 'AEW', showId: 'raw' });
  const b = M.addWrestler(st, { name: 'NXT Star', origin: 'NXT', showId: 'dynamite', gender: 'female' });
  const c = M.addWrestler(st, { name: 'WWE Star', origin: 'WWE', showId: 'nxt', alignment: 'heel' });
  assert.equal(a.showId, 'raw');
  assert.equal(b.showId, 'dynamite');
  assert.equal(c.alignment, 'heel');
  sound(st);
});

test('wrestler names are required and unique, ignoring case and spacing', () => {
  const st = M.createUniverse();
  M.addWrestler(st, { name: 'Rhea Ripley', gender: 'female' });
  throwsUE(() => M.addWrestler(st, { name: '  rhea   RIPLEY ' }), /already a wrestler called Rhea Ripley/);
  throwsUE(() => M.addWrestler(st, { name: '   ' }), /name/);
  throwsUE(() => M.addWrestler(st, { name: 'x'.repeat(61) }), /too long/);
  throwsUE(() => M.addWrestler(st, { name: 'A', gender: 'robot' }), /gender/);
  throwsUE(() => M.addWrestler(st, { name: 'B', showId: 'impact' }), /Unknown show/);
  assert.equal(st.wrestlers.length, 1);
  sound(st);
});

test('a failed call leaves the universe exactly as it was', () => {
  const st = M.createUniverse();
  M.addWrestler(st, { name: 'Taken' });
  const before = frozen(st);
  throwsUE(() => M.addWrestler(st, { name: 'Taken', showId: 'raw' }));
  throwsUE(() => M.addTeam(st, { name: 'Solo', members: [st.wrestlers[0].id] }));
  throwsUE(() => M.addTitle(st, { name: 'Belt', kind: 'trios' }));
  throwsUE(() => M.addEvent(st, { kind: 'weekly' }));
  assert.equal(frozen(st), before);
});

test('bulk add skips duplicates and blanks, and reports them', () => {
  const st = M.createUniverse();
  M.addWrestler(st, { name: 'CM Punk' });
  const r = M.addWrestlers(st, ['Kenny Omega', '', 'cm punk', 'Will Ospreay', 'Kenny Omega'],
    { origin: 'AEW', showId: 'dynamite' });
  assert.deepEqual(r.added.map(w => w.name), ['Kenny Omega', 'Will Ospreay']);
  assert.deepEqual(r.skipped.map(s => s.name), ['cm punk', 'Kenny Omega']);
  assert.ok(r.added.every(w => w.origin === 'AEW' && w.showId === 'dynamite'));
  throwsUE(() => M.addWrestlers(st, ['Z'], { showId: 'nope' }), /Unknown show/);
  throwsUE(() => M.addWrestlers(st, ['Z'], { gender: 'x' }), /gender/);
  sound(st);
});

test('a wrestler called "x" does not break bulk add', () => {
  const st = M.createUniverse();
  M.addWrestler(st, { name: 'x' });
  assert.equal(M.addWrestlers(st, ['Y'], {}).added.length, 1);
});

test('every change of show is kept as roster history', () => {
  const st = M.createUniverse();
  const w = M.addWrestler(st, { name: 'Drew McIntyre', showId: 'raw' });
  M.advanceWeek(st);
  M.assignWrestler(st, w.id, 'smackdown', 'traded');
  assert.equal(M.assignWrestler(st, w.id, 'smackdown'), null, 'no-op when already there');
  M.assignWrestler(st, w.id, '');
  const moves = M.movesOf(st, w.id);
  assert.deepEqual(moves.map(m => [m.from, m.to, m.at.week]),
    [[null, 'raw', 1], ['raw', 'smackdown', 2], ['smackdown', null, 2]]);
  assert.equal(moves[1].note, 'traded');
  assert.equal(w.showId, null);
  throwsUE(() => M.updateWrestler(st, w.id, { showId: 'raw' }), /assignWrestler/);
  sound(st);
});

test('editing a wrestler changes only what is given', () => {
  const st = M.createUniverse();
  const w = M.addWrestler(st, { name: 'Seth Rollins', alignment: 'face', showId: 'raw' });
  M.updateWrestler(st, w.id, { alignment: 'heel', status: 'injured', notes: 'Knee' });
  assert.deepEqual([w.name, w.alignment, w.status, w.notes, w.showId], ['Seth Rollins', 'heel', 'injured', 'Knee', 'raw']);
  M.updateWrestler(st, w.id, { alignment: '' });
  assert.equal(w.alignment, null);
  M.updateWrestler(st, w.id, { name: 'seth rollins' });   // same wrestler, new casing - not a clash
  assert.equal(w.name, 'seth rollins');
  sound(st);
});

test('only a wrestler with no history can be deleted', () => {
  const st = M.createUniverse();
  const a = M.addWrestler(st, { name: 'Oops', showId: 'raw' });
  M.deleteWrestler(st, a.id);
  assert.equal(st.wrestlers.length, 0);
  assert.equal(st.moves.length, 0, 'their roster moves go with them');

  const b = M.addWrestler(st, { name: 'B' });
  const c = M.addWrestler(st, { name: 'C' });
  const ev = M.addEvent(st, { showId: 'raw' });
  M.recordMatch(st, ev.id, { sides: [{ wrestlers: [b.id] }, { wrestlers: [c.id] }], winner: 0 });
  throwsUE(() => M.deleteWrestler(st, b.id), /history \(a match\)/);
  sound(st);
});

// ---------------------------------------------------------------- tag teams

test('tag teams need two or more distinct, real wrestlers', () => {
  const st = M.createUniverse();
  const [a, b, c] = ['A', 'B', 'C'].map(n => M.addWrestler(st, { name: n }));
  throwsUE(() => M.addTeam(st, { name: 'T', members: [a.id] }), /at least two/);
  throwsUE(() => M.addTeam(st, { name: 'T', members: [a.id, a.id] }), /once/);
  throwsUE(() => M.addTeam(st, { name: 'T', members: [a.id, 'w999'] }), /No wrestler/);
  const t = M.addTeam(st, { name: 'Trio', members: [a.id, b.id, c.id] });
  const u = M.addTeam(st, { name: 'Pair', members: [a.id, b.id] });   // a wrestler may be on two teams
  throwsUE(() => M.addTeam(st, { name: 'trio', members: [b.id, c.id] }), /already a tag team/);
  assert.deepEqual(M.teamsOf(st, a.id).map(x => x.id), [t.id, u.id]);
  // line-ups change through dated joins and departures, never by overwriting
  throwsUE(() => M.updateTeam(st, u.id, { members: [a.id, c.id] }), /addTeamMember/);
  M.addTeamMember(st, u.id, c.id);
  M.removeTeamMember(st, u.id, b.id);
  assert.deepEqual(u.members, [a.id, c.id]);
  sound(st);
});

test('a team split across shows is allowed and reported', () => {
  const st = M.createUniverse();
  const a = M.addWrestler(st, { name: 'A', showId: 'raw' });
  const b = M.addWrestler(st, { name: 'B', showId: 'nxt' });
  const t = M.addTeam(st, { name: 'Split', members: [a.id, b.id] });
  assert.deepEqual(M.teamShows(st, t).sort(), ['nxt', 'raw']);
  sound(st);
});

test('disbanding and reuniting a team', () => {
  const st = M.createUniverse();
  const [a, b] = ['A', 'B'].map(n => M.addWrestler(st, { name: n }));
  const t = M.addTeam(st, { name: 'T', members: [a.id, b.id] });
  M.setTeamActive(st, t.id, false);
  assert.equal(t.active, false);
  M.setTeamActive(st, t.id, true);
  assert.equal(t.active, true);
  assert.deepEqual(t.log.map(e => e.type), ['formed', 'disbanded', 'reunited'], 'both kept in the history');
  M.deleteTeam(st, t.id);
  assert.equal(st.teams.length, 0);
  assert.equal(st.memberships.length, 0, 'its line-up history goes with it');
  sound(st);
});

// ---------------------------------------------------------------- championships

function titleWorld() {
  const st = M.createUniverse();
  const [a, b, c, d] = ['Gunther', 'Jey Uso', 'Dawn', 'Dusk'].map(n => M.addWrestler(st, { name: n, showId: 'raw' }));
  const team = M.addTeam(st, { name: 'Day Break', members: [c.id, d.id] });
  const whc = M.addTitle(st, { name: 'World Heavyweight Championship', showId: 'raw', division: 'men' });
  const tag = M.addTitle(st, { name: 'World Tag Team Championship', showId: 'raw', kind: 'tag' });
  return { st, a, b, c, d, team, whc, tag };
}

test('crowning, changing and vacating a title keeps one champion at a time', () => {
  const { st, a, b, whc } = titleWorld();
  M.setChampion(st, whc.id, { type: 'wrestler', id: a.id });
  M.advanceWeek(st);
  M.setChampion(st, whc.id, { type: 'wrestler', id: b.id });
  let reigns = M.titleReigns(st, whc.id);
  assert.equal(reigns.length, 2);
  assert.equal(reigns[0].end.seq, reigns[1].start.seq, 'the old reign ends as the new one starts');
  assert.equal(M.currentReign(st, whc.id).holder.id, b.id);
  throwsUE(() => M.setChampion(st, whc.id, { type: 'wrestler', id: b.id }), /already holds/);
  M.vacateTitle(st, whc.id);
  assert.equal(M.currentReign(st, whc.id), null);
  throwsUE(() => M.vacateTitle(st, whc.id), /already vacant/);
  assert.equal(M.titlesHeldBy(st, { type: 'wrestler', id: b.id }).length, 0);
  sound(st);
});

test('singles titles take a wrestler, tag titles take a team', () => {
  const { st, a, team, whc, tag } = titleWorld();
  throwsUE(() => M.setChampion(st, whc.id, { type: 'team', id: team.id }), /singles title/);
  throwsUE(() => M.setChampion(st, tag.id, { type: 'wrestler', id: a.id }), /tag title/);
  M.setChampion(st, tag.id, { type: 'team', id: team.id });
  assert.deepEqual(M.titlesOfWrestler(st, team.members[0]).map(x => [x.title.id, x.team.id]), [[tag.id, team.id]]);
  throwsUE(() => M.setTeamActive(st, team.id, false), /hold the World Tag Team Championship/);
  throwsUE(() => M.updateTitle(st, tag.id, { kind: 'singles' }), /history/);
  sound(st);
});

test('undo walks a title back one change at a time', () => {
  const { st, a, b, whc } = titleWorld();
  M.setChampion(st, whc.id, { type: 'wrestler', id: a.id });
  M.setChampion(st, whc.id, { type: 'wrestler', id: b.id });
  M.vacateTitle(st, whc.id);
  M.undoTitleChange(st, whc.id);                        // un-vacate: b is champion again
  assert.equal(M.currentReign(st, whc.id).holder.id, b.id);
  M.undoTitleChange(st, whc.id);                        // remove b's reign: a is champion again
  assert.equal(M.currentReign(st, whc.id).holder.id, a.id);
  M.undoTitleChange(st, whc.id);                        // remove a's reign: vacant, no history
  assert.equal(M.titleReigns(st, whc.id).length, 0);
  throwsUE(() => M.undoTitleChange(st, whc.id), /no history/);
  sound(st);
});

test('retiring and deleting titles protects their history', () => {
  const { st, a, whc } = titleWorld();
  const spare = M.addTitle(st, { name: 'Spare Belt' });
  M.deleteTitle(st, spare.id);
  M.setChampion(st, whc.id, { type: 'wrestler', id: a.id });
  throwsUE(() => M.updateTitle(st, whc.id, { active: false }), /Vacate/);
  M.vacateTitle(st, whc.id);
  M.updateTitle(st, whc.id, { active: false, showId: null });
  throwsUE(() => M.setChampion(st, whc.id, { type: 'wrestler', id: a.id }), /retired/);
  throwsUE(() => M.deleteTitle(st, whc.id), /Retire it instead/);
  throwsUE(() => M.deleteWrestler(st, a.id), /a title reign/);
  sound(st);
});

// ---------------------------------------------------------------- seasons

test('there is always exactly one active season', () => {
  const st = M.createUniverse();
  M.advanceWeek(st); M.advanceWeek(st);
  assert.equal(M.activeSeason(st).week, 3);
  M.setWeek(st, 2);
  throwsUE(() => M.setWeek(st, 0), /Week/);
  throwsUE(() => M.setWeek(st, 1.5), /Week/);
  const s2 = M.startNextSeason(st, 'Road to WrestleMania');
  assert.equal(s2.number, 2);
  assert.equal(s2.name, 'Road to WrestleMania');
  assert.equal(s2.week, 1);
  assert.equal(st.seasons[0].status, 'complete');
  assert.equal(st.seasons[0].ended.week, 2);
  assert.equal(st.seasons.filter(s => s.status === 'active').length, 1);
  M.renameSeason(st, st.seasons[0].id, '');
  assert.equal(st.seasons[0].name, 'Season 1');
  sound(st);
});

test('a title reign carries across seasons', () => {
  const { st, a, whc } = titleWorld();
  M.setChampion(st, whc.id, { type: 'wrestler', id: a.id });
  M.startNextSeason(st);
  assert.equal(M.currentReign(st, whc.id).holder.id, a.id);
  sound(st);
});

// ---------------------------------------------------------------- events + results

test('events: weekly episodes need a show, PLEs need a name', () => {
  const st = M.createUniverse();
  M.setWeek(st, 4);
  const raw = M.addEvent(st, { showId: 'raw' });
  assert.equal(raw.name, 'Raw · Week 4');
  assert.equal(raw.at.week, 4);
  const back = M.addEvent(st, { showId: 'nxt', week: 2 });   // backfilling an earlier week
  assert.equal(back.at.week, 2);
  throwsUE(() => M.addEvent(st, { kind: 'weekly' }), /which show/);
  throwsUE(() => M.addEvent(st, { kind: 'ple' }), /name/);
  const ple = M.addEvent(st, { kind: 'ple', name: 'WrestleMania' });   // no show: every brand
  assert.equal(ple.showId, null);
  assert.deepEqual(M.eventsIn(st, M.activeSeason(st).id).map(e => e.name), ['NXT · Week 2', 'Raw · Week 4', 'WrestleMania']);
  M.updateEvent(st, raw.id, { name: 'Raw after Mania', week: 5 });
  assert.equal(raw.at.week, 5);
  sound(st);
});

test('recording results: sides, winners, draws and no contests', () => {
  const { st, a, b, c, d, team } = titleWorld();
  const ev = M.addEvent(st, { showId: 'raw' });
  const m1 = M.recordMatch(st, ev.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [b.id] }], winner: 1, finish: 'pinfall' });
  assert.equal(M.resultFor(m1, 1), 'W');
  assert.equal(M.resultFor(m1, 0), 'L');
  const m2 = M.recordMatch(st, ev.id, { sides: [{ wrestlers: [c.id, d.id], team: team.id }, { wrestlers: [a.id, b.id] }], outcome: 'draw' });
  assert.equal(m2.winner, null);
  assert.equal(M.resultFor(m2, 0), 'D');
  const m3 = M.recordMatch(st, ev.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [b.id] }, { wrestlers: [c.id] }], outcome: 'nc' });
  assert.equal(M.resultFor(m3, 2), 'NC');
  assert.equal(M.matchesOf(st, a.id).length, 3);

  throwsUE(() => M.recordMatch(st, ev.id, { sides: [{ wrestlers: [a.id] }], winner: 0 }), /two sides/);
  throwsUE(() => M.recordMatch(st, ev.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [] }], winner: 0 }), /nobody/);
  throwsUE(() => M.recordMatch(st, ev.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [a.id] }], winner: 0 }), /twice/);
  throwsUE(() => M.recordMatch(st, ev.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [b.id] }] }), /who won/);
  throwsUE(() => M.recordMatch(st, ev.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [b.id] }], winner: 2 }), /who won/);
  throwsUE(() => M.recordMatch(st, ev.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [b.id] }], winner: 0, finish: 'roll-up' }), /finish/);
  assert.equal(ev.matches.length, 3);
  sound(st);
});

test('a title changes hands only when the result says so, dated to the event', () => {
  const { st, a, b, c, d, team, whc, tag } = titleWorld();
  M.setChampion(st, whc.id, { type: 'wrestler', id: a.id });
  M.setWeek(st, 6);
  const ev = M.addEvent(st, { showId: 'raw', week: 3 });

  // champion retains: a title match with no change
  M.recordMatch(st, ev.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [b.id] }], winner: 0, titleId: whc.id });
  assert.equal(M.currentReign(st, whc.id).holder.id, a.id);

  const before = frozen(st);
  throwsUE(() => M.recordMatch(st, ev.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [b.id] }], winner: 0, titleId: whc.id }, { titleChange: true }), /already holds/);
  throwsUE(() => M.recordMatch(st, ev.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [b.id] }], outcome: 'draw', titleId: whc.id }, { titleChange: true }), /changes hands/);
  throwsUE(() => M.recordMatch(st, ev.id, { sides: [{ wrestlers: [c.id, d.id] }, { wrestlers: [a.id, b.id] }], winner: 0, titleId: tag.id }, { titleChange: true }), /pick the tag team/);
  assert.equal(frozen(st), before, 'rejected results leave nothing behind');

  const m = M.recordMatch(st, ev.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [b.id] }], winner: 1, titleId: whc.id }, { titleChange: true });
  const r = M.currentReign(st, whc.id);
  assert.deepEqual([r.holder.id, r.eventId, r.matchId, r.start.week], [b.id, ev.id, m.id, 3]);

  const t = M.recordMatch(st, ev.id, { sides: [{ wrestlers: [c.id, d.id], team: team.id }, { wrestlers: [a.id, b.id] }], winner: 0, titleId: tag.id }, { titleChange: true });
  assert.equal(M.currentReign(st, tag.id).holder.id, team.id);

  // a later change pins this one in place: deleting it would leave the next
  // champion winning the belt from someone who never held it
  M.vacateTitle(st, whc.id);
  const pinned = frozen(st);
  throwsUE(() => M.deleteMatch(st, ev.id, m.id), /vacated since this match/);
  throwsUE(() => M.deleteEvent(st, ev.id), /vacated since Raw · Week 3/);
  assert.equal(frozen(st), pinned);
  M.undoTitleChange(st, whc.id);
  // with nothing after it, deleting the result hands the belt back
  M.deleteMatch(st, ev.id, t.id);
  assert.equal(M.currentReign(st, tag.id), null, 'the tag title is vacant again');
  M.deleteEvent(st, ev.id);
  assert.equal(M.currentReign(st, whc.id).holder.id, a.id, 'deleting the event gives the belt back');
  assert.equal(st.events.length, 0);
  sound(st);
});

test('title changes must follow the calendar - a backfill can’t crown the wrong champion', () => {
  const { st, a, b, whc } = titleWorld();
  M.setWeek(st, 5);
  const late = M.addEvent(st, { showId: 'raw' });                   // week 5
  M.recordMatch(st, late.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [b.id] }], winner: 0, titleId: whc.id }, { titleChange: true });
  const early = M.addEvent(st, { showId: 'raw', week: 3 });         // entered later, dated earlier
  let before = frozen(st);
  throwsUE(() => M.recordMatch(st, early.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [b.id] }], winner: 1, titleId: whc.id },
    { titleChange: true }), /began in season 1, week 5 \(Monday\), later than season 1, week 3 \(Monday\)/);
  throwsUE(() => M.setChampion(st, whc.id, { type: 'wrestler', id: b.id }, { eventId: early.id }), /in order/);
  assert.equal(frozen(st), before, 'nothing half-recorded');
  M.setWeek(st, 2);                                                  // clock wound back past the reign
  before = frozen(st);
  throwsUE(() => M.vacateTitle(st, whc.id), /in order/);
  throwsUE(() => M.setChampion(st, whc.id, { type: 'wrestler', id: b.id }), /in order/);
  assert.equal(frozen(st), before, 'nothing half-recorded');
  // the same week is fine: a title can change hands twice in one night
  M.setWeek(st, 5);
  M.recordMatch(st, late.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [b.id] }], winner: 1, titleId: whc.id }, { titleChange: true });
  assert.equal(M.currentReign(st, whc.id).holder.id, b.id);
  sound(st);
});

// ---------------------------------------------------------------- history

test('history follows the calendar, not the order things were typed in', () => {
  const st = M.createUniverse();
  const a = M.addWrestler(st, { name: 'A', showId: 'raw' });
  const b = M.addWrestler(st, { name: 'B', showId: 'raw' });
  M.setWeek(st, 5);
  const w5 = M.addEvent(st, { showId: 'raw' });
  const w3 = M.addEvent(st, { showId: 'raw', week: 3 });            // backfilled after week 5
  M.recordMatch(st, w5.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [b.id] }], winner: 0 });
  M.recordMatch(st, w3.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [b.id] }], winner: 1 });
  M.startNextSeason(st);
  const s2 = M.addEvent(st, { showId: 'raw' });                     // season 2, week 1
  M.recordMatch(st, s2.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [b.id] }], outcome: 'draw' });

  // season 2 week 1 is newer than season 1 week 5, even though 1 < 5
  assert.deepEqual(M.matchesOf(st, a.id).map(x => x.event.id), [s2.id, w5.id, w3.id]);
  const events = M.timeline(st).filter(e => e.type === 'event').map(e => e.rec.id);
  assert.deepEqual(events, [s2.id, w5.id, w3.id]);
  sound(st);
});

test('an episode named for its week keeps up when it moves; a chosen name stays', () => {
  const st = M.createUniverse();
  const ev = M.addEvent(st, { showId: 'raw', week: 3 });
  M.updateEvent(st, ev.id, { week: 4 });
  assert.equal(ev.name, 'Raw · Week 4');
  M.updateEvent(st, ev.id, { showId: 'smackdown' });
  assert.equal(ev.name, 'SmackDown · Week 4');
  M.updateEvent(st, ev.id, { name: 'Go-Home Show' });
  M.updateEvent(st, ev.id, { week: 5 });
  assert.equal(ev.name, 'Go-Home Show');
  const ple = M.addEvent(st, { kind: 'ple', name: 'Clash', week: 3 });
  M.updateEvent(st, ple.id, { week: 6 });
  assert.equal(ple.name, 'Clash');
  sound(st);
});

test('the timeline puts everything in the order it happened', () => {
  const { st, a, b, whc } = titleWorld();
  M.setChampion(st, whc.id, { type: 'wrestler', id: a.id });
  M.advanceWeek(st);
  M.assignWrestler(st, b.id, 'smackdown');
  const ev = M.addEvent(st, { showId: 'smackdown' });
  M.vacateTitle(st, whc.id);
  M.startNextSeason(st);
  const types = M.timeline(st).map(e => e.type);
  assert.deepEqual(types.slice(0, 6), ['season-start', 'season-end', 'title-vacated', 'event', 'move', 'title-won']);
  assert.equal(types[types.length - 1], 'season-start');
  const seqs = M.timeline(st).map(e => e.seq);
  assert.deepEqual(seqs, [...seqs].sort((x, y) => y - x));
  assert.equal(M.timeline(st).find(e => e.type === 'event').rec, ev);
  assert.deepEqual(M.summary(st), { wrestlers: 4, teams: 1, titles: 2, events: 1, matches: 0, booked: 0, seasons: 2 });
});

// ---------------------------------------------------------------- persistence

test('save and load round-trip the whole universe', () => {
  const { st, a, whc } = titleWorld();
  M.setChampion(st, whc.id, { type: 'wrestler', id: a.id });
  const storage = memoryStorage();
  assert.equal(saveUniverse(storage, st), true);
  const got = loadUniverse(storage);
  assert.equal(got.status, 'loaded');
  assert.deepEqual(got.problems, []);
  assert.deepEqual(got.state, JSON.parse(JSON.stringify(st)));
});

test('a first run starts fresh; a full disk reports failure', () => {
  const storage = memoryStorage();
  const got = loadUniverse(storage);
  assert.equal(got.status, 'new');
  storage.full = true;
  assert.equal(saveUniverse(storage, got.state), false);
  const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };
  assert.equal(loadUniverse(blocked).status, 'unavailable');
});

test('only the universe key is written - fantasy and Markets data are untouched', () => {
  const storage = memoryStorage({ cbd_team_v1: '{"team":{}}', arc_markets_v1: '{"watch":["x"]}' });
  saveUniverse(storage, M.createUniverse());
  assert.equal(storage.getItem('cbd_team_v1'), '{"team":{}}');
  assert.equal(storage.getItem('arc_markets_v1'), '{"watch":["x"]}');
  assert.deepEqual(storage.keys().sort(), ['arc_markets_v1', 'cbd_team_v1', STORAGE_KEY].sort());
});

test('an unreadable save is copied aside, never overwritten', () => {
  const storage = memoryStorage({ [STORAGE_KEY]: '{"app":"wwe-universe","version":1,' });   // truncated
  const got = loadUniverse(storage);
  assert.equal(got.status, 'recovered');
  assert.equal(got.readOnly, false);
  assert.equal(storage.getItem(got.backupKey), '{"app":"wwe-universe","version":1,');
  // loading the same broken save again doesn't pile up copies
  assert.equal(loadUniverse(storage).backupKey, got.backupKey);

  const newer = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ app: 'wwe-universe', version: 99 }) });
  const g2 = loadUniverse(newer);
  assert.equal(g2.status, 'recovered');
  assert.match(g2.problems[0], /newer version/);

  // when even the copy can't be written, stay read-only rather than lose it
  const stuck = memoryStorage({ [STORAGE_KEY]: 'not json' });
  stuck.full = true;
  const g3 = loadUniverse(stuck);
  assert.equal(g3.readOnly, true);
  assert.equal(g3.backupKey, null);
  assert.equal(stuck.getItem(STORAGE_KEY), 'not json');
});

test('export then import gives back the same universe', () => {
  const { st, a, b, whc } = titleWorld();
  const ev = M.addEvent(st, { showId: 'raw' });
  M.recordMatch(st, ev.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [b.id] }], winner: 0, titleId: whc.id }, { titleChange: true });
  const back = importUniverse(exportUniverse(st));
  assert.deepEqual(back, JSON.parse(JSON.stringify(st)));
  // ids keep counting from where they were, so new records never collide
  const w = M.addWrestler(back, { name: 'New' });
  assert.equal(st.wrestlers.some(x => x.id === w.id), false);
  sound(back);
});

test('import refuses anything that is not a sound universe', () => {
  throwsUE(() => importUniverse('nope'), /not valid JSON/);
  throwsUE(() => importUniverse('[]'), /not a universe/);
  throwsUE(() => importUniverse(JSON.stringify({ app: 'arc-markets', version: 1 })), /not a WWE Universe/);
  throwsUE(() => importUniverse(JSON.stringify({ app: 'wwe-universe' })), /version/);

  const st = M.createUniverse();
  const a = M.addWrestler(st, { name: 'A' });
  const b = M.addWrestler(st, { name: 'B' });
  const t = M.addTitle(st, { name: 'T' });
  M.setChampion(st, t.id, { type: 'wrestler', id: a.id });
  const broken = JSON.parse(JSON.stringify(st));
  broken.reigns.push({ ...broken.reigns[0], id: 'rg90', holder: { type: 'wrestler', id: b.id } });
  broken.nextId = 91;
  throwsUE(() => importUniverse(JSON.stringify(broken)), /2 champions at once/);

  const dangling = JSON.parse(JSON.stringify(st));
  dangling.wrestlers[0].showId = 'impact';
  throwsUE(() => importUniverse(JSON.stringify(dangling)), /show that doesn't exist/);
});

test('import refuses a crafted save that would inject markup', () => {
  const st = M.createUniverse();
  const w = M.addWrestler(st, { name: 'A', showId: 'raw' });
  const good = JSON.stringify(st);
  assert.ok(importUniverse(good));

  const badId = JSON.parse(good);                        // ids land inside onclick="..."
  badId.wrestlers[0].id = "w1');alert(1);('";
  badId.moves[0].wrestler = badId.wrestlers[0].id;
  throwsUE(() => importUniverse(JSON.stringify(badId)), /plain token/);

  const badColor = JSON.parse(good);                     // colours land inside style="..."
  badColor.shows[0].color = 'red" onmouseover="alert(1)';
  throwsUE(() => importUniverse(JSON.stringify(badColor)), /colour/);

  const badSeason = JSON.parse(good);                    // season numbers land in labels
  badSeason.seasons[0].number = '<img src=x onerror=alert(1)>';
  throwsUE(() => importUniverse(JSON.stringify(badSeason)), /broken number/);

  const badName = JSON.parse(good);
  badName.wrestlers[0].name = { toString: 'x' };
  throwsUE(() => importUniverse(JSON.stringify(badName)), /isn't text/);
  assert.equal(w.name, 'A');
});

test('an old or partial save is filled in on load', () => {
  const got = importUniverse(JSON.stringify({ app: 'wwe-universe', version: 1 }));
  assert.equal(got.shows.length, 4);
  assert.equal(M.activeSeason(got).number, 1);
  sound(got);
});

// ================================================================ stage 2
// Profiles, records, line-ups, and correcting mistakes without collateral.

const REC = (w = 0, l = 0, d = 0, nc = 0) => ({ w, l, d, nc });
const byNameIn = (st, n) => st.wrestlers.find(w => w.name === n);

test('a real v1 save migrates all the way forward and still adds up', async () => {
  // Written by the v1 model as committed in a23ab03 - not hand-made.
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('./fixtures/universe-v1.json', import.meta.url), 'utf8');
  assert.equal(JSON.parse(text).version, 1);
  const st = importUniverse(text);
  assert.equal(st.version, M.SCHEMA_VERSION);
  sound(st);
  const team = n => st.teams.find(t => t.name === n);
  assert.equal(st.memberships.length, 6, 'every v1 member becomes a founding member');
  assert.deepEqual(team('Odd Couple').log.map(e => e.type), ['formed', 'disbanded']);
  assert.equal(team('Odd Couple').active, false);
  assert.deepEqual(M.teamRecord(st, team('The Usos').id), REC(0, 1, 0, 1));
  assert.deepEqual(M.teamRecord(st, team('The Elite Two').id), REC(1));
  const jey = byNameIn(st, 'Jey Uso'), cody = byNameIn(st, 'Cody Rhodes');
  assert.deepEqual(M.wrestlerRecord(st, jey.id).singles, REC(1));
  assert.deepEqual(M.wrestlerRecord(st, jey.id).tag, REC(0, 1, 0, 1));
  assert.deepEqual(M.wrestlerRecord(st, cody.id).singles, REC(1), 'a triple threat is singles');
  assert.deepEqual(M.wrestlerRecord(st, cody.id).teams[''], REC(0, 0, 0, 1), 'a makeshift pairing');
  // and it carries on working as a v2 universe
  const usos = team('The Usos');
  M.addTeamMember(st, usos.id, byNameIn(st, 'Free Agent').id);
  M.undoTeamChange(st, usos.id);
  sound(st);
});

test('a team’s record is its own - never the sum of its members’', () => {
  const st = M.createUniverse();
  const [a, b, c, x, y] = ['A', 'B', 'C', 'X', 'Y'].map(n => M.addWrestler(st, { name: n, showId: 'raw' }));
  const ab = M.addTeam(st, { name: 'AB', members: [a.id, b.id] });
  const ac = M.addTeam(st, { name: 'AC', members: [a.id, c.id] });
  const xy = M.addTeam(st, { name: 'XY', members: [x.id, y.id] });
  const ev = M.addEvent(st, { showId: 'raw' });
  const rec = (sides, winner, outcome) => M.recordMatch(st, ev.id, { sides, winner, outcome });
  rec([{ wrestlers: [a.id] }, { wrestlers: [x.id] }], 0);                                        // A singles win
  rec([{ wrestlers: [b.id] }, { wrestlers: [y.id] }], 0);                                        // B singles win
  rec([{ wrestlers: [a.id, b.id], team: ab.id }, { wrestlers: [x.id, y.id], team: xy.id }], 1);  // AB lose as AB
  rec([{ wrestlers: [a.id, b.id] }, { wrestlers: [x.id, y.id] }], 0);                            // A & B win, not as AB
  rec([{ wrestlers: [a.id, c.id], team: ac.id }, { wrestlers: [x.id, y.id] }], 0);               // A wins with AC
  rec([{ wrestlers: [a.id] }, { wrestlers: [x.id, y.id] }], 0);                                  // handicap: singles for A
  assert.deepEqual(M.teamRecord(st, ab.id), REC(0, 1), 'two singles wins and a makeshift win are not AB’s');
  assert.deepEqual(M.teamRecord(st, xy.id), REC(1));
  const ra = M.wrestlerRecord(st, a.id);
  assert.deepEqual(ra.singles, REC(2));
  assert.deepEqual(ra.tag, REC(2, 1));
  assert.deepEqual(ra.teams, { [ab.id]: REC(0, 1), '': REC(1), [ac.id]: REC(1) });
  assert.deepEqual(M.wrestlerRecord(st, x.id).tag, REC(1, 3), 'the pair in the handicap match is tag');
  assert.deepEqual(M.teamMatches(st, ab.id).length, 1);
});

test('a side wrestling as a team has to be the team', () => {
  const st = M.createUniverse();
  const [a, b, c, d] = ['A', 'B', 'C', 'D'].map(n => M.addWrestler(st, { name: n }));
  const ab = M.addTeam(st, { name: 'AB', members: [a.id, b.id] });
  const ev = M.addEvent(st, { showId: 'raw' });
  throwsUE(() => M.recordMatch(st, ev.id, { sides: [{ wrestlers: [a.id], team: ab.id }, { wrestlers: [c.id] }], winner: 0 }), /at least two of them/);
  throwsUE(() => M.recordMatch(st, ev.id, { sides: [{ wrestlers: [a.id, c.id], team: ab.id }, { wrestlers: [d.id] }], winner: 0 }), /C has never been on AB/);
});

test('moving a wrestler keeps every result, reign and team exactly as it was', () => {
  const { st, a, b, c, d, team, whc } = titleWorld();
  const ev = M.addEvent(st, { showId: 'raw' });
  M.recordMatch(st, ev.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [b.id] }], winner: 0, titleId: whc.id }, { titleChange: true });
  M.recordMatch(st, ev.id, { sides: [{ wrestlers: [c.id, d.id], team: team.id }, { wrestlers: [a.id, b.id] }], winner: 0 });
  const before = JSON.stringify([st.events, st.reigns, st.teams, st.memberships, M.wrestlerRecord(st, a.id)]);
  M.advanceWeek(st);
  M.assignWrestler(st, a.id, 'smackdown', 'traded');
  M.assignWrestler(st, c.id, 'dynamite');
  M.assignWrestler(st, a.id, '');
  assert.equal(JSON.stringify([st.events, st.reigns, st.teams, st.memberships, M.wrestlerRecord(st, a.id)]), before);
  assert.equal(ev.showId, 'raw', 'the show a result happened on is the event’s, not the wrestler’s');
  assert.deepEqual(M.movesOf(st, a.id).map(m => m.to), ['raw', 'smackdown', null]);
  assert.deepEqual(M.teamShows(st, team).sort((x, y) => String(x).localeCompare(String(y))), ['dynamite', 'raw']);
  sound(st);
});

test('moves can be backdated in order, bulk-moved all-or-nothing, and undone', () => {
  const st = M.createUniverse();
  const [a, b, c] = ['A', 'B', 'C'].map(n => M.addWrestler(st, { name: n, showId: 'raw' }));
  M.setWeek(st, 6);
  const mv = M.assignWrestler(st, a.id, 'nxt', 'call-up', { week: 3 });
  assert.equal(mv.at.week, 3);
  throwsUE(() => M.assignWrestler(st, a.id, 'raw', '', { week: 2 }), /last move was in season 1, week 3/);
  throwsUE(() => M.assignWrestler(st, a.id, 'raw', '', { week: 0 }), /Week/);

  let before = frozen(st);
  throwsUE(() => M.assignWrestlers(st, [b.id, 'w999'], 'smackdown'), /No wrestler/);
  throwsUE(() => M.assignWrestlers(st, [b.id, a.id], 'smackdown', '', { week: 2 }), /Moves have to be recorded in order/);
  throwsUE(() => M.assignWrestlers(st, [b.id, b.id], 'smackdown'), /twice/);
  assert.equal(frozen(st), before, 'a refused bulk move moves nobody');
  const moved = M.assignWrestlers(st, [a.id, b.id, c.id], 'smackdown', 'shake-up');
  assert.equal(moved.length, 3);
  assert.equal(M.assignWrestlers(st, [a.id, b.id], 'smackdown').length, 0, 'already there: nothing recorded');

  // undo takes back only the latest move of that one wrestler
  before = JSON.stringify([M.movesOf(st, b.id), M.movesOf(st, c.id)]);
  M.undoLastMove(st, a.id);
  assert.equal(a.showId, 'nxt');
  assert.deepEqual(M.movesOf(st, a.id).map(m => m.to), ['raw', 'nxt']);
  assert.equal(JSON.stringify([M.movesOf(st, b.id), M.movesOf(st, c.id)]), before);
  M.undoLastMove(st, a.id);
  M.undoLastMove(st, a.id);
  assert.equal(a.showId, null);
  throwsUE(() => M.undoLastMove(st, a.id), /no roster moves/);
  sound(st);
});

test('team line-ups change with dated joins and departures', () => {
  const st = M.createUniverse();
  const [a, b, c, d] = ['A', 'B', 'C', 'D'].map(n => M.addWrestler(st, { name: n }));
  M.setWeek(st, 2);
  const t = M.addTeam(st, { name: 'Stable', members: [a.id, b.id, c.id] });
  M.setWeek(st, 8);
  throwsUE(() => M.addTeamMember(st, t.id, d.id, { week: 1 }), /formed in season 1, week 2/);
  throwsUE(() => M.addTeamMember(st, t.id, a.id), /already on Stable/);
  M.removeTeamMember(st, t.id, c.id, { week: 5 });
  throwsUE(() => M.removeTeamMember(st, t.id, b.id), /at least two members/);
  M.addTeamMember(st, t.id, d.id, { week: 6 });
  const mates = w => M.teammatesOf(st, w)[0].partners.map(p => p.name).sort();
  assert.deepEqual(mates(c.id), ['A', 'B'], 'D joined after C left, so they never teamed');
  throwsUE(() => M.addTeamMember(st, t.id, c.id, { week: 4 }), /left Stable in season 1, week 5/);
  M.addTeamMember(st, t.id, c.id);                                    // back for a second spell
  assert.deepEqual(M.membershipsOf(st, t.id).filter(m => m.wrestler === c.id).map(m => [m.start.week, m.end && m.end.week]),
    [[2, 5], [8, null]]);
  assert.deepEqual([...t.members].sort(), [a.id, b.id, c.id, d.id].sort());
  assert.deepEqual(mates(a.id), ['B', 'C', 'D']);
  assert.deepEqual(mates(c.id), ['A', 'B', 'D'], 'now C is back alongside D');
  assert.equal(M.memberAt(st, t.id, c.id, { season: 's1', week: 3, seq: 1e9 }), true);
  assert.equal(M.memberAt(st, t.id, c.id, { season: 's1', week: 6, seq: 1e9 }), false);
  sound(st);
});

test('undoing a team change takes back one change at a time', () => {
  const st = M.createUniverse();
  const [a, b, c] = ['A', 'B', 'C'].map(n => M.addWrestler(st, { name: n }));
  const t = M.addTeam(st, { name: 'T', members: [a.id, b.id] });
  throwsUE(() => M.undoTeamChange(st, t.id), /haven't changed since they formed/);
  M.addTeamMember(st, t.id, c.id);
  M.removeTeamMember(st, t.id, a.id);
  M.setTeamActive(st, t.id, false);
  M.setTeamActive(st, t.id, true);
  M.undoTeamChange(st, t.id);                           // reunion
  assert.equal(t.active, false);
  M.undoTeamChange(st, t.id);                           // disbanding
  assert.equal(t.active, true);
  assert.deepEqual(t.log.map(e => e.type), ['formed']);
  M.undoTeamChange(st, t.id);                           // A leaving
  assert.deepEqual([...t.members].sort(), [a.id, b.id, c.id].sort());
  sound(st);

  // a join someone has already wrestled under can't just vanish
  const ev = M.addEvent(st, { showId: 'raw' });
  const m = M.recordMatch(st, ev.id, { sides: [{ wrestlers: [a.id, c.id], team: t.id }, { wrestlers: [b.id] }], winner: 0 });
  throwsUE(() => M.undoTeamChange(st, t.id), /C wrestled for T at Raw · Week 1. Edit that match first/);
  M.deleteMatch(st, ev.id, m.id);
  M.undoTeamChange(st, t.id);                           // C joining
  assert.deepEqual([...t.members].sort(), [a.id, b.id].sort());
  sound(st);

  // a reunion that has since won a title stays reunited
  const tag = M.addTitle(st, { name: 'Tags', kind: 'tag' });
  M.setTeamActive(st, t.id, false);
  M.setTeamActive(st, t.id, true);
  M.setChampion(st, tag.id, { type: 'team', id: t.id });
  throwsUE(() => M.undoTeamChange(st, t.id), /hold the Tags since reuniting/);
});

test('a wrong result is corrected in place, and nothing else moves', () => {
  const st = M.createUniverse();
  const [a, b, c] = ['A', 'B', 'C'].map(n => M.addWrestler(st, { name: n, showId: 'raw' }));
  const ev = M.addEvent(st, { showId: 'raw' });
  const m1 = M.recordMatch(st, ev.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [b.id] }], winner: 0, finish: 'pinfall' });
  const m2 = M.recordMatch(st, ev.id, { sides: [{ wrestlers: [b.id] }, { wrestlers: [c.id] }], winner: 1 });
  const other = JSON.stringify(m2);
  const fixed = M.updateMatch(st, ev.id, m1.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [c.id] }], winner: 1, finish: 'submission', stip: 'No DQ' });
  assert.equal(fixed, ev.matches[0], 'same record, same place on the card');
  assert.equal(fixed.id, m1.id);
  assert.deepEqual([fixed.sides[1].wrestlers[0], fixed.winner, fixed.finish, fixed.stip], [c.id, 1, 'submission', 'No DQ']);
  assert.equal(JSON.stringify(ev.matches[1]), other);
  assert.deepEqual(M.wrestlerRecord(st, a.id).singles, REC(0, 1));
  assert.deepEqual(M.wrestlerRecord(st, b.id).singles, REC(0, 1), 'B is no longer in the first match');
  const before = frozen(st);
  throwsUE(() => M.updateMatch(st, ev.id, m1.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [a.id] }], winner: 0 }), /twice/);
  assert.equal(frozen(st), before);
  sound(st);
});

test('correcting a title-changing result carries through to the title history', () => {
  const st = M.createUniverse();
  const [a, b, c, d] = ['A', 'B', 'C', 'D'].map(n => M.addWrestler(st, { name: n, showId: 'raw' }));
  const t = M.addTitle(st, { name: 'Belt' });
  M.setChampion(st, t.id, { type: 'wrestler', id: a.id });
  M.setWeek(st, 3);
  const ev = M.addEvent(st, { showId: 'raw' });
  const tt = { sides: [a, b, c, d].map(w => ({ wrestlers: [w.id] })), titleId: t.id };  // fatal four-way
  const m = M.recordMatch(st, ev.id, { ...tt, winner: 1 }, { titleChange: true });      // B wins
  const reign = M.currentReign(st, t.id);
  // it was really C who won
  M.updateMatch(st, ev.id, m.id, { ...tt, winner: 2 }, { titleChange: true });
  assert.equal(M.currentReign(st, t.id), reign, 'the same reign, corrected - not a new one');
  assert.deepEqual([reign.holder.id, reign.eventId, reign.matchId], [c.id, ev.id, m.id]);
  assert.equal(M.titleReigns(st, t.id).length, 2);
  throwsUE(() => M.updateMatch(st, ev.id, m.id, { ...tt, winner: 0 }, { titleChange: true }), /retention, not a title change/);

  // D takes it from C two weeks later
  M.setWeek(st, 5);
  const ev2 = M.addEvent(st, { showId: 'raw' });
  M.recordMatch(st, ev2.id, { sides: [{ wrestlers: [c.id] }, { wrestlers: [d.id] }], winner: 1, titleId: t.id }, { titleChange: true });
  // the earlier result can still be re-pointed - the later reign is untouched...
  const later = JSON.stringify(M.titleReigns(st, t.id)[2]);
  M.updateMatch(st, ev.id, m.id, { ...tt, winner: 1, finish: 'pinfall' }, { titleChange: true });
  assert.equal(reign.holder.id, b.id);
  assert.equal(JSON.stringify(M.titleReigns(st, t.id)[2]), later);
  // ...but not taken away, and not handed to the next champion
  const pinned = frozen(st);
  throwsUE(() => M.updateMatch(st, ev.id, m.id, { ...tt, winner: 1 }), /changed hands or been vacated since this match/);
  throwsUE(() => M.updateMatch(st, ev.id, m.id, { ...tt, winner: 3 }, { titleChange: true }), /D win the Belt next/);
  throwsUE(() => M.deleteMatch(st, ev.id, m.id), /since this match/);
  assert.equal(frozen(st), pinned);

  // once the later change is undone, dropping the title change hands the belt back to A
  M.undoTitleChange(st, t.id);
  M.updateMatch(st, ev.id, m.id, { ...tt, winner: 1 });
  assert.equal(M.currentReign(st, t.id).holder.id, a.id);
  assert.equal(ev.matches[0].titleId, t.id, 'still a title match - just not a title change');
  // and a title change can be added to a result after the fact
  M.updateMatch(st, ev.id, m.id, { ...tt, winner: 1 }, { titleChange: true });
  assert.equal(M.currentReign(st, t.id).holder.id, b.id);
  sound(st);
});

test('moving an event to another week carries its title changes, in order', () => {
  const st = M.createUniverse();
  const [a, b, c] = ['A', 'B', 'C'].map(n => M.addWrestler(st, { name: n, showId: 'raw' }));
  const t = M.addTitle(st, { name: 'Belt' });
  M.setWeek(st, 2);
  M.setChampion(st, t.id, { type: 'wrestler', id: a.id });                 // A from week 2
  const ev = M.addEvent(st, { showId: 'raw', week: 3 });
  M.recordMatch(st, ev.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [b.id] }], winner: 1, titleId: t.id }, { titleChange: true });
  M.setWeek(st, 6);
  M.setChampion(st, t.id, { type: 'wrestler', id: c.id });                 // C from week 6
  M.updateEvent(st, ev.id, { week: 5 });
  const [ra, rb, rc] = M.titleReigns(st, t.id);
  assert.deepEqual([ra.end.week, rb.start.week, rb.end.week, rc.start.week], [5, 5, 6, 6]);
  assert.equal(ev.name, 'Raw · Week 5', 'still called by its default name, so it follows the week');
  throwsUE(() => M.updateEvent(st, ev.id, { week: 7 }), /after the Belt reign won here ended \(season 1, week 6\)/);
  throwsUE(() => M.updateEvent(st, ev.id, { week: 1 }), /before the Belt reign this event ended began \(season 1, week 2\)/);
  sound(st);
});

test('a hand-entered reign can be corrected without touching the rest', () => {
  const st = M.createUniverse();
  const [a, b, c, d] = ['A', 'B', 'C', 'D'].map(n => M.addWrestler(st, { name: n }));
  const t = M.addTitle(st, { name: 'Belt' });
  const crown = (w, week) => { M.setWeek(st, week); return M.setChampion(st, t.id, { type: 'wrestler', id: w.id }); };
  const r1 = crown(a, 1), r2 = crown(b, 3), r3 = crown(c, 5);
  const r3Before = JSON.stringify(r3);
  M.updateReign(st, r2.id, { holder: { type: 'wrestler', id: d.id }, note: 'house show' });
  assert.deepEqual([r2.holder.id, r2.note], [d.id, 'house show']);
  throwsUE(() => M.updateReign(st, r2.id, { holder: { type: 'wrestler', id: a.id } }), /already held the Belt going into/);
  throwsUE(() => M.updateReign(st, r2.id, { holder: { type: 'wrestler', id: c.id } }), /win the Belt next/);
  M.updateReign(st, r2.id, { week: 2 });
  assert.deepEqual([r1.end.week, r2.start.week], [2, 2]);
  throwsUE(() => M.updateReign(st, r2.id, { week: 6 }), /after this reign ended/);
  M.setWeek(st, 9);
  M.setWeek(st, 1);
  throwsUE(() => M.updateReign(st, r3.id, { week: 1 }), /before the previous reign began/);
  assert.deepEqual([r1.holder.id, r1.start.week], [a.id, 1], 'the reign before keeps its holder and start');
  assert.equal(JSON.stringify(r3), r3Before, 'the reign after is untouched');

  // a reign that came from a result is corrected through that result
  M.setWeek(st, 7);
  const ev = M.addEvent(st, { showId: 'raw' });
  M.recordMatch(st, ev.id, { sides: [{ wrestlers: [c.id] }, { wrestlers: [a.id] }], winner: 1, titleId: t.id }, { titleChange: true });
  const r4 = M.currentReign(st, t.id);
  throwsUE(() => M.updateReign(st, r4.id, { holder: { type: 'wrestler', id: b.id } }), /edit that result/);
  throwsUE(() => M.updateReign(st, r4.id, { week: 8 }), /change that event's week/);
  M.updateReign(st, r4.id, { note: 'cash-in' });
  sound(st);
});

test('merging a duplicate keeps everything either of them did', () => {
  const st = M.createUniverse();
  const [keep, dup, x, y] = ['Mercedes Moné', 'Mercedes Mone', 'X', 'Y'].map(n => M.addWrestler(st, { name: n, showId: 'dynamite' }));
  M.assignWrestler(st, dup.id, 'raw');
  const team = M.addTeam(st, { name: 'Dup & X', members: [dup.id, x.id] });
  const belt = M.addTitle(st, { name: 'Belt' });
  const ev = M.addEvent(st, { showId: 'raw' });
  M.recordMatch(st, ev.id, { sides: [{ wrestlers: [dup.id] }, { wrestlers: [y.id] }], winner: 0, titleId: belt.id }, { titleChange: true });
  M.recordMatch(st, ev.id, { sides: [{ wrestlers: [dup.id, x.id], team: team.id }, { wrestlers: [y.id] }], winner: 0 });
  M.recordMatch(st, ev.id, { sides: [{ wrestlers: [keep.id] }, { wrestlers: [x.id] }], winner: 1 });
  M.mergeWrestlers(st, keep.id, dup.id);
  assert.equal(M.wrestlerById(st, dup.id), null);
  assert.equal(keep.showId, 'dynamite', 'the kept wrestler’s show history is the real one');
  assert.deepEqual(M.wrestlerRecord(st, keep.id).singles, REC(1, 1));
  assert.deepEqual(M.wrestlerRecord(st, keep.id).teams[team.id], REC(1));
  assert.deepEqual(team.members.sort(), [keep.id, x.id].sort());
  assert.equal(M.currentReign(st, belt.id).holder.id, keep.id);
  assert.equal(st.moves.some(m => m.wrestler === dup.id), false);
  sound(st);

  // refused when they can't be the same person
  const a = M.addWrestler(st, { name: 'A' }), b = M.addWrestler(st, { name: 'B' });
  const ev2 = M.addEvent(st, { showId: 'raw' });
  M.recordMatch(st, ev2.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [b.id] }], winner: 0 });
  throwsUE(() => M.mergeWrestlers(st, a.id, b.id), /both in a match/);
  const z = M.addWrestler(st, { name: 'Z' });
  M.addTeamMember(st, team.id, z.id);
  throwsUE(() => M.mergeWrestlers(st, keep.id, z.id), /both been on Dup & X/);
  throwsUE(() => M.mergeWrestlers(st, a.id, a.id), /two different/);
  const c = M.addWrestler(st, { name: 'C' });
  M.setChampion(st, belt.id, { type: 'wrestler', id: c.id });
  throwsUE(() => M.mergeWrestlers(st, keep.id, c.id), /win the Belt from themselves/);
});

test('a career lists what happened to that wrestler, newest first', () => {
  const st = M.createUniverse();
  const [a, b] = ['A', 'B'].map(n => M.addWrestler(st, { name: n, showId: 'raw' }));
  const belt = M.addTitle(st, { name: 'Belt' });
  const tags = M.addTitle(st, { name: 'Tags', kind: 'tag' });
  M.setWeek(st, 2);
  const t = M.addTeam(st, { name: 'AB', members: [a.id, b.id] });
  M.setWeek(st, 3);
  M.setChampion(st, belt.id, { type: 'wrestler', id: a.id });
  M.setChampion(st, tags.id, { type: 'team', id: t.id });
  M.setWeek(st, 4);
  M.setChampion(st, belt.id, { type: 'wrestler', id: b.id });
  M.assignWrestler(st, a.id, 'smackdown');
  const c = M.addWrestler(st, { name: 'C' });
  M.addTeamMember(st, t.id, c.id);
  M.removeTeamMember(st, t.id, a.id);
  M.vacateTitle(st, tags.id);
  const career = M.careerOf(st, a.id).map(e => `${e.week}:${e.type}${e.title ? ':' + e.title.name : ''}`);
  assert.deepEqual(career, ['4:team-left', '4:move', '4:title-lost:Belt', '3:title-won:Tags', '3:title-won:Belt',
    '2:team-formed', '1:move']);
  assert.ok(!career.includes('4:title-vacated:Tags'), 'the tag title was vacated after A had left the team');
  assert.deepEqual(M.careerOf(st, c.id).map(e => e.type), ['title-vacated', 'team-joined']);
  assert.deepEqual(M.championshipsOf(st, c.id).map(x => x.title.name), ['Tags'], 'C was on the team during the reign');
});

test('reign lengths count across seasons, and defences are counted', () => {
  const st = M.createUniverse();
  const [a, b] = ['A', 'B'].map(n => M.addWrestler(st, { name: n }));
  const belt = M.addTitle(st, { name: 'Belt' });
  M.setWeek(st, 10);
  const r = M.setChampion(st, belt.id, { type: 'wrestler', id: a.id });
  const ev = M.addEvent(st, { showId: 'raw', week: 11 });
  M.recordMatch(st, ev.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [b.id] }], winner: 0, titleId: belt.id });
  M.recordMatch(st, ev.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [b.id] }], outcome: 'draw', titleId: belt.id });
  M.recordMatch(st, ev.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [b.id] }], winner: 0 });   // not for the title
  M.setWeek(st, 12);
  M.startNextSeason(st);
  M.setWeek(st, 2);
  assert.equal(M.weeksBetween(st, r.start, { season: M.activeSeason(st).id, week: 2 }), 4);   // W10 → W12, S2 W1, W2
  assert.equal(M.reignWeeks(st, r), 4);
  assert.equal(M.defencesOf(st, r), 2, 'a retained title match counts, a draw included; a non-title match does not');
  const ev2 = M.addEvent(st, { showId: 'raw' });
  M.recordMatch(st, ev2.id, { sides: [{ wrestlers: [a.id] }, { wrestlers: [b.id] }], winner: 1, titleId: belt.id }, { titleChange: true });
  assert.equal(M.defencesOf(st, r), 2, 'the match that lost the title is not a defence');
  assert.equal(M.reignWeeks(st, r), 4);
});


test('a team’s history, what undo would take back, and makeshift partners', () => {
  const st = M.createUniverse();
  const [a, b, c, d] = ['A', 'B', 'C', 'D'].map(n => M.addWrestler(st, { name: n }));
  const tags = M.addTitle(st, { name: 'Tags', kind: 'tag' });
  const t = M.addTeam(st, { name: 'T', members: [a.id, b.id] });
  assert.equal(M.lastTeamChange(st, t.id), null);
  M.setWeek(st, 2);
  M.addTeamMember(st, t.id, c.id);
  M.setChampion(st, tags.id, { type: 'team', id: t.id });
  M.setWeek(st, 3);
  M.removeTeamMember(st, t.id, a.id);
  M.vacateTitle(st, tags.id);
  M.setTeamActive(st, t.id, false);
  assert.deepEqual(M.teamHistoryOf(st, t.id).map(e => `${e.week}:${e.type}${e.wrestler ? ':' + e.wrestler.name : ''}`),
    ['3:team-disbanded', '3:title-vacated', '3:member-left:A', '2:title-won', '2:member-joined:C', '1:team-formed']);
  assert.equal(M.lastTeamChange(st, t.id).kind, 'disbanded');
  M.undoTeamChange(st, t.id);
  assert.deepEqual([M.lastTeamChange(st, t.id).kind, M.lastTeamChange(st, t.id).m.wrestler], ['left', a.id]);

  const ev = M.addEvent(st, { showId: 'raw' });
  M.recordMatch(st, ev.id, { sides: [{ wrestlers: [d.id, a.id] }, { wrestlers: [b.id] }], winner: 0 });
  M.recordMatch(st, ev.id, { sides: [{ wrestlers: [d.id, a.id] }, { wrestlers: [c.id] }], winner: 0 });
  M.recordMatch(st, ev.id, { sides: [{ wrestlers: [d.id, b.id] }, { wrestlers: [a.id] }], winner: 0 });
  M.recordMatch(st, ev.id, { sides: [{ wrestlers: [b.id, c.id], team: t.id }, { wrestlers: [d.id] }], winner: 0 });
  assert.deepEqual(M.tagPartnersOf(st, d.id).map(p => `${p.wrestler.name}×${p.count}`), ['A×2', 'B×1']);
  assert.deepEqual(M.tagPartnersOf(st, b.id).map(p => p.wrestler.name), ['D'], 'wrestling as the team is not a makeshift pairing');
});

test('a reign after a vacancy can’t be dated before the vacancy', () => {
  const st = M.createUniverse();
  const [a, b] = ['A', 'B'].map(n => M.addWrestler(st, { name: n }));
  const t = M.addTitle(st, { name: 'Belt' });
  M.setChampion(st, t.id, { type: 'wrestler', id: a.id });        // A from week 1
  M.setWeek(st, 4);
  M.vacateTitle(st, t.id);                                          // vacant from week 4
  M.setWeek(st, 6);
  const r = M.setChampion(st, t.id, { type: 'wrestler', id: b.id }); // B from week 6, awarded
  throwsUE(() => M.updateReign(st, r.id, { week: 3 }), /vacant until season 1, week 4/);
  M.updateReign(st, r.id, { week: 4 });                              // the same week is fine
  assert.equal(r.start.week, 4);
  assert.equal(M.titleReigns(st, t.id)[0].end.week, 4, 'the vacated reign keeps its own end');
  // and the same floor applies when an event carrying the win moves
  M.updateReign(st, r.id, { week: 6 });
  M.undoTitleChange(st, t.id);
  const ev = M.addEvent(st, { showId: 'raw', week: 6 });
  M.recordMatch(st, ev.id, { sides: [{ wrestlers: [b.id] }, { wrestlers: [a.id] }], winner: 0, titleId: t.id }, { titleChange: true });
  throwsUE(() => M.updateEvent(st, ev.id, { week: 2 }), /vacant until season 1, week 4/);
  M.updateEvent(st, ev.id, { week: 5 });
  assert.equal(M.currentReign(st, t.id).start.week, 5);
  sound(st);
});

// ================================================================ stage 3
// The show calendar and match cards: booking, entering results, correcting
// them - and records and title histories across every common match type.

const S = ids => ids.map(x => ({ wrestlers: Array.isArray(x) ? x : [x] }));
const R = (w = 0, l = 0, d = 0, nc = 0) => ({ w, l, d, nc });

// Ten wrestlers, three teams, one card with every common kind of match.
function cardWorld() {
  const st = M.createUniverse();
  const W = {};
  'ABCDEFGHIJ'.split('').forEach(n => { W[n] = M.addWrestler(st, { name: n, showId: 'raw' }).id; });
  const T = {
    AC: M.addTeam(st, { name: 'AC', members: [W.A, W.C] }).id,
    BD: M.addTeam(st, { name: 'BD', members: [W.B, W.D] }).id,
    EF: M.addTeam(st, { name: 'EF', members: [W.E, W.F] }).id,
  };
  const ev = M.addEvent(st, { showId: 'raw' });
  const team = (t, ...ws) => ({ wrestlers: ws, team: t });
  const card = [
    ['Singles',           S([W.A, W.B])],
    ['Tag team',          [team(T.AC, W.A, W.C), team(T.BD, W.B, W.D)]],
    ['Tag team',          S([[W.A, W.D], [W.B, W.C]])],                            // makeshift pairs
    ['Triple threat',     S([W.A, W.B, W.E])],
    ['Fatal 4-way',       S([W.A, W.B, W.E, W.F])],
    ['3-on-3 tag',        S([[W.A, W.B, W.C], [W.D, W.E, W.F]])],
    ['Handicap 1-on-2',   S([W.G, [W.A, W.B]])],
    ['Triple threat tag', [team(T.AC, W.A, W.C), team(T.BD, W.B, W.D), team(T.EF, W.E, W.F)]],
    ['10-way',            S('ABCDEFGHIJ'.split('').map(n => W[n]))],               // battle royal
    ['Singles',           S([W.A, W.C])],
  ].map(([kind, sides]) => ({ kind, m: M.bookMatch(st, ev.id, { sides, stip: kind === '10-way' ? 'Battle Royal' : '' }) }));
  return { st, W, T, ev, card };
}
// What the game produced, entered one booked match at a time.
function playCard(st, ev, card, W) {
  const results = [
    { winner: 0, finish: 'pinfall', fall: { by: W.A, on: W.B } },
    { winner: 0 },
    { winner: 0 },
    { winner: 2, fall: { by: W.E, on: W.B } },
    { winner: 3 },
    { outcome: 'nc' },
    { winner: 0 },
    { winner: 2 },
    { winner: 7, finish: 'elimination', fall: { by: W.H, on: W.A } },
    { outcome: 'draw' },
  ];
  card.forEach(({ m }, i) => M.enterResult(st, ev.id, m.id, results[i]));
}

test('a booked match has no result and counts for nothing until it’s played', () => {
  const { st, W, T, ev, card } = cardWorld();
  assert.deepEqual(card.map(c => M.matchKind(c.m).label), card.map(c => c.kind), 'the kind is read from the line-up');
  assert.ok(card.every(c => c.m.status === 'scheduled' && c.m.outcome === null && c.m.winner === null));
  assert.deepEqual(M.cardStatus(ev), { booked: 10, played: 0, total: 10, state: 'booked' });
  assert.deepEqual(M.wrestlerRecord(st, W.A), { singles: R(), tag: R(), teams: {} });
  assert.deepEqual(M.teamRecord(st, T.AC), R());
  assert.equal(M.matchesOf(st, W.A).length, 0);
  assert.equal(M.bookingsOf(st, W.A).length, 10);
  assert.equal(M.teamBookings(st, T.AC).length, 2);
  assert.deepEqual(M.resultsHistory(st), []);
  assert.deepEqual(M.summary(st).booked, 10);
  // a booked wrestler is on a card, so they can't just be deleted
  throwsUE(() => M.deleteWrestler(st, W.J), /a booked match/);
  // a booking can be changed before it's played; a result can't be changed as a booking
  M.updateBooking(st, ev.id, card[0].m.id, { sides: S([W.A, W.G]), notes: '#1 contender' });
  assert.deepEqual([card[0].m.sides[1].wrestlers, card[0].m.notes], [[W.G], '#1 contender']);
  M.updateBooking(st, ev.id, card[0].m.id, { sides: S([W.A, W.B]) });
  assert.equal(card[0].m.notes, '#1 contender', 'what isn’t changed stays');
  sound(st);
});

test('the tool never picks a winner', () => {
  const { st, W, ev, card } = cardWorld();
  const t = M.addTitle(st, { name: 'Belt' });
  M.setChampion(st, t.id, { type: 'wrestler', id: W.A });
  const m = M.bookMatch(st, ev.id, { sides: S([W.A, W.B]), titleId: t.id });
  const before = frozen(st);
  throwsUE(() => M.enterResult(st, ev.id, m.id, {}), /Enter the result: who won, a draw, or a no contest/);
  throwsUE(() => M.enterResult(st, ev.id, m.id, { outcome: 'win' }), /Pick who won/);
  throwsUE(() => M.enterResult(st, ev.id, m.id, { outcome: 'draw', winner: 0 }), /A draw has no winner/);
  throwsUE(() => M.enterResult(st, ev.id, m.id, { outcome: 'nc', winner: 1 }), /no contest has no winner/);
  throwsUE(() => M.recordMatch(st, ev.id, { sides: S([W.C, W.D]) }), /Enter the result/);
  throwsUE(() => M.enterResult(st, ev.id, m.id, { outcome: 'draw', fall: { on: W.A } }), /Only a win/);
  throwsUE(() => M.enterResult(st, ev.id, m.id, { winner: 1, fall: { by: W.A } }), /A wasn't on the winning side/);
  assert.equal(frozen(st), before, 'every refusal leaves the match booked and untouched');
  // the challenger winning a title match doesn't move the belt unless the result says so (a DQ, say)
  M.enterResult(st, ev.id, m.id, { winner: 1, finish: 'dq' });
  assert.equal(M.currentReign(st, t.id).holder.id, W.A);
  // nor does booking anything
  assert.ok(card.every(c => c.m.winner === null));
});

test('records across every common match type, from one played card', () => {
  const { st, W, T, ev, card } = cardWorld();
  playCard(st, ev, card, W);
  assert.deepEqual(M.cardStatus(ev).state, 'complete');
  // worked out by hand from the ten results
  const rec = n => { const r = M.wrestlerRecord(st, W[n]); return [r.singles, r.tag]; };
  assert.deepEqual(rec('A'), [R(1, 3, 1), R(2, 2, 0, 1)]);
  assert.deepEqual(rec('B'), [R(0, 4), R(0, 4, 0, 1)]);
  assert.deepEqual(rec('C'), [R(0, 1, 1), R(1, 2, 0, 1)]);
  assert.deepEqual(rec('D'), [R(0, 1), R(1, 2, 0, 1)]);
  assert.deepEqual(rec('E'), [R(1, 2), R(1, 0, 0, 1)]);
  assert.deepEqual(rec('F'), [R(1, 1), R(1, 0, 0, 1)]);
  assert.deepEqual(rec('G'), [R(1, 1), R()], 'the lone wrestler in a handicap match: singles');
  assert.deepEqual(rec('H'), [R(1), R()]);
  assert.deepEqual(rec('J'), [R(0, 1), R()], 'every non-winner of a battle royal takes a loss');
  // teams: only as the team - A&C's makeshift tag and the 3-on-3 aren't AC's
  assert.deepEqual(M.teamRecord(st, T.AC), R(1, 1));
  assert.deepEqual(M.teamRecord(st, T.BD), R(0, 2));
  assert.deepEqual(M.teamRecord(st, T.EF), R(1));
  assert.deepEqual(M.wrestlerRecord(st, W.A).teams, { [T.AC]: R(1, 1), '': R(1, 1, 0, 1) });
  // winners, losers and the fall
  const tt = card[3].m;
  assert.deepEqual([tt.winner, tt.fall], [2, { by: W.E, on: W.B }]);
  assert.equal(card[8].m.finish, 'elimination');
  // the history lists all ten, newest show first, card in running order
  assert.deepEqual(M.resultsHistory(st).map(x => x.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  sound(st);
});

test('correcting results updates every record they touch, and nothing else', () => {
  const { st, W, T, ev, card } = cardWorld();
  playCard(st, ev, card, W);
  const untouched = JSON.stringify([M.wrestlerRecord(st, W.H), M.wrestlerRecord(st, W.J), M.teamRecord(st, T.BD)]);
  // triple threat: it was B, not E, who won
  M.updateMatch(st, ev.id, card[3].m.id, { sides: card[3].m.sides, winner: 1, fall: { by: W.B, on: W.A } });
  assert.deepEqual(M.wrestlerRecord(st, W.B).singles, R(1, 3));
  assert.deepEqual(M.wrestlerRecord(st, W.E).singles, R(0, 3));
  assert.deepEqual(M.wrestlerRecord(st, W.A).singles, R(1, 3, 1), 'still a loss for A either way');
  // triple threat tag: AC won it, not EF
  M.updateMatch(st, ev.id, card[7].m.id, { sides: card[7].m.sides, winner: 0 });
  assert.deepEqual([M.teamRecord(st, T.AC), M.teamRecord(st, T.EF)], [R(2, 0), R(0, 1)]);
  // the handicap match was really a no contest
  M.updateMatch(st, ev.id, card[6].m.id, { sides: card[6].m.sides, outcome: 'nc' });
  assert.deepEqual(M.wrestlerRecord(st, W.G).singles, R(0, 1, 0, 1));
  // and the draw hadn't happened yet: take the result back, it's booked again
  M.clearResult(st, ev.id, card[9].m.id);
  assert.equal(card[9].m.status, 'scheduled');
  assert.deepEqual(M.wrestlerRecord(st, W.A).singles, R(1, 3, 0));
  assert.deepEqual(M.wrestlerRecord(st, W.A).tag, R(3, 0, 0, 2), 'the handicap loss became a no contest');
  assert.deepEqual(M.cardStatus(ev), { booked: 1, played: 9, total: 10, state: 'partial' });
  assert.equal(JSON.stringify([M.wrestlerRecord(st, W.H), M.wrestlerRecord(st, W.J), M.teamRecord(st, T.BD)]), untouched);
  assert.deepEqual(card.map(c => c.m.id), ev.matches.map(m => m.id), 'every match keeps its id and its place');
  sound(st);
});

test('title histories follow results through entry, correction and clearing', () => {
  const { st, W, T, ev } = cardWorld();
  const belt = M.addTitle(st, { name: 'Belt' });
  const tags = M.addTitle(st, { name: 'Tags', kind: 'tag' });
  M.setChampion(st, belt.id, { type: 'wrestler', id: W.A });
  M.setChampion(st, tags.id, { type: 'team', id: T.AC });
  // a fatal 4-way for the Belt and a triple threat tag for the Tags
  const f4 = M.bookMatch(st, ev.id, { sides: S([W.A, W.B, W.E, W.F]), titleId: belt.id });
  const ttt = M.bookMatch(st, ev.id, { sides: [{ wrestlers: [W.A, W.C], team: T.AC }, { wrestlers: [W.B, W.D], team: T.BD },
    { wrestlers: [W.E, W.F], team: T.EF }], titleId: tags.id });
  M.enterResult(st, ev.id, f4.id, { winner: 2 }, { titleChange: true });              // E wins the Belt
  M.enterResult(st, ev.id, ttt.id, { winner: 0 });                                    // AC retain
  assert.equal(M.currentReign(st, belt.id).holder.id, W.E);
  assert.equal(M.currentReign(st, tags.id).holder.id, T.AC);
  assert.equal(M.defencesOf(st, M.currentReign(st, tags.id)), 1, 'a retention is a defence');
  // correction: it was F who won the fatal 4-way - the same reign, a different champion
  const reign = M.currentReign(st, belt.id);
  M.updateMatch(st, ev.id, f4.id, { sides: f4.sides, titleId: belt.id, winner: 3 }, { titleChange: true });
  assert.equal(M.currentReign(st, belt.id), reign);
  assert.equal(reign.holder.id, W.F);
  // correction: EF won the tag titles after all
  M.updateMatch(st, ev.id, ttt.id, { sides: ttt.sides, titleId: tags.id, winner: 2 }, { titleChange: true });
  assert.equal(M.currentReign(st, tags.id).holder.id, T.EF);
  assert.deepEqual(M.titleReigns(st, tags.id).map(r => r.holder.id), [T.AC, T.EF]);
  // clearing the Belt result hands it back to A; entering it again crowns F again
  M.clearResult(st, ev.id, f4.id);
  assert.equal(M.currentReign(st, belt.id).holder.id, W.A);
  assert.equal(M.titleReigns(st, belt.id).length, 1);
  M.enterResult(st, ev.id, f4.id, { winner: 3 }, { titleChange: true });
  assert.equal(M.currentReign(st, belt.id).holder.id, W.F);
  // once the Belt changes hands again later, the earlier result can't be taken back
  M.advanceWeek(st);
  const ev2 = M.addEvent(st, { showId: 'raw' });
  M.recordMatch(st, ev2.id, { sides: S([W.F, W.G]), titleId: belt.id, winner: 1 }, { titleChange: true });
  const pinned = frozen(st);
  throwsUE(() => M.clearResult(st, ev.id, f4.id), /changed hands or been vacated since this match/);
  throwsUE(() => M.deleteMatch(st, ev.id, f4.id), /since this match/);
  assert.equal(frozen(st), pinned);
  sound(st);
});

test('same-week shows are ordered by night: Monday’s change can’t land after Friday’s', () => {
  const st = M.createUniverse();
  const [a, b, c] = ['A', 'B', 'C'].map(n => M.addWrestler(st, { name: n }));
  const belt = M.addTitle(st, { name: 'Belt' });
  const dyn1 = M.addEvent(st, { showId: 'dynamite' });      // week 1, Wednesday: A wins the vacant Belt
  M.recordMatch(st, dyn1.id, { sides: S([a.id, b.id]), titleId: belt.id, winner: 0 }, { titleChange: true });
  M.advanceWeek(st);
  const raw = M.addEvent(st, { showId: 'raw' });            // Monday
  const sd = M.addEvent(st, { showId: 'smackdown' });       // Friday
  assert.deepEqual([raw.at.day, sd.at.day], [0, 4]);
  // Friday's result is entered first...
  M.recordMatch(st, sd.id, { sides: S([a.id, c.id]), titleId: belt.id, winner: 1 }, { titleChange: true });
  // ...so Monday's can't now be recorded as changing the belt after it
  throwsUE(() => M.recordMatch(st, raw.id, { sides: S([a.id, b.id]), titleId: belt.id, winner: 1 }, { titleChange: true }),
    /began in season 1, week 2 \(Friday\), later than season 1, week 2 \(Monday\)/);
  // a PLE defaults to Saturday; nights sort the week
  const ple = M.addEvent(st, { kind: 'ple', name: 'Clash' });
  const nxt = M.addEvent(st, { showId: 'nxt' });
  assert.deepEqual(M.eventsIn(st, M.activeSeason(st).id).map(e => e.name),
    ['Dynamite · Week 1', 'Raw · Week 2', 'NXT · Week 2', 'SmackDown · Week 2', 'Clash']);
  assert.equal(ple.at.day, 5);
  // moving an event to another night carries its title change, in order
  throwsUE(() => M.updateEvent(st, sd.id, { week: 1, day: 0 }), /season 1, week 1 \(Monday\) is before the Belt reign this event ended began \(season 1, week 1 \(Wednesday\)\)/);
  M.updateEvent(st, sd.id, { week: 1, day: 3 });            // Thursday of week 1 is after Wednesday: fine
  M.updateEvent(st, sd.id, { week: 2, day: 4 });
  M.updateEvent(st, sd.id, { day: 6 });
  assert.equal(M.currentReign(st, belt.id).start.day, 6);
  assert.ok(nxt);
  sound(st);
});

test('a season start date puts every show on the calendar', () => {
  const st = M.createUniverse();
  const s = M.activeSeason(st);
  assert.equal(M.calendarDate(st, s.id, 3, 0), null, 'no start date: plain weeks');
  M.setSeasonStart(st, s.id, '2026-01-07');                 // a Wednesday in week 1
  assert.equal(M.calendarDate(st, s.id, 1, 0), '2026-01-05', 'week 1 runs from that Monday');
  assert.equal(M.calendarDate(st, s.id, 3, 0), '2026-01-19');
  assert.equal(M.calendarDate(st, s.id, 3, 4), '2026-01-23');
  assert.equal(M.calendarDate(st, s.id, 9, 5), '2026-03-07', 'across February: 2 March + 5');
  throwsUE(() => M.setSeasonStart(st, s.id, '2026-02-30'), /isn’t a date/);
  throwsUE(() => M.setSeasonStart(st, s.id, 'soon'), /isn’t a date/);
  M.setSeasonStart(st, s.id, '');
  assert.equal(s.start, null);
  sound(st);
});

test('the card can be reordered, and history browses newest first by show', () => {
  const st = M.createUniverse();
  const [a, b, c] = ['A', 'B', 'C'].map(n => M.addWrestler(st, { name: n }));
  const raw1 = M.addEvent(st, { showId: 'raw' });
  const m1 = M.recordMatch(st, raw1.id, { sides: S([a.id, b.id]), winner: 0 });
  const m2 = M.bookMatch(st, raw1.id, { sides: S([b.id, c.id]) });
  const m3 = M.recordMatch(st, raw1.id, { sides: S([a.id, c.id]), outcome: 'draw' });
  assert.equal(M.moveMatch(st, raw1.id, m3.id, -1), true);
  assert.equal(M.moveMatch(st, raw1.id, m3.id, -1), true);
  assert.equal(M.moveMatch(st, raw1.id, m3.id, -1), false, 'already opening the show');
  assert.deepEqual(raw1.matches.map(m => m.id), [m3.id, m1.id, m2.id]);
  M.advanceWeek(st);
  const nxt2 = M.addEvent(st, { showId: 'nxt' });
  const m4 = M.recordMatch(st, nxt2.id, { sides: S([b.id, c.id]), outcome: 'nc' });
  const ple = M.addEvent(st, { kind: 'ple', name: 'Mania' });
  const m5 = M.recordMatch(st, ple.id, { sides: S([a.id, b.id, c.id]), winner: 2 });
  assert.deepEqual(M.resultsHistory(st).map(x => x.match.id), [m5.id, m4.id, m3.id, m1.id], 'booked matches aren’t history yet');
  assert.deepEqual(M.resultsHistory(st, { showId: 'raw' }).map(x => x.match.id), [m3.id, m1.id]);
  assert.deepEqual(M.resultsHistory(st, { showId: 'ple' }).map(x => x.match.id), [m5.id]);
  M.startNextSeason(st);
  const raw3 = M.addEvent(st, { showId: 'raw' });
  const m6 = M.recordMatch(st, raw3.id, { sides: S([a.id, b.id]), winner: 1 });
  assert.equal(M.resultsHistory(st)[0].match.id, m6.id);
  assert.deepEqual(M.resultsHistory(st, { seasonId: st.seasons[0].id }).length, 4);
  sound(st);
});

test('a real v2 save migrates: every result played, every show on its night, nothing relegated', async () => {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('./fixtures/universe-v2.json', import.meta.url), 'utf8');
  assert.equal(JSON.parse(text).version, 2);
  const st = importUniverse(text);
  assert.equal(st.version, M.SCHEMA_VERSION);
  assert.deepEqual([st.transitions, st.relegations], [[], []]);
  assert.ok(st.events.every(e => e.matches.every(m => m.relegation === null)));
  sound(st);
  assert.ok(st.events.every(e => e.matches.every(m => m.status === 'played' && m.fall === null)));
  const byName = n => st.events.find(e => e.name === n);
  assert.deepEqual([byName('Raw · Week 2').at.day, byName('Dynamite · Week 2').at.day, byName('Clash').at.day,
    byName('NXT · Week 2').at.day], [0, 2, 5, 1]);
  const w = n => st.wrestlers.find(x => x.name === n).id;
  const t = n => st.teams.find(x => x.name === n).id;
  assert.deepEqual(M.wrestlerRecord(st, w('Rhea Ripley')).singles, R(2));
  assert.deepEqual(M.teamRecord(st, t('The Elite Two')), R(1, 0, 0, 1));
  assert.deepEqual(M.teamRecord(st, t('The Usos')), R(0, 1, 0, 2));
  assert.equal(M.holderName(st, M.currentReign(st, st.titles.find(x => x.name === "Women's World Championship").id).holder), 'Rhea Ripley');
});

test('a save claiming a booked match has a result is refused', () => {
  const st = M.createUniverse();
  const [a, b] = ['A', 'B'].map(n => M.addWrestler(st, { name: n }));
  const ev = M.addEvent(st, { showId: 'raw' });
  M.bookMatch(st, ev.id, { sides: S([a.id, b.id]) });
  const bad = JSON.parse(JSON.stringify(st));
  bad.events[0].matches[0].winner = 0;
  throwsUE(() => importUniverse(JSON.stringify(bad)), /only booked but has a result/);
  const odd = JSON.parse(JSON.stringify(st));
  odd.events[0].matches[0].status = 'maybe';
  throwsUE(() => importUniverse(JSON.stringify(odd)), /neither booked nor played/);
});

// ---------------------------------------------------------------- the claude.ai copy
//
// Published as an artifact, the app keeps the universe in the viewer's own
// space in the artifact's database. A stand-in with the same shape: documents
// in a Map, the viewer's id, a save prompt that records what it was given.

function fakeClaude(store = new Map(), { uid = 'viewer-1', failOn = null } = {}) {
  const saved = [];
  const snap = path => {
    const v = store.get(path);
    return { id: path.split('/').pop(), exists: v !== undefined, data: () => v && JSON.parse(JSON.stringify(v)),
      metadata: { fromCache: false, hasPendingWrites: false } };
  };
  const doc = path => ({
    path,
    get: async () => snap(path),
    set: async data => {
      if (failOn && failOn(path)) throw { code: 'unavailable', message: 'down' };
      store.set(path, JSON.parse(JSON.stringify(data)));
    },
    delete: async () => { store.delete(path); },
    acquire: async () => ({ acquired: true }),
    onSnapshot: () => () => {},
  });
  const db = { doc, collection: p => ({ path: p, doc: id => doc(`${p}/${id}`) }) };
  const ns = { db, user: { id: async () => uid }, downloads: { save: async r => { saved.push(r); return { status: 'saved' }; } } };
  return { use: async name => ns[name] || null, store, saved };
}
const memory = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
};
// one browser with the app open: its universe, its storage, its claude.ai copy
function device(claude, st = M.createUniverse(), storage = memory()) {
  const d = { st, storage, adopted: 0 };
  d.cloud = createCloud({ claude, storage, delay: 0, current: () => d.st, adopt: x => { d.st = x; d.adopted++; } });
  return d;
}
function bigUniverse(n) {
  const st = M.createUniverse();
  for (let i = 0; i < n; i++) M.addWrestler(st, { name: `Wrestler ${i}`, showId: M.SHOW_SEED[i % 4].id, notes: 'x'.repeat(400) });
  return st;
}

test('as an artifact, the universe goes to the claude.ai copy, and a new browser opens it', async () => {
  const claude = fakeClaude();
  const st = M.createUniverse();
  M.addWrestler(st, { name: 'Cody Rhodes', showId: 'smackdown' });
  const a = device(claude, st);
  await a.cloud.start();
  const man = claude.store.get('data/users/viewer-1/save');
  assert.equal(man.rev, 1);
  assert.equal(a.cloud.status().mode, 'synced');

  const b = device(claude);                                          // another browser: nothing stored locally
  await b.cloud.start();
  assert.equal(b.adopted, 1);
  assert.deepEqual(b.st, a.st);

  M.addWrestler(b.st, { name: 'Gunther', showId: 'raw' });           // a change there goes up
  assert.equal(b.cloud.changed(b.st), true);
  await b.cloud.flush();
  const c = device(claude);
  await c.cloud.start();
  assert.deepEqual(c.st.wrestlers.map(w => w.name), ['Cody Rhodes', 'Gunther']);
  assert.equal(claude.store.get('data/users/viewer-1/save').rev, 2);
  // nothing lands outside the viewer's own space
  assert.ok([...claude.store.keys()].every(k => k.startsWith('data/users/viewer-1/')));
});

test('a universe too big for one document is split, and reads back whole', async () => {
  const claude = fakeClaude();
  const a = device(claude, bigUniverse(500));
  await a.cloud.start();
  const man = claude.store.get('data/users/viewer-1/save');
  assert.ok(man.parts[man.slot] >= 3, `${man.parts[man.slot]} parts`);
  for (const [k, v] of claude.store) assert.ok(JSON.stringify(v).length < 200 * 1024, `${k} fits in a document`);
  const b = device(claude);
  await b.cloud.start();
  assert.deepEqual(b.st, a.st);
  // shrinking tidies the parts the smaller save no longer needs, in its slot
  a.st = bigUniverse(5);
  a.cloud.changed(a.st);
  await a.cloud.flush();
  a.st = bigUniverse(4);
  a.cloud.changed(a.st);
  await a.cloud.flush();
  const now = claude.store.get('data/users/viewer-1/save');
  const leftover = [...claude.store.keys()].filter(k => k.includes(`/${now.slot}-`)).length;
  assert.equal(leftover, now.parts[now.slot]);
});

test('a save cut off before it finishes leaves the last one whole', async () => {
  let failing = false;
  const claude = fakeClaude(new Map(), { failOn: p => failing && p.endsWith('/save') });
  const st = M.createUniverse();
  M.addWrestler(st, { name: 'Cody Rhodes' });
  const a = device(claude, st);
  await a.cloud.start();
  failing = true;                                                    // parts go in, the manifest doesn't
  M.addWrestler(a.st, { name: 'Gunther' });
  a.cloud.changed(a.st);
  await a.cloud.flush();
  assert.equal(a.cloud.status().mode, 'error');
  assert.equal(JSON.parse(a.storage.getItem('wwe_universe_v1:cloud')).dirty, true);
  const b = device(claude);
  await b.cloud.start();
  assert.deepEqual(b.st.wrestlers.map(w => w.name), ['Cody Rhodes']);
  failing = false;                                                   // and the next try gets it up
  await a.cloud.flush();
  const c = device(claude);
  await c.cloud.start();
  assert.deepEqual(c.st.wrestlers.map(w => w.name), ['Cody Rhodes', 'Gunther']);
});

test('a change this browser hadn’t sent yet goes up; one a newer save overtook is kept aside', async () => {
  const claude = fakeClaude();
  const st = M.createUniverse();
  M.addWrestler(st, { name: 'Cody Rhodes' });
  const a = device(claude, st);
  await a.cloud.start();                                             // rev 1, this browser in step
  const behind = JSON.parse(JSON.stringify(a.st));

  // the page closed before a change went up: next time it's sent, not replaced
  M.addWrestler(a.st, { name: 'Gunther' });
  a.storage.setItem('wwe_universe_v1:cloud', JSON.stringify({ rev: 1, dirty: true }));
  const again = device(claude, a.st, a.storage);
  await again.cloud.start();
  assert.equal(again.adopted, 0);
  assert.equal(claude.store.get('data/users/viewer-1/save').rev, 2);

  // meanwhile another browser was behind (rev 1) with its own unsent change: the newer save wins
  const other = device(claude, behind, memory());
  other.storage.setItem('wwe_universe_v1:cloud', JSON.stringify({ rev: 1, dirty: true }));
  await other.cloud.start();
  assert.equal(other.adopted, 1);
  assert.deepEqual(other.st.wrestlers.map(w => w.name), ['Cody Rhodes', 'Gunther']);
  assert.ok(other.storage.getItem('wwe_universe_v1:before-sync'));
});

test('an unreadable claude.ai copy is never written over', async () => {
  const store = new Map([['data/users/viewer-1/save', { rev: 3, slot: 'a', parts: { a: 2 } }], ['data/users/viewer-1/a-0', { s: '{"app":' }]]);
  const claude = fakeClaude(store);
  const st = M.createUniverse();
  M.addWrestler(st, { name: 'Cody Rhodes' });
  const a = device(claude, st);
  await a.cloud.start();
  assert.equal(a.cloud.status().mode, 'error');
  assert.equal(a.cloud.changed(a.st), false);
  await a.cloud.flush();
  assert.equal(store.get('data/users/viewer-1/save').rev, 3);
});

test('a view that can’t keep a copy leaves the app as it was; export uses the save prompt', async () => {
  const none = device({ use: async () => null });
  await none.cloud.start();
  assert.equal(none.cloud.status().mode, 'off');
  assert.equal(none.cloud.changed(none.st), false);
  assert.equal(none.storage.getItem('wwe_universe_v1:cloud'), null);
  assert.equal(await none.cloud.exportFile('x.json', '{}'), 'unavailable');

  const claude = fakeClaude();
  const a = device(claude);
  assert.equal(await a.cloud.exportFile('wwe-universe-season1-week1.json', exportUniverse(a.st)), 'saved');
  assert.equal(claude.saved[0].filename, 'wwe-universe-season1-week1.json');
  assert.deepEqual(importUniverse(claude.saved[0].data), a.st);
});

// ---------------------------------------------------------------- standings and rankings

// Raw: A, B, C, D (men), G (a woman); a team of A & B, and one of C & D.
function standingsWorld() {
  const st = M.createUniverse();
  const [A, B, C, D] = ['A', 'B', 'C', 'D'].map(n => M.addWrestler(st, { name: n, showId: 'raw' }));
  const G = M.addWrestler(st, { name: 'G', showId: 'raw', gender: 'female' });
  const T1 = M.addTeam(st, { name: 'T1', members: [A.id, B.id] });
  const T2 = M.addTeam(st, { name: 'T2', members: [C.id, D.id] });
  const T3 = M.addTeam(st, { name: 'T3', members: [G.id, D.id] });
  const ev = M.addEvent(st, { showId: 'raw' });
  const play = (sides, input) => M.recordMatch(st, ev.id, { sides, ...input });
  play(S([A.id, B.id]), { winner: 0 });                                     // A def. B
  play(S([A.id, C.id]), { winner: 0 });                                     // A def. C
  play(S([B.id, C.id]), { outcome: 'draw' });                               // B drew C
  play([{ team: T1.id, wrestlers: [A.id, B.id] }, { team: T2.id, wrestlers: [C.id, D.id] }], { winner: 0 });
  play(S([[A.id, D.id], [B.id, C.id]]), { winner: 1 });                     // makeshift: B & C def. A & D
  play(S([G.id, D.id]), { outcome: 'nc' });                                 // no contest: ranks nobody
  return { st, A, B, C, D, G, T1, T2, T3 };
}
const names = rows => rows.map(r => `${r.rank ?? '-'}:${r.name}`);

test('the ranking score is a winning percentage with one win and one loss added', () => {
  assert.equal(SD.rating(R(1)), 2 / 3);
  assert.equal(SD.rating(R(5)), 6 / 7);
  assert.equal(SD.rating(R(10, 2)), 11 / 14);
  assert.equal(SD.rating(R(0, 0, 2)), 0.5);                                 // two draws: even
  assert.equal(SD.rating(R(1, 0, 0, 7)), 2 / 3);                            // no contests don't count
  assert.ok(SD.rating(R(5)) > SD.rating(R(10, 2)) && SD.rating(R(10, 2)) > SD.rating(R(1)));
});

test('standings keep singles, tag and team records apart', () => {
  const { st } = standingsWorld();
  const season = SD.periodOf(st, M.activeSeason(st).id);
  const singles = SD.standings(st, { showId: 'raw', period: season, kind: 'singles' });
  // A 2-0 (75%), B 0-1-1 and C 0-1-1 (37.5%, tied: same rank); D and G have no wins, losses or draws
  assert.deepEqual(names(singles.ranked), ['1:A', '2:B', '2:C']);
  assert.deepEqual(singles.ranked.map(r => r.rec), [R(2), R(0, 1, 1), R(0, 1, 1)]);
  assert.deepEqual(names(singles.unranked), ['-:D', '-:G']);
  assert.deepEqual(singles.unranked.find(r => r.name === 'G').rec, R(0, 0, 0, 1));
  // tag: B won both (as T1, then with C), C split, A split, D lost both
  const tag = SD.standings(st, { showId: 'raw', period: season, kind: 'tag' });
  assert.deepEqual(names(tag.ranked), ['1:B', '2:A', '2:C', '4:D']);
  assert.deepEqual(tag.ranked.map(r => r.rec), [R(2), R(1, 1), R(1, 1), R(0, 2)]);
  // teams rank on their own matches only; T3 is together but hasn't wrestled
  const teams = SD.standings(st, { showId: 'raw', period: season, kind: 'teams' });
  assert.deepEqual(names(teams.ranked), ['1:T1', '2:T2']);
  assert.deepEqual(names(teams.unranked), ['-:T3']);
  // recent form, newest first, and the streak
  const a = singles.ranked[0];
  assert.deepEqual([a.form, a.streak], [['W', 'W'], { type: 'W', n: 2 }]);
});

test('season and all-time standings, each wrestler on the show they were on then', () => {
  const { st, A, C, D } = standingsWorld();
  M.startNextSeason(st);
  const ev = M.addEvent(st, { showId: 'raw' });
  M.recordMatch(st, ev.id, { sides: S([C.id, A.id]), winner: 0 });           // season 2: C def. A
  M.assignWrestler(st, D.id, 'smackdown');
  const [s1, s2] = st.seasons;
  const rawS1 = SD.standings(st, { showId: 'raw', period: SD.periodOf(st, s1.id) });
  const rawS2 = SD.standings(st, { showId: 'raw', period: SD.periodOf(st, s2.id) });
  const rawAll = SD.standings(st, { showId: 'raw', period: SD.periodOf(st, 'all') });
  const sdAll = SD.standings(st, { showId: 'smackdown', period: SD.periodOf(st, 'all') });
  assert.deepEqual(names(rawS1.ranked), ['1:A', '2:B', '2:C']);            // season 1 as it ended
  assert.ok(rawS1.unranked.some(r => r.name === 'D'), 'D was on Raw when season 1 ended');
  assert.deepEqual(names(rawS2.ranked), ['1:C', '2:A']);                   // season 2 alone: C 1-0, A 0-1
  assert.ok(![...rawS2.ranked, ...rawS2.unranked].some(r => r.name === 'D'), 'D is on SmackDown now');
  // all time: A 2-1 (60%), C 1-1-1 (50%), B 0-1-1
  assert.deepEqual(names(rawAll.ranked), ['1:A', '2:C', '3:B']);
  assert.deepEqual(rawAll.ranked.map(r => r.rec), [R(2, 1), R(1, 1, 1), R(0, 1, 1)]);
  assert.deepEqual(sdAll.unranked.map(r => r.name), ['D']);
  // every show at once
  const every = SD.standings(st, { period: SD.periodOf(st, 'all') });
  assert.deepEqual(names(every.ranked), ['1:A', '2:C', '3:B']);
});

test('rankings never stand in the way of a title: the bottom of the table can win it', () => {
  const st = M.createUniverse();
  const champ = M.addWrestler(st, { name: 'Champ', showId: 'raw' });
  const jobber = M.addWrestler(st, { name: 'Jobber', showId: 'raw' });
  const rookie = M.addWrestler(st, { name: 'Rookie', showId: 'nxt' });      // never wrestled, another show
  const whc = M.addTitle(st, { name: 'World Heavyweight Championship', showId: 'raw' });
  M.setChampion(st, whc.id, { type: 'wrestler', id: champ.id });
  const ev = M.addEvent(st, { showId: 'raw' });
  for (let i = 0; i < 5; i++) M.recordMatch(st, ev.id, { sides: S([champ.id, jobber.id]), winner: 0 });
  const table = SD.standings(st, { showId: 'raw', period: SD.periodOf(st, 'all') });
  assert.deepEqual(names(table.ranked), ['1:Champ', '2:Jobber']);          // 5-0 against 0-5

  const title = M.bookMatch(st, ev.id, { sides: S([champ.id, jobber.id]), titleId: whc.id });
  M.enterResult(st, ev.id, title.id, { outcome: 'win', winner: 1 }, { titleChange: true });
  assert.equal(M.currentReign(st, whc.id).holder.id, jobber.id);
  const next = M.bookMatch(st, ev.id, { sides: S([jobber.id, rookie.id]), titleId: whc.id });
  M.enterResult(st, ev.id, next.id, { outcome: 'win', winner: 1 }, { titleChange: true });
  assert.equal(M.currentReign(st, whc.id).holder.id, rookie.id);
  sound(st);
});

test('booking and results never consult the rankings', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const f of ['model.js', 'card.js']) {
    const src = await readFile(new URL(`../js/universe/${f}`, import.meta.url), 'utf8');
    assert.ok(!/standings/.test(src), `${f} doesn't use the standings`);
  }
});

// ---------------------------------------------------------------- booking balance

// Season 2, weeks 1-4 on Raw (season 1 held one E v C rivalry each week).
//   men    A 4, B 4, C 3, D 4, F 1, E 0 matches; J arrives from SmackDown in
//          week 3 (0 matches); K arrives from NXT in week 4; L is injured
//   women  G 1, H 1, I 0
function balanceWorld() {
  const st = M.createUniverse();
  const add = (n, show, gender = 'male') => M.addWrestler(st, { name: n, showId: show, gender });
  const [A, B, C, D, E, F] = ['A', 'B', 'C', 'D', 'E', 'F'].map(n => add(n, 'raw'));
  const J = add('J', 'smackdown'), K = add('K', 'nxt'), L = add('L', 'raw');
  const [G, H, I] = ['G', 'H', 'I'].map(n => add(n, 'raw', 'female'));
  M.updateWrestler(st, L.id, { status: 'injured' });
  // season 1: E and C meet twice, one win each
  const old = M.addEvent(st, { showId: 'raw' });
  M.recordMatch(st, old.id, { sides: S([E.id, C.id]), winner: 0 });
  M.recordMatch(st, old.id, { sides: S([E.id, C.id]), winner: 1 });
  M.startNextSeason(st);
  const weeks = {
    1: [[A, B], [C, D]], 2: [[A, B], [C, D], [G, H]], 3: [[A, D], [B, F]], 4: [[A, D], [B, C]],
  };
  for (let wk = 1; wk <= 4; wk++) {
    M.setWeek(st, wk);
    if (wk === 3) M.assignWrestler(st, J.id, 'raw');
    if (wk === 4) M.assignWrestler(st, K.id, 'raw');
    const ev = M.addEvent(st, { showId: 'raw' });
    weeks[wk].forEach(([x, y]) => M.recordMatch(st, ev.id, { sides: S([x.id, y.id]), winner: 0 }));
  }
  return { st, A, B, C, D, E, F, J, K, L, G, H, I };
}
const byId = (res, id) => res.groups.flatMap(g => g.rows).find(r => r.id === id);

test('balance: a period is the most recent weeks of the season, or the whole season', () => {
  const { st } = balanceWorld();
  M.setWeek(st, 6);
  const p = SD.periodOf(st, 'last4');
  assert.deepEqual([p.from, p.to, p.label], [3, 6, 'Last 4 weeks']);
  assert.deepEqual([SD.periodOf(st, 'last8').from, SD.periodOf(st, M.activeSeason(st).id).from], [1, 1]);
});

test('balance: flags only wrestlers far below what is typical in their division on the show', () => {
  const { st, A, C, E, F, J, K, L, I } = balanceWorld();
  const res = SD.balance(st, { showId: 'raw', period: SD.periodOf(st, 'last4') });
  const men = res.groups.find(g => g.key === 'male');
  // judged: A B C D E F (4 weeks) and J (2 weeks) - not K (1 week), not L (injured)
  // rates 1 1 .75 1 0 .25 0 -> median .75 a week
  assert.equal(men.judged, 7);
  assert.equal(men.typical, 0.75);
  const e = byId(res, E.id), f = byId(res, F.id), j = byId(res, J.id);
  assert.deepEqual([e.weeks, e.matches, e.expected, e.short, e.flagged, e.severity], [4, 0, 3, 3, true, 'well below']);
  assert.deepEqual([f.matches, f.short, f.flagged, f.severity], [1, 2, true, 'below']);
  // J arrived in week 3: judged on 2 weeks, 1.5 matches short - not enough to flag
  assert.deepEqual([j.weeks, j.short, j.flagged], [2, 1.5, false]);
  assert.deepEqual([byId(res, K.id).weeks, byId(res, K.id).judged, byId(res, K.id).flagged], [1, false, false]);
  assert.deepEqual([byId(res, L.id).injured, byId(res, L.id).flagged], [true, false]);
  assert.equal(byId(res, C.id).flagged, false);                            // .75: exactly typical
  assert.equal(byId(res, A.id).flagged, false);
  // the women are compared with each other: .25 .25 0 -> typical .25, I is 1 short: a quiet division flags nobody
  const women = res.groups.find(g => g.key === 'female');
  assert.equal(women.typical, 0.25);
  assert.equal(byId(res, I.id).flagged, false);
  // over the whole season it's the same four weeks
  const season = SD.balance(st, { showId: 'raw', period: SD.periodOf(st, M.activeSeason(st).id) });
  assert.deepEqual(season.groups.flatMap(g => g.rows.filter(r => r.flagged).map(r => r.name)), ['E', 'F']);
});

test('balance: a smaller show is judged on its own terms, never against another show', () => {
  const { st } = balanceWorld();
  // SmackDown now has one wrestler, nobody to compare with
  const res = SD.balance(st, { showId: 'smackdown', period: SD.periodOf(st, 'last4') });
  assert.ok(res.groups.every(g => !g.enough && g.rows.every(r => !r.flagged)));
});

test('balance: teams are compared with the show’s other teams, on matches as the team', () => {
  const st = M.createUniverse();
  const w = Array.from({ length: 10 }, (_, i) => M.addWrestler(st, { name: `W${i}`, showId: 'raw' }));
  const team = (n, a, b) => M.addTeam(st, { name: n, members: [w[a].id, w[b].id] });
  const [T1, T2, T3, T4] = [team('T1', 0, 1), team('T2', 2, 3), team('T3', 4, 5), team('T4', 6, 7)];
  const side = t => ({ team: t.id, wrestlers: [...t.members] });
  const plan = { 1: [[T1, T2]], 2: [[T1, T3]], 3: [[T2, T3]], 4: [[T1, T2]] };
  for (let wk = 1; wk <= 4; wk++) {
    M.setWeek(st, wk);
    const ev = M.addEvent(st, { showId: 'raw' });
    plan[wk].forEach(([x, y]) => M.recordMatch(st, ev.id, { sides: [side(x), side(y)], winner: 0 }));
    // T4's members wrestle each week, but never as T4
    M.recordMatch(st, ev.id, { sides: S([w[6].id, w[8].id]), winner: 0 });
    M.recordMatch(st, ev.id, { sides: S([[w[7].id, w[9].id], [w[4].id, w[5].id]]), winner: 0 });
  }
  const res = SD.balance(st, { showId: 'raw', period: SD.periodOf(st, 'last4') });
  const teams = res.groups.find(g => g.key === 'teams');
  // T1 3, T2 3, T3 2, T4 0 -> rates .75 .75 .5 0, median .625; T4 is 2.5 short
  assert.equal(teams.typical, 0.625);
  assert.deepEqual(teams.rows.filter(r => r.flagged).map(r => [r.name, r.matches, r.short]), [['T4', 0, 2.5]]);
  // and its members are busy, so they're not short themselves
  assert.equal(byId(res, w[6].id).flagged, false);
  // ideas for T4: another team on the show, never one sharing a member
  const ideas = SD.matchIdeas(st, { kind: 'team', id: T4.id }, { showId: 'raw', balanceResult: res });
  assert.ok(ideas.length && ideas.every(i => ['T1', 'T2', 'T3'].includes(i.opponent.name)));
  assert.deepEqual(ideas[0].lineup[0], { team: T4.id, wrestlers: T4.members });
});

test('match ideas: available opponents, ranked on need, rivalry and standings - and only ideas', () => {
  const { st, E, F, C, A, G, J, L } = balanceWorld();
  const res = SD.balance(st, { showId: 'raw', period: SD.periodOf(st, 'last4') });
  const ideas = SD.matchIdeas(st, { kind: 'wrestler', id: E.id }, { showId: 'raw', balanceResult: res });
  // F: both short (+3), never met (+.75) = 3.75. C: rivalry from season 1 (+2), #2 in this
  // season's standings (+.75) = 2.75. A: never met (+.75), #1 (+.75) = 1.5, ahead of B on name
  assert.deepEqual(ideas.map(i => i.opponent.name), ['F', 'C', 'A']);
  assert.deepEqual(ideas[0].reasons, ['Both are short of matches', 'Fresh matchup: they’ve never met']);
  assert.deepEqual(ideas[1].reasons, ['Rivalry: met 2 times — E 1, C 1', 'A shot at #2 C']);
  // a suggestion is only a line-up: no winner, no result, nothing booked
  assert.deepEqual(ideas[0].lineup, [{ team: '', wrestlers: [E.id] }, { team: '', wrestlers: [F.id] }]);
  assert.equal(st.events.flatMap(e => e.matches).filter(m => m.status === 'scheduled').length, 0);
  // never the injured, the other division, or another show's wrestlers
  const all = SD.matchIdeas(st, { kind: 'wrestler', id: E.id }, { showId: 'raw', balanceResult: res, });
  assert.ok(!all.some(i => [L.id, G.id].includes(i.opponent.id)));
  // once F is booked for this week, F drops behind C
  const ev = st.events[st.events.length - 1];
  M.bookMatch(st, ev.id, { sides: S([F.id, J.id]) });
  const again = SD.matchIdeas(st, { kind: 'wrestler', id: E.id }, { showId: 'raw', balanceResult: res });
  assert.deepEqual(again.slice(0, 2).map(i => i.opponent.name), ['C', 'F']);
  assert.match(again[1].note, /already booked/);
});

// ---------------------------------------------------------------- the season transition: relegation
//
// Season 1. Wins before WrestleMania (all at an NXT house show, against N1;
// R1, S1 and S2 each lose there once, so everyone has wrestled):
//   Raw        R1 0, R2 1, R3 1, R4 2, R5 2 (+1 at WrestleMania = 3), R6 4
//   SmackDown  S1 0, S2 0, S3 1, S4 2, S5 5
//   Dynamite   D1 1, D2 1, D3 1
// WrestleMania is a Saturday PLE in week 4.
function relegationWorld() {
  const st = M.createUniverse();
  const add = (n, show) => M.addWrestler(st, { name: n, showId: show });
  const rw = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'].map(n => add(n, 'raw'));
  const sw = ['S1', 'S2', 'S3', 'S4', 'S5'].map(n => add(n, 'smackdown'));
  const dw = ['D1', 'D2', 'D3'].map(n => add(n, 'dynamite'));
  const n1 = add('N1', 'nxt');
  const wins = [[rw[1], 1], [rw[2], 1], [rw[3], 2], [rw[4], 2], [rw[5], 4], [sw[2], 1], [sw[3], 2], [sw[4], 5], [dw[0], 1], [dw[1], 1], [dw[2], 1]];
  M.setWeek(st, 2);
  const house = M.addEvent(st, { showId: 'nxt' });
  wins.forEach(([w, n]) => { for (let i = 0; i < n; i++) M.recordMatch(st, house.id, { sides: S([w.id, n1.id]), winner: 0 }); });
  [rw[0], sw[0], sw[1]].forEach(w => M.recordMatch(st, house.id, { sides: S([w.id, n1.id]), winner: 1 }));
  M.setWeek(st, 4);
  const wm = M.addEvent(st, { kind: 'ple', name: 'WrestleMania', week: 4 });
  M.recordMatch(st, wm.id, { sides: S([rw[4].id, n1.id]), winner: 0 });
  const tr = M.startTransition(st, wm.id);
  const id = w => w.id;
  return { st, rw, sw, dw, n1, wm, tr, id };
}
const keys = t => t.flags.map(f => `${f.level}:${f.key}`);
const cand = (st, t) => t.candidates.map(id => M.wrestlerById(st, id).name);

test('relegation candidates are the fewest wins on each show; a tie at the cutoff is left to the owner', () => {
  const { st, tr, wm } = relegationWorld();
  const raw = M.relegationTable(st, tr.id, 'raw');
  assert.deepEqual(raw.pool.map(r => `${r.name}:${r.wins}`), ['R1:0', 'R2:1', 'R3:1', 'R4:2', 'R5:3', 'R6:4']);
  assert.deepEqual(raw.pool.map(r => r.place), [1, 2, 2, 4, 5, 6]);
  assert.equal(raw.pool.find(r => r.name === 'R5').matches, 3);                // WrestleMania counts
  // two candidates: R1 for sure; R2 and R3 tie for the second spot
  assert.deepEqual([cand(st, raw), raw.tied.map(r => r.name)], [['R1'], ['R2', 'R3']]);
  assert.deepEqual(keys(raw), ['decide:tie']);                               // R1 alone is the tie's doing, not flagged twice
  assert.match(raw.flags[0].text, /R2 and R3 are tied on 1 win for the last candidate spot/);
  const night = M.addEvent(st, { showId: 'raw', week: 5 });
  throwsUE(() => M.bookRelegation(st, tr.id, 'raw', night.id), /tied on 1 win/);

  // SmackDown holds more this year, Dynamite none: nothing has to match
  M.setCandidateCount(st, tr.id, 'smackdown', 4);
  const sd = M.relegationTable(st, tr.id, 'smackdown');
  assert.deepEqual(cand(st, sd), ['S1', 'S2', 'S3', 'S4']);
  assert.deepEqual(sd.pairs.map(p => [p.a, p.b].map(x => M.wrestlerById(st, x).name).join('-')), ['S1-S2', 'S3-S4']);
  assert.deepEqual(sd.blocking, []);
  const dyn = M.relegationTable(st, tr.id, 'dynamite');
  assert.deepEqual([cand(st, dyn), dyn.tied.length, keys(dyn)], [[], 3, ['decide:tie']]);
  M.setCandidateCount(st, tr.id, 'dynamite', 0);
  assert.deepEqual(keys(M.relegationTable(st, tr.id, 'dynamite')), []);
  assert.equal(M.relegationTable(st, tr.id, 'raw').wm.id, wm.id);
  assert.ok(!('nxt' in tr.shows), 'NXT holds no relegation matches');
  sound(st);
});

test('the owner settles the tie and books the match on the first show after WrestleMania', () => {
  const { st, tr, rw } = relegationWorld();
  M.toggleCandidate(st, tr.id, 'raw', rw[2].id);                            // R3 takes the tied spot
  let raw = M.relegationTable(st, tr.id, 'raw');
  assert.deepEqual([cand(st, raw), keys(raw)], [['R1', 'R3'], ['check:picked']]);
  assert.match(raw.flags[0].text, /Picked by you — added R3/);
  // no Raw after WrestleMania yet: it would be Monday of week 5
  assert.deepEqual([raw.night.event, raw.night.week], [undefined, 5]);
  const before = M.addEvent(st, { showId: 'raw', week: 4 });                 // Monday of WrestleMania week
  const sd = M.addEvent(st, { showId: 'smackdown', week: 5 });
  const night = M.addEvent(st, { showId: 'raw', week: 5 });
  assert.equal(M.relegationTable(st, tr.id, 'raw').night.event.id, night.id);
  throwsUE(() => M.bookRelegation(st, tr.id, 'raw', before.id), /come after WrestleMania/);
  throwsUE(() => M.bookRelegation(st, tr.id, 'raw', sd.id), /go on a Raw episode/);
  const [m] = M.bookRelegation(st, tr.id, 'raw', night.id);
  assert.deepEqual([m.status, m.stip, m.relegation.show, m.winner], ['scheduled', 'Relegation match', 'raw', null]);
  raw = M.relegationTable(st, tr.id, 'raw');
  assert.equal(raw.pairs[0].status, 'booked');
  throwsUE(() => M.toggleCandidate(st, tr.id, 'raw', rw[0].id), /booked in a relegation match/);
  throwsUE(() => M.useWinTotals(st, tr.id, 'raw'), /candidates are fixed/);
  throwsUE(() => M.bookRelegation(st, tr.id, 'raw', night.id), /already booked/);
  sound(st);
});

function bookedRaw() {
  const w = relegationWorld();
  M.toggleCandidate(w.st, w.tr.id, 'raw', w.rw[2].id);
  const night = M.addEvent(w.st, { showId: 'raw', week: 5 });
  const [m] = M.bookRelegation(w.st, w.tr.id, 'raw', night.id);
  const who = m.sides.findIndex(sd => sd.wrestlers[0] === w.rw[2].id);         // R3's side
  return { ...w, night, m, r3: who, r1: 1 - who };
}

test('the loser moves to NXT the moment the result is entered, with why kept for good', () => {
  const { st, tr, rw, night, m, r3 } = bookedRaw();
  M.recordMatch(st, night.id, { sides: S([rw[0].id, rw[5].id]), winner: 0 });  // after WrestleMania: not counted
  M.enterResult(st, night.id, m.id, { outcome: 'win', winner: r3 });
  const R1 = M.wrestlerById(st, rw[0].id);
  assert.equal(R1.showId, 'nxt');
  assert.equal(M.wrestlerById(st, rw[2].id).showId, 'raw');                    // the winner stays
  const mv = M.movesOf(st, R1.id).pop();
  assert.deepEqual([mv.from, mv.to, mv.at.week, mv.at.day, mv.note], ['raw', 'nxt', 5, 0, 'Relegated — lost to R3']);
  const [rec] = M.relegationsOf(st, R1.id);
  assert.deepEqual([rec.show, rec.from, rec.wins, rec.place, rec.of, rec.candidate, rec.opponent, rec.match],
    ['raw', 'raw', 0, 1, 6, 'fewest wins', rw[2].id, m.id]);
  assert.equal(rec.reason, 'Lost the Raw relegation match to R3 at Raw · Week 5 (Season 1). A relegation candidate for the fewest wins: '
    + '0 wins in Season 1 up to WrestleMania — 1st fewest of 6 on Raw.');
  const t = M.relegationTable(st, tr.id, 'raw');
  assert.equal(t.pairs[0].status, 'relegated');
  assert.equal(t.pool.find(r => r.name === 'R1').wins, 0);
  assert.equal(t.pool.find(r => r.name === 'R1').now, 'nxt');
  assert.ok(M.careerOf(st, R1.id).some(e => e.type === 'move' && e.move.to === 'nxt'));
  // R3 was the owner's pick, and the record would say so
  M.updateMatch(st, night.id, m.id, { sides: m.sides, outcome: 'win', winner: 1 - r3 });
  assert.equal(M.relegationsOf(st, rw[2].id)[0].candidate, 'owner');
  assert.match(M.relegationsOf(st, rw[2].id)[0].reason, /Picked as a candidate by the owner, with 1 win in Season 1 up to WrestleMania \(joint 2nd fewest of 6 on Raw\)/);
  sound(st);
});

test('correcting a relegation result swaps who goes down; clearing or deleting it brings them back', () => {
  const { st, tr, rw, night, m, r1, r3 } = bookedRaw();
  const show = id => M.wrestlerById(st, id).showId;
  M.enterResult(st, night.id, m.id, { outcome: 'win', winner: r3 });
  M.updateMatch(st, night.id, m.id, { sides: m.sides, outcome: 'win', winner: r1 });      // R1 won after all
  assert.deepEqual([show(rw[0].id), show(rw[2].id)], ['raw', 'nxt']);
  assert.deepEqual(st.relegations.map(r => M.wrestlerById(st, r.wrestler).name), ['R3']);
  M.updateMatch(st, night.id, m.id, { sides: m.sides, outcome: 'win', winner: r1, finish: 'pinfall' });   // same result, more detail
  assert.equal(st.relegations.length, 1);
  M.clearResult(st, night.id, m.id);
  assert.deepEqual([show(rw[0].id), show(rw[2].id), st.relegations.length], ['raw', 'raw', 0]);
  assert.equal(M.movesOf(st, rw[2].id).length, 1);                           // the NXT move is gone, not just reversed
  M.enterResult(st, night.id, m.id, { outcome: 'win', winner: r3 });
  M.setWeek(st, 6);
  M.assignWrestler(st, rw[0].id, 'smackdown');                                // R1 has moved on since
  throwsUE(() => M.updateMatch(st, night.id, m.id, { sides: m.sides, outcome: 'win', winner: r1 }), /R1 has moved since being relegated/);
  throwsUE(() => M.deleteMatch(st, night.id, m.id), /moved since being relegated/);
  M.undoLastMove(st, rw[0].id);
  M.deleteMatch(st, night.id, m.id);
  assert.deepEqual([show(rw[0].id), st.relegations.length], ['raw', 0]);
  assert.equal(M.relegationTable(st, tr.id, 'raw').pairs[0].status, 'unbooked');
  sound(st);
});

test('a relegation match without a winner is the owner’s decision: settle it, or book a rematch', () => {
  const { st, tr, sw } = relegationWorld();
  M.setCandidateCount(st, tr.id, 'smackdown', 4);
  const night = M.addEvent(st, { showId: 'smackdown', week: 5 });
  const [m1, m2] = M.bookRelegation(st, tr.id, 'smackdown', night.id);
  M.enterResult(st, night.id, m1.id, { outcome: 'draw' });                   // S1 v S2
  M.enterResult(st, night.id, m2.id, { outcome: 'win', winner: 1 });          // S4 beats S3
  let t = M.relegationTable(st, tr.id, 'smackdown');
  assert.deepEqual(t.pairs.map(p => p.status), ['no winner', 'relegated']);
  assert.deepEqual(keys(t), ['decide:nowinner']);
  assert.match(t.flags[0].text, /S1 vs S2 ended in a draw\. Book a rematch, or decide/);
  assert.equal(M.wrestlerById(st, sw[1].id).showId, 'smackdown');           // a draw sends nobody down
  const pair = t.pairs[0];
  M.decidePair(st, tr.id, 'smackdown', pair.id, sw[1].id, 'Lost the coin toss');
  assert.equal(M.wrestlerById(st, sw[1].id).showId, 'nxt');
  const rec = M.relegationsOf(st, sw[1].id)[0];
  assert.equal(rec.decided, true);
  assert.match(rec.reason, /ended without a winner; sent to NXT by the owner's decision — Lost the coin toss\./);
  throwsUE(() => M.clearResult(st, night.id, m1.id), /Undo that decision first/);
  M.undoDecision(st, tr.id, 'smackdown', pair.id);
  assert.equal(M.wrestlerById(st, sw[1].id).showId, 'smackdown');
  // a rematch the next week: S1 wins it
  const next = M.addEvent(st, { showId: 'smackdown', week: 6 });
  const [re] = M.bookRelegation(st, tr.id, 'smackdown', next.id, [pair.id]);
  M.enterResult(st, next.id, re.id, { outcome: 'win', winner: 0 });
  assert.equal(M.wrestlerById(st, sw[1].id).showId, 'nxt');
  assert.match(M.relegationsOf(st, sw[1].id)[0].reason, /^Lost the SmackDown relegation match to S1 at SmackDown · Week 6/);
  throwsUE(() => M.updateMatch(st, night.id, m1.id, { sides: m1.sides, outcome: 'win', winner: 0 }), /rematch has been booked/);
  // SmackDown sent two down, Raw none so far: nothing has to match
  assert.equal(st.relegations.length, 2);
  sound(st);
});

test('odd numbers and missing results are flagged for the owner, never settled quietly', () => {
  const { st, tr, rw, wm, n1 } = relegationWorld();
  M.bookMatch(st, wm.id, { sides: S([rw[5].id, n1.id]) });                   // WrestleMania isn't finished
  let raw = M.relegationTable(st, tr.id, 'raw');
  assert.deepEqual(keys(raw), ['decide:incomplete', 'decide:tie']);
  assert.match(raw.flags[0].text, /1 match up to WrestleMania has no result yet \(WrestleMania\)/);
  M.countWinsAsTheyStand(st, tr.id);
  M.toggleCandidate(st, tr.id, 'raw', rw[1].id);                              // R1, R2 ...
  M.toggleCandidate(st, tr.id, 'raw', rw[2].id);                              // ... and R3: three
  raw = M.relegationTable(st, tr.id, 'raw');
  assert.deepEqual(keys(raw), ['decide:odd', 'check:picked']);
  assert.match(raw.flags[0].text, /An odd number of candidates \(3\): R3 has no opponent/);
  M.pairCandidates(st, tr.id, 'raw', rw[0].id, rw[2].id);                     // R1 v R3; R2 left over
  raw = M.relegationTable(st, tr.id, 'raw');
  assert.deepEqual(raw.pairs.map(p => [p.a, p.b].map(x => M.wrestlerById(st, x).name).join('-')), ['R1-R3']);
  assert.deepEqual(raw.unpaired.map(x => M.wrestlerById(st, x).name), ['R2']);
  M.toggleCandidate(st, tr.id, 'raw', rw[1].id);                              // two again: back to win order
  raw = M.relegationTable(st, tr.id, 'raw');
  assert.deepEqual([keys(raw), raw.pairs.length], [['check:picked'], 1]);
  M.bookMatch(st, wm.id, { sides: S([rw[3].id, n1.id]) });                   // another missing result: flagged again
  assert.ok(keys(M.relegationTable(st, tr.id, 'raw')).includes('decide:incomplete'));
  sound(st);
});

test('a relegation match keeps its pairing, its night stays after WrestleMania, and its move follows the night', () => {
  const { st, tr, rw, wm, night, m, r3 } = bookedRaw();
  throwsUE(() => M.updateBooking(st, night.id, m.id, { sides: S([rw[0].id, rw[5].id]) }), /its line-up is its pairing/);
  throwsUE(() => M.enterResult(st, night.id, m.id, { sides: S([rw[0].id, rw[5].id]), winner: 0 }), /its line-up is its pairing/);
  M.updateBooking(st, night.id, m.id, { notes: 'Loser goes to NXT' });        // everything else can change
  M.enterResult(st, night.id, m.id, { outcome: 'win', winner: r3 });
  throwsUE(() => M.updateEvent(st, night.id, { week: 4 }), /has to stay after WrestleMania/);
  throwsUE(() => M.updateEvent(st, night.id, { showId: 'smackdown' }), /stays a Raw episode/);
  throwsUE(() => M.updateEvent(st, wm.id, { week: 6 }), /has to stay before it/);
  M.updateEvent(st, night.id, { week: 6, day: 1 });
  const mv = M.movesOf(st, rw[0].id).pop();
  assert.deepEqual([mv.at.week, mv.at.day, st.relegations[0].at.week], [6, 1, 6]);
  throwsUE(() => M.deleteEvent(st, wm.id), /season transition starts from WrestleMania/);
  throwsUE(() => M.cancelTransition(st, tr.id), /Take them off first/);
  throwsUE(() => M.startTransition(st, wm.id), /already has its season transition/);
  M.deleteEvent(st, night.id);                                               // the whole night goes: so does the relegation
  assert.deepEqual([M.wrestlerById(st, rw[0].id).showId, st.relegations.length], ['raw', 0]);
  M.cancelTransition(st, tr.id);
  assert.equal(st.transitions.length, 0);
  sound(st);
});

test('the pool is who was on the show at WrestleMania', () => {
  const { st, tr, rw, sw } = relegationWorld();
  M.setWeek(st, 5);
  M.assignWrestler(st, rw[0].id, 'smackdown');                               // traded after WrestleMania
  M.assignWrestler(st, sw[4].id, 'raw');
  const raw = M.relegationTable(st, tr.id, 'raw');
  assert.ok(raw.pool.some(r => r.name === 'R1') && !raw.pool.some(r => r.name === 'S5'));
  assert.ok(raw.flags.some(f => f.key === 'moved' && /R1 is on SmackDown now/.test(f.text)));
});

test('merging duplicates carries who took the fall, and leaves relegation records alone', () => {
  const st = M.createUniverse();
  const [a, dup, b] = ['Cody', 'Cody R', 'Gunther'].map(n => M.addWrestler(st, { name: n, showId: 'raw' }));
  const ev = M.addEvent(st, { showId: 'raw' });
  M.recordMatch(st, ev.id, { sides: S([dup.id, b.id]), winner: 0, fall: { by: dup.id, on: b.id } });
  M.mergeWrestlers(st, a.id, dup.id);
  assert.deepEqual(st.events[0].matches[0].fall, { by: a.id, on: b.id });
  sound(st);
  const w = relegationWorld();
  const twin = M.addWrestler(w.st, { name: 'R1 again', showId: 'raw' });
  M.toggleCandidate(w.st, w.tr.id, 'raw', w.rw[2].id);                      // R1 and R3 are now the owner's picks
  throwsUE(() => M.mergeWrestlers(w.st, twin.id, w.rw[0].id), /part of a season transition/);
  M.mergeWrestlers(w.st, w.rw[0].id, twin.id);
  sound(w.st);
});

test('a save with relegation in it round-trips, and a broken record is refused', () => {
  const { st, night, m, r3 } = bookedRaw();
  M.enterResult(st, night.id, m.id, { outcome: 'win', winner: r3 });
  const back = importUniverse(exportUniverse(st));
  assert.deepEqual(back, st);
  const broken = JSON.parse(exportUniverse(st));
  broken.moves = broken.moves.filter(x => x.to !== 'nxt');
  throwsUE(() => importUniverse(JSON.stringify(broken)), /problem/);
  assert.ok(M.validate(migrateOnly(broken)).some(p => /roster move that doesn't match/.test(p)));
});
function migrateOnly(raw) { return M.migrate(raw); }
