// The GM at Gorilla while the show goes out, and the review once it is over.
// No simulation yet: every item takes exactly its planned time.
import { el } from './dom.js';
import { commit } from '../store.js';
import { PHASES, completeSegment, advanceWeek, availableResponses, resolveIncidentResponse } from '../model/game.js';
import {
  currentItem, upcomingItems, airedItems, elapsedMinutes, remainingMinutes,
} from '../model/broadcast.js';
import { itemLabel, typeLabel } from './labels.js';
import { matchType } from '../data/match-types.js';
import { titleById } from '../model/titles.js';
import { SEVERITIES, responseById, suspensionLabel, proportionality } from '../data/responses.js';
import { gmReputation } from '../model/discipline.js';
import { tierOf, nextTier } from '../model/network.js';
import { backstagePanel } from './backstage.js';
import { threadPanel } from './threads.js';
import { incidentLine, demandLine, momentLine } from './incident-text.js';
import { hasTwoSides, incidentKind } from '../data/backstage.js';
import { locationName, locationProse } from '../data/locations.js';
import { authority, minutesLeft, whereYouAre } from '../model/backstage.js';
import { showsStopwatch, projectedFinish, readsProportionality } from '../model/unlocks.js';
import { byId } from '../model/wrestlers.js';
import { anticipationFor } from '../model/rivalries.js';
import { isPromo } from '../model/promos.js';
import { intensity } from '../data/promos.js';
import { bossView } from '../model/executives.js';

// Kinds that read as a situation, all of which the interface words the same way
// whether it is asking about one or recording it.
const BACKSTAGE_KINDS = new Set([
  'attack', 'brawl', 'ambush', 'argument', 'tag-dispute', 'faction-dispute',
  'complaint', 'storm-in', 'confrontation', 'refusal', 'walkout',
  'cheap-shot', 'submission-held', 'faction-beatdown',
]);

// And the things that only ever happen — nobody rules on a handshake.
const MOMENT_KINDS = new Set([
  'handshake', 'handshake-refused', 'stare-down', 'champion-challenge',
  'broke-it-up', 'balked', 'tie-formed',
]);

// Everything that belongs in the "tonight so far" feed rather than the rundown.
const INCIDENT_TYPES = new Set([
  'attack', 'brawl', 'ambush', 'argument', 'tag-dispute', 'faction-dispute',
  'complaint', 'storm-in', 'confrontation', 'refusal', 'walkout',
  'cheap-shot', 'submission-held', 'faction-beatdown',
  'handshake', 'handshake-refused', 'stare-down', 'champion-challenge',
  'save', 'escalation', 'hesitation', 'nobody', 'balked', 'broke-it-up', 'ruling',
  'missed', 'walked-out', 'pulled-item', 'granted-leave', 'talked', 'moved',
  'tie-formed',
]);

