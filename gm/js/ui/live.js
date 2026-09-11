// The GM at Gorilla while the show goes out, and the review once it is over.
// No simulation yet: every item takes exactly its planned time.
import { el } from './dom.js';
import { commit } from '../store.js';
import { PHASES, completeSegment, advanceWeek } from '../model/game.js';
import { itemById } from '../model/show.js';
import {
  currentItem, upcomingItems, airedItems, elapsedMinutes, remainingMinutes,
} from '../model/broadcast.js';
import { itemLabel, participantsLabel, typeLabel } from './labels.js';
import { EXECUTIVE, reviewShow } from '../model/executives.js';
import { withGrudges, bookable } from '../model/morale.js';
import { moodWord, moodClass, byMood } from './mood.js';
import { nameOf } from '../model/wrestlers.js';

export function renderLive(state, navigate) {
  if (state.phase === PHASES.LIVE) return liveView(state);
  if (state.phase === PHASES.AFTER) return aftermathView(state);

  return el('section', {},
    el('h2', { text: 'Live Show' }),
    el('p', { class: 'empty', text: `No show in progress. Week ${state.week} is still being booked.` }),
    el('button', { type: 'button', class: 'btn', text: 'Go to Booking', onClick: () => navigate('booking') })
  );
}

function liveView(state) {
  const { show, broadcast } = state;
  const item = currentItem(show, broadcast);
  const upcoming = upcomingItems(show, broadcast);
  const left = remainingMinutes(show, broadcast);

  return el('section', {},
    el('h2', { text: `Week ${state.week} — on the air` }),

    el('div', { class: 'onair' },
      el('div', { class: 'label', text: 'On air now' }),
      el('div', { class: 'title', text: itemLabel(state, item) }),
      el('div', { class: 'muted', text: `${typeLabel(item)} · ${participantsLabel(state, item)}` }),
      el('div', {}, 'Planned duration: ', el('b', { text: `${item.plannedMinutes} minutes` }))
    ),

    el('div', { class: 'totals' },
      el('div', {}, 'Current Show Time: ', el('b', { text: `${elapsedMinutes(broadcast)} minutes` })),
      el('div', {}, 'Time Remaining: ',
        el('b', { class: left < 0 ? 'over' : '', text: `${left} minutes` })
      ),
      el('div', {}, 'Show Length: ', el('b', { text: `${show.runtimeMinutes} minutes` }))
    ),

    left < 0 ? el('div', { class: 'notice warn', text: 'This show has run past its broadcast window.' }) : null,

    el('p', {},
      el('button', {
        type: 'button', class: 'btn primary', text: 'Complete Segment',
        onClick: () => commit(s => completeSegment(s)),
      })
    ),

    el('h3', { text: `Remaining rundown (${upcoming.length})` }),
    upcoming.length
      ? rundownTable(state, show, upcoming)
      : el('p', { class: 'empty', text: 'Nothing left after this. Completing it ends the show.' })
  );
}

function rundownTable(state, show, items) {
  const rows = items.map(item =>
    el('tr', {},
      el('td', { class: 'num', text: show.items.indexOf(item) + 1 }),
      el('td', { text: typeLabel(item) }),
      el('td', { text: itemLabel(state, item) }),
      el('td', { class: 'muted', text: participantsLabel(state, item) }),
      el('td', { class: 'num', text: `${item.plannedMinutes} min` })
    )
  );

  return el('table', {},
    el('thead', {},
      el('tr', {},
        el('th', { class: 'num', text: 'Pos' }),
        el('th', { text: 'Type' }),
        el('th', { text: 'Item' }),
        el('th', { text: 'Participants' }),
        el('th', { class: 'num', text: 'Planned' })
      )
    ),
    el('tbody', {}, rows)
  );
}

function aftermathView(state) {
  const { show, broadcast, week } = state;
  const aired = airedItems(show, broadcast);
  const total = elapsedMinutes(broadcast);
  const diff = total - show.runtimeMinutes;
  const review = reviewShow(state);

  const rows = aired.map(({ item, result }, index) =>
    el('tr', {},
      el('td', { class: 'num', text: index + 1 }),
      el('td', { text: item ? typeLabel(item) : '\u2014' }),
      el('td', { text: item ? itemLabel(state, item) : '(removed item)' }),
      el('td', { class: 'num', text: item ? `${item.plannedMinutes} min` : '\u2014' }),
      el('td', { class: 'num', text: `${result.actualMinutes} min` })
    )
  );

  return el('section', {},
    el('div', { class: 'after-head' },
      el('h2', { text: `Post-show \u2014 Week ${week}` }),
      el('div', { class: 'grade-wrap' },
        el('span', { class: 'grade-label', text: "Executive's grade" }),
        el('span', { class: `grade grade-${review.grade}`, text: review.grade })
      )
    ),

    memoPanel(review),

    el('h3', { text: 'The locker room' }),
    moodList(state),

    el('div', { class: 'split' },
      el('div', {},
        el('h3', { text: 'Carried into next week' }),
        grudgeList(state)
      ),
      el('div', {},
        el('h3', { text: 'What really happened tonight' }),
        journalList(state)
      )
    ),

    el('h3', { text: 'What aired' }),
    el('div', { class: 'totals' },
      el('div', {}, 'Show Length: ', el('b', { text: `${show.runtimeMinutes} minutes` })),
      el('div', {}, 'Total Aired: ', el('b', { text: `${total} minutes` })),
      el('div', {}, diff === 0 ? 'Finished exactly on time.'
        : diff > 0 ? el('b', { class: 'over', text: `Ran ${diff} minutes long.` })
        : el('b', { text: `Finished ${Math.abs(diff)} minutes light.` }))
    ),
    el('table', {},
      el('thead', {},
        el('tr', {},
          el('th', { class: 'num', text: 'Pos' }),
          el('th', { text: 'Type' }),
          el('th', { text: 'Item' }),
          el('th', { class: 'num', text: 'Planned' }),
          el('th', { class: 'num', text: 'Actual' })
        )
      ),
      el('tbody', {}, rows)
    ),

    el('button', {
      type: 'button', class: 'btn primary', text: `Start Week ${week + 1}`,
      onClick: () => commit(s => advanceWeek(s)),
    }),
    el('p', { class: 'muted', text: 'Advancing clears the card and opens booking for a new show.' })
  );
}

