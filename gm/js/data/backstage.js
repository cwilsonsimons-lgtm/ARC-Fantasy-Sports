// What can go wrong backstage, and what they want out of it.
//
// Every entry is a *situation*, not a verdict. The catalogue says what kind of
// thing it is, how big it reads before anybody responds, and where in the
// building it happens — because where it happens decides whether the GM is
// standing there when it does.
//
// The wording lives in the interface, as everywhere else in this prototype: an
// incident on the save is a kind and some ids, so no prose is ever frozen into
// a saved game.

// What somebody is actually asking for. A demand is what makes "give them what
// they want" a real option rather than a shrug — and what makes giving in cost
// something, because the room finds out what your word is worth.
export const DEMANDS = {
  airtime: { label: 'to be on the show', concede: 'They go on tonight.' },
  match: { label: 'the match they have been asking for', concede: 'You book it.' },
  spot: { label: 'a better spot on the card', concede: 'You move them up.' },
  title: { label: 'a shot at a championship', concede: 'You promise them the shot.' },
  apology: { label: 'you to back down', concede: 'You take it back.' },
  out: { label: 'to be let go', concede: 'You let them walk.' },
};

// `carry` is how many rooms away you can tell something is happening. Two
// people shouting carries next door; two people going through a catering table
// carries most of the way down the corridor. It is the difference between a
// building you have to walk to understand and one you can hear from your desk.
export const INCIDENT_KINDS = [
  {
    id: 'argument', label: 'Argument', severity: 'minor', carry: 1,
    note: 'Two people who cannot stand each other, in the same room.',
  },
  {
    id: 'brawl', label: 'Brawl', severity: 'major', carry: 2,
    note: 'It stopped being an argument.',
  },
  {
    id: 'attack', label: 'Attack', severity: 'major', carry: 2,
    note: 'One of them did not see it coming.',
  },
  {
    id: 'ambush', label: 'Ambush', severity: 'major', carry: 2,
    note: 'They went looking, and they found them.',
  },
  {
    id: 'complaint', label: 'Complaint', severity: 'minor',
    demand: true,
    note: 'Somebody wants a word, and they have rehearsed it.',
  },
  {
    id: 'storm-in', label: 'Storming in', severity: 'moderate',
    demand: true, atGm: true,
    note: 'No knock. They are past asking.',
  },
  {
    id: 'confrontation', label: 'Confrontation', severity: 'moderate',
    atGm: true,
    note: 'This one is about you, and it is happening in front of whoever is here.',
  },
  {
    id: 'refusal', label: 'Refusing to go out', severity: 'major',
    demand: true, atGorilla: true,
    note: 'They are booked in the next one and they are not moving.',
  },
  {
    id: 'walkout', label: 'Walking out', severity: 'critical',
    note: 'Bag packed, keys out, already in the car park.',
  },
  {
    id: 'tag-dispute', label: 'Tag team falling out', severity: 'moderate',
    note: 'One of them thinks they are carrying the other.',
  },
  {
    id: 'faction-dispute', label: 'Faction dispute', severity: 'moderate',
    note: 'Somebody is questioning who runs this.',
  },
];

const BY_ID = new Map(INCIDENT_KINDS.map(k => [k.id, k]));

export function carryOf(kindId) {
  const kind = BY_ID.get(kindId);
  return kind && kind.carry ? kind.carry : 1;
}

export function incidentKind(id) {
  return BY_ID.get(id) || BY_ID.get('argument');
}

// Whether the two people in it are both wrestlers. A confrontation is one
// wrestler and you, and you cannot mediate between somebody and yourself.
export function hasTwoSides(incident) {
  return Boolean(incident && incident.victimId && incident.victimId !== 'gm');
}
