// Read views for the Universe dashboard: rosters, belts, shows, the log.
//
// Every one of these takes a projection and returns HTML. None of them read the
// store directly, so whatever is on screen is exactly what the event log folds
// down to — including when the header is set to a past date.

import { h, table, chip, wlink, fmtDate, plural } from './dom.js';
import { titleLineage, titleMatches, timelineFor, days, describeThread, activeRivalries, activeAlliances } from '../project.js';
import { currentSeason, seasons, brandStandings, nextStep, PHASES, PHASE_LABEL } from '../season.js';
import { tiers, brandCard, pyramidText } from '../pyramid.js';
import { SHOW_DAYS } from '../schema.js';

// The colour comes off the brand record, because a user who creates WCW picks
// its colour in the form — there is no table of known brands to look it up in.
const brandColor = (state, id) => (state.brands[id] && state.brands[id].color) || 'var(--violet)';
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
        <div class="bar" style="background:${brandColor(state, b.id)}"></div>
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
    const interim = c.interimHolders.map(id => (state.wrestlers[id] ? state.wrestlers[id].name : id)).join(' & ');
    return `<div class="belt" data-belt="${h(c.id)}" style="border-left-color:${brandColor(state, c.brandId)}">
      <div class="nm">${h(c.name)}</div>
      <div class="holder${c.vacant ? ' vacant' : ''}">${c.vacant ? 'VACANT' : h(holders)}</div>
      ${interim ? `<div class="interim">${chip('interim', 'new')} ${h(interim)}</div>` : ''}
      <div class="facts">
        <span>${brandName(state, c.brandId) || 'unbranded'}</span>
        ${c.vacant ? '' : `<span>${c.daysHeld} days</span><span>${plural(c.defenses, 'defense')}</span>`}
        <span>${c.reigns.length ? plural(c.reigns.length, 'reign') : 'never held'}</span>
      </div>
    </div>`;
  }).join('');

  return `<h2>Championships <span class="sub">click a belt for its full lineage</span></h2>
    <div class="belts">${cards}</div>`;
}

