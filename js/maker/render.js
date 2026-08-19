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

// A slot occupies a fixed number of lines or fewer, so a long team name cannot
// grow downwards into the row beneath it. Past the limit the words are split
// across the lines available and the block condenses to fit - and the split is
// chosen to make the *widest* line as narrow as possible, because that line is
// what sets the condense. Greedy filling put "SERIOUSLY STEP" on one line and
// "BURROW" on the next, which needed more squeeze than the balanced split does.
function wrapTo(ctx, text, maxW, maxLines) {
  const lines = wrapLines(ctx, text, maxW);
  if (!maxLines || lines.length <= maxLines) return lines;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxLines) return words;

  const w = words.map(x => ctx.measureText(x).width);
  const space = ctx.measureText(' ').width;
  const width = (i, j) => w.slice(i, j).reduce((a, b) => a + b, 0) + space * (j - i - 1);

  // best[i][k] = the narrowest possible widest-line for words[i..] over k lines
  const memo = new Map();
  const best = (i, k) => {
    if (k === 1) return { max: width(i, words.length), cuts: [] };
    const key = i + ':' + k;
    if (memo.has(key)) return memo.get(key);
    let out = null;
    for (let j = i + 1; j <= words.length - (k - 1); j++) {
      const rest = best(j, k - 1);
      const max = Math.max(width(i, j), rest.max);
      if (!out || max < out.max) out = { max, cuts: [j].concat(rest.cuts) };
    }
    memo.set(key, out);
    return out;
  };

  const cuts = best(0, Math.min(maxLines, words.length)).cuts.concat(words.length);
  const out = [];
  let from = 0;
  cuts.forEach(c => { out.push(words.slice(from, c).join(' ')); from = c; });
  return out;
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

// ---------- slots ----------

function box(slot, W, H) {
  return { x: slot.x * W, y: slot.y * H, w: slot.w * W, h: slot.h * H };
}

// Outline and shadow are set as a fraction of the canvas so a template keeps
// one look at any resolution - but they also have to stay in proportion to the
// type, or a small line gets a 39px blur around an 8px letter and disappears
// into its own halo.
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

// A text slot is not a box. It is a baseline at slot.y, an anchor at slot.x,
// and one cap height, and all three are fixed - so a record is drawn at the
// same size on the same line whatever it says, and every record on every screen
// lands on top of the last one.
//
// Nothing about the value is allowed to change the size. A string too wide for
// its span is condensed horizontally instead, which shortens it without moving
// the baseline or changing the cap height. Only past the condense floor does it
// give up and scale down, which in practice means a name nobody has.
const SQUEEZE_FLOOR = 0.5;

function drawText(ctx, slot, c, W, H, trace) {
  const t = slot.side === 'b' ? c.b : slot.side === 'a' ? c.a : null;
  let text = resolve(slot.text, slot.side, c);
  const face = faceOf(slot, t);
  if (slot.caps || face.tt === 'uppercase') text = text.toUpperCase();
  if (!text.trim()) return;

  const cap = slot.size * H;                     // the cap height, exactly
  let px = cap / capUnit(ctx, face);             // whatever px that face needs
  setFont(ctx, face, px);

  const span = slot.w * W;
  const ax = slot.x * W;
  const baseline = slot.y * H;
  const lineH = px * LH;

  let lines = slot.wrap ? wrapTo(ctx, text, span, slot.maxLines || 0) : [text];
  let squeeze = 1;
  const widest = () => lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
  if (widest() > span) {
    squeeze = Math.max(SQUEEZE_FLOOR, span / widest());
    if (widest() * squeeze > span + 0.5) {
      // Past the floor. Scale down as a last resort and say so in the trace.
      px *= span / (widest() * squeeze);
      setFont(ctx, face, px);
      if (slot.wrap) lines = wrapTo(ctx, text, span / squeeze, slot.maxLines || 0);
    }
  }

  if (trace) trace[slot.id] = {
    cap: +(px * capUnit(ctx, face)).toFixed(2), px: +px.toFixed(2),
    baseline: +baseline.toFixed(2), squeeze: +squeeze.toFixed(3), lines: lines.length,
  };

  ctx.textAlign = slot.align;
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  lines.forEach((line, i) => {
    ctx.save();
    // Condensing is done about the anchor, so left/centre/right stays put.
    ctx.translate(ax, baseline + i * lineH);
    if (squeeze !== 1) ctx.scale(squeeze, 1);
    shade(ctx, slot, H, px);
    if (slot.stroke > 0) {
      ctx.lineWidth = strokeWidth(slot, H, px) / squeeze;
      ctx.strokeStyle = slot.strokeColor || '#000';
      ctx.strokeText(line, 0, 0);
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    }
    ctx.fillStyle = colorOf(slot, t);
    ctx.fillText(line, 0, 0);
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
