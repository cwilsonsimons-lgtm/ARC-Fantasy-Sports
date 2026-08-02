// Arc Markets — the Portfolio screen.
//
// Every number here is read from the ledger at the current market price. There
// is no seeded holding and no mock row: if the account owns nothing, the screen
// says so. Positions revalue on each flow tick because accountSummary() is
// recomputed on every render, not cached.
import { BY_ID, watchRows } from './data.js';
import { ICON, spark, money, signed, dirClass, tri, face, esc, marketRow, empty } from './ui.js';
import { accountSummary, closedRows, resetLedger, workingOrders, START_CASH } from './ledger.js';
import { TERM_BY_KEY } from './contracts.js';

let tab = 'holdings';       // holdings | watchlist | orders | history
let sortKey = 'value';      // value | change | pl | name

const TABS = [
  ['holdings',  'Positions', ICON.bag],
  ['watchlist', 'Watchlist', ICON.star],
  ['orders',    'Orders',    ICON.sliders],
  ['history',   'History',   ICON.history],
];

function sortRows(rows) {
  const by = {
    value:  (a, b) => Math.abs(b.value) - Math.abs(a.value),
    change: (a, b) => b.dayPl - a.dayPl,
    pl:     (a, b) => b.pl - a.pl,
    name:   (a, b) => nameOf(a).localeCompare(nameOf(b)),
  };
  return [...rows].sort(by[sortKey] || by.value);
}
function nameOf(r) { const p = BY_ID[r.playerId]; return p ? p.name : r.playerId; }
function pctSigned(pct, amount) {
  const neg = (amount != null ? amount : pct) < 0;
  return `${neg ? '-' : '+'}${Math.abs(pct).toFixed(2)}%`;
}

/** One open position: size, average cost, market value and P&L. */
function positionCard(r) {
  const p = BY_ID[r.playerId];
  if (!p) return '';
  const t = TERM_BY_KEY[r.term];
  const d = dirClass(r.pl);
  return `<div class="pf-row" onclick="mkOpenPlayer('${r.playerId}')">
    <div class="bar" style="background:${p.color}"></div>
    ${face(p)}
    <div class="who">
      <div class="nm">${esc(p.name)}</div>
      <div class="sb">${esc(p.pos)} &middot; ${esc(p.tm)} &middot; ${esc(t ? t.short : r.term)}</div>
      <span class="chip ${r.side}">${r.side === 'short' ? 'SHORT ' : ''}${Math.abs(r.qty)} sh</span>
      <span class="chip">avg ${money(r.avg)}</span>
    </div>
    <div class="vals">
      <div class="v">${money(Math.abs(r.value))}</div>
      <div class="pl ${d}">${tri(r.pl)} ${signed(r.pl)}</div>
      <div class="pp ${d}">${pctSigned(r.plPct, r.pl)}</div>
    </div>
  </div>`;
}

