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

const slot = (o) => Object.assign({
  id: newId('slot'), label: '', kind: 'text', side: 'a', text: '{{team}}',
  x: .1, y: .1, w: .2, h: .08,
  align: 'center', valign: 'middle',
  font: 'team',            // 'team' = whatever typeface that team picked
  size: .06,               // cap, as a fraction of canvas height; shrinks to fit
  color: 'team',           // 'team' = the team's colour
  stroke: 0, strokeColor: '#000000',
  shadow: .25, shadowColor: '#000000',
  wrap: false, caps: false, opacity: 1, rotate: 0, hidden: false,
  sizing: 'pair',          // pair | league | off — see sizingOf() in render.js

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
    // Everything for a team stacked down its own half; the middle stays open.
    slot({ id:'logoA', label:'Logo A',   kind:'image', side:'a', x:.045, y:.045, w:.16, h:.22 }),
    slot({ id:'logoB', label:'Logo B',   kind:'image', side:'b', x:.795, y:.045, w:.16, h:.22 }),
    slot({ id:'nameA', label:'Name A',   side:'a', text:'{{team}}', x:.02, y:.40, w:.46, h:.10, size:.10, stroke:.004 }),
    slot({ id:'nameB', label:'Name B',   side:'b', text:'{{team}}', x:.52, y:.40, w:.46, h:.10, size:.10, stroke:.004 }),
    slot({ id:'recA',  label:'Record A', side:'a', text:'{{record}}', x:.02, y:.505, w:.46, h:.065, font:'oswald', color:'#ffffff', stroke:.003 }),
    slot({ id:'recB',  label:'Record B', side:'b', text:'{{record}}', x:.52, y:.505, w:.46, h:.065, font:'oswald', color:'#ffffff', stroke:.003 }),
    slot({ id:'ppgA',  label:'PPG A',    side:'a', text:'PPG: {{ppg}}', x:.02, y:.575, w:.46, h:.06, font:'oswald', color:'#ffffff', stroke:.003 }),
    slot({ id:'ppgB',  label:'PPG B',    side:'b', text:'PPG: {{ppg}}', x:.52, y:.575, w:.46, h:.06, font:'oswald', color:'#ffffff', stroke:.003 }),
    slot({ id:'noteA', label:'Note A',   side:'a', text:'{{note}}', x:.03, y:.645, w:.44, h:.20, font:'oswald', color:'#ffffff', size:.055, wrap:true, sizing:'off', stroke:.003 }),
    slot({ id:'noteB', label:'Note B',   side:'b', text:'{{note}}', x:.53, y:.645, w:.44, h:.20, font:'oswald', color:'#ffffff', size:.055, wrap:true, sizing:'off', stroke:.003 }),
    slot({ id:'scoreA',label:'Score A',  side:'a', text:'{{score}}', x:.10, y:.30, w:.30, h:.09, font:'anton', color:'#ffffff', stroke:.004, hidden:true }),
    slot({ id:'scoreB',label:'Score B',  side:'b', text:'{{score}}', x:.60, y:.30, w:.30, h:.09, font:'anton', color:'#ffffff', stroke:.004, hidden:true }),
    slot({ id:'week',  label:'Week',     side:'',  text:'WEEK {{week}}', x:.35, y:.03, w:.30, h:.06, font:'anton', color:'#ffffff', stroke:.003, hidden:true }),
  ];

  if (kind === 'scoreboard') return [
    // Names on the wings, the numbers stacked in a centre column - the shape of
    // a scoreboard background that already has plates in its corners.
    slot({ id:'nameA', label:'Name A',   side:'a', text:'{{team}}', x:.015, y:.045, w:.30, h:.075, size:.055 }),
    slot({ id:'nameB', label:'Name B',   side:'b', text:'{{team}}', x:.685, y:.045, w:.30, h:.075, size:.055 }),
    slot({ id:'logoA', label:'Logo A',   kind:'image', side:'a', x:.055, y:.165, w:.22, h:.26 }),
    slot({ id:'logoB', label:'Logo B',   kind:'image', side:'b', x:.725, y:.165, w:.22, h:.26 }),
    slot({ id:'recA',  label:'Record A', side:'a', text:'{{record}}', x:.405, y:.300, w:.088, h:.055, font:'jet', color:'#ffffff', shadow:0 }),
    slot({ id:'recB',  label:'Record B', side:'b', text:'{{record}}', x:.507, y:.300, w:.088, h:.055, font:'jet', color:'#ffffff', shadow:0 }),
    slot({ id:'ppgA',  label:'PPG A',    side:'a', text:'{{ppg}}',    x:.405, y:.410, w:.088, h:.055, font:'jet', color:'#ffffff', shadow:0 }),
    slot({ id:'ppgB',  label:'PPG B',    side:'b', text:'{{ppg}}',    x:.507, y:.410, w:.088, h:.055, font:'jet', color:'#ffffff', shadow:0 }),
    slot({ id:'noteA', label:'Note A',   side:'a', text:'{{note}}', x:.035, y:.470, w:.26, h:.18, font:'oswald', color:'#ffffff', size:.038, wrap:true, sizing:'off', stroke:.002 }),
    slot({ id:'noteB', label:'Note B',   side:'b', text:'{{note}}', x:.705, y:.470, w:.26, h:.18, font:'oswald', color:'#ffffff', size:.038, wrap:true, sizing:'off', stroke:.002 }),
    slot({ id:'scoreA',label:'Score A',  side:'a', text:'{{score}}', x:.395, y:.545, w:.10, h:.08, font:'anton', color:'team', stroke:.003, hidden:true }),
    slot({ id:'scoreB',label:'Score B',  side:'b', text:'{{score}}', x:.505, y:.545, w:.10, h:.08, font:'anton', color:'team', stroke:.003, hidden:true }),
    slot({ id:'week',  label:'Week',     side:'',  text:'WEEK {{week}}', x:.35, y:.90, w:.30, h:.06, font:'anton', color:'#ffffff', stroke:.003, hidden:true }),
  ];

  // Default. Both teams sit in a column down the middle of the screen, which
  // leaves the outer quarter of each side completely clear - that is where the
  // player cutouts get dropped in afterwards, and nothing here may collide
  // with them. The name row runs 20%-47% across with B mirrored, which leaves
  // 400px clear on each edge of a 2000px canvas.
  return [
    slot({ id:'logoA', label:'Logo A',   kind:'image', side:'a', x:.270, y:.115, w:.165, h:.175 }),
    slot({ id:'logoB', label:'Logo B',   kind:'image', side:'b', x:.565, y:.115, w:.165, h:.175 }),
    slot({ id:'nameA', label:'Name A',   side:'a', text:'{{team}}', x:.200, y:.310, w:.270, h:.095, size:.085, stroke:.0035 }),
    slot({ id:'nameB', label:'Name B',   side:'b', text:'{{team}}', x:.530, y:.310, w:.270, h:.095, size:.085, stroke:.0035 }),
    slot({ id:'vs',    label:'VS',       side:'',  text:'VS', x:.470, y:.310, w:.06, h:.095, font:'anton', color:'#ffffff', stroke:.004 }),
    slot({ id:'recA',  label:'Record A', side:'a', text:'{{record}}', x:.255, y:.415, w:.195, h:.075, font:'anton', color:'#ffffff', stroke:.003 }),
    slot({ id:'recB',  label:'Record B', side:'b', text:'{{record}}', x:.550, y:.415, w:.195, h:.075, font:'anton', color:'#ffffff', stroke:.003 }),
    slot({ id:'ppgA',  label:'PPG A',    side:'a', text:'PPG: {{ppg}}', x:.255, y:.500, w:.195, h:.055, font:'oswald', color:'#ffffff', stroke:.0025 }),
    slot({ id:'ppgB',  label:'PPG B',    side:'b', text:'PPG: {{ppg}}', x:.550, y:.500, w:.195, h:.055, font:'oswald', color:'#ffffff', stroke:.0025 }),
    slot({ id:'noteA', label:'Note A',   side:'a', text:'{{note}}', x:.210, y:.575, w:.250, h:.22, font:'oswald', color:'#ffffff', size:.042, wrap:true, sizing:'off', stroke:.0025 }),
    slot({ id:'noteB', label:'Note B',   side:'b', text:'{{note}}', x:.540, y:.575, w:.250, h:.22, font:'oswald', color:'#ffffff', size:.042, wrap:true, sizing:'off', stroke:.0025 }),
    slot({ id:'scoreA',label:'Score A',  side:'a', text:'{{score}}', x:.255, y:.225, w:.195, h:.085, font:'anton', color:'team', stroke:.0035, hidden:true }),
    slot({ id:'scoreB',label:'Score B',  side:'b', text:'{{score}}', x:.550, y:.225, w:.195, h:.085, font:'anton', color:'team', stroke:.0035, hidden:true }),
    slot({ id:'week',  label:'Week',     side:'',  text:'WEEK {{week}}', x:.35, y:.045, w:.30, h:.055, font:'anton', color:'#ffffff', stroke:.003, hidden:true }),
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
  v: 1, year: new Date().getFullYear(), week: 1, weeks: 14,
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
