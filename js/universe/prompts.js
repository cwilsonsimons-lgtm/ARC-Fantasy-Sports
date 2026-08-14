// WWE 2K Universe — prompt export.
//
// Three prompts for pasting into another AI, each with the current state already
// embedded so you never have to re-explain your universe:
//
//   recap        a show that happened — full card, results, what changed
//   contenders   before a PLE — standings, champions, hottest rivalries
//   next         what to book — the open threads queue
//
// They are plain text on purpose. Markdown tables and JSON both survive a copy
// worse than lines do, and every model reads a list of results fine.
//
// Everything here is a pure function of a projection, so a prompt generated with
// the header date set to last month describes the universe as it was then.

import { titleLineage, describeThread, activeRivalries, activeAlliances } from './project.js';
import { currentSeason, brandStandings } from './season.js';

const nm = (state, id) => (state.wrestlers[id] ? state.wrestlers[id].name
  : state.groups[id] ? state.groups[id].name
  : state.championships[id] ? state.championships[id].name : id);

const brand = (state, id) => (state.brands[id] ? state.brands[id].name : null);
const line = (...parts) => parts.filter(Boolean).join(' ');
const bullets = rows => rows.map(r => `- ${r}`).join('\n');

// A compact statement of who holds what — every prompt wants it.
function titleBlock(state) {
  return Object.values(state.championships).filter(c => !c.retired).map(c => {
    const who = c.vacant ? 'VACANT' : c.holders.map(x => nm(state, x)).join(' & ');
    const interim = c.interimHolders.length ? `, interim champion ${c.interimHolders.map(x => nm(state, x)).join(' & ')}` : '';
    return `- ${c.name} (${brand(state, c.brandId) || 'unbranded'}): ${who}`
      + (c.vacant ? '' : ` — ${c.daysHeld} days, ${c.defenses} defence${c.defenses === 1 ? '' : 's'}`) + interim;
  }).join('\n');
}

function rivalryBlock(state, limit = 8) {
  const rows = activeRivalries(state, limit);
  if (!rows.length) return 'None running hot right now.';
  return bullets(rows.map(r => `${nm(state, r.a)} vs ${nm(state, r.b)} — heat ${r.heat}, `
    + `${r.meetings} meeting${r.meetings === 1 ? '' : 's'}, last ${r.last} (${Object.keys(r.why).join(', ')})`));
}

// ------------------------------------------------------------------ format
//
// The rules that describe the entry shorthand. These sit here rather than in
// ingest.js because two different jobs need the same paragraph: "read this
// screenshot and write it like this" and "write me a card in this format".

export const CARD_RULES = `Answer in this shorthand, one segment per line, nothing else:

Show Name / YYYY-MM-DD / Brand
Winner d. Loser — stipulation, Championship Name
Partner & Partner d. Partner & Partner (tag)
A d. B, C — triple threat
A vs B (draw)
* Attacker attacks Victim after the match
* Saver saves Victim from Attacker
Speaker promo on Target
injury: Name (6 weeks, knee)
promise: Name — Championship Name
vacate: Championship Name

Rules:
- the first line is the show: name, date, brand, separated by "/"
- the winner always goes on the left of "d."
- "&" joins partners in one corner; "," separates opposing corners
- put the stipulation, the finish (pinfall, submission, dq, countout) and the
  championship after a dash or in brackets
- if a title changed hands, just name the belt — do not write "new champion",
  that is worked out from who won
- write "(retains)" only if the champion won but you want it stated
- use "vs" only when there was no winner, and give a finish like (draw) or (dq)
- lines starting with "*" are non-match segments
- never invent a wrestler who is not on the list below`;

export const ROSTER_RULES = `Answer as one wrestler per line, nothing else:

BRAND NAME
Wrestler Name, gender, status

Rules:
- put a brand on its own line, then everyone on it underneath
- list a brand's roster in FULL. The import treats your list as that brand's
  whole roster, so anybody you leave out comes off it. If you only know part of
  a brand, say so rather than guessing, and leave the brand out entirely
- gender is m or f
- status is one of: active, relegation, promotion, free agent, injured
- if no status is shown, write active
- put free agents under a "Free Agents" heading
- for tag teams or factions, add a section at the end:
  Tag Teams
  Team Name = Member One & Member Two
  Factions
  Faction Name = One & Two & Three`;

