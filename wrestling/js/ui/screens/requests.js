// The inbox: what the roster is asking you for, and why.
//
// There is no Grant button. A request is granted by booking the thing they
// asked for, which keeps the GM's answer and the GM's card the same act. You
// can refuse to somebody's face, which costs less than letting it sit until the
// show passes and they find out you were never going to.

import * as store from '../../core/store.js';
import { EVENT_TYPES } from '../../core/events.js';
import {
  REQUEST_KINDS, REQUEST_LABEL, REQUEST_STATUS, PERSON_KINDS,
} from '../../models/request.js';
import { satisfactionOf, DIMENSION_LABEL } from '../../systems/satisfaction.js';
import { esc, titleCase, meter } from '../format.js';
import { notLoaded } from './roster.js';

const STATUS_TONE = {
  [REQUEST_STATUS.GRANTED]: 'brass',
  [REQUEST_STATUS.DENIED]: '',
  [REQUEST_STATUS.IGNORED]: 'grease',
};

/** What the GM would have to do to say yes. */
function howToGrant(r) {
  switch (r.kind) {
    case REQUEST_KINDS.TITLE_SHOT:
      return `Book them in a match for the ${store.getTitle(r.titleId)?.shortName || ''} title`;
    case REQUEST_KINDS.FACE_RIVAL:
    case REQUEST_KINDS.MATCH_WITH:
      return `Book them against ${store.nameOf(r.targetId)}`;
    case REQUEST_KINDS.TAG_WITH:
      return `Book them in a tag match alongside ${store.nameOf(r.targetId)}`;
    case REQUEST_KINDS.AVOID:
      return `Keep them off the same match as ${store.nameOf(r.targetId)} for a show`;
    case REQUEST_KINDS.MORE_SEGMENT_TIME:
      return 'Give them a match with a limit worth their standing';
    case REQUEST_KINDS.MORE_TV_TIME:
      return 'Give them enough airtime on one show';
    case REQUEST_KINDS.BETTER_ROLE:
      return 'Book them near the top of a card';
    default:
      return '';
  }
}

export default {
  label: 'Requests',
  render() {
    if (!store.isLoaded()) return notLoaded();

    const open = store.openRequests();
    const resolved = store.allRequests()
      .filter((r) => r.status !== REQUEST_STATUS.OPEN)
      .sort((a, b) => (b.resolvedOnDay ?? 0) - (a.resolvedOnDay ?? 0))
      .slice(0, 12);

    const rows = open.map((r) => {
      const w = store.getWrestler(r.wrestlerId);
      const sat = satisfactionOf(r.wrestlerId);
      return `<tr>
        <td><button class="rowlink" data-action="go" data-arg="wrestler/${w.id}"><strong>${esc(w.name)}</strong></button>
          <div class="muted" style="font-size:11px">${esc(titleCase(w.standing.careerStatus))}
            ${w.standing.rank ? `&middot; #${w.standing.rank}` : ''}</div></td>
        <td><span class="pill ${r.urgency >= 70 ? 'grease' : ''}">${esc(REQUEST_LABEL[r.kind])}</span>
          <div style="font-size:12px;margin-top:.25rem">${esc(r.text)}</div></td>
        <td style="font-size:12px">${r.reasons.map((x) => esc(x)).join('<br>')}</td>
        <td class="num">${r.urgency}${meter(r.urgency, 40)}
          <div class="muted" style="font-size:11px">morale ${Math.round(w.state.morale)} &middot; sat ${sat.overall}</div></td>
        <td style="font-size:12px" class="muted">${esc(howToGrant(r))}</td>
        <td><button class="act danger" data-action="denyRequest" data-id="${r.id}">Tell them no</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" class="empty">Nobody is asking for anything. Run a show.</td></tr>';

    const history = resolved.map((r) => `<tr>
      <td>${esc(store.nameOf(r.wrestlerId))}</td>
      <td>${esc(REQUEST_LABEL[r.kind])}${PERSON_KINDS.includes(r.kind) && r.targetId ? ` <span class="muted">(${esc(store.nameOf(r.targetId))})</span>` : ''}</td>
      <td><span class="pill ${STATUS_TONE[r.status]}">${esc(titleCase(r.status))}</span></td>
      <td class="num muted">d${r.resolvedOnDay ?? '-'}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="empty">Nothing settled yet.</td></tr>';

    const counts = store.allRequests().reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1; return acc;
    }, {});

    // Who is unhappiest, and about what.
    const unhappy = store.allWrestlers()
      .map((w) => ({ w, sat: satisfactionOf(w.id) }))
      .sort((a, b) => a.sat.overall - b.sat.overall)
      .slice(0, 6)
      .map(({ w, sat }) => `<tr>
        <td><button class="rowlink" data-action="go" data-arg="wrestler/${w.id}">${esc(w.name)}</button></td>
        <td class="num ${sat.overall < 35 ? 'neg' : ''}">${sat.overall}${meter(sat.overall, 35)}</td>
        <td class="num">${Math.round(w.state.morale)}</td>
        <td>${esc(DIMENSION_LABEL[sat.worst.key])} <span class="num neg">${Math.round(sat.worst.score)}</span></td>
        <td style="font-size:12px" class="muted">${esc(sat.worst.reasons[0] || '')}</td>
      </tr>`).join('');

    return `
      <h1>Requests</h1>
      <p class="sub">${open.length} open &middot;
        ${counts.granted || 0} granted, ${counts.denied || 0} refused, ${counts.ignored || 0} never answered.
        Every one comes from the record, never from a dice roll.</p>

      <div class="scroller"><table>
        <thead><tr><th>Wrestler</th><th>Asking for</th><th>Because</th><th>Urgency</th><th>To say yes</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>

      <h2>Unhappiest in the room</h2>
      <div class="scroller"><table>
        <thead><tr><th>Wrestler</th><th>Satisfaction</th><th>Morale</th><th>Worst of it</th><th>Why</th></tr></thead>
        <tbody>${unhappy}</tbody>
      </table></div>

      <h2>Recently settled</h2>
      <div class="scroller"><table>
        <thead><tr><th>Wrestler</th><th>Asked for</th><th>Outcome</th><th>When</th></tr></thead>
        <tbody>${history}</tbody>
      </table></div>`;
  },
};
