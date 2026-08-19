// State for the matchup-screen maker.
//
// One template holds a background image plus the slots that say where every
// piece of information lands on it. Teams hold identity (logo, typeface,
// colours). Results hold the scores. Nothing about a team's placement is
// stored per matchup - that is the point of the tool: position a slot once and
// every screen made from that template puts the same thing in the same place.

import { T as APP_TEAMS, TEAM_FONTS } from '../data/teams.js';
import { newId } from './assets.js';

export const KEY = 'cbf_matchup_maker_v1';

// Text slots resolve these against the team on their side. `side` picks which
// team; a slot with no side gets league-level values only.
export const TOKENS = [
  ['{{team}}',    'team name'],
  ['{{manager}}', 'manager name'],
  ['{{record}}',  'record, e.g. 5-7'],
  ['{{ppg}}',     'average points'],
  ['{{pf}}',      'points for'],
  ['{{pa}}',      'points against'],
  ['{{rank}}',    'place in the standings'],
  ['{{streak}}',  'e.g. W3'],
  ['{{note}}',    "this week's blurb"],
  ['{{score}}',   'final score this week'],
  ['{{opp}}',     "opponent's name"],
  ['{{week}}',    'week number'],
  ['{{year}}',    'season'],
];

// The app's identity faces, plus the two workhorse families that are already
// embedded in css/fonts.css - a scoreboard wants a mono digit and a plain sans.
export const FONTS = TEAM_FONTS.concat([
  { k:'jet',    lb:'Scoreboard', ff:"'JetBrains Mono'", w:800, sc:0.92, tt:'none', ls:'0' },
  { k:'barlow', lb:'Plain',      ff:"'Barlow'",         w:700, sc:1.00, tt:'none', ls:'0' },
]);

// A text slot has no box. `y` is its baseline, `x` is the point it aligns to,
// and `size` is the cap height it always draws at - the three things that have
// to be identical from screen to screen. `w` is only how much room it has
// before it condenses, and `h` only matters to wrapped text and to the editor
// handle. Image slots keep a real box, because a logo is one.
const slot = (o) => Object.assign({
  id: newId('slot'), label: '', kind: 'text', side: 'a', text: '{{team}}',
  x: .5, y: .5, w: .25, h: .08,
  align: 'center', valign: 'middle',
  font: 'team',            // 'team' = whatever typeface that team picked
  size: .05,               // cap height, as a fraction of canvas height. Fixed.
  color: 'team',           // 'team' = the team's colour
  stroke: 0, strokeColor: '#000000',
  shadow: .25, shadowColor: '#000000',
  wrap: false, maxLines: 0, caps: false, opacity: 1, rotate: 0, hidden: false,
}, o);

export const makeSlot = slot;

// Three starting layouts. All three are only a starting point - the editor
// drags them onto whatever background you actually load, and `Apply layout`
// swaps between them.
export const LAYOUTS = [
  ['center',     'Centre column — sides clear for player photos'],
  ['scoreboard', 'Names on the wings, numbers stacked in the centre'],
  ['wings',      'Everything stacked down each side'],
];

