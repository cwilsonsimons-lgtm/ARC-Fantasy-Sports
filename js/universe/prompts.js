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
