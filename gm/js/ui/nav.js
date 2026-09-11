import { el } from './dom.js';
import { PHASES } from '../model/game.js';

export function renderNav(route, phase, navigate, hasSave) {
  const tabs = hasSave
    ? [
        ['roster', 'Roster'],
        ['booking', 'Booking'],
        ['live', phase === PHASES.AFTER ? 'Aftermath' : 'Live Show'],
        ['saves', 'Saves'],
      ]
    : [['saves', 'Saves']];

  return tabs.map(([id, label]) =>
    el('button', {
      type: 'button',
      class: route === id ? 'on' : '',
      text: label,
      onClick: () => navigate(id),
    })
  );
}
