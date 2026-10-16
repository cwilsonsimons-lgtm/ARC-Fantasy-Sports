import { describe, expect, it } from 'vitest';
import { formatHeight, parseHeight, parseWeight } from '../src/core/height';
import { describeDiff, findMatches, tierFor } from '../src/core/match';
import { defaultPositionSettings, normalizePosition } from '../src/core/positions';
import {
  activeWorkspace, addProspects, assign, AssignmentError, counts, createWorkspace, deleteProspect, initialState,
  removeAssignment, removeSamples, restoreAssignment, switchWorkspace, updateAssignment, usedMap, type AppState, type Prospect,
} from '../src/core/state';
import { parseTable, toCsv } from '../src/core/csv';
import { applyMapping, guessMapping, looksLikeHeader, TEMPLATE_CSV, validateRows } from '../src/core/importer';
import { loadState, makeBackup, readBackup, saveState, STORAGE_KEY } from '../src/core/storage';

const pos = defaultPositionSettings();
const opts = { heightTol: 1, weightTol: 5 };
let n = 0;
const P = (name: string, position: string, heightIn: number, weight: number, college?: string): Prospect => ({
  id: `t${++n}`, name, position, heightIn, weight, ...(college ? { college } : {}),
});
const WR = { position: 'WR', heightIn: 75, weight: 215 };

class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}

