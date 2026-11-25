import { describe, expect, it } from 'vitest';
import { buildValuer, modelPlayerValue, retention, seasonsLeft, toScale, assetName } from '../src/core/model';
import { balance, buyers, findOffers, fitLearned, packageValue, readTrade } from '../src/core/trade';
import { parseMarket, normName } from '../src/core/ktc';
import { buildLeague, tradesFromPayload } from '../src/core/statsdeck';
import { rebuildFromGames, series, takeSnapshot } from '../src/core/history';
import { emptyLearned, emptySettings, type League, type Player, type TradeLog } from '../src/core/types';

const P = (id: string, name: string, pos: Player['pos'], age: number, form: number, trend = 0, extra: Partial<Player> = {}): Player => ({
  id,
  name,
  pos,
  age,
  nfl: 'X',
  rookie: false,
  form,
  base: +(form / (1 + trend)).toFixed(2),
  trend,
  slot: 'bench',
  ...extra,
});

function fixture(): League {
  const players = [
    // me (1): rebuilding-ish, deep at RB
    P('p:warren', 'Jaylen Warren', 'RB', 28, 11, -0.2),
    P('p:rb2', 'Old Back', 'RB', 30, 14),
    P('p:rb3', 'Young Back', 'RB', 23, 9),
    P('p:qb1', 'My Qb', 'QB', 26, 24),
    P('p:wr1', 'My Wideout', 'WR', 25, 15),
    P('p:te1', 'My End', 'TE', 26, 10),
    // Jake (5): contender, thin at RB, owns the hot rookie
    P('p:emmett', 'Emmett Johnson', 'RB', 23, 18.4, 0.45, { rookie: true }),
    P('p:jqb', 'Jake Qb', 'QB', 29, 26),
    P('p:jwr', 'Jake Wideout', 'WR', 26, 20),
    P('p:jwr2', 'Jake Wideout Two', 'WR', 27, 17),
    P('p:jte', 'Jake End', 'TE', 27, 14),
    // Other (2): stacked at RB
    P('p:orb1', 'Other Back', 'RB', 24, 22),
    P('p:orb2', 'Other Back Two', 'RB', 25, 18),
    P('p:oqb', 'Other Qb', 'QB', 24, 20),
    P('p:owr', 'Other Wideout', 'WR', 24, 13),
  ];
  const owner: Record<string, string> = {};
  for (const p of players) owner[p.id] = p.id.startsWith('p:j') || p.id === 'p:emmett' ? '5' : p.id.startsWith('p:o') ? '2' : '1';
  const picks = {
    'k:2027-1-1': { id: 'k:2027-1-1', season: 2027, round: 1, orig: '1' },
    'k:2027-2-1': { id: 'k:2027-2-1', season: 2027, round: 2, orig: '1' },
    'k:2027-1-5': { id: 'k:2027-1-5', season: 2027, round: 1, orig: '5' },
    'k:2028-1-2': { id: 'k:2028-1-2', season: 2028, round: 1, orig: '2' },
  };
  owner['k:2027-1-1'] = '1';
  owner['k:2027-2-1'] = '1';
  owner['k:2027-1-5'] = '5';
  owner['k:2028-1-2'] = '2';
  return {
    name: 'Test League',
    asOf: '2026-11-25T00:00:00Z',
    season: 2027,
    teams: [
      { id: '5', name: 'Dakyard Football', wins: 17, losses: 5, standing: 1 },
      { id: '2', name: 'Other', wins: 11, losses: 11, standing: 2 },
      { id: '1', name: 'Jumpin Uncs', wins: 5, losses: 17, standing: 3, me: true },
    ],
    players: Object.fromEntries(players.map((p) => [p.id, p])),
    picks,
    owner,
  };
}

