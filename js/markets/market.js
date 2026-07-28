// Arc Markets — the Market screen: status strip, highlight cards, filters, table.
import { MARKET, marketStats, topMover, mostActive, topRookie, watchRows } from './data.js';
import { ICON, spark, face, esc, money, pctText, marketRow } from './ui.js';

let filter = 'All';          // All | QB | RB | WR | TE | Trending | Movers | Watch
let sortDesc = true;         // price sort direction

function highlight(kind, p) {
  const map = {
    up:   { cls: 'up',   lb: 'TRENDING UP',  ic: ICON.flame,  color: '#2BE06B',
            val: `+${pctText(Math.abs(p.pct))}`, tone: 'up' },
    down: { cls: 'down', lb: 'BIGGEST DROP', ic: ICON.drop,   color: '#FF4B4B',
            val: `-${pctText(Math.abs(p.pct))}`, tone: 'down' },
    act:  { cls: 'act',  lb: 'MOST ACTIVE',  ic: ICON.rocket, color: '#2E8CFF',
            val: (p.trades / 1000).toFixed(1) + 'K', tone: 'act', sub: 'trades today' },
    rook: { cls: 'rook', lb: 'ROOKIE BUZZ',  ic: ICON.star,   color: '#A86EFF',
            val: `+${pctText(Math.abs(p.pct))}`, tone: 'rook' },
  };
  const m = map[kind];
  return `<div class="mk-card ${m.cls}" onclick="mkOpenPlayer('${p.id}')">
    <div class="lb" style="color:${m.color}">${m.ic}${m.lb}</div>
    ${face(p)}
    <div class="nm">${esc(p.name)}</div>
    <div class="vl" style="color:${m.color}">${m.val}</div>
    ${m.sub ? `<div class="sub">${m.sub}</div>` : ''}
    ${spark(p.spark, m.color, { w: 88, h: 24, id: m.cls })}
  </div>`;
}

const PILLS = [
  ['All'], ['QB'], ['RB'], ['WR'], ['TE'], ['|'],
  ['Trending', ICON.trend], ['Movers', ICON.movers], ['Watch', ICON.star],
];

function rows() {
  let list = MARKET;
  if (['QB', 'RB', 'WR', 'TE'].includes(filter)) list = list.filter(p => p.pos === filter);
  else if (filter === 'Trending') list = [...list].sort((a, b) => b.pct - a.pct);
  else if (filter === 'Movers')   list = [...list].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  else if (filter === 'Watch')    list = watchRows();

  if (filter === 'All' || ['QB', 'RB', 'WR', 'TE'].includes(filter)) {
    list = [...list].sort((a, b) => sortDesc ? b.price - a.price : a.price - b.price);
  }
  if (!list.length) {
    return `<div class="mk-empty">${ICON.star}<div class="t">Nothing on your watchlist yet</div>
      <div class="s">Tap the star on any player to follow their price here.</div></div>`;
  }
  return list.map(marketRow).join('');
}

export function renderMarket() {
  const el = document.getElementById('mkMarket');
  if (!el) return;
  const st = marketStats();
  el.innerHTML = `
    <div class="mk-strip">
      <span class="open"><span class="dot"></span>MARKET OPEN</span>
      <span class="sep">|</span>
      <span><b>${st.trades.toLocaleString()}</b> trades today</span>
      <span class="sep">|</span>
      <span>Volume <span class="up">&#9650; ${st.volumePct}%</span></span>
      <span class="sep">|</span>
      <span>Season 2026</span>
    </div>

    <div class="mk-cards">
      ${highlight('up', topMover(1))}
      ${highlight('down', topMover(-1))}
      ${highlight('act', mostActive())}
      ${highlight('rook', topRookie())}
    </div>

    <div class="mk-pills">
      ${PILLS.map(([k, ic]) => k === '|'
        ? '<div class="mk-pill div"></div>'
        : `<div class="mk-pill${filter === k ? ' on' : ''}" onclick="mkFilter('${k}')">${ic || ''}${k === 'Watch' ? '' : k}</div>`
      ).join('')}
    </div>

    <div class="mk-th">
      <span style="flex:1">PLAYER</span>
      <span class="s" style="min-width:54px;justify-content:flex-end;margin-right:7px" onclick="mkSort()">PRICE ${ICON.sort}</span>
      <span style="min-width:46px;text-align:center">TREND</span>
      <span style="min-width:27px"></span>
    </div>
    ${rows()}`;
}

export function mkFilter(k) { filter = k; renderMarket(); }
export function mkSort() { sortDesc = !sortDesc; renderMarket(); }
