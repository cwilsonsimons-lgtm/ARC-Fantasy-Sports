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
import * as P from '../js/universe/persist.js';
import { createCloud } from '../js/universe/cloud.js';
import * as SD from '../js/universe/standings.js';
import * as RL from '../js/universe/relations.js';
import * as DR from '../js/universe/director.js';
import * as B from '../js/universe/booker.js';
import * as SL from '../js/universe/storylines.js';
import * as SIM from '../js/universe/simulate.js';
import { FIND_FROM, findable } from '../js/universe/ui.js';
import { bookingSample, sampleCycle, sampleSeason } from './universe-sample.mjs';

const sound = st => assert.deepEqual(M.validate(st), []);
const throwsUE = (fn, re) => assert.throws(fn, e => e instanceof M.UniverseError && (!re || re.test(e.message)));
const frozen = st => JSON.stringify(st);

/** A Storage stand-in: the same getItem/setItem surface, plus a switch to make writes fail. */
function memoryStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    full: false,
    limit: Infinity,                      // total characters it can hold, like a browser's quota
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem(k, v) {
      const size = [...m].reduce((n, [key, val]) => n + (key === k ? 0 : val.length), 0) + String(v).length;
      if (this.full || size > this.limit) throw new Error('QuotaExceededError');
      m.set(k, String(v));
    },
    removeItem(k) { m.delete(k); },
    keys: () => [...m.keys()],
  };
}

// ---------------------------------------------------------------- seed

