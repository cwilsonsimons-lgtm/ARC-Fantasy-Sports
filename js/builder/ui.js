// The builder's screen: four tabs over one shared league object.
//
// Rendering is deliberately blunt — a tab is rebuilt from state as a string —
// with one exception: typing never rebuilds the panel the cursor is in. Score,
// caption and name fields write straight into state and redraw only the canvas
// (and the standings block), because rebuilding an <input> mid-keystroke drops
// focus and, on iOS, closes the keyboard.
import { T } from '../data/teams.js';
import {
  DEFAULT_SLOTS, FONTS, H, PLAYER_SLOTS, THEMES, W, WEEK_TAGS, WEEK_THEMES,
  fontFamily, weekLabel,
} from './data.js';
import { drawGraphic, monogramCrest } from './draw.js';
import {
  applyLeagueSchedule, dataUrlToImage, loadLeague, loadLogoBundle, persistLeague,
  playerKey, readImageFile, readKey, removeKey, saveLogoBundle, setSaveNotifier, writeKey,
} from './store.js';
import { fmtPpg, fmtRecord, roastsFor, statsThroughWeek } from './stats.js';

let _id = 1;
const nid = () => _id++;

export const B = {
  ready: false,
  tab: 'graphic',
  league: null,
  logoData: {},        // teamId | 'league' | 'background' -> dataURL
  logos: {},           // teamId -> Image
  leagueLogoImg: null,
  bgImg: null,
  layers: [],
  selId: null,
  teamA: '',
  teamB: '',
  asOfWeek: 0,
  selWeek: 0,
  blurbA: '',
  blurbB: '',
  theme: 'auto',
  labels: ['Record', 'Average Points'],
  ovr: { ra: '', rb: '', pa: '', pb: '' },
  suggest: { a: [], b: [] },
  pendingDel: null,
  playerImgs: {},      // storage key -> Image
  crests: {},          // teamId -> generated monogram canvas, for teams with no logo
};

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const teamById = (id) => B.league.teams.find((t) => t.id === id);
const effectiveTheme = () => (B.theme === 'auto' ? WEEK_THEMES[B.asOfWeek] || 'classic' : B.theme);

// ---------- boot ----------
export async function initBuilder() {
  setSaveNotifier(note);
  B.league = loadLeague();
  B.logoData = loadLogoBundle();

  for (const t of B.league.teams) {
    const img = await dataUrlToImage(B.logoData[t.id]);
    if (img) B.logos[t.id] = img;
  }
  B.leagueLogoImg = await dataUrlToImage(B.logoData.league);
  B.bgImg = await dataUrlToImage(B.logoData.background);

  // Open on the first week that has matchups but no scores — the week you are
  // most likely making a graphic for.
  const firstOpen = B.league.weeks.findIndex((wk) =>
    wk.some((m) => m.a && m.b && (m.sa === '' || m.sb === ''))
  );
  if (firstOpen >= 0) { B.asOfWeek = firstOpen; B.selWeek = firstOpen; }

  const last = B.league.last;
  if (last) {
    if (teamById(last.teamA)) B.teamA = last.teamA;
    if (teamById(last.teamB)) B.teamB = last.teamB;
    if (last.asOfWeek >= 0 && last.asOfWeek < B.league.weeks.length) {
      B.asOfWeek = last.asOfWeek;
      B.selWeek = last.asOfWeek;
    }
    if (last.theme) B.theme = last.theme;
    if (last.labels && last.labels.length === 2) B.labels = [...last.labels];
    const m = B.league.weeks[B.asOfWeek].find((x) => x.a === B.teamA && x.b === B.teamB);
    if (m) { B.blurbA = m.ba || ''; B.blurbB = m.bb || ''; }
    loadLogoLayers(B.teamA, B.teamB);
  }

  B.ready = true;
  wire();
  render();
}

function save() { persistLeague(B.league); }

// The matchup you are working on is worth keeping across a reload — losing the
// teams, the week and the box labels to a refresh is the small annoyance that
// makes a tool feel disposable.
function remember() {
  B.league.last = {
    teamA: B.teamA, teamB: B.teamB, asOfWeek: B.asOfWeek,
    theme: B.theme, labels: [...B.labels],
  };
  save();
}

