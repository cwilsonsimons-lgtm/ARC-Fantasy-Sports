// What the GM knows about a wrestler, and how surely.
//
// Stats are 0-100 under the hood and are never shown as numbers. What the
// player gets is a *reading*, and the reading sharpens as their familiarity
// grows — vague at first, then specific. Being wrong early is the point.
//
// Familiarity grows from simple exposure: every week a wrestler is on the
// roster, and more sharply every time they are actually booked. You learn
// people by working with them.

export const STATS = [
  { key: 'inRing',          label: 'In-ring',         note: 'Decides matches.' },
  { key: 'charisma',        label: 'Charisma',        note: 'What they get out of a microphone.' },
  { key: 'ambition',        label: 'Ambition',        note: 'How hard being left off lands.' },
  { key: 'ego',             label: 'Ego',             note: 'How much the size of the spot matters.' },
  { key: 'professionalism', label: 'Professionalism', note: 'How evenly they take news.' },
];

export const FAMILIARITY_PER_WEEK = 2;
export const FAMILIARITY_PER_BOOKING = 7;
const IMPRESSION_AT = 25;
const KNOWN_AT = 60;

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
  const bands = tier === 'known' ? PRECISE : ROUGH;
  return bands.find(([floor]) => value >= floor)[1];
}

export function growFamiliarity(wrestler, booked) {
  const gain = FAMILIARITY_PER_WEEK + (booked ? FAMILIARITY_PER_BOOKING : 0);
  wrestler.familiarity = Math.min(100, (wrestler.familiarity || 0) + gain);
}
