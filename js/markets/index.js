// Arc Markets — section shell: open/close, bottom nav, sheets, toasts.
//
// This is the only file that touches the fantasy app, and only at the seam:
// opening the section adds a class to <body>, closing it removes it. Markets
// never reads league state, and the fantasy app never reads market state.
//
// The app's own bottom nav stays visible throughout; Markets has no nav of its
// own, and reaches the portfolio from a button in the header instead.
import { BY_ID, toggleWatch, isWatched, POINTS_PER_DOLLAR } from './data.js';
import { ICON, face, esc, money, pctText, dirClass, tri } from './ui.js';
import { playerCharts } from './charts.js';
import { priceChart } from './pricechart.js';
import { renderMarket } from './market.js';
import { renderPortfolio } from './portfolio.js';
import { bumpQty, cancelWorking, marketInfoHTML, openTicket, setTicket, submitTicket,
         ticket, ticketHTML } from './trade.js';
import { setEngine } from './engine.js';
import { quoteStats } from './quotes.js';
import { DEFAULT_TERM, TERM_BY_KEY, termsFor } from './contracts.js';
import { positionFor, positionRows } from './ledger.js';
import { symbolFor } from './contracts.js';
import { MARKET, WEEKS_PLAYED, bindQuoteSource, priceDays, syncMarket } from './data.js';
import { listMarket, onFlow, startFlow } from './flow.js';
import { seedHistory as seedEventHistory } from './events.js';
import { hasHistory, recordAll, seedHistory as seedSeries } from './quotes.js';
import { startProjectionFeed } from './projections.js';

let view = 'market';
let pxRange = '1d';       // survives across sheet opens, like a stock app's
let openId = null;        // the contract sheet currently on screen

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
  openId = id;
  openTicket(id, ticket.playerId === id ? ticket.term : DEFAULT_TERM);
  openSheet(esc(p.name), playerSheetHTML(p));
}

/** Repaint the open contract sheet in place — used after a fill and on flow. */
export function mkRefreshPlayer(id) {
  if (!openId || (id && id !== openId)) return;
  const p = BY_ID[openId];
  if (!p) return;
  const body = document.getElementById('mkSheetBody');
  if (body) body.innerHTML = playerSheetHTML(p);
}

function playerSheetHTML(p) {
  const term = ticket.term || DEFAULT_TERM;
  const q = quoteStats(p.id, term);
  const d = dirClass(q.dayPct);
  const t = TERM_BY_KEY[term] || TERM_BY_KEY[DEFAULT_TERM];
  const pos = positionFor(symbolFor(p.id, term));

  return `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
      ${face(p)}
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;color:var(--mk-ink-3);font-weight:700">
          ${esc(p.tm)} &middot; ${esc(p.posRank)} &middot; ${esc(t.short)}</div>
        <div style="font-size:24px;font-weight:800;margin-top:3px">${money(q.price)}</div>
        <div class="${d}" style="font-size:12.5px;font-weight:700;margin-top:2px">
          ${tri(q.dayPct)} ${money(q.dayChange)} (${pctText(Math.abs(q.dayPct))}) today</div>
      </div>
      <div class="mk-live"><span class="dot"></span>24/7</div>
    </div>

    ${pos ? `<div class="mk-settle" style="margin-bottom:8px">${ICON.bag}<span>You are
      <b>${pos.qty < 0 ? 'short' : 'long'} ${Math.abs(pos.qty)} shares</b> at an average of
      <b>${money(pos.avg)}</b>.</span></div>` : ''}

    <div id="mkCharts">${playerCharts(p, pxRange, term)}</div>

    <h4>MARKET</h4>
    ${marketInfoHTML(p.id, term)}

    <div id="mkTicket">${ticketHTML()}</div>

    <div class="mk-settle">${ICON.info}<span>${esc(t.desc)} Settles at
      <b>${POINTS_PER_DOLLAR} points per $1</b>, immediately on expiry or if the player retires.
      NFL trades, releases and signings do not affect the contract.</span></div>

    <div style="display:flex;gap:9px;margin-top:14px">
      <div class="mk-pill${isWatched(p.id) ? ' on' : ''}" style="flex:1;justify-content:center"
        onclick="mkToggleWatch('${p.id}');mkRefreshPlayer('${p.id}')">${ICON.star} Watch</div>
      <div class="mk-pill" style="flex:1;justify-content:center;background:var(--mk-blue);
        border-color:var(--mk-blue);color:#fff" onclick="mkAbout()">${ICON.info} How this works</div>
    </div>`;
}