let noteTimer = null;
function note(text, sticky) {
  const el = document.getElementById('saveNote');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('warn', !!sticky);
  clearTimeout(noteTimer);
  if (!sticky) noteTimer = setTimeout(() => { el.textContent = ''; }, 1600);
}

// ---------- the two sides of the graphic ----------
function buildSides() {
  const stats = statsThroughWeek(B.league, B.asOfWeek);
  const mk = (id, blurb, fallbackName, fallbackColor) => {
    const t = teamById(id);
    if (!t) return { name: fallbackName, color: fallbackColor, font: 'oswald', record: '0-0', ppg: '—', blurb };
    return {
      name: t.name, color: t.color, font: t.font,
      record: fmtRecord(stats[t.id]), ppg: fmtPpg(stats[t.id]), blurb,
    };
  };
  return [
    mk(B.teamA, B.blurbA, 'TEAM 1', '#ffd200'),
    mk(B.teamB, B.blurbB, 'TEAM 2', '#5AA9E6'),
  ];
}

function drawState() {
  const auto = buildSides();
  const sides = [
    { ...auto[0], record: B.ovr.ra.trim() || auto[0].record, ppg: B.ovr.pa.trim() || auto[0].ppg },
    { ...auto[1], record: B.ovr.rb.trim() || auto[1].record, ppg: B.ovr.pb.trim() || auto[1].ppg },
  ];
  return {
    bgImg: B.bgImg, leagueLogoImg: B.leagueLogoImg, layers: B.layers, sides,
    selId: B.selId, theme: effectiveTheme(), labels: B.labels, auto,
  };
}

export function draw() {
  const cv = document.getElementById('stage');
  if (!cv) return;
  drawGraphic(cv.getContext('2d'), drawState());
}

// ---------- render ----------
export function render() {
  if (!B.ready) return;
  document.querySelectorAll('[data-tab]').forEach((el) => {
    el.classList.toggle('on', el.dataset.tab === B.tab);
  });
  const panel = document.getElementById('panel');
  panel.innerHTML =
    B.tab === 'graphic' ? graphicTab()
      : B.tab === 'scores' ? scoresTab()
        : B.tab === 'schedule' ? scheduleTab()
          : teamsTab();
  document.getElementById('exportBtn').style.display = B.tab === 'graphic' ? '' : 'none';
  if (B.tab === 'graphic') { wireCanvas(); draw(); }
}

const teamOptions = (sel, placeholder) =>
  `<option value="">${placeholder}</option>` + B.league.teams.map((t) =>
    `<option value="${t.id}"${t.id === sel ? ' selected' : ''}>${esc(t.name)}</option>`).join('');

const weekOptions = (sel, prefix) => B.league.weeks.map((_, i) =>
  `<option value="${i}"${i === sel ? ' selected' : ''}>${prefix}${i + 1}${WEEK_TAGS[i] ? ` (${WEEK_TAGS[i]})` : ''}</option>`).join('');

