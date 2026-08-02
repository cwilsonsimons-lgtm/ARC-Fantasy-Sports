// Arc Markets — the three charts on a contract.
//
// A. PRICE            what the crowd thought, over time
// B. LAST FIVE        what the player actually did, against his own average
// C. PACE             cumulative production against the pace today's price implies
//
// A and B exist elsewhere in some form. C does not, and cannot: it only works
// because an Arc contract settles on a season total. A price line tells you the
// crowd's opinion and never the player's output; a game-log chart tells you the
// output and never whether the price is fair. C is the only one that puts the
// two on the same axes, so the gap between the lines *is* the trade.
//
// Everything here is derived from the player's id, so the same player shows the
// same season on every load.
import { SEASON_GAMES, WEEKS_PLAYED, POINTS_PER_DOLLAR,
         gameLog, priceDays, careerSeries, paceData } from './data.js';
import { esc, money } from './ui.js';
import { priceChart as livePriceChart } from './pricechart.js';

const UP = '#2BE06B', DOWN = '#FF4B4B', BLUE = '#2E8CFF', DIM = '#5A6577';

// ---------------------------------------------------------------- chart A
// Finance ranges (1D / 1W / 1M / 3M / 1Y) assume something trades every day.
// Football does not: a 1D chart in June is a flat line, and a 1M chart is four
// data points. These ranges are cut to the sport instead.
export const RANGES = [
  ['week',   'This week', 'Since the last kickoff'],
  ['five',   'Last 5',    'The last five game weeks'],
  ['season', 'Season',    `Week 1 through week ${WEEKS_PLAYED}`],
  ['career', 'Career',    'One price per season in the league'],
];

/** {pts:[{v,label,sub}], first, last, min, max} for one range. */
export function priceSeries(p, range) {
  if (range === 'career') {
    const yrs = careerSeries(p);
    return frame(yrs.map(y => ({ v: y.price, label: "'" + String(y.year).slice(2),
                                 sub: `${y.year} season` })));
  }
  const days = priceDays(p);
  const span = range === 'week' ? 7 : range === 'five' ? 35 : days.length;
  const cut = days.slice(Math.max(0, days.length - span));
  const every = range === 'week' ? 1 : 7;
  let seen = null;
  return frame(cut.map((d, i) => {
    // one tick per day inside a week, one per game week beyond that - and never
    // the same tick twice, since the final point rarely lands on the cadence
    let label = '';
    if (i % every === 0 || i === cut.length - 1) {
      label = range === 'week' ? DAY[i % 7] : 'W' + (d.w + 1);
      if (label === seen) label = ''; else seen = label;
    }
    return { v: d.v, label,
      sub: range === 'week' ? `${DAY_FULL[i % 7]}, week ${d.w + 1}` : `Week ${d.w + 1}` };
  }));
}
const DAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function frame(pts) {
  const vs = pts.map(p => p.v);
  const min = Math.min(...vs), max = Math.max(...vs);
  return { pts, first: vs[0], last: vs[vs.length - 1], min, max };
}

const W = 320, H = 118;

export function priceChart(p, range) {
  const s = priceSeries(p, range);
  const n = s.pts.length;
  const up = s.last >= s.first;
  const color = up ? UP : DOWN;
  const pad = (s.max - s.min) * 0.18 || 0.05;
  const lo = s.min - pad, hi = s.max + pad;
  const X = i => (i / Math.max(1, n - 1)) * W;
  const Y = v => H - ((v - lo) / (hi - lo)) * H;
  const line = s.pts.map((q, i) => `${X(i).toFixed(1)},${Y(q.v).toFixed(1)}`).join(' ');

  const delta = s.last - s.first;
  const pct = s.first ? (delta / s.first) * 100 : 0;
  const label = (RANGES.find(r => r[0] === range) || RANGES[0])[1];

  return `
    <div class="mkc" data-mkc="price">
      <div class="mkc-h">
        <div class="mkc-t">PRICE</div>
        <div class="mkc-d ${up ? 'up' : 'down'}">${delta < 0 ? '-' : '+'}${money(delta)}
          (${pct < 0 ? '-' : '+'}${Math.abs(pct).toFixed(1)}%) &middot; ${esc(label.toLowerCase())}</div>
      </div>
      <div class="mkc-plot">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="mkc-svg">
          <defs><linearGradient id="mkcpx" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${color}" stop-opacity=".34"/>
            <stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
          <line class="mkc-base" x1="0" y1="${Y(s.first).toFixed(1)}" x2="${W}" y2="${Y(s.first).toFixed(1)}"/>
          <polygon points="0,${H} ${line} ${W},${H}" fill="url(#mkcpx)"/>
          <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2"
            stroke-linejoin="round" stroke-linecap="round"/>
          <line class="mkc-cur" x1="0" y1="0" x2="0" y2="${H}"/>
          <circle class="mkc-dot" cx="${X(n - 1)}" cy="${Y(s.last).toFixed(1)}" r="3.4" fill="${color}"/>
        </svg>
        <div class="mkc-hi">${money(s.max)}</div>
        <div class="mkc-lo">${money(s.min)}</div>
      </div>
      <div class="mkc-x">${s.pts.map((q, i) => q.label
        ? `<span style="left:${((X(i) / W) * 100).toFixed(2)}%">${esc(q.label)}</span>` : '').join('')}</div>
      <div class="mkc-read"><span class="a">${money(s.last)}</span><span class="b">Now</span></div>
      <div class="mkc-ranges">${RANGES.map(([k, lb]) =>
        `<div class="mkc-rg${k === range ? ' on' : ''}" onclick="mkRange('${p.id}','${k}')">${lb}</div>`
      ).join('')}</div>
    </div>`;
}

