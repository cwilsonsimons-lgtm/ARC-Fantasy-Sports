#!/usr/bin/env node
// Generate Record Book art with OpenAI's image API and wire it into the page.
//
//   OPENAI_API_KEY=sk-... node tools/records-art.mjs [--all] [--force] [--only <id,...|mascot>]
//
// Reads records/data.js (run `npm run records` first), works out which players the
// page features, and draws a cartoon portrait for each one that does not have art
// yet, plus the league mascot. Images land in records/art/ and the list of them in
// records/art-auto.js, which the page loads. Anything in records/art.js (hand-made
// art) wins over generated art.
//
// Default: the mascot, the all-time hi-score holder and the #1 at each position
// this season (about 6 images). --all draws every player who appears anywhere on
// the page (~60). Existing images are skipped unless --force.
//
// Model and size can be changed with OPENAI_IMAGE_MODEL (default gpt-image-1).

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REC = path.join(ROOT, 'records');
const ART = path.join(REC, 'art');
const MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const KEY = process.env.OPENAI_API_KEY;

const args = process.argv.slice(2);
const ALL = args.includes('--all');
const FORCE = args.includes('--force');
const onlyAt = args.indexOf('--only');
const ONLY = onlyAt >= 0 ? new Set(args[onlyAt + 1].split(',')) : null;

if (!KEY) { console.error('Set OPENAI_API_KEY (an API key from platform.openai.com).'); process.exit(1); }

const load = (file, name) => {
  if (!fs.existsSync(file)) return null;
  const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx);
  return ctx.window[name];
};
const D = load(path.join(REC, 'data.js'), 'RECORDS');
if (!D) { console.error('records/data.js is missing. Run `npm run records` first.'); process.exit(1); }
const auto = load(path.join(REC, 'art-auto.js'), 'RECORDS_ART_AUTO') || { mascot: null, players: {} };

// ---------- prompts ----------
const STYLE = 'Bold cartoon illustration in a retro arcade / 90s sports-card style. Thick black outlines, ' +
  'cel shading, saturated colors, slight exaggeration. Dark navy night background with gold and lime-green ' +
  'accent lighting and a subtle stadium glow. No text, no words, no letters, no numbers, no team logos, no watermarks.';

const COLORS = {
  ARI: 'cardinal red and white', ATL: 'red and black', BAL: 'purple and black', BUF: 'royal blue and red',
  CAR: 'black and panther blue', CHI: 'navy and orange', CIN: 'black and orange', CLE: 'brown and orange',
  DAL: 'navy and silver', DEN: 'orange and navy', DET: 'Honolulu blue and silver', GB: 'green and gold',
  HOU: 'deep steel blue and red', IND: 'royal blue and white', JAX: 'teal and black', KC: 'red and gold',
  LAR: 'royal blue and gold', LA: 'royal blue and gold', LAC: 'powder blue and gold', LV: 'silver and black',
  MIA: 'aqua and orange', MIN: 'purple and gold', NE: 'navy and red', NO: 'black and gold', NYG: 'royal blue and red',
  NYJ: 'green and white', PHI: 'midnight green and silver', PIT: 'black and gold', SEA: 'navy and action green',
  SF: 'scarlet and gold', TB: 'red and pewter', TEN: 'navy and titans blue', WAS: 'burgundy and gold',
};
const POS = { QB: 'quarterback', RB: 'running back', WR: 'wide receiver', TE: 'tight end', K: 'kicker' };

const mascotPrompt = `${STYLE} The mascot of a fantasy football league called City Boys Dynasty: a swaggering, ` +
  'muscular city pigeon wearing a gold football helmet with a lime-green stripe and a gold chain, spiking a football ' +
  'on a city rooftop at night. Neon-lit skyscrapers behind him, stadium lights in the distance. Confident, cocky grin. ' +
  'Wide landscape composition with the pigeon centered and breathing room at the edges.';
