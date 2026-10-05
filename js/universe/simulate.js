// Universe — simulate ahead: what the next few weeks could do to the universe.
//
// A preview, never the real thing. The universe is copied, and the copy is
// played forward week by week the way the owner would play it: every show's
// episode planned, the story director going before each show and straight
// after each match, the auto booker drafting each card and the draft booked
// as it stands - and a stand-in for the WWE 2K25 CPU deciding every match,
// because results in the real universe only ever come from the game. Then the
// copy is compared with the universe as it is: titles, relationships, story
// events, turns, teams, feuds, standings, momentum, #1 contenders.
//
// Pure and seeded: the same universe, settings and seed always simulate the
// same weeks. Nothing here changes the universe it's handed.
import * as M from './model.js';
import * as RL from './relations.js';
import * as SD from './standings.js';
import * as SL from './storylines.js';
import * as B from './booker.js';
import * as DR from './director.js';
import { incidentText } from './ui.js';

export const WEEK_CHOICES = [1, 2, 4, 8, 12];
export const RESULTS = {
  form: { label: 'Favourites usually win', text: 'The side with the better record, momentum and gold is likelier to win — upsets still happen.' },
  even: { label: 'Anyone can win', text: 'Every side has the same chance.' },
};
export const RULES = { draw: 0.03, noContest: 0.01, champBonus: 0.08, hot: 0.08, cold: -0.08, power: 2 };

const copyOf = st => JSON.parse(JSON.stringify(st));
const nm = (st, id) => (M.wrestlerById(st, id) || { name: '(gone)' }).name;
const sideName = (st, sd) => (sd.team && M.teamById(st, sd.team) ? M.teamById(st, sd.team).name : sd.wrestlers.map(id => nm(st, id)).join(' & '));
const holders = (st, h) => (h.type === 'team' ? (M.teamById(st, h.id) || { members: [] }).members : [h.id]);

// ---------------------------------------------------------------- the stand-in CPU

// how likely a wrestler is to win, from the record: their win rate (an even start for a newcomer), how they're going, and gold
function rating(st, id, hist) {
  const r = M.wrestlerRecord(st, id);
  const w = r.singles.w + r.tag.w, l = r.singles.l + r.tag.l;
  let x = (w + 1) / (w + l + 2);
  const mo = DR.momentumOf(st, id, hist);
  if (mo.label === 'hot' || mo.label === 'rising') x += RULES.hot;
  else if (mo.label === 'cold') x += RULES.cold;
  if (M.titlesOfWrestler(st, id).length) x += RULES.champBonus;
  return Math.max(0.05, x);
}

/**
 * Decide one match, as the CPU might: a draw or no contest now and then;
 * otherwise a winner drawn by strength ('form') or evenly ('even'). A title
 * changes hands when its challengers win. Returns the result as entered.
 */
export function playMatch(st, ev, m, { seed, results = 'form' }) {
  const roll = DR.draw('sim', seed, ev.id, m.id);
  if (roll < RULES.noContest) return M.enterResult(st, ev.id, m.id, { outcome: 'nc' });
  if (roll < RULES.noContest + RULES.draw) return M.enterResult(st, ev.id, m.id, { outcome: 'draw' });
  const hist = DR.history(st, ev.at);
  const weights = m.sides.map(sd => (results === 'even' ? 1
    : (sd.wrestlers.reduce((n, id) => n + rating(st, id, hist), 0) / sd.wrestlers.length) ** RULES.power));
  const total = weights.reduce((n, w) => n + w, 0);
  let x = DR.draw('sim', seed, ev.id, m.id, 'winner') * total;
  let winner = weights.findIndex(w => (x -= w) < 0);
  if (winner < 0) winner = weights.length - 1;
  const sd = m.sides[winner];
  const t = m.titleId && M.titleById(st, m.titleId);
  const reign = t && M.currentReign(st, t.id);
  const theirs = reign && (reign.holder.type === 'team' ? sd.team === reign.holder.id : sd.wrestlers.includes(reign.holder.id));
  const canHold = t && (t.kind === 'tag' ? !!sd.team : sd.wrestlers.length === 1);
  return M.enterResult(st, ev.id, m.id, { outcome: 'win', winner }, { titleChange: !!(t && t.active && canHold && !theirs) });
}

