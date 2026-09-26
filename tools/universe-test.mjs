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

test('a real v2 save migrates to v3: every result played, every show on its night', async () => {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('./fixtures/universe-v2.json', import.meta.url), 'utf8');
  assert.equal(JSON.parse(text).version, 2);
  const st = importUniverse(text);
  assert.equal(st.version, 3);
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
