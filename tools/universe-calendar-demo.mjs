// A month on the universe calendar, from the first Monday to the last Sunday,
// and on into the next: every show's episode on its night, drafted by the
// auto booker and booked; results entered as the game would give them (the
// first side wins - this is a stand-in for the owner, not the app deciding);
// the Royal Rumble on its annual date, built toward from three weeks out;
// then Next week, into February - where nothing gets a result it wasn't given,
// and the Elimination Chamber's qualifiers begin. Last, the Chamber is
// rescheduled: its build-up follows, and a result and a locked match stay.
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
M.setCalendar(st, { month: 0, year: 2026 });                         // it began in January 2026
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

// ---------------------------------------------------------------- January: a complete four-week month
say('January 2026 — four weeks, Monday to Sunday, days 1 to 28');
runWeek(1);
const rumble = st.events.find(e => e.name === 'Royal Rumble');
expect(rumble && rumble.recurring && `${M.DAYS[rumble.at.day]} ${date(rumble.at.week, rumble.at.day).date}` === 'Saturday 27' && rumble.at.week === 4,
  'the Royal Rumble is on the calendar on its annual date: Saturday 27 January, week 4');
const ahead = M.approaching(st, { season: season.id, week: 1, day: 0 }, ['raw']);
expect(ahead.length && ahead[0].event === rumble && ahead[0].weeks === 3,
  `week 1 is already building toward it: ${ahead.map(x => `${x.event.name} in ${x.weeks} weeks (${x.phases.map(p => p.focus).join(', ')})`).join('; ')}`);
runWeek(2);
runWeek(3);
// week 4: SmackDown's card stays unplayed, and only half the Rumble's results are in
runWeek(4, { hold: ['SmackDown · Week 4', 'Royal Rumble'] });
enter(rumble, Math.ceil(rumble.matches.length / 2));

const evs = M.eventsIn(st, season.id);
const cell = (w, day) => {
  const here = evs.filter(e => e.at.week === w && e.at.day === day);
  const d = date(w, day).date;
  return `${String(d).padStart(2)} ${here.map(e => `${M.isBigEvent(e) ? '★' : ''}${M.isBigEvent(e) ? e.name : (M.showById(st, e.showId) || { name: '?' }).name.slice(0, 3)}${MARK[M.eventStatus(e)]}`).join(' ')}`.padEnd(24);
};
say(`        ${M.DAYS.map(d => d.slice(0, 3).padEnd(24)).join('')}`);
for (let w = 1; w <= 4; w++) say(`   W${w}   ${M.DAYS.map((_, day) => cell(w, day)).join('')}`);
say('   ○ scheduled   ◐ in progress   ● completed');
const month = evs.filter(e => e.at.week <= 4);
expect([1, 2, 3, 4].every(w => ['raw', 'smackdown', 'dynamite', 'nxt', 'evolve'].every(s => month.some(e => e.at.week === w && e.showId === s && e.kind === 'weekly'))),
  `every show's episode in each of the four weeks — ${month.length} events in January`);
expect(month.every(e => { const u = M.stampDate(st, e.at); return u.month === 0 && u.year === 2026 && u.date >= 1 && u.date <= 28; }),
  'every one of them falls on a day 1–28 of January 2026');
const st4 = n => M.eventStatus(evs.find(e => e.name === n));
expect(st4('Raw · Week 4') === 'completed' && st4('SmackDown · Week 4') === 'scheduled' && st4('Royal Rumble') === 'in-progress',
  'Raw week 4 completed, SmackDown week 4 scheduled (booked, no results), the Royal Rumble in progress');