// The network, in their own voice. Verdicts come from the model; the wording
// lives here, so no sentence is ever frozen into saved state.
function memoPanel(review) {
  const lines = [];

  lines.push(
    review.timing === 'on-time'
      ? 'The show came off the air inside its window. Broadcast standards met. Acceptable.'
      : review.timing === 'long'
      ? `We bled ${review.over} minutes past the hard out. That is unacceptable on my network.`
      : `You handed back ${Math.abs(review.over)} minutes of my airtime and we filled it with a replay. Don't do that again.`
  );

  lines.push(
    review.rosterUse === 'broad'
      ? `You used ${review.used} of ${review.roster} available wrestlers. That is a roster, not a clique.`
      : review.rosterUse === 'narrow'
      ? `You used ${review.used} of ${review.roster}. The rest are being paid to watch.`
      : `${review.used} wrestlers on a two-hour show. I am paying for a roster and you are booking a house show.`
  );

  lines.push(
    review.lockerRoom === 'settled'
      ? 'Your locker room looks settled. Keep it that way.'
      : review.lockerRoom === 'restless'
      ? 'I am hearing grumbling from your talent. A restless locker room becomes my problem, and I do not enjoy having problems.'
      : 'Your locker room is a mess, and people outside this building are starting to notice.'
  );

  if (review.grudgeCount > 0) {
    lines.push(
      `${review.grudgeCount} of your people are carrying something into next week. Handle it before I have to.`
    );
  }

  return el('div', { class: 'memo' },
    el('div', { class: 'memo-head' },
      el('span', { class: 'memo-from', text: 'Memo from upstairs' }),
      el('span', { class: 'memo-sig', text: `${EXECUTIVE.name} \u00b7 ${EXECUTIVE.role}` })
    ),
    lines.map(line => el('p', { text: `\u201c${line}\u201d` }))
  );
}

// Demeanour, not digits: a word per wrestler, unhappiest first.
function moodList(state) {
  const roster = byMood(state.wrestlers.filter(bookable));

  return el('ul', { class: 'moods' },
    roster.map(w =>
      el('li', {},
        el('span', { class: 'mood-name', text: w.name }),
        el('span', { class: 'mood-arch', text: w.archetype }),
        el('span', { class: `mood-word ${moodClass(w)}`, text: moodWord(w) }),
        w.grudges.length ? el('span', { class: 'chip chip-bad', text: 'grudge' }) : null,
        w.weeksOffCard > 0
          ? el('span', { class: 'chip', text: `off ${w.weeksOffCard}w` })
          : null
      )
    )
  );
}

function grudgeList(state) {
  const holders = withGrudges(state.wrestlers);
  if (!holders.length) {
    return el('p', { class: 'empty', text: 'Nobody is carrying a grudge. Enjoy it while it lasts.' });
  }

  return el('ul', { class: 'grudges' },
    holders.map(w =>
      el('li', {},
        el('b', { text: w.name }),
        ' \u2014 ',
        w.grudges.map(g => grudgeText(state, w, g)).join('; ')
      )
    )
  );
}

// Grudges store a type and a target, never a sentence. This writes the sentence.
function grudgeText(state, wrestler, grudge) {
  if (grudge.type === 'overlooked') {
    const target = grudge.targetId ? nameOf(state.wrestlers, grudge.targetId) : 'management';
    return `overlooked ${grudge.data.weeks} weeks running, blames ${target}`;
  }
  return 'has a problem with you';
}

function journalList(state) {
  if (!state.journal.length) {
    return el('p', { class: 'empty', text: 'A quiet night. Almost suspicious.' });
  }

  return el('ol', { class: 'journal' },
    state.journal.map(entry =>
      el('li', {},
        el('span', { class: 'at', text: `${entry.at} min` }),
        journalText(state, entry)
      )
    )
  );
}

// Names a group without listing a dozen of them.
function nameList(state, ids) {
  const names = ids.map(id => nameOf(state.wrestlers, id));
  if (names.length === 1) return `${names[0]} has`;
  if (names.length === 2) return `${names[0]} and ${names[1]} have`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]} have`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others have`;
}

// Journal entries store references, not sentences. The wording lives here.
function journalText(state, entry) {
  if (entry.type === 'show-start') return 'The show goes on the air.';
  if (entry.type === 'show-end') return 'The broadcast ends.';
  if (entry.type === 'grudges-formed') {
    return `${nameList(state, entry.data.wrestlerIds)} stopped assuming the omission is an accident.`;
  }

  const item = itemById(state.show, entry.itemId);
  const label = item ? itemLabel(state, item) : '(removed item)';
  const { plannedMinutes, actualMinutes } = entry.data;
  const timing = actualMinutes === plannedMinutes
    ? `ran its planned ${plannedMinutes} minutes`
    : `planned for ${plannedMinutes}, ran ${actualMinutes}`;
  return `${label} — ${timing}.`;
}
