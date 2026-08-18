// The renderer. One function draws a matchup screen, and both the on-screen
// preview and the exported PNG call it, so what you position is what you post.
//
// Every slot coordinate is a fraction of the canvas, never a pixel. That is
// what makes a layout portable: the same slots land in the same place on a
// 2000x1300 background and on a 1080x1080 one, and a template survives having
// its background swapped for the Thanksgiving version.

import { IMG, fontFamily } from './assets.js';
import { state, team, tpl, FONTS } from './store.js';
import { stats, isFinal } from './standings.js';

const FONT_BY_KEY = {};
FONTS.forEach(f => { FONT_BY_KEY[f.k] = f; });

const LH = 1.14;              // line height, as a multiple of font size
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- data behind a slot ----------

export function context(game, week, opts = {}) {
  const through = opts.includeWeek ? week : week - 1;
  const s = stats(through);
  const of = id => s.rows.get(id) || { record: '0-0', ppg: 0, pf: 0, pa: 0, rank: 0, streak: '-' };
  return {
    week, year: state.year, game, all: s.rows,
    a: team(game && game.a), b: team(game && game.b),
    sa: of(game && game.a), sb: of(game && game.b),
  };
}

const fmt1 = n => (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '.00');

function value(token, side, c) {
  const t = side === 'b' ? c.b : c.a;
  const o = side === 'b' ? c.a : c.b;
  const r = side === 'b' ? c.sb : c.sa;
  const g = c.game || {};
  const score = side === 'b' ? g.bs : g.as;
  switch (token) {
    case 'team':    return t ? t.name : '';
    case 'manager': return t ? t.mgr || '' : '';
    case 'record':  return r.record;
    case 'ppg':     return r.gp ? fmt1(r.ppg) : '--';
    case 'pf':      return fmt1(r.pf);
    case 'pa':      return fmt1(r.pa);
    case 'rank':    return r.rank ? String(r.rank) : '';
    case 'streak':  return r.streak || '-';
    case 'note':    return (side === 'b' ? g.noteB : g.noteA) || '';
    case 'score':   return isFinal(g) ? fmt1(score) : '';
    case 'opp':     return o ? o.name : '';
    case 'week':    return String(c.week);
    case 'year':    return String(c.year);
    default:        return '';
  }
}

export function resolve(text, side, c) {
  return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => value(k.toLowerCase(), side, c));
}

// What a slot is sized against. The point is that the answer does not change
// from screen to screen, so a value is never measured on its own:
//
//   pair   - the wider of the two teams on this screen, so both sides come out
//            at one size and as large as the box allows. The default.
//   league - the longest name in the league, so every screen in every week is
//            identical. Absolute, at the cost of sizing for the worst case.
//   off    - measure the actual string. Only sensible for a wrapped blurb,
//            which has no worst case to measure.
//
// Numbers never use the actual value under pair or league: a record is sized
// against 88-88 and a score against 888.88, because 8 is the widest glyph in
// almost every face. So a record does not resize when a team goes from 3-2 to
// 12-4, and week 14 lines up with week 1.
export const sizingOf = slot => slot.sizing || (slot.lock === false ? 'off' : 'pair');

const WIDEST = {
  record: '88-88', ppg: '888.88', pf: '8888.88', pa: '8888.88', score: '888.88',
  rank: '88', streak: 'W88', week: '88', year: '8888',
};

function longestName(c, mode) {
  if (mode === 'league') {
    return state.teams.reduce((best, t) => (t.name || '').length > best.length ? t.name : best, '');
  }
  const a = (c.a && c.a.name) || '', b = (c.b && c.b.name) || '';
  return a.length >= b.length ? a : b;
}

function longestMgr(c, mode) {
  if (mode === 'league') {
    return state.teams.reduce((best, t) => (t.mgr || '').length > best.length ? t.mgr : best, '');
  }
  const a = (c.a && c.a.mgr) || '', b = (c.b && c.b.mgr) || '';
  return a.length >= b.length ? a : b;
}

