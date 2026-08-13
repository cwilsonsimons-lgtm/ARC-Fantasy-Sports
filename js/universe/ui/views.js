// Read views for the Universe dashboard: rosters, belts, shows, the log.
//
// Every one of these takes a projection and returns HTML. None of them read the
// store directly, so whatever is on screen is exactly what the event log folds
// down to — including when the header is set to a past date.

import { h, table, chip, wlink, fmtDate, plural } from './dom.js';
import { titleLineage, timelineFor, days } from '../project.js';

const BRAND_COLOR = { 'b:raw': 'var(--raw)', 'b:smackdown': 'var(--smackdown)', 'b:nxt': 'var(--nxt)' };
const brandColor = id => BRAND_COLOR[id] || 'var(--violet)';
const brandName = (state, id) => (id && state.brands[id] ? state.brands[id].name : null);

const genderMark = g => (g === 'female' ? 'F' : g === 'male' ? 'M' : g ? '·' : '?');

function statusChip(w) {
  if (w.injury) return chip('injured', 'hurt');
  if (w.status === 'promotion-flagged') return chip('↑ promotion', 'up');
  if (w.status === 'relegation-flagged') return chip('↓ relegation', 'down');
  if (w.status === 'free agent') return chip('free agent', 'fa');
  if (w.status === 'released') return chip('released', 'fa');
  return '';
}

const recordCell = w => (w.record.total ? `${w.record.w}-${w.record.l}-${w.record.d}` : '—');
const streakCell = w => (w.streak.n ? `${w.streak.n}${w.streak.type === 'w' ? 'W' : 'L'}` : '—');

const titlesCell = (state, w) => w.titles
  .map(t => chip(state.championships[t] ? state.championships[t].name.replace(/ Championship$/, '') : t, 'title')).join('');

const groupsCell = (state, w) => w.groups
  .map(g => chip(state.groups[g] ? state.groups[g].name : g, 'group')).join('');

// ------------------------------------------------------------------ roster

export function rosterView(state) {
  const cols = [
    { label: 'Wrestler', get: w => wlink(w), html: true },
    { label: 'G', get: w => genderMark(w.gender), dim: true },
    { label: 'Status', get: w => statusChip(w), html: true },
    { label: 'W-L-D', num: true, get: recordCell },
    { label: 'Streak', num: true, get: streakCell, dim: true },
    { label: 'Titles', get: w => titlesCell(state, w), html: true },
    { label: 'Group', get: w => groupsCell(state, w), html: true },
  ];

  const brands = Object.values(state.brands).map(b => {
    const roster = b.roster.map(id => state.wrestlers[id]);
    const m = roster.filter(w => w.gender === 'male').length;
    const f = roster.filter(w => w.gender === 'female').length;
    return `<div class="card flush">
      <div class="brandhead">
        <div class="bar" style="background:${brandColor(b.id)}"></div>
        <div class="nm">${h(b.name)}</div>
        <div class="ct">${plural(roster.length, 'wrestler')} · ${m}M / ${f}F · ${plural(b.champions.length, 'title')}</div>
      </div>
      ${table(roster, cols, 'Nobody is on this brand.')}
    </div>`;
  }).join('');

  const fa = state.freeAgents.map(id => state.wrestlers[id]);
  const faCard = `<div class="card flush">
    <div class="brandhead">
      <div class="bar" style="background:var(--ink-3)"></div>
      <div class="nm">Free agents</div>
      <div class="ct">${plural(fa.length, 'wrestler')}</div>
    </div>
    ${table(fa, cols, 'Everyone is under contract.')}
  </div>`;

  const groups = Object.values(state.groups).filter(g => g.active && g.members.length);
  const groupCard = `<div class="card flush">
    <div class="brandhead">
      <div class="bar" style="background:var(--violet)"></div>
      <div class="nm">Tag teams &amp; factions</div>
      <div class="ct">${plural(groups.length, 'group')}</div>
    </div>
    ${table(groups, [
      { label: 'Name', get: g => `<strong>${h(g.name)}</strong>`, html: true },
      { label: 'Kind', get: g => (g.kind === 'tagTeam' ? 'tag team' : g.kind), dim: true },
      { label: 'Brand', get: g => brandName(state, g.brandId) || '—', dim: true },
      { label: 'Members', get: g => g.members.map(m => (state.wrestlers[m] ? wlink(state.wrestlers[m]) : h(m))).join(', '), html: true },
      { label: 'Since', get: g => g.formedOn || '—', dim: true },
    ], 'No teams or factions yet.')}
  </div>`;

  return `<div class="grid">${brands}${faCard}${groupCard}</div>`;
}