function closedCard(c) {
  const p = BY_ID[c.playerId];
  const d = dirClass(c.pl);
  const when = new Date(c.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const why = c.reason === 'expiry' ? 'Settled · expired'
            : c.reason === 'retired' ? 'Settled · retired'
            : c.reason === 'settled' ? 'Settled' : 'Closed';
  return `<div class="pf-row closed"${p ? ` onclick="mkOpenPlayer('${c.playerId}')"` : ''}>
    <div class="bar" style="background:${p ? p.color : '#5A6675'}"></div>
    ${p ? face(p) : '<div class="face">—</div>'}
    <div class="who">
      <div class="nm">${esc(p ? p.name : c.playerId)}</div>
      <div class="sb">${why} &middot; ${when}</div>
      <span class="chip ${c.side}">${c.side === 'short' ? 'SHORT ' : ''}${Math.abs(c.qty)} sh</span>
      <span class="chip">${money(c.avg)} → ${money(c.exit != null ? c.exit : c.settleValue)}</span>
    </div>
    <div class="vals">
      <div class="pl ${d}">${signed(c.pl)}</div>
      <div class="pp">realized</div>
    </div>
  </div>`;
}

function body(a) {
  if (tab === 'holdings') {
    if (!a.rows.length) {
      return empty(ICON.bag, 'No open positions',
        'Open the Market tab, pick a player and tap Buy. Positions appear here immediately '
        + 'and revalue as the market moves.');
    }
    return `<div class="mk-hcount">
        <span class="n">${a.rows.length} position${a.rows.length === 1 ? '' : 's'}</span>
        <span class="mk-sort" onclick="mkCycleSort()">${ICON.sliders} Sort by ${sortKey} ${ICON.chevron}</span>
      </div>
      ${sortRows(a.rows).map(positionCard).join('')}`;
  }
  if (tab === 'watchlist') {
    const rows = watchRows();
    return rows.length
      ? `<div class="mk-hcount"><span class="n">${rows.length} watching</span></div>
         ${rows.map(r => marketRow(r)).join('')}`
      : empty(ICON.star, 'Nothing on your watchlist',
              'Tap the star beside any player’s name to follow their price here.');
  }
  if (tab === 'orders') {
    const working = workingOrders();
    if (!working.length) {
      return empty(ICON.sliders, 'No working orders',
        'Limit orders that have not filled yet wait here until the market reaches your price.');
    }
    return working.map(o => {
      const p = BY_ID[o.sym.split('@')[0]];
      return `<div class="pf-row">
        <div class="bar" style="background:${p ? p.color : '#5A6675'}"></div>
        ${p ? face(p) : ''}
        <div class="who">
          <div class="nm">${esc(p ? p.name : o.sym)}</div>
          <div class="sb">${esc(o.action.toUpperCase())} ${o.qty} @ ${money(o.limit)}
            ${o.filled ? `&middot; ${o.filled} filled` : ''}</div>
        </div>
        <div class="vals"><div class="cancel" onclick="event.stopPropagation();mkCancelOrder('${o.id}')">Cancel</div></div>
      </div>`;
    }).join('');
  }
  const closed = closedRows();
  return closed.length
    ? `<div class="mk-hcount"><span class="n">${closed.length} closed</span>
         <span class="mk-sort">Realized ${signed(a.realized)}</span></div>
       ${closed.map(closedCard).join('')}`
    : empty(ICON.history, 'No closed positions yet',
        'When you close a position — or a contract settles — it moves here with its realized profit or loss.');
}

/** Portfolio value over the session, from the positions actually held. */
function valueSeries(a) {
  const n = 40, out = [];
  const start = a.equity - a.dayChange;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push(start + a.dayChange * t);
  }
  out[n - 1] = a.equity;
  const lo = Math.min(...out), hi = Math.max(...out), span = hi - lo || 1;
  return out.map(v => Math.round(((v - lo) / span) * 100) / 100);
}

export function renderPortfolio() {
  const el = document.getElementById('mkPortfolio');
  if (!el) return;
  const a = accountSummary();
  const d = dirClass(a.dayChange);
  const color = a.dayChange < 0 ? '#FF4B4B' : '#2BE06B';
  const stat = (lb, val, cls) => `<div class="pf-s"><span>${lb}</span><b class="${cls || ''}">${val}</b></div>`;
  // the sign comes from the underlying amount, so a return that rounds to 0.00%
  // cannot read '+' while the dollar figure beside it reads negative

  el.innerHTML = `
    <div class="mk-ptop">
      <h1>Portfolio</h1>
      <span class="mk-range" onclick="mkResetAccount()">${ICON.history} Reset</span>
    </div>

    <div class="mk-val">
      <div class="l">
        <div class="k">TOTAL VALUE</div>
        <div class="v">${money(a.equity)}</div>
        <div class="c ${d}">${tri(a.dayChange)} ${signed(a.dayChange)}
          (${pctSigned(a.dayPct, a.dayChange)}) <em>today</em></div>
      </div>
      <div class="g">${spark(valueSeries(a), color, { w: 150, h: 82, fill: true, id: 'pf' })}</div>
    </div>

    <div class="pf-stats">
      ${stat('Cash', money(a.cash))}
      ${stat('Buying power', money(a.buyingPower))}
      ${stat('Positions', money(a.longValue + a.shortValue))}
      ${stat('Total return', signed(a.totalReturn), dirClass(a.totalReturn))}
      ${stat('Return %', pctSigned(a.totalReturnPct, a.totalReturn), dirClass(a.totalReturn))}
      ${stat('Cost basis', money(a.costBasis))}
      ${stat('Unrealized', signed(a.unrealized), dirClass(a.unrealized))}
      ${stat('Realized', signed(a.realized), dirClass(a.realized))}
      ${stat('Open', String(a.openCount))}
    </div>

    <div class="mk-tabs">
      ${TABS.map(([k, lb, ic]) => `<div class="mk-tab${tab === k ? ' on' : ''}" onclick="mkTab('${k}')">
        ${ic}${lb}</div>`).join('')}
    </div>

    ${body(a)}`;
}

export function mkTab(k) { tab = k; renderPortfolio(); }
export function mkCycleSort() {
  const order = ['value', 'change', 'pl', 'name'];
  sortKey = order[(order.indexOf(sortKey) + 1) % order.length];
  renderPortfolio();
}
/** Explicit reset — the only thing that ever clears holdings. */
export function mkResetAccount() {
  if (!window.confirm('Reset the account? This clears every position, order and '
      + `all trade history, and returns the balance to ${money(START_CASH)}.`)) return;
  resetLedger();
  renderPortfolio();
  window.mkToast && window.mkToast('Account reset');
}
