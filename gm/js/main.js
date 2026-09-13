// Boot: load the save, wire the three screens, redraw whenever state changes.
import { load, subscribe, getState, resetAll } from './store.js';
import { PHASES } from './model/game.js';
import { renderNav } from './ui/nav.js';
import { renderRoster } from './ui/roster.js';
import { renderBooking } from './ui/booking.js';
import { renderLive } from './ui/live.js';
import { renderSaves } from './ui/saves.js';
import { renderCalendar } from './ui/calendar.js';
import { renderTitles } from './ui/titles.js';
import { renderTree } from './ui/tree.js';
import { renderCard } from './ui/wrestler-card.js';
import { openCardId, closeCard } from './ui/card-state.js';

const navEl = document.getElementById('nav');
const viewEl = document.getElementById('view');
const phaseEl = document.getElementById('phase');
const promoEl = document.getElementById('promo');

const PHASE_LABEL = { [PHASES.PREP]: 'Booking', [PHASES.LIVE]: 'On air', [PHASES.AFTER]: 'Aftermath' };

let route = 'roster';

function navigate(next) {
  route = next;
  render();
}

function render() {
  const state = getState();
  if (!state) route = 'saves';

  navEl.replaceChildren(...renderNav(route, state && state.phase, navigate, Boolean(state)));
  // Where you are in the season on the top line, whose promotion it is on the
  // second. Two facts the player wants without looking for them.
  phaseEl.replaceChildren(
    state ? `Week ${state.week} · ${PHASE_LABEL[state.phase]}` : 'No save open'
  );
  promoEl.replaceChildren(state ? state.promotion.promotion : 'Open or start a save');

  // Unspent points are easy to forget about and the board is a tab you have to
  // remember to open, so the tab says so itself.
  const points = state && state.gm ? state.gm.points : 0;
  const boardTab = [...navEl.children].find(b => b.textContent === 'GM Board');
  if (boardTab && points) {
    boardTab.classList.add('has-points');
    boardTab.title = `${points} unspent upgrade point${points === 1 ? '' : 's'}`;
  }

  const view =
    route === 'saves' ? renderSaves(state, navigate) :
    !state ? renderSaves(state, navigate) :
    route === 'booking' ? renderBooking(state, navigate) :
    route === 'calendar' ? renderCalendar(state, navigate) :
    route === 'titles' ? renderTitles(state) :
    route === 'tree' ? renderTree(state) :
    route === 'live' ? renderLive(state, navigate) :
    renderRoster(state);

  const cardId = openCardId();
  const card = cardId ? renderCard(state, cardId) : null;
  viewEl.replaceChildren(...(card ? [view, card] : [view]));
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeCard();
});

const state = load();
if (!state) route = 'saves';
// A refresh during or just after a show lands back where the action is.
else if (state.phase !== PHASES.PREP) route = 'live';

// Two-click confirm rather than window.confirm(), which some embedded contexts block.
const resetBtn = document.getElementById('reset');
let resetArmed = false;
resetBtn.addEventListener('click', () => {
  if (!resetArmed) {
    resetArmed = true;
    resetBtn.textContent = 'Click again to delete every save';
    return;
  }
  resetAll();
});

subscribe(render);
render();
