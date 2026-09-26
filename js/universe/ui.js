// WWE Universe — small HTML building blocks shared by the views and sheets.
//
// Everything the owner types - names, notes, stipulations - goes through esc()
// before it reaches innerHTML. Inline handlers only ever carry record ids,
// which the model generates, never names.
import { DAYS, calendarDate, seasonById, showById, wrestlerById, teamById, titleById, byName, blankRecord, matchKind } from './model.js';

export function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const svg = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${extra}>${d}</svg>`;
export const ICON = {
  plus:   svg('<path d="M12 5v14M5 12h14"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>'),
  belt:   svg('<rect x="2" y="8" width="20" height="8" rx="2"/><circle cx="12" cy="12" r="3.2"/><path d="M5 10v4M19 10v4"/>'),
  team:   svg('<circle cx="9" cy="8" r="3.2"/><circle cx="16.5" cy="9" r="2.6"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M14 14.5a5 5 0 0 1 7 4.5"/>'),
  user:   svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  cal:    svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  save:   svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'),
  x:      svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  left:   svg('<path d="m15 18-6-6 6-6"/>'),
  right:  svg('<path d="m9 18 6-6-6-6"/>'),
  move:   svg('<path d="M7 7h11l-3-3M17 17H6l3 3"/>'),
  edit:   svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
  undo:   svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  check:  svg('<path d="m5 12 5 5 9-10"/>'),
  up:     svg('<path d="m6 15 6-6 6 6"/>'),
  down:   svg('<path d="m6 9 6 6 6-6"/>'),
  star:   svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
  list:   svg('<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'),
};

export const LABEL = {
  gender:    { male: 'Men’s', female: 'Women’s' },   // shown as the wrestler's division
  origin:    { WWE: 'WWE', AEW: 'AEW', NXT: 'NXT', Other: 'Other' },
  alignment: { face: 'Face', heel: 'Heel', tweener: 'Tweener' },
  status:    { active: 'Active', injured: 'Injured' },
  kind:      { singles: 'Singles', tag: 'Tag team' },
  division:  { men: "Men's", women: "Women's", open: 'Open' },
  event:     { weekly: 'Weekly show', ple: 'Premium live event' },
  finish:    { pinfall: 'Pinfall', submission: 'Submission', ko: 'Knockout / ref stoppage', dq: 'Disqualification',
               countout: 'Count-out', elimination: 'Elimination', escape: 'Escape', retrieval: 'Retrieved the object', other: 'Other' },
};

const NEUTRAL = '#5E6979';
/** A show's colour, only ever as a plain hex value - it goes straight into a style attribute. */
export function showColor(st, showId) {
  const s = showById(st, showId);
  return s && /^#[0-9a-f]{3,8}$/i.test(String(s.color)) ? s.color : NEUTRAL;
}
export function showName(st, showId, none = 'Unassigned') { const s = showById(st, showId); return s ? s.name : none; }

export function stampLabel(st, stamp) {
  const s = stamp && seasonById(st, stamp.season);
  return stamp ? `S${s ? s.number : '?'} · W${stamp.week}` : '';
}

export function initials(name) {
  const parts = String(name).replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
export function avatar(st, w, cls = '') {
  return `<span class="uv-av ${cls}" style="--c:${showColor(st, w.showId)}">${esc(initials(w.name))}</span>`;
}
export function showDot(st, showId) {
  return `<span class="uv-dot" style="--c:${showColor(st, showId)}"></span>`;
}
export function tag(text, cls = '') { return `<span class="uv-tag ${cls}">${esc(text)}</span>`; }

/** <option>s from [value, label] pairs. */
export function options(pairs, selected) {
  return pairs.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(selected ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('');
}
export function labelPairs(map) { return Object.entries(map); }
export function showPairs(st, none) {
  const pairs = st.shows.map(s => [s.id, s.name]);
  return none ? [['', none], ...pairs] : pairs;
}

/** Every wrestler, grouped by show, for a picker. `skip` leaves some out (ids). */
export function wrestlerOptions(st, selected, blank = '— Pick a wrestler —', skip = []) {
  const groups = [...st.shows.map(s => [s.id, s.name]), [null, 'Unassigned']];
  return `<option value="">${esc(blank)}</option>` + groups.map(([id, name]) => {
    const list = st.wrestlers.filter(w => w.showId === id && !skip.includes(w.id)).sort(byName);
    if (!list.length) return '';
    return `<optgroup label="${esc(name)}">${options(list.map(w => [w.id, w.name]), selected)}</optgroup>`;
  }).join('');
}
/** Active teams for a picker; `all` includes disbanded ones (for correcting the past). */
export function teamOptions(st, selected, blank = '— Pick a tag team —', all = false) {
  const list = st.teams.filter(t => all || t.active || t.id === selected).sort(byName);
  return `<option value="">${esc(blank)}</option>` + options(list.map(t => [t.id, t.name]), selected);
}
export function titleOptions(st, selected, blank = 'No title on the line') {
  const list = st.titles.filter(t => t.active || t.id === selected);
  return `<option value="">${esc(blank)}</option>` + options(list.map(t => [t.id, t.name]), selected);
}

export function field(label, control, cls = '') {
  return `<label class="uv-f ${cls}"><span>${esc(label)}</span>${control}</label>`;
}
export function select(handler, pairsHTML, extra = '') {
  return `<select class="uv-in" onchange="${handler}"${extra}>${pairsHTML}</select>`;
}

export function empty(icon, title, text, action = '') {
  return `<div class="uv-empty">${icon}<div class="t">${esc(title)}</div><div class="s">${esc(text)}</div>${action}</div>`;
}
export function section(title, count, color) {
  return `<div class="uv-sec"${color ? ` style="--c:${color}"` : ''}>${color ? '<span class="bar"></span>' : ''}`
    + `<span class="t">${esc(title)}</span>${count == null ? '' : `<span class="n">${count}</span>`}</div>`;
}

// ---------------------------------------------------------------- results

export function sideName(st, side) {
  if (side.team) {
    const t = teamById(st, side.team);
    if (t) return t.name;
  }
  return side.wrestlers.map(id => (wrestlerById(st, id) || { name: '(missing)' }).name).join(' & ');
}

/** One line for a result: "A def. B", "A vs B — Draw", with the winner in bold. */
export function matchLine(st, m) {
  const names = m.sides.map(s => esc(sideName(st, s)));
  if (m.outcome === 'win') {
    const rest = names.filter((_, i) => i !== m.winner);
    return `<b>${names[m.winner]}</b> def. ${rest.join(', ')}`;
  }
  return `${names.join(' vs ')} <span class="uv-muted">— ${m.outcome === 'draw' ? 'Draw' : 'No contest'}</span>`;
}
// ---------------------------------------------------------------- records, lengths, links

/** "5–2–1" (wins–losses–draws); no contests ride along only when there are any. */
export function fmtRec(rec = blankRecord()) {
  return `${rec.w}–${rec.l}–${rec.d}`;
}
export function recNote(rec = blankRecord()) {
  const n = rec.w + rec.l + rec.d + rec.nc;
  if (!n) return 'No matches';
  return `${n} match${n === 1 ? '' : 'es'}${rec.nc ? ` · ${rec.nc} NC` : ''}`;
}
export function weeksText(n) { return n === 0 ? 'under a week' : `${n} week${n === 1 ? '' : 's'}`; }

/** A holder's name as a link to their page. */
export function holderLink(st, holder) {
  if (holder.type === 'team') {
    const t = teamById(st, holder.id);
    return t ? `<span class="uv-link" onclick="event.stopPropagation();uvOpenTeam('${t.id}')">${esc(t.name)}</span>` : '(missing)';
  }
  const w = wrestlerById(st, holder.id);
  return w ? `<span class="uv-link" onclick="event.stopPropagation();uvOpenWrestler('${w.id}')">${esc(w.name)}</span>` : '(missing)';
}
export function wrestlerLink(st, w) {
  return w ? `<span class="uv-link" onclick="event.stopPropagation();uvOpenWrestler('${w.id}')">${esc(w.name)}</span>` : '(deleted)';
}
/** A dated history line, the same shape everywhere: stamp on the left, text on the right. */
export function histLine(st, e, html) {
  return `<div class="uv-tl"><span class="w">${stampLabel(st, e)}</span><span class="x">${html}</span></div>`;
}

// ---------------------------------------------------------------- dates

export const NIGHT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-01-19' -> '19 Jan 2026' (no locale: the same everywhere). */
export function isoText(iso, year = true) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}${year ? ` ${y}` : ''}`;
}
/**
 * When an event airs. With a season start date: "Mon 19 Jan 2026" (long:
 * "Monday 19 Jan 2026"); without: "Mon · Week 3".
 */
