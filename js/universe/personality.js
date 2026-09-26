// Universe — personalities and relationships on screen.
//
// The owner sees everything from the start: every trait, every relationship,
// and why each one exists. Nothing is hidden, scouted or discovered.
//
// Traits are the owner's alone - set here, dated, and never changed because of
// a result. Relationships are worked out from the record (relations.js), so
// each one has a timeline, oldest first, of what caused every change. The
// owner can ignore any automatic change, and start, set, end or annotate any
// relationship by hand - dated entries on the same timeline, which can be
// taken back. Incidents (a betrayal, an interference, an attack) are logged
// on the show they happened on.
import * as M from './model.js';
import * as RL from './relations.js';
import {
  ICON, INCIDENT, avatar, empty, esc, field, incidentText, options, section, select, showColor, showName, sideName, stampLabel, wrestlerOptions,
} from './ui.js';
import { closeSheet, commit, confirmThen, openSheet, paintSheet, pushPage, refresh, uni } from './app.js';

const { RULES } = RL;

// what each trait means, and what (if anything) it does to relationships
const TRAIT = {
  ambitious: ['Ambitious', 'Wants the gold above everything.', 'Losing a title in a match starts their grudge at heat 2, not 1.'],
  loyal: ['Loyal', 'Sticks by partners and friends.',
    `Allies with a partner after ${RULES.alliesLoyal} matches on the same side, not ${RULES.allies}. Being betrayed hurts more: heat 3.`],
  opportunistic: ['Opportunistic', 'Looks out for number one.', 'Can become allies with a partner, but never friends just from teaming up.'],
  'hot-headed': ['Hot-headed', 'Quick to anger.',
    `A grudge after ${RULES.streakHotHeaded} straight losses to someone, not ${RULES.streak}. Being attacked: heat 2.`],
  patient: ['Patient', 'Slow to anger.', `A grudge only after ${RULES.streakPatient} straight losses to someone, not ${RULES.streak}.`],
  proud: ['Proud', 'Hates to look weak.', null],
  cowardly: ['Cowardly', 'Would rather not fight fair.', null],
  respectful: ['Respectful', 'Shakes hands after a hard loss.', null],
};
const NO_EFFECT = 'For your booking — it doesn’t change a relationship by itself.';
const traitName = t => TRAIT[t][0];

const KIND = {
  grudge: { label: 'Grudge', color: '#FF5A4E', level: 'heat' },
  rivals: { label: 'Rivals', color: '#F0A53A', level: 'heat' },
  allies: { label: 'Allies', color: '#72C4FF', level: 'strength' },
  friends: { label: 'Friends', color: '#4CD37A', level: 'strength' },
  'former-partners': { label: 'Former partners', color: '#98A3B3', level: null },
};
const ORDER = Object.keys(KIND);
const kindChip = kind => `<span class="uv-rk" style="--k:${KIND[kind].color}">${KIND[kind].label}</span>`;
const dots = r => (KIND[r.kind].level ? `<span class="uv-lv" style="--k:${KIND[r.kind].color}" title="${KIND[r.kind].level} ${r.level} of 3">`
  + `${[1, 2, 3].map(i => `<i${i <= r.level ? ' class="on"' : ''}></i>`).join('')}</span>` : '');
const when = (st, at) => (at ? stampLabel(st, at) : 'Start');
const nm = (st, id) => (M.wrestlerById(st, id) || { name: '(deleted)' }).name;
const other = (r, wid) => (r.a === wid ? r.b : r.a);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function uvOpenPair(a, b) { pushPage('pair', `${a}+${b}`); }

// ================================================================ the wrestler's page

// how close something is to changing: losing runs and partnerships, closest first
function buildingOf(st, d, wid) {
  const out = [];
  const needOf = l => (d.has(l, 'hot-headed', null) ? RULES.streakHotHeaded : d.has(l, 'patient', null) ? RULES.streakPatient : RULES.streak);
  d.streak.forEach((n, key) => {
    const [l, w] = key.split('>');
    if (!n || (l !== wid && w !== wid)) return;
    const need = needOf(l);
    const g = d.rels.get(RL.relKey('grudge', l, w));
    const next = `${need - n} more in a row ${g && g.active ? 'adds heat' : 'makes a grudge'}`;
    const run = n === 1 ? 'last time' : `the last ${n} times`;
    out.push({ other: l === wid ? w : l, left: need - n, n, of: need,
      text: l === wid ? `Lost to ${nm(st, w)} ${run} — ${next}` : `${nm(st, l)} lost to them ${run} — ${next}` });
  });
  d.together.forEach((n, p) => {
    const [x, y] = p.split('+');
    if (x !== wid && y !== wid) return;
    const mate = x === wid ? y : x;
    const alliesAt = d.has(x, 'loyal', null) || d.has(y, 'loyal', null) ? RULES.alliesLoyal : RULES.allies;
    const on = kind => (d.rels.get(RL.relKey(kind, x, y)) || {}).active;
    const opportunist = d.has(x, 'opportunistic', null) || d.has(y, 'opportunistic', null);
    const teamed = `Teamed with ${nm(st, mate)} ${plural(n, 'time')}`;
    if (n < alliesAt && !on('allies')) out.push({ other: mate, left: alliesAt - n, n, of: alliesAt, text: `${teamed} — allies at ${alliesAt}` });
    else if (n < RULES.friends && !on('friends') && !opportunist) {
      out.push({ other: mate, left: RULES.friends - n, n, of: RULES.friends, text: `${teamed} — friends at ${RULES.friends}` });
    }
  });
  return out.sort((p, q) => p.left - q.left);
}