// A belt's own page: who has it, everything that happened to it, in order.
export function titlePage(state, titleId) {
  const c = state.championships[titleId];
  if (!c) return '<div class="empty">No such championship.</div>';
  const nm = id => (state.wrestlers[id] ? state.wrestlers[id].name : id);
  const lineage = titleLineage(state, titleId).slice().reverse();
  const matches = titleMatches(state, titleId);
  const longest = c.longestReign;

  const facts = [
    ['Brand', brandName(state, c.brandId) || 'Unbranded'],
    ['Division', c.division || '—'],
    ['Reigns', c.reigns.length],
    ['Defenses', c.totalDefenses],
    ['Longest', longest ? `${longest.days}d` : '—'],
  ].map(([k, v]) => `<div class="fact"><div class="k">${h(k)}</div><div class="v">${h(v)}</div></div>`).join('');

  const holderLine = c.vacant
    ? '<span class="vacant">VACANT</span>'
    : `${c.holders.map(x => wlink(state.wrestlers[x] || { id: x, name: x })).join(' &amp; ')}
       <span class="dim">· ${c.daysHeld} days · ${plural(c.defenses, 'defense')}</span>`;

  const interimLine = c.interimHolders.length
    ? `<div style="margin-top:6px">${chip('interim', 'new')}
       ${c.interimHolders.map(x => wlink(state.wrestlers[x] || { id: x, name: x })).join(' &amp; ')}
       <span class="dim">· since ${h(c.interimSince)}</span></div>` : '';

  // Who holds a belt is a decision, not only a consequence. Booking a match is
  // the usual way it moves, but sometimes the game handed it over off-screen, or
  // the seed guessed wrong, and there should be a way to just say so.
  const setter = `<div class="card" style="margin-bottom:16px">
      <h2>Set the champion <span class="sub">writes a title change dated ${h(state.asOf)} — no match needed</span></h2>
      <div class="row" style="margin-top:0">
        <input type="text" id="champName" placeholder="${c.division === 'tag' ? 'Name &amp; Name' : 'Wrestler name'}"
          style="flex:1;min-width:200px" value="">
        <button class="btn" data-setchamp="${h(c.id)}" data-reason="awarded">Set champion</button>
        <button class="btn ghost" data-setchamp="${h(c.id)}" data-reason="interim">Set interim</button>
        ${c.vacant ? '' : `<button class="btn danger" data-vacate="${h(c.id)}">Vacate</button>`}
      </div>
      <div class="hint" style="margin-top:8px">
        ${c.division === 'tag' ? 'Two names joined with &amp; for a tag title. ' : ''}Everything downstream
        recalculates, and the change lands in the log where it can be voided like anything else.
      </div>
    </div>`;

  return `<div class="backrow">
      <button class="linkbtn" data-tab="titles">← all championships</button>
    </div>
    <div class="pagehead" style="border-left-color:${brandColor(state, c.brandId)}">
      <div class="nm">${h(c.name)}</div>
      <div class="holder">${holderLine}</div>
      ${interimLine}
    </div>
    <div class="facts2">${facts}</div>
    ${setter}

    <h2>Lineage <span class="sub">every reign, newest first · interim runs are marked</span></h2>
    <div class="card flush">${table(lineage, [
      { label: '#', num: true, get: r => r.n, dim: true },
      { label: 'Champion', get: r => h(r.holders.join(' & ')) + (r.interim ? ' ' + chip('interim', 'new') : ''), html: true },
      { label: 'Won', get: r => r.from },
      { label: 'Lost', get: r => r.to || (r.current ? '<span class="dim">current</span>' : '—'), html: true },
      { label: 'Days', num: true, get: r => r.days },
      { label: 'Def.', num: true, get: r => r.defenses },
      { label: 'How', get: r => [r.reason, r.endReason].filter(Boolean).join(' → '), dim: true },
    ], 'Never held.')}</div>

    <h2 style="margin-top:22px">Title matches <span class="sub">${plural(matches.length, 'match')}</span></h2>
    <div class="card flush">${table(matches, [
      { label: 'Date', get: m => m.date, dim: true },
      { label: 'Match', get: m => m.text },
      { label: 'Type', get: m => m.matchType || '', dim: true },
      { label: '', get: m => (m.titleChanged ? chip('title change', 'new') : ''), html: true },
    ], 'No matches for this belt yet.')}</div>`;
}

// ------------------------------------------------------------------ wrestler

