// Boot: load the save, wire the three screens, redraw whenever state changes.
import { load, subscribe, getState, resetAll } from './store.js';
import { isLive } from './model/broadcast.js';
import { renderNav } from './ui/nav.js';
import { renderRoster } from './ui/roster.js';
import { renderBooking } from './ui/booking.js';
import { renderLive } from './ui/live.js';

const navEl = document.getElementById('nav');
const viewEl = document.getElementById('view');

let route = 'roster';

function navigate(next) {
  route = next;
  render();
}

function render() {
  const state = getState();
  navEl.replaceChildren(...renderNav(route, navigate));

  const view =
    route === 'booking' ? renderBooking(state, navigate) :
    route === 'live' ? renderLive(state, navigate) :
    renderRoster(state);

  viewEl.replaceChildren(view);
}

const state = load();
if (isLive(state.broadcast)) route = 'live'; // a refresh mid-show lands back at Gorilla

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
