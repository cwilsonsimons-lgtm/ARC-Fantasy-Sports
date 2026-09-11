import { el } from './dom.js';
import { PHASES } from '../model/game.js';

export function renderNav(route, phase, navigate) {
  const tabs = [
    ['roster', 'Roster'],
    ['booking', 'Booking'],
    ['live', phase === PHASES.AFTER ? 'Aftermath' : 'Live Show'],
  ];

  return tabs.map(([id, label]) =>
    el('button', {
      type: 'button',
      class: route === id ? 'on' : '',
      text: label,
      onClick: () => navigate(id),
    })
  );
}
