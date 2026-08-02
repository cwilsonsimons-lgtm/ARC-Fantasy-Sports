// Arc Markets — the Portfolio screen: value card, tabs, holdings table.
import { portfolioSeries, watchRows } from './data.js';
import { orders, portfolioTotals } from './orders.js';
import { BY_ID } from './data.js';
import { ICON, spark, money, signed, pctText, dirClass, tri, holdingRow, marketRow, empty,
         esc, qtyClass, qtyText } from './ui.js';

let tab = 'holdings';       // holdings | watchlist | news | history
let sortKey = 'value';      // value | name | change | size

const TABS = [
  ['holdings',  'Holdings',  ICON.bag],
  ['watchlist', 'Watchlist', ICON.star],
  ['news',      'News',      ICON.news],
  ['history',   'History',   ICON.history],
];
const SORTS = [
  ['value',  'Value'],
  ['name',   'Name'],
  ['change', 'Change'],
  ['size',   'Position size'],
];

function sortRows(rows) {
  const by = {
    value:  (a, b) => Math.abs(b.value) - Math.abs(a.value),
    name:   (a, b) => a.name.localeCompare(b.name),
    change: (a, b) => b.dayChange - a.dayChange,
    size:   (a, b) => Math.abs(b.qty) - Math.abs(a.qty),
  };
  return [...rows].sort(by[sortKey] || by.value);
}

function body(pf) {
  if (tab === 'holdings') {
    if (!pf.rows.length) return empty(ICON.bag, 'No open positions', '');
    return `<div class="mk-hcount">
        <span class="n">${pf.rows.length} Positions</span>
        <select class="mk-sortsel" onchange="mkSortBy(this.value)">
          ${SORTS.map(([k, lb]) =>
            `<option value="${k}"${sortKey === k ? ' selected' : ''}>${lb}</option>`).join('')}
        </select>
      </div>
      <div class="mk-th">
        <span style="flex:1">PLAYER</span>
        <span style="min-width:54px;text-align:right;margin-right:7px">MARK</span>
        <span style="min-width:78px;text-align:right">TODAY / VALUE</span>
      </div>
      ${sortRows(pf.rows).map(holdingRow).join('')}`;
  }
  if (tab === 'history') {
    const log = orders();
    if (!log.length) return empty(ICON.history, 'No trades yet', '');
    return `<div class="mk-hcount"><span class="n">${log.length} Fills</span></div>
      ${[...log].reverse().map(o => {
        const p = BY_ID[o.pid];
        return `<div class="mk-fill" onclick="mkOpenPlayer('${o.pid}')">
          <span class="sd ${o.side}">${o.side.toUpperCase()}</span>
          <div class="who"><div class="nm">${esc(p ? p.name : o.pid)}</div>
            <div class="sb">${new Date(o.ts).toLocaleDateString()}</div></div>
          <div class="qt">${o.qty.toLocaleString()} @ ${money(o.price)}</div>
        </div>`;
      }).join('')}`;
  }
  if (tab === 'watchlist') {
    const rows = watchRows();
    return rows.length
      ? `<div class="mk-hcount"><span class="n">${rows.length} Watching</span></div>
         ${rows.map(marketRow).join('')}`
      : empty(ICON.star, 'Nothing on your watchlist',
              'Tap the star on any player in the Market tab to follow their price here.');
  }
  if (tab === 'news') {
    return empty(ICON.news, 'No news in this prototype',
      'Player news would land here. It is deliberately empty rather than filled with '
      + 'invented headlines about real players.');
  }
  return empty(ICON.news, 'No news in this prototype', '');
}

export function renderPortfolio() {
  const el = document.getElementById('mkPortfolio');
  if (!el) return;
  // Everything on this screen is folded out of the order book, so a fill that
  // lands anywhere is reflected here the moment this runs.
  const pf = portfolioTotals();
  const d = dirClass(pf.dayChange);
  const color = pf.dayChange < 0 ? '#F05D5E' : '#329F5B';

  el.innerHTML = `
    <div class="mk-ptop"><h1>Portfolio</h1></div>

    <div class="mk-val">
      <div class="l">
        <div class="k">POSITIONS VALUE</div>
        <div class="v">${money(pf.value)}</div>
        <div class="c ${d}">${tri(pf.dayChange)} ${signed(pf.dayChange)}
          (${pctText(Math.abs(pf.dayPct))}) <em>today</em></div>
      </div>
      <div class="g">${spark(portfolioSeries(pf.value, pf.dayChange), color,
        { w: 150, h: 82, fill: true, id: 'pf' })}</div>
    </div>

    <div class="mk-tot">
      <div><span class="k">BUYING POWER</span><span class="v">${money(pf.buyingPower)}</span></div>
      <div><span class="k">OPEN P/L</span><span class="v ${dirClass(pf.openPL)}">${signed(pf.openPL)}</span></div>
      <div><span class="k">REALIZED</span><span class="v ${dirClass(pf.realized)}">${signed(pf.realized)}</span></div>
    </div>

    <div class="mk-tabs">
      ${TABS.map(([k, lb, ic]) => `<div class="mk-tab${tab === k ? ' on' : ''}" onclick="mkTab('${k}')">
        ${ic}${lb}${k === 'news' ? '<span class="nd"></span>' : ''}</div>`).join('')}
    </div>

    ${body(pf)}`;
}

export function mkTab(k) { tab = k; renderPortfolio(); }
export function mkSortBy(k) { sortKey = k; renderPortfolio(); }