function gauge(text, side, c, mode) {
  return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const key = k.toLowerCase();
    if (key === 'team' || key === 'opp') return longestName(c, mode);
    if (key === 'manager') return longestMgr(c, mode);
    if (key === 'note') return value(key, side, c);   // free text has no worst case
    return WIDEST[key] != null ? WIDEST[key] : value(key, side, c);
  });
}

// ---------- type ----------

function faceOf(slot, t) {
  const key = slot.font === 'team' ? (t && t.font) || 'oswald' : slot.font;
  if (String(key).startsWith('custom:')) {
    const id = key.slice(7);
    const f = (state.fonts || []).find(x => x.id === id);
    return { ff: `'${fontFamily(id)}'`, w: 400, sc: 1, tt: 'none', ls: '0', lb: f ? f.name : 'custom' };
  }
  return FONT_BY_KEY[key] || FONT_BY_KEY.oswald;
}

function setFont(ctx, face, px) {
  ctx.font = `${face.w} ${px}px ${face.ff}, 'Oswald', sans-serif`;
  if ('letterSpacing' in ctx) {
    // The face's tracking is quoted at ~14px in the app; scale it with the type.
    const ls = parseFloat(face.ls) || 0;
    ctx.letterSpacing = (ls * px / 14).toFixed(2) + 'px';
  }
}

function wrapLines(ctx, text, maxW) {
  const out = [];
  text.split('\n').forEach(para => {
    let line = '';
    para.split(/\s+/).filter(Boolean).forEach(word => {
      const next = line ? line + ' ' + word : word;
      if (line && ctx.measureText(next).width > maxW) { out.push(line); line = word; }
      else line = next;
    });
    out.push(line);
  });
  return out.length ? out : [''];
}

// Cap height per 1px of font size. Two faces at the same px are not the same
// size on the page - Bungee towers over Oswald - so a slot that inherits each
// team's own typeface has to be matched on cap height, not on px, or the names
// come out at visibly different sizes and sit on different lines.
const CAP = new Map();
function capUnit(ctx, face) {
  const key = face.ff + '|' + face.w;
  if (CAP.has(key)) return CAP.get(key);
  setFont(ctx, face, 100);
  const m = ctx.measureText('H');
  const u = (m.actualBoundingBoxAscent || 72) / 100;
  CAP.set(key, u);
  return u;
}

// Every face this slot might be drawn in - both sides of this screen, or every
// team in the league when the size has to hold across all of them.
function facesFor(slot, c, mode) {
  if (slot.font !== 'team') return [faceOf(slot, null)];
  const teams = mode === 'league' ? state.teams : [c.a, c.b].filter(Boolean);
  const seen = new Set(), out = [];
  teams.forEach(t => {
    const f = faceOf(slot, t);
    const k = f.ff + '|' + f.w;
    if (!seen.has(k)) { seen.add(k); out.push(f); }
  });
  return out.length ? out : [faceOf(slot, null)];
}

// The one cap height this slot uses on every screen: the largest that fits the
// box for the widest value the slot could ever hold, in the least economical
// face any team has picked. Deterministic, so week 1 and week 14 match.
function lockedCap(ctx, slot, c, H, b, mode) {
  const g = gauge(slot.text, slot.side, c, mode);
  let cap = slot.size * H * 0.72;
  facesFor(slot, c, mode).forEach(face => {
    const u = capUnit(ctx, face);
    const str = slot.caps || face.tt === 'uppercase' ? g.toUpperCase() : g;
    setFont(ctx, face, 100);
    const w100 = ctx.measureText(str).width;
    let px = slot.size * H * (face.sc || 1);
    if (w100 > 0) px = Math.min(px, b.w * 100 / w100);
    cap = Math.min(cap, px * u);
  });
  return Math.max(2, Math.min(cap, b.h * 0.92));
}

