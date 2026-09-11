// The kinds of match you can book.
//
// Each type carries a minimum runtime, which is how match type reaches the show
// clock: an Iron Man match eats a quarter of your window whether you like it or
// not, so choosing a stipulation is a timing decision as well as a talent one.
export const MATCH_TYPES = [
  { id: 'singles',    name: 'Singles Match',     minMinutes: 5,
    note: 'One fall. Nobody has strong feelings about a singles match.' },
  { id: 'submission', name: 'Submission Match',  minMinutes: 10,
    note: 'No pinfalls. You win when they quit.' },
  { id: 'hardcore',   name: 'Hardcore Match',    minMinutes: 8,
    note: 'No disqualification, and whatever is not bolted down.' },
  { id: 'ladder',     name: 'Ladder Match',      minMinutes: 12,
    note: 'Spectacle, and a long way down.' },
  { id: 'cage',       name: 'Steel Cage Match',  minMinutes: 12,
    note: 'Nobody comes in. Nobody leaves.' },
  { id: 'lastman',    name: 'Last Man Standing', minMinutes: 14,
    note: 'A count of ten, and no pin will save you.' },
  { id: 'ironman',    name: 'Iron Man Match',    minMinutes: 25,
    note: 'Most falls inside the time limit. It eats your show.' },
];

export const DEFAULT_MATCH_TYPE = 'singles';

export function matchType(id) {
  return MATCH_TYPES.find(t => t.id === id) || MATCH_TYPES[0];
}
