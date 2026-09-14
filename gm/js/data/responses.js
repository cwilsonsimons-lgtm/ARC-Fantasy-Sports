// What the GM can do about an incident.
//
// `weight` is how heavy the response is. It is compared against the severity of
// what actually happened, and the gap is what the locker room judges — a month
// off for a shouting match reads as tyranny, a quiet word after a riot reads as
// weakness. That comparison is the whole reason discipline is judgement rather
// than a button marked "harshest".
//
// Everything is offered for everything, with three exceptions that would be
// nonsense rather than merely bad: you cannot mediate between one person and
// themselves, you cannot make a match tonight with no minutes left, and you
// cannot give somebody what they want when they have not asked for anything.
// Every other terrible idea is available, because choosing the terrible idea is
// the game.
export const SEVERITIES = {
  minor:    { weight: 1, label: 'Minor' },
  moderate: { weight: 2, label: 'Moderate' },
  major:    { weight: 3, label: 'Major' },
  critical: { weight: 4, label: 'Critical' },
};

export const RESPONSES = [
  {
    id: 'ignore', weight: 0, label: 'Let them settle it',
    note: 'Say nothing. See what it becomes.',
  },
  {
    id: 'delay', weight: 0, label: 'Deal with it later',
    note: 'Not now. It will still be there, and it will have grown.',
  },
  {
    id: 'giveIn', weight: 0, label: 'Give them what they want',
    note: 'Solves this one completely. The room will hear how you solved it.',
    needsDemand: true,
  },
  {
    id: 'word', weight: 1, label: 'Have a word with {aggressor}',
    note: 'Find out what is actually bothering them.',
  },
  {
    id: 'mediate', weight: 1, label: 'Bring them both in',
    note: 'Put them in a room together. It could go either way.',
    needsTwo: true,
  },
  {
    id: 'bookNext', weight: 1, label: 'Book it for next week',
    note: 'Take the heat and keep tonight intact.',
    needsTwo: true,
  },
  {
    id: 'security', weight: 2, label: 'Send security',
    note: 'Separate them. Solves nothing underneath, and you have only so many.',
  },
  {
    id: 'bookTonight', weight: 2, label: 'Make the match tonight',
    note: 'You want each other? Fine. Find the minutes.',
    needsRuntime: true,
    needsTwo: true,
  },
  {
    id: 'warning', weight: 2, label: 'Formal warning for {aggressor}',
    note: 'On the record, and the room will hear about it.',
  },
  {
    id: 'eject', weight: 3, label: 'Send {aggressor} home for the night',
    note: 'Done for tonight, including anything they were booked for.',
    suspendWeeks: 0,
  },
  {
    id: 'suspend1', weight: 4, label: 'Suspend {aggressor} — one week',
    note: 'They miss next week.',
    suspendWeeks: 1,
  },
  {
    id: 'suspend2', weight: 4, label: 'Suspend {aggressor} — two weeks',
    note: 'Long enough that the card has to be rebuilt around it.',
    suspendWeeks: 2,
  },
  {
    id: 'suspend4', weight: 5, label: 'Suspend {aggressor} — one month',
    note: 'Four weeks. They will have time to think about you.',
    suspendWeeks: 4,
  },
  {
    id: 'suspendIndef', weight: 6, label: 'Suspend {aggressor} indefinitely',
    note: 'No end date. They come back when you say so, and not before.',
    suspendWeeks: 'indefinite',
  },
];

export function responseById(id) {
  return RESPONSES.find(r => r.id === id) || null;
}

// How the room reads the gap between what happened and what you did.
export function proportionality(severityId, responseId) {
  const severity = SEVERITIES[severityId] || SEVERITIES.moderate;
  const response = responseById(responseId);
  if (!response) return 'fair';
  const gap = response.weight - severity.weight;
  if (gap >= 2) return 'harsh';
  if (gap <= -2) return 'weak';
  return 'fair';
}

// Suspensions read as a ladder rather than a set of buttons, so the step you
// took is legible next to the ones you did not.
export function suspensionLabel(weeks) {
  if (weeks === 'indefinite') return 'indefinitely';
  if (!weeks) return 'for tonight';
  return weeks === 1 ? 'for a week' : weeks === 4 ? 'for a month' : `for ${weeks} weeks`;
}
