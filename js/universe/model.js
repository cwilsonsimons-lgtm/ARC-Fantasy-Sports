// WWE Universe — the data model.
//
// A companion to WWE 2K25's Universe Mode. The game decides every result; this
// records what happened afterwards. So nothing in here picks a winner, books a
// match, ranks anyone or moves a wrestler on its own - it only stores what the
// owner tells it, keeps it consistent, and remembers when it happened.
//
// Pure on purpose: no DOM, no storage, no clock, no randomness. Every function
// takes the universe object and reads it or changes it in place, so the whole
// model runs under Node for tests exactly as it does in the page.
//
// A function that changes the universe checks all of its inputs before it
// touches anything, and throws a UniverseError with a sentence meant for the
// owner when something is wrong. A failed call leaves the universe as it was.
//
// Time is recorded as a stamp - { season, week, seq }. `season` and `week` are
// the universe's own calendar; `seq` is a counter that only goes up, so any two
// things that happened can be put in order even inside the same week.
//
// History is never rewritten by an ordinary change. Moving a wrestler adds a
// roster move; changing a team's line-up adds or closes a membership; a new
// champion adds a reign. Past results name the wrestlers who were actually in
// them, so none of that touches them. The correction tools further down -
// undo, edit a result, edit a reign, merge a duplicate - each fix one record
// and refuse when the fix would disturb anything else.

export const APP_ID = 'wwe-universe';
export const SCHEMA_VERSION = 3;

export class UniverseError extends Error {
  constructor(message) { super(message); this.name = 'UniverseError'; }
}
function fail(message) { throw new UniverseError(message); }

// The four shows, each with its regular night (0 = Monday ... 6 = Sunday).
// Roster sizes are whatever the owner makes them - nothing here caps a show
// or expects them to match.
export const SHOW_SEED = [
  { id: 'raw',       name: 'Raw',       promotion: 'WWE', color: '#E23B2E', day: 0 },
  { id: 'smackdown', name: 'SmackDown', promotion: 'WWE', color: '#2F6BFF', day: 4 },
  { id: 'dynamite',  name: 'Dynamite',  promotion: 'AEW', color: '#D8A93B', day: 2 },
  { id: 'nxt',       name: 'NXT',       promotion: 'WWE', color: '#C4CAD3', day: 1 },
];
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const PLE_DAY = 5;                                     // premium live events default to Saturday

export const GENDERS     = ['male', 'female'];
export const ORIGINS     = ['WWE', 'AEW', 'NXT', 'Other'];   // where a wrestler comes from, not where they are
export const ALIGNMENTS  = ['face', 'heel', 'tweener'];
export const STATUSES    = ['active', 'injured'];
export const TITLE_KINDS = ['singles', 'tag'];
export const DIVISIONS   = ['men', 'women', 'open'];
export const EVENT_KINDS = ['weekly', 'ple'];                 // a weekly episode, or a premium live event
export const OUTCOMES    = ['win', 'draw', 'nc'];             // nc = no contest
export const FINISHES    = ['pinfall', 'submission', 'ko', 'dq', 'countout', 'elimination', 'escape', 'retrieval', 'other'];
export const MATCH_STATUSES = ['scheduled', 'played'];        // on the card, or result entered

const MAX_NAME = 60;
const MAX_TEXT = 2000;
const MAX_WEEK = 999;
const MAX_SIDES = 40;       // a battle royal or Rumble can put everyone on their own side

// ---------------------------------------------------------------- create

export function createUniverse() {
  const st = {
    app: APP_ID,
    version: SCHEMA_VERSION,
    nextId: 1,              // every record id ends in this counter, so ids never repeat
    seq: 0,                 // the ordering clock behind every stamp
    shows: SHOW_SEED.map(s => ({ ...s })),
    wrestlers: [],
    moves: [],              // roster assignment history, one row per change of show
    teams: [],
    memberships: [],        // team line-up history, one row per spell a wrestler spent on a team
    titles: [],
    reigns: [],             // title history; the open reign (end === null) is the champion
    seasons: [],
    events: [],             // shows and PLEs, each holding its match results
  };
  openSeason(st, 1, '');
  return st;
}

// ---------------------------------------------------------------- lookups

const byId = (list, id) => (id == null || id === '' ? null : list.find(x => x.id === id) || null);
export const showById     = (st, id) => byId(st.shows, id);
export const wrestlerById = (st, id) => byId(st.wrestlers, id);
export const teamById     = (st, id) => byId(st.teams, id);
export const titleById    = (st, id) => byId(st.titles, id);
export const eventById    = (st, id) => byId(st.events, id);
export const seasonById   = (st, id) => byId(st.seasons, id);

function must(found, what, id) {
  if (!found) fail(`No ${what} with id "${id}".`);
  return found;
}
function removeWhere(list, pred) {
  for (let i = list.length - 1; i >= 0; i--) if (pred(list[i])) list.splice(i, 1);
}
function newId(st, prefix) { return prefix + st.nextId++; }

export function activeSeason(st) {
  return st.seasons.find(s => s.status === 'active') || null;
}
// A stamp is { season, week, seq } plus `day` (0-6) when it happened on a
// particular night - anything dated by a show. Changes made outside a show
// (a move, a line-up change, a title awarded) belong to the week as a whole.
function stampAt(st, seasonId, week, day) {
  const s = { season: seasonId, week, seq: ++st.seq };
  if (day != null) s.day = day;
  return s;
}
const seasonNo = (st, id) => (seasonById(st, id) || { number: 0 }).number;
// Two dates by the universe's calendar: season, then week, then - when both
// know it - the night. Negative, zero or positive.
function cmpDate(st, a, b) {
  return seasonNo(st, a.season) - seasonNo(st, b.season) || a.week - b.week
    || (a.day != null && b.day != null ? a.day - b.day : 0);
}
/**
 * Order two stamps by the universe's calendar - season, week, night - and only
 * then by the order they were entered. Entry order alone is wrong as soon as a
 * show is backfilled: Monday's Raw entered after Friday's SmackDown still
 * happened first.
 */
export function compareStamps(st, a, b) {
  return cmpDate(st, a, b) || a.seq - b.seq;
}
// true when `a` falls on an earlier date than `b` (the same date is not earlier)
const earlierDate = (st, a, b) => cmpDate(st, a, b) < 0;
const weekLabel = (st, s) => `season ${seasonNo(st, s.season)}, week ${s.week}${s.day != null ? ` (${DAYS[s.day]})` : ''}`;
function now(st) {
  const s = activeSeason(st);
  return stampAt(st, s.id, s.week);
}
// The { season, week } a change is dated to: a given week of the active
// season, or its current week. Turned into a stamp only once every check passes.
function dateIn(st, week) {
  const s = activeSeason(st);
  return { season: s.id, week: week == null || week === '' ? s.week : checkWeek(week) };
}
const stampFor = (st, date) => stampAt(st, date.season, date.week);
const nowDate = st => ({ season: activeSeason(st).id, week: activeSeason(st).week });
// The real calendar date of a week and night, as 'YYYY-MM-DD' - or null when
// the season has no start date. A season's start is any day of its week 1;
// the week runs Monday to Sunday.
export function calendarDate(st, seasonId, week, day) {
  const s = seasonById(st, seasonId);
  if (!s || !s.start || day == null) return null;
  const [y, m, d] = s.start.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d);
  const monday = start - ((new Date(start).getUTCDay() + 6) % 7) * 864e5;
  return new Date(monday + ((week - 1) * 7 + day) * 864e5).toISOString().slice(0, 10);
}
// true when stamp/date `x` falls inside the span [from, to) - `to` null means still open
const within = (st, x, from, to) => compareStamps(st, from, x) <= 0 && (!to || compareStamps(st, x, to) < 0);

/**
 * Whole weeks from one date to another, counting across season breaks: a
 * season's last week runs straight into week 1 of the next.
 */
export function weeksBetween(st, a, b) {
  const sa = seasonById(st, a.season), sb = seasonById(st, b.season);
  if (!sa || !sb || sa.number > sb.number) return 0;
  if (sa.id === sb.id) return Math.max(0, b.week - a.week);
  const lastWeek = s => (s.ended ? s.ended.week : s.week);
  let n = lastWeek(sa) - a.week;
  st.seasons.filter(s => s.number > sa.number && s.number < sb.number).forEach(s => { n += lastWeek(s); });
  return Math.max(0, n + b.week);
}

// ---------------------------------------------------------------- field checks

export function cleanName(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
const nameKey = v => cleanName(v).toLowerCase();

function checkName(list, value, what, selfId) {
  const name = cleanName(value);
  if (!name) fail(`Give the ${what} a name.`);
  if (name.length > MAX_NAME) fail(`That name is too long (${MAX_NAME} characters max).`);
  const clash = list.find(x => x.id !== selfId && nameKey(x.name) === name.toLowerCase());
  if (clash) fail(`There is already a ${what} called ${clash.name}.`);
  return name;
}
function checkText(value, what) {
  const s = String(value == null ? '' : value).trim();
  if (s.length > MAX_TEXT) fail(`${what} is too long (${MAX_TEXT} characters max).`);
  return s;
}
function oneOf(value, allowed, what) {
  if (!allowed.includes(value)) fail(`Unknown ${what}: ${value}.`);
  return value;
}
function checkShowId(st, id) {
  if (id == null || id === '') return null;
  if (!showById(st, id)) fail(`Unknown show: ${id}.`);
  return id;
}
function checkNote(value) {
  const n = cleanName(value);
  if (n.length > MAX_NAME) fail(`That note is too long (${MAX_NAME} characters max).`);
  return n;
}
function checkDay(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 6) fail('Pick a night of the week.');
  return n;
}
const isIsoDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
function checkWeek(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_WEEK) fail(`Week must be a whole number from 1 to ${MAX_WEEK}.`);
  return n;
}
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ---------------------------------------------------------------- wrestlers

const WRESTLER_DEFAULTS = { gender: 'male', origin: 'WWE', alignment: null, status: 'active', notes: '' };

function wrestlerFields(st, input, self) {
  const base = self || WRESTLER_DEFAULTS;
  const alignment = v => (v == null || v === '' ? null : oneOf(v, ALIGNMENTS, 'alignment'));
  return {
    name:      has(input, 'name') || !self ? checkName(st.wrestlers, input.name, 'wrestler', self && self.id) : self.name,
    gender:    has(input, 'gender')    ? oneOf(input.gender, GENDERS, 'gender')    : base.gender,
    origin:    has(input, 'origin')    ? oneOf(input.origin, ORIGINS, 'origin')    : base.origin,
    alignment: has(input, 'alignment') ? alignment(input.alignment)                : base.alignment,
    status:    has(input, 'status')    ? oneOf(input.status, STATUSES, 'status')    : base.status,
    notes:     has(input, 'notes')     ? checkText(input.notes, 'Notes')            : base.notes,
  };
}

