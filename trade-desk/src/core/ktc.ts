// Reads values pasted from KeepTradeCut's dynasty rankings (or any list of "name … value").
// The page can't fetch KTC itself, so you select the rankings, copy, and paste. Players are
// anchored on names we already know from the league, so the page layout doesn't matter much.
import type { League } from './types';
import { pickSlotLabel } from './model';

export const normName = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’'`.]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export interface MarketImport {
  values: Record<string, number>;
  matched: { id: string; name: string; value: number }[];
  unmatchedLines: number;
}

const ROUND: Record<string, number> = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4 };

export function parseMarket(text: string, league: League): MarketImport {
  const names = new Map<string, string>();
  for (const p of Object.values(league.players)) names.set(normName(p.name), p.id);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const values: Record<string, number> = {};
  const matched: MarketImport['matched'] = [];
  const pickValues: { season: number; slot: string; round: number; value: number }[] = [];
  let unmatched = 0;

  // A value is a whole number from 100 to 10,000 that isn't a year.
  const valueIn = (s: string) => {
    for (const tok of s.replace(/,(\d{3})/g, '$1').split(/[\s|\t]+/)) {
      if (!/^\d{3,5}$/.test(tok)) continue;
      const n = +tok;
      if (n >= 100 && n <= 10000 && !(n >= 2020 && n <= 2035)) return n;
    }
    return null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const pick = /(20\d\d)\s+(early|mid|late)?\s*(1st|2nd|3rd|4th)/i.exec(line);
    if (pick) {
      const rest = line.slice(pick.index + pick[0].length);
      const v = valueIn(rest) ?? valueIn(lines.slice(i + 1, i + 5).join(' '));
      if (v != null) pickValues.push({ season: +pick[1], slot: (pick[2] ?? '').toLowerCase(), round: ROUND[pick[3].toLowerCase()], value: v });
      continue;
    }
    const n = normName(line);
    let id: string | undefined = names.get(n);
    let after = '';
    if (!id) {
      // "1 Josh Allen BUF QB1 30.4 9999" on one line: try the longest known name inside it.
      for (const [nm, pid] of names) {
        if (nm.length > 4 && (' ' + n + ' ').includes(' ' + nm + ' ') && (!id || nm.length > normName(league.players[id].name).length)) id = pid;
      }
      if (id) {
        const raw = league.players[id].name.split(' ').pop()!;
        const at = line.toLowerCase().lastIndexOf(raw.toLowerCase());
        after = at >= 0 ? line.slice(at + raw.length) : line;
      }
    }
    if (!id) {
      unmatched++;
      continue;
    }
    // The value follows the name, on the same line or within the next few (team, position, age…).
    let v = valueIn(after);
    for (let j = i + 1; v == null && j < Math.min(lines.length, i + 7); j++) {
      if (names.has(normName(lines[j]))) break;
      v = valueIn(lines[j]);
    }
    if (v != null && values[id] == null) {
      values[id] = v;
      matched.push({ id, name: league.players[id].name, value: v });
    }
  }

  for (const k of Object.values(league.picks)) {
    const label = pickSlotLabel(league, k).toLowerCase();
    const exact = pickValues.find((p) => p.season === k.season && p.round === k.round && p.slot === label);
    const any = pickValues.filter((p) => p.season === k.season && p.round === k.round);
    const v = exact?.value ?? (any.length ? Math.round(any.reduce((s, p) => s + p.value, 0) / any.length) : null);
    if (v != null) values[k.id] = v;
  }
  return { values, matched, unmatchedLines: unmatched };
}
