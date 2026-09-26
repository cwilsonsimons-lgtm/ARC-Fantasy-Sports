// A sample season for Universe, built through the model the way the app would:
// unequal rosters, singles and tag results, title changes, an underbooked
// wrestler, WrestleMania, then relegation on every main show, NXT
// qualifiers and a draft. Shared by the unit tests (universe-test.mjs) and
// the browser checks (universe-check.mjs), which imports it as a save file.
import * as M from '../js/universe/model.js';

const S = ids => ids.map(x => ({ wrestlers: Array.isArray(x) ? x : [x] }));

// Raw has 9, SmackDown 7, Dynamite 5, NXT 6. Four weeks of singles and tag
// results with title changes on Raw, SmackDown and the Raw tag titles; one Raw
// wrestler is never booked; WrestleMania is week 4 and changes two titles.
export function sampleSeason() {
  const st = M.createUniverse();
  M.setStory(st, { on: false });
  const add = (name, showId, gender = 'male') => M.addWrestler(st, { name, showId, gender });
  ['Cody', 'Gunther', 'Jey', 'Seth', 'Drew', 'Sami', 'Kevin', 'Idle'].forEach(n => add(n, 'raw'));
  add('Rhea', 'raw', 'female');
  ['Roman', 'Solo', 'LA', 'Randy', 'Bron', 'Carmelo', 'Andrade'].forEach(n => add(n, 'smackdown'));
  ['Moxley', 'Hangman', 'Ospreay', 'Swerve', 'Darby'].forEach(n => add(n, 'dynamite'));
  ['Oba', 'Trick', 'Je', 'Ethan', 'Wes', 'Tony'].forEach(n => add(n, 'nxt'));
  const W = n => st.wrestlers.find(w => w.name === n);
  const title = (name, showId, kind = 'singles') => M.addTitle(st, { name, showId, kind, division: 'men' });
  const T = { world: title('World', 'raw'), sd: title('Undisputed', 'smackdown'), aew: title('AEW World', 'dynamite'),
    tag: title('Raw Tag', 'raw', 'tag'), nxt: title('NXT', 'nxt') };
  const judgment = M.addTeam(st, { name: 'Judgment', members: [W('Drew').id, W('Sami').id] });
  const ko = M.addTeam(st, { name: 'KO Crew', members: [W('Kevin').id, W('Seth').id] });
  [[T.world, 'Gunther'], [T.sd, 'Roman'], [T.aew, 'Moxley'], [T.nxt, 'Oba']].forEach(([t, n]) => M.setChampion(st, t.id, { type: 'wrestler', id: W(n).id }));
  M.setChampion(st, T.tag.id, { type: 'team', id: judgment.id });
  const one = (ev, w, l, extra = {}, opts = {}) => M.recordMatch(st, ev.id, { sides: S([W(w).id, W(l).id]), winner: 0, ...extra }, opts);
  const tag = (ev, tw, tl, extra = {}, opts = {}) => M.recordMatch(st, ev.id,
    { sides: [{ team: tw.id, wrestlers: [...tw.members] }, { team: tl.id, wrestlers: [...tl.members] }], winner: 0, ...extra }, opts);
  const ep = (show, week) => { M.setWeek(st, week); return M.addEvent(st, { showId: show }); };
  const change = { titleChange: true };
  let e = ep('raw', 1); one(e, 'Cody', 'Jey'); one(e, 'Seth', 'Drew'); tag(e, ko, judgment); one(e, 'Rhea', 'Sami');
  e = ep('smackdown', 1); one(e, 'Solo', 'LA'); one(e, 'Randy', 'Carmelo'); one(e, 'Bron', 'Andrade');
  e = ep('dynamite', 1); const hangmanDarby = one(e, 'Hangman', 'Darby'); one(e, 'Ospreay', 'Swerve');
  e = ep('nxt', 1); one(e, 'Trick', 'Je'); one(e, 'Ethan', 'Wes'); one(e, 'Tony', 'Je');
  e = ep('raw', 2); const codyWins = one(e, 'Cody', 'Gunther', { titleId: T.world.id }, change); one(e, 'Jey', 'Sami'); one(e, 'Kevin', 'Drew');
  e = ep('smackdown', 2); one(e, 'Solo', 'Randy'); one(e, 'LA', 'Carmelo');
  e = ep('dynamite', 2); one(e, 'Swerve', 'Darby'); one(e, 'Hangman', 'Ospreay');
  e = ep('nxt', 2); one(e, 'Trick', 'Wes'); one(e, 'Ethan', 'Tony');
  e = ep('raw', 3); const codyDefends = one(e, 'Cody', 'Seth', { titleId: T.world.id }); tag(e, ko, judgment, { titleId: T.tag.id }, change); one(e, 'Jey', 'Drew');
  e = ep('smackdown', 3); one(e, 'Solo', 'Roman', { titleId: T.sd.id }, change); one(e, 'Bron', 'LA');
  e = ep('dynamite', 3); one(e, 'Moxley', 'Hangman', { titleId: T.aew.id }); one(e, 'Ospreay', 'Darby');
  e = ep('nxt', 3); one(e, 'Je', 'Wes'); one(e, 'Trick', 'Ethan');
  M.setWeek(st, 4);
  const wm = M.addEvent(st, { kind: 'ple', name: 'WrestleMania', week: 4 });
  const maniaMain = one(wm, 'Gunther', 'Cody', { titleId: T.world.id }, change);
  one(wm, 'Swerve', 'Moxley', { titleId: T.aew.id }, change);
  one(wm, 'Randy', 'Andrade');
  return { st, W, T, wm, judgment, ko, hangmanDarby, codyWins, codyDefends, maniaMain };
}
// through the transition: ties decided, relegation on every main show, qualifiers, the draft
export function sampleCycle() {
  const x = sampleSeason();
  const { st, W, wm } = x;
  const tr = M.startTransition(st, wm.id);
  const table = sid => M.relegationTable(st, tr.id, sid);
  const pick = (sid, ...names) => names.forEach(n => { if (!table(sid).candidates.includes(W(n).id)) M.toggleCandidate(st, tr.id, sid, W(n).id); });
  pick('raw', 'Drew', 'Idle');
  pick('smackdown', 'Andrade', 'Carmelo');
  M.setWeek(st, 5);
  const rel = {};
  ['raw', 'smackdown', 'dynamite'].forEach(sid => {
    const ev = M.addEvent(st, { showId: sid });
    rel[sid] = { ev, m: M.bookRelegation(st, tr.id, sid, ev.id)[0] };
  });
  const result = (ev, m, winner) => M.enterResult(st, ev.id, m.id, { sides: m.sides, outcome: 'win', winner });
  result(rel.raw.ev, rel.raw.m, 0); result(rel.smackdown.ev, rel.smackdown.m, 1); result(rel.dynamite.ev, rel.dynamite.m, 0);
  const nxtEv = M.addEvent(st, { showId: 'nxt' });
  M.setQualifiers(st, tr.id, ['Trick', 'Ethan', 'Je', 'Tony'].map(n => W(n).id));
  const quals = M.bookQualifiers(st, tr.id, nxtEv.id);
  quals.forEach((m, i) => result(nxtEv, m, i % 2));
  M.openWindow(st, tr.id);
  M.draftWrestler(st, tr.id, W('Oba').id, 'raw', { titles: { [x.T.nxt.id]: 'vacate' } });
  M.draftWrestler(st, tr.id, W('Trick').id, 'dynamite');
  M.closeWindow(st, tr.id);
  return { ...x, tr, table, rel, nxtEv, quals, result };
}

