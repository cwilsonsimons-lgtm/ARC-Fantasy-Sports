// How a wrestler regards a booking.
//
// This is the data layer for behaviour, not the behaviour itself. It answers
// "how would this person take this?" and shows its working. Nothing here
// refuses anything, blocks anything, or creates an incident: Tier 4's job is to
// give the game the judgement it needs, and the tier that generates reactions
// will roll against what this returns.
//
// Everything is pure. It reads the store and returns a number with reasons.
//
// The central rule of the tier lives at the bottom of `regard()`: STANDING
// BUYS THE RIGHT TO SAY NO. A rookie with a superstar's ego still accepts,
// because refusing is not available to someone with no standing. A superstar
// with a rookie's humility can still refuse, because it is. That is enforced as
// a floor under the final number rather than as a special case, so it holds for
// every ask without anyone remembering to check.

import * as store from '../core/store.js';
import {
  CAREER_RANK, TOP_STATUS_RANK, TRAJECTORY,
  statusRank, standingWeight, relationshipTo, memoryWeightOn,
} from '../models/wrestler.js';
import { formatOf } from './formats.js';
import { SEGMENT_KINDS } from '../models/segment.js';

/** What they would most likely do. A tendency, not a roll. */
export const RESPONSE = Object.freeze({
  ACCEPT: 'accept',
  GRUDGING: 'accept_grudgingly',
  PUSH_BACK: 'push_back',
  REFUSE: 'refuse',
});

export const RESPONSE_LABEL = Object.freeze({
  [RESPONSE.ACCEPT]: 'Accepts',
  [RESPONSE.GRUDGING]: 'Accepts, unhappy',
  [RESPONSE.PUSH_BACK]: 'Pushes back',
  [RESPONSE.REFUSE]: 'Refuses',
});

const THRESHOLDS = Object.freeze([
  [72, RESPONSE.ACCEPT],
  [52, RESPONSE.GRUDGING],
  [32, RESPONSE.PUSH_BACK],
  [0, RESPONSE.REFUSE],
]);

export function responseFor(willingness) {
  return THRESHOLDS.find(([min]) => willingness >= min)[1];
}

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/**
 * The lowest a wrestler of this standing can fall.
 * Rookie 88 (accepts essentially anything) down to superstar 8 (can refuse).
 */
export function refusalFloor(wrestler) {
  return 88 - standingWeight(wrestler) * 80;
}

/** Roughly where on the card someone of this status expects to be, 0 to 1. */
export function expectedSlot(wrestler) {
  return statusRank(wrestler) / TOP_STATUS_RANK;
}

/** Roughly how much ring time they think they are worth, in minutes. */
export function expectedMinutes(wrestler) {
  return 6 + statusRank(wrestler) * 2.5;
}

/**
 * How a wrestler regards one booking.
 *
 * `ask` describes the spot, not the outcome: opponents, format, time limit,
 * where it sits on the card, and whether a title is on the line. Nobody knows
 * who is going over at this point, including the GM.
 */
