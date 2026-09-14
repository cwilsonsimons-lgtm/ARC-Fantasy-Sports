// One show: the card, the time budget, and the gap between them.
//
// Booking here assigns a time LIMIT. Nothing on this screen decides how long a
// segment actually runs - that belongs to the match simulation, which is not
// built. The "record result" control is a stand-in for it, so the foundation can
// be exercised end to end.

import * as store from '../../core/store.js';
import * as clock from '../../core/clock.js';
import { SEGMENT_KINDS, FINISHES, sides } from '../../models/segment.js';
import { esc, mmss, signedTime, titleCase } from '../format.js';
import { notLoaded } from './roster.js';

export default {
  label: 'Show',
  inNav: false,
  render([id]) {
    if (!store.isLoaded()) return notLoaded();
    const show = id ? store.getShow(id) : store.allShows().find((s) => s.status !== 'complete');
    if (!show) return `<h1>Unknown show</h1><p class="sub">No show with id ${esc(id)}.</p>`;

    const state = store.getState();
    const segments = store.segmentsOfShow(show.id);
    const booked = show.result.bookedSec;
    const actual = show.result.actualSec;
    const unbooked = show.timeBudgetSec - booked;

    const rows = segments.map((seg, i) => {
      const bySide = sides(seg);
      const line = Object.values(bySide)
        .map((ids) => ids.map((wid) =>
          `<button class="rowlink" data-action="go" data-arg="wrestler/${wid}">${esc(store.nameOf(wid))}</button>`
        ).join(' &amp; '))
        .join(' <span class="muted">vs</span> ');
      const ran = seg.result.actualSec;
      const delta = ran ? ran - seg.timeLimitSec : 0;
      const winners = (seg.result.winnerIds || []).map((w) => esc(store.nameOf(w))).join(', ');
      return `<tr>
        <td class="num muted">${i + 1}</td>
        <td><span class="pill">${esc(seg.kind)}</span></td>
        <td>${esc(seg.name || '-')}<div style="font-size:12px">${line || '<span class="muted">nobody booked</span>'}</div></td>
        <td class="num">${mmss(seg.timeLimitSec)}</td>
        <td class="num">${ran ? mmss(ran) : '<span class="muted">-</span>'}</td>
        <td class="num ${delta < 0 ? 'pos' : delta > 0 ? 'neg' : 'muted'}">${ran ? signedTime(delta) : ''}</td>
        <td>${seg.result.finish
          ? `${esc(titleCase(seg.result.finish))}${winners ? `<div class="muted" style="font-size:11px">${winners}</div>` : ''}`
          : '<span class="muted">not run</span>'}</td>
        <td>
          ${seg.status === 'complete' ? '' : `<button class="act" data-action="runSegment" data-id="${seg.id}">Record result</button>`}
          <button class="act danger" data-action="cutSegment" data-id="${seg.id}">Cut</button>
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" class="empty">Nothing booked on this card yet.</td></tr>';

    const rosterOptions = store.allWrestlers()
      .map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('');

    return `
      <h1>${esc(show.name)}</h1>
      <p class="sub">${show.id} &middot; ${clock.formatDate(state.calendar, show.day)} &middot;
        ${show.kind.toUpperCase()} &middot; ${esc(titleCase(show.status))}</p>

      <div class="cards">
        <div class="card"><h3>Television time</h3>
          <div class="kv"><span>Budget</span><span>${mmss(show.timeBudgetSec)}</span></div>
          <div class="kv"><span>Booked as limits</span><span>${mmss(booked)}</span></div>
          <div class="kv"><span>Actually run</span><span>${actual ? mmss(actual) : '-'}</span></div>
          <div class="kv"><span>Still to fill</span><span class="${unbooked < 0 ? 'neg' : 'pos'}">${signedTime(-unbooked)}</span></div>
        </div>
        <div class="card"><h3>Card</h3>
          <div class="kv"><span>Segments</span><span>${segments.length}</span></div>
          <div class="kv"><span>Matches</span><span>${segments.filter((s) => s.kind === 'match').length}</span></div>
          <div class="kv"><span>Complete</span><span>${segments.filter((s) => s.status === 'complete').length}</span></div>
        </div>
      </div>

      <div class="bar">
        ${show.status === 'scheduled' ? `<button class="act primary" data-action="startShow" data-id="${show.id}">Go live</button>` : ''}
        ${show.status === 'live' ? `<button class="act primary" data-action="completeShow" data-id="${show.id}">Off the air</button>` : ''}
        <button class="act" data-action="go" data-arg="calendar">Calendar</button>
      </div>

      <h2>The card</h2>
      <div class="scroller"><table>
        <thead><tr><th>#</th><th>Kind</th><th>Segment</th><th>Limit</th><th>Ran</th><th>Gap</th><th>Finish</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>

      <h2>Book a segment</h2>
      <p class="sub">You assign a time limit, not a duration. What it actually runs is the simulation's call.</p>
      <form data-action="bookSegment" data-show="${show.id}">
        <div class="bar">
          <div class="field"><label for="segKind">Kind</label>
            <select id="segKind" name="kind">
              ${Object.values(SEGMENT_KINDS).map((k) => `<option value="${k}">${titleCase(k)}</option>`).join('')}
            </select></div>
          <div class="field"><label for="segName">Name</label>
            <input id="segName" name="name" placeholder="Main event" size="18"></div>
          <div class="field"><label for="segA">Side A</label>
            <select id="segA" name="a">${rosterOptions}</select></div>
          <div class="field"><label for="segB">Side B</label>
            <select id="segB" name="b"><option value="">(none)</option>${rosterOptions}</select></div>
          <div class="field"><label for="segLimit">Limit (min)</label>
            <input id="segLimit" name="limit" type="number" min="1" max="60" value="15" size="4"></div>
          <button class="act primary" type="submit">Book it</button>
        </div>
      </form>`;
  },
};

export { FINISHES };
