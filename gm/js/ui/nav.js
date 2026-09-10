import { el } from './dom.js';

const TABS = [
  ['roster', 'Roster'],
  ['booking', 'Booking'],
  ['live', 'Live Show'],
];

export function renderNav(route, navigate) {
  return TABS.map(([id, label]) =>
    el('button', {
      type: 'button',
      class: route === id ? 'on' : '',
      text: label,
      onClick: () => navigate(id),
    })
  );
}
