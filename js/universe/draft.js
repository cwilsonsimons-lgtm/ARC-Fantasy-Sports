// WWE 2K Universe — the annual draft.
//
// The year ends WrestleMania → Last Stand → Draft. Last Stand settles who moves
// *between* tiers; the draft reshuffles everyone *within* a tier, so the brands
// on each rung re-pick their rosters from the pool of names already on that rung.
//
// Like everything else here it reads the pyramid rather than naming brands, so a
// universe with three tier-1 shows drafts three ways and a universe with two
// drafts two ways, from the same code.
//
// The order is reverse season standings — the brand that had the worst year
// picks first — and it snakes, so the first brand does not get every round's
// best available. Everything is a proposal until you commit it: the picks are an
// editable list, and committing writes ordinary `brand.transfer` events, which
// means a draft can be voided pick by pick like any other history.
//
// Two rules that are defaults rather than laws, both overridable:
//
//   protectChampions  a champion stays on the brand their belt belongs to,
//                     because splitting a belt from its holder makes a mess of
//                     the title's brand and nobody books it on purpose
//   keepTeams         when a brand picks somebody in an active tag team, their
//                     partners come with them — drafting half of a tag team is
//                     almost always a mistake rather than a choice

import { tiers, tierOf, autoPromotions } from './pyramid.js';
import { currentSeason, standingsFor } from './season.js';

export const DRAFT_DEFAULTS = { protectChampions: true, keepTeams: true };

// Who a champion is tied to: the brand that owns the belt they hold.
function championHome(state) {
  const home = new Map();
  Object.values(state.championships).forEach(c => {
    if (!c.brandId || c.retired) return;
    [...c.holders, ...c.interimHolders].forEach(h => { if (!home.has(h)) home.set(h, c.brandId); });
  });
  return home;
}

function activePartners(state, ref) {
  const out = new Set();
  Object.values(state.groups).forEach(g => {
    if (!g.active || g.kind !== 'tagTeam' || !g.members.includes(ref)) return;
    g.members.forEach(m => { if (m !== ref) out.add(m); });
  });
  return [...out];
}

// ------------------------------------------------------------------ proposal

export function proposeDraft(state, opts = {}) {
  const { protectChampions, keepTeams } = { ...DRAFT_DEFAULTS, ...opts };
  const season = opts.season || currentSeason(state);
  const tier = opts.tier == null ? (tiers(state)[0] || {}).tier : opts.tier;
  const brands = (tiers(state).find(t => t.tier === tier) || { brands: [] }).brands;
  if (brands.length < 2) {
    return { tier, order: [], picks: [], pool: [], protected: [], why: 'a draft needs at least two brands on the tier' };
  }

  // Season form, used both to order the brands and to rank the pool.
  const form = new Map(standingsFor(state, { from: season.from, to: season.to }).map(r => [r.id, r]));
  const score = id => (form.get(id) ? form.get(id).points : 0);
  const rank = (a, b) => score(b.id) - score(a.id)
    || ((form.get(b.id) || {}).winPct || 0) - ((form.get(a.id) || {}).winPct || 0)
    || a.name.localeCompare(b.name);

  // Everyone on this tier. Free agents join the top tier's pool, since that is
  // where an unsigned name is signed to.
  const isTop = tiers(state)[0] && tiers(state)[0].tier === tier;
  const roster = Object.values(state.wrestlers).filter(w =>
    (w.brandId && tierOf(state, w.brandId) === tier) || (isTop && !w.brandId && w.status !== 'released'));

  // Automatic call-ups from the rung below join this tier's pool without having
  // won a Last Stand match — that is the whole point of the designation. They
  // are drafted like anybody else, and the pick is what actually moves them.
  const calledUp = autoPromotions(state)
    .filter(a => tierOf(state, a.to) === tier && !roster.some(w => w.id === a.id))
    .map(a => ({ ...state.wrestlers[a.id], calledUp: a }));
  roster.push(...calledUp);

  const home = protectChampions ? championHome(state) : new Map();
  const held = [];
  const pool = [];
  roster.forEach(w => {
    const brandOfBelt = home.get(w.id);
    if (brandOfBelt && brands.some(b => b.id === brandOfBelt)) {
      held.push({ ...w, brandId: brandOfBelt, why: 'champion — stays with the belt' });
    } else pool.push(w);
  });
  pool.sort(rank);

  // Weakest season first, and it snakes.
  const order = brands.slice().sort((a, b) => {
    const pa = (a.roster || []).reduce((n, id) => n + score(id), 0);
    const pb = (b.roster || []).reduce((n, id) => n + score(id), 0);
    return pa - pb || a.name.localeCompare(b.name);
  }).map(b => ({
    brandId: b.id, name: b.name,
    points: (b.roster || []).reduce((n, id) => n + score(id), 0),
    protectedCount: held.filter(x => x.brandId === b.id).length,
  }));

  const picks = [];
  const taken = new Set(held.map(w => w.id));
  const remaining = () => pool.filter(w => !taken.has(w.id));

  let round = 1;
  while (remaining().length) {
    const sweep = round % 2 ? order : order.slice().reverse();
    let movedThisRound = false;
    for (const slot of sweep) {
      const next = remaining()[0];
      if (!next) break;
      taken.add(next.id);
      picks.push({
        round, pick: picks.length + 1, brandId: slot.brandId, brandName: slot.name,
        wrestlerId: next.id, name: next.name, gender: next.gender,
        from: next.brandId, points: score(next.id), withTeam: [],
      });
      movedThisRound = true;

      if (keepTeams) {
        activePartners(state, next.id).forEach(pid => {
          const partner = pool.find(w => w.id === pid && !taken.has(pid));
          if (!partner) return;
          taken.add(pid);
          picks[picks.length - 1].withTeam.push({ id: pid, name: partner.name });
          picks.push({
            round, pick: picks.length + 1, brandId: slot.brandId, brandName: slot.name,
            wrestlerId: pid, name: partner.name, gender: partner.gender,
            from: partner.brandId, points: score(pid), team: true, withTeam: [],
          });
        });
      }
    }
    if (!movedThisRound) break;                 // nothing left to hand out
    round += 1;
  }

  return { tier, order, picks, pool, protected: held, rounds: round - 1, season };
}

