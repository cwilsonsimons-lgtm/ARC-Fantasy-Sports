// How each wrestler feels about a stipulation, and how good they actually are
// at it. These are two separate hidden values and they are deliberately not
// correlated:
//
//   taste     do they want this match?     drives morale, and grudges
//   aptitude  are they good at it?         drives who wins
//
// The interesting quadrant is low taste and high aptitude — a wrestler who
// hates the cage but is excellent inside one. Book it and you win the match and
// lose the man. That choice is the point of the system.
//
// Both are stored sparsely: a wrestler only carries entries for stipulations
// they have an opinion about. Anything absent is indifference, and aptitude
// falls back to their general in-ring ability.
import { knowledgeTier } from './stats.js';
import { matchType } from '../data/match-types.js';

const NEUTRAL_TASTE = 50;

const TASTE_BANDS = [
  [80, 'Loves it', 'good'],
  [62, 'Happy to', 'fine'],
  [38, 'No strong feelings', 'plain'],
  [20, 'Dislikes it', 'warn'],
  [0, 'Hates it', 'bad'],
];

const APTITUDE_BANDS = [
  [82, 'Elite'],
  [68, 'Excellent'],
  [54, 'Good'],
  [40, 'Average'],
  [24, 'Poor'],
  [0, 'Terrible'],
];

export function tasteOf(wrestler, typeId) {
  const entry = wrestler.matchTypes && wrestler.matchTypes[typeId];
  return entry && entry.taste !== undefined ? entry.taste : NEUTRAL_TASTE;
}

export function aptitudeOf(wrestler, typeId) {
  const entry = wrestler.matchTypes && wrestler.matchTypes[typeId];
  if (entry && entry.aptitude !== undefined) return entry.aptitude;
  return wrestler.stats.inRing;
}

function band(bands, value) {
  return bands.find(([floor]) => value >= floor) || bands[bands.length - 1];
}

// What somebody likes is something they will tell you, so it surfaces as soon
// as you have any read on them at all.
export function tasteReading(wrestler, typeId) {
  if (knowledgeTier(wrestler) === 'unread') return null;
  const [, word, tone] = band(TASTE_BANDS, tasteOf(wrestler, typeId));
  return { word, tone };
}

// How good they actually are is something you only learn by watching, so it
// takes a full read.
export function aptitudeReading(wrestler, typeId) {
  if (knowledgeTier(wrestler) !== 'known') return null;
  return band(APTITUDE_BANDS, aptitudeOf(wrestler, typeId))[1];
}

export function loves(wrestler, typeId) {
  return tasteOf(wrestler, typeId) >= 80;
}

export function hates(wrestler, typeId) {
  return tasteOf(wrestler, typeId) < 20;
}

// The stipulations a wrestler feels strongly about, for their card. Sorted
// best-liked first so favourites lead and the refusals sit at the bottom.
export function opinions(wrestler) {
  const ids = Object.keys(wrestler.matchTypes || {});
  return ids
    .map(id => ({ type: matchType(id), taste: tasteOf(wrestler, id) }))
    .filter(entry => entry.taste >= 62 || entry.taste < 38)
    .sort((a, b) => b.taste - a.taste);
}
