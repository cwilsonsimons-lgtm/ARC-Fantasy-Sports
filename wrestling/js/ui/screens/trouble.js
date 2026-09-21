// Everything waiting on the GM, and everything that already went one way or
// the other.
//
// The top half is answerable: open, and somebody has actually told the GM.
// The bottom half is the record, including the incidents nobody ever mentioned
// - those only appear here after the night is over, which is the only point at
// which knowing about them cannot change anything.

import * as store from '../../core/store.js';
import { INCIDENT_SPECS, INCIDENT_STATUS, severityLabel } from '../../models/incident.js';
import { incidentCard, incidentRow } from '../incidentCard.js';
import { locationName } from '../../models/location.js';
import { esc, mmss } from '../format.js';
import { notLoaded } from './roster.js';

export default {
  label: 'Trouble',
  render() {
    if (!store.isLoaded()) return notLoaded();

    const answerable = store.answerableIncidents();
    const open = store.openIncidents();
    const quiet = open.length - answerable.length;

    const settled = store.allIncidents()
      .filter((i) => i.status !== INCIDENT_STATUS.OPEN)
      .sort((a, b) => b.day - a.day || b.tick - a.tick)
      .slice(0, 30);

    const waiting = answerable.length
      ? answerable.map((i) => incidentCard(i)).join('')
      : `<p class="empty">Nothing is waiting on you. That is either a quiet night or a sign
         that nobody is telling you anything.</p>`;

    // How the GM has handled things so far, which is a character sheet of a
    // kind: a GM who answers everything with security is a different GM.
    const byResponse = {};
    for (const i of store.allIncidents()) {
      if (!i.response) continue;
      byResponse[i.response] = (byResponse[i.response] || 0) + 1;
    }
    const habits = Object.entries(byResponse)
      .sort((a, b) => b[1] - a[1])
      .map(([key, n]) => `<div class="kv"><span>${esc(key.replace(/_/g, ' '))}</span><span>${n}</span></div>`)
      .join('') || '<p class="empty">You have not had to do anything yet.</p>';

    const lapsed = store.allIncidents().filter((i) => i.status === INCIDENT_STATUS.UNRESOLVED);
    const neverHeard = store.allIncidents().filter((i) => i.discoveredTick == null
      && i.status !== INCIDENT_STATUS.OPEN);

    return `
      <h1>Trouble</h1>
      <p class="sub">${answerable.length} waiting on you${
        quiet ? ` &middot; ${quiet} more happening that nobody has mentioned` : ''}</p>

      <div class="cols two">
        <div>
          ${waiting}

          <h2>What has already happened</h2>
          <div class="sheet">${settled.map(incidentRow).join('')
            || '<p class="empty">Nothing yet.</p>'}</div>
        </div>

        <div>
          <section class="panel">
            <div class="head"><h2>How you handle things</h2></div>
            <div class="body">
              ${habits}
              <p class="sub">There is no right answer here. Security always works and is never
                forgiven; talking is free of resentment and often fails.</p>
            </div>
          </section>

          <section class="panel">
            <div class="head"><h2>The record</h2></div>
            <div class="body">
              <div class="kv"><span>Things that have gone wrong</span><span>${store.allIncidents().length}</span></div>
              <div class="kv"><span>Answered</span><span>${store.allIncidents().filter((i) => i.response).length}</span></div>
              <div class="kv"><span>Left as they were</span><span>${lapsed.length}</span></div>
              <div class="kv"><span>You never heard about</span><span>${neverHeard.length}</span></div>
              <p class="sub">The last line is the case for being better wired in. Nothing you
                were never told about cost you anything, but nothing you were never told about
                could be turned into television either.</p>
            </div>
          </section>

          <section class="panel">
            <div class="head"><h2>Who is on a warning</h2></div>
            <div class="body">
              ${store.allWrestlers()
                .filter((w) => w.state.discipline.warnings || w.state.discipline.suspendedUntilDay)
                .map((w) => `<div class="kv">
                  <span>${esc(w.name)}</span>
                  <span>${w.state.discipline.suspendedUntilDay != null
                    ? `suspended to day ${w.state.discipline.suspendedUntilDay}`
                    : `${w.state.discipline.warnings} warning${w.state.discipline.warnings === 1 ? '' : 's'}`}</span>
                </div>`).join('')
                || '<p class="empty">Nobody has been in front of you yet.</p>'}
            </div>
          </section>
        </div>
      </div>`;
  },
};
