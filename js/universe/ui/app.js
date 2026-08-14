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
import { commitCard, setTitleOutcome } from '../card.js';
import { commitRoster } from '../roster.js';
import { UNIVERSE_SEED } from '../seed-data.js';
import { $, h, on, today, plural } from './dom.js';
import { buildIndex, resolve as resolveName } from '../util.js';
import { rosterView, titlesView, showsView, logView, eventSheet, wrestlerPage, titlePage,
  threadsView, heatPanel, seasonView, brandsView, lastStandView, calendarView, showPage } from './views.js';
import { entryView, cardPreview, rosterImportPanel, rosterPreview } from './entry.js';
import { promptsView, importView, copyText } from './tools.js';
import { proposeFlags, commitFlags, proposeLastStand, lastStandCard } from '../season.js';
import { proposeDraft, commitDraft } from '../draft.js';
import { recordMatch } from '../laststand.js';
import { checkBrand } from '../pyramid.js';
import { saveChampionship, retireChampionship, deleteChampionship, defaultTeamSize } from '../championships.js';
import { buildPrompt, entryPrompt } from '../prompts.js';
import { transcriptionPrompt, ingestScreenshot, detectKind, cleanReply, setKey, hasKey } from '../ingest.js';

const store = new UniverseStore({ adapter: localStorageAdapter() });
if (!store.doc.events.length) seedFromJSON(UNIVERSE_SEED, { store });

// `tab` is whichever pane is showing. The two detail pages (a wrestler, a belt)
// are panes too — they just are not in the tab bar, and carry an id.
const app = {
  tab: 'tonight', detailId: null, asOf: null, state: null, flash: null,
  season: {},                       // { proposal, lastStand, draft } — unsaved working state
  brandEdit: null,                  // brand id being edited, or 'new'
  beltEdit: null,                   // belt id being edited, 'new', or 'new:<brandId>'
  showRetiredBelts: false,
  pick: {},                         // the Last Stand match maker's selection
  prompt: { id: 'next' },
  month: null,                      // which month the calendar is showing

  shots: [], activeShot: 0, shotKind: 'card',
  rosterAddOnly: false,             // a deliberately partial paste
};

const TABS = [
  { id: 'tonight', label: 'Tonight' },
  { id: 'roster', label: 'Roster', count: s => Object.keys(s.wrestlers).length },
  { id: 'brands', label: 'Pyramid', count: s => Object.keys(s.brands).length },
  { id: 'titles', label: 'Titles', count: s => Object.values(s.championships).filter(c => !c.retired).length },
  { id: 'threads', label: 'Threads', count: s => s.threads.length },
  { id: 'season', label: 'Season' },
  { id: 'laststand', label: 'Last Stand' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'shows', label: 'Shows', count: s => s.shows.length },
  { id: 'log', label: 'Log', count: s => s.events.length },
  { id: 'prompts', label: 'Prompts' },
  { id: 'import', label: 'Import' },
];
const PANES = [...TABS.map(t => t.id), 'wrestler', 'title', 'show'];

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
  if (app.tab === 'season') $('#pane-season').innerHTML = seasonView(s, {
    proposal: app.season.proposal, lastStand: app.season.lastStand,
    lastStandProposal: app.season.lastStandProposal, draft: app.season.draft,
  });
  if (app.tab === 'brands') $('#pane-brands').innerHTML = brandsView(s, { editing: app.brandEdit });
  if (app.tab === 'laststand') $('#pane-laststand').innerHTML = lastStandView(s, { pick: app.pick });
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
    $('#pane-roster').innerHTML = rosterImportPanel(open || !!keep, { addOnly: app.rosterAddOnly }) + rosterView(s);
    if (keep) { $('#rosterText').value = keep; refreshRosterPreview(); }
  }
  if (app.tab === 'titles') $('#pane-titles').innerHTML = titlesView(s, {
    editingBelt: app.beltEdit, showRetired: app.showRetiredBelts,
  });
  if (app.tab === 'calendar') $('#pane-calendar').innerHTML = calendarView(s, { month: app.month });
  if (app.tab === 'show') $('#pane-show').innerHTML = showPage(s, app.detailId);
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
  const out = rosterPreview(store, app.state, box.value, { addOnly: app.rosterAddOnly });
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
    const res = commitRoster(store, app.pendingRoster, { date: today(), addOnly: app.rosterAddOnly });
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
// The whole belt card opens the belt; the edit button inside it does not.
on('click', '[data-belt]', (e, el) => { if (!e.target.closest('[data-editbelt]')) go('title', el.dataset.belt); });
on('click', '[data-show]', (e, el) => go('show', el.dataset.show));
on('click', '[data-month]', (e, el) => { app.month = el.dataset.month; go('calendar'); });
on('change', '#calJump', (e, el) => { if (el.value) { app.month = el.value; render(); } });
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
on('change', '#rosterAddOnly', (e, el) => { app.rosterAddOnly = el.checked; refreshRosterPreview(); });

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

