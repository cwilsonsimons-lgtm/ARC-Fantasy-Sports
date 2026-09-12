// Who steps in, and why.
//
// When something happens to someone, every other wrestler in the building gets
// a look at it. Most do nothing. The ones who act do it for a reason, and the
// reason is the interesting part — a save is never "IF face THEN save". It is a
// sum of competing pulls:
//
//   pulls      friendship, a debt owed, hatred of the attacker, principle,
//              self-interest, respect, faction loyalty, ambition
//   deterrents fear of the attacker, spite toward the victim, being busy
//
// Score above the acting line and they go. Score in the band below it and they
// come out, think about it, and go back — which damages a relationship far more
// than never moving at all. Below that and they stand there.
//
// Nobody reacting is a result, not an absence of one.
import { byId } from './wrestlers.js';
import { trait, lean, scale } from './traits.js';
import { roomOf } from './backstage.js';
import { hops } from '../data/locations.js';

// Tuned against several thousand simulated matches. The targets are that a save
// is common but not automatic, that hesitating and nobody-moving are both real
// outcomes rather than rounding errors, and that a full locker-room brawl is
// the rare spectacular result instead of the norm.
//
// One thing the numbers deliberately allow: the rate drifts upward across a
// save. In week two nobody in this locker room owes anybody anything and people
// mostly stand and watch. By week thirty there are debts, factions and scores,
// and somebody usually goes. That arc is the relationships paying off, so it is
// left in rather than normalised away.
export const ACT_AT = 29;
export const HESITATE_AT = 22;
const MAX_DEPTH = 3;
const DEPTH_PENALTY = 11; // each link in a chain is harder to justify than the last
// History stops counting past a point. The twentieth match against somebody is
// not twice the grievance of the tenth, and without a ceiling a roster played
// for a year turns into one where everybody runs in for everybody.
const HISTORY_CAP = 7;
const DEBT_CAP = 3; // the fourth favour is not a fourth reason
// Reasons do not simply add up. Somebody with five reasons to go was already
// going on the strength of the first one; the rest are corroboration, and each
// counts for less than the one above it. Without this, a locker room that has
// been running for six months is one where the best-connected person has every
// motive at once and crosses the acting line every single time — which is how
// "who steps in" stops being a question.
const CORROBORATION = 0.45;

export const MOTIVES = {
  alliance: 'friendship',
  faction: 'faction loyalty',
  partner: 'their tag partner',
  mentor: 'the one who brought them up',
  love: 'something more than friendship',
  debt: 'a debt',
  revenge: 'revenge',
  morality: 'principle',
  interest: 'self-interest',
  respect: 'respect',
  ambition: 'ambition',
};

// A named tie is not a friendship with a bigger number on it. Somebody goes for
// their tag partner without thinking about it, and the reason they give is the
// tie itself.
const TIE_MOTIVE = {
  'tag-team': { motive: 'partner', pull: 34 },
  allies: { motive: 'alliance', pull: 30 },
  faction: { motive: 'faction', pull: 30 },
  romance: { motive: 'love', pull: 40 },
  mentor: { motive: 'mentor', pull: 28 },
  student: { motive: 'mentor', pull: 30 },
};

function bond(wrestler, otherId) {
  return wrestler.relationships[otherId] || { matches: 0, segments: 0, owed: 0, tie: null };
}

function grudgesAgainst(wrestler, targetId) {
  return wrestler.grudges.filter(g => g.targetId === targetId).length;
}

// Anybody the candidate is scheduled with later tonight is somebody they need
// standing up.
function sharesLaterItem(state, candidateId, otherId, fromIndex) {
  return state.show.items.slice(fromIndex + 1).some(item =>
    item.participants.includes(candidateId) && item.participants.includes(otherId)
  );
}

function isBusyLater(state, candidateId, fromIndex) {
  return state.show.items.slice(fromIndex + 1).some(item => item.participants.includes(candidateId));
}

