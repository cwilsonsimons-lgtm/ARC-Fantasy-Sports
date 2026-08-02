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
export const ticket = { playerId: null, term: DEFAULT_TERM, action: 'buy',
                        type: 'market', qty: 1, limit: null };

export function openTicket(playerId, term) {
  ticket.playerId = playerId;
  ticket.term = term || DEFAULT_TERM;
  const side = playerSide(playerId);
  ticket.action = side === 'short' ? 'cover' : 'buy';
  ticket.type = 'market';
  ticket.qty = 1;
  ticket.limit = null;
  return ticketHTML();
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
  if (window.mkRefreshPlayer) window.mkRefreshPlayer(ticket.playerId);
  return res;
}
export function cancelWorking(id) {
  cancelOrder(id);
  if (window.mkToast) window.mkToast('Order cancelled');
  if (window.mkRefreshPlayer) window.mkRefreshPlayer(ticket.playerId);
}

// ---------------------------------------------------------------- ticket view
const ACTION_ORDER = ['buy', 'sell', 'short', 'cover'];

export function ticketHTML() {
  const p = BY_ID[ticket.playerId];
  if (!p) return '';
  const sym = symbolFor(ticket.playerId, ticket.term);
  const q = quoteStats(ticket.playerId, ticket.term);
  const pos = positionFor(sym);
  const side = playerSide(ticket.playerId);
  const acctSum = accountSummary();

  const terms = termsFor(ticket.playerId);
  const termRow = `<div class="tk-terms">${terms.map(t => `
    <div class="tk-term${t.key === ticket.term ? ' on' : ''}" onclick="mkTicketSet('term','${t.key}')">
      <b>${t.short}</b><span>${esc(t.label)}</span></div>`).join('')}
    ${!isTop100(ticket.playerId) ? `<div class="tk-term off" title="Top 100 only">
      <b>5Y</b><span>Top 100</span></div>` : ''}
  </div>`;

  // every action is validated up front, so a disabled button can say why
  const probe = a => validate({ action: a, sym, qty: Math.max(ticket.qty, MIN_QTY),
                               type: ticket.type, limit: ticket.limit });
  const actions = ACTION_ORDER.map(a => {
    const v = probe(a);
    const on = a === ticket.action;
    return `<div class="tk-act ${a}${on ? ' on' : ''}${v.ok ? '' : ' off'}"
      ${v.ok ? `onclick="mkTicketSet('action','${a}')"` : `onclick="mkToast('${esc(v.reason)}')"`}
      >${ACTIONS[a].label}</div>`;
  }).join('');

  const est = ticket.type === 'limit' && ticket.limit ? ticket.limit
            : (ACTIONS[ticket.action].side === 'buy' ? (q.ask || q.price) : (q.bid || q.price));
  const cost = (ticket.qty || 0) * (est || 0);
  const check = validate({ action: ticket.action, sym, qty: ticket.qty,
                           type: ticket.type, limit: ticket.limit });

  const posLine = pos ? `<div class="tk-pos ${pos.qty < 0 ? 'short' : 'long'}">
      ${pos.qty < 0 ? 'SHORT' : 'LONG'} ${Math.abs(pos.qty)} shares @ ${money(pos.avg)}</div>` : '';
  const hedgeNote = side ? `<div class="tk-note">You are <b>${side}</b> this player. Positions in the
      opposite direction are blocked across every contract length until this one is closed.</div>` : '';

  const working = workingOrders().filter(o => o.sym === sym);
  const workRows = working.length ? `<div class="tk-work">
    <div class="tk-work-h">WORKING ORDERS</div>
    ${working.map(o => `<div class="tk-work-r">
      <span>${ACTIONS[o.action].label} ${o.qty}${o.filled ? ` (${o.filled} filled)` : ''} @ ${money(o.limit)}</span>
      <span class="x" onclick="mkCancelOrder('${o.id}')">Cancel</span></div>`).join('')}
  </div>` : '';

  return `
    <div class="tk">
      <div class="tk-h">
        <span>TRADE</span>
        <span class="tk-cash">Cash ${money(acctSum.cash)}</span>
      </div>
      ${termRow}
      ${posLine}
      <div class="tk-acts">${actions}</div>
      <div class="tk-seg">
        <div class="sg${ticket.type === 'market' ? ' on' : ''}" onclick="mkTicketSet('type','market')">Market</div>
        <div class="sg${ticket.type === 'limit' ? ' on' : ''}" onclick="mkTicketSet('type','limit')">Limit</div>
      </div>
      <div class="tk-field">
        <label>Shares</label>
        <div class="tk-qty">
          <span class="b" onclick="mkBumpQty(-1)">−</span>
          <input type="number" step="0.001" min="0" inputmode="decimal" value="${ticket.qty}"
            onchange="mkTicketSet('qty',this.value)" oninput="mkTicketSet('qty',this.value)">
          <span class="b" onclick="mkBumpQty(1)">+</span>
        </div>
      </div>
      <div class="tk-chips">
        ${[0.25, 0.5, 1, 5, 10].map(n => `<span onclick="mkTicketSet('qty',${n})">${n}</span>`).join('')}
      </div>
      ${ticket.type === 'limit' ? `<div class="tk-field">
        <label>Limit price</label>
        <input class="tk-in" type="number" step="0.01" inputmode="decimal"
          value="${ticket.limit != null ? ticket.limit : (est || 0).toFixed(2)}"
          onchange="mkTicketSet('limit',this.value)">
      </div>` : ''}
      <div class="tk-sum">
        <span>${ticket.type === 'limit' ? 'Limit' : 'Est. price'}</span><b>${money(est || 0)}</b>
        <span>${ACTIONS[ticket.action].side === 'buy' ? 'Est. cost' : 'Est. proceeds'}</span><b>${money(cost)}</b>
      </div>
      <div class="tk-go ${check.ok ? '' : 'off'}"
        onclick="${check.ok ? 'mkSubmitTicket()' : `mkToast('${esc(check.reason)}')`}">
        ${ACTIONS[ticket.action].label} ${ticket.qty || 0} ${ticket.qty === 1 ? 'share' : 'shares'}
      </div>
      ${check.ok ? '' : `<div class="tk-err">${esc(check.reason)}</div>`}
      ${hedgeNote}
      ${workRows}
    </div>`;
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