// ------------------------------------------------------------------ titles

export function titlesView(state) {
  const belts = Object.values(state.championships).filter(c => !c.retired);
  if (!belts.length) return '<div class="empty">No championships.</div>';

  const cards = belts.map(c => {
    const holders = c.holders.map(id => (state.wrestlers[id] ? state.wrestlers[id].name : id)).join(' & ');
    const reign = c.reigns[c.reigns.length - 1];
    return `<div class="belt" data-belt="${h(c.id)}" style="border-left-color:${brandColor(c.brandId)}">
      <div class="nm">${h(c.name)}</div>
      <div class="holder${c.vacant ? ' vacant' : ''}">${c.vacant ? 'Vacant' : h(holders)}</div>
      <div class="facts">
        <span>${brandName(state, c.brandId) || 'unbranded'}</span>
        ${c.vacant ? '' : `<span>${c.daysHeld} days</span><span>${plural(reign ? reign.defenses : 0, 'defense')}</span>`}
        <span>${plural(c.reigns.length, 'reign')}</span>
      </div>
    </div>`;
  }).join('');

  return `<h2>Championships <span class="sub">click a belt for its full lineage</span></h2>
    <div class="belts">${cards}</div>`;
}

export function lineageSheet(state, titleId) {
  const c = state.championships[titleId];
  const rows = titleLineage(state, titleId).slice().reverse();
  return {
    title: c.name,
    body: `<div class="facts2">
        <div class="fact"><div class="k">Holder</div><div class="v">${c.vacant ? 'Vacant' : h(c.holders.map(x => state.wrestlers[x] ? state.wrestlers[x].name : x).join(' & '))}</div></div>
        <div class="fact"><div class="k">Days</div><div class="v">${c.daysHeld}</div></div>
        <div class="fact"><div class="k">Reigns</div><div class="v">${c.reigns.length}</div></div>
        <div class="fact"><div class="k">Defenses</div><div class="v">${c.totalDefenses}</div></div>
      </div>
      ${table(rows, [
        { label: '#', num: true, get: r => r.n },
        { label: 'Champion', get: r => h(r.holders.join(' & ')), html: true },
        { label: 'Won', get: r => r.from },
        { label: 'Lost', get: r => r.to || '—', dim: true },
        { label: 'Days', num: true, get: r => r.days },
        { label: 'Def.', num: true, get: r => r.defenses },
      ], 'Never held.')}`,
  };
}

// ------------------------------------------------------------------ wrestler