/** Add one wrestler. `showId` assigns them straight away (and records it). */
export function addWrestler(st, input = {}) {
  const fields = wrestlerFields(st, input, null);
  const showId = checkShowId(st, input.showId);
  const w = { id: newId(st, 'w'), ...fields, showId: null };
  st.wrestlers.push(w);
  if (showId) recordMove(st, w, showId, '', nowDate(st));
  return w;
}

/**
 * Add many wrestlers from a list of names, sharing the same defaults. Names
 * that can't be added - blank, too long, already taken - are skipped and
 * reported rather than failing the batch.
 */
export function addWrestlers(st, names, defaults = {}) {
  // Check the shared fields once, so a bad default fails the whole call rather
  // than quietly skipping every name for the same reason.
  const { name: _ignored, ...shared } = defaults;
  wrestlerFields(st, shared, { ...WRESTLER_DEFAULTS, id: null, name: '' });
  checkShowId(st, defaults.showId);

  const added = [], skipped = [];
  for (const raw of names || []) {
    const name = cleanName(raw);
    if (!name) continue;
    try {
      added.push(addWrestler(st, { ...defaults, name }));
    } catch (e) {
      if (!(e instanceof UniverseError)) throw e;
      skipped.push({ name, reason: e.message });
    }
  }
  return { added, skipped };
}

/** Edit a wrestler's details. Show changes go through assignWrestler. */
export function updateWrestler(st, id, patch = {}) {
  const w = must(wrestlerById(st, id), 'wrestler', id);
  if (has(patch, 'showId')) fail('Change shows with assignWrestler, so the move is kept in the history.');
  Object.assign(w, wrestlerFields(st, patch, w));
  return w;
}

function recordMove(st, w, to, note, date) {
  const move = { id: newId(st, 'mv'), wrestler: w.id, from: w.showId, to, at: stampFor(st, date || nowDate(st)), note };
  st.moves.push(move);
  w.showId = to;
  return move;
}

// A wrestler's show history is one line, so each move has to be dated on or
// after the one before it. Returns the wrestler, or null if they're already there.
function moveChecks(st, id, to, date) {
  const w = must(wrestlerById(st, id), 'wrestler', id);
  if (w.showId === to) return null;
  const moves = movesOf(st, id);
  const last = moves[moves.length - 1];
  if (last && earlierDate(st, date, last.at)) {
    fail(`${w.name}'s last move was in ${weekLabel(st, last.at)}, later than ${weekLabel(st, date)}. Moves have to be recorded in order.`);
  }
  return w;
}

/**
 * Put a wrestler on a show, or pass null / '' to leave them unassigned. The
 * move is kept in their history; nothing they've already done changes, since
 * results name the wrestler, not the show they were on. `opts.week` backdates
 * the move within the current season. Returns the move, or null when they
 * were already there.
 */
export function assignWrestler(st, id, showId, note = '', opts = {}) {
  const to = checkShowId(st, showId);
  const n = checkNote(note);
  const date = dateIn(st, opts.week);
  const w = moveChecks(st, id, to, date);
  return w ? recordMove(st, w, to, n, date) : null;
}

/** Move several wrestlers at once - all of them, or none if any can't go. */
export function assignWrestlers(st, ids, showId, note = '', opts = {}) {
  const to = checkShowId(st, showId);
  const n = checkNote(note);
  const date = dateIn(st, opts.week);
  if (!Array.isArray(ids) || !ids.length) fail('Pick at least one wrestler to move.');
  if (new Set(ids).size !== ids.length) fail('The same wrestler is picked twice.');
  const going = ids.map(id => moveChecks(st, id, to, date)).filter(Boolean);
  return going.map(w => recordMove(st, w, to, n, date));
}

/** Take back a wrestler's most recent move - the fix for a move made by mistake. */
export function undoLastMove(st, id) {
  const w = must(wrestlerById(st, id), 'wrestler', id);
  const moves = movesOf(st, id);
  const last = moves[moves.length - 1];
  if (!last) fail(`${w.name} has no roster moves to undo.`);
  removeWhere(st.moves, m => m.id === last.id);
  w.showId = last.from;
  return last;
}

/** What stops a wrestler from being deleted - empty when nothing does. */
export function wrestlerRefs(st, id) {
  const refs = [];
  const teams = teamsEver(st, id).length;
  if (teams) refs.push(teams === 1 ? 'a tag team' : `${teams} tag teams`);
  const reigns = st.reigns.filter(r => r.holder.type === 'wrestler' && r.holder.id === id).length;
  if (reigns) refs.push(reigns === 1 ? 'a title reign' : `${reigns} title reigns`);
  const matches = matchesOf(st, id).length;
  if (matches) refs.push(matches === 1 ? 'a match' : `${matches} matches`);
  const booked = bookingsOf(st, id).length;
  if (booked) refs.push(booked === 1 ? 'a booked match' : `${booked} booked matches`);
  return refs;
}

/**
 * Delete a wrestler who was added by mistake. Anyone with history - a team, a
 * title reign, a match - is kept, because deleting them would rewrite the past;
 * leave them unassigned instead.
 */
export function deleteWrestler(st, id) {
  const w = must(wrestlerById(st, id), 'wrestler', id);
  const refs = wrestlerRefs(st, id);
  if (refs.length) fail(`${w.name} is part of the history (${refs.join(', ')}), so they can't be deleted. Leave them unassigned instead.`);
  removeWhere(st.wrestlers, x => x.id === id);
  removeWhere(st.moves, m => m.wrestler === id);
}

export function rosterOf(st, showId) {
  const key = showId || null;
  return st.wrestlers.filter(w => w.showId === key).sort(byName);
}
/** Head count per show id, plus '' for unassigned. Sizes are allowed to differ. */
export function rosterCounts(st) {
  const out = { '': 0 };
  st.shows.forEach(s => { out[s.id] = 0; });
  st.wrestlers.forEach(w => { out[w.showId || ''] = (out[w.showId || ''] || 0) + 1; });
  return out;
}
export function movesOf(st, wrestlerId) {
  return st.moves.filter(m => m.wrestler === wrestlerId).sort((a, b) => a.at.seq - b.at.seq);
}
export function byName(a, b) { return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }); }

// ---------------------------------------------------------------- tag teams
//
// A team's current line-up is `members`; how it got there is kept in
// `memberships`, one row per spell a wrestler spent on the team -
// { team, wrestler, start, end }. `log` records the team itself forming,
// disbanding and reuniting. A team's record comes only from matches it
// wrestled as the team, never from its members' own matches.

export const TEAM_EVENTS = ['formed', 'disbanded', 'reunited'];
export const teamFormed = t => t.log[0].at;

function checkMembers(st, members) {
  const ids = (members || []).filter(x => x != null && x !== '');
  ids.forEach(m => must(wrestlerById(st, m), 'wrestler', m));
  if (new Set(ids).size !== ids.length) fail('A wrestler can only be on a team once.');
  if (ids.length < 2) fail('A tag team needs at least two wrestlers.');
  return ids;
}

/** A team of two or more. A wrestler may be on several teams at once. */
export function addTeam(st, input = {}) {
  const name = checkName(st.teams, input.name, 'tag team', null);
  const ids = checkMembers(st, input.members);
  const at = stampFor(st, dateIn(st, input.week));
  const team = { id: newId(st, 'tm'), name, members: [...ids], active: true, log: [{ type: 'formed', at }] };
  st.teams.push(team);
  ids.forEach(w => st.memberships.push({ id: newId(st, 'ms'), team: team.id, wrestler: w, start: { ...at }, end: null }));
  return team;
}

/** Rename a team. Line-up changes go through add/removeTeamMember so they're dated. */
export function updateTeam(st, id, patch = {}) {
  const t = must(teamById(st, id), 'tag team', id);
  if (has(patch, 'members')) fail('Change the line-up with addTeamMember and removeTeamMember, so it stays in the history.');
  if (has(patch, 'name')) t.name = checkName(st.teams, patch.name, 'tag team', id);
  return t;
}

export function membershipsOf(st, teamId) {
  return st.memberships.filter(m => m.team === teamId).sort((a, b) => a.start.seq - b.start.seq);
}
const openSpell = (st, teamId, wrestlerId) =>
  st.memberships.find(m => m.team === teamId && m.wrestler === wrestlerId && m.end === null) || null;

/** Add a wrestler to a team's line-up, from `opts.week` (default: this week). */
export function addTeamMember(st, teamId, wrestlerId, opts = {}) {
  const t = must(teamById(st, teamId), 'tag team', teamId);
  const w = must(wrestlerById(st, wrestlerId), 'wrestler', wrestlerId);
  if (t.members.includes(wrestlerId)) fail(`${w.name} is already on ${t.name}.`);
  const date = dateIn(st, opts.week);
  if (earlierDate(st, date, teamFormed(t))) fail(`${t.name} formed in ${weekLabel(st, teamFormed(t))}, after ${weekLabel(st, date)}.`);
  const before = st.memberships.filter(m => m.team === teamId && m.wrestler === wrestlerId && m.end);
  const lastLeft = before.sort((a, b) => b.end.seq - a.end.seq)[0];
  if (lastLeft && earlierDate(st, date, lastLeft.end)) fail(`${w.name} left ${t.name} in ${weekLabel(st, lastLeft.end)}, after ${weekLabel(st, date)}.`);
  const spell = { id: newId(st, 'ms'), team: teamId, wrestler: wrestlerId, start: stampFor(st, date), end: null };
  st.memberships.push(spell);
  t.members.push(wrestlerId);
  return spell;
}

/** Take a wrestler off a team's line-up. Their past matches with the team stay theirs. */
export function removeTeamMember(st, teamId, wrestlerId, opts = {}) {
  const t = must(teamById(st, teamId), 'tag team', teamId);
  const w = must(wrestlerById(st, wrestlerId), 'wrestler', wrestlerId);
  if (!t.members.includes(wrestlerId)) fail(`${w.name} isn't on ${t.name}.`);
  if (t.members.length <= 2) fail(`${t.name} need at least two members. Add the new partner first, or disband the team.`);
  const spell = openSpell(st, teamId, wrestlerId);
  const date = dateIn(st, opts.week);
  if (earlierDate(st, date, spell.start)) fail(`${w.name} joined ${t.name} in ${weekLabel(st, spell.start)}, after ${weekLabel(st, date)}.`);
  spell.end = stampFor(st, date);
  removeWhere(t.members, x => x === wrestlerId);
  return spell;
}

/** Disband (false) or reunite (true). A team holding a title can't disband. */
export function setTeamActive(st, id, active) {
  const t = must(teamById(st, id), 'tag team', id);
  if (!!active === t.active) return t;
  if (!active) {
    const held = titlesHeldBy(st, { type: 'team', id });
    if (held.length) fail(`${t.name} hold the ${held[0].name}. Vacate it or crown new champions first.`);
  }
  t.active = !!active;
  t.log.push({ type: active ? 'reunited' : 'disbanded', at: now(st) });
  return t;
}

/**
 * A team's most recent change - { kind, seq, at, entry | m }, kind being
 * 'disbanded', 'reunited', 'joined' or 'left' - or null if it hasn't changed
 * since it formed. What undoTeamChange would take back.
 */