// The profile page: record, reigns with day counts, who they are with, who
// they are against, and every event they appear in.
export function wrestlerPage(state, id) {
  const w = state.wrestlers[id];
  if (!w) return '<div class="empty">No such wrestler.</div>';
  const nm = x => (state.wrestlers[x] ? state.wrestlers[x].name : x);
  const tl = timelineFor(state, id);

  const facts = [
    ['Record', w.record.total ? `${w.record.w}-${w.record.l}-${w.record.d}` : '—'],
    ['Win rate', w.record.total ? `${Math.round(w.winPct * 100)}%` : '—'],
    ['Streak', streakCell(w)],
    ['Reigns', w.titleHistory.length],
    ['Appearances', w.appearances],
  ].map(([k, v]) => `<div class="fact"><div class="k">${h(k)}</div><div class="v">${h(v)}</div></div>`).join('');

  const reigns = w.titleHistory.slice().reverse().map(r => ({
    ...r,
    name: state.championships[r.titleId] ? state.championships[r.titleId].name : r.titleId,
    dayCount: r.to ? r.days : days(r.from, state.asOf),
  }));

  const tie = rows => table(rows, [
    { label: 'Who', get: r => wlink(state.wrestlers[r.with] || { id: r.with, name: r.with }), html: true },
    { label: 'Heat', num: true, get: r => r.heat },
    { label: 'From', get: r => Object.entries(r.why).map(([k, n]) => `${k}${n > 1 ? ` ×${n}` : ''}`).join(', '), dim: true },
    { label: 'Last', get: r => r.last, dim: true },
    { label: '', get: r => (r.active ? '' : '<span class="dim">cooled off</span>'), html: true },
  ], 'Nothing yet.');

  const status = [
    statusChip(w) || chip('active', 'brand'),
    w.brandId ? chip(brandName(state, w.brandId), 'brand') : chip('free agent', 'fa'),
    ...w.titles.map(t => chip(state.championships[t].name, 'title')),
    ...w.groups.map(g => chip(state.groups[g].name, 'group')),
  ].join(' ');

  const notes = [];
  if (w.injury) notes.push(`Injured since ${h(w.injury.since)}${w.injury.description ? ` — ${h(w.injury.description)}` : ''} (${days(w.injury.since, state.asOf)} days out)`);
  if (w.contract) notes.push(`Under contract since ${h(w.contract.since)}${w.contract.expires ? `, expires ${h(w.contract.expires)}` : ''}`);
  else notes.push('No contract — free agent');

  const threads = state.threads.filter(t => t.subjects.includes(id) || t.about === id).map(t => describeThread(state, t));

  return `<div class="backrow"><button class="linkbtn" data-tab="roster">← roster</button></div>
    <div class="pagehead" style="border-left-color:${brandColor(state, w.brandId)}">
      <div class="nm">${h(w.name)}</div>
      <div class="holder">${status}</div>
      <div class="dim" style="margin-top:6px">${notes.join(' · ')}</div>
    </div>
    <div class="facts2">${facts}</div>

    <div class="cols">
      <div>
        <h2>Rivalries <span class="sub">built from attacks, losses and promos</span></h2>
        <div class="card flush">${tie(w.rivals.slice(0, 8))}</div>
      </div>
      <div>
        <h2>Alliances <span class="sub">built from tag wins and saves</span></h2>
        <div class="card flush">${tie(w.allies.slice(0, 8))}</div>
      </div>
    </div>

    <h2 style="margin-top:22px">Title reigns</h2>
    <div class="card flush">${table(reigns, [
      { label: 'Championship', get: r => `<span class="belt-link" data-belt="${h(r.titleId)}">${h(r.name)}</span>${r.interim ? ' ' + chip('interim', 'new') : ''}`, html: true },
      { label: 'Won', get: r => r.from },
      { label: 'Lost', get: r => r.to || '<span class="dim">current</span>', html: true },
      { label: 'Days', num: true, get: r => r.dayCount },
    ], 'Never held a championship.')}</div>

    ${threads.length ? `<h2 style="margin-top:22px">Open threads</h2>
      <div class="card flush">${table(threads, [
        { label: 'Thread', get: t => h(t.line), html: true },
        { label: 'Open', num: true, get: t => `${t.age}d` },
      ])}</div>` : ''}

    <h2 style="margin-top:22px">Timeline <span class="sub">${plural(tl.length, 'segment')}, newest first</span></h2>
    <div class="card flush">${table(tl, [
      { label: 'Date', get: r => r.date, dim: true },
      { label: 'Type', get: r => r.type, dim: true },
      { label: 'What', get: r => r.text },
      { label: 'As', get: r => r.role, dim: true },
      { label: '', get: r => `<button class="linkbtn" data-ev="${h(r.id)}">open</button>`, html: true },
    ], 'Has not appeared yet.')}</div>`;
}

// ------------------------------------------------------------------ threads

export function threadsView(state) {
  const open = state.threads.map(t => describeThread(state, t));
  const closed = state.threadsClosed.slice(-25).reverse().map(t => describeThread(state, t));

  const kindChip = t => chip(t.kind.replace('-', ' '), t.kind === 'betrayal' ? 'down' : t.kind === 'title-shot' ? 'title' : t.kind === 'injury' ? 'hurt' : 'brand');

  return `<h2>Open threads <span class="sub">oldest first — the longer one sits, the louder it is</span></h2>
    <div class="card flush">${table(open.map(t => ({ ...t, _cls: t.stale ? 'stale' : '' })), [
      { label: 'Kind', get: kindChip, html: true },
      { label: 'Thread', get: t => h(t.line), html: true },
      { label: 'Since', get: t => t.opened, dim: true },
      { label: 'Open', num: true, get: t => `${t.age}d` },
      { label: '', get: t => `<button class="linkbtn" data-resolve="${h(t.id)}">resolve</button>`, html: true },
    ], 'Nothing hanging — every question the log opened has been answered.')}</div>

    <h2 style="margin-top:22px">Recently closed <span class="sub">answered by an event, or marked resolved</span></h2>
    <div class="card flush">${table(closed, [
      { label: 'Kind', get: kindChip, html: true },
      { label: 'Thread', get: t => h(t.line), html: true },
      { label: 'Open for', num: true, get: t => `${t.age}d` },
      { label: 'Closed by', get: t => t.closedWhy, dim: true },
    ], 'Nothing closed yet.')}</div>`;
}

