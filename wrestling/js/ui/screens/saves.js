// Saves: start a game, write one to a slot, read one back, move one between
// machines as JSON.

import * as store from '../../core/store.js';
import * as persist from '../../core/persist.js';
import { checkState } from '../../core/invariants.js';
import { esc } from '../format.js';

export default {
  label: 'Saves',
  render() {
    const loaded = store.isLoaded();
    const saves = persist.listSaves();

    const rows = saves.map((s) => `<tr>
      <td><strong>${esc(s.label || s.slot)}</strong><div class="muted num" style="font-size:11px">${esc(s.slot)}</div></td>
      <td class="num">${esc(String(s.savedAt).replace('T', ' ').slice(0, 16))}</td>
      <td class="num">day ${s.summary?.day ?? '?'}</td>
      <td class="num">${s.summary?.rosterSize ?? '?'}</td>
      <td class="num">${s.summary?.events ?? '?'}</td>
      <td>
        <button class="act" data-action="loadSlot" data-slot="${esc(s.slot)}">Load</button>
        <button class="act danger" data-action="deleteSlot" data-slot="${esc(s.slot)}">Delete</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">No saves yet.</td></tr>';

    const problems = loaded ? checkState(store.getState()) : [];

    return `
      <h1>Saves</h1>
      <p class="sub">A save carries the state, the ID counters and the RNG position, so a reload continues
      the same world rather than a similar one.</p>

      <h2>New game</h2>
      <form data-action="newGame">
        <div class="bar">
          <div class="field"><label for="gmName">GM name</label>
            <input id="gmName" name="gmName" value="C. Wilson" size="14"></div>
          <div class="field"><label for="brandName">Brand</label>
            <input id="brandName" name="brandName" value="Friday Night Showcase" size="18"></div>
          <div class="field"><label for="seed">Seed</label>
            <input id="seed" name="seed" value="" placeholder="random" size="12"></div>
          <div class="field"><label for="mode">Mode</label>
            <select id="mode" name="mode">
              <option value="sandbox">Solo sandbox</option>
              <option value="competitive">Competitive</option>
            </select></div>
          <button class="act primary" type="submit">Start</button>
        </div>
      </form>

      <h2>Slots</h2>
      <div class="bar">
        <div class="field"><label for="slotName">Slot</label>
          <input id="slotName" value="slot1" size="10"></div>
        <div class="field"><label for="slotLabel">Label</label>
          <input id="slotLabel" value="" placeholder="optional" size="16"></div>
        <button class="act primary" data-action="saveSlot"${loaded ? '' : ' disabled'}>Save</button>
        <button class="act" data-action="exportSave"${loaded ? '' : ' disabled'}>Copy as JSON</button>
        <button class="act" data-action="importSave">Paste JSON</button>
      </div>
      <div class="scroller"><table>
        <thead><tr><th>Save</th><th>Written</th><th>Day</th><th>Roster</th><th>Events</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>

      <h2>Integrity</h2>
      ${!loaded ? '<p class="empty">No game loaded.</p>' : problems.length
        ? `<p class="neg">${problems.length} problem(s):</p><ul>${problems.map((p) => `<li class="neg">${esc(p)}</li>`).join('')}</ul>`
        : `<p><span class="pill brass">Sound</span> Every reference resolves, no wrestler is stored twice, the log is append-only.</p>`}
      <div class="bar"><button class="act" data-action="checkState"${loaded ? '' : ' disabled'}>Re-check now</button></div>`;
  },
};
