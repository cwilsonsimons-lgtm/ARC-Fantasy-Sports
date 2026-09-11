// Save slots. Each one is a different promotion with a different roster.
import { el } from './dom.js';
import { saves, activeSaveId, startNewSave, openSave, removeSave, notify } from '../store.js';

let confirming = null;

export function renderSaves(state, navigate) {
  const list = saves();
  const current = activeSaveId();

  return el('section', {},
    el('h2', { text: 'Saves' }),
    el('p', { class: 'muted', text: 'Every save is its own promotion, with its own roster, its own histories and its own grudges. Nothing carries between them.' }),

    list.length
      ? el('ul', { class: 'saves' }, list.map(entry => saveRow(entry, entry.id === current && state, navigate)))
      : el('p', { class: 'empty', text: 'No saves yet. Start one and see who turns up.' }),

    el('button', {
      type: 'button', class: 'btn primary', text: 'Start a new save',
      onClick: () => { confirming = null; startNewSave(); navigate('roster'); },
    })
  );
}

function saveRow(entry, isOpen, navigate) {
  return el('li', { class: isOpen ? 'save open' : 'save' },
    el('div', { class: 'save-id' },
      el('div', { class: 'save-name' }, entry.name, isOpen ? el('span', { class: 'chip', text: 'open' }) : null),
      el('div', { class: 'save-meta', text: `${entry.show} · Week ${entry.week} · ${entry.roster} wrestlers · ${when(entry.updatedAt)}` })
    ),
    el('div', { class: 'save-actions' },
      isOpen
        ? el('button', { type: 'button', class: 'btn', text: 'Continue', onClick: () => navigate('roster') })
        : el('button', {
            type: 'button', class: 'btn', text: 'Open',
            onClick: () => { confirming = null; if (openSave(entry.id)) navigate('roster'); },
          }),
      el('button', {
        type: 'button',
        class: confirming === entry.id ? 'btn danger' : 'btn',
        text: confirming === entry.id ? 'Delete for good' : 'Delete',
        onClick: () => {
          if (confirming !== entry.id) {
            // No commit here: this is interface state, so redraw without saving.
            confirming = entry.id;
            notify();
            return;
          }
          confirming = null;
          removeSave(entry.id);
        },
      })
    )
  );
}

function when(stamp) {
  if (!stamp) return 'never played';
  const days = Math.floor((Date.now() - stamp) / 86400000);
  if (days <= 0) return 'played today';
  if (days === 1) return 'played yesterday';
  return `played ${days} days ago`;
}
