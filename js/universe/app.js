// WWE Universe — the live universe, and the plumbing every screen shares:
// commit (change + save + repaint), the bottom sheet, the confirm box, toasts.
//
// Every change goes through commit(). It snapshots the universe first, so if
// the model throws halfway the universe is put back exactly as it was - the
// owner sees the reason in a toast, and nothing half-done is ever saved.
import { UniverseError, createUniverse } from './model.js';
import { loadUniverse, saveUniverse } from './persist.js';

let U = null;
let loaded = { status: 'new', problems: [], backupKey: null, readOnly: false };
let saveFailed = false;
let painter = () => {};

export const uni = () => U;
export const loadState = () => loaded;
export const lastSaveFailed = () => saveFailed;

function storage() {
  try { return window.localStorage || null; } catch (e) { return null; }
}

export function bootUniverse(paint) {
  painter = paint;
  const s = storage();
  loaded = s ? loadUniverse(s)
    : { state: createUniverse(), status: 'unavailable', problems: [], backupKey: null, readOnly: false };
  U = loaded.state;
}

function persist() {
  if (loaded.readOnly) { saveFailed = true; return false; }
  const s = storage();
  saveFailed = !(s && saveUniverse(s, U));
  return !saveFailed;
}

/**
 * Run `fn(universe)`. On success: save, repaint, and toast `okMsg` (a string,
 * or a function of fn's return value). On a UniverseError: restore, repaint,
 * and toast the reason. Returns { ok, value }.
 */
export function commit(fn, okMsg) {
  const before = JSON.stringify(U);
  let value;
  try {
    value = fn(U);
  } catch (e) {
    U = JSON.parse(before);
    if (!(e instanceof UniverseError)) throw e;
    refresh();
    toast(e.message, true);
    return { ok: false, error: e.message };
  }
  const saved = persist();
  refresh();
  const msg = typeof okMsg === 'function' ? okMsg(value) : okMsg;
  if (!saved) toast("Couldn't save - storage is full or blocked. Export a backup.", true);
  else if (msg) toast(msg);
  return { ok: true, value };
}

/** Swap in a whole universe (import or reset). The owner has already confirmed. */
export function replaceUniverse(state) {
  U = state;
  loaded = { status: 'loaded', problems: [], backupKey: loaded.backupKey, readOnly: false };
  const saved = persist();
  refresh();
  return saved;
}

export function refresh() { painter(); paintSheet(); }

// ---------------------------------------------------------------- pages
// Profiles (a wrestler, a team, a title) open as full pages over the current
// tab, stacked so Back retraces the path: roster -> wrestler -> team -> title.
// Each entry remembers where its page was scrolled, so coming back lands in
// the same place. Changing tab clears the stack.
let pages = [];
let tabScroll = 0;          // where the tab underneath was scrolled

export const currentPage = () => pages[pages.length - 1] || null;
export const previousPage = () => pages[pages.length - 2] || null;
const scroller = () => document.getElementById('uvScroll');

export function pushPage(kind, id) {
  const top = currentPage();
  if (top && top.kind === kind && top.id === id) { closeSheet(); return; }
  const sc = scroller();
  if (top) top.scroll = sc ? sc.scrollTop : 0;
  else tabScroll = sc ? sc.scrollTop : 0;
  pages.push({ kind, id, title: '', scroll: 0 });
  closeSheet();
  painter();
  if (sc) sc.scrollTop = 0;
}
export function popPage() {
  pages.pop();
  painter();
  const top = currentPage(), sc = scroller();
  if (sc) sc.scrollTop = top ? top.scroll : tabScroll;
}
/** Drop pages whose record has gone (deleted, merged away). */
export function dropPage() { pages.pop(); }
export function clearPages() { pages = []; }

// ---------------------------------------------------------------- sheet
// A sheet is a function returning { title, body } from the current universe,
// so it repaints itself after every change. Returning null closes it - the
// thing it was showing has gone.
let sheet = null;

export function openSheet(render) {
  sheet = render;
  paintSheet();
  if (!sheet) return;
  document.body.classList.add('uv-sheet-open');
  const el = document.getElementById('uvSheet');
  if (el) el.scrollTop = 0;
}
export function paintSheet() {
  if (!sheet) return;
  const out = sheet();
  if (!out) { closeSheet(); return; }
  document.getElementById('uvSheetTitle').innerHTML = out.title;
  document.getElementById('uvSheetBody').innerHTML = out.body;
}
export function closeSheet() {
  sheet = null;
  document.body.classList.remove('uv-sheet-open');
}
/**
 * Focus a form field so typing can start straight away. preventScroll is not
 * optional: the sheet is still sliding in from below the frame, and a plain
 * focus() scrolls the overflow:hidden app column to bring the field into
 * view - dragging the whole app up and out of its frame.
 */
export function focusField(id) {
  const el = document.getElementById(id);
  if (el) el.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- confirm
let onYes = null;

export function confirmThen(title, text, yesLabel, fn) {
  onYes = fn;
  document.getElementById('uvConfirmTitle').textContent = title;
  document.getElementById('uvConfirmText').textContent = text;
  document.getElementById('uvConfirmYes').textContent = yesLabel;
  document.body.classList.add('uv-confirm-open');
}
export function answerConfirm(yes) {
  const fn = onYes;
  onYes = null;
  document.body.classList.remove('uv-confirm-open');
  if (yes && fn) fn();
}

// ---------------------------------------------------------------- toast
let toastTimer;
export function toast(msg, bad = false) {
  const el = document.getElementById('uvHint');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('bad', !!bad);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), bad ? 3600 : 1800);
}