export function wrestlerSheet(state, id) {
  const w = state.wrestlers[id];
  if (!w) return { title: 'Unknown', body: '<div class="empty">No such wrestler.</div>' };
  const tl = timelineFor(state, id).slice(0, 40);

  const facts = [
    ['Brand', brandName(state, w.brandId) || 'Free agent'],
    ['Record', w.record.total ? `${w.record.w}-${w.record.l}-${w.record.d}` : '—'],
    ['Streak', streakCell(w)],
    ['Appearances', w.appearances],
  ].map(([k, v]) => `<div class="fact"><div class="k">${h(k)}</div><div class="v">${h(v)}</div></div>`).join('');

  const lines = [];
  if (w.titles.length) lines.push(`Holding ${w.titles.map(t => h(state.championships[t].name)).join(', ')}`);
  if (w.groups.length) lines.push(`Part of ${w.groups.map(g => h(state.groups[g].name)).join(', ')}`);
  if (w.injury) lines.push(`Injured since ${w.injury.since}${w.injury.description ? ` — ${h(w.injury.description)}` : ''} (${days(w.injury.since, state.asOf)} days)`);
  if (w.contract) lines.push(`Under contract since ${w.contract.since}${w.contract.expires ? `, expires ${w.contract.expires}` : ''}`);
  else lines.push('No contract');

  return {
    title: w.name,
    body: `<div class="facts2">${facts}</div>
      <div class="msg ok" style="background:none;border-color:var(--line);color:var(--ink-2)">
        ${statusChip(w) || chip('active', 'brand')} ${lines.map(l => `<div style="margin-top:4px">${l}</div>`).join('')}
      </div>
      <h2>Timeline <span class="sub">${plural(tl.length, 'segment')}, newest first</span></h2>
      ${table(tl, [
        { label: 'Date', get: r => r.date, dim: true },
        { label: 'Type', get: r => r.type, dim: true },
        { label: 'What', get: r => r.text },
        { label: 'As', get: r => r.role, dim: true },
      ], 'Has not appeared yet.')}`,
  };
}

// ------------------------------------------------------------------ shows

export function showsView(state) {
  if (!state.shows.length) return '<div class="empty">No shows yet — enter a card on the Tonight tab.</div>';
  return [...state.shows].reverse().map(s => `<div class="card flush" style="margin-bottom:16px">
      <div class="brandhead">
        <div class="bar" style="background:${brandColor(s.brandId)}"></div>
        <div class="nm">${h(s.name)}</div>
        <div class="ct">${fmtDate(s.date)} · ${brandName(state, s.brandId) || 'no brand'} · ${plural(s.segments.length, 'segment')}</div>
      </div>
      ${table(s.segments, [
        { label: '#', num: true, get: g => g.order || '' },
        { label: 'Type', get: g => g.type, dim: true },
        { label: 'Segment', get: g => g.text },
        { label: 'Id', get: g => `<span class="mono">${h(g.id)}</span>`, html: true },
      ], 'Empty card.')}
    </div>`).join('');
}

// ------------------------------------------------------------------ log

export function logView(store, state, { limit = 120 } = {}) {
  const rows = store.effectiveEvents({ includeVoided: true }).slice(-limit).reverse();
  const nameOf = ref => (state.wrestlers[ref] ? state.wrestlers[ref].name
    : state.groups[ref] ? state.groups[ref].name
    : state.championships[ref] ? state.championships[ref].name : ref);

  const body = table(rows.map(e => ({ ...e, _cls: `logrow${e.voided ? ' voided' : ''}` })), [
    { label: 'Id', get: e => `<span class="mono">${h(e.id)}</span>`, html: true },
    { label: 'Date', get: e => e.date, dim: true },
    { label: 'Type', get: e => e.type },
    { label: 'Who', get: e => h(e.participants.map(p => nameOf(p.ref)).join(', ')), html: true },
    { label: 'Note', get: e => h([e.amended ? `amended ×${e.amended}` : '', e.note].filter(Boolean).join(' · ')), html: true },
    {
      label: '', get: e => e.voided
        ? `<button class="linkbtn" data-restore="${h(e.id)}">restore</button>`
        : `<button class="linkbtn" data-ev="${h(e.id)}">open</button><button class="linkbtn warn" data-void="${h(e.id)}">void</button>`,
      html: true,
    },
  ], 'Nothing logged yet.');

  const cx = store.doc.corrections.slice().reverse().slice(0, 40);
  const cxTable = table(cx, [
    { label: 'Id', get: c => `<span class="mono">${h(c.id)}</span>`, html: true },
    { label: 'When', get: c => c.at.slice(0, 16).replace('T', ' '), dim: true },
    { label: 'Op', get: c => c.op },
    { label: 'Target', get: c => `<span class="mono">${h(c.targetId)}</span>`, html: true },
    { label: 'Note', get: c => c.note || '', dim: true },
  ], 'No corrections — nothing has needed fixing.');

  return `<h2>Event log <span class="sub">newest first · voided events stay in the log</span></h2>
    <div class="card flush">${body}</div>
    <h2 style="margin-top:22px">Correction log <span class="sub">every edit and void, in order</span></h2>
    <div class="card flush">${cxTable}</div>`;
}