// one row per person, with everything between them
function relRows(st, rels, wid) {
  const by = new Map();
  rels.forEach(r => { const o = other(r, wid); if (!by.has(o)) by.set(o, []); by.get(o).push(r); });
  return [...by].map(([oid, list]) => {
    const o = M.wrestlerById(st, oid);
    return `<div class="uv-row uv-relrow" data-pair="${oid}" onclick="uvOpenPair('${wid}','${oid}')">${avatar(st, o)}
      <div class="uv-main"><div class="nm">${esc(o.name)}</div>
        ${list.map(r => `<div class="uv-rl" data-rel="${esc(r.key)}">${kindChip(r.kind)}<span>${esc(RL.relText(st, r))}
          <em>since ${when(st, r.since)}</em></span>${dots(r)}</div>`).join('')}</div>
      <span class="uv-chev">${ICON.right}</span></div>`;
  }).join('');
}

function traitLine(st, e) {
  const name = traitName(e.trait);
  const text = e.at ? (e.on ? `Became <b>${esc(name.toLowerCase())}</b>` : `No longer <b>${esc(name.toLowerCase())}</b>`)
    : (e.on ? `<b>${esc(name)}</b> from the start` : `Not <b>${esc(name.toLowerCase())}</b> after all — from the start`);
  return `<div class="uv-tl"><span class="w">${when(st, e.at)}</span><span class="x">${text}${e.note ? ` <span class="uv-muted">— ${esc(e.note)}</span>` : ''}</span></div>`;
}

/** The Personality and Relationships sections of a wrestler's page. */
export function uvProfilePersonality(st, w) {
  const d = RL.relationships(st);
  const rels = RL.relationsOf(st, w.id, d);
  const hist = M.traitHistory(st, w.id);
  const building = buildingOf(st, d, w.id).slice(0, 5);
  return `
    ${section('Personality', w.traits.length || null)}
    ${w.traits.length ? `<div class="uv-traits read">${w.traits.map(t => `<div class="uv-trait on" data-trait="${t}"><b>${esc(traitName(t))}</b>
      <span>${esc(TRAIT[t][1])}</span><span class="fx">${esc(TRAIT[t][2] || NO_EFFECT)}</span></div>`).join('')}</div>`
      : '<div class="uv-none">No traits set. Traits shape how relationships grow — and only you change them.</div>'}
    <div class="uv-page-acts"><div class="uv-btn" onclick="uvEditTraits('${w.id}')">${ICON.edit}Edit personality</div></div>
    ${hist.length ? `<div class="uv-sub">Personality history</div><div class="uv-tls">${hist.map(e => traitLine(st, e)).join('')}</div>` : ''}

    ${section('Relationships', rels.length || null)}
    ${rels.length ? relRows(st, rels, w.id) : '<div class="uv-none">No relationships right now.</div>'}
    ${building.length ? `<div class="uv-sub">Building up</div>${building.map(b => `<div class="uv-li uv-bu" onclick="uvOpenPair('${w.id}','${b.other}')">
      <span class="uv-left">${b.n}/${b.of}</span><span>${esc(b.text)}</span></div>`).join('')}` : ''}
    <div class="uv-page-acts"><div class="uv-btn" onclick="uvRelSheet('${w.id}')">${ICON.plus}Add or change a relationship</div></div>
    <p class="uv-p uv-inset-p"><span class="uv-link" onclick="uvHowRelations()">How relationships work</span></p>`;
}

// ================================================================ two wrestlers

function entryRow(st, e, pairLink = false) {
  const { cause, result } = RL.entryText(st, e);
  const ev = e.cause.event;
  const act = e.auto
    ? (e.ignored ? `<span class="uv-link" onclick="event.stopPropagation();uvRestoreChange('${esc(e.key)}')">Count it again</span>`
      : `<span class="uv-link" onclick="event.stopPropagation();uvIgnoreChange('${esc(e.key)}')">Ignore</span>`)
    : `<span class="uv-link" onclick="event.stopPropagation();uvTakeBackRel('${e.cause.edit.id}')">Take back</span>`;
  return `<div class="uv-ent${e.ignored ? ' ignored' : ''}${e.auto ? '' : ' own'}" style="--k:${KIND[e.kind].color}" data-entry="${esc(e.key)}"
      ${pairLink ? `onclick="uvOpenPair('${e.a}','${e.b}')"` : ''}>
    <div class="w">${when(st, e.at)}</div>
    <div class="x"><div class="c">${esc(cause)}</div>
      <div class="r">→ ${esc(result)}</div>
      ${e.ignored ? `<div class="ig">Ignored by you${e.ignored.note ? ` — ${esc(e.ignored.note)}` : ''}. It doesn’t count.</div>` : ''}
      ${pairLink ? '' : `<div class="a"><span>${e.auto ? 'Automatic' : 'Your change'}</span>${act}${ev ? `<span class="uv-link" onclick="event.stopPropagation();uvOpenEvent('${ev}')">Open the show</span>` : ''}</div>`}
    </div></div>`;
}