export function preset(kind) {
  if (kind === 'wings') return [
    // Everything for a team down its own half; the middle stays open.
    slot({ id:'logoA', label:'Logo A',   kind:'image', side:'a', x:.045, y:.045, w:.16, h:.22 }),
    slot({ id:'logoB', label:'Logo B',   kind:'image', side:'b', x:.795, y:.045, w:.16, h:.22 }),
    slot({ id:'nameA', label:'Name A',   side:'a', text:'{{team}}', x:.25, y:.46, w:.44, size:.062, wrap:true, maxLines:2, h:.16, stroke:.004 }),
    slot({ id:'nameB', label:'Name B',   side:'b', text:'{{team}}', x:.75, y:.46, w:.44, size:.062, wrap:true, maxLines:2, h:.16, stroke:.004 }),
    slot({ id:'recA',  label:'Record A', side:'a', text:'{{record}}', x:.25, y:.565, w:.44, size:.05, font:'oswald', color:'#ffffff', stroke:.003 }),
    slot({ id:'recB',  label:'Record B', side:'b', text:'{{record}}', x:.75, y:.565, w:.44, size:.05, font:'oswald', color:'#ffffff', stroke:.003 }),
    slot({ id:'ppgA',  label:'PPG A',    side:'a', text:'PPG: {{ppg}}', x:.25, y:.635, w:.44, size:.042, font:'oswald', color:'#ffffff', stroke:.003 }),
    slot({ id:'ppgB',  label:'PPG B',    side:'b', text:'PPG: {{ppg}}', x:.75, y:.635, w:.44, size:.042, font:'oswald', color:'#ffffff', stroke:.003 }),
    slot({ id:'noteA', label:'Note A',   side:'a', text:'{{note}}', x:.25, y:.705, w:.42, size:.034, h:.20, font:'oswald', color:'#ffffff', wrap:true, maxLines:4, stroke:.0025 }),
    slot({ id:'noteB', label:'Note B',   side:'b', text:'{{note}}', x:.75, y:.705, w:.42, size:.034, h:.20, font:'oswald', color:'#ffffff', wrap:true, maxLines:4, stroke:.0025 }),
    slot({ id:'scoreA',label:'Score A',  side:'a', text:'{{score}}', x:.25, y:.36, w:.30, size:.055, font:'anton', color:'#ffffff', stroke:.004, hidden:true }),
    slot({ id:'scoreB',label:'Score B',  side:'b', text:'{{score}}', x:.75, y:.36, w:.30, size:.055, font:'anton', color:'#ffffff', stroke:.004, hidden:true }),
    slot({ id:'week',  label:'Week',     side:'',  text:'WEEK {{week}}', x:.50, y:.08, w:.30, size:.04, font:'anton', color:'#ffffff', stroke:.003, hidden:true }),
  ];

  if (kind === 'scoreboard') return [
    // Names on the wings, the numbers on two lines down the centre - the shape
    // of a background that already has plates in its corners.
    slot({ id:'nameA', label:'Name A',   side:'a', text:'{{team}}', x:.165, y:.105, w:.29, size:.038 }),
    slot({ id:'nameB', label:'Name B',   side:'b', text:'{{team}}', x:.835, y:.105, w:.29, size:.038 }),
    slot({ id:'logoA', label:'Logo A',   kind:'image', side:'a', x:.055, y:.165, w:.22, h:.26 }),
    slot({ id:'logoB', label:'Logo B',   kind:'image', side:'b', x:.725, y:.165, w:.22, h:.26 }),
    slot({ id:'recA',  label:'Record A', side:'a', text:'{{record}}', x:.449, y:.345, w:.085, size:.038, font:'jet', color:'#ffffff', shadow:0 }),
    slot({ id:'recB',  label:'Record B', side:'b', text:'{{record}}', x:.551, y:.345, w:.085, size:.038, font:'jet', color:'#ffffff', shadow:0 }),
    slot({ id:'ppgA',  label:'PPG A',    side:'a', text:'{{ppg}}',    x:.449, y:.455, w:.085, size:.034, font:'jet', color:'#ffffff', shadow:0 }),
    slot({ id:'ppgB',  label:'PPG B',    side:'b', text:'{{ppg}}',    x:.551, y:.455, w:.085, size:.034, font:'jet', color:'#ffffff', shadow:0 }),
    slot({ id:'noteA', label:'Note A',   side:'a', text:'{{note}}', x:.165, y:.505, w:.26, size:.028, h:.18, font:'oswald', color:'#ffffff', wrap:true, maxLines:4, stroke:.002 }),
    slot({ id:'noteB', label:'Note B',   side:'b', text:'{{note}}', x:.835, y:.505, w:.26, size:.028, h:.18, font:'oswald', color:'#ffffff', wrap:true, maxLines:4, stroke:.002 }),
    slot({ id:'scoreA',label:'Score A',  side:'a', text:'{{score}}', x:.449, y:.60, w:.10, size:.05, font:'anton', color:'team', stroke:.003, hidden:true }),
    slot({ id:'scoreB',label:'Score B',  side:'b', text:'{{score}}', x:.551, y:.60, w:.10, size:.05, font:'anton', color:'team', stroke:.003, hidden:true }),
    slot({ id:'week',  label:'Week',     side:'',  text:'WEEK {{week}}', x:.50, y:.94, w:.30, size:.035, font:'anton', color:'#ffffff', stroke:.003, hidden:true }),
  ];

  // Default. Both teams down the middle of the screen, mirrored about the
  // centre line, which leaves 400px clear on each edge of a 2000px canvas for
  // the player cutouts that get dropped on afterwards.
  //
  // Every row is a baseline shared by both sides: the two names sit on one
  // line, the two records on the next, and so on. Names wrap rather than
  // shrink, so a long one takes a second line at the same size rather than
  // coming out smaller than everybody else's.
  return [
    slot({ id:'logoA', label:'Logo A',   kind:'image', side:'a', x:.270, y:.100, w:.165, h:.175 }),
    slot({ id:'logoB', label:'Logo B',   kind:'image', side:'b', x:.565, y:.100, w:.165, h:.175 }),
    slot({ id:'nameA', label:'Name A',   side:'a', text:'{{team}}', x:.335, y:.355, w:.27, size:.055, wrap:true, maxLines:2, h:.13, stroke:.0035 }),
    slot({ id:'nameB', label:'Name B',   side:'b', text:'{{team}}', x:.665, y:.355, w:.27, size:.055, wrap:true, maxLines:2, h:.13, stroke:.0035 }),
    slot({ id:'vs',    label:'VS',       side:'',  text:'VS', x:.500, y:.355, w:.06, size:.045, font:'anton', color:'#ffffff', stroke:.004 }),
    slot({ id:'recA',  label:'Record A', side:'a', text:'{{record}}', x:.335, y:.520, w:.22, size:.055, font:'anton', color:'#ffffff', stroke:.003 }),
    slot({ id:'recB',  label:'Record B', side:'b', text:'{{record}}', x:.665, y:.520, w:.22, size:.055, font:'anton', color:'#ffffff', stroke:.003 }),
    slot({ id:'ppgA',  label:'PPG A',    side:'a', text:'PPG: {{ppg}}', x:.335, y:.585, w:.25, size:.038, font:'oswald', color:'#ffffff', stroke:.0025 }),
    slot({ id:'ppgB',  label:'PPG B',    side:'b', text:'PPG: {{ppg}}', x:.665, y:.585, w:.25, size:.038, font:'oswald', color:'#ffffff', stroke:.0025 }),
    slot({ id:'noteA', label:'Note A',   side:'a', text:'{{note}}', x:.335, y:.660, w:.25, size:.030, h:.20, font:'oswald', color:'#ffffff', wrap:true, maxLines:4, stroke:.0025 }),
    slot({ id:'noteB', label:'Note B',   side:'b', text:'{{note}}', x:.665, y:.660, w:.25, size:.030, h:.20, font:'oswald', color:'#ffffff', wrap:true, maxLines:4, stroke:.0025 }),
    slot({ id:'scoreA',label:'Score A',  side:'a', text:'{{score}}', x:.335, y:.295, w:.22, size:.055, font:'anton', color:'team', stroke:.0035, hidden:true }),
    slot({ id:'scoreB',label:'Score B',  side:'b', text:'{{score}}', x:.665, y:.295, w:.22, size:.055, font:'anton', color:'team', stroke:.0035, hidden:true }),
    slot({ id:'week',  label:'Week',     side:'',  text:'WEEK {{week}}', x:.50, y:.085, w:.30, size:.035, font:'anton', color:'#ffffff', stroke:.003, hidden:true }),
  ];
}