function graphicTab() {
  const st = drawState();
  const chips = B.league.weeks[B.asOfWeek]
    .map((m, mi) => {
      const A = teamById(m.a), Bt = teamById(m.b);
      if (!A || !Bt) return '';
      const on = B.teamA === m.a && B.teamB === m.b;
      return `<button class="chip${on ? ' on' : ''}" data-act="pickMatch" data-mi="${mi}">${esc(A.name)} vs ${esc(Bt.name)}</button>`;
    })
    .join('');

  const captionBlock = (key, id, blurb, fallback) => {
    const t = teamById(id);
    return `<div class="stack">
      <div class="side-name" style="color:${t ? t.color : '#8b8f9c'}">${esc(t ? t.name : fallback)}</div>
      <textarea class="in tall" data-in="blurb${key.toUpperCase()}" placeholder="Fun fact / stat line / roast">${esc(blurb)}</textarea>
      ${id ? `<button class="btn small" data-act="suggest" data-side="${key}">Suggest a line</button>` : ''}
      ${B.suggest[key].map((line, i) =>
        `<button class="btn line" data-act="useLine" data-side="${key}" data-i="${i}">${esc(line)}</button>`).join('')}
    </div>`;
  };

  const featured = ['a', 'b'].map((k) => {
    const id = k === 'a' ? B.teamA : B.teamB;
    const t = teamById(id);
    if (!t || !t.players.length) return '';
    const side = k === 'a' ? 'left' : 'right';
    return `<div class="stack">
      <div class="side-name" style="color:${t.color}">${esc(t.name)}</div>
      <div class="chips">${t.players.map((p) => {
        const on = B.layers.some((l) => l.pid === p.pid);
        return `<button class="chip${on ? ' on' : ''}" data-act="togglePlayer" data-side="${side}" data-tid="${t.id}" data-pid="${p.pid}">${esc(p.name)}</button>`;
      }).join('')}</div>
    </div>`;
  }).join('');

  return `<div class="main">
    <div class="stage-wrap">
      <div class="picker">
        <select class="in" data-in="teamA">${teamOptions(B.teamA, '— Left team —')}</select>
        <span class="vs">vs</span>
        <select class="in" data-in="teamB">${teamOptions(B.teamB, '— Right team —')}</select>
        <select class="in auto" data-in="asOfWeek" title="Records and averages as of the start of this week">
          ${weekOptions(B.asOfWeek, 'Entering Wk ')}
        </select>
        <select class="in auto" data-in="theme">
          ${THEMES.map((t) => `<option value="${t}"${t === B.theme ? ' selected' : ''}>${t === 'auto' ? `Theme: auto (${effectiveTheme()})` : t}</option>`).join('')}
        </select>
      </div>
      ${chips ? `<div class="chips">${chips}</div>` : ''}
      <canvas id="stage" width="${W}" height="${H}"></canvas>
      <div class="hint">Pick any two teams — records and averages fill in from the scores you have entered
        (“Entering Wk” sets the cutoff). Drag a logo or cut-out to move it, drag the ⤡ handle to resize.</div>
      ${B.selId ? `<div class="bar">
        <button class="btn" data-act="flip">Flip</button>
        <button class="btn" data-act="forward">Bring forward</button>
        <button class="btn" data-act="back">Send back</button>
        <button class="btn danger" data-act="delLayer">Delete</button>
      </div>` : ''}
    </div>

    <div class="side">
      ${featured ? `<div class="card">
        <div class="card-t">Featured players</div>
        ${featured}
        <div class="hint">Tap to add or remove — cut-outs face the centre automatically. First tap takes the
          front spot, extras stack behind.</div>
      </div>` : ''}

      <div class="card">
        <div class="card-t">Captions / trash talk</div>
        ${captionBlock('a', B.teamA, B.blurbA, 'Left team')}
        ${captionBlock('b', B.teamB, B.blurbB, 'Right team')}
      </div>

      <div class="card">
        <div class="card-t">Box labels &amp; overrides</div>
        <div class="row">
          <input class="in" data-in="label1" value="${esc(B.labels[0])}" placeholder="Top box label">
          <input class="in" data-in="label2" value="${esc(B.labels[1])}" placeholder="Bottom box label">
        </div>
        <div class="hint">Manual values — leave blank to use the entered scores.</div>
        <div class="row">
          <input class="in" data-in="ovr.ra" value="${esc(B.ovr.ra)}" placeholder="${esc(st.auto[0].record)} (left)">
          <input class="in" data-in="ovr.rb" value="${esc(B.ovr.rb)}" placeholder="${esc(st.auto[1].record)} (right)">
        </div>
        <div class="row">
          <input class="in" data-in="ovr.pa" value="${esc(B.ovr.pa)}" placeholder="${esc(st.auto[0].ppg)} (left)">
          <input class="in" data-in="ovr.pb" value="${esc(B.ovr.pb)}" placeholder="${esc(st.auto[1].ppg)} (right)">
        </div>
      </div>

      <div class="card">
        <div class="card-t">Art</div>
        <div class="row">
          ${fileBtn('League logo', 'leagueLogo')}
          ${fileBtn(B.bgImg ? 'Swap background' : 'Background', 'background')}
          ${fileBtn('Add cut-outs', 'players', true)}
        </div>
        ${B.bgImg ? '<button class="btn" data-act="clearBg">Use the painted stadium instead</button>' : ''}
        <div class="row">
          <button class="btn" data-act="saveSlots">Save logo spots</button>
          <button class="btn" data-act="snapSlots">Snap to spots</button>
        </div>
        <div class="hint">“Save logo spots” remembers where the two team logos sit, so every future graphic
          drops them in the same place at the same size.</div>
      </div>
    </div>
  </div>`;
}