/** The page for two wrestlers: what's between them now, what's building, and the whole timeline. */
export function uvPairPage(id) {
  const st = uni();
  const [a, b] = String(id).split('+');
  const A = M.wrestlerById(st, a), B = M.wrestlerById(st, b);
  if (!A || !B) return null;
  const d = RL.relationships(st);
  const pv = RL.pairView(st, a, b, d);
  const now = pv.rels.filter(r => r.active).sort((x, y) => ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind));
  const p = pv.progress;
  const runs = p.losses.filter(x => x.n > 0);
  const opportunist = d.has(a, 'opportunistic', null) || d.has(b, 'opportunistic', null);
  const person = w => `<div class="p" onclick="uvOpenWrestler('${w.id}')">${avatar(st, w, 'lg')}<b>${esc(w.name)}</b>
    <span>${esc(showName(st, w.showId))}</span>
    <span class="tr">${w.traits.length ? esc(w.traits.map(traitName).join(', ')) : 'No traits set'}</span></div>`;
  return {
    title: `${A.name} & ${B.name}`,
    body: `
      <div class="uv-pairhead" style="--c:${showColor(st, A.showId)}">${person(A)}<div class="amp">&amp;</div>${person(B)}</div>
      <div class="uv-page-acts">
        <div class="uv-btn pri" onclick="uvRelSheet('${a}','${b}')">${ICON.edit}Change…</div>
        <div class="uv-btn" onclick="uvHowRelations()">How it works</div>
      </div>

      ${section('Now', now.length || null)}
      ${now.length ? `<div class="uv-rels">${now.map(r => `<div class="uv-relnow" style="--k:${KIND[r.kind].color}" data-rel="${esc(r.key)}">
        ${kindChip(r.kind)}<div class="uv-main"><div class="nm">${esc(RL.relText(st, r))}</div>
        <div class="sub">${RL.levelText(r) ? `${esc(RL.levelText(r))} of 3 · ` : ''}since ${when(st, r.since)}</div></div>${dots(r)}</div>`).join('')}</div>`
        : '<div class="uv-none">Nothing between them right now.</div>'}

      ${section('Building up', null)}
      <div class="uv-build">
        ${runs.length ? runs.map(x => `<div>${esc(nm(st, x.loser))} has lost ${x.n} in a row to ${esc(nm(st, x.winner))} —
          ${(d.rels.get(RL.relKey('grudge', x.loser, x.winner)) || {}).active ? 'more heat' : 'a grudge'} at ${x.need}</div>`).join('')
          : '<div>No losing run between them. A win resets one.</div>'}
        <div>${p.together ? `On the same side ${plural(p.together, 'time')}.` : 'Never on the same side.'} Allies at ${p.alliesAt}${opportunist
          ? '; never friends from teaming up (opportunistic)' : `, friends at ${p.friendsAt}`}.</div>
      </div>

      ${section('Timeline', pv.entries.length || null)}
      ${pv.entries.length ? `<div class="uv-ents">${pv.entries.map(e => entryRow(st, e)).join('')}</div>`
        : '<div class="uv-none">Nothing has happened between them yet.</div>'}
      <div class="uv-fix">
        <div class="h">Fix a mistake</div>
        <div class="fine">An automatic change you don’t agree with: tap <b>Ignore</b> on it. It stays on the timeline, crossed out,
          and everything after it is worked out again without it. Your own changes can be taken back.</div>
        <div class="fine">A wrong result or incident: correct it on its show — every relationship built on it follows.</div>
      </div>`,
  };
}

export function uvIgnoreChange(key) {
  const st = uni();
  const e = RL.relationships(st).entries.find(x => x.key === key);
  if (!e) return;
  confirmThen('Ignore this change?',
    `“${RL.entryText(st, e).result}” won’t count. It stays on the timeline, crossed out, and you can count it again any time. Everything after it is worked out again without it.`,
    'Ignore it', () => { const before = RL.snapshot(uni()); commit(s => M.dismissChange(s, key), () => `Ignored${uvRelNews(before)}`); });
}
export function uvRestoreChange(key) {
  const before = RL.snapshot(uni());
  commit(st => M.restoreChange(st, key), () => `Counted again${uvRelNews(before)}`);
}
export function uvTakeBackRel(editId) {
  const st = uni();
  const e = RL.relationships(st).entries.find(x => !x.auto && x.cause.edit.id === editId);
  confirmThen('Take back your change?',
    `${e ? `“${RL.entryText(st, e).result}” comes off the timeline. ` : ''}Everything after it is worked out again without it.`,
    'Take it back', () => { const before = RL.snapshot(uni()); commit(s => M.deleteRelEdit(s, editId), () => `Taken back${uvRelNews(before)}`); });
}