/** Range buttons on the price chart: swap that one chart, leave the sheet alone. */
export function mkRange(id, key) {
  const p = BY_ID[id];
  if (!p) return;
  pxRange = key;
  const host = document.querySelector('#mkCharts [data-mkc="price"]');
  if (host) host.outerHTML = priceChart(p, key, ticket.term); else mkOpenPlayer(id);
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

// ---------------------------------------------------------------- ticket glue
// The markup drives everything through inline handlers, so the ticket's
// setters are re-exported here under the mk* names the rest of the section uses.
export function mkTicketSet(field, value) { setTicket(field, value); }
export function mkBumpQty(d) { bumpQty(d); }
export function mkSubmitTicket() { submitTicket(); }
export function mkCancelOrder(id) { cancelWorking(id); }
/** Swap market structure at runtime — the app cannot tell the difference. */
export function mkSetEngine(kind) {
  setEngine(kind);
  mkToast(kind === 'amm' ? 'Automated market maker' : 'Order book');
  if (openId) mkRefreshPlayer(openId); else renderMarket();
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

// ---------------------------------------------------------------- boot
// Order matters: list the contracts (which trades them into an opening price),
// backfill the event history and the pre-session price path, start the
// projection feed, then start the participant clock. From here on, every price
// on screen is the last print of a trade.
export function initMarkets() {
  listMarket();
  seedEventHistory(WEEKS_PLAYED);
  bootstrapSeries();
  bindQuoteSource(id => quoteStats(id, DEFAULT_TERM));
  startProjectionFeed({ intervalMs: 60000 });

  onFlow(() => {
    recordAll();
    syncMarket();
    if (!document.body.classList.contains('markets')) return;
    if (document.body.classList.contains('mk-sheet-open')) mkRefreshPlayer(openId);
    else if (view === 'market') renderMarket();
    else renderPortfolio();
  });
  startFlow(3000);
}

/**
 * Give every contract a price history from before this session opened: one
 * point per day across the season, then intraday detail through the last 24
 * hours so the 1D range has a real shape the moment the app opens rather than
 * a flat line waiting for live prints to accumulate.
 */
function bootstrapSeries() {
  const DAY = 86400000, SLOT = 15 * 60000, INTRA = DAY / SLOT;
  MARKET.forEach(p => {
    const days = priceDays(p);
    termsFor(p.id).forEach(t => {
      const sym = symbolFor(p.id, t.key);
      if (hasHistory(sym)) return;
      const q = quoteStats(p.id, t.key);
      const scale = days.length ? q.price / (days[days.length - 1].v || 1) : 1;
      const now = Date.now();
      const t0 = now - days.length * DAY;
      const pts = days.slice(0, -1).map((d, i) => ({ t: t0 + i * DAY, v: round2px(d.v * scale) }));
      // walk the final day from yesterday's close to the current price
      const openPx = pts.length ? pts[pts.length - 1].v : q.price;
      let v = openPx;
      const drift = (q.price - openPx) / INTRA;
      for (let i = 1; i <= INTRA; i++) {
        v += drift + (Math.sin((i + sym.length) * 1.7) + Math.sin(i * 0.31)) * openPx * 0.0016;
        pts.push({ t: now - DAY + i * SLOT, v: round2px(v) });
      }
      pts[pts.length - 1] = { t: now, v: q.price };
      seedSeries(sym, pts);
    });
  });
  recordAll();
  syncMarket();
}
function round2px(v) { return Math.round(v * 100) / 100; }