const fileBtn = (label, kind, multiple, tid) =>
  `<label class="btn file">${esc(label)}<input type="file" accept="image/*"${multiple ? ' multiple' : ''}
    data-file="${kind}"${tid ? ` data-tid="${tid}"` : ''}></label>`;

function scoresTab() {
  const wk = B.league.weeks[B.selWeek];
  const rows = wk.map((m, mi) => {
    const A = teamById(m.a), Bt = teamById(m.b);
    if (!A || !Bt) return '';
    return `<div class="score-row">
      <span class="score-name" style="color:${A.color}">${esc(A.name)}</span>
      <input class="in num" inputmode="decimal" data-score="${mi}.sa" value="${esc(m.sa)}" placeholder="—">
      <span class="vs">–</span>
      <input class="in num" inputmode="decimal" data-score="${mi}.sb" value="${esc(m.sb)}" placeholder="—">
      <span class="score-name right" style="color:${Bt.color}">${esc(Bt.name)}</span>
    </div>`;
  }).join('');

  return `<div class="page">
    <div class="row">
      <select class="in" data-in="selWeek">${weekOptions(B.selWeek, 'Week ')}</select>
      <button class="btn" data-act="graphicFromWeek">Make a graphic</button>
    </div>
    <div class="card">
      <div class="card-t">${esc(weekLabel(B.selWeek))} results</div>
      ${rows || '<div class="hint">No matchups set for this week yet — set them on the Schedule tab.</div>'}
      <div class="hint">Type the final scores once and every record, average and suggested caption updates.</div>
    </div>
    <div class="card" id="standings">${standingsHTML()}</div>
  </div>`;
}

function standingsHTML() {
  const stats = statsThroughWeek(B.league, B.league.weeks.length);
  const rows = B.league.teams
    .map((t) => ({ t, s: stats[t.id] }))
    .sort((x, y) => (y.s.w - x.s.w) || (y.s.pts - x.s.pts))
    .map(({ t, s }, i) => `<div class="stand-row">
      <span class="rk">${i + 1}</span>
      <span class="score-name" style="color:${t.color}">${esc(t.name)}</span>
      <span class="mono">${fmtRecord(s)}</span>
      <span class="mono dim">${fmtPpg(s)}</span>
    </div>`).join('');
  return `<div class="card-t">Standings (median included)</div>${rows}`;
}

function scheduleTab() {
  const wk = B.league.weeks[B.selWeek];
  const rows = wk.map((m, mi) => `<div class="row">
    <select class="in" data-match="${mi}.a">${teamOptions(m.a, '— Team —')}</select>
    <span class="vs">vs</span>
    <select class="in" data-match="${mi}.b">${teamOptions(m.b, '— Team —')}</select>
  </div>`).join('');

  return `<div class="page">
    <div class="row">
      <select class="in" data-in="selWeek">${weekOptions(B.selWeek, 'Week ')}</select>
      <button class="btn" data-act="loadSchedule">Load the league schedule</button>
    </div>
    <div class="card">
      <div class="card-t">${esc(weekLabel(B.selWeek))}</div>
      ${rows}
      <div class="hint">“Load the league schedule” fills all ${B.league.weeks.length} weeks from the app's own
        round-robin, keeping any score you have already entered. Edit a week here if the real one differs.</div>
    </div>
  </div>`;
}

