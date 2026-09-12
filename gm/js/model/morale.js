// How a show changes the locker room.
//
// Morale is a running total, and the total is meaningless without an account of
// what is in it. So nothing here writes `wrestler.morale` directly: every change
// goes through remember(), which moves the number and files a memory saying why.
// "Why is this one furious" then has an answer, and the answer decays over time
// at a rate the person decides.
//
// What a show can say about somebody:
//
//   you appeared, and where on the card, and for how long
//   you were asked to work something you love, or something you dread
//   you won, or you lost
//   you did not appear, again, for the Nth week running
//   somebody else had the night you wanted
//
// Repetition is what matters. One missed week is a slight; several in a row
// becomes a belief, and that is when a grudge forms — after how many depends on
// how patient the person is.
import { airedItems, elapsedMinutes } from './broadcast.js';
import { createEntry } from './journal.js';
import { growFamiliarity } from './stats.js';
import { noteItem } from './relationships.js';
import { tasteOf } from './match-types.js';
import { trait, lean } from './traits.js';
import { remember } from './memory.js';
import { nextId } from '../ids.js';

const APPEARED_BASE = 2;
const MAIN_EVENT_BONUS = 4;
const OPENER_BONUS = 1;
const MINUTES_PER_POINT = 5;
const MISSED_BASE = 2;
const MISSED_PER_WEEK = 2;
const MISSED_WEEKS_CAP = 4;
const GRUDGE_AT_WEEKS = 3;
// Being put in a match you genuinely dread does not need repeating to land.
const HATED_TASTE = 20;
const WIN_VALUE = 2;
const LOSS_VALUE = 2;
// Below this nobody is jealous enough for it to be worth writing down. Set high
// on purpose: almost everybody notices whose night it was, and if almost
// everybody produced a line about it, the one person who genuinely cannot stand
// it would be invisible in the noise.
const JEALOUS_AT = 68;
const ENVY_HEARD = 2; // how many of them are loud enough about it to reach you

// What each wrestler actually got out of the show that just aired. Built from
// what aired, not from what was planned.
export function involvement(state) {
  const { show, broadcast } = state;
  const byWrestler = new Map();
  const lastIndex = show.items.length - 1;

  for (const { item, result } of airedItems(show, broadcast)) {
    if (!item) continue;
    const index = show.items.indexOf(item);
    for (const id of item.participants) {
      const entry = byWrestler.get(id)
        || {
          minutes: 0, segmentMinutes: 0, items: 0, mainEvent: false, opener: false,
          stipulations: [], wins: 0, losses: 0, alsoRan: 0,
        };
      entry.minutes += result.actualMinutes;
      if (item.type === 'segment') entry.segmentMinutes += result.actualMinutes;
      else entry.stipulations.push(item.matchType);
      entry.items += 1;
      if (index === lastIndex) entry.mainEvent = true;
      if (index === 0) entry.opener = true;
      if (item.type === 'match' && result.winnerIds && result.winnerIds.length) {
        if (result.winnerIds.includes(id)) entry.wins += 1;
        else if (!result.fallIds || !result.fallIds.length || result.fallIds.includes(id)) {
          entry.losses += 1;
        } else {
          // In it, and did not win it. Nobody beat them, and it does not land
          // like a defeat — which is the whole reason to book somebody into a
          // fatal four-way rather than a singles match.
          entry.alsoRan += 1;
        }
      }
      byWrestler.set(id, entry);
    }
  }
  return byWrestler;
}

function bookable(wrestler) {
  return wrestler.status === 'Available';
}

// Professionalism flattens a reaction in both directions. A pro takes good news
// and bad news at roughly the same temperature.
function temper(wrestler, delta) {
  const factor = 1 - (trait(wrestler, 'professionalism') - 50) / 200; // 0.75x .. 1.25x
  return Math.round(delta * factor);
}

// Half-range swing around the midpoint: 50 gives 0, 100 gives +size, 0 gives -size.
function swing(value, size) {
  return Math.round(((value - 50) / 50) * size);
}

// How many empty weeks this particular person will absorb before deciding it
// means something. Two for somebody with no patience at all, five for somebody
// who will wait.
function grudgeAfter(wrestler) {
  return Math.max(2, Math.round(GRUDGE_AT_WEEKS + lean(wrestler, 'patience') * 2));
}

// And how badly a stipulation has to land before it becomes a standing
// objection rather than a bad night.
function hatedThreshold(wrestler) {
  return Math.round(HATED_TASTE - lean(wrestler, 'patience') * 10);
}

