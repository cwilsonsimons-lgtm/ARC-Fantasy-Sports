// Universe — a fourth tier, from nothing, printed.
//
// Usage: node tools/universe-tiers-demo.mjs      (npm run demo:tiers)
//
// Shows that a tier below Evolve works without any code of its own: it's
// added, given a show and rules - the same way the Tiers & transfers screen
// does it - and then a season plays through the same engine that runs Raw,
// SmackDown and Dynamite ⇄ NXT: relegation matches on Evolve send a loser down
// to the new tier, a qualifying match and a championship on the new tier make
// wrestlers draft eligible, and the draft moves them up with the title handled
// by the connection's rule. Results stand in for what WWE 2K25's CPU decides.
// Every step is checked, and the universe is validated at the end.
import * as M from '../js/universe/model.js';
import { exportUniverse } from '../js/universe/persist.js';

const st = M.createUniverse();
const out = [];
const say = (...x) => out.push(x.join(' '));
const name = id => M.wrestlerById(st, id).name;
const show = id => M.showById(st, id).name;
const S = (...ids) => ids.map(id => ({ wrestlers: [id] }));
let failed = 0;
const expect = (ok, what) => { if (!ok) failed++; say(`   ${ok ? 'ok  ' : 'FAIL'} ${what}`); };

// 1. the fourth tier: added at the bottom, a show put in it, and rules for its connection to Evolve
const t4 = M.addTier(st, { name: 'Indies' });
const lfg = M.addShow(st, { name: 'LFG', day: 3, tier: t4.id });
const link = M.linkBetween(st, 'tier-evolve', t4.id);
say('Tiers, top down:');
st.tiers.forEach((t, i) => say(`   Tier ${i + 1} · ${t.name}: ${t.shows.map(show).join(', ') || '—'}`));
say(`A new connection starts with everything off: relegation ${link.rules.relegation.on ? 'on' : 'off'}, qualifiers ${link.rules.qualifiers.on ? 'on' : 'off'}.`);
M.setLinkRules(st, link.id, { relegation: { on: true, candidates: 2 }, qualifiers: { on: true }, champions: 'eligible', titles: 'vacate' });
say('Evolve ⇄ Indies rules set: 2 relegation candidates on Evolve, losers down to LFG right away; qualifying matches on LFG;');
say('LFG champions draft eligible; a title is vacated when its holder moves up; drafted up to Evolve.');

// 2. a season: Evolve and LFG wrestlers, a few results, WrestleMania
const add = (n, s) => M.addWrestler(st, { name: n, showId: s }).id;
const [E1, E2, E3] = ['Kali Armstrong', 'Jackson Drake', 'Keanu Carver'].map(n => add(n, 'evolve'));
const [L1, L2, L3, LC] = ['Rookie One', 'Rookie Two', 'Rookie Three', 'Indie Champ'].map(n => add(n, lfg.id));
const belt = M.addTitle(st, { name: 'LFG Championship', showId: lfg.id });
M.setChampion(st, belt.id, { type: 'wrestler', id: LC });
M.setWeek(st, 2);
const ep = M.addEvent(st, { showId: 'evolve' });
M.recordMatch(st, ep.id, { sides: S(E3, E1), winner: 0 });
M.setWeek(st, 4);
const wm = M.addEvent(st, { kind: 'ple', name: 'WrestleMania', week: 4 });
const tr = M.startTransition(st, wm.id);
say('');
say(`${wm.name} starts the season transition. Its connections, as they stand now:`);
tr.parts.forEach(p => say(`   ${p.lowerName} → ${p.upperName}${M.pendingRules(p.rules).length ? ` (not carried out yet: ${M.pendingRules(p.rules).join('; ')})` : ''}`));
expect(tr.parts.length === 3, 'three connections, the new one included');

// 3. relegation on Evolve: the fewest wins face each other, the loser goes down to LFG
const t = M.relegationTable(st, tr.id, 'evolve');
say('');
say(`Evolve's relegation candidates (fewest wins): ${t.candidates.map(name).join(' vs ')} — losers go to ${t.to.name}.`);
M.setWeek(st, 5);
const night = M.addEvent(st, { showId: 'evolve', week: 5 });
const [rm] = M.bookRelegation(st, tr.id, 'evolve', night.id);
M.enterResult(st, night.id, rm.id, { outcome: 'win', winner: 0 });
const down = st.relegations.find(r => r.show === 'evolve');
say(`   ${name(down.opponent)} wins; ${name(down.wrestler)} moves ${show('evolve')} → ${show(M.wrestlerById(st, down.wrestler).showId)}.`);
say(`   Kept for good: "${down.reason}"`);
expect(M.wrestlerById(st, down.wrestler).showId === lfg.id && down.to === lfg.id, 'the loser is on LFG, and the record says so');

// 4. LFG's qualifier, and its champion, at the transfer window
M.setQualifiers(st, tr.id, [L1, L2]);
const lfgNight = M.addEvent(st, { showId: lfg.id, week: 5 });
const [q] = M.bookQualifiers(st, tr.id, lfgNight.id);
M.enterResult(st, lfgNight.id, q.id, { outcome: 'win', winner: 0 });
M.openWindow(st, tr.id);
const elig = M.promotionTable(st, tr.id, link.id).eligible;
say('');
say(`LFG qualifier: ${name(L1)} beats ${name(L2)}. The transfer window opens. Draft eligible from LFG:`);
elig.forEach(e => say(`   ${name(e.wrestler)} — ${e.sources.map(x => x.source).join(', ')}`));
expect(elig.length === 2, 'the qualifier winner and the LFG champion are eligible');

// 5. the draft: up to Evolve only, and the title follows the rule without asking
const opts = M.draftOptions(st, tr.id, LC);
let refused = '';
try { M.draftWrestler(st, tr.id, LC, 'nxt'); } catch (e) { refused = e.message; }
const [pick] = M.draftWrestler(st, tr.id, LC, 'evolve');
say('');
say(`Drafting ${name(LC)}: can go to ${opts.shows.map(show).join(', ')}. (To NXT? "${refused}")`);
say(`   Pick ${pick.pick}: ${name(LC)} ${show(pick.from)} → ${show(pick.to)}; the ${belt.name} ${pick.titles[0].choice} by the rule.`);
expect(M.currentReign(st, belt.id) === null, `the ${belt.name} is vacant — a clear status after its holder moved`);
M.closeWindow(st, tr.id);
say(`   The window closes; left undrafted: ${tr.window.undrafted.map(name).join(', ') || 'nobody'}.`);
expect(M.wrestlerById(st, L3).showId === lfg.id, `${name(L3)} never left LFG`);

// 6. sound, and it survives a save and load
expect(M.validate(st).length === 0, 'the universe is consistent (validate)');
expect(M.validate(M.migrate(JSON.parse(exportUniverse(st)))).length === 0, 'and survives a save and load');
say('');
say(failed ? `${failed} check(s) failed.` : 'A fourth tier: no code of its own — just a tier, a show and rules.');
console.log(out.join('\n'));
if (failed) process.exitCode = 1;