export function newTemplate(name = 'New template', kind = 'center') {
  return { id: newId('tpl'), name, bg: '', bgColor: '#0b1220', w: 2000, h: 1300, slots: preset(kind) };
}

// Seeded from the league already in the app, so the tool opens with real teams
// rather than ten rows of "Team 1".
function seedTeams() {
  return Object.entries(APP_TEAMS).map(([k, t]) => ({
    id: k, name: t.n, mgr: t.mgr, color: t.c, accent: '#ffffff', font: t.font, logo: '',
  }));
}

export const state = {
  v: 2, year: new Date().getFullYear(), week: 1, weeks: 14,
  teams: [], templates: [], defaultTpl: '', schedule: {}, fonts: [], photos: [],
};

export function load() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { saved = null; }
  Object.assign(state, saved || {});
  if (!state.teams || !state.teams.length) state.teams = seedTeams();
  if (!state.templates || !state.templates.length) {
    const a = newTemplate('Default', 'center');
    state.templates = [a];
    state.defaultTpl = a.id;
  }
  if (!state.templates.some(t => t.id === state.defaultTpl)) state.defaultTpl = state.templates[0].id;
  migrateSlots();
  state.schedule = state.schedule || {};
  state.fonts = state.fonts || [];
  // Imported background photos are a library shared by every template, so one
  // import covers the plain, Thanksgiving and Christmas versions alike.
  state.photos = state.photos || [];
  state.templates.forEach(t => {
    if (t.bg && !state.photos.some(p => p.id === t.bg)) state.photos.push({ id: t.bg, name: t.name });
  });
  return state;
}

// Text used to be fitted into a box, which is what let it change size and
// position with its own contents. Convert an old template in place: work out
// the baseline and cap height the box was producing, and keep those.
function migrateSlots() {
  if (state.v >= 2) return;
  state.templates.forEach(t => t.slots.forEach(s => {
    if (s.kind === 'image') return;
    const capFrac = Math.min((s.size || .05) * 0.72, (s.h || .08) * 0.92);
    const vf = s.valign === 'top' ? 0 : s.valign === 'bottom' ? 1 : 0.5;
    s.y = s.y + (s.h - capFrac) * vf + capFrac;
    s.x = s.align === 'left' ? s.x : s.align === 'right' ? s.x + s.w : s.x + s.w / 2;
    s.size = capFrac;
    delete s.sizing;
    delete s.lock;
  }));
  state.v = 2;
}

let pending = 0;
export function save() {
  // Coalesce the bursts a drag produces into one write per frame.
  clearTimeout(pending);
  pending = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { console.warn('save failed', e); }
  }, 60);
}

export const team = id => state.teams.find(t => t.id === id) || null;
export const tpl = id => state.templates.find(t => t.id === id) || state.templates[0];
export const games = wk => (state.schedule[wk] = state.schedule[wk] || []);

export function newGame(a = '', b = '') {
  return { id: newId('g'), a, b, as: null, bs: null, final: false, noteA: '', noteB: '', tpl: '' };
}
