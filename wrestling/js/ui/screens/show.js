// The show screen, in three modes: booking it, running it, reading the results.
//
// One screen rather than three, because it is one thing at three points in its
// life, and the GM should not have to go looking for the card they just booked.

import * as store from '../../core/store.js';
import * as clock from '../../core/clock.js';
import * as runner from '../../systems/showRunner.js';
import * as booking from '../../systems/booking.js';
import { FORMATS, MATCH_FORMATS, SEGMENT_FORMATS, formatOf, slotsFor, autoName } from '../../systems/formats.js';
import { sides, SEGMENT_KINDS } from '../../models/segment.js';
import { championIds, currentReign } from '../../models/title.js';
import * as playback from '../playback.js';
import { esc, mmss, signedTime, titleCase } from '../format.js';
import { notLoaded } from './roster.js';

/** Booking form draft. Kept here so changing the format does not lose the rest. */
export const draft = { format: 'singles', overrideSide: '', titleId: '' };

export function setDraftFormat(next) {
  if (FORMATS[next]) draft.format = next;
}
export function setOverride(next) { draft.overrideSide = next; }
export function setDraftTitle(next) { draft.titleId = next || ''; }

export default {
  label: 'This week',
  render([id]) {
    if (!store.isLoaded()) return notLoaded();
    const show = id ? store.getShow(id) : runner.currentShow();
    if (!show) return `<h1>No show</h1><p class="sub">Everything on the calendar has been run.</p>`;

    if (show.status === 'live') return renderLive(show);
    if (show.status === 'complete') return renderResults(show);
    return renderBooking(show);
  },
};

// ---------------------------------------------------------------------------

function header(show, extra = '') {
  const cal = store.getState().calendar;
  return `
    <h1>${esc(show.name)}</h1>
    <p class="sub">${clock.formatDate(cal, show.day)} &middot; ${show.kind.toUpperCase()}
      &middot; budget ${mmss(show.timeBudgetSec)}${extra}</p>`;
}

/** Who is in it, as links, grouped by side. */
function lineup(segment) {
  const bySide = sides(segment);
  const groups = Object.values(bySide).map((ids) => ids.map((wid) =>
    `<button class="rowlink" data-action="go" data-arg="wrestler/${wid}">${esc(store.nameOf(wid))}</button>`
  ).join(' &amp; '));
  const joiner = segment.kind === SEGMENT_KINDS.MATCH ? ' <span class="muted">vs</span> ' : ' <span class="muted">and</span> ';
  return groups.join(joiner) || '<span class="muted">nobody booked</span>';
}

/** A belt pill, so a title match never reads like an ordinary one. */
function titlePill(segment) {
  if (!segment.titleId) return '';
  const title = store.getTitle(segment.titleId);
  return title ? ` <span class="pill brass">${esc(title.shortName)} title</span>` : '';
}