export function eventWhen(st, ev, long = false) {
  const day = ev.at.day;
  const night = day == null ? '' : long ? DAYS[day] : NIGHT[day];
  const iso = calendarDate(st, ev.at.season, ev.at.week, day);
  if (iso) return `${night} ${isoText(iso)}`;
  return `${night}${night ? ' · ' : ''}Week ${ev.at.week}`;
}

/** A night on a season's calendar: "Mon 19 Jan" with dates, else "Mon". */
export function nightLabel(st, seasonId, week, day) {
  const iso = calendarDate(st, seasonId, week, day);
  return iso ? `${NIGHT[day]} ${isoText(iso, false)}` : NIGHT[day];
}

// ---------------------------------------------------------------- the card

export function chip(text, cls = '') { return `<span class="uv-chip ${cls}">${esc(text)}</span>`; }
export function kindChip(m) { return chip(matchKind(m).label, 'kind'); }

/** "A vs B vs C" for a booked match - a team side by its name. */
export function vsLine(st, m) {
  return m.sides.map(sd => `<b>${esc(sideName(st, sd))}</b>`).join(' <span class="uv-muted">vs</span> ');
}

// how the win read, finish by finish; anything else (a DQ, a count-out) is "beat"
const FALL_VERB = { pinfall: 'pinned', submission: 'made {} submit', ko: 'knocked out', elimination: 'eliminated {} last',
  escape: 'escaped ahead of', retrieval: 'beat {} to it' };
/** Who scored and who took the fall, when the owner recorded it: "Cody Rhodes pinned Gunther". */
export function fallLine(st, m) {
  if (!m.fall) return '';
  const name = id => esc((wrestlerById(st, id) || { name: '?' }).name);
  const { on } = m.fall;
  // a winning side of one scored the win, whether or not the owner said so
  const win = m.outcome === 'win' && m.sides[m.winner];
  const by = m.fall.by || (win && win.wrestlers.length === 1 ? win.wrestlers[0] : null);
  if (by && on) {
    const verb = FALL_VERB[m.finish] || 'beat {}';
    return `${name(by)} ${verb.includes('{}') ? verb.replace('{}', name(on)) : `${verb} ${name(on)}`}`;
  }
  return by ? `${name(by)} scored the win` : `${name(on)} took the fall`;
}
