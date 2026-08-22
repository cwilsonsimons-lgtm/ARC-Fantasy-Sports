import { useState, useRef, useEffect, useCallback } from "react";

/* ============================================================
   CITY BOYS DYNASTY — LEAGUE MATCHUP BUILDER
   Teams, schedule, and scores are saved between sessions.
   Pick a matchup → graphic auto-fills names, fonts, records,
   average points, and drops in team logos. Export as PNG.
   ============================================================ */

const W = 1370;
const H = 770;

const FONTS = [
  "Bangers",
  "Bungee",
  "Black Ops One",
  "Titan One",
  "Pacifico",
  "Lobster",
  "UnifrakturMaguntia",
  "Orbitron",
  "Rye",
];

const FONT_LINK =
  "https://fonts.googleapis.com/css2?family=Bangers&family=Bungee&family=Black+Ops+One&family=Titan+One&family=Pacifico&family=Lobster&family=UnifrakturMaguntia&family=Orbitron&family=Rye&family=Barlow+Condensed:wght@400;600;700&display=swap";

const DEFAULT_TEAMS = [
  { id: "diggin", name: "Diggin In Boutte", color: "#ff8c42", font: "Titan One" },
  { id: "horns", name: "Texas Longhorns", color: "#e06e1f", font: "Rye" },
  { id: "brady", name: "Brady Bunch", color: "#ffd9a0", font: "Bungee" },
  { id: "burrow", name: "Seriously Step Burrow", color: "#f26522", font: "Bangers" },
  { id: "barzal", name: "Barzal's Balls", color: "#4da6ff", font: "Titan One" },
  { id: "dakyard", name: "Dakyard Football", color: "#6b7bff", font: "Bungee" },
  { id: "vick", name: "Mike Vick's Dog House", color: "#3ec9a7", font: "Lobster" },
  { id: "romo", name: "Romosexual", color: "#ff5fb0", font: "Pacifico" },
  { id: "dones", name: "One & Dones", color: "#ffd200", font: "UnifrakturMaguntia" },
  { id: "saquon", name: "Saquon My Balls", color: "#3ddc84", font: "Bungee" },
];

const DEFAULT_WEEK_COUNT = 14;
const LEAGUE_KEY = "cityboys-league-v1";
const LOGOS_KEY = "cityboys-logos-v1"; // all team + league logos in one bundle
const logoKey = (id) => `cityboys-logo-${id}`; // legacy per-team keys (migrated)
const playerKey = (tid, pid) => `cityboys-player-${tid}-${pid}`;

// 2026 City Boys Dynasty schedule (owner → team ids)
// Wilson=dones Luke=barzal Jake=dakyard Seabass=vick Manas=brady
// Jatin=diggin Jarren=burrow Cam=saquon Mason=horns Benton=romo
const SEASON_SCHEDULE = [
  /* Wk 1  */ [["dones","dakyard"],["barzal","brady"],["vick","burrow"],["diggin","horns"],["saquon","romo"]],
  /* Wk 2  */ [["dones","vick"],["barzal","burrow"],["dakyard","brady"],["diggin","romo"],["saquon","horns"]],
  /* Wk 3  */ [["dones","brady"],["barzal","dakyard"],["vick","horns"],["diggin","burrow"],["saquon","romo"]],
  /* Wk 4  */ [["dones","saquon"],["barzal","horns"],["dakyard","diggin"],["vick","brady"],["burrow","romo"]],
  /* Wk 5  */ [["dones","barzal"],["dakyard","vick"],["brady","diggin"],["burrow","saquon"],["horns","romo"]],
  /* Wk 6  */ [["dones","diggin"],["barzal","saquon"],["dakyard","burrow"],["vick","romo"],["brady","horns"]],
  /* Wk 7  */ [["dones","burrow"],["barzal","vick"],["dakyard","saquon"],["brady","romo"],["diggin","horns"]],
  /* Wk 8  */ [["dones","horns"],["barzal","diggin"],["dakyard","romo"],["vick","saquon"],["brady","burrow"]],
  /* Wk 9  */ [["dones","romo"],["barzal","dakyard"],["vick","diggin"],["brady","saquon"],["burrow","horns"]],
  /* Wk 10 */ [["dones","barzal"],["dakyard","vick"],["brady","diggin"],["burrow","saquon"],["horns","romo"]],
  /* Wk 11 */ [["dones","vick"],["barzal","horns"],["dakyard","saquon"],["brady","burrow"],["diggin","romo"]],
  /* Wk 12 */ [["dones","dakyard"],["barzal","brady"],["vick","saquon"],["diggin","romo"],["burrow","horns"]],
  /* Wk 13 */ [["dones","brady"],["barzal","saquon"],["dakyard","horns"],["vick","diggin"],["burrow","romo"]],
  /* Wk 14 */ [["dones","diggin"],["barzal","burrow"],["dakyard","brady"],["vick","romo"],["saquon","horns"]],
];

// 0-indexed week → label tag / background theme
const WEEK_TAGS = { 4: "Rivalry", 8: "Halloween", 9: "Rivalry", 12: "Thanksgiving", 13: "Christmas" };
const WEEK_THEMES = { 8: "halloween", 12: "thanksgiving", 13: "christmas" };

// 2025 season receipts — ready-made caption ammo
const HISTORY_LINES = {
  dakyard: [
    "(Went 23-5 with an 18-game win streak last year and still has no ring)",
    "(Scored 153 in his only playoff game last season... with a bye)",
    "(Dropped 257.88 in Week 8 last year — highest score in league history)",
    "(Started 9-0 in matchups last season, then lost 4 of his last 5)",
  ],
  brady: [
    "(Reigning champ — won it all as the 4 seed)",
    "(Beat the 1, 5, and 3 seeds on the way to the 2025 title)",
    "(Lost his regular season finale last year and won the whole thing anyway)",
  ],
  romo: [
    "(Earned the 2 seed last year, then scored 159 coming off a bye)",
    "(Won a 207.90-205.60 heartbreaker over One & Dones last season)",
    "(Best regular season of his life ended in one playoff game)",
  ],
  diggin: [
    "(Lost the 2025 championship to the Brady Bunch)",
    "(Scored 85 and 96 in two of his last six games last year and still made the title game)",
    "(Runner-up last season — closest he'll ever get)",
  ],
  dones: [
    "(2nd most points in the league last year and still ended up the 5 seed)",
    "(Hung 247.60 on Barzal's Balls in Rivalry Week — biggest beatdown in league history)",
    "(Lost to Romosexual by 2.3 last year in Week 13)",
    "(Drew the eventual champ in round 1 last season, classic)",
  ],
  burrow: [
    "(Started 0-5 last season before beating Romosexual to break the streak)",
    "(Snuck into the 2025 playoffs at 12-16)",
    "(Scored 172 in his lone playoff game last year and went home)",
  ],
  vick: [
    "(Missed last year's playoffs on a 5-game losing streak)",
    "(The only team to beat Dakyard before Week 12 last season — Week 10, 199-161)",
    "(Finished 2025 losing 5 straight — momentum!)",
  ],
  barzal: [
    "(Lost 247-103 to One & Dones in Rivalry Week last year)",
    "(Got his revenge 203-129 over One & Dones in Rivalry Week round 2)",
    "(Missed the playoffs at 12-16 last season)",
  ],
  horns: [
    "(Went 9-19 last year without spending a single waiver dollar)",
    "(Scored 73.50 in Week 1 last year — lowest game in league history)",
    "(Owns two of the three lowest scores from last season)",
  ],
  saquon: [
    "(8-20 last season with $100 FAAB still in his pocket)",
    "(Scored 185 in Week 1 last year and spent the whole season chasing it)",
    "(Fewest wins in the league last year and somehow the least effort too)",
  ],
};

const ord = (n) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);

// ---------- layout constants for the graphic ----------
const PLATE = { y: 22, h: 74, leftX: 24, leftW: 500, rightX: 846, rightW: 500 };
const COL = { x: 568, y: 186, w: 234, h: 562 };
const LOGO = { cx: W / 2, cy: 96, maxW: 176, maxH: 158 };

let _id = 1;
const nid = () => _id++;

// fixed logo positions — same spot & size on every graphic
const DEFAULT_SLOTS = {
  a: { x: 345, y: 240, box: 170 },
  b: { x: 1025, y: 240, box: 170 },
};

const emptyWeek = () =>
  Array.from({ length: 5 }, () => ({ a: "", b: "", sa: "", sb: "", ba: "", bb: "" }));

const freshLeague = () => ({
  teams: DEFAULT_TEAMS.map((t) => ({ ...t })),
  weeks: Array.from({ length: DEFAULT_WEEK_COUNT }, emptyWeek),
  logoSlots: structuredClone(DEFAULT_SLOTS),
});

