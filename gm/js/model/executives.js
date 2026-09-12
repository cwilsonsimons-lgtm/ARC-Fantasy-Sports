// The network's read on the episode.
//
// Deliberately returns verdicts, not numbers: 'long' / 'on-time' / 'light',
// 'settled' / 'restless' / 'bad'. The wording lives in the UI, and the score
// that produces the grade is never exported — the player is told the
// executive's priorities, never their arithmetic, or they optimise the formula
// instead of the show.
import { elapsedMinutes } from './broadcast.js';
import { averageMorale, withGrudges, appearedCount, bookableCount } from './morale.js';
import { authorityValue } from './backstage.js';

export const EXECUTIVE = { name: 'Diane Petrosyan', role: 'Network' };

// Proportion of the window that can go unfilled before it reads as dead air.
// A flat number of minutes does not survive the show changing length: six
// minutes short is a rounding error on two hours and a tenth of an hour show.
const LIGHT_SHARE = 0.1;

export function reviewShow(state) {
  const aired = elapsedMinutes(state.broadcast);
  const over = aired - state.show.runtimeMinutes;
  const lightAt = Math.round(state.show.runtimeMinutes * LIGHT_SHARE);
  const timing = over > 0 ? 'long' : over < -lightAt ? 'light' : 'on-time';

  const average = averageMorale(state.wrestlers);
  const grudgeCount = withGrudges(state.wrestlers).length;
  const lockerRoom = average >= 60 && grudgeCount === 0 ? 'settled'
    : average >= 45 ? 'restless'
    : 'bad';

  const used = appearedCount(state);
  const roster = bookableCount(state.wrestlers);
  const share = roster ? used / roster : 0;
  const rosterUse = share >= 0.5 ? 'broad' : used >= 4 ? 'narrow' : 'thin';

  // An advertised match that did not happen is the thing they notice first.
  const breaches = state.breaches || 0;

  // And then how the building was run. Head office does not care who was angry
  // about what — they care that a segment came off the card because somebody
  // would not go out, and that a wrestler left the venue. Things that happened
  // with nobody in the room are counted separately from things that were ruled
  // on badly: the second is a judgement call, the first is an absence.
  const night = state.journal || [];
  const missed = night.filter(e => e.type === 'missed').length;
  const walkouts = night.filter(e => e.type === 'walked-out').length;
  const pulled = night.filter(e => e.type === 'pulled-item').length;
  const disorder = missed + walkouts * 3 + pulled * 2;
  const backstage = disorder === 0 ? 'quiet' : disorder <= 2 ? 'noisy' : 'out of hand';

  const score = Math.max(0,
    (timing === 'on-time' ? 1 : timing === 'light' ? 0.5 : 0)
    + (lockerRoom === 'settled' ? 1 : lockerRoom === 'restless' ? 0.5 : 0)
    + (rosterUse === 'broad' ? 1 : rosterUse === 'narrow' ? 0.5 : 0)
    - (backstage === 'out of hand' ? 1 : backstage === 'noisy' ? 0.5 : 0)
    - breaches);

  const grade = score >= 2.5 ? 'A' : score >= 1.75 ? 'B' : score >= 1 ? 'C' : 'D';

  return {
    grade, timing, over, lockerRoom, grudgeCount, rosterUse, used, roster, aired,
    breaches, backstage, missed, walkouts, pulled,
  };
}

// What head office thinks of how you run the place, as distinct from what they
// think of any one episode. A good show from a building nobody is in charge of
// is a good show they are worried about.
const BOSS_VIEW = [
  [72, 'They think you have the place in hand.', 'good'],
  [56, 'They have no particular concerns about you.', 'fine'],
  [40, 'They have started asking how things are backstage.', 'plain'],
  [24, 'They are hearing things about your locker room.', 'warn'],
  [0, 'They do not believe you are running this building.', 'bad'],
];

export function bossView(state) {
  const record = state.gmRecord || {};
  // Walkouts are counted out of the archived nights rather than tracked
  // separately — the journal already knows, and a second tally would be a
  // second thing to keep in step.
  const walkouts = (state.history || []).reduce((count, week) =>
    count + (week.journal || []).filter(e => e.type === 'walked-out').length, 0);

  // Missing things is already in the authority figure, as a share of the calls
  // that came your way. Counting the raw number again here would mean a GM who
  // ran forty weeks was worse at the job than one who ran four.
  const value = Math.max(0, Math.min(100,
    authorityValue(state) - walkouts * 7 - (record.gaveIn || 0) * 1.5));
  const [, phrase, tone] = BOSS_VIEW.find(([floor]) => value >= floor);
  return { value: Math.round(value), phrase, tone, walkouts };
}
