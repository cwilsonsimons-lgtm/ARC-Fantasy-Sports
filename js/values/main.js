// League Values — entry point and UI. A standalone page: it imports nothing from
// the fantasy app or Arc Markets, and keeps its own storage (see store.js).

import { DEFAULT_PARAMS, replay, compare, isPick, pickLabel, pickKey, groupLabel } from './model.js';
import { DD_TODAY, parseDynastyDaddy, mergeSnapshots, fetchDynastyDaddy } from './baseline.js';
import { describeScoring, isSuperflex } from './scoring.js';
import { sparkline, historyChart } from './chart.js';
import { data, cache, save, exportAll, importAll } from './store.js';
import { sync } from './sync.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = v => Math.round(v).toLocaleString();
const pct = x => { const p = (Math.exp(x) - 1) * 100; return (p >= 0 ? '+' : '') + p.toFixed(Math.abs(p) < 10 ? 1 : 0) + '%'; };
const day = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const DAY = 86400000;

let model = null;
const ui = { pos: '', owner: '', search: '', sort: 'league', tab: 'values' };

// ---- derived league facts --------------------------------------------------

const league = () => cache.leagues[0] || null;
const superflex = () => (league() ? isSuperflex(league()) : true);

function owners() {
  const users = new Map((cache.users || []).map(u => [u.user_id, u]));
  const out = new Map();
  for (const r of cache.rosters || []) {
    const u = users.get(r.owner_id);
    out.set(r.roster_id, u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`);
  }
  return out;
}
function rosterOf() {
  const out = new Map();
  for (const r of cache.rosters || []) for (const p of r.players || []) out.set(p, r.roster_id);
  return out;
}

function labelOf(key) {
  if (isPick(key)) return pickLabel(key);
  return cache.players[key]?.name || `Player ${key}`;
}
function posOf(key) { return isPick(key) ? 'PICK' : cache.players[key]?.pos || '?'; }

function allTrades() {
  const ignored = new Set(data.ignored);
  return Object.values(cache.trades || {}).flat().map(t => ({ ...t, ignored: ignored.has(t.id) }));
}

function weeks() {
  return Object.values(cache.weeks || {}).sort((a, b) => a.end - b.end);
}

function rebuild() {
  if (!data.snapshots.length) { model = null; return; }
  model = replay({
    snapshots: data.snapshots,
    players: cache.players,
    weeks: weeks(),
    trades: allTrades(),
    rejected: data.rejected,
  }, data.params);
}

// Every asset worth listing: anything the market values, plus rostered players.
function universe() {
  const keys = new Set();
  const last = data.snapshots[data.snapshots.length - 1];
  if (last) for (const k in last.values) if (isPick(k) || cache.players[k]) keys.add(k);
  for (const k of rosterOf().keys()) if (cache.players[k]) keys.add(k);
  return [...keys];
}

// ---- header / status -------------------------------------------------------

function renderHeader() {
  const lg = league();
  $('lv-league').textContent = lg ? `${lg.name} · ${lg.season}` : 'No league connected';
  const bits = [];
  if (cache.syncedAt) bits.push(`Synced ${ago(cache.syncedAt)}`);
  const last = data.snapshots[data.snapshots.length - 1];
  if (last) bits.push(`values ${day(last.date)}`);
  $('lv-status').textContent = bits.join(' · ');
}
function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
function status(msg) { $('lv-status').textContent = msg; }

// ---- values tab ------------------------------------------------------------

function renderValues() {
  const empty = $('values-empty');
  if (!model) {
    empty.hidden = false;
    empty.innerHTML = data.leagueId
      ? 'No Dynasty Daddy values yet. Load them on the <b>Setup</b> tab — they are the starting point every league value is built from.'
      : 'Start on the <b>Setup</b> tab: connect your Sleeper league, then load Dynasty Daddy values.';
    $('values-body').innerHTML = '';
    $('groups').innerHTML = '';
    return;
  }
  empty.hidden = !!data.leagueId;
  if (!data.leagueId) empty.innerHTML = 'Connect your Sleeper league on <b>Setup</b> to learn from its trades.';

  const own = owners(), roster = rosterOf();
  const sel = $('f-owner');
  const prev = sel.value;
  sel.innerHTML = `<option value="">All teams</option><option value="fa">Free agents</option>` +
    [...own].sort((a, b) => a[1].localeCompare(b[1])).map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('');
  sel.value = prev;

  // League-wide tendencies the model has learned, biggest first.
  const groups = [...model.groups()].filter(([, v]) => Math.abs(v) >= 0.01).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6);
  $('groups').innerHTML = groups.length
    ? `<span class="lv-meta" style="border:0;background:none;padding-left:0">League tendencies:</span>` +
      groups.map(([g, v]) => `<span class="${v > 0 ? 'up' : 'down'}">${esc(groupLabel(g))} ${pct(v)}</span>`).join('')
    : '';

  const q = ui.search.toLowerCase();
  const since = Date.now() - 45 * DAY;
  let rows = universe().map(k => {
    const x = model.explain(k);
    return { k, ...x, pos: posOf(k), roster: roster.get(k) };
  }).filter(r => {
    if (ui.pos && r.pos !== ui.pos) return false;
    if (ui.owner === 'fa' && (r.roster || r.pos === 'PICK')) return false;
    if (ui.owner && ui.owner !== 'fa' && String(r.roster) !== ui.owner) return false;
    if (q && !labelOf(r.k).toLowerCase().includes(q)) return false;
    return true;
  });
  const by = { league: r => -r.league, dd: r => -r.dd, up: r => -r.total, down: r => r.total };
  rows.sort((a, b) => by[ui.sort](a) - by[ui.sort](b));
  rows = rows.slice(0, 300);

  $('values-body').innerHTML = rows.map((r, i) => {
    const p = cache.players[r.k];
    const meta = isPick(r.k) ? 'Rookie pick' : `${p?.team || 'FA'}${p?.age ? ' · ' + p.age : ''}`;
    const cls = Math.abs(r.total) < 0.005 ? 'flat' : r.total > 0 ? 'up' : 'down';
    return `<tr data-k="${esc(r.k)}">
      <td class="num lv-meta">${i + 1}</td>
      <td><span class="lv-pos ${r.pos}">${r.pos === 'PICK' ? 'PK' : r.pos}</span><span class="lv-name">${esc(labelOf(r.k))}</span>
        <div class="lv-meta">${esc(meta)}</div></td>
      <td class="hide-sm lv-meta">${esc(own.get(r.roster) || (r.pos === 'PICK' ? '' : 'FA'))}</td>
      <td class="num lv-dd">${fmt(r.dd)}</td>
      <td class="num"><b>${fmt(r.league)}</b></td>
      <td class="num ${cls}">${pct(r.total)}</td>
      <td class="hide-sm">${sparkline(model.history(r.k, since))}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" class="lv-meta">No players match.</td></tr>`;
}

// ---- player sheet ----------------------------------------------------------

function openPlayer(k) {
  const x = model.explain(k);
  const p = cache.players[k];
  const own = owners(), roster = rosterOf();
  const reasons = model.reasons(k).slice().reverse();
  const markers = reasons.filter(r => r.kind !== 'form').map(r => ({ date: r.date, kind: r.kind, title: r.text }));
  const partRow = (label, v, note = '') => `<tr><td>${label}${note ? `<div class="lv-meta">${note}</div>` : ''}</td>
    <td class="num ${Math.abs(v) < 0.005 ? 'flat' : v > 0 ? 'up' : 'down'}">${pct(v)}</td></tr>`;

  $('sheet-body').innerHTML = `
    <div><span class="lv-pos ${posOf(k)}">${posOf(k) === 'PICK' ? 'PK' : posOf(k)}</span><b style="font-size:20px">${esc(labelOf(k))}</b></div>
    <div class="lv-meta">${isPick(k) ? 'Rookie draft pick, valued as a mid-round slot' : esc(`${p?.team || 'FA'}${p?.age ? ' · age ' + p.age : ''} · ${own.get(roster.get(k)) || 'Free agent'}`)}</div>
    <div class="lv-big">
      <div><b>${fmt(x.league)}</b><span>League value</span></div>
      <div><b class="lv-dd">${fmt(x.dd)}</b><span>Dynasty Daddy</span></div>
      <div><b class="${x.total >= 0 ? 'up' : 'down'}">${pct(x.total)}</b><span>Difference</span></div>
    </div>
    ${historyChart(model.history(k), markers)}
    <h2 style="margin-top:16px">Why it differs</h2>
    <table class="lv-parts">
      ${partRow('Trades involving this player', x.parts.trade, 'Learned from accepted and rejected deals; fades without new ones')}
      ${partRow(esc(groupLabel(x.group)), x.parts.group, 'What the league pays for this kind of asset')}
      ${partRow('Scoring format: position', x.parts.formatPos, 'How much this league’s scoring pays the position vs plain PPR')}
      ${partRow('Scoring format: player', x.parts.formatPlayer, 'First downs, TE premium, tiers — this player vs the position average')}
      ${partRow('Recent form', x.parts.form, 'Weekly points vs expectation')}
    </table>
    <h2>What moved it</h2>
    ${reasons.length ? `<ul class="lv-reasons">${reasons.slice(0, 40).map(r => `<li><span class="d">${day(r.date)}</span><span>${esc(r.text)}</span>
      <span class="${r.delta >= 0 ? 'up' : 'down'}">${pct(r.delta)}</span></li>`).join('')}</ul>`
      : '<p class="lv-note">No trades or standout weeks yet — this value is the market number plus the scoring-format adjustment.</p>'}`;
  $('sheet').hidden = false;
}

// ---- asset pickers ---------------------------------------------------------

let pickerOptions = null;
function options() {
  if (pickerOptions) return pickerOptions;
  const keys = new Set(universe());
  const lg = league();
  const base = lg ? +lg.season : new Date().getFullYear();
  for (let y = base; y <= base + 3; y++) for (let r = 1; r <= 4; r++) keys.add(pickKey(y, r));
  const map = new Map();
  for (const k of keys) {
    const p = cache.players[k];
    map.set(isPick(k) ? labelOf(k) : `${labelOf(k)} (${p?.pos || '?'}, ${p?.team || 'FA'})`, k);
  }
  pickerOptions = map;
  let dl = $('lv-assets-dl');
  if (!dl) { dl = document.createElement('datalist'); dl.id = 'lv-assets-dl'; document.body.append(dl); }
  dl.innerHTML = [...map.keys()].sort().map(l => `<option value="${esc(l)}">`).join('');
  return map;
}

function picker(el, onChange) {
  const list = [];
  el.innerHTML = `<div class="lv-asset-list"></div><input class="lv-input" list="lv-assets-dl" placeholder="Add player or pick">`;
  const box = el.firstElementChild, input = el.lastElementChild;
  const draw = () => {
    box.innerHTML = list.map((k, i) => `<div class="lv-asset"><span>${esc(labelOf(k))}</span>
      <span class="lv-meta">${model ? fmt(model.explain(k).league) : ''} <button data-i="${i}" aria-label="Remove">×</button></span></div>`).join('');
  };
  input.addEventListener('focus', options);
  input.addEventListener('change', () => {
    const k = options().get(input.value);
    if (k && !list.includes(k)) { list.push(k); draw(); onChange?.(); }
    input.value = '';
  });
  box.addEventListener('click', e => {
    const i = e.target.dataset?.i;
    if (i != null) { list.splice(+i, 1); draw(); onChange?.(); }
  });
  return { list, clear() { list.length = 0; draw(); }, draw };
}

// ---- trades tab ------------------------------------------------------------

let rjOffered, rjAsked;

function renderTrades() {
  const own = owners();
  const items = [
    ...allTrades().map(t => ({ ...t, kind: 'trade' })),
    ...data.rejected.map(r => ({ ...r, kind: 'rejected' })),
  ].sort((a, b) => b.date - a.date);

  if (!items.length) {
    $('trade-list').innerHTML = `<div class="lv-empty">${data.leagueId ? 'No trades found yet.' : 'Connect your league on Setup to pull its trades.'}</div>`;
    return;
  }
  const at = (k, t) => model ? model.explain(k, t - 1) : { dd: 0, league: 0 };
  const side = (title, keys, t) => {
    const vals = keys.map(k => ({ k, ...at(k, t) }));
    const sum = f => vals.reduce((s, v) => s + v[f], 0);
    return `<div><div class="lv-side-name">${esc(title)}</div><div class="lv-side-assets">
      ${vals.map(v => `<div><span>${esc(labelOf(v.k))}</span><span class="lv-meta">${fmt(v.dd)} → <b>${fmt(v.league)}</b></span></div>`).join('')}</div>
      <div class="lv-side-tot"><span>DD ${fmt(sum('dd'))}</span><span>League ${fmt(sum('league'))}</span></div></div>`;
  };

  $('trade-list').innerHTML = items.slice(0, 200).map(it => {
    if (it.kind === 'rejected') {
      return `<div class="lv-trade"><div class="lv-trade-head"><span><span class="lv-tag rej">Rejected</span> ${day(it.date)}${it.note ? ' · ' + esc(it.note) : ''}</span>
        <button class="lv-link" data-del="${esc(it.id)}">Remove</button></div>
        <div class="lv-trade-sides">${side('Offered', it.proposerGives, it.date)}${side('Asked for', it.receiverGives, it.date)}</div></div>`;
    }
    const ev = model?.evaluated.get(it.id);
    let verdict = '';
    if (ev && ev.sides.length === 2) {
      const [a, b] = ev.sides;
      const g = Math.log(Math.max(a.dd, 1) / Math.max(b.dd, 1));
      const winner = g > 0 ? it.sides[0] : it.sides[1];
      verdict = Math.abs(g) < 0.03 ? 'Even by Dynasty Daddy'
        : `By Dynasty Daddy, ${esc(own.get(winner.roster) || 'Team ' + winner.roster)} got ${Math.round((Math.exp(Math.abs(g)) - 1) * 100)}% more`;
    }
    return `<div class="lv-trade ${it.ignored ? 'ignored' : ''}"><div class="lv-trade-head">
      <span><span class="lv-tag">Accepted</span> ${day(it.date)} · ${verdict}</span>
      <button class="lv-link" data-ignore="${esc(it.id)}">${it.ignored ? 'Count it again' : 'Ignore (dump/collusion)'}</button></div>
      <div class="lv-trade-sides">${it.sides.map(s => side(`${own.get(s.roster) || 'Team ' + s.roster} got`, s.gets, it.date)).join('')}</div></div>`;
  }).join('');
}

function addRejected() {
  if (!rjOffered.list.length || !rjAsked.list.length) { alert('Add at least one asset to each side.'); return; }
  const dateStr = $('rj-date').value;
  const date = dateStr ? Date.parse(dateStr + 'T12:00:00') : Date.now();
  data.rejected.push({
    id: 'rj-' + Date.now().toString(36),
    date: Math.min(date, Date.now()),
    proposerGives: [...rjOffered.list],
    receiverGives: [...rjAsked.list],
    note: $('rj-note').value.trim(),
  });
  save();
  rjOffered.clear(); rjAsked.clear(); $('rj-note').value = '';
  refresh();
}

// ---- trade check -----------------------------------------------------------

let calcA, calcB;
function renderCalc() {
  const out = $('calc-out');
  if (!model) { out.innerHTML = '<p class="lv-note">Load Dynasty Daddy values on Setup first.</p>'; return; }
  if (!calcA.list.length && !calcB.list.length) { out.innerHTML = ''; return; }
  const c = compare(model, calcA.list, calcB.list);
  const say = (a, b) => {
    if (!a || !b) return '—';
    const g = Math.log(a / b);
    if (Math.abs(g) < 0.04) return 'Fair';
    return `Side ${g > 0 ? 'A' : 'B'} wins by ${Math.round((Math.exp(Math.abs(g)) - 1) * 100)}%`;
  };
  out.innerHTML = `<div class="lv-verdict">This league: ${say(c.a.league, c.b.league)}</div>
    <div class="lv-calc-grid">
      <div></div><div><b>Side A</b></div><div><b>Side B</b></div>
      <div>League value</div><div>${fmt(c.a.league)}</div><div>${fmt(c.b.league)}</div>
      <div>Dynasty Daddy</div><div>${fmt(c.a.dd)}</div><div>${fmt(c.b.dd)}</div>
      <div>DD verdict</div><div style="grid-column:span 2">${say(c.a.dd, c.b.dd)}</div>
    </div>
    <p class="lv-note" style="margin-top:8px">Package totals reward consolidation: one great player is worth more than two good ones that add up to the same.</p>`;
}

// ---- setup tab -------------------------------------------------------------

const PARAM_INFO = {
  tradeRate: ['Trade learning rate', 'Share of a trade’s value gap one trade closes'],
  rejectRate: ['Rejected-offer learning rate', 'Weaker: a "no" says less than a "yes"'],
  groupShare: ['Shared with similar players', 'Share of each trade move applied to the position/age group'],
  halfLifeDays: ['Trade memory (days)', 'Trade-learned moves halve over this long'],
  groupHalfLifeDays: ['League tendency memory (days)', ''],
  formRate: ['Weekly form strength', 'Per week, per 100% over/under expectation'],
  formHalfLifeDays: ['Form memory (days)', ''],
  formatPosWeight: ['Scoring edge: position', '0 ignores how your scoring favours a position'],
  formatPlayerWeight: ['Scoring edge: player', '0 ignores first-down/TEP edges within a position'],
  consolidation: ['Consolidation premium', '1 = values just add up; higher favours the stud side'],
  maxStep: ['Max move per event', 'Log units (0.15 ≈ 16%)'],
};

function renderSetup() {
  $('s-league').value = data.leagueId;
  $('s-seasons').value = String(data.seasons);
  const lg = league();
  $('s-scoring').innerHTML = lg ? describeScoring(lg).map(s => `<span>${esc(s)}</span>`).join('') : '';
  const n = data.snapshots.length;
  $('dd-status').textContent = n
    ? `${n} snapshot${n > 1 ? 's' : ''}, ${day(data.snapshots[0].date)} – ${day(data.snapshots[n - 1].date)}. Using ${superflex() ? 'superflex' : '1QB'} values. Load fresh values every few days so the baseline keeps moving with the market.`
    : `No values loaded. They're the baseline every league value starts from (${superflex() ? 'superflex' : '1QB'} values will be used).`;
  $('dd-url').value = data.ddUrl;
  const today = data.ddUrl || DD_TODAY;
  $('dd-link').href = today; $('dd-link').textContent = today;
  $('dd-link-prev').href = prevUrl();

  const P = { ...DEFAULT_PARAMS, ...data.params };
  $('s-params').innerHTML = Object.entries(PARAM_INFO).map(([k, [label, hint]]) =>
    `<label><b>${label}</b><input class="lv-input" type="number" step="any" data-param="${k}" value="${P[k]}">${hint ? `<span>${hint}</span>` : ''}</label>`).join('');
}
function prevUrl() { return (data.ddUrl || DD_TODAY).replace('/today', '/prev'); }

function importDD(json) {
  const snaps = parseDynastyDaddy(json, { superflex: superflex() });
  const count = snaps.reduce((s, x) => s + Object.keys(x.values).length, 0);
  if (!count) throw new Error('No values found — expected rows with sleeper_id and sf_trade_value');
  data.snapshots = mergeSnapshots(data.snapshots, snaps);
  if (!save()) alert('Browser storage is full — older value history was not saved.');
  pickerOptions = null;
  refresh();
  return snaps.length;
}

async function fetchDD(prev) {
  const url = prev ? prevUrl() : (data.ddUrl || DD_TODAY);
  status('Fetching Dynasty Daddy…');
  try {
    const n = importDD(await fetchDynastyDaddy(url));
    status(`Loaded ${n} day${n > 1 ? 's' : ''} of values`);
  } catch (e) {
    status('');
    document.querySelector('.lv-details').open = true;
    alert(`Couldn't fetch from Dynasty Daddy directly (${e.message}). Their API usually only answers its own site — use "Paste the values instead" below.`);
  }
}

// ---- wiring ----------------------------------------------------------------

function refresh() {
  rebuild();
  renderHeader();
  if (ui.tab === 'values') renderValues();
  if (ui.tab === 'trades') renderTrades();
  if (ui.tab === 'calc') { calcA.draw(); calcB.draw(); renderCalc(); }
  if (ui.tab === 'setup') renderSetup();
}

async function runSync() {
  const btn = $('lv-sync');
  btn.disabled = true;
  try {
    await sync(status);
    pickerOptions = null;
    refresh();
  } catch (e) {
    status('');
    alert(e.message);
  } finally {
    btn.disabled = false;
    renderHeader();
  }
}

function setTab(tab) {
  ui.tab = tab;
  document.querySelectorAll('.lv-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('.lv-pane').forEach(p => p.classList.toggle('on', p.id === 'pane-' + tab));
  try { localStorage.setItem('league_values_tab', tab); } catch {}
  refresh();
}

function init() {
  document.querySelectorAll('.lv-tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('lv-sync').addEventListener('click', runSync);

  $('f-search').addEventListener('input', e => { ui.search = e.target.value; renderValues(); });
  $('f-owner').addEventListener('change', e => { ui.owner = e.target.value; renderValues(); });
  $('f-sort').addEventListener('change', e => { ui.sort = e.target.value; renderValues(); });
  $('f-pos').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    ui.pos = b.dataset.pos;
    $('f-pos').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    renderValues();
  });
  $('values-body').addEventListener('click', e => { const tr = e.target.closest('tr[data-k]'); if (tr) openPlayer(tr.dataset.k); });
  $('sheet-x').addEventListener('click', () => { $('sheet').hidden = true; });
  $('sheet').addEventListener('click', e => { if (e.target.id === 'sheet') $('sheet').hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $('sheet').hidden = true; });

  rjOffered = picker($('rj-offered'));
  rjAsked = picker($('rj-asked'));
  $('rj-date').value = new Date().toISOString().slice(0, 10);
  $('rj-add').addEventListener('click', addRejected);
  $('trade-list').addEventListener('click', e => {
    const ig = e.target.dataset?.ignore, del = e.target.dataset?.del;
    if (ig) {
      data.ignored = data.ignored.includes(ig) ? data.ignored.filter(x => x !== ig) : [...data.ignored, ig];
      save(); refresh();
    } else if (del && confirm('Remove this rejected offer?')) {
      data.rejected = data.rejected.filter(r => r.id !== del);
      save(); refresh();
    }
  });

  calcA = picker($('calc-a'), renderCalc);
  calcB = picker($('calc-b'), renderCalc);

  $('s-save').addEventListener('click', () => {
    const raw = $('s-league').value.trim();
    data.leagueId = (raw.match(/\d{6,}/) || [raw])[0];
    data.seasons = +$('s-seasons').value;
    save();
    runSync();
  });
  $('dd-url').addEventListener('change', e => { data.ddUrl = e.target.value.trim(); save(); renderSetup(); });
  $('dd-fetch').addEventListener('click', () => fetchDD(false));
  $('dd-fetch-prev').addEventListener('click', () => fetchDD(true));
  $('dd-import').addEventListener('click', () => {
    try {
      const n = importDD(JSON.parse($('dd-paste').value));
      $('dd-paste').value = '';
      status(`Imported ${n} day${n > 1 ? 's' : ''} of values`);
    } catch (e) { alert(`Couldn't read that: ${e.message}`); }
  });
  $('dd-file').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { importDD(JSON.parse(await f.text())); } catch (err) { alert(`Couldn't read that file: ${err.message}`); }
    e.target.value = '';
  });
  $('s-params').addEventListener('change', e => {
    const k = e.target.dataset.param; if (!k) return;
    const v = parseFloat(e.target.value);
    if (Number.isFinite(v)) data.params[k] = v; else delete data.params[k];
    save(); refresh();
  });
  $('s-reset').addEventListener('click', () => { data.params = {}; save(); refresh(); });
  $('b-export').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportAll()], { type: 'application/json' }));
    a.download = `league-values-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  });
  $('b-import').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { importAll(await f.text()); pickerOptions = null; refresh(); } catch (err) { alert(err.message); }
    e.target.value = '';
  });

  let tab = 'values';
  try { tab = localStorage.getItem('league_values_tab') || tab; } catch {}
  if (!data.leagueId) tab = 'setup';
  setTab(tab);

  // Keep the league current without a click: trades and stats are cheap to re-read.
  if (data.leagueId && Date.now() - cache.syncedAt > 3 * 3600000) runSync();
}

init();