export function lastTeamChange(st, id) {
  const t = must(teamById(st, id), 'tag team', id);
  const formedSeq = teamFormed(t).seq;
  const changes = [];
  t.log.slice(1).forEach(entry => changes.push({ kind: entry.type, seq: entry.at.seq, at: entry.at, entry }));
  membershipsOf(st, id).forEach(m => {
    if (m.start.seq !== formedSeq) changes.push({ kind: 'joined', seq: m.start.seq, at: m.start, m });
    if (m.end) changes.push({ kind: 'left', seq: m.end.seq, at: m.end, m });
  });
  return changes.sort((a, b) => b.seq - a.seq)[0] || null;
}

/**
 * Take back a team's most recent change - a member joining or leaving, or
 * the team disbanding or reuniting - without touching anything before it.
 */
export function undoTeamChange(st, id) {
  const t = must(teamById(st, id), 'tag team', id);
  const last = lastTeamChange(st, id);
  if (!last) fail(`${t.name} haven't changed since they formed. If the team itself was a mistake, delete it.`);
  if (last.kind === 'disbanded') {
    t.active = true;
  } else if (last.kind === 'reunited') {
    const held = titlesHeldBy(st, { type: 'team', id });
    if (held.length) fail(`${t.name} hold the ${held[0].name} since reuniting, so they can't go back to being disbanded.`);
    t.active = false;
  } else if (last.kind === 'joined') {
    const w = wrestlerById(st, last.m.wrestler);
    if (t.members.length <= 2) fail(`${t.name} need at least two members, so ${w.name} joining can't be undone. Disband the team instead.`);
    const otherSpells = st.memberships.some(m => m !== last.m && m.team === id && m.wrestler === w.id);
    let used = null;
    eachMatch(st, (m, ev) => { if (!used && m.sides.some(sd => sd.team === id && sd.wrestlers.includes(w.id))) used = { m, ev }; });
    if (used && !otherSpells) {
      fail(`${w.name} ${used.m.status === 'played' ? 'wrestled' : 'is booked'} for ${t.name} at ${used.ev.name}. Edit that match first.`);
    }
    removeWhere(st.memberships, m => m === last.m);
    removeWhere(t.members, x => x === w.id);
    return last;
  } else {                                                 // left: put them back
    last.m.end = null;
    t.members.push(last.m.wrestler);
    return last;
  }
  removeWhere(t.log, e => e === last.entry);
  return last;
}

export function teamRefs(st, id) {
  const refs = [];
  const reigns = st.reigns.filter(r => r.holder.type === 'team' && r.holder.id === id).length;
  if (reigns) refs.push(reigns === 1 ? 'a title reign' : `${reigns} title reigns`);
  let matches = 0;
  eachMatch(st, (m) => { if (m.sides.some(s => s.team === id)) matches++; });
  if (matches) refs.push(matches === 1 ? 'a match' : `${matches} matches`);
  return refs;
}

export function deleteTeam(st, id) {
  const t = must(teamById(st, id), 'tag team', id);
  const refs = teamRefs(st, id);
  if (refs.length) fail(`${t.name} are part of the history (${refs.join(', ')}), so they can't be deleted. Disband them instead.`);
  removeWhere(st.teams, x => x.id === id);
  removeWhere(st.memberships, m => m.team === id);
}

/** Teams a wrestler is on right now. */
export function teamsOf(st, wrestlerId) {
  return st.teams.filter(t => t.members.includes(wrestlerId));
}
/** Every team a wrestler has ever been on. */
export function teamsEver(st, wrestlerId) {
  const ids = new Set(st.memberships.filter(m => m.wrestler === wrestlerId).map(m => m.team));
  return st.teams.filter(t => ids.has(t.id));
}
/** The shows a team's members are on. More than one means the team is split. */
export function teamShows(st, team) {
  return [...new Set(team.members.map(id => (wrestlerById(st, id) || {}).showId || null))];
}
/** Was the wrestler on the team at that moment? */
export function memberAt(st, teamId, wrestlerId, stamp) {
  return st.memberships.some(m => m.team === teamId && m.wrestler === wrestlerId && within(st, stamp, m.start, m.end));
}

/**
 * A team's own history, newest first: forming, disbanding and reuniting,
 * members joining and leaving, and titles won, lost and vacated.
 * Each entry: { type, seq, season, week, ... }.
 */
export function teamHistoryOf(st, teamId) {
  const t = must(teamById(st, teamId), 'tag team', teamId);
  const out = [];
  const at = (stamp, type, extra) => out.push({ type, seq: stamp.seq, season: stamp.season, week: stamp.week, ...extra });
  t.log.forEach(e => at(e.at, `team-${e.type}`, {}));
  membershipsOf(st, teamId).forEach(m => {
    const wrestler = wrestlerById(st, m.wrestler);
    if (m.start.seq !== teamFormed(t).seq) at(m.start, 'member-joined', { wrestler });
    if (m.end) at(m.end, 'member-left', { wrestler });
  });
  st.reigns.filter(r => r.holder.type === 'team' && r.holder.id === teamId).forEach(reign => {
    const title = titleById(st, reign.titleId);
    at(reign.start, 'title-won', { reign, title });
    if (reign.end) at(reign.end, reign.vacated ? 'title-vacated' : 'title-lost', { reign, title });
  });
  return out.sort((a, b) => compareStamps(st, b, a));
}

/** Partners in tag matches that weren't as a registered team: [{ wrestler, count }], most frequent first. */
export function tagPartnersOf(st, wrestlerId) {
  const count = new Map();
  matchesOf(st, wrestlerId).forEach(({ match, side }) => {
    const s = match.sides[side];
    if (s.team || s.wrestlers.length < 2) return;
    s.wrestlers.forEach(id => { if (id !== wrestlerId) count.set(id, (count.get(id) || 0) + 1); });
  });
  return [...count].map(([id, n]) => ({ wrestler: wrestlerById(st, id), count: n }))
    .sort((a, b) => b.count - a.count || byName(a.wrestler, b.wrestler));
}

/**
 * Everyone a wrestler has teamed with, team by team: [{ team, current, spells,
 * partners }]. Partners are the wrestlers whose time on the team overlapped
 * theirs - so a former team lists who they actually teamed with.
 */
export function teammatesOf(st, wrestlerId) {
  return teamsEver(st, wrestlerId).map(team => {
    const spells = st.memberships.filter(m => m.team === team.id && m.wrestler === wrestlerId);
    const overlaps = o => spells.some(s => (!o.end || compareStamps(st, s.start, o.end) < 0)
      && (!s.end || compareStamps(st, o.start, s.end) < 0));
    const partners = [...new Set(st.memberships
      .filter(o => o.team === team.id && o.wrestler !== wrestlerId && overlaps(o)).map(o => o.wrestler))]
      .map(id => wrestlerById(st, id)).filter(Boolean);
    return { team, current: team.members.includes(wrestlerId), spells, partners };
  });
}

// ---------------------------------------------------------------- championships

function titleFields(st, input, self) {
  const base = self || { showId: null, kind: 'singles', division: 'open' };
  return {
    name:     has(input, 'name') || !self ? checkName(st.titles, input.name, 'championship', self && self.id) : self.name,
    showId:   has(input, 'showId')   ? checkShowId(st, input.showId)                    : base.showId,
    kind:     has(input, 'kind')     ? oneOf(input.kind, TITLE_KINDS, 'title type')     : base.kind,
    division: has(input, 'division') ? oneOf(input.division, DIVISIONS, 'division')     : base.division,
  };
}

/** A championship. `showId` null means it isn't exclusive to one show. */
export function addTitle(st, input = {}) {
  const fields = titleFields(st, input, null);
  const title = { id: newId(st, 'ch'), ...fields, active: true };
  st.titles.push(title);
  return title;
}

export function updateTitle(st, id, patch = {}) {
  const t = must(titleById(st, id), 'championship', id);
  const fields = titleFields(st, patch, t);
  if (fields.kind !== t.kind && st.reigns.some(r => r.titleId === id)) {
    fail(`${t.name} already has a title history, so it can't switch between singles and tag.`);
  }
  let active = t.active;
  if (has(patch, 'active')) {
    active = !!patch.active;
    if (!active && currentReign(st, id)) fail(`Vacate the ${t.name} before retiring it.`);
  }
  Object.assign(t, fields, { active });
  return t;
}

export function titleRefs(st, id) {
  const refs = [];
  const reigns = st.reigns.filter(r => r.titleId === id).length;
  if (reigns) refs.push(reigns === 1 ? 'a reign' : `${reigns} reigns`);
  let matches = 0;
  eachMatch(st, m => { if (m.titleId === id) matches++; });
  if (matches) refs.push(matches === 1 ? 'a title match' : `${matches} title matches`);
  return refs;
}

export function deleteTitle(st, id) {
  const t = must(titleById(st, id), 'championship', id);
  const refs = titleRefs(st, id);
  if (refs.length) fail(`The ${t.name} has history (${refs.join(', ')}), so it can't be deleted. Retire it instead.`);
  removeWhere(st.titles, x => x.id === id);
}

export function titleReigns(st, titleId) {
  return st.reigns.filter(r => r.titleId === titleId).sort((a, b) => a.start.seq - b.start.seq);
}
export function currentReign(st, titleId) {
  return st.reigns.find(r => r.titleId === titleId && r.end === null) || null;
}
const sameHolder = (a, b) => !!a && !!b && a.type === b.type && a.id === b.id;

/** Titles held right now by exactly this holder ({ type, id }). */
export function titlesHeldBy(st, holder) {
  return st.reigns.filter(r => r.end === null && sameHolder(r.holder, holder))
    .map(r => titleById(st, r.titleId));
}
/** Titles a wrestler holds, directly or through a team: [{ title, team }]. */
export function titlesOfWrestler(st, wrestlerId) {
  const out = titlesHeldBy(st, { type: 'wrestler', id: wrestlerId }).map(title => ({ title, team: null }));
  teamsOf(st, wrestlerId).forEach(team =>
    titlesHeldBy(st, { type: 'team', id: team.id }).forEach(title => out.push({ title, team })));
  return out;
}

// `pastOk` allows a team that has since disbanded - for correcting a reign in
// the past, not for crowning anyone today.
function checkHolder(st, title, holder, pastOk = false) {
  if (!holder || !holder.id) fail('Pick who holds the title.');
  if (title.kind === 'tag') {
    if (holder.type !== 'team') fail(`The ${title.name} is a tag title, so a tag team has to hold it.`);
    const team = must(teamById(st, holder.id), 'tag team', holder.id);
    if (!team.active && !pastOk) fail(`${team.name} have disbanded.`);
  } else {
    if (holder.type !== 'wrestler') fail(`The ${title.name} is a singles title, so one wrestler has to hold it.`);
    must(wrestlerById(st, holder.id), 'wrestler', holder.id);
  }
  return { type: holder.type, id: holder.id };
}