// Why somebody went. The reason is the whole point — a save that just happens
// is a dice roll, a save with a motive attached is a story.
const MOTIVE_LINE = {
  alliance: 'They have stood together before.',
  faction: 'You go after one of them, you go after all of them.',
  partner: 'That is their tag partner on the floor.',
  mentor: 'One of them brought the other one up.',
  love: 'Everybody in the building knows what those two are.',
  debt: 'That debt has been sitting there a while.',
  revenge: 'Nothing to do with the victim. Everything to do with who was swinging.',
  morality: 'No reason beyond it being wrong.',
  interest: 'They need that one upright later tonight.',
  respect: 'They barely know them. They went anyway.',
  ambition: 'A chance to be in something that matters.',
};
import { itemLabelNodes, participantLinks, wrestlerLink } from './links.js';
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

    // An incident can fire off the last match of the night, which leaves the
    // broadcast finished but the evening very much not.
    item
      ? el('div', { class: 'onair' },
          el('div', { class: 'label', text: 'On air now' }),
          el('div', { class: 'title' }, itemLabelNodes(state, item)),
          el('div', { class: 'muted' }, `${typeLabel(item)} · `, participantLinks(state, item.participants)),
          el('div', {}, 'Planned duration: ', el('b', { text: `${item.plannedMinutes} minutes` }))
        )
      : el('div', { class: 'onair onair-done' },
          el('div', { class: 'label', text: 'Off the air' }),
          el('div', { class: 'title', text: 'The broadcast is over. This is not.' })
        ),

    // What is on the air, and whether anybody is waiting for it. Said while it
    // is happening, because that is when the GM is deciding how long to give it.
    onAirLine(state, item),

    el('div', { class: 'totals' },
      el('div', {}, 'Current Show Time: ', el('b', { text: `${elapsedMinutes(broadcast)} minutes` })),
      el('div', {}, 'Time Remaining: ',
        el('b', { class: left < 0 ? 'over' : '', text: `${left} minutes` })
      ),
      el('div', {}, 'Show Length: ', el('b', { text: `${show.runtimeMinutes} minutes` }))
    ),

    stopwatchLine(state),

    left < 0 ? el('div', { class: 'notice warn', text: 'This show has run past its broadcast window.' }) : null,

    decisionPanel(state),

    // The night the GM is having, alongside the one going out on television.
    item ? backstagePanel(state) : null,

    item
      ? el('p', {},
          el('button', {
            type: 'button', class: 'btn primary',
            text: minutesLeft(state) > 0 ? 'Let it run' : 'Complete Segment',
            disabled: Boolean(state.pendingIncident),
            onClick: () => commit(s => completeSegment(s)),
          }),
          state.pendingIncident
            ? el('span', { class: 'muted', text: '  The show is holding until you answer.' })
            : minutesLeft(state) > 0
              ? el('span', { class: 'muted', text: `  Gives up the ${minutesLeft(state)} minutes you have left backstage.` })
              : null
        )
      : null,

    incidentPanel(state),

    el('h3', { text: `Remaining rundown (${upcoming.length})` }),
    upcoming.length
      ? rundownTable(state, show, upcoming)
      : el('p', { class: 'empty', text: 'Nothing left after this. Completing it ends the show.' })
  );
}

// The show stops and asks. An incident is a situation, not a verdict — what it
// becomes is the GM's call, and the room will have an opinion about the call.
function decisionPanel(state) {
  const incident = state.pendingIncident;
  if (!incident) return null;

  const aggressor = nameOf(state.wrestlers, incident.aggressorId);
  const victim = hasTwoSides(incident) ? nameOf(state.wrestlers, incident.victimId) : 'you';
  const fill = text => text.replace('{aggressor}', aggressor).replace('{victim}', victim);
  const kind = incidentKind(incident.kind || 'attack');
  const severity = SEVERITIES[incident.severity] || SEVERITIES.moderate;

  return el('div', { class: 'decision' },
    el('div', { class: 'decision-head' },
      el('span', { class: `sev sev-${incident.severity}`, text: severity.label }),
      el('span', { class: 'decision-kind', text: kind.label }),
      incident.locationId
        ? el('span', { class: 'decision-where', text: locationName(incident.locationId) })
        : null,
      el('span', { class: 'decision-what', text: 'What are you going to do about this?' })
    ),
    el('p', { class: 'decision-line', text: incidentLine(state, incident.kind || 'attack', incident) }),
    incident.demand
      ? el('p', { class: 'decision-demand', text: demandLine(incident.demand) })
      : null,
    // Arriving after the room has made up its mind is not the same as being
    // there, and the player should know that before they choose.
    incident.late
      ? el('p', { class: 'decision-late', text: 'You got here late. Whatever you decide now, they had already worked out that nobody was coming.' })
      : null,
    incident.deferrals
      ? el('p', { class: 'decision-late', text: 'You put this off once already.' })
      : null,
    el('div', { class: 'options' },
      availableResponses(state).map(response =>
        el('button', {
          type: 'button', class: 'option',
          onClick: () => commit(s => resolveIncidentResponse(s, response.id)),
        },
          el('span', { class: 'option-label', text: fill(response.label) }),
          el('span', { class: 'option-note', text: response.note }),
          readingOf(state, incident, response)
        )
      )
    )
  );
}