// ---------------------------------------------------------------- chart B
// Bars of real output with the season average as the reference, over/under
// coloured. This is the one that answers "is $2.86 good?" in the terms the
// question is actually about - what the player did, not what he cost.
export function lastFiveChart(p) {
  const log = gameLog(p);
  const played = log.slice(0, WEEKS_PLAYED);
  if (!played.length) return '';
  const five = played.slice(-5);
  const avg = played.reduce((n, g) => n + g.pts, 0) / played.length;
  const top = Math.max(avg, ...five.map(g => g.pts)) * 1.14 || 1;
  const beat = five.filter(g => g.pts >= avg).length;
  // the bar band and the week label below it are fixed heights, so the average
  // line can be placed in px and actually land where the bars say it does
  const BAND = 92, FOOT = 18;

  return `
    <div class="mkc">
      <div class="mkc-h">
        <div class="mkc-t">LAST 5 GAMES</div>
        <div class="mkc-d">${beat} of ${five.length} over average</div>
      </div>
      <div class="mkc-bars">
        <div class="mkc-avg" style="bottom:${(FOOT + (avg / top) * BAND).toFixed(1)}px">
          <span>AVG ${avg.toFixed(1)}</span>
        </div>
        ${five.map(g => {
          const over = g.pts >= avg;
          return `<div class="mkc-bar">
            <div class="col"><div class="b ${over ? 'up' : 'down'}"
              style="height:${Math.max(2, (g.pts / top) * 100).toFixed(1)}%"><span
              class="v ${over ? 'up' : 'down'}">${g.pts.toFixed(1)}</span></div></div>
            <div class="w">W${g.week}</div>
          </div>`;
        }).join('')}
      </div>
      <div class="mkc-note">PPR points per game. The dashed line is his own season average
        (${avg.toFixed(1)}), so a green bar is a week he beat himself.</div>
    </div>`;
}

// ---------------------------------------------------------------- chart C
export function paceChart(p) {
  const d = paceData(p);
  if (d.cum.length < 2) return '';
  const ahead = d.ahead >= 0;
  const color = ahead ? UP : DOWN;
  const top = Math.max(d.target, d.finish, d.run) * 1.06 || 1;
  const X = w => (w / SEASON_GAMES) * W;
  const Y = v => H - (v / top) * H;

  const actual = d.cum.map(c => `${X(c.week).toFixed(1)},${Y(c.pts).toFixed(1)}`).join(' ');
  const last = d.cum[d.cum.length - 1];
  // the gap between what he has done and what the price has him doing
  const gap = `${X(0)},${Y(0)} ${actual} ${X(last.week).toFixed(1)},${Y(d.paceNow).toFixed(1)}`;
  const settle = d.finish / POINTS_PER_DOLLAR;

  return `
    <div class="mkc">
      <div class="mkc-h">
        <div class="mkc-t">PACE</div>
        <div class="mkc-d ${ahead ? 'up' : 'down'}">${ahead ? '+' : '-'}${Math.abs(d.ahead).toFixed(1)} pts
          ${ahead ? 'ahead of' : 'behind'} the price</div>
      </div>
      <div class="mkc-plot tall">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="mkc-svg">
          <defs><linearGradient id="mkcpace" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${color}" stop-opacity=".30"/>
            <stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
          <polygon points="${gap}" fill="url(#mkcpace)"/>
          <line class="mkc-pace" x1="0" y1="${Y(0)}" x2="${X(SEASON_GAMES)}" y2="${Y(d.target).toFixed(1)}"/>
          <line class="mkc-proj" style="stroke:${color}"
            x1="${X(last.week).toFixed(1)}" y1="${Y(last.pts).toFixed(1)}"
            x2="${X(SEASON_GAMES)}" y2="${Y(d.finish).toFixed(1)}"/>
          <polyline points="${actual}" fill="none" stroke="${color}" stroke-width="2.2"
            stroke-linejoin="round" stroke-linecap="round"/>
          <circle cx="${X(last.week).toFixed(1)}" cy="${Y(last.pts).toFixed(1)}" r="3.4" fill="${color}"/>
        </svg>
        <div class="mkc-hi">${Math.round(top)}</div>
        <div class="mkc-lo">0</div>
      </div>
      <div class="mkc-x">
        <span style="left:0%">W1</span>
        <span style="left:${((WEEKS_PLAYED / SEASON_GAMES) * 100).toFixed(1)}%">NOW</span>
        <span style="left:100%">W${SEASON_GAMES}</span>
      </div>
      <div class="mkc-key">
        <span><i style="background:${color}"></i>Actual ${d.run.toFixed(0)} pts</span>
        <span><i class="dash"></i>Price pace ${d.target.toFixed(0)} pts</span>
      </div>
      <div class="mkc-verdict ${ahead ? 'up' : 'down'}">
        At ${d.rate.toFixed(1)} points a game he finishes on <b>${d.finish.toFixed(0)}</b>, and the
        contract settles near <b>${money(settle)}</b> against <b>${money(p.price)}</b> today.
      </div>
      <div class="mkc-note">The straight line is the season total you are paying for at
        ${money(p.price)}. The climbing line is what he has actually banked. The gap between
        them is the whole trade.</div>
    </div>`;
}

// ---------------------------------------------------------------- all three
// The price chart now comes from pricechart.js, which reads the live tape and
// the event feed. B and C stay here: they chart the player's production, which
// is not a market quantity.
export function playerCharts(p, range, term) {
  return livePriceChart(p, range, term) + lastFiveChart(p) + paceChart(p);
}
