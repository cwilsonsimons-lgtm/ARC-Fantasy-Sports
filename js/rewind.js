// ---------- REWIND: win-probability chart ----------
//
// A line across the whole NFL week rather than a slider. Win probability runs on
// the y axis with 50% as the midline; the area is filled toward whoever is
// ahead. Scrub it to read the score, the odds and what had just happened.
//
// Points come from the lineup itself. Every player's game has a kickoff ordinal,
// and their points accrue across that window in a few discrete jumps - the
// scoring plays. The chart samples every ten minutes of game time and marks the
// jumps, which is what gives the line its shape: flat overnight, jagged on
// Sunday afternoon when eight games overlap.
import { LINEUP } from './store.js';
import { pLive, pOrd } from './clock.js';

const SAMPLE_MIN = 10;      // one point every ten minutes of game time
const GAME_MIN = 200;       // a player's game is worth this much elapsed time
const DAYS = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

// ord packs a day number and minutes-of-day; flatten it to absolute minutes
const absMin = ord => Math.floor(ord / 2000) * 1440 + (ord % 2000);

function clockLabel(abs){
  const day = Math.floor(abs / 1440), mins = ((abs % 1440) + 1440) % 1440;
  let h = Math.floor(mins / 60); const m = mins % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${DAYS[(day + 4) % 7]} ${h}:${String(m).padStart(2,'0')} ${ap}`;
}

// Deterministic scoring pattern for one player: the fractions of their game at
// which points land. Same player, same jumps, every time.
function jumpsFor(name){
  let h = 2166136261;
  for (let i = 0; i < name.length; i++){ h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
  const r = () => (h = Math.imul(h ^ (h >>> 15), h | 1) >>> 0) / 4294967296;
  const n = 2 + Math.floor(r() * 3);                       // 2-4 scoring plays
  const at = Array.from({length:n}, () => 0.08 + r() * 0.86).sort((a,b)=>a-b);
  const w  = at.map(() => 0.4 + r());                      // uneven weights
  const tot = w.reduce((s,v)=>s+v,0);
  return at.map((f,i) => ({ at:f, share: w[i]/tot }));
}

/** A player's accrued points at elapsed fraction `f` of their game. */
function accrued(total, name, f){
  if (f <= 0) return 0;
  if (f >= 1) return total;
  let got = 0;
  for (const j of jumpsFor(name)) if (f >= j.at) got += j.share;
  return total * got;
}

/**
 * The full week as chart points.
 * Each: { abs, a, x, win, td } - td flags a sample where someone scored.
 */
export function rewindSeries(){
  const rows = LINEUP.filter(r => r.a || r.x);
  if (!rows.length) return [];

  const ords = [];
  rows.forEach(r => ['a','x'].forEach(s => {
    const o = r[s] ? pOrd(r[s]) : null;
    if (o != null && isFinite(o)) ords.push(o);
  }));
  if (!ords.length) return [];

  const start = Math.min(...ords.map(absMin)) - 20;
  const end   = Math.max(...ords.map(absMin)) + GAME_MIN + 20;

  // precompute each player's total and kickoff so sampling stays cheap
  const side = s => rows.map(r => {
    const p = r[s];
    if (!p || !isFinite(pOrd(p))) return null;
    return { name: p.n, total: pLive(p.proj, p.n), proj: p.proj, kick: absMin(pOrd(p)) };
  }).filter(Boolean);
  const A = side('a'), X = side('x');

  const sum = (list, t) => list.reduce((n, p) =>
    n + accrued(p.total, p.name, (t - p.kick) / GAME_MIN), 0);
  // win odds use points banked so far plus the projection still to come
  const blend = (list, t) => list.reduce((n, p) => {
    const f = (t - p.kick) / GAME_MIN;
    const done = Math.max(0, Math.min(1, f));
    return n + (f >= 1 ? p.total : accrued(p.total, p.name, f) + p.proj * (1 - done));
  }, 0);

  const out = [];
  let prevA = 0, prevX = 0;
  for (let t = start; t <= end; t += SAMPLE_MIN){
    const a = sum(A, t), x = sum(X, t);
    const win = Math.max(1, Math.min(99, Math.round(50 + (blend(A,t) - blend(X,t)) * 1.1)));
    out.push({ abs:t, a:Math.round(a*10)/10, x:Math.round(x*10)/10, win,
               td: (a - prevA > 4) || (x - prevX > 4) });
    prevA = a; prevX = x;
  }
  return out;
}

// ---------------------------------------------------------------- rendering
const W = 320, H = 150, PADL = 4, PADR = 4;

export function buildRewind(el, aFinal, xFinal){
  const pts = rewindSeries();
  if (!pts.length){ el.innerHTML = `<div class="rw-empty">No games to replay yet</div>`; return; }

  const n = pts.length;
  const X = i => PADL + (i / (n - 1)) * (W - PADL - PADR);
  const Y = w => H - (w / 100) * H;

  const line = pts.map((p,i) => `${X(i).toFixed(1)},${Y(p.win).toFixed(1)}`).join(' ');
  const area = `${PADL},${Y(50)} ${line} ${X(n-1).toFixed(1)},${Y(50)}`;
  const scored = pts.map((p,i) => p.td
    ? `<circle class="rw-td" cx="${X(i).toFixed(1)}" cy="${Y(p.win).toFixed(1)}" r="2.4"/>` : '').join('');

  // day gridlines, so the week reads at a glance
  const marks = [];
  let lastDay = null;
  pts.forEach((p,i) => {
    const d = Math.floor(p.abs / 1440);
    if (d !== lastDay){
      lastDay = d;
      const x = X(i);
      const prev = marks[marks.length - 1];
      if (!prev || x - prev.x > 26) marks.push({ x, lb:DAYS[(d + 4) % 7] });
      else marks.push({ x, lb:'' });          // keep the gridline, drop the label
    }
  });

  el.innerHTML = `
    <div class="rw-head">
      <span class="rw-title">WIN PROBABILITY</span>
      <span class="rw-legend"><i class="me"></i>You<i class="opp"></i>Opponent</span>
    </div>
    <div class="rw-chart">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="rw-svg">
        <defs>
          <!-- one gradient, hard stop at the midline: green while you lead,
               red once you trail, so the side is readable without a legend -->
          <linearGradient id="rwFill" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${H}">
            <stop offset="0"   stop-color="#8CE04A" stop-opacity=".48"/>
            <stop offset="0.5" stop-color="#8CE04A" stop-opacity=".04"/>
            <stop offset="0.5" stop-color="#F0453E" stop-opacity=".04"/>
            <stop offset="1"   stop-color="#F0453E" stop-opacity=".48"/>
          </linearGradient>
        </defs>
        ${marks.map(m => `<line class="rw-grid" x1="${m.x.toFixed(1)}" y1="0" x2="${m.x.toFixed(1)}" y2="${H}"/>`).join('')}
        <polygon class="rw-area" points="${area}" fill="url(#rwFill)"/>
        <line class="rw-mid" x1="0" y1="${Y(50)}" x2="${W}" y2="${Y(50)}"/>
        <polyline class="rw-line" points="${line}"/>
        ${scored}
        <line class="rw-cursor" x1="0" y1="0" x2="0" y2="${H}"/>
        <circle class="rw-dot" cx="0" cy="0" r="4"/>
      </svg>
      <div class="rw-y"><span>100</span><span>50</span><span>100</span></div>
      <div class="rw-axis">${marks.filter(m => m.lb).map(m =>
        `<span style="left:${(m.x / W * 100).toFixed(2)}%">${m.lb}</span>`).join('')}</div>
    </div>
    <div class="rw-read">
      <div class="rw-r1"><span class="t"></span><span class="w"></span></div>
      <div class="rw-r2"><span class="sc"></span><span class="ev"></span></div>
    </div>`;

  const svg = el.querySelector('.rw-svg');
  const cur = el.querySelector('.rw-cursor'), dot = el.querySelector('.rw-dot');
  const rT = el.querySelector('.rw-r1 .t'), rW = el.querySelector('.rw-r1 .w');
  const rS = el.querySelector('.rw-r2 .sc'), rE = el.querySelector('.rw-r2 .ev');

  function show(i){
    i = Math.max(0, Math.min(n - 1, i));
    const p = pts[i], x = X(i), y = Y(p.win);
    cur.setAttribute('x1', x); cur.setAttribute('x2', x);
    dot.setAttribute('cx', x); dot.setAttribute('cy', y);
    rT.textContent = clockLabel(p.abs);
    rW.textContent = p.win + '% win';
    rW.className = 'w ' + (p.win >= 50 ? 'up' : 'dn');
    rS.innerHTML = `<b>${p.a.toFixed(1)}</b> &ndash; <b>${p.x.toFixed(1)}</b>`;
    rE.textContent = p.td ? 'Scoring play' : '';
  }
  show(n - 1);

  // scrub: pointer anywhere on the chart picks the nearest point
  let drag = false;
  const at = e => {
    const r = svg.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    show(Math.round((cx / r.width) * (n - 1)));
  };
  const move = e => { if (drag){ at(e); e.preventDefault(); } };
  const down = e => { drag = true; at(e); };
  const up = () => { drag = false; };

  if (el._rwAbort) el._rwAbort.abort();          // drop the previous render's listeners
  const ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  el._rwAbort = ac;
  const sig  = ac ? { signal:ac.signal } : {};
  const sigP = ac ? { passive:false, signal:ac.signal } : { passive:false };
  svg.addEventListener('mousedown', down, sig);
  window.addEventListener('mousemove', move, sig);
  window.addEventListener('mouseup', up, sig);
  svg.addEventListener('touchstart', down, sigP);
  window.addEventListener('touchmove', move, sigP);
  window.addEventListener('touchend', up, sig);
}

// win% bar / win% numbers are the Rewind trigger (no separate button)
export const rwOpen={};
export function toggleRewind(id){
  const rw=document.getElementById(id);if(!rw)return;
  const open=!rwOpen[id];rwOpen[id]=open;
  rw.style.display=open?'block':'none';
  document.querySelectorAll('[data-rw="'+id+'"]').forEach(e=>e.classList.toggle('rw-on',open));
  if(open&&rw.scrollIntoView)rw.scrollIntoView({block:'nearest',behavior:'smooth'});
}
// re-apply the open/closed state after a hero re-render (week step, sim step, backdrop change)
export function syncRewind(id){
  const rw=document.getElementById(id);if(!rw)return;
  const open=!!rwOpen[id];
  rw.style.display=open?'block':'none';
  document.querySelectorAll('[data-rw="'+id+'"]').forEach(e=>e.classList.toggle('rw-on',open));
}
