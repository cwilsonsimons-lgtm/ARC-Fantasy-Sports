// Arc Markets — the order ticket.
//
// Two actions, BUY and SELL. There is no Short button and no Cover button: a
// sell that runs past zero is short, a buy that runs past zero is covered, and
// the ticket says so in the only number that matters — what the position is
// now, and what it becomes if this fills.
//
// Order entry is not ambient. It lives behind the docked TRADE bar, in this
// modal, and nowhere else on the player sheet.
import { BY_ID } from './data.js';
import { execute, positionFor, projectFill } from './orders.js';
import { ICON, esc, money, qtyClass, qtyText } from './ui.js';

let T = null;   // {pid, side, qty, type, limit, stage}

export function mkTicket(pid) {
  const p = BY_ID[pid];
  if (!p) return;
  T = { pid, side: 'buy', qty: 1, type: 'market', limit: p.price, stage: 'entry' };
  paint();
  document.body.classList.add('mk-ticket-open');
}
export function mkCloseTicket() {
  document.body.classList.remove('mk-ticket-open');
  T = null;
}

export function mkTicketSide(s) { if (T) { T.side = s; paint(); } }
export function mkTicketQty(d) {
  if (!T) return;
  T.qty = Math.max(1, Math.min(9999, T.qty + d));
  paint();
}
export function mkTicketQtySet(v) {
  if (!T) return;
  T.qty = Math.max(1, Math.min(9999, Math.round(+v || 1)));
  paint();
}
export function mkTicketType(v) {
  if (!T) return;
  T.type = v;
  if (v === 'limit' && !T.limit) T.limit = BY_ID[T.pid].price;
  paint();
}
export function mkTicketLimit(v) {
  if (!T) return;
  T.limit = Math.max(0.01, Math.round((+v || 0) * 100) / 100);
}
export function mkTicketReview() { if (T) { T.stage = 'review'; paint(); } }
export function mkTicketBack() { if (T) { T.stage = 'entry'; paint(); } }

export function mkTicketConfirm() {
  if (!T) return;
  const p = BY_ID[T.pid];
  const price = T.type === 'limit' ? T.limit : p.price;
  execute(T.pid, T.side, T.qty, price);
  const pid = T.pid;
  mkCloseTicket();
  // The portfolio and the badge on the player sheet both read from the order
  // book, so repainting them is the whole of "updates immediately".
  window.mkRepaintPositions && window.mkRepaintPositions(pid);
}

function fillPrice() {
  const p = BY_ID[T.pid];
  return T.type === 'limit' ? (T.limit || p.price) : p.price;
}

/** Current position at the top, position after fill at the bottom. */
function paint() {
  const el = document.getElementById('mkTicketBody');
  if (!el || !T) return;
  const p = BY_ID[T.pid];
  const cur = positionFor(T.pid);
  const after = projectFill(T.pid, T.side, T.qty);
  const px = fillPrice();
  const cost = Math.round(T.qty * px * 100) / 100;
  const crosses = cur.qty !== 0 && Math.sign(after) !== 0 && Math.sign(after) !== Math.sign(cur.qty);

  const head = `<div class="tk-hd">
      <div class="tk-nm">${esc(p.name)}</div>
      <div class="tk-x" onclick="mkCloseTicket()">${ICON.chevron}</div>
    </div>
    <div class="tk-pos">
      <span class="k">POSITION</span>
      <span class="v ${qtyClass(cur.qty)}">${qtyText(cur.qty)}</span>
    </div>`;

  const foot = `<div class="tk-after${crosses ? ' cross' : ''}">
      <span class="k">AFTER FILL</span>
      <span class="v ${qtyClass(after)}">${qtyText(after)}</span>
    </div>`;

  if (T.stage === 'review') {
    el.innerHTML = `${head}
      <div class="tk-review">
        <div class="tk-r"><span>Action</span><b class="${T.side === 'buy' ? 'up' : 'down'}">${T.side.toUpperCase()}</b></div>
        <div class="tk-r"><span>Quantity</span><b>${T.qty.toLocaleString()}</b></div>
        <div class="tk-r"><span>Type</span><b>${T.type === 'limit' ? 'Limit' : 'Market'}</b></div>
        <div class="tk-r"><span>${T.type === 'limit' ? 'Limit price' : 'Mark'}</span><b>${money(px)}</b></div>
        <div class="tk-r tot"><span>Estimated ${T.side === 'buy' ? 'cost' : 'proceeds'}</span><b>${money(cost)}</b></div>
      </div>
      ${foot}
      <div class="tk-acts">
        <div class="tk-btn ghost" onclick="mkTicketBack()">Back</div>
        <div class="tk-btn go ${T.side}" onclick="mkTicketConfirm()">Confirm ${T.side}</div>
      </div>`;
    return;
  }

  el.innerHTML = `${head}
    <div class="tk-side">
      <div class="sd buy${T.side === 'buy' ? ' on' : ''}" onclick="mkTicketSide('buy')">Buy</div>
      <div class="sd sell${T.side === 'sell' ? ' on' : ''}" onclick="mkTicketSide('sell')">Sell</div>
    </div>

    <div class="tk-row">
      <span class="k">Quantity</span>
      <div class="tk-step">
        <div class="s" onclick="mkTicketQty(-1)">−</div>
        <input id="tkQty" type="number" inputmode="numeric" min="1" value="${T.qty}"
          onchange="mkTicketQtySet(this.value)">
        <div class="s" onclick="mkTicketQty(1)">+</div>
      </div>
    </div>

    <div class="tk-row">
      <span class="k">Order type</span>
      <select class="tk-sel" onchange="mkTicketType(this.value)">
        <option value="market"${T.type === 'market' ? ' selected' : ''}>Market</option>
        <option value="limit"${T.type === 'limit' ? ' selected' : ''}>Limit</option>
      </select>
    </div>

    ${T.type === 'limit' ? `<div class="tk-row">
      <span class="k">Limit price</span>
      <input class="tk-sel" id="tkLimit" type="number" step="0.01" min="0.01"
        value="${(T.limit || p.price).toFixed(2)}" onchange="mkTicketLimit(this.value);mkTicketRepaint()">
    </div>` : ''}

    <div class="tk-row tot">
      <span class="k">Estimated ${T.side === 'buy' ? 'cost' : 'proceeds'}</span>
      <b>${money(cost)}</b>
    </div>

    ${foot}
    <div class="tk-acts">
      <div class="tk-btn go ${T.side}" onclick="mkTicketReview()">Review</div>
    </div>`;
}
export function mkTicketRepaint() { paint(); }
