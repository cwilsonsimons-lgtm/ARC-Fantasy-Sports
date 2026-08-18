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
    week, year: state.year, game,
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
    const ls = parseFloat(face.ls) || 0;
    // The face's tracking is quoted at ~14px in the app; scale it with the type.
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

// Shrink until it fits the box. Single lines scale straight from one
// measurement; wrapped text has to iterate, because the wrap changes with size.
function fit(ctx, text, face, slot, W, H, boxW, boxH) {
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
    const wide = lines.some(l => ctx.measureText(l).width > boxW);
    const tall = lines.length * px * LH > boxH;
    if (!wide && !tall) break;
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

function shade(ctx, slot, H) {
  if (!slot.shadow) { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; return; }
  ctx.shadowColor = slot.shadowColor || '#000';
  ctx.shadowBlur = slot.shadow * H * 0.12;
  ctx.shadowOffsetY = slot.shadow * H * 0.03;
}

function colorOf(slot, t) {
  if (slot.color === 'team')   return (t && t.color) || '#ffffff';
  if (slot.color === 'accent') return (t && t.accent) || '#ffffff';
  return slot.color || '#ffffff';
}

function drawText(ctx, slot, c, W, H) {
  const t = slot.side === 'b' ? c.b : slot.side === 'a' ? c.a : null;
  let text = resolve(slot.text, slot.side, c);
  const face = faceOf(slot, t);
  if (slot.caps || face.tt === 'uppercase') text = text.toUpperCase();
  if (!text.trim()) return;

  const b = box(slot, W, H);
  const { lines, px } = fit(ctx, text, face, slot, W, H, b.w, b.h);

  const m = ctx.measureText(lines[0] || 'H');
  const asc = m.actualBoundingBoxAscent || px * 0.75;
  const desc = m.actualBoundingBoxDescent || px * 0.22;
  const blockH = (lines.length - 1) * px * LH + asc + desc;
  const top = b.y + (b.h - blockH) * (slot.valign === 'top' ? 0 : slot.valign === 'bottom' ? 1 : 0.5);

  ctx.textAlign = slot.align;
  ctx.textBaseline = 'alphabetic';
  const ax = slot.align === 'left' ? b.x : slot.align === 'right' ? b.x + b.w : b.x + b.w / 2;

  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  lines.forEach((line, i) => {
    const y = top + asc + i * px * LH;
    ctx.save();
    // The shadow belongs to whatever is outermost: the outline if there is one,
    // otherwise the fill. Casting it from both doubles it into a smear.
    shade(ctx, slot, H);
    if (slot.stroke > 0) {
      ctx.lineWidth = slot.stroke * H * 2;
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
  shade(ctx, slot, H);
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
    else drawText(ctx, slot, c, W, H);
    ctx.restore();
  });
  return canvas;
}
