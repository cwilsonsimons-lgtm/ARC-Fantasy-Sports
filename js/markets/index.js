// Arc Markets — section shell: open/close, bottom nav, sheets, toasts.
//
// This is the only file that touches the fantasy app, and only at the seam:
// opening the section adds a class to <body>, closing it removes it. Markets
// never reads league state, and the fantasy app never reads market state.
//
// The app's own bottom nav stays visible throughout; Markets has no nav of its
// own, and reaches the portfolio from a button in the header instead.
import { BY_ID, toggleWatch, isWatched, seasonCurve, POINTS_PER_DOLLAR,
         holdingRows } from './data.js';
import { ICON, face, esc, money, pctText, dirClass, tri } from './ui.js';
import { playerCharts, priceChart } from './charts.js';
import { renderMarket } from './market.js';
import { renderPortfolio } from './portfolio.js';

let view = 'market';
let pxRange = 'season';   // survives across sheet opens, like a stock app's

export function openMarkets() {
  document.body.classList.add('markets');
  mkView(view);
}

/** Leave Arc Markets and go back to the fantasy app. */
export function closeMarkets() {
  if (!document.body.classList.contains('markets')) return;   // also called by nav items
  document.body.classList.remove('markets');
  mkCloseSheet();
  // hand control back to whichever fantasy tab makes sense right now
  window.showTab && window.showTab(window.homeTab ? window.homeTab() : 'matchup');
}

export function mkView(name) {
  view = name;
  document.querySelectorAll('.mk-view').forEach(v =>
    v.classList.toggle('on', v.dataset.mkview === name));
  const btn = document.getElementById('mkPfBtn');
  if (btn) btn.classList.toggle('on', name === 'portfolio');
  if (name === 'market') renderMarket(); else renderPortfolio();
  const sc = document.getElementById('mkScroll');
  if (sc) sc.scrollTop = 0;
}

/** The header's top-right button swaps between the market and the portfolio. */
export function mkTogglePortfolio() {
  mkView(view === 'portfolio' ? 'market' : 'portfolio');
}


// ---------------------------------------------------------------- watchlist
export function mkToggleWatch(id, el) {
  const on = toggleWatch(id);
  if (el) el.classList.toggle('on', on);
  mkToast(on ? 'Added to watchlist' : 'Removed from watchlist');
}

// ---------------------------------------------------------------- sheets
function openSheet(title, html) {
  document.getElementById('mkSheetTitle').innerHTML = title;
  document.getElementById('mkSheetBody').innerHTML = html;
  document.body.classList.add('mk-sheet-open');
}
export function mkCloseSheet() { document.body.classList.remove('mk-sheet-open'); }

export function mkOpenPlayer(id) {
  const p = BY_ID[id];
  if (!p) return;
  const d = dirClass(p.pct);
  const curve = seasonCurve(p);

  // No sparkline in the header: the price chart below draws the same season at
  // full width, and the thumbnail was the same picture twice.
  openSheet(esc(p.name), `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
      ${face(p)}
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;color:var(--mk-ink-3);font-weight:700">
          ${esc(p.tm)} &middot; ${esc(p.posRank)}</div>
        <div style="font-size:24px;font-weight:800;margin-top:3px">${money(p.price)}</div>
        <div class="${d}" style="font-size:12.5px;font-weight:700;margin-top:2px">
          ${tri(p.pct)} ${money(p.change)} (${pctText(Math.abs(p.pct))}) today</div>
      </div>
    </div>

    ${holdingFor(p.id)}

    <div id="mkCharts">${playerCharts(p, pxRange)}</div>

    <div class="mk-settle">${ICON.info}<span>Settles on official season production at
      <b>${POINTS_PER_DOLLAR} points per $1</b>. This contract pays out
      ${p.sproj.toFixed(1)} &divide; ${POINTS_PER_DOLLAR} = <b>${money(p.price)}</b> at today's
      projection — the final number is whatever the player actually does.</span></div>

    <h4>SEASON CONTRACTS</h4>
    <div class="mk-curve">
      ${curve.map((c, i) => `<div class="yr${i === 0 ? ' now' : ''}">
        <div class="y">${c.year}</div><div class="p">${money(c.price)}</div></div>`).join('')}
    </div>
    <p style="font-size:11.5px;color:var(--mk-ink-3);margin-top:10px">Three seasons priced side by
      side sketch the shape of a career — a premium on players with room to grow, a discount on
      those past their peak.</p>

    <div style="display:flex;gap:9px;margin-top:14px">
      <div class="mk-pill${isWatched(p.id) ? ' on' : ''}" style="flex:1;justify-content:center"
        onclick="mkToggleWatch('${p.id}');mkOpenPlayer('${p.id}')">${ICON.star} Watch</div>
      <div class="mk-pill" style="flex:1;justify-content:center;background:var(--mk-blue);
        border-color:var(--mk-blue);color:#fff" onclick="mkAbout()">${ICON.info} How this works</div>
    </div>`);
}

