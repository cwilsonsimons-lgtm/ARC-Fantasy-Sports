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


// A week to book, for the auto booker: every show with a story going on.
// Raw: a feud whose rivals met one on one last week (Seth and Kevin), a grudge
// against the champion with Backlash three weeks away (Cody and Gunther), a
// friend of Cody's, an upset of the champion (Jey over Gunther), a faction
// holding the tag titles, someone never booked (Idle), a call-up from NXT this
// week (Oba), one injured (Punk) and one away (Brock), and a women's division.
// SmackDown: a feud that has met twice lately and needs settling (Roman and
// Solo). Dynamite: two tag teams at odds. NXT: a vacant title. Evolve: a small
// roster. LFG: a show added later, in a tier of its own.
export function bookingSample() {
  const st = M.createUniverse();
  M.setStory(st, { on: false });
  const roster = {
    raw: [['Cody', 'Gunther', 'Seth', 'Kevin', 'Sami', 'Jey', 'Drew', 'Damian', 'Finn', 'Priest', 'Idle', 'Punk', 'Brock'], ['Rhea', 'Liv', 'Becky', 'Iyo']],
    smackdown: [['Roman', 'Solo', 'Randy', 'LA', 'Bron', 'Carmelo', 'Jacob', 'Tama'], ['Bianca', 'Jade', 'Tiffany', 'Nia']],
    dynamite: [['Moxley', 'Hangman', 'Ospreay', 'Swerve', 'Matt', 'Nick', 'Dax', 'Cash'], ['Toni', 'Mariah', 'Mercedes']],
    nxt: [['Oba', 'Trick', 'Je', 'Ethan', 'Wes', 'Tony'], ['Roxanne', 'Giulia', 'Stephanie', 'Jaida']],
    evolve: [['Kali', 'Jackson', 'Keanu', 'Edris'], ['Kendal', 'Wren']],
  };
  Object.entries(roster).forEach(([showId, [men, women]]) => {
    men.forEach(name => M.addWrestler(st, { name, showId, gender: 'male' }));
    women.forEach(name => M.addWrestler(st, { name, showId, gender: 'female' }));
  });
  const indies = M.addTier(st, { name: 'Indies' });
  const lfg = M.addShow(st, { name: 'LFG', day: 3, tier: indies.id });
  ['Rookie A', 'Rookie B', 'Rookie C', 'Rookie D'].forEach(name => M.addWrestler(st, { name, showId: lfg.id, gender: 'male' }));
  const W = n => st.wrestlers.find(w => w.name === n);
  const id = n => W(n).id;
  const team = (name, members) => M.addTeam(st, { name, members: members.map(id) });
  const T = {
    ko: team('KO & Sami', ['Kevin', 'Sami']), jd: team('Judgment Day', ['Damian', 'Finn', 'Priest']),
    bloodline: team('Bloodline', ['Solo', 'Jacob', 'Tama']), bucks: team('Young Bucks', ['Matt', 'Nick']), ftr: team('FTR', ['Dax', 'Cash']),
  };
  const title = (name, showId, kind = 'singles', division = 'men') => M.addTitle(st, { name, showId, kind, division });
  const C = {
    world: title('World Heavyweight Championship', 'raw'), women: title('Women’s World Championship', 'raw', 'singles', 'women'),
    rawTag: title('World Tag Team Championship', 'raw', 'tag'), wwe: title('WWE Championship', 'smackdown'),
    sdWomen: title('WWE Women’s Championship', 'smackdown', 'singles', 'women'), aew: title('AEW World Championship', 'dynamite'),
    aewTag: title('AEW Tag Team Championship', 'dynamite', 'tag'), nxt: title('NXT Championship', 'nxt'), evolve: title('Evolve Championship', 'evolve'),
  };
  const crown = (t, holder) => M.setChampion(st, t.id, holder);
  crown(C.world, { type: 'wrestler', id: id('Gunther') }); crown(C.women, { type: 'wrestler', id: id('Liv') });
  crown(C.rawTag, { type: 'team', id: T.jd.id }); crown(C.wwe, { type: 'wrestler', id: id('Randy') });
  crown(C.sdWomen, { type: 'wrestler', id: id('Tiffany') }); crown(C.aew, { type: 'wrestler', id: id('Moxley') });
  crown(C.aewTag, { type: 'team', id: T.ftr.id }); crown(C.evolve, { type: 'wrestler', id: id('Jackson') });
  // relationships the owner set up at the start of the universe
  const rel = (kind, a, b, level) => M.editRelationship(st, { action: 'form', kind, a: id(a), b: id(b), level, since: 'start' });
  rel('grudge', 'Cody', 'Gunther', 2); rel('rivals', 'Cody', 'Gunther', 2);
  rel('rivals', 'Seth', 'Kevin', 2); rel('friends', 'Cody', 'Jey', 2); rel('friends', 'Kevin', 'Sami', 2);
  rel('grudge', 'Sami', 'Finn', 1); rel('grudge', 'Becky', 'Liv', 2);
  rel('grudge', 'Roman', 'Solo', 3); rel('grudge', 'Solo', 'Roman', 3); rel('allies', 'Roman', 'LA', 2);
  rel('rivals', 'Matt', 'Dax', 2);
  // four weeks of results
  const one = (ev, w, l, extra = {}) => M.recordMatch(st, ev.id, { sides: [{ wrestlers: [id(w)] }, { wrestlers: [id(l)] }], winner: 0, ...extra });
  const two = (ev, a, b) => M.recordMatch(st, ev.id, { sides: [{ team: a.id, wrestlers: a.members.slice(0, 2) }, { team: b.id, wrestlers: b.members.slice(0, 2) }], winner: 0 });
  const ep = (show, week) => { M.setWeek(st, week); return M.addEvent(st, { showId: show }); };
  const weeks = {
    raw: [
      e => { one(e, 'Cody', 'Drew'); one(e, 'Seth', 'Jey'); one(e, 'Gunther', 'Kevin'); two(e, T.jd, T.ko); one(e, 'Rhea', 'Iyo'); },
      e => { one(e, 'Kevin', 'Drew'); one(e, 'Cody', 'Finn'); one(e, 'Gunther', 'Sami'); one(e, 'Damian', 'Jey'); one(e, 'Liv', 'Becky'); one(e, 'Priest', 'Seth'); },
      e => { one(e, 'Cody', 'Priest'); one(e, 'Seth', 'Drew'); two(e, T.ko, T.jd); one(e, 'Becky', 'Iyo'); one(e, 'Gunther', 'Damian'); },
      e => { one(e, 'Jey', 'Gunther'); one(e, 'Seth', 'Kevin'); one(e, 'Drew', 'Finn'); one(e, 'Liv', 'Rhea'); one(e, 'Iyo', 'Rhea'); one(e, 'Cody', 'Sami'); },
    ],
    smackdown: [
      e => { one(e, 'Randy', 'Carmelo'); one(e, 'Bron', 'LA'); one(e, 'Tiffany', 'Jade'); one(e, 'Jacob', 'Tama'); },
      e => { one(e, 'Roman', 'Solo'); one(e, 'Randy', 'Bron'); one(e, 'Bianca', 'Nia'); one(e, 'Carmelo', 'Jacob'); },
      e => { one(e, 'Solo', 'Roman', { finish: 'dq' }); one(e, 'LA', 'Carmelo'); one(e, 'Jade', 'Nia'); one(e, 'Tama', 'Bron'); },
      e => { one(e, 'Randy', 'LA'); one(e, 'Bron', 'Jacob'); one(e, 'Tiffany', 'Bianca'); },
    ],
    dynamite: [
      e => { one(e, 'Moxley', 'Hangman'); two(e, T.ftr, T.bucks); one(e, 'Toni', 'Mariah'); },
      e => { one(e, 'Ospreay', 'Swerve'); one(e, 'Hangman', 'Matt'); one(e, 'Mercedes', 'Toni'); },
      e => { two(e, T.bucks, T.ftr); one(e, 'Moxley', 'Ospreay'); one(e, 'Swerve', 'Cash'); },
      e => { one(e, 'Hangman', 'Swerve'); one(e, 'Mariah', 'Mercedes'); one(e, 'Ospreay', 'Nick'); },
    ],
    nxt: [
      e => { one(e, 'Trick', 'Je'); one(e, 'Ethan', 'Wes'); one(e, 'Roxanne', 'Giulia'); },
      e => { one(e, 'Oba', 'Tony'); one(e, 'Trick', 'Ethan'); one(e, 'Giulia', 'Stephanie'); },
      e => { one(e, 'Je', 'Wes'); one(e, 'Tony', 'Ethan'); one(e, 'Jaida', 'Roxanne'); },
      e => { one(e, 'Trick', 'Tony'); one(e, 'Oba', 'Je'); one(e, 'Giulia', 'Jaida'); },
    ],
    evolve: [
      e => { one(e, 'Kali', 'Keanu'); one(e, 'Kendal', 'Wren'); },
      e => { one(e, 'Jackson', 'Edris'); },
      e => { one(e, 'Keanu', 'Edris'); one(e, 'Wren', 'Kendal'); },
      e => { one(e, 'Jackson', 'Kali'); },
    ],
  };
  for (let w = 1; w <= 4; w++) Object.entries(weeks).forEach(([show, list]) => list[w - 1](ep(show, w)));
  M.setWeek(st, 5);
  M.updateWrestler(st, id('Punk'), { status: 'injured' });
  M.updateWrestler(st, id('Brock'), { status: 'away' });
  M.assignWrestler(st, id('Oba'), 'raw', 'Called up');
  const backlash = M.addEvent(st, { kind: 'ple', name: 'Backlash', showId: 'raw', week: 7 });
  return { st, W, id, T, C, lfg, indies, backlash };
}
