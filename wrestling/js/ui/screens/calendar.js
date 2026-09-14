// Calendar: the schedule, and the only place game time moves forward.

import * as store from '../../core/store.js';
import * as clock from '../../core/clock.js';
import { esc, titleCase } from '../format.js';
import { notLoaded } from './roster.js';

export default {
  label: 'Calendar',
  render() {
    if (!store.isLoaded()) return notLoaded();
    const state = store.getState();
    const cal = state.calendar;
    const day = cal.day;

    const rows = cal.entries.map((entry) => {
      const show = store.getShow(entry.showId);
      const when = entry.day - day;
      const status = entry.day < day ? 'past' : entry.day === day ? 'today' : `in ${when}d`;
      return `<tr>
        <td class="num ${entry.day === day ? 'pos' : entry.day < day ? 'muted' : ''}">${clock.formatDate(cal, entry.day)}</td>
        <td class="num muted">d${entry.day}</td>
        <td><span class="pill ${entry.kind === 'ple' ? 'brass' : ''}">${entry.kind.toUpperCase()}</span></td>
        <td><button class="rowlink" data-action="go" data-arg="show/${show.id}">${esc(entry.label)}</button></td>
        <td class="num muted">M${entry.block} W${entry.week}</td>
        <td class="num">${show.segmentIds.length}</td>
        <td><span class="pill ${show.status === 'complete' ? '' : show.status === 'live' ? 'brass' : ''}">${esc(titleCase(show.status))}</span></td>
        <td class="num muted">${status}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" class="empty">Nothing scheduled.</td></tr>';

    const next = clock.nextEntry(cal);

    return `
      <h1>Calendar</h1>
      <p class="sub">${clock.formatDate(cal, day)} &middot; ${clock.formatGameTime(day)} &middot; day ${day}</p>

      <div class="bar">
        <button class="act" data-action="advance" data-days="1">Advance 1 day</button>
        <button class="act" data-action="advance" data-days="7">Advance 1 week</button>
        <button class="act primary" data-action="advanceToShow"${next ? '' : ' disabled'}>
          ${next ? `Advance to ${esc(next.label)}` : 'Nothing scheduled'}
        </button>
        <button class="act" data-action="scheduleMore">Schedule another month</button>
      </div>

      <div class="scroller"><table>
        <thead><tr><th>Date</th><th>Day</th><th>Kind</th><th>Show</th><th>Block</th><th>Card</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>

      <p class="sub">Three weeks of television then a premium live event, as set out in the design foundation.
      Every dated thing in the game stores the integer day, never a formatted date.</p>`;
  },
};
