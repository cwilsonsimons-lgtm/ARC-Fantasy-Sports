// The year, rather than the week.
//
// Three things live here. What already happened, kept rather than thrown away
// when the week turns. What is planned, which may be a private intention or a
// public promise. And the special events, which are fixed points you can see
// coming and book toward.
//
// The distinction that matters is advertised versus planned. A planned match is
// a note to yourself and costs nothing to change. Advertising it makes it real:
// the audience is told, the network expects it, and failing to deliver is a
// breach with names attached. Telling a wrestler privately sits between the two
// — it is not public, but it is still your word.
import { byId } from './wrestlers.js';
import { createEntry } from './journal.js';
import { runtimeFor } from './network.js';
import { nextId } from '../ids.js';
import { matchType, DEFAULT_MATCH_TYPE } from '../data/match-types.js';

export const PPV_EVERY = 12;
export const PPV_BONUS_MINUTES = 30;
const HISTORY_LIMIT = 52;
const HORIZON = 8; // weeks of calendar you can plan into

const PPV_NAMES = [
  'Last Rites', 'Iron Harvest', 'Broken Ground', 'The Reckoning',
  'Cold Open', 'Hard Country', 'The Long Count', 'Bad Weather',
];

export function isPpvWeek(week) {
  return week > 0 && week % PPV_EVERY === 0;
}

export function ppvName(week) {
  return PPV_NAMES[(Math.floor(week / PPV_EVERY) - 1) % PPV_NAMES.length];
}

export function showNameFor(state, week) {
  return isPpvWeek(week) ? ppvName(week) : state.promotion.show;
}

// A special event is a bigger night than the network normally gives you.
export function runtimeForWeek(state, week) {
  return runtimeFor(state) + (isPpvWeek(week) ? PPV_BONUS_MINUTES : 0);
}

// The next eight weeks, plus the next special event even when it sits beyond
// them — a big show you cannot see coming is a big show you cannot book toward,
// which is the entire reason it is on the calendar.
export function horizonWeeks(state) {
  const weeks = [];
  for (let i = 1; i <= HORIZON; i += 1) weeks.push(state.week + i);

  const nextPpv = (Math.floor(state.week / PPV_EVERY) + 1) * PPV_EVERY;
  if (!weeks.includes(nextPpv)) weeks.push(nextPpv);
  return weeks;
}

// ---------- planning ----------

export function scheduleMatch(state, { week, wrestlerAId, wrestlerBId, matchTypeId = DEFAULT_MATCH_TYPE, plannedMinutes = 12 }) {
  state.scheduled = state.scheduled || [];
  const stipulation = matchType(matchTypeId);
  const entry = {
    id: nextId('si'), // the same id it will carry onto the card, so delivery can be checked
    week,
    type: 'match',
    matchType: stipulation.id,
    name: '',
    participants: [wrestlerAId, wrestlerBId],
    plannedMinutes: Math.max(stipulation.minMinutes, plannedMinutes),
    advertised: false,
    told: [],
  };
  state.scheduled.push(entry);
  return entry;
}

export function scheduledFor(state, week) {
  return (state.scheduled || []).filter(entry => entry.week === week);
}

export function unschedule(state, id) {
  const entry = (state.scheduled || []).find(e => e.id === id);
  if (!entry) return null;
  state.scheduled = state.scheduled.filter(e => e.id !== id);

  // Dropping something you had already announced is not a private decision.
  if (entry.advertised || entry.told.length) breachFor(state, entry, 'pulled');
  return entry;
}

export function setAdvertised(state, id, advertised) {
  const entry = (state.scheduled || []).find(e => e.id === id);
  if (!entry) return null;
  entry.advertised = advertised;
  if (advertised) {
    // Being announced is worth something on its own.
    for (const wrestlerId of entry.participants) {
      const wrestler = byId(state.wrestlers, wrestlerId);
      if (wrestler) wrestler.morale = Math.min(100, wrestler.morale + 3);
    }
  }
  return entry;
}

// Quietly letting somebody know they are penned in for a future show. Not
// public, but they will hold you to it.
export function tellWrestler(state, id, wrestlerId) {
  const entry = (state.scheduled || []).find(e => e.id === id);
  if (!entry || entry.told.includes(wrestlerId)) return null;
  if (!entry.participants.includes(wrestlerId)) return null;

  entry.told.push(wrestlerId);
  const wrestler = byId(state.wrestlers, wrestlerId);
  if (wrestler) {
    wrestler.morale = Math.min(100, wrestler.morale + 5);
    wrestler.weeksOffCard = 0; // they know they are not forgotten
  }
  return entry;
}

// ---------- delivery ----------

// Called when the week turns: this week's plans become this week's card.
export function loadScheduled(state) {
  for (const entry of scheduledFor(state, state.week)) {
    state.show.items.push({
      id: entry.id,
      type: entry.type,
      matchType: entry.matchType,
      name: entry.name,
      participants: [...entry.participants],
      plannedMinutes: entry.plannedMinutes,
      advertised: entry.advertised,
      told: [...entry.told],
    });
  }
}

// Called when the show comes off the air. Anything announced for tonight that
// did not happen is a breach, and the people it was promised to take it worst.
export function checkBreaches(state) {
  const aired = new Set((state.broadcast ? state.broadcast.results : []).map(r => r.itemId));
  let count = 0;

  for (const entry of scheduledFor(state, state.week)) {
    if (!entry.advertised && !entry.told.length) continue;
    if (aired.has(entry.id)) continue;
    breachFor(state, entry, 'undelivered');
    count += 1;
  }

  state.breaches = count;
  return count;
}

function breachFor(state, entry, reason) {
  for (const wrestlerId of entry.participants) {
    const wrestler = byId(state.wrestlers, wrestlerId);
    if (!wrestler) continue;
    const wasTold = entry.told.includes(wrestlerId);
    wrestler.morale = Math.max(0, wrestler.morale - (wasTold ? 11 : 6));
    if (wasTold && !wrestler.grudges.some(g => g.type === 'broken-promise')) {
      wrestler.grudges.push({
        id: nextId('gr'), week: state.week, type: 'broken-promise', targetId: null,
        data: { week: entry.week },
      });
    }
  }

  state.journal.push(createEntry({
    week: state.week, at: 0, type: 'breach',
    data: {
      participants: [...entry.participants],
      advertised: entry.advertised,
      told: entry.told.length,
      reason,
    },
  }));
}

// ---------- history ----------

// Keep the week rather than overwrite it. Compact on purpose: a season of shows
// has to fit in a browser's storage alongside everything else.
export function archiveWeek(state) {
  state.history = state.history || [];
  state.history.unshift({
    week: state.week,
    name: state.show.name,
    ppv: isPpvWeek(state.week),
    runtimeMinutes: state.show.runtimeMinutes,
    grade: state.lastReview ? state.lastReview.grade : null,
    items: state.show.items.map(item => ({
      id: item.id,
      type: item.type,
      matchType: item.matchType,
      name: item.name,
      participants: [...item.participants],
      plannedMinutes: item.plannedMinutes,
      advertised: Boolean(item.advertised),
    })),
    results: (state.broadcast ? state.broadcast.results : []).map(r => ({ ...r })),
    journal: state.journal.map(entry => ({ ...entry })),
  });
  if (state.history.length > HISTORY_LIMIT) state.history.length = HISTORY_LIMIT;

  // Plans for weeks now gone are no longer plans.
  state.scheduled = (state.scheduled || []).filter(entry => entry.week > state.week);
}
