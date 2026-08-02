// Arc Markets — the trade ticket and the market-information panel.
//
// The ticket is the only place a user creates an order, and every path through
// it goes to ledger.placeOrder(), which is where the no-hedge rule is enforced.
// The UI mirrors that rule rather than reimplementing it: actions the account
// cannot take are disabled with the same reason validate() would give.
import { ICON, esc, money, signed } from './ui.js';
import { BY_ID } from './data.js';
import { DEFAULT_TERM, TERM_BY_KEY, intrinsic, isTop100, symbolFor, termsFor,
         top100Rank, top100Season, POINTS_PER_DOLLAR } from './contracts.js';
import { ACTIONS, cancelOrder, placeOrder, playerSide, positionFor, validate,
         workingOrders, accountSummary } from './ledger.js';
import { quoteStats } from './quotes.js';
import { projectionFor, providerLabel } from './projections.js';
import { gameStatusFor, injuryFor, opponentFor, seasonPointsFor } from './status.js';
import { MIN_QTY } from './engine.js';

// ---------------------------------------------------------------- ticket state
// `open` is what keeps the player page clean: the order pad only exists while
// the user is actually placing a trade. Everything else on the page is
// read-only, and the single Buy button is the way in.
export const ticket = { playerId: null, term: DEFAULT_TERM, action: 'buy',
                        type: 'market', qty: 1, limit: null, open: false, review: false };

/** Prepare the ticket for a player without opening it. */
export function openTicket(playerId, term) {
  ticket.playerId = playerId;
  ticket.term = term || DEFAULT_TERM;
  ticket.action = playerSide(playerId) === 'short' ? 'cover' : 'buy';
  ticket.type = 'market';
  ticket.qty = 1;
  ticket.limit = null;
  ticket.open = false;
  ticket.review = false;
  return '';
}
/** Reveal the order pad. `intent` is 'buy' or 'sell' from the page buttons. */
export function beginTrade(playerId, intent, term) {
  const side = playerSide(playerId);
  if (ticket.playerId !== playerId) openTicket(playerId, term);
  if (term) ticket.term = term;
  ticket.action = intent === 'sell'
    ? (side === 'short' ? 'cover' : 'sell')
    : (side === 'short' ? 'cover' : 'buy');
  ticket.open = true;
  ticket.review = false;
  ticket.qty = 1;
  if (window.mkRefreshPlayer) window.mkRefreshPlayer(playerId);
}
export function closeTrade() {
  ticket.open = false;
  ticket.review = false;
  if (window.mkRefreshPlayer) window.mkRefreshPlayer(ticket.playerId);
}
export function toggleReview(on) {
  ticket.review = !!on;
  repaintTicket();
}
export function setTicket(field, value) {
  if (field === 'qty') ticket.qty = Math.max(0, parseFloat(value) || 0);
  else if (field === 'limit') ticket.limit = parseFloat(value) || null;
  else ticket[field] = value;
  if (field === 'term') ticket.action = playerSide(ticket.playerId) === 'short' ? 'cover' : 'buy';
  repaintTicket();
}
export function bumpQty(delta) {
  ticket.qty = Math.max(0, Math.round((ticket.qty + delta) * 1000) / 1000);
  repaintTicket();
}
function repaintTicket() {
  const host = document.getElementById('mkTicket');
  if (host) host.innerHTML = ticketHTML();
}

// ---------------------------------------------------------------- submit
export function submitTicket() {
  const sym = symbolFor(ticket.playerId, ticket.term);
  const res = placeOrder({ action: ticket.action, sym, qty: ticket.qty,
                           type: ticket.type, limit: ticket.limit });
  const toast = window.mkToast || (() => {});
  if (!res.ok) { toast(res.reason); repaintTicket(); return res; }
  const o = res.order;
  const a = ACTIONS[o.action];
  toast(o.status === 'resting'
    ? `${a.label} order resting at ${money(o.limit)}`
    : `${a.label} ${o.filled} @ ${money(o.avg)}`);
  ticket.qty = 1;
  ticket.open = false;      // order placed — put the page back to its clean state
  ticket.review = false;
  if (window.mkRefreshPlayer) window.mkRefreshPlayer(ticket.playerId);
  return res;
}
export function cancelWorking(id) {
  cancelOrder(id);
  if (window.mkToast) window.mkToast('Order cancelled');
  if (window.mkRefreshPlayer) window.mkRefreshPlayer(ticket.playerId);
}