function resultCell(segment) {
  const r = segment.result;
  if (segment.status !== 'complete') return '<span class="muted">not run</span>';
  if (!r.winnerIds.length) return `${esc(titleCase(r.finish))}`;
  return `${esc(store.nameOf(r.winnerIds[0]))}${r.winnerIds.length > 1 ? ' &amp; ' + esc(store.nameOf(r.winnerIds[1])) : ''}
    <div class="muted" style="font-size:11px">${esc(titleCase(r.finish))}${r.overridden ? ' &middot; overridden' : ''}</div>`;
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

function renderBooking(show) {
  const segments = store.segmentsOfShow(show.id);
  const outlook = booking.cardOutlook(show.id);
  const format = formatOf(draft.format);
  const isMatch = format.kind === SEGMENT_KINDS.MATCH;

  // Someone already in a match cannot be in another, but can still talk.
  const pool = isMatch ? booking.availableFor(show.id) : store.allWrestlers();
  const options = pool.map((w) =>
    `<option value="${w.id}">${esc(w.name)}</option>`).join('');

  const slots = slotsFor(draft.format).map((slot, i) => `
    <div class="field">
      <label for="slot${i}">${esc(slot.label)}</label>
      <select id="slot${i}" name="slot${i}" data-side="${slot.side}">${options}</select>
    </div>`).join('');

  const rows = segments.map((seg, i) => `
    <tr>
      <td class="num muted">${i + 1}</td>
      <td><span class="pill">${esc(formatOf(seg.format).label)}</span></td>
      <td>${esc(seg.name || '-')}${titlePill(seg)}<div style="font-size:12px">${lineup(seg)}</div></td>
      <td class="num">${mmss(seg.timeLimitSec)}</td>
      <td><button class="act danger" data-action="cutSegment" data-id="${seg.id}">Cut</button></td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty">Nothing booked yet.</td></tr>';

  const gap = outlook.expectedGapSec;
  const gapTone = Math.abs(gap) < 180 ? 'pos' : 'neg';

  return `
    ${header(show)}

    <div class="cards">
      <div class="card"><h3>The hour</h3>
        <div class="kv"><span>Budget</span><span>${mmss(outlook.budgetSec)}</span></div>
        <div class="kv"><span>Booked as limits</span><span>${mmss(outlook.bookedSec)}</span></div>
        <div class="kv"><span>Expected to fill</span><span>${mmss(outlook.expectedSec)}</span></div>
        <div class="kv"><span>${gap >= 0 ? 'Likely dead air' : 'Likely overrun'}</span>
          <span class="${gapTone}">${mmss(Math.abs(gap))}</span></div>
      </div>
      ${store.allTitles().length ? `<div class="card"><h3>Championships</h3>
        ${store.allTitles().map((t) => {
          const holders = championIds(t);
          const contender = t.contenderId ? store.getWrestler(t.contenderId) : null;
          return `<div class="kv"><span>${esc(t.shortName)}</span><span>${holders.length ? esc(holders.map(store.nameOf).join(' & ')) : '<span class="neg">vacant</span>'}</span></div>
            ${contender ? `<div class="kv"><span class="muted" style="font-size:11px">#1 contender</span><span class="muted" style="font-size:11px">${esc(contender.name)} (#${contender.standing.rank})</span></div>` : ''}`;
        }).join('')}
      </div>` : ''}
      <div class="card"><h3>Read this before you book</h3>
        <p style="font-size:12px;margin:0">A time limit is a ceiling, not a plan. Most matches end
        well before theirs, so a card booked to exactly fill the hour will leave you short.
        Book past the budget.</p>
      </div>
    </div>

    <div class="bar">
      <button class="act primary" data-action="goLive" data-id="${show.id}"${segments.length ? '' : ' disabled'}>
        Go live${segments.length ? '' : ' (nothing booked)'}</button>
      <button class="act" data-action="go" data-arg="calendar">Calendar</button>
    </div>

    <h2>The card</h2>
    <div class="scroller"><table>
      <thead><tr><th>#</th><th>Format</th><th>Segment</th><th>Limit</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>

    <h2>Book a segment</h2>
    <form data-action="bookSegment" data-show="${show.id}">
      <div class="bar">
        <div class="field"><label for="segFormat">Format</label>
          <select id="segFormat" data-action="changeFormat">
            <optgroup label="Matches">
              ${MATCH_FORMATS.map((k) => `<option value="${k}"${k === draft.format ? ' selected' : ''}>${esc(FORMATS[k].label)}</option>`).join('')}
            </optgroup>
            <optgroup label="Segments">
              ${SEGMENT_FORMATS.map((k) => `<option value="${k}"${k === draft.format ? ' selected' : ''}>${esc(FORMATS[k].label)}</option>`).join('')}
            </optgroup>
          </select></div>
        ${slots}
        ${isMatch ? `<div class="field"><label for="segTitle">For the title</label>
          <select id="segTitle" data-action="changeTitle">
            <option value="">No title</option>
            ${store.allTitles().map((t) => {
              const holders = championIds(t);
              const who = holders.length ? holders.map(store.nameOf).join(' & ') : 'vacant';
              return `<option value="${t.id}"${t.id === draft.titleId ? ' selected' : ''}>${esc(t.shortName)} (${esc(who)})</option>`;
            }).join('')}
          </select></div>` : ''}
        <div class="field"><label for="segLimit">Limit (min)</label>
          <input id="segLimit" name="limit" type="number" min="1" max="60" value="${Math.round(format.defaultLimitSec / 60)}" size="4"></div>
        <div class="field"><label for="segName">Name (optional)</label>
          <input id="segName" name="name" placeholder="auto" size="16"></div>
        <button class="act primary" type="submit"${pool.length ? '' : ' disabled'}>Add to card</button>
      </div>
    </form>
    ${isMatch && pool.length < slotsFor(draft.format).length
      ? '<p class="neg">Not enough wrestlers left who are not already in a match tonight.</p>' : ''}`;
}

// ---------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------

function renderLive(show) {
  const p = runner.progress(show.id);
  const outlook = booking.cardOutlook(show.id);
  const next = runner.nextSegment(show.id);
  const elapsedPct = Math.min(100, Math.round(p.elapsedSec / p.budgetSec * 100));
  // What is left to run will almost certainly not use its full limits, so the
  // projection the GM needs is the expected one, not the ceiling.
  const gap = outlook.expectedGapSec;

  const rows = p.segments.map((seg, i) => {
    const done = seg.status === 'complete';
    const isNext = next && seg.id === next.id;
    const ran = seg.result.actualSec;
    const delta = done ? ran - seg.timeLimitSec : 0;
    return `
      <tr${isNext ? ' style="outline:2px solid var(--brass);outline-offset:-2px"' : ''}>
        <td class="num muted">${i + 1}</td>
        <td>${esc(seg.name || formatOf(seg.format).label)}${titlePill(seg)}
          <div style="font-size:12px">${lineup(seg)}</div>
          ${done && seg.result.beats?.length ? `<details style="margin-top:.3rem"><summary class="muted" style="font-size:11px;cursor:pointer">beats</summary>
            <div class="log" style="margin-top:.3rem">${seg.result.beats.map((b) =>
              `<div class="ev"><span class="d">${mmss(b.atSec)}</span><span></span><span>${esc(b.text)}</span></div>`).join('')}</div></details>` : ''}
        </td>
        <td class="num">${mmss(seg.timeLimitSec)}</td>
        <td class="num">${done ? mmss(ran) : '<span class="muted">-</span>'}</td>
        <td class="num ${delta < 0 ? 'pos' : delta > 0 ? 'neg' : 'muted'}">${done ? signedTime(delta) : ''}</td>
        <td>${resultCell(seg)}</td>
        <td class="num">${done && seg.result.quality != null ? seg.result.quality : ''}</td>
      </tr>`;
  }).join('');

  // While a match is playing out, the controls step aside: the only things to do
  // are watch it, hurry it along, or skip to the finish.
  const watching = playback.isActive() && !playback.isFinished();

  const overrideControl = next && next.kind === SEGMENT_KINDS.MATCH
    ? `<div class="field"><label for="ovr">Override the finish</label>
        <select id="ovr" data-action="changeOverride">
          <option value=""${draft.overrideSide === '' ? ' selected' : ''}>Let it play out</option>
          ${Object.keys(sides(next)).map((k) => `<option value="${k}"${draft.overrideSide === k ? ' selected' : ''}>${esc(sides(next)[k].map(store.nameOf).join(' & '))} goes over</option>`).join('')}
        </select></div>`
    : '';

  return `
    ${header(show, ' &middot; <span class="pos">ON AIR</span>')}

    <div class="cards">
      <div class="card"><h3>Clock</h3>
        <div class="kv"><span>Aired</span><span>${mmss(p.elapsedSec)} of ${mmss(p.budgetSec)}</span></div>
        <div class="meter"><i style="width:${elapsedPct}%"></i></div>
        <div class="kv"><span>Still to come (limits)</span><span>${mmss(p.remainingBookedSec)}</span></div>
        <div class="kv"><span>Expected to finish on</span><span>${mmss(outlook.expectedSec)}</span></div>
        <div class="kv"><span>${gap >= 0 ? 'Likely short by' : 'Likely over by'}</span>
          <span class="${Math.abs(gap) < 180 ? 'pos' : 'neg'}">${mmss(Math.abs(gap))}</span></div>
      </div>
      <div class="card"><h3>Card</h3>
        <div class="kv"><span>Done</span><span>${p.doneCount} of ${p.total}</span></div>
        <div class="kv"><span>Up next</span><span>${next ? esc(next.name || formatOf(next.format).label) : 'nothing left'}</span></div>
      </div>
    </div>

    <div id="playbackHost">${playback.panelHtml()}</div>

    ${watching ? '' : `<div class="bar">
      ${next ? `<button class="act primary" data-action="runNext" data-id="${show.id}">Run: ${esc(next.name || formatOf(next.format).label)}</button>` : ''}
      ${next ? `<button class="act" data-action="runRest" data-id="${show.id}">Run the rest of the card</button>` : ''}
      ${overrideControl}
      ${next ? `<div class="field"><label for="pbSpeed">Match playback</label>${playback.speedPickerHtml()}</div>` : ''}
      ${!next ? `<button class="act primary" data-action="goOffAir" data-id="${show.id}">Go off the air</button>` : ''}
    </div>`}

    <h2>The card</h2>
    <div class="scroller"><table>
      <thead><tr><th>#</th><th>Segment</th><th>Limit</th><th>Ran</th><th>Gap</th><th>Result</th><th>Rating</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function renderResults(show) {
  const segments = store.segmentsOfShow(show.id);
  const fillPct = Math.round(show.result.actualSec / show.timeBudgetSec * 100);
  const next = runner.currentShow();

  const rows = segments.map((seg, i) => `
    <tr>
      <td class="num muted">${i + 1}</td>
      <td>${esc(seg.name || formatOf(seg.format).label)}${titlePill(seg)}<div style="font-size:12px">${lineup(seg)}</div></td>
      <td class="num">${mmss(seg.timeLimitSec)}</td>
      <td class="num">${mmss(seg.result.actualSec)}</td>
      <td class="num ${seg.result.actualSec - seg.timeLimitSec < 0 ? 'pos' : 'neg'}">${signedTime(seg.result.actualSec - seg.timeLimitSec)}</td>
      <td>${resultCell(seg)}</td>
      <td class="num">${seg.result.quality ?? ''}</td>
    </tr>`).join('');

  return `
    ${header(show, ' &middot; in the books')}

    <div class="cards">
      <div class="card"><h3>Show rating</h3>
        <div style="font-size:2.4rem;line-height:1;font-variant-numeric:tabular-nums">${show.result.rating}</div>
        <div class="meter" style="margin-top:.5rem"><i style="width:${show.result.rating}%"></i></div>
      </div>
      <div class="card"><h3>The hour</h3>
        <div class="kv"><span>Budget</span><span>${mmss(show.timeBudgetSec)}</span></div>
        <div class="kv"><span>Booked as limits</span><span>${mmss(show.result.bookedSec)}</span></div>
        <div class="kv"><span>Actually aired</span><span>${mmss(show.result.actualSec)}</span></div>
        <div class="kv"><span>Filled</span><span class="${fillPct >= 85 ? 'pos' : 'neg'}">${fillPct}%</span></div>
      </div>
    </div>

    <div class="bar">
      ${next && next.id !== show.id
        ? `<button class="act primary" data-action="nextWeek">Next week: ${esc(next.name)}</button>`
        : '<span class="muted">Nothing left on the calendar.</span>'}
      <button class="act" data-action="go" data-arg="roster">Roster</button>
      <button class="act" data-action="go" data-arg="calendar">Calendar</button>
    </div>

    <h2>The card</h2>
    <div class="scroller"><table>
      <thead><tr><th>#</th><th>Segment</th><th>Limit</th><th>Ran</th><th>Gap</th><th>Result</th><th>Rating</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}
