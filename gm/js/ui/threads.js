// What the game noticed.
//
// Nothing in this panel was authored. Every line is a pair of wrestlers the
// game watched accumulate a record — a match, then an attack, then somebody
// standing there when they were needed — and the title is composed from the
// sharpest thing in it. That is the whole claim of this tier: the stories are
// already in the save, and all the interface has to do is stop hiding them.
import { el } from './dom.js';
import { liveThreads, threadsFor } from '../model/threads.js';
import { nameOf } from '../model/wrestlers.js';
import { wrestlerLink } from './links.js';

// The sharpest event in a thread, said as what it left behind.
const PEAK_LINE = {
  abandoned: 'one of them was left standing there alone',
  'faction-beatdown': 'it stopped being one against one',
  attack: 'it carried on after the bell',
  'submission-held': 'a hold was kept on too long',
  brawl: 'they went through each other backstage',
  ambush: 'one of them went looking for the other',
  'cheap-shot': 'a shot on the way out',
  argument: 'it is being said out loud now',
  'tag-dispute': 'the team is coming apart',
  'faction-dispute': 'somebody is questioning who runs it',
  'handshake-refused': 'a hand was left hanging',
  'stare-down': 'neither of them will look away',
  booked: 'you put them in a ring together',
  match: 'they keep ending up in a ring together',
  ruling: 'you had to make a call about them',
};

function headline(entry) {
  const peak = entry.peak;
  return peak && PEAK_LINE[peak.type] ? PEAK_LINE[peak.type] : 'it keeps going';
}

// How loud to be about it.
//
// The top label is deliberately exclusive: there is one story of your show, and
// handing the same phrase to five pairs at once tells the player nothing. So it
// goes to the hottest thread and only when it has genuinely earned it; below
// that the label describes the thread on its own terms.
function tempOf(heat, isTop) {
  if (isTop && heat >= 24) return { word: 'The story of your show', tone: 'bad' };
  if (heat >= 24) return { word: 'Out of hand', tone: 'bad' };
  if (heat >= 12) return { word: 'A feud', tone: 'warn' };
  return { word: 'Building', tone: 'plain' };
}

// How much of it there is, and how fresh. "Fourteen weeks of it" was true of
// almost every thread and therefore said nothing; the count and the recency
// tell them apart.
function volume(state, entry) {
  const count = entry.thread.events.length;
  const since = state.week - entry.thread.lastWeek;
  const how = `${count} ${count === 1 ? 'thing' : 'things'}`;
  const when = since === 0 ? 'the latest of them tonight'
    : since === 1 ? 'the last of them last week'
    : `nothing for ${since} weeks`;
  return `${how} between them, ${when}`;
}

export function threadPanel(state) {
  const threads = liveThreads(state, 5);
  if (!threads.length) return null;

  return el('div', {},
    el('h3', { text: 'What is building' }),
    el('p', { class: 'muted thread-note', text: 'Nobody wrote these. They are what the last few weeks added up to.' }),
    el('ul', { class: 'threads' },
      threads.map((entry, index) => {
        const temp = tempOf(entry.heat, index === 0);
        return el('li', { class: 'thread' },
          el('div', { class: 'thread-head' },
            el('span', { class: 'thread-pair' },
              wrestlerLink(state, entry.thread.a),
              ' and ',
              wrestlerLink(state, entry.thread.b)
            ),
            el('span', { class: `thread-temp thread-${temp.tone}`, text: temp.word })
          ),
          el('span', { class: 'thread-why', text: `${volume(state, entry)}. Where it turned: ${headline(entry)}.` })
        );
      })
    )
  );
}

// The compact version, for a wrestler's own card.
export function threadList(state, wrestlerId) {
  const threads = threadsFor(state, wrestlerId, 3);
  if (!threads.length) return null;

  return el('div', {},
    el('h4', { text: 'What they have going' }),
    el('ul', { class: 'threads threads-compact' },
      threads.map(entry => {
        const otherId = entry.thread.a === wrestlerId ? entry.thread.b : entry.thread.a;
        const temp = tempOf(entry.heat, false);
        return el('li', { class: 'thread' },
          el('div', { class: 'thread-head' },
            wrestlerLink(state, otherId),
            el('span', { class: `thread-temp thread-${temp.tone}`, text: temp.word })
          ),
          el('span', { class: 'thread-why', text: `${headline(entry)}.` })
        );
      })
    )
  );
}
