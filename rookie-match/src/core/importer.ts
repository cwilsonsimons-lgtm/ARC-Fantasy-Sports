// Import pipeline: table → field mapping → validated rows → duplicate checks.
// Nothing here writes to state; the UI shows the preview and the user decides.
import { parseHeight, parseWeight } from './height';
import { cleanCode, normalizePosition, type PositionSettings } from './positions';
import type { Prospect, ProspectInput } from './state';
import { toCsv } from './csv';

export type Field = 'name' | 'firstName' | 'lastName' | 'position' | 'height' | 'weight' | 'college' | 'notes' | 'ignore';

export const FIELD_LABEL: Record<Field, string> = {
  name: 'Name',
  firstName: 'First name',
  lastName: 'Last name',
  position: 'Position',
  height: 'Height',
  weight: 'Weight (lb)',
  college: 'College',
  notes: 'Notes',
  ignore: '— Ignore —',
};

const HEADER_WORDS: Record<string, Field> = {
  name: 'name', player: 'name', 'player name': 'name', prospect: 'name', 'full name': 'name',
  first: 'firstName', 'first name': 'firstName', firstname: 'firstName',
  last: 'lastName', 'last name': 'lastName', lastname: 'lastName', surname: 'lastName',
  pos: 'position', position: 'position',
  ht: 'height', height: 'height', hgt: 'height', 'height (in)': 'height', 'height in': 'height', inches: 'height',
  wt: 'weight', weight: 'weight', lbs: 'weight', lb: 'weight', 'weight (lb)': 'weight', 'weight (lbs)': 'weight', pounds: 'weight',
  college: 'college', school: 'college', team: 'college', university: 'college',
  notes: 'notes', note: 'notes', comments: 'notes', comment: 'notes',
};

const headerKey = (h: string) => h.trim().toLowerCase().replace(/[_.]+/g, ' ').replace(/\s+/g, ' ');

export const DEFAULT_ORDER: Field[] = ['name', 'position', 'height', 'weight', 'college', 'notes'];

/** True when the first row reads as column headings rather than a player. */
export function looksLikeHeader(row: string[]): boolean {
  const hits = row.filter((c) => HEADER_WORDS[headerKey(c)]).length;
  return hits >= 2 || (hits >= 1 && row.length === 1);
}

export function guessMapping(firstRow: string[], hasHeader: boolean): Field[] {
  if (!hasHeader) return firstRow.map((_, i) => DEFAULT_ORDER[i] ?? 'ignore');
  const taken = new Set<Field>();
  return firstRow.map((h) => {
    const f = HEADER_WORDS[headerKey(h)];
    if (!f || taken.has(f)) return 'ignore';
    taken.add(f);
    return f;
  });
}

export interface RawValues {
  name: string;
  position: string;
  height: string;
  weight: string;
  college: string;
  notes: string;
}

export function applyMapping(row: string[], mapping: Field[]): RawValues {
  const v: RawValues = { name: '', position: '', height: '', weight: '', college: '', notes: '' };
  let first = '';
  let last = '';
  mapping.forEach((f, i) => {
    const c = (row[i] ?? '').trim();
    if (f === 'firstName') first = c;
    else if (f === 'lastName') last = c;
    else if (f !== 'ignore' && c) v[f] = v[f] ? `${v[f]} ${c}` : c;
  });
  if (!v.name && (first || last)) v.name = `${first} ${last}`.trim();
  return v;
}

export interface Duplicate {
  name: string;
  where: 'pool' | 'import';
  detail: string; // e.g. "row 4" or "already in pool"
}

export interface ValidatedRow {
  line: number; // 1-based line in the source
  raw: RawValues;
  prospect?: ProspectInput;
  errors: string[];
  warnings: string[];
  unknownPosition?: string; // raw code that didn't map
  duplicates: Duplicate[]; // possible duplicates (same name + position, and college if both have one)
  sameName: string[]; // same name but a different position or college — informational only
}

export const normName = (n: string) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
const normCollege = (c?: string) => (c ? normName(c) : '');

