// Read-only roster listing. Viewing is all this screen needs to do for now.
import { el } from './dom.js';

export function renderRoster(state) {
  const rows = state.wrestlers.map(w =>
    el('tr', {},
      el('td', { text: w.name }),
      el('td', { text: w.gender }),
      el('td', { text: w.alignment }),
      el('td', { text: w.status }),
      el('td', { class: 'muted', text: w.id })
    )
  );

  return el('section', {},
    el('h2', { text: `Roster (${state.wrestlers.length})` }),
    el('table', {},
      el('thead', {},
        el('tr', {},
          el('th', { text: 'Name' }),
          el('th', { text: 'Gender' }),
          el('th', { text: 'Alignment' }),
          el('th', { text: 'Status' }),
          el('th', { text: 'ID' })
        )
      ),
      el('tbody', {}, rows)
    )
  );
}
