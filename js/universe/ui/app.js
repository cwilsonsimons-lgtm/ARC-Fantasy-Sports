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
import { rosterView, titlesView, showsView, logView, eventSheet, wrestlerPage, titlePage,
  threadsView, heatPanel, seasonView } from './views.js';
import { entryView, cardPreview, rosterImportPanel, rosterPreview } from './entry.js';
import { promptsView, importView, copyText } from './tools.js';
import { proposeFlags, commitFlags, proposeLastStand, lastStandCard } from '../season.js';
import { buildPrompt } from '../prompts.js';
import { transcriptionPrompt, ingestScreenshot, detectKind, cleanReply, setKey, hasKey } from '../ingest.js';

const store = new UniverseStore({ adapter: localStorageAdapter() });
if (!store.doc.events.length) seedFromJSON(UNIVERSE_SEED, { store });

// `tab` is whichever pane is showing. The two detail pages (a wrestler, a belt)
// are panes too — they just are not in the tab bar, and carry an id.
const app = {
  tab: 'tonight', detailId: null, asOf: null, state: null, flash: null,
  season: {},                       // { proposal, lastStand } — unsaved working state
  prompt: { id: 'next' },
  shots: [], activeShot: 0, shotKind: 'card',
};

const TABS = [
  { id: 'tonight', label: 'Tonight' },
  { id: 'roster', label: 'Roster', count: s => Object.keys(s.wrestlers).length },
  { id: 'titles', label: 'Titles', count: s => Object.values(s.championships).filter(c => !c.retired).length },
  { id: 'threads', label: 'Threads', count: s => s.threads.length },
  { id: 'season', label: 'Season' },
  { id: 'shows', label: 'Shows', count: s => s.shows.length },
  { id: 'log', label: 'Log', count: s => s.events.length },
  { id: 'prompts', label: 'Prompts' },
  { id: 'import', label: 'Import' },
];
const PANES = [...TABS.map(t => t.id), 'wrestler', 'title'];

const go = (tab, detailId = null) => { app.tab = tab; app.detailId = detailId; closeSheet(); render(); };

// The universe has its own clock: whatever the newest event is dated, or today
// if that is later. A thread resolved "now" must not land before the show that
// opened it, which is what using the wall clock would do.
const universeNow = () => {
  const last = store.doc.events.reduce((m, e) => (e.date > m ? e.date : m), '0000-00-00');
  return last > today() ? last : today();
};

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

  PANES.forEach(id => $(`#pane-${id}`).classList.toggle('on', id === app.tab));

  if (app.tab === 'tonight') {
    // Rebuilding the pane would wipe what is being typed, so the entry form is
    // drawn once; only the preview and the heat panel below it are refreshed.
    if (!$('#cardText')) {
      $('#pane-tonight').innerHTML = entryView() + '<div id="heatPanel"></div>';
      $('#cardText').focus();
    }
    refreshCardPreview();
    $('#heatPanel').innerHTML = heatPanel(s);
  }
  if (app.tab === 'threads') $('#pane-threads').innerHTML = threadsView(s);
  if (app.tab === 'season') $('#pane-season').innerHTML = seasonView(s, { proposal: app.season.proposal, lastStand: app.season.lastStand });
  if (app.tab === 'prompts') { $('#pane-prompts').innerHTML = promptsView(s, app.prompt); refreshPrompt(); }
  if (app.tab === 'import') {
    const keep = $('#shotText') ? $('#shotText').value : (app.shotText || '');
    $('#pane-import').innerHTML = importView(s, { shots: app.shots, active: app.activeShot, kind: app.shotKind });
    if (keep) { $('#shotText').value = keep; refreshShotPreview(); }
  }
  if (app.tab === 'wrestler') $('#pane-wrestler').innerHTML = wrestlerPage(s, app.detailId);
  if (app.tab === 'title') $('#pane-title').innerHTML = titlePage(s, app.detailId);
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

on('click', '[data-tab]', (e, el) => go(el.dataset.tab));
on('click', '[data-w]', (e, el) => go('wrestler', el.dataset.w));
on('click', '[data-belt]', (e, el) => go('title', el.dataset.belt));
on('click', '[data-ev]', (e, el) => openSheet(eventSheet(store, app.state, el.dataset.ev)));

// Mark a thread resolved. It is an event like anything else, so it lands in the
// log, shows up in the correction trail, and can be voided if you change your
// mind — rather than a flag flipped on a record somewhere.
on('click', '[data-resolve]', (e, el) => {
  store.append({
    type: 'thread.resolved', date: universeNow(), source: 'dashboard',
    participants: [], data: { threadId: el.dataset.resolve, reason: 'marked resolved' },
  });
  save();
  flash('Thread resolved.');
  render();
});

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
  if (e.target.id === 'shotText') refreshShotPreview();
  if (e.target.id === 'promptPle') { app.prompt.ple = e.target.value; refreshPrompt(); }
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

// ------------------------------------------------------------------ season

