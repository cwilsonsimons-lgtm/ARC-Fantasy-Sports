// Ranking. Candidates are grouped into tiers by hard measurement limits, then
// ordered inside each tier by a transparent distance:
//   distance = |Δheight| / heightTol + |Δweight| / weightTol      (lower is better)
// Ties: smaller |Δheight|, then smaller |Δweight|, then name A→Z.
// The score only compares measurements; it says nothing about talent or style.
import type { GeneratedPlayer, Prospect } from './state';
import { positionsOf, relatedPositions, type PositionSettings } from './positions';

export type Tier = 'exact' | 'preferred' | 'fallback';

export const TIER_LABEL: Record<Tier, string> = {
  exact: 'Exact match',
  preferred: 'Within preferred range',
  fallback: 'Outside preferred range',
};

export interface Candidate {
  prospect: Prospect;
  tier: Tier;
  heightDiff: number; // prospect − generated (positive = prospect is taller)
  weightDiff: number; // prospect − generated (positive = prospect is heavier)
  distance: number;
  used: boolean;
  /** Used, but an exact match, so it may be picked again. */
  reusable: boolean;
  related: boolean; // found through the related-position search
}

export interface MatchOptions {
  heightTol: number;
  weightTol: number;
  includeUsed?: boolean;
  /** Suggest used prospects that match exactly, even with includeUsed off. */
  reuseExact?: boolean;
  includeRelated?: boolean;
}

export interface MatchResult {
  exact: Candidate[];
  preferred: Candidate[];
  fallback: Candidate[];
  related: Candidate[]; // related positions, kept apart from exact-position results
  relatedPositions: string[];
}

// Measurement inputs are whole or fractional inches/pounds; round away float noise
// so a 1.0000000001" gap still counts as 1".
const r = (n: number) => Math.round(n * 1e6) / 1e6;

export function tierFor(heightDiff: number, weightDiff: number, heightTol: number, weightTol: number): Tier {
  const dh = Math.abs(r(heightDiff));
  const dw = Math.abs(r(weightDiff));
  if (dh === 0 && dw === 0) return 'exact';
  if (dh <= heightTol && dw <= weightTol) return 'preferred';
  return 'fallback';
}

const TIER_ORDER: Record<Tier, number> = { exact: 0, preferred: 1, fallback: 2 };

export function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
    // Within a tier, names still free come before ones already used.
    Number(a.used) - Number(b.used) ||
    a.distance - b.distance ||
    Math.abs(a.heightDiff) - Math.abs(b.heightDiff) ||
    Math.abs(a.weightDiff) - Math.abs(b.weightDiff) ||
    a.prospect.name.localeCompare(b.prospect.name, undefined, { sensitivity: 'base' }) ||
    a.prospect.id.localeCompare(b.prospect.id)
  );
}

function candidate(p: Prospect, g: GeneratedPlayer, o: MatchOptions, used: boolean, related: boolean): Candidate {
  const heightDiff = r(p.heightIn - g.heightIn);
  const weightDiff = r(p.weight - g.weight);
  return {
    prospect: p,
    tier: tierFor(heightDiff, weightDiff, o.heightTol, o.weightTol),
    heightDiff,
    weightDiff,
    distance: r(Math.abs(heightDiff) / o.heightTol + Math.abs(weightDiff) / o.weightTol),
    used,
    reusable: false,
    related,
  };
}

export function findMatches(
  g: GeneratedPlayer,
  prospects: Prospect[],
  usedIds: Set<string>,
  o: MatchOptions,
  positions: PositionSettings,
): MatchResult {
  if (!(o.heightTol > 0) || !(o.weightTol > 0)) throw new Error('Tolerances must be positive');
  const rel = o.includeRelated ? relatedPositions(g.position, positions) : [];
  const same: Candidate[] = [];
  const related: Candidate[] = [];
  for (const p of prospects) {
    const used = usedIds.has(p.id);
    const listed = positionsOf(p.position);
    if (listed.includes(g.position)) {
      const c = candidate(p, g, o, used, false);
      c.reusable = used && !!o.reuseExact && c.tier === 'exact';
      if (used && !o.includeUsed && !c.reusable) continue;
      same.push(c);
    } else if (listed.some((x) => rel.includes(x))) {
      if (used && !o.includeUsed) continue;
      related.push(candidate(p, g, o, used, true));
    }
  }
  same.sort(compareCandidates);
  related.sort(compareCandidates);
  return {
    exact: same.filter((c) => c.tier === 'exact'),
    preferred: same.filter((c) => c.tier === 'preferred'),
    fallback: same.filter((c) => c.tier === 'fallback'),
    related,
    relatedPositions: rel,
  };
}

const num = (n: number) => String(Math.round(Math.abs(n) * 1000) / 1000);
const amount = (n: number, one: string, many: string) => `${num(n)} ${Math.abs(n) === 1 ? one : many}`;

/** "1 inch taller, 4 pounds lighter" — relative to the generated Madden player. */
export function describeDiff(heightDiff: number, weightDiff: number): string {
  const h = heightDiff === 0 ? 'same height' : `${amount(heightDiff, 'inch', 'inches')} ${heightDiff > 0 ? 'taller' : 'shorter'}`;
  const w = weightDiff === 0 ? 'same weight' : `${amount(weightDiff, 'pound', 'pounds')} ${weightDiff > 0 ? 'heavier' : 'lighter'}`;
  return `${h}, ${w}`;
}