const playerPrompt = p => {
  const c = COLORS[p.nfl] || 'navy and gold';
  return `${STYLE} Head-and-shoulders cartoon portrait of NFL ${POS[p.pos] || 'player'} ${p.name} in a ${c} ` +
    `football uniform with no logos, fierce and confident, slightly turned toward the camera. Square crop, face in the ` +
    `upper middle of the frame, background a glowing ${c} gradient.`;
};
// Fallback when the model will not draw a real person: same look, no name.
const genericPrompt = p => `${STYLE} Head-and-shoulders cartoon portrait of a fierce, confident ${POS[p.pos] || 'football player'} ` +
  `in a ${COLORS[p.nfl] || 'navy and gold'} football uniform with no logos. Square crop, face in the upper middle of the frame.`;

// ---------- who gets art ----------
const featured = new Map();
const add = p => p && p.id && p.pos !== 'D/ST' && !featured.has(p.id) && featured.set(p.id, p);
D.hiScore.forEach(add);
D.positions.forEach(pos => add(D.bestByPosition[pos][0]));
if (ALL) {
  [D.topScorers, D.seasonLeaders, D.biggestWeeks, D.mostPoints, D.bench, D.worstStarts,
   ...D.positions.map(p => D.bestByPosition[p])].flat().forEach(add);
  D.positionKings.forEach(k => Object.values(k.kings).forEach(add));
}

// ---------- OpenAI ----------
async function draw(prompt, size) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: MODEL, prompt, size, quality: 'medium', output_format: 'webp', output_compression: 85, n: 1 }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.data?.[0]?.b64_json) return Buffer.from(body.data[0].b64_json, 'base64');
    const msg = body.error?.message || `${res.status} ${res.statusText}`;
    if (res.status === 400 || res.status === 401 || res.status === 403 || attempt >= 3) {
      const err = new Error(msg); err.status = res.status; err.code = body.error?.code; throw err;
    }
    await new Promise(r => setTimeout(r, 2000 * attempt));
  }
}

const jobs = [];
if (!ONLY || ONLY.has('mascot')) jobs.push({ key: 'mascot', file: 'art/mascot.webp', size: '1536x1024', prompt: mascotPrompt });
for (const p of featured.values()) {
  if (ONLY && !ONLY.has(p.id)) continue;
  jobs.push({ key: p.id, name: p.name, file: `art/players/${p.id}.webp`, size: '1024x1024', prompt: playerPrompt(p), fallback: genericPrompt(p) });
}

fs.mkdirSync(path.join(ART, 'players'), { recursive: true });
let made = 0, skipped = 0, failed = 0;
for (const j of jobs) {
  const out = path.join(REC, j.file);
  if (!FORCE && fs.existsSync(out)) { skipped++; record(j); continue; }
  process.stdout.write(`Drawing ${j.name || j.key}… `);
  try {
    let img;
    try { img = await draw(j.prompt, j.size); }
    catch (e) {
      if (!j.fallback || e.status !== 400) throw e;
      process.stdout.write('(declined by name, drawing a lookalike) ');
      img = await draw(j.fallback, j.size);
    }
    fs.writeFileSync(out, img); record(j); made++;
    console.log(`saved ${j.file} (${(img.length / 1024) | 0} KB)`);
  } catch (e) {
    failed++; console.log(`failed: ${e.message}`);
    if (e.status === 401 || e.status === 403) break; // bad key: no point trying the rest
  }
}
function record(j) { if (j.key === 'mascot') auto.mascot = j.file; else (auto.players ||= {})[j.key] = j.file; }

fs.writeFileSync(path.join(REC, 'art-auto.js'),
  `// Generated by tools/records-art.mjs — do not edit by hand. Hand-made art goes in art.js.\n` +
  `window.RECORDS_ART_AUTO = ${JSON.stringify(auto, null, 2)};\n`);
console.log(`Done: ${made} drawn, ${skipped} already there, ${failed} failed. Model ${MODEL}.`);
if (failed) process.exitCode = 1;
