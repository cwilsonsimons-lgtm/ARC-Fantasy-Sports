// The building, and what reaches you in it.
//
// This screen only ever shows the GM two things: where they are standing, and
// what they have actually been told. It deliberately does not show news still
// in transit, or news that never found them - a fog you can see through is not
// a fog, and the whole point of the layer is that the GM's picture of the night
// is late and partial.
//
// Walking is the one verb here, and it costs time. Crossing the building while
// a show is running means the show carries on without you, which is exactly the
// trade the design foundation asks for.

import * as store from '../../core/store.js';
import { EVENT_TYPES } from '../../core/events.js';
import {
  LOCATION_IDS, LOCATIONS, locationName, locationShort, hops, travelSeconds, route, isOnAir,
} from '../../models/location.js';
import { RELIABILITY, RELIABILITY_LABEL, confidenceOf, lateness } from '../../models/notification.js';
import { willingnessToTell, TELL_THRESHOLD, awareness, BASE_DELAY_SEC, DELAY_PER_HOP_SEC, MAX_AWARENESS_CUT } from '../../systems/notifications.js';
import { esc, mmss, meter, titleCase } from '../format.js';
import { incidentCard } from '../incidentCard.js';
import { notLoaded } from './roster.js';

/** Reliability decides how much of the accent a line is allowed. */
const RELIABILITY_TONE = {
  [RELIABILITY.WITNESSED]: 'green',
  [RELIABILITY.FIRSTHAND]: 'blue',
  [RELIABILITY.SECONDHAND]: 'amber',
  [RELIABILITY.RUMOUR]: 'red',
};

/** Rooms in walking order from where you are: here first, then nearest out. */
export function buildingFrom(here) {
  return LOCATION_IDS
    .map((id) => ({
      id,
      room: LOCATIONS[id],
      away: hops(here, id),
      seconds: travelSeconds(here, id),
      who: store.whoIsIn(id),
      trouble: store.answerableIncidents().filter((i) => i.locationId === id).length,
    }))
    .sort((a, b) => a.away - b.away || a.room.name.localeCompare(b.room.name));
}

/** How long news from a given distance takes to find you right now. */
export function newsDelay(distance) {
  const cut = 1 - (awareness() / 100) * MAX_AWARENESS_CUT;
  return Math.round((BASE_DELAY_SEC + distance * DELAY_PER_HOP_SEC) * cut);
}

function roomCard(entry, here) {
  const { id, room, away, seconds, who, trouble } = entry;
  const youAreHere = id === here;
  // Trouble you have been told about outranks everything else about a room.
  const tone = trouble ? ' bad' : youAreHere ? ' good' : room.onAir ? ' warn' : '';
  const cost = youAreHere
    ? 'You are here'
    : `${mmss(seconds)} walk &middot; ${away} door${away === 1 ? '' : 's'}`;
  return `
    <button class="wcard${tone}" data-action="walkTo" data-room="${id}"${youAreHere ? ' aria-current="true"' : ''}>
      <span class="who">
        <span class="nm">${esc(room.name)}</span>
        <span class="sub">${cost}</span>
      </span>
      ${trouble ? `<span class="tag red">${trouble}</span>` : ''}
      ${room.onAir ? '<span class="tag amber">On air</span>' : ''}
      <span class="tag${who.length ? ' blue' : ''}">${who.length}</span>
    </button>`;
}

function personCard(w) {
  const tells = willingnessToTell(w);
  const tone = tells >= 55 ? ' good' : tells < TELL_THRESHOLD ? ' bad' : '';
  return `
    <button class="wcard${tone}" data-action="go" data-arg="wrestler/${w.id}">
      <span class="who">
        <span class="nm">${esc(w.name)}</span>
        <span class="sub">${esc(titleCase(w.standing.careerStatus))} &middot; talks to you ${tells}</span>
      </span>
      ${store.titlesHeldBy(w.id).map((t) => `<span class="tag amber">${esc(t.shortName)}</span>`).join('')}
    </button>`;
}

/**
 * One thing you have been told.
 *
 * The second line is the notification's own `detail`, which is written where
 * the reliability is decided, so the explanation cannot drift from the label.
 */
function noteRow(n) {
  const late = lateness(n);
  return `
    <button class="slot note${n.read ? ' done' : ' next'}" data-action="readNews" data-id="${n.id}">
      <span class="what">
        <span class="t">${esc(n.summary)}</span>
        <span class="d">${esc(n.detail || locationName(n.locationId))}${
          late ? ` &middot; ${mmss(late)} late` : ''}</span>
      </span>
      <span class="side">
        <span class="tag ${RELIABILITY_TONE[n.reliability] || ''}">${esc(RELIABILITY_LABEL[n.reliability] || n.reliability)}</span>
        <span class="time">${confidenceOf(n)}%</span>
      </span>
    </button>`;
}

