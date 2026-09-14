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

/** Refresh the persistent header. Called after anything that moves the world. */
export function renderHeader(state) {
  const brand = document.getElementById('brandName');
  const gm = document.getElementById('gmName');
  const when = document.getElementById('when');
  if (!state) {
    brand.textContent = 'Wrestling GM';
    gm.textContent = 'no game loaded';
    when.textContent = '';
    return;
  }
  brand.textContent = state.meta.brandName;
  gm.textContent = `${state.meta.gmName} - ${state.meta.mode}`;
  when.textContent = headerWhen(state);
}

let whenFormatter = () => '';
export function setWhenFormatter(fn) { whenFormatter = fn; }
function headerWhen(state) { return whenFormatter(state); }

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
