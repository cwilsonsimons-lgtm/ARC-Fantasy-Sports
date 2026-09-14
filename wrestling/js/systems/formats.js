// Segment formats: what you can put on a card, and the shape it takes.
//
// One table covers matches and non-match segments, because the segment model
// covers both. A format declares its sides and how many people stand on each,
// which is all the booking screen needs to draw the right number of slots and
// all the simulation needs to know who is working whom.
//
// `sideSizes` is exact. A format that needs a different head count is a
// different format, which keeps booking unambiguous and the sim free of
// special cases.

import { SEGMENT_KINDS } from '../models/segment.js';

export const FORMATS = Object.freeze({
  // ---- matches ----
  singles: {
    label: 'Singles', kind: SEGMENT_KINDS.MATCH,
    sideSizes: [1, 1], defaultLimitSec: 12 * 60,
  },
  tag: {
    label: 'Tag Team', kind: SEGMENT_KINDS.MATCH,
    sideSizes: [2, 2], defaultLimitSec: 15 * 60,
  },
  triple_threat: {
    label: 'Triple Threat', kind: SEGMENT_KINDS.MATCH,
    sideSizes: [1, 1, 1], defaultLimitSec: 15 * 60,
  },
  fatal_four_way: {
    label: 'Fatal Four-Way', kind: SEGMENT_KINDS.MATCH,
    sideSizes: [1, 1, 1, 1], defaultLimitSec: 15 * 60,
  },
  six_man_tag: {
    label: 'Six-Man Tag', kind: SEGMENT_KINDS.MATCH,
    sideSizes: [3, 3], defaultLimitSec: 18 * 60,
  },
  handicap: {
    label: 'Handicap', kind: SEGMENT_KINDS.MATCH,
    sideSizes: [1, 2], defaultLimitSec: 10 * 60,
  },

  // ---- segments ----
  promo: {
    label: 'Promo', kind: SEGMENT_KINDS.PROMO,
    sideSizes: [1], defaultLimitSec: 5 * 60,
  },
  face_to_face: {
    label: 'Face-to-Face Promo', kind: SEGMENT_KINDS.PROMO,
    sideSizes: [1, 1], defaultLimitSec: 7 * 60,
  },
  interview: {
    label: 'Backstage Interview', kind: SEGMENT_KINDS.INTERVIEW,
    sideSizes: [1], defaultLimitSec: 3 * 60,
  },
  angle: {
    label: 'Angle', kind: SEGMENT_KINDS.ANGLE,
    sideSizes: [1, 1], defaultLimitSec: 4 * 60,
  },
});

export const FORMAT_KEYS = Object.freeze(Object.keys(FORMATS));

export const MATCH_FORMATS = Object.freeze(
  FORMAT_KEYS.filter((k) => FORMATS[k].kind === SEGMENT_KINDS.MATCH)
);
export const SEGMENT_FORMATS = Object.freeze(
  FORMAT_KEYS.filter((k) => FORMATS[k].kind !== SEGMENT_KINDS.MATCH)
);

export function formatOf(key) {
  return FORMATS[key] || FORMATS.singles;
}

/** Total people a format needs. */
export function slotCount(key) {
  return formatOf(key).sideSizes.reduce((a, b) => a + b, 0);
}

/** Side letters: 'a', 'b', 'c', ... one per side. */
export function sideKeys(key) {
  return formatOf(key).sideSizes.map((_, i) => String.fromCharCode(97 + i));
}

/**
 * Flat slot descriptors for the booking form, in order:
 * [{side:'a', index:0, label:'Side A'}, ...]
 */
export function slotsFor(key) {
  const { sideSizes } = formatOf(key);
  const out = [];
  sideSizes.forEach((size, s) => {
    const side = String.fromCharCode(97 + s);
    for (let i = 0; i < size; i++) {
      out.push({
        side,
        index: i,
        label: sideSizes.length === 1
          ? (size === 1 ? 'Wrestler' : `Wrestler ${i + 1}`)
          : `Side ${side.toUpperCase()}${size > 1 ? ` (${i + 1})` : ''}`,
      });
    }
  });
  return out;
}

/**
 * A readable name built from who is in it, so the GM does not have to type one.
 * "Croft vs Vance", "Kane & Pike vs Wren & Delacroix", "Vance promo".
 */
export function autoName(formatKey, participants, nameOf) {
  const format = formatOf(formatKey);
  const bySide = new Map();
  for (const p of participants) {
    if (!bySide.has(p.side)) bySide.set(p.side, []);
    bySide.get(p.side).push(nameOf(p.wrestlerId));
  }
  const groups = [...bySide.values()].map((names) => names.join(' & '));
  if (!groups.length) return format.label;
  if (format.kind === SEGMENT_KINDS.MATCH) return groups.join(' vs ');
  if (formatKey === 'promo') return `${groups[0]} promo`;
  if (formatKey === 'interview') return `${groups[0]} interview`;
  return groups.join(' and ');
}
