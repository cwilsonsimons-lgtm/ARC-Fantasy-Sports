// Universe — the auto booker, a week of drafts printed.
//
// Usage: node tools/universe-booker-demo.mjs      (npm run demo:booker)
//
// Takes the booking sample (universe-sample.mjs) - week 5 to book on Raw,
// SmackDown, Dynamite, NXT and Evolve, plus LFG, a show added later - and
// drafts every show's card the way "Draft this week's cards" does, then
// Backlash, Raw's premium live event two weeks on. Each match is printed with
// why it was chosen. Then the owner's side: a match changed, one drawn again,
// one taken off, one of their own added, the rest drawn again, and the card
// booked. Every step is checked: nobody twice, nobody injured or away, no
// result anywhere, the booked card exactly the draft, the universe sound.
import * as M from '../js/universe/model.js';
import * as B from '../js/universe/booker.js';
import { bookingSample } from './universe-sample.mjs';

const { st, id, backlash } = bookingSample();
const out = [];
const say = (...x) => out.push(x.join(' '));
let failed = 0;
const expect = (ok, what) => { if (!ok) failed++; say(`   ${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const nm = x => M.wrestlerById(st, x).name;
const sideName = sd => (sd.team ? M.teamById(st, sd.team).name : sd.wrestlers.map(nm).join(' & '));
const line = m => `${m.sides.map(sideName).join(' vs ')}${m.titleId ? ` — ${M.titleById(st, m.titleId).name}` : ''}${m.stip ? ` (${m.stip})` : ''}`;
const who = m => m.sides.flatMap(sd => sd.wrestlers);
const printCard = (ev, matches) => matches.forEach((m, i) => {
  say(`   ${i + 1}. ${line(m)}${m.notes ? `  [${m.notes}]` : ''}`);
  say(`      why: ${m.why[0]}`);
  m.why.slice(1, 3).forEach(w => say(`           ${w}`));
});
const results = () => st.events.reduce((n, e) => n + e.matches.filter(m => m.status === 'played').length, 0);
const played = results();

say('Week 5 — a draft card for every show');
st.shows.forEach(sh => {
  const ev = M.addEvent(st, { showId: sh.id });
  const r = B.draftCard(st, ev.id);
  M.setDraft(st, ev.id, r.matches.map(B.toSpec));
  const tier = st.tiers.findIndex(t => t.shows.includes(sh.id));
  say('');
  say(`${ev.name}  (tier ${tier + 1}, ${M.cardSize(st, ev)}-match card)${r.short ? ` — ${r.short}` : ''}`);
  printCard(ev, r.matches);
  const ids = r.matches.flatMap(who);
  expect(new Set(ids).size === ids.length && ids.every(x => M.wrestlerById(st, x).status === 'active' && M.wrestlerById(st, x).showId === sh.id),
    'nobody twice; only the show’s own roster, nobody injured or away');
});

say('');
const ple = B.draftCard(st, backlash.id);
say(`${backlash.name}  (premium live event, ${M.cardSize(st, backlash)}-match card)${ple.short ? ` — ${ple.short}` : ''}`);
printCard(backlash, ple.matches);
expect(ple.matches.filter(m => m.titleId).length === 3, 'every Raw title with a contender is on the line');

// the owner's side, on Raw
const raw = st.events.find(e => e.showId === 'raw' && e.kind === 'weekly' && e.at.week === 5);
const d = () => M.eventById(st, raw.id).draft;
say('');
say('Raw, the owner’s changes:');
const first = d().matches[0];
M.editDraftMatch(st, raw.id, first.id, { stip: 'Ladder' });
say(`   changed match 1 to a Ladder match: ${line(d().matches[0])}`);
const gone = d().matches[3];
M.deleteDraftMatch(st, raw.id, gone.id);
say(`   took off: ${line(gone)}`);
const again = B.redrawOne(st, raw.id, d().matches[2].id);
const old = d().matches[2];
if (again) M.redrawDraftMatch(st, raw.id, old.id, B.toSpec(again));
say(`   drew match 3 again: ${line(old)}  →  ${again ? `${line(again)} (${again.why[0]})` : 'nothing else fits'}`);
M.addDraftMatch(st, raw.id, { sides: [{ wrestlers: [id('Liv')] }, { wrestlers: [id('Iyo')] }], notes: 'My pick' });
say('   added their own: Liv vs Iyo');
const r = B.redraft(st, raw.id);
M.setDraft(st, raw.id, r.list, { nonce: r.nonce });
expect(d().matches.some(m => m.id === first.id && m.stip === 'Ladder') && d().matches.some(m => !m.auto), 'drawing the rest again kept the changed match and their own');
expect(!d().matches.some(m => m.auto && m.auto.key === gone.auto.key), 'the match taken off didn’t come back');
const draft = JSON.parse(JSON.stringify(d().matches));
const made = M.bookDraft(st, raw.id);
say('   booked:');
made.forEach((m, i) => say(`   ${i + 1}. ${line(m)}${m.auto ? `${m.auto.edited ? ' (changed by the owner)' : ''} — ${m.auto.why[0]}` : ' (the owner’s own)'}`));
expect(made.every((m, i) => JSON.stringify([m.sides, m.titleId, m.stip, m.notes]) === JSON.stringify([draft[i].sides, draft[i].titleId, draft[i].stip, draft[i].notes])),
  'the card is exactly the draft');
expect(made.every(m => m.status === 'scheduled' && m.outcome === null && m.winner === null) && results() === played, 'no result anywhere — the game decides');
expect(M.validate(st).length === 0, 'the universe is consistent (validate)');

console.log(out.join('\n'));
console.log(failed ? `\n${failed} check(s) failed` : '\nThe booker drafts; the owner decides; the game plays.');
process.exit(failed ? 1 : 0);
