// The global event log, read back.
//
// Everything that has ever happened, in order, with the cause of each. This is
// the record a system built later reads to reconstruct a past it was not
// present for.

import * as store from '../../core/store.js';
import { EVENT_TYPES } from '../../core/events.js';
import { esc } from '../format.js';
import { notLoaded } from './roster.js';

let filter = '';

export function setFilter(next) { filter = next; }

export default {
  label: 'Event log',
  render() {
    if (!store.isLoaded()) return notLoaded();
    const log = store.queryLog(filter ? { type: filter } : {});
    const used = new Map();
    for (const e of store.queryLog({})) used.set(e.type, (used.get(e.type) || 0) + 1);

    const options = [...used.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([type, n]) => `<option value="${type}"${type === filter ? ' selected' : ''}>${esc(type)} (${n})</option>`)
      .join('');

    const rows = [...log].reverse().map((e) => `
      <div class="ev">
        <span class="d">d${e.day} <span style="opacity:.6">#${e.seq}</span></span>
        <span class="t">${esc(e.type)}</span>
        <span>${esc(e.summary)}${e.causeId ? ` <span class="muted">&larr; ${e.causeId}</span>` : ''}</span>
      </div>`).join('') || '<p class="empty">No events match.</p>';

    const registered = Object.keys(EVENT_TYPES).length;

    return `
      <h1>Event log</h1>
      <p class="sub">${store.queryLog({}).length} events &middot; ${used.size} of ${registered} registered types in use &middot; append-only</p>

      <div class="bar">
        <div class="field"><label for="logFilter">Filter by type</label>
          <select id="logFilter" data-action="filterLog">
            <option value="">all types</option>${options}
          </select></div>
      </div>

      <div class="log">${rows}</div>`;
  },
};