// Returns the strongest reason this wrestler has to get involved, and the net
// pull. A negative or small total means they stay where they are.
export function weigh(state, { victimId, aggressorId, fromIndex = 0 }, candidate) {
  const victim = byId(state.wrestlers, victimId);
  const aggressor = byId(state.wrestlers, aggressorId);
  if (!victim || !aggressor) return null;

  const toVictim = bond(candidate, victimId);
  const toAggressor = bond(candidate, aggressorId);

  const pulls = [];
  const pull = (motive, value) => {
    if (value > 0) pulls.push({ motive, value });
  };

  // Loyalty decides whether anybody else's trouble is their business at all;
  // selfishness decides whether they would rather it were not.
  const forOthers = scale(candidate, 'loyalty', 0.8) * (1 - lean(candidate, 'selfishness') * 0.4);

  // A named tie — a tag partner, a faction, the one who brought them up, or
  // something more than that — outranks anything the counts would have said,
  // and is its own stated reason.
  const named = toVictim.tie ? TIE_MOTIVE[toVictim.tie] : null;
  if (named) {
    pull(named.motive, named.pull * forOthers);
  } else if (toVictim.segments >= 4) {
    // Past a certain depth standing together stops being friendship and starts
    // being a faction, so the two are exclusive and both get to be a reason.
    pull('faction', Math.min(toVictim.segments, HISTORY_CAP) * 4 * forOthers);
  } else {
    pull('alliance', Math.min(toVictim.segments, HISTORY_CAP) * 5 * forOthers);
  }
  // They were helped once, and that is remembered — by the sort of person who
  // remembers that kind of thing.
  pull('debt', Math.min(toVictim.owed || 0, DEBT_CAP) * 11 * scale(candidate, 'loyalty', 0.5));
  // They would cross the building to get at the attacker.
  pull('revenge', (Math.min(toAggressor.matches, HISTORY_CAP) * 3
    + grudgesAgainst(candidate, aggressorId) * 13) * scale(candidate, 'vindictiveness', 0.5));
  // Some people just think it is wrong.
  // A principled veteran will go for somebody they have never spoken to. An
  // ordinary babyface needs a reason of their own on top of this.
  //
  // And principle is not blind: almost nobody crosses the building out of
  // simple decency for a heel who has it coming. That is what makes "nobody
  // moved" a situational story about who the victim is, rather than a dice
  // roll — get jumped as a hated heel and you find out how alone you are.
  const worthSaving = victim.alignment === 'Face' ? 1 : victim.alignment === 'Neutral' ? 0.55 : 0.15;
  pull('morality', candidate.alignment === 'Face'
    ? (6 + trait(candidate, 'professionalism') / 8) * worthSaving * forOthers
    : 0);
  // They need this person upright for their own match — and the more somebody
  // is looking after themself, the more that particular reason weighs.
  pull('interest', sharesLaterItem(state, candidate.id, victimId, fromIndex)
    ? 19 * scale(candidate, 'selfishness', 0.4)
    : 0);
  // They barely know them, but they know what they have done.
  pull('respect', victim.role === 'Main event' ? 7 : victim.role === 'Upper card' ? 4 : 0);
  // A chance to be in something that matters, for somebody who needs one.
  const ambition = trait(candidate, 'ambition');
  pull('ambition', ambition > 70 ? (ambition - 60) / 3 + candidate.weeksOffCard * 3 : 0);

  // Fear of whoever is doing the beating, sharpened by a lack of
  // professionalism and answered by nerve. Courage is the trait that decides
  // whether the size of the other one is a reason to stay where you are.
  //
  // The baseline matters: running into somebody else's fight is never free,
  // even against a smaller opponent. Without it, fear is zero for anybody who
  // outranks the aggressor and courage has nothing to push against in most of
  // the situations where it should be the deciding trait.
  const BASE_FEAR = 5;
  let fear = BASE_FEAR + Math.max(0, aggressor.stats.inRing - candidate.stats.inRing) / 4;
  if (trait(candidate, 'professionalism') < 40) fear *= 1.6;
  // Nought for somebody who walks into anything, double for somebody who does
  // not. Courage is the only trait acting on this term, so it has to carry the
  // full range or it is decoration.
  fear *= Math.max(0, 1 - lean(candidate, 'courage'));
  // They think the victim has it coming, and how long they have thought it is
  // a matter of how long they hold things.
  const spite = ((candidate.alignment === 'Heel' ? Math.min(toVictim.matches, HISTORY_CAP) * 2 : 0)
    + grudgesAgainst(candidate, victimId) * 13) * scale(candidate, 'vindictiveness', 0.4);
  // They have somewhere to be.
  const busy = isBusyLater(state, candidate.id, fromIndex) ? 5 : 0;

  // Strongest reason first, everything after it discounted. The strongest is
  // also the one they would give if asked, which is what the journal prints.
  pulls.sort((a, b) => b.value - a.value);
  let total = 0;
  for (let i = 0; i < pulls.length; i += 1) total += pulls[i].value * CORROBORATION ** i;

  // Kept apart from the total on purpose. Somebody whose reasons were strong
  // and whose nerve was not is a different story from somebody who had no
  // reason at all, and the only way to tell them apart afterwards is to have
  // not added them together in the first place.
  const deterrent = fear + spite + busy;
  return {
    candidate,
    total: total - deterrent,
    pull: total,
    deterrent,
    motive: pulls.length ? pulls[0].motive : 'morality',
  };
}

// Everyone who could plausibly see it.
//
// Where it happens changes who that is, and it changes it a lot. Something that
// goes out on camera is on every monitor in the building, so the whole locker
// room can come sprinting through the curtain. Something in a corridor is seen
// by whoever is in that corridor and heard by the room next door, and that is
// the entire list. It is why "nobody moved" is common backstage and rare on
// television, without either being a tuned number.
function candidates(state, involved, locationId) {
  const pool = state.wrestlers.filter(w => w.status === 'Available' && !involved.has(w.id));
  // Before the backstage layer places anybody — an old save mid-show, or a
  // staged test — everybody is simply present.
  if (!state.whereabouts || !locationId || locationId === 'gorilla') return pool;
  return pool.filter(w => {
    const room = roomOf(state, w.id);
    return room && hops(room, locationId) <= 1;
  });
}