// Everything setChampion checks, without changing anything. `when` is the
// { season, week } the change would be dated to.
function champChecks(st, titleId, holder, when) {
  const title = must(titleById(st, titleId), 'championship', titleId);
  if (!title.active) fail(`The ${title.name} is retired.`);
  const h = checkHolder(st, title, holder);
  const cur = currentReign(st, titleId);
  if (cur && sameHolder(cur.holder, h)) fail(`${holderName(st, h)} already hold${h.type === 'team' ? '' : 's'} the ${title.name}.`);
  checkInOrder(st, title, cur, when);
  return { title, holder: h, cur };
}

// A title's history is one line: each change has to land on or after the
// start of the reign it ends. Backfilling a change into an earlier week would
// crown the wrong current champion, so it is refused rather than reordered.
function checkInOrder(st, title, cur, when) {
  if (cur && earlierDate(st, when, cur.start)) {
    fail(`The current ${title.name} reign began in ${weekLabel(st, cur.start)}, later than ${weekLabel(st, when)}. `
      + 'Title changes have to be recorded in order - undo the later one first.');
  }
}
const dateOf = (st, ev) => (ev ? { season: ev.at.season, week: ev.at.week, day: ev.at.day }
  : { season: activeSeason(st).id, week: activeSeason(st).week });

/**
 * Crown a new champion. The current reign, if any, ends at the moment the new
 * one begins. With `eventId` (and `matchId`) the change is dated to that show;
 * otherwise to the current week.
 */
export function setChampion(st, titleId, holder, opts = {}) {
  const ev = opts.eventId ? must(eventById(st, opts.eventId), 'event', opts.eventId) : null;
  const { holder: h, cur } = champChecks(st, titleId, holder, dateOf(st, ev));
  if (opts.matchId && !(ev && ev.matches.some(m => m.id === opts.matchId && m.status === 'played'))) fail('That match has no result on that event.');
  const note = cleanName(opts.note);
  if (note.length > MAX_NAME) fail(`That note is too long (${MAX_NAME} characters max).`);
  const at = ev ? stampAt(st, ev.at.season, ev.at.week, ev.at.day) : now(st);
  if (cur) cur.end = { ...at };
  const reign = { id: newId(st, 'rg'), titleId, holder: h, start: at, end: null, vacated: false,
    eventId: ev ? ev.id : null, matchId: opts.matchId || null, note };
  st.reigns.push(reign);
  return reign;
}

export function vacateTitle(st, titleId) {
  const title = must(titleById(st, titleId), 'championship', titleId);
  const cur = currentReign(st, titleId);
  if (!cur) fail(`The ${title.name} is already vacant.`);
  checkInOrder(st, title, cur, dateOf(st, null));
  cur.end = now(st);
  cur.vacated = true;
  return cur;
}

/**
 * Take back the most recent change to a title: a vacancy is undone by giving
 * the belt back, a new champion by removing their reign and reopening the one
 * it ended.
 */
export function undoTitleChange(st, titleId) {
  const title = must(titleById(st, titleId), 'championship', titleId);
  const reigns = titleReigns(st, titleId);
  const last = reigns[reigns.length - 1];
  if (!last) fail(`The ${title.name} has no history to undo.`);
  if (last.end) {
    if (!title.active) fail(`The ${title.name} is retired. Reactivate it first.`);
    last.end = null;
    last.vacated = false;
    return last;
  }
  const prev = reigns[reigns.length - 2];
  removeWhere(st.reigns, r => r.id === last.id);
  if (prev && prev.end && prev.end.seq === last.start.seq) prev.end = null;
  return prev || null;
}

// Title changes can only be taken back from the end of a title's history:
// removing one from the middle would leave the next champion winning the belt
// from someone who never held it. Checks `reigns` can go, and returns the
// function that removes them and hands the belt back to whoever they ended.
function removableReigns(st, reigns, what) {
  const byTitle = new Map();
  reigns.forEach(r => byTitle.set(r.titleId, [...(byTitle.get(r.titleId) || []), r]));
  const plans = [...byTitle].map(([titleId, group]) => {
    const hist = titleReigns(st, titleId);
    const tail = hist.slice(-group.length);
    if (!tail.every(r => group.includes(r)) || tail[tail.length - 1].end) {
      fail(`The ${titleById(st, titleId).name} has changed hands or been vacated since ${what}. Undo those later changes first.`);
    }
    return { group, prev: hist[hist.length - group.length - 1] || null };
  });
  return () => plans.forEach(({ group, prev }) => {
    const first = group.reduce((a, b) => (a.start.seq < b.start.seq ? a : b));
    removeWhere(st.reigns, r => group.includes(r));
    if (prev && prev.end && prev.end.seq === first.start.seq) prev.end = null;
  });
}

// The reign before and after `r` on its title, and whether each is joined to
// it (the belt passing straight from one to the other). `floor` is the
// earliest `r` can begin: when the reign before it began, if the belt passed
// straight over - or when it ended, if the title sat vacant in between.
function neighbours(st, r) {
  const hist = titleReigns(st, r.titleId);
  const i = hist.indexOf(r);
  const prev = hist[i - 1] || null, next = hist[i + 1] || null;
  const prevJoined = !!(prev && prev.end && prev.end.seq === r.start.seq);
  return { prev, next, prevJoined,
    nextJoined: !!(next && r.end && next.start.seq === r.end.seq),
    floor: prev ? (prevJoined ? prev.start : prev.end) : null };
}

/** How many weeks a reign lasted - or has lasted, if it's still going. */
export function reignWeeks(st, r) { return weeksBetween(st, r.start, r.end || nowDate(st)); }

/**
 * Successful defences in a reign: title matches for this title, dated inside
 * the reign, that the champion was in and that didn't change the title.
 */
export function defencesOf(st, r) {
  let n = 0;
  eachPlayed(st, (m, ev) => {
    if (m.titleId !== r.titleId || st.reigns.some(x => x.matchId === m.id)) return;
    if (earlierDate(st, ev.at, r.start) || (r.end && earlierDate(st, r.end, ev.at))) return;
    const inIt = r.holder.type === 'team' ? m.sides.some(s => s.team === r.holder.id)
      : m.sides.some(s => s.wrestlers.includes(r.holder.id));
    if (inIt) n++;
  });
  return n;
}

/**
 * Correct one reign without touching the rest of the title's history: who
 * held it, the week it began, or its note. A reign that came from a result is
 * corrected through that result (or its event's week) instead, so the two
 * can't disagree.
 */
export function updateReign(st, reignId, patch = {}) {
  const r = must(st.reigns.find(x => x.id === reignId), 'title reign', reignId);
  const title = titleById(st, r.titleId);
  const ev = r.eventId ? eventById(st, r.eventId) : null;
  const { prev, next, prevJoined, nextJoined, floor } = neighbours(st, r);
  let holder = r.holder, week = r.start.week, note = r.note;
  if (has(patch, 'holder')) {
    holder = checkHolder(st, title, patch.holder, true);
    if (!sameHolder(holder, r.holder)) {
      if (r.matchId) fail(`This reign came from a result at ${ev ? ev.name : 'an event'} - edit that result to change who won.`);
      if (!r.end && holder.type === 'team' && !teamById(st, holder.id).active) fail(`${holderName(st, holder)} have disbanded, so they can't be the current champions.`);
      if (prevJoined && sameHolder(prev.holder, holder)) fail(`${holderName(st, holder)} already held the ${title.name} going into this reign.`);
      if (nextJoined && sameHolder(next.holder, holder)) fail(`${holderName(st, holder)} win the ${title.name} next, so they can't be the ones they won it from.`);
    }
  }
  if (has(patch, 'week')) {
    week = checkWeek(patch.week);
    if (week !== r.start.week) {
      if (r.eventId) fail(`This reign is dated by ${ev ? ev.name : 'its event'} - change that event's week instead.`);
      const date = { season: r.start.season, week };
      if (floor && earlierDate(st, date, floor)) {
        fail(prevJoined ? `That's before the previous reign began (${weekLabel(st, floor)}).`
          : `The title was vacant until ${weekLabel(st, floor)}, so this reign can't begin before then.`);
      }
      if (r.end && earlierDate(st, r.end, date)) fail(`That's after this reign ended (${weekLabel(st, r.end)}).`);
    }
  }
  if (has(patch, 'note')) note = checkNote(patch.note);
  r.holder = holder;
  r.note = note;
  r.start.week = week;
  if (prevJoined) prev.end.week = week;
  return r;
}

/** Every reign a wrestler was part of, newest first: [{ reign, title, team }] (team null for singles). */
export function championshipsOf(st, wrestlerId) {
  const out = [];
  st.reigns.forEach(reign => {
    const title = titleById(st, reign.titleId);
    if (reign.holder.type === 'wrestler') {
      if (reign.holder.id === wrestlerId) out.push({ reign, title, team: null });
      return;
    }
    // a tag reign counts if they were on the team at any point during it
    const spells = st.memberships.filter(m => m.team === reign.holder.id && m.wrestler === wrestlerId);
    const overlaps = spells.some(m => (!reign.end || compareStamps(st, m.start, reign.end) < 0)
      && (!m.end || compareStamps(st, reign.start, m.end) < 0));
    if (overlaps) out.push({ reign, title, team: teamById(st, reign.holder.id) });
  });
  return out.sort((a, b) => compareStamps(st, b.reign.start, a.reign.start));
}

export function holderName(st, holder) {
  if (!holder) return 'Vacant';
  const x = holder.type === 'team' ? teamById(st, holder.id) : wrestlerById(st, holder.id);
  return x ? x.name : '(missing)';
}

// ---------------------------------------------------------------- seasons

function openSeason(st, number, name) {
  const id = newId(st, 's');
  const season = { id, number, name: cleanName(name) || `Season ${number}`, week: 1, status: 'active',
    started: null, ended: null, start: null };
  st.seasons.push(season);
  season.started = stampAt(st, id, 1);
  return season;
}

export function setWeek(st, week) {
  const season = activeSeason(st);
  season.week = checkWeek(week);
  return season;
}
export function advanceWeek(st) { return setWeek(st, activeSeason(st).week + 1); }

/** End the current season and start the next. There is always exactly one active season. */
export function startNextSeason(st, name = '') {
  if (cleanName(name).length > MAX_NAME) fail(`That name is too long (${MAX_NAME} characters max).`);
  const cur = activeSeason(st);
  cur.ended = now(st);
  cur.status = 'complete';
  return openSeason(st, Math.max(...st.seasons.map(s => s.number)) + 1, name);
}

/**
 * Pin a season to the real calendar: `iso` ('YYYY-MM-DD') is any day of its
 * week 1, and every show then gets a date. Pass '' or null to go back to
 * plain weeks. Purely a label - nothing is reordered.
 */
export function setSeasonStart(st, id, iso) {
  const s = must(seasonById(st, id), 'season', id);
  if (iso == null || iso === '') { s.start = null; return s; }
  if (!isIsoDate(iso)) fail('That isn’t a date.');
  s.start = iso;
  return s;
}