// Everything the model needs to write names the parser will recognise.
export function knownNames(state, limit = 260) {
  const names = Object.values(state.wrestlers).map(w => w.name).slice(0, limit);
  const belts = Object.values(state.championships).filter(c => !c.retired).map(c => c.name);
  const brands = Object.values(state.brands).map(b => b.name);
  return `Brands: ${brands.join(', ')}\n\n`
    + `Championships: ${belts.join(', ')}\n\n`
    + `Wrestlers (use these exact spellings):\n${names.join(', ')}`;
}

// The prompt that sits beside the paste boxes. It tells the model exactly what
// to produce, so whatever comes back can be pasted straight in.
export function entryPrompt(state, kind = 'card') {
  const isRoster = kind === 'roster';
  return `I am keeping a WWE 2K Universe mode save in a tool that reads a specific
plain-text format. I need you to give me ${isRoster ? 'a roster' : 'a show card'} in exactly that format.

${isRoster ? ROSTER_RULES : CARD_RULES}

${knownNames(state)}

${isRoster
    ? `If I give you a screenshot of a roster page, transcribe it. If I describe a
roster instead, write it out. Either way: only the lines, no preamble, no
explanation, no code fences, no markdown.`
    : `If I give you a screenshot of a results screen, transcribe it. If I describe
what happened on the show, write it out. If I ask you to book a card, invent it
using only the wrestlers listed above. Either way: only the lines, no preamble,
no explanation, no code fences, no markdown.

Today's universe date is ${state.asOf}.`}`;
}

// ------------------------------------------------------------------ recap

export function recapPrompt(state, showId) {
  const show = state.showsById[showId] || state.shows[state.shows.length - 1];
  if (!show) return 'No shows have been saved yet.';

  const changes = [];
  state.events.filter(e => e.showId === show.id).forEach(e => {
    (e.effects || []).forEach(fx => {
      if (fx.kind === 'title.award') changes.push(`${fx.holders.map(x => nm(state, x)).join(' & ')} won the ${nm(state, fx.titleId)}`);
      if (fx.kind === 'title.interim') changes.push(`${fx.holders.map(x => nm(state, x)).join(' & ')} became interim ${nm(state, fx.titleId)} champion`);
      if (fx.kind === 'title.unify') changes.push(`${fx.holders.map(x => nm(state, x)).join(' & ')} unified the ${nm(state, fx.titleId)}`);
      if (fx.kind === 'title.vacate') changes.push(`the ${nm(state, fx.titleId)} was ${fx.reason}`);
      if (fx.kind === 'roster.brand' && fx.reason === 'relegation') changes.push(`${nm(state, fx.subject)} was relegated to ${brand(state, fx.brandId)}`);
      if (fx.kind === 'roster.brand' && fx.reason === 'promotion') changes.push(`${nm(state, fx.subject)} was promoted to ${brand(state, fx.brandId)}`);
      if (fx.kind === 'injury.start') changes.push(`${nm(state, fx.subject)} was injured${fx.weeks ? ` (out ${fx.weeks} weeks)` : ''}`);
    });
  });

  return `You are writing a recap of a professional wrestling show for a fan site.

SHOW
${show.name} — ${show.date}${brand(state, show.brandId) ? ` — ${brand(state, show.brandId)} brand` : ''}

CARD, IN ORDER
${show.segments.map((s, i) => `${i + 1}. [${s.type}] ${s.text}`).join('\n')}

WHAT CHANGED
${changes.length ? bullets(changes) : '- No title or roster changes.'}

STANDING GOING IN
${titleBlock(state)}

LIVE RIVALRIES
${rivalryBlock(state, 6)}

TASK
Write a 400-600 word recap in the voice of a wrestling news site. Cover every
segment in card order, call the main event by name, and give the biggest moment
its own paragraph. Use only the results above — do not invent finishes, run-ins,
injuries or title changes that are not listed. Where a match has no stated
finish, describe the outcome without inventing how it ended.`;
}

// ------------------------------------------------------------------ contenders

