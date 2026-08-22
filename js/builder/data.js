// Static tables for the matchup builder.
//
// Teams, colours and typefaces are NOT re-declared here — they come from
// js/data/teams.js, the same table the phone app renders from. The builder
// stores only what is specific to making graphics: entered scores, captions,
// logo art and the saved logo positions.
import { T, TEAM_FONTS, FONT_BY_KEY } from '../data/teams.js';
import { MAXW, MINW, scheduleForWeek } from '../data/schedule.js';

// canvas size — 16:9-ish, wide enough for two name plates and a stat column
export const W = 1370;
export const H = 770;

export const WEEKS = MAXW - MINW + 1;
export const GAMES_PER_WEEK = Object.keys(T).length / 2;

// week index (0-based) → label tag / background theme
export const WEEK_TAGS = { 4: 'Rivalry', 8: 'Halloween', 9: 'Rivalry', 12: 'Thanksgiving', 13: 'Christmas' };
export const WEEK_THEMES = { 8: 'halloween', 12: 'thanksgiving', 13: 'christmas' };
export const THEMES = ['auto', 'classic', 'halloween', 'thanksgiving', 'christmas'];

export const weekLabel = (i) => `Week ${i + 1}${WEEK_TAGS[i] ? ' · ' + WEEK_TAGS[i] : ''}`;

// The typeface list is the league's own — every face is embedded in css/fonts.css,
// so a graphic renders identically with no network. `ff` is quoted for CSS; canvas
// wants the bare family name.
export const FONTS = TEAM_FONTS;
export function fontFamily(key) {
  const f = FONT_BY_KEY[key] || FONT_BY_KEY.oswald;
  return f.ff.replace(/'/g, '');
}
export function fontWeight(key) {
  return (FONT_BY_KEY[key] || FONT_BY_KEY.oswald).w;
}
// Optical size correction: the same px size renders very differently across these
// faces, so scale the fitted size the way the app's team-name CSS does.
export function fontScale(key) {
  return (FONT_BY_KEY[key] || FONT_BY_KEY.oswald).sc;
}

// UI + furniture faces, also embedded
export const UI_FONT = 'Barlow';
export const LABEL_FONT = 'Oswald';
export const VALUE_FONT = 'Rubik Mono One';

// The league's round-robin, straight from the app so a graphic can never disagree
// with the schedule the app shows.
export function leagueSchedule() {
  const out = [];
  for (let w = MINW; w <= MAXW; w++) out.push(scheduleForWeek(w).map(([a, b]) => [a, b]));
  return out;
}

// fixed logo positions — same spot & size on every graphic unless re-saved
export const DEFAULT_SLOTS = {
  a: { x: 345, y: 240, box: 170 },
  b: { x: 1025, y: 240, box: 170 },
};

// staggered feature spots per side — front player first, then behind
export const PLAYER_SLOTS = [
  { x: 285, y: 480, box: 540 },
  { x: 115, y: 420, box: 430 },
  { x: 440, y: 400, box: 370 },
];

// layout constants for the graphic
export const PLATE = { y: 22, h: 74, leftX: 24, leftW: 500, rightX: 846, rightW: 500 };
export const COL = { x: 568, y: 186, w: 234, h: 562 };
export const LOGO = { cx: W / 2, cy: 96, maxW: 176, maxH: 158 };

// Last season's receipts — ready-made caption ammo, keyed by the app's team ids.
export const HISTORY_LINES = {
  dakyard: [
    '(Went 23-5 with an 18-game win streak last year and still has no ring)',
    '(Scored 153 in his only playoff game last season... with a bye)',
    '(Dropped 257.88 in Week 8 last year — highest score in league history)',
    '(Started 9-0 in matchups last season, then lost 4 of his last 5)',
  ],
  brady: [
    '(Reigning champ — won it all as the 4 seed)',
    '(Beat the 1, 5, and 3 seeds on the way to the title)',
    '(Lost his regular season finale last year and won the whole thing anyway)',
  ],
  radiator: [
    '(Earned the 2 seed last year, then scored 159 coming off a bye)',
    '(Won a 207.90-205.60 heartbreaker over the Pandas last season)',
    '(Best regular season of his life ended in one playoff game)',
  ],
  boutte: [
    '(Lost last year’s championship to the Brady Bunch)',
    '(Scored 85 and 96 in two of his last six games last year and still made the title game)',
    '(Runner-up last season — closest he’ll ever get)',
  ],
  pandas: [
    '(2nd most points in the league last year and still ended up the 5 seed)',
    '(Hung 247.60 on Barzal’s Balls in Rivalry Week — biggest beatdown in league history)',
    '(Lost by 2.3 last year in Week 13)',
    '(Drew the eventual champ in round 1 last season, classic)',
  ],
  burrow: [
    '(Started 0-5 last season before breaking the streak)',
    '(Snuck into the playoffs at 12-16)',
    '(Scored 172 in his lone playoff game last year and went home)',
  ],
  doghouse: [
    '(Missed last year’s playoffs on a 5-game losing streak)',
    '(The only team to beat Dakyard before Week 12 last season — Week 10, 199-161)',
    '(Finished last season losing 5 straight — momentum!)',
  ],
  barzal: [
    '(Lost 247-103 to the Pandas in Rivalry Week last year)',
    '(Got his revenge 203-129 in Rivalry Week round 2)',
    '(Missed the playoffs at 12-16 last season)',
  ],
  longhorns: [
    '(Went 9-19 last year without spending a single waiver dollar)',
    '(Scored 73.50 in Week 1 last year — lowest game in league history)',
    '(Owns two of the three lowest scores from last season)',
  ],
  saquon: [
    '(8-20 last season with $100 FAAB still in his pocket)',
    '(Scored 185 in Week 1 last year and spent the whole season chasing it)',
    '(Fewest wins in the league last year and somehow the least effort too)',
  ],
};

export const ord = (n) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);
