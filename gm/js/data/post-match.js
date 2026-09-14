// What happens when the bell rings.
//
// There used to be one question here — does the loser swing? — and one coin to
// flip for it. The bell is a better moment than that. Two people have just had
// a match in front of an audience, and what they do in the ten seconds
// afterwards is the most legible thing either of them does all night: a hand
// offered and taken, a hand offered and left hanging, a hold kept on past the
// bell, a champion walking down the aisle.
//
// Most of these are *colour*. They file memories, they move relationships, some
// of them put something on the table for next week — and they do not stop the
// show. Only the four that involve somebody getting hurt need a ruling, because
// only those are the GM's problem. A show that halted for a handshake would
// teach the player to dread the bell.
export const MOMENTS = [
  {
    id: 'handshake', label: 'Handshake', colour: true,
    note: 'Two professionals, in front of the audience.',
  },
  {
    id: 'handshake-refused', label: 'Refused handshake', colour: true,
    note: 'One hand out, and nothing in it.',
  },
  {
    id: 'stare-down', label: 'Stare-down', colour: true,
    note: 'Nobody swings. Everybody understands.',
  },
  {
    id: 'champion-challenge', label: 'Champion confrontation', colour: true,
    note: 'The belt came to the ring, and it was not defending anything.',
  },
  {
    id: 'cheap-shot', label: 'Cheap shot', severity: 'minor',
    note: 'One shot on the way out. Not a beating; not nothing.',
  },
  {
    id: 'attack', label: 'Post-match attack', severity: 'major',
    note: 'They did not stop at the bell.',
  },
  {
    id: 'submission-held', label: 'Hold kept on', severity: 'major',
    note: 'The bell went. The hold did not come off.',
  },
  {
    id: 'faction-beatdown', label: 'Faction beatdown', severity: 'critical',
    note: 'It was never going to be one against one.',
  },
];

const BY_ID = new Map(MOMENTS.map(m => [m.id, m]));

export function moment(id) {
  return BY_ID.get(id) || null;
}

// A moment that is only ever a moment: recorded, remembered, and not something
// the GM is asked to rule on.
export function isColour(id) {
  const found = BY_ID.get(id);
  return Boolean(found && found.colour);
}

// How long somebody is out after a hold was kept on too long. Short enough that
// it is a problem for the next few cards rather than the end of a run.
export const INJURY_WEEKS = [1, 3];
