// What the GM knows about a wrestler, and how surely.
//
// Nothing is ever shown as a number. What the player gets is a *reading*, and
// the reading sharpens as their familiarity grows — vague at first, then
// specific. Being wrong early is the point.
//
// Familiarity grows from simple exposure: every week a wrestler is on the
// roster, and more sharply every time they are actually booked. You learn
// people by working with them.
//
// Ability and personality reveal at different speeds, because they are learned
// differently. You can watch somebody wrestle once and have an opinion about
// how good they are. Working out whether they hold a grudge takes considerably
// longer, and you usually find out the hard way.
import { TRAITS, trait } from './traits.js';

export { ABILITIES } from './traits.js';

export const FAMILIARITY_PER_WEEK = 2;
export const FAMILIARITY_PER_BOOKING = 7;
const IMPRESSION_AT = 25;
const KNOWN_AT = 60;
const PERSONALITY_IMPRESSION_AT = 42;
const PERSONALITY_KNOWN_AT = 80;

// Centred so that a middling value reads as middling. A scale where 44 comes
// back as "Good" quietly tells the player everyone is fine.
const PRECISE = [
  [82, 'Elite'],
  [68, 'Excellent'],
  [54, 'Good'],
  [40, 'Average'],
  [24, 'Poor'],
  [0, 'Terrible'],
];

const ROUGH = [
  [67, 'Above average'],
  [34, 'About average'],
  [0, 'Below average'],
];

export function knowledgeTier(wrestler) {
  const f = wrestler.familiarity || 0;
  if (f >= KNOWN_AT) return 'known';
  if (f >= IMPRESSION_AT) return 'impression';
  return 'unread';
}

// Personality lags ability. Somebody can be a known quantity in the ring and
// still a stranger backstage, which is exactly the gap the game is about.
export function personalityTier(wrestler) {
  const f = wrestler.familiarity || 0;
  if (f >= PERSONALITY_KNOWN_AT) return 'known';
  if (f >= PERSONALITY_IMPRESSION_AT) return 'impression';
  return 'unread';
}

export function knowledgeLabel(wrestler) {
  const tier = knowledgeTier(wrestler);
  if (tier === 'known') return 'You know this one';
  if (tier === 'impression') return 'You are starting to get a read';
  return 'You barely know them';
}

// Percentage toward a complete read, for the progress bar. This is a measure of
// the player's own knowledge, not of the wrestler, so it is honest to show it.
export function knowledgePercent(wrestler) {
  return Math.min(100, Math.round(wrestler.familiarity || 0));
}

// A word, never a number. Null means the player has no read at all yet.
export function statReading(wrestler, key) {
  const tier = knowledgeTier(wrestler);
  if (tier === 'unread') return null;
  const value = wrestler.stats[key];
  if (!Number.isFinite(value)) return null;
  const bands = tier === 'known' ? PRECISE : ROUGH;
  return bands.find(([floor]) => value >= floor)[1];
}

// The same idea for personality, in that trait's own language: a known read on
// somebody's ego says "Enormous", not "Elite".
//
// `notable` is whether this is worth the player's attention at all. Most people
// are unremarkable on most axes, and a card where all eleven lines shout is a
// card where none of them do.
export function traitReading(wrestler, key) {
  const tier = personalityTier(wrestler);
  if (tier === 'unread') return null;

  const spec = TRAITS.find(t => t.key === key);
  const value = trait(wrestler, key);

  if (tier === 'known' && spec) {
    if (value >= 66) return { word: spec.words[0], notable: true };
    if (value >= 38) return { word: spec.words[1], notable: false };
    return { word: spec.words[2], notable: true };
  }
  const word = ROUGH.find(([floor]) => value >= floor)[1];
  return { word, notable: word !== 'About average' };
}

export function growFamiliarity(wrestler, booked) {
  const gain = FAMILIARITY_PER_WEEK + (booked ? FAMILIARITY_PER_BOOKING : 0);
  wrestler.familiarity = Math.min(100, (wrestler.familiarity || 0) + gain);
}