export function renameSeason(st, id, name) {
  const s = must(seasonById(st, id), 'season', id);
  const n = cleanName(name);
  if (n.length > MAX_NAME) fail(`That name is too long (${MAX_NAME} characters max).`);
  s.name = n || `Season ${s.number}`;
  return s;
}

// ---------------------------------------------------------------- events

function eventName(st, kind, showId, week, value) {
  const name = cleanName(value);
  if (name.length > MAX_NAME) fail(`That name is too long (${MAX_NAME} characters max).`);
  if (name) return name;
  if (kind === 'ple') fail('Give the premium live event a name.');
  return `${showById(st, showId).name} · Week ${week}`;
}

/** The night an episode normally airs: its show's night, or Saturday for a PLE. */
export function defaultDay(st, kind, showId) {
  const show = showById(st, showId);
  return kind === 'weekly' && show ? show.day : PLE_DAY;
}

/**
 * A weekly episode (needs a show) or a premium live event (a show is optional -
 * leave it empty for a PLE shared by every brand). New events go in the active
 * season, in the current week unless `week` says otherwise, on the show's own
 * night unless `day` says otherwise.
 */
export function addEvent(st, input = {}) {
  const season = activeSeason(st);
  const kind = oneOf(input.kind || 'weekly', EVENT_KINDS, 'event type');
  const showId = checkShowId(st, input.showId);
  if (kind === 'weekly' && !showId) fail('Pick which show this episode is.');
  const week = input.week == null || input.week === '' ? season.week : checkWeek(input.week);
  const day = input.day == null || input.day === '' ? defaultDay(st, kind, showId) : checkDay(input.day);
  const name = eventName(st, kind, showId, week, input.name);
  const notes = checkText(input.notes, 'Notes');
  const ev = { id: newId(st, 'ev'), name, kind, showId, at: stampAt(st, season.id, week, day), notes, matches: [] };
  st.events.push(ev);
  return ev;
}

export function updateEvent(st, id, patch = {}) {
  const ev = must(eventById(st, id), 'event', id);
  const kind = has(patch, 'kind') ? oneOf(patch.kind, EVENT_KINDS, 'event type') : ev.kind;
  const showId = has(patch, 'showId') ? checkShowId(st, patch.showId) : ev.showId;
  if (kind === 'weekly' && !showId) fail('A weekly episode needs a show.');
  const week = has(patch, 'week') ? checkWeek(patch.week) : ev.at.week;
  const day = has(patch, 'day') ? checkDay(patch.day) : ev.at.day;
  const linked = st.reigns.filter(r => r.eventId === id);
  const moved = week !== ev.at.week || day !== ev.at.day;
  if (moved) {
    // a title that changed hands here moves with the event, as long as the
    // title's history still reads in order afterwards
    const date = { season: ev.at.season, week, day };
    const when = weekLabel(st, date);
    linked.forEach(r => {
      const { prevJoined, floor } = neighbours(st, r);
      const title = titleById(st, r.titleId).name;
      if (floor && earlierDate(st, date, floor)) {
        fail(prevJoined ? `${when} is before the ${title} reign this event ended began (${weekLabel(st, floor)}).`
          : `The ${title} was vacant until ${weekLabel(st, floor)}, so ${when} is too early.`);
      }
      if (r.end && earlierDate(st, r.end, date)) fail(`${when} is after the ${title} reign won here ended (${weekLabel(st, r.end)}).`);
    });
  }
  // an episode still called by its default name ("Raw · Week 3") keeps up
  // with a new show or week; a name the owner chose is left alone
  const autoNamed = ev.kind === 'weekly' && ev.name === eventName(st, 'weekly', ev.showId, ev.at.week, '');
  const name = has(patch, 'name') ? eventName(st, kind, showId, week, patch.name)
    : autoNamed && kind === 'weekly' ? eventName(st, kind, showId, week, '') : ev.name;
  const notes = has(patch, 'notes') ? checkText(patch.notes, 'Notes') : ev.notes;
  Object.assign(ev, { kind, showId, name, notes });
  if (moved) {
    const place = x => { x.week = week; if (day == null) delete x.day; else x.day = day; };
    linked.forEach(r => {
      const { prev, prevJoined } = neighbours(st, r);
      if (prevJoined) place(prev.end);
      place(r.start);
    });
    place(ev.at);
  }
  return ev;
}

/**
 * Delete an event and its results. A title that changed hands here goes back
 * to whoever held it before - allowed only while nothing later depends on it.
 */
export function deleteEvent(st, id) {
  const ev = must(eventById(st, id), 'event', id);
  const linked = st.reigns.filter(r => r.eventId === id);
  const revert = linked.length ? removableReigns(st, linked, ev.name) : null;
  removeWhere(st.events, e => e.id === id);
  if (revert) revert();
}

/** Events in a season, oldest first: by week, then night, then the order they were added. */
export function eventsIn(st, seasonId) {
  return st.events.filter(e => e.at.season === seasonId).sort((a, b) => compareStamps(st, a.at, b.at));
}

// ---------------------------------------------------------------- the card: bookings and results
//
// A match is one record from the moment it's booked until long after its
// result is in: { id, status, sides, titleId, stip, notes, outcome, winner,
// finish, fall }. 'scheduled' means it's on the card and nothing about who
// won exists yet; 'played' means the owner has entered what WWE 2K25
// produced. It keeps its id and its place on the card throughout, so a
// correction never rebuilds anything. Only played matches count - toward
// records, defences and history.
//
// Nothing here ever picks a winner. A result exists only when the owner
// enters one, and a win needs the winning side named.

// A side wrestling as a team counts toward that team's record, so it has to
// be the team: at least two wrestlers, every one of them on it at some point.
function normalizeSides(st, sides) {
  if (!Array.isArray(sides) || sides.length < 2) fail('A match needs at least two sides.');
  if (sides.length > MAX_SIDES) fail(`A match can have at most ${MAX_SIDES} sides.`);
  const seen = new Set();
  return sides.map((side, i) => {
    const ids = ((side && side.wrestlers) || []).filter(x => x != null && x !== '');
    if (!ids.length) fail(`Side ${i + 1} has nobody on it.`);
    ids.forEach(id => {
      const w = must(wrestlerById(st, id), 'wrestler', id);
      if (seen.has(id)) fail(`${w.name} can't be in the same match twice.`);
      seen.add(id);
    });
    const team = side.team || null;
    if (team) {
      const t = must(teamById(st, team), 'tag team', team);
      if (ids.length < 2) fail(`Side ${i + 1} is wrestling as ${t.name}, so it needs at least two of them.`);
      const outsider = ids.find(id => !st.memberships.some(m => m.team === team && m.wrestler === id));
      if (outsider) fail(`${wrestlerById(st, outsider).name} has never been on ${t.name}. Add them to the team first, or record the side without the team.`);
    }
    return { wrestlers: [...ids], team };
  });
}

// Who's in it and what's at stake - everything a booking has. `keepTitleId`
// lets a correction to an old match keep a title that has since retired.
function bookingFields(st, input, keepTitleId = null) {
  const sides = normalizeSides(st, input.sides);
  const title = input.titleId ? must(titleById(st, input.titleId), 'championship', input.titleId) : null;
  if (title && !title.active && title.id !== keepTitleId) fail(`The ${title.name} is retired.`);
  const stip = cleanName(input.stip);
  if (stip.length > MAX_NAME) fail(`That stipulation is too long (${MAX_NAME} characters max).`);
  const notes = checkText(input.notes, 'Notes');
  return { sides, title, stip, notes };
}

// What happened, checked against the sides it happened to. The outcome is
// never assumed: with neither an outcome nor a winner there's no result, and
// a win needs its winning side named.
function resultFields(st, input, sides) {
  const hasWinner = !(input.winner === '' || input.winner == null);
  let outcome = input.outcome === '' || input.outcome == null ? null : input.outcome;
  if (!outcome) {
    if (!hasWinner) fail('Enter the result: who won, a draw, or a no contest.');
    outcome = 'win';
  }
  oneOf(outcome, OUTCOMES, 'result');
  let winner = null;
  if (outcome === 'win') {
    winner = hasWinner ? Number(input.winner) : NaN;
    if (!Number.isInteger(winner) || winner < 0 || winner >= sides.length) fail('Pick who won.');
  } else if (hasWinner) {
    fail(`A ${outcome === 'draw' ? 'draw' : 'no contest'} has no winner.`);
  }
  const finish = input.finish == null || input.finish === '' ? null : oneOf(input.finish, FINISHES, 'finish');
  return { outcome, winner, finish, fall: checkFall(st, input.fall, sides, outcome, winner) };
}

// Optional detail on a win: who scored the pin or submission (`by`, on the
// winning side) and who took it (`on`, on a losing side) - in a multi-person
// match, the one loser who actually lost the fall. Records don't depend on it.
function checkFall(st, fall, sides, outcome, winner) {
  const by = (fall && fall.by) || null, on = (fall && fall.on) || null;
  if (!by && !on) return null;
  if (outcome !== 'win') fail('Only a win has someone scoring or taking the fall.');
  if (by && !sides[winner].wrestlers.includes(by)) fail(`${must(wrestlerById(st, by), 'wrestler', by).name} wasn't on the winning side.`);
  if (on && !sides.some((sd, i) => i !== winner && sd.wrestlers.includes(on))) {
    fail(`${must(wrestlerById(st, on), 'wrestler', on).name} wasn't on a losing side.`);
  }
  return { by, on };
}

const bookedRecord = b => ({ status: 'scheduled', sides: b.sides, titleId: b.title ? b.title.id : null,
  stip: b.stip, notes: b.notes, outcome: null, winner: null, finish: null, fall: null });
const playedRecord = (b, r) => ({ ...bookedRecord(b), status: 'played',
  outcome: r.outcome, winner: r.winner, finish: r.finish, fall: r.fall });
// A booking's fields, from `input` where given and the match where not.
const bookingInput = (m, input) => ({
  sides: has(input, 'sides') ? input.sides : m.sides,
  titleId: has(input, 'titleId') ? input.titleId : m.titleId,
  stip: has(input, 'stip') ? input.stip : m.stip,
  notes: has(input, 'notes') ? input.notes : m.notes,
});

function holderFromSide(title, side) {
  if (title.kind === 'tag') {
    if (!side.team) fail(`The ${title.name} is a tag title - pick the tag team on the winning side.`);
    return { type: 'team', id: side.team };
  }
  if (side.wrestlers.length !== 1) fail(`The ${title.name} is a singles title - the winning side has to be one wrestler.`);
  return { type: 'wrestler', id: side.wrestlers[0] };
}

