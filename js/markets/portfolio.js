// Arc Markets — the Portfolio screen: value card, tabs, holdings table.
import { portfolio, watchRows } from './data.js';
import { ICON, spark, money, signed, pctText, dirClass, tri, holdingRow, marketRow, empty } from './ui.js';

let tab = 'holdings';       // holdings | watchlist | news | history
let sortKey = 'value';      // value | change | price | name

const TABS = [
  ['holdings',  'Holdings',  ICON.bag],
  ['watchlist', 'Watchlist', ICON.star],
  ['news',      'News',      ICON.news],
  ['history',   'History',   ICON.history],
];

function sortRows(rows) {
  const by = {
    value:  (a, b) => b.value - a.value,
    change: (a, b) => b.dayChange - a.dayChange,
    price:  (a, b) => b.price - a.price,
    name:   (a, b) => a.name.localeCompare(b.name),
  };
  return [...rows].sort(by[sortKey] || by.value);
}

function body(pf) {
  if (tab === 'holdings') {
    return `<div class="mk-hcount">
        <span class="n">${pf.rows.length} Holdings</span>
        <span class="mk-sort" onclick="mkCycleSort()">${ICON.sliders} Sort by ${ICON.chevron}</span>
      </div>
      <div class="mk-th">
        <span style="flex:1">PLAYER</span>
        <span style="min-width:54px;text-align:right;margin-right:7px">PRICE</span>
        <span style="min-width:78px;text-align:right">TODAY'S CHANGE</span>
      </div>
      ${sortRows(pf.rows).map(holdingRow).join('')}`;
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
  return empty(ICON.history, 'No orders yet',
    'Arc Markets is a concept. The first build is free to play, with no real money — '
    + 'your play-money buy and sell history would appear here.');
}

export function renderPortfolio() {
  const el = document.getElementById('mkPortfolio');
  if (!el) return;
  const pf = portfolio();
  const d = dirClass(pf.dayChange);
  const color = pf.dayChange < 0 ? '#FF4B4B' : '#2BE06B';

  el.innerHTML = `
    <div class="mk-ptop">
      <h1>Portfolio</h1>
      <span class="mk-range" onclick="mkToast('Range switching is not wired up in this prototype')">
        Today ${ICON.chevron}</span>
    </div>

    <div class="mk-val">
      <div class="l">
        <div class="k">PORTFOLIO VALUE</div>
        <div class="v">${money(pf.value)}</div>
        <div class="c ${d}">${tri(pf.dayChange)} ${signed(pf.dayChange)}
          (${pctText(Math.abs(pf.dayPct))}) <em>today</em></div>
      </div>
      <div class="g">${spark(pf.series, color, { w: 150, h: 82, fill: true, id: 'pf' })}</div>
    </div>

    <div class="mk-tabs">
      ${TABS.map(([k, lb, ic]) => `<div class="mk-tab${tab === k ? ' on' : ''}" onclick="mkTab('${k}')">
        ${ic}${lb}${k === 'news' ? '<span class="nd"></span>' : ''}</div>`).join('')}
    </div>

    ${body(pf)}`;
}

export function mkTab(k) { tab = k; renderPortfolio(); }
export function mkCycleSort() {
  const order = ['value', 'change', 'price', 'name'];
  sortKey = order[(order.indexOf(sortKey) + 1) % order.length];
  renderPortfolio();
  window.mkToast && window.mkToast('Sorted by ' + sortKey);
}
