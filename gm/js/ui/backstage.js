// Where the GM is standing, and what that is costing them.
//
// This panel is the tier in one place: a room, a clock, the people in it, and
// everywhere else you could be instead. Reading it is free. Every button on it
// spends minutes you will not get back, and the show goes on regardless.
import { el } from './dom.js';
import { commit } from '../store.js';
import { walkTo, talkTo, goAndLook } from '../model/game.js';
import {
  whereYouAre, minutesLeft, canWalkTo, peopleIn, roomOf, authority, securityLeft,
  SECURITY_STAFF, TALK_MINUTES,
} from '../model/backstage.js';
import { locationProse } from '../data/locations.js';
import { incidentLine } from './incident-text.js';
import { moodWord, moodClass } from './mood.js';
import { bookable } from '../model/morale.js';
import { wrestlerLink } from './links.js';

export function backstagePanel(state) {
  const here = whereYouAre(state);
  const left = minutesLeft(state);
  const held = Boolean(state.pendingIncident);

  return el('div', { class: 'backstage' },
    el('div', { class: 'bs-head' },
      el('div', {},
        el('div', { class: 'bs-label', text: 'Where you are' }),
        el('div', { class: 'bs-room', text: here.name })
      ),
      el('div', { class: 'bs-clock' },
        el('span', { class: left > 0 ? 'bs-min' : 'bs-min bs-min-out', text: String(left) }),
        el('span', { class: 'bs-min-note', text: left === 1 ? 'minute left' : 'minutes left' })
      )
    ),
    el('p', { class: 'bs-note muted', text: here.sees }),

    alertList(state, held),
    roomList(state, here, left, held),
    travelList(state, left, held),
    standingStrip(state)
  );
}

// Something you can hear through a wall. You have until this segment ends to go
// and look, and going costs the walk.
function alertList(state, held) {
  const alerts = state.alerts || [];
  if (!alerts.length) return null;

  return el('div', { class: 'bs-alerts' },
    alerts.map(alert => {
      const minutes = walkCost(state, alert.locationId);
      const reachable = !held && minutes <= minutesLeft(state);
      return el('div', { class: 'bs-alert' },
        el('div', { class: 'bs-alert-what' },
          el('span', { class: 'bs-alert-tag', text: 'You can hear it' }),
          el('span', { text: heardAs(alert, state) })
        ),
        el('button', {
          type: 'button', class: 'btn small',
          text: `Go and look · ${minutes}m`,
          disabled: !reachable,
          onClick: () => commit(s => goAndLook(s, alert.id)),
        })
      );
    })
  );
}

// From the next room you know something is going on and roughly where. You do
// not know what it is until you are standing in it.
function heardAs(alert, state) {
  const where = locationProse(alert.locationId);
  const loud = alert.kind === 'brawl' || alert.kind === 'ambush' || alert.kind === 'attack';
  return loud
    ? `Something has kicked off in ${where}.`
    : `Raised voices from ${where}.`;
}

function walkCost(state, toId) {
  const route = canWalkTo(state).find(r => r.id === toId);
  return route ? route.minutes : 0;
}

function roomList(state, here, left, held) {
  const people = peopleIn(state, here.id);
  if (!people.length) {
    return el('div', {},
      el('h4', { class: 'bs-h', text: 'Here now' }),
      el('p', { class: 'empty', text: 'Nobody. Which is its own kind of information.' })
    );
  }

  const spoken = new Set(state.spokenTo || []);
  return el('div', {},
    el('h4', { class: 'bs-h', text: `Here now (${people.length})` }),
    el('ul', { class: 'bs-people' },
      people.map(w =>
        el('li', {},
          wrestlerLink(state, w.id),
          bookable(w)
            ? el('span', { class: `bs-mood ${moodClass(w)}`, text: moodWord(w) })
            : el('span', { class: 'bs-mood muted', text: w.status }),
          spoken.has(w.id)
            ? el('span', { class: 'bs-spoken', text: 'spoken to' })
            : el('button', {
                type: 'button', class: 'btn small',
                text: `Talk · ${TALK_MINUTES}m`,
                disabled: held || left < TALK_MINUTES,
                onClick: () => commit(s => talkTo(s, w.id)),
              })
        )
      )
    )
  );
}

function travelList(state, left, held) {
  return el('div', {},
    el('h4', { class: 'bs-h', text: 'Go to' }),
    el('div', { class: 'bs-travel' },
      canWalkTo(state).map(route =>
        el('button', {
          type: 'button',
          class: route.affordable ? 'bs-go' : 'bs-go bs-go-far',
          title: route.note,
          disabled: held || route.minutes > left,
          onClick: () => commit(s => walkTo(s, route.id)),
        },
          el('span', { class: 'bs-go-name', text: route.short }),
          el('span', { class: 'bs-go-min', text: `${route.minutes}m` })
        )
      )
    )
  );
}

// Two standing facts the player needs while deciding anything: whether their
// word carries, and how many people they have left to send.
function standingStrip(state) {
  const office = authority(state);
  const left = securityLeft(state);
  return el('div', { class: 'bs-standing' },
    el('span', { class: `bs-auth bs-${office.tone}`, text: office.phrase }),
    el('span', { class: 'bs-security' },
      'Security: ',
      el('b', { class: left ? '' : 'over', text: `${left} of ${SECURITY_STAFF}` })
    )
  );
}

export { incidentLine };
