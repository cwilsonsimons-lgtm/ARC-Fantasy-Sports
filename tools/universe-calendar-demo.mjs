// A month on the universe calendar, from the first Monday to the last Sunday,
// and on into the next: the universe begins in May (a season runs from May to
// WrestleMania in April); every show's episode on its night, drafted by the
// auto booker and booked; results entered as the game would give them (the
// first side wins - this is a stand-in for the owner, not the app deciding);
// in the last week of May each show's Last Stand takes its episode's place,
// built toward from two weeks out; then Next week, into June - where nothing
// gets a result it wasn't given, and Money in the Bank's qualifiers go on.
// Last, Money in the Bank is rescheduled: its build-up follows, and a result
// and a locked match stay.
//
// Usage: node tools/universe-calendar-demo.mjs
import * as M from '../js/universe/model.js';
import * as B from '../js/universe/booker.js';

const out = [];
const say = (...x) => out.push(x.join(' '));
let failed = 0;
const expect = (ok, what) => { if (!ok) failed++; say(`   ${ok ? 'ok  ' : 'FAIL'} ${what}`); };

// ---------------------------------------------------------------- a universe
const st = M.createUniverse();
M.setStory(st, { on: false });
M.setCalendar(st, { month: 4, year: 2026 });                         // it began in May 2026 (the default)
const roster = {
  raw: [['Cody', 'Gunther', 'Seth', 'Kevin', 'Sami', 'Jey', 'Drew', 'Damian'], ['Rhea', 'Liv', 'Becky', 'Iyo']],
  smackdown: [['Roman', 'Solo', 'Randy', 'LA', 'Bron', 'Carmelo'], ['Bianca', 'Jade', 'Tiffany', 'Nia']],
  dynamite: [['Moxley', 'Hangman', 'Ospreay', 'Swerve', 'Matt', 'Nick'], ['Toni', 'Mariah']],
  nxt: [['Oba', 'Trick', 'Je', 'Ethan'], ['Roxanne', 'Giulia']],
  evolve: [['Kali', 'Jackson', 'Keanu', 'Edris'], []],
};
Object.entries(roster).forEach(([showId, [men, women]]) => {
  men.forEach(name => M.addWrestler(st, { name, showId, gender: 'male' }));
  women.forEach(name => M.addWrestler(st, { name, showId, gender: 'female' }));
});
const id = n => st.wrestlers.find(w => w.name === n).id;
M.editRelationship(st, { action: 'form', kind: 'grudge', a: id('Cody'), b: id('Gunther'), level: 2, since: 'start' });
M.editRelationship(st, { action: 'form', kind: 'rivals', a: id('Roman'), b: id('Solo'), level: 2, since: 'start' });
const world = M.addTitle(st, { name: 'World Heavyweight Championship', showId: 'raw', kind: 'singles', division: 'men' });
M.setChampion(st, world.id, { type: 'wrestler', id: id('Gunther') });
const season = M.activeSeason(st);
const nm = x => M.wrestlerById(st, x).name;
const line = m => m.sides.map(sd => sd.wrestlers.map(nm).join(' & ')).join(' vs ');
const played = () => st.events.reduce((n, e) => n + e.matches.filter(m => m.status === 'played').length, 0);
const MARK = { scheduled: '○', 'in-progress': '◐', completed: '●' };
const date = (week, day) => M.universeDate(st, season.id, week, day);

// the game's results, as the owner would enter them
const enter = (ev, n = Infinity) => ev.matches.filter(m => m.status === 'scheduled').slice(0, n)
  .forEach(m => M.enterResult(st, ev.id, m.id, { outcome: 'win', winner: 0 }));
// the week as the owner runs it: Next week puts the year's annual events on the calendar, each show is planned and drafted, then booked
function runWeek(week, { results = true, hold = [] } = {}) {
  M.setWeek(st, week);
  M.scheduleAnnual(st);
  B.weekPlan(st, week).forEach(r => { if (r.action === 'plan') M.addEvent(st, { showId: r.show.id, week }); });
  M.eventsIn(st, season.id).filter(e => e.at.week === week).forEach(ev => {
    const d = B.draftCard(st, ev.id);
    if (!d.matches.length) return;
    M.setDraft(st, ev.id, d.matches.map(B.toSpec), { seen: d.seen, played: d.played });
    M.bookDraft(st, ev.id);
    if (results && !hold.includes(ev.name)) enter(ev);
  });
}