// ---------------------------------------------------------------- playing weeks

/**
 * Start a simulation: a copy of `st`, to be played forward `weeks` weeks from
 * the current one (this week's shows that still have matches to play count as
 * the first). `pace` sets the story director's pace for the copy (it runs
 * there even if it's switched off in the universe). Returns the run's state,
 * for stepWeek and finish.
 */
export function start(st, { weeks = 4, seed = 1, results = 'form', pace = null } = {}) {
  const copy = copyOf(st);
  const from = M.activeSeason(copy).week;
  if (!copy.story.on) M.setStory(copy, { on: true });
  if (pace) M.setStory(copy, { pace });
  copy.story.seed = (Math.abs(Math.floor(Number(seed) || 0)) % 2147483646) + 1;
  return { copy, seed, results: RESULTS[results] ? results : 'form', from, to: from + Math.max(1, Math.floor(weeks)) - 1, week: from,
    played: 0, booked: 0, problems: [] };
}

/** Play the next week of a simulation. False once it's done. */
export function stepWeek(sim) {
  if (sim.week > sim.to) return false;
  const st = sim.copy, w = sim.week;
  if (M.activeSeason(st).week !== w) M.setWeek(st, w);
  M.scheduleAnnual(st);                                           // the year's annual events, as the app puts them on the calendar
  // every show's episode on the calendar (a special event in its place), as the owner would plan the week
  B.weekPlan(st, w).forEach(r => { if (r.action === 'plan') M.addEvent(st, { showId: r.show.id, week: w }); });
  const season = M.activeSeason(st).id;
  const evs = st.events.filter(e => e.at.season === season && e.at.week === w).sort((a, b) => M.compareStamps(st, a.at, b.at));
  for (const ev of evs) {
    DR.tick(st);                                                  // before the show, once it's the next one up
    bookCard(sim, ev);
    for (const m of ev.matches.filter(x => x.status === 'scheduled')) {
      try { playMatch(st, ev, m, sim); sim.played++; } catch (e) {
        if (!(e instanceof M.UniverseError)) throw e;
        sim.problems.push(`${ev.name}: ${e.message}`);
      }
      DR.tick(st);                                                // straight after the match
    }
  }
  sim.week++;
  if (sim.week > sim.to) DR.tick(st);                             // after the last show
  return sim.week <= sim.to;
}
// a card for the show: its draft as it stands, or a draft of the rest from the auto booker - booked
function bookCard(sim, ev) {
  const st = sim.copy;
  const cs = M.cardStatus(ev);
  if (cs.played && !ev.matches.some(m => m.status === 'scheduled')) return;
  const draft = () => {
    const r = B.draftCard(st, ev.id);
    if (!r.matches.length) { ev.draft = null; return; }
    M.setDraft(st, ev.id, r.matches.map(B.toSpec), { seen: r.seen, played: r.played });
  };
  try {
    if (!ev.draft && !cs.played && cs.total < M.cardSize(st, ev)) draft();
    if (ev.draft) sim.booked += M.bookDraft(st, ev.id).length;
  } catch (e) {
    if (!(e instanceof M.UniverseError)) throw e;
    try { M.discardDraft(st, ev.id); draft(); if (ev.draft) sim.booked += M.bookDraft(st, ev.id).length; } catch (e2) {
      if (!(e2 instanceof M.UniverseError)) throw e2;
      sim.problems.push(`${ev.name}: ${e2.message}`);
    }
  }
}

/** Simulate in one go: { after, report }. */
export function simulate(st, opts = {}) {
  const sim = start(st, opts);
  while (stepWeek(sim));
  return { sim, after: sim.copy, report: report(st, sim) };
}

// ---------------------------------------------------------------- what changed