// ------------------------------------------------------------------ pyramid

// The shape of the universe, drawn as it reads:
//
//     Raw | SmackDown | Dynamite
//               ↓
//              NXT
//               ↓
//             Evolve
//
// Every rung is derived from the `tier` number on each brand, so a save with
// six tiers draws six rows and one with two draws two. Nothing here knows the
// name of a single brand.
export function brandsView(state, ui = {}) {
  const rows = tiers(state);
  const editing = ui.editing || null;      // brand id, or 'new'

  const rungs = rows.map((t, i) => `
    <div class="rung">
      <div class="rungmeta">
        <div class="tiernum">Tier ${t.tier}</div>
        <div class="tierlabel">${h(t.label)}</div>
      </div>
      <div class="rungbrands">
        ${t.brands.map(b => {
          const card = brandCard(state, b.id);
          const belts = card.championships.length;
          return `<button class="brandcard${editing === b.id ? ' on' : ''}" data-editbrand="${h(b.id)}"
              style="--bc:${h(b.color || 'var(--violet)')}">
            <div class="bhead">
              <span class="blogo">${h(b.logo || '●')}</span>
              <span class="bname">${h(b.name)}</span>
              ${b.abbr ? `<span class="babbr">${h(b.abbr)}</span>` : ''}
            </div>
            <div class="bfacts">
              ${b.day ? `<span>${h(b.day)}s</span>` : '<span class="dim">no show day</span>'}
              <span>${plural(card.size, 'wrestler')}</span>
              <span>${plural(belts, 'title')}</span>
            </div>
            <div class="bmoves">
              ${card.promotesTo ? `<span class="up">↑ ${h(state.brands[card.promotesTo].name)}</span>` : '<span class="dim">top of the pyramid</span>'}
              ${card.relegatesTo ? `<span class="down">↓ ${h(state.brands[card.relegatesTo].name)}</span>` : '<span class="dim">bottom</span>'}
            </div>
            ${card.parent ? `<div class="bparent">develops for ${h(card.parent.name)}</div>` : ''}
          </button>`;
        }).join('')}
      </div>
    </div>
    ${i < rows.length - 1 ? '<div class="rungarrow">↓</div>' : ''}`).join('');

  return `<h2>The pyramid <span class="sub">${h(pyramidText(state))}</span></h2>
    <div class="pyramid">${rungs}</div>
    <div class="row">
      <button class="btn" data-editbrand="new">New show</button>
      <span class="hint">Tiers are just numbers — add a tier 4 and the pyramid grows a rung.
        Promotion, relegation and the draft all read this, never a brand name.</span>
    </div>
    ${editing ? brandForm(state, editing) : ''}
    ${brandTable(state)}`;
}