export default {
  label: 'Backstage',
  render() {
    if (!store.isLoaded()) return notLoaded();

    const here = store.gmLocation();
    const room = LOCATIONS[here];
    const clock = store.tick();
    const building = buildingFrom(here);
    const inHere = store.whoIsIn(here);

    const heard = store.deliveredNotifications()
      .slice()
      .sort((a, b) => b.deliveredTick - a.deliveredTick || b.raisedTick - a.raisedTick);
    const unread = heard.filter((n) => !n.read).length;

    const rooms = building.map((e) => roomCard(e, here)).join('');

    const people = inHere.length
      ? inHere.map(personCard).join('')
      : `<p class="empty">Nobody else is in ${esc(room.name)}. Whatever is happening tonight,
         it is happening somewhere you are not.</p>`;

    // Anything going on where you are standing. Trouble elsewhere is not shown
    // here: you would have to be told about it, and being told is the Tier 7
    // notification feed below.
    const rightHere = store.answerableIncidents()
      .filter((i) => i.locationId === here);
    const elsewhere = store.answerableIncidents().length - rightHere.length;

    const news = heard.length
      ? heard.slice(0, 24).map(noteRow).join('')
      : `<p class="empty">Nothing has reached you yet. News takes time to cross the building,
         and somebody has to want to bring it.</p>`;

    // Who, in the whole building, would actually come and find you. This is a
    // thing the GM plausibly knows - it is their own standing with people.
    const tellers = store.allWrestlers()
      .map((w) => ({ w, tells: willingnessToTell(w), where: store.locationOf(w.id) }))
      .sort((a, b) => b.tells - a.tells)
      .slice(0, 6)
      .map(({ w, tells, where }) => `
        <div class="kv"><span>${esc(w.shortName)} <span class="muted">&middot; ${esc(locationName(where))}</span></span>
          <span>${tells}</span></div>`).join('');

    const silent = store.allWrestlers().filter((w) => willingnessToTell(w) < TELL_THRESHOLD).length;

    const distances = [0, 1, 2].map((d) => `
      <div class="kv"><span>${d === 0 ? 'In this room' : `${d} door${d === 1 ? '' : 's'} away`}</span>
        <span>${d === 0 ? 'at once' : mmss(newsDelay(d))}</span></div>`).join('');

    const walks = store.queryLog({
      types: [EVENT_TYPES.GM_MOVED], newestFirst: true, limit: 6,
    }).map((e) => {
      // Only the rooms between the ends are worth naming; you know where you
      // set off from and where you ended up.
      const through = (e.data?.via || []).slice(1, -1).map(locationShort);
      return `<div class="ev">
        <span class="d">${mmss(e.data?.seconds || 0)}</span>
        <span><span class="t">${esc(locationName(e.data?.to))}</span>${
          through.length ? `<br><span class="muted">through ${esc(through.join(', '))}</span>` : ''}</span>
      </div>`;
    }).join('')
      || '<p class="empty">You have not moved tonight.</p>';

    return `
      <h1>Backstage</h1>
      <p class="sub">${mmss(clock)} into the night &middot; you are in ${esc(room.name)}
        &middot; ${heard.length} thing${heard.length === 1 ? '' : 's'} have reached you${
          unread ? `, ${unread} unread` : ''}</p>

      <div class="cols three">
        <div>
          <section class="panel">
            <div class="head"><h2>The building</h2><span class="meta">${store.allWrestlers().length} in</span></div>
            <div class="body"><div class="sheet">${rooms}</div></div>
          </section>
        </div>

        <div>
          <section class="panel">
            <div class="head">
              <h2>${esc(room.name)}</h2>
              <span class="meta">${isOnAir(here) ? 'You can run the show from here' : 'Off the air'}</span>
            </div>
            <div class="body">
              <p class="sub" style="margin-top:0">${esc(room.blurb)}</p>
              <div class="sheet">${people}</div>
            </div>
          </section>

          ${rightHere.map((i) => incidentCard(i)).join('')}
          ${elsewhere ? `<p class="sub">${elsewhere} other thing${elsewhere === 1 ? '' : 's'}
            need${elsewhere === 1 ? 's' : ''} you somewhere else.
            <button class="rowlink" data-action="go" data-arg="trouble">See them all</button></p>` : ''}

          <section class="panel">
            <div class="head">
              <h2>What you have been told</h2>
              <span class="meta">${unread ? `${unread} unread` : 'all read'}</span>
            </div>
            <div class="body">
              ${heard.length ? `<div class="bar"><button class="act" data-action="markAllNews">Mark all read</button></div>` : ''}
              <div class="sheet">${news}</div>
            </div>
          </section>
        </div>

        <div>
          <section class="panel">
            <div class="head"><h2>How wired in you are</h2><span class="meta">${awareness()}/100</span></div>
            <div class="body">
              ${meter(awareness(), 1)}
              <p class="sub">Raising this shortens every delay and sharpens what arrives. Nothing raises
                it yet; it is the hook the GM skill tree hangs off.</p>
              ${distances}
            </div>
          </section>

          <section class="panel">
            <div class="head"><h2>Who would tell you</h2><span class="meta">of ${store.allWrestlers().length}</span></div>
            <div class="body">
              ${tellers}
              <p class="sub">${silent
                ? `${silent} ${silent === 1 ? 'person' : 'people'} would not come and find you at all.`
                : 'Everybody would bring you news if they saw something.'}</p>
            </div>
          </section>

          <section class="panel">
            <div class="head"><h2>Where you have walked</h2></div>
            <div class="body"><div class="log narrow">${walks}</div></div>
          </section>
        </div>
      </div>`;
  },
};
