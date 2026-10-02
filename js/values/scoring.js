// Fantasy points under the league's own Sleeper scoring settings. Sleeper's stat
// keys and scoring keys share names (pass_td, rec, rec_fd, bonus_rec_te,
// rec_0_4 …), so league points are a dot product of the two.

export function leaguePoints(stats, scoring) {
  let pts = 0;
  for (const k in scoring) {
    const v = stats[k];
    if (typeof v === 'number') pts += v * scoring[k];
  }
  return Math.round(pts * 100) / 100;
}

// Plain PPR is what market values are built around; it's the comparison point
// for the scoring-format edge. Sleeper ships it precomputed on each stat line.
export function pprPoints(stats) {
  if (typeof stats.pts_ppr === 'number') return stats.pts_ppr;
  return leaguePoints(stats, PPR);
}

const PPR = {
  pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_2pt: 2,
  rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
  rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
  fum_lost: -2,
};

// Short human summary of what makes this league's scoring different.
export function describeScoring(league) {
  const s = league.scoring_settings || {};
  const pos = league.roster_positions || [];
  const out = [];
  const teams = league.total_rosters;
  if (teams) out.push(`${teams} teams`);
  if (pos.includes('SUPER_FLEX') || pos.filter(p => p === 'QB').length > 1) out.push('Superflex');
  if (s.pass_td) out.push(`${s.pass_td}pt pass TD`);
  const tiers = Object.keys(s).filter(k => /^rec_\d+_\d+p?$|^rec_\d+p$/.test(k) && s[k]);
  if (tiers.length) out.push('Tiered PPR');
  else if (s.rec) out.push(s.rec === 1 ? 'PPR' : `${s.rec} PPR`);
  if (s.bonus_rec_te) out.push(`TE premium +${s.bonus_rec_te}`);
  const fd = ['pass_fd', 'rush_fd', 'rec_fd'].filter(k => s[k]);
  if (fd.length) out.push(`First downs (${fd.map(k => `${k.split('_')[0]} ${s[k]}`).join(', ')})`);
  return out;
}

export function isSuperflex(league) {
  const pos = league.roster_positions || [];
  return pos.includes('SUPER_FLEX') || pos.filter(p => p === 'QB').length > 1;
}