/** After a change: what it did to relationships, as a tail for the toast (or ''). */
export function uvRelNews(before) {
  const st = uni();
  const news = RL.changesBetween(st, before, RL.snapshot(st));
  return news.length ? ` — ${news[0]}${news.length > 1 ? ` (+${news.length - 1} more)` : ''}` : '';
}
/** A snapshot to hand uvRelNews after a change. */
export function uvRelBefore() { return RL.snapshot(uni()); }

// what a change would do, tried on a copy - never on the real thing
function preview(apply) {
  const st = uni();
  try {
    const copy = JSON.parse(JSON.stringify(st));
    apply(copy);
    return RL.changesBetween(copy, RL.snapshot(st), RL.snapshot(copy));
  } catch (e) {
    if (e instanceof M.UniverseError) return null;
    throw e;
  }
}
const previewBox = (news, idle) => `<div class="uv-prev"><b>What it changes</b>${news == null ? `<span>${esc(idle)}</span>`
  : news.length ? news.map(x => `<span>${esc(x)}</span>`).join('') : '<span>No relationship changes.</span>'}</div>`;

// ================================================================ editing a relationship

let rd = null;

/** Start, set, end or note a relationship - two wrestlers fixed, one, or none. */
export function uvRelSheet(a = '', b = '', kind = '') {
  rd = { a, b, fixA: !!a, fixB: !!b, kind: kind || 'grudge', dir: 'ab', action: '', level: 1, since: 'now', note: '' };
  openSheet(relSheet);
}

function relSheet() {
  const st = uni();
  if (!rd) return null;
  if ((rd.fixA && !M.wrestlerById(st, rd.a)) || (rd.fixB && !M.wrestlerById(st, rd.b))) return null;
  if (st.wrestlers.length < 2) return { title: 'Relationship', body: empty(ICON.user, 'Add wrestlers first', 'A relationship needs two wrestlers.') };
  const both = rd.a && rd.b && rd.a !== rd.b;
  const [x, y] = rd.kind === 'grudge' && rd.dir === 'ba' ? [rd.b, rd.a] : [rd.a, rd.b];
  const d = both ? RL.relationships(st) : null;
  const r = both ? d.rels.get(RL.relKey(rd.kind, x, y)) : null;
  const active = !!(r && r.active);
  const lv = KIND[rd.kind].level;
  const acts = active ? [...(lv ? [['level', `Set the ${lv}`]] : []), ['end', 'End it'], ['note', 'Add a note']] : [['form', 'Start it'], ['note', 'Add a note']];
  if (!acts.some(([k]) => k === rd.action)) rd.action = acts[0][0];
  const seg = (list, cur, fn) => `<div class="uv-seg">${list.map(([k, lb]) => `<div class="${String(cur) === String(k) ? 'on' : ''}" data-v="${k}"
    onclick="${fn}('${k}')">${esc(lb)}</div>`).join('')}</div>`;
  const s = M.activeSeason(st);
  if (rd.action === 'end' || rd.action === 'note') rd.since = 'now';   // an ending, or a note, is dated
  const input = { action: rd.action, kind: rd.kind, a: x, b: y, level: rd.level, since: rd.since, note: rd.note };
  const news = both ? preview(copy => M.editRelationship(copy, input)) : null;
  return {
    title: rd.fixA && rd.fixB ? `${esc(nm(st, rd.a))} & ${esc(nm(st, rd.b))}` : 'Relationship',
    body: `
      ${rd.fixA && rd.fixB ? '' : `<div class="uv-grid">
        ${field('Wrestler', rd.fixA ? `<div class="uv-in ro">${esc(nm(st, rd.a))}</div>` : select("uvRelSet('a',this.value)", wrestlerOptions(st, rd.a, '— Pick a wrestler —', [rd.b]), ' id="uvRelA"'), 'wide')}
        ${field('And', select("uvRelSet('b',this.value)", wrestlerOptions(st, rd.b, '— Pick a wrestler —', [rd.a]), ' id="uvRelB"'), 'wide')}
      </div>`}
      <div class="uv-pills tight">${ORDER.map(k => `<div class="uv-pill${rd.kind === k ? ' on' : ''}" data-kind="${k}" onclick="uvRelSet('kind','${k}')">
        <span class="uv-dot" style="--c:${KIND[k].color}"></span>${KIND[k].label}</div>`).join('')}</div>
      ${both && rd.kind === 'grudge' ? `<div class="uv-sub flush">Who holds it</div>${seg([['ab', `${nm(st, rd.a)} → ${nm(st, rd.b)}`], ['ba', `${nm(st, rd.b)} → ${nm(st, rd.a)}`]], rd.dir, 'uvRelDir')}` : ''}
      ${both ? `<div class="uv-note">${active ? `Now: <b>${esc(RL.relText(st, r))}</b>${lv ? ` — ${esc(RL.levelText(r))} of 3` : ''}.`
        : `Not now: ${esc(RL.relText(st, { kind: rd.kind, a: x, b: y }).replace(' holds a grudge', ' holds no grudge').replace(' are ', ' are not '))}.`}</div>
      <div class="uv-sub flush">Change</div>${seg(acts, rd.action, 'uvRelAction')}
      ${(rd.action === 'form' || rd.action === 'level') && lv ? `<div class="uv-sub flush">${lv === 'heat' ? 'Heat' : 'Strength'}</div>
        ${seg([[1, '1 · mild'], [2, '2'], [3, '3 · all-out']], rd.level, 'uvRelLevel')}` : ''}
      ${rd.action === 'form' || rd.action === 'level' ? `<div class="uv-sub flush">Counts from</div>
      ${seg([['now', `This week (W${s.week})`], ['start', 'The start']], rd.since, 'uvRelSince')}
      <div class="fine">${rd.since === 'start' ? 'From the start: as if it had always been so — for history from before your universe began. It counts before every result.'
        : 'This week: from now on. Everything before stays as it was.'}</div>` : ''}
      <div style="margin-top:10px">${field(rd.action === 'note' ? 'Note' : 'Why (optional)', `<input id="uvRelNote" class="uv-in" maxlength="60" value="${esc(rd.note)}"
        placeholder="${rd.action === 'note' ? 'e.g. Still bitter about Mania' : 'e.g. Feud from before the universe'}" oninput="uvRelNote(this.value)">`, 'wide')}</div>
      ${previewBox(news, rd.action === 'note' ? 'Only a note on the timeline.' : '')}
      <div class="uv-btn pri full" onclick="uvRelSave()">Save</div>` : '<p class="uv-p">Pick two wrestlers.</p>'}`,
  };
}
export function uvRelSet(k, v) { rd[k] = v; if (k !== 'kind') rd.dir = 'ab'; paintSheet(); }
export function uvRelDir(v) { rd.dir = v; paintSheet(); }
export function uvRelAction(v) { rd.action = v; paintSheet(); }
export function uvRelLevel(v) { rd.level = Number(v); paintSheet(); }
export function uvRelSince(v) { rd.since = v; paintSheet(); }
export function uvRelNote(v) { rd.note = v; }
export function uvRelSave() {
  const [x, y] = rd.kind === 'grudge' && rd.dir === 'ba' ? [rd.b, rd.a] : [rd.a, rd.b];
  const before = RL.snapshot(uni());
  const r = commit(st => M.editRelationship(st, { action: rd.action, kind: rd.kind, a: x, b: y, level: rd.level, since: rd.since, note: rd.note }),
    () => `Saved${uvRelNews(before)}`);
  if (r.ok) closeSheet();
}

