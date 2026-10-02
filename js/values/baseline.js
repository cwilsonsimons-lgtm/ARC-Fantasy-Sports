// Dynasty Daddy values → dated snapshots keyed the way the model keys assets
// (Sleeper player id, or pick:<season>:<round>).
//
// Dynasty Daddy's API (dynasty-daddy.com/api/v1/player/all/today) returns one
// row per player with sleeper_id, trade_value (1QB) and sf_trade_value
// (superflex). Picks are rows with position "PI", first_name the season and
// last_name like "Mid 1st". The …/all/prev endpoint returns the same rows for
// recent months with a date on each, which seeds history in one go.
//
// Their API only answers browser requests from their own site, so a direct
// fetch from here may be refused; the Setup tab falls back to pasting the JSON.

import { pickKey } from './model.js';

export const DD_TODAY = 'https://dynasty-daddy.com/api/v1/player/all/today';
export const DD_PREV = 'https://dynasty-daddy.com/api/v1/player/all/prev';

const dayOf = t => { const d = new Date(t); d.setUTCHours(12, 0, 0, 0); return d.getTime(); };

function rowDate(r) {
  const raw = r.date || r.created_at || r.updated_at;
  const t = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(t) ? dayOf(t) : null;
}

function pickRound(name) {
  const m = /(\d)\s*(st|nd|rd|th)/i.exec(name || '') || /round\s*(\d)/i.exec(name || '');
  return m ? +m[1] : null;
}

// rows -> [{ date, values }]. `superflex` picks sf_trade_value over trade_value.
// Rows without a date are stamped `fallbackDate`.
export function parseDynastyDaddy(rows, { superflex = true, fallbackDate = Date.now() } = {}) {
  if (!Array.isArray(rows)) {
    rows = rows?.players || rows?.data || rows?.rows;
    if (!Array.isArray(rows)) throw new Error('Expected a JSON array of players');
  }
  const byDate = new Map();
  const pickTiers = new Map();   // date|key -> { mid, all: [] }
  for (const r of rows) {
    const v = Number(superflex ? (r.sf_trade_value ?? r.trade_value) : (r.trade_value ?? r.sf_trade_value));
    if (!Number.isFinite(v)) continue;
    const date = rowDate(r) ?? dayOf(fallbackDate);
    const values = byDate.get(date) || byDate.set(date, {}).get(date);
    if (r.position === 'PI') {
      const season = String(r.first_name || '').match(/\d{4}/)?.[0];
      const round = pickRound(r.last_name || r.full_name);
      if (!season || !round) continue;
      const key = pickKey(season, round);
      const id = date + '|' + key;
      const tier = pickTiers.get(id) || pickTiers.set(id, { date, key, mid: null, all: [] }).get(id);
      tier.all.push(v);
      if (/mid/i.test(r.last_name || r.full_name)) tier.mid = v;
    } else if (r.sleeper_id) {
      values[String(r.sleeper_id)] = v;
    }
  }
  // Sleeper picks don't carry a slot, so value them as a mid pick.
  for (const t of pickTiers.values()) {
    byDate.get(t.date)[t.key] = t.mid ?? Math.round(t.all.reduce((a, b) => a + b, 0) / t.all.length);
  }
  return [...byDate].map(([date, values]) => ({ date, values })).sort((a, b) => a.date - b.date);
}

// Merge new snapshots into the stored list. Same-day snapshots replace each other.
// Older history is thinned to one per week so storage stays small.
export function mergeSnapshots(existing, incoming, now = Date.now()) {
  const map = new Map(existing.map(s => [s.date, s]));
  for (const s of incoming) if (Object.keys(s.values).length) map.set(s.date, s);
  const all = [...map.values()].sort((a, b) => a.date - b.date);
  const recent = now - 21 * 86400000;
  const keep = [];
  let lastWeek = null;
  for (const s of all) {
    if (s.date >= recent) { keep.push(s); continue; }
    const wk = Math.floor(s.date / (7 * 86400000));
    if (wk === lastWeek) keep[keep.length - 1] = s; else keep.push(s);
    lastWeek = wk;
  }
  return keep;
}

export async function fetchDynastyDaddy(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Dynasty Daddy: ${res.status}`);
  return res.json();
}
