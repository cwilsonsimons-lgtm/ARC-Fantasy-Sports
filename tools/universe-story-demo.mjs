// Universe — a few weeks of the story director, printed.
//
// Usage: node tools/universe-story-demo.mjs [weeks=8] [seed=23] [pace=normal] [results=9]
//
// Builds a small universe - Raw and SmackDown, their champions, three tag
// teams, personalities, a few relationships - and plays it forward the way the
// owner does: plan each show, book it, enter the results, move on a week. The
// director does everything else by itself.
//
// The results stand in for WWE 2K25's CPU: a fixed pseudo-random pick, the
// same every run. It keeps a champion's title 65% of the time, and gives Akira
// Tozawa a run - he mostly loses the first two weeks, then wins 85% - to show
// that an underdog's rise is noticed when the results support it. The
// "booker" books what the story sets up (a confrontation becomes a match, a
// title demand or a challenge a title match) the way the owner might; the
// director never books or decides a match.
//
// Printed: each show's card and results and what happened around it, with its
// lead cause; then what changed, and checks that the director left every
// result, title and roster move exactly as entered, that everything is
// consistent, and that the same seed tells the same story.
import * as M from '../js/universe/model.js';
import * as RL from '../js/universe/relations.js';
import * as DR from '../js/universe/director.js';
import { incidentText } from '../js/universe/ui.js';

const [WEEKS = 8, SEED = 23, PACE = 'normal', CPU = 9] = process.argv.slice(2).map((x, i) => (i === 2 ? x : Number(x)));
const UNDERDOG = 'Akira Tozawa';