// ---------------------------------------------------------------- May: a complete four-week month
say('May 2026 — four weeks, Monday to Sunday, days 1 to 28');
runWeek(1);
const lastStands = st.events.filter(e => e.recurring && /: Last Stand$/.test(e.name));
const rawLS = lastStands.find(e => e.name === 'Raw: Last Stand');
expect(lastStands.length === 5 && lastStands.every(e => e.at.week === 4 && e.at.day === M.showById(st, e.showId).day),
  'each show’s Last Stand is on the calendar in the last week of May, on its own night');
expect(`${M.DAYS[rawLS.at.day]} ${date(4, rawLS.at.day).date}` === 'Monday 22', 'Raw: Last Stand is Monday 22 May');
runWeek(2);
const ahead = M.approaching(st, { season: season.id, week: 2, day: 0 }, ['raw']);
expect(ahead.length && ahead[0].event === rawLS && ahead[0].weeks === 2,
  `week 2 is building toward it: ${ahead.map(x => `${x.event.name} in ${x.weeks} weeks (${x.phases.map(p => p.focus).join(', ')})`).join('; ')}`);
runWeek(3);
// week 4: the Last Stands. SmackDown's card stays unplayed, and only half of Raw's results are in
runWeek(4, { hold: ['SmackDown: Last Stand', 'Raw: Last Stand'] });
enter(rawLS, Math.ceil(rawLS.matches.length / 2));

const evs = M.eventsIn(st, season.id);
const short = e => (M.isBigEvent(e) ? `★${e.name.replace(': Last Stand', ' LS')}` : (M.showById(st, e.showId) || { name: '?' }).name.slice(0, 3));
const cell = (w, day) => {
  const here = evs.filter(e => e.at.week === w && e.at.day === day);
  return `${String(date(w, day).date).padStart(2)} ${here.map(e => `${short(e)}${MARK[M.eventStatus(e)]}`).join(' ')}`.padEnd(26);
};
say(`        ${M.DAYS.map(d => d.slice(0, 3).padEnd(26)).join('')}`);
for (let w = 1; w <= 4; w++) say(`   W${w}   ${M.DAYS.map((_, day) => cell(w, day)).join('')}`);
say('   ○ scheduled   ◐ in progress   ● completed   ★ special event (LS: Last Stand)');
const month = evs.filter(e => e.at.week <= 4);
const SHOWS = ['raw', 'smackdown', 'dynamite', 'nxt', 'evolve'];
expect([1, 2, 3].every(w => SHOWS.every(s => month.some(e => e.at.week === w && e.showId === s && e.kind === 'weekly'))),
  'weeks 1–3: every show’s episode, each week');
expect(SHOWS.every(s => !month.some(e => e.at.week === 4 && e.kind === 'weekly' && e.showId === s) && month.some(e => e.at.week === 4 && e.kind === 'special' && e.showId === s)),
  'week 4: each show’s Last Stand in place of its episode');
expect(month.every(e => { const u = M.stampDate(st, e.at); return u.month === 4 && u.year === 2026 && u.date >= 1 && u.date <= 28; }),
  `all ${month.length} events fall on a day 1–28 of May 2026`);
const st4 = n => M.eventStatus(evs.find(e => e.name === n));
expect(st4('Dynamite: Last Stand') === 'completed' && st4('SmackDown: Last Stand') === 'scheduled' && st4('Raw: Last Stand') === 'in-progress',
  'Dynamite’s Last Stand completed, SmackDown’s scheduled (booked, no results), Raw’s in progress');