// ---------------------------------------------------------------- Next week: into February
say('');
say('Next week → February 2026');
const before = played();
const waiting = evs.flatMap(e => e.matches.filter(m => m.status === 'scheduled').map(m => m.id));
runWeek(5, { results: false });
const feb = date(5, 0);
expect(feb.month === 1 && feb.week === 1 && feb.date === 1 && feb.year === 2026, `week 5 is ${M.MONTHS[feb.month]} ${feb.year}, week ${feb.week}: Monday the ${feb.date}st`);
expect(date(4, 6).date === 28 && date(5, 0).date === 1, 'Sunday 28 January, then Monday 1 February — no 29th, 30th or 31st');
expect(played() === before, `moving the date on entered no result (${before} results before and after)`);
expect(waiting.every(mid => st.events.some(e => e.matches.some(m => m.id === mid && m.status === 'scheduled'))),
  `the ${waiting.length} matches still waiting for the game are still waiting`);
const chamber = st.events.find(e => e.name === 'Elimination Chamber');
expect(chamber && chamber.at.week === 8 && date(8, chamber.at.day).date === 27, 'the Elimination Chamber: Saturday 27 February, week 8');
const raw5 = M.eventsIn(st, season.id).find(e => e.name === 'Raw · Week 5');
const quals = raw5.matches.filter(m => m.prep && m.prep.event === chamber.id && m.prep.kind === 'qualifier');
say(`   Raw, Monday 1 February: ${raw5.matches.map(m => `${line(m)}${m.prep ? ` [${m.prep.kind} · ${m.prep.name}]` : ''}`).join(' · ')}`);
expect(quals.length >= 1, `the booker builds toward the Chamber: ${quals.length} qualifying match${quals.length === 1 ? '' : 'es'} on Raw`);
expect(raw5.matches.every(m => m.status === 'scheduled'), 'and nothing on it has a result');

// ---------------------------------------------------------------- rescheduling the Chamber
say('');
say('The Elimination Chamber moves a week later, then three weeks earlier');
const q1 = quals[0];
enter(raw5, 0);
M.enterResult(st, raw5.id, q1.id, { outcome: 'win', winner: 0 });         // one qualifier played...
const sd5 = M.eventsIn(st, season.id).find(e => e.name === 'SmackDown · Week 5');
const q2 = sd5.matches.find(m => m.prep && m.prep.kind === 'qualifier') || M.bookMatch(st, sd5.id,
  { sides: [{ wrestlers: [id('Bron')] }, { wrestlers: [id('Carmelo')] }], prep: { event: chamber.id, kind: 'qualifier' } });
M.setMatchLocked(st, sd5.id, q2.id, true);                                   // ...and one locked by the owner
const nxt5 = M.eventsIn(st, season.id).find(e => e.name === 'NXT · Week 5');
const q3 = M.bookMatch(st, nxt5.id, { sides: [{ wrestlers: [id('Oba')] }, { wrestlers: [id('Trick')] }], prep: { event: chamber.id, kind: 'qualifier' } });
let r = M.moveEvent(st, chamber.id, { date: { year: 2026, month: 2, week: 1 }, day: 5 });
expect(chamber.at.week === 9 && r.removed === 0, `a week later (Saturday 6 March): its build-up is weeks 5–9 now; nothing in week 5 falls out (${r.removed} removed)`);
r = M.moveEvent(st, chamber.id, { date: { year: 2026, month: 0, week: 4 }, day: 6 });
expect(chamber.at.week === 4, 'three weeks earlier, Sunday 28 January: week 5 is after it now');
expect(!nxt5.matches.includes(q3), 'the unplayed, unlocked qualifier came off');
expect(raw5.matches.includes(q1) && q1.status === 'played', 'the played qualifier stays, result and all');
expect(sd5.matches.includes(q2) && q2.locked && q2.status === 'scheduled', 'the locked qualifier stays');
expect(M.validate(st).length === 0, 'the universe is consistent (validate)');

say('');
say(failed ? `${failed} check${failed === 1 ? '' : 's'} failed.` : 'A month is four weeks; the date moves on; the game decides.');
console.log(out.join('\n'));
process.exitCode = failed ? 1 : 0;
