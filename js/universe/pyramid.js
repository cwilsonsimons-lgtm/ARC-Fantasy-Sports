// WWE 2K Universe — the brand pyramid.
//
// A universe is a stack of tiers, not a hardcoded Raw/SmackDown/NXT. `tier` is
// an ordinary number on the brand record — 1 is the top — and everything else
// here is derived from it. That is what lets one save run
//
//     Raw | SmackDown | Dynamite   →   NXT   →   Evolve
//
// and another run
//
//     Raw | SmackDown   →   NXT | WCW   →   Evolve
//
// with the same promotion, relegation and draft code. Nothing in this file
// mentions a brand by name, and nothing anywhere else should either: ask the
// pyramid what is above or below a brand and act on the answer.
//
// `parentId` is the optional finer link — "Evolve develops specifically for
// NXT" — used to prefer one destination when a tier has several brands. Without
// it, movement goes to whichever brand on the neighbouring tier has the thinnest
// roster, which keeps a pyramid balanced over a few seasons.

const tierOfBrand = b => (Number.isFinite(b.tier) ? b.tier : 1);

// Every tier that has at least one brand, top first.
export function tiers(state) {
  const byTier = new Map();
  Object.values(state.brands).forEach(b => {
    const t = tierOfBrand(b);
    if (!byTier.has(t)) byTier.set(t, []);
    byTier.get(t).push(b);
  });
  return [...byTier.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tier, brands], i, all) => ({
      tier,
      brands: brands.sort((x, y) => x.name.localeCompare(y.name)),
      depth: i + 1,
      isTop: i === 0,
      isBottom: i === all.length - 1,
      label: i === 0 ? 'Main roster' : i === all.length - 1 && all.length > 2 ? 'Lower developmental' : 'Developmental',
    }));
}

export const tierOf = (state, brandId) => (state.brands[brandId] ? tierOfBrand(state.brands[brandId]) : null);
export const brandsInTier = (state, tier) => Object.values(state.brands).filter(b => tierOfBrand(b) === tier);

// The tier numbers actually in use, in order. Tiers do not have to be
// consecutive — a user who numbers them 1, 5, 10 gets the same three rungs.
const ladder = state => tiers(state).map(t => t.tier);

export function tierAbove(state, brandId) {
  const rungs = ladder(state);
  const i = rungs.indexOf(tierOf(state, brandId));
  return i > 0 ? rungs[i - 1] : null;
}

export function tierBelow(state, brandId) {
  const rungs = ladder(state);
  const i = rungs.indexOf(tierOf(state, brandId));
  return i >= 0 && i < rungs.length - 1 ? rungs[i + 1] : null;
}

export const canBePromoted = (state, brandId) => tierAbove(state, brandId) !== null;
export const canBeRelegated = (state, brandId) => tierBelow(state, brandId) !== null;

// Where somebody leaving `brandId` in the given direction should land.
//
//   1. the brand named by the parent link, in the right direction
//   2. a brand on the neighbouring tier that names this one as its parent
//   3. the thinnest roster on the neighbouring tier
//
// Returns null when there is no rung that way — the top of the pyramid cannot
// be promoted off, and the bottom cannot be relegated out of the company.
export function destination(state, brandId, direction) {
  const brand = state.brands[brandId];
  if (!brand) return null;
  const wantTier = direction === 'promotion' ? tierAbove(state, brandId) : tierBelow(state, brandId);
  if (wantTier == null) return null;

  const candidates = brandsInTier(state, wantTier);
  if (!candidates.length) return null;

  if (direction === 'promotion' && brand.parentId) {
    const parent = candidates.find(b => b.id === brand.parentId);
    if (parent) return parent.id;
  }
  if (direction === 'relegation') {
    const child = candidates.find(b => b.parentId === brandId);
    if (child) return child.id;
  }
  return candidates.slice().sort((a, b) =>
    (a.roster || []).length - (b.roster || []).length || a.name.localeCompare(b.name))[0].id;
}

// The pyramid as one line of text, the way the brief drew it:
//   Raw | SmackDown | Dynamite ↓ NXT ↓ Evolve
export function pyramidText(state, { sep = ' | ', down = ' ↓ ' } = {}) {
  return tiers(state).map(t => t.brands.map(b => b.name).join(sep)).join(down);
}

// A brand with everything the pyramid knows about it attached.
export function brandCard(state, brandId) {
  const b = state.brands[brandId];
  if (!b) return null;
  const up = tierAbove(state, brandId);
  const down = tierBelow(state, brandId);
  return {
    ...b,
    tier: tierOfBrand(b),
    parent: b.parentId && state.brands[b.parentId] ? state.brands[b.parentId] : null,
    children: Object.values(state.brands).filter(x => x.parentId === brandId),
    promotesTo: up == null ? null : destination(state, brandId, 'promotion'),
    relegatesTo: down == null ? null : destination(state, brandId, 'relegation'),
    championships: Object.values(state.championships).filter(c => c.brandId === brandId && !c.retired),
    size: (b.roster || []).length,
  };
}

// Validation for a brand about to be written. Tier numbers must be positive,
// and a parent link has to point at a brand nearer the top — otherwise the
// pyramid stops being a pyramid and movement can loop.
export function checkBrand(state, rec, { id = null } = {}) {
  const errors = [];
  const tier = Number(rec.tier == null ? 1 : rec.tier);
  if (!Number.isFinite(tier) || tier < 1) errors.push('tier must be a whole number, 1 or higher');
  if (rec.parentId) {
    const parent = state.brands[rec.parentId];
    if (!parent) errors.push('the parent brand does not exist');
    else if (tierOfBrand(parent) >= tier) errors.push(`${parent.name} is on tier ${tierOfBrand(parent)}, so it cannot be the parent of a tier ${tier} brand`);
    else if (id && rec.parentId === id) errors.push('a brand cannot be its own parent');
  }
  if (!String(rec.name || '').trim()) errors.push('a brand needs a name');
  return errors;
}

export { tierOfBrand };
