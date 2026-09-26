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
  M.updateTeam(st, u.id, { members: [a.id, c.id] });
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
  assert.ok(t.disbanded);
  M.setTeamActive(st, t.id, true);
  assert.equal(t.active, true);
  assert.equal(t.disbanded, null);
  M.deleteTeam(st, t.id);
  assert.equal(st.teams.length, 0);
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

  // history can't be pulled out from under a title change
  throwsUE(() => M.deleteMatch(st, ev.id, m.id), /Undo that title change/);
  throwsUE(() => M.deleteEvent(st, ev.id), /Undo that title change/);
  throwsUE(() => M.updateEvent(st, ev.id, { week: 4 }), /week is fixed/);
  M.undoTitleChange(st, tag.id);
  M.deleteMatch(st, ev.id, t.id);
  M.undoTitleChange(st, whc.id);
  assert.equal(M.currentReign(st, whc.id).holder.id, a.id, 'undo gives the belt back to the previous champion');
  M.deleteEvent(st, ev.id);
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
    { titleChange: true }), /began in season 1, week 5, later than season 1, week 3/);
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
  assert.deepEqual(M.summary(st), { wrestlers: 4, teams: 1, titles: 2, events: 1, matches: 0, seasons: 2 });
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