function brandForm(state, id) {
  const b = id === 'new' ? { tier: (tiers(state).slice(-1)[0] || { tier: 0 }).tier + 1 } : (state.brands[id] || {});
  const isNew = id === 'new';
  const parents = Object.values(state.brands).filter(x => x.id !== id);

  const field = (label, input, hint = '') =>
    `<label class="opt col"><span>${h(label)}</span>${input}${hint ? `<em class="hint">${h(hint)}</em>` : ''}</label>`;

  return `<div class="card" id="brandForm" style="margin:16px 0">
    <h2>${isNew ? 'New show' : `Edit ${h(b.name)}`}</h2>
    <div class="formgrid">
      ${field('Name', `<input id="bfName" type="text" value="${h(b.name || '')}" placeholder="Dynamite">`)}
      ${field('Short name', `<input id="bfAbbr" type="text" value="${h(b.abbr || '')}" placeholder="DYN">`)}
      ${field('Logo', `<input id="bfLogo" type="text" value="${h(b.logo || '')}" placeholder="⚡" maxlength="4">`, 'an emoji or a character')}
      ${field('Colour', `<input id="bfColor" type="color" value="${h(b.color || '#7C5CFF')}">`)}
      ${field('Tier', `<input id="bfTier" type="number" min="1" step="1" value="${h(b.tier == null ? 1 : b.tier)}">`, '1 is the top of the pyramid')}
      ${field('Show day', `<select id="bfDay">
          <option value="">—</option>
          ${SHOW_DAYS.map(d => `<option value="${d}"${b.day === d ? ' selected' : ''}>${d}</option>`).join('')}
        </select>`)}
      ${field('Develops for', `<select id="bfParent">
          <option value="">— the tier above in general —</option>
          ${parents.map(p => `<option value="${h(p.id)}"${b.parentId === p.id ? ' selected' : ''}>${h(p.name)} (tier ${p.tier == null ? 1 : p.tier})</option>`).join('')}
        </select>`, 'optional: send promotions to one brand')}
    </div>
    <div class="row">
      <button class="btn" data-savebrand="${h(id)}">${isNew ? 'Create show' : 'Save changes'}</button>
      <button class="btn ghost" data-editbrand="">Cancel</button>
      ${isNew ? '' : `<span class="hint">Championships and roster are managed from the belt pages and the roster import.</span>`}
    </div>
  </div>`;
}

function brandTable(state) {
  const rows = Object.values(state.brands).map(b => brandCard(state, b.id))
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  return `<h2 style="margin-top:22px">Every show</h2>
    <div class="card flush">${table(rows, [
      { label: 'Show', get: b => `<span class="blogo">${h(b.logo || '●')}</span> <strong>${h(b.name)}</strong>`, html: true },
      { label: 'Tier', num: true, get: b => b.tier },
      { label: 'Day', get: b => b.day || '—', dim: true },
      { label: 'Roster', num: true, get: b => b.size },
      { label: 'Titles', get: b => b.championships.map(c => chip(c.name.replace(/ Championship$/, ''), 'title')).join(' ') || '<span class="dim">none</span>', html: true },
      { label: 'Promotes to', get: b => (b.promotesTo ? h(state.brands[b.promotesTo].name) : '—'), dim: true },
      { label: 'Relegates to', get: b => (b.relegatesTo ? h(state.brands[b.relegatesTo].name) : '—'), dim: true },
      { label: '', get: b => `<button class="linkbtn" data-editbrand="${h(b.id)}">edit</button>`, html: true },
    ], 'No shows yet.')}</div>`;
}

// ------------------------------------------------------------------ season