export function settleShow(state) {
  const appearances = involvement(state);
  const at = elapsedMinutes(state.broadcast);
  const newGrudges = [];
  const hatedBookings = [];

  // History first: who met whom in the ring, and who stood beside whom.
  for (const { item } of airedItems(state.show, state.broadcast)) {
    if (item) noteItem(state.wrestlers, item);
  }

  for (const wrestler of state.wrestlers) {
    const used = appearances.get(wrestler.id);
    // You learn people by being around them, and faster by working with them.
    growFamiliarity(wrestler, Boolean(used));

    if (used) {
      wrestler.weeksOffCard = 0;
      // You used them. Whatever they had been telling people about being
      // overlooked, they cannot keep saying it.
      wrestler.grudges = wrestler.grudges.filter(g => g.type !== 'overlooked');
      let delta = APPEARED_BASE
        + (used.mainEvent ? MAIN_EVENT_BONUS : 0)
        + (used.opener ? OPENER_BONUS : 0)
        + Math.floor(used.minutes / MINUTES_PER_POINT);

      // Ego decides how much the size of the spot matters: the marquee slot is
      // worth more to a big one, and opening the show stings.
      if (used.mainEvent) delta += swing(trait(wrestler, 'ego'), 3);
      else if (used.opener) delta -= swing(trait(wrestler, 'ego'), 2);

      // And somebody who believes they belong on top reads the middle of the
      // card as a demotion, every week, whether or not anything was said. This
      // is the ordinary grinding cost of a big ego at the top of a roster, and
      // it is the reason the marquee slot is a decision rather than a reward.
      if (!used.mainEvent && (wrestler.role === 'Main event' || wrestler.role === 'Upper card')) {
        delta -= Math.max(0, swing(trait(wrestler, 'ego'), 5));
      }

      // Talkers get more out of microphone time than wrestlers do.
      if (used.segmentMinutes) {
        delta += Math.round((used.segmentMinutes / 10) * (wrestler.stats.charisma / 60));
      }

      // What they were asked to do, not just how much of it. Getting the match
      // you have been asking for is worth as much as the spot itself; being put
      // in the one you dread costs more.
      for (const stipulation of used.stipulations) {
        const taste = tasteOf(wrestler, stipulation);
        // Taste scales the whole booking rather than nudging it. A wrestler who
        // dreads the stipulation does not enjoy the main event much either, so
        // the spot is worth a fraction of what it would otherwise have been —
        // and then the stipulation lands on top of that.
        delta *= 0.5 + taste / 100;          // hated 0.5x, indifferent 1x, loved 1.5x
        delta += Math.round((taste - 50) / 4); // and its own weight, -12 .. +12
        if (taste < hatedThreshold(wrestler) && !hasMatchGrudge(wrestler, stipulation)) {
          wrestler.grudges.push({
            id: nextId('gr'),
            week: state.week,
            type: 'hated-match',
            targetId: null,
            data: { matchTypeId: stipulation },
          });
          hatedBookings.push({ wrestlerId: wrestler.id, matchTypeId: stipulation });
        }
      }

      remember(state, wrestler, {
        source: 'airtime',
        weight: temper(wrestler, delta),
        detail: used.mainEvent ? 'main-event' : used.opener ? 'opener' : 'card',
      });

      // Where somebody goes on the card is airtime, but *being used at all* is
      // unmistakably a decision you made about them, and it is judged as one.
      // This is the main way the GM axis moves in an ordinary week: nobody
      // forms a view of the office during incidents, they form it every time
      // the card goes up and they read down it looking for their own name.
      remember(state, wrestler, {
        source: 'gm',
        weight: used.mainEvent ? 3 : 1,
        detail: used.mainEvent ? 'put-on-top' : 'used',
      });

      // And then the result, which is a separate thing from the spot. Losing in
      // the main event is still losing, and a big ego feels it further.
      settleResult(state, wrestler, used);
      continue;
    }

    // Could not have been booked, so this is not a snub.
    if (!bookable(wrestler)) continue;

    wrestler.weeksOffCard += 1;
    const weeks = Math.min(wrestler.weeksOffCard, MISSED_WEEKS_CAP);
    // Ambition decides how hard being overlooked lands. The same empty week is
    // a shrug to one wrestler and an insult to another.
    const sting = -(MISSED_BASE + MISSED_PER_WEEK * weeks)
      * (0.5 + trait(wrestler, 'ambition') / 100);
    remember(state, wrestler, {
      source: 'airtime',
      weight: temper(wrestler, sting),
      detail: 'left-off',
    });

    // And leaving somebody off is the same decision with the other sign on it,
    // once it has happened often enough to read as a choice rather than a week.
    if (wrestler.weeksOffCard >= 2) {
      remember(state, wrestler, { source: 'gm', weight: -2, detail: 'kept-off' });
    }

    if (wrestler.weeksOffCard >= grudgeAfter(wrestler) && !hasOverlookedGrudge(wrestler)) {
      wrestler.grudges.push({
        id: nextId('gr'),
        week: state.week,
        type: 'overlooked',
        targetId: null, // null means management — the GM. Incidents will name a wrestler.
        data: { weeks: wrestler.weeksOffCard },
      });
      newGrudges.push(wrestler.id);
    }
  }

  // Somebody else's good night is its own event for the people who were
  // counting. Run last, because it reads the night everyone else just had.
  const envy = settleJealousy(state, appearances);

  // One entry, not one per wrestler. A dozen identical lines is the kind of
  // noise that makes a feed unreadable the moment the roster grows.
  for (const booking of hatedBookings) {
    state.journal.push(createEntry({
      week: state.week,
      at,
      type: 'hated-booking',
      data: booking,
    }));
  }

  if (newGrudges.length) {
    state.journal.push(createEntry({
      week: state.week,
      at,
      type: 'grudges-formed',
      data: { wrestlerIds: newGrudges },
    }));
  }

  for (const entry of envy) {
    state.journal.push(createEntry({
      week: state.week,
      at,
      type: 'noticed',
      data: entry,
    }));
  }
}