// ---------------------------------------------------------------- Next week: into June
say('');
say('Next week → June 2026');
const before = played();
const waiting = evs.flatMap(e => e.matches.filter(m => m.status === 'scheduled').map(m => m.id));
runWeek(5, { results: false });
const jun = date(5, 0);
expect(jun.month === 5 && jun.week === 1 && jun.date === 1 && jun.year === 2026, `week 5 is ${M.MONTHS[jun.month]} ${jun.year}, week ${jun.week}: Monday the ${jun.date}st`);
expect(date(4, 6).date === 28 && date(5, 0).date === 1, 'Sunday 28 May, then Monday 1 June — no 29th, 30th or 31st');
expect(played() === before, `moving the date on entered no result (${before} results before and after)`);
expect(waiting.every(mid => st.events.some(e => e.matches.some(m => m.id === mid && m.status === 'scheduled'))),
  `the ${waiting.length} matches still waiting for the game are still waiting`);
const mitb = st.events.find(e => e.name === 'Money in the Bank');
expect(mitb && mitb.at.week === 8 && date(8, mitb.at.day).date === 27, 'Money in the Bank: Saturday 27 June, week 8');
const mania = st.events.find(e => e.name === 'WrestleMania');
expect(mania && mania.at.week === 47 && M.MONTHS[date(47).month] === 'April', 'WrestleMania: April 2027, week 47 — the end of the season');
const raw5 = M.eventsIn(st, season.id).find(e => e.name === 'Raw · Week 5');
const quals = raw5.matches.filter(m => m.prep && m.prep.event === mitb.id && m.prep.kind === 'qualifier');
say(`   Raw, Monday 1 June: ${raw5.matches.map(m => `${line(m)}${m.prep ? ` [${m.prep.kind} · ${m.prep.name}]` : ''}`).join(' · ')}`);
expect(quals.length >= 1, `the booker builds toward Money in the Bank: ${quals.length} qualifying match${quals.length === 1 ? '' : 'es'} on Raw`);
expect(raw5.matches.every(m => m.status === 'scheduled'), 'and nothing on it has a result');

// ---------------------------------------------------------------- rescheduling Money in the Bank
say('');
say('Money in the Bank moves a week later, then four weeks earlier');
const q1 = quals[0];
M.enterResult(st, raw5.id, q1.id, { outcome: 'win', winner: 0 });         // one qualifier played...
const sd5 = M.eventsIn(st, season.id).find(e => e.name === 'SmackDown · Week 5');
const q2 = sd5.matches.find(m => m.prep && m.prep.kind === 'qualifier') || M.bookMatch(st, sd5.id,
  { sides: [{ wrestlers: [id('Bron')] }, { wrestlers: [id('Carmelo')] }], prep: { event: mitb.id, kind: 'qualifier' } });
M.setMatchLocked(st, sd5.id, q2.id, true);                                   // ...and one locked by the owner
const nxt5 = M.eventsIn(st, season.id).find(e => e.name === 'NXT · Week 5');
const q3 = M.bookMatch(st, nxt5.id, { sides: [{ wrestlers: [id('Oba')] }, { wrestlers: [id('Trick')] }], prep: { event: mitb.id, kind: 'qualifier' } });
let r = M.moveEvent(st, mitb.id, { date: { year: 2026, month: 6, week: 1 }, day: 5 });
expect(mitb.at.week === 9 && r.removed === 0, `a week later (Saturday 6 July): its build-up is weeks 5–9 now; nothing in week 5 falls out (${r.removed} removed)`);
r = M.moveEvent(st, mitb.id, { date: { year: 2026, month: 4, week: 4 }, day: 6 });
expect(mitb.at.week === 4, 'four weeks earlier, Sunday 28 May: week 5 is after it now');
expect(!nxt5.matches.includes(q3), 'the unplayed, unlocked qualifier came off');
expect(raw5.matches.includes(q1) && q1.status === 'played', 'the played qualifier stays, result and all');
expect(sd5.matches.includes(q2) && q2.locked && q2.status === 'scheduled', 'the locked qualifier stays');
expect(M.validate(st).length === 0, 'the universe is consistent (validate)');

say('');
say(failed ? `${failed} check${failed === 1 ? '' : 's'} failed.` : 'A month is four weeks; the date moves on; the game decides.');
console.log(out.join('\n'));
process.exitCode = failed ? 1 : 0;
