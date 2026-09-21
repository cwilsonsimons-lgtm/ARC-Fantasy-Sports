// Who runs with whom.
//
// A faction is membership and a name. Nothing else: no faction morale, no
// faction wars, no leader powers beyond the fact that the leader's fights are
// the faction's fights. It exists because Tier 9 needs a reason to back
// somebody that is not "you like them", and a stable is exactly that.
//
// Crucially, membership carries NO relationship values. On a blank slate the
// Syndicate all think nothing of each other, and they still pile in when one of
// them is in a fight, because that is what a stable is. Affinity and faction
// are separate motives, and keeping them separate is what makes a faction mean
// something rather than being a shorthand for "friends".
//
// This is authored character, like position on the card: who these people run
// with on day one, not something that has happened to them.

import { mint } from '../core/ids.js';

export function createFaction(spec = {}) {
  const {
    id = mint('team'),
    name,
    shortName = '',
    memberIds = [],
    leaderId = null,
    formedOnDay = 0,
  } = spec;

  if (!name) throw new Error('createFaction: a faction needs a name');
  if (memberIds.length < 2) throw new Error(`createFaction: ${name} needs at least two members`);

  return {
    id,
    name,
    shortName: shortName || name,
    memberIds: [...memberIds],
    leaderId: leaderId || memberIds[0],
    formedOnDay,
    disbandedOnDay: null,
  };
}

export function isActive(faction) {
  return faction.disbandedOnDay == null && faction.memberIds.length >= 2;
}

export function validateFaction(f) {
  const problems = [];
  if (!f.name) problems.push('no name');
  if (!Array.isArray(f.memberIds)) problems.push('memberIds is not a list');
  else {
    if (new Set(f.memberIds).size !== f.memberIds.length) problems.push('somebody is in it twice');
    if (f.leaderId && !f.memberIds.includes(f.leaderId)) {
      problems.push('the leader is not a member');
    }
  }
  return problems;
}