// ------------------------------------------------------------------ shows

on('click', '[data-editbrand]', (e, el) => {
  app.brandEdit = el.dataset.editbrand || null;
  render();
});

on('click', '[data-savebrand]', (e, el) => {
  const id = el.dataset.savebrand;
  const rec = {
    name: $('#bfName').value.trim(),
    abbr: $('#bfAbbr').value.trim() || undefined,
    logo: $('#bfLogo').value.trim() || undefined,
    color: $('#bfColor').value,
    // Not `Number(x) || 1` — that quietly turns a typed 0 into a valid tier 1
    // instead of refusing it, and the whole point of checkBrand is to say no.
    tier: $('#bfTier').value === '' ? 1 : Number($('#bfTier').value),
    day: $('#bfDay').value || undefined,
    parentId: $('#bfParent').value || undefined,
  };
  const problems = checkBrand(app.state, rec, { id: id === 'new' ? null : id });
  if (problems.length) { flash(problems.map(h).join('; '), 'err'); render(); return; }

  try {
    if (id === 'new') store.addEntity('brand', rec, { upsert: false });
    else store.amendEntity(id, rec, 'edited from the dashboard');
    save();
    app.brandEdit = null;
    flash(`${h(rec.name)} saved. The pyramid, the lists and the draft all read it straight away.`);
  } catch (err) {
    flash(h(err.errors ? err.errors.join('; ') : err.message), 'err');
  }
  render();
});

// ------------------------------------------------------------------ championships
// How many belts a show carries is the user's call. Everything here is an
// entity edit — who *holds* a belt stays in the log, on the belt's own page.