// ---------------------------------------------------------------- order pad
// Shown only while ticket.open is true. The action set is scoped to what the
// user came here to do: the Buy pad offers Buy (or Short, if they hold
// nothing); the Sell pad offers Sell or Cover depending on which side they are
// on. Actions that would break the no-hedge rule are never offered at all.
function padActions() {
  const side = playerSide(ticket.playerId);
  if (ticket.action === 'sell' || ticket.action === 'cover') {
    return side === 'short' ? ['cover'] : ['sell'];
  }
  return side === 'long' ? ['buy'] : side === 'short' ? ['cover'] : ['buy', 'short'];
}

export function ticketHTML() {
  if (!ticket.open) return '';
  const p = BY_ID[ticket.playerId];
  if (!p) return '';
  const sym = symbolFor(ticket.playerId, ticket.term);
  const q = quoteStats(ticket.playerId, ticket.term);
  const pos = positionFor(sym);
  const a = ACTIONS[ticket.action];
  const acctSum = accountSummary();
  const buying = a.side === 'buy';

  const est = ticket.type === 'limit' && ticket.limit ? ticket.limit
            : (buying ? (q.ask || q.price) : (q.bid || q.price));
  const cost = (ticket.qty || 0) * (est || 0);
  const check = validate({ action: ticket.action, sym, qty: ticket.qty,
                           type: ticket.type, limit: ticket.limit });

  const acts = padActions();
  const actionRow = acts.length > 1 ? `<div class="tk-acts">${acts.map(k =>
    `<div class="tk-act ${k}${k === ticket.action ? ' on' : ''}"
      onclick="mkTicketSet('action','${k}')">${ACTIONS[k].label}</div>`).join('')}</div>` : '';

  const terms = termsFor(ticket.playerId);
  const termRow = `<div class="tk-terms">${terms.map(t => `
    <div class="tk-term${t.key === ticket.term ? ' on' : ''}" onclick="mkTicketSet('term','${t.key}')">
      <b>${t.short}</b><span>${esc(t.label)}</span></div>`).join('')}
    ${!isTop100(ticket.playerId) ? `<div class="tk-term off" title="Five-year contracts are Top 100 only">
      <b>5Y</b><span>Top 100</span></div>` : ''}
  </div>`;

  // review step: confirm the order before it goes in
  if (ticket.review) {
    return `<div class="tk">
      <div class="tk-h"><span>REVIEW ORDER</span>
        <span class="tk-x" onclick="mkReview(0)">Edit</span></div>
      <div class="tk-rev">
        <div><span>Action</span><b>${a.label}</b></div>
        <div><span>Contract</span><b>${esc(p.name)} · ${esc((TERM_BY_KEY[ticket.term] || {}).short || '')}</b></div>
        <div><span>Order type</span><b>${ticket.type === 'limit' ? 'Limit' : 'Market'}</b></div>
        <div><span>Quantity</span><b>${ticket.qty} ${ticket.qty === 1 ? 'share' : 'shares'}</b></div>
        <div><span>${ticket.type === 'limit' ? 'Limit price' : 'Est. price'}</span><b>${money(est || 0)}</b></div>
        <div class="tot"><span>${buying ? 'Estimated cost' : 'Estimated proceeds'}</span><b>${money(cost)}</b></div>
      </div>
      <div class="tk-go ${check.ok ? '' : 'off'}"
        onclick="${check.ok ? 'mkSubmitTicket()' : `mkToast('${esc(check.reason)}')`}">
        Place ${a.label.toLowerCase()} order</div>
      ${check.ok ? '' : `<div class="tk-err">${esc(check.reason)}</div>`}
      <div class="tk-cancel" onclick="mkCloseTrade()">Cancel</div>
    </div>`;
  }

  return `
    <div class="tk">
      <div class="tk-h">
        <span>${a.label.toUpperCase()} ${esc(p.short || p.name)}</span>
        <span class="tk-x" onclick="mkCloseTrade()">&#10005;</span>
      </div>
      ${termRow}
      ${pos ? `<div class="tk-pos ${pos.qty < 0 ? 'short' : 'long'}">
        ${pos.qty < 0 ? 'SHORT' : 'LONG'} ${Math.abs(pos.qty)} shares @ ${money(pos.avg)}</div>` : ''}
      ${actionRow}
      <div class="tk-seg">
        <div class="sg${ticket.type === 'market' ? ' on' : ''}" onclick="mkTicketSet('type','market')">
          Market ${buying ? 'buy' : a.label.toLowerCase()}</div>
        <div class="sg${ticket.type === 'limit' ? ' on' : ''}" onclick="mkTicketSet('type','limit')">
          Limit ${buying ? 'buy' : a.label.toLowerCase()}</div>
      </div>
      <div class="tk-field">
        <label>Quantity <em>fractional shares welcome</em></label>
        <div class="tk-qty">
          <span class="b" onclick="mkBumpQty(-1)">&minus;</span>
          <input type="number" step="0.001" min="0" inputmode="decimal" value="${ticket.qty}"
            onchange="mkTicketSet('qty',this.value)">
          <span class="b" onclick="mkBumpQty(1)">+</span>
        </div>
      </div>
      <div class="tk-chips">
        ${(buying ? [0.25, 0.5, 1, 5, 10] : sellChips(pos)).map(n =>
          `<span onclick="mkTicketSet('qty',${n})">${n}</span>`).join('')}
        ${!buying && pos ? `<span onclick="mkTicketSet('qty',${Math.abs(pos.qty)})">All</span>` : ''}
      </div>
      ${ticket.type === 'limit' ? `<div class="tk-field">
        <label>Limit price</label>
        <input class="tk-in" type="number" step="0.01" inputmode="decimal"
          value="${ticket.limit != null ? ticket.limit : (est || 0).toFixed(2)}"
          onchange="mkTicketSet('limit',this.value)">
      </div>` : ''}
      <div class="tk-sum">
        <span>${ticket.type === 'limit' ? 'Limit price' : 'Est. price'}</span><b>${money(est || 0)}</b>
        <span>${buying ? 'Estimated cost' : 'Estimated proceeds'}</span><b>${money(cost)}</b>
        <span>${buying ? 'Buying power' : 'Cash after'}</span><b>${money(buying ? acctSum.buyingPower : acctSum.cash + cost)}</b>
      </div>
      <div class="tk-go ${check.ok ? '' : 'off'}"
        onclick="${check.ok ? 'mkReview(1)' : `mkToast('${esc(check.reason)}')`}">Review order</div>
      ${check.ok ? '' : `<div class="tk-err">${esc(check.reason)}</div>`}
    </div>`;
}
function sellChips(pos) {
  const held = pos ? Math.abs(pos.qty) : 1;
  return [0.25, 0.5, 1, Math.round(held * 0.5 * 1000) / 1000].filter((n, i, a) =>
    n > 0 && n <= held && a.indexOf(n) === i);
}

