// WWE 2K Universe dashboard — boot and wiring.
//
// The whole UI is a function of the projection: any change appends to the log,
// then render() re-projects and redraws. No view holds state of its own, which
// is why voiding an event from the log tab immediately moves the rosters, the
// belts and the records on every other tab.
//
// Storage is localStorage under `arc_universe_v1` — the fantasy app's own keys
// are never touched. First load seeds from the committed seed module.

import { UniverseStore, localStorageAdapter } from '../store.js';
import { project } from '../project.js';
import { seedFromJSON } from '../seed.js';
import { commitCard } from '../card.js';
import { commitRoster } from '../roster.js';
import { UNIVERSE_SEED } from '../seed-data.js';
import { $, h, on, today, plural } from './dom.js';
import { rosterView, titlesView, showsView, logView, wrestlerSheet, lineageSheet, eventSheet } from './views.js';
import { entryView, cardPreview, rosterImportPanel, rosterPreview } from './entry.js';

const store = new UniverseStore({ adapter: localStorageAdapter() });
if (!store.doc.events.length) seedFromJSON(UNIVERSE_SEED, { store });

const app = { tab: 'tonight', asOf: null, state: null, flash: null };

const TABS = [
  { id: 'tonight', label: 'Tonight' },
  { id: 'roster', label: 'Roster', count: s => Object.keys(s.wrestlers).length },
  { id: 'titles', label: 'Titles', count: s => Object.values(s.championships).filter(c => !c.retired).length },
  { id: 'shows', label: 'Shows', count: s => s.shows.length },
  { id: 'log', label: 'Log', count: s => s.events.length },
];

// ------------------------------------------------------------------ render

function render() {
  app.state = project(store, { asOf: app.asOf });
  const s = app.state;

  $('#uName').textContent = store.doc.meta.name || 'Universe';
  $('#uMeta').textContent = `${plural(Object.keys(s.wrestlers).length, 'wrestler')} · ${plural(store.stats().live, 'event')}`
    + `${store.stats().voided ? ` · ${store.stats().voided} voided` : ''}`
    + `${store.doc.corrections.length ? ` · ${plural(store.doc.corrections.length, 'correction')}` : ''}`;

  $('#tabs').innerHTML = TABS.map(t =>
    `<button class="tab${t.id === app.tab ? ' on' : ''}" data-tab="${t.id}">${h(t.label)}${
      t.count ? `<span class="count">${t.count(s)}</span>` : ''}</button>`).join('');

  const asOf = $('#asOf');
  asOf.value = app.asOf || '';
  $('#asOfWrap').classList.toggle('past', !!app.asOf);
  $('#asOfNow').style.display = app.asOf ? '' : 'none';

  TABS.forEach(t => $(`#pane-${t.id}`).classList.toggle('on', t.id === app.tab));

  if (app.tab === 'tonight') {
    // Rebuilding the pane would wipe what is being typed, so it is drawn once
    // and only the preview is refreshed after that.
    if (!$('#cardText')) {
      $('#pane-tonight').innerHTML = entryView();
      $('#cardText').focus();
    }
    refreshCardPreview();
  }
  if (app.tab === 'roster') {
    const keep = $('#rosterText') ? $('#rosterText').value : '';
    const open = $('#rosterPanel') ? $('#rosterPanel').open : false;
    $('#pane-roster').innerHTML = rosterImportPanel(open || !!keep) + rosterView(s);
    if (keep) { $('#rosterText').value = keep; refreshRosterPreview(); }
  }
  if (app.tab === 'titles') $('#pane-titles').innerHTML = titlesView(s);
  if (app.tab === 'shows') $('#pane-shows').innerHTML = showsView(s);
  if (app.tab === 'log') $('#pane-log').innerHTML = logView(store, s);

  if (app.flash) {
    const bar = document.createElement('div');
    bar.className = `msg ${app.flash.kind || 'ok'}`;
    bar.innerHTML = app.flash.text;
    const pane = $(`#pane-${app.tab}`);
    pane.insertBefore(bar, pane.firstChild);
    app.flash = null;
  }
}

const save = () => { if (!store.save()) flash('Could not save — browser storage is full or blocked. Recent changes are in memory only.', 'err'); };
const flash = (text, kind = 'ok') => { app.flash = { text, kind }; };

// ------------------------------------------------------------------ previews

function refreshCardPreview() {
  const box = $('#cardText');
  if (!box) return;
  const out = cardPreview(store, app.state, box.value);
  $('#cardPreview').innerHTML = out.html;
  $('#cardSave').disabled = !out.ok;
  app.pendingCard = out.ok ? out.parsed : null;
}