describe('market value', () => {
  it('ages out by position', () => {
    expect(retention('RB', 25)).toBe(1);
    expect(retention('RB', 29)).toBeLessThan(retention('WR', 29));
    expect(retention('QB', 33)).toBeGreaterThan(retention('RB', 33));
    expect(seasonsLeft('RB', 23)).toBeGreaterThan(seasonsLeft('RB', 28));
  });
  it('stays on the 0-10,000 scale', () => {
    expect(toScale(0)).toBe(0);
    expect(toScale(1e6)).toBe(10000);
    expect(toScale(23)).toBeGreaterThan(6000);
  });
  it('rates the hot rookie above the 28-year-old in a slump', () => {
    const L = fixture();
    expect(modelPlayerValue(L.players['p:emmett'])).toBeGreaterThan(modelPlayerValue(L.players['p:warren']) + 1500);
  });
  it('a hot streak only moves the market halfway', () => {
    const e = fixture().players['p:emmett'];
    const hot = modelPlayerValue(e, 1);
    const cold = modelPlayerValue(e, 0);
    const mkt = modelPlayerValue(e);
    expect(hot).toBeGreaterThan(mkt);
    expect(cold).toBeLessThan(mkt);
  });
  it('names picks by projected slot', () => {
    const L = fixture();
    expect(assetName(L, 'k:2027-1-1')).toBe('2027 Early 1st');
    expect(assetName(L, 'k:2027-1-5')).toBe('2027 Late 1st');
    expect(assetName(L, 'k:2028-1-2')).toBe('2028 1st');
  });
});

describe('each team sees its own value', () => {
  const L = fixture();
  const v = buildValuer(L, emptySettings(), emptyLearned());
  it('the owner of a hot player values him above the market, and above everyone else', () => {
    const m = v.market('p:emmett');
    expect(v.value('5', 'p:emmett')).toBeGreaterThan(m);
    expect(v.value('5', 'p:emmett')).toBeGreaterThan(v.value('1', 'p:emmett'));
    expect(v.value('5', 'p:emmett')).toBeGreaterThan(v.value('2', 'p:emmett'));
  });
  it('I see my own player without the owner bump', () => {
    expect(v.explain('1', 'p:warren').endowment).toBe(1);
    expect(v.explain('5', 'p:emmett').endowment).toBeGreaterThan(1);
  });
  it('a team thin at a position pays more for it than a team stacked there', () => {
    expect(v.ctx['5'].ratio.RB).toBeLessThan(v.ctx['2'].ratio.RB);
    expect(v.explain('5', 'p:rb2').need).toBeGreaterThan(v.explain('2', 'p:rb2').need);
  });
  it('contenders pay for veterans, rebuilders for picks', () => {
    expect(v.ctx['5'].window).toBeGreaterThan(0);
    expect(v.ctx['1'].window).toBeLessThan(0);
    expect(v.explain('5', 'k:2027-1-1').window).toBeLessThan(1);
    expect(v.explain('1', 'k:2027-1-5').window).toBeGreaterThan(1);
    expect(v.explain('5', 'p:rb2').window).toBeGreaterThan(v.explain('1', 'p:rb2').window);
  });
  it('manual nudges apply to one team only', () => {
    const s = emptySettings();
    s.nudges.push({ team: '2', asset: 'p:warren', pct: 0.25 });
    const v2 = buildValuer(L, s, emptyLearned());
    expect(v2.value('2', 'p:warren')).toBeCloseTo(v.value('2', 'p:warren') * 1.25, -1);
    expect(v2.value('5', 'p:warren')).toBe(v.value('5', 'p:warren'));
  });
  it('market overrides replace the model', () => {
    const s = emptySettings();
    s.market['p:warren'] = 6100;
    expect(buildValuer(L, s, emptyLearned()).market('p:warren')).toBe(6100);
  });
});