// Every tier that can hold a draft, top first.
export const proposeDraftAll = (state, opts = {}) =>
  tiers(state)
    .map(t => proposeDraft(state, { ...opts, tier: t.tier }))
    .filter(d => d.picks.length || d.protected.length);

// ------------------------------------------------------------------ commit

// Only wrestlers who actually change brand are written. Re-running a draft that
// nobody edited therefore writes nothing, the same way re-pasting a roster does.
export function commitDraft(store, proposal, { date, dryRun = false, state = null } = {}) {
  const picks = (proposal.picks || []).filter(p => p.from !== p.brandId);
  const events = picks.map(p => ({
    type: 'brand.transfer', date, source: 'draft',
    participants: [{ ref: p.wrestlerId, role: 'subject' }],
    data: { toBrandId: p.brandId, fromBrandId: p.from || null, reason: 'draft', status: 'active' },
    note: `drafted by ${p.brandName}, round ${p.round}`,
  }));

  // Someone picked out of free agency has no contract to transfer, so they get
  // signed instead — a transfer would move a brand they were never on.
  const signed = state ? picks.filter(p => !p.from).map(p => p.wrestlerId) : [];
  events.forEach((e, i) => {
    if (!signed.includes(picks[i].wrestlerId)) return;
    e.type = 'contract.signed';
    e.data = { brandId: picks[i].brandId, status: 'active' };
  });

  if (dryRun || !events.length) return { events, written: 0, moved: picks.length };
  const written = store.appendBatch(events);
  store.save();
  return { events: written, written: written.length, moved: picks.length };
}

// ------------------------------------------------------------------ read-back

export function draftText(state, proposal) {
  const brandName = id => (state.brands[id] ? state.brands[id].name : '—');
  const lines = [
    `Draft — tier ${proposal.tier}`,
    `Order: ${proposal.order.map(o => o.name).join(' → ')} (weakest season first, snaking)`,
  ];
  if (proposal.protected.length) {
    lines.push('', 'Protected (champions stay with their belt):');
    proposal.protected.forEach(w => lines.push(`  ${w.name} — ${brandName(w.brandId)}`));
  }
  lines.push('', 'Picks:');
  proposal.picks.forEach(p => lines.push(
    `  ${String(p.round).padStart(2)}.${String(p.pick).padStart(3)}  ${p.brandName.padEnd(12)} ${p.name}`
    + `${p.team ? ' (tag partner)' : ''}${p.from === p.brandId ? ' (stays)' : ''}`));
  return lines.join('\n');
}