/** Range buttons on the price chart: swap that one chart, leave the sheet alone. */
export function mkRange(id, key) {
  const p = BY_ID[id];
  if (!p) return;
  pxRange = key;
  const host = document.querySelector('#mkCharts [data-mkc="price"]');
  if (host) host.outerHTML = priceChart(p, key); else mkOpenPlayer(id);
}

/** The holdings row no longer has room for total value, so it lives here. */
function holdingFor(id) {
  const h = holdingRows().find(r => r.id === id);
  if (!h) return '';
  return `<div class="mk-settle" style="margin-bottom:8px">${ICON.bag}<span>You hold
    <b>${h.shares} shares</b> &middot; total value <b>${money(h.value)}</b>
    &middot; <span class="${dirClass(h.dayChange)}">${money(h.dayChange)} today</span></span></div>`;
}

export function mkAbout() {
  openSheet('Arc Markets', `
    <p><b>Follow — and one day trade — the value of players the way you'd follow a stock.</b>
      Every notable player has a price that rises and falls as the season unfolds: big games,
      injuries, benchings, breakouts.</p>
    <p>Each contract tracks a player's <b>season scorecard number</b> — the sum of their official
      statistics, the same way fantasy football counts points. Buy at today's price; when the
      season ends the contract pays out on the player's real, official number, at
      ${POINTS_PER_DOLLAR} points per dollar.</p>
    <p>Nothing is decided by a bookmaker, an odds-setter, or the company — only by what the player
      actually does on the field, and what other fans were willing to pay along the way.</p>

    <h4>WHAT WOULD BE BUILT FIRST</h4>
    <p>A completely free app: this market as a game with play money and real prices, plus a trade
      calculator that values any proposed fantasy trade using live crowd prices. Real-money
      trading would come later, only through federally regulated exchange partners, and only if
      the free version proves itself against numbers set in advance.</p>

    <h4>WHAT'S GENUINELY HARD</h4>
    <p>The rules are still being fought over in court. Markets need enough traders before prices
      are fair. Bigger companies could copy it. And it has to be built responsibly — deposit
      limits, self-exclusion and real consumer protections from day one, around season-long
      opinions rather than rapid-fire action.</p>

    <div class="fine">Concept only — nothing is built. “Arc Markets” is a working title. This
      prototype is not an offer to sell securities, an invitation to invest, or a solicitation to
      participate in any trading, gaming or wagering product. No real-money product exists or is
      being offered. Any future real-money markets would be listed only on exchanges regulated by
      the U.S. Commodity Futures Trading Commission and operated by licensed partners, subject to
      all applicable law and eligibility requirements. Player names and all prices and figures
      shown here are illustrative.</div>`);
}

// ---------------------------------------------------------------- toast
let mkT;
export function mkToast(msg) {
  const el = document.getElementById('mkHint');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(mkT);
  mkT = setTimeout(() => el.classList.remove('show'), 1700);
}

export function initMarkets() { /* nothing to prerender; views build on open */ }
