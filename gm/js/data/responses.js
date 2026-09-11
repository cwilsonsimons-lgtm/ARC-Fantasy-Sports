// What the GM can do about an incident.
//
// `weight` is how heavy the response is. It is compared against the severity of
// what actually happened, and the gap is what the locker room judges — a month
// off for a shouting match reads as tyranny, a quiet word after a riot reads as
// weakness. That comparison is the whole reason discipline is judgement rather
// than a button marked "harshest".
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
    id: 'word', weight: 1, label: 'Have a word with {aggressor}',
    note: 'Find out what is actually bothering them.',
  },
  {
    id: 'mediate', weight: 1, label: 'Bring them both in',
    note: 'Put them in a room together. It could go either way.',
  },
  {
    id: 'bookNext', weight: 1, label: 'Book it for next week',
    note: 'Take the heat and keep tonight intact.',
  },
  {
    id: 'security', weight: 2, label: 'Send security',
    note: 'Separate them. Solves nothing underneath.',
  },
  {
    id: 'bookTonight', weight: 2, label: 'Make the match tonight',
    note: 'You want each other? Fine. Find the minutes.',
    needsRuntime: true,
  },
  {
    id: 'warning', weight: 2, label: 'Formal warning for {aggressor}',
    note: 'On the record, and the room will hear about it.',
  },
  {
    id: 'eject', weight: 3, label: 'Eject {aggressor} from the building',
    note: 'They are done for tonight, including anything they were booked for.',
  },
  {
    id: 'suspend1', weight: 4, label: 'Suspend {aggressor} — one week',
    note: 'They miss next week.',
    suspendWeeks: 1,
  },
  {
    id: 'suspend4', weight: 5, label: 'Suspend {aggressor} — one month',
    note: 'Four weeks. They will have time to think about you.',
    suspendWeeks: 4,
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
