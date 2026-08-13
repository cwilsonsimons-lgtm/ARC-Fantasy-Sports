// Tiny DOM helpers for the Universe dashboard.
//
// Views render to HTML strings and get written into a pane; interaction is
// delegated from the document, so nothing has to be re-bound after a redraw.
// That keeps the whole UI a pure function of the projection: change the store,
// call render(), done.

export const h = s => String(s == null ? '' : s)
  .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Delegated listener: on('click', '[data-w]', (e, el) => ...)
export const on = (type, sel, fn) => document.addEventListener(type, e => {
  const el = e.target.closest(sel);
  if (el) fn(e, el);
});

export const today = () => new Date().toISOString().slice(0, 10);

// "2026-08-17" -> "Mon 17 Aug 2026"
export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// A table from rows + column specs, matching the shape used by the CLI so the
// two stay recognisably the same product.
export function table(rows, cols, emptyText = 'Nothing here yet.') {
  if (!rows.length) return `<div class="empty">${h(emptyText)}</div>`;
  const head = cols.map(c => `<th${c.num ? ' class="num"' : ''}>${h(c.label)}</th>`).join('');
  const body = rows.map(r => {
    const tds = cols.map(c => {
      const raw = c.get(r);
      const cls = [c.num ? 'num' : '', c.dim ? 'dim' : ''].filter(Boolean).join(' ');
      return `<td${cls ? ` class="${cls}"` : ''}>${c.html ? raw : h(raw)}</td>`;
    }).join('');
    return `<tr${r._cls ? ` class="${r._cls}"` : ''}>${tds}</tr>`;
  }).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export const chip = (text, kind = 'brand') => `<span class="chip ${kind}">${h(text)}</span>`;

// A wrestler's name, clickable through to their sheet.
export const wlink = w => `<span class="wname" data-w="${h(w.id)}">${h(w.name)}</span>`;