// The rest of the card, against the rest of the window. Only shown with
// Stopwatch, because working out for yourself that six segments at nine
// minutes will not fit into forty is a thing a GM can do and a thing this
// upgrade is for not having to do.
function onAirLine(state, item) {
  if (!item) return null;
  if (isPromo(item)) {
    const level = intensity(item.intensityId);
    const said = (item.ammo || []).length;
    return el('p', { class: 'net-note muted', text:
      `${level.label}. ${said ? `${said} thing${said === 1 ? '' : 's'} they are allowed to bring up.` : 'Nothing specific to bring up.'}` });
  }
  if (item.type !== 'match') return null;
  const read = anticipationFor(state, item);
  if (!read) return null;
  return el('p', { class: `net-note tone-${read.tone}`, text: `${read.label}.` });
}

function stopwatchLine(state) {
  if (!showsStopwatch(state) || !state.broadcast) return null;
  const read = projectedFinish(state.show, state.broadcast);
  if (!read || !read.toCome) return null;

  const over = read.over;
  const word = over > 0
    ? `The card as it stands finishes ${over} minute${over === 1 ? '' : 's'} past the window.`
    : over < 0
      ? `${-over} minute${over === -1 ? '' : 's'} of window spare once the card has run.`
      : 'The card as it stands finishes exactly on the window.';

  return el('div', { class: `stopwatch ${over > 0 ? 'stopwatch-over' : over < 0 ? 'stopwatch-light' : ''}` },
    el('span', { class: 'stopwatch-key', text: 'Stopwatch' }),
    el('span', { class: 'stopwatch-read', text: word }),
    el('span', { class: 'muted', text: `${read.toCome} minutes still to come.` })
  );
}

// How the room will read a call, before it is made. Wrong about one time in
// five, and wronger on somebody the GM has never worked out — a hint, not a
// preview, because judgement is the game.
//
// Deliberately deterministic: the same incident and the same button give the
// same hint every render, so a re-draw never quietly changes the advice.
const READ_WORD = { fair: 'reads as fair', harsh: 'reads as harsh', weak: 'reads as weak' };
const WRONG_ONE_IN = 5;

function readingOf(state, incident, response) {
  if (!readsProportionality(state)) return null;
  if (!response.weight && response.weight !== 0) return null;

  const truth = proportionality(incident.severity, response.id);
  const seed = hashOf(incident.id + ':' + response.id);
  // Somebody you have never worked out is somebody whose reaction you are
  // guessing at, so the hint is wrong more often on a stranger.
  const aggressor = byId(state.wrestlers, incident.aggressorId);
  const known = aggressor && (aggressor.familiarity || 0) >= 42;
  const wrong = seed % (known ? WRONG_ONE_IN : 3) === 0;

  const shown = wrong
    ? (truth === 'fair' ? (seed % 2 ? 'harsh' : 'weak') : 'fair')
    : truth;

  return el('span', { class: `option-read read-${shown}`, text: READ_WORD[shown] });
}

function hashOf(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash;
}

// What has kicked off tonight, as it happens, rather than only in the review.
function incidentPanel(state) {
  const beats = state.journal.filter(entry => INCIDENT_TYPES.has(entry.type));
  if (!beats.length) return null;

  return el('div', {},
    el('h3', { text: 'Tonight so far' }),
    el('ul', { class: 'incidents' },
      beats.map(entry =>
        el('li', { class: `beat beat-${entry.type}` },
          el('span', { class: 'at', text: `${entry.at} min` }),
          journalText(state, entry)
        )
      )
    )
  );
}