describe('trades', () => {
  const L = fixture();
  const settings = emptySettings();
  it('consolidation: one great player beats two good ones of the same total', () => {
    expect(packageValue([8000])).toBeGreaterThan(packageValue([4500, 4500]));
    expect(packageValue([4500, 4500])).toBeGreaterThan(4500);
  });
  it('Jake says no to Warren for Emmett', () => {
    const v = buildValuer(L, settings, emptyLearned());
    const r = readTrade(v, { team: '5', give: ['p:emmett'], get: ['p:warren'] });
    expect(r.p).toBeLessThan(0.1);
  });
  it('a rejection teaches the desk that team values what it kept more', () => {
    const v0 = buildValuer(L, settings, emptyLearned());
    // Find a near-fair offer for Emmett first, so the "no" actually carries information.
    const offer = { team: '5', give: ['p:emmett'], get: ['p:warren', 'k:2027-2-1', 'p:rb3'] };
    const before = readTrade(v0, offer);
    const log: TradeLog = { id: 't1', ts: '2026-11-24T00:00:00Z', team: '5', with: '1', give: offer.give, get: offer.get, outcome: 'rejected', source: 'manual' };
    const learned = fitLearned(L, settings, [log], new Date('2026-11-25T00:00:00Z'));
    const v1 = buildValuer(L, settings, learned);
    const after = readTrade(v1, offer);
    expect(after.p).toBeLessThan(before.p);
    expect(v1.value('5', 'p:emmett')).toBeGreaterThan(v0.value('5', 'p:emmett'));
    expect(v1.value('5', 'p:warren')).toBeLessThan(v0.value('5', 'p:warren'));
    // Other teams are untouched.
    expect(v1.value('2', 'p:emmett')).toBe(v0.value('2', 'p:emmett'));
    // And forgetting the log forgets the lesson.
    const v2 = buildValuer(L, settings, fitLearned(L, settings, [], new Date()));
    expect(v2.value('5', 'p:emmett')).toBe(v0.value('5', 'p:emmett'));
  });
  it('an old rejection counts for less than a fresh one', () => {
    const offer = { give: ['p:emmett'], get: ['p:warren', 'k:2027-2-1', 'p:rb3'] };
    const mk = (ts: string): TradeLog => ({ id: ts, ts, team: '5', with: '1', ...offer, outcome: 'rejected', source: 'manual' });
    const now = new Date('2026-11-25T00:00:00Z');
    const fresh = fitLearned(L, settings, [mk('2026-11-24T00:00:00Z')], now).asset['5']?.['p:emmett'] ?? 0;
    const old = fitLearned(L, settings, [mk('2026-06-01T00:00:00Z')], now).asset['5']?.['p:emmett'] ?? 0;
    expect(fresh).toBeGreaterThan(0.02);
    expect(fresh).toBeGreaterThan(old);
  });
  it('a completed trade teaches both sides', () => {
    const log: TradeLog = { id: 's1', ts: '2026-11-20T00:00:00Z', team: '2', with: '5', give: ['p:orb2'], get: ['p:jwr2', 'k:2027-1-5'], outcome: 'completed', source: 'sleeper' };
    const learned = fitLearned(L, settings, [log], new Date('2026-11-25T00:00:00Z'));
    expect(learned.observations).toBe(2);
    expect(Object.keys(learned.asset)).toEqual(expect.arrayContaining(['2', '5']));
  });
  it('finds offers they would likely take, cheapest for me first', () => {
    const v = buildValuer(L, settings, emptyLearned());
    const offers = findOffers(v, '5', ['p:emmett'], { minP: 0.5 });
    expect(offers.length).toBeGreaterThan(0);
    for (const o of offers) expect(o.them.p).toBeGreaterThanOrEqual(0.5);
    for (let i = 1; i < offers.length; i++) expect(offers[i - 1].mine.edge).toBeGreaterThanOrEqual(offers[i].mine.edge);
  });
  it('balance suggests an add when the deal is short', () => {
    const v = buildValuer(L, settings, emptyLearned());
    const fixes = balance(v, { team: '5', give: ['p:emmett'], get: ['p:warren'] });
    expect(fixes.every((f) => f.kind === 'add' && f.read.p >= 0.6)).toBe(true);
  });
  it('lists who values my players most', () => {
    const v = buildValuer(L, settings, emptyLearned());
    const b = buyers(v);
    expect(b.length).toBe(8);
    for (const x of b) expect(x.best[0].value).toBeGreaterThanOrEqual(x.best[x.best.length - 1].value);
  });
});