export function contenderPrompt(state, { brandId = null, ple = 'the next premium live event' } = {}) {
  const season = currentSeason(state);
  const tables = brandStandings(state, season)
    .filter(b => (brandId ? b.id === brandId : true))
    .map(b => {
      const rows = b.table.filter(r => r.matches > 0).slice(0, 10);
      return `${b.name} (season ${season.n}, from ${season.from})\n`
        + (rows.length
          ? rows.map((r, i) => `  ${i + 1}. ${r.name} — ${r.w}-${r.l}-${r.d}, ${r.points} pts${r.titleMatches ? `, ${r.titleMatches} title matches` : ''}`).join('\n')
          : '  (nobody has wrestled yet this season)');
    }).join('\n\n');

  const owed = state.threads.filter(t => t.kind === 'title-shot')
    .map(t => `- ${t.subjects.map(x => nm(state, x)).join(' & ')} is owed a shot at the ${nm(state, t.about)} (${t.age} days)`);

  return `You are the booking committee for a professional wrestling promotion,
deciding the card for ${ple}.

CHAMPIONS
${titleBlock(state)}

SEASON STANDINGS
${tables}

RIVALRY HEAT — the hottest running stories
${rivalryBlock(state, 10)}

ALLIANCES
${activeAlliances(state, 6).map(r => `- ${nm(state, r.a)} & ${nm(state, r.b)} — strength ${r.heat}`).join('\n') || '- None.'}

TITLE SHOTS ALREADY OWED
${owed.length ? owed.join('\n') : '- None outstanding.'}

TASK
Recommend the card for ${ple}. For every title, name the challenger you would
book and justify it in two sentences using the standings and the rivalry heat
above. Flag any champion who has no credible challenger. Suggest one match that
pays off a rivalry with no title attached. Only use wrestlers who appear above.`;
}

// ------------------------------------------------------------------ next

export function nextPrompt(state, { limit = 12 } = {}) {
  const threads = state.threads.slice(0, limit).map(t => describeThread(state, t));
  const grouped = {};
  threads.forEach(t => { (grouped[t.kind] = grouped[t.kind] || []).push(t); });

  const block = Object.entries(grouped).map(([kind, rows]) =>
    `${kind.toUpperCase().replace('-', ' ')}\n` + rows.map(t => `- ${t.line} — open ${t.age} days (since ${t.opened})`).join('\n')
  ).join('\n\n');

  return `You are the head writer for a professional wrestling promotion. These
are the loose ends currently hanging in the storyline — questions the shows have
asked and not yet answered, oldest first.

OPEN THREADS
${block || '- Nothing is hanging. Every question has been answered.'}

WHO HOLDS WHAT
${titleBlock(state)}

RIVALRY HEAT
${rivalryBlock(state, 8)}

TASK
For each open thread, propose the next beat: what happens on the next show to
move it forward, and what it is building to. Say which threads should be paid
off soon and which should be left to breathe. If two threads should be merged
into one story, say so. Keep each answer to three sentences. Do not introduce
wrestlers who do not appear above.`;
}

// ------------------------------------------------------------------ registry

export const PROMPTS = [
  {
    id: 'card-format', label: 'Write me a card',
    blurb: 'The card format, the roster and the belts — for an AI to fill in.',
    needs: null,
    build: state => entryPrompt(state, 'card'),
  },
  {
    id: 'roster-format', label: 'Write me a roster',
    blurb: 'The roster format with every brand and name the parser knows.',
    needs: null,
    build: state => entryPrompt(state, 'roster'),
  },
  {
    id: 'recap', label: 'Show recap',
    blurb: 'The full card and results of a show, ready to be written up.',
    needs: 'show',
    build: (state, opts) => recapPrompt(state, opts.showId),
  },
  {
    id: 'contenders', label: 'Contender report',
    blurb: 'Standings, champions and rivalry heat, for booking the next PLE.',
    needs: 'ple',
    build: (state, opts) => contenderPrompt(state, opts),
  },
  {
    id: 'next', label: 'What happens next',
    blurb: 'Every open thread, oldest first, with what it is waiting on.',
    needs: null,
    build: (state, opts) => nextPrompt(state, opts),
  },
];

export const buildPrompt = (id, state, opts = {}) => {
  const p = PROMPTS.find(x => x.id === id);
  return p ? p.build(state, opts) : '';
};

export { titleBlock, rivalryBlock, line };
