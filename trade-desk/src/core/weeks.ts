// NFL weeks. A fantasy week runs Tuesday to Monday night, so a week is keyed by its Tuesday
// (YYYY-MM-DD, local time). The week number comes from the last sync, which knows which week
// is next, and is counted forward or back from there.
import type { League } from './types';

const DAY = 86400000;
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** The Tuesday that starts the week containing `d`. */
export function weekStart(d: Date): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const back = (x.getDay() + 7 - 2) % 7; // Tuesday = 2
  x.setDate(x.getDate() - back);
  return ymd(x);
}

/** Week number for a week key, if the league says which week it was at the last sync. */
export function weekNumber(key: string, league: Pick<League, 'asOf' | 'week'>): number | null {
  if (!league.week) return null;
  const anchor = parse(weekStart(new Date(league.asOf)));
  const n = league.week + Math.round((parse(key).getTime() - anchor.getTime()) / (7 * DAY));
  return n >= 1 && n <= 18 ? n : null;
}

export function weekLabel(key: string, league: Pick<League, 'asOf' | 'week'>): string {
  const n = weekNumber(key, league);
  if (n) return `Week ${n}`;
  return 'Week of ' + parse(key).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "Nov 24 – Nov 30" */
export function weekRange(key: string): string {
  const a = parse(key);
  const b = new Date(a.getTime() + 6 * DAY);
  const f = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${f(a)} – ${f(b)}`;
}