// ================================================================ editing a personality

let td = null;

export function uvEditTraits(id) {
  const st = uni();
  const w = M.wrestlerById(st, id);
  if (!w) return;
  // a first personality is who they've always been; later ones are a change
  td = { id, on: new Set(w.traits), since: M.traitHistory(st, id).length ? 'now' : 'start', note: '' };
  openSheet(traitSheet);
}

function traitSheet() {
  const st = uni();
  const w = td && M.wrestlerById(st, td.id);
  if (!w) return null;
  const adds = M.TRAITS.filter(t => td.on.has(t) && !w.traits.includes(t));
  const drops = w.traits.filter(t => !td.on.has(t));
  const s = M.activeSeason(st);
  const seg = (list, cur, fn) => `<div class="uv-seg">${list.map(([k, lb]) => `<div class="${cur === k ? 'on' : ''}" data-v="${k}"
    onclick="${fn}('${k}')">${esc(lb)}</div>`).join('')}</div>`;
  const news = adds.length || drops.length ? preview(copy => M.setTraits(copy, td.id, [...td.on], { since: td.since })) : [];
  return {
    title: `${esc(w.name)}’s personality`,
    body: `
      <p class="uv-p">Pick any traits. They never change on their own — a result, however bad, doesn’t rewrite who someone is.
        Only you do, here.</p>
      <div class="uv-traits">${M.TRAITS.map(t => `<div class="uv-trait${td.on.has(t) ? ' on' : ''}" data-trait="${t}" onclick="uvTraitToggle('${t}')">
        <b>${esc(traitName(t))}</b><span>${esc(TRAIT[t][1])}</span><span class="fx">${esc(TRAIT[t][2] || NO_EFFECT)}</span></div>`).join('')}</div>
      ${adds.length || drops.length ? `
        <div class="uv-note">${[adds.length && `Adds ${adds.map(traitName).join(', ')}`, drops.length && `Removes ${drops.map(traitName).join(', ')}`].filter(Boolean).join(' · ')}.</div>
        <div class="uv-sub flush">Counts from</div>
        ${seg([['now', `This week (W${s.week})`], ['start', 'The start']], td.since, 'uvTraitSince')}
        <div class="fine">${td.since === 'start' ? 'From the start: as if they’d always been this way. Past relationships are worked out again with it.'
          : 'This week: from now on. What already happened stays as it was — traits count as they were at the time.'}</div>
        <div style="margin-top:10px">${field('Why (optional)', `<input id="uvTraitNote" class="uv-in" maxlength="60" value="${esc(td.note)}"
          placeholder="e.g. Snapped after WrestleMania" oninput="uvTraitNote(this.value)">`, 'wide')}</div>
        ${td.since === 'start' || news.length ? previewBox(news, '') : ''}
        <div class="uv-btn pri full" onclick="uvTraitSave()">Save</div>` : '<div class="uv-btn full" onclick="uvCloseSheet()">Done</div>'}`,
  };
}
export function uvTraitToggle(t) { if (td.on.has(t)) td.on.delete(t); else td.on.add(t); paintSheet(); }
export function uvTraitSince(v) { td.since = v; paintSheet(); }
export function uvTraitNote(v) { td.note = v; }
export function uvTraitSave() {
  const before = RL.snapshot(uni());
  const r = commit(st => M.setTraits(st, td.id, [...td.on], { since: td.since, note: td.note }), () => `Personality saved${uvRelNews(before)}`);
  if (r.ok) closeSheet();
}

