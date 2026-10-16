// Reads a draft big board that the user copied (select all → copy) or saved as an
// .html page: Tankathon's NFL big board or an NFL Mock Draft Database board.
// Neither site can be fetched from the browser (they don't allow cross-site reads),
// so the user brings the page to us.
//
// A player is anchored on their position: either a "POS | School" style line
// (Tankathon writes "OT/IOL | Missouri"; "School | POS", "POS, School" and "·" or
// "•" separators work too) or a line holding only a position, followed by the
// school. The name sits just before the anchor (with the board rank before or on
// the name line); height and weight, when the board shows them, follow it.
// Nothing is guessed: a missing height or weight comes back empty and the import
// preview flags it.
import type { RawValues } from './importer';
import { cleanCode, defaultPositionSettings, normalizePosition, type PositionSettings } from './positions';

export type BoardSource = 'tankathon' | 'mddb';

export const SOURCE_LABEL: Record<BoardSource, string> = {
  tankathon: 'Tankathon big board',
  mddb: 'NFL Mock Draft Database board',
};

export interface BoardRow {
  line: number; // 1-based line in the extracted text, for the preview
  rank?: number;
  raw: RawValues;
}

export interface BoardResult {
  rows: BoardRow[];
  year?: string; // draft year if the page says e.g. "2027 NFL Draft"
  withMeasurements: number; // rows where both height and weight were found
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', prime: '′', Prime: '″' };

/** Turns saved page HTML into one text fragment per line. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n] ?? m);
}

const looksLikeHtml = (t: string) => /<(html|body|div|table|span)[\s>]/i.test(t);

// Height: 6'3", 6' 3", 6'3'', 6’3”, 6'2 1/2", 6'2½"; or labelled "Ht 6-3" / "Height: 6-3".
const HEIGHT_FT = /(\d)\s*['’′]\s*(\d{1,2}(?:\.\d+)?(?:\s*\d\/\d)?[½¼¾⅛⅜⅝⅞]?)\s*(?:"|''|”|″)?/;
const HEIGHT_LABELLED = /\b(?:ht|height)\b\.?:?\s*(\d)\s*-\s*(\d{1,2}(?:\.\d+)?)/i;
const HEIGHT_DASH_ALONE = /^(\d)-(\d{1,2})$/;
// Weight: "215 lbs", "215 lb", "215lbs", labelled "Wt 215" / "Weight: 215".
const WEIGHT_UNIT = /\b(\d{3})(?:\.\d)?\s*(?:lbs?|pounds)\b\.?/i;
const WEIGHT_LABELLED = /\b(?:wt|weight)\b\.?:?\s*(\d{3})\b/i;
const NUMBER_ALONE = /^(\d{3})$/;

function findHeight(line: string): string | null {
  let m = line.match(HEIGHT_FT);
  if (m) return `${m[1]}'${m[2].trim()}"`;
  m = line.match(HEIGHT_LABELLED) ?? line.match(HEIGHT_DASH_ALONE);
  return m ? `${m[1]}-${m[2]}` : null;
}

function findWeight(line: string): string | null {
  const m = line.match(WEIGHT_UNIT) ?? line.match(WEIGHT_LABELLED);
  return m ? m[1] : null;
}

const RANK_ALONE = /^#?(\d{1,3})\.?$/;
const RANK_PREFIX = /^#?(\d{1,3})[.)]?\s+(.+)$/;

/** A line that could be a player's name: letters, a space or two, no digits. */
function nameLike(line: string): boolean {
  if (line.length < 3 || line.length > 45 || /\d/.test(line) || line.includes('|')) return false;
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ'’.\- ]+$/.test(line)) return false;
  return /[A-Za-z]{2,}/.test(line) && /\s/.test(line.trim());
}

// Labels boards use that the default position list doesn't (they still anchor a
// player; the import then asks what they should map to).
const EXTRA_POSITIONS = new Set(['ATH', 'DB', 'OL', 'DL', 'IOL', 'EDGE', 'OT', 'OG', 'DT', 'DE', 'OLB', 'ILB', 'SAF', 'IDL']);
const POS_SHAPE = /^[A-Z]{1,5}(?:\s*\/\s*[A-Z]{1,5})*$/;

function isPosition(code: string, positions: PositionSettings): boolean {
  const c = code.trim();
  if (!POS_SHAPE.test(c.toUpperCase()) || c.length > 12) return false;
  return normalizePosition(c, positions) !== null || c.toUpperCase().split('/').every((p) => EXTRA_POSITIONS.has(cleanCode(p)));
}

/** Text that reads like a school: letters and the punctuation schools use, no digits. */
const schoolLike = (line: string) => line.length >= 2 && line.length <= 50 && /^[A-Za-zÀ-ÿ&.'’()\- ]+$/.test(line);

// Page furniture that can look like a name ("Consensus Big Board", "Mock Drafts").
const NOT_A_NAME = /\b(board|draft|drafts|mock|rank|ranking|position|school|college|prospects?|consensus|nfl|round|pick|team|filter|search|sign|log|menu|home|news)\b/i;

const MEASURE_TAIL = /\s\d\s*['’′-]\s*\d|\s\d{3}\s*lbs?\b/i;

interface Anchor { pos: string; school: string; tail: string; schoolOnNextLine?: boolean }

const SEPARATED = /^(.+?)\s*(?:\||\s[•·–—-]\s|,\s)\s*(.+)$/;

function anchorAt(lines: string[], i: number, positions: PositionSettings): Anchor | null {
  const line = lines[i];
  const m = line.match(SEPARATED);
  if (m) {
    const [, left, right] = m;
    if (isPosition(left, positions)) {
      // "QB | Texas 6'4" 222 lbs": measurements can trail the school.
      const cut = right.search(MEASURE_TAIL);
      return { pos: left, school: cut === -1 ? right : right.slice(0, cut), tail: cut === -1 ? '' : right.slice(cut) };
    }
    const [first, ...rest] = right.split(' ');
    if (isPosition(first, positions) && schoolLike(left)) return { pos: first, school: left, tail: rest.join(' ') };
    return null;
  }
  // A position on its own line, school on the next. Rows of filter chips
  // ("QB", "RB", "WR", ...) are skipped by requiring non-position neighbours.
  if (!isPosition(line, positions)) return null;
  const prev = lines[i - 1] ?? '';
  const next = lines[i + 1] ?? '';
  if (isPosition(prev, positions) || isPosition(next, positions)) return null;
  return schoolLike(next) ? { pos: line, school: next, tail: '', schoolOnNextLine: true } : { pos: line, school: '', tail: '' };
}

/** A line that could be a player's name: letters, at least two words, no digits, not page furniture. */
function nameLikeStrict(line: string): boolean {
  return nameLike(line) && !NOT_A_NAME.test(line);
}

export function parseBoard(input: string, source: BoardSource, positions: PositionSettings = defaultPositionSettings()): BoardResult {
  const text = looksLikeHtml(input) ? htmlToText(input) : input;
  const lines = text.split(/\r?\n|\t/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

  // Re-join "QB" / "|" / "Texas" split across lines by the copy.
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '|' && i > 0 && i + 1 < lines.length) {
      lines.splice(i - 1, 3, `${lines[i - 1]} | ${lines[i + 1]}`);
      i -= 1;
    } else if (/^\|\s*\S/.test(lines[i]) && i > 0) {
      lines.splice(i - 1, 2, `${lines[i - 1]} ${lines[i]}`);
      i -= 1;
    }
  }

  const found: { i: number; a: Anchor }[] = [];
  lines.forEach((_, i) => { const a = anchorAt(lines, i, positions); if (a) found.push({ i, a }); });

  const yearMatch = text.match(/\b(20\d\d)\s+(?:NFL\s+)?(?:Draft|Big Board|Consensus)/i);
  const rows: BoardRow[] = [];
  let prevEnd = -1;

  found.forEach(({ i: ai, a }, k) => {
    // Name: nearest name-like line before the anchor (after the previous player's block).
    let name = '';
    let rank: number | undefined;
    let nameIdx = -1;
    for (let j = ai - 1; j > prevEnd && j >= ai - 4; j--) {
      const pre = lines[j].match(RANK_PREFIX);
      if (pre && nameLikeStrict(pre[2])) { name = pre[2]; rank = Number(pre[1]); nameIdx = j; break; }
      if (nameLikeStrict(lines[j])) { name = lines[j]; nameIdx = j; break; }
    }
    // The next player's name and rank sit after this anchor (and after its school line).
    prevEnd = a.schoolOnNextLine ? ai + 1 : ai;
    if (!name) return; // a position with no player in front of it is page furniture
    if (rank === undefined) {
      for (let j = nameIdx - 1; j >= 0 && j >= nameIdx - 2; j--) {
        const r = lines[j].match(RANK_ALONE);
        if (r) { rank = Number(r[1]); break; }
      }
    }
    // Height/weight: between this anchor and the next player's name.
    const nextAnchor = found[k + 1]?.i ?? lines.length;
    let end = nextAnchor;
    for (let j = nextAnchor - 1; j > ai && j >= nextAnchor - 4; j--) {
      const pre = lines[j].match(RANK_PREFIX);
      if (nameLikeStrict(lines[j]) || (pre && nameLikeStrict(pre[2]))) { end = j; break; }
    }
    let height = a.tail ? findHeight(a.tail) ?? '' : '';
    let weight = a.tail ? findWeight(a.tail) ?? a.tail.trim().match(/(?:^|\s)(\d{3})$/)?.[1] ?? '' : '';
    for (let j = ai + 1; j < end && !(height && weight); j++) {
      if (!height) {
        const h = findHeight(lines[j]);
        if (h) {
          height = h;
          // "6'4"" then "222" on the next line.
          const w = findWeight(lines[j]) ?? (j + 1 < end ? (findWeight(lines[j + 1]) ?? lines[j + 1].match(NUMBER_ALONE)?.[1] ?? null) : null);
          if (w && !weight) weight = w;
          continue;
        }
      }
      if (!weight) {
        const w = findWeight(lines[j]);
        if (w) weight = w;
      }
    }
    rows.push({
      line: ai + 1,
      ...(rank !== undefined ? { rank } : {}),
      raw: {
        name,
        position: a.pos.replace(/\s+/g, ''),
        height,
        weight,
        college: a.school.trim(),
        notes: rank !== undefined ? `${SOURCE_LABEL[source]} #${rank}` : `From ${SOURCE_LABEL[source]}`,
      },
    });
  });

  return {
    rows,
    withMeasurements: rows.filter((r) => r.raw.height && r.raw.weight).length,
    ...(yearMatch ? { year: yearMatch[1] } : {}),
  };
}