export function seasonView(state, ui = {}) {
  const all = seasons(state);
  const season = currentSeason(state);
  const tables = brandStandings(state, season);
  const flagged = Object.values(state.wrestlers).filter(w => /flagged$/.test(w.status));
  const proposal = ui.proposal || null;
  const step = nextStep(state, season);

  // The year in order, with the current phase lit. Every marker is a date from
  // the log — there is no calendar stored anywhere.
  const marks = { wrestlemania: season.wrestlemania, lastStand: season.lastStand, draft: season.draft };
  const timeline = `<div class="phases">${PHASES.map(ph => {
    const done = ph === 'regular' ? !!season.wrestlemania
      : ph === 'newSeason' ? false
      : !!marks[ph];
    const on = season.phase === ph;
    const when = marks[ph] ? marks[ph].date : null;
    return `<div class="phase${on ? ' on' : ''}${done ? ' done' : ''}">
      <div class="pname">${h(PHASE_LABEL[ph])}</div>
      <div class="pwhen">${when ? h(when) : on ? 'now' : '—'}</div>
    </div>`;
  }).join('<div class="parrow">→</div>')}</div>`;

  const standings = tables.map(b => `<div class="card flush">
      <div class="brandhead">
        <div class="bar" style="background:${brandColor(state, b.id)}"></div>
        <div class="nm">${h(b.name)}</div>
        <div class="ct">${(b.tier || 1) > 1 ? `tier ${b.tier}` : 'main roster'} · ${plural(b.table.length, 'wrestler')}</div>
      </div>
      ${table(b.table, [
        { label: 'Wrestler', get: r => wlink(state.wrestlers[r.id]), html: true },
        { label: 'G', get: r => (r.gender === 'female' ? 'F' : r.gender === 'male' ? 'M' : '?'), dim: true },
        { label: 'W-L-D', num: true, get: r => `${r.w}-${r.l}-${r.d}` },
        { label: 'Pts', num: true, get: r => r.points },
        { label: 'Title matches', num: true, get: r => r.titleMatches || '', dim: true },
        { label: '', get: r => statusChip(state.wrestlers[r.id]), html: true },
      ], 'Nobody on this brand.')}
    </div>`).join('');

  const proposalBlock = proposal ? `
    <h2 style="margin-top:22px">Proposed lists <span class="sub">nothing is written until you confirm</span></h2>
    <div class="card flush">${table(proposal, [
      { label: 'Wrestler', get: p => h(p.name), html: true },
      { label: 'Show', get: p => p.fromName, dim: true },
      { label: 'G', get: p => (p.gender === 'female' ? 'F' : 'M'), dim: true },
      { label: 'List', get: p => chip(p.flag === 'relegation-flagged' ? '↓ relegation' : '↑ promotion', p.flag === 'relegation-flagged' ? 'down' : 'up'), html: true },
      { label: 'At stake', get: p => (p.toward && state.brands[p.toward] ? state.brands[p.toward].name : '—'), dim: true },
      { label: 'Record', get: p => p.record, dim: true },
      { label: 'Why', get: p => p.why, dim: true },
    ])}</div>
    ${(proposal.skipped || []).length ? `<div class="msg warn">
      ${proposal.skipped.map(sk => `${h(sk.brandName)} ${h(sk.flag.replace('-flagged', ''))} (${h(sk.gender)}): ${h(sk.why)} — no match, so nobody is flagged`).join('<br>')}
    </div>` : ''}
    <div class="row"><button class="btn" id="flagsCommit">Write ${plural(proposal.filter(p => !p.alreadyFlagged).length, 'flag')}</button>
      <button class="btn ghost" id="flagsCancel">Cancel</button></div>` : '';

  // Last Stand, as competitions rather than a list of matches: one block per
  // brand, per gender, per direction, because that is the unit that settles a
  // single spot.
  const ls = ui.lastStandProposal;
  const bracket = ls ? `
    <h2 style="margin-top:22px">Last Stand <span class="sub">promotion and relegation are separate competitions, decided inside each show</span></h2>
    <div class="bracketgrid">${ls.groups.map(g => `
      <div class="bracket ${g.direction}" style="--bc:${brandColor(state, g.brandId)}">
        <h3>${h(g.brandName)} <small>${g.direction} · ${g.gender === 'female' ? 'women' : 'men'}</small></h3>
        <div class="bmeta">${g.resolved
          ? `settled — ${h((g.outcome || []).map(w => w.name).join(', '))} ${g.direction === 'relegation' ? `drops to ${h(g.toBrandName)}` : `goes up to ${h(g.toBrandName)}`}`
          : g.decides
            ? `round ${g.round} decides it: ${g.direction === 'relegation' ? `the loser drops to ${h(g.toBrandName)}` : `the winner goes up to ${h(g.toBrandName)}`}`
            : `round ${g.round} — qualifier, nobody moves yet`}</div>
        <ol>${g.matches.map(m => `<li>${h(m.a.name)} <span class="dim">vs</span> ${h(m.b.name)}</li>`).join('')
          || '<li class="dim">no match to book</li>'}</ol>
        ${g.bye ? `<div class="bmeta dim">${h(g.bye.name)} has a bye into the next round</div>` : ''}
      </div>`).join('')}</div>
    <div class="card entry" style="margin-top:14px">
      <textarea id="lastStandText" spellcheck="false" style="min-height:160px" readonly>${h(ui.lastStand || '')}</textarea>
      <div class="row">
        <button class="btn" id="lastStandUse">Send to the entry box</button>
        <button class="btn ghost" id="lastStandCopy">Copy</button>
        <button class="btn ghost" id="lastStandCancel">Close</button>
        <span class="hint">Enter the results, then press Book Last Stand again for the next round.</span>
      </div>
    </div>` : '';

  const history = all.length > 1 ? `
    <h2 style="margin-top:22px">Seasons <span class="sub">every year on record</span></h2>
    <div class="card flush">${table(all.slice().reverse(), [
      { label: 'Season', num: true, get: x => x.n },
      { label: 'From', get: x => x.from },
      { label: 'To', get: x => x.to || '—', dim: true },
      { label: 'WrestleMania', get: x => (x.wrestlemania ? x.wrestlemania.date : '—'), dim: true },
      { label: 'Last Stand', get: x => (x.lastStand ? x.lastStand.date : '—'), dim: true },
      { label: 'Draft', get: x => (x.draft ? x.draft.date : '—'), dim: true },
      { label: 'Phase', get: x => chip(x.phaseLabel, x.current ? 'new' : 'brand'), html: true },
    ])}</div>` : '';

  return `<div class="pagehead" style="border-left-color:var(--gold)">
      <div class="nm">Season ${season.n} — ${h(season.phaseLabel)}</div>
      <div class="holder">${h(season.from)} → ${season.to ? h(season.to) : 'in progress'}</div>
      <div class="dim" style="margin-top:6px"><strong>Next:</strong> ${h(step.do)}${step.then ? ` — then ${h(step.then)}` : ''}</div>
    </div>

    ${timeline}

    <div class="row" style="margin-top:0">
      <button class="btn${season.phase === 'wrestlemania' ? '' : ' ghost'}" id="flagsPropose">Work out the lists</button>
      <button class="btn${season.phase === 'lastStand' ? '' : ' ghost'}" id="lastStandPropose"${flagged.length ? '' : ' disabled'}>Book Last Stand</button>
      ${tiers(state).map(t => (t.brands.length > 1
        ? `<button class="btn${season.phase === 'draft' ? '' : ' ghost'}" data-draftpropose="${t.tier}">Draft tier ${t.tier}</button>` : '')).join('')}
      <span class="hint">Champions are never relegated.</span>
    </div>
    ${proposalBlock}
    ${bracket}
    ${ui.draft ? draftView(state, ui.draft) : ''}

    ${flagged.length ? `<h2 style="margin-top:22px">On the lists <span class="sub">${plural(flagged.length, 'name')}</span></h2>
      <div class="card flush">${table(flagged, [
        { label: 'Wrestler', get: w => wlink(w), html: true },
        { label: 'Show', get: w => brandName(state, w.brandId) || '—', dim: true },
        { label: 'G', get: w => (w.gender === 'female' ? 'F' : 'M'), dim: true },
        { label: 'List', get: w => statusChip(w), html: true },
      ])}</div>` : ''}

    ${history}

    <h2 style="margin-top:22px">Standings <span class="sub">wins this season — 3 points a win, 1 a draw</span></h2>
    <div class="grid">${standings}</div>`;
}

