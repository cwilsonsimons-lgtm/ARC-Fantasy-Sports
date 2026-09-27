// Universe — a feud across several weeks, printed: the story director and the
// auto booker together, with the CPU deciding every match.
//
// Usage: node tools/universe-feud-demo.mjs [seed=7] [upsetWeek=6]     (npm run demo:feud)
//
// Takes the booking sample (universe-sample.mjs) and plays Raw forward from
// week 5 to week 9, Backlash included, the way the owner would: plan the show
// (the story director decides what happens before it), draft the card with
// the auto booker and book it as drafted, play it (a stand-in for WWE 2K25's
// CPU), enter the results (the director decides what happens after), and move
// on a week. It follows Cody and Gunther: a grudge over the World title.
//
// The stand-in CPU is plain: the side with the better record wins - except
// once. In `upsetWeek` - or the first show after it with a chapter of the feud
// on the card - the underdog wins that chapter,
// the way the CPU sometimes does; the owner enters it as it happened. What
// happens next is the point: the booker picks it up, and the feud goes on from
// there.
//
// Checked: the feud moved on through different kinds of match rather than
// the same one every week; no line-up from the feud came back the next week;
// the unexpected result changed the next card; story events the director made
// became reasons for matches; every result came from the stand-in CPU (the
// booker never picked one); and the universe is consistent.
import * as M from '../js/universe/model.js';
import * as B from '../js/universe/booker.js';
import * as SL from '../js/universe/storylines.js';
import * as DR from '../js/universe/director.js';
import { incidentText } from '../js/universe/ui.js';
import { bookingSample } from './universe-sample.mjs';

