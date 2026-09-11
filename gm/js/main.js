// Boot: load the save, wire the three screens, redraw whenever state changes.
import { load, subscribe, getState, resetAll } from './store.js';
import { PHASES } from './model/game.js';
import { renderNav } from './ui/nav.js';
import { renderRoster } from './ui/roster.js';
import { renderBooking } from './ui/booking.js';
import { renderLive } from './ui/live.js';
import { renderSaves } from './ui/saves.js';
import { renderCalendar } from './ui/calendar.js';
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
  if (!state) route = 'saves';

  navEl.replaceChildren(...renderNav(route, state && state.phase, navigate, Boolean(state)));
  phaseEl.replaceChildren(
    state ? `${state.promotion.show} · Week ${state.week} · ${PHASE_LABEL[state.phase]}` : 'No save open'
  );

  const view =
    route === 'saves' ? renderSaves(state, navigate) :
    !state ? renderSaves(state, navigate) :
    route === 'booking' ? renderBooking(state, navigate) :
    route === 'calendar' ? renderCalendar(state, navigate) :
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