function teamsTab() {
  return `<div class="page">
    ${B.league.teams.map((t) => `<div class="card" style="border-left:4px solid ${t.color}">
      <div class="row">
        ${B.logos[t.id]
          ? `<img class="crest" src="${B.logoData[t.id]}" alt="">`
          : `<div class="crest empty" style="color:${t.color};background:${(T[t.id] || {}).bg || '#10131a'}">${esc((T[t.id] || {}).mono || '?')}</div>`}
        <input class="in" data-team="${t.id}.name" value="${esc(t.name)}">
        <input class="swatch" type="color" data-team="${t.id}.color" value="${t.color}" aria-label="${esc(t.name)} colour">
      </div>
      <div class="row">
        <select class="in" data-team="${t.id}.font" style="font-family:'${fontFamily(t.font)}'">
          ${FONTS.map((f) => `<option value="${f.k}"${f.k === t.font ? ' selected' : ''}>${f.lb}</option>`).join('')}
        </select>
        ${fileBtn(B.logos[t.id] ? 'Swap logo' : 'Upload logo', 'teamLogo', false, t.id)}
      </div>
      <div class="preview" style="font-family:'${fontFamily(t.font)}';color:${t.color}">${esc(t.name)}</div>
      <div class="players">
        <div class="card-t small">Cut-outs (${t.players.length})</div>
        ${t.players.map((p) => `<div class="row">
          <input class="in" data-player="${t.id}.${p.pid}.name" value="${esc(p.name)}">
          <button class="btn small" data-act="facing" data-tid="${t.id}" data-pid="${p.pid}" title="Which way the art faces">Faces ${p.facing === 'right' ? '▶' : '◀'}</button>
          <button class="btn small danger${B.pendingDel === p.pid ? ' armed' : ''}" data-act="delPlayer" data-tid="${t.id}" data-pid="${p.pid}">${B.pendingDel === p.pid ? 'Sure?' : '✕'}</button>
        </div>`).join('')}
        ${fileBtn('+ Add cut-outs', 'teamPlayers', true, t.id)}
      </div>
    </div>`).join('')}
    <div class="hint">Names, colours and typefaces start from the app's own team table. Editing them here
      changes the graphics only — the app is untouched.</div>
  </div>`;
}

// ---------- layers ----------
// A team with no uploaded logo falls back to its monogram, so both sides of the
// graphic always carry a crest.
function crestFor(id) {
  if (B.logos[id]) return B.logos[id];
  if (!T[id]) return null;
  if (!B.crests[id]) B.crests[id] = monogramCrest(T[id]);
  return B.crests[id];
}

function loadLogoLayers(aId, bId) {
  const slots = B.league.logoSlots || DEFAULT_SLOTS;
  const out = [];
  const place = (id, slot, role) => {
    const img = crestFor(id);
    if (!id || !img) return;
    out.push({ id: nid(), img, role, x: slot.x, y: slot.y, scale: slot.box / Math.max(img.width, img.height), flip: false });
  };
  place(aId, slots.a, 'logoA');
  place(bId, slots.b, 'logoB');
  B.layers = out;
  B.selId = null;
}

function saveLogoSlots() {
  const A = B.layers.find((l) => l.role === 'logoA');
  const Bl = B.layers.find((l) => l.role === 'logoB');
  if (!A && !Bl) { note('Load two logos first'); return; }
  if (!B.league.logoSlots) B.league.logoSlots = structuredClone(DEFAULT_SLOTS);
  const toSlot = (L) => ({
    x: Math.round(L.x), y: Math.round(L.y),
    box: Math.round(Math.max(L.img.width, L.img.height) * L.scale),
  });
  if (A) B.league.logoSlots.a = toSlot(A);
  if (Bl) B.league.logoSlots.b = toSlot(Bl);
  save();
  note('Logo spots saved');
}

function snapLogosToSlots() {
  const slots = B.league.logoSlots || DEFAULT_SLOTS;
  B.layers = B.layers.map((L) => {
    const slot = L.role === 'logoA' ? slots.a : L.role === 'logoB' ? slots.b : null;
    if (!slot || !L.img) return L;
    return { ...L, x: slot.x, y: slot.y, scale: slot.box / Math.max(L.img.width, L.img.height) };
  });
  draw();
}

async function getPlayerImage(tid, pid) {
  const key = playerKey(tid, pid);
  if (B.playerImgs[key]) return B.playerImgs[key];
  const img = await dataUrlToImage(readKey(key));
  if (img) B.playerImgs[key] = img;
  return img;
}

async function togglePlayerOnCanvas(side, tid, pid) {
  if (B.layers.some((l) => l.pid === pid)) {
    B.layers = B.layers.filter((l) => l.pid !== pid);
    render();
    return;
  }
  const team = teamById(tid);
  const player = team && team.players.find((p) => p.pid === pid);
  const img = await getPlayerImage(tid, pid);
  if (!img || !player) { note('Could not load that cut-out'); return; }
  const used = B.layers.filter((l) => l.side === side && l.pid).length;
  const slot = PLAYER_SLOTS[Math.min(used, PLAYER_SLOTS.length - 1)];
  // face inward: the left side looks right, the right side looks left
  const flip = side === 'left' ? player.facing === 'left' : player.facing === 'right';
  B.layers = [...B.layers, {
    id: nid(), img, pid, side,
    x: side === 'left' ? slot.x : W - slot.x,
    y: slot.y, scale: slot.box / img.height, flip,
  }];
  render();
}