// ================================================================ incidents on a show

const matchName = (st, ev, id) => {
  const i = ev.matches.findIndex(m => m.id === id);
  return i < 0 ? '' : `Match ${i + 1}: ${ev.matches[i].sides.map(sd => sideName(st, sd)).join(' vs ')}`;
};

/** The show page's Incidents section, and what changed between wrestlers there. */
export function uvIncidentsBlock(st, ev) {
  const d = RL.relationships(st);
  const here = d.entries.filter(e => e.cause.event === ev.id);
  return `
    ${section('Incidents', ev.incidents.length || null)}
    ${ev.incidents.map(inc => `<div class="uv-inc" data-inc="${inc.id}" onclick="uvIncident('${ev.id}','${inc.id}')">
      <span class="uv-rk" style="--k:${INCIDENT[inc.kind].color}">${INCIDENT[inc.kind].label}</span>
      <div class="uv-main"><div class="nm">${esc(incidentText(st, inc))}</div>
        ${inc.match || inc.note || inc.story ? `<div class="sub">${esc([inc.match && matchName(st, ev, inc.match), inc.note,
          inc.story && 'From a story suggestion'].filter(Boolean).join(' · '))}</div>` : ''}</div>
      <span class="uv-chev">${ICON.edit}</span></div>`).join('')}
    ${ev.incidents.length ? '' : '<div class="uv-none">A betrayal, a run-in, an attack, a challenge — whatever you saw in the game besides the results goes here.</div>'}
    <div class="uv-page-acts"><div class="uv-btn" onclick="uvIncident('${ev.id}')">${ICON.plus}Record an incident</div></div>
    ${here.length ? `${section('Relationships', here.length)}<div class="uv-ents">${here.map(e => entryRow(st, e, true)).join('')}</div>` : ''}`;
}

let ic = null;

export function uvIncident(eventId, incId = '') {
  const ev = M.eventById(uni(), eventId);
  const inc = incId && ev && ev.incidents.find(x => x.id === incId);
  ic = inc ? { eventId, incId, kind: inc.kind, by: [...inc.by], on: [...inc.on], helped: [...inc.helped], match: inc.match || '', note: inc.note,
    title: inc.title || '', team: inc.team || '', disband: false }
    : { eventId, incId: '', kind: 'betrayal', by: [''], on: [''], helped: [], match: '', note: '', title: '', team: '', disband: true };
  openSheet(incidentSheet);
}
const incidentInput = () => ({ kind: ic.kind, by: ic.by, on: ic.on, helped: ic.helped, match: ic.match || null, note: ic.note,
  title: ic.title || null, team: ic.team || null });
// a walk-out can split the team up at the same time - only when it's new, and the team is still together
const splits = st => ic.kind === 'breakup' && !ic.incId && ic.disband && ic.team && (M.teamById(st, ic.team) || {}).active;
function saveIncident(st) {
  const inc = ic.incId ? M.updateIncident(st, ic.eventId, ic.incId, incidentInput()) : M.recordIncident(st, ic.eventId, incidentInput());
  if (splits(st)) M.setTeamActive(st, ic.team, false);
  return inc;
}