on('click', '[data-editbelt]', (e, el) => {
  app.beltEdit = el.dataset.editbelt || null;
  if (app.beltEdit) go('titles'); else render();
  // The form is below every belt on the page, so take the user to it.
  const form = $('#beltForm');
  if (form) { form.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#tfName').focus(); }
});
on('change', '#beltShowRetired', (e, el) => { app.showRetiredBelts = el.checked; render(); });
// Switching division re-guesses the team size, unless it has been typed over.
on('change', '#tfDivision', (e, el) => {
  const size = $('#tfTeamSize');
  if (size && !size.dataset.touched) size.value = defaultTeamSize(el.value);
});
on('input', '#tfTeamSize', (e, el) => { el.dataset.touched = '1'; });
// Picking a different show changes where its champion would be called up to.
on('change', '#tfBrand', (e, el) => {
  const hint = $('#tfAutoHint');
  if (!hint) return;
  const dest = JSON.parse(hint.dataset.dest || '{}')[el.value];
  const from = app.state.brands[el.value];
  hint.textContent = dest
    ? `${from.name} champions would go into the ${dest} draft pool.`
    : 'Only a belt on a show with a tier above it can call anybody up.';
});

on('click', '[data-savebelt]', (e, el) => {
  const id = el.dataset.savebelt;
  const isNew = id === 'new' || id.startsWith('new:');
  const rec = {
    name: $('#tfName').value.trim(),
    brandId: $('#tfBrand').value || null,
    division: $('#tfDivision').value,
    teamSize: $('#tfTeamSize').value === '' ? null : Number($('#tfTeamSize').value),
    autoPromote: $('#tfAuto').checked,
  };
  try {
    const res = saveChampionship(store, app.state, rec, { id: isNew ? null : id });
    app.beltEdit = null;
    flash(`${h(rec.name)} ${res.created ? 'created' : 'saved'}${rec.autoPromote ? ' — its champion is called up at the offseason' : ''}.`);
    render();
  } catch (err) { flash(h(err.message), 'err'); render(); }
});

on('click', '[data-retirebelt]', (e, el) => {
  const c = app.state.championships[el.dataset.retirebelt];
  if (!confirm(`Retire the ${c.name}? The lineage is kept — it just comes off the active list.`)) return;
  retireChampionship(store, app.state, c.id, { on: universeNow() });
  app.beltEdit = null;
  flash(`${h(c.name)} retired.`);
  render();
});
on('click', '[data-unretirebelt]', (e, el) => {
  const c = app.state.championships[el.dataset.unretirebelt];
  retireChampionship(store, app.state, c.id, { undo: true });
  flash(`${h(c.name)} is active again.`);
  render();
});
on('click', '[data-deletebelt]', (e, el) => {
  const c = app.state.championships[el.dataset.deletebelt];
  if (!confirm(`Delete the ${c.name}? It has never been contested, so nothing is lost.`)) return;
  try {
    deleteChampionship(store, app.state, c.id);
    app.beltEdit = null;
    flash(`${h(c.name)} deleted.`);
  } catch (err) { flash(h(err.message), 'err'); }
  render();
});

// ------------------------------------------------------------------ Last Stand

on('change', '#lsA', (e, el) => { app.pick = { aId: el.value, date: app.pick.date }; render(); });
on('change', '#lsB', (e, el) => { app.pick = { ...app.pick, bId: el.value, winnerId: null }; render(); });
on('change', '#lsWinner', (e, el) => { app.pick = { ...app.pick, winnerId: el.value }; render(); });
on('change', '#lsDate', (e, el) => { app.pick = { ...app.pick, date: el.value }; });
on('click', '#lsClear', () => { app.pick = {}; render(); });

on('click', '#lsRecord', () => {
  const { aId, bId, winnerId, date } = app.pick;
  try {
    const res = recordMatch(store, app.state, { aId, bId, winnerId, date: date || universeNow() });
    save();
    app.pick = { date };
    const moved = res.stakes
      ? `${h(app.state.wrestlers[res.stakes === 'relegation' ? res.loserId : res.winnerId].name)} moves to ${h((app.state.brands[res.to] || {}).name || '')}`
      : 'a qualifier — nobody moved, but the loser is out of the running';
    flash(`Recorded. ${moved}.`);
  } catch (err) {
    flash(h(err.errors ? err.errors.join('; ') : err.message), 'err');
  }
  render();
});

// ------------------------------------------------------------------ draft

on('click', '[data-draftpropose]', (e, el) => {
  app.season.draft = proposeDraft(app.state, { tier: Number(el.dataset.draftpropose) });
  app.season.proposal = null;
  app.season.lastStand = null;
  render();
});
on('click', '[data-draftcancel]', () => { app.season.draft = null; render(); });
on('click', '[data-draftcommit]', () => {
  const res = commitDraft(store, app.season.draft, { date: universeNow(), state: app.state });
  save();
  app.season.draft = null;
  flash(`Draft run — ${plural(res.written, 'wrestler')} changed brand.`);
  render();
});

// ------------------------------------------------------------------ format prompts

const copyEntryPrompt = async (kind, statusEl) => {
  const ok = await copyText(entryPrompt(app.state, kind));
  const el = $(statusEl);
  if (el) el.textContent = ok
    ? 'prompt copied — paste it into any AI, with a screenshot or a description'
    : 'could not reach the clipboard';
  if (!el) flash(ok ? 'Prompt copied — paste it into any AI, with a screenshot or a description.' : 'Could not reach the clipboard.', ok ? 'ok' : 'warn');
  if (!el) render();
};
on('click', '#cardPrompt', () => copyEntryPrompt('card', null));
on('click', '#rosterPrompt', () => copyEntryPrompt('roster', null));

// Flip a title match between "the belt moved" and "the champion retained" by
// rewriting the line, so the override is visible in the text you typed.
on('click', '[data-titletoggle]', (e, el) => {
  const box = $('#cardText');
  if (!box) return;
  const lineNo = +el.dataset.titletoggle;
  const lines = box.value.split('\n');
  if (!lines[lineNo - 1]) return;
  lines[lineNo - 1] = setTitleOutcome(lines[lineNo - 1], el.dataset.want);
  box.value = lines.join('\n');
  refreshCardPreview();
});

// ------------------------------------------------------------------ champions

// Resolve "Cody Rhodes" or "Johnny Gargano & Tommaso Ciampa" to entity ids.
function resolveNames(text) {
  const idx = buildIndex(store, 'wrestler');
  const names = String(text || '').split(/\s*[&+,]\s*|\s+and\s+/i).map(s => s.trim()).filter(Boolean);
  const ids = [], bad = [];
  names.forEach(n => {
    const hit = resolveName(idx, n);
    if (hit.ok) ids.push(hit.id);
    else bad.push(hit.reason === 'ambiguous' ? `"${n}" matches ${hit.candidates.join(', ')}` : `no wrestler called "${n}"`);
  });
  return { ids, bad };
}

on('click', '[data-setchamp]', (e, el) => {
  const titleId = el.dataset.setchamp;
  const input = $('#champName');
  const { ids, bad } = resolveNames(input ? input.value : '');
  if (bad.length) { flash(bad.map(h).join('; '), 'err'); render(); return; }
  if (!ids.length) { flash('Type a name first — or two names joined with &amp; for a tag title.', 'warn'); render(); return; }
  store.append({
    type: 'title.change', date: universeNow(), source: 'dashboard',
    participants: ids.map(ref => ({ ref, role: 'champion' })),
    data: { titleId, reason: el.dataset.reason },
    note: 'set from the dashboard',
  });
  save();
  flash(`${ids.map(i => h(app.state.wrestlers[i].name)).join(' &amp; ')} is now the ${
    el.dataset.reason === 'interim' ? 'interim ' : ''}champion.`);
  render();
});

on('click', '[data-vacate]', (e, el) => {
  store.append({
    type: 'title.change', date: universeNow(), source: 'dashboard',
    participants: [], data: { titleId: el.dataset.vacate, reason: 'vacated' },
    note: 'vacated from the dashboard',
  });
  save();
  flash('Title vacated. That opens a thread until somebody wins it.');
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
    flash(proposal.resolved.length
      ? 'Every competition has been settled — the draft is next.'
      : 'Nothing to book: nobody is carrying a flag.', 'warn');
    render();
    return;
  }
  app.season.lastStandProposal = proposal;
  app.season.lastStand = lastStandCard(app.state, proposal, { date: universeNow() });
  app.season.draft = null;
  render();
});
on('click', '#lastStandCancel', () => {
  app.season.lastStand = null;
  app.season.lastStandProposal = null;
  render();
});
on('click', '#lastStandCopy', async () => {
  flash(await copyText(app.season.lastStand) ? 'Card copied.' : 'Could not reach the clipboard.', 'ok');
  render();
});
on('click', '#lastStandUse', () => {
  const text = app.season.lastStand;
  app.season.lastStand = null;
  app.season.lastStandProposal = null;
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
