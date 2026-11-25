// Turns saved StatsDeck payloads into the db documents the page reads, for seeding a fresh
// artifact or for the UI check. Usage:
//   node tools/run-ts.mjs tools/seed.ts <payloads.json> <out.json>
// payloads.json: { standings, trades, teams: { <team name>: <get_league_team / get_my_roster data> } }
import { readFileSync, writeFileSync } from 'node:fs';
import { buildLeague, tradesFromPayload } from '../src/core/statsdeck';
import { buildValuer } from '../src/core/model';
import { fitLearned } from '../src/core/trade';
import { takeSnapshot } from '../src/core/history';
import { emptySettings } from '../src/core/types';

const [inFile, outFile, myTeam = 'Jumpin’ Uncs'] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(inFile, 'utf8'));
const asOf = raw.standings?.freshness?.as_of ? new Date(raw.standings.freshness.as_of).toISOString() : new Date().toISOString();
const league = buildLeague({ data: raw.standings }, Object.values(raw.teams).map((d) => ({ data: d })), myTeam, asOf);
const trades = tradesFromPayload({ data: raw.trades }, league);
const settings = emptySettings();
const v = buildValuer(league, settings, fitLearned(league, settings, trades, new Date(asOf)));
const snap = takeSnapshot(v, asOf);
const docs: Record<string, unknown> = {
  'league/current': league,
  'league/settings': settings,
  [`history/${snap.date}`]: snap,
};
for (const t of trades) docs[`trades/${t.id}`] = t;
writeFileSync(outFile, JSON.stringify(docs));
for (const [k, d] of Object.entries(docs)) console.log(k, (JSON.stringify(d).length / 1024).toFixed(1) + ' KB');