function refreshRosterPreview() {
  const box = $('#rosterText');
  if (!box) return;
  const out = rosterPreview(store, app.state, box.value);
  $('#rosterPreview').innerHTML = out.html;
  $('#rosterSave').disabled = !out.ok;
  app.pendingRoster = out.ok ? out.parsed : null;
}

// ------------------------------------------------------------------ sheet

function openSheet({ title, body }) {
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = body;
  $('#sheet').classList.add('on');
  $('#scrim').classList.add('on');
}
function closeSheet() {
  $('#sheet').classList.remove('on');
  $('#scrim').classList.remove('on');
}

// ------------------------------------------------------------------ actions

function saveCard() {
  if (!app.pendingCard) return;
  try {
    const res = commitCard(store, app.pendingCard);
    save();
    $('#cardText').value = '';
    app.pendingCard = null;
    flash(`Saved <strong>${h(app.state.showsById ? '' : '')}${h(res.showId)}</strong> — ${plural(res.written, 'event')} written. It is on the Shows tab.`);
  } catch (e) {
    flash(`Could not save: ${h(e.message)}`, 'err');
  }
  render();
}

function importRoster() {
  if (!app.pendingRoster) return;
  try {
    const res = commitRoster(store, app.pendingRoster, { date: today() });
    save();
    $('#rosterText').value = '';
    app.pendingRoster = null;
    flash(`Imported — ${plural(res.written, 'event')} written.`);
  } catch (e) {
    flash(`Could not import: ${h(e.message)}`, 'err');
  }
  render();
}

// ------------------------------------------------------------------ events

on('click', '[data-tab]', (e, el) => { app.tab = el.dataset.tab; render(); });
on('click', '[data-w]', (e, el) => openSheet(wrestlerSheet(app.state, el.dataset.w)));
on('click', '[data-belt]', (e, el) => openSheet(lineageSheet(app.state, el.dataset.belt)));
on('click', '[data-ev]', (e, el) => openSheet(eventSheet(store, app.state, el.dataset.ev)));

on('click', '[data-void]', (e, el) => {
  store.voidEvent(el.dataset.void, 'voided from the dashboard');
  save(); closeSheet();
  flash('Event voided — it stays in the log, and everything downstream has been recalculated.');
  render();
});
on('click', '[data-restore]', (e, el) => {
  store.restoreEvent(el.dataset.restore, 'restored from the dashboard');
  save(); closeSheet();
  flash('Event restored.');
  render();
});

// Fix a result: pick the corner that actually won.
on('click', '[data-winner]', (e, el) => {
  const [id, sideRaw] = el.dataset.winner.split(':');
  const side = +sideRaw;
  const ev = store.applied(store.getEvent(id));
  store.amendEvent(id, {
    participants: ev.participants.map(p => ({ ...p, role: p.side === side ? 'winner' : 'loser' })),
  }, 'result corrected from the dashboard');
  save();
  flash('Result corrected — records, streaks and title reigns have all been replayed.');
  openSheet(eventSheet(store, project(store, { asOf: app.asOf }), id));
  render();
});

on('click', '#scrim, #sheetClose', closeSheet);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSheet();
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && app.tab === 'tonight') { e.preventDefault(); saveCard(); }
});

document.addEventListener('input', e => {
  if (e.target.id === 'cardText') refreshCardPreview();
  if (e.target.id === 'rosterText') refreshRosterPreview();
});

on('click', '#cardSave', saveCard);
on('click', '#rosterSave', importRoster);
on('click', '#cardClear', () => { $('#cardText').value = ''; refreshCardPreview(); });
on('click', '#rosterClear', () => { $('#rosterText').value = ''; refreshRosterPreview(); });

on('change', '#asOf', (e, el) => { app.asOf = el.value || null; render(); });
on('click', '#asOfNow', () => { app.asOf = null; render(); });

on('click', '#reset', () => {
  if (!confirm('Delete this universe and start again from the seed roster?\n\nEvery show, result and correction will be lost.')) return;
  store.doc = { meta: { version: 1, name: 'Universe', seq: 0, cxSeq: 0 }, entities: { wrestlers: {}, brands: {}, championships: {}, groups: {} }, events: [], corrections: [] };
  seedFromJSON(UNIVERSE_SEED, { store });
  save();
  app.tab = 'tonight';
  flash('Universe reset to the seed roster.');
  render();
});

render();

// Handy in the console, and how tools/universe-ui-check.mjs drives the page.
window.UNIVERSE = { store, app, render, project };