export function regard(wrestlerId, ask = {}) {
  const w = store.requireWrestler(wrestlerId);
  const {
    opponentIds = [], partnerIds = [], formatKey = 'singles',
    timeLimitSec = 10 * 60, cardIndex = null, cardLength = null,
    titleId = null,
  } = ask;

  const t = w.identity.traits;
  const reasons = [];
  const add = (delta, text) => {
    if (Math.abs(delta) < 2.5) return 0;
    reasons.push({ delta: Math.round(delta * 10) / 10, text });
    return delta;
  };

  // --- who they are, before anything is asked of them ---
  let willingness = 50
    + t.professionalism * 0.30
    + t.respectForAuthority * 0.22
    + t.patience * 0.08
    - w.identity.ego * 0.28;

  const disposition = willingness;
  reasons.push({
    delta: Math.round((disposition - 50) * 10) / 10,
    text: disposition >= 50
      ? 'Professional, and defers to the office'
      : 'Carries enough ego to argue with the office',
    base: true,
  });

  // --- what they currently think of you, and of everything ---
  willingness += add((w.ties.gm.trust - 50) * 0.22,
    w.ties.gm.trust >= 50 ? 'Takes you at your word' : 'Does not take you at your word');
  willingness += add((w.ties.gm.respect - 50) * 0.10,
    w.ties.gm.respect >= 50 ? 'Rates you as a GM' : 'Does not rate you as a GM');
  willingness += add((w.state.morale - 50) * 0.14,
    w.state.morale >= 50 ? 'In reasonable spirits' : 'Unhappy at the moment');

  // --- is this opponent worth their time, or above their station? ---
  if (opponentIds.length) {
    const theirRank = Math.max(...opponentIds.map((id) => CAREER_RANK[store.getWrestler(id)?.standing.careerStatus] ?? 3));
    const gap = statusRank(w) - theirRank;
    const names = opponentIds.map(store.nameOf).join(' and ');
    if (gap > 0) {
      willingness += add(-gap * 4.5 * (0.4 + w.identity.ego / 120),
        `Thinks ${names} is beneath them`);
    } else if (gap < 0) {
      willingness += add(-gap * 6 * (0.4 + w.identity.ambition / 100),
        `A chance against ${names}`);
    }

    // A grudge is a reason to WANT the match, not to duck it.
    const today = store.today();
    let grudge = 0;
    for (const m of w.memory) {
      if (!m.aboutIds.some((id) => opponentIds.includes(id))) continue;
      if (!['loss', 'upset_loss', 'cheated', 'humiliation', 'title_loss', 'gm_promise_broken'].includes(m.type)) continue;
      grudge = Math.max(grudge, memoryWeightOn(m, today));
    }
    if (grudge) {
      willingness += add(grudge * 0.15 * (0.3 + t.aggression / 100),
        `Has something to settle with ${names}`);
    }
  }

  // --- who they have been put with ---
  for (const partnerId of partnerIds) {
    const feeling = relationshipTo(w, partnerId);
    if (feeling < -25) {
      willingness += add(feeling * 0.25 * (0.5 + t.vindictiveness / 100),
        `Does not want to be in a team with ${store.nameOf(partnerId)}`);
    } else if (feeling > 35) {
      willingness += add(feeling * 0.12 * (0.5 + t.loyalty / 100),
        `Happy to work with ${store.nameOf(partnerId)}`);
    }
  }

  // --- where on the card, which is the loudest statement the GM makes ---
  if (cardIndex != null && cardLength > 1) {
    const actual = cardIndex / (cardLength - 1);
    const slip = expectedSlot(w) - actual;
    if (slip > 0.25) {
      willingness += add(-slip * 30 * (0.4 + w.identity.ego / 100),
        cardIndex === 0 ? 'Being asked to open the show' : 'Placed lower on the card than they expect');
    } else if (slip < -0.3) {
      willingness += add(-slip * 14 * (0.3 + w.identity.ambition / 100),
        'Placed higher on the card than they expect');
    }
  }

  // --- the time limit is a statement about their worth too ---
  const limitMin = timeLimitSec / 60;
  const wanted = expectedMinutes(w);
  if (limitMin < wanted * 0.6) {
    willingness += add(-(1 - limitMin / (wanted * 0.6)) * 25 * (0.5 + w.identity.ego / 100),
      `Only ${Math.round(limitMin)} minutes for someone of their standing`);
  }

  // --- risk, which is what courage is for ---
  if (limitMin > 20) {
    willingness += add(-(limitMin - 20) * 0.8 * (1 - t.courage / 100),
      'A longer match than they are comfortable with');
  }
  if (w.state.condition < 60) {
    willingness += add(-(60 - w.state.condition) * 0.25 * (1 - t.courage / 100),
      'Carrying too much wear to want this');
  }
  if (formatOf(formatKey).kind !== SEGMENT_KINDS.MATCH) {
    willingness += add(12 * (0.3 + t.sociability / 100), 'A segment rather than a match');
  }

  // --- a championship changes what an ask is worth ---
  if (titleId) {
    const title = store.getTitle(titleId);
    const holding = title && store.titlesHeldBy(wrestlerId).some((x) => x.id === title.id);
    willingness += holding
      ? add(9, `Defending the ${title.shortName} title`)
      : add(20 * (0.4 + w.identity.ambition / 100), `A shot at the ${title.shortName} title`);
  }

  // --- which way their career is pointing ---
  if (w.standing.trajectory === TRAJECTORY.DECLINING) {
    willingness += add(-7 * (0.5 + t.jealousy / 100), 'Believes they are being written off');
  } else if (w.standing.trajectory === TRAJECTORY.RISING) {
    willingness += add(5, 'On the way up and taking what is offered');
  }

  const raw = clamp(willingness);

  // --- standing buys the right to say no ---
  //
  // The floor only counts as having held someone up when it changed what they
  // would actually DO. A superstar whose raw willingness sits below their floor
  // is still refusing, and saying they lack the standing to refuse would be
  // exactly backwards.
  const floor = refusalFloor(w);
  const final = Math.round(Math.max(raw, floor));
  const held = raw < floor && responseFor(final) !== responseFor(raw);
  if (held) {
    reasons.push({
      delta: Math.round((floor - raw) * 10) / 10,
      text: 'Has no standing to refuse, whatever they think of it',
      floor: true,
    });
  }

  return {
    wrestlerId,
    willingness: final,
    raw: Math.round(raw),
    floor: Math.round(floor),
    heldUpByStanding: held,
    likely: responseFor(final),
    reasons: reasons.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
  };
}

/** Everyone in a segment, and how each of them takes it. */
export function regardSegment(segment, { cardIndex = null, cardLength = null } = {}) {
  const bySide = {};
  for (const p of segment.participants) (bySide[p.side] ||= []).push(p.wrestlerId);

  return segment.participants.map((p) => {
    const mine = bySide[p.side] || [];
    const opponentIds = Object.entries(bySide)
      .filter(([side]) => side !== p.side)
      .flatMap(([, ids]) => ids);
    return regard(p.wrestlerId, {
      opponentIds,
      partnerIds: mine.filter((id) => id !== p.wrestlerId),
      formatKey: segment.format,
      timeLimitSec: segment.timeLimitSec,
      titleId: segment.titleId,
      cardIndex, cardLength,
    });
  });
}

/** The unhappiest person in a segment, which is the one worth looking at. */
export function worstRegard(segment, opts) {
  return regardSegment(segment, opts).sort((a, b) => a.willingness - b.willingness)[0] || null;
}