describe('KeepTradeCut paste', () => {
  const L = fixture();
  it('reads the rankings page laid out a field per line', () => {
    const text = ['1', 'Emmett Johnson', 'KC', 'RB3', '23.4 y.o.', '7,412', '2', 'Jaylen Warren', 'PIT', 'RB31', '28.1 y.o.', '3901'].join('\n');
    const r = parseMarket(text, L);
    expect(r.values['p:emmett']).toBe(7412);
    expect(r.values['p:warren']).toBe(3901);
  });
  it('reads one player per line and picks', () => {
    const text = '14 Emmett Johnson KC RB 23.4 7400\n2027 Early 1st 6950\n2027 Mid 1st 5900\n2027 Late 2nd 2500';
    const r = parseMarket(text, L);
    expect(r.values['p:emmett']).toBe(7400);
    expect(r.values['k:2027-1-1']).toBe(6950);
    expect(r.values['k:2027-2-1']).toBe(2500);
  });
  it('normalizes names', () => {
    expect(normName('Marvin Harrison Jr.')).toBe('marvin harrison');
    expect(normName("Ja'Marr Chase")).toBe('jamarr chase');
  });
});

describe('StatsDeck import', () => {
  const row = (id: string, name: string, pos: string, form: number, delta = 0) => ({
    source_id: id,
    name,
    position: pos,
    age: 25,
    nfl_team: 'KC',
    is_rookie: false,
    _form: { form_score: form, weighting_basis: { games: 10 } },
    _trajectory: { delta },
  });
  const standings = {
    data: {
      connection: { league_name: 'City Boys Dynasty' },
      standings: [
        { team_name: 'A', record_display: '9-1', standing: '1st of 2' },
        { team_name: 'B', record_display: '1-9', standing: '2nd of 2' },
      ],
      strength: { teams: [{ team_id: 7, team_name: 'A' }, { team_id: 3, team_name: 'B' }] },
    },
  };
  const rosterA = { data: { team_id: 7, team_name: 'A', starters: [row('11', 'Hot Hand', 'RB', 18, 0.5)], bench: [], owned_picks: [{ season: '2027', round: 1, original_owner: 'B' }] } };
  const rosterB = { data: { team_name: 'B', starters: [row('22', 'Steady', 'WR', 12)], reserve: [row('23', 'Hurt', 'TE', 8)] } };
  it('builds teams, players, picks and owners', () => {
    const L = buildLeague(standings, [rosterA, rosterB], 'B', '2026-11-25T00:00:00Z');
    expect(L.name).toBe('City Boys Dynasty');
    expect(L.teams.find((t) => t.me)?.id).toBe('3');
    expect(L.owner['p:11']).toBe('7');
    expect(L.owner['p:23']).toBe('3');
    expect(L.players['p:23'].slot).toBe('ir');
    expect(L.players['p:11'].base).toBe(12);
    expect(L.owner['k:2027-1-3']).toBe('7');
    expect(L.season).toBe(2027);
  });
  it('turns completed trades into log entries and keeps departed players', () => {
    const L = buildLeague(standings, [rosterA, rosterB], 'B', '2026-11-25T00:00:00Z');
    const trades = tradesFromPayload(
      {
        data: {
          recent_trades: [
            {
              trade_id: '99',
              status: 'completed',
              proposed_at: Date.parse('2026-11-18T00:00:00Z'),
              sides: [
                { team_id: 7, team_name: 'A', receives_players: [row('22', 'Steady', 'WR', 12)], receives_picks: [] },
                { team_id: 3, team_name: 'B', receives_players: [row('55', 'Gone Now', 'QB', 15)], receives_picks: [{ season: '2028', round: 2, original_owner: 'A' }] },
              ],
            },
          ],
        },
      },
      L,
    );
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ team: '7', with: '3', get: ['p:22'], give: ['p:55', 'k:2028-2-7'], outcome: 'completed' });
    expect(L.players['p:55'].name).toBe('Gone Now');
  });
});

