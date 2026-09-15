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
import { regardSegment, RESPONSE, RESPONSE_LABEL } from '../../systems/disposition.js';
import * as playback from '../playback.js';
import { esc, mmss, signedTime, titleCase } from '../format.js';
import { notLoaded } from './roster.js';
import { rosterRailHtml } from '../rosterRail.js';
import { rivalries } from './lockerroom.js';

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

const RESPONSE_TONE = {
  [RESPONSE.ACCEPT]: '',
  [RESPONSE.GRUDGING]: '',
  [RESPONSE.PUSH_BACK]: 'grease',
  [RESPONSE.REFUSE]: 'grease',
};

/** How the least happy person in a segment is taking it. */
function reactionPill(segment, index, total) {
  if (!segment.participants.length) return '<span class="muted">-</span>';
  const views = regardSegment(segment, { cardIndex: index, cardLength: total });
  const worst = views.sort((a, b) => a.willingness - b.willingness)[0];
  const name = store.getWrestler(worst.wrestlerId)?.shortName || '';
  return `<span class="pill ${RESPONSE_TONE[worst.likely]}">${esc(RESPONSE_LABEL[worst.likely])}</span>
    <div class="muted" style="font-size:11px">${esc(name)} &middot; ${worst.willingness}</div>`;
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

/** Five blocks of heat, the way a feud reads at a glance. */
function heatBars(heat) {
  const on = Math.round(heat / 20);
  return `<span class="heat"><span class="heatbars">${
    [0, 1, 2, 3, 4].map((i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('')
  }</span><span class="heatval">${heat}</span></span>`;
}

function feudsPanel() {
  const feuds = rivalries().slice(0, 4).map(({ a, b, heat, ab, ba }) => `
    <div class="slot" style="border-left:3px solid var(--red)">
      <span class="what">
        <span class="t">${esc(a.name)} <span class="muted">vs</span> ${esc(b.name)}</span>
        <span class="d">${esc((ab.history.slice(-1)[0] || ba.history.slice(-1)[0] || {}).summary || 'Bad blood')}</span>
      </span>
      <span class="side">${heatBars(heat)}</span>
    </div>`).join('');

  return `<section class="panel">
    <div class="head">
      <span class="title">Active Feuds</span>
      <button class="act" data-action="go" data-arg="lockerroom">View all</button>
    </div>
    <div class="body">
      <div class="sheet">${feuds || '<p class="empty">No feuds yet. Book people against each other more than once.</p>'}</div>
    </div>
  </section>`;
}

function renderBooking(show) {
  const state = store.getState();
  const segments = store.segmentsOfShow(show.id);
  const outlook = booking.cardOutlook(show.id);
  const format = formatOf(draft.format);
  const isMatch = format.kind === SEGMENT_KINDS.MATCH;

  const pool = isMatch ? booking.availableFor(show.id) : store.allWrestlers();

  // Each slot pre-selects a DIFFERENT wrestler, so an untouched four-slot tag
  // form is already a legal booking rather than one man against himself.
  const slots = slotsFor(draft.format).map((slot, i) => {
    const preferred = pool[i % Math.max(1, pool.length)]?.id;
    const options = pool.map((w) =>
      `<option value="${w.id}"${w.id === preferred ? ' selected' : ''}>${esc(w.name)}</option>`).join('');
    return `<div class="field">
      <label for="slot${i}">${esc(slot.label)}</label>
      <select id="slot${i}" name="slot${i}" data-side="${slot.side}">${options}</select>
    </div>`;
  }).join('');

  // ---- the card as a run sheet ----
  const sheet = segments.map((seg, i) => {
    const views = regardSegment(seg, { cardIndex: i, cardLength: segments.length });
    const worst = views.sort((a, b) => a.willingness - b.willingness)[0];
    return `<div class="slot">
      <span class="idx">${i + 1}</span>
      <span class="what">
        <span class="t">${esc(seg.name || formatOf(seg.format).label)}${titlePill(seg)}</span>
        <span class="d">${lineup(seg)}</span>
      </span>
      <span class="side">
        <span class="tag">${esc(formatOf(seg.format).label)}</span>
        ${worst ? `<span class="tag ${RESPONSE_TONE[worst.likely] === 'grease' ? 'red' : ''}">${esc(RESPONSE_LABEL[worst.likely])}</span>` : ''}
        <span class="time">${mmss(seg.timeLimitSec)}</span>
        <button class="act danger" data-action="cutSegment" data-id="${seg.id}">Cut</button>
      </span>
    </div>`;
  }).join('') || '<p class="empty">Nothing booked yet.</p>';

  const unhappy = segments.flatMap((seg, i) =>
    regardSegment(seg, { cardIndex: i, cardLength: segments.length })
      .filter((v) => v.likely !== RESPONSE.ACCEPT)
      .map((v) => ({ v, seg })))
    .sort((a, b) => a.v.willingness - b.v.willingness);

  const gap = outlook.expectedGapSec;
  const grade = gradeGuess(outlook);

  return `
  <div class="cols three">
    <div>${rosterRailHtml()}</div>

    <div>
      <section class="panel">
        <div class="head">
          <span class="title">Book a Segment</span>
          <span class="meta">${segments.length} of 8 on the card</span>
        </div>
        <div class="body">
          <form data-action="bookSegment" data-show="${show.id}">
            <div class="bar">
              <div class="field wide"><label for="segFormat">Format</label>
                <select id="segFormat" data-action="changeFormat">
                  <optgroup label="Matches">
                    ${MATCH_FORMATS.map((k) => `<option value="${k}"${k === draft.format ? ' selected' : ''}>${esc(FORMATS[k].label)}</option>`).join('')}
                  </optgroup>
                  <optgroup label="Segments">
                    ${SEGMENT_FORMATS.map((k) => `<option value="${k}"${k === draft.format ? ' selected' : ''}>${esc(FORMATS[k].label)}</option>`).join('')}
                  </optgroup>
                </select></div>
              ${isMatch ? `<div class="field wide"><label for="segTitle">Title / stakes</label>
                <select id="segTitle" data-action="changeTitle">
                  <option value="">None</option>
                  ${store.allTitles().map((t) => {
                    const holders = championIds(t);
                    const who = holders.length ? holders.map(store.nameOf).join(' & ') : 'vacant';
                    return `<option value="${t.id}"${t.id === draft.titleId ? ' selected' : ''}>${esc(t.shortName)} (${esc(who)})</option>`;
                  }).join('')}
                </select></div>` : ''}
            </div>
            <div class="bar">
              ${slots}
              <div class="field" style="flex:0 1 8rem"><label for="segLimit">Time limit</label>
                <input id="segLimit" name="limit" type="number" min="1" max="60" value="${Math.round(format.defaultLimitSec / 60)}"></div>
            </div>
            <div class="bar" style="margin-bottom:0">
              <div class="field wide"><label for="segName">Name (optional)</label>
                <input id="segName" name="name" placeholder="auto"></div>
              <button class="act primary" type="submit"${pool.length ? '' : ' disabled'}>Add to Show</button>
            </div>
          </form>
          ${isMatch && pool.length < slotsFor(draft.format).length
            ? '<p class="neg" style="margin:.7rem 0 0">Not enough wrestlers left who are not already in a match tonight.</p>' : ''}
        </div>
      </section>

      ${feudsPanel()}

      <section class="panel">
        <div class="head">
          <span class="title">Current Show Card</span>
          <span class="meta">${mmss(outlook.bookedSec)} booked</span>
        </div>
        <div class="body"><div class="sheet">${sheet}</div></div>
      </section>

      ${unhappy.length ? `<section class="panel">
        <div class="head">
          <span class="title">How the locker room is taking it</span>
          <span class="meta">${unhappy.length} unhappy</span>
        </div>
        <div class="body"><div class="scroller"><table>
          <thead><tr><th>Wrestler</th><th>Segment</th><th>Response</th><th>Why</th></tr></thead>
          <tbody>${unhappy.map(({ v, seg }) => {
            const w = store.getWrestler(v.wrestlerId);
            const top = v.reasons.filter((r) => r.delta < -2).slice(0, 3);
            return `<tr>
              <td><button class="rowlink" data-action="go" data-arg="wrestler/${w.id}">${esc(w.name)}</button>
                <div class="muted" style="font-size:11px">${esc(titleCase(w.standing.careerStatus))}</div></td>
              <td class="muted">${esc(seg.name || formatOf(seg.format).label)}</td>
              <td><span class="tag ${RESPONSE_TONE[v.likely] === 'grease' ? 'red' : 'amber'}">${esc(RESPONSE_LABEL[v.likely])}</span>
                <div class="muted num" style="font-size:11px">${v.willingness}${v.heldUpByStanding ? ` (wants ${v.raw})` : ''}</div></td>
              <td style="font-size:12px">${top.map((r) => `${esc(r.text)} <span class="neg num">${r.delta}</span>`).join('<br>')}
                ${v.heldUpByStanding ? '<br><span class="muted">Has no standing to refuse, whatever they think of it.</span>' : ''}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div></div>
      </section>` : ''}
    </div>

    <div>
      <section class="panel">
        <div class="head">
          <span class="title">Upcoming Show</span>
          <span class="meta">${daysAway(show)}</span>
        </div>
        <div class="body">
          <div class="showart">
            <div class="kicker">${esc(state.meta.brandName)}</div>
            <div class="big">${esc(show.name)}</div>
          </div>
          <div class="kv"><span>${clock.formatDate(state.calendar, show.day)}</span><span>${show.kind.toUpperCase()}</span></div>
          <div class="cards" style="grid-template-columns:1fr 1fr;gap:.5rem;margin:.7rem 0 0">
            <div class="card" style="padding:.6rem"><h3>Booked</h3>
              <div class="num" style="font-size:1.2rem">${mmss(outlook.bookedSec)}</div>
              <div class="muted" style="font-size:11px">of ${mmss(outlook.budgetSec)}</div></div>
            <div class="card" style="padding:.6rem"><h3>Likely fill</h3>
              <div class="num" style="font-size:1.2rem">${mmss(outlook.expectedSec)}</div>
              <div class="muted ${Math.abs(gap) < 180 ? 'pos' : 'neg'}" style="font-size:11px">${gap >= 0 ? `${mmss(gap)} short` : `${mmss(-gap)} over`}</div></div>
            <div class="card" style="padding:.6rem"><h3>Projected</h3>
              <div class="num ${grade.tone}" style="font-size:1.2rem">${grade.label}</div>
              <div class="muted" style="font-size:11px">if it runs as booked</div></div>
            <div class="card" style="padding:.6rem"><h3>Segments</h3>
              <div class="num" style="font-size:1.2rem">${segments.length}</div>
              <div class="muted" style="font-size:11px">${segments.filter((s) => s.kind === 'match').length} matches</div></div>
          </div>
          <div class="bar" style="margin:.8rem 0 0">
            <button class="act primary" data-action="goLive" data-id="${show.id}"${segments.length ? '' : ' disabled'}>
              ${segments.length ? 'Go live' : 'Nothing booked'}</button>
            <button class="act" data-action="go" data-arg="calendar">Calendar</button>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="head"><span class="title">Championships</span></div>
        <div class="body">
          ${store.allTitles().map((t) => {
            const holders = championIds(t);
            const contender = t.contenderId ? store.getWrestler(t.contenderId) : null;
            return `<div class="kv"><span>${esc(t.shortName)}</span><span>${holders.length ? esc(holders.map(store.nameOf).join(' & ')) : '<span class="neg">vacant</span>'}</span></div>
              ${contender ? `<div class="kv"><span class="muted" style="font-size:11px">#1 contender</span><span class="muted" style="font-size:11px">${esc(contender.name)} (#${contender.standing.rank})</span></div>` : ''}`;
          }).join('')}
        </div>
      </section>

      <section class="panel">
        <div class="head"><span class="title">Before you book</span></div>
        <div class="body">
          <p style="font-size:.8rem;color:var(--muted);margin:0">A time limit is a ceiling, not a plan.
          Most matches end well before theirs, so a card booked to exactly fill the hour leaves you short.
          Book past the budget.</p>
        </div>
      </section>
    </div>
  </div>`;
}

/** A rough letter for how the card looks before anybody wrestles. */
function gradeGuess(outlook) {
  const fill = outlook.expectedSec / outlook.budgetSec;
  const miss = Math.abs(1 - fill);
  const score = Math.max(0, 100 - miss * 120);
  if (score >= 82) return { label: 'A-', tone: 'pos' };
  if (score >= 70) return { label: 'B+', tone: 'pos' };
  if (score >= 55) return { label: 'B-', tone: '' };
  if (score >= 38) return { label: 'C', tone: '' };
  return { label: 'D', tone: 'neg' };
}

function daysAway(show) {
  const n = show.day - store.today();
  if (n <= 0) return 'Tonight';
  return n === 1 ? 'Tomorrow' : `In ${n} days`;
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