// ---------- canvas helpers ----------
function chamferPath(ctx, x, y, w, h, c) {
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

function wrapText(ctx, text, maxWidth) {
  const words = (text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function fitFontSize(ctx, text, fontFamily, weight, maxWidth, startSize, minSize) {
  let size = startSize;
  while (size > minSize) {
    ctx.font = `${weight} ${size}px "${fontFamily}"`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

function strokedText(ctx, text, x, y, fill, strokeWidth, strokeColor = "#000") {
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  if (strokeWidth > 0) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

// seeded rng so the background doesn't shimmer on every redraw
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

function drawStadiumBg(ctx, theme = "classic") {
  const rnd = mulberry32(
    theme === "halloween" ? 13 : theme === "thanksgiving" ? 77 : theme === "christmas" ? 99 : 42
  );

  const skies = {
    classic: [["#05070f", 0], ["#0b1226", 0.55], ["#101b33", 1]],
    halloween: [["#0d0416", 0], ["#241038", 0.5], ["#3a1130", 1]],
    thanksgiving: [["#170b03", 0], ["#3b2008", 0.55], ["#5a3110", 1]],
    christmas: [["#03101f", 0], ["#0a1e3a", 0.55], ["#12294d", 1]],
  };
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  for (const [c, s] of skies[theme] || skies.classic) sky.addColorStop(s, c);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // crowd band
  const crowd = ctx.createLinearGradient(0, H * 0.28, 0, H * 0.62);
  crowd.addColorStop(0, "rgba(40,50,80,0)");
  crowd.addColorStop(0.5, "rgba(55,62,95,0.55)");
  crowd.addColorStop(1, "rgba(30,36,60,0)");
  ctx.fillStyle = crowd;
  ctx.fillRect(0, H * 0.28, W, H * 0.34);
  for (let i = 0; i < 900; i++) {
    const x = rnd() * W;
    const y = H * 0.3 + rnd() * H * 0.28;
    ctx.fillStyle = `rgba(${180 + rnd() * 75},${170 + rnd() * 70},${
      150 + rnd() * 80
    },${0.06 + rnd() * 0.12})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // light beams
  const beamSets = {
    classic: [[80, "#ffd88a"], [1090, "#9ec8ff"], [420, "#ffb3d1"], [750, "#a8ffe0"]],
    halloween: [[80, "#ff9d3f"], [1090, "#b06bff"], [420, "#ff5c33"], [750, "#8a4dff"]],
    thanksgiving: [[80, "#ffb85c"], [1090, "#ff8a3d"], [420, "#ffd27a"], [750, "#e8a04a"]],
    christmas: [[80, "#ff6b6b"], [1090, "#6bff8f"], [420, "#ffe08a"], [750, "#8ab8ff"]],
  };
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (const [bx, col] of beamSets[theme] || beamSets.classic) {
    const g = ctx.createRadialGradient(bx, -60, 10, bx, -60, 560);
    g.addColorStop(0, col + "55");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();

  // field
  const fields = {
    classic: ["#173a22", "#0c2413", "rgba(255,255,255,0.28)", "rgba(255,255,255,0.18)"],
    halloween: ["#33291a", "#1a1208", "rgba(255,200,120,0.22)", "rgba(255,200,120,0.12)"],
    thanksgiving: ["#3a2a12", "#20160a", "rgba(255,220,160,0.25)", "rgba(255,220,160,0.14)"],
    christmas: ["#dfe7ee", "#aebfcc", "rgba(90,110,130,0.5)", "rgba(90,110,130,0.3)"],
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

  // ---- theme decorations ----
  if (theme === "halloween") {
    // moon
    ctx.save();
    ctx.shadowColor = "#f5edd8";
    ctx.shadowBlur = 60;
    ctx.fillStyle = "#f2e9d0";
    ctx.beginPath();
    ctx.arc(W - 210, 150, 66, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(190,180,150,0.5)";
    for (const [mx, my, mr] of [[-20, -12, 10], [18, 14, 7], [8, -24, 5], [-28, 22, 6]]) {
      ctx.beginPath();
      ctx.arc(W - 210 + mx, 150 + my, mr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // bats
    ctx.fillStyle = "#0a0510";
    for (let i = 0; i < 14; i++) {
      const x = rnd() * W;
      const y = 40 + rnd() * H * 0.4;
      const s = 4 + rnd() * 6;
      ctx.beginPath();
      ctx.moveTo(x - 4 * s, y);
      ctx.quadraticCurveTo(x - 2 * s, y - 2 * s, x, y);
      ctx.quadraticCurveTo(x + 2 * s, y - 2 * s, x + 4 * s, y);
      ctx.quadraticCurveTo(x + 2 * s, y + s, x, y + 0.5 * s);
      ctx.quadraticCurveTo(x - 2 * s, y + s, x - 4 * s, y);
      ctx.fill();
    }
    // low orange fog
    const fog = ctx.createLinearGradient(0, H * 0.55, 0, H);
    fog.addColorStop(0, "rgba(255,120,30,0)");
    fog.addColorStop(1, "rgba(255,110,20,0.22)");
    ctx.fillStyle = fog;
    ctx.fillRect(0, H * 0.55, W, H * 0.45);
  } else if (theme === "thanksgiving") {
    // falling leaves
    const leafColors = ["#c2571b", "#a33b12", "#d98a2b", "#8a4a15"];
    for (let i = 0; i < 44; i++) {
      const x = rnd() * W;
      const y = rnd() * H * 0.72;
      const s = 5 + rnd() * 9;
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
  } else if (theme === "christmas") {
    // string lights along the top
    const bulbColors = ["#ff4d4d", "#4dff6b", "#ffd24d", "#4da6ff"];
    ctx.strokeStyle = "rgba(20,30,45,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 8) {
      const y = 10 + Math.sin(x / 90) * 6;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
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
    // snowfall
    for (let i = 0; i < 130; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const r = 0.8 + rnd() * 2.1;
      ctx.globalAlpha = 0.25 + rnd() * 0.6;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // vignette
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

function drawGraphic(ctx, state, opts = {}) {
  const { bgImg, leagueLogoImg, layers, sides, selId } = state;
  const showUi = !opts.export;

  ctx.clearRect(0, 0, W, H);

  if (bgImg) {
    const s = Math.max(W / bgImg.width, H / bgImg.height);
    const dw = bgImg.width * s;
    const dh = bgImg.height * s;
    ctx.drawImage(bgImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, 0, W, H);
  } else {
    drawStadiumBg(ctx, state.theme || "classic");
  }

  for (const L of layers) {
    if (!L.img) continue;
    const dw = L.img.width * L.scale;
    const dh = L.img.height * L.scale;
    ctx.save();
    ctx.translate(L.x, L.y);
    if (L.flip) ctx.scale(-1, 1);
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    ctx.drawImage(L.img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();

    if (showUi && L.id === selId) {
      ctx.save();
      ctx.strokeStyle = "#ffd200";
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 2;
      ctx.strokeRect(L.x - dw / 2, L.y - dh / 2, dw, dh);
      ctx.setLineDash([]);
      ctx.fillStyle = "#ffd200";
      ctx.strokeStyle = "#000";
      const hx = L.x + dw / 2;
      const hy = L.y + dh / 2;
      ctx.beginPath();
      ctx.arc(hx, hy, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#000";
      ctx.font = '700 13px "Barlow Condensed"';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("⤡", hx, hy + 1);
      ctx.restore();
    }
  }

  // center column
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 24;
  chamferPath(ctx, COL.x, COL.y, COL.w, COL.h, 16);
  const colFill = ctx.createLinearGradient(COL.x, COL.y, COL.x, COL.y + COL.h);
  colFill.addColorStop(0, "rgba(10,12,20,0.88)");
  colFill.addColorStop(1, "rgba(16,20,34,0.88)");
  ctx.fillStyle = colFill;
  ctx.fill();
  ctx.restore();
  chamferPath(ctx, COL.x, COL.y, COL.w, COL.h, 16);
  const metal = ctx.createLinearGradient(COL.x, COL.y, COL.x + COL.w, COL.y + COL.h);
  metal.addColorStop(0, "#e8e8ee");
  metal.addColorStop(0.5, "#8a8fa0");
  metal.addColorStop(1, "#e0e0ea");
  ctx.strokeStyle = metal;
  ctx.lineWidth = 3;
  ctx.stroke();

  const pad = 14;
  const innerX = COL.x + pad;
  const innerW = COL.w - pad * 2;
  let cy = COL.y + 26;

  const sectionLabel = (label) => {
    const txt = label.toUpperCase();
    const size = fitFontSize(ctx, txt, "Orbitron", "700", COL.w - 24, 17, 10);
    ctx.font = `700 ${size}px "Orbitron"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    strokedText(ctx, txt, W / 2, cy, "#ffffff", 4);
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
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fill();
      ctx.strokeStyle = cell.c;
      ctx.lineWidth = 2.5;
      ctx.save();
      ctx.shadowColor = cell.c;
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.restore();
      const size = fitFontSize(ctx, cell.v, "Orbitron", "700", cellW - 12, 22, 11);
      ctx.font = `700 ${size}px "Orbitron"`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#fff";
      ctx.fillText(cell.v, cell.x + cellW / 2, cy + cellH / 2 + 1);
    }
    cy += cellH + 20;
  };

  const labelTexts = state.labels || ["Record", "Average Points"];
  sectionLabel(labelTexts[0] || "Record");
  valueCells(sides[0].record, sides[1].record);
  sectionLabel(labelTexts[1] || "Average Points");
  valueCells(sides[0].ppg, sides[1].ppg);

  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(innerX, cy - 6);
  ctx.lineTo(innerX + innerW, cy - 6);
  ctx.stroke();
  cy += 8;

  const remaining = COL.y + COL.h - cy - 12;
  const half = remaining / 2;
  const drawBlurb = (side, topY, availH) => {
    ctx.fillStyle = side.color;
    ctx.fillRect(W / 2 - 22, topY, 44, 4);
    let size = 19;
    let lines = [];
    while (size >= 11) {
      ctx.font = `700 ${size}px "Orbitron"`;
      lines = wrapText(ctx, side.blurb, innerW);
      if (lines.length * (size + 7) <= availH - 16) break;
      size -= 1;
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    let ty = topY + 16 + size;
    for (const line of lines) {
      strokedText(ctx, line, W / 2, ty, "#ffffff", 5);
      ty += size + 7;
    }
  };
  drawBlurb(sides[0], cy, half);
  drawBlurb(sides[1], cy + half + 4, half);

  // team name plates
  const plate = (x, w, side) => {
    ctx.save();
    ctx.shadowColor = side.color;
    ctx.shadowBlur = 22;
    chamferPath(ctx, x, PLATE.y, w, PLATE.h, 18);
    const pf = ctx.createLinearGradient(x, PLATE.y, x, PLATE.y + PLATE.h);
    pf.addColorStop(0, "rgba(8,10,18,0.92)");
    pf.addColorStop(1, "rgba(20,24,40,0.92)");
    ctx.fillStyle = pf;
    ctx.fill();
    ctx.restore();
    chamferPath(ctx, x, PLATE.y, w, PLATE.h, 18);
    ctx.strokeStyle = side.color;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    chamferPath(ctx, x + 5, PLATE.y + 5, w - 10, PLATE.h - 10, 14);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const size = fitFontSize(ctx, side.name, side.font, "400", w - 44, 46, 18);
    ctx.font = `400 ${size}px "${side.font}"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    strokedText(ctx, side.name, x + w / 2, PLATE.y + PLATE.h / 2 + 3, side.color, 6);
  };
  plate(PLATE.leftX, PLATE.leftW, sides[0]);
  plate(PLATE.rightX, PLATE.rightW, sides[1]);

  // league logo
  if (leagueLogoImg) {
    const s = Math.min(LOGO.maxW / leagueLogoImg.width, LOGO.maxH / leagueLogoImg.height);
    const dw = leagueLogoImg.width * s;
    const dh = leagueLogoImg.height * s;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 16;
    ctx.drawImage(leagueLogoImg, LOGO.cx - dw / 2, LOGO.cy - dh / 2, dw, dh);
    ctx.restore();
  } else if (showUi) {
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 2;
    ctx.strokeRect(LOGO.cx - 70, LOGO.cy - 60, 140, 120);
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = '600 16px "Barlow Condensed"';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("LEAGUE LOGO", LOGO.cx, LOGO.cy);
    ctx.restore();
  }
}

// dataURL → Image
const dataUrlToImage = (url) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });

// compress an uploaded logo to keep storage small
const compressImage = (img, maxDim = 320) => {
  const s = Math.min(1, maxDim / Math.max(img.width, img.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(img.width * s);
  cv.height = Math.round(img.height * s);
  cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL("image/png");
};

// ============================================================
export default function CityBoysBuilder() {
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const drawStateRef = useRef(null);
  const saveTimer = useRef(null);
  const logoDataRef = useRef({}); // teamId | 'league' -> dataURL, persisted as one bundle

  const [phase, setPhase] = useState("loading"); // loading | ready
  const [tab, setTab] = useState("graphic"); // graphic | scores | schedule | teams
  const [league, setLeague] = useState(freshLeague);
  const [logos, setLogos] = useState({}); // teamId -> Image
  const [leagueLogoImg, setLeagueLogoImg] = useState(null);
  const [bgImg, setBgImg] = useState(null);

  const [selWeek, setSelWeek] = useState(0);
  const [teamA, setTeamA] = useState("");
  const [teamB, setTeamB] = useState("");
  const [asOfWeek, setAsOfWeek] = useState(0); // records shown "entering" this week
  const [blurbA, setBlurbA] = useState("");
  const [blurbB, setBlurbB] = useState("");
  const [theme, setTheme] = useState("auto");
  const [label1, setLabel1] = useState("Record");
  const [label2, setLabel2] = useState("Average Points");
  const [ovr, setOvr] = useState({ ra: "", rb: "", pa: "", pb: "" }); // manual overrides
  const clearOverrides = () => setOvr({ ra: "", rb: "", pa: "", pb: "" });
  const effectiveTheme = theme === "auto" ? WEEK_THEMES[asOfWeek] || "classic" : theme;

  const weekLabel = (i) =>
    `Week ${i + 1}${WEEK_TAGS[i] ? " · " + WEEK_TAGS[i] : ""}`;

  const loadSeasonSchedule = () => {
    updateLeague((lg) => {
      lg.weeks = SEASON_SCHEDULE.map((pairs, wi) =>
        pairs.map(([a, b], mi) => {
          const old = lg.weeks[wi]?.[mi];
          const same =
            old && ((old.a === a && old.b === b) || (old.a === b && old.b === a));
          return same ? old : { a, b, sa: "", sb: "", ba: "", bb: "" };
        })
      );
      return lg;
    });
    setSaveNote("2026 schedule loaded");
    setTimeout(() => setSaveNote(""), 2000);
  };
  const [layers, setLayers] = useState([]);
  const [selId, setSelId] = useState(null);
  const [fontTick, setFontTick] = useState(0);
  const [exportUrl, setExportUrl] = useState(null);
  const [saveNote, setSaveNote] = useState("");
  const [pendingDel, setPendingDel] = useState(null);
  const [suggest, setSuggest] = useState({ a: [], b: [] });

  // ---------- load fonts ----------
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONT_LINK;
    document.head.appendChild(link);
    (async () => {
      try {
        await document.fonts.ready;
        await Promise.all(
          FONTS.map((f) => document.fonts.load(`400 40px "${f}"`).catch(() => {}))
        );
      } catch (e) {}
      setFontTick((t) => t + 1);
    })();
    const t = setTimeout(() => setFontTick((x) => x + 1), 1800);
    return () => clearTimeout(t);
  }, []);

  // ---------- load saved league ----------
  useEffect(() => {
    (async () => {
      let loaded = freshLeague();
      try {
        const res = await window.storage.get(LEAGUE_KEY);
        if (res?.value) {
          const parsed = JSON.parse(res.value);
          if (parsed?.teams?.length) loaded = parsed;
        }
      } catch (e) {
        /* first run — nothing saved yet */
      }
      if (!loaded.logoSlots) loaded.logoSlots = structuredClone(DEFAULT_SLOTS);
      // migrate right-side logo slot if saved on the old narrower canvas
      const savedW = loaded.canvasW || 1170;
      if (savedW !== W && loaded.logoSlots?.b) {
        loaded.logoSlots.b.x = W - (savedW - loaded.logoSlots.b.x);
        loaded.canvasW = W;
      } else if (!loaded.canvasW) {
        loaded.canvasW = W;
      }
      loaded.teams.forEach((t) => {
        if (!t.players) t.players = [];
      });
      setLeague(loaded);
      const firstOpen = loaded.weeks.findIndex((wk) =>
        wk.some((m) => m.a && m.b && (m.sa === "" || m.sb === ""))
      );
      if (firstOpen >= 0) {
        setAsOfWeek(firstOpen);
        setSelWeek(firstOpen);
      }

      // logos — one bundled key (many separate reads were getting rate-limited)
      const imgs = {};
      let bundle = null;
      try {
        const r = await window.storage.get(LOGOS_KEY);
        if (r?.value) bundle = JSON.parse(r.value);
      } catch (e) {}
      if (bundle) {
        logoDataRef.current = bundle;
        for (const t of loaded.teams) {
          if (bundle[t.id]) {
            const img = await dataUrlToImage(bundle[t.id]);
            if (img) imgs[t.id] = img;
          }
        }
        if (bundle.league) {
          const img = await dataUrlToImage(bundle.league);
          if (img) setLeagueLogoImg(img);
        }
      } else {
        // legacy: one key per team — read once, then migrate into the bundle
        for (const t of loaded.teams) {
          try {
            const r = await window.storage.get(logoKey(t.id));
            if (r?.value) {
              logoDataRef.current[t.id] = r.value;
              const img = await dataUrlToImage(r.value);
              if (img) imgs[t.id] = img;
            }
          } catch (e) {}
        }
        try {
          const r = await window.storage.get(logoKey("league"));
          if (r?.value) {
            logoDataRef.current.league = r.value;
            const img = await dataUrlToImage(r.value);
            if (img) setLeagueLogoImg(img);
          }
        } catch (e) {}
        if (Object.keys(logoDataRef.current).length) {
          try {
            await window.storage.set(LOGOS_KEY, JSON.stringify(logoDataRef.current));
          } catch (e) {}
        }
      }
      try {
        const r = await window.storage.get(logoKey("background"));
        if (r?.value) {
          const img = await dataUrlToImage(r.value);
          if (img) setBgImg(img);
        }
      } catch (e) {}
      setLogos(imgs);
      setPhase("ready");
    })();
  }, []);

  // ---------- autosave league ----------
  const persistLeague = useCallback((lg) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await window.storage.set(LEAGUE_KEY, JSON.stringify(lg));
        setSaveNote("Saved");
        setTimeout(() => setSaveNote(""), 1500);
      } catch (e) {
        setSaveNote("Save failed — try again");
      }
    }, 700);
  }, []);

  const updateLeague = (fn) =>
    setLeague((lg) => {
      const next = fn(structuredClone(lg));
      persistLeague(next);
      return next;
    });

  // ---------- stats ----------
  // record & PPG using games BEFORE the selected week (entering the matchup)
  // records include league median: top half of weekly scoring gets an extra W, bottom half an extra L
  const statsThroughWeek = (beforeWeek) => {
    const stats = {};
    for (const t of league.teams)
      stats[t.id] = { w: 0, l: 0, t: 0, pts: 0, games: 0 };
    league.weeks.forEach((week, wi) => {
      if (wi >= beforeWeek) return;
      const weekScores = [];
      for (const m of week) {
        if (!m.a || !m.b) continue;
        const sa = parseFloat(m.sa);
        const sb = parseFloat(m.sb);
        if (isNaN(sa) || isNaN(sb)) continue;
        if (!stats[m.a] || !stats[m.b]) continue;
        stats[m.a].pts += sa;
        stats[m.a].games++;
        stats[m.b].pts += sb;
        stats[m.b].games++;
        weekScores.push({ id: m.a, p: sa }, { id: m.b, p: sb });
        if (sa > sb) {
          stats[m.a].w++;
          stats[m.b].l++;
        } else if (sb > sa) {
          stats[m.b].w++;
          stats[m.a].l++;
        } else {
          stats[m.a].t++;
          stats[m.b].t++;
        }
      }
      // league median result
      if (weekScores.length >= 2) {
        weekScores.sort((x, y) => y.p - x.p);
        const winners = Math.floor(weekScores.length / 2);
        weekScores.forEach((s, i) => {
          if (i < winners) stats[s.id].w++;
          else stats[s.id].l++;
        });
      }
    });
    return stats;
  };

  const teamById = (id) => league.teams.find((t) => t.id === id);

  // ---------- roast suggestion engine ----------
  const gameLog = (tid) => {
    const log = [];
    league.weeks.forEach((wk, wi) => {
      if (wi >= asOfWeek) return;
      wk.forEach((m) => {
        const sa = parseFloat(m.sa);
        const sb = parseFloat(m.sb);
        if (isNaN(sa) || isNaN(sb)) return;
        if (m.a === tid) log.push({ wi, pts: sa, opp: sb });
        else if (m.b === tid) log.push({ wi, pts: sb, opp: sa });
      });
    });
    return log;
  };

  const roastsFor = (tid) => {
    if (!tid) return [];
    const out = [];
    const log = gameLog(tid);
    if (log.length) {
      // current streak
      const last = log[log.length - 1];
      const lastWin = last.pts > last.opp;
      let s = 0;
      for (let i = log.length - 1; i >= 0; i--) {
        const w = log[i].pts > log[i].opp;
        if (w === lastWin) s++;
        else break;
      }
      if (s >= 2) out.push(`(Has ${lastWin ? "won" : "lost"} ${s} straight)`);

      // last week's scoring rank across the league
      const lw = last.wi;
      const weekScores = [];
      league.weeks[lw].forEach((m) => {
        const sa = parseFloat(m.sa);
        const sb = parseFloat(m.sb);
        if (!isNaN(sa) && m.a) weekScores.push({ t: m.a, p: sa });
        if (!isNaN(sb) && m.b) weekScores.push({ t: m.b, p: sb });
      });
      weekScores.sort((x, y) => y.p - x.p);
      const r = weekScores.findIndex((x) => x.t === tid) + 1;
      const n = weekScores.length;
      if (r === 1) out.push("(Highest scoring team in the league last week)");
      else if (r === n) out.push("(Lowest scoring team in the league last week)");
      else if (r <= 3) out.push(`(${ord(r)} highest scoring team last week)`);
      else if (r >= n - 1) out.push(`(${ord(n - r + 1)} lowest scoring team last week)`);

      // season PPG rank
      const stats = statsThroughWeek(asOfWeek);
      const ranked = league.teams
        .map((t) => ({
          id: t.id,
          ppg: stats[t.id].games ? stats[t.id].pts / stats[t.id].games : -1,
        }))
        .filter((x) => x.ppg >= 0)
        .sort((a, b) => b.ppg - a.ppg);
      const pr = ranked.findIndex((x) => x.id === tid) + 1;
      if (pr === 1 && ranked.length > 3) out.push("(Highest PPG in the league)");
      else if (pr === ranked.length && ranked.length > 3)
        out.push("(Lowest PPG in the league)");

      // record vs the league median
      let mw = 0;
      let ml = 0;
      log.forEach((g) => {
        const ws = [];
        league.weeks[g.wi].forEach((m) => {
          const sa = parseFloat(m.sa);
          const sb = parseFloat(m.sb);
          if (!isNaN(sa) && m.a) ws.push({ t: m.a, p: sa });
          if (!isNaN(sb) && m.b) ws.push({ t: m.b, p: sb });
        });
        ws.sort((x, y) => y.p - x.p);
        const idx = ws.findIndex((x) => x.t === tid);
        if (idx >= 0) idx < Math.floor(ws.length / 2) ? mw++ : ml++;
      });
      if (mw + ml >= 3 && ml > mw * 2)
        out.push(`(${mw}-${ml} against the league median)`);
      else if (mw + ml >= 3 && mw > ml * 2 && ml > 0)
        out.push(`(${mw}-${ml} vs the median but can't beat an actual opponent)`);

      // close-game record
      let cw = 0;
      let cl = 0;
      log.forEach((g) => {
        if (Math.abs(g.pts - g.opp) < 10) g.pts > g.opp ? cw++ : cl++;
      });
      if (cw + cl >= 2 && cl > cw)
        out.push(`(${cw}-${cl} in games decided by less than 10)`);
      else if (cw >= 2 && cl === 0)
        out.push(`(${cw}-0 in games decided by less than 10)`);
    }
    const hist = [...(HISTORY_LINES[tid] || [])].sort(() => Math.random() - 0.5);
    out.push(...hist);
    return out.slice(0, 4);
  };

  const fmtRecord = (s) =>
    s.t > 0 ? `${s.w}-${s.l}-${s.t}` : `${s.w}-${s.l}`;
  const fmtPpg = (s) => (s.games ? (s.pts / s.games).toFixed(2) : "—");

  // ---------- graphic sides ----------
  const buildSides = () => {
    const stats = statsThroughWeek(asOfWeek);
    const mk = (id, blurb, fallbackName, fallbackColor, fallbackFont) => {
      const T = teamById(id);
      if (!T)
        return {
          name: fallbackName,
          color: fallbackColor,
          font: fallbackFont,
          record: "0-0",
          ppg: "—",
          blurb,
        };
      return {
        name: T.name,
        color: T.color,
        font: T.font,
        record: fmtRecord(stats[T.id]),
        ppg: fmtPpg(stats[T.id]),
        blurb,
      };
    };
    return [
      mk(teamA, blurbA, "TEAM 1", "#ffd200", "Bangers"),
      mk(teamB, blurbB, "TEAM 2", "#4da6ff", "Bungee"),
    ];
  };

  const autoSides = buildSides();
  const sides = [
    {
      ...autoSides[0],
      record: ovr.ra.trim() || autoSides[0].record,
      ppg: ovr.pa.trim() || autoSides[0].ppg,
    },
    {
      ...autoSides[1],
      record: ovr.rb.trim() || autoSides[1].record,
      ppg: ovr.pb.trim() || autoSides[1].ppg,
    },
  ];

  drawStateRef.current = {
    bgImg,
    leagueLogoImg,
    layers,
    sides,
    selId,
    theme: effectiveTheme,
    labels: [label1, label2],
  };

  // redraw
  useEffect(() => {
    if (phase !== "ready" || tab !== "graphic") return;
    const cv = canvasRef.current;
    if (!cv) return;
    drawGraphic(cv.getContext("2d"), drawStateRef.current);
  });

  // drop in the two team logos at their saved slots — same spot & size every time
  const loadLogoLayers = (aId, bId) => {
    const slots = league.logoSlots || DEFAULT_SLOTS;
    const newLayers = [];
    const place = (id, slot, role) => {
      if (!id || !logos[id]) return;
      const img = logos[id];
      newLayers.push({
        id: nid(),
        img,
        role,
        x: slot.x,
        y: slot.y,
        scale: slot.box / Math.max(img.width, img.height),
        flip: false,
      });
    };
    place(aId, slots.a, "logoA");
    place(bId, slots.b, "logoB");
    setLayers(newLayers);
    setSelId(null);
  };

  // remember the current logo positions/sizes as the default slots
  const saveLogoSlots = () => {
    const A = layers.find((l) => l.role === "logoA");
    const B = layers.find((l) => l.role === "logoB");
    if (!A && !B) return;
    updateLeague((lg) => {
      if (!lg.logoSlots) lg.logoSlots = structuredClone(DEFAULT_SLOTS);
      const toSlot = (L) => ({
        x: Math.round(L.x),
        y: Math.round(L.y),
        box: Math.round(Math.max(L.img.width, L.img.height) * L.scale),
      });
      if (A) lg.logoSlots.a = toSlot(A);
      if (B) lg.logoSlots.b = toSlot(B);
      return lg;
    });
    setSaveNote("Logo spots saved");
    setTimeout(() => setSaveNote(""), 1500);
  };

  // snap existing logo layers back to the saved slots (leaves player PNGs alone)
  const snapLogosToSlots = () => {
    const slots = league.logoSlots || DEFAULT_SLOTS;
    setLayers((ls) =>
      ls.map((L) => {
        const slot = L.role === "logoA" ? slots.a : L.role === "logoB" ? slots.b : null;
        if (!slot || !L.img) return L;
        return {
          ...L,
          x: slot.x,
          y: slot.y,
          scale: slot.box / Math.max(L.img.width, L.img.height),
        };
      })
    );
  };

  // free pick: choose any team on either side
  const pickTeam = (side, id) => {
    const a = side === "a" ? id : teamA;
    const b = side === "b" ? id : teamB;
    if (side === "a") setTeamA(id);
    else setTeamB(id);
    clearOverrides();
    loadLogoLayers(a, b);
  };

  // shortcut: tap a scheduled matchup to load it (also prefills captions)
  const selectMatch = (wi, mi) => {
    const m = league.weeks[wi][mi];
    setAsOfWeek(wi);
    setTeamA(m.a);
    setTeamB(m.b);
    setBlurbA(m.ba || "");
    setBlurbB(m.bb || "");
    clearOverrides();
    loadLogoLayers(m.a, m.b);
  };

  // ---------- uploads ----------
  const loadImageFile = (file, cb) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => cb(img, r.result);
      img.src = r.result;
    };
    r.readAsDataURL(file);
  };

  const persistLogoBundle = async () => {
    try {
      await window.storage.set(LOGOS_KEY, JSON.stringify(logoDataRef.current));
      setSaveNote("Saved");
      setTimeout(() => setSaveNote(""), 1500);
    } catch (e) {
      setSaveNote("Logo save failed — try a smaller image");
    }
  };

  const uploadTeamLogo = (teamId, file) => {
    loadImageFile(file, async (img) => {
      const compressed = compressImage(img, 300);
      const small = await dataUrlToImage(compressed);
      setLogos((l) => ({ ...l, [teamId]: small }));
      logoDataRef.current[teamId] = compressed;
      persistLogoBundle();
    });
  };

  const uploadLeagueLogo = (file) => {
    loadImageFile(file, async (img) => {
      const compressed = compressImage(img, 400);
      const small = await dataUrlToImage(compressed);
      setLeagueLogoImg(small);
      logoDataRef.current.league = compressed;
      persistLogoBundle();
    });
  };

  const uploadBackground = (file) => {
    loadImageFile(file, async (img) => {
      const compressed = compressImage(img, 1600);
      const small = await dataUrlToImage(compressed);
      setBgImg(small);
      try {
        await window.storage.set(logoKey("background"), compressed);
      } catch (e) {}
    });
  };

  const addPlayers = (files) => {
    Array.from(files).forEach((f) => {
      loadImageFile(f, (img) => {
        const scale = Math.min(1, 460 / img.height);
        setLayers((ls) => {
          const leftCount = ls.filter((l) => l.x < W / 2).length;
          const goLeft = leftCount <= ls.length - leftCount;
          const layer = {
            id: nid(),
            img,
            x: goLeft ? 230 : W - 230,
            y: 460,
            scale,
            flip: false,
          };
          setSelId(layer.id);
          return [...ls, layer];
        });
      });
    });
  };

  // ---------- player library ----------
  const playerImgCache = useRef({}); // storageKey -> Image

  const uploadTeamPlayers = (teamId, files) => {
    Array.from(files).forEach((f) => {
      loadImageFile(f, async (img) => {
        const compressed = compressImage(img, 800);
        const small = await dataUrlToImage(compressed);
        const pid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const key = playerKey(teamId, pid);
        playerImgCache.current[key] = small;
        try {
          await window.storage.set(key, compressed);
        } catch (e) {
          setSaveNote("Player image save failed");
          return;
        }
        const cleanName = f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
        updateLeague((lg) => {
          const t = lg.teams.find((x) => x.id === teamId);
          if (t) {
            if (!t.players) t.players = [];
            t.players.push({ pid, name: cleanName || "Player", facing: "right" });
          }
          return lg;
        });
      });
    });
  };

  const deletePlayer = async (teamId, pid) => {
    updateLeague((lg) => {
      const t = lg.teams.find((x) => x.id === teamId);
      if (t) t.players = (t.players || []).filter((p) => p.pid !== pid);
      return lg;
    });
    setLayers((ls) => ls.filter((l) => l.pid !== pid));
    delete playerImgCache.current[playerKey(teamId, pid)];
    try {
      await window.storage.delete(playerKey(teamId, pid));
    } catch (e) {}
  };

  const setPlayerField = (teamId, pid, field, val) =>
    updateLeague((lg) => {
      const t = lg.teams.find((x) => x.id === teamId);
      const p = t?.players?.find((x) => x.pid === pid);
      if (p) p[field] = val;
      return lg;
    });

  const getPlayerImage = async (teamId, pid) => {
    const key = playerKey(teamId, pid);
    if (playerImgCache.current[key]) return playerImgCache.current[key];
    try {
      const r = await window.storage.get(key);
      if (r?.value) {
        const img = await dataUrlToImage(r.value);
        if (img) {
          playerImgCache.current[key] = img;
          return img;
        }
      }
    } catch (e) {}
    return null;
  };

  // staggered feature spots per side — front player first, then behind
  const PLAYER_SLOTS_LEFT = [
    { x: 285, y: 480, box: 540 },
    { x: 115, y: 420, box: 430 },
    { x: 440, y: 400, box: 370 },
  ];

  const togglePlayerOnCanvas = async (side, teamId, player) => {
    const existing = layers.find((l) => l.pid === player.pid);
    if (existing) {
      setLayers((ls) => ls.filter((l) => l.pid !== player.pid));
      return;
    }
    const img = await getPlayerImage(teamId, player.pid);
    if (!img) {
      setSaveNote("Couldn't load that player image");
      return;
    }
    setLayers((ls) => {
      const sideCount = ls.filter((l) => l.side === side && l.pid).length;
      const slot = PLAYER_SLOTS_LEFT[Math.min(sideCount, PLAYER_SLOTS_LEFT.length - 1)];
      const x = side === "left" ? slot.x : W - slot.x;
      // face inward: left side faces right, right side faces left
      const flip = side === "left" ? player.facing === "left" : player.facing === "right";
      return [
        ...ls,
        {
          id: nid(),
          img,
          pid: player.pid,
          side,
          x,
          y: slot.y,
          scale: slot.box / img.height,
          flip,
        },
      ];
    });
  };

  // ---------- pointer interaction ----------
  const canvasPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  };

  const hitTest = (p) => {
    const ls = layers;
    const sel = ls.find((l) => l.id === selId);
    if (sel && sel.img) {
      const hw = (sel.img.width * sel.scale) / 2;
      const hh = (sel.img.height * sel.scale) / 2;
      if (Math.hypot(p.x - (sel.x + hw), p.y - (sel.y + hh)) < 20)
        return { layer: sel, mode: "resize" };
    }
    for (let i = ls.length - 1; i >= 0; i--) {
      const L = ls[i];
      if (!L.img) continue;
      const hw = (L.img.width * L.scale) / 2;
      const hh = (L.img.height * L.scale) / 2;
      if (p.x >= L.x - hw && p.x <= L.x + hw && p.y >= L.y - hh && p.y <= L.y + hh)
        return { layer: L, mode: "move" };
    }
    return null;
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    const p = canvasPos(e);
    const hit = hitTest(p);
    if (!hit) {
      setSelId(null);
      return;
    }
    setSelId(hit.layer.id);
    canvasRef.current.setPointerCapture(e.pointerId);
    if (hit.mode === "move") {
      dragRef.current = {
        mode: "move",
        id: hit.layer.id,
        dx: p.x - hit.layer.x,
        dy: p.y - hit.layer.y,
      };
    } else {
      const d = Math.hypot(p.x - hit.layer.x, p.y - hit.layer.y);
      dragRef.current = {
        mode: "resize",
        id: hit.layer.id,
        startScale: hit.layer.scale,
        startDist: Math.max(d, 8),
      };
    }
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const p = canvasPos(e);
    setLayers((ls) =>
      ls.map((L) => {
        if (L.id !== d.id) return L;
        if (d.mode === "move") return { ...L, x: p.x - d.dx, y: p.y - d.dy };
        const dist = Math.hypot(p.x - L.x, p.y - L.y);
        return { ...L, scale: Math.max(0.05, d.startScale * (dist / d.startDist)) };
      })
    );
  };

  const onPointerUp = () => (dragRef.current = null);

  const selLayer = layers.find((l) => l.id === selId);
  const modSel = (fn) => setLayers((ls) => ls.map((L) => (L.id === selId ? fn(L) : L)));
  const moveLayer = (dir) =>
    setLayers((ls) => {
      const i = ls.findIndex((l) => l.id === selId);
      if (i < 0) return ls;
      const j = i + dir;
      if (j < 0 || j >= ls.length) return ls;
      const copy = [...ls];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  // ---------- export ----------
  const doExport = () => {
    const cv = document.createElement("canvas");
    cv.width = W * 2;
    cv.height = H * 2;
    const ctx = cv.getContext("2d");
    ctx.scale(2, 2);
    drawGraphic(ctx, drawStateRef.current, { export: true });
    setExportUrl(cv.toDataURL("image/png"));
  };

  // ---------- schedule / score mutations ----------
  const setMatchField = (wi, mi, field, val) =>
    updateLeague((lg) => {
      lg.weeks[wi][mi][field] = val;
      return lg;
    });

  const addWeek = () =>
    updateLeague((lg) => {
      lg.weeks.push(emptyWeek());
      return lg;
    });

  const setTeamField = (id, field, val) =>
    updateLeague((lg) => {
      const t = lg.teams.find((x) => x.id === id);
      if (t) t[field] = val;
      return lg;
    });

  // ============================================================
  const S = styles;

  if (phase === "loading")
    return (
      <div style={{ ...S.app, alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#c9a227", fontFamily: "system-ui", fontSize: 18 }}>
          Loading your league…
        </div>
      </div>
    );

  const FileButton = ({ label, multiple, onFiles, accent, small }) => (
    <label
      style={{
        ...S.fileBtn,
        ...(accent ? S.fileBtnAccent : {}),
        ...(small ? { padding: "6px 8px", fontSize: 12, flex: "none" } : {}),
      }}
    >
      {label}
      <input
        type="file"
        accept="image/*"
        multiple={!!multiple}
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </label>
  );

  const TabBtn = ({ id, label }) => (
    <button
      style={{ ...S.tabBtn, ...(tab === id ? S.tabBtnActive : {}) }}
      onClick={() => setTab(id)}
    >
      {label}
    </button>
  );

  const seasonStats = statsThroughWeek(league.weeks.length);

  return (
    <div style={S.app}>
      <div style={S.topbar}>
        <div style={S.brand}>
          <span style={S.brandMark}>⚔</span> CITY BOYS DYNASTY
          <span style={S.brandSub}>MATCHUP BUILDER</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {saveNote && <span style={S.saveNote}>{saveNote}</span>}
          {tab === "graphic" && (
            <button style={S.exportBtn} onClick={doExport}>
              EXPORT PNG
            </button>
          )}
        </div>
      </div>

      <div style={S.tabs}>
        <TabBtn id="graphic" label="GRAPHIC" />
        <TabBtn id="scores" label="SCORES" />
        <TabBtn id="schedule" label="SCHEDULE" />
        <TabBtn id="teams" label="TEAMS" />
      </div>

      {/* ================= GRAPHIC ================= */}
      {tab === "graphic" && (
        <div style={S.main}>
          <div style={S.stageWrap}>
            {/* free matchup picker — any team vs any team */}
            <div style={S.pickerRow}>
              <select
                style={{ ...S.input, flex: 1, minWidth: 120 }}
                value={teamA}
                onChange={(e) => pickTeam("a", e.target.value)}
              >
                <option value="">— Left team —</option>
                {league.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <span style={{ color: "#8b8f9c", fontWeight: 700 }}>vs</span>
              <select
                style={{ ...S.input, flex: 1, minWidth: 120 }}
                value={teamB}
                onChange={(e) => pickTeam("b", e.target.value)}
              >
                <option value="">— Right team —</option>
                {league.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <select
                style={{ ...S.input, width: "auto" }}
                value={asOfWeek}
                onChange={(e) => setAsOfWeek(Number(e.target.value))}
                title="Records and PPG shown as of the start of this week"
              >
                {league.weeks.map((_, i) => (
                  <option key={i} value={i}>
                    Entering Wk {i + 1}
                    {WEEK_TAGS[i] ? ` (${WEEK_TAGS[i]})` : ""}
                  </option>
                ))}
              </select>
            </div>
            {league.weeks[asOfWeek].some((m) => m.a && m.b) && (
              <div style={{ ...S.matchChips, marginBottom: 10 }}>
                {league.weeks[asOfWeek].map((m, mi) => {
                  const A = teamById(m.a);
                  const B = teamById(m.b);
                  if (!A || !B) return null;
                  const active = teamA === m.a && teamB === m.b;
                  return (
                    <button
                      key={mi}
                      style={{ ...S.chip, ...(active ? S.chipActive : {}) }}
                      onClick={() => selectMatch(asOfWeek, mi)}
                    >
                      {A.name} vs {B.name}
                    </button>
                  );
                })}
              </div>
            )}

            <canvas
              ref={canvasRef}
              width={W}
              height={H}
              style={S.canvas}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
            <div style={S.hint}>
              Pick any two teams — records and average points fill in
              automatically from your entered scores ("Entering Wk" controls the
              cutoff). Drag logos/cutouts to move, drag the ⤡ handle to resize.
            </div>
            {selLayer && (
              <div style={S.layerBar}>
                <button style={S.layerBtn} onClick={() => modSel((L) => ({ ...L, flip: !L.flip }))}>
                  Flip
                </button>
                <button style={S.layerBtn} onClick={() => moveLayer(1)}>
                  Bring forward
                </button>
                <button style={S.layerBtn} onClick={() => moveLayer(-1)}>
                  Send back
                </button>
                <button
                  style={{ ...S.layerBtn, color: "#ff7a7a" }}
                  onClick={() => {
                    setLayers((ls) => ls.filter((l) => l.id !== selId));
                    setSelId(null);
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>

          <div style={S.sidebar}>
            {(teamById(teamA)?.players?.length > 0 ||
              teamById(teamB)?.players?.length > 0) && (
              <div style={S.card}>
                <div style={S.cardTitle}>FEATURED PLAYERS</div>
                {[
                  { id: teamA, side: "left" },
                  { id: teamB, side: "right" },
                ].map(({ id, side }) => {
                  const T = teamById(id);
                  if (!T || !(T.players || []).length) return null;
                  return (
                    <div key={side}>
                      <div style={{ fontSize: 13, color: T.color, marginBottom: 4 }}>
                        {T.name}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {T.players.map((p) => {
                          const active = layers.some((l) => l.pid === p.pid);
                          return (
                            <button
                              key={p.pid}
                              style={{ ...S.chip, ...(active ? S.chipActive : {}) }}
                              onClick={() => togglePlayerOnCanvas(side, T.id, p)}
                            >
                              {p.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                <div style={{ fontSize: 12, color: "#8b8f9c" }}>
                  Tap to add or remove — players auto-face toward the center.
                  First tap is the front spot, extras stack behind. Drag to
                  fine-tune.
                </div>
              </div>
            )}

            <div style={S.card}>
              <div style={S.cardTitle}>CAPTIONS / TRASH TALK</div>
              {[
                {
                  key: "a",
                  id: teamA,
                  blurb: blurbA,
                  setBlurb: setBlurbA,
                  fallback: "Left team",
                },
                {
                  key: "b",
                  id: teamB,
                  blurb: blurbB,
                  setBlurb: setBlurbB,
                  fallback: "Right team",
                },
              ].map(({ key, id, blurb, setBlurb, fallback }) => (
                <div key={key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontSize: 13, color: teamById(id)?.color || "#8b8f9c" }}>
                    {teamById(id)?.name || fallback}
                  </div>
                  <textarea
                    style={{ ...S.input, minHeight: 56, resize: "vertical" }}
                    value={blurb}
                    onChange={(e) => setBlurb(e.target.value)}
                    placeholder="Fun fact / stat line / roast"
                  />
                  {id && (
                    <button
                      style={{ ...S.layerBtn, alignSelf: "flex-start", fontSize: 13 }}
                      onClick={() => setSuggest((s) => ({ ...s, [key]: roastsFor(id) }))}
                    >
                      💡 Suggest a line
                    </button>
                  )}
                  {suggest[key].map((line, i) => (
                    <button
                      key={i}
                      style={{
                        ...S.layerBtn,
                        textAlign: "left",
                        fontSize: 13,
                        lineHeight: 1.35,
                        borderColor: "#4a5164",
                      }}
                      onClick={() => {
                        setBlurb(line);
                        setSuggest((s) => ({ ...s, [key]: [] }));
                      }}
                    >
                      {line}
                    </button>
                  ))}
                </div>
              ))}
            </div>

            <div style={S.card}>
              <div style={S.cardTitle}>BOX LABELS & OVERRIDES</div>
              <div style={S.row}>
                <input
                  style={{ ...S.input, flex: 1 }}
                  value={label1}
                  onChange={(e) => setLabel1(e.target.value)}
                  placeholder="Top box label"
                />
                <input
                  style={{ ...S.input, flex: 1 }}
                  value={label2}
                  onChange={(e) => setLabel2(e.target.value)}
                  placeholder="Bottom box label"
                />
              </div>
              <div style={{ fontSize: 13, color: "#8b8f9c" }}>
                Manual values (leave blank for auto):
              </div>
              <div style={S.row}>
                <input
                  style={{ ...S.input, flex: 1 }}
                  value={ovr.ra}
                  onChange={(e) => setOvr((o) => ({ ...o, ra: e.target.value }))}
                  placeholder={`${autoSides[0].record} (left)`}
                />
                <input
                  style={{ ...S.input, flex: 1 }}
                  value={ovr.rb}
                  onChange={(e) => setOvr((o) => ({ ...o, rb: e.target.value }))}
                  placeholder={`${autoSides[1].record} (right)`}
                />
              </div>
              <div style={S.row}>
                <input
                  style={{ ...S.input, flex: 1 }}
                  value={ovr.pa}
                  onChange={(e) => setOvr((o) => ({ ...o, pa: e.target.value }))}
                  placeholder={`${autoSides[0].ppg} (left)`}
                />
                <input
                  style={{ ...S.input, flex: 1 }}
                  value={ovr.pb}
                  onChange={(e) => setOvr((o) => ({ ...o, pb: e.target.value }))}
                  placeholder={`${autoSides[1].ppg} (right)`}
                />
              </div>
              {(ovr.ra || ovr.rb || ovr.pa || ovr.pb) && (
                <button style={S.linkBtn} onClick={clearOverrides}>
                  Reset to auto values
                </button>
              )}
            </div>

            <div style={S.card}>
              <div style={S.cardTitle}>IMAGES & THEME</div>
              <div style={S.row}>
                <span style={{ fontSize: 14, color: "#8b8f9c" }}>Background theme</span>
                <select
                  style={{ ...S.input, flex: 1 }}
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                >
                  <option value="auto">
                    Auto — {(WEEK_THEMES[asOfWeek] || "classic")} for Wk {asOfWeek + 1}
                  </option>
                  <option value="classic">Classic stadium</option>
                  <option value="halloween">Halloween 🎃</option>
                  <option value="thanksgiving">Thanksgiving 🍂</option>
                  <option value="christmas">Christmas 🎄</option>
                </select>
              </div>
              <FileButton label="+ Add player PNGs" multiple accent onFiles={addPlayers} />
              <div style={S.row}>
                <button style={{ ...S.layerBtn, flex: 1 }} onClick={saveLogoSlots}>
                  Save logo spots
                </button>
                <button style={{ ...S.layerBtn, flex: 1 }} onClick={snapLogosToSlots}>
                  Snap to spots
                </button>
              </div>
              <div style={{ fontSize: 12, color: "#8b8f9c" }}>
                Drag the two team logos where you want them, tap "Save logo
                spots" once — every matchup after that loads them in the exact
                same place at the exact same size.
              </div>
              <div style={S.row}>
                <FileButton
                  label={bgImg ? "Swap background" : "Upload background"}
                  onFiles={(f) => uploadBackground(f[0])}
                />
                <FileButton
                  label={leagueLogoImg ? "Swap league logo" : "League logo"}
                  onFiles={(f) => uploadLeagueLogo(f[0])}
                />
              </div>
              {bgImg && (
                <button
                  style={S.linkBtn}
                  onClick={async () => {
                    setBgImg(null);
                    try {
                      await window.storage.delete(logoKey("background"));
                    } catch (e) {}
                  }}
                >
                  Use built-in stadium background
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= SCORES ================= */}
      {tab === "scores" && (
        <div style={S.page}>
          <div style={S.pickerRow}>
            <select
              style={{ ...S.input, width: "auto" }}
              value={selWeek}
              onChange={(e) => setSelWeek(Number(e.target.value))}
            >
              {league.weeks.map((_, i) => (
                <option key={i} value={i}>
                  {weekLabel(i)}
                </option>
              ))}
            </select>
            <span style={S.hint}>Enter final scores — standings update automatically.</span>
          </div>
          {league.weeks[selWeek].map((m, mi) => {
            const A = teamById(m.a);
            const B = teamById(m.b);
            if (!A || !B)
              return (
                <div key={mi} style={{ ...S.card, opacity: 0.5 }}>
                  <span style={S.hint}>Matchup {mi + 1} — set teams in Schedule tab</span>
                </div>
              );
            return (
              <div key={mi} style={S.card}>
                <div style={S.scoreRow}>
                  <span style={{ ...S.scoreName, color: A.color }}>{A.name}</span>
                  <input
                    style={{ ...S.input, width: 84, textAlign: "center" }}
                    inputMode="decimal"
                    value={m.sa}
                    onChange={(e) => setMatchField(selWeek, mi, "sa", e.target.value)}
                    placeholder="0.00"
                  />
                  <span style={{ color: "#8b8f9c", fontWeight: 700 }}>vs</span>
                  <input
                    style={{ ...S.input, width: 84, textAlign: "center" }}
                    inputMode="decimal"
                    value={m.sb}
                    onChange={(e) => setMatchField(selWeek, mi, "sb", e.target.value)}
                    placeholder="0.00"
                  />
                  <span style={{ ...S.scoreName, color: B.color, textAlign: "right" }}>
                    {B.name}
                  </span>
                </div>
              </div>
            );
          })}

          <div style={S.card}>
            <div style={S.cardTitle}>STANDINGS (all entered weeks)</div>
            {[...league.teams]
              .sort((a, b) => {
                const sa = seasonStats[a.id];
                const sb = seasonStats[b.id];
                if (sb.w !== sa.w) return sb.w - sa.w;
                return sb.pts - sa.pts;
              })
              .map((t, i) => {
                const s = seasonStats[t.id];
                return (
                  <div key={t.id} style={S.standRow}>
                    <span style={{ width: 22, color: "#8b8f9c" }}>{i + 1}</span>
                    <span style={{ flex: 1, color: t.color, fontWeight: 600 }}>{t.name}</span>
                    <span style={{ width: 56, textAlign: "right" }}>{fmtRecord(s)}</span>
                    <span style={{ width: 74, textAlign: "right", color: "#8b8f9c" }}>
                      {fmtPpg(s)}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* ================= SCHEDULE ================= */}
      {tab === "schedule" && (
        <div style={S.page}>
          <button style={{ ...S.exportBtn, alignSelf: "flex-start" }} onClick={loadSeasonSchedule}>
            LOAD 2026 SCHEDULE
          </button>
          <div style={S.pickerRow}>
            <select
              style={{ ...S.input, width: "auto" }}
              value={selWeek}
              onChange={(e) => setSelWeek(Number(e.target.value))}
            >
              {league.weeks.map((_, i) => (
                <option key={i} value={i}>
                  {weekLabel(i)}
                </option>
              ))}
            </select>
            <button style={S.layerBtn} onClick={addWeek}>
              + Add week
            </button>
          </div>
          {league.weeks[selWeek].map((m, mi) => (
            <div key={mi} style={S.card}>
              <div style={S.row}>
                <select
                  style={{ ...S.input, flex: 1 }}
                  value={m.a}
                  onChange={(e) => setMatchField(selWeek, mi, "a", e.target.value)}
                >
                  <option value="">— Team —</option>
                  {league.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <span style={{ alignSelf: "center", color: "#8b8f9c", fontWeight: 700 }}>
                  vs
                </span>
                <select
                  style={{ ...S.input, flex: 1 }}
                  value={m.b}
                  onChange={(e) => setMatchField(selWeek, mi, "b", e.target.value)}
                >
                  <option value="">— Team —</option>
                  {league.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
          <span style={S.hint}>
            Set all 5 matchups for each week once — after that everything fills
            itself in.
          </span>
        </div>
      )}

      {/* ================= TEAMS ================= */}
      {tab === "teams" && (
        <div style={S.page}>
          {league.teams.map((t) => (
            <div key={t.id} style={{ ...S.card, borderLeft: `4px solid ${t.color}` }}>
              <div style={S.row}>
                {logos[t.id] ? (
                  <img
                    src={logos[t.id].src}
                    alt=""
                    style={{ width: 44, height: 44, objectFit: "contain", borderRadius: 6 }}
                  />
                ) : (
                  <div style={S.logoPlaceholder}>?</div>
                )}
                <input
                  style={{ ...S.input, flex: 1 }}
                  value={t.name}
                  onChange={(e) => setTeamField(t.id, "name", e.target.value)}
                />
                <input
                  type="color"
                  value={t.color}
                  onChange={(e) => setTeamField(t.id, "color", e.target.value)}
                  style={S.colorInput}
                  aria-label={`${t.name} color`}
                />
              </div>
              <div style={S.row}>
                <select
                  style={{ ...S.input, flex: 1, fontFamily: `"${t.font}"` }}
                  value={t.font}
                  onChange={(e) => {
                    const f = e.target.value;
                    setTeamField(t.id, "font", f);
                    document.fonts
                      .load(`400 40px "${f}"`)
                      .then(() => setFontTick((x) => x + 1))
                      .catch(() => {});
                  }}
                >
                  {FONTS.map((f) => (
                    <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>
                      {f}
                    </option>
                  ))}
                </select>
                <FileButton
                  small
                  label={logos[t.id] ? "Swap logo" : "Upload logo"}
                  onFiles={(files) => uploadTeamLogo(t.id, files[0])}
                />
              </div>
              <div
                style={{
                  fontFamily: `"${t.font}"`,
                  color: t.color,
                  fontSize: 24,
                  textShadow: "2px 2px 0 #000",
                }}
              >
                {t.name}
              </div>

              {/* player library */}
              <div style={{ borderTop: "1px solid #2a2f3c", paddingTop: 8 }}>
                <div style={{ ...S.cardTitle, fontSize: 12, marginBottom: 6 }}>
                  PLAYER PNGs ({(t.players || []).length})
                </div>
                {(t.players || []).map((p) => (
                  <div key={p.pid} style={{ ...S.row, marginBottom: 6 }}>
                    <input
                      style={{ ...S.input, flex: 1, padding: "6px 8px", fontSize: 14 }}
                      value={p.name}
                      onChange={(e) => setPlayerField(t.id, p.pid, "name", e.target.value)}
                    />
                    <button
                      style={{ ...S.layerBtn, padding: "6px 10px", fontSize: 13 }}
                      onClick={() =>
                        setPlayerField(
                          t.id,
                          p.pid,
                          "facing",
                          p.facing === "right" ? "left" : "right"
                        )
                      }
                      title="Which way the PNG faces"
                    >
                      Faces {p.facing === "right" ? "▶" : "◀"}
                    </button>
                    <button
                      style={{
                        ...S.layerBtn,
                        padding: "6px 10px",
                        fontSize: 13,
                        color: "#ff7a7a",
                        ...(pendingDel === p.pid
                          ? { background: "#3a1518", borderColor: "#ff7a7a" }
                          : {}),
                      }}
                      onClick={() => {
                        if (pendingDel === p.pid) {
                          deletePlayer(t.id, p.pid);
                          setPendingDel(null);
                        } else {
                          setPendingDel(p.pid);
                          setTimeout(
                            () => setPendingDel((cur) => (cur === p.pid ? null : cur)),
                            3000
                          );
                        }
                      }}
                    >
                      {pendingDel === p.pid ? "Sure?" : "✕"}
                    </button>
                  </div>
                ))}
                <FileButton
                  small
                  multiple
                  label="+ Add player PNGs"
                  onFiles={(files) => uploadTeamPlayers(t.id, files)}
                />
              </div>
            </div>
          ))}
          <span style={S.hint}>
            Logos, colors, and fonts save automatically and load into every
            graphic.
          </span>
        </div>
      )}

      {/* ================= EXPORT MODAL ================= */}
      {exportUrl && (
        <div style={S.modal} onClick={() => setExportUrl(null)}>
          <div style={S.modalInner} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalTitle}>Your graphic is ready</div>
            <img src={exportUrl} alt="Exported matchup graphic" style={S.modalImg} />
            <div style={S.modalHint}>
              On your phone: press and hold the image, then "Save Image".
            </div>
            <div style={S.row}>
              <a href={exportUrl} download="matchup-graphic.png" style={S.dlBtn}>
                Download PNG
              </a>
              <button style={S.layerBtn} onClick={() => setExportUrl(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- styles ----------
const styles = {
  app: {
    minHeight: "100vh",
    background: "#14161c",
    color: "#f2f2f5",
    fontFamily: '"Barlow Condensed", system-ui, sans-serif',
    display: "flex",
    flexDirection: "column",
  },
  topbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "12px 16px",
    background: "#0c0e13",
    borderBottom: "2px solid #c9a227",
    flexWrap: "wrap",
  },
  brand: {
    fontWeight: 700,
    fontSize: 20,
    letterSpacing: 1.5,
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    flexWrap: "wrap",
  },
  brandMark: { color: "#c9a227" },
  brandSub: { fontSize: 12, letterSpacing: 3, color: "#8b8f9c", fontWeight: 600 },
  saveNote: { fontSize: 13, color: "#3ddc84" },
  exportBtn: {
    background: "#c9a227",
    color: "#14161c",
    border: "none",
    borderRadius: 6,
    padding: "10px 18px",
    fontFamily: "inherit",
    fontWeight: 700,
    fontSize: 15,
    letterSpacing: 1.5,
    cursor: "pointer",
  },
  tabs: {
    display: "flex",
    gap: 4,
    padding: "8px 16px 0",
    background: "#0c0e13",
  },
  tabBtn: {
    background: "transparent",
    color: "#8b8f9c",
    border: "none",
    borderBottom: "3px solid transparent",
    padding: "8px 14px",
    fontFamily: "inherit",
    fontWeight: 700,
    fontSize: 15,
    letterSpacing: 2,
    cursor: "pointer",
  },
  tabBtnActive: { color: "#ffd964", borderBottomColor: "#c9a227" },
  main: {
    display: "flex",
    flexWrap: "wrap",
    gap: 16,
    padding: 16,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  page: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 16,
    maxWidth: 620,
    width: "100%",
    margin: "0 auto",
    boxSizing: "border-box",
  },
  stageWrap: { flex: "1 1 620px", maxWidth: 1000, minWidth: 300 },
  pickerRow: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    marginBottom: 10,
    flexWrap: "wrap",
  },
  matchChips: { display: "flex", gap: 8, flexWrap: "wrap", flex: 1 },
  chip: {
    background: "#1e222c",
    color: "#f2f2f5",
    border: "1px solid #343a48",
    borderRadius: 999,
    padding: "7px 14px",
    fontFamily: "inherit",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
  },
  chipActive: { background: "#242015", borderColor: "#c9a227", color: "#ffd964" },
  canvas: {
    width: "100%",
    height: "auto",
    display: "block",
    borderRadius: 10,
    boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
    touchAction: "none",
    cursor: "grab",
    background: "#000",
  },
  hint: { fontSize: 14, color: "#8b8f9c", marginTop: 4 },
  layerBar: { display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" },
  layerBtn: {
    background: "#1e222c",
    color: "#f2f2f5",
    border: "1px solid #343a48",
    borderRadius: 6,
    padding: "8px 12px",
    fontFamily: "inherit",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
  },
  sidebar: {
    flex: "1 1 280px",
    maxWidth: 380,
    minWidth: 270,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  card: {
    background: "#1a1d25",
    border: "1px solid #2a2f3c",
    borderRadius: 10,
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  cardTitle: {
    fontWeight: 700,
    letterSpacing: 2,
    fontSize: 14,
    color: "#c9a227",
  },
  colorInput: {
    width: 38,
    height: 34,
    border: "none",
    background: "transparent",
    padding: 0,
    cursor: "pointer",
    alignSelf: "center",
  },
  input: {
    background: "#10131a",
    border: "1px solid #343a48",
    borderRadius: 6,
    color: "#f2f2f5",
    padding: "9px 10px",
    fontFamily: "inherit",
    fontSize: 15,
    width: "100%",
    boxSizing: "border-box",
  },
  row: { display: "flex", gap: 8, alignItems: "center" },
  scoreRow: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    justifyContent: "space-between",
  },
  scoreName: { flex: 1, fontWeight: 600, fontSize: 15 },
  standRow: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    fontSize: 15,
    padding: "3px 0",
  },
  logoPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 6,
    background: "#10131a",
    border: "1px dashed #4a5164",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#4a5164",
    fontWeight: 700,
  },
  fileBtn: {
    background: "#1e222c",
    border: "1px dashed #4a5164",
    borderRadius: 6,
    padding: "10px 12px",
    textAlign: "center",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
    flex: 1,
    color: "#f2f2f5",
  },
  fileBtnAccent: { background: "#242015", borderColor: "#c9a227", color: "#ffd964" },
  linkBtn: {
    background: "none",
    border: "none",
    color: "#8fb4ff",
    fontFamily: "inherit",
    fontSize: 13,
    cursor: "pointer",
    textAlign: "left",
    padding: 0,
    textDecoration: "underline",
  },
  modal: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.75)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 50,
  },
  modalInner: {
    background: "#1a1d25",
    border: "1px solid #343a48",
    borderRadius: 12,
    padding: 16,
    maxWidth: 720,
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  modalTitle: { fontWeight: 700, fontSize: 18, letterSpacing: 1 },
  modalImg: { width: "100%", borderRadius: 8, border: "1px solid #343a48" },
  modalHint: { fontSize: 13, color: "#8b8f9c" },
  dlBtn: {
    background: "#c9a227",
    color: "#14161c",
    borderRadius: 6,
    padding: "10px 16px",
    fontWeight: 700,
    fontSize: 15,
    letterSpacing: 1,
    textDecoration: "none",
    textAlign: "center",
    flex: 1,
  },
};
