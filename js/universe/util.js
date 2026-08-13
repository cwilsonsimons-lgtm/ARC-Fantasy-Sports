// WWE 2K Universe — name resolution and plain-text tables.
//
// Fast entry lives or dies on name resolution. Nobody types "w:rhea-ripley"
// after a show; they type "Rhea" and expect it to land. So the resolver walks
// from strict to loose — id, full name, alias, surname, prefix, substring — and
// stops at the first rung that gives exactly one answer. Two answers is an
// error with both names listed, never a guess: silently logging a match against
// the wrong wrestler is far worse than being asked to disambiguate.

import { slug } from './schema.js';

export const norm = s => String(s == null ? '' : s).toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Build a lookup over one kind of entity. Cheap enough to rebuild per import.
export function buildIndex(store, kind = 'wrestler') {
  const rows = store.entitiesOf(kind).map(e => ({
    id: e.id, name: e.name,
    keys: new Set([norm(e.name), slug(e.name), ...(e.aliases || []).map(norm)]),
    tokens: norm(e.name).split(' ').filter(Boolean),
  }));
  return { kind, rows, byId: new Map(rows.map(r => [r.id, r])) };
}

export function resolve(index, text) {
  const q = norm(text);
  const raw = String(text || '').trim();
  if (!q) return { ok: false, reason: 'empty', input: raw, candidates: [] };
  if (index.byId.has(raw)) return { ok: true, id: raw, name: index.byId.get(raw).name, how: 'id' };

  const pick = (matches, how) => {
    if (matches.length === 1) return { ok: true, id: matches[0].id, name: matches[0].name, how };
    if (matches.length > 1) return { ok: false, reason: 'ambiguous', input: raw, candidates: matches.map(m => m.name) };
    return null;
  };

  return pick(index.rows.filter(r => r.keys.has(q)), 'exact')
    || pick(index.rows.filter(r => r.tokens.length && r.tokens[r.tokens.length - 1] === q), 'surname')
    || pick(index.rows.filter(r => r.tokens.includes(q)), 'token')
    || pick(index.rows.filter(r => [...r.keys].some(k => k.startsWith(q))), 'prefix')
    || pick(index.rows.filter(r => [...r.keys].some(k => k.includes(q))), 'substring')
    || { ok: false, reason: 'unknown', input: raw, candidates: near(index, q) };
}

// Suggestions for an unrecognised name — cheap edit-distance-ish scoring so a
// typo comes back with "did you mean".
function near(index, q, limit = 3) {
  return index.rows
    .map(r => ({ name: r.name, score: overlap(q, norm(r.name)) }))
    .filter(r => r.score > 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(r => r.name);
}

function overlap(a, b) {
  const bg = s => { const out = new Set(); for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2)); return out; };
  const A = bg(a), B = bg(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  A.forEach(x => { if (B.has(x)) hit++; });
  return (2 * hit) / (A.size + B.size);
}

// ------------------------------------------------------------------ tables
//
// The brief says no UI, but "no UI" still has to be readable in a terminal.
// These render aligned plain text and nothing else — no colour, no cursor
// control — so the same output pastes into a commit message or a notes file.

export function table(rows, cols, { indent = '' } = {}) {
  if (!rows.length) return `${indent}(none)`;
  const heads = cols.map(c => c.label);
  const body = rows.map(r => cols.map(c => {
    const v = typeof c.get === 'function' ? c.get(r) : r[c.key];
    return v == null ? '' : String(v);
  }));
  const w = heads.map((h, i) => Math.max(visLen(h), ...body.map(b => visLen(b[i]))));
  const line = cells => indent + cells.map((c, i) => (cols[i].align === 'right' ? padStart(c, w[i]) : padEnd(c, w[i]))).join('  ').replace(/\s+$/, '');
  return [line(heads), indent + w.map(n => '─'.repeat(n)).join('  ')].concat(body.map(line)).join('\n');
}

const visLen = s => [...String(s)].length;
const padEnd = (s, n) => s + ' '.repeat(Math.max(0, n - visLen(s)));
const padStart = (s, n) => ' '.repeat(Math.max(0, n - visLen(s))) + s;

export function heading(text, char = '─') {
  return `\n${text}\n${char.repeat(visLen(text))}`;
}

// "3 matches" / "1 match"
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