const [SEED = 7, UPSET_WEEK = 6] = process.argv.slice(2).map(Number);
const FEUD = ['Cody', 'Gunther'];          // the grudge over the World Heavyweight Championship
const { st } = bookingSample();
const out = [];
const say = (...x) => out.push(x.join(' '));
let failed = 0;
const expect = (ok, what) => { if (!ok) failed++; say(`   ${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const nm = id => M.wrestlerById(st, id).name;
const side = sd => (sd.team ? M.teamById(st, sd.team).name : sd.wrestlers.map(nm).join(' & '));
const line = m => `${m.sides.map(side).join(' vs ')}${m.titleId ? ` (${M.titleById(st, m.titleId).name})` : ''}${m.stip ? ` — ${m.stip}` : ''}`;
const who = m => m.sides.flatMap(sd => sd.wrestlers);

// the stand-in CPU: the better record wins; a title changes hands when its challenger wins
const rating = id => { const r = M.wrestlerRecord(st, id); const w = r.singles.w + r.tag.w, l = r.singles.l + r.tag.l; return (w + 1) / (w + l + 2); };
const strength = sd => sd.wrestlers.reduce((n, id) => n + rating(id), 0) / sd.wrestlers.length;
function play(ev, m, underdog) {
  const order = m.sides.map((sd, i) => ({ i, s: strength(sd) })).sort((a, b) => b.s - a.s || a.i - b.i);
  const winner = underdog ? order[order.length - 1].i : order[0].i;
  const loserSide = m.sides[order.find(o => o.i !== winner).i];
  const fall = m.sides[winner].wrestlers.length > 1 || loserSide.wrestlers.length > 1
    ? { by: [...m.sides[winner].wrestlers].sort((a, b) => rating(a) - rating(b))[0], on: [...loserSide.wrestlers].sort((a, b) => rating(b) - rating(a))[0] } : null;
  const reign = m.titleId && M.currentReign(st, m.titleId);
  const champIn = reign && m.sides[winner].wrestlers.some(id => (reign.holder.type === 'team' ? M.teamById(st, reign.holder.id).members : [reign.holder.id]).includes(id));
  const titleChange = !!m.titleId && !champIn && (m.sides[winner].wrestlers.length === 1 || !!m.sides[winner].team);
  M.enterResult(st, ev.id, m.id, { outcome: 'win', winner, fall }, { titleChange });
  return winner;
}
const storyNow = ev => M.allIncidents(st).filter(x => x.event.id === ev.id);

// the storyline to follow: the one that matters most on Raw going into week 5
M.setWeek(st, 5);
M.setStory(st, { on: true, pace: 'normal' });
M.seedStory(st, SEED);
const idOf = n => st.wrestlers.find(w => w.name === n).id;
const track = SL.storyOf(SL.storylines(st), idOf(FEUD[0]), idOf(FEUD[1]));
const [A, B2] = [track.a, track.b];
const inFeud = m => who(m).includes(A) || who(m).includes(B2);
say(`Following ${nm(A)} vs ${nm(B2)} — ${SL.storyText(st, track)}`);

let lastFeudLineups = [], upsetDone = null, adapted = null, fromDirector = 0, booked = 0, played = 0;
for (let week = 5; week <= 9; week++) {
  M.setWeek(st, week);
  const planned = st.events.filter(e => e.at.week === week && e.at.season === M.activeSeason(st).id);
  if (!planned.some(e => e.kind === 'weekly' && e.showId === 'raw')) M.addEvent(st, { showId: 'raw' });
  const shows = st.events.filter(e => e.at.week === week && e.at.season === M.activeSeason(st).id && (e.showId === 'raw'))
    .sort((a, b) => M.compareStamps(st, a.at, b.at));
  for (const ev of shows) {
    DR.tick(st);                                                    // before the show: the director, by itself
    say('');
    say(`${ev.name}`);
    storyNow(ev).filter(x => x.incident.phase === 'pre').forEach(x => say(`   before the show: ${incidentText(st, x.incident)}`));
    const l = SL.storyOf(SL.storylines(st, { at: ev.at }), A, B2);
    if (l) say(`   the feud going in: ${SL.STAGE_LABEL[l.stage]} · ${SL.storyText(st, l)}`);
    // the auto booker drafts; the owner books it as drafted
    const r = B.draftCard(st, ev.id);
    M.setDraft(st, ev.id, r.matches.map(B.toSpec), { seen: r.seen, played: r.played });
    const cards = M.bookDraft(st, ev.id);
    booked += cards.length;
    const feud = cards.filter(inFeud);
    // the feud's own chapter tonight: the match the booker drew for this storyline (the draft keeps card order)
    const chapter = cards.find((m, i) => r.matches[i] && r.matches[i].feud === track.key) || cards.find(m => who(m).includes(A) && who(m).includes(B2));
    feud.forEach(m => {
      say(`   drafted: ${line(m)}`);
      m.auto.why.slice(0, 4).forEach(w => say(`      · ${w}`));
      const director = m.auto.events.filter(id => M.allIncidents(st).some(x => x.incident.id === id && x.incident.story));
      if (director.length) fromDirector++;
    });
    if (!feud.length) say(`   drafted: nothing for the feud this time — ${nm(A)} and ${nm(B2)} sit this one out`);
    // the rest of the card that came out of the story
    cards.filter(m => !inFeud(m) && m.auto && m.auto.events.length).forEach(m => {
      say(`   also from the story: ${line(m)} — ${m.auto.why[0]}`);
      if (m.auto.events.some(id => M.allIncidents(st).some(x => x.incident.id === id && x.incident.story))) fromDirector++;
    });
    // the first matches after the upset: did the booker pick it up?
    if (upsetDone && !adapted && M.compareStamps(st, ev.at, upsetDone.ev.at) > 0) {
      const picked = w => new RegExp(`nobody saw it coming|Unfinished|wants it back|isn’t over|pinned|upset|beat ${nm(upsetDone.loser)}`).test(w);
      adapted = cards.find(m => who(m).some(id => upsetDone.people.includes(id)) && m.auto && m.auto.why.some(picked));
      if (adapted) say(`   → the upset, picked up: ${line(adapted)} — ${adapted.auto.why.find(picked)}`);
    }
    const thisWeek = feud.map(m => B.matchKey(m));
    expect(!thisWeek.some(k => lastFeudLineups.includes(k)), 'no line-up from the feud came back from last week');
    lastFeudLineups = thisWeek;
    // the CPU plays it
    cards.forEach(m => {
      const underdog = !upsetDone && week >= UPSET_WEEK && m === chapter;
      const w = play(ev, m, underdog);
      played++;
      if (underdog || inFeud(m)) {
        say(`   the CPU: ${side(m.sides[w])} won${m.fall ? ` — ${nm(m.fall.by)} pinned ${nm(m.fall.on)}` : ''}${underdog ? '   ← nobody saw that coming' : ''}`);
      }
      if (underdog) {
        const lost = m.sides.filter((_, i) => i !== w).flatMap(sd => sd.wrestlers).find(id => id === A || id === B2) || m.fall && m.fall.on;
        upsetDone = { ev, m, loser: lost, people: who(m) };
      }
    });
    DR.tick(st);                                                    // after the show: the director again
    storyNow(ev).filter(x => x.incident.phase === 'post').forEach(x => say(`   after the show: ${incidentText(st, x.incident)}`));
  }
}

say('');
const end = SL.storyOf(SL.storylines(st), A, B2);
say(`${nm(A)} vs ${nm(B2)}, the whole way: ${end ? SL.storyText(st, end) : 'over'}`);
(end ? end.beats : []).filter(b => b.wk >= 5 || b.kind !== 'match').forEach(b => say(`   week ${b.wk}: ${b.kind === 'match' ? `${SL.FORMAT_LABEL[b.format]} — ` : ''}${b.text}`));
const formats = new Set((end ? end.beats : []).filter(b => b.kind === 'match' && b.wk >= 5).map(b => b.format));
expect(formats.size >= 2, `the feud moved on in different ways: ${[...formats].map(f => SL.FORMAT_LABEL[f]).join(', ')}`);
expect(!!upsetDone, 'the CPU handed the feud’s match to the underdog once');
// (another seed tells another story: a truce first leaves nothing to pick up, and the director may make nothing that calls for a match)
const truce = end && upsetDone && end.beats.find(b => b.kind === 'truce' && M.compareStamps(st, b.ev.at, upsetDone.ev.at) <= 0);
expect(!!adapted || !!truce, adapted ? 'a card after it picked up the unexpected result' : 'the feud was settled by a truce before the upset — nothing to pick up');
// only what happened in time for a later card: not what followed the last show
const lastShow = st.events.filter(e => e.showId === 'raw').sort((x, y) => M.compareStamps(st, x.at, y.at)).pop();
const calls = M.allIncidents(st).filter(x => x.incident.story && !(x.event === lastShow && x.incident.phase === 'post')
  && ['attack', 'betrayal', 'brawl', 'confrontation', 'challenge', 'demand', 'save', 'interference'].includes(x.incident.kind));
expect(fromDirector > 0 || calls.length === 0, 'story events the director made became reasons for matches');
expect(played === booked && st.events.every(e => e.matches.every(m => m.status === 'played')), 'every result came from the CPU stand-in, after booking');
expect(M.validate(st).length === 0, 'the universe is consistent (validate)');

console.log(out.join('\n'));
console.log(failed ? `\n${failed} check(s) failed` : '\nThe story director tells it, the booker follows it, the CPU decides it.');
process.exit(failed ? 1 : 0);