// ---------- canvas interaction ----------
let drag = null;

function wireCanvas() {
  const cv = document.getElementById('stage');
  if (!cv) return;
  const pos = (e) => {
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const hitTest = (p) => {
    const sel = B.layers.find((l) => l.id === B.selId);
    if (sel && sel.img) {
      const hw = (sel.img.width * sel.scale) / 2, hh = (sel.img.height * sel.scale) / 2;
      if (Math.hypot(p.x - (sel.x + hw), p.y - (sel.y + hh)) < 20) return { layer: sel, mode: 'resize' };
    }
    for (let i = B.layers.length - 1; i >= 0; i--) {
      const L = B.layers[i];
      if (!L.img) continue;
      const hw = (L.img.width * L.scale) / 2, hh = (L.img.height * L.scale) / 2;
      if (p.x >= L.x - hw && p.x <= L.x + hw && p.y >= L.y - hh && p.y <= L.y + hh)
        return { layer: L, mode: 'move' };
    }
    return null;
  };

  cv.onpointerdown = (e) => {
    e.preventDefault();
    const p = pos(e);
    const hit = hitTest(p);
    const had = B.selId;
    if (!hit) { B.selId = null; if (had) render(); else draw(); return; }
    B.selId = hit.layer.id;
    cv.setPointerCapture(e.pointerId);
    if (hit.mode === 'move') drag = { mode: 'move', id: hit.layer.id, dx: p.x - hit.layer.x, dy: p.y - hit.layer.y };
    else drag = {
      mode: 'resize', id: hit.layer.id, startScale: hit.layer.scale,
      startDist: Math.max(Math.hypot(p.x - hit.layer.x, p.y - hit.layer.y), 8),
    };
    if (had !== B.selId) render(); else draw();
  };
  // Dragging redraws the canvas only — rebuilding the panel here would drop the
  // pointer capture and the drag with it.
  cv.onpointermove = (e) => {
    if (!drag) return;
    const p = pos(e);
    B.layers = B.layers.map((L) => {
      if (L.id !== drag.id) return L;
      if (drag.mode === 'move') return { ...L, x: p.x - drag.dx, y: p.y - drag.dy };
      const dist = Math.hypot(p.x - L.x, p.y - L.y);
      return { ...L, scale: Math.max(0.05, drag.startScale * (dist / drag.startDist)) };
    });
    draw();
  };
  cv.onpointerup = cv.onpointercancel = () => { drag = null; };
}

// ---------- export ----------
function doExport() {
  const cv = document.createElement('canvas');
  cv.width = W * 2;
  cv.height = H * 2;   // 2x so the PNG holds up when someone opens it full screen
  const ctx = cv.getContext('2d');
  ctx.scale(2, 2);
  drawGraphic(ctx, drawState(), { export: true });
  const url = cv.toDataURL('image/png');
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-in">
    <div class="modal-t">Your graphic is ready</div>
    <img src="${url}" alt="Exported matchup graphic">
    <div class="hint">On a phone: press and hold the image, then “Save Image”.</div>
    <div class="row">
      <a class="btn primary" href="${url}" download="matchup-${B.teamA || 'a'}-vs-${B.teamB || 'b'}-wk${B.asOfWeek + 1}.png">Download PNG</a>
      <button class="btn" data-act="closeModal">Close</button>
    </div>
  </div>`;
  modal.hidden = false;
}

// ---------- events ----------
function wire() {
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
}

function onClick(e) {
  const tab = e.target.closest('[data-tab]');
  if (tab) { B.tab = tab.dataset.tab; B.suggest = { a: [], b: [] }; render(); return; }
  const el = e.target.closest('[data-act]');
  if (!el) {
    if (e.target.id === 'modal') { document.getElementById('modal').hidden = true; }
    return;
  }
  const { act, side, tid, pid, mi, i } = el.dataset;
  switch (act) {
    case 'export': doExport(); break;
    case 'closeModal': document.getElementById('modal').hidden = true; break;
    case 'pickMatch': {
      const m = B.league.weeks[B.asOfWeek][+mi];
      B.teamA = m.a; B.teamB = m.b;
      B.blurbA = m.ba || ''; B.blurbB = m.bb || '';
      B.ovr = { ra: '', rb: '', pa: '', pb: '' };
      loadLogoLayers(m.a, m.b);
      remember();
      render();
      break;
    }
    case 'suggest':
      B.suggest[side] = roastsFor(B.league, side === 'a' ? B.teamA : B.teamB, B.asOfWeek);
      if (!B.suggest[side].length) note('No lines yet — enter some scores');
      render();
      break;
    case 'useLine': {
      const line = B.suggest[side][+i];
      if (side === 'a') B.blurbA = line; else B.blurbB = line;
      B.suggest[side] = [];
      storeCaption();
      render();
      break;
    }
    case 'togglePlayer': togglePlayerOnCanvas(side, tid, pid); break;
    case 'facing': {
      const t = teamById(tid);
      const p = t && t.players.find((x) => x.pid === pid);
      if (p) { p.facing = p.facing === 'right' ? 'left' : 'right'; save(); render(); }
      break;
    }
    case 'delPlayer':
      if (B.pendingDel === pid) { deletePlayer(tid, pid); B.pendingDel = null; }
      else { B.pendingDel = pid; }
      render();
      break;
    case 'flip': modSel((L) => ({ ...L, flip: !L.flip })); break;
    case 'forward': moveLayer(1); break;
    case 'back': moveLayer(-1); break;
    case 'delLayer':
      B.layers = B.layers.filter((l) => l.id !== B.selId);
      B.selId = null;
      render();
      break;
    case 'saveSlots': saveLogoSlots(); break;
    case 'snapSlots': snapLogosToSlots(); break;
    case 'clearBg':
      B.bgImg = null;
      delete B.logoData.background;
      saveLogoBundle(B.logoData);
      render();
      break;
    case 'loadSchedule':
      applyLeagueSchedule(B.league);
      save();
      note('Schedule loaded');
      render();
      break;
    case 'graphicFromWeek':
      B.asOfWeek = B.selWeek;
      B.tab = 'graphic';
      render();
      break;
    default: break;
  }
}

function modSel(fn) {
  B.layers = B.layers.map((L) => (L.id === B.selId ? fn(L) : L));
  draw();
}
function moveLayer(dir) {
  const i = B.layers.findIndex((l) => l.id === B.selId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= B.layers.length) return;
  const copy = [...B.layers];
  [copy[i], copy[j]] = [copy[j], copy[i]];
  B.layers = copy;
  draw();
}

// Captions typed on the graphic tab are kept with the scheduled matchup, so
// reopening that week brings the trash talk back.
function storeCaption() {
  const wk = B.league.weeks[B.asOfWeek];
  const m = wk && wk.find((x) => x.a === B.teamA && x.b === B.teamB);
  if (!m) return;
  m.ba = B.blurbA;
  m.bb = B.blurbB;
  save();
}

function onChange(e) {
  const file = e.target.closest('[data-file]');
  if (file && file.files && file.files.length) {
    handleFiles(file.dataset.file, file.dataset.tid, file.files);
    file.value = '';
    return;
  }
  const sel = e.target.closest('[data-in]');
  if (sel && sel.tagName === 'SELECT') applyField(sel.dataset.in, sel.value, true);
  const match = e.target.closest('[data-match]');
  if (match) {
    const [mi, field] = match.dataset.match.split('.');
    B.league.weeks[B.selWeek][+mi][field] = match.value;
    save();
    render();
  }
  const team = e.target.closest('[data-team]');
  if (team && (team.type === 'color' || team.tagName === 'SELECT')) {
    const [tid, field] = team.dataset.team.split('.');
    const t = teamById(tid);
    if (t) { t[field] = team.value; save(); render(); }
  }
}

function onInput(e) {
  const el = e.target;
  if (el.dataset.in && el.tagName !== 'SELECT') { applyField(el.dataset.in, el.value, false); return; }
  if (el.dataset.score) {
    const [mi, field] = el.dataset.score.split('.');
    B.league.weeks[B.selWeek][+mi][field] = el.value;
    save();
    const stand = document.getElementById('standings');
    if (stand) stand.innerHTML = standingsHTML();
    return;
  }
  if (el.dataset.team) {
    const [tid, field] = el.dataset.team.split('.');
    const t = teamById(tid);
    if (t) {
      t[field] = el.value;
      save();
      const prev = el.closest('.card').querySelector('.preview');
      if (prev) prev.textContent = el.value;
    }
    return;
  }
  if (el.dataset.player) {
    const [tid, pid, field] = el.dataset.player.split('.');
    const t = teamById(tid);
    const p = t && t.players.find((x) => x.pid === pid);
    if (p) { p[field] = el.value; save(); }
  }
}

// One place for "a control changed a value on the graphic".
function applyField(name, value, isSelect) {
  switch (name) {
    case 'teamA':
    case 'teamB': {
      if (name === 'teamA') B.teamA = value; else B.teamB = value;
      B.ovr = { ra: '', rb: '', pa: '', pb: '' };
      loadLogoLayers(B.teamA, B.teamB);
      remember();
      render();
      return;
    }
    case 'asOfWeek': B.asOfWeek = +value; remember(); render(); return;
    case 'selWeek': B.selWeek = +value; render(); return;
    case 'theme': B.theme = value; remember(); render(); return;
    case 'blurbA': B.blurbA = value; storeCaption(); draw(); return;
    case 'blurbB': B.blurbB = value; storeCaption(); draw(); return;
    case 'label1': B.labels[0] = value; remember(); draw(); return;
    case 'label2': B.labels[1] = value; remember(); draw(); return;
    default:
      if (name.startsWith('ovr.')) { B.ovr[name.slice(4)] = value; draw(); }
      if (isSelect) render();
  }
}

// ---------- uploads ----------
async function handleFiles(kind, tid, files) {
  if (kind === 'teamLogo') {
    const r = await readImageFile(files[0], 300, 'image/png');
    if (!r) return;
    B.logos[tid] = r.img;
    B.logoData[tid] = r.url;
    if (saveLogoBundle(B.logoData)) note('Saved');
    if (tid === B.teamA || tid === B.teamB) loadLogoLayers(B.teamA, B.teamB);
    render();
    return;
  }
  if (kind === 'leagueLogo') {
    const r = await readImageFile(files[0], 400, 'image/png');
    if (!r) return;
    B.leagueLogoImg = r.img;
    B.logoData.league = r.url;
    if (saveLogoBundle(B.logoData)) note('Saved');
    render();
    return;
  }
  if (kind === 'background') {
    // JPEG, and only 1400px wide: a full-bleed backdrop as PNG is several MB and
    // on its own fills the storage the whole league shares.
    const r = await readImageFile(files[0], 1400, 'image/jpeg', 0.82);
    if (!r) return;
    B.bgImg = r.img;
    B.logoData.background = r.url;
    if (saveLogoBundle(B.logoData)) note('Saved');
    render();
    return;
  }
  if (kind === 'players') {
    // dropped straight onto the canvas, not kept in a team's library
    for (const f of files) {
      const r = await readImageFile(f, 900, 'image/png');
      if (!r) continue;
      const leftCount = B.layers.filter((l) => l.x < W / 2).length;
      const goLeft = leftCount <= B.layers.length - leftCount;
      const layer = {
        id: nid(), img: r.img, x: goLeft ? 230 : W - 230, y: 460,
        scale: Math.min(1, 460 / r.img.height), flip: false,
      };
      B.layers = [...B.layers, layer];
      B.selId = layer.id;
    }
    render();
    return;
  }
  if (kind === 'teamPlayers') {
    const t = teamById(tid);
    if (!t) return;
    for (const f of files) {
      const r = await readImageFile(f, 800, 'image/png');
      if (!r) continue;
      const pid = 'p' + (Date.now().toString(36)) + nid().toString(36);
      const key = playerKey(tid, pid);
      if (!writeKey(key, r.url)) return;
      B.playerImgs[key] = r.img;
      const name = f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
      t.players.push({ pid, name: name || 'Player', facing: 'right' });
    }
    save();
    render();
  }
}

function deletePlayer(tid, pid) {
  const t = teamById(tid);
  if (t) t.players = t.players.filter((p) => p.pid !== pid);
  B.layers = B.layers.filter((l) => l.pid !== pid);
  delete B.playerImgs[playerKey(tid, pid)];
  removeKey(playerKey(tid, pid));
  save();
}