function incidentSheet() {
  const st = uni();
  const ev = ic && M.eventById(st, ic.eventId);
  if (!ev || (ic.incId && !ev.incidents.some(x => x.id === ic.incId))) return null;
  const k = INCIDENT[ic.kind];
  const picks = (list, label, optional = false) => `<div class="uv-sidebox"><div class="h"><span>${esc(label)}</span></div>
    ${ic[list].map((wid, j) => `<div class="uv-pick">${select(`uvIcPick('${list}',${j},this.value)`, wrestlerOptions(st, wid), ` data-${list}="${j}"`)}
      ${ic[list].length > 1 || optional ? `<div class="uv-ic sm" onclick="uvIcDrop('${list}',${j})">${ICON.x}</div>` : ''}</div>`).join('')}
    <div class="uv-add" onclick="uvIcAdd('${list}')">${ICON.plus}${ic[list].length ? 'Add another' : 'Add someone'}</div></div>`;
  const titles = st.titles.filter(t => t.active || t.id === ic.title);
  const teams = st.teams.filter(t => t.members.length || t.id === ic.team);
  const news = preview(copy => saveIncident(copy));
  return {
    title: ic.incId ? 'Edit the incident' : 'Record an incident',
    body: `
      <p class="uv-p">${esc(ev.name)} — what you saw in the game besides the results.</p>
      <div class="uv-pills tight">${Object.keys(INCIDENT).map(x => `<div class="uv-pill${ic.kind === x ? ' on' : ''}" data-v="${x}" onclick="uvIcKind('${x}')">
        <span class="uv-dot" style="--c:${INCIDENT[x].color}"></span>${INCIDENT[x].label}</div>`).join('')}</div>
      <div class="fine" style="margin:4px 0 10px">${esc(k.text)}</div>
      ${ev.matches.length ? field('During', select("uvIcSet('match',this.value)", options([['', '— Not during a match —'],
        ...ev.matches.map(m => [m.id, matchName(st, ev, m.id)])], ic.match), ' id="uvIcMatch"'), 'wide') : ''}
      ${k.title ? `<div style="margin-top:10px">${field(ic.kind === 'challenge' ? 'For the title' : 'Over a title (optional)',
        select("uvIcSet('title',this.value)", options([['', ic.kind === 'challenge' ? '— Pick the title —' : 'No title'], ...titles.map(t => [t.id, t.name])], ic.title),
          ' id="uvIcTitle"'), 'wide')}</div>` : ''}
      ${k.team ? `<div style="margin-top:10px">${field('The team', select("uvIcSet('team',this.value)", options([['', '— Pick the team —'],
        ...teams.map(t => [t.id, t.name])], ic.team), ' id="uvIcTeam"'), 'wide')}</div>` : ''}
      <div style="margin-top:10px">${picks('by', k.by)}${k.on === false ? '' : picks('on', k.on || (ic.kind === 'breakup' ? 'Left behind (optional)' : 'Calling out (optional)'), k.on === null)}${k.helped ? picks('helped', k.helped, ic.kind === 'interference') : ''}</div>
      ${ic.kind === 'breakup' && !ic.incId && ic.team && (M.teamById(st, ic.team) || {}).active ? `<label class="uv-check"><input id="uvIcDisband" type="checkbox"${ic.disband ? ' checked' : ''}
        onchange="uvIcSet('disband',this.checked)"><span>Disband ${esc(M.teamById(st, ic.team).name)} as well</span></label>` : ''}
      <div style="margin-top:12px">${field('Notes (optional)', `<input id="uvIcNote" class="uv-in" maxlength="2000" value="${esc(ic.note)}" placeholder="e.g. Hit him with the belt"
        oninput="uvIcNote(this.value)">`, 'wide')}</div>
      ${previewBox(news, 'Pick who was in it.')}
      <div class="uv-btn pri full" onclick="uvIcSave()">${ic.incId ? 'Save the incident' : 'Record it'}</div>
      ${ic.incId ? '<div class="uv-btn bad full" onclick="uvIcDelete()">Delete the incident</div>' : ''}`,
  };
}
export function uvIcKind(k) {
  ic.kind = k;
  const shape = INCIDENT[k];
  if (!shape.helped) ic.helped = [];
  else if (!ic.helped.length && k === 'save') ic.helped = [''];
  if (shape.on === false) ic.on = [];
  else if (!ic.on.length && shape.on) ic.on = [''];
  if (!shape.title) ic.title = '';
  if (!shape.team) ic.team = '';
  paintSheet();
}
export function uvIcSet(k, v) { ic[k] = v; paintSheet(); }
export function uvIcPick(list, j, v) { ic[list][j] = v; paintSheet(); }
export function uvIcAdd(list) { ic[list].push(''); paintSheet(); }
export function uvIcDrop(list, j) { ic[list].splice(j, 1); paintSheet(); }
export function uvIcNote(v) { ic.note = v; }
export function uvIcSave() {
  const before = RL.snapshot(uni());
  const r = commit(st => saveIncident(st), () => `${ic.incId ? 'Incident saved' : 'Incident recorded'}${uvRelNews(before)}`);
  if (r.ok) closeSheet();
}
export function uvIcDelete() {
  const { eventId, incId } = ic;
  const st = uni();
  const inc = M.eventById(st, eventId).incidents.find(x => x.id === incId);
  confirmThen('Delete this incident?', `“${incidentText(st, inc)}” comes off the show, and every relationship change it made is worked out again without it.`
    + (inc.story ? ' The story suggestion it came from stays accepted — take that back on the show instead if you want it open again.' : ''),
    'Delete', () => {
      const before = RL.snapshot(uni());
      if (commit(s => M.deleteIncident(s, eventId, incId), () => `Incident deleted${uvRelNews(before)}`).ok) closeSheet();
    });
}

// ================================================================ every relationship

let relKind = '';
export function uvRelKind(k) { relKind = k; refresh(); }

