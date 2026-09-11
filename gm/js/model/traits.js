// Who somebody is, as distinct from what they can do.
//
// Ability decides matches. Personality decides everything else — what registers
// as a slight, how long it is held, whether they go when somebody is being
// beaten, and whether your word counts for anything. Every trait below has at
// least one real effect somewhere; a trait that only shows on a card is
// decoration.
//
// `words` are what the player sees once they know somebody: high, middling,
// low. Never a number, and never a bare "78 ego" — the point of a personality
// is that you read it off a person, not off a bar.
export const TRAITS = [
  {
    key: 'ego', label: 'Ego', note: 'How much the size of the spot matters.',
    words: ['Enormous', 'Healthy', 'Puts on no airs'],
  },
  {
    key: 'ambition', label: 'Ambition', note: 'How hard being overlooked lands.',
    words: ['Burning', 'Present', 'Content where they are'],
  },
  {
    key: 'aggression', label: 'Aggression', note: 'How readily they put hands on somebody.',
    words: ['Quick to swing', 'Even-tempered', 'Never raises a hand'],
  },
  {
    key: 'patience', label: 'Patience', note: 'How long they will let something go.',
    words: ['Will wait years', 'Ordinary', 'None at all'],
  },
  {
    key: 'professionalism', label: 'Professionalism', note: 'How evenly they take news.',
    words: ['Total', 'Reliable enough', 'A liability'],
  },
  {
    key: 'loyalty', label: 'Loyalty', note: "Whether their friends' treatment is their business.",
    words: ['Unshakeable', 'Ordinary', 'Own corner only'],
  },
  {
    key: 'jealousy', label: 'Jealousy', note: "How much somebody else's night bothers them.",
    words: ["Counts everyone's minutes", 'Ordinary', 'Happy for anybody'],
  },
  {
    key: 'courage', label: 'Courage', note: 'Whether the size of the other one stops them.',
    words: ['Walks into anything', 'Ordinary', 'Stays well out of it'],
  },
  {
    key: 'authority', label: 'Respect for authority', note: 'How much your word counts with them.',
    words: ['Respects the office', 'Ordinary', 'Answers to nobody'],
  },
  {
    key: 'vindictiveness', label: 'Vindictiveness', note: 'How long they hold on to it.',
    words: ['Forgets nothing', 'Ordinary', 'Lets things go'],
  },
  {
    key: 'selfishness', label: 'Selfishness', note: "Whether anyone else's problem is their problem.",
    words: ['Looks after themself', 'Ordinary', 'Puts others first'],
  },
];

export const ABILITIES = [
  { key: 'inRing', label: 'In-ring', note: 'Decides matches.' },
  { key: 'charisma', label: 'Charisma', note: 'What they get out of a microphone.' },
];

export const DEFAULT_TRAIT_BAND = [38, 62];

export const TRAIT_KEYS = TRAITS.map(t => t.key);

export function traitSpec(key) {
  return TRAITS.find(t => t.key === key) || null;
}

// Reads a trait with a sane fallback, so a save written before a trait existed
// does not turn every calculation into NaN.
export function trait(wrestler, key) {
  const value = wrestler && wrestler.traits ? wrestler.traits[key] : undefined;
  return Number.isFinite(value) ? value : 50;
}

// -1 at zero, 0 at the midpoint, +1 at a hundred. Most effects want this rather
// than the raw value.
export function lean(wrestler, key) {
  return (trait(wrestler, key) - 50) / 50;
}

// A multiplier centred on 1. `spread` is how far the trait can push it, so
// scale(w, 'loyalty', 0.5) runs 0.5x for somebody with none to 1.5x for
// somebody who has nothing but.
export function scale(wrestler, key, spread) {
  return 1 + lean(wrestler, key) * spread;
}