// ---------------------------------------------------------------- info panel
export function marketInfoHTML(playerId, term) {
  const p = BY_ID[playerId];
  if (!p) return '';
  const q = quoteStats(playerId, term);
  const t = TERM_BY_KEY[term] || TERM_BY_KEY[DEFAULT_TERM];
  const iv = intrinsic({ ...p, sproj: projectionFor(playerId) }, t.key);
  const inj = injuryFor(playerId);
  const pts = seasonPointsFor(playerId);
  const cell = (lb, val, cls) => `<div class="mi-c"><span>${lb}</span><b class="${cls || ''}">${val}</b></div>`;
  const pc = n => `<span class="${n < 0 ? 'down' : 'up'}">${n < 0 ? '' : '+'}${n.toFixed(2)}%</span>`;

  return `
    <div class="mi">
      <div class="mi-grid">
        ${cell('Price', money(q.price))}
        ${cell('Last', money(q.last))}
        ${cell('Bid', q.bid != null ? money(q.bid) : '—')}
        ${cell('Ask', q.ask != null ? money(q.ask) : '—')}
        ${cell('Day', pc(q.dayPct))}
        ${cell('Week', pc(q.weekPct))}
        ${cell('Month', pc(q.monthPct))}
        ${cell('Volume', q.volume.toLocaleString())}
        ${cell('Trades', q.trades.toLocaleString())}
      </div>
      <div class="mi-ratio">
        <div class="mi-ratio-h"><span>BUY / SELL</span>
          <b>${Math.round(q.buyRatio * 100)}% buy</b></div>
        <div class="mi-bar"><i style="width:${Math.round(q.buyRatio * 100)}%"></i></div>
      </div>
      <div class="mi-grid">
        ${cell('Projection', projectionFor(playerId).toFixed(1))}
        ${cell('Points', pts.toFixed(1))}
        ${cell('Position', esc(p.posRank))}
        ${cell('Team', esc(p.tm))}
        ${cell('Injury', inj.label, inj.cls)}
        ${cell('Opponent', esc(opponentFor(playerId)))}
        ${cell('Game', esc(gameStatusFor(playerId)))}
        ${cell('Intrinsic', money(iv.value))}
        ${cell('Top 100', isTop100(playerId) ? '#' + top100Rank(playerId) : '—')}
      </div>
      <div class="mi-src">${ICON.info}<span>Projection from <b>${esc(providerLabel())}</b> ·
        intrinsic value is ${iv.points.toFixed(0)} pts ÷ ${POINTS_PER_DOLLAR}.
        Informational only — price is set by trading, on the
        <b>${q.engine === 'amm' ? 'automated market maker' : 'order book'}</b>.</span></div>
    </div>`;
}