/** The Roster tab's Relationships view: everything now, and the latest changes. */
export function uvRelationsView() {
  const st = uni();
  if (st.wrestlers.length < 2) {
    return empty(ICON.team, 'No relationships yet', 'Add wrestlers to the roster first. Relationships grow out of their results, teams and incidents.');
  }
  const d = RL.relationships(st);
  const active = [...d.rels.values()].filter(r => r.active);
  const count = k => active.filter(r => r.kind === k).length;
  const shown = active.filter(r => !relKind || r.kind === relKind);
  const last = r => r.entries[r.entries.length - 1];
  shown.sort((x, y) => ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind) || y.level - x.level
    || (last(y).at && last(x).at ? M.compareStamps(st, last(y).at, last(x).at) : !last(x).at - !last(y).at));
  const pill = (k, label, n, color) => `<div class="uv-pill${relKind === k ? ' on' : ''}" data-kind="${k}" onclick="uvRelKind('${k}')">`
    + `${color ? `<span class="uv-dot" style="--c:${color}"></span>` : ''}${esc(label)}<span class="n">${n}</span></div>`;
  const row = r => {
    const A = M.wrestlerById(st, r.a), B = M.wrestlerById(st, r.b);
    return `<div class="uv-row" data-rel="${esc(r.key)}" onclick="uvOpenPair('${r.a}','${r.b}')">
      <span class="uv-av2">${avatar(st, A)}${avatar(st, B)}</span>
      <div class="uv-main"><div class="nm">${esc(A.name)} ${r.kind === 'grudge' ? '→' : '&amp;'} ${esc(B.name)}</div>
        <div class="sub">${kindChip(r.kind)}<span class="uv-rt">since ${when(st, r.since)} · ${plural(r.entries.length, 'change')}</span></div></div>
      ${dots(r)}<span class="uv-chev">${ICON.right}</span></div>`;
  };
  const latest = d.entries.slice(-12).reverse();
  return `
    <div class="uv-bar"><div class="uv-bar-t">Relationships</div>
      <div class="uv-btn pri" onclick="uvRelSheet()">${ICON.plus}Add</div></div>
    <p class="uv-p uv-inset-p">Worked out from results, title changes, tag teams and the incidents you record — plus your own changes.
      Tap one to see exactly why it exists. <span class="uv-link" onclick="uvHowRelations()">How relationships work</span></p>
    <div class="uv-pills">${pill('', 'All', active.length)}${ORDER.map(k => pill(k, KIND[k].label, count(k), KIND[k].color)).join('')}</div>
    ${shown.length ? shown.map(row).join('')
      : `<div class="uv-none">${active.length ? 'None of these right now.' : 'None yet. They grow out of results, teams and incidents — or add one yourself.'}</div>`}
    ${latest.length ? `${section('Latest changes', null)}<div class="uv-ents">${latest.map(e => entryRow(st, e, true)).join('')}</div>` : ''}`;
}

// ================================================================ the rules, in the app

export function uvHowRelations() {
  openSheet(() => ({
    title: 'How relationships work',
    body: `
      <p class="uv-p"><b>You see everything.</b> Every trait and every relationship is on show from the start. Nothing is hidden,
        scouted or discovered over time.</p>
      <p class="uv-p"><b>Where relationships come from.</b> They’re worked out from what’s on record, in calendar order — results,
        title changes, tag teams, the incidents you log on a show, and your own changes. Nothing random happens.</p>
      <div class="uv-calc">
        <div><span>Losses</span><b>${RULES.streak} straight losses to the same wrestler: a grudge against them, or 1 more heat.
          Hot-headed: ${RULES.streakHotHeaded}. Patient: ${RULES.streakPatient}. A win over them starts the count again.</b></div>
        <div><span>Title</span><b>losing a title to someone in a match: a grudge against the new champion (ambitious: heat 2), and
          they’re rivals</b></div>
        <div><span>Betrayal</span><b>a grudge against the betrayer, heat 2 (loyal: 3); any friendship or alliance between them ends</b></div>
        <div><span>Interference</span><b>a grudge against whoever interfered; whoever it helped becomes their ally</b></div>
        <div><span>Attack</span><b>a grudge against the attacker (hot-headed: heat 2)</b></div>
        <div><span>Save</span><b>the attacker holds a grudge against whoever made the save; the one saved becomes their ally</b></div>
        <div><span>Brawl</span><b>a grudge each way, and they’re rivals</b></div>
        <div><span>Challenge</span><b>a title challenge, or calling someone out: they’re rivals</b></div>
        <div><span>Walk-out</span><b>anyone left behind holds a grudge against whoever walked out; any friendship or alliance between them ends</b></div>
        <div><span>Teaming</span><b>${RULES.allies} matches on the same side, win or lose: allies (loyal: ${RULES.alliesLoyal}).
          ${RULES.friends}: friends — unless either is opportunistic, or there’s a grudge between them</b></div>
        <div><span>Split</span><b>leaving a tag team, or it disbanding: former partners</b></div>
      </div>
      <p class="uv-p"><b>Heat and strength</b> run from 1 to 3. A grudge goes one way — one wrestler holds it against another.
        Rivals, allies and friends go both ways.</p>
      <p class="uv-p"><b>Traits</b> only change how fast or how hard those rules hit, and they count as they were at the time.
        Proud, cowardly and respectful don’t change anything by themselves — they’re for your booking. If someone is both
        hot-headed and patient, hot-headed wins. A trait is never changed for you, however a match goes.</p>
      <p class="uv-p"><b>Your changes.</b> Ignore any automatic change: it stays on the timeline, crossed out, and doesn’t count.
        Start, set, end or add a note to any relationship yourself — from this week, or from the start for history before your
        universe began. Your changes sit on the same timeline and can be taken back.</p>
      <p class="uv-p"><b>Corrections follow.</b> Correct a result, or edit or delete an incident, and every relationship built on it
        is worked out again.</p>`,
  }));
}