// How a result's title change should land, all worked out before anything
// changes: `keep` corrects the holder of the reign this match already made,
// `add` makes a new reign, `revert` hands a belt back. A title changes hands
// only when opts.titleChange says so - a title match where the champion kept
// the belt is just a title match.
function titlePlan(st, ev, linked, b, r, titleChange) {
  const plan = { keep: null, add: null, revert: null };
  if (!titleChange) {
    if (linked) plan.revert = removableReigns(st, [linked], 'this match');
    return plan;
  }
  if (!b.title) fail('Pick the title that changed hands.');
  if (r.outcome !== 'win') fail('A title only changes hands when someone wins.');
  const raw = holderFromSide(b.title, b.sides[r.winner]);
  if (linked && linked.titleId === b.title.id) {
    const holder = checkHolder(st, b.title, raw, sameHolder(raw, linked.holder));
    const { prev, next, prevJoined, nextJoined } = neighbours(st, linked);
    const who = holderName(st, holder);
    if (prevJoined && sameHolder(prev.holder, holder)) fail(`${who} already held the ${b.title.name} going into this match - that's a retention, not a title change.`);
    if (nextJoined && sameHolder(next.holder, holder)) fail(`${who} win the ${b.title.name} next, in ${weekLabel(st, next.start)}, so they can't have won it here too.`);
    plan.keep = holder;
  } else {
    if (linked) plan.revert = removableReigns(st, [linked], 'this match');
    plan.add = champChecks(st, b.title.id, raw, dateOf(st, ev)).holder;
  }
  return plan;
}
function applyPlan(st, ev, m, plan, linked) {
  if (plan.revert) plan.revert();
  if (plan.keep) linked.holder = plan.keep;
  if (plan.add) setChampion(st, m.titleId, plan.add, { eventId: ev.id, matchId: m.id });
}

function findMatch(st, eventId, matchId) {
  const ev = must(eventById(st, eventId), 'event', eventId);
  return { ev, m: must(ev.matches.find(x => x.id === matchId), 'match', matchId) };
}

/** Put a match on an event's card: who's in it, what's at stake. The result comes later, from the game. */
export function bookMatch(st, eventId, input = {}) {
  const ev = must(eventById(st, eventId), 'event', eventId);
  const m = { id: newId(st, 'm'), ...bookedRecord(bookingFields(st, input)) };
  ev.matches.push(m);
  return m;
}

/** Change a booked match before it's played. A played match is corrected with updateMatch. */
export function updateBooking(st, eventId, matchId, input = {}) {
  const { m } = findMatch(st, eventId, matchId);
  if (m.status !== 'scheduled') fail('This match already has a result - correct the result instead.');
  Object.assign(m, bookedRecord(bookingFields(st, bookingInput(m, input), m.titleId)));
  return m;
}

/**
 * Enter what happened in a booked match, after watching the CPU play it.
 * The booking's line-up, stakes and notes stand unless `input` changes them -
 * a surprise entrant, a note about the finish. `opts.titleChange` crowns the
 * winners of the title at stake, dated to this event.
 */
export function enterResult(st, eventId, matchId, input = {}, opts = {}) {
  const { ev, m } = findMatch(st, eventId, matchId);
  if (m.status === 'played') fail('This match already has a result - correct it instead.');
  const b = bookingFields(st, bookingInput(m, input), m.titleId);
  const r = resultFields(st, input, b.sides);
  const plan = titlePlan(st, ev, null, b, r, opts.titleChange);
  Object.assign(m, playedRecord(b, r));
  applyPlan(st, ev, m, plan, null);
  return m;
}

/**
 * Book a match and enter its result in one step - for one that happened
 * without being on the card. Same rules as enterResult.
 */
export function recordMatch(st, eventId, input = {}, opts = {}) {
  const ev = must(eventById(st, eventId), 'event', eventId);
  const b = bookingFields(st, input);
  const r = resultFields(st, input, b.sides);
  const plan = titlePlan(st, ev, null, b, r, opts.titleChange);
  const m = { id: newId(st, 'm'), ...playedRecord(b, r) };
  ev.matches.push(m);
  applyPlan(st, ev, m, plan, null);
  return m;
}

/**
 * Correct a recorded result in place - wrong winner, wrong people, wrong
 * finish, wrong title. `input` is the whole corrected result. It keeps its id
 * and its place on the card, so nothing else has to be re-entered. If it
 * changed a title, the correction carries through: a different winner becomes
 * that reign's holder, and dropping the title change hands the belt back -
 * but only while nothing later depends on it, so correcting one result can't
 * rewrite anyone else's history.
 */
export function updateMatch(st, eventId, matchId, input = {}, opts = {}) {
  const { ev, m } = findMatch(st, eventId, matchId);
  if (m.status !== 'played') fail("This match hasn't been played yet - enter its result instead.");
  const linked = st.reigns.find(r => r.matchId === matchId) || null;
  const b = bookingFields(st, input, m.titleId);
  const r = resultFields(st, input, b.sides);
  const plan = titlePlan(st, ev, linked, b, r, opts.titleChange);
  Object.assign(m, playedRecord(b, r));
  applyPlan(st, ev, m, plan, linked);
  return m;
}

/**
 * Take a result back off a match: it stays on the card, booked, as if it
 * hadn't been played. A title change it made is handed back - only while
 * nothing later depends on it.
 */
export function clearResult(st, eventId, matchId) {
  const { m } = findMatch(st, eventId, matchId);
  if (m.status !== 'played') fail('This match has no result to clear.');
  const linked = st.reigns.find(r => r.matchId === matchId);
  const revert = linked ? removableReigns(st, [linked], 'this match') : null;
  Object.assign(m, bookedRecord({ sides: m.sides, title: titleById(st, m.titleId), stip: m.stip, notes: m.notes }));
  if (revert) revert();
  return m;
}

/**
 * Take a match off the card altogether, played or not. If its result changed
 * a title, the belt goes back to whoever held it before - allowed only while
 * nothing later depends on that change.
 */
export function deleteMatch(st, eventId, matchId) {
  const { ev } = findMatch(st, eventId, matchId);
  const linked = st.reigns.find(r => r.matchId === matchId);
  const revert = linked ? removableReigns(st, [linked], 'this match') : null;
  removeWhere(ev.matches, m => m.id === matchId);
  if (revert) revert();
}

/** Move a match one place up (-1) or down (+1) the card. False at either end. */
export function moveMatch(st, eventId, matchId, delta) {
  const { ev, m } = findMatch(st, eventId, matchId);
  const i = ev.matches.indexOf(m), j = i + Math.sign(Number(delta) || 0);
  if (j === i || j < 0 || j >= ev.matches.length) return false;
  ev.matches.splice(i, 1);
  ev.matches.splice(j, 0, m);
  return true;
}

/**
 * What kind of match it is, read from the line-up rather than stored - so it
 * can never disagree with who was in it. { key, label }.
 */
export function matchKind(match) {
  const sizes = match.sides.map(sd => sd.wrestlers.length);
  const n = sizes.length, k = sizes[0];
  const K = (key, label) => ({ key, label });
  if (sizes.every(x => x === k)) {
    if (k === 1) return n === 2 ? K('singles', 'Singles') : n === 3 ? K('triple-threat', 'Triple threat')
      : n === 4 ? K('fatal-4-way', 'Fatal 4-way') : K('multi-way', `${n}-way`);
    if (k === 2) return n === 2 ? K('tag', 'Tag team') : n === 3 ? K('triple-threat-tag', 'Triple threat tag')
      : n === 4 ? K('fatal-4-way-tag', 'Fatal 4-way tag') : K('multi-team-tag', `${n}-team tag`);
    return n === 2 ? K('team-tag', `${k}-on-${k} tag`) : K('multi-team-tag', `${n}-team, ${k} a side`);
  }
  if (n === 2) return K('handicap', `Handicap ${Math.min(...sizes)}-on-${Math.max(...sizes)}`);
  return K('other', 'Uneven multi-way');
}

/** Where an event's card stands: { booked, played, total, state } - 'empty', 'booked', 'partial' or 'complete'. */
export function cardStatus(ev) {
  const played = ev.matches.filter(m => m.status === 'played').length;
  const total = ev.matches.length, booked = total - played;
  const state = !total ? 'empty' : !played ? 'booked' : booked ? 'partial' : 'complete';
  return { booked, played, total, state };
}

function eachMatch(st, fn) {
  st.events.forEach(ev => ev.matches.forEach(m => fn(m, ev)));
}
function eachPlayed(st, fn) {
  eachMatch(st, (m, ev) => { if (m.status === 'played') fn(m, ev); });
}
/** Every match a wrestler has had a result in, newest first: [{ event, match, side }]. */
export function matchesOf(st, wrestlerId) {
  const out = [];
  eachPlayed(st, (match, event) => {
    const side = match.sides.findIndex(sd => sd.wrestlers.includes(wrestlerId));
    if (side >= 0) out.push({ event, match, side });
  });
  return out.sort((a, b) => compareStamps(st, b.event.at, a.event.at));
}
/** Matches a wrestler is booked in that have no result yet, soonest first. */
export function bookingsOf(st, wrestlerId) {
  const out = [];
  eachMatch(st, (match, event) => {
    if (match.status !== 'scheduled') return;
    const side = match.sides.findIndex(sd => sd.wrestlers.includes(wrestlerId));
    if (side >= 0) out.push({ event, match, side });
  });
  return out.sort((a, b) => compareStamps(st, a.event.at, b.event.at));
}
/**
 * The results, newest show first, each show's card in running order - the
 * browsable history. Filter by `seasonId`, and by `showId` (or 'ple' for
 * premium live events). Each row: { event, match, n } with n the card position.
 */
export function resultsHistory(st, filter = {}) {
  const out = [];
  st.events
    .filter(e => (!filter.seasonId || e.at.season === filter.seasonId)
      && (!filter.showId || (filter.showId === 'ple' ? e.kind === 'ple' : e.showId === filter.showId)))
    .sort((a, b) => compareStamps(st, b.at, a.at))
    .forEach(event => event.matches.forEach((match, i) => { if (match.status === 'played') out.push({ event, match, n: i + 1 }); }));
  return out;
}
/** 'W', 'L', 'D' or 'NC' for whoever was on side `side`. */
export function resultFor(match, side) {
  if (match.outcome === 'draw') return 'D';
  if (match.outcome === 'nc') return 'NC';
  return match.winner === side ? 'W' : 'L';
}

// ---------------------------------------------------------------- records

const KEY = { W: 'w', L: 'l', D: 'd', NC: 'nc' };
export const blankRecord = () => ({ w: 0, l: 0, d: 0, nc: 0 });
const tally = (rec, r) => { rec[KEY[r]]++; return rec; };

/**
 * A wrestler's record, split the way wrestling splits it. A match is singles
 * when their own side was just them - a triple threat is singles, and so is
 * the lone wrestler in a handicap match - and tag when they had a partner.
 * `teams` breaks the tag record down by the team they wrestled as, with ''
 * for makeshift pairings.
 */
export function wrestlerRecord(st, wrestlerId) {
  const out = { singles: blankRecord(), tag: blankRecord(), teams: {} };
  matchesOf(st, wrestlerId).forEach(({ match, side }) => {
    const s = match.sides[side];
    const r = resultFor(match, side);
    if (s.wrestlers.length === 1) tally(out.singles, r);
    else {
      tally(out.tag, r);
      tally(out.teams[s.team || ''] || (out.teams[s.team || ''] = blankRecord()), r);
    }
  });
  return out;
}