describe('height parsing', () => {
  it.each([
    [`6'3"`, 75], [`6' 3"`, 75], [`6'3`, 75], ['6-3', 75], ['6 - 3', 75], ['75', 75], ['75"', 75], ['75 in', 75],
    ['75 inches', 75], ['6 ft 3 in', 75], ['6ft3', 75], [`6’3”`, 75], [`6'3''`, 75], [`6'0"`, 72], [`6'`, 72],
    [`6'2 1/2"`, 74.5], ['6-2.5', 74.5], [`6'2½"`, 74.5], ['74.5', 74.5], [`5'11"`, 71], ['6-10', 82],
  ])('%s → %d inches', (input, inches) => {
    const r = parseHeight(input);
    expect(r).toMatchObject({ ok: true, value: inches });
  });

  it.each([
    ['6.3', /ambiguous/], ['6', /feet only/], ['6025', /scouting notation/], [`6'13"`, /under 12/], ['', /required/],
    ['tall', /Can't read/], ['48', /outside/], ['6-3-1', /Can't read/], ['100', /outside/], [`7'9"`, /outside/],
  ])('rejects %s', (input, msg) => {
    const r = parseHeight(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(msg);
  });

  it('warns on unusually short but valid heights', () => {
    expect(parseHeight('63')).toMatchObject({ ok: true, value: 63, warning: expect.stringMatching(/unusually short/) });
  });

  it('formats inches back to feet and inches', () => {
    expect(formatHeight(75)).toBe(`6'3"`);
    expect(formatHeight(72)).toBe(`6'0"`);
    expect(formatHeight(74.5)).toBe(`6'2½"`);
  });

  it('parses weights', () => {
    expect(parseWeight('215')).toMatchObject({ ok: true, value: 215 });
    expect(parseWeight('215 lbs')).toMatchObject({ ok: true, value: 215 });
    expect(parseWeight('heavy').ok).toBe(false);
    expect(parseWeight('50').ok).toBe(false);
  });
});

describe('positions', () => {
  it('normalizes obvious equivalents', () => {
    expect(normalizePosition('HB', pos)).toBe('RB');
    expect(normalizePosition('rb', pos)).toBe('RB');
    expect(normalizePosition('LT', pos)).toBe('OT');
    expect(normalizePosition('FS', pos)).toBe('S');
  });
  it('keeps distinct positions distinct and leaves vague ones unmapped', () => {
    expect(normalizePosition('CB', pos)).toBe('CB');
    expect(normalizePosition('S', pos)).toBe('S');
    expect(normalizePosition('DB', pos)).toBeNull();
    expect(normalizePosition('IOL', pos)).toBeNull();
  });
});

describe('matching tiers', () => {
  it('ranks exact measurements first', () => {
    const pool = [P('Near', 'WR', 76, 215), P('Exact', 'WR', 75, 215), P('Far', 'WR', 80, 250)];
    const r = findMatches(WR, pool, new Set(), opts, pos);
    expect(r.exact.map((c) => c.prospect.name)).toEqual(['Exact']);
    expect(r.preferred.map((c) => c.prospect.name)).toEqual(['Near']);
    expect(r.fallback.map((c) => c.prospect.name)).toEqual(['Far']);
  });

  it('counts exactly 1 inch and 5 pounds away as preferred (boundaries included)', () => {
    for (const [h, w] of [[76, 220], [74, 210], [76, 210], [74, 220]]) {
      expect(tierFor(h - 75, w - 215, 1, 5)).toBe('preferred');
    }
    const r = findMatches(WR, [P('Edge', 'WR', 76, 220)], new Set(), opts, pos);
    expect(r.preferred).toHaveLength(1);
    expect(r.preferred[0].distance).toBe(2);
  });

  it('puts a player outside either limit only in the fallback tier', () => {
    const pool = [P('TooHeavy', 'WR', 75, 221), P('TooTall', 'WR', 77, 215), P('Both', 'WR', 77, 221)];
    const r = findMatches(WR, pool, new Set(), opts, pos);
    expect(r.exact).toHaveLength(0);
    expect(r.preferred).toHaveLength(0);
    expect(r.fallback.map((c) => c.prospect.name).sort()).toEqual(['Both', 'TooHeavy', 'TooTall']);
  });

  it('orders by distance, then height diff, weight diff, then name', () => {
    const pool = [
      P('Zed', 'WR', 75, 220), // 0 + 1 = 1
      P('Amy', 'WR', 76, 215), // 1 + 0 = 1, but bigger height diff
      P('Bob', 'WR', 75, 220), // ties Zed exactly → name
      P('Cal', 'WR', 75, 217), // 0.4
    ];
    const r = findMatches(WR, pool, new Set(), opts, pos);
    expect(r.preferred.map((c) => c.prospect.name)).toEqual(['Cal', 'Bob', 'Zed', 'Amy']);
  });

  it('respects adjusted tolerances', () => {
    const r = findMatches(WR, [P('A', 'WR', 77, 225)], new Set(), { heightTol: 2, weightTol: 10 }, pos);
    expect(r.preferred).toHaveLength(1);
    expect(() => findMatches(WR, [], new Set(), { heightTol: 0, weightTol: 5 }, pos)).toThrow();
  });

  it('matches on position only, and keeps related positions separate and opt-in', () => {
    const pool = [P('Corner', 'CB', 73, 200), P('Safety', 'S', 73, 200)];
    const g = { position: 'CB', heightIn: 73, weight: 200 };
    const off = findMatches(g, pool, new Set(), opts, pos);
    expect([...off.exact, ...off.preferred, ...off.fallback].map((c) => c.prospect.name)).toEqual(['Corner']);
    expect(off.related).toHaveLength(0);
    const on = findMatches(g, pool, new Set(), { ...opts, includeRelated: true }, pos);
    expect(on.exact.map((c) => c.prospect.name)).toEqual(['Corner']);
    expect(on.related.map((c) => c.prospect.name)).toEqual(['Safety']);
  });

  it('describes signed differences relative to the generated player', () => {
    expect(describeDiff(1, -4)).toBe('1 inch taller, 4 pounds lighter');
    expect(describeDiff(-2, 1)).toBe('2 inches shorter, 1 pound heavier');
    expect(describeDiff(0, 0)).toBe('same height, same weight');
    expect(describeDiff(0.5, 0)).toBe('0.5 inches taller, same weight');
  });
});

function stateWith(pool: Omit<Prospect, 'id'>[]): AppState {
  return addProspects(initialState([]), pool);
}

describe('used-player tracking', () => {
  const pool = [
    { name: 'Exact Guy', position: 'WR', heightIn: 75, weight: 215 },
    { name: 'Close Guy', position: 'WR', heightIn: 76, weight: 218 },
  ];

  it('removes used prospects from suggestions and undo brings them back', () => {
    let s = stateWith(pool);
    const ws = () => activeWorkspace(s);
    const exact = ws().prospects.find((p) => p.name === 'Exact Guy')!;
    const res = assign(s, { prospectId: exact.id, generated: WR, originalName: 'Gen Name', team: 'Bears' });
    s = res.state;
    expect(counts(ws())).toEqual({ total: 2, used: 1, available: 1 });
    let r = findMatches(WR, ws().prospects, new Set(usedMap(ws()).keys()), opts, pos);
    expect(r.exact).toHaveLength(0);
    expect(r.preferred.map((c) => c.prospect.name)).toEqual(['Close Guy']);
    // Shown with the toggle, but flagged used.
    r = findMatches(WR, ws().prospects, new Set(usedMap(ws()).keys()), { ...opts, includeUsed: true }, pos);
    expect(r.exact[0]).toMatchObject({ used: true });

    s = removeAssignment(s, res.assignment.id).state;
    expect(counts(ws()).available).toBe(2);
    r = findMatches(WR, ws().prospects, new Set(usedMap(ws()).keys()), opts, pos);
    expect(r.exact.map((c) => c.prospect.name)).toEqual(['Exact Guy']);
  });

  it('refuses to assign the same prospect twice in a workspace', () => {
    let s = stateWith(pool);
    const id = activeWorkspace(s).prospects[0].id;
    s = assign(s, { prospectId: id, generated: WR }).state;
    expect(() => assign(s, { prospectId: id, generated: WR })).toThrow(AssignmentError);
  });

  it('saves the assignment details and lets them be edited', () => {
    let s = stateWith(pool);
    const p = activeWorkspace(s).prospects[0];
    const { state, assignment } = assign(s, { prospectId: p.id, generated: WR, originalName: '  Gen  ', team: 'Bears', notes: 'r1' });
    s = state;
    expect(assignment).toMatchObject({ prospectName: 'Exact Guy', generated: WR, originalName: 'Gen', team: 'Bears', notes: 'r1' });
    expect(new Date(assignment.date).getTime()).not.toBeNaN();
    s = updateAssignment(s, assignment.id, { team: '', notes: 'pick 12' });
    const a = activeWorkspace(s).assignments[0];
    expect(a.team).toBeUndefined();
    expect(a.notes).toBe('pick 12');
  });

  it('restores an undone assignment unless the prospect was reused', () => {
    let s = stateWith(pool);
    const id = activeWorkspace(s).prospects[0].id;
    const { state, assignment } = assign(s, { prospectId: id, generated: WR });
    s = removeAssignment(state, assignment.id).state;
    const reassigned = assign(s, { prospectId: id, generated: WR }).state;
    expect(() => restoreAssignment(reassigned, assignment)).toThrow(AssignmentError);
    expect(usedMap(activeWorkspace(restoreAssignment(s, assignment))).has(id)).toBe(true);
  });

  it('blocks deleting a used prospect', () => {
    let s = stateWith(pool);
    const id = activeWorkspace(s).prospects[0].id;
    s = assign(s, { prospectId: id, generated: WR }).state;
    expect(() => deleteProspect(s, id)).toThrow(AssignmentError);
  });

  it('keeps used status separate across workspaces and copies pools with everyone available', () => {
    let s = stateWith(pool);
    const first = s.activeWorkspaceId;
    s = assign(s, { prospectId: activeWorkspace(s).prospects[0].id, generated: WR }).state;
    s = createWorkspace(s, 'Season 2', first);
    const second = activeWorkspace(s);
    expect(second.id).not.toBe(first);
    expect(second.prospects.map((p) => p.name)).toEqual(['Exact Guy', 'Close Guy']);
    expect(counts(second)).toEqual({ total: 2, used: 0, available: 2 });
    // Assign in the second, the first is untouched.
    s = assign(s, { prospectId: second.prospects[1].id, generated: WR }).state;
    s = switchWorkspace(s, first);
    expect(activeWorkspace(s).assignments.map((a) => a.prospectName)).toEqual(['Exact Guy']);
    // An empty workspace really is empty.
    s = createWorkspace(s, 'Blank');
    expect(counts(activeWorkspace(s)).total).toBe(0);
  });

  it('removes sample prospects except ones in use', () => {
    let s = initialState([
      { id: 's1', name: 'Sam', position: 'WR', heightIn: 75, weight: 215, sample: true },
      { id: 's2', name: 'Pam', position: 'WR', heightIn: 75, weight: 215, sample: true },
      { id: 'r1', name: 'Real', position: 'WR', heightIn: 75, weight: 215 },
    ]);
    s = assign(s, { prospectId: 's1', generated: WR }).state;
    const { state, kept } = removeSamples(s);
    expect(kept).toBe(1);
    expect(activeWorkspace(state).prospects.map((p) => p.id)).toEqual(['s1', 'r1']);
  });
});

describe('import', () => {
  it('parses CSV with headers, unquoted inch marks and quoted commas', () => {
    const text = `Player,Pos,Ht,Wt,School\nA One,WR,6'3",215,"Texas, Austin"\nB Two,HB,6-0,205,\nC Three,LT,77,312,Sample`;
    const { rows } = parseTable(text);
    expect(looksLikeHeader(rows[0])).toBe(true);
    const mapping = guessMapping(rows[0], true);
    expect(mapping).toEqual(['name', 'position', 'height', 'weight', 'college']);
    const v = validateRows(rows.slice(1).map((r, i) => ({ line: i + 2, raw: applyMapping(r, mapping) })), pos, []);
    expect(v.map((r) => r.errors)).toEqual([[], [], []]);
    expect(v.map((r) => r.prospect?.heightIn)).toEqual([75, 72, 77]);
    expect(v.map((r) => r.prospect?.position)).toEqual(['WR', 'RB', 'OT']);
    expect(v[0].prospect?.college).toBe('Texas, Austin');
  });

  it('accepts headerless tab-separated paste in the default column order', () => {
    const { rows, delimiter } = parseTable(`A One\tWR\t6'3"\t215\nB Two\tCB\t5-11\t190`);
    expect(delimiter).toBe('\t');
    expect(looksLikeHeader(rows[0])).toBe(false);
    const mapping = guessMapping(rows[0], false);
    const v = validateRows(rows.map((r, i) => ({ line: i + 1, raw: applyMapping(r, mapping) })), pos, []);
    expect(v.map((r) => r.prospect?.heightIn)).toEqual([75, 71]);
  });

  it('flags invalid and ambiguous values instead of guessing', () => {
    const { rows } = parseTable(`A,WR,6.3,215\nB,DB,6-0,190\nC,WR,6-0,`);
    const v = validateRows(rows.map((r, i) => ({ line: i + 1, raw: applyMapping(r, guessMapping(r, false)) })), pos, []);
    expect(v[0].errors.join()).toMatch(/ambiguous/);
    expect(v[1].unknownPosition).toBe('DB');
    expect(v[2].errors.join()).toMatch(/Weight is required/);
    expect(v.every((r) => !r.prospect)).toBe(true);
  });

  it('flags possible duplicates without merging same-name players', () => {
    const existing = [P('John Smith', 'WR', 75, 215, 'Alabama')];
    const { rows } = parseTable([
      'John Smith,WR,6-3,215,Alabama', // dup of pool
      'John Smith,WR,6-1,200,Ohio State', // same name, other college: not a dup
      'John Smith,CB,6-0,190,Alabama', // same name, other position: not a dup
      'Jane Doe,TE,6-5,250,', // first time
      'jane doe,TE,6-5,251,Iowa', // dup of row 4 (college missing on one side)
    ].join('\n'));
    const v = validateRows(rows.map((r, i) => ({ line: i + 1, raw: applyMapping(r, guessMapping(r, false)) })), pos, existing);
    expect(v.map((r) => r.duplicates.length)).toEqual([1, 0, 0, 0, 1]);
    expect(v[1].sameName.length).toBeGreaterThan(0);
    expect(v[4].duplicates[0]).toMatchObject({ where: 'import', detail: 'same as row 4' });
    expect(v.every((r) => r.prospect)).toBe(true);
  });

  it('ships a template that imports cleanly', () => {
    const { rows } = parseTable(TEMPLATE_CSV);
    const mapping = guessMapping(rows[0], true);
    const v = validateRows(rows.slice(1).map((r, i) => ({ line: i + 2, raw: applyMapping(r, mapping) })), pos, []);
    expect(v.every((r) => r.errors.length === 0)).toBe(true);
    expect(v[0].prospect?.heightIn).toBe(75);
  });

  it('round-trips through the CSV writer', () => {
    const csv = toCsv(['a', 'b'], [[`6'3"`, 'x, "y"']]);
    expect(parseTable(csv).rows).toEqual([['a', 'b'], [`6'3"`, 'x, "y"']]);
  });
});

describe('persistence', () => {
  it('survives a save and reload', () => {
    const storage = new MemStorage();
    let s = stateWith([{ name: 'Exact Guy', position: 'WR', heightIn: 75, weight: 215 }]);
    s = assign(s, { prospectId: activeWorkspace(s).prospects[0].id, generated: WR }).state;
    expect(saveState(s, storage)).toBeNull();
    const loaded = loadState(storage);
    expect(loaded.status).toBe('loaded');
    expect(loaded.state).toEqual(s);
  });

  it('starts with the sample pool on first run and recovers from unreadable data', () => {
    const storage = new MemStorage();
    const fresh = loadState(storage);
    expect(fresh.status).toBe('fresh');
    expect(activeWorkspace(fresh.state).prospects.every((p) => p.sample)).toBe(true);
    storage.setItem(STORAGE_KEY, '{nope');
    const rec = loadState(storage);
    expect(rec.status).toBe('recovered');
    expect(storage.getItem('rookie_match_v1_unreadable')).toBe('{nope');
  });

  it('backs up and restores everything, and rejects broken backups', () => {
    let s = stateWith([{ name: 'Exact Guy', position: 'WR', heightIn: 75, weight: 215 }]);
    s = assign(s, { prospectId: activeWorkspace(s).prospects[0].id, generated: WR, team: 'Bears' }).state;
    s = createWorkspace(s, 'Second', s.activeWorkspaceId);
    s = { ...s, settings: { ...s.settings, heightTol: 2, aliases: { ...s.settings.aliases, DB: 'CB' } } };
    const r = readBackup(makeBackup(s));
    expect(r.ok && r.state).toEqual(s);
    expect(readBackup('not json')).toMatchObject({ ok: false });
    const broken = JSON.parse(makeBackup(s));
    broken.data.workspaces[0].assignments.push({ ...broken.data.workspaces[0].assignments[0], id: 'dup' });
    const bad = readBackup(JSON.stringify(broken));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join()).toMatch(/assigned twice/);
  });
});
