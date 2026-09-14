// Watching a match happen.
//
// The simulation works out the whole match in one go - it has to, because the
// finish depends on how the match went. This module spends that result back out
// over real time, so the GM sees the clock climb and finds out when it ends at
// the moment it ends, instead of reading a finished row.
//
// Nothing is recorded while it plays. The caller commits the result when the
// clock reaches the finish, which means a reload mid-match simply means the
// match has not happened yet, and the card behind the panel cannot spoil it.

import * as store from '../core/store.js';
import { esc, mmss, signedTime, titleCase } from './format.js';

/** Real milliseconds per match-second. A 15-minute match at "normal" takes 20s. */
export const SPEEDS = Object.freeze({
  instant: { label: 'Instant', msPerSec: 0 },
  fast: { label: 'Fast', msPerSec: 9 },
  normal: { label: 'Normal', msPerSec: 22 },
  slow: { label: 'Slow', msPerSec: 45 },
});

const SPEED_KEY = 'wgm_playback_speed';
const TICK_MS = 50;

function readSpeed() {
  try {
    const stored = localStorage.getItem(SPEED_KEY);
    if (stored && SPEEDS[stored]) return stored;
  } catch { /* storage blocked; the default is fine */ }
  return 'normal';
}

let speed = readSpeed();
let state = null;   // {segment, result, timeline, clockSec, finished, startedAt}
let timer = null;
let onFinish = null;

export function isActive() { return state != null; }
export function currentSegmentId() { return state?.segment.id ?? null; }
export function isFinished() { return !!state?.finished; }

export function setSpeed(next) {
  if (!SPEEDS[next]) return;
  speed = next;
  try { localStorage.setItem(SPEED_KEY, next); } catch { /* not important enough to fail */ }
  if (state && !state.finished && SPEEDS[next].msPerSec === 0) finish();
  else paint();
}

export function getSpeed() { return speed; }

/**
 * Begin playing a previewed result.
 * `onDone(result)` fires once, when the clock reaches the finish: that is the
 * caller's cue to record it.
 */
export function start({ segment, result, timeline }, onDone) {
  stop();
  onFinish = onDone;
  state = {
    segment, result,
    timeline: timeline || result.beats || [],
    clockSec: 0,
    finished: false,
    startedAt: Date.now(),
  };

  if (SPEEDS[speed].msPerSec === 0) return finish();

  timer = setInterval(() => {
    const elapsed = Date.now() - state.startedAt;
    state.clockSec = elapsed / SPEEDS[speed].msPerSec;
    if (state.clockSec >= state.result.actualSec) finish();
    else paint();
  }, TICK_MS);
  paint();
}

/** Jump straight to the finish. */
export function skip() {
  if (state && !state.finished) finish();
}

function finish() {
  clearInterval(timer);
  timer = null;
  if (!state) return;
  state.clockSec = state.result.actualSec;
  state.finished = true;
  const done = onFinish;
  onFinish = null;
  if (done) done(state.result);   // the caller records it and re-renders
  else paint();
}

/** Clear the panel entirely. */
export function stop() {
  clearInterval(timer);
  timer = null;
  state = null;
  onFinish = null;
}

/** Re-paint just the panel, leaving the rest of the screen alone. */
function paint() {
  const host = document.getElementById('playbackHost');
  if (host) host.innerHTML = panelHtml();
}

/** The speed control, so it can also sit in the show's own action bar. */
export function speedPickerHtml() {
  return `<select data-action="playbackSpeed" aria-label="Match playback speed">
      ${Object.entries(SPEEDS).map(([k, v]) =>
        `<option value="${k}"${k === speed ? ' selected' : ''}>${v.label}</option>`).join('')}
    </select>`;
}

function nameSides(segment) {
  const bySide = {};
  for (const p of segment.participants) (bySide[p.side] ||= []).push(store.nameOf(p.wrestlerId));
  return Object.values(bySide).map((n) => n.join(' & ')).join(' vs ');
}

/**
 * The panel's markup. The show screen embeds this so a full re-render keeps
 * whatever the panel is currently showing.
 */
export function panelHtml() {
  if (!state) return '';
  const { segment, result, timeline, clockSec, finished } = state;
  const shown = Math.min(clockSec, result.actualSec);
  const pct = Math.min(100, (shown / segment.timeLimitSec) * 100);
  const revealed = timeline.filter((b) => b.atSec <= shown + 0.001);

  const feed = revealed.slice(-7).map((b) => `
    <div class="ev${b.kind === 'finish' ? ' fin' : ''}">
      <span class="d">${mmss(b.atSec)}</span>
      <span>${esc(b.text)}</span>
    </div>`).join('');

  const speedPicker = speedPickerHtml();

  if (!finished) {
    return `
      <div class="playback live">
        <div class="pb-head">
          <span class="pill brass">On now</span>
          <strong>${esc(segment.name || nameSides(segment))}</strong>
          <span class="muted">limit ${mmss(segment.timeLimitSec)}</span>
        </div>
        <div class="pb-clock">${mmss(shown)}</div>
        <div class="meter pb-bar"><i style="width:${pct}%"></i></div>
        <div class="log pb-feed">${feed}</div>
        <div class="bar pb-controls">
          <button class="act" data-action="playbackSkip">Skip to the finish</button>
          ${speedPicker}
        </div>
      </div>`;
  }

  const delta = result.actualSec - segment.timeLimitSec;
  const outcome = result.winnerIds.length
    ? `${result.winnerIds.map((id) => esc(store.nameOf(id))).join(' &amp; ')} <span class="muted">by ${esc(titleCase(result.finish))}</span>`
    : `<span class="muted">${esc(titleCase(result.finish))}</span>`;

  return `
    <div class="playback done">
      <div class="pb-head">
        <span class="pill">Final</span>
        <strong>${esc(segment.name || nameSides(segment))}</strong>
        <span class="muted">limit ${mmss(segment.timeLimitSec)}</span>
      </div>
      <div class="pb-result">
        <div class="pb-clock">${mmss(result.actualSec)}</div>
        <div>
          <div class="pb-outcome">${outcome}${result.overridden ? ' <span class="pill grease">overridden</span>' : ''}</div>
          <div class="muted" style="font-size:12px">
            ${delta < 0 ? `${mmss(-delta)} inside the limit` : 'went the distance'}
            &middot; rated ${result.quality}
          </div>
        </div>
      </div>
      <div class="log pb-feed">${feed}</div>
    </div>`;
}
