// Position vocabulary shared by imported prospects and Madden entries.
// Everything is stored under a canonical code. Aliases map other spellings onto a
// canonical code; they are editable because Madden versions and prospect lists
// disagree. Distinct positions are never merged by default — that is what the
// separate, opt-in "related positions" list is for.

export interface PositionSettings {
  positions: string[]; // canonical codes, in display order
  aliases: Record<string, string>; // ALIAS -> canonical code
  related: [string, string][]; // pairs searched only when related search is on
}

export const DEFAULT_POSITIONS = [
  'QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'OG', 'C', 'DE', 'DT', 'LB', 'CB', 'S', 'K', 'P', 'LS',
];

export const DEFAULT_ALIASES: Record<string, string> = {
  HB: 'RB', TB: 'RB', HALFBACK: 'RB', 'RUNNING BACK': 'RB',
  QUARTERBACK: 'QB', FULLBACK: 'FB',
  'WIDE RECEIVER': 'WR', 'TIGHT END': 'TE',
  T: 'OT', LT: 'OT', RT: 'OT', TACKLE: 'OT', 'OFFENSIVE TACKLE': 'OT',
  G: 'OG', LG: 'OG', RG: 'OG', GUARD: 'OG', 'OFFENSIVE GUARD': 'OG',
  OC: 'C', CENTER: 'C',
  LE: 'DE', RE: 'DE', EDGE: 'DE', LEDG: 'DE', REDG: 'DE', 'DEFENSIVE END': 'DE',
  NT: 'DT', DI: 'DT', 'DEFENSIVE TACKLE': 'DT',
  OLB: 'LB', ILB: 'LB', MLB: 'LB', LOLB: 'LB', ROLB: 'LB', SAM: 'LB', MIKE: 'LB', WILL: 'LB', LINEBACKER: 'LB',
  CORNERBACK: 'CB', CORNER: 'CB',
  FS: 'S', SS: 'S', SAF: 'S', SAFETY: 'S',
  PK: 'K', KICKER: 'K', PUNTER: 'P', 'LONG SNAPPER': 'LS',
};

export const DEFAULT_RELATED: [string, string][] = [
  ['RB', 'FB'], ['FB', 'TE'], ['WR', 'TE'], ['OT', 'OG'], ['OG', 'C'], ['DE', 'DT'], ['DE', 'LB'], ['CB', 'S'], ['S', 'LB'], ['K', 'P'],
];

export function defaultPositionSettings(): PositionSettings {
  return {
    positions: [...DEFAULT_POSITIONS],
    aliases: { ...DEFAULT_ALIASES },
    related: DEFAULT_RELATED.map((p) => [p[0], p[1]] as [string, string]),
  };
}

export const cleanCode = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, ' ').replace(/\./g, '');

/** Canonical code for a raw position, or null when it is unknown. */
export function normalizePosition(raw: string, s: PositionSettings): string | null {
  const code = cleanCode(raw);
  if (!code) return null;
  if (s.positions.includes(code)) return code;
  const mapped = s.aliases[code];
  return mapped && s.positions.includes(mapped) ? mapped : null;
}

export function relatedPositions(pos: string, s: PositionSettings): string[] {
  const out = new Set<string>();
  for (const [a, b] of s.related) {
    if (a === pos && b !== pos) out.add(b);
    if (b === pos && a !== pos) out.add(a);
  }
  return [...out].filter((p) => s.positions.includes(p));
}