test('a new universe has its five shows in three tiers, and an active Season 1', () => {
  const st = M.createUniverse();
  assert.deepEqual(st.shows.map(s => s.name), ['Raw', 'SmackDown', 'Dynamite', 'NXT', 'Evolve']);
  assert.deepEqual(st.shows.map(s => s.promotion), ['WWE', 'WWE', 'AEW', 'WWE', 'WWE']);
  assert.deepEqual(st.tiers.map(t => [t.name, t.shows]), [['Main roster', ['raw', 'smackdown', 'dynamite']], ['NXT', ['nxt']], ['Evolve', ['evolve']]]);
  assert.deepEqual(M.activeLinks(st).map(l => l.id), ['link-main-nxt', 'link-nxt-evolve']);
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
  assert.deepEqual(M.rosterCounts(st), { '': 1, raw: 7, smackdown: 3, dynamite: 11, nxt: 0, evolve: 0 });
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
  assert.deepEqual(got.shows.map(s => s.id), ['raw', 'smackdown', 'dynamite', 'nxt', 'evolve']);
  assert.deepEqual(got.tiers.map(t => t.shows.length), [3, 1, 1]);
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

// ---------------------------------------------------------------- the season transition: NXT promotion and the draft
//
// The relegation world, plus NXT: prospects NA-ND, NChamp holding the NXT
// Championship, and Prospects (NT1 & NT2) holding the NXT Tag Team
// Championship - all there before WrestleMania.
function cycleWorld() {
  const w = relegationWorld();
  const { st } = w;
  M.setWeek(st, 3);
  const [NA, NB, NC, ND, NChamp, NT1, NT2] = ['NA', 'NB', 'NC', 'ND', 'NChamp', 'NT1', 'NT2'].map(n => M.addWrestler(st, { name: n, showId: 'nxt' }));
  const nxtTitle = M.addTitle(st, { name: 'NXT Championship', showId: 'nxt' });
  const nxtTag = M.addTitle(st, { name: 'NXT Tag Team Championship', showId: 'nxt', kind: 'tag' });
  const team = M.addTeam(st, { name: 'Prospects', members: [NT1.id, NT2.id] });
  M.setChampion(st, nxtTitle.id, { type: 'wrestler', id: NChamp.id });
  M.setChampion(st, nxtTag.id, { type: 'team', id: team.id });
  M.setWeek(st, 5);
  return { ...w, NA, NB, NC, ND, NChamp, NT1, NT2, nxtTitle, nxtTag, team };
}
const names2 = (st, ids) => ids.map(id => M.wrestlerById(st, id).name);
const eligibleNames = (st, trId) => M.promotionTable(st, trId).eligible.map(e => `${M.wrestlerById(st, e.wrestler).name}:${e.sources.map(s => s.source).join('+')}`);

test('NXT: champions are eligible automatically, qualifier winners become eligible, and nobody moves', () => {
  const { st, tr, NA, NB, NC, ND, NChamp } = cycleWorld();
  let t = M.promotionTable(st, tr.id);
  assert.deepEqual(t.champions.map(c => `${M.wrestlerById(st, c.wrestler).name}:${M.titleById(st, c.title).name}`),
    ['NChamp:NXT Championship', 'NT1:NXT Tag Team Championship', 'NT2:NXT Tag Team Championship']);
  assert.deepEqual(eligibleNames(st, tr.id), ['NChamp:champion', 'NT1:champion', 'NT2:champion']);
  assert.deepEqual(t.flags.map(f => f.key), ['tagchamps']);
  assert.match(t.flags[0].text, /Prospects hold the NXT Tag Team Championship: each of them is eligible\. Whether they move together is your call/);
  M.setQualifiers(st, tr.id, [NA.id, NB.id, NC.id, ND.id]);
  t = M.promotionTable(st, tr.id);
  assert.deepEqual(t.pairs.map(p => names2(st, [p.a, p.b]).join('-')), ['NA-NB', 'NC-ND']);
  assert.deepEqual([t.night.event, t.night.week], [undefined, 5]);            // Tuesday after a Saturday WrestleMania
  const night = M.addEvent(st, { showId: 'nxt', week: 5 });
  const raw = M.addEvent(st, { showId: 'raw', week: 5 });
  throwsUE(() => M.bookQualifiers(st, tr.id, raw.id), /go on an episode of NXT/);
  const [q1, q2] = M.bookQualifiers(st, tr.id, night.id);
  assert.deepEqual([q1.stip, !!q1.qualifier, q1.relegation, q1.status], ['Qualifying match', true, null, 'scheduled']);
  M.enterResult(st, night.id, q1.id, { outcome: 'win', winner: 0 });          // NA beats NB
  M.enterResult(st, night.id, q2.id, { outcome: 'draw' });                    // NC and ND draw
  t = M.promotionTable(st, tr.id);
  assert.deepEqual(t.pairs.map(p => p.status), ['qualified', 'no winner']);
  assert.ok(t.flags.some(f => f.key === 'nowinner' && /NC vs ND ended in a draw\. Book a rematch, or decide who \(if anyone\) qualifies/.test(f.text)));
  M.decideQualifier(st, tr.id, t.pairs[1].id, [NC.id, ND.id], 'Both impressed');
  assert.deepEqual(eligibleNames(st, tr.id), ['NA:qualifier', 'NC:decision', 'NChamp:champion', 'ND:decision', 'NT1:champion', 'NT2:champion']);
  const na = M.eligibilityOf(st, tr.id, NA.id)[0];
  assert.deepEqual([na.source, na.opponent, na.match], ['qualifier', NB.id, q1.id]);
  // eligible moves nobody
  assert.ok([NA, NB, NC, ND, NChamp].every(w => M.wrestlerById(st, w.id).showId === 'nxt'));
  sound(st);
});

test('NXT: the qualifier field is the owner’s - odd numbers and champions are flagged, not fixed', () => {
  const { st, tr, NA, NB, NC, NChamp } = cycleWorld();
  M.toggleQualifier(st, tr.id, NA.id);
  M.toggleQualifier(st, tr.id, NB.id);
  M.toggleQualifier(st, tr.id, NChamp.id);
  let t = M.promotionTable(st, tr.id);
  assert.deepEqual(t.flags.map(f => `${f.level}:${f.key}`), ['decide:odd', 'check:champion', 'check:tagchamps']);
  assert.match(t.flags[0].text, /An odd number in the qualifiers \(3\): NChamp has no opponent/);
  assert.match(t.flags[1].text, /NChamp is already eligible as a champion of NXT/);
  const night = M.addEvent(st, { showId: 'nxt', week: 5 });
  throwsUE(() => M.bookQualifiers(st, tr.id, night.id), /odd number in the qualifiers/);
  M.toggleQualifier(st, tr.id, NChamp.id);
  M.toggleQualifier(st, tr.id, NC.id);
  M.pairQualifiers(st, tr.id, NA.id, NC.id);                                  // NA v NC, NB left with nobody... then paired
  t = M.promotionTable(st, tr.id);
  assert.deepEqual(t.pairs.map(p => names2(st, [p.a, p.b]).join('-')), ['NA-NC']);
  assert.deepEqual(names2(st, t.unpaired), ['NB']);
  throwsUE(() => M.toggleQualifier(st, tr.id, M.wrestlerById(st, st.wrestlers.find(w => w.name === 'R1').id).id), /wasn't on NXT at WrestleMania/);
  sound(st);
});

test('NXT: a corrected qualifier changes who is eligible - until they have been drafted', () => {
  const { st, tr, NA, NB, NC, ND } = cycleWorld();
  M.setQualifiers(st, tr.id, [NA.id, NB.id, NC.id, ND.id]);
  const night = M.addEvent(st, { showId: 'nxt', week: 5 });
  const [q1] = M.bookQualifiers(st, tr.id, night.id);
  M.enterResult(st, night.id, q1.id, { outcome: 'win', winner: 0 });
  M.updateMatch(st, night.id, q1.id, { sides: q1.sides, outcome: 'win', winner: 1 });     // NB won after all
  assert.deepEqual([M.eligibilityOf(st, tr.id, NA.id).length, M.eligibilityOf(st, tr.id, NB.id).length], [0, 1]);
  M.clearResult(st, night.id, q1.id);
  assert.equal(M.eligibilityOf(st, tr.id, NB.id).length, 0);
  M.enterResult(st, night.id, q1.id, { outcome: 'win', winner: 0 });
  M.openWindow(st, tr.id);
  M.draftWrestler(st, tr.id, NA.id, 'dynamite');
  throwsUE(() => M.updateMatch(st, night.id, q1.id, { sides: q1.sides, outcome: 'win', winner: 1 }), /NA has been drafted to Dynamite since qualifying\. Undo that pick first/);
  throwsUE(() => M.updateBooking(st, night.id, q1.id, {}), /already has a result/);
  sound(st);
});

test('the transfer window: draft, with the title and tag-team calls left to the owner; end it with some undrafted', () => {
  const { st, tr, NA, NB, NChamp, NT1, NT2, nxtTitle, nxtTag, team } = cycleWorld();
  M.setQualifiers(st, tr.id, [NA.id, NB.id]);
  const night = M.addEvent(st, { showId: 'nxt', week: 5 });
  const [q1] = M.bookQualifiers(st, tr.id, night.id);
  throwsUE(() => M.draftWrestler(st, tr.id, NChamp.id, 'raw'), /transfer window isn't open/);
  M.openWindow(st, tr.id);
  M.enterResult(st, night.id, q1.id, { outcome: 'win', winner: 0 });          // qualifying while the window is open still counts
  const champs = st.eligibility.filter(e => e.source === 'champion');
  assert.deepEqual(champs.map(e => [M.wrestlerById(st, e.wrestler).name, M.titleById(st, e.title).name, e.team]),
    [['NChamp', 'NXT Championship', null], ['NT1', 'NXT Tag Team Championship', team.id], ['NT2', 'NXT Tag Team Championship', team.id]]);
  // a champion: keep the title or vacate it - never assumed
  assert.deepEqual(M.draftQuestions(st, NChamp.id).titles.map(x => x.title), [nxtTitle.id]);
  throwsUE(() => M.draftWrestler(st, tr.id, NChamp.id, 'raw'), /NXT Championship: keep it or vacate it\?/);
  throwsUE(() => M.draftWrestler(st, tr.id, NChamp.id, 'nxt', { titles: { [nxtTitle.id]: 'vacate' } }), /go to Raw, SmackDown or Dynamite/);
  const [p1] = M.draftWrestler(st, tr.id, NChamp.id, 'raw', { titles: { [nxtTitle.id]: 'vacate' }, note: 'Top pick' });
  assert.equal(M.wrestlerById(st, NChamp.id).showId, 'raw');
  assert.equal(M.currentReign(st, nxtTitle.id), null);
  assert.deepEqual([p1.pick, p1.from, p1.to, p1.titles, p1.note], [1, 'nxt', 'raw', [{ title: nxtTitle.id, reign: M.titleReigns(st, nxtTitle.id)[0].id, choice: 'vacated', rule: null }], 'Top pick']);
  assert.equal(st.eligibility.find(e => e.id === p1.eligibility[0]).source, 'champion');
  // tag champions: the partner comes along only if the owner says so; the team keeps its title here
  const [p2a, p2b] = M.draftWrestler(st, tr.id, NT1.id, 'smackdown', { partners: [NT2.id], titles: { [nxtTag.id]: 'keep' } });
  assert.deepEqual([M.wrestlerById(st, NT1.id).showId, M.wrestlerById(st, NT2.id).showId], ['smackdown', 'smackdown']);
  assert.equal(M.currentReign(st, nxtTag.id).holder.id, team.id);
  assert.deepEqual([p2a.pick, p2b.pick, p2b.with, p2a.group === p2b.group, p2a.titles[0].choice], [2, 2, NT1.id, true, 'kept']);
  M.draftWrestler(st, tr.id, NA.id, 'dynamite');
  throwsUE(() => M.draftWrestler(st, tr.id, NB.id, 'raw'), /NB isn't draft eligible/);
  throwsUE(() => M.draftWrestler(st, tr.id, NA.id, 'raw'), /isn't on NXT/);
  // each show took a different number
  const took = show => M.draftsOf(st, tr.id).filter(d => d.to === show).length;
  assert.deepEqual([took('raw'), took('smackdown'), took('dynamite')], [1, 2, 1]);
  // end the window; nobody else has to go
  M.closeWindow(st, tr.id);
  assert.deepEqual(tr.window.undrafted, []);
  throwsUE(() => M.draftWrestler(st, tr.id, NA.id, 'raw'), /isn't open/);
  throwsUE(() => M.undoDraft(st, p1.id), /Reopen it first/);
  M.reopenWindow(st, tr.id);
  M.undoDraft(st, p1.id);                                                     // NChamp goes back, and so does the belt
  assert.equal(M.wrestlerById(st, NChamp.id).showId, 'nxt');
  assert.equal(M.currentReign(st, nxtTitle.id).holder.id, NChamp.id);
  M.closeWindow(st, tr.id);
  assert.deepEqual(names2(st, tr.window.undrafted), ['NChamp']);              // left undrafted, and kept on record
  sound(st);
});

test('a complete post-WrestleMania cycle: relegation, NXT qualifiers, the draft, a new season', () => {
  const w = cycleWorld();
  const { st, tr, rw, sw, NA, NB, NC, ND, NChamp, NT1, NT2, nxtTitle, nxtTag } = w;
  const rosterOf = show => st.wrestlers.filter(x => x.showId === show).length;
  const before = { raw: rosterOf('raw'), smackdown: rosterOf('smackdown'), dynamite: rosterOf('dynamite'), nxt: rosterOf('nxt') };
  assert.deepEqual(before, { raw: 6, smackdown: 5, dynamite: 3, nxt: 8 });

  // 1. relegation: Raw settles its tie; SmackDown sends two; Dynamite none
  M.toggleCandidate(st, tr.id, 'raw', rw[2].id);
  M.setCandidateCount(st, tr.id, 'smackdown', 4);
  M.setCandidateCount(st, tr.id, 'dynamite', 0);
  const rawNight = M.addEvent(st, { showId: 'raw', week: 5 });
  const sdNight = M.addEvent(st, { showId: 'smackdown', week: 5 });
  const [rm] = M.bookRelegation(st, tr.id, 'raw', rawNight.id);
  const [sm1, sm2] = M.bookRelegation(st, tr.id, 'smackdown', sdNight.id);
  const winnerIs = (m, id) => m.sides.findIndex(sd => sd.wrestlers[0] === id);
  M.enterResult(st, rawNight.id, rm.id, { outcome: 'win', winner: winnerIs(rm, rw[2].id) });   // R3 stays, R1 down
  M.enterResult(st, sdNight.id, sm1.id, { outcome: 'win', winner: winnerIs(sm1, sw[1].id) });  // S2 stays, S1 down
  M.enterResult(st, sdNight.id, sm2.id, { outcome: 'win', winner: winnerIs(sm2, sw[2].id) });  // S3 stays, S4 down

  // 2. NXT's first show after WrestleMania: qualifiers
  M.setQualifiers(st, tr.id, [NA.id, NB.id, NC.id, ND.id]);
  const nxtNight = M.addEvent(st, { showId: 'nxt', week: 5 });
  const [q1, q2] = M.bookQualifiers(st, tr.id, nxtNight.id);
  M.enterResult(st, nxtNight.id, q1.id, { outcome: 'win', winner: 0 });      // NA qualifies
  M.enterResult(st, nxtNight.id, q2.id, { outcome: 'win', winner: 1 });      // ND qualifies
  // relegated wrestlers arrived in NXT, but weren't on NXT at WrestleMania: not in the qualifier pool
  assert.ok(!M.promotionTable(st, tr.id).inPool.has(rw[0].id));

  // 3. the transfer window: champions fixed as eligible, then the draft
  M.openWindow(st, tr.id);
  assert.deepEqual(eligibleNames(st, tr.id), ['NA:qualifier', 'NChamp:champion', 'ND:qualifier', 'NT1:champion', 'NT2:champion']);
  M.draftWrestler(st, tr.id, NChamp.id, 'raw', { titles: { [nxtTitle.id]: 'vacate' } });
  M.draftWrestler(st, tr.id, NA.id, 'raw');
  M.draftWrestler(st, tr.id, NT1.id, 'dynamite', { titles: { [nxtTag.id]: 'vacate' } });   // NT1 alone: NT2 stays
  M.closeWindow(st, tr.id);                                                    // ND and NT2 left undrafted
  assert.deepEqual(names2(st, tr.window.undrafted), ['ND', 'NT2']);

  // where everyone ended up: nothing had to balance
  const after = { raw: rosterOf('raw'), smackdown: rosterOf('smackdown'), dynamite: rosterOf('dynamite'), nxt: rosterOf('nxt') };
  assert.deepEqual(after, { raw: 7, smackdown: 3, dynamite: 4, nxt: 8 });
  assert.equal(M.currentReign(st, nxtTag.id), null);                          // vacated on NT1's pick, as decided
  assert.deepEqual(M.teamShows(st, M.teamById(st, w.team.id)).sort(), ['dynamite', 'nxt']);   // the team is split, not dissolved

  // the record, in order: every transfer since WrestleMania and why
  const moves = M.transfersSince(st, tr.id).map(x => `${M.wrestlerById(st, x.move.wrestler).name} ${x.move.from}>${x.move.to} ${x.relegation ? 'relegated' : x.draft ? `pick ${x.draft.pick}` : 'move'}`);
  assert.deepEqual(moves, ['R1 raw>nxt relegated', 'S1 smackdown>nxt relegated', 'S4 smackdown>nxt relegated',
    'NChamp nxt>raw pick 1', 'NA nxt>raw pick 2', 'NT1 nxt>dynamite pick 3']);
  const pick = id => M.draftsOf(st, tr.id).find(d => d.wrestler === id);
  assert.equal(st.eligibility.find(e => e.id === pick(NA.id).eligibility[0]).source, 'qualifier');
  assert.equal(st.eligibility.find(e => e.id === pick(NChamp.id).eligibility[0]).source, 'champion');
  assert.deepEqual(M.careerOf(st, NChamp.id).filter(e => e.type === 'move').map(e => e.move.note), ['Drafted from NXT', '']);

  // 4. a new season begins; all of it is still there, and the save round-trips
  M.startNextSeason(st);
  assert.equal(M.activeSeason(st).number, 2);
  assert.equal(st.relegations.length, 3);
  assert.equal(st.drafts.length, 3);
  assert.deepEqual(importUniverse(exportUniverse(st)), st);
  sound(st);
});

test('a v4 save with a season transition migrates to the promotion format', () => {
  const { st } = relegationWorld();
  const old = JSON.parse(JSON.stringify(st));
  old.version = 4;
  delete old.tiers;
  delete old.links;
  old.transitions.forEach(t => { delete t.parts; delete t.window; });
  delete old.eligibility;
  delete old.drafts;
  old.events.forEach(e => e.matches.forEach(m => { delete m.qualifier; }));
  const back = M.migrate(old);
  assert.equal(back.version, M.SCHEMA_VERSION);
  assert.deepEqual([back.transitions[0].parts[0].qualifiers, back.transitions[0].window, back.eligibility, back.drafts], [{ picked: [], pairs: null }, null, [], []]);
  assert.deepEqual(M.validate(back), []);
});

test('a drafted or eligible wrestler can’t be merged away', () => {
  const { st, tr, NChamp, nxtTitle } = cycleWorld();
  M.openWindow(st, tr.id);
  M.draftWrestler(st, tr.id, NChamp.id, 'raw', { titles: { [nxtTitle.id]: 'keep' } });
  const twin = M.addWrestler(st, { name: 'NChamp 2', showId: 'raw' });
  throwsUE(() => M.mergeWrestlers(st, twin.id, NChamp.id), /part of a season transition/);
  assert.ok(M.wrestlerRefs(st, NChamp.id).includes('a season transition'));
});

// ---------------------------------------------------------------- tiers

// A save as version 8 wrote it: four shows, no tiers, the transition's
// promotion on the transition itself, and records naming no connection.
function asV8(st) {
  const old = JSON.parse(JSON.stringify(st));
  old.version = 8;
  delete old.tiers;
  delete old.links;
  old.shows = old.shows.filter(x => x.id !== 'evolve');
  old.transitions.forEach(t => { t.promotion = t.parts[0].qualifiers; delete t.parts; });
  old.events.forEach(e => e.matches.forEach(m => { if (m.qualifier) delete m.qualifier.link; }));
  old.eligibility.forEach(x => { delete x.link; });
  old.drafts.forEach(x => { delete x.link; x.titles.forEach(d => { delete d.rule; }); });
  old.relegations.forEach(x => { delete x.link; delete x.to; });
  return old;
}

test('a version 8 save in the middle of its transition keeps everything, and carries on under the tiers', () => {
  const { st, tr, rw, NA, NB, NChamp, nxtTitle } = cycleWorld();
  // relegation done on Raw, qualifiers booked and one played, the window open with a pick made
  const raw = M.relegationTable(st, tr.id, 'raw');
  M.toggleCandidate(st, tr.id, 'raw', raw.tied[0].id);
  const rawNight = M.addEvent(st, { showId: 'raw', week: 5 });
  const [rm] = M.bookRelegation(st, tr.id, 'raw', rawNight.id);
  M.enterResult(st, rawNight.id, rm.id, { outcome: 'win', winner: 1 });
  M.setQualifiers(st, tr.id, [NA.id, NB.id]);
  const night = M.addEvent(st, { showId: 'nxt', week: 5 });
  const [q] = M.bookQualifiers(st, tr.id, night.id);
  M.enterResult(st, night.id, q.id, { outcome: 'win', winner: 0 });
  M.openWindow(st, tr.id);
  M.draftWrestler(st, tr.id, NChamp.id, 'smackdown', { titles: { [nxtTitle.id]: 'keep' } });
  const old = asV8(st);
  const back = M.migrate(old);
  assert.deepEqual(M.validate(back), []);
  // nothing dropped: every record, move and match is still there, as it was
  for (const k of ['wrestlers', 'moves', 'events', 'reigns', 'relegations', 'eligibility', 'drafts']) assert.equal(back[k].length, old[k].length, k);
  assert.deepEqual(back.transitions[0].parts[0].qualifiers, old.transitions[0].promotion);
  assert.deepEqual(back.transitions[0].shows, old.transitions[0].shows);
  assert.deepEqual(back.relegations.map(r => [r.wrestler, r.to, r.link]), old.relegations.map(r => [r.wrestler, 'nxt', 'link-main-nxt']));
  assert.deepEqual([...back.eligibility, ...back.drafts].map(x => x.link), [...old.eligibility, ...old.drafts].map(() => 'link-main-nxt'));
  // the tiers are the ones it always worked as, plus Evolve below NXT with its own rule
  assert.deepEqual(back.tiers.map(t => [t.name, t.shows]), [['Main roster', ['raw', 'smackdown', 'dynamite']], ['NXT', ['nxt']], ['Evolve', ['evolve']]]);
  assert.deepEqual(back.transitions[0].parts.map(p => [p.upper, p.lower, p.rules.relegation.to, p.rules.champions, p.rules.titles]),
    [[['raw', 'smackdown', 'dynamite'], ['nxt'], 'nxt', 'eligible', 'ask']]);
  // and it carries on: undo the pick, end the window
  M.undoDraft(back, back.drafts[0].id);
  assert.equal(M.wrestlerById(back, NChamp.id).showId, 'nxt');
  M.closeWindow(back, tr.id);
  assert.ok(back.transitions[0].window.undrafted.includes(NChamp.id));
  assert.equal(M.wrestlerById(back, rw[0].id).showId, M.wrestlerById(st, rw[0].id).showId);
  assert.deepEqual(M.validate(back), []);
});

test('tiers: add, rename, reorder and remove the lower ones; shows move between them; connections follow', () => {
  const st = M.createUniverse();
  const [main, nxt, evolve] = st.tiers;
  const t4 = M.addTier(st, { name: 'Tier 4' });
  assert.deepEqual(M.activeLinks(st).map(l => [M.tierById(st, l.upper).name, M.tierById(st, l.lower).name]),
    [['Main roster', 'NXT'], ['NXT', 'Evolve'], ['Evolve', 'Tier 4']]);
  const fresh = M.linkBetween(st, evolve.id, t4.id);
  assert.deepEqual([fresh.rules.relegation.on, fresh.rules.qualifiers.on, fresh.rules.promotion.to], [false, false, 'evolve'], 'a new connection has nothing switched on');
  M.renameTier(st, t4.id, 'Indies');
  throwsUE(() => M.renameTier(st, t4.id, 'nxt'), /already a tier called NXT/);
  throwsUE(() => M.moveTier(st, main.id, 1), /stays at the top/);
  throwsUE(() => M.moveTier(st, nxt.id, -1), /can't go above tier 2/);
  // swap NXT and Evolve: the new neighbours get new connections; the old ones wait
  const evolveRule = M.linkBetween(st, nxt.id, evolve.id).rules;
  M.moveTier(st, evolve.id, -1);
  assert.deepEqual(st.tiers.map(t => t.name), ['Main roster', 'Evolve', 'NXT', 'Indies']);
  assert.equal(M.linkBetween(st, main.id, evolve.id).rules.relegation.on, false);
  M.moveTier(st, evolve.id, 1);                                                   // and back: the rules come back too
  assert.deepEqual(M.linkBetween(st, nxt.id, evolve.id).rules, evolveRule);
  assert.equal(M.linkBetween(st, main.id, nxt.id).rules.relegation.on, true);
  // shows: into a tier, out of one - tier 1 keeps at least one
  const lfg = M.addShow(st, { name: 'LFG', day: 3, tier: t4.id });
  assert.deepEqual(M.tierById(st, t4.id).shows, [lfg.id]);
  assert.equal(M.linkBetween(st, evolve.id, t4.id).rules.relegation.to, lfg.id, 'a destination follows the tier');
  M.setShowTier(st, 'dynamite', null);
  assert.equal(M.tierOfShow(st, 'dynamite'), null);
  M.setShowTier(st, 'smackdown', t4.id);
  assert.deepEqual(main.shows, ['raw']);
  throwsUE(() => M.setShowTier(st, 'raw', t4.id), /tier 1 — it needs at least one show/);
  throwsUE(() => M.deleteShow(st, 'raw'), /tier 1's only show/);
  // removing a tier keeps its shows - and everyone on them
  const w = M.addWrestler(st, { name: 'Indie', showId: lfg.id });
  M.removeTier(st, t4.id);
  assert.deepEqual([M.tierOfShow(st, lfg.id), M.wrestlerById(st, w.id).showId], [null, lfg.id]);
  assert.equal(M.activeLinks(st).length, 2);
  M.setShowTier(st, 'smackdown', main.id); M.setShowTier(st, 'dynamite', main.id);
  sound(st);
});

test('a connection’s rules are checked as a whole, and a transition keeps the rules it started with', () => {
  const { st } = relegationWorld();
  const link = M.activeLinks(st)[0];
  throwsUE(() => M.setLinkRules(st, link.id, { champions: 'sometimes' }), /Unknown champion rule/);
  throwsUE(() => M.setLinkRules(st, link.id, { relegation: { to: 'raw' } }), /go to a show in NXT/);
  throwsUE(() => M.setLinkRules(st, link.id, { promotion: { to: 'nxt' } }), /go to a show in Main roster/);
  throwsUE(() => M.setLinkRules(st, link.id, { relegation: { candidates: 1.5 } }), /whole number/);
  throwsUE(() => M.setLinkRules(st, link.id, { champions: 'automatic' }), /Pick the show in Main roster they move up to/);
  M.setLinkRules(st, link.id, { champions: 'automatic', promotion: { to: 'raw' } });
  assert.deepEqual(M.pendingRules(link.rules), ['champions moving up by themselves at the transfer window']);
  M.setLinkRules(st, link.id, { champions: 'eligible', titles: 'keep', relegation: { candidates: 3 }, promotion: { to: null } });
  // the transition already under way still has two candidates a show and asks about titles
  const tr = st.transitions[0];
  assert.deepEqual([tr.shows.raw.count, tr.parts[0].rules.titles], [2, 'ask']);
  assert.deepEqual([link.rules.relegation.candidates, link.rules.titles], [3, 'keep']);
  // rules that aren't carried out yet hold the matches back rather than half-happen
  M.cancelTransition(st, tr.id);
  M.setLinkRules(st, link.id, { relegation: { timing: 'window' }, qualifiers: { on: true }, promotion: { timing: 'result', to: 'raw' } });
  const tr2 = M.startTransition(st, st.events.find(e => e.name === 'WrestleMania').id);
  assert.equal(tr2.shows.raw.count, 3);
  const night = M.addEvent(st, { showId: 'raw', week: 5 });
  throwsUE(() => M.bookRelegation(st, tr2.id, 'raw', night.id), /at the transfer window, which isn't carried out yet/);
  sound(st);
});

test('Evolve → NXT: champions move up by themselves at the window - kept as the rule, listed, and not carried out yet', () => {
  const { st, tr } = cycleWorld();
  M.cancelTransition(st, tr.id);
  const ev = M.addWrestler(st, { name: 'Evolve Champ', showId: 'evolve' });
  const belt = M.addTitle(st, { name: 'Evolve Championship', showId: 'evolve' });
  M.setChampion(st, belt.id, { type: 'wrestler', id: ev.id });
  const tr2 = M.startTransition(st, st.events.find(e => e.name === 'WrestleMania').id);
  assert.deepEqual(tr2.parts.map(p => `${p.lowerName}→${p.upperName}`), ['NXT→Main roster', 'Evolve→NXT']);
  const t = M.promotionTable(st, tr2.id, 'link-nxt-evolve');
  assert.deepEqual([t.champions, t.automatic.map(c => c.wrestler), t.part.rules.titles, t.part.rules.promotion.to],
    [[], [ev.id], 'vacate', 'nxt']);
  assert.deepEqual(t.pending, ['champions moving up by themselves at the transfer window']);
  assert.ok(!('nxt' in tr2.shows), 'NXT → Evolve relegation is off');
  M.openWindow(st, tr2.id);
  // the NXT champions are eligible as before; the Evolve champion is neither eligible nor moved
  assert.deepEqual([M.eligibilityOf(st, tr2.id, ev.id), M.wrestlerById(st, ev.id).showId, M.currentReign(st, belt.id).holder.id], [[], 'evolve', ev.id]);
  assert.equal(M.promotionTable(st, tr2.id).champions.length, 3);
  sound(st);
});

test('a fourth tier works end to end with no new code: relegation into it, qualifiers and champions out of it, the draft, the title rule', () => {
  const st = M.createUniverse();
  const add = (n, show) => M.addWrestler(st, { name: n, showId: show });
  const t4 = M.addTier(st, { name: 'Indies' });
  const lfg = M.addShow(st, { name: 'LFG', day: 3, tier: t4.id });
  const link = M.linkBetween(st, 'tier-evolve', t4.id);
  M.setLinkRules(st, link.id, { relegation: { on: true, candidates: 2 }, qualifiers: { on: true }, champions: 'eligible', titles: 'vacate' });
  const [E1, E2, E3] = ['E1', 'E2', 'E3'].map(n => add(n, 'evolve'));
  const [L1, L2, L3, LC] = ['L1', 'L2', 'L3', 'LC'].map(n => add(n, lfg.id));
  const lfgTitle = M.addTitle(st, { name: 'LFG Championship', showId: lfg.id });
  M.setChampion(st, lfgTitle.id, { type: 'wrestler', id: LC.id });
  M.setWeek(st, 2);
  const e2 = M.addEvent(st, { showId: 'evolve' });
  M.recordMatch(st, e2.id, { sides: S([E3.id, E1.id]), winner: 0 });            // E3 1 win; E1 and E2 none
  M.setWeek(st, 4);
  const wm = M.addEvent(st, { kind: 'ple', name: 'WrestleMania', week: 4 });
  const tr = M.startTransition(st, wm.id);
  assert.deepEqual(tr.parts.map(p => `${p.lowerName}→${p.upperName}`), ['NXT→Main roster', 'Evolve→NXT', 'Indies→Evolve']);
  assert.deepEqual(M.relegationShows(st, tr).map(x => x.name), ['Raw', 'SmackDown', 'Dynamite', 'Evolve']);
  // Evolve's relegation: the fewest wins face each other; the loser goes down to LFG
  const t = M.relegationTable(st, tr.id, 'evolve');
  assert.deepEqual([t.candidates.map(id => M.wrestlerById(st, id).name).sort(), t.to.name], [['E1', 'E2'], 'LFG']);
  M.setWeek(st, 5);
  const evolveNight = M.addEvent(st, { showId: 'evolve', week: 5 });
  const [rm] = M.bookRelegation(st, tr.id, 'evolve', evolveNight.id);
  M.enterResult(st, evolveNight.id, rm.id, { outcome: 'win', winner: 0 });
  const down = st.relegations.find(r => r.show === 'evolve');
  assert.deepEqual([M.wrestlerById(st, down.wrestler).showId, down.to, down.link], [lfg.id, lfg.id, link.id]);
  // LFG's qualifiers make a winner eligible; its champion is eligible when the window opens
  M.setQualifiers(st, tr.id, [L1.id, L2.id]);
  const lfgNight = M.addEvent(st, { showId: lfg.id, week: 5 });
  throwsUE(() => M.bookQualifiers(st, tr.id, evolveNight.id, null), /Qualifying matches are off for Evolve → NXT/);
  const [q] = M.bookQualifiers(st, tr.id, lfgNight.id);
  M.enterResult(st, lfgNight.id, q.id, { outcome: 'win', winner: 0 });
  M.openWindow(st, tr.id);
  const elig = M.promotionTable(st, tr.id, link.id).eligible.map(e => `${M.wrestlerById(st, e.wrestler).name}:${e.sources.map(x => x.source)}`);
  assert.deepEqual(elig, ['L1:qualifier', 'LC:champion']);
  // the draft: only up to Evolve; the champion's title follows the rule - vacated - without being asked
  assert.deepEqual(M.draftOptions(st, tr.id, LC.id).shows, ['evolve']);
  throwsUE(() => M.draftWrestler(st, tr.id, LC.id, 'nxt'), /Draft picks from Indies go to Evolve/);
  throwsUE(() => M.draftWrestler(st, tr.id, LC.id, 'evolve', { titles: { [lfgTitle.id]: 'keep' } }), /vacate a title when its holder moves up/);
  const [pick] = M.draftWrestler(st, tr.id, LC.id, 'evolve');
  assert.deepEqual([pick.from, pick.to, pick.link, pick.titles.map(x => [x.choice, x.rule])], [lfg.id, 'evolve', link.id, [['vacated', 'vacate']]]);
  assert.equal(M.currentReign(st, lfgTitle.id), null, 'the LFG title is vacant: a clear status after its holder moved');
  M.closeWindow(st, tr.id);
  assert.deepEqual(tr.window.undrafted, [L1.id]);
  assert.equal(M.wrestlerById(st, L3.id).showId, lfg.id);
  sound(st);
  // and it all survives a save and load
  assert.deepEqual(M.validate(M.migrate(JSON.parse(exportUniverse(st)))), []);
});

test('shows: add one, rename it or change its night, and delete it only while nothing names it', () => {
  const st = M.createUniverse();
  const s = M.addShow(st, { name: 'Main Event', day: 3 });
  assert.deepEqual([s.name, s.day, M.tierOfShow(st, s.id)], ['Main Event', 3, null]);
  throwsUE(() => M.addShow(st, { name: 'raw' }), /already a show called Raw/);
  M.updateShow(st, s.id, { name: 'Superstars', day: 4 });
  assert.deepEqual([s.name, s.day], ['Superstars', 4]);
  M.addWrestler(st, { name: 'X', showId: s.id });
  throwsUE(() => M.deleteShow(st, s.id), /has history \(a wrestler on it, roster moves\)/);
  const t = M.addShow(st, { name: 'Spare' });
  M.deleteShow(st, t.id);
  assert.equal(M.showById(st, t.id), null);
  // a deleted seed show stays deleted when the save loads again
  M.deleteShow(st, 'evolve');
  assert.equal(M.showById(M.migrate(JSON.parse(exportUniverse(st))), 'evolve'), null);
  sound(st);
});

// ---------------------------------------------------------------- personalities and relationships

function relWorld() {
  const st = M.createUniverse();
  const [A, B, C, D, E] = ['A', 'B', 'C', 'D', 'E'].map(n => M.addWrestler(st, { name: n, showId: 'raw' }));
  let week = 0;
  const show = () => { M.setWeek(st, ++week); return M.addEvent(st, { showId: 'raw' }); };
  const beat = (ev, w, l) => M.recordMatch(st, ev.id, { sides: S([w.id, l.id]), winner: 0 });
  const rels = () => RL.relationships(st);
  const name = id => M.wrestlerById(st, id).name;
  const now = kind => [...rels().rels.values()].filter(r => r.active && (!kind || r.kind === kind))
    .map(r => `${r.kind === 'grudge' ? `${name(r.a)}>${name(r.b)}` : [name(r.a), name(r.b)].sort().join('+')}:${r.kind}:${r.level}`).sort();
  return { st, A, B, C, D, E, show, beat, rels, now };
}

test('traits are the owner’s: dated, kept, and never changed by results', () => {
  const { st, A, B, show, beat } = relWorld();
  M.setTraits(st, A.id, ['proud', 'loyal'], { since: 'start' });
  assert.deepEqual(M.wrestlerById(st, A.id).traits, ['loyal', 'proud']);                  // kept in the list's order
  const ev = show();
  for (let i = 0; i < 10; i++) beat(ev, B, A);                                              // ten straight losses
  assert.deepEqual(M.wrestlerById(st, A.id).traits, ['loyal', 'proud']);
  M.setWeek(st, 6);
  const ch = M.setTraits(st, A.id, ['loyal', 'hot-headed'], { note: 'Snapped at WrestleMania' });
  assert.deepEqual(ch.map(c => `${c.trait}:${c.on}`), ['hot-headed:true', 'proud:false']);
  assert.deepEqual([...M.traitsAt(st, A.id, ev.at)].sort(), ['loyal', 'proud']);           // as they were at week 1
  assert.deepEqual([...M.traitsAt(st, A.id, null)].sort(), ['hot-headed', 'loyal']);
  assert.deepEqual(M.traitHistory(st, A.id).map(e => `${e.trait}:${e.on}:${e.at ? e.at.week : 'start'}`),
    ['hot-headed:true:6', 'proud:false:6', 'loyal:true:start', 'proud:true:start']);
  throwsUE(() => M.setTraits(st, A.id, ['sneaky']), /Unknown trait/);
  assert.deepEqual(M.setTraits(st, A.id, ['hot-headed', 'loyal']), []);                    // nothing changed: nothing logged
  sound(st);
});

test('repeated losses to the same wrestler grow a grudge - a win resets the count', () => {
  const { st, A, B, show, beat, now, rels } = relWorld();
  const ev = show();
  beat(ev, B, A); beat(ev, B, A);
  assert.deepEqual(now(), []);
  beat(ev, A, B);                                                                          // A wins one back: the count restarts
  beat(ev, B, A); beat(ev, B, A);
  assert.deepEqual(now(), []);
  beat(ev, B, A);                                                                          // third in a row
  assert.deepEqual(now(), ['A>B:grudge:1']);
  const e = rels().entries.find(x => x.kind === 'grudge');
  assert.deepEqual(RL.entryText(st, e), { cause: 'A lost to B for the 3rd time running at Raw · Week 1', result: 'A holds a grudge against B' });
  beat(ev, B, A); beat(ev, B, A); beat(ev, B, A);
  assert.deepEqual(now(), ['A>B:grudge:2']);
  const pv = RL.pairView(st, A.id, B.id);
  assert.deepEqual(pv.progress.losses.map(x => `${x.n}/${x.need}`), ['0/3', '0/3']);
  beat(ev, B, A);
  assert.deepEqual(RL.pairView(st, A.id, B.id).progress.losses[0].n, 1);
});

test('traits change how fast grudges form - as they were at the time', () => {
  const { st, A, B, C, D, show, beat, now } = relWorld();
  M.setTraits(st, A.id, ['hot-headed'], { since: 'start' });
  M.setTraits(st, C.id, ['patient'], { since: 'start' });
  const ev = show();
  beat(ev, B, A); beat(ev, B, A);                                                          // hot-headed: 2 is enough
  beat(ev, D, C); beat(ev, D, C); beat(ev, D, C);                                          // patient: 3 isn't
  assert.deepEqual(now(), ['A>B:grudge:1']);
  beat(ev, D, C);
  assert.deepEqual(now(), ['A>B:grudge:1', 'C>D:grudge:1']);
  // hot-headed from week 3 on doesn't change what already happened at week 1
  const w = relWorld();
  const ev1 = w.show();
  w.beat(ev1, w.B, w.A); w.beat(ev1, w.B, w.A);
  M.setWeek(w.st, 3);
  M.setTraits(w.st, w.A.id, ['hot-headed']);
  assert.deepEqual(w.now(), []);
});

test('a title defeat: a grudge against the new champion, and they’re rivals', () => {
  const { st, A, B, C, D, show, now, rels } = relWorld();
  const belt = M.addTitle(st, { name: 'Belt' });
  M.setChampion(st, belt.id, { type: 'wrestler', id: A.id });
  M.setTraits(st, C.id, ['ambitious'], { since: 'start' });
  const ev = show();
  M.recordMatch(st, ev.id, { sides: S([B.id, A.id]), winner: 0, titleId: belt.id }, { titleChange: true });
  assert.deepEqual(now(), ['A+B:rivals:1', 'A>B:grudge:1']);
  const e = rels().entries.find(x => x.kind === 'grudge');
  assert.equal(RL.entryText(st, e).cause, 'A lost the Belt to B at Raw · Week 1');
  // a title match the champion keeps is just a loss for the challenger
  M.recordMatch(st, ev.id, { sides: S([B.id, D.id]), winner: 0, titleId: belt.id });
  assert.equal(now().length, 2);
  // ambitious: 2 heat
  M.setChampion(st, belt.id, { type: 'wrestler', id: C.id });
  M.recordMatch(st, ev.id, { sides: S([D.id, C.id]), winner: 0, titleId: belt.id }, { titleChange: true });
  assert.ok(now().includes('C>D:grudge:2'));
});

test('incidents: a betrayal ends a friendship, an interference makes allies, an attack starts a grudge', () => {
  const { st, A, B, C, D, E, show, now, rels } = relWorld();
  M.editRelationship(st, { action: 'form', kind: 'friends', a: A.id, b: B.id, since: 'start' });
  M.editRelationship(st, { action: 'form', kind: 'allies', a: A.id, b: B.id, since: 'start', level: 2 });
  M.setTraits(st, A.id, ['loyal'], { since: 'start' });
  M.setTraits(st, D.id, ['hot-headed'], { since: 'start' });
  const ev = show();
  const m = M.recordMatch(st, ev.id, { sides: S([C.id, A.id]), winner: 0 });
  M.recordIncident(st, ev.id, { kind: 'betrayal', by: [B.id], on: [A.id], note: 'Walked out mid-match' });
  M.recordIncident(st, ev.id, { kind: 'interference', by: [E.id], on: [A.id], helped: [C.id], match: m.id });
  M.recordIncident(st, ev.id, { kind: 'attack', by: [C.id], on: [D.id] });
  assert.deepEqual(now(), ['A>B:grudge:3', 'A>E:grudge:1', 'C+E:allies:1', 'D>C:grudge:2']);
  const texts = rels().entries.filter(e => e.auto).map(e => RL.entryText(st, e).result);
  assert.ok(texts.includes('A and B are no longer friends') && texts.includes('A and B are no longer allies'));
  throwsUE(() => M.recordIncident(st, ev.id, { kind: 'attack', by: [C.id], on: [C.id] }), /can't be on both sides/);
  throwsUE(() => M.recordIncident(st, ev.id, { kind: 'attack', by: [], on: [C.id] }), /Pick who attacked/);
  throwsUE(() => M.recordIncident(st, ev.id, { kind: 'rumour', by: [C.id], on: [D.id] }), /Unknown incident/);
  // correcting an incident corrects what grew out of it
  const betrayal = ev.incidents[0];
  M.deleteIncident(st, ev.id, betrayal.id);
  assert.deepEqual(now(), ['A+B:allies:2', 'A+B:friends:1', 'A>E:grudge:1', 'C+E:allies:1', 'D>C:grudge:2']);
  sound(st);
});

test('a long partnership makes allies, then friends; splitting up leaves former partners', () => {
  const { st, A, B, C, D, E, show, now } = relWorld();
  const team = M.addTeam(st, { name: 'AB', members: [A.id, B.id] });
  assert.deepEqual(now('allies'), ['A+B:allies:3']);                                       // a team: allies at 3 from the day it forms
  const ev = show();
  const tag = w => M.recordMatch(st, ev.id, { sides: [{ team: team.id, wrestlers: [A.id, B.id] }, { wrestlers: [C.id, D.id] }], winner: w });
  for (let i = 0; i < 4; i++) tag(i % 2);
  assert.deepEqual(now('allies'), ['A+B:allies:3']);
  tag(0);                                                                                  // the 5th match together, win or lose
  assert.deepEqual(now('allies'), ['A+B:allies:3', 'C+D:allies:1']);                       // partners without a team take longer
  for (let i = 0; i < 7; i++) tag(0);
  assert.deepEqual(now('friends'), ['A+B:friends:1', 'C+D:friends:1']);                    // losing together still counts; their grudges are against A and B
  M.setWeek(st, 4);
  M.setTeamActive(st, team.id, false);
  assert.deepEqual(now('former-partners'), ['A+B:former-partners:1']);
  assert.deepEqual(now('allies'), ['A+B:allies:2', 'C+D:allies:1']);                       // splitting up cools the alliance
  const trio = M.addTeam(st, { name: 'CDE', members: [C.id, D.id, E.id] });
  assert.deepEqual(now('allies'), ['A+B:allies:2', 'C+D:allies:3', 'C+E:allies:3', 'D+E:allies:3']);   // everyone in the group
  M.removeTeamMember(st, trio.id, E.id, { week: 4 });                                     // leaving a team, too
  assert.deepEqual(now('former-partners'), ['A+B:former-partners:1', 'C+E:former-partners:1', 'D+E:former-partners:1']);
  assert.deepEqual(now('allies'), ['A+B:allies:2', 'C+D:allies:3', 'C+E:allies:2', 'D+E:allies:2']);
  // loyal partners are allies sooner; the opportunistic never become friends on their own
  const w = relWorld();
  M.setTraits(w.st, w.A.id, ['loyal', 'opportunistic'], { since: 'start' });
  const e2 = w.show();
  for (let i = 0; i < 12; i++) {
    M.recordMatch(w.st, e2.id, { sides: [{ wrestlers: [w.A.id, w.B.id] }, { wrestlers: [w.C.id, w.D.id] }], outcome: 'draw' });
    if (i === 2) assert.deepEqual(w.now('allies'), ['A+B:allies:1']);                     // 3 matches: only the loyal pair
  }
  assert.deepEqual(w.now('friends'), ['C+D:friends:1']);
});

// ---------------------------------------------------------------- teammates, trust, and relationships between teams

// three teams on Raw: T1 (A, B), T2 (C, D), T3 (E, F); G on their own
function teamRelWorld() {
  const st = M.createUniverse();
  M.setStory(st, { on: false });
  const [A, B, C, D, E, F, G] = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(n => M.addWrestler(st, { name: n, showId: 'raw', gender: 'male' }));
  const T1 = M.addTeam(st, { name: 'T1', members: [A.id, B.id] });
  const T2 = M.addTeam(st, { name: 'T2', members: [C.id, D.id] });
  const T3 = M.addTeam(st, { name: 'T3', members: [E.id, F.id] });
  let week = 0;
  const show = () => { M.setWeek(st, ++week); return M.addEvent(st, { showId: 'raw' }); };
  const name = id => (M.wrestlerById(st, id) || M.teamById(st, id)).name;
  const key = r => (r.kind === 'grudge' ? `${name(r.a)}>${name(r.b)}` : [name(r.a), name(r.b)].sort().join('+'));
  // wrestlers now (through their teams: marked "~"), and teams now
  const now = kind => [...RL.relationships(st).rels.values()].filter(r => r.active && (!kind || r.kind === kind))
    .map(r => `${key(r)}:${r.kind}:${r.level}${r.via ? '~' : ''}`).sort();
  const teams = () => [...RL.relationships(st).teams.values()].filter(r => r.active).map(r => `${key(r)}:${r.kind}:${r.level}`).sort();
  const texts = () => { const d = RL.relationships(st); return [...d.entries, ...d.teamEntries].map(e => RL.entryText(st, e)).map(t => `${t.cause} → ${t.result}`); };
  return { st, A, B, C, D, E, F, G, T1, T2, T3, show, now, teams, texts };
}

test('teammates: allies at strength 3 with everyone in the group, from the day they team up, join or reunite', () => {
  const { st, A, B, C, D, E, G, T1, show, now, texts } = teamRelWorld();
  assert.deepEqual(now('allies'), ['A+B:allies:3', 'C+D:allies:3', 'E+F:allies:3']);
  assert.ok(texts().includes('A and B teamed up as T1 → A and B are allies (strength 3)'));
  const trio = M.addTeam(st, { name: 'Faction', members: [C.id, E.id, G.id] });              // a faction: every pair
  assert.deepEqual(now('allies').filter(x => /G/.test(x)), ['C+G:allies:3', 'E+G:allies:3']);
  show();
  M.addTeamMember(st, T1.id, D.id);                                                          // joining later: with each of them
  assert.deepEqual(now('allies').filter(x => /D/.test(x)).sort(), ['A+D:allies:3', 'B+D:allies:3', 'C+D:allies:3']);
  assert.ok(texts().includes('D joined T1, alongside A → A and D are allies (strength 3)'));
  M.setWeek(st, 3);
  M.setTeamActive(st, trio.id, false);                                                       // disbanding: a step down
  assert.deepEqual(now('allies').filter(x => /G/.test(x)), ['C+G:allies:2', 'E+G:allies:2']);
  M.setWeek(st, 5);
  M.setTeamActive(st, trio.id, true);                                                        // reunited: full trust again
  assert.deepEqual(now('allies').filter(x => /G/.test(x)), ['C+G:allies:3', 'E+G:allies:3']);
  assert.ok(texts().some(t => /^Faction reunited → (C and G|G and C)'s alliance grows to strength 3$/.test(t)));
  sound(st);
});

test('distrust: a reason not to trust a teammate lowers it; at nothing it ends, even on the same team', () => {
  const { st, A, B, C, D, T1, show, now, texts } = teamRelWorld();
  const ev = show();
  M.recordIncident(st, ev.id, { kind: 'tension', by: [A.id], on: [B.id], team: T1.id });
  assert.deepEqual(now('allies').filter(x => x.startsWith('A+B')), ['A+B:allies:2']);
  M.recordIncident(st, ev.id, { kind: 'confrontation', by: [A.id], on: [B.id] });
  assert.deepEqual(now('allies').filter(x => x.startsWith('A+B')), ['A+B:allies:1']);
  const ev2 = show();
  M.recordIncident(st, ev2.id, { kind: 'attack', by: [A.id], on: [B.id] });
  assert.deepEqual(now('allies').filter(x => x.startsWith('A+B')), []);                     // gone - and they're still a team
  assert.ok(M.teamById(st, T1.id).active);
  assert.ok(texts().some(t => /^A attacked B at .* → A and B are no longer allies$/.test(t)));
  // correcting the record puts the trust back
  M.deleteIncident(st, ev2.id, ev2.incidents[0].id);
  assert.deepEqual(now('allies').filter(x => x.startsWith('A+B')), ['A+B:allies:1']);
  // losing to a teammate again and again: a grudge forms, and trust slips
  const ev3 = show();
  for (let i = 0; i < 3; i++) M.recordMatch(st, ev3.id, { sides: S([D.id, C.id]), winner: 0 });
  assert.deepEqual(now().filter(x => /^[CD]/.test(x)), ['C+D:allies:2', 'C>D:grudge:1']);
  // a betrayal ends it at once
  M.recordIncident(st, ev3.id, { kind: 'betrayal', by: [D.id], on: [C.id] });
  assert.deepEqual(now('allies').filter(x => /^C\+D/.test(x)), []);
  // an interference against a partner costs two steps; a save one
  const w = teamRelWorld();
  const e = w.show();
  const m = M.recordMatch(w.st, e.id, { sides: S([w.A.id, w.G.id]), winner: 1 });
  M.recordIncident(w.st, e.id, { kind: 'interference', by: [w.B.id], on: [w.A.id], helped: [w.G.id], match: m.id });
  assert.deepEqual(w.now('allies').filter(x => x.startsWith('A+B')), ['A+B:allies:1']);
  sound(st);
});

test('between tag teams: a losing run, a tag title and what members do to each other', () => {
  const { st, A, B, C, D, E, F, T1, T2, T3, show, teams, texts } = teamRelWorld();
  const ev = show();
  const tag = (w, l) => M.recordMatch(st, ev.id, { sides: [{ team: w.id, wrestlers: w.members }, { team: l.id, wrestlers: l.members }], winner: 0 });
  tag(T2, T1); tag(T2, T1);
  assert.deepEqual(teams(), []);
  tag(T2, T1);                                                                               // three running, as teams
  assert.deepEqual(teams(), ['T1>T2:grudge:1']);
  assert.ok(texts().some(t => /^T1 lost to T2 for the 3rd time running at .* → T1 hold a grudge against T2$/.test(t)));
  // a tag title changing hands between teams
  const belts = M.addTitle(st, { name: 'Tag Titles', showId: 'raw', division: 'men', kind: 'tag' });
  M.setChampion(st, belts.id, { type: 'team', id: T3.id });
  M.recordMatch(st, ev.id, { sides: [{ team: T2.id, wrestlers: T2.members }, { team: T3.id, wrestlers: T3.members }], winner: 0, titleId: belts.id }, { titleChange: true });
  assert.deepEqual(teams(), ['T1>T2:grudge:1', 'T2+T3:rivals:1', 'T3>T2:grudge:1']);
  // incidents between members of different teams
  const ev2 = show();
  M.recordIncident(st, ev2.id, { kind: 'save', by: [E.id], on: [C.id], helped: [A.id] });   // E (T3) saves A (T1) from C (T2)
  assert.deepEqual(teams(), ['T1+T3:allies:1', 'T1>T2:grudge:1', 'T2+T3:rivals:1', 'T2>T3:grudge:1', 'T3>T2:grudge:1']);
  M.recordIncident(st, ev2.id, { kind: 'brawl', by: [B.id], on: [F.id] });                  // and then T1 and T3 fall out
  assert.deepEqual(teams().filter(x => /T1.*T3|T3.*T1/.test(x)), ['T1+T3:rivals:1', 'T1>T3:grudge:1', 'T3>T1:grudge:1']);
  assert.ok(texts().some(t => /^B \(T1\) and F \(T3\) brawled at .* → T1 and T3 are no longer allies$/.test(t)));
  M.recordIncident(st, ev2.id, { kind: 'truce', by: [A.id], on: [E.id] });
  assert.deepEqual(teams().filter(x => /T1.*T3|T3.*T1/.test(x)), []);
  // two on the same team never make a relationship between their team and itself
  M.recordIncident(st, ev2.id, { kind: 'attack', by: [C.id], on: [D.id] });
  assert.ok(teams().every(x => !/T2\+T2|T2>T2/.test(x)));
  sound(st);
});

test('a relationship between teams extends to every pair of their members, while they’re on them', () => {
  const { st, A, B, C, D, E, G, T1, T2, T3, show, now, teams } = teamRelWorld();
  M.editRelationship(st, { teams: true, action: 'form', kind: 'grudge', a: T1.id, b: T2.id, level: 2, since: 'start' });
  assert.deepEqual(teams(), ['T1>T2:grudge:2']);
  assert.deepEqual(now('grudge'), ['A>C:grudge:2~', 'A>D:grudge:2~', 'B>C:grudge:2~', 'B>D:grudge:2~']);
  const r = RL.relationships(st).rels.get(RL.relKey('grudge', A.id, C.id));
  assert.equal(RL.viaText(st, r), 'through T1 and T2');
  // their own relationship, when stronger, stands; when weaker, the team's shows, and theirs is kept underneath
  const ev = show();
  M.recordIncident(st, ev.id, { kind: 'attack', by: [C.id], on: [A.id] });                  // A's own grudge: heat 1 - and T1's grows to 3
  assert.deepEqual(teams(), ['T1>T2:grudge:3']);
  const ac = RL.relationships(st).rels.get(RL.relKey('grudge', A.id, C.id));
  assert.deepEqual([ac.level, ac.own, !!ac.via], [3, 1, true]);
  M.editRelationship(st, { action: 'level', kind: 'grudge', a: A.id, b: C.id, level: 3 });
  assert.ok(now('grudge').includes('A>C:grudge:3'));                                        // their own, not through the teams
  // it follows the line-ups: a new member is in, someone who left is out, a disbanded team is on hold
  M.addTeamMember(st, T1.id, G.id);
  assert.ok(now('grudge').includes('G>C:grudge:3~'));
  M.setWeek(st, 2);
  M.removeTeamMember(st, T1.id, B.id);
  assert.ok(!now('grudge').some(x => x.startsWith('B>')));
  M.setTeamActive(st, T2.id, false);
  assert.deepEqual(now('grudge'), ['A>C:grudge:3']);
  M.setTeamActive(st, T2.id, true);
  // an alliance between teams doesn't reach two members with a grudge between them
  M.editRelationship(st, { teams: true, action: 'form', kind: 'allies', a: T1.id, b: T3.id, level: 2 });
  M.recordIncident(st, ev.id, { kind: 'attack', by: [E.id], on: [G.id] });
  const allies = now('allies').filter(x => x.endsWith('~'));
  assert.ok(allies.includes('A+E:allies:2~') && !allies.includes('E+G:allies:2~'));
  // the storyline list isn't flooded: a feud between teams is booked team against team
  const pair = (x, y) => [x.id, y.id].sort().join('+');
  const lines = SL.storylines(st).map(l => [l.a, l.b].sort().join('+'));
  assert.ok(lines.includes(pair(A, C)) && !lines.includes(pair(A, D)) && !lines.includes(pair(G, C)) && !lines.includes(pair(G, D)));
  sound(st);
});

test('the owner edits team relationships like any other; teams can’t have one with themselves', () => {
  const { st, A, C, T1, T2, T3, show, teams, texts } = teamRelWorld();
  throwsUE(() => M.editRelationship(st, { teams: true, action: 'form', kind: 'friends', a: T1.id, b: T2.id }), /Unknown relationship/);
  throwsUE(() => M.editRelationship(st, { teams: true, action: 'form', kind: 'rivals', a: T1.id, b: T1.id }), /two different tag teams/);
  const both = M.addTeam(st, { name: 'Both', members: [A.id, C.id] });
  throwsUE(() => M.editRelationship(st, { teams: true, action: 'form', kind: 'rivals', a: T1.id, b: both.id }), /share a member/);
  throwsUE(() => M.editRelationship(st, { teams: true, action: 'form', kind: 'rivals', a: T1.id, b: A.id }), /tag team/);
  show();
  const before = RL.snapshot(st);
  const e = M.editRelationship(st, { teams: true, action: 'form', kind: 'rivals', a: T1.id, b: T2.id, level: 2, note: 'Tag division feud' });
  assert.deepEqual(RL.changesBetween(st, before, RL.snapshot(st)), ['T1 and T2 are rivals (heat 2)']);
  assert.ok(texts().includes('Your change — Tag division feud → T1 and T2 are rivals (heat 2)'));
  M.editRelationship(st, { teams: true, action: 'end', kind: 'rivals', a: T1.id, b: T2.id });
  assert.deepEqual(teams(), []);
  // a team in a relationship edit is part of the history
  assert.ok(M.teamRefs(st, T2.id).includes('a relationship'));
  throwsUE(() => M.deleteTeam(st, T2.id));
  M.deleteRelEdit(st, st.relEdits[1].id);
  M.deleteRelEdit(st, e.id);
  assert.deepEqual(teams(), []);
  M.deleteTeam(st, T3.id);
  sound(st);
  // an ignored automatic change between teams doesn't count
  const w = teamRelWorld();
  const ev = w.show();
  for (let i = 0; i < 3; i++) M.recordMatch(w.st, ev.id, { sides: [{ team: w.T2.id, wrestlers: w.T2.members }, { team: w.T1.id, wrestlers: w.T1.members }], winner: 0 });
  const auto = RL.relationships(w.st).teamEntries.find(x => x.auto);
  M.dismissChange(w.st, auto.key);
  assert.deepEqual(w.teams(), []);
  sound(w.st);
});

test('the auto booker: allied teams are unlikely opponents; a feud between teams says so', () => {
  const { st, T1, T2, T3, show } = teamRelWorld();
  M.editRelationship(st, { teams: true, action: 'form', kind: 'grudge', a: T1.id, b: T2.id, level: 2, since: 'start' });
  M.editRelationship(st, { teams: true, action: 'form', kind: 'allies', a: T1.id, b: T3.id, level: 3, since: 'start' });
  const ev = show();
  const ideas = B.ideasFor(st, ev.id, {}).filter(x => x.kind === 'teams' && x.sides.every(sd => sd.team));
  const of = (x, y) => ideas.find(i => i.sides.map(sd => sd.team).sort().join() === [x.id, y.id].sort().join());
  assert.ok(of(T1, T2).why.includes('T1 hold a grudge against T2 (heat 2)'));
  assert.ok(of(T1, T3).why.includes('T1 and T3 are allies (strength 3) — a friendly contest at most'));
  assert.ok(of(T1, T2).score > of(T2, T3).score && of(T2, T3).score > of(T1, T3).score);
});

test('a version 11 save: every relationship edit is between wrestlers', () => {
  const { st, A, B } = teamRelWorld();
  M.editRelationship(st, { action: 'form', kind: 'rivals', a: A.id, b: B.id });
  const old = JSON.parse(JSON.stringify(st));
  old.version = 11;
  old.relEdits.forEach(e => delete e.teams);
  const up = M.migrate(old);
  assert.deepEqual([up.version, up.relEdits.map(e => e.teams)], [M.SCHEMA_VERSION, [false]]);
  sound(up);
  const bad = JSON.parse(JSON.stringify(up));
  bad.relEdits[0].teams = true;                                                              // two wrestlers, called teams
  assert.ok(M.validate(bad).length > 0);
});

test('a corrected result corrects the relationship it built', () => {
  const { st, A, B, show, beat, now } = relWorld();
  const ev = show();
  beat(ev, B, A); beat(ev, B, A);
  const third = beat(ev, B, A);
  assert.deepEqual(now(), ['A>B:grudge:1']);
  M.updateMatch(st, ev.id, third.id, { sides: third.sides, outcome: 'win', winner: 1 });   // A actually won that one
  assert.deepEqual(now(), []);
  M.deleteMatch(st, ev.id, third.id);
  beat(ev, B, A);
  assert.deepEqual(now(), ['A>B:grudge:1']);
});

test('the owner edits any relationship; automatic changes can be ignored; the timeline says why', () => {
  const { st, A, B, C, show, beat, now, rels } = relWorld();
  M.editRelationship(st, { action: 'form', kind: 'rivals', a: A.id, b: B.id, level: 2, since: 'start', note: 'Old enemies' });
  const ev = show();
  beat(ev, B, A); beat(ev, B, A); beat(ev, B, A);
  assert.deepEqual(now(), ['A+B:rivals:2', 'A>B:grudge:1']);
  M.setWeek(st, 2);
  M.editRelationship(st, { action: 'level', kind: 'grudge', a: A.id, b: B.id, level: 3, note: 'Cost him the title shot' });
  M.editRelationship(st, { action: 'end', kind: 'rivals', a: A.id, b: B.id });
  assert.deepEqual(now(), ['A>B:grudge:3']);
  // the timeline, oldest first
  const pv = RL.pairView(st, A.id, B.id);
  assert.deepEqual(pv.entries.map(e => `${e.change}:${e.kind}`), ['formed:rivals', 'formed:grudge', 'set:grudge', 'ended:rivals']);
  assert.deepEqual(RL.entryText(st, pv.entries[0]), { cause: 'Your change, counted from the start — Old enemies', result: 'A and B are rivals (heat 2)' });
  // ignore the automatic grudge: it's still on the timeline, marked, and changes nothing
  const auto = pv.entries.find(e => e.auto);
  M.dismissChange(st, auto.key, 'Never happened like that');
  let again = RL.pairView(st, A.id, B.id);
  assert.ok(again.entries.find(e => e.key === auto.key).ignored);
  assert.deepEqual(now(), ['A>B:grudge:3']);                                               // the owner's own heat still stands
  throwsUE(() => M.dismissChange(st, auto.key), /already ignored/);
  M.restoreChange(st, auto.key);
  // take back an edit of the owner's own
  const edit = st.relEdits.find(e => e.action === 'level');
  M.deleteRelEdit(st, edit.id);
  assert.deepEqual(now(), ['A>B:grudge:1']);
  // what a result just changed, in words
  const before = RL.snapshot(st);
  const ev2 = show();
  beat(ev2, A, C); beat(ev2, A, C); beat(ev2, A, C);
  assert.deepEqual(RL.changesBetween(st, before, RL.snapshot(st)), ['C holds a grudge against A']);
  throwsUE(() => M.editRelationship(st, { action: 'form', kind: 'friends', a: A.id, b: A.id }), /two different wrestlers/);
  throwsUE(() => M.editRelationship(st, { action: 'level', kind: 'grudge', a: A.id, b: B.id, level: 4 }), /from 1 to 3/);
  // an ending is dated; one with nothing left to end still shows, so it can be taken back
  throwsUE(() => M.editRelationship(st, { action: 'end', kind: 'grudge', a: A.id, b: B.id, since: 'start' }), /ended from this week on/);
  const noop = M.editRelationship(st, { action: 'end', kind: 'friends', a: A.id, b: B.id });
  const last = RL.pairView(st, A.id, B.id).entries.at(-1);
  assert.deepEqual([last.change, last.cause.edit.id, RL.entryText(st, last).result],
    ['nothing', noop.id, 'A and B\'s friendship had already ended — nothing to end']);
  sound(st);
});

test('relationships and incidents survive merges, deletes and the save file', () => {
  const { st, A, B, C, show } = relWorld();
  const ev = show();
  M.recordIncident(st, ev.id, { kind: 'attack', by: [A.id], on: [B.id] });
  M.editRelationship(st, { action: 'form', kind: 'friends', a: A.id, b: C.id });
  assert.ok(M.wrestlerRefs(st, A.id).includes('an incident') && M.wrestlerRefs(st, C.id).includes('a relationship'));
  throwsUE(() => M.deleteWrestler(st, C.id), /part of the history/);
  const dup = M.addWrestler(st, { name: 'A2', showId: 'raw' });
  M.setTraits(st, dup.id, ['proud'], { since: 'start' });
  const inc = M.recordIncident(st, ev.id, { kind: 'interference', by: [dup.id], on: [C.id], helped: [B.id] });
  const helped = RL.relationships(st).entries.find(e => e.cause.incident === inc.id && e.kind === 'allies');
  M.dismissChange(st, helped.key, 'Wrong run-in');
  M.mergeWrestlers(st, A.id, dup.id);
  assert.deepEqual(ev.incidents.map(x => x.by), [[A.id], [A.id]]);
  // an ignored change stays ignored under the kept wrestler's name
  const moved = RL.relationships(st);
  assert.ok(moved.entries.find(e => e.cause.incident === inc.id && e.kind === 'allies').ignored);
  assert.ok(!(moved.rels.get(RL.relKey('allies', A.id, B.id)) || {}).active);
  assert.equal(st.traitLog.length, 0);
  const b2 = M.addWrestler(st, { name: 'B2', showId: 'raw' });
  M.recordIncident(st, ev.id, { kind: 'attack', by: [B.id], on: [b2.id] });
  throwsUE(() => M.mergeWrestlers(st, B.id, b2.id), /opposite sides of an incident/);
  assert.deepEqual(importUniverse(exportUniverse(st)), st);
  sound(st);
  // a v5 save grows the personality layer on load
  const old = JSON.parse(exportUniverse(st));
  old.version = 5;
  old.wrestlers.forEach(w => { delete w.traits; });
  old.events.forEach(e => { delete e.incidents; });
  delete old.traitLog;
  delete old.relEdits;
  const back = M.migrate(old);
  assert.deepEqual([back.version, back.wrestlers[0].traits, back.events[0].incidents, back.traitLog, back.relEdits], [M.SCHEMA_VERSION, [], [], [], []]);
});

// ---------------------------------------------------------------- the story director

// Raw: Gunther (hot-headed, ambitious heel) holds the world title and has a
// grudge against Jey (loyal face); Sami & Kevin (opportunistic) are a team;
// Nobody has lost every match.
function directorWorld({ pace = 'normal', seed = 7 } = {}) {
  const st = M.createUniverse();
  M.setStory(st, { pace });
  M.seedStory(st, seed);
  const add = (n, alignment, traits) => {
    const w = M.addWrestler(st, { name: n, showId: 'raw', alignment });
    M.setTraits(st, w.id, traits, { since: 'start' });
    return w;
  };
  const G = add('Gunther', 'heel', ['hot-headed', 'ambitious']), J = add('Jey', 'face', ['loyal']), Sa = add('Sami', 'face', ['loyal']);
  const K = add('Kevin', 'face', ['opportunistic']), Se = add('Seth', 'heel', []), N = add('Nobody', 'face', []);
  const title = M.addTitle(st, { name: 'World Heavyweight Championship', showId: 'raw', division: 'men' });
  M.setChampion(st, title.id, { type: 'wrestler', id: G.id });
  const team = M.addTeam(st, { name: 'KO & Sami', members: [Sa.id, K.id] });
  let week = 0;
  const show = () => { M.setWeek(st, ++week); const ev = M.addEvent(st, { showId: 'raw' }); DR.tick(st); return ev; };
  const one = (ev, w, l, extra = {}, opts = {}) => {
    const m = M.recordMatch(st, ev.id, { sides: S([w.id, l.id]), winner: 0, ...extra }, opts);
    DR.tick(st);
    return m;
  };
  return { st, G, J, Sa, K, Se, N, title, team, show, one };
}
const directorIncidents = st => st.events.flatMap(e => e.incidents.filter(i => i.story).map(i => ({ e, i })));
const whatHappened = st => directorIncidents(st).map(({ e, i }) => `${e.name}:${i.phase}:${i.kind}:${i.by.map(id => M.wrestlerById(st, id).name)}>${i.on.map(id => M.wrestlerById(st, id).name)}`);

test('the story director records canon by itself — before a show and after its results — and never touches results, titles or rosters', () => {
  const { st, G, J, Se, N, title, show, one } = directorWorld({ pace: 'wild' });
  M.editRelationship(st, { action: 'form', kind: 'grudge', a: G.id, b: J.id, level: 3, since: 'start' });
  const ev = show();
  assert.equal(M.directorRollOf(st, ev.id, 'pre').phase, 'pre', 'the director ran before the show as soon as it was the next one');
  const reigns = st.reigns.length, moves = st.moves.length;
  const m = one(ev, J, G, { titleId: title.id }, { titleChange: true });       // the game said Jey won the title
  one(ev, Se, N);
  const post = M.directorRollOf(st, ev.id, 'post');
  assert.ok(post, 'the card is complete, so the director has been through it');
  // the results are exactly as entered; the only title change is the entered one; nobody moved
  assert.deepEqual([m.winner, M.currentReign(st, title.id).holder.id, st.reigns.length, st.moves.length], [0, J.id, reigns + 1, moves]);
  // what it recorded is canon: incidents on the show, each with its cause, and the relationships follow
  const made = ev.incidents.filter(i => i.story === post.id);
  assert.deepEqual(made.map(i => i.id), post.made);
  made.forEach(i => { assert.equal(i.phase, 'post'); assert.ok(i.cause.length > 0); });
  if (made.length) {
    assert.ok(M.timeline(st).some(e => e.type === 'incident' && e.rec.incident.id === made[0].id));
    assert.ok(RL.relationships(st).entries.some(e => e.cause.incident === made[0].id) || ['momentum', 'open-challenge', 'turn'].includes(made[0].kind));
  }
  // every possibility it weighed is logged, with the draw that decided it
  post.considered.forEach(k => {
    assert.equal(k.draw, DR.draw(st.story.seed, ev.id, 'post', 0, k.key));
    if (k.picked) assert.ok(k.draw < k.chance);
  });
  // nothing is due now; running it again changes nothing
  const before = frozen(st);
  assert.deepEqual(DR.tick(st), []);
  assert.equal(frozen(st), before);
  sound(st);
});

test('the same save always tells the same story; another seed tells another', () => {
  const story = seed => {
    const { st, G, J, Sa, K, Se, N, show, one } = directorWorld({ pace: 'wild', seed });
    for (let wk = 0; wk < 4; wk++) {
      const ev = show();
      one(ev, J, G); one(ev, Se, N);
      const m = M.recordMatch(st, ev.id, { sides: [{ team: st.teams[0].id, wrestlers: [Sa.id, K.id] }, { wrestlers: [Se.id, N.id] }], winner: 1 });
      DR.tick(st);
      assert.ok(m);
    }
    sound(st);
    return whatHappened(st).join(' | ');
  };
  assert.equal(story(11), story(11));
  const tales = new Set(Array.from({ length: 12 }, (_, i) => story(i + 1)));
  assert.ok(tales.size > 6, 'different saves, different stories');
});

// a season of CPU-style results on Raw and SmackDown, with the director running as it would in the app
function directorSeason(pace, seed, weeks = 16) {
  const st = M.createUniverse();
  M.setStory(st, { pace });
  M.seedStory(st, seed);
  let x = seed * 7919 + 13;
  const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  const shows = ['raw', 'smackdown'];
  shows.forEach(sh => Array.from({ length: 9 }, (_, i) => {
    const w = M.addWrestler(st, { name: `${sh} ${i}`, showId: sh, alignment: rnd() < 0.5 ? 'face' : 'heel' });
    M.setTraits(st, w.id, M.TRAITS.filter(() => rnd() < 0.18), { since: 'start' });
    return w;
  }));
  const roster = sh => st.wrestlers.filter(w => w.showId === sh);
  shows.forEach(sh => {
    const r = roster(sh);
    M.addTeam(st, { name: `${sh} A`, members: [r[0].id, r[1].id] });
    M.addTeam(st, { name: `${sh} B`, members: [r[2].id, r[3].id] });
    const t = M.addTitle(st, { name: `${sh} title`, showId: sh, division: 'men' });
    M.setChampion(st, t.id, { type: 'wrestler', id: r[8].id });
  });
  for (let wk = 1; wk <= weeks; wk++) {
    if (wk > 1) { M.setWeek(st, wk); DR.tick(st); }
    shows.forEach(sh => {
      const ev = M.addEvent(st, { showId: sh });
      DR.tick(st);
      const ws = [...roster(sh)].sort(() => rnd() - 0.5);
      const booked = [M.bookMatch(st, ev.id, { sides: S([ws[4].id, ws[5].id]) }), M.bookMatch(st, ev.id, { sides: S([ws[6].id, ws[7].id]) })];
      const teams = st.teams.filter(t => t.active && t.members.every(id => M.wrestlerById(st, id).showId === sh));
      if (teams.length >= 2) booked.push(M.bookMatch(st, ev.id, { sides: teams.slice(0, 2).map(t => ({ team: t.id, wrestlers: [...t.members] })) }));
      booked.forEach(m => {
        M.enterResult(st, ev.id, m.id, { sides: m.sides, outcome: 'win', winner: rnd() < 0.5 ? 0 : 1 });
        DR.tick(st);
      });
    });
  }
  return st;
}

test('occasional and varied: within its limits, never the same thing twice in a row, and the big moments spaced out', () => {
  const rate = pace => {
    const st = directorSeason(pace, 5);
    const P = DR.PACE[pace];
    const runs = st.story.rolls.filter(r => !r.undone);
    runs.forEach(r => assert.ok(r.considered.filter(k => k.picked).length <= P[r.phase], `${r.phase} cap`));
    const byWeek = new Map();
    runs.forEach(r => { const w = M.eventById(st, r.event).at.week; byWeek.set(w, (byWeek.get(w) || 0) + r.considered.filter(k => k.picked).length); });
    byWeek.forEach(n => assert.ok(n <= P.perWeek, 'week cap'));
    // the same thing between the same people doesn't come straight back
    const picks = runs.flatMap(r => r.considered.filter(k => k.picked).map(k => ({ ...k, wk: M.eventById(st, r.event).at.week })));
    picks.forEach((p, i) => picks.slice(i + 1).forEach(q => { if (q.key === p.key) assert.ok(q.wk - p.wk >= DR.RULES.repeatWeeks, p.key); }));
    // betrayals, breakups and turns are spaced apart across the universe
    ['betrayal', 'breakup', 'turn'].forEach(kind => {
      const wks = directorIncidents(st).filter(({ i }) => i.kind === kind).map(({ e }) => e.at.week).sort((a, b) => a - b);
      wks.forEach((w, i) => { if (i) assert.ok(w - wks[i - 1] >= DR.KIND[kind].spacing || w === wks[i - 1] && kind !== 'betrayal', `${kind} spacing`); });
    });
    sound(st);
    return { perShow: picks.length / 32, kinds: new Set(picks.map(p => p.kind)).size };
  };
  const [quiet, normal, wild] = ['quiet', 'normal', 'wild'].map(rate);
  assert.ok(quiet.perShow < normal.perShow && normal.perShow < wild.perShow, JSON.stringify([quiet, normal, wild]));
  assert.ok(normal.perShow > 0.15 && normal.perShow < 1, `normal: ${normal.perShow} a show`);
  assert.ok(wild.kinds >= 7, `wild: ${wild.kinds} kinds of event`);
});

test('big moments are earned: breakups follow repeated tension, betrayals follow buildup, turns follow a pattern', () => {
  let breakups = 0, betrayals = 0, turns = 0;
  for (const seed of [2, 5, 9, 13, 21]) {
    const st = directorSeason('wild', seed, 20);
    const all = M.allIncidents(st);
    const weekOf = e => e.at.week;
    directorIncidents(st).forEach(({ e, i }) => {
      if (i.kind === 'breakup') {
        breakups++;
        const members = [...i.by, ...i.on];
        const tension = all.filter(x => x.incident.kind === 'tension' && weekOf(e) - weekOf(x.event) < DR.RULES.buildupWeeks
          && M.compareStamps(st, x.event.at, e.at) <= 0 && x.incident.id !== i.id
          && [...x.incident.by, ...x.incident.on].filter(id => members.includes(id)).length >= 2).length;
        assert.ok(tension >= DR.RULES.breakupTension || i.cause.some(c => /building|A shock/.test(c)), `a breakup without buildup: ${i.cause.join('; ')}`);
      }
      if (i.kind === 'betrayal') {
        betrayals++;
        assert.ok(i.cause.some(c => /It has been building|A shock/.test(c)), i.cause.join('; '));
      }
      if (i.kind === 'turn') {
        turns++;
        assert.ok(i.cause.some(c => /times in \d+ weeks|done right by others|turned on by their own|was a face — no longer/.test(c)), i.cause.join('; '));
      }
    });
  }
  assert.ok(breakups + betrayals + turns > 0, 'some big moments happened');
});

test('undo a run, run it again, edit or delete one event: the owner overrides anything', () => {
  const { st, Sa, K, team, show } = directorWorld({ pace: 'wild' });
  const ev = show();
  const other = M.addWrestler(st, { name: 'X', showId: 'raw' }), y = M.addWrestler(st, { name: 'Y', showId: 'raw' });
  M.recordMatch(st, ev.id, { sides: [{ team: team.id, wrestlers: [Sa.id, K.id] }, { wrestlers: [other.id, y.id] }], winner: 1 });
  // a hand-made run, so this doesn't depend on the draw: a walk-out, and a turn
  const rels = RL.snapshot(st);
  const post = M.directorRollOf(st, ev.id, 'post');
  if (post) M.undoDirectorRoll(st, post.id);
  const alignment = K.alignment;
  const r = M.saveDirectorRoll(st, ev.id, 'post', { pool: 2, picked: [
    { kind: 'breakup', key: 'breakup:test', why: ['They had been falling apart'], plan: { incidents: [{ kind: 'breakup', by: [K.id], on: [Sa.id], team: team.id }], disband: team.id } },
    { kind: 'turn', key: 'turn:test', why: ['Enough'], plan: { incidents: [{ kind: 'turn', by: [K.id], to: 'heel' }] } },
  ], considered: [] }, { nonce: 5 });
  assert.deepEqual([team.active, K.alignment], [false, 'heel']);
  // override one event: edit it (it's marked as edited), or delete it (the turn goes back)
  const turn = ev.incidents.find(i => i.kind === 'turn' && i.story === r.id);
  M.updateIncident(st, ev.id, turn.id, { note: 'Snapped' });
  assert.equal(turn.edited, true);
  M.deleteIncident(st, ev.id, turn.id);
  assert.equal(K.alignment, alignment);
  // undo the whole run: the team is back, the run stays logged as undone, and the director doesn't redo it by itself
  M.undoDirectorRoll(st, r.id);
  assert.deepEqual([team.active, r.undone, ev.incidents.filter(i => i.story === r.id).length], [true, true, 0]);
  assert.deepEqual(RL.snapshot(st), rels);
  assert.deepEqual(DR.tick(st), []);
  throwsUE(() => M.undoDirectorRoll(st, r.id), /already been undone/);
  // run it again: a new nonce, logged, and just as reproducible
  const copy = JSON.parse(JSON.stringify(st));
  const again = DR.rerun(st, r.id);
  const again2 = DR.rerun(copy, r.id);
  assert.deepEqual([again.nonce, again.considered], [again2.nonce, again2.considered]);
  assert.ok(again.nonce > r.nonce);
  sound(st);
  // a correction the event followed from is flagged on it; the event stays canon
  const ev2 = show();
  const m = M.recordMatch(st, ev2.id, { sides: S([Sa.id, K.id]), winner: 0 });
  const rr = M.directorRollOf(st, ev2.id, 'post') || M.saveDirectorRoll(st, ev2.id, 'post', { picked: [] });
  M.undoDirectorRoll(st, rr.id);
  const r2 = M.saveDirectorRoll(st, ev2.id, 'post', { picked: [{ kind: 'attack', key: 'a', why: ['Lost'], basis: { match: m.id, winners: [Sa.id] },
    plan: { incidents: [{ kind: 'attack', by: [K.id], on: [Sa.id], match: m.id }] } }] }, { nonce: 1 });
  const atk = ev2.incidents.find(i => i.story === r2.id);
  assert.equal(M.storyProblem(st, ev2, atk), null);
  M.updateMatch(st, ev2.id, m.id, { sides: m.sides, outcome: 'win', winner: 1 });
  assert.equal(M.storyProblem(st, ev2, atk), 'The result it followed has been corrected since.');
  sound(st);
});

test('before a show is for the next show up; straight after each match once its result is in; after the show once the card is', () => {
  const st = M.createUniverse();
  M.seedStory(st, 3);
  const [a, b] = ['A', 'B'].map(n => M.addWrestler(st, { name: n, showId: 'raw' }));
  const [c, d] = ['C', 'D'].map(n => M.addWrestler(st, { name: n, showId: 'smackdown' }));
  const raw = M.addEvent(st, { showId: 'raw' }), sd = M.addEvent(st, { showId: 'smackdown' });
  const dueNow = () => DR.due(st).map(x => `${x.event.name}:${x.phase}${x.match ? `:${raw.matches.indexOf(x.match) + 1}` : ''}`);
  assert.deepEqual(dueNow(), ['Raw · Week 1:pre']);
  DR.tick(st);
  const m = M.bookMatch(st, raw.id, { sides: S([a.id, b.id]) });
  const m2 = M.bookMatch(st, raw.id, { sides: S([b.id, a.id]) });
  M.enterResult(st, raw.id, m2.id, { sides: m2.sides, outcome: 'win', winner: 1 });
  assert.deepEqual(dueNow(), ['Raw · Week 1:post:2'], 'match 2 is in: straight after it, whatever order the results come in');
  const [after2] = DR.tick(st);
  assert.deepEqual([after2.phase, after2.match], ['post', m2.id]);
  assert.equal(M.directorRollOf(st, raw.id, 'post', m2.id), after2);
  assert.deepEqual(dueNow(), [], 'half a card: nothing more yet');
  M.enterResult(st, raw.id, m.id, { sides: m.sides, outcome: 'win', winner: 0 });
  assert.deepEqual(dueNow(), ['Raw · Week 1:post:1', 'Raw · Week 1:post'], 'then match 1, and the card is complete: after the show');
  DR.tick(st);
  assert.ok(M.directorRollOf(st, raw.id, 'post'), 'after the show');
  assert.ok(M.directorRollOf(st, sd.id, 'pre'), 'then SmackDown is next up');
  throwsUE(() => M.saveDirectorRoll(st, raw.id, 'post', { picked: [] }, { match: m.id }), /already been through Raw · Week 1 after that match/);
  throwsUE(() => M.saveDirectorRoll(st, sd.id, 'pre', { picked: [] }, { match: m.id }), /match/);
  // switched off, nothing happens at all
  M.setStory(st, { on: false });
  M.recordMatch(st, sd.id, { sides: S([c.id, d.id]), winner: 0 });
  assert.deepEqual([DR.due(st), DR.tick(st)], [[], []]);
  sound(st);
});

test('switched back on, the director starts from that week; what happens before a show counts before its matches', () => {
  const st = M.createUniverse();
  M.seedStory(st, 5);
  const [a, b] = ['A', 'B'].map(n => M.addWrestler(st, { name: n, showId: 'raw' }));
  M.setStory(st, { on: false });
  const w1 = M.addEvent(st, { showId: 'raw' });
  M.recordMatch(st, w1.id, { sides: S([a.id, b.id]), winner: 0 });
  M.setWeek(st, 2);
  const w2 = M.addEvent(st, { showId: 'raw' });
  M.setStory(st, { on: true });
  assert.deepEqual(st.story.since, { season: M.activeSeason(st).id, week: 2 });
  assert.deepEqual(DR.due(st).map(x => `${x.event.name}:${x.phase}`), ['Raw · Week 2:pre'], 'the week it was off stays as it was');
  M.setStory(st, { on: true });
  assert.equal(st.story.since.week, 2, 'switching on when it is on changes nothing');
  // a confrontation before the show, then a brawl in it: the rivalry forms before the match, not after
  M.recordIncident(st, w2.id, { kind: 'confrontation', by: [a.id], on: [b.id], phase: 'pre' });
  M.recordMatch(st, w2.id, { sides: S([b.id, a.id]), winner: 0 });
  const order = RL.relationships(st).entries.filter(e => e.at && e.at.week === 2).map(e => e.cause.type);
  assert.equal(order[0], 'confrontation');
  throwsUE(() => M.recordIncident(st, w2.id, { kind: 'turn', by: [a.id] }), /Pick the alignment they turned to/);
  sound(st);
});

test('an underdog can rise: upsets are noticed, and anyone can be drawn to challenge — the title changes only on a result', () => {
  const { st, G, J, Sa, K, Se, N, title, show, one } = directorWorld({ pace: 'wild' });
  const ev = show();
  for (const w of [J, Sa, K, Se]) one(ev, w, N);                                  // Nobody loses everything
  one(ev, G, Se);
  const contenders = DR.titleContenders(st, ev.id, title.id);
  assert.ok(contenders.find(k => k.ids[0] === N.id).share > 0, 'the bottom of the table is in the draw');
  // Nobody beats the champion: the upset is noticed, from the bottom of the rankings
  const ev2 = show();
  const upset = M.recordMatch(st, ev2.id, { sides: S([N.id, G.id]), winner: 0 });
  const r = DR.lookAt(st, ev2.id, 'post', 0, upset.id);                          // straight after the upset
  const rise = r.considered.find(k => k.key === `rise:${N.id}`);
  assert.ok(rise && rise.chance > 0);
  assert.equal(M.currentReign(st, title.id).holder.id, G.id, 'a non-title win changes no title');
  // booked for the title and winning it on an entered result: champion
  const ev3 = show();
  const tm = M.bookMatch(st, ev3.id, { sides: S([N.id, G.id]), titleId: title.id });
  M.enterResult(st, ev3.id, tm.id, { sides: tm.sides, outcome: 'win', winner: 0 }, { titleChange: true });
  DR.tick(st);
  assert.equal(M.currentReign(st, title.id).holder.id, N.id);
  assert.ok(upset);
  sound(st);
});

test('alliances form between people who aren’t partners already; early on, an upset needs a losing record behind it', () => {
  const { st, G, J, Sa, K, Se, N, show, one } = directorWorld({ pace: 'wild' });
  M.setStory(st, { on: false });                                     // looked at by hand, nothing recorded
  [Sa, K, J].forEach(w => M.editRelationship(st, { action: 'form', kind: 'grudge', a: w.id, b: G.id, level: 3, since: 'start' }));
  const ev = show();
  const allies = DR.lookAt(st, ev.id, 'pre', 0).considered.filter(k => k.kind === 'alliance').map(k => k.key);
  assert.ok(!allies.includes(`alliance:${[Sa.id, K.id].sort().join('+')}`), 'KO & Sami are a team already');
  assert.ok(allies.includes(`alliance:${[J.id, Sa.id].sort().join('+')}`), 'Jey and Sami share an enemy');
  // Jey beats the champion in his first match: no record to speak of, so no upset
  const first = one(ev, J, G);
  assert.ok(!DR.lookAt(st, ev.id, 'post', 0, first.id).considered.some(k => k.key === `rise:${J.id}`));
  // Nobody loses twice, then beats the champion: that's an upset
  const ev2 = show();
  one(ev2, J, N); one(ev2, Se, N);
  const win = one(ev2, N, G);
  const rise = DR.lookAt(st, ev2.id, 'post', 0, win.id).considered.find(k => k.key === `rise:${N.id}`);
  assert.ok(rise && rise.chance > 0);
});

test('a run whose picks can’t be recorded is logged with nothing made and why — and nothing after it is held up', () => {
  const { st, Sa, K, team, show } = directorWorld({ pace: 'wild' });
  M.setStory(st, { on: false });
  const ev = show();
  const m = M.recordMatch(st, ev.id, { sides: [{ team: team.id, wrestlers: [Sa.id, K.id] }, { wrestlers: [M.addWrestler(st, { name: 'X', showId: 'raw' }).id] }], winner: 1 });
  M.setStory(st, { on: true });
  // a pick that no longer fits the record (the team has already split) is refused as a whole...
  M.setTeamActive(st, team.id, false);
  const bad = { pool: 1, picked: [{ kind: 'breakup', key: 'b', why: ['Clashed twice'], plan: { incidents: [{ kind: 'breakup', by: [K.id], on: [Sa.id], team: team.id, match: m.id }], disband: team.id } }],
    considered: [{ kind: 'breakup', key: 'b', chance: 0.5, draw: 0.1, picked: true }] };
  throwsUE(() => M.saveDirectorRoll(st, ev.id, 'post', bad), /already split/);
  // ...and the fallback the director uses: logged, nothing made, the reason kept
  const r = M.saveDirectorRoll(st, ev.id, 'post', { ...bad, picked: [], considered: bad.considered.map(k => ({ ...k, picked: false })) }, { problem: 'KO & Sami have already split.' });
  assert.deepEqual([r.made, r.problem, r.considered[0].picked], [[], 'KO & Sami have already split.', false]);
  sound(st);
  assert.ok(M.validate(M.migrate(JSON.parse(exportUniverse(st)))).length === 0);
});

// ---------------------------------------------------------------- simulate ahead

test('simulate ahead: weeks played on a copy — the universe itself never changes, and the same seed simulates the same weeks', () => {
  const { st } = bookingSample();
  M.setStory(st, { on: false });
  const before = JSON.stringify(st);
  const one = SIM.simulate(st, { weeks: 3, seed: 5 });
  assert.equal(JSON.stringify(st), before, 'nothing in the universe changed');
  assert.equal(st.story.on, false);
  const after = one.after;
  assert.deepEqual(M.validate(after), []);
  assert.equal(M.activeSeason(after).week, M.activeSeason(st).week + 2);
  assert.ok(after.story.on, 'the story director runs in the copy');
  // every show in those weeks played out: every match on them has a result
  const s = M.activeSeason(after);
  const evs = after.events.filter(e => e.at.season === s.id && e.at.week >= one.report.from && e.at.week <= one.report.to);
  assert.ok(evs.length >= 3 * after.shows.length - 1);
  assert.ok(evs.every(e => e.matches.every(m => m.status === 'played')));
  assert.ok(evs.every(e => e.draft === null), 'drafts booked as they stood');
  // only active wrestlers on the cards the booker drew
  const booked = evs.flatMap(e => e.matches.filter(m => m.auto)).flatMap(m => m.sides.flatMap(sd => sd.wrestlers));
  assert.ok(booked.every(id => M.wrestlerById(st, id).status === 'active'));
  // the same seed, the same weeks; another seed, (almost surely) others
  const again = SIM.simulate(st, { weeks: 3, seed: 5 });
  assert.equal(JSON.stringify(again.after), JSON.stringify(after));
  const other = SIM.simulate(st, { weeks: 3, seed: 6 });
  assert.notEqual(JSON.stringify(other.after.events), JSON.stringify(after.events));
});

test('simulate ahead: the report counts what changed against the universe as it is', () => {
  const { st } = bookingSample();
  const { after, report: r } = SIM.simulate(st, { weeks: 2, seed: 9, pace: 'wild' });
  const known = new Set(st.events.flatMap(e => e.matches.filter(m => m.status === 'played').map(m => m.id)));
  const played = after.events.flatMap(e => e.matches.filter(m => m.status === 'played' && !known.has(m.id)));
  assert.equal(r.matches, played.length);
  assert.equal(r.pace, 'wild');
  // title changes: every reign that began in those weeks, from the result that made it
  const fresh = after.reigns.filter(x => !st.reigns.some(y => y.id === x.id));
  assert.equal(r.titles.length, fresh.length);
  fresh.forEach(x => assert.ok(played.some(m => m.id === x.matchId), 'only on a simulated result'));
  // relationships: the same as comparing the two
  assert.deepEqual(r.relationships.lines, RL.changesBetween(after, RL.snapshot(st), RL.snapshot(after)));
  const formed = Object.values(r.relationships.formed).reduce((n, k) => n + k, 0);
  const ended = Object.values(r.relationships.ended).reduce((n, k) => n + k, 0);
  assert.equal(formed + ended + r.relationships.grew + r.relationships.cooled, r.relationships.lines.length);
  // story events: every new incident is in one of them
  const incs = after.events.flatMap(e => e.incidents).filter(i => !st.events.some(e => e.incidents.some(j => j.id === i.id)));
  assert.ok(r.story.length > 0 && r.story.length <= incs.length);
  assert.equal(Object.values(r.storyKinds).reduce((n, k) => n + k, 0), r.story.length);
  assert.ok(r.story.every(g => typeof g.text === 'string' && g.text && g.where && g.when));
  assert.ok(r.standings.length >= 4 && r.standings.every(x => x.top.length >= 1));
  assert.deepEqual(r.problems, []);
});

test('simulate ahead: favourites usually win; "anyone can win" is even', () => {
  const st = M.createUniverse();
  M.setStory(st, { on: false });
  const [A, B] = ['Ace', 'Jobber'].map(n => M.addWrestler(st, { name: n, showId: 'raw' }));
  const ev = M.addEvent(st, { showId: 'raw' });
  for (let i = 0; i < 10; i++) M.recordMatch(st, ev.id, { sides: S([A.id, B.id]), winner: 0 });
  const tally = results => {
    const won = [0, 0, 0];
    for (let seed = 1; seed <= 300; seed++) {
      const c = JSON.parse(JSON.stringify(st));
      const e = c.events[0];
      const m = M.bookMatch(c, e.id, { sides: S([A.id, B.id]) });
      SIM.playMatch(c, e, m, { seed, results });
      won[m.outcome === 'win' ? m.winner : 2]++;
    }
    return won;
  };
  const form = tally('form'), even = tally('even');
  assert.ok(form[0] > 0.75 * 300 && form[1] > 0, `favourite ${form[0]}, upsets ${form[1]}`);
  assert.ok(Math.abs(even[0] - even[1]) < 60, `even ${even}`);
  assert.ok(form[2] > 0 && form[2] < 30, 'a draw or no contest now and then');
  // a title changes hands when the challenger wins it, and only then
  const t = M.addTitle(st, { name: 'Belt', showId: 'raw', division: 'men' });
  M.setChampion(st, t.id, { type: 'wrestler', id: B.id });
  let changed = 0, kept = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const c = JSON.parse(JSON.stringify(st));
    const m = M.bookMatch(c, c.events[0].id, { sides: S([A.id, B.id]), titleId: t.id });
    SIM.playMatch(c, c.events[0], m, { seed });
    const holder = M.currentReign(c, t.id).holder.id;
    if (m.outcome === 'win' && m.winner === 0) { assert.equal(holder, A.id); changed++; } else { assert.equal(holder, B.id); kept++; }
  }
  assert.ok(changed > 0 && kept > 0);
});

test('a dropdown gets a search once its list is long enough to need one', () => {
  const list = n => `<select class="uv-in"><option value="">— Pick —</option>${Array.from({ length: n }, (_, i) => `<option value="w${i}">W${i}</option>`).join('')}</select>`;
  assert.equal(findable(list(FIND_FROM - 1)), list(FIND_FROM - 1), 'a short list is just the dropdown');
  const long = findable(list(FIND_FROM));
  assert.ok(long.startsWith('<div class="uv-find">') && long.includes(list(FIND_FROM)) && /onclick="uvFind\(this\)"/.test(long));
});

test('momentum and goals come from the record', () => {
  const { st, G, J, N, show, one } = directorWorld();
  const ev = show();
  one(ev, N, J); one(ev, N, G); one(ev, N, J);
  const mo = DR.momentumOf(st, N.id);
  assert.equal(mo.label, 'hot');
  assert.ok(mo.reasons.some(r => /beat Gunther, a champion/.test(r)));
  assert.equal(DR.goalOf(st, G.id), 'Keep the World Heavyweight Championship');
  M.editRelationship(st, { action: 'form', kind: 'grudge', a: J.id, b: N.id, level: 2 });
  assert.equal(DR.goalOf(st, J.id), 'Revenge on Nobody');
});

// ---------------------------------------------------------------- #1 contender's matches

// Raw: Gunther holds the World title; Cody, Seth (ambitious), Jey, Drew, Sami; two tag teams and a tag title
function contenderWorld() {
  const st = M.createUniverse();
  M.setStory(st, { on: false });
  const [G, C, Se, J, D, Sa, K, F, Da] = ['Gunther', 'Cody', 'Seth', 'Jey', 'Drew', 'Sami', 'Kevin', 'Finn', 'Damian']
    .map(n => M.addWrestler(st, { name: n, showId: 'raw', gender: 'male' }));
  M.setTraits(st, Se.id, ['ambitious'], { since: 'start' });
  const world = M.addTitle(st, { name: 'World Title', showId: 'raw', division: 'men' });
  M.setChampion(st, world.id, { type: 'wrestler', id: G.id });
  const ko = M.addTeam(st, { name: 'KO & Sami', members: [Sa.id, K.id] });
  const jd = M.addTeam(st, { name: 'Judgment Day', members: [F.id, Da.id] });
  const tag = M.addTitle(st, { name: 'Tag Titles', showId: 'raw', division: 'men', kind: 'tag' });
  let week = 0;
  const show = () => { M.setWeek(st, ++week); return M.addEvent(st, { showId: 'raw' }); };
  return { st, G, C, Se, J, D, Sa, K, F, Da, world, ko, jd, tag, show };
}
const nextUp = (st, h) => (h ? M.holderName(st, h.holder) : null);

test('a #1 contender’s match: what can be one', () => {
  const { st, G, C, Se, J, Sa, K, F, Da, world, ko, jd, tag, show } = contenderWorld();
  const ev = show();
  const one = (a, b, extra = {}) => ({ sides: S([a.id, b.id]), contender: world.id, ...extra });
  throwsUE(() => M.bookMatch(st, ev.id, one(C, Se, { titleId: world.id })), /either for a title or a #1 contender’s match/);
  throwsUE(() => M.bookMatch(st, ev.id, one(G, C)), /Gunther holds the World Title — a #1 contender’s match is for the challengers/);
  throwsUE(() => M.bookMatch(st, ev.id, { sides: S([[C.id, J.id], Se.id]), contender: world.id }), /one wrestler a side/);
  throwsUE(() => M.bookMatch(st, ev.id, { sides: S([[Sa.id, K.id], [F.id, Da.id]]), contender: tag.id }), /every side wrestling as a tag team/);
  throwsUE(() => M.bookMatch(st, ev.id, { sides: S([C.id, Se.id]), contender: 'nope' }), /championship/);
  const m = M.bookMatch(st, ev.id, one(C, Se));
  assert.deepEqual([m.contender, m.titleId], [world.id, null]);
  const fours = M.bookMatch(st, ev.id, { sides: S([C.id, Se.id, J.id]), contender: world.id });
  assert.equal(fours.sides.length, 3);
  const teams = M.bookMatch(st, ev.id, { sides: [{ team: ko.id, wrestlers: ko.members }, { team: jd.id, wrestlers: jd.members }], contender: tag.id });
  assert.equal(teams.contender, tag.id);
  // edits keep it unless told otherwise; one or the other
  M.updateBooking(st, ev.id, m.id, { stip: 'Ladder' });
  assert.equal(M.eventById(st, ev.id).matches[0].contender, world.id);
  throwsUE(() => M.updateBooking(st, ev.id, m.id, { titleId: world.id }), /not both/);
  M.updateBooking(st, ev.id, m.id, { contender: null, titleId: world.id, sides: S([G.id, C.id]) });
  assert.deepEqual([m.contender, m.titleId], [null, world.id]);
  // a title with #1 contender's matches is part of the history
  assert.ok(M.titleRefs(st, tag.id).includes('a #1 contender’s match'));
  throwsUE(() => M.deleteTitle(st, tag.id), /can't be deleted/);
  // retired: no new ones; an old one keeps its stakes when corrected
  M.vacateTitle(st, world.id);
  sound(st);
});

test('the #1 contender: the winner is next in line until they’ve had their shot', () => {
  const { st, G, C, Se, J, D, world, show } = contenderWorld();
  const ev = show();
  assert.equal(M.numberOneContender(st, world.id), null);
  const m1 = M.recordMatch(st, ev.id, { sides: S([C.id, Se.id]), contender: world.id, winner: 0 });
  assert.equal(nextUp(st, M.numberOneContender(st, world.id)), 'Cody');
  assert.deepEqual(M.contenderFor(st, { type: 'wrestler', id: C.id }).map(t => t.name), ['World Title']);
  // a draw names nobody, and leaves Cody where he is
  M.recordMatch(st, ev.id, { sides: S([J.id, D.id]), contender: world.id, outcome: 'draw' });
  assert.equal(nextUp(st, M.numberOneContender(st, world.id)), 'Cody');
  // a later one names someone new
  const ev2 = show();
  const m2 = M.recordMatch(st, ev2.id, { sides: S([J.id, D.id, Se.id]), contender: world.id, winner: 2 });
  assert.equal(nextUp(st, M.numberOneContender(st, world.id)), 'Seth');
  // correcting it corrects who's next; a correction that doesn't mention the stakes keeps them
  M.updateMatch(st, ev2.id, m2.id, { sides: m2.sides, outcome: 'win', winner: 0 });
  assert.equal(nextUp(st, M.numberOneContender(st, world.id)), 'Jey');
  assert.equal(m2.contender, world.id);
  // their shot, win or lose, uses it up
  const ev3 = show();
  M.recordMatch(st, ev3.id, { sides: S([G.id, J.id]), titleId: world.id, winner: 0 });
  assert.equal(M.numberOneContender(st, world.id), null);
  // a title match someone else had doesn't
  M.recordMatch(st, ev3.id, { sides: S([C.id, D.id]), contender: world.id, winner: 1 });
  M.recordMatch(st, ev3.id, { sides: S([G.id, Se.id]), titleId: world.id, winner: 0 });
  assert.equal(nextUp(st, M.numberOneContender(st, world.id)), 'Drew');
  // winning the title some other way ends it too
  M.setChampion(st, world.id, { type: 'wrestler', id: D.id });
  assert.equal(M.numberOneContender(st, world.id), null);
  // clearing a result takes it back
  M.clearResult(st, ev.id, m1.id);
  assert.equal(M.eventById(st, ev.id).matches[0].contender, world.id);
  sound(st);
});

test('losing a #1 contender’s match is like losing a title: a grudge against the winner, and rivals', () => {
  const { st, C, Se, J, ko, jd, tag, world, show } = contenderWorld();
  const ev = show();
  const d0 = RL.snapshot(st);
  M.recordMatch(st, ev.id, { sides: S([C.id, Se.id, J.id]), contender: world.id, winner: 0 });
  const d = RL.relationships(st);
  const lvl = (kind, a, b) => { const r = d.rels.get(RL.relKey(kind, a.id, b.id)); return r && r.active ? r.level : 0; };
  assert.deepEqual([lvl('grudge', Se, C), lvl('grudge', J, C), lvl('rivals', Se, C), lvl('rivals', J, C), lvl('grudge', Se, J)], [2, 1, 1, 1, 0]);   // Seth is ambitious
  assert.ok(RL.changesBetween(st, d0, RL.snapshot(st)).includes('Seth holds a grudge against Cody (heat 2)'));
  assert.ok(d.entries.some(e => RL.entryText(st, e).cause === `Seth lost the #1 contender’s match for the World Title to Cody at ${ev.name}`));
  // a draw: nothing
  const ev2 = show();
  M.recordMatch(st, ev2.id, { sides: S([J.id, Se.id]), contender: world.id, outcome: 'draw' });
  assert.equal((RL.relationships(st).rels.get(RL.relKey('grudge', J.id, Se.id)) || {}).active || false, false);
  // for a tag title: the teams too
  M.recordMatch(st, ev2.id, { sides: [{ team: ko.id, wrestlers: ko.members }, { team: jd.id, wrestlers: jd.members }], contender: tag.id, winner: 1 });
  const t = RL.relationships(st);
  assert.deepEqual(['grudge', 'rivals'].map(k => (t.teams.get(RL.teamRelKey(k, ko.id, jd.id)) || {}).level), [1, 1]);
  assert.ok(t.teamEntries.some(e => RL.entryText(st, e).cause === `KO & Sami lost the #1 contender’s match for the Tag Titles to Judgment Day at ${ev2.name}`));
  assert.equal(nextUp(st, M.numberOneContender(st, tag.id)), 'Judgment Day');
  sound(st);
});

test('drafts carry a #1 contender’s match; the booker books them, and gives the #1 contender the next shot', () => {
  const { st, G, C, Se, J, D, world, show } = contenderWorld();
  const ev = show();
  M.recordMatch(st, ev.id, { sides: S([G.id, J.id]), titleId: world.id, winner: 0 });              // just defended
  const ev2 = show();
  const ideas = B.ideasFor(st, ev2.id);
  const cont = ideas.filter(x => x.kind === 'contender');
  assert.ok(cont.length && cont.every(x => x.contender === world.id && !x.titleId && !x.people.includes(G.id)));
  // on a draft and booked, it stays one
  M.setDraft(st, ev2.id, [B.toSpec(cont[0])]);
  assert.equal(M.eventById(st, ev2.id).draft.matches[0].contender, world.id);
  const [booked] = M.bookDraft(st, ev2.id);
  assert.equal(booked.contender, world.id);
  M.enterResult(st, ev2.id, booked.id, { winner: 0 });
  const next = M.numberOneContender(st, world.id);
  // next week: the #1 contender gets the shot, and there's no other #1 contender's match for it
  const ev3 = show();
  const later = B.ideasFor(st, ev3.id);
  assert.equal(later.filter(x => x.kind === 'contender' && x.contender === world.id).length, 0);
  const shot = later.find(x => x.kind === 'title' && x.titleId === world.id && x.sides.length === 2);
  assert.ok(shot.people.includes(next.holder.id));
  assert.match(shot.why[0], new RegExp(`^${M.holderName(st, next.holder)} earned the shot: #1 contender — won the #1 contender’s match last week$`));
  // a card never has a title's match and a #1 contender's match for it
  const r = B.draftCard(st, ev3.id);
  assert.ok(!(r.matches.some(x => x.titleId === world.id) && r.matches.some(x => x.contender === world.id)));
  // a draft that names the champion is pointed out
  M.setDraft(st, ev3.id, [{ sides: S([C.id, Se.id]), contender: world.id }]);
  M.setChampion(st, world.id, { type: 'wrestler', id: C.id });
  assert.ok([...B.draftNotes(st, M.eventById(st, ev3.id)).values()][0].includes('Cody holds the World Title now — a #1 contender’s match is for the challengers'));
  assert.ok(D && J);
});

test('a version 12 save: no match was a #1 contender’s match', () => {
  const { st, C, Se, show } = contenderWorld();
  const ev = show();
  M.recordMatch(st, ev.id, { sides: S([C.id, Se.id]), winner: 0 });
  M.setDraft(st, ev.id, [{ sides: S([C.id, Se.id]) }]);
  const old = JSON.parse(JSON.stringify(st));
  old.version = 12;
  old.events.forEach(e => { e.matches.forEach(m => delete m.contender); if (e.draft) e.draft.matches.forEach(m => delete m.contender); });
  const up = M.migrate(old);
  assert.deepEqual([up.version, up.events[0].matches[0].contender, up.events[0].draft.matches[0].contender], [M.SCHEMA_VERSION, null, null]);
  sound(up);
  const bad = JSON.parse(JSON.stringify(up));
  bad.events[0].matches[0].contender = bad.titles[0].id;
  bad.events[0].matches[0].titleId = bad.titles[0].id;
  assert.ok(M.validate(bad).some(x => /both a title match and a #1 contender’s match/.test(x)));
});

// ---------------------------------------------------------------- the director: personalities, friends, partners and rivals

test('the director: friends, partners and allies run in to help someone win; rivals cost someone the match — never against their own', () => {
  const { st, G, J, Sa, K, Se, N, show } = directorWorld();
  M.setStory(st, { on: false });
  M.editRelationship(st, { action: 'form', kind: 'friends', a: Se.id, b: G.id, since: 'start' });
  M.editRelationship(st, { action: 'form', kind: 'allies', a: N.id, b: J.id, since: 'start' });
  M.setTraits(st, Se.id, ['loyal'], { since: 'start' });
  const ev = show();
  const m = M.recordMatch(st, ev.id, { sides: S([G.id, J.id]), winner: 0 });
  const runIns = DR.possibilities(st, ev.id, 'post', m.id).filter(p => p.kind === 'interference');
  const seth = runIns.find(p => p.key === `interference:${Se.id}:${m.id}`);
  assert.deepEqual(seth.incidents, [{ kind: 'interference', by: [Se.id], on: [J.id], helped: [G.id], match: m.id }]);
  assert.ok(['Seth and Gunther are friends', 'Seth is loyal', 'Seth is a heel'].every(t => seth.why.includes(t)));
  assert.ok(!runIns.some(p => p.incidents[0].by.includes(N.id)), 'Nobody never interferes against their ally Jey');
  // a partner helps a partner: Kevin for Sami
  const m2 = M.recordMatch(st, ev.id, { sides: S([Sa.id, N.id]), winner: 0 });
  const kev = DR.possibilities(st, ev.id, 'post', m2.id).find(p => p.key === `interference:${K.id}:${m2.id}`);
  assert.ok(kev.why[0] === 'Kevin is in KO & Sami with Sami' && kev.why.some(t => /^Kevin is opportunistic/.test(t)));
  // a rival costs someone the match - helping nobody in particular (a newcomer beats Seth; Nobody has it in for Seth)
  M.editRelationship(st, { action: 'form', kind: 'grudge', a: N.id, b: Se.id, level: 2, since: 'start' });
  const X = M.addWrestler(st, { name: 'Xavier', showId: 'raw', alignment: 'face' });
  const m3 = M.recordMatch(st, ev.id, { sides: S([X.id, Se.id]), winner: 0 });
  const nob = DR.possibilities(st, ev.id, 'post', m3.id).find(p => p.key === `interference:${N.id}:${m3.id}`);
  assert.deepEqual([nob.incidents[0].on, nob.incidents[0].helped, nob.why[0]], [[Se.id], [], 'Nobody holds a grudge against Seth (heat 2)']);
  // made canon, it does what an interference does
  M.recordIncident(st, ev.id, seth.incidents[0]);
  assert.ok(RL.relationships(st).rels.get(RL.relKey('grudge', J.id, Se.id)).active);
});

test('the director: partners join a post-match attack; tag teams at odds face off as teams', () => {
  const { st, G, J, Sa, K, Se, N, team, show } = directorWorld();
  M.setStory(st, { on: false });
  const ev = show();
  // Kevin and Sami lose together: an attack by either brings the other
  const m = M.recordMatch(st, ev.id, { sides: [{ team: team.id, wrestlers: [Sa.id, K.id] }, { wrestlers: [G.id, Se.id] }], winner: 1 });
  const attack = DR.possibilities(st, ev.id, 'post', m.id).find(p => p.kind === 'attack' && p.incidents[0].match === m.id);
  assert.deepEqual([...attack.incidents[0].by].sort(), [K.id, Sa.id].sort());
  assert.ok(attack.why.some(t => /joins in — (Sami|Kevin) lost alongside (Kevin|Sami), their partner in KO & Sami$/.test(t)));
  // a coward brings the team (Sami isn't loyal here, so it's Kevin's doing)
  M.setTraits(st, K.id, ['cowardly'], { since: 'start' });
  M.setTraits(st, Sa.id, [], { since: 'start' });
  const m2 = M.recordMatch(st, ev.id, { sides: S([J.id, K.id]), winner: 0 });
  const a2 = DR.possibilities(st, ev.id, 'post', m2.id).find(p => p.kind === 'attack' && p.incidents[0].match === m2.id);
  assert.deepEqual(a2.incidents[0].by, [K.id, Sa.id]);
  assert.ok(a2.why.includes('Sami joins in — Kevin is cowardly and brings KO & Sami backup'));
  // two teams with a grudge: before the next show they face off as teams, not pair by pair
  const other = M.addTeam(st, { name: 'Bloodline', members: [J.id, N.id] });
  M.editRelationship(st, { teams: true, action: 'form', kind: 'grudge', a: team.id, b: other.id, level: 2, since: 'start' });
  M.setWeek(st, 2);
  const ev2 = M.addEvent(st, { showId: 'raw' });
  const pre = DR.possibilities(st, ev2.id, 'pre').filter(p => p.kind === 'confrontation');
  const faceOff = pre.find(p => p.key === `confrontation:${[team.id, other.id].sort().join('+')}`);
  assert.deepEqual([faceOff.incidents[0].by, faceOff.incidents[0].on], [team.members, other.members]);
  assert.equal(faceOff.why[0], 'KO & Sami hold a grudge against Bloodline (heat 2)');
  assert.ok(!pre.some(p => p.incidents[0].by.length === 1 && [Sa.id, K.id].includes(p.incidents[0].by[0]) && [J.id, N.id].includes(p.incidents[0].on[0])),
    'no pair-by-pair confrontations for bad blood that is only between their teams');
});

test('straight after each match: its events are about it, on it, and one show’s limits hold across its matches', () => {
  let shows = 0, made = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { st, G, J, Sa, K, Se, N, team, show } = directorWorld({ pace: 'wild', seed });
    [[J, G, 3], [Sa, Se, 2], [N, K, 2]].forEach(([a, b, level]) => M.editRelationship(st, { action: 'form', kind: 'grudge', a: a.id, b: b.id, level, since: 'start' }));
    for (let w = 0; w < 3; w++) {
      const ev = show();
      // the card booked first, then each result in: the director goes straight away, for that match
      const card = [[G, J], [Se, Sa], [K, N]].map(([a, b]) => M.bookMatch(st, ev.id, { sides: S([a.id, b.id]) }));
      card.push(M.bookMatch(st, ev.id, { sides: [{ team: team.id, wrestlers: [Sa.id, K.id] }, { wrestlers: [J.id, N.id] }] }));
      card.forEach((m, i) => {
        const before = st.story.rolls.length;
        M.enterResult(st, ev.id, m.id, { winner: i % 2 });
        DR.tick(st);
        const runs = st.story.rolls.slice(before);
        assert.deepEqual(runs.map(r => r.match), i < card.length - 1 ? [m.id] : [m.id, null], 'straight after it - and after the show once the card is in');
      });
      shows++;
      const rolls = st.story.rolls.filter(r => r.event === ev.id && r.phase === 'post');
      assert.deepEqual(rolls.map(r => r.match), [...ev.matches.map(m => m.id), null], 'one run after each match, in card order, then one after the show');
      const picks = rolls.flatMap(r => r.considered.filter(k => k.picked));
      assert.ok(picks.length <= DR.PACE.wild.post, 'the show’s limit, across its matches');
      const fam = k => (k === 'save' ? 'attack' : k === 'cooling' || k === 'respect' ? 'truce' : k);
      assert.equal(new Set(picks.map(k => fam(k.kind))).size, picks.length, 'never two of a kind on a show');
      const theirs = ev.incidents.filter(x => x.story);
      made += theirs.length;
      rolls.filter(r => r.match).forEach(r => theirs.filter(x => r.made.includes(x.id)).forEach(x => assert.equal(x.match, r.match, 'each on the match it followed')));
      // nobody in two of the director's events on one show
      const groups = rolls.flatMap(r => r.made.length ? [ev.incidents.filter(x => r.made.includes(x.id))] : []);
      const seen = new Set();
      groups.forEach(g => {
        const people = new Set(g.flatMap(x => [...x.by, ...x.on, ...x.helped]));
        people.forEach(id => assert.ok(!seen.has(id), 'one wrestler, one event a show'));
        people.forEach(id => seen.add(id));
      });
    }
    sound(st);
  }
  assert.ok(made > 0, `${made} events over ${shows} shows`);
});

test('what happens straight after a match counts right after it — before the next match', () => {
  const { st, A, B, show } = relWorld();
  const ev = show();
  const m1 = M.recordMatch(st, ev.id, { sides: S([A.id, B.id]), winner: 0 });
  M.recordMatch(st, ev.id, { sides: S([A.id, B.id]), winner: 0 });
  M.recordMatch(st, ev.id, { sides: S([A.id, B.id]), winner: 0 });               // B's third loss in a row: a grudge, or more
  M.recordIncident(st, ev.id, { kind: 'attack', by: [A.id], on: [B.id], match: m1.id });   // straight after the first
  const grudge = RL.relationships(st).entries.filter(e => e.rel === RL.relKey('grudge', B.id, A.id)).map(e => `${e.cause.type}:${e.change}`);
  assert.deepEqual(grudge, ['attack:formed', 'losses:raised']);
  // an incident that isn't tied to a match still counts after them all
  const ev2 = show();
  M.recordMatch(st, ev2.id, { sides: S([B.id, A.id]), winner: 0 });
  M.recordIncident(st, ev2.id, { kind: 'truce', by: [A.id], on: [B.id] });
  assert.equal(RL.relationships(st).entries.filter(e => e.at === ev2.at || (e.at && e.at.seq === ev2.at.seq)).pop().cause.type, 'truce');
});

test('one match’s run can be undone or run again on its own; a v13 save’s runs were for whole shows', () => {
  const { st, G, J, Se, N, show, one } = directorWorld({ pace: 'wild', seed: 11 });
  [[J, G, 3], [N, Se, 3]].forEach(([a, b, level]) => M.editRelationship(st, { action: 'form', kind: 'grudge', a: a.id, b: b.id, level, since: 'start' }));
  const ev = show();
  const m1 = one(ev, G, J), m2 = one(ev, Se, N);
  const r1 = M.directorRollOf(st, ev.id, 'post', m1.id), r2 = M.directorRollOf(st, ev.id, 'post', m2.id);
  const again = DR.rerun(st, r1.id);
  assert.deepEqual([again.match, again.nonce, r1.undone, M.directorRollOf(st, ev.id, 'post', m1.id).id], [m1.id, 1, true, again.id]);
  assert.equal(M.directorRollOf(st, ev.id, 'post', m2.id), r2, 'the other match’s run is untouched');
  M.undoDirectorRoll(st, again.id);
  assert.deepEqual(DR.due(st).filter(d => d.match && d.match.id === m1.id), [], 'undone stays undone');
  sound(st);
  // older saves: every run was for a whole show's part
  const old = JSON.parse(exportUniverse(st));
  old.version = 13;
  old.story.rolls.forEach(r => delete r.match);
  const up = M.migrate(old);
  assert.ok(up.story.rolls.every(r => r.match === null));
  // a show already gone through as a whole isn't gone over again match by match
  assert.deepEqual(DR.due(up).filter(d => d.event.id === ev.id), []);
  // a match recorded straight onto the card later still gets its own run
  const m3 = one(ev, J, N);
  assert.ok(M.directorRollOf(st, ev.id, 'post', m3.id));
  const bad = JSON.parse(exportUniverse(st));
  bad.story.rolls.push({ ...bad.story.rolls.find(r => r.match === m2.id && !r.undone), id: 'dr999', made: [] });
  assert.ok(M.validate(bad).some(x => /second run for the same part/.test(x)));
});

test('the director: a new #1 contender steps up to the champion', () => {
  const { st, G, J, Se, N, title, show } = directorWorld();
  M.setStory(st, { on: false });
  const ev = show();
  const m = M.recordMatch(st, ev.id, { sides: S([N.id, Se.id]), contender: title.id, winner: 0 });
  const odds = DR.titleContenders(st, ev.id, title.id).sort((a, b) => b.share - a.share);
  assert.equal(odds[0].name, 'Nobody');
  assert.equal(odds[0].reasons[0], `Nobody won the #1 contender’s match at ${ev.name}`);
  // the loser may attack - it's like losing a title
  const attack = DR.possibilities(st, ev.id, 'post', m.id).find(p => p.kind === 'attack' && p.incidents[0].match === m.id);
  assert.ok(attack.why.includes('Seth just lost a #1 contender’s match for the World Heavyweight Championship'));
  // before the next show, the #1 contender wants the match, hot or not
  M.setWeek(st, 2);
  const ev2 = M.addEvent(st, { showId: 'raw' });
  const demand = DR.possibilities(st, ev2.id, 'pre').find(p => p.key === `demand:${N.id}:${title.id}`);
  assert.ok(demand.why.includes(`Nobody is #1 contender — won the #1 contender’s match at ${ev.name} — and wants the match`));
  assert.ok(G && J);
});

test('new incidents: confrontations, alliances, tension, truces, open challenges and turns', () => {
  const { st, G, J, Sa, K, Se, title, team, show } = directorWorld({ pace: 'quiet' });
  M.setStory(st, { on: false });
  const ev = show();
  const rel = () => [...RL.relationships(st).rels.values()].filter(r => r.active).map(r => `${RL.relText(st, r)}${RL.levelText(r) ? ` ${r.level}` : ''}`).sort();
  M.recordIncident(st, ev.id, { kind: 'confrontation', by: [G.id], on: [J.id] });
  M.recordIncident(st, ev.id, { kind: 'brawl', by: [G.id], on: [J.id] });
  M.recordIncident(st, ev.id, { kind: 'alliance', by: [Se.id], on: [G.id] });
  assert.deepEqual(rel(), ['Gunther and Jey are rivals 2', 'Gunther holds a grudge against Jey 1', 'Jey holds a grudge against Gunther 1', 'Kevin and Sami are allies 3', 'Seth and Gunther are allies 1'].sort());
  M.recordIncident(st, ev.id, { kind: 'truce', by: [J.id], on: [G.id] });
  assert.deepEqual(rel(), ['Gunther and Jey are rivals 1', 'Kevin and Sami are allies 3', 'Seth and Gunther are allies 1'].sort());
  M.recordIncident(st, ev.id, { kind: 'tension', by: [K.id], on: [Sa.id], team: team.id });
  assert.ok(rel().includes('Kevin and Sami are allies 2'), 'tension inside a team costs a little trust');
  M.recordIncident(st, ev.id, { kind: 'open-challenge', by: [G.id], title: title.id });
  const turn = M.recordIncident(st, ev.id, { kind: 'turn', by: [J.id], to: 'heel' });
  assert.deepEqual([J.alignment, turn.turn], ['heel', { from: 'face', to: 'heel' }]);
  throwsUE(() => M.recordIncident(st, ev.id, { kind: 'turn', by: [J.id], to: 'heel' }), /already a heel/);
  M.deleteIncident(st, ev.id, turn.id);
  assert.equal(J.alignment, 'face');
  const texts = RL.relationships(st).entries.map(e => RL.entryText(st, e));
  assert.ok(texts.some(t => /^Jey and Gunther called a truce at /.test(t.cause) && / cools to heat 1$/.test(t.result)));
  sound(st);
});

test('a v7 save: accepted suggestions stay as the owner’s incidents with their reasons, and the director takes over from this week', () => {
  const { st, G, J, show } = directorWorld();
  M.setStory(st, { on: false });
  const ev = show();
  const inc = M.recordIncident(st, ev.id, { kind: 'attack', by: [G.id], on: [J.id] });
  const old = JSON.parse(exportUniverse(st));
  old.version = 7;
  old.story = { on: true, pace: 'wild', seed: 99, rolls: [{ event: ev.id, at: ev.at, pool: 4, found: 1, pace: 'wild' }],
    suggestions: [{ id: 'sg900', event: ev.id, kind: 'attack', key: 'k', status: 'accepted', why: ['Gunther is hot-headed'],
      basis: { match: null, winners: null, title: null, team: null }, plan: { incidents: [] }, created: { incidents: [inc.id] } },
    { id: 'sg901', event: ev.id, kind: 'demand', key: 'k2', status: 'open', why: [], basis: {}, plan: { incidents: [] } }] };
  old.events.forEach(e => e.incidents.forEach(x => { x.story = 'sg900'; delete x.cause; delete x.phase; delete x.basis; delete x.turn; delete x.edited; }));
  const back = M.migrate(old);
  const x = back.events[0].incidents[0];
  assert.deepEqual([back.version, x.story, x.cause, x.phase], [M.SCHEMA_VERSION, null, ['Gunther is hot-headed'], 'post']);
  assert.deepEqual([back.story.pace, back.story.seed, back.story.suggestions, back.story.rolls.length, back.story.rolls[0].phase],
    ['wild', 99, undefined, 1, 'post']);
  assert.deepEqual(back.story.since, { season: back.seasons[0].id, week: 1 });
  sound(back);
  // shows before `since` are left alone
  assert.deepEqual(DR.due(back).filter(d => d.event.id === ev.id && d.phase === 'post'), []);
});

// ---------------------------------------------------------------- a whole sample season, end to end

// the season itself is built in universe-sample.mjs, shared with the browser checks

test('a sample season: unequal rosters, title changes, an underbooked wrestler, relegation on every show, qualifiers, a draft', () => {
  const x = sampleSeason();
  const { st, W, T } = x;
  // the underbooked wrestler is flagged; booking balance never compares rosters across shows
  const bal = SD.balance(st, { showId: 'raw', period: SD.periodOf(st, 'last4') });
  const rows = bal.groups.flatMap(g => g.rows);
  assert.deepEqual(rows.filter(r => r.flagged).map(r => r.name), ['Idle']);
  // title histories read in order, and the standings count singles and tag apart
  assert.deepEqual(M.titleReigns(st, T.world.id).map(r => M.holderName(st, r.holder)), ['Gunther', 'Cody', 'Gunther']);
  assert.equal(M.defencesOf(st, M.titleReigns(st, T.world.id)[1]), 1);
  assert.deepEqual(M.titleReigns(st, T.tag.id).map(r => M.holderName(st, r.holder)), ['Judgment', 'KO Crew']);
  assert.deepEqual(M.wrestlerRecord(st, W('Seth').id).tag, { w: 2, l: 0, d: 0, nc: 0 });
  assert.equal(SD.standings(st, { showId: 'raw', period: SD.periodOf(st, 'all') }).ranked[0].name, 'Cody');
  // the transition: ties at the cutoff wait for the owner; Dynamite's cutoff is clean
  const c = sampleCycle();
  const tr = c.tr;
  assert.deepEqual(['raw', 'smackdown', 'dynamite'].map(sid => c.table(sid).pool.length), [9, 7, 5]);
  assert.deepEqual(c.st.relegations.map(r => [M.showById(c.st, r.show).name, c.W && M.wrestlerById(c.st, r.wrestler).name, r.candidate]),
    [['Raw', 'Idle', 'owner'], ['SmackDown', 'Andrade', 'owner'], ['Dynamite', 'Moxley', 'fewest wins']]);
  assert.ok(c.table('raw').flags.some(f => f.key === 'idle'), 'a candidate with no matches is pointed out');
  // qualifier winners and the NXT champion are eligible; eligibility moved nobody; the draft did
  assert.deepEqual(c.st.eligibility.map(e => `${M.wrestlerById(c.st, e.wrestler).name}:${e.source}`).sort(), ['Oba:champion', 'Tony:qualifier', 'Trick:qualifier']);
  assert.deepEqual(c.st.drafts.map(d => `${M.wrestlerById(c.st, d.wrestler).name}>${d.to}`), ['Oba>raw', 'Trick>dynamite']);
  assert.deepEqual(c.st.transitions[0].window.undrafted.map(id => M.wrestlerById(c.st, id).name), ['Tony']);
  assert.equal(M.currentReign(c.st, c.T.nxt.id), null, 'the NXT title was vacated with the pick');
  // every show ends a different size, and nothing had to match
  assert.deepEqual(['raw', 'smackdown', 'dynamite', 'nxt'].map(s => c.st.wrestlers.filter(w => w.showId === s).length), [9, 6, 5, 7]);
  assert.equal(M.transfersSince(c.st, tr.id).length, 5);
  sound(c.st);
});

test('correcting old results afterwards keeps standings, titles and relegation history straight', () => {
  const c = sampleCycle();
  const { st, W, T, tr } = c;
  const ev = m => st.events.find(e => e.matches.includes(m));
  const flip = (m, opts = {}) => M.updateMatch(st, ev(m).id, m.id, { sides: m.sides, outcome: 'win', winner: 1 - m.winner, titleId: m.titleId }, opts);
  // a pre-WrestleMania result that moves the win totals: the relegation stands, and says what changed
  const before = SD.standings(st, { showId: 'dynamite', period: SD.periodOf(st, st.seasons[0].id) });
  flip(c.hangmanDarby);
  const after = SD.standings(st, { showId: 'dynamite', period: SD.periodOf(st, st.seasons[0].id) });
  const rec = (t, n) => [...t.ranked, ...t.unranked].find(r => r.name === n).rec;
  assert.equal(rec(after, 'Darby').w - rec(before, 'Darby').w, 1);
  const dyn = c.table('dynamite');
  assert.ok(!dyn.flags.some(f => f.key === 'picked'), 'the rule picked them — never shown as the owner’s pick');
  const changed = dyn.flags.find(f => f.key === 'changed');
  assert.match(changed.text, /Darby 0 → 1, Hangman 2 → 1\. The candidates and results stand as booked/);
  const moxley = st.relegations.find(r => r.show === 'dynamite');
  assert.equal(moxley.wins, 1);                                                  // the record keeps what it was decided on
  assert.equal(M.relegationDrift(st, moxley), null);                              // Moxley's own total didn't move
  // a later title change can't be pulled out from under the history
  throwsUE(() => flip(c.codyWins), /changed hands or been vacated since/);
  // WrestleMania's title change corrected to a retention: Cody is champion again, cleanly
  flip(c.maniaMain, { titleChange: false });
  assert.equal(M.currentReign(st, T.world.id).holder.id, W('Cody').id);
  assert.deepEqual(M.titleChecks(st, T.world.id), []);
  // now week 2 can be corrected too - and the week-3 title match without the champion is pointed out, not hidden
  flip(c.codyWins, { titleChange: false });
  assert.deepEqual(M.titleReigns(st, T.world.id).map(r => M.holderName(st, r.holder)), ['Gunther']);
  assert.deepEqual(M.titleChecks(st, T.world.id).map(x => x.text), [
    "The World match at Raw · Week 3 didn't include the champion of the day, Gunther."]);
  // a qualifier can't change under a closed window; reopened, it can
  const tonyQual = c.quals.find(m => m.sides[m.winner].wrestlers[0] === W('Tony').id);
  throwsUE(() => flip(tonyQual), /transfer window has closed/);
  M.reopenWindow(st, tr.id);
  flip(tonyQual);
  assert.ok(!M.eligibilityOf(st, tr.id, W('Tony').id).length);
  M.closeWindow(st, tr.id);
  assert.deepEqual(st.transitions[0].window.undrafted.map(id => M.wrestlerById(st, id).name), ['Je']);
  // a relegation result corrected: the other wrestler goes down, and the history says so
  flip(c.rel.raw.m);
  assert.deepEqual(st.relegations.filter(r => r.show === 'raw').map(r => M.wrestlerById(st, r.wrestler).name), ['Drew']);
  assert.deepEqual([W('Idle').showId, W('Drew').showId], ['raw', 'nxt']);
  // a title the draft vacated comes back only by undoing that pick
  throwsUE(() => M.undoTitleChange(st, T.nxt.id), /vacated when Oba was drafted to Raw\. Undo that draft pick instead/);
  // a drafted wrestler's qualifier is locked until the pick is undone
  M.reopenWindow(st, tr.id);
  throwsUE(() => flip(c.quals.find(m => m.sides[m.winner].wrestlers[0] === W('Trick').id)), /drafted to Dynamite since qualifying/);
  sound(st);
  // and a correction that moves a relegated wrestler's own total shows on their record
  const idleMatch = M.recordMatch(st, st.events.find(e => e.name === 'Raw · Week 1').id, { sides: S([W('Drew').id, W('Rhea').id]), winner: 0 });
  assert.deepEqual(M.relegationDrift(st, st.relegations.find(r => r.show === 'raw')), { then: 0, now: 1 });
  M.deleteMatch(st, ev(idleMatch).id, idleMatch.id);
  sound(st);
});

// ---------------------------------------------------------------- restore points

test('restore points: kept before big changes, the newest weekly one only, never at the save’s expense', () => {
  const store = memoryStorage();
  const st = M.createUniverse();
  M.addWrestler(st, { name: 'Cody', showId: 'raw' });
  assert.ok(P.keepRestorePoint(store, st, { label: 'End of Season 1 · Week 1', kind: 'weekly', when: '2026-09-01T10:00:00Z' }));
  M.setWeek(st, 2);
  M.addWrestler(st, { name: 'Gunther', showId: 'raw' });
  assert.ok(P.keepRestorePoint(store, st, { label: 'End of Season 1 · Week 2', kind: 'weekly' }));
  assert.ok(P.keepRestorePoint(store, st, { label: 'Before importing x.json', kind: 'import' }));
  assert.deepEqual(P.listRestorePoints(store).map(p => p.label), ['Before importing x.json', 'End of Season 1 · Week 2']);
  // what comes back is checked like an imported file, and is the universe as it was
  const back = P.readRestorePoint(store, P.listRestorePoints(store)[1].id);
  assert.deepEqual(back.wrestlers.map(w => w.name), ['Cody', 'Gunther']);
  sound(back);
  // at most four; the oldest go first
  ['a', 'b', 'c'].forEach(l => P.keepRestorePoint(store, st, { label: l, kind: 'manual' }));
  assert.deepEqual(P.listRestorePoints(store).map(p => p.label), ['c', 'b', 'a', 'Before importing x.json']);
  assert.equal(store.keys().filter(k => k.startsWith(`${P.RESTORE_KEY}:`)).length, 4);
  // storage running short: restore points give way before the universe fails to save
  const size = JSON.stringify(st).length;
  store.limit = store.keys().reduce((n, k) => n + store.getItem(k).length, 0) + size - 1;   // not quite room for the save
  assert.ok(saveUniverse(store, st));
  assert.ok(P.listRestorePoints(store).length < 4);
  assert.equal(loadUniverse(store).status, 'loaded');
  // storage that takes no writes: keeping one fails quietly, and what's already kept stays
  const kept = P.listRestorePoints(store).map(p => p.label);
  store.full = true;
  assert.equal(P.keepRestorePoint(store, st, { label: 'no room' }), false);
  store.full = false;
  assert.deepEqual(P.listRestorePoints(store).map(p => p.label), kept);
  // too big to fit even alone: the index still matches what's really there
  store.limit = store.getItem(STORAGE_KEY).length + store.getItem(P.RESTORE_KEY).length + 10;
  assert.equal(P.keepRestorePoint(store, st, { label: 'too big' }), false);
  P.listRestorePoints(store).forEach(p => assert.ok(P.readRestorePoint(store, p.id)));
  assert.equal(loadUniverse(store).status, 'loaded');
  store.limit = Infinity;
  throwsUE(() => P.readRestorePoint(store, 999), /no longer in this browser/);
  // exports are remembered, so the app can say how long it's been
  assert.equal(P.lastExported(store), null);
  P.noteExported(store, '2026-09-26T12:00:00Z');
  assert.equal(P.lastExported(store), '2026-09-26T12:00:00Z');
});

// ---------------------------------------------------------------- the auto booker

const lineupOf = (st, m) => m.sides.map(sd => sd.wrestlers.map(id => M.wrestlerById(st, id).name).join(' & ')).join(' vs ');
const who = m => m.sides.flatMap(sd => sd.wrestlers);
const pairIs = (st, m, a, b) => m.sides.length === 2 && m.sides.every(sd => sd.wrestlers.length === 1)
  && [a, b].every(n => who(m).includes(st.wrestlers.find(w => w.name === n).id));
const draftWeek = st => Object.fromEntries(st.shows.map(sh => {
  const ev = st.events.find(e => e.kind === 'weekly' && e.showId === sh.id && e.at.week === 5) || M.addEvent(st, { showId: sh.id });
  const r = B.draftCard(st, ev.id);
  M.setDraft(st, ev.id, r.matches.map(B.toSpec));
  return [sh.id, { ev, r }];
}));

test('booker settings: defaults follow each show’s tier, and each show keeps its own', () => {
  const { st, lfg } = bookingSample();
  const size = id => [M.bookerSettings(st, id).size, M.bookerSettings(st, id).pleSize];
  assert.deepEqual([size('raw'), size('dynamite'), size('nxt'), size('evolve'), size(lfg.id)], [[6, 8], [6, 8], [5, 7], [4, 6], [4, 6]]);
  assert.equal(M.bookerSettings(st, null).pleSize, 10);
  const sat = M.addShow(st, { name: 'Saturday Night', day: 5 });             // in no tier
  assert.deepEqual(size(sat.id), [5, 7]);
  M.setShowTier(st, 'evolve', st.tiers[1].id);                              // moved up: its defaults follow
  assert.deepEqual(size('evolve'), [5, 7]);
  M.setBookerSettings(st, 'nxt', { size: 7, titles: 2, stips: 'often', mix: { singles: 'sometimes', trios: 'never' } });
  const n = M.bookerSettings(st, 'nxt');
  assert.deepEqual([n.size, n.pleSize, n.titles, n.stips, n.mix.singles, n.mix.trios, n.mix.tag, n.changed], [7, 9 - 2, 2, 'often', 'sometimes', 'never', 'often', true]);
  assert.deepEqual(M.bookerSettings(st, 'raw').mix.singles, 'often');        // nobody else changed
  const before = frozen(st);
  throwsUE(() => M.setBookerSettings(st, 'raw', { size: 0 }), /1 to 15 matches/);
  throwsUE(() => M.setBookerSettings(st, 'raw', { titles: 9 }), /0 to 5/);
  throwsUE(() => M.setBookerSettings(st, 'raw', { mix: { ladder: 'often' } }), /kind of match/);
  throwsUE(() => M.setBookerSettings(st, 'raw', { mix: Object.fromEntries(M.MATCH_TYPES.map(k => [k, 'never'])) }), /at least one kind/);
  assert.equal(frozen(st), before);
  M.resetBookerSettings(st, 'nxt');
  assert.equal(M.bookerSettings(st, 'nxt').changed, false);
  M.setBookerSettings(st, sat.id, { size: 3 });
  M.deleteShow(st, sat.id);                                                 // its settings go with it
  assert.equal(st.booker.shows[sat.id], undefined);
  sound(st);
});

test('a draft for every show — Raw, SmackDown, Dynamite, NXT, Evolve and a show added later — full, sound, and never a result', () => {
  const { st, lfg } = bookingSample();
  const before = frozen(st);
  const evs = st.shows.map(sh => M.addEvent(st, { showId: sh.id }));
  const planned = frozen(st);
  const drafts = evs.map(ev => B.draftCard(st, ev.id));
  assert.equal(frozen(st), planned, 'drafting reads the universe and changes nothing');
  assert.notEqual(before, planned);
  drafts.forEach((r, i) => {
    const ev = evs[i];
    const roster = st.wrestlers.filter(w => w.showId === ev.showId && w.status === 'active');
    const ids = r.matches.flatMap(who);
    assert.ok(r.matches.length >= 1, ev.name);
    assert.ok(r.matches.length <= M.cardSize(st, ev), ev.name);
    assert.equal(new Set(ids).size, ids.length, `${ev.name}: nobody twice`);
    assert.ok(ids.every(id => roster.some(w => w.id === id)), `${ev.name}: only the show’s available roster`);
    assert.ok(r.matches.every(m => m.why.length && m.why.every(x => typeof x === 'string' && x.length)), `${ev.name}: every match says why`);
    assert.ok(r.matches.every(m => !('winner' in m) && !('outcome' in m)), 'no result, ever');
    // full: as many matches as the card holds, or nobody left in any division who could make another
    const left = roster.filter(w => !ids.includes(w.id));
    assert.ok(r.matches.length === M.cardSize(st, ev) || M.GENDERS.every(g => left.filter(w => w.gender === g).length < 2), `${ev.name}: a full card`);
    assert.equal(!!r.short, r.matches.length < M.cardSize(st, ev));
  });
  const [raw, , , , evolve, lfgR] = drafts;
  assert.equal(raw.matches.length, 6);
  assert.equal(evolve.matches.length, 3);                                   // 6 wrestlers, 4 slots: as many as fit
  assert.equal(lfgR.matches.length, 2);
  assert.match(lfgR.short, /Only 2 matches fit with 4 wrestlers available on LFG/);
  assert.ok(!raw.matches.some(m => who(m).some(id => ['Punk', 'Brock'].includes(M.wrestlerById(st, id).name))), 'injured and away left out');
  assert.equal(evs[5].showId, lfg.id);
  // the same universe drafts the same card
  assert.deepEqual(B.draftCard(st, evs[0].id).matches.map(m => m.key), raw.matches.map(m => m.key));
});

test('logical matches: titles and contenders, feuds and their allies, friends, teams, upsets, someone short of matches, a new arrival', () => {
  const { st, C } = bookingSample();
  const ev = M.addEvent(st, { showId: 'raw' });
  const ideas = B.ideasFor(st, ev.id);
  const find = (kind, a, b) => ideas.find(x => x.kind === kind && pairIs(st, x, a, b));
  const said = re => ideas.some(x => x.why.some(w => re.test(w)));
  // titles: the champion against the best contender, with the case for them
  const world = ideas.find(x => x.kind === 'title' && x.titleId === C.world.id && x.sides.length === 2);
  assert.equal(lineupOf(st, world), 'Gunther vs Cody');
  assert.match(world.why[1], /^Challenger Cody: #1 in the men’s standings, a grudge against Gunther, hot/);
  const tagTitle = ideas.find(x => x.kind === 'title' && x.titleId === C.rawTag.id);
  assert.deepEqual(tagTitle.sides.map(sd => M.teamById(st, sd.team).name), ['Judgment Day', 'KO & Sami']);
  // rivals who met one on one last week, with Backlash ahead: the feud builds through allies instead
  const direct = find('feud', 'Seth', 'Kevin');
  const proxy = find('build', 'Seth', 'Sami');
  assert.ok(proxy.score > direct.score + 3, `${proxy.score} vs ${direct.score}`);
  assert.equal(proxy.why[0], 'Seth against Sami, who stands with Kevin');
  assert.equal(proxy.why[1], 'Connection: Seth → Kevin (rival) → Sami (Kevin’s tag partner)');
  assert.match(proxy.why.join(' '), /They met one on one last week — the feud moves on another way/);
  assert.match(direct.why.join(' '), /Backlash is in 2 weeks — this could wait for it/);
  // a friend isn't an enemy of a friend's rival by default: with nothing on record to draw Jey in, Jey isn't pitted against Gunther for Cody
  assert.ok(!said(/stands up for a friend: Cody’s feud with Gunther/));
  // tag partners against a member of the team they're at odds with
  const odds = ideas.find(x => pairIs(st, x, 'Sami', 'Finn'));
  assert.ok(odds.why.some(w => /Sami of KO & Sami against Finn of Judgment Day — their teams are at odds/.test(w)), odds.why.join(' | '));
  // an upset: a rematch, and a step up
  assert.match(find('rematch', 'Jey', 'Gunther').why[0], /^Rematch: Jey upset Gunther last week/);
  assert.ok(ideas.some(x => x.kind === 'step' && who(x).includes(st.wrestlers.find(w => w.name === 'Jey').id)));
  // someone short of matches gets a chance
  assert.ok(ideas.some(x => x.kind === 'chance' && /^A chance: Idle has had 0 matches in 4 weeks/.test(x.why[0])));
  // a call-up gets a first match
  assert.ok(ideas.some(x => x.kind === 'arrival' && /^New arrival: Oba, up from NXT .* a first match on Raw/.test(x.why[0])));
  // nobody injured or away, in anything
  assert.ok(!ideas.some(x => who(x).some(id => M.wrestlerById(st, id).status !== 'active')));
  // SmackDown: two meetings in four weeks - settle it with a stipulation
  const sd = B.ideasFor(st, M.addEvent(st, { showId: 'smackdown' }).id);
  const settle = sd.find(x => x.kind === 'feud' && pairIs(st, x, 'Roman', 'Solo'));
  assert.ok(settle.stip);
  assert.match(settle.why.join(' | '), /2 meetings in the last four weeks/);
  // Dynamite: teams at odds
  const dyn = B.ideasFor(st, M.addEvent(st, { showId: 'dynamite' }).id);
  assert.ok(dyn.some(x => x.kind === 'title' && x.titleId === C.aewTag.id && /rivals with FTR/.test(x.why.join(' '))));
  // NXT: a vacant title
  const nxt = B.ideasFor(st, M.addEvent(st, { showId: 'nxt' }).id);
  const vacant = nxt.find(x => x.titleId === C.nxt.id);
  assert.deepEqual([vacant.kind, vacant.notes], ['vacant', 'For the vacant NXT Championship']);
  sound(st);
});

test('the premium live event: every title with a contender, the feuds’ big matches for the title, a stipulation where the heat is', () => {
  const { st, C, backlash } = bookingSample();
  const r = B.draftCard(st, backlash.id);
  const byTitle = id => r.matches.find(m => m.titleId === id);
  assert.ok(pairIs(st, byTitle(C.world.id), 'Cody', 'Gunther'));
  assert.ok(byTitle(C.world.id).stip);
  assert.match(byTitle(C.world.id).why.join(' | '), /Gunther defends the World Heavyweight Championship at Backlash.*Cody holds a grudge against Gunther/);
  assert.ok(pairIs(st, byTitle(C.women.id), 'Liv', 'Becky'));
  assert.ok(byTitle(C.rawTag.id));
  assert.equal(r.matches[r.matches.length - 1].titleId, C.world.id, 'the World title main-events');
  M.setBookerSettings(st, 'raw', { stips: 'never' });
  assert.ok(B.draftCard(st, backlash.id).matches.every(m => !m.stip), 'no stipulations when the show says never');
});

test('a feud builds across weeks: last week’s singles match isn’t drafted again, week after week', () => {
  const { st } = bookingSample();
  const ev5 = M.addEvent(st, { showId: 'raw' });
  M.setDraft(st, ev5.id, B.draftCard(st, ev5.id).matches.map(B.toSpec));
  const booked = M.bookDraft(st, ev5.id);
  booked.forEach(m => M.enterResult(st, ev5.id, m.id, { outcome: 'win', winner: 0 }));   // the test plays the games, not the booker
  M.setWeek(st, 6);
  const ev6 = M.addEvent(st, { showId: 'raw' });
  const next = B.draftCard(st, ev6.id).matches;
  const singles = booked.filter(m => m.sides.length === 2 && m.sides.every(sd => sd.wrestlers.length === 1));
  next.filter(m => m.kind !== 'rematch').forEach(m => {
    assert.ok(!singles.some(p => B.matchKey(p) === B.matchKey({ ...m, titleId: p.titleId })), `repeated: ${lineupOf(st, m)}`);
  });
  sound(st);
});

test('settings shape the card: its size, its kinds of match, its title matches', () => {
  const { st } = bookingSample();
  const ev = M.addEvent(st, { showId: 'raw' });
  M.setBookerSettings(st, 'raw', { size: 3 });
  assert.equal(B.draftCard(st, ev.id).matches.length, 3);
  M.setBookerSettings(st, 'raw', { size: 6, titles: 0 });
  assert.ok(B.draftCard(st, ev.id).matches.every(m => !m.titleId));
  M.setBookerSettings(st, 'raw', { titles: 2 });
  assert.ok(B.draftCard(st, ev.id).matches.filter(m => m.titleId).length <= 2);
  M.setBookerSettings(st, 'raw', { mix: { singles: 'never', triple: 'often', fourway: 'often', tag: 'often' } });
  const r = B.draftCard(st, ev.id);
  assert.ok(r.matches.length >= 4);
  assert.ok(r.matches.every(m => m.type !== 'singles'), r.matches.map(m => m.type).join());
  // what's booked already counts toward the size, and its wrestlers are taken
  M.resetBookerSettings(st, 'raw');
  const cody = st.wrestlers.find(w => w.name === 'Cody').id, seth = st.wrestlers.find(w => w.name === 'Seth').id;
  M.bookMatch(st, ev.id, { sides: [{ wrestlers: [cody] }, { wrestlers: [seth] }] });
  const rest = B.draftCard(st, ev.id);
  assert.equal(rest.matches.length, 5);
  assert.ok(!rest.matches.some(m => who(m).includes(cody) || who(m).includes(seth)));
});

test('the draft is the owner’s: edit, add, draw one again, take off, move, who’s out — and drawing the rest again keeps their changes', () => {
  const { st, id } = bookingSample();
  const ev = M.addEvent(st, { showId: 'raw' });
  M.setDraft(st, ev.id, B.draftCard(st, ev.id).matches.map(B.toSpec));
  const d = () => M.eventById(st, ev.id).draft;
  const [a, b, c2] = d().matches;
  // edit: marked as changed; an unchanged save isn't
  M.editDraftMatch(st, ev.id, a.id, { notes: a.notes });
  assert.equal(d().matches[0].auto.edited, false);
  M.editDraftMatch(st, ev.id, a.id, { stip: 'Ladder' });
  assert.deepEqual([d().matches[0].stip, d().matches[0].auto.edited], ['Ladder', true]);
  // take one off: it's not offered again on this draft
  M.deleteDraftMatch(st, ev.id, c2.id);
  assert.ok(d().passed.includes(c2.auto.key));
  assert.ok(!B.ideasFor(st, ev.id).some(x => x.key === c2.auto.key));
  // draw one again: something else, in the same place
  const again = B.redrawOne(st, ev.id, b.id);
  assert.ok(again && again.key !== b.auto.key);
  M.redrawDraftMatch(st, ev.id, b.id, B.toSpec(again));
  assert.equal(d().matches[1].auto.key, again.key);
  assert.ok(!d().matches.some(m => m.id === b.id));
  // move, add their own
  assert.equal(M.moveDraftMatch(st, ev.id, d().matches[1].id, -1), true);
  assert.equal(M.moveDraftMatch(st, ev.id, d().matches[0].id, -1), false);
  const own = M.addDraftMatch(st, ev.id, { sides: [{ wrestlers: [id('Punk')] }, { wrestlers: [id('Idle')] }], stip: 'Street Fight' });
  assert.equal(own.auto, null);
  assert.match(B.draftNotes(st, M.eventById(st, ev.id)).get(own.id).join(' · '), /Punk is injured/);
  // who's out tonight is left out of whatever is drawn next
  M.setDraftOut(st, ev.id, [id('Cody')]);
  const kept = d().matches.filter(m => !m.auto || m.auto.edited).map(m => [m.id, d().matches.indexOf(m)]);
  const r = B.redraft(st, ev.id);
  M.setDraft(st, ev.id, r.list, { nonce: r.nonce });
  assert.equal(d().nonce, 1);
  const order = d().matches.map(m => m.id).filter(x => kept.some(([mid]) => mid === x));
  assert.deepEqual(order, kept.map(([mid]) => mid), 'what the owner changed or added stays, in its order');
  assert.ok(!d().matches.filter(m => m.auto && !m.auto.edited).some(m => who(m).includes(id('Cody'))));
  assert.deepEqual(d().out, [id('Cody')]);
  sound(st);
});

test('booking a draft puts exactly the draft on the card — the owner’s edits, why it was chosen, and no result', () => {
  const { st, id } = bookingSample();
  const ev = M.addEvent(st, { showId: 'smackdown' });
  const pre = M.bookMatch(st, ev.id, { sides: [{ wrestlers: [id('Randy')] }, { wrestlers: [id('Bron')] }] });
  M.setDraft(st, ev.id, B.draftCard(st, ev.id).matches.map(B.toSpec));
  const first = M.eventById(st, ev.id).draft.matches[0];
  M.editDraftMatch(st, ev.id, first.id, { notes: 'Winner faces Randy' });
  M.addDraftMatch(st, ev.id, { sides: [{ wrestlers: [id('Nia')] }, { wrestlers: [id('Jade')] }] });
  const draft = JSON.parse(JSON.stringify(M.eventById(st, ev.id).draft.matches));
  const records = st.wrestlers.map(w => JSON.stringify(M.wrestlerRecord(st, w.id)));
  const made = M.bookDraft(st, ev.id);
  const e = M.eventById(st, ev.id);
  assert.equal(e.draft, null);
  assert.equal(e.matches[0].id, pre.id, 'what was booked stays first');
  assert.equal(made.length, draft.length);
  made.forEach((m, i) => {
    assert.deepEqual([m.sides, m.titleId, m.stip, m.notes], [draft[i].sides, draft[i].titleId, draft[i].stip, draft[i].notes]);
    assert.deepEqual([m.status, m.outcome, m.winner, m.finish, m.fall], ['scheduled', null, null, null, null]);
  });
  assert.deepEqual(made[0].auto.why, draft[0].auto.why);
  assert.equal(made[0].auto.edited, true);
  assert.equal(made[made.length - 1].auto, null);
  assert.deepEqual(st.wrestlers.map(w => JSON.stringify(M.wrestlerRecord(st, w.id))), records, 'booking counts for nothing');
  // editing an auto-booked match afterwards marks it too
  const plain = made.find(m => m.auto && !m.auto.edited);
  M.updateBooking(st, ev.id, plain.id, { stip: 'Tables' });
  assert.equal(plain.auto.edited, true);
  sound(st);
});

test('drafts are checked like bookings, count for nothing, and follow deletes and merges', () => {
  const { st, id } = bookingSample();
  const ev = M.addEvent(st, { showId: 'raw' });
  const before = frozen(st);
  throwsUE(() => M.setDraft(st, ev.id, [{ sides: [{ wrestlers: [id('Cody')] }] }]), /at least two sides/);
  throwsUE(() => M.setDraft(st, ev.id, [{ sides: [{ wrestlers: [id('Cody')] }, { wrestlers: [id('Cody')] }] }]), /same match twice/);
  throwsUE(() => M.addDraftMatch(st, ev.id, { sides: [{ wrestlers: [id('Cody')] }, { wrestlers: [id('Seth')] }] }), /has no draft card/);
  throwsUE(() => M.bookDraft(st, ev.id), /has no draft card/);
  assert.equal(frozen(st), before);
  M.setDraft(st, ev.id, []);
  throwsUE(() => M.bookDraft(st, ev.id), /The draft is empty/);
  // a draft that can't all be booked books nothing
  const t = M.addTitle(st, { name: 'Old Belt', showId: 'raw', kind: 'singles', division: 'men' });
  M.addDraftMatch(st, ev.id, { sides: [{ wrestlers: [id('Drew')] }, { wrestlers: [id('Priest')] }] });
  M.addDraftMatch(st, ev.id, { sides: [{ wrestlers: [id('Cody')] }, { wrestlers: [id('Seth')] }], titleId: t.id });
  M.updateTitle(st, t.id, { active: false });
  throwsUE(() => M.bookDraft(st, ev.id), /^Match 2 on the draft: The Old Belt is retired/);
  assert.equal(M.eventById(st, ev.id).matches.length, 0);
  // drafts count for nothing: not a booking, not a card
  assert.equal(M.bookingsOf(st, id('Drew')).length, 0);
  assert.equal(M.cardStatus(M.eventById(st, ev.id)).state, 'empty');
  // deleting what a draft names takes it out of the draft
  M.deleteTitle(st, t.id);
  assert.equal(M.eventById(st, ev.id).draft.matches[1].titleId, null);
  const temp = M.addWrestler(st, { name: 'Temp', showId: 'raw' });
  M.addDraftMatch(st, ev.id, { sides: [{ wrestlers: [temp.id] }, { wrestlers: [id('Rhea')] }] });
  M.setDraftOut(st, ev.id, [temp.id]);
  M.deleteWrestler(st, temp.id);
  assert.equal(M.eventById(st, ev.id).draft.matches.length, 2);
  assert.deepEqual(M.eventById(st, ev.id).draft.out, []);
  const dup = M.addWrestler(st, { name: 'Drew Again', showId: 'raw' });
  M.addDraftMatch(st, ev.id, { sides: [{ wrestlers: [dup.id] }, { wrestlers: [id('Liv')] }] });
  M.mergeWrestlers(st, id('Drew'), dup.id);
  assert.deepEqual(M.eventById(st, ev.id).draft.matches[2].sides[0].wrestlers, [id('Drew')]);
  sound(st);
  // a broken draft in a save is caught
  const bad = JSON.parse(JSON.stringify(st));
  bad.events.find(e => e.id === ev.id).draft.matches[0].sides[0].wrestlers = ['w9999'];
  assert.ok(M.validate(bad).some(x => /draft match .* includes a wrestler who doesn't exist/.test(x)));
  const bad2 = JSON.parse(JSON.stringify(st));
  bad2.booker.shows.raw = { size: 99 };
  assert.ok(M.validate(bad2).some(x => /auto booker’s settings for Raw are unreadable/.test(x)));
});

test('away: left out of drafts, of booking balance and match ideas, and flagged on the season transition', () => {
  const { st, id } = bookingSample();
  M.updateWrestler(st, id('Seth'), { status: 'away' });
  const ev = M.addEvent(st, { showId: 'raw' });
  assert.ok(!B.ideasFor(st, ev.id).some(x => who(x).includes(id('Seth'))));
  const bal = SD.balance(st, { showId: 'raw', period: SD.periodOf(st, 'last4') });
  const row = bal.groups[0].rows.find(r => r.id === id('Seth'));
  assert.deepEqual([row.injured, row.status, row.judged], [true, 'away', false]);
  const idle = bal.groups[0].rows.find(r => r.id === id('Idle'));
  assert.ok(!SD.matchIdeas(st, { kind: 'wrestler', id: idle.id }, { showId: 'raw', balanceResult: bal }).some(x => x.opponent.id === id('Seth')));
  sound(st);
});

test('a version 9 save: nothing drafted, nothing auto-booked, every show on its tier’s defaults — and nothing else changed', () => {
  const { st } = bookingSample();
  const old = JSON.parse(JSON.stringify(st));
  old.version = 9;
  delete old.booker;
  old.events.forEach(e => { delete e.draft; e.matches.forEach(m => { delete m.auto; }); });
  const up = M.migrate(old);
  assert.equal(up.version, M.SCHEMA_VERSION);
  assert.deepEqual(up.booker, { shows: {}, all: {} });
  assert.ok(up.events.every(e => e.draft === null && e.matches.every(m => m.auto === null)));
  assert.deepEqual(up, st);
  sound(up);
});

test('drafting a week: each show planned or drafted, or why not', () => {
  const { st, lfg } = bookingSample();
  const ev = M.addEvent(st, { showId: 'raw' });
  M.recordMatch(st, M.addEvent(st, { showId: 'nxt' }).id, { sides: [{ wrestlers: [st.wrestlers.find(w => w.name === 'Je').id] },
    { wrestlers: [st.wrestlers.find(w => w.name === 'Tony').id] }], winner: 0 });
  M.setDraft(st, M.addEvent(st, { showId: 'dynamite' }).id, []);
  const plan = B.weekPlan(st, 5);
  const row = name => plan.find(r => (r.event ? r.event.name : r.show.name).startsWith(name));
  assert.deepEqual([row('Raw').action, row('NXT').action, row('Dynamite').action, row('SmackDown').action, row('LFG').action],
    ['draft', 'skip', 'skip', 'plan', 'plan']);
  assert.match(row('NXT').text, /Results are in/);
  assert.equal(row('Raw').event.id, ev.id);
  assert.equal(plan.filter(r => r.show && r.show.id === lfg.id).length, 1);
  const days = plan.map(r => r.day);
  assert.deepEqual(days, [...days].sort((a, b) => a - b));
});

// ---------------------------------------------------------------- the booker reads the story

// the booking sample with story events recorded after Raw week 4, as the director (or the owner) would
function storySample() {
  const x = bookingSample();
  const { st, id } = x;
  x.raw4 = st.events.find(e => e.showId === 'raw' && e.at.week === 4);
  x.inc = (ev, kind, by, on = [], extra = {}) => M.recordIncident(st, ev.id, { kind, by: by.map(id), on: on.map(id), phase: 'post', ...extra });
  return x;
}
const whyOf = x => x.why.join(' | ');

test('storylines: worked out from story events and matches — beats, chapters, formats, a priority that fades, who is drawn in', () => {
  const { st, id, raw4, inc } = storySample();
  const attack = inc(raw4, 'attack', ['Gunther'], ['Cody']);
  inc(raw4, 'save', ['Jey'], ['Gunther'], { helped: [id('Cody')] });
  const lines = SL.storylines(st);
  const cg = SL.storyOf(lines, id('Cody'), id('Gunther'));
  assert.ok(cg.beats.some(b => b.kind === 'attack' && b.incident === attack.id));
  assert.equal(cg.hook.kind, 'attack');
  assert.match(cg.hook.text, /^Gunther attacked Cody at Raw · Week 4, after the show$/);
  // the saver is drawn in on Cody's side, with the reason; nobody stands with Gunther without one
  const d = RL.relationships(st);
  const cody = SL.drawnIn(st, d, cg, id('Cody'), id('Gunther'));
  assert.deepEqual(cody.map(p => p.id), [id('Jey')]);
  assert.equal(cody[0].path, 'Gunther → Cody (rival) → Jey (made the save for Cody against Gunther at Raw · Week 4)');
  assert.deepEqual(SL.drawnIn(st, d, cg, id('Gunther'), id('Cody')), []);
  // a tag partner stands with a rival; a friend who's close to both sides stays out of it
  const sk = SL.storyOf(lines, id('Seth'), id('Kevin'));
  assert.deepEqual(SL.drawnIn(st, d, sk, id('Kevin'), id('Seth')).map(p => [p.id, p.how]), [[id('Sami'), 'tag partner']]);
  M.editRelationship(st, { action: 'form', kind: 'friends', a: id('Sami'), b: id('Seth'), level: 1 });
  const torn = SL.storyOf(SL.storylines(st), id('Seth'), id('Kevin'));
  assert.deepEqual(SL.drawnIn(st, RL.relationships(st), torn, id('Kevin'), id('Seth')), []);
  // the matches: SmackDown's Roman and Solo have met one on one twice
  const rs = SL.storyOf(lines, id('Roman'), id('Solo'));
  assert.deepEqual([rs.chapters, rs.direct, rs.formats], [2, 2, ['singles', 'singles']]);
  // big events fade over weeks rather than vanish: the attack still counts three weeks on, at half
  const now = cg.priority;
  M.setWeek(st, 7);
  const later = SL.storyOf(SL.storylines(st), id('Cody'), id('Gunther'));
  assert.ok(later.priority < now && later.priority > now / 2 - 1, `${later.priority} vs ${now}`);
  assert.ok(later.beats.some(b => b.incident === attack.id));
  sound(st);
});

test('story events make matches: revenge after an attack, a feud after a betrayal, tonight’s confrontation tonight, a title shot after a demand', () => {
  const { st, id, raw4, inc, backlash, T, C } = storySample();
  M.deleteEvent(st, backlash.id);                                           // no premium live event ahead to hold anything back
  const attack = inc(raw4, 'attack', ['Gunther'], ['Cody']);
  const betray = inc(raw4, 'betrayal', ['Kevin'], ['Sami']);
  inc(raw4, 'breakup', ['Kevin'], ['Sami'], { team: T.ko.id });
  M.setTeamActive(st, T.ko.id, false);
  const demand = inc(raw4, 'demand', ['Oba'], ['Gunther'], { title: C.world.id });
  const ev = M.addEvent(st, { showId: 'raw' });
  const conf = M.recordIncident(st, ev.id, { kind: 'confrontation', by: [id('Becky')], on: [id('Liv')], phase: 'pre' });
  const ideas = B.ideasFor(st, ev.id);
  const pair = (a, b) => ideas.find(x => pairIs(st, x, a, b));
  // an attack: a revenge match, the attack named and kept as the reason
  const revenge = ideas.find(x => pairIs(st, x, 'Cody', 'Gunther') && x.why[0].startsWith('Revenge: Gunther attacked Cody last week'));
  assert.ok(revenge, ideas.filter(x => pairIs(st, x, 'Cody', 'Gunther')).map(whyOf).join('\n'));
  assert.ok(revenge.events.includes(attack.id));
  // a betrayal: the team is done and a feud starts
  const feud = pair('Sami', 'Kevin');
  assert.equal(feud.why[0], 'Betrayal: Kevin turned on Sami last week');
  assert.ok(feud.events.includes(betray.id));
  // a confrontation before tonight's show: the match is tonight, and it's likely
  const tonight = pair('Liv', 'Becky');
  assert.equal(tonight.why[0], 'Becky confronted Liv before the show tonight — the match is tonight');
  assert.ok(tonight.events.includes(conf.id));
  assert.ok(ideas.indexOf(tonight) < 6, 'among the likeliest');
  // a title demand: the demand leads the challenger's case
  const shot = ideas.find(x => x.kind === 'title' && x.titleId === C.world.id && x.people.includes(id('Oba')));
  assert.match(whyOf(shot), /Oba: demanded a shot last week/);
  assert.ok(shot.events.includes(demand.id));
  // and the draft keeps the story events behind each match, through booking
  const r = B.draftCard(st, ev.id);
  M.setDraft(st, ev.id, r.matches.map(B.toSpec), { seen: r.seen, played: r.played });
  const made = M.bookDraft(st, ev.id);
  assert.ok(made.some(m => m.auto.events.includes(conf.id)), 'tonight’s confrontation is on the card');
  sound(st);
});

test('a save becomes a tag match; new allies take on a common enemy; a friend is drawn in only with a reason', () => {
  const { st, id, raw4, inc } = storySample();
  const ev0 = M.addEvent(st, { showId: 'raw' });
  // before anything happens, Jey (Cody's friend) isn't set against Gunther for Cody
  assert.ok(!B.ideasFor(st, ev0.id).some(x => x.kind === 'defend' && pairIs(st, x, 'Jey', 'Gunther')));
  M.deleteEvent(st, ev0.id);
  inc(raw4, 'attack', ['Gunther'], ['Cody']);
  const save = inc(raw4, 'save', ['Jey'], ['Gunther'], { helped: [id('Cody')] });
  M.editRelationship(st, { action: 'form', kind: 'allies', a: id('Gunther'), b: id('Drew'), level: 2 });
  const ev = M.addEvent(st, { showId: 'raw' });
  const ideas = B.ideasFor(st, ev.id);
  // (the storyline's own tag idea is the same four people: one idea, with both reasons)
  const tag = ideas.find(x => x.type === 'tag' && x.events.includes(save.id) && x.why.some(w => w.startsWith('From the save:')));
  assert.ok(tag, 'the save makes a tag match');
  assert.ok(tag.why.includes('From the save: Jey saved Cody from Gunther last week — now they team up'), whyOf(tag));
  assert.ok(tag.why.some(w => /^Connection: Cody → Gunther \(rival\) → Drew \(Gunther’s ally — the feud is at its hottest\)$/.test(w)), whyOf(tag));
  assert.deepEqual(new Set(tag.people), new Set([id('Jey'), id('Cody'), id('Gunther'), id('Drew')]));
  // Jey is drawn in now, and the connection says why
  const jey = ideas.find(x => pairIs(st, x, 'Jey', 'Gunther') && ['defend', 'build', 'feud'].includes(x.kind));
  assert.ok(jey.why.some(w => /made the save/.test(w)), whyOf(jey));
  // new allies against a common enemy
  const drewIdle = M.recordIncident(st, raw4.id, { kind: 'alliance', by: [id('Drew')], on: [id('Idle')], phase: 'post' });
  M.editRelationship(st, { action: 'form', kind: 'grudge', a: id('Idle'), b: id('Finn'), level: 2 });
  const allied = B.ideasFor(st, ev.id).find(x => x.events.includes(drewIdle.id));
  assert.ok(allied && allied.type === 'tag' && allied.people.includes(id('Finn')), allied && whyOf(allied));
  assert.match(allied.why[0], /^New allies: Drew and Idle joined forces last week$/);
  sound(st);
});

test('no repeats: last week’s line-up in any format waits, a feud that went one way twice goes another, and a lost title shot waits its turn', () => {
  const { st, id, T, C } = storySample();
  const ev5 = M.addEvent(st, { showId: 'raw' });
  // last week, on this show: KO & Sami beat Judgment Day in a tag match for the titles... and lost it the week before
  const tagKey = B.matchKey({ titleId: null, sides: [{ wrestlers: [id('Kevin'), id('Sami')] }, { wrestlers: [id('Damian'), id('Finn')] }] });
  const before = B.ideasFor(st, ev5.id).find(x => B.matchKey({ ...x, titleId: null }) === tagKey);
  M.recordMatch(st, st.events.find(e => e.showId === 'raw' && e.at.week === 4).id, {
    sides: [{ team: T.jd.id, wrestlers: [id('Damian'), id('Finn')] }, { team: T.ko.id, wrestlers: [id('Kevin'), id('Sami')] }], titleId: C.rawTag.id, winner: 0 });
  const after = B.ideasFor(st, ev5.id).filter(x => B.matchKey({ ...x, titleId: null }) === tagKey);
  assert.ok(after.every(x => x.score < before.score - 2), 'the same four, last week, in any format: much less likely');
  assert.ok(!after.some(x => x.titleId === C.rawTag.id), 'KO & Sami just lost a shot: they wait their turn');
  // Sami and Finn's feud has gone through tag matches twice running: this time one on one, and it says so
  const ideas = B.ideasFor(st, ev5.id);
  const direct = ideas.find(x => pairIs(st, x, 'Sami', 'Finn'));
  assert.ok(direct.why.includes('A tag match twice running — this time one on one'), whyOf(direct));
  sound(st);
});

test('a feud across weeks, with the CPU deciding: it moves on through different matches, and an unexpected winner changes what comes next', () => {
  const { st, id, backlash } = storySample();
  M.deleteEvent(st, backlash.id);
  const A = id('Cody'), G = id('Gunther');
  const rating = x => { const r = M.wrestlerRecord(st, x); const w = r.singles.w + r.tag.w, l = r.singles.l + r.tag.l; return (w + 1) / (w + l + 2); };
  const strength = sd => sd.wrestlers.reduce((n, x) => n + rating(x), 0) / sd.wrestlers.length;
  let upset = null;
  const later = [];
  for (let week = 5; week <= 9; week++) {
    M.setWeek(st, week);
    const ev = M.addEvent(st, { showId: 'raw' });
    const r = B.draftCard(st, ev.id);
    M.setDraft(st, ev.id, r.matches.map(B.toSpec), { seen: r.seen, played: r.played });
    const made = M.bookDraft(st, ev.id);
    const key = SL.storyOf(SL.storylines(st), A, G).key;
    const chapter = made.find((m, i) => r.matches[i].feud === key);
    if (upset) later.push(...made.filter(m => m.auto && m.sides.flat().length && m.sides.some(sd => sd.wrestlers.some(x => upset.people.includes(x)))));
    // the CPU: the better record wins - except once, when the feud's chapter goes to the underdog
    made.forEach(m => {
      const order = m.sides.map((sd, i) => ({ i, s: strength(sd) })).sort((p, q) => q.s - p.s || p.i - q.i);
      const flip = !upset && week >= 6 && m === chapter;
      const winner = flip ? order[order.length - 1].i : order[0].i;
      M.enterResult(st, ev.id, m.id, { outcome: 'win', winner }, {});
      if (flip) upset = { week, people: m.sides.flatMap(sd => sd.wrestlers) };
    });
    if (week === 5) M.recordIncident(st, ev.id, { kind: 'attack', by: [G], on: [A], phase: 'post' });   // the story, as the director might tell it
  }
  const story = SL.storyOf(SL.storylines(st), A, G);
  const chapters = story.beats.filter(b => b.kind === 'match' && b.wk >= 5);
  assert.ok(chapters.length >= 3, story.beats.map(b => `${b.wk} ${b.format} ${b.text}`).join('\n'));
  chapters.forEach((b, i) => { if (i) assert.ok(!(b.format === chapters[i - 1].format && b.via === chapters[i - 1].via && b.wk - chapters[i - 1].wk <= 1 && b.format !== 'proxy'), `week ${b.wk} repeats`); });
  assert.ok(new Set(chapters.map(b => `${b.format}:${b.via || ''}`)).size >= 2, 'different matches along the way');
  assert.ok(upset, 'the CPU handed a chapter to the underdog');
  assert.ok(later.some(m => m.auto.why.some(w => /nobody saw it coming|isn’t over|beat /.test(w))), later.map(m => m.auto.why.join(' | ')).join('\n'));
  assert.ok(st.events.every(e => e.matches.every(m => m.status === 'played')), 'every result entered, none picked by the booker');
  sound(st);
});

test('a draft says what’s new since it was drawn, and flags a match whose story event was undone', () => {
  const { st, id, raw4, inc, backlash } = storySample();
  M.deleteEvent(st, backlash.id);
  const attack = inc(raw4, 'attack', ['Gunther'], ['Cody']);
  const ev = M.addEvent(st, { showId: 'raw' });
  const r = B.draftCard(st, ev.id);
  M.setDraft(st, ev.id, r.matches.map(B.toSpec), { seen: r.seen, played: r.played });
  const e = () => M.eventById(st, ev.id);
  assert.deepEqual(B.sinceDraft(st, e()), { incidents: [], results: 0 });
  const conf = M.recordIncident(st, ev.id, { kind: 'confrontation', by: [id('Seth')], on: [id('Kevin')], phase: 'pre' });
  M.recordMatch(st, M.addEvent(st, { showId: 'smackdown' }).id, { sides: [{ wrestlers: [id('Roman')] }, { wrestlers: [id('LA')] }], winner: 0 });
  const since = B.sinceDraft(st, e());
  assert.deepEqual([since.incidents.map(x => x.incident.id), since.results], [[conf.id], 1]);
  // undo the attack the revenge match followed: the draft says so
  const dm = e().draft.matches.find(m => m.auto && m.auto.events.includes(attack.id));
  assert.ok(dm, 'a drafted match follows the attack');
  M.deleteIncident(st, raw4.id, attack.id);
  assert.ok(B.draftNotes(st, e()).get(dm.id).includes('The story event it followed has been undone'));
  // drawing the rest again starts from what's on record now
  const again = B.redraft(st, ev.id);
  M.setDraft(st, ev.id, again.list, { nonce: again.nonce, seen: again.seen, played: again.played });
  assert.deepEqual(B.sinceDraft(st, e()), { incidents: [], results: 0 });
  assert.ok(!e().draft.matches.some(m => m.auto && !m.auto.edited && m.auto.events.includes(attack.id)));
  sound(st);
});

test('the rare surprise: one at most, only when the card’s draw allows it, and always with a hook', () => {
  const { st, id, raw4, inc } = storySample();
  // two with a common enemy: both at war with Gunther
  inc(raw4, 'attack', ['Gunther'], ['Drew']);
  inc(raw4, 'attack', ['Gunther'], ['Priest']);
  let seenOpen = 0, seenClosed = 0;
  for (let n = 0; n < 12; n++) {
    const ev = M.addEvent(st, { showId: 'raw' });
    const r = B.draftCard(st, ev.id, { nonce: n });
    const s = r.matches.filter(m => m.kind === 'surprise');
    assert.ok(s.length <= 1);
    s.forEach(m => assert.match(m.why[0], /^A surprise pairing — /));
    const ideas = B.ideasFor(st, ev.id, { nonce: n }).filter(x => x.kind === 'surprise');
    if (ideas.length) seenOpen++; else seenClosed++;
    M.deleteEvent(st, ev.id);
  }
  assert.ok(seenOpen > 0 && seenClosed > seenOpen, `open on ${seenOpen} of 12 draws`);
});

test('a version 10 save: drafted and booked matches get no story events, drafts don’t know what they saw', () => {
  const { st, id } = storySample();
  const ev = M.addEvent(st, { showId: 'raw' });
  const r = B.draftCard(st, ev.id);
  M.setDraft(st, ev.id, r.matches.map(B.toSpec), { seen: r.seen, played: r.played });
  const ev2 = M.addEvent(st, { showId: 'nxt' });
  M.setDraft(st, ev2.id, B.draftCard(st, ev2.id).matches.map(B.toSpec));
  M.bookDraft(st, ev2.id);
  const old = JSON.parse(JSON.stringify(st));
  old.version = 10;
  old.events.forEach(e => {
    e.matches.forEach(m => { if (m.auto) delete m.auto.events; });
    if (e.draft) { delete e.draft.seen; delete e.draft.played; e.draft.matches.forEach(m => { if (m.auto) delete m.auto.events; }); }
  });
  const up = M.migrate(old);
  assert.equal(up.version, M.SCHEMA_VERSION);
  const e = up.events.find(x => x.id === ev.id);
  assert.deepEqual([e.draft.seen, e.draft.played], [null, null]);
  assert.ok(e.draft.matches.every(m => Array.isArray(m.auto.events) && !m.auto.events.length));
  assert.ok(up.events.find(x => x.id === ev2.id).matches.every(m => m.auto && Array.isArray(m.auto.events)));
  assert.deepEqual(B.sinceDraft(up, e), { incidents: [], results: 0 });
  sound(up);
  assert.ok(id('Cody'));
});