// Somebody who wades in to *stop* it rather than to take a side.
//
// This is how a chain ends without a counter running out. A pro with respect
// for the place walks between them, and it is over — which is a far better
// ending than a depth limit, and it means the locker room contains somebody
// whose function is to be the adult.
const PEACEMAKER_AT = 70;
// How much of a reason the next one in needs before they get there first. A
// peacemaker heads off somebody who was only just going to pile in; somebody
// with a real score to settle goes straight past them.
const PUSHES_PAST = 5;
// How far past the acting line somebody's reasons have to be before standing
// still is a story about them rather than about the situation.
const BALK_AT = 6;
const BALK_BEATS_WAVER = 8;

function peacemakerScore(candidate) {
  return (trait(candidate, 'professionalism') + trait(candidate, 'authority')) / 2
    - Math.max(0, lean(candidate, 'aggression')) * 20
    - Math.max(0, -lean(candidate, 'courage')) * 25;
}

// Everyone arriving with the actor.
//
// The unit is *theirs*, not a property of who they are running out to help: a
// faction does not send a representative and then wait to see how it goes. So
// whoever comes as a unit with the person who went comes too, whether or not
// they have ever spoken to the wrestler on the floor — which is exactly how a
// two-person problem becomes a six-person one without anybody booking it.
const CREW_TIES = new Set(['faction', 'tag-team']);
const CREW_LIMIT = 2;

function crewWith(state, actor, victimId, involved, locationId) {
  return Object.entries(actor.relationships || {})
    .filter(([id, rel]) => CREW_TIES.has(rel.tie) && id !== victimId && !involved.has(id))
    .map(([id]) => byId(state.wrestlers, id))
    .filter(other => other && other.status === 'Available' && inReach(state, other, locationId))
    .slice(0, CREW_LIMIT);
}

function inReach(state, wrestler, locationId) {
  if (!state.whereabouts || !locationId || locationId === 'gorilla') return true;
  const room = roomOf(state, wrestler.id);
  return Boolean(room) && hops(room, locationId) <= 1;
}

// One pass over the room. Five things can come out of it, and four of them are
// somebody not helping.
export function resolveReaction(state, event, involved, depth = 0) {
  const empty = { actor: null, crew: [], hesitator: null, balker: null, peacemaker: null };
  if (depth >= MAX_DEPTH) return empty;

  const field = candidates(state, involved, event.locationId);
  const weighed = field
    .map(candidate => weigh(state, event, candidate))
    .filter(Boolean)
    .sort((a, b) => b.total - a.total);

  // Each link in a chain is harder to justify than the last — but how much
  // harder is a question about the person. Being the third one in is a matter
  // of nerve more than of motive, so courage is what shortens that distance.
  const barFor = candidate =>
    ACT_AT + depth * DEPTH_PENALTY * (1 - lean(candidate, 'courage') * 0.4);

  const actor = weighed.find(entry => entry.total >= barFor(entry.candidate)) || null;

  // Once it is more than two people the question stops being "whose side" and
  // starts being "is anybody going to stop this".
  //
  // It is a race rather than an override. Somebody calm enough to walk between
  // them heads off a wrestler who was only just about to pile in — but anybody
  // with a real reason goes straight past, which is what keeps a genuine
  // five-person chain possible instead of the adult in the room ending every
  // one of them at the first opportunity.
  if (depth >= 1) {
    const margin = actor ? actor.total - barFor(actor.candidate) : Infinity;
    if (margin < PUSHES_PAST) {
      const calm = field
        .map(candidate => ({ candidate, score: peacemakerScore(candidate) }))
        .filter(entry => entry.score >= PEACEMAKER_AT)
        .sort((a, b) => b.score - a.score)[0];
      if (calm) return { ...empty, peacemaker: calm };
    }
  }

  if (actor) {
    return {
      ...empty,
      actor,
      crew: crewWith(state, actor.candidate, event.victimId, involved, event.locationId),
    };
  }

  // Two ways of not going, and they are different stories.
  //
  // A hesitator came out and thought better of it: their total landed just
  // below the line. A balker never moved — their *reasons* were overwhelming
  // and their nerve was the only thing that decided it, which is the quietest
  // and worst thing in the game. That one is rarer and lands harder, so a big
  // enough pull beats somebody merely wavering.
  const hesitator = weighed.find(entry => entry.total >= HESITATE_AT) || null;
  const balker = weighed.find(entry =>
    entry.pull >= barFor(entry.candidate) + BALK_AT
    && entry.total < HESITATE_AT
    && lean(entry.candidate, 'courage') < 0) || null;

  if (balker && (!hesitator || balker.pull >= hesitator.pull + BALK_BEATS_WAVER)) {
    return { ...empty, balker };
  }
  if (hesitator) return { ...empty, hesitator };
  return { ...empty, balker };
}