export function validateRaw(raw: RawValues, positions: PositionSettings): Omit<ValidatedRow, 'line' | 'duplicates' | 'sameName'> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const name = raw.name.replace(/\s+/g, ' ').trim();
  if (!name) errors.push('Name is missing');
  let position: string | null = null;
  let unknownPosition: string | undefined;
  if (!raw.position.trim()) errors.push('Position is missing');
  else {
    position = normalizePosition(raw.position, positions);
    if (!position) {
      unknownPosition = cleanCode(raw.position);
      errors.push(`Unknown position "${raw.position.trim()}" — map it to a position`);
    }
  }
  const h = parseHeight(raw.height);
  if (!h.ok) errors.push(`Height: ${h.error}`);
  else if (h.warning) warnings.push(h.warning);
  const w = parseWeight(raw.weight);
  if (!w.ok) errors.push(`Weight: ${w.error}`);
  const out: Omit<ValidatedRow, 'line' | 'duplicates' | 'sameName'> = { raw, errors, warnings, ...(unknownPosition ? { unknownPosition } : {}) };
  if (errors.length === 0 && position && h.ok && w.ok) {
    out.prospect = {
      name,
      position,
      heightIn: h.value,
      weight: w.value,
      ...(raw.college.trim() ? { college: raw.college.trim() } : {}),
      ...(raw.notes.trim() ? { notes: raw.notes.trim() } : {}),
    };
  }
  return out;
}

/** Possible-duplicate rule: same name and position, and the same college when both records have one. */
export function isPossibleDuplicate(a: Pick<Prospect, 'name' | 'position' | 'college'>, b: Pick<Prospect, 'name' | 'position' | 'college'>): boolean {
  if (normName(a.name) !== normName(b.name) || a.position !== b.position) return false;
  const ca = normCollege(a.college);
  const cb = normCollege(b.college);
  return !ca || !cb || ca === cb;
}

function describe(p: Pick<Prospect, 'position' | 'college'>) {
  return [p.position, p.college].filter(Boolean).join(', ');
}

export function checkAgainst(p: ProspectInput, existing: Prospect[], excludeId?: string): { duplicates: Duplicate[]; sameName: string[] } {
  const duplicates: Duplicate[] = [];
  const sameName: string[] = [];
  for (const e of existing) {
    if (e.id === excludeId || normName(e.name) !== normName(p.name)) continue;
    if (isPossibleDuplicate(p, e)) duplicates.push({ name: e.name, where: 'pool', detail: `already in pool (${describe(e)})` });
    else sameName.push(`${e.name} (${describe(e)}) is already in the pool`);
  }
  return { duplicates, sameName };
}

export function validateRows(rows: { line: number; raw: RawValues }[], positions: PositionSettings, existing: Prospect[]): ValidatedRow[] {
  const out: ValidatedRow[] = [];
  for (const { line, raw } of rows) {
    const v = validateRaw(raw, positions);
    const row: ValidatedRow = { ...v, line, duplicates: [], sameName: [] };
    if (v.prospect) {
      const c = checkAgainst(v.prospect, existing);
      row.duplicates.push(...c.duplicates);
      row.sameName.push(...c.sameName);
      for (const prev of out) {
        if (!prev.prospect || normName(prev.prospect.name) !== normName(v.prospect.name)) continue;
        if (isPossibleDuplicate(v.prospect, prev.prospect)) row.duplicates.push({ name: prev.prospect.name, where: 'import', detail: `same as row ${prev.line}` });
        else row.sameName.push(`row ${prev.line}: ${prev.prospect.name} (${describe(prev.prospect)})`);
      }
    }
    out.push(row);
  }
  return out;
}

export const TEMPLATE_CSV = toCsv(
  ['name', 'position', 'height', 'weight', 'college', 'notes'],
  [
    ['Example Player', 'WR', `6'3"`, 215, 'Example State', 'Replace these rows with your prospects'],
    ['Second Example', 'HB', '6-0', 205, '', 'HB is stored as RB'],
    ['Third Example', 'OT', 77, 312, 'Sample Tech', 'Height can be total inches'],
  ],
);