/** Every match a team wrestled as the team, newest first: [{ event, match, side }]. */
export function teamMatches(st, teamId) {
  const out = [];
  eachPlayed(st, (match, event) => {
    const side = match.sides.findIndex(s => s.team === teamId);
    if (side >= 0) out.push({ event, match, side });
  });
  return out.sort((a, b) => compareStamps(st, b.event.at, a.event.at));
}
/** Matches a team is booked in as the team, with no result yet, soonest first. */
export function teamBookings(st, teamId) {
  const out = [];
  eachMatch(st, (match, event) => {
    const side = match.status === 'scheduled' ? match.sides.findIndex(s => s.team === teamId) : -1;
    if (side >= 0) out.push({ event, match, side });
  });
  return out.sort((a, b) => compareStamps(st, a.event.at, b.event.at));
}

/**
 * A team's own record - only matches it wrestled as the team. Its members'
 * singles matches, and tag matches they had with other partners, don't count.
 */
export function teamRecord(st, teamId) {
  return teamMatches(st, teamId).reduce((rec, x) => tally(rec, resultFor(x.match, x.side)), blankRecord());
}

// ---------------------------------------------------------------- merging duplicates

/**
 * Fold a duplicate into the wrestler it duplicates - the usual cure for a name
 * entered twice. Everything the duplicate did (results, team spells, title
 * reigns) is re-pointed at the kept wrestler; the duplicate's own roster moves
 * are dropped, since the kept wrestler's show history is the real one.
 * Refused when the two were ever in the same match or on the same team, or
 * when it would give one wrestler back-to-back reigns of the same title.
 */
export function mergeWrestlers(st, keepId, dupId) {
  const keep = must(wrestlerById(st, keepId), 'wrestler', keepId);
  const dup = must(wrestlerById(st, dupId), 'wrestler', dupId);
  if (keepId === dupId) fail('Pick two different wrestlers.');
  let clash = null;
  eachMatch(st, (m, ev) => {
    const ws = m.sides.flatMap(sd => sd.wrestlers);
    if (!clash && ws.includes(keepId) && ws.includes(dupId)) clash = ev;
  });
  if (clash) fail(`${keep.name} and ${dup.name} were both in a match at ${clash.name}, so they can't be the same person. Fix that result first.`);
  const keepTeams = new Set(st.memberships.filter(m => m.wrestler === keepId).map(m => m.team));
  const shared = st.memberships.find(m => m.wrestler === dupId && keepTeams.has(m.team));
  if (shared) fail(`${keep.name} and ${dup.name} have both been on ${teamById(st, shared.team).name}. Take one of them off it first.`);
  const as = h => (h.type === 'wrestler' && h.id === dupId ? { type: 'wrestler', id: keepId } : h);
  st.titles.forEach(t => {
    const hist = titleReigns(st, t.id);
    hist.forEach((r, i) => {
      const prev = hist[i - 1];
      if (prev && prev.end && prev.end.seq === r.start.seq && sameHolder(as(prev.holder), as(r.holder))) {
        fail(`${keep.name} would win the ${t.name} from themselves in ${weekLabel(st, r.start)}. Fix that title history first.`);
      }
    });
  });
  eachMatch(st, m => m.sides.forEach(sd => { sd.wrestlers = sd.wrestlers.map(id => (id === dupId ? keepId : id)); }));
  st.memberships.forEach(m => { if (m.wrestler === dupId) m.wrestler = keepId; });
  st.teams.forEach(t => { t.members = t.members.map(id => (id === dupId ? keepId : id)); });
  st.reigns.forEach(r => { r.holder = as(r.holder); });
  removeWhere(st.moves, m => m.wrestler === dupId);
  removeWhere(st.wrestlers, w => w.id === dupId);
  return keep;
}

// ---------------------------------------------------------------- career

/**
 * One wrestler's career, newest first by the calendar: shows joined and left,
 * teams formed, joined, left and disbanded, and titles won, lost and vacated -
 * tag titles included when they were on the team at the time.
 * Each entry: { type, seq, season, week, ... }.
 */
export function careerOf(st, wrestlerId) {
  const out = [];
  const at = (stamp, type, extra) => out.push({ type, seq: stamp.seq, season: stamp.season, week: stamp.week, ...extra });
  movesOf(st, wrestlerId).forEach(move => at(move.at, 'move', { move }));
  st.memberships.filter(m => m.wrestler === wrestlerId).forEach(m => {
    const team = teamById(st, m.team);
    at(m.start, m.start.seq === teamFormed(team).seq ? 'team-formed' : 'team-joined', { team });
    if (m.end) at(m.end, 'team-left', { team });
    team.log.slice(1).forEach(e => { if (within(st, e.at, m.start, m.end)) at(e.at, `team-${e.type}`, { team }); });
  });
  championshipsOf(st, wrestlerId).forEach(({ reign, title, team }) => {
    const there = stamp => !team || memberAt(st, team.id, wrestlerId, stamp);
    if (there(reign.start)) at(reign.start, 'title-won', { reign, title, team });
    if (reign.end && there(reign.end)) at(reign.end, reign.vacated ? 'title-vacated' : 'title-lost', { reign, title, team });
  });
  return out.sort((a, b) => compareStamps(st, b, a));
}

// ---------------------------------------------------------------- history

/**
 * Everything that happened, newest first by the universe's calendar, built
 * from the records themselves rather than kept as a second copy - so it can
 * never disagree with them.
 * Each entry: { type, seq, season, week, rec } where `rec` is the season,
 * roster move, team, team membership, reign or event the entry came from.
 */
export function timeline(st) {
  const out = [];
  const at = (stamp, type, rec) => out.push({ type, seq: stamp.seq, season: stamp.season, week: stamp.week, day: stamp.day, rec });
  st.seasons.forEach(s => {
    at(s.started, 'season-start', s);
    if (s.ended) at(s.ended, 'season-end', s);
  });
  st.moves.forEach(m => at(m.at, 'move', m));
  st.teams.forEach(t => t.log.forEach(e => at(e.at, `team-${e.type}`, t)));
  st.memberships.forEach(m => {
    const t = teamById(st, m.team);
    if (t && m.start.seq !== teamFormed(t).seq) at(m.start, 'team-joined', m);
    if (m.end) at(m.end, 'team-left', m);
  });
  st.reigns.forEach(r => {
    at(r.start, 'title-won', r);
    if (r.vacated) at(r.end, 'title-vacated', r);
  });
  st.events.forEach(e => at(e.at, 'event', e));
  return out.sort((a, b) => compareStamps(st, b, a));
}

export function summary(st) {
  let matches = 0, booked = 0;
  eachMatch(st, m => { if (m.status === 'played') matches++; else booked++; });
  return {
    wrestlers: st.wrestlers.length, teams: st.teams.length, titles: st.titles.length,
    events: st.events.length, matches, booked, seasons: st.seasons.length,
  };
}

// ---------------------------------------------------------------- load / check

/**
 * Bring stored or imported data up to the current schema. Throws on anything
 * that isn't a universe, or was written by a newer version of this tool.
 * Returns a fresh copy; the input is never modified.
 */
export function migrate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('That is not a universe save.');
  if (raw.app !== APP_ID) fail('That is not a WWE Universe save.');
  const v = raw.version;
  if (!Number.isInteger(v) || v < 1) fail('That save has no version number.');
  if (v > SCHEMA_VERSION) fail(`That save is from a newer version of this tool (v${v}; this is v${SCHEMA_VERSION}).`);
  const st = JSON.parse(JSON.stringify(raw));
  for (const k of ['shows', 'wrestlers', 'moves', 'teams', 'memberships', 'titles', 'reigns', 'seasons', 'events']) {
    if (!Array.isArray(st[k])) st[k] = [];
  }
  if (!Number.isInteger(st.nextId) || st.nextId < 1) st.nextId = 1;
  if (!Number.isInteger(st.seq) || st.seq < 0) st.seq = 0;
  SHOW_SEED.forEach(seed => { if (!showById(st, seed.id)) st.shows.push({ ...seed }); });
  if (!st.seasons.length) openSeason(st, 1, '');

  // Each step walks a save forward one version, so any older save arrives at
  // the current schema however old it is.
  if (st.version === 1) {
    // v2: team line-ups get their own dated history. A v1 save only knew each
    // team's current members and when it formed, so that is what's kept:
    // everyone on the team joined when it formed, and nobody has left.
    st.memberships = [];
    st.teams.forEach(t => {
      const formed = t.formed || st.seasons[0].started;
      t.log = [{ type: 'formed', at: { ...formed } }];
      if (t.disbanded) t.log.push({ type: 'disbanded', at: { ...t.disbanded } });
      t.active = !t.disbanded;
      (Array.isArray(t.members) ? t.members : []).forEach(w =>
        st.memberships.push({ id: `ms${st.nextId++}`, team: t.id, wrestler: w, start: { ...formed }, end: null }));
      delete t.formed;
      delete t.disbanded;
    });
    st.version = 2;
  }
  if (st.version === 2) {
    // v3: a match can be booked before it's played, and every show has a
    // night. Everything a v2 save recorded had been played; its episodes air
    // on their show's regular night, and its PLEs on a Saturday.
    const night = id => (SHOW_SEED.find(x => x.id === id) || { day: 0 }).day;
    st.shows.forEach(sh => { if (!Number.isInteger(sh.day)) sh.day = night(sh.id); });
    st.seasons.forEach(se => { if (se.start === undefined) se.start = null; });
    st.events.forEach(e => {
      if (e.at && e.at.day == null) e.at.day = e.kind === 'weekly' && showById(st, e.showId) ? showById(st, e.showId).day : PLE_DAY;
      (Array.isArray(e.matches) ? e.matches : []).forEach(m => {
        m.status = 'played';
        if (m.fall === undefined) m.fall = null;
      });
    });
    st.version = 3;
  }
  return st;
}

/**
 * Every way the data disagrees with itself, as sentences. Empty means sound.
 * Used on import (which refuses anything with problems) and by the tests.
 */
