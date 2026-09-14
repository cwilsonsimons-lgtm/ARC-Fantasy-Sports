// Talking, and how far you let them take it.
//
// A promo is the one segment where the GM decides the temperature rather than
// the outcome. You put two people who have a history in front of a camera, you
// tell them how hot to go, and you choose what they are allowed to bring up.
// Everything after that is theirs.
//
// The tension is the whole tier: the hotter the promo, the more the crowd
// invests and the more the two of them mean it — and the more likely it is that
// somebody throws a punch on live television and hands you an incident.

// The ladder the GM sets before the segment goes out.
//
// `heat` and `hatred` multiply whatever the material was worth. `risk` is the
// base chance it stops being a promo, before the two of them are taken into
// account — a patient professional and a short-tempered one do not carry the
// same segment.
export const INTENSITIES = [
  {
    id: 'calm', label: 'Calm', heat: 0.5, hatred: 0.2, risk: 0,
    note: 'They state their case. Nobody raises their voice.',
  },
  {
    id: 'heated', label: 'Heated', heat: 1, hatred: 0.6, risk: 0.04,
    note: 'Real edge to it. The crowd sits up.',
  },
  {
    id: 'hostile', label: 'Hostile', heat: 1.4, hatred: 1, risk: 0.16,
    note: 'Personal, and it is going somewhere.',
  },
  {
    id: 'explosive', label: 'Explosive', heat: 1.8, hatred: 1.5, risk: 0.38,
    note: 'Nose to nose. Somebody has to be between them.',
  },
  {
    id: 'fight', label: 'About to Fight', heat: 2.2, hatred: 2, risk: 0.72,
    note: 'You are not booking a promo. You are booking the start of a brawl.',
  },
];

export function intensity(id) {
  return INTENSITIES.find(i => i.id === id) || INTENSITIES[1];
}

export function intensityIndex(id) {
  const at = INTENSITIES.findIndex(i => i.id === id);
  return at < 0 ? 1 : at;
}

// What a wrestler can actually bring up, and what it costs.
//
// None of this is authored. Every kind below is derived from something that
// really happened between these two — or to one of them — which is why the
// material gets more personal as the rivalry gets older. A pair who met last
// week have nothing to say about each other; a pair who have been at it for
// nine months have a list.
//
// `heat` is what the crowd gets out of hearing it. `hatred` is what it does to
// the person it is aimed at. `risk` is how much closer it moves the segment to
// a fight. The interesting ones are high hatred and low heat — a thing that
// means nothing to the audience and everything to the man it is said to.
export const AMMO = {
  record: {
    label: 'Their record against you', heat: 2, hatred: 1, risk: 0.02,
    sentence: 'has not beaten you yet and they both know it',
  },
  loss: {
    label: 'The night you beat them', heat: 3, hatred: 2, risk: 0.04,
    sentence: 'has a specific night thrown back at them',
  },
  'title-failure': {
    label: 'The title they could not win', heat: 4, hatred: 4, risk: 0.08,
    sentence: 'is reminded exactly how close they came and what happened',
  },
  embarrassment: {
    label: 'The way they were beaten', heat: 4, hatred: 5, risk: 0.12,
    sentence: 'is made to hear about it in detail',
  },
  injury: {
    label: 'The injury', heat: 3, hatred: 6, risk: 0.16,
    sentence: 'is asked how the shoulder is',
  },
  betrayal: {
    label: 'What they did to somebody who trusted them', heat: 5, hatred: 7, risk: 0.18,
    sentence: 'has the thing nobody else will say to them said out loud',
  },
  abandoned: {
    label: 'The partner they left standing', heat: 5, hatred: 7, risk: 0.2,
    sentence: 'is asked where they were that night',
  },
  promise: {
    label: 'What the office promised them', heat: 3, hatred: 3, risk: 0.06,
    sentence: 'has a promise nobody kept read back to them',
  },
  ally: {
    label: 'Somebody they care about', heat: 4, hatred: 8, risk: 0.26,
    sentence: 'hears a name that has nothing to do with any of this',
  },
  years: {
    label: 'How long they have been waiting', heat: 3, hatred: 4, risk: 0.08,
    sentence: 'is told, in public, what everybody backstage already thinks',
  },
};

export function ammoSpec(kind) {
  return AMMO[kind] || null;
}

// What the segment reads as afterwards, for the aftermath and the journal.
export const OUTCOMES = {
  flat: 'It did not land.',
  solid: 'It did what it was supposed to do.',
  strong: 'That is the segment people will talk about.',
  physical: 'It stopped being a promo.',
};
