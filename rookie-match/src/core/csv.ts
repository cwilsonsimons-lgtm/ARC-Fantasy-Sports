// Small CSV/TSV reader and writer. Quotes are only treated as quoting when they
// open a field, so unquoted heights like 6'3" survive intact.

export type Delimiter = ',' | '\t' | ';' | '|';

function splitLine(line: string, d: Delimiter): string[] {
  const out: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let v = '';
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { v += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else v += line[i++];
      }
      // Anything between the closing quote and the delimiter is kept (lenient).
      const next = line.indexOf(d, i);
      v += next === -1 ? line.slice(i) : line.slice(i, next);
      out.push(v);
      i = next === -1 ? line.length + 1 : next + 1;
    } else {
      const next = line.indexOf(d, i);
      out.push(next === -1 ? line.slice(i) : line.slice(i, next));
      i = next === -1 ? line.length + 1 : next + 1;
    }
  }
  return out.map((c) => c.trim());
}

/** Splits text into logical lines, keeping newlines that sit inside a quoted field. */
function logicalLines(text: string): string[] {
  const lines: string[] = [];
  let cur = '';
  let inQuote = false;
  let fieldStart = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuote && text[i + 1] === '"') { cur += '""'; i++; continue; }
      if (inQuote) inQuote = false;
      else if (fieldStart) inQuote = true;
      cur += ch;
      fieldStart = false;
      continue;
    }
    if (!inQuote && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      lines.push(cur);
      cur = '';
      fieldStart = true;
      continue;
    }
    cur += ch;
    fieldStart = !inQuote && (ch === ',' || ch === '\t' || ch === ';' || ch === '|');
  }
  lines.push(cur);
  return lines.filter((l) => l.trim() !== '');
}

export function detectDelimiter(text: string): Delimiter {
  const sample = logicalLines(text).slice(0, 10);
  if (sample.length === 0) return ',';
  const cands: Delimiter[] = ['\t', ',', ';', '|'];
  let best: Delimiter = ',';
  let bestScore = -1;
  for (const d of cands) {
    const widths = sample.map((l) => splitLine(l, d).length);
    const min = Math.min(...widths);
    if (min < 2) continue;
    const consistent = widths.filter((w) => w === widths[0]).length / widths.length;
    const score = consistent * 10 + min;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

export function parseTable(text: string, delimiter?: Delimiter): { rows: string[][]; delimiter: Delimiter } {
  const d = delimiter ?? detectDelimiter(text);
  const rows = logicalLines(text.replace(/^﻿/, '')).map((l) => splitLine(l, d));
  return { rows, delimiter: d };
}

function cell(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