export function validate(st) {
  const bad = [];
  const ids = new Set();
  const idNum = id => { const m = /\d+$/.exec(id); return m ? +m[0] : 0; };
  // Ids end up inside inline onclick handlers and names inside markup, so an
  // imported file only passes if every id is a plain token and every name is
  // text - a crafted save can't smuggle script in through either.
  const own = (list, what) => list.forEach(x => {
    if (!x || typeof x.id !== 'string' || !x.id) { bad.push(`A ${what} has no id.`); return; }
    if (!/^[a-z][a-z0-9-]{0,39}$/i.test(x.id)) { bad.push(`A ${what} has an id that isn't a plain token.`); return; }
    if (ids.has(x.id)) bad.push(`The id ${x.id} is used twice.`);
    ids.add(x.id);
    if (list !== st.shows && idNum(x.id) >= st.nextId) bad.push(`The id ${x.id} is ahead of the id counter.`);
  });
  own(st.shows, 'show'); own(st.wrestlers, 'wrestler'); own(st.moves, 'roster move'); own(st.teams, 'tag team');
  own(st.titles, 'championship'); own(st.reigns, 'title reign'); own(st.seasons, 'season'); own(st.events, 'event');
  own(st.memberships, 'team membership');
  st.events.forEach(e => own(e.matches || [], 'match'));

  const stamp = (s, where) => {
    if (!s || !seasonById(st, s.season) || !Number.isInteger(s.week) || !Number.isInteger(s.seq)) {
      bad.push(`${where} has a broken date.`);
    } else if (s.seq > st.seq) bad.push(`${where} is dated ahead of the clock.`);
  };
  const names = (list, what) => {
    const seen = new Set();
    list.forEach(x => {
      if (typeof x.name !== 'string') { bad.push(`A ${what} (${x.id}) has a name that isn't text.`); return; }
      const k = nameKey(x.name);
      if (!k) bad.push(`A ${what} (${x.id}) has no name.`);
      else if (seen.has(k)) bad.push(`Two ${what}s are called ${x.name}.`);
      seen.add(k);
    });
  };
  const showOk = id => id === null || !!showById(st, id);

  names(st.shows, 'show');
  const night = d => Number.isInteger(d) && d >= 0 && d <= 6;
  st.shows.forEach(s => {
    if (!/^#[0-9a-f]{3,8}$/i.test(String(s.color))) bad.push(`${s.name} has an unreadable colour.`);
    if (typeof s.promotion !== 'string') bad.push(`${s.name} has no promotion.`);
    if (!night(s.day)) bad.push(`${s.name} has no night of the week.`);
  });

  names(st.wrestlers, 'wrestler');
  st.wrestlers.forEach(w => {
    if (!GENDERS.includes(w.gender) || !ORIGINS.includes(w.origin) || !STATUSES.includes(w.status)
      || !(w.alignment === null || ALIGNMENTS.includes(w.alignment))) bad.push(`${w.name} has an unknown detail.`);
    if (!showOk(w.showId)) bad.push(`${w.name} is on a show that doesn't exist.`);
    const moves = movesOf(st, w.id);
    const last = moves.length ? moves[moves.length - 1].to : null;
    if (last !== w.showId) bad.push(`${w.name}'s roster history doesn't end on their current show.`);
  });
  st.moves.forEach(m => {
    if (!wrestlerById(st, m.wrestler)) bad.push(`Roster move ${m.id} is for a wrestler who doesn't exist.`);
    if (!showOk(m.from) || !showOk(m.to)) bad.push(`Roster move ${m.id} names a show that doesn't exist.`);
    stamp(m.at, `Roster move ${m.id}`);
  });

  names(st.teams, 'tag team');
  st.teams.forEach(t => {
    if (!Array.isArray(t.members) || t.members.length < 2) bad.push(`${t.name} have fewer than two members.`);
    else {
      if (new Set(t.members).size !== t.members.length) bad.push(`${t.name} list a member twice.`);
      if (t.members.some(id => !wrestlerById(st, id))) bad.push(`${t.name} include a wrestler who doesn't exist.`);
      const open = st.memberships.filter(m => m.team === t.id && m.end === null).map(m => m.wrestler).sort();
      if (JSON.stringify([...t.members].sort()) !== JSON.stringify(open)) bad.push(`${t.name}'s line-up doesn't match their membership history.`);
    }
    const log = Array.isArray(t.log) ? t.log : [];
    if (!log.length || !log[0] || log[0].type !== 'formed') { bad.push(`${t.name} have no record of forming.`); return; }
    log.forEach((e, i) => {
      if (!TEAM_EVENTS.includes(e.type)) bad.push(`${t.name} have an unknown history entry.`);
      stamp(e.at, t.name);
      if (i > 0 && e.type !== (log[i - 1].type === 'disbanded' ? 'reunited' : 'disbanded')) {
        bad.push(`${t.name}'s history has them ${e.type} out of turn.`);
      }
    });
    if (t.active !== (log[log.length - 1].type !== 'disbanded')) bad.push(`${t.name}'s active flag disagrees with their history.`);
  });
  const spells = new Map();
  st.memberships.forEach(m => {
    const t = teamById(st, m.team);
    if (!t) { bad.push(`Membership ${m.id} is for a team that doesn't exist.`); return; }
    if (!wrestlerById(st, m.wrestler)) bad.push(`Membership ${m.id} is for a wrestler who doesn't exist.`);
    stamp(m.start, `Membership ${m.id}`);
    if (m.end) {
      stamp(m.end, `Membership ${m.id}`);
      if (m.end.seq < m.start.seq || earlierDate(st, m.end, m.start)) bad.push(`Membership ${m.id} ends before it starts.`);
    }
    const formed = Array.isArray(t.log) && t.log[0] && t.log[0].at;
    if (formed && m.start && m.start.seq < formed.seq) bad.push(`Membership ${m.id} starts before ${t.name} formed.`);
    const k = `${m.team}/${m.wrestler}`;
    spells.set(k, [...(spells.get(k) || []), m]);
  });
  spells.forEach(list => {
    list.sort((a, b) => a.start.seq - b.start.seq).forEach((m, i) => {
      const prev = list[i - 1];
      if (prev && (!prev.end || prev.end.seq > m.start.seq)) bad.push(`Membership ${m.id} overlaps an earlier spell on the same team.`);
    });
  });

  names(st.titles, 'championship');
  st.titles.forEach(t => {
    if (!TITLE_KINDS.includes(t.kind) || !DIVISIONS.includes(t.division)) bad.push(`The ${t.name} has an unknown detail.`);
    if (!showOk(t.showId)) bad.push(`The ${t.name} is on a show that doesn't exist.`);
    const open = st.reigns.filter(r => r.titleId === t.id && r.end === null);
    if (open.length > 1) bad.push(`The ${t.name} has ${open.length} champions at once.`);
    if (open.length && !t.active) bad.push(`The ${t.name} is retired but still has a champion.`);
  });
  st.reigns.forEach(r => {
    const t = titleById(st, r.titleId);
    if (!t) { bad.push(`Reign ${r.id} is for a title that doesn't exist.`); return; }
    const holder = r.holder || {};
    const want = t.kind === 'tag' ? 'team' : 'wrestler';
    if (holder.type !== want) bad.push(`Reign ${r.id} on the ${t.name} has the wrong kind of holder.`);
    else if (!(want === 'team' ? teamById(st, holder.id) : wrestlerById(st, holder.id))) {
      bad.push(`Reign ${r.id} on the ${t.name} names a holder who doesn't exist.`);
    }
    stamp(r.start, `Reign ${r.id}`);
    if (r.end) {
      stamp(r.end, `Reign ${r.id}`);
      if (r.end.seq < r.start.seq || earlierDate(st, r.end, r.start)) bad.push(`Reign ${r.id} ends before it starts.`);
    }
    if (r.eventId) {
      const ev = eventById(st, r.eventId);
      if (!ev) bad.push(`Reign ${r.id} was won at an event that doesn't exist.`);
      else if (r.matchId && !ev.matches.some(m => m.id === r.matchId)) bad.push(`Reign ${r.id} was won in a match that doesn't exist.`);
    }
  });

  const active = st.seasons.filter(s => s.status === 'active');
  if (active.length !== 1) bad.push(`There should be exactly one active season, not ${active.length}.`);
  const numbers = new Set();
  st.seasons.forEach(s => {
    if (typeof s.name !== 'string') bad.push(`Season ${s.id} has a name that isn't text.`);
    if (!Number.isInteger(s.number) || s.number < 1) bad.push(`Season ${s.id} has a broken number.`);
    else if (numbers.has(s.number)) bad.push(`Two seasons are numbered ${s.number}.`);
    numbers.add(s.number);
    if (!['active', 'complete'].includes(s.status)) bad.push(`${s.name} has an unknown status.`);
    if (s.start != null && !isIsoDate(s.start)) bad.push(`${s.name} has a start date that isn't a date.`);
    if (!Number.isInteger(s.week) || s.week < 1) bad.push(`${s.name} has a broken week.`);
    stamp(s.started, s.name);
    if (s.status === 'complete') stamp(s.ended, s.name);
  });

  st.events.forEach(e => {
    if (typeof e.name !== 'string' || !e.name.trim()) bad.push(`Event ${e.id} has no name.`);
    if (!Array.isArray(e.matches)) bad.push(`${e.name} has no results list.`);
    if (!EVENT_KINDS.includes(e.kind)) bad.push(`${e.name} has an unknown type.`);
    if (!showOk(e.showId) || (e.kind === 'weekly' && !e.showId)) bad.push(`${e.name} is on a show that doesn't exist.`);
    stamp(e.at, e.name);
    if (e.at && !night(e.at.day)) bad.push(`${e.name} has no night of the week.`);
    (e.matches || []).forEach(m => {
      const where = `A match at ${e.name}`;
      if (!MATCH_STATUSES.includes(m.status)) { bad.push(`${where} is neither booked nor played.`); return; }
      if (m.titleId && !titleById(st, m.titleId)) bad.push(`${where} is for a title that doesn't exist.`);
      const sides = Array.isArray(m.sides) ? m.sides : [];
      if (sides.length < 2) bad.push(`${where} has fewer than two sides.`);
      const seen = new Set();
      sides.forEach(s => {
        const ws = (s && s.wrestlers) || [];
        if (!ws.length) bad.push(`${where} has an empty side.`);
        ws.forEach(id => {
          if (!wrestlerById(st, id)) bad.push(`${where} includes a wrestler who doesn't exist.`);
          if (seen.has(id)) bad.push(`${where} has the same wrestler twice.`);
          seen.add(id);
        });
        if (s && s.team && !teamById(st, s.team)) bad.push(`${where} names a tag team that doesn't exist.`);
      });
      if (m.status === 'scheduled') {
        if (m.outcome !== null || m.winner !== null || m.finish !== null || m.fall !== null) bad.push(`${where} is only booked but has a result.`);
        if (st.reigns.some(r => r.matchId === m.id)) bad.push(`${where} is only booked but changed a title.`);
        return;
      }
      if (!OUTCOMES.includes(m.outcome)) bad.push(`${where} has an unknown result.`);
      if (m.outcome === 'win' && !(Number.isInteger(m.winner) && m.winner >= 0 && m.winner < sides.length)) bad.push(`${where} has no valid winner.`);
      if (m.outcome !== 'win' && m.winner !== null) bad.push(`${where} is a ${m.outcome} but names a winner.`);
      if (m.finish !== null && !FINISHES.includes(m.finish)) bad.push(`${where} has an unknown finish.`);
      if (m.fall != null) {
        const winners = m.outcome === 'win' && sides[m.winner] ? sides[m.winner].wrestlers : [];
        const losers = sides.filter((_, i) => i !== m.winner).flatMap(sd => sd.wrestlers || []);
        if (m.outcome !== 'win') bad.push(`${where} is a ${m.outcome} but names who took the fall.`);
        else if ((m.fall.by && !winners.includes(m.fall.by)) || (m.fall.on && !losers.includes(m.fall.on))) bad.push(`${where} names the fall wrongly.`);
      }
    });
  });
  return bad;
}