// Wins and losses, recorded as their own feeling. Ego makes a loss land harder;
// a professional shrugs both off faster.
function settleResult(state, wrestler, used) {
  if (!used.wins && !used.losses && !used.alsoRan) return;

  let delta = 0;
  if (used.wins) delta += used.wins * (WIN_VALUE + swing(trait(wrestler, 'ego'), 2));
  if (used.losses) {
    const pride = 1 + lean(wrestler, 'ego') * 0.9 + lean(wrestler, 'ambition') * 0.3;
    delta -= used.losses * LOSS_VALUE * Math.max(0.4, pride);
  }
  // Being in a multi-way and not winning it costs a fraction of a defeat: the
  // ambitious ones still wanted it, and nobody beat them.
  if (used.alsoRan) delta -= used.alsoRan * (0.5 + lean(wrestler, 'ambition') * 0.4);
  if (!Math.round(delta)) return;

  remember(state, wrestler, {
    source: 'result',
    weight: temper(wrestler, delta),
    detail: used.wins && !used.losses ? 'won' : used.losses && !used.wins ? 'lost' : 'mixed',
  });
}

// Who had the night everybody else wanted, and who was counting.
//
// This is the first thing in the game that happens to somebody because of what
// happened to *somebody else*. A jealous wrestler who was left off while the
// main event went to a peer does not need to have been wronged to feel wronged.
function settleJealousy(state, appearances) {
  const spotlight = [];

  for (const [id, used] of appearances) {
    if (used.mainEvent) spotlight.push({ id, reason: 'main-event', size: 4 });
  }
  for (const entry of state.journal) {
    if (entry.week !== state.week || entry.type !== 'title-change') continue;
    for (const id of entry.data.championIds || []) {
      spotlight.push({ id, reason: 'title', size: 7 });
    }
  }
  if (!spotlight.length) return [];

  const shone = new Set(spotlight.map(s => s.id));
  const noticed = new Map(); // one memory per jealous wrestler, about the biggest thing

  for (const wrestler of state.wrestlers) {
    if (!bookable(wrestler) || shone.has(wrestler.id)) continue;
    const jealousy = trait(wrestler, 'jealousy');
    if (jealousy <= JEALOUS_AT) continue;

    const edge = (jealousy - JEALOUS_AT) / (100 - JEALOUS_AT); // 0 .. 1
    const watchedFromTheBack = !appearances.has(wrestler.id);

    let worst = null;
    for (const spot of spotlight) {
      const weight = -Math.round((spot.size + (watchedFromTheBack ? 2 : 0)) * edge);
      if (weight >= 0) continue;
      if (!worst || weight < worst.weight) worst = { ...spot, weight };
    }
    if (worst) noticed.set(wrestler.id, worst);
  }

  const entries = [];
  for (const [wrestlerId, spot] of noticed) {
    remember(state, wrestlerId, {
      source: 'peer',
      weight: spot.weight,
      targetId: spot.id,
      detail: spot.reason,
    });
    entries.push({ wrestlerId, targetId: spot.id, reason: spot.reason, weight: spot.weight });
  }

  // Everyone who felt it, felt it. Only the ones who could not keep it to
  // themselves become something you actually hear about.
  return entries
    .sort((a, b) => a.weight - b.weight)
    .slice(0, ENVY_HEARD);
}

export function hasMatchGrudge(wrestler, matchTypeId) {
  return wrestler.grudges.some(g => g.type === 'hated-match' && g.data.matchTypeId === matchTypeId);
}

export function hasOverlookedGrudge(wrestler) {
  return wrestler.grudges.some(g => g.type === 'overlooked');
}

export function averageMorale(wrestlers) {
  const pool = wrestlers.filter(bookable);
  if (!pool.length) return 50;
  return Math.round(pool.reduce((sum, w) => sum + w.morale, 0) / pool.length);
}

export function withGrudges(wrestlers) {
  return wrestlers.filter(w => w.grudges.length > 0);
}

export function appearedCount(state) {
  return involvement(state).size;
}

export function bookableCount(wrestlers) {
  return wrestlers.filter(bookable).length;
}

export { bookable };