describe('history', () => {
  it('snapshots every team and draws one line per asset', () => {
    const L = fixture();
    const v = buildValuer(L, emptySettings(), emptyLearned());
    const a = takeSnapshot(v, '2026-11-18T00:00:00Z');
    const b = { ...takeSnapshot(v, '2026-11-25T00:00:00Z'), market: { ...a.market, 'p:emmett': 9000 } };
    const line = series([b, a], 'p:emmett');
    expect(line.map((p) => p.date)).toEqual(['2026-11-18', '2026-11-25']);
    expect(line[1].value).toBe(9000);
    expect(series([a], 'p:emmett', '5')[0].value).toBe(v.value('5', 'p:emmett'));
  });
  it('rebuilds a hot streak from the game log', () => {
    const e = fixture().players['p:emmett'];
    const games = [8.8, 5.5, 2.7, 2.0, 3.4, 1.7, 24.3, 11.4, 38.1, 29.3].map((points, i) => ({ week: i + 1, date: `2026-09-${10 + i}`, points }));
    const line = rebuildFromGames(e, games);
    expect(line).toHaveLength(10);
    expect(line[9].value).toBeGreaterThan(line[5].value + 2000);
  });
});

describe('editing rankings', () => {
  it('moving to a rank lands between the new neighbours', async () => {
    const { valueForRank, byValue } = await import('../src/core/rankings');
    const list = [
      { id: 'a', value: 9000, name: 'A' },
      { id: 'b', value: 8000, name: 'B' },
      { id: 'c', value: 7000, name: 'C' },
      { id: 'd', value: 5000, name: 'D' },
    ];
    expect(valueForRank(list, 'd', 2)).toBe(8500);
    expect(valueForRank(list, 'a', 4)).toBe(4950);
    expect(valueForRank(list, 'c', 1)).toBe(9050);
    const moved = list.map((r) => (r.id === 'd' ? { ...r, value: valueForRank(list, 'd', 2) } : r)).sort(byValue);
    expect(moved.map((r) => r.id)).toEqual(['a', 'd', 'b', 'c']);
  });
  it('your own value is final for you; your league value flows to every team', () => {
    const L = fixture();
    const s = emptySettings();
    const v0 = buildValuer(L, s, emptyLearned());
    s.mine = { 'p:emmett': 9100 };
    const vm = buildValuer(L, s, emptyLearned());
    expect(vm.value('1', 'p:emmett')).toBe(9100);
    expect(vm.explain('1', 'p:emmett').set).toBe(true);
    // Nobody else's view moves when you rank a player for yourself.
    for (const t of ['5', '2']) for (const id of Object.keys(L.owner)) expect(vm.value(t, id)).toBe(v0.value(t, id));
    s.consensus = { 'p:warren': 6400 };
    const v = buildValuer(L, s, emptyLearned());
    expect(v.market('p:warren')).toBe(6400);
    expect(v.value('5', 'p:warren')).toBeGreaterThan(v0.value('5', 'p:warren'));
  });
  it('your league value beats a KTC paste', () => {
    const L = fixture();
    const s = emptySettings();
    s.market['p:warren'] = 5000;
    s.consensus = { 'p:warren': 5600 };
    expect(buildValuer(L, s, emptyLearned()).market('p:warren')).toBe(5600);
  });
});
