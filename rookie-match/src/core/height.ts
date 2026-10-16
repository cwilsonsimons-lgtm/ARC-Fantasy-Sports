// Height and weight parsing. Heights are stored as total inches (fractions allowed,
// e.g. 74.5 for 6'2 1/2"). Anything that could mean two different heights is
// rejected with an explanation rather than guessed.

export const MIN_HEIGHT = 60; // 5'0"
export const MAX_HEIGHT = 90; // 7'6"
export const MIN_WEIGHT = 120;
export const MAX_WEIGHT = 420;

export type Parsed =
  | { ok: true; value: number; warning?: string }
  | { ok: false; error: string };

const fail = (error: string): Parsed => ({ ok: false, error });

// "1/2", "5/8", "½", "2.5" → number
function parseInchPart(raw: string): number | null {
  const s = raw
    .replace(/½/g, ' 1/2').replace(/¼/g, ' 1/4').replace(/¾/g, ' 3/4')
    .replace(/⅛/g, ' 1/8').replace(/⅜/g, ' 3/8').replace(/⅝/g, ' 5/8').replace(/⅞/g, ' 7/8')
    .trim();
  if (s === '') return 0;
  let m = s.match(/^(\d+(?:\.\d+)?)$/);
  if (m) return Number(m[1]);
  m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/); // 2 1/2
  if (m && Number(m[3]) > 0) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = s.match(/^(\d+)\/(\d+)$/); // 1/2
  if (m && Number(m[2]) > 0) return Number(m[1]) / Number(m[2]);
  return null;
}

function checkRange(inches: number): Parsed {
  if (!Number.isFinite(inches)) return fail('Not a number');
  if (inches < MIN_HEIGHT || inches > MAX_HEIGHT) {
    return fail(`${formatHeight(inches)} is outside the accepted range (5'0" to 7'6")`);
  }
  const warning = inches < 66 ? `${formatHeight(inches)} is unusually short for a prospect — check the value` : undefined;
  return warning ? { ok: true, value: inches, warning } : { ok: true, value: inches };
}

function feetInches(feet: number, inchStr: string, original: string): Parsed {
  const inches = parseInchPart(inchStr);
  if (inches === null) return fail(`Can't read the inches in "${original}"`);
  if (inches >= 12) return fail(`"${original}" has ${inches} inches — inches must be under 12`);
  return checkRange(feet * 12 + inches);
}

export function parseHeight(input: string | number | null | undefined): Parsed {
  if (input === null || input === undefined) return fail('Height is required');
  const original = String(input).trim();
  if (original === '') return fail('Height is required');
  // Normalise typographic quotes.
  const s = original.replace(/[’‘′`´]/g, "'").replace(/[“”″]/g, '"').replace(/''/g, '"').toLowerCase();

  // 6'3", 6' 3", 6'3, 6' 3 1/2", 6'
  let m = s.match(/^(\d)\s*'\s*([^'"]*?)\s*"?$/);
  if (m) return feetInches(Number(m[1]), m[2], original);

  // 6 ft 3 in, 6ft3, 6 feet 3 inches
  m = s.match(/^(\d)\s*(?:ft|feet|foot)\.?\s*(.*?)\s*(?:in|inch|inches|")?\.?$/);
  if (m) return feetInches(Number(m[1]), m[2], original);

  // 6-3, 6-3.5, 6-3 1/2  (one-digit feet then a hyphen)
  m = s.match(/^(\d)\s*-\s*(\d[\d./ ]*)$/);
  if (m) return feetInches(Number(m[1]), m[2], original);

  // 75, 75", 75 in, 75 inches, 74.5
  m = s.match(/^(\d+(?:\.\d+)?)\s*(?:"|in|in\.|inch|inches)?$/);
  if (m) {
    const digits = m[1];
    const n = Number(digits);
    const unit = s.slice(digits.length).trim();
    if (!unit) {
      if (/^\d$/.test(digits)) return fail(`"${original}" looks like feet only — enter feet and inches, e.g. 6'0"`);
      if (/^\d\.\d+$/.test(digits)) {
        return fail(`"${original}" is ambiguous (decimal feet, or ${digits.replace('.', "'")}"?) — use 6'3" or 75`);
      }
      if (/^[5-7][01]\d[0-8]$/.test(digits)) {
        return fail(`"${original}" looks like scouting notation — enter it as feet and inches, e.g. 6'2 5/8"`);
      }
    }
    return checkRange(n);
  }
  return fail(`Can't read height "${original}" — use 6'3", 6-3 or 75`);
}

export function parseWeight(input: string | number | null | undefined): Parsed {
  if (input === null || input === undefined) return fail('Weight is required');
  const original = String(input).trim();
  if (original === '') return fail('Weight is required');
  const m = original.toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(?:lb|lbs|lb\.|lbs\.|pounds?|#)?$/);
  if (!m) return fail(`Can't read weight "${original}" — use pounds, e.g. 215`);
  const n = Number(m[1]);
  if (n < MIN_WEIGHT || n > MAX_WEIGHT) return fail(`${n} lb is outside the accepted range (${MIN_WEIGHT}–${MAX_WEIGHT})`);
  return { ok: true, value: n };
}

const FRACTIONS: Record<string, string> = {
  '0.125': '⅛', '0.25': '¼', '0.375': '⅜', '0.5': '½', '0.625': '⅝', '0.75': '¾', '0.875': '⅞',
};

export function formatHeight(inches: number): string {
  if (!Number.isFinite(inches)) return '—';
  const feet = Math.floor(inches / 12);
  const rest = Math.round((inches - feet * 12) * 1000) / 1000;
  const whole = Math.floor(rest);
  const frac = Math.round((rest - whole) * 1000) / 1000;
  const fracStr = frac === 0 ? '' : FRACTIONS[String(frac)] ?? String(frac).slice(1);
  return `${feet}'${whole}${fracStr}"`;
}

export function formatNumber(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}
