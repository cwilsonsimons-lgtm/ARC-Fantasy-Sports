// Everything that paints the graphic. No DOM, no state — hand it a 2D context
// and a plain description of the matchup and it draws the same picture every
// time, which is what makes the export identical to the preview.
import {
  COL, H, LABEL_FONT, LOGO, PLATE, UI_FONT, VALUE_FONT, W,
  fontFamily, fontScale, fontWeight,
} from './data.js';

// ---------- primitives ----------
export function chamferPath(ctx, x, y, w, h, c) {
  ctx.beginPath();
  ctx.moveTo(x + c, y);
  ctx.lineTo(x + w - c, y);
  ctx.lineTo(x + w, y + c);
  ctx.lineTo(x + w, y + h - c);
  ctx.lineTo(x + w - c, y + h);
  ctx.lineTo(x + c, y + h);
  ctx.lineTo(x, y + h - c);
  ctx.lineTo(x, y + c);
  ctx.closePath();
}

export function wrapText(ctx, text, maxWidth) {
  const words = (text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

// Shrink until it fits. Team names run from "Brady Bunch" to "Seriously Step
// Burrow" across faces of wildly different width, so nothing here is a fixed size.
export function fitFontSize(ctx, text, family, weight, maxWidth, startSize, minSize) {
  let size = startSize;
  while (size > minSize) {
    ctx.font = `${weight} ${size}px "${family}"`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

export function strokedText(ctx, text, x, y, fill, strokeWidth, strokeColor = '#000') {
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  if (strokeWidth > 0) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

// Seeded so the crowd and the confetti sit in the same places on every redraw —
// an unseeded background shimmers under the cursor while you drag a logo, and
// two exports of the same matchup would not match.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEEDS = { classic: 42, halloween: 13, thanksgiving: 77, christmas: 99 };

// ---------- painted stadium ----------
export function drawStadiumBg(ctx, theme = 'classic') {
  const rnd = mulberry32(SEEDS[theme] || SEEDS.classic);

  const skies = {
    classic: [['#05070f', 0], ['#0b1226', 0.55], ['#101b33', 1]],
    halloween: [['#0d0416', 0], ['#241038', 0.5], ['#3a1130', 1]],
    thanksgiving: [['#170b03', 0], ['#3b2008', 0.55], ['#5a3110', 1]],
    christmas: [['#03101f', 0], ['#0a1e3a', 0.55], ['#12294d', 1]],
  };
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  for (const [c, s] of skies[theme] || skies.classic) sky.addColorStop(s, c);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // crowd band
  const crowd = ctx.createLinearGradient(0, H * 0.28, 0, H * 0.62);
  crowd.addColorStop(0, 'rgba(40,50,80,0)');
  crowd.addColorStop(0.5, 'rgba(55,62,95,0.55)');
  crowd.addColorStop(1, 'rgba(30,36,60,0)');
  ctx.fillStyle = crowd;
  ctx.fillRect(0, H * 0.28, W, H * 0.34);
  for (let i = 0; i < 900; i++) {
    const x = rnd() * W;
    const y = H * 0.3 + rnd() * H * 0.28;
    ctx.fillStyle = `rgba(${180 + rnd() * 75},${170 + rnd() * 70},${150 + rnd() * 80},${0.06 + rnd() * 0.12})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // light beams
  const beamSets = {
    classic: [[80, '#ffd88a'], [1090, '#9ec8ff'], [420, '#ffb3d1'], [750, '#a8ffe0']],
    halloween: [[80, '#ff9d3f'], [1090, '#b06bff'], [420, '#ff5c33'], [750, '#8a4dff']],
    thanksgiving: [[80, '#ffb85c'], [1090, '#ff8a3d'], [420, '#ffd27a'], [750, '#e8a04a']],
    christmas: [[80, '#ff6b6b'], [1090, '#6bff8f'], [420, '#ffe08a'], [750, '#8ab8ff']],
  };
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (const [bx, col] of beamSets[theme] || beamSets.classic) {
    const g = ctx.createRadialGradient(bx, -60, 10, bx, -60, 560);
    g.addColorStop(0, col + '55');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();

  // field
  const fields = {
    classic: ['#173a22', '#0c2413', 'rgba(255,255,255,0.28)', 'rgba(255,255,255,0.18)'],
    halloween: ['#33291a', '#1a1208', 'rgba(255,200,120,0.22)', 'rgba(255,200,120,0.12)'],
    thanksgiving: ['#3a2a12', '#20160a', 'rgba(255,220,160,0.25)', 'rgba(255,220,160,0.14)'],
    christmas: ['#dfe7ee', '#aebfcc', 'rgba(90,110,130,0.5)', 'rgba(90,110,130,0.3)'],
  };
  const [fTop, fBot, lineA, lineB] = fields[theme] || fields.classic;
  const fieldTop = H * 0.6;
  const field = ctx.createLinearGradient(0, fieldTop, 0, H);
  field.addColorStop(0, fTop);
  field.addColorStop(1, fBot);
  ctx.fillStyle = field;
  ctx.fillRect(0, fieldTop, W, H - fieldTop);
  ctx.strokeStyle = lineA;
  ctx.lineWidth = 3;
  for (let i = -6; i <= 6; i++) {
    ctx.beginPath();
    ctx.moveTo(W / 2 + i * 55, fieldTop);
    ctx.lineTo(W / 2 + i * 165, H);
    ctx.stroke();
  }
  ctx.strokeStyle = lineB;
  for (let y = fieldTop + 30; y < H; y += 42) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  if (theme === 'halloween') drawHalloween(ctx, rnd);
  else if (theme === 'thanksgiving') drawThanksgiving(ctx, rnd);
  else if (theme === 'christmas') drawChristmas(ctx, rnd);

  // vignette
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

function drawHalloween(ctx, rnd) {
  ctx.save();
  ctx.shadowColor = '#f5edd8';
  ctx.shadowBlur = 60;
  ctx.fillStyle = '#f2e9d0';
  ctx.beginPath();
  ctx.arc(W - 210, 150, 66, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(190,180,150,0.5)';
  for (const [mx, my, mr] of [[-20, -12, 10], [18, 14, 7], [8, -24, 5], [-28, 22, 6]]) {
    ctx.beginPath();
    ctx.arc(W - 210 + mx, 150 + my, mr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = '#0a0510';
  for (let i = 0; i < 14; i++) {
    const x = rnd() * W, y = 40 + rnd() * H * 0.4, s = 4 + rnd() * 6;
    ctx.beginPath();
    ctx.moveTo(x - 4 * s, y);
    ctx.quadraticCurveTo(x - 2 * s, y - 2 * s, x, y);
    ctx.quadraticCurveTo(x + 2 * s, y - 2 * s, x + 4 * s, y);
    ctx.quadraticCurveTo(x + 2 * s, y + s, x, y + 0.5 * s);
    ctx.quadraticCurveTo(x - 2 * s, y + s, x - 4 * s, y);
    ctx.fill();
  }
  const fog = ctx.createLinearGradient(0, H * 0.55, 0, H);
  fog.addColorStop(0, 'rgba(255,120,30,0)');
  fog.addColorStop(1, 'rgba(255,110,20,0.22)');
  ctx.fillStyle = fog;
  ctx.fillRect(0, H * 0.55, W, H * 0.45);
}

function drawThanksgiving(ctx, rnd) {
  const leafColors = ['#c2571b', '#a33b12', '#d98a2b', '#8a4a15'];
  for (let i = 0; i < 44; i++) {
    const x = rnd() * W, y = rnd() * H * 0.72, s = 5 + rnd() * 9;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rnd() * Math.PI * 2);
    ctx.globalAlpha = 0.45 + rnd() * 0.45;
    ctx.fillStyle = leafColors[Math.floor(rnd() * leafColors.length)];
    ctx.beginPath();
    ctx.ellipse(0, 0, s, s * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawChristmas(ctx, rnd) {
  const bulbColors = ['#ff4d4d', '#4dff6b', '#ffd24d', '#4da6ff'];
  ctx.strokeStyle = 'rgba(20,30,45,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 8) {
    const y = 10 + Math.sin(x / 90) * 6;
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  for (let x = 20, i = 0; x < W; x += 46, i++) {
    const y = 16 + Math.sin(x / 90) * 6;
    const c = bulbColors[i % bulbColors.length];
    ctx.save();
    ctx.shadowColor = c;
    ctx.shadowBlur = 14;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  for (let i = 0; i < 130; i++) {
    const x = rnd() * W, y = rnd() * H, r = 0.8 + rnd() * 2.1;
    ctx.globalAlpha = 0.25 + rnd() * 0.6;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Stand-in crest for a team with no uploaded logo: the same monogram, team
// colour and backdrop the app puts on its badges. A graphic is worth making
// before anyone has got round to uploading art, and an empty circle is worse
// than a letter. Returns a canvas, which drawImage takes like any image.
export function monogramCrest(team, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const r = size / 2;
  ctx.beginPath();
  ctx.arc(r, r, r - 6, 0, Math.PI * 2);
  ctx.fillStyle = team.bg || '#10131a';
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = team.c || '#c9a227';
  ctx.stroke();
  ctx.fillStyle = team.c || '#c9a227';
  ctx.font = `700 ${Math.round(size * 0.52)}px "${LABEL_FONT}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(team.mono || '?', r, r + size * 0.03);
  return c;
}

// ---------- the graphic ----------
// `opts.export` drops the editing furniture: selection outline, resize handle
// and the empty-logo placeholder never reach the exported PNG.
export function drawGraphic(ctx, state, opts = {}) {
  const { bgImg, leagueLogoImg, layers, sides, selId } = state;
  const showUi = !opts.export;

  ctx.clearRect(0, 0, W, H);

  if (bgImg) {
    const s = Math.max(W / bgImg.width, H / bgImg.height);
    const dw = bgImg.width * s, dh = bgImg.height * s;
    ctx.drawImage(bgImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, W, H);
  } else {
    drawStadiumBg(ctx, state.theme || 'classic');
  }

  for (const L of layers) {
    if (!L.img) continue;
    const dw = L.img.width * L.scale, dh = L.img.height * L.scale;
    ctx.save();
    ctx.translate(L.x, L.y);
    if (L.flip) ctx.scale(-1, 1);
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    ctx.drawImage(L.img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();

    if (showUi && L.id === selId) drawSelection(ctx, L.x, L.y, dw, dh);
  }

  drawStatColumn(ctx, state);
  drawPlate(ctx, PLATE.leftX, PLATE.leftW, sides[0]);
  drawPlate(ctx, PLATE.rightX, PLATE.rightW, sides[1]);

  if (leagueLogoImg) {
    const s = Math.min(LOGO.maxW / leagueLogoImg.width, LOGO.maxH / leagueLogoImg.height);
    const dw = leagueLogoImg.width * s, dh = leagueLogoImg.height * s;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 16;
    ctx.drawImage(leagueLogoImg, LOGO.cx - dw / 2, LOGO.cy - dh / 2, dw, dh);
    ctx.restore();
  } else if (showUi) {
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(LOGO.cx - 70, LOGO.cy - 60, 140, 120);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `600 16px "${UI_FONT}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('LEAGUE LOGO', LOGO.cx, LOGO.cy);
    ctx.restore();
  }
}

function drawSelection(ctx, x, y, dw, dh) {
  ctx.save();
  ctx.strokeStyle = '#ffd200';
  ctx.setLineDash([8, 6]);
  ctx.lineWidth = 2;
  ctx.strokeRect(x - dw / 2, y - dh / 2, dw, dh);
  ctx.setLineDash([]);
  ctx.fillStyle = '#ffd200';
  ctx.strokeStyle = '#000';
  const hx = x + dw / 2, hy = y + dh / 2;
  ctx.beginPath();
  ctx.arc(hx, hy, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.font = `700 13px "${UI_FONT}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⤡', hx, hy + 1);
  ctx.restore();
}

function drawStatColumn(ctx, state) {
  const { sides } = state;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 24;
  chamferPath(ctx, COL.x, COL.y, COL.w, COL.h, 16);
  const colFill = ctx.createLinearGradient(COL.x, COL.y, COL.x, COL.y + COL.h);
  colFill.addColorStop(0, 'rgba(10,12,20,0.88)');
  colFill.addColorStop(1, 'rgba(16,20,34,0.88)');
  ctx.fillStyle = colFill;
  ctx.fill();
  ctx.restore();
  chamferPath(ctx, COL.x, COL.y, COL.w, COL.h, 16);
  const metal = ctx.createLinearGradient(COL.x, COL.y, COL.x + COL.w, COL.y + COL.h);
  metal.addColorStop(0, '#e8e8ee');
  metal.addColorStop(0.5, '#8a8fa0');
  metal.addColorStop(1, '#e0e0ea');
  ctx.strokeStyle = metal;
  ctx.lineWidth = 3;
  ctx.stroke();

  const pad = 14;
  const innerX = COL.x + pad;
  const innerW = COL.w - pad * 2;
  let cy = COL.y + 26;

  const sectionLabel = (label) => {
    const txt = (label || '').toUpperCase();
    const size = fitFontSize(ctx, txt, LABEL_FONT, '700', COL.w - 24, 18, 10);
    ctx.font = `700 ${size}px "${LABEL_FONT}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    strokedText(ctx, txt, W / 2, cy, '#ffffff', 4);
    cy += 24;
  };

  const valueCells = (v1, v2) => {
    const cellW = (innerW - 10) / 2;
    const cellH = 46;
    const cells = [
      { x: innerX, v: v1, c: sides[0].color },
      { x: innerX + cellW + 10, v: v2, c: sides[1].color },
    ];
    for (const cell of cells) {
      chamferPath(ctx, cell.x, cy, cellW, cellH, 8);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fill();
      ctx.strokeStyle = cell.c;
      ctx.lineWidth = 2.5;
      ctx.save();
      ctx.shadowColor = cell.c;
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.restore();
      const size = fitFontSize(ctx, cell.v, VALUE_FONT, '400', cellW - 12, 20, 10);
      ctx.font = `400 ${size}px "${VALUE_FONT}"`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(cell.v, cell.x + cellW / 2, cy + cellH / 2 + 1);
    }
    cy += cellH + 20;
  };

  const labels = state.labels || ['Record', 'Average Points'];
  sectionLabel(labels[0] || 'Record');
  valueCells(sides[0].record, sides[1].record);
  sectionLabel(labels[1] || 'Average Points');
  valueCells(sides[0].ppg, sides[1].ppg);

  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(innerX, cy - 6);
  ctx.lineTo(innerX + innerW, cy - 6);
  ctx.stroke();
  cy += 8;

  // The two captions split whatever is left, so a long roast shrinks itself
  // rather than running out of the column.
  const remaining = COL.y + COL.h - cy - 12;
  const half = remaining / 2;
  const drawBlurb = (side, topY, availH) => {
    ctx.fillStyle = side.color;
    ctx.fillRect(W / 2 - 22, topY, 44, 4);
    let size = 19, lines = [];
    while (size >= 11) {
      ctx.font = `600 ${size}px "${LABEL_FONT}"`;
      lines = wrapText(ctx, side.blurb, innerW);
      if (lines.length * (size + 7) <= availH - 16) break;
      size -= 1;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    let ty = topY + 16 + size;
    for (const line of lines) {
      strokedText(ctx, line, W / 2, ty, '#ffffff', 5);
      ty += size + 7;
    }
  };
  drawBlurb(sides[0], cy, half);
  drawBlurb(sides[1], cy + half + 4, half);
}

function drawPlate(ctx, x, w, side) {
  ctx.save();
  ctx.shadowColor = side.color;
  ctx.shadowBlur = 22;
  chamferPath(ctx, x, PLATE.y, w, PLATE.h, 18);
  const pf = ctx.createLinearGradient(x, PLATE.y, x, PLATE.y + PLATE.h);
  pf.addColorStop(0, 'rgba(8,10,18,0.92)');
  pf.addColorStop(1, 'rgba(20,24,40,0.92)');
  ctx.fillStyle = pf;
  ctx.fill();
  ctx.restore();
  chamferPath(ctx, x, PLATE.y, w, PLATE.h, 18);
  ctx.strokeStyle = side.color;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  chamferPath(ctx, x + 5, PLATE.y + 5, w - 10, PLATE.h - 10, 14);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const family = fontFamily(side.font);
  const weight = fontWeight(side.font);
  // Faces in this set differ by up to 40% in optical size at the same px, so
  // start from the corrected size and let the fitter take it down from there.
  const start = Math.round(46 * fontScale(side.font));
  const size = fitFontSize(ctx, side.name, family, weight, w - 44, start, 16);
  ctx.font = `${weight} ${size}px "${family}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  strokedText(ctx, side.name, x + w / 2, PLATE.y + PLATE.h / 2 + 3, side.color, 6);
}
