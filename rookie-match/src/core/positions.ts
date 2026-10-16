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

// Defaults follow Tankathon's NFL big board labels, since that's where the prospect
// pool comes from. Madden's positions are mapped onto them below.
export const DEFAULT_POSITIONS = [
  'QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'IOL', 'EDGE', 'DL', 'LB', 'CB', 'S', 'K', 'P', 'LS',
];

export const DEFAULT_ALIASES: Record<string, string> = {
  HB: 'RB', TB: 'RB', HALFBACK: 'RB', 'RUNNING BACK': 'RB',
  QUARTERBACK: 'QB', FULLBACK: 'FB',
  'WIDE RECEIVER': 'WR', 'TIGHT END': 'TE',
  T: 'OT', LT: 'OT', RT: 'OT', TACKLE: 'OT', 'OFFENSIVE TACKLE': 'OT',
  // Tankathon doesn't split guards from centers.
  G: 'IOL', OG: 'IOL', LG: 'IOL', RG: 'IOL', C: 'IOL', OC: 'IOL', GUARD: 'IOL', CENTER: 'IOL', 'INTERIOR OL': 'IOL',
  DE: 'EDGE', LE: 'EDGE', RE: 'EDGE', LEDG: 'EDGE', REDG: 'EDGE', ED: 'EDGE', 'DEFENSIVE END': 'EDGE',
  DT: 'DL', NT: 'DL', DI: 'DL', IDL: 'DL', 'DEFENSIVE TACKLE': 'DL',
  OLB: 'LB', ILB: 'LB', MLB: 'LB', LOLB: 'LB', ROLB: 'LB', SAM: 'LB', MIKE: 'LB', WILL: 'LB', LINEBACKER: 'LB',
  CORNERBACK: 'CB', CORNER: 'CB',
  FS: 'S', SS: 'S', SAF: 'S', SAFETY: 'S',
  PK: 'K', KICKER: 'K', PUNTER: 'P', 'LONG SNAPPER': 'LS',
};

export const DEFAULT_RELATED: [string, string][] = [
  ['RB', 'FB'], ['FB', 'TE'], ['WR', 'TE'], ['OT', 'IOL'], ['EDGE', 'DL'], ['EDGE', 'LB'], ['CB', 'S'], ['S', 'LB'], ['K', 'P'],
];

export function defaultPositionSettings(): PositionSettings {
  return {
    positions: [...DEFAULT_POSITIONS],
    aliases: { ...DEFAULT_ALIASES },
    related: DEFAULT_RELATED.map((p) => [p[0], p[1]] as [string, string]),
  };
}

export const cleanCode = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, ' ').replace(/\./g, '');

function normalizeOne(code: string, s: PositionSettings): string | null {
  if (s.positions.includes(code)) return code;
  const mapped = s.aliases[code];
  return mapped && s.positions.includes(mapped) ? mapped : null;
}

/**
 * Canonical code for a raw position, or null when it is unknown. Dual listings
 * such as Tankathon's "OT/IOL" stay dual ("OT/IOL"); every part must be known.
 */
export function normalizePosition(raw: string, s: PositionSettings): string | null {
  const code = cleanCode(raw);
  if (!code) return null;
  const whole = normalizeOne(code, s);
  if (whole) return whole;
  const parts = code.split(/\s*\/\s*/).filter(Boolean);
  if (parts.length < 2) return null;
  const out: string[] = [];
  for (const part of parts) {
    const n = normalizeOne(part, s);
    if (!n) return null;
    if (!out.includes(n)) out.push(n);
  }
  return out.join('/');
}

/** The individual positions a stored position covers ("OT/IOL" → ["OT", "IOL"]). */
export const positionsOf = (stored: string): string[] => stored.split('/');

/** Raw codes in a position string that don't map to anything (for import messages). */
export function unknownParts(raw: string, s: PositionSettings): string[] {
  return cleanCode(raw).split(/\s*\/\s*/).filter((p) => p && !normalizeOne(p, s));
}

export function relatedPositions(pos: string, s: PositionSettings): string[] {
  const out = new Set<string>();
  for (const [a, b] of s.related) {
    if (a === pos && b !== pos) out.add(b);
    if (b === pos && a !== pos) out.add(a);
  }
  return [...out].filter((p) => s.positions.includes(p));
}