const REL_KINDS = ['grudge', 'rivals', 'allies', 'friends', 'former-partners'];
const kindOfKey = key => (key.startsWith('team:') ? key.slice(5) : key).split(':')[0];

/**
 * What the simulated weeks changed, compared with the universe as it is:
 * counts, and the details worth reading. Names come from the simulated copy.
 */
export function report(before, sim) {
  const after = sim.copy;
  const season = M.activeSeason(after);
  const known = new Set(before.events.flatMap(e => e.matches.filter(m => m.status === 'played').map(m => m.id)));
  const inPeriod = e => e.at.season === season.id && e.at.week >= sim.from && e.at.week <= sim.to;
  const events = after.events.filter(inPeriod).sort((a, b) => M.compareStamps(after, a.at, b.at));
  const played = events.flatMap(ev => ev.matches.filter(m => m.status === 'played' && !known.has(m.id)).map(m => ({ ev, m })));

  // titles: every reign that began in the simulated weeks
  const oldReigns = new Set(before.reigns.map(r => r.id));
  const titles = after.reigns.filter(r => !oldReigns.has(r.id)).sort((a, b) => a.start.seq - b.start.seq).map(r => {
    const prev = after.reigns.find(x => x.titleId === r.titleId && x.end && x.end.seq === r.start.seq);
    const ev = M.eventById(after, r.eventId);
    return { title: M.titleById(after, r.titleId).name, to: M.holderName(after, r.holder), from: prev ? M.holderName(after, prev.holder) : null,
      where: ev ? ev.name : '', week: r.start.week };
  });
  const contenders = after.titles.filter(t => t.active).map(t => ({ t, c: M.numberOneContender(after, t.id) })).filter(x => x.c)
    .map(({ t, c }) => ({ title: t.name, who: M.holderName(after, c.holder), where: c.event.name,
      isNew: !M.numberOneContender(before, t.id) || !sameHolder(M.numberOneContender(before, t.id).holder, c.holder) }));

  // relationships: what formed, ended, grew or cooled
  const a = RL.snapshot(before), b = RL.snapshot(after);
  const rel = { formed: {}, ended: {}, grew: 0, cooled: 0 };
  REL_KINDS.forEach(k => { rel.formed[k] = 0; rel.ended[k] = 0; });
  b.forEach((lv, key) => {
    const k = kindOfKey(key);
    if (!a.has(key)) rel.formed[k] = (rel.formed[k] || 0) + 1;
    else if (lv > a.get(key)) rel.grew++;
    else if (lv < a.get(key)) rel.cooled++;
  });
  a.forEach((lv, key) => { if (!b.has(key)) { const k = kindOfKey(key); rel.ended[k] = (rel.ended[k] || 0) + 1; } });
  const relLines = RL.changesBetween(after, a, b);
  const now = [...RL.relationships(after).rels.values()].filter(r => r.active);
  const was = [...RL.relationships(before).rels.values()].filter(r => r.active);

  // story events: everything the director made in those weeks, one line per decision
  const oldInc = new Set(before.events.flatMap(e => e.incidents.map(i => i.id)));
  const story = [];
  events.forEach(ev => {
    let last = null;
    ev.incidents.filter(i => !oldInc.has(i.id)).forEach(i => {
      if (last && last.roll === i.story && JSON.stringify(last.cause) === JSON.stringify(i.cause)) { last.incs.push(i); return; }
      last = { ev, roll: i.story, cause: i.cause, incs: [i] };
      story.push(last);
    });
  });
  const KIND = g => (g.incs.some(i => i.kind === 'save') ? 'save' : g.incs[0].kind);
  const storyKinds = {};
  story.forEach(g => { storyKinds[KIND(g)] = (storyKinds[KIND(g)] || 0) + 1; });
  const line = g => [incidentText(after, g.incs[0]), ...g.incs.slice(1).map(i => (i.kind === 'save' ? `${i.by.map(id => nm(after, id)).join(' & ')} made the save`
    : i.kind === 'turn' ? `${nm(after, i.by[0])} turned ${i.turn.to}` : i.kind === 'breakup' ? `${(M.teamById(after, i.team) || { name: 'the team' }).name} split`
      : incidentText(after, i)))].join(' — ');
  const m = g => g.incs[0].match && g.ev.matches.find(x => x.id === g.incs[0].match);
  const storyLines = story.map(g => ({ kind: KIND(g), text: line(g), where: g.ev.name, week: g.ev.at.week,
    when: g.incs[0].phase === 'pre' ? 'before the show' : m(g) ? `straight after ${m(g).sides.map(sd => sideName(after, sd)).join(' vs ')}` : 'after the show' }));

  // turns and splits
  const turns = after.wrestlers.map(w => ({ w, old: M.wrestlerById(before, w.id) })).filter(x => x.old && x.old.alignment !== x.w.alignment)
    .map(x => ({ who: x.w.name, from: x.old.alignment, to: x.w.alignment }));
  const splits = after.teams.filter(t => !t.active && (M.teamById(before, t.id) || {}).active).map(t => t.name);

  // feuds: the storylines that matter most now, and which are new
  const oldLines = new Set(SL.storylines(before).map(l => l.key));
  const feuds = SL.storylines(after).filter(l => l.stage !== 'settled').sort((x, y) => y.priority - x.priority).slice(0, 6)
    .map(l => ({ who: `${nm(after, l.a)} vs ${nm(after, l.b)}`, stage: SL.STAGE_LABEL[l.stage], text: SL.storyText(after, l), isNew: !oldLines.has(l.key) }));

  // standings: each show's top three now, and its biggest climber this season
  const standings = after.shows.map(sh => {
    const per = st => { const p = SD.periodOf(st, season.id); return SD.standings(st, { showId: sh.id, period: p }).ranked; };
    const nowRows = per(after), oldRows = per(before);
    const oldRank = new Map(oldRows.map(r => [r.id, r.rank]));
    const climbs = nowRows.map(r => ({ name: r.name, rank: r.rank, up: (oldRank.get(r.id) || nowRows.length + 1) - r.rank })).filter(x => x.up > 0)
      .sort((x, y) => y.up - x.up || x.rank - y.rank);
    return { show: sh.name, top: nowRows.slice(0, 3).map(r => ({ name: r.name, rank: r.rank, was: oldRank.get(r.id) || null })), climber: climbs[0] || null };
  }).filter(x => x.top.length);

  // who's hot now, and who won most in those weeks
  const hist = DR.history(after, null);
  const hot = after.wrestlers.filter(w => w.status === 'active' && w.showId).map(w => ({ w, mo: DR.momentumOf(after, w.id, hist) }))
    .filter(x => x.mo.label === 'hot').sort((x, y) => y.mo.score - x.mo.score || x.w.name.localeCompare(y.w.name)).slice(0, 5)
    .map(x => ({ name: x.w.name, form: x.mo.form }));
  const wins = new Map();
  played.forEach(({ m: mm }) => { if (mm.outcome === 'win') mm.sides[mm.winner].wrestlers.forEach(id => wins.set(id, (wins.get(id) || 0) + 1)); });
  const winners = [...wins].sort((x, y) => y[1] - x[1] || nm(after, x[0]).localeCompare(nm(after, y[0]))).slice(0, 5).map(([id, n]) => ({ name: nm(after, id), wins: n }));

  return {
    from: sim.from, to: sim.to, season: season.name, results: sim.results, pace: after.story.pace, seed: sim.seed,
    shows: events.filter(ev => ev.matches.some(x => x.status === 'played' && !known.has(x.id))).length, matches: played.length, booked: sim.booked,
    titles, contenders, relationships: { ...rel, lines: relLines, before: was.length, after: now.length },
    story: storyLines, storyKinds, turns, splits, feuds, standings, hot, winners, problems: sim.problems,
  };
}
const sameHolder = (x, y) => !!x && !!y && x.type === y.type && x.id === y.id;
