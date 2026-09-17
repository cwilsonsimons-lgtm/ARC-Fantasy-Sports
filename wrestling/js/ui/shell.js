// Navigation shell: hash routing, tabs, action dispatch and toasts.
//
// Screens are pure render functions - they take the route params, read the
// store, and return HTML. They never hold entity objects between renders, which
// is the UI half of the one-wrestler rule: every screen re-reads from the store,
// so a stale copy cannot exist for long enough to diverge.
//
// Interaction goes through `data-action` attributes and one delegated listener,
// rather than the inline-onclick globals used by the fantasy app next door.

import { esc } from './format.js';

const screens = new Map();   // name -> {label, render(params), inNav}
const actions = new Map();   // name -> fn(params, element)

export function registerScreen(name, screen) { screens.set(name, screen); }
export function registerActions(map) {
  for (const [name, fn] of Object.entries(map)) actions.set(name, fn);
}

export function parseRoute(hash = location.hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { name: parts[0] || 'roster', args: parts.slice(1) };
}

export function go(path) {
  const next = `#/${String(path).replace(/^#?\/?/, '')}`;
  if (location.hash === next) render();
  else location.hash = next;
}

export function render() {
  const { name, args } = parseRoute();
  const screen = screens.get(name);
  const host = document.getElementById('screen');
  if (!screen) {
    host.innerHTML = `<h1>Not found</h1><p class="sub">No screen called "${esc(name)}".</p>`;
    return;
  }
  try {
    host.innerHTML = screen.render(args);
  } catch (err) {
    host.innerHTML = `<h1>Screen error</h1><p class="sub">${esc(err.message)}</p>`;
    console.error(err);
  }
  renderTabs(name);
  host.scrollTop = 0;
}

function renderTabs(active) {
  const el = document.getElementById('tabs');
  el.innerHTML = [...screens.entries()]
    .filter(([, s]) => s.inNav !== false)
    .map(([name, s]) =>
      `<button class="tab${name === active ? ' on' : ''}" data-action="go" data-arg="${name}">${esc(s.label)}</button>`
    ).join('');
}

/* Small inline icons for the status chips. Drawn here rather than loaded,
   because the page has to work with no network at all. */
const ICONS = {
  roster: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  morale: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>',
  belt: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="6"/><path d="M8.2 13.9 7 22l5-3 5 3-1.2-8.1"/></svg>',
  ear: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8.5a6.5 6.5 0 1 1 13 0c0 6-6 6-6 10a3.5 3.5 0 0 1-7 0"/><path d="M9.5 8.5a2.5 2.5 0 1 1 5 0c0 2.5-2.5 2.5-2.5 5"/></svg>',
  cal: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
};

function chip({ icon, tone = '', value, caption, badge }) {
  return `<div class="chip">
    <span class="ico ${tone}">${ICONS[icon] || ''}</span>
    <span><span class="val">${escapeText(value)}</span><span class="cap">${escapeText(caption)}</span></span>
    ${badge ? `<span class="badge">${escapeText(badge)}</span>` : ''}
  </div>`;
}

function escapeText(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * Refresh the persistent header.
 *
 * The chips show things the game actually tracks. There is no budget or
 * attendance system, so there are no budget or attendance chips: a number with
 * nothing behind it would be worse than an empty corner.
 */
export function renderHeader(state) {
  const brand = document.getElementById('brandName');
  const gm = document.getElementById('gmName');
  const chips = document.getElementById('chips');
  if (!state) {
    brand.textContent = 'Wrestling GM';
    gm.textContent = 'no game loaded';
    chips.innerHTML = '';
    return;
  }
  brand.textContent = state.meta.brandName;
  gm.textContent = `${state.meta.gmName} · ${state.meta.mode}`;
  chips.innerHTML = chipProvider(state);
}

let chipProvider = () => '';
export function setChipProvider(fn) { chipProvider = fn; }
export { chip };

let whenFormatter = () => '';
export function setWhenFormatter(fn) { whenFormatter = fn; }

let toastTimer;
export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/** One delegated listener for the whole app. */
export function bindEvents() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = actions.get(el.dataset.action);
    if (!fn) return;
    e.preventDefault();
    fn(el.dataset, el);
  });
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-action]');
    if (!form) return;
    e.preventDefault();
    const fn = actions.get(form.dataset.action);
    if (fn) fn(form.dataset, form);
  });
  // Typing re-renders, so put the caret back where it was afterwards.
  document.addEventListener('input', (e) => {
    const el = e.target.closest('input[data-action]');
    if (!el) return;
    const fn = actions.get(el.dataset.action);
    if (!fn) return;
    const { id, selectionStart } = el;
    fn({ ...el.dataset, value: el.value }, el);
    const next = id && document.getElementById(id);
    if (next) {
      next.focus();
      try { next.setSelectionRange(selectionStart, selectionStart); } catch { /* not a text input */ }
    }
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.tagName === 'FORM') return;
    const fn = actions.get(el.dataset.action);
    if (fn) fn({ ...el.dataset, value: el.value }, el);
  });
  window.addEventListener('hashchange', render);
}

// The two navigation actions every screen can use.
registerActions({
  go: ({ arg }) => go(arg),
});