// Unlocked: size to the string in front of us, which is what a note wants.
function fitLoose(ctx, text, face, slot, H, boxW, boxH) {
  let px = Math.max(4, slot.size * H * (face.sc || 1));
  if (!slot.wrap) {
    setFont(ctx, face, px);
    const w = ctx.measureText(text).width;
    if (w > boxW) px *= boxW / w;
    px = Math.min(px, boxH / 1.02);
    setFont(ctx, face, px);
    return { lines: [text], px };
  }
  let lines = [];
  for (let i = 0; i < 24; i++) {
    setFont(ctx, face, px);
    lines = wrapLines(ctx, text, boxW);
    if (!lines.some(l => ctx.measureText(l).width > boxW) && lines.length * px * LH <= boxH) break;
    px *= 0.93;
    if (px < 4) break;
  }
  setFont(ctx, face, px);
  return { lines, px };
}

// ---------- slots ----------

function box(slot, W, H) {
  return { x: slot.x * W, y: slot.y * H, w: slot.w * W, h: slot.h * H };
}

// Outline and shadow are set as a fraction of the canvas so a template keeps
// one look at any resolution - but they also have to stay in proportion to the
// type. At the canvas figure alone, a name that shrank to fit a long string got
// a 39px blur around an 8px letter and disappeared into its own halo, so both
// are capped against the size actually being drawn.
function shade(ctx, slot, H, px) {
  if (!slot.shadow) { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; return; }
  ctx.shadowColor = slot.shadowColor || '#000';
  ctx.shadowBlur = Math.min(slot.shadow * H * 0.12, px * 0.7);
  ctx.shadowOffsetY = Math.min(slot.shadow * H * 0.03, px * 0.2);
}

const strokeWidth = (slot, H, px) => Math.min(slot.stroke * H * 2, px * 0.22);

function colorOf(slot, t) {
  if (slot.color === 'team')   return (t && t.color) || '#ffffff';
  if (slot.color === 'accent') return (t && t.accent) || '#ffffff';
  return slot.color || '#ffffff';
}

function drawText(ctx, slot, c, W, H, trace) {
  const t = slot.side === 'b' ? c.b : slot.side === 'a' ? c.a : null;
  let text = resolve(slot.text, slot.side, c);
  const face = faceOf(slot, t);
  if (slot.caps || face.tt === 'uppercase') text = text.toUpperCase();
  if (!text.trim()) return;

  const b = box(slot, W, H);
  // A wrapped blurb has no worst case to measure, so it always sizes to itself.
  const mode = slot.wrap ? 'off' : sizingOf(slot);
  const locked = mode !== 'off';
  let px, lines;
  if (locked) {
    px = lockedCap(ctx, slot, c, H, b, mode) / capUnit(ctx, face);
    setFont(ctx, face, px);
    const w = ctx.measureText(text).width;
    if (w > b.w) { px *= b.w / w; setFont(ctx, face, px); }   // safety, never spills
    lines = [text];
  } else {
    ({ lines, px } = fitLoose(ctx, text, face, slot, H, b.w, b.h));
  }

  // Anchor on the capitals, not on the glyphs in this particular string:
  // actualBoundingBox* made "PPG: --" sit higher than "PPG: 162.93", and a name
  // without a descender sit higher than one with a g in it.
  //
  // A locked slot is laid out against the size it was *asked* for rather than
  // the size it came out at, so a screen whose names happen to fit larger still
  // puts its baseline on exactly the same line as every other screen.
  const capH = px * capUnit(ctx, face);
  const refCap = locked ? Math.min(slot.size * H * 0.72, b.h * 0.92) : capH;
  const blockH = (lines.length - 1) * px * LH + refCap;
  const top = b.y + (b.h - blockH) * (slot.valign === 'top' ? 0 : slot.valign === 'bottom' ? 1 : 0.5);

  ctx.textAlign = slot.align;
  ctx.textBaseline = 'alphabetic';
  const ax = slot.align === 'left' ? b.x : slot.align === 'right' ? b.x + b.w : b.x + b.w / 2;

  // The whole promise of the tool is that this number is the same on every
  // screen, so make it readable rather than something you can only see.
  if (trace) trace[slot.id] = { px: +px.toFixed(2), cap: +capH.toFixed(2),
    baseline: +(top + refCap).toFixed(2), lines: lines.length, mode };

  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  lines.forEach((line, i) => {
    const y = top + refCap + i * px * LH;
    ctx.save();
    // The shadow belongs to whatever is outermost: the outline if there is one,
    // otherwise the fill. Casting it from both doubles it into a smear.
    shade(ctx, slot, H, px);
    if (slot.stroke > 0) {
      ctx.lineWidth = strokeWidth(slot, H, px);
      ctx.strokeStyle = slot.strokeColor || '#000';
      ctx.strokeText(line, ax, y);
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    }
    ctx.fillStyle = colorOf(slot, t);
    ctx.fillText(line, ax, y);
    ctx.restore();
  });
}