function rundownTable(state, show, items) {
  const rows = items.map(item =>
    el('tr', {},
      el('td', { class: 'num', text: show.items.indexOf(item) + 1 }),
      el('td', { text: typeLabel(item) }),
      el('td', {}, itemLabelNodes(state, item)),
      el('td', { class: 'muted' }, participantLinks(state, item.participants)),
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
      el('td', {}, item ? itemLabelNodes(state, item) : '(removed item)'),
      el('td', {}, result.winnerId ? wrestlerLink(state, result.winnerId) : el('span', { class: 'muted', text: '\u2014' })),
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
    officePanel(state, review),
    networkPanel(state),
    reputationPanel(state),

    el('h3', { text: 'The locker room' }),
    moodList(state),

    threadPanel(state),

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
          el('th', { text: 'Winner' }),
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

  if (review.backstage !== 'quiet') {
    lines.unshift(review.backstage === 'noisy'
      ? 'I hear things happened backstage that nobody dealt with. I would rather hear it from you than from them.'
      : 'Your building was out of control tonight. Segments off the card, people walking out. Run it or I will find somebody who will.');
  }

  if (review.breaches > 0) {
    lines.unshift(review.breaches === 1
      ? 'A match I advertised did not happen. I had to explain that to people, which is your job, not mine.'
      : `${review.breaches} advertised matches did not happen. I am not doing this again.`);
  }

  if (review.grudgeCount > 0) {
    lines.push(review.grudgeCount === 1
      ? 'One of your people is carrying something into next week. Handle it before I have to.'
      : `${review.grudgeCount} of your people are carrying something into next week. Handle it before I have to.`);
  }

  return el('div', { class: 'memo' },
    el('div', { class: 'memo-head' },
      el('span', { class: 'memo-from', text: 'Memo from upstairs' }),
      el('span', { class: 'memo-sig', text: `${EXECUTIVE.name} \u00b7 ${EXECUTIVE.role}` })
    ),
    lines.map(line => el('p', { text: `\u201c${line}\u201d` }))
  );
}

// The airtime you have earned, and what the next slice costs.
function networkPanel(state) {
  const award = state.lastReview || {};
  const tier = tierOf(state);
  const next = nextTier(state);
  const trust = state.network.trust;
  const floor = tier.trust;
  const span = next ? Math.max(1, next.trust - floor) : 1;
  const progress = next ? Math.min(100, Math.round(((trust - floor) / span) * 100)) : 100;

  return el('div', { class: award.promoted ? 'network promoted' : 'network' },
    el('div', { class: 'net-head' },
      el('span', { class: 'net-label', text: 'Network' }),
      el('span', {
        class: award.delta > 0 ? 'net-delta up' : award.delta < 0 ? 'net-delta down' : 'net-delta',
        text: award.delta === undefined ? '' : award.delta > 0 ? `trust +${award.delta}` : award.delta < 0 ? `trust ${award.delta}` : 'trust unchanged',
      })
    ),
    award.promoted
      ? el('p', { class: 'net-win', text: `They have given you ${award.promoted.minutes - award.fromMinutes} more minutes. Next week runs ${award.promoted.minutes}.` })
      : el('p', { class: 'net-line', text: next
          ? `${trust} of ${next.trust} toward ${next.minutes} minutes.`
          : 'You have all the airtime they have to give.' }),
    el('div', { class: 'read-bar' }, el('div', { class: 'net-fill', style: `width:${progress}%` }))
  );
}


// Nobody picks this at the start. It is what the room has decided you are,
// from the pattern of calls you actually made.
// Two standings that are about you rather than about the show: whether your
// word carries in the building, and what head office makes of how you run it.
// They move together but they are not the same thing — a locker room can be
// terrified of you and head office still unconvinced.
function officePanel(state, review) {
  const office = authority(state);
  const boss = bossView(state);
  const missed = (state.missed || []).length;

  return el('div', { class: 'office' },
    el('div', { class: 'office-row' },
      el('span', { class: 'office-label', text: 'Your authority' }),
      el('span', { class: `office-read office-${office.tone}`, text: office.phrase })
    ),
    el('div', { class: 'office-row' },
      el('span', { class: 'office-label', text: 'Head office' }),
      el('span', { class: `office-read office-${boss.tone}`, text: boss.phrase })
    ),
    missed
      ? el('p', { class: 'office-missed' },
          el('b', { text: String(missed) }),
          missed === 1
            ? ' thing happened tonight with nobody in the room.'
            : ' things happened tonight with nobody in the room.'
        )
      : el('p', { class: 'office-missed muted', text: 'Nothing happened tonight that you were not there for.' })
  );
}

function reputationPanel(state) {
  const reputation = gmReputation(state);
  if (!reputation) return null;
  return el('div', { class: 'reputation' },
    el('span', { class: 'rep-label', text: 'They have you down as' }),
    el('span', { class: 'rep-name', text: reputation.label }),
    el('span', { class: 'rep-blurb', text: reputation.blurb })
  );
}

// Demeanour, not digits: a word per wrestler, unhappiest first.
function moodList(state) {
  const roster = byMood(state.wrestlers.filter(bookable));

  return el('ul', { class: 'moods' },
    roster.map(w =>
      el('li', {},
        el('span', { class: 'mood-name' }, wrestlerLink(state, w.id)),
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
        wrestlerLink(state, w.id),
        ' \u2014 ',
        w.grudges.map(g => grudgeText(state, w, g)).join('; ')
      )
    )
  );
}

// Grudges store a type and a target, never a sentence. This writes the sentence.
function grudgeText(state, wrestler, grudge) {
  if (grudge.type === 'punished') {
    return grudge.data.onBehalfOf
      ? `thinks you went too hard on ${nameOf(state.wrestlers, grudge.data.onBehalfOf)}`
      : 'thinks your punishment did not fit what happened';
  }
  if (grudge.type === 'broken-promise') {
    return 'was promised a match that never came';
  }
  if (grudge.type === 'attacked') {
    return `jumped after the bell by ${nameOf(state.wrestlers, grudge.targetId)}`;
  }
  if (grudge.type === 'abandoned') {
    return `left to it by ${nameOf(state.wrestlers, grudge.targetId)}`;
  }
  if (grudge.type === 'hated-match') {
    const target = grudge.targetId ? nameOf(state.wrestlers, grudge.targetId) : 'management';
    return `put in a ${matchType(grudge.data.matchTypeId).name.toLowerCase()} by ${target}`;
  }
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
//
// `items` is the pool those references point into. It defaults to tonight's
// card, but an archived week keeps its own, and resolving last month's journal
// against this week's card turns every line into "(removed item)".
export function journalText(state, entry, items = state.show.items) {
  if (entry.type === 'show-start') return 'The show goes on the air.';
  if (entry.type === 'show-end') return 'The broadcast ends.';
  if (entry.type === 'argument') {
    return `${nameOf(state.wrestlers, entry.data.aggressorId)} and ${nameOf(state.wrestlers, entry.data.victimId)} went at it backstage.`;
  }
  if (entry.type === 'ruling') {
    const response = responseById(entry.data.responseId);
    const who = nameOf(state.wrestlers, entry.data.aggressorId);
    const label = response ? response.label.replace('{aggressor}', who) : 'A ruling was made';
    const read = entry.data.read === 'harsh' ? ' The room thought that was heavy.'
      : entry.data.read === 'weak' ? ' The room noticed you let it go.'
      : '';
    const pulled = entry.data.pulled ? ` ${entry.data.pulled} booked segment${entry.data.pulled === 1 ? '' : 's'} came off the card.` : '';
    const late = entry.data.late ? ' You were not there when it started.' : '';
    return `Your call: ${label}.${read}${pulled}${late}`;
  }

  // Everything that is a situation rather than a consequence reads the same way
  // here as it did when you were asked about it.
  if (BACKSTAGE_KINDS.has(entry.type)) {
    return incidentLine(state, entry.type, entry.data);
  }
  if (MOMENT_KINDS.has(entry.type)) {
    return momentLine(state, entry.type, entry.data) || '';
  }
  if (entry.type === 'missed') {
    // The line above this one already said what happened. Repeating it and then
    // adding a clause read as the game saying the same thing twice.
    const where = entry.data.whereYouWere
      ? ` You were in ${locationProse(entry.data.whereYouWere)}.`
      : '';
    return `Nobody with any authority was there for that.${where}`;
  }
  if (entry.type === 'walked-out') {
    return `${nameOf(state.wrestlers, entry.data.wrestlerId)} got in the car and drove off. Not expected back for ${entry.data.weeks} weeks.`;
  }
  if (entry.type === 'pulled-item') {
    const who = entry.data.participants.map(id => nameOf(state.wrestlers, id)).join(' vs. ');
    return `${who} came off the card. Nobody was at the curtain to make it happen.`;
  }
  if (entry.type === 'granted-leave') {
    return `${nameOf(state.wrestlers, entry.data.wrestlerId)} asked to be let go and you agreed. ${entry.data.weeks} weeks.`;
  }
  if (entry.type === 'talked') {
    return `You found ${nameOf(state.wrestlers, entry.data.wrestlerId)} and heard them out.`;
  }
  if (entry.type === 'moved') {
    return `You headed for ${locationProse(entry.data.locationId)}.`;
  }
  if (entry.type === 'title-change') {
    const title = titleById(state, entry.data.titleId);
    const winners = entry.data.championIds.map(id => nameOf(state.wrestlers, id)).join(' & ');
    const former = (entry.data.formerIds || []).map(id => nameOf(state.wrestlers, id)).join(' & ');
    return former
      ? `${winners} took the ${title ? title.name : 'championship'} off ${former}.`
      : `${winners} won the vacant ${title ? title.name : 'championship'}.`;
  }
  if (entry.type === 'title-defended') {
    const title = titleById(state, entry.data.titleId);
    const champs = entry.data.championIds.map(id => nameOf(state.wrestlers, id)).join(' & ');
    return `${champs} held onto the ${title ? title.name : 'championship'}.`;
  }
  if (entry.type === 'title-created') {
    const title = titleById(state, entry.data.titleId);
    return `The network has sanctioned the ${title ? title.name : 'new championship'}. It starts vacant.`;
  }
  if (entry.type === 'breach') {
    const who = entry.data.participants.map(id => nameOf(state.wrestlers, id)).join(' vs. ');
    return entry.data.advertised
      ? `${who} was advertised and never happened.`
      : `${who} was promised privately and never happened.`;
  }
  if (entry.type === 'window-extended') {
    return `The network has extended the show to ${entry.data.minutes} minutes.`;
  }
  if (entry.type === 'promise-broken') {
    return `${nameOf(state.wrestlers, entry.data.victimId)} never got the match you promised them.`;
  }
  if (entry.type === 'opportunity-cold') {
    return `Whatever was brewing between ${nameOf(state.wrestlers, entry.data.victimId)} and ${nameOf(state.wrestlers, entry.data.aggressorId)} has gone cold.`;
  }
  if (entry.type === 'attack') {
    return `${nameOf(state.wrestlers, entry.data.aggressorId)} jumped ${nameOf(state.wrestlers, entry.data.victimId)} after the bell.`;
  }
  if (entry.type === 'save' || entry.type === 'escalation') {
    const saver = nameOf(state.wrestlers, entry.data.saverId);
    const withThem = (entry.data.withIds || []).map(id => nameOf(state.wrestlers, id));
    // A faction does not send a representative, and the line should not read as
    // though it did.
    const company = withThem.length
      ? ` ${withThem.join(' and ')} came with them.`
      : '';
    const why = MOTIVE_LINE[entry.data.motive] || '';
    return entry.type === 'save'
      ? `${saver} came out to make the save.${company} ${why}`
      : `${saver} piled in on ${nameOf(state.wrestlers, entry.data.aggressorId)}.${company} ${why}`;
  }
  if (entry.type === 'hesitation') {
    return `${nameOf(state.wrestlers, entry.data.wrestlerId)} came out, stopped halfway, and went back. ${nameOf(state.wrestlers, entry.data.victimId)} saw all of it.`;
  }
  if (entry.type === 'nobody') {
    return `Nobody moved. ${nameOf(state.wrestlers, entry.data.victimId)} took all of it alone.`;
  }
  if (entry.type === 'hated-booking') {
    const who = nameOf(state.wrestlers, entry.data.wrestlerId);
    return `${who} was put in a ${matchType(entry.data.matchTypeId).name.toLowerCase()} and did not hide what they thought of it.`;
  }
  if (entry.type === 'grudges-formed') {
    return `${nameList(state, entry.data.wrestlerIds)} stopped assuming the omission is an accident.`;
  }
  if (entry.type === 'noticed') {
    const who = nameOf(state.wrestlers, entry.data.wrestlerId);
    const them = nameOf(state.wrestlers, entry.data.targetId);
    return entry.data.reason === 'title'
      ? `${who} watched ${them} get handed a championship and counted the years.`
      : `${who} noticed exactly whose night that main event was.`;
  }

  const item = items.find(candidate => candidate.id === entry.itemId) || null;
  const label = item ? itemLabel(state, item) : '(removed item)';
  const { plannedMinutes, actualMinutes } = entry.data;
  const timing = actualMinutes === plannedMinutes
    ? `ran its planned ${plannedMinutes} minutes`
    : `planned for ${plannedMinutes}, ran ${actualMinutes}`;
  const won = entry.data.winnerId
    ? ` ${nameOf(state.wrestlers, entry.data.winnerId)} went over.`
    : '';
  return `${label} — ${timing}.${won}`;
}
