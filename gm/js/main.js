// Boot: load the save, wire the three screens, redraw whenever state changes.
import { load, subscribe, getState, resetAll } from './store.js';
import { PHASES } from './model/game.js';
import { renderNav } from './ui/nav.js';
import { renderRoster } from './ui/roster.js';
import { renderBooking } from './ui/booking.js';
import { renderLive } from './ui/live.js';
import { renderCard } from './ui/wrestler-card.js';
import { openCardId, closeCard } from './ui/card-state.js';

const navEl = document.getElementById('nav');
const viewEl = document.getElementById('view');
const phaseEl = document.getElementById('phase');

const PHASE_LABEL = { [PHASES.PREP]: 'Prep', [PHASES.LIVE]: 'On air', [PHASES.AFTER]: 'Aftermath' };

let route = 'roster';

function navigate(next) {
  route = next;
  render();
}

function render() {
  const state = getState();
  navEl.replaceChildren(...renderNav(route, state.phase, navigate));
  phaseEl.replaceChildren(`Week ${state.week} · ${PHASE_LABEL[state.phase]}`);

  const view =
    route === 'booking' ? renderBooking(state, navigate) :
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
// A refresh during or just after a show lands back where the action is.
if (state.phase !== PHASES.PREP) route = 'live';

// Two-click confirm rather than window.confirm(), which some embedded contexts block.
const resetBtn = document.getElementById('reset');
let resetArmed = false;
resetBtn.addEventListener('click', () => {
  if (!resetArmed) {
    resetArmed = true;
    resetBtn.textContent = 'Click again to confirm reset';
    return;
  }
  resetAll();
});

subscribe(render);
render();