// ------------------------------------------------------------------ draft

// The draft board: one column per brand, picks in order, snaking. Champions sit
// at the top of their column greyed as protected, and a name dragged along by a
// tag partner is marked, so you can see why a column filled up the way it did.
export function draftView(state, proposal) {
  if (!proposal) return '';
  if (!proposal.picks.length && !proposal.protected.length) {
    return `<div class="msg warn">${h(proposal.why || 'Nothing to draft on this tier.')}</div>`;
  }

  const cols = proposal.order.map(o => {
    const held = proposal.protected.filter(w => w.brandId === o.brandId);
    const picks = proposal.picks.filter(p => p.brandId === o.brandId);
    return `<div class="draftcol" style="--bc:${brandColor(state, o.brandId)}">
      <h3>${h(o.name)} <small>${plural(held.length + picks.length, 'name')}</small></h3>
      <ol>
        ${held.map(w => `<li class="protected"><span class="rd">—</span>
            <span class="nm">${h(w.name)}</span> <span class="hint">champion</span></li>`).join('')}
        ${picks.map(p => `<li class="${p.team ? 'team ' : ''}${p.from !== p.brandId ? 'moved' : ''}">
            <span class="rd">${p.round}.</span>
            <span class="nm">${h(p.name)}</span>
            ${p.from === p.brandId ? '<span class="hint">stays</span>'
              : `<span class="hint">from ${h(state.brands[p.from] ? state.brands[p.from].name : 'free agency')}</span>`}
          </li>`).join('')}
      </ol>
    </div>`;
  }).join('');

  const moving = proposal.picks.filter(p => p.from !== p.brandId).length;
  return `<div class="msg ok">
      <strong>Tier ${proposal.tier}</strong> · order ${h(proposal.order.map(o => o.name).join(' → '))}
      (weakest season first, snaking) · ${plural(proposal.rounds, 'round')} ·
      <strong>${plural(moving, 'wrestler')}</strong> would change brand
      ${proposal.protected.length ? ` · ${plural(proposal.protected.length, 'champion')} protected` : ''}
    </div>
    <div class="draftgrid">${cols}</div>
    <div class="row">
      <button class="btn" data-draftcommit="${proposal.tier}">Run the draft</button>
      <button class="btn ghost" data-draftcancel="1">Cancel</button>
      <span class="hint">Only the ${plural(moving, 'move')} get written — anyone staying put costs nothing.</span>
    </div>`;
}