on('click', '#flagsPropose', () => {
  app.season.proposal = proposeFlags(app.state);
  app.season.lastStand = null;
  render();
});
on('click', '#flagsCancel', () => { app.season.proposal = null; render(); });
on('click', '#flagsCommit', () => {
  const res = commitFlags(store, app.season.proposal || [], { date: universeNow() });
  save();
  app.season.proposal = null;
  flash(`${plural(res.written, 'name')} flagged. Book Last Stand when you are ready.`);
  render();
});
on('click', '#lastStandPropose', () => {
  const proposal = proposeLastStand(app.state);
  if (!proposal.matches.length) {
    flash('Nothing to book — nobody is carrying a flag, or there is only one name per gender on a list.', 'warn');
    render();
    return;
  }
  app.season.lastStand = lastStandCard(app.state, proposal, { date: universeNow() });
  if (proposal.unpaired.length) {
    flash(`${proposal.unpaired.map(w => h(w.name)).join(', ')} had nobody to face and was left off the card.`, 'warn');
  }
  render();
});
on('click', '#lastStandCopy', async () => {
  flash(await copyText(app.season.lastStand) ? 'Card copied.' : 'Could not reach the clipboard.', 'ok');
  render();
});
on('click', '#lastStandUse', () => {
  const text = app.season.lastStand;
  app.season.lastStand = null;
  go('tonight');
  $('#cardText').value = text;
  refreshCardPreview();
  $('#cardText').focus();
});

// ------------------------------------------------------------------ prompts

function refreshPrompt() {
  const box = $('#promptText');
  if (!box) return;
  const opts = {
    showId: app.prompt.showId || (app.state.shows.length ? app.state.shows[app.state.shows.length - 1].id : null),
    brandId: app.prompt.brandId || null,
    ple: app.prompt.ple || undefined,
  };
  const text = buildPrompt(app.prompt.id, app.state, opts);
  box.value = text;
  $('#promptSize').textContent = `${text.length.toLocaleString()} characters`;
}

on('click', '[data-prompt]', (e, el) => { app.prompt = { ...app.prompt, id: el.dataset.prompt }; render(); });
on('change', '#promptShow', (e, el) => { app.prompt.showId = el.value; refreshPrompt(); });
on('change', '#promptBrand', (e, el) => { app.prompt.brandId = el.value || null; refreshPrompt(); });
on('click', '#promptCopy', async () => {
  const ok = await copyText($('#promptText').value);
  $('#promptSize').textContent = ok ? 'copied to clipboard' : 'could not reach the clipboard — select the text and copy';
});

// ------------------------------------------------------------------ import

function refreshShotPreview() {
  const box = $('#shotText');
  if (!box) return;
  const text = cleanReply(box.value);
  app.shotText = box.value;
  const kind = detectKind(text) || app.shotKind;
  const out = kind === 'roster' ? rosterPreview(store, app.state, text) : cardPreview(store, app.state, text);
  $('#shotPreview').innerHTML = out.html || '';
  $('#shotUse').disabled = !out.ok;
  app.shotParsed = out.ok ? { kind, text } : null;
  $('#shotStatus').textContent = text ? `reads as a ${kind === 'roster' ? 'roster' : 'show card'}` : '';
}

const addShots = files => {
  [...files].filter(f => /^image\//.test(f.type)).forEach(f => {
    const r = new FileReader();
    r.onload = () => {
      app.shots.push({ name: f.name, dataUrl: r.result });
      app.activeShot = app.shots.length - 1;
      render();
    };
    r.readAsDataURL(f);
  });
};

on('click', '#shotPick', () => $('#shotFile').click());
document.addEventListener('change', e => { if (e.target.id === 'shotFile') addShots(e.target.files); });
on('click', '[data-shot]', (e, el) => { app.activeShot = +el.dataset.shot; render(); });
on('change', '#shotKind', (e, el) => { app.shotKind = el.value; });

document.addEventListener('dragover', e => {
  if (!$('#drop')) return;
  e.preventDefault();
  $('#drop').classList.add('over');
});
document.addEventListener('dragleave', e => { if ($('#drop') && e.target === $('#drop')) $('#drop').classList.remove('over'); });
document.addEventListener('drop', e => {
  if (!$('#drop')) return;
  e.preventDefault();
  $('#drop').classList.remove('over');
  if (e.dataTransfer && e.dataTransfer.files) addShots(e.dataTransfer.files);
});

on('click', '#shotPrompt', async () => {
  const ok = await copyText(transcriptionPrompt(app.state, app.shotKind));
  $('#shotStatus').textContent = ok
    ? 'prompt copied — paste it into your AI along with the screenshot, then paste the reply below'
    : 'could not reach the clipboard';
});

on('click', '#shotRead', async () => {
  const shot = app.shots[app.activeShot];
  if (!shot) return;
  const btn = $('#shotRead');
  btn.disabled = true;
  $('#shotStatus').textContent = 'reading the screenshot…';
  try {
    const out = await ingestScreenshot(app.state, { dataUrl: shot.dataUrl, kind: app.shotKind });
    $('#shotText').value = out.text;
    refreshShotPreview();
  } catch (err) {
    $('#shotStatus').textContent = `could not read it: ${err.message}`;
  }
  btn.disabled = false;
});

on('click', '#apiSave', () => {
  setKey($('#apiKey').value.trim());
  flash(hasKey() ? 'Key saved in this browser. Screenshots will be read automatically.' : 'Key removed.');
  render();
});
on('click', '#apiClear', () => { setKey(''); flash('Key removed.'); render(); });
on('click', '#shotClear', () => { $('#shotText').value = ''; app.shotText = ''; refreshShotPreview(); });

on('click', '#shotUse', () => {
  if (!app.shotParsed) return;
  const { kind, text } = app.shotParsed;
  app.shotText = '';
  go(kind === 'roster' ? 'roster' : 'tonight');
  if (kind === 'roster') {
    $('#rosterPanel').open = true;
    $('#rosterText').value = text;
    refreshRosterPreview();
  } else {
    $('#cardText').value = text;
    refreshCardPreview();
    $('#cardText').focus();
  }
});

render();

// Handy in the console, and how tools/universe-ui-check.mjs drives the page.
window.UNIVERSE = { store, app, render, project };
