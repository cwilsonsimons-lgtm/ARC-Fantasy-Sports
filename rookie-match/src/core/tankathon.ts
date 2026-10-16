// Reads a Tankathon NFL big board that the user copied (select all → copy) or
// saved as an .html page. Tankathon can't be fetched from the browser (it doesn't
// allow cross-site reads), so the user brings the page to us.
//
// Each player on the board carries a "POS | School" line (e.g. "OT/IOL | Missouri").
// That line anchors a player: the name sits just before it (with the board rank
// before or on the name line), and height and weight follow it. Nothing is guessed:
// a player whose height or weight can't be found comes back with that field empty,
// and the import preview flags it.
import type { RawValues } from './importer';

export interface TankathonRow {
  line: number; // 1-based line in the extracted text, for the preview
  rank?: number;
  raw: RawValues;
}

export interface TankathonResult {
  rows: TankathonRow[];
  year?: string; // draft year if the page says e.g. "2027 NFL Draft"
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

const POS_PART = '[A-Z]{1,5}';
const ANCHOR = new RegExp(`^(${POS_PART}(?:\\s*/\\s*${POS_PART})*)\\s*\\|\\s*(.+)$`);

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

export function parseTankathon(input: string): TankathonResult {
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

  const anchors: number[] = [];
  lines.forEach((l, i) => { if (ANCHOR.test(l)) anchors.push(i); });

  const yearMatch = text.match(/\b(20\d\d)\s+NFL\s+(?:Draft|Big Board)/i);
  const rows: TankathonRow[] = [];
  let prevEnd = -1;

  anchors.forEach((ai, k) => {
    const [, pos, rest] = lines[ai].match(ANCHOR)!;
    // "QB | Texas 6'4" 222 lbs" — measurements on the anchor line itself.
    const cut = rest.search(/\s\d\s*['’′-]\s*\d|\s\d{3}\s*lbs?\b/i);
    const school = cut === -1 ? rest : rest.slice(0, cut);
    const tail = cut === -1 ? '' : rest.slice(cut);
    // Name: nearest name-like line before the anchor (after the previous player's block).
    let name = '';
    let rank: number | undefined;
    let nameIdx = -1;
    for (let j = ai - 1; j > prevEnd && j >= ai - 4; j--) {
      const pre = lines[j].match(RANK_PREFIX);
      if (pre && nameLike(pre[2])) { name = pre[2]; rank = Number(pre[1]); nameIdx = j; break; }
      if (nameLike(lines[j])) { name = lines[j]; nameIdx = j; break; }
    }
    if (nameIdx > 0 && rank === undefined) {
      for (let j = nameIdx - 1; j > prevEnd && j >= nameIdx - 2; j--) {
        const r = lines[j].match(RANK_ALONE);
        if (r) { rank = Number(r[1]); break; }
      }
    }
    // Height/weight: between this anchor and the next player's name.
    const nextAnchor = anchors[k + 1] ?? lines.length;
    let end = nextAnchor;
    for (let j = nextAnchor - 1; j > ai && j >= nextAnchor - 4; j--) {
      const pre = lines[j].match(RANK_PREFIX);
      if (nameLike(lines[j]) || (pre && nameLike(pre[2]))) { end = j; break; }
    }
    let height = tail ? findHeight(tail) ?? '' : '';
    let weight = tail ? findWeight(tail) ?? tail.trim().match(/\s(\d{3})$/)?.[1] ?? '' : '';
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
      if (height && weight) break;
    }
    prevEnd = ai; // the next player's name and rank sit after this anchor
    rows.push({
      line: ai + 1,
      ...(rank !== undefined ? { rank } : {}),
      raw: {
        name,
        position: pos.replace(/\s+/g, ''),
        height,
        weight,
        college: school.trim(),
        notes: rank !== undefined ? `Tankathon big board #${rank}` : 'From Tankathon big board',
      },
    });
  });

  return { rows, ...(yearMatch ? { year: yearMatch[1] } : {}) };
}