// One event, with the buttons that correct it.
export function eventSheet(store, state, id) {
  const raw = store.getEvent(id);
  if (!raw) return { title: 'Unknown', body: '<div class="empty">No such event.</div>' };
  const ev = store.applied(raw);
  const voided = store.isVoided(id);
  const nameOf = ref => (state.wrestlers[ref] ? state.wrestlers[ref].name : ref);

  // Sides, so a mis-typed result can be fixed by clicking the right corner.
  const sides = [...new Set(ev.participants.map(p => p.side).filter(s => s != null))].sort();
  const fixer = ev.type === 'match' && sides.length > 1 ? `
    <h2>Wrong result?</h2>
    <div class="row">${sides.map(s => {
      const refs = ev.participants.filter(p => p.side === s);
      const isWinner = refs.some(p => p.role === 'winner');
      return `<button class="btn ${isWinner ? '' : 'ghost'}" data-winner="${h(id)}:${s}"${isWinner ? ' disabled' : ''}>
        ${isWinner ? '✓ ' : ''}${h(refs.map(p => nameOf(p.ref)).join(' & '))}</button>`;
    }).join('')}</div>
    <div class="hint" style="margin-top:6px">Picking a different corner writes a correction — records, streaks and title reigns all recalculate.</div>` : '';

  const cx = store.historyOf(id);

  return {
    title: `${ev.type} · ${ev.id}`,
    body: `${voided ? '<div class="msg warn">This event is voided. It stays in the log but is left out of every projection.</div>' : ''}
      <div class="facts2">
        <div class="fact"><div class="k">Date</div><div class="v">${h(ev.date)}</div></div>
        <div class="fact"><div class="k">Type</div><div class="v">${h(ev.type)}</div></div>
        <div class="fact"><div class="k">Source</div><div class="v" style="font-size:13px">${h(ev.source)}</div></div>
      </div>
      ${ev.note ? `<div class="msg ok" style="background:none;border-color:var(--line);color:var(--ink-2)">${h(ev.note)}</div>` : ''}
      ${fixer}
      <h2 style="margin-top:18px">Participants</h2>
      ${table(ev.participants, [
        { label: 'Who', get: p => h(nameOf(p.ref)), html: true },
        { label: 'Role', get: p => p.role, dim: true },
        { label: 'Side', num: true, get: p => (p.side == null ? '—' : p.side), dim: true },
      ], 'Nobody.')}
      <h2 style="margin-top:18px">Effects <span class="sub">what this event asserts</span></h2>
      ${table(ev.effects, [
        { label: 'Kind', get: f => f.kind },
        { label: 'Detail', get: f => Object.entries(f).filter(([k]) => k !== 'kind')
            .map(([k, v]) => `${k}=${Array.isArray(v) ? v.map(nameOf).join('+') : (state.wrestlers[v] ? nameOf(v) : v)}`).join('  '), dim: true },
      ], 'No effects.')}
      ${cx.length ? `<h2 style="margin-top:18px">Corrections</h2>${table(cx, [
        { label: 'Id', get: c => c.id },
        { label: 'Op', get: c => c.op },
        { label: 'Note', get: c => c.note || '', dim: true },
      ])}` : ''}
      <div class="row" style="margin-top:20px">
        ${voided
          ? `<button class="btn ghost" data-restore="${h(id)}">Restore this event</button>`
          : `<button class="btn danger" data-void="${h(id)}">Void this event</button>`}
      </div>`,
  };
}

export { brandColor, brandName, statusChip };
