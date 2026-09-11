// The network's read on the episode.
//
// Deliberately returns verdicts, not numbers: 'long' / 'on-time' / 'light',
// 'settled' / 'restless' / 'bad'. The wording lives in the UI, and the score
// that produces the grade is never exported — the player is told the
// executive's priorities, never their arithmetic, or they optimise the formula
// instead of the show.
import { elapsedMinutes } from './broadcast.js';
import { averageMorale, withGrudges, appearedCount, bookableCount } from './morale.js';

export const EXECUTIVE = { name: 'Diane Petrosyan', role: 'Network' };

const LIGHT_THRESHOLD = 5; // minutes under the window before it reads as dead air

export function reviewShow(state) {
  const aired = elapsedMinutes(state.broadcast);
  const over = aired - state.show.runtimeMinutes;
  const timing = over > 0 ? 'long' : over < -LIGHT_THRESHOLD ? 'light' : 'on-time';

  const average = averageMorale(state.wrestlers);
  const grudgeCount = withGrudges(state.wrestlers).length;
  const lockerRoom = average >= 60 && grudgeCount === 0 ? 'settled'
    : average >= 45 ? 'restless'
    : 'bad';

  const used = appearedCount(state);
  const roster = bookableCount(state.wrestlers);
  const share = roster ? used / roster : 0;
  const rosterUse = share >= 0.5 ? 'broad' : used >= 4 ? 'narrow' : 'thin';

  const score =
    (timing === 'on-time' ? 1 : timing === 'light' ? 0.5 : 0) +
    (lockerRoom === 'settled' ? 1 : lockerRoom === 'restless' ? 0.5 : 0) +
    (rosterUse === 'broad' ? 1 : rosterUse === 'narrow' ? 0.5 : 0);

  const grade = score >= 2.5 ? 'A' : score >= 1.75 ? 'B' : score >= 1 ? 'C' : 'D';

  return { grade, timing, over, lockerRoom, grudgeCount, rosterUse, used, roster, aired };
}