// ------------------------------------------------------------------ heat

// The dashboard panel: who is feuding, who is together, hottest first.
export function heatPanel(state) {
  const nmw = id => wlink(state.wrestlers[id] || { id, name: id });
  const rows = list => table(list, [
    { label: 'Pair', get: r => `${nmw(r.a)} <span class="dim">vs</span> ${nmw(r.b)}`, html: true },
    { label: 'Heat', num: true, get: r => r.heat },
    { label: 'Meetings', num: true, get: r => r.meetings, dim: true },
    { label: 'Last', get: r => r.last, dim: true },
  ], 'Nothing running.');

  const bonds = list => table(list, [
    { label: 'Pair', get: r => `${nmw(r.a)} <span class="dim">&amp;</span> ${nmw(r.b)}`, html: true },
    { label: 'Bond', num: true, get: r => r.heat },
    { label: 'From', get: r => Object.keys(r.why).join(', '), dim: true },
    { label: 'Last', get: r => r.last, dim: true },
  ], 'Nothing running.');

  const threads = state.threads.slice(0, 5).map(t => describeThread(state, t));

  return `<div class="cols" style="margin-top:16px">
    <div>
      <h2>Active rivalries <span class="sub">heat decays without new events</span></h2>
      <div class="card flush">${rows(activeRivalries(state, 8))}</div>
    </div>
    <div>
      <h2>Active alliances</h2>
      <div class="card flush">${bonds(activeAlliances(state, 6))}</div>
      <h2 style="margin-top:16px">Oldest open threads
        <span class="sub">${plural(state.threads.length, 'open')}</span></h2>
      <div class="card flush">${table(threads, [
        { label: 'Thread', get: t => h(t.line), html: true },
        { label: 'Open', num: true, get: t => `${t.age}d` },
      ], 'Nothing hanging.')}</div>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ shows

export function showsView(state) {
  if (!state.shows.length) return '<div class="empty">No shows yet — enter a card on the Tonight tab.</div>';
  return [...state.shows].reverse().map(s => `<div class="card flush" style="margin-bottom:16px">
      <div class="brandhead">
        <div class="bar" style="background:${brandColor(state, s.brandId)}"></div>
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