function drawImage(ctx, slot, c, W, H) {
  const t = slot.side === 'b' ? c.b : c.a;
  const b = box(slot, W, H);
  const img = t && t.logo ? IMG.get(t.logo) : null;
  if (!img) return monogram(ctx, b, t);

  // Contain, so a wide wordmark and a square crest both sit inside the slot.
  const k = Math.min(b.w / img.naturalWidth, b.h / img.naturalHeight);
  const w = img.naturalWidth * k, h = img.naturalHeight * k;
  const x = b.x + (b.w - w) * (slot.align === 'left' ? 0 : slot.align === 'right' ? 1 : .5);
  const y = b.y + (b.h - h) * (slot.valign === 'top' ? 0 : slot.valign === 'bottom' ? 1 : .5);
  shade(ctx, slot, H, Math.min(w, h));
  ctx.drawImage(img, x, y, w, h);
  ctx.shadowColor = 'transparent';
}

// A team with no logo yet still gets a mark, so the screen is never half-built.
function monogram(ctx, b, t) {
  const d = Math.min(b.w, b.h), x = b.x + (b.w - d) / 2, y = b.y + (b.h - d) / 2;
  ctx.save();
  ctx.fillStyle = (t && t.color) || '#888';
  ctx.globalAlpha = 0.9;
  const r = d * 0.22;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, d, d, r) : ctx.rect(x, y, d, d);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#0b0f14';
  ctx.font = `800 ${d * 0.5}px 'Oswald', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(((t && t.name) || '?').trim()[0].toUpperCase(), x + d / 2, y + d / 2 + d * 0.02);
  ctx.restore();
}

// ---------- the screen ----------

export function draw(canvas, opts = {}) {
  const t = tpl(opts.tplId);
  const scale = opts.scale || 1;
  const W = Math.round(t.w * scale), H = Math.round(t.h * scale);
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = t.bgColor || '#0b1220';
  ctx.fillRect(0, 0, W, H);

  const bg = t.bg ? IMG.get(t.bg) : null;
  if (bg) {
    // Cover: fill the frame, crop the overflow, exactly like CSS background-size.
    const k = Math.max(W / bg.naturalWidth, H / bg.naturalHeight);
    const w = bg.naturalWidth * k, h = bg.naturalHeight * k;
    ctx.drawImage(bg, (W - w) / 2, (H - h) / 2, w, h);
  }

  const c = opts.ctx || context(opts.game, opts.week || state.week, opts);
  t.slots.forEach(slot => {
    if (slot.hidden) return;
    ctx.save();
    ctx.globalAlpha = clamp(slot.opacity == null ? 1 : slot.opacity, 0, 1);
    if (slot.rotate) {
      const b = box(slot, W, H);
      ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
      ctx.rotate(slot.rotate * Math.PI / 180);
      ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
    }
    if (slot.kind === 'image') drawImage(ctx, slot, c, W, H);
    else drawText(ctx, slot, c, W, H, opts.trace);
    ctx.restore();
  });
  return canvas;
}
