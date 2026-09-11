// Which wrestler card is open. Pure interface state — it never touches the
// save, so it lives here rather than in the game state, and uses notify() to
// redraw without writing anything to storage.
import { notify } from '../store.js';

let openId = null;

export function openCard(id) {
  openId = id;
  notify();
}

export function closeCard() {
  if (openId === null) return;
  openId = null;
  notify();
}

export function openCardId() {
  return openId;
}