function play({ weeks, seed, pace, cpuSeed }) {
  let x = cpuSeed;                                   // the stand-in CPU: its own fixed sequence, not the director's
  const cpu = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  const st = M.createUniverse();
  M.setStory(st, { pace });
  M.seedStory(st, seed);
  const add = (name, showId, alignment, traits, gender = 'male') => {
    const w = M.addWrestler(st, { name, showId, alignment, gender });
    M.setTraits(st, w.id, traits, { since: 'start' });
    return w;
  };
  [['Gunther', 'heel', ['hot-headed', 'ambitious', 'proud']], ['Cody Rhodes', 'face', ['respectful', 'loyal']], ['Jey Uso', 'face', ['loyal']],
    ['Seth Rollins', 'heel', ['proud']], ['Drew McIntyre', 'heel', ['hot-headed']], ['Sami Zayn', 'face', ['loyal', 'respectful']],
    ['Kevin Owens', 'face', ['opportunistic', 'hot-headed']], [UNDERDOG, 'face', []]].forEach(([n, a, t]) => add(n, 'raw', a, t));
  [['Rhea Ripley', 'face', ['ambitious']], ['Liv Morgan', 'heel', ['opportunistic']], ['Iyo Sky', 'heel', ['patient']]]
    .forEach(([n, a, t]) => add(n, 'raw', a, t, 'female'));
  [['Roman Reigns', 'heel', ['proud']], ['Solo Sikoa', 'heel', ['opportunistic']], ['LA Knight', 'face', ['ambitious']],
    ['Randy Orton', 'face', ['patient', 'respectful']], ['Bron Breakker', 'face', ['ambitious']], ['Carmelo Hayes', 'heel', ['cowardly']]]
    .forEach(([n, a, t]) => add(n, 'smackdown', a, t));
  const W = n => st.wrestlers.find(w => w.name === n);
  const title = (name, showId, division, holder) => {
    const t = M.addTitle(st, { name, showId, division });
    M.setChampion(st, t.id, { type: 'wrestler', id: W(holder).id });
    return t;
  };
  const titles = { raw: title('World Heavyweight Championship', 'raw', 'men', 'Gunther'), smackdown: title('Undisputed WWE Championship', 'smackdown', 'men', 'Roman Reigns') };
  const womens = title('Women’s World Championship', 'raw', 'women', 'Liv Morgan');
  const team = (name, a, b) => M.addTeam(st, { name, members: [W(a).id, W(b).id] });
  team('KO & Sami', 'Kevin Owens', 'Sami Zayn'); team('Judgment Day', 'Drew McIntyre', 'Seth Rollins'); team('The Bloodline', 'Solo Sikoa', 'Carmelo Hayes');
  M.editRelationship(st, { action: 'form', kind: 'grudge', a: W('Cody Rhodes').id, b: W('Gunther').id, level: 1, since: 'start' });
  M.editRelationship(st, { action: 'form', kind: 'friends', a: W('Jey Uso').id, b: W('Sami Zayn').id, level: 2, since: 'start' });

  const setupMoves = st.moves.length, setupReigns = new Set(st.reigns.map(r => r.id));
  const entered = new Map();                         // match id -> the winner the CPU gave
  const out = [];
  const nm = id => M.wrestlerById(st, id).name;
  const shown = new Set();
  // the director's events on a show's part, as the What happened feed groups them, with their lead cause
  const events = (ev, phase) => {
    const list = [];
    ev.incidents.filter(i => i.story && (i.phase === phase) && !shown.has(i.id)).forEach(i => {
      shown.add(i.id);
      const last = list[list.length - 1];
      if (last && last.story === i.story && JSON.stringify(last.cause) === JSON.stringify(i.cause)) last.incs.push(i);
      else list.push({ story: i.story, cause: i.cause, incs: [i] });
    });
    return list.map(g => {
      const text = [incidentText(st, g.incs[0]), ...g.incs.slice(1).map(i => (i.kind === 'save' ? `${nm(i.by[0])} made the save`
        : i.kind === 'turn' ? `${nm(i.by[0])} turned ${i.turn.to}` : i.kind === 'breakup' ? `${M.teamById(st, i.team).name} split` : incidentText(st, i)))].join(' — ');
      return { text, why: g.cause.find(w => !/^Less likely/.test(w)) || '', kinds: g.incs.map(i => i.kind) };
    });
  };
  const line = (label, e) => out.push(`    ${label.padEnd(7)} ${e.text}${e.why ? `  (${e.why})` : ''}`);
  const side = ids => {
    const t = ids.length > 1 && st.teams.find(x => x.active && x.members.length === ids.length && ids.every(id => x.members.includes(id)));
    return { team: t ? t.id : null, wrestlers: ids };
  };
  const pending = [];                                // title matches the story has set up for a show's next episode

  for (let week = 1; week <= weeks; week++) {
    if (week > 1) M.setWeek(st, week);
    DR.tick(st);
    out.push(`\nWeek ${week}`);
    for (const showId of ['raw', 'smackdown']) {
      const ev = M.addEvent(st, { showId });
      DR.tick(st);                                   // it's the next show up: what happens before it happens now
      out.push(`  ${ev.name}`);
      const before = events(ev, 'pre');
      before.forEach(e => line('before', e));
      // the booker books what the story set up, then fills the card from the roster
      const busy = new Set();
      const book = (a, b, titleId = null) => {
        if ([...a, ...b].some(id => busy.has(id))) return;
        [...a, ...b].forEach(id => busy.add(id));
        M.bookMatch(st, ev.id, { sides: [side(a), side(b)], titleId });
      };
      const champOf = t => { const r = M.currentReign(st, t.id); return r ? [r.holder.id] : null; };
      const free = gender => st.wrestlers.filter(w => w.showId === showId && w.gender === gender && !busy.has(w.id)).sort(() => cpu() - 0.5);
      ev.incidents.filter(i => i.phase === 'pre').forEach(i => {
        const champ = i.title && champOf(M.titleById(st, i.title));
        if (i.kind === 'confrontation') book(i.by, i.on);
        if (i.kind === 'demand' && champ && !champ.includes(i.by[0])) book(i.by, champ, i.title);
        if (i.kind === 'open-challenge') {                          // whoever answers is the booker's call
          const answer = free(M.wrestlerById(st, i.by[0]).gender).find(w => !i.by.includes(w.id));
          if (answer) book(i.by, [answer.id], champ && champ.includes(i.by[0]) ? i.title : null);
        }
      });
      pending.filter(p => p.showId === showId).forEach(p => { if (champOf(p.title)) book(p.by, champOf(p.title), p.title.id); });
      pending.splice(0, pending.length, ...pending.filter(p => p.showId !== showId));
      if (week % 3 === 0 && !ev.matches.some(m => m.titleId === titles[showId].id)) {
        const champ = champOf(titles[showId]);
        const pool = st.wrestlers.filter(w => w.showId === showId && w.gender === 'male' && !busy.has(w.id) && !champ.includes(w.id));
        if (pool.length) book(champ, [pool[Math.floor(cpu() * pool.length)].id], titles[showId].id);
      }
      const teams = st.teams.filter(t => t.active && t.members.every(id => M.wrestlerById(st, id).showId === showId && !busy.has(id)));
      if (teams.length >= 2) {
        teams.slice(0, 2).forEach(t => t.members.forEach(id => busy.add(id)));
        M.bookMatch(st, ev.id, { sides: teams.slice(0, 2).map(t => ({ team: t.id, wrestlers: [...t.members] })) });
      } else if (teams.length === 1) {                                // a team with no rivals takes on two others
        const t = teams[0], pair = free('male').filter(w => !t.members.includes(w.id)).slice(0, 2);
        if (pair.length === 2) book([...t.members], pair.map(w => w.id));
      }
      if (showId === 'raw' && !busy.has(W(UNDERDOG).id)) {           // the underdog gets a match every week
        const opp = free('male').find(w => w.id !== W(UNDERDOG).id);
        if (opp) book([W(UNDERDOG).id], [opp.id]);
      }
      for (const gender of ['male', 'female']) {
        const f = free(gender);
        for (let i = 0; i + 1 < f.length && i < 4; i += 2) book([f[i].id], [f[i + 1].id]);
      }
      out.push(`    card    ${ev.matches.map(m => m.sides.map(sd => sd.team ? M.teamById(st, sd.team).name : sd.wrestlers.map(nm).join(' & ')).join(' vs ')
        + (m.titleId ? ` (${M.titleById(st, m.titleId).name})` : '')).join(' · ')}`);
      // the "CPU" plays them; the results are entered one by one, and the director follows by itself
      const results = [];
      ev.matches.filter(m => m.status === 'scheduled').forEach(m => {
        // the stand-in: the underdog wins 80%, a champion keeps the title 65%, anything else is a coin toss
        const favoured = m.sides.findIndex(sd => sd.wrestlers.includes(W(UNDERDOG).id));
        const reign = m.titleId && M.currentReign(st, m.titleId);
        const champ = reign ? m.sides.findIndex(sd => sd.wrestlers.includes(reign.holder.id)) : -1;
        const pick = (side, p) => (cpu() < p ? side : 1 - side);
        const winner = favoured >= 0 ? pick(favoured, week <= 2 ? 0.2 : 0.85) : champ >= 0 ? pick(champ, 0.65) : pick(0, 0.5);
        const won = M.enterResult(st, ev.id, m.id, { sides: m.sides, outcome: 'win', winner }, { titleChange: champ >= 0 && winner !== champ });
        entered.set(won.id, winner);
        results.push(`${m.sides[winner].team ? M.teamById(st, m.sides[winner].team).name : m.sides[winner].wrestlers.map(nm).join(' & ')}${champ >= 0 && winner !== champ ? ' (new champion)' : ''}`);
        DR.tick(st);
      });
      out.push(`    winners ${results.join(' · ')}`);
      events(ev, 'post').forEach(e => {
        line('after', e);
        // a title challenge after the show: the booker makes it next week's main event
        const inc = ev.incidents.find(i => i.kind === 'challenge' && incidentText(st, i) === e.text.split(' — ')[0]);
        if (inc && inc.title) pending.push({ showId, by: inc.by, title: M.titleById(st, inc.title) });
      });
    }
  }
  // what the director changed, and what it didn't
  const rels = [...RL.relationships(st).rels.values()].filter(r => r.active);
  const turns = M.allIncidents(st).filter(x => x.incident.kind === 'turn').map(x => `${nm(x.incident.by[0])} (${x.incident.turn.from} → ${x.incident.turn.to}, ${x.event.name})`);
  const splits = st.teams.filter(t => !t.active).map(t => t.name);
  const newReigns = st.reigns.filter(r => !setupReigns.has(r.id));
  const byEntered = newReigns.every(r => {
    const ev = M.eventById(st, r.eventId), m = ev && ev.matches.find(y => y.id === r.matchId);
    return m && m.status === 'played' && m.titleId === r.titleId && m.sides[m.winner].wrestlers.includes(r.holder.id);
  });
  const results = st.events.flatMap(e => e.matches);
  const picks = st.story.rolls.flatMap(r => r.considered.filter(k => k.picked));
  const under = W(UNDERDOG), rec = M.wrestlerRecord(st, under.id).singles, mo = DR.momentumOf(st, under.id);
  return {
    st, out, feed: M.allIncidents(st).map(x => `${x.event.id}:${x.incident.phase}:${incidentText(st, x.incident)}`),
    summary: [
      `\nWhat changed over ${weeks} weeks (${pace} pace, seed ${seed})`,
      `  ${picks.length} story events over ${weeks * 2} shows — ${(picks.length / (weeks * 2)).toFixed(2)} a show; ${new Set(picks.map(p => p.kind)).size} kinds`,
      `  relationships now: ${['grudge', 'rivals', 'allies', 'friends', 'former-partners'].map(k => `${rels.filter(r => r.kind === k).length} ${k}`).join(', ')}`,
      `  turns: ${turns.join('; ') || 'none'}`,
      `  teams split: ${splits.join(', ') || 'none'}`,
      `  title changes: ${newReigns.map(r => `${M.holderName(st, r.holder)} won the ${M.titleById(st, r.titleId).name} at ${M.eventById(st, r.eventId).name}`).join('; ') || 'none'}`,
      `  ${UNDERDOG}: ${rec.w}-${rec.l} in singles, momentum ${mo.label}${mo.reasons.length ? ` (${mo.reasons[0]})` : ''}; goal: ${DR.goalOf(st, under.id) || 'nothing in particular'}`,
      `  champions now: ${st.titles.map(t => `${t.name}: ${M.holderName(st, M.currentReign(st, t.id).holder)}`).join('; ')}`,
    ],
    checks: {
      'every result is the one entered': results.every(m => m.status === 'played' && entered.get(m.id) === m.winner) && results.length === entered.size,
      'every title change came from an entered result': byEntered,
      'nobody moved between shows': st.moves.length === setupMoves,
      'the save is consistent (validate)': M.validate(st).length === 0,
      'every director event keeps its cause': M.allIncidents(st).every(x => !x.incident.story || x.incident.cause.length > 0),
    },
  };
}

const a = play({ weeks: WEEKS, seed: SEED, pace: PACE, cpuSeed: CPU });
console.log(`The story director — ${WEEKS} weeks of Raw and SmackDown (seed ${SEED}, ${PACE} pace)`);
console.log(`Results come from a stand-in for the CPU, which gives ${UNDERDOG} a run from week 3. Everything marked before/after is the director's.`);
console.log(a.out.join('\n'));
console.log(a.summary.join('\n'));
const b = play({ weeks: WEEKS, seed: SEED, pace: PACE, cpuSeed: CPU });
const checks = { ...a.checks, 'the same seed tells the same story': JSON.stringify(a.feed) === JSON.stringify(b.feed) };
console.log('\nChecks');
Object.entries(checks).forEach(([k, v]) => console.log(`  ${v ? 'ok  ' : 'FAIL'} ${k}`));
if (Object.values(checks).some(v => !v)) process.exitCode = 1;
