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

export const APP_ID = 'wwe-universe';
export const SCHEMA_VERSION = 1;

export class UniverseError extends Error {
  constructor(message) { super(message); this.name = 'UniverseError'; }
}
function fail(message) { throw new UniverseError(message); }

// The four shows. Roster sizes are whatever the owner makes them - nothing
// here caps a show or expects them to match.
export const SHOW_SEED = [
  { id: 'raw',       name: 'Raw',       promotion: 'WWE', color: '#E23B2E' },
  { id: 'smackdown', name: 'SmackDown', promotion: 'WWE', color: '#2F6BFF' },
  { id: 'dynamite',  name: 'Dynamite',  promotion: 'AEW', color: '#D8A93B' },
  { id: 'nxt',       name: 'NXT',       promotion: 'WWE', color: '#C4CAD3' },
];

export const GENDERS     = ['male', 'female'];
export const ORIGINS     = ['WWE', 'AEW', 'NXT', 'Other'];   // where a wrestler comes from, not where they are
export const ALIGNMENTS  = ['face', 'heel', 'tweener'];
export const STATUSES    = ['active', 'injured'];
export const TITLE_KINDS = ['singles', 'tag'];
export const DIVISIONS   = ['men', 'women', 'open'];
export const EVENT_KINDS = ['weekly', 'ple'];                 // a weekly episode, or a premium live event
export const OUTCOMES    = ['win', 'draw', 'nc'];             // nc = no contest
export const FINISHES    = ['pinfall', 'submission', 'dq', 'countout', 'ko', 'other'];

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
function stampAt(st, seasonId, week) { return { season: seasonId, week, seq: ++st.seq }; }
const seasonNo = (st, id) => (seasonById(st, id) || { number: 0 }).number;
/**
 * Order two stamps by the universe's calendar - season, then week - and only
 * then by the order they were entered. Entry order alone is wrong as soon as
 * a show is backfilled into an earlier week.
 */
export function compareStamps(st, a, b) {
  return seasonNo(st, a.season) - seasonNo(st, b.season) || a.week - b.week || a.seq - b.seq;
}
// true when `a` falls in an earlier week than `b` (the same week is not earlier)
const earlierWeek = (st, a, b) => (seasonNo(st, a.season) - seasonNo(st, b.season) || a.week - b.week) < 0;
const weekLabel = (st, s) => `season ${seasonNo(st, s.season)}, week ${s.week}`;
function now(st) {
  const s = activeSeason(st);
  return stampAt(st, s.id, s.week);
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
  if (showId) recordMove(st, w, showId, '');
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

function recordMove(st, w, to, note) {
  const move = { id: newId(st, 'mv'), wrestler: w.id, from: w.showId, to, at: now(st), note: cleanName(note) };
  st.moves.push(move);
  w.showId = to;
  return move;
}

/**
 * Put a wrestler on a show, or pass null / '' to leave them unassigned.
 * Returns the recorded move, or null when they were already there.
 */
export function assignWrestler(st, id, showId, note = '') {
  const w = must(wrestlerById(st, id), 'wrestler', id);
  const to = checkShowId(st, showId);
  if (w.showId === to) return null;
  if (cleanName(note).length > MAX_NAME) fail(`That note is too long (${MAX_NAME} characters max).`);
  return recordMove(st, w, to, note);
}

/** What stops a wrestler from being deleted - empty when nothing does. */
export function wrestlerRefs(st, id) {
  const refs = [];
  const teams = st.teams.filter(t => t.members.includes(id)).length;
  if (teams) refs.push(teams === 1 ? 'a tag team' : `${teams} tag teams`);
  const reigns = st.reigns.filter(r => r.holder.type === 'wrestler' && r.holder.id === id).length;
  if (reigns) refs.push(reigns === 1 ? 'a title reign' : `${reigns} title reigns`);
  const matches = matchesOf(st, id).length;
  if (matches) refs.push(matches === 1 ? 'a match' : `${matches} matches`);
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

function teamFields(st, input, self) {
  const name = has(input, 'name') || !self ? checkName(st.teams, input.name, 'tag team', self && self.id) : self.name;
  let members = self ? self.members : [];
  if (has(input, 'members') || !self) {
    const ids = (input.members || []).filter(x => x != null && x !== '');
    ids.forEach(m => must(wrestlerById(st, m), 'wrestler', m));
    if (new Set(ids).size !== ids.length) fail('A wrestler can only be on a team once.');
    if (ids.length < 2) fail('A tag team needs at least two wrestlers.');
    members = [...ids];
  }
  return { name, members };
}

/** A team of two or more. A wrestler may be on several teams at once. */
export function addTeam(st, input = {}) {
  const fields = teamFields(st, input, null);
  const team = { id: newId(st, 'tm'), ...fields, active: true, formed: now(st), disbanded: null };
  st.teams.push(team);
  return team;
}

export function updateTeam(st, id, patch = {}) {
  const t = must(teamById(st, id), 'tag team', id);
  Object.assign(t, teamFields(st, patch, t));
  return t;
}

/** Disband (false) or reunite (true). A team holding a title can't disband. */
export function setTeamActive(st, id, active) {
  const t = must(teamById(st, id), 'tag team', id);
  if (!!active === t.active) return t;
  if (!active) {
    const held = titlesHeldBy(st, { type: 'team', id });
    if (held.length) fail(`${t.name} hold the ${held[0].name}. Vacate it or crown new champions first.`);
    t.active = false;
    t.disbanded = now(st);
  } else {
    t.active = true;
    t.disbanded = null;
  }
  return t;
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
}

export function teamsOf(st, wrestlerId) {
  return st.teams.filter(t => t.members.includes(wrestlerId));
}
/** The shows a team's members are on. More than one means the team is split. */
export function teamShows(st, team) {
  return [...new Set(team.members.map(id => (wrestlerById(st, id) || {}).showId || null))];
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

function checkHolder(st, title, holder) {
  if (!holder || !holder.id) fail('Pick who holds the title.');
  if (title.kind === 'tag') {
    if (holder.type !== 'team') fail(`The ${title.name} is a tag title, so a tag team has to hold it.`);
    const team = must(teamById(st, holder.id), 'tag team', holder.id);
    if (!team.active) fail(`${team.name} have disbanded.`);
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
  if (cur && earlierWeek(st, when, cur.start)) {
    fail(`The current ${title.name} reign began in ${weekLabel(st, cur.start)}, later than ${weekLabel(st, when)}. `
      + 'Title changes have to be recorded in order - undo the later one first.');
  }
}
const dateOf = (st, ev) => (ev ? { season: ev.at.season, week: ev.at.week }
  : { season: activeSeason(st).id, week: activeSeason(st).week });

/**
 * Crown a new champion. The current reign, if any, ends at the moment the new
 * one begins. With `eventId` (and `matchId`) the change is dated to that show;
 * otherwise to the current week.
 */
export function setChampion(st, titleId, holder, opts = {}) {
  const ev = opts.eventId ? must(eventById(st, opts.eventId), 'event', opts.eventId) : null;
  const { holder: h, cur } = champChecks(st, titleId, holder, dateOf(st, ev));
  if (opts.matchId && !(ev && ev.matches.some(m => m.id === opts.matchId))) fail('That match is not on that event.');
  const note = cleanName(opts.note);
  if (note.length > MAX_NAME) fail(`That note is too long (${MAX_NAME} characters max).`);
  const at = ev ? stampAt(st, ev.at.season, ev.at.week) : now(st);
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

export function holderName(st, holder) {
  if (!holder) return 'Vacant';
  const x = holder.type === 'team' ? teamById(st, holder.id) : wrestlerById(st, holder.id);
  return x ? x.name : '(missing)';
}

// ---------------------------------------------------------------- seasons

function openSeason(st, number, name) {
  const id = newId(st, 's');
  const season = { id, number, name: cleanName(name) || `Season ${number}`, week: 1, status: 'active',
    started: null, ended: null };
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

/**
 * A weekly episode (needs a show) or a premium live event (a show is optional -
 * leave it empty for a PLE shared by every brand). New events go in the active
 * season, in the current week unless `week` says otherwise.
 */
export function addEvent(st, input = {}) {
  const season = activeSeason(st);
  const kind = oneOf(input.kind || 'weekly', EVENT_KINDS, 'event type');
  const showId = checkShowId(st, input.showId);
  if (kind === 'weekly' && !showId) fail('Pick which show this episode is.');
  const week = input.week == null || input.week === '' ? season.week : checkWeek(input.week);
  const name = eventName(st, kind, showId, week, input.name);
  const notes = checkText(input.notes, 'Notes');
  const ev = { id: newId(st, 'ev'), name, kind, showId, at: stampAt(st, season.id, week), notes, matches: [] };
  st.events.push(ev);
  return ev;
}

export function updateEvent(st, id, patch = {}) {
  const ev = must(eventById(st, id), 'event', id);
  const kind = has(patch, 'kind') ? oneOf(patch.kind, EVENT_KINDS, 'event type') : ev.kind;
  const showId = has(patch, 'showId') ? checkShowId(st, patch.showId) : ev.showId;
  if (kind === 'weekly' && !showId) fail('A weekly episode needs a show.');
  let week = ev.at.week;
  if (has(patch, 'week')) {
    week = checkWeek(patch.week);
    if (week !== ev.at.week && st.reigns.some(r => r.eventId === id)) {
      fail('A title changed hands at this event, so its week is fixed. Undo that title change first.');
    }
  }
  const name = has(patch, 'name') ? eventName(st, kind, showId, week, patch.name) : ev.name;
  const notes = has(patch, 'notes') ? checkText(patch.notes, 'Notes') : ev.notes;
  Object.assign(ev, { kind, showId, name, notes });
  ev.at.week = week;
  return ev;
}

export function deleteEvent(st, id) {
  const ev = must(eventById(st, id), 'event', id);
  if (st.reigns.some(r => r.eventId === id)) fail(`A title changed hands at ${ev.name}. Undo that title change before deleting the event.`);
  removeWhere(st.events, e => e.id === id);
}

/** Events in a season, oldest first. */
export function eventsIn(st, seasonId) {
  return st.events.filter(e => e.at.season === seasonId)
    .sort((a, b) => a.at.week - b.at.week || a.at.seq - b.at.seq);
}

// ---------------------------------------------------------------- match results

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
    if (team) must(teamById(st, team), 'tag team', team);
    return { wrestlers: [...ids], team };
  });
}

function holderFromSide(title, side) {
  if (title.kind === 'tag') {
    if (!side.team) fail(`The ${title.name} is a tag title - pick the tag team on the winning side.`);
    return { type: 'team', id: side.team };
  }
  if (side.wrestlers.length !== 1) fail(`The ${title.name} is a singles title - the winning side has to be one wrestler.`);
  return { type: 'wrestler', id: side.wrestlers[0] };
}

/**
 * Record a result the game produced. Each side lists its wrestlers, plus the
 * tag team they wrestled as, if any. `winner` is the index of the winning side
 * when the outcome is 'win'.
 *
 * With `opts.titleChange`, the winning side becomes champion of `titleId`,
 * dated to this event. Nothing is inferred: a title match where the champion
 * retained is just a title match.
 */
export function recordMatch(st, eventId, input = {}, opts = {}) {
  const ev = must(eventById(st, eventId), 'event', eventId);
  const sides = normalizeSides(st, input.sides);
  const outcome = oneOf(input.outcome || 'win', OUTCOMES, 'result');
  let winner = null;
  if (outcome === 'win') {
    winner = input.winner === '' || input.winner == null ? NaN : Number(input.winner);
    if (!Number.isInteger(winner) || winner < 0 || winner >= sides.length) fail('Pick who won.');
  }
  const finish = input.finish == null || input.finish === '' ? null : oneOf(input.finish, FINISHES, 'finish');
  const title = input.titleId ? must(titleById(st, input.titleId), 'championship', input.titleId) : null;
  if (title && !title.active) fail(`The ${title.name} is retired.`);
  const stip = cleanName(input.stip);
  if (stip.length > MAX_NAME) fail(`That stipulation is too long (${MAX_NAME} characters max).`);
  const notes = checkText(input.notes, 'Notes');

  let holder = null;
  if (opts.titleChange) {
    if (!title) fail('Pick the title that changed hands.');
    if (outcome !== 'win') fail('A title only changes hands when someone wins.');
    holder = champChecks(st, title.id, holderFromSide(title, sides[winner]), dateOf(st, ev)).holder;
  }

  const match = { id: newId(st, 'm'), sides, outcome, winner, finish, titleId: title ? title.id : null, stip, notes };
  ev.matches.push(match);
  if (holder) setChampion(st, title.id, holder, { eventId: ev.id, matchId: match.id });
  return match;
}

export function deleteMatch(st, eventId, matchId) {
  const ev = must(eventById(st, eventId), 'event', eventId);
  must(ev.matches.find(m => m.id === matchId), 'match', matchId);
  const reign = st.reigns.find(r => r.matchId === matchId);
  if (reign) fail(`The ${titleById(st, reign.titleId).name} changed hands in this match. Undo that title change first.`);
  removeWhere(ev.matches, m => m.id === matchId);
}

function eachMatch(st, fn) {
  st.events.forEach(ev => ev.matches.forEach(m => fn(m, ev)));
}
/** Every match a wrestler was in, newest first: [{ event, match, side }]. */
export function matchesOf(st, wrestlerId) {
  const out = [];
  eachMatch(st, (match, event) => {
    const side = match.sides.findIndex(s => s.wrestlers.includes(wrestlerId));
    if (side >= 0) out.push({ event, match, side });
  });
  return out.sort((a, b) => compareStamps(st, b.event.at, a.event.at));
}
/** 'W', 'L', 'D' or 'NC' for whoever was on side `side`. */
export function resultFor(match, side) {
  if (match.outcome === 'draw') return 'D';
  if (match.outcome === 'nc') return 'NC';
  return match.winner === side ? 'W' : 'L';
}

// ---------------------------------------------------------------- history

/**
 * Everything that happened, newest first by the universe's calendar, built
 * from the records themselves rather than kept as a second copy - so it can
 * never disagree with them.
 * Each entry: { type, seq, season, week, rec } where `rec` is the season,
 * roster move, team, reign or event the entry came from.
 */
export function timeline(st) {
  const out = [];
  const at = (stamp, type, rec) => out.push({ type, seq: stamp.seq, season: stamp.season, week: stamp.week, rec });
  st.seasons.forEach(s => {
    at(s.started, 'season-start', s);
    if (s.ended) at(s.ended, 'season-end', s);
  });
  st.moves.forEach(m => at(m.at, 'move', m));
  st.teams.forEach(t => {
    at(t.formed, 'team-formed', t);
    if (t.disbanded) at(t.disbanded, 'team-disbanded', t);
  });
  st.reigns.forEach(r => {
    at(r.start, 'title-won', r);
    if (r.vacated) at(r.end, 'title-vacated', r);
  });
  st.events.forEach(e => at(e.at, 'event', e));
  return out.sort((a, b) => compareStamps(st, b, a));
}

export function summary(st) {
  let matches = 0;
  eachMatch(st, () => { matches++; });
  return {
    wrestlers: st.wrestlers.length, teams: st.teams.length, titles: st.titles.length,
    events: st.events.length, matches, seasons: st.seasons.length,
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
  // Version 1 is the first schema, so there is nothing to upgrade yet. A future
  // change adds a step here - if (st.version === 1) { ...; st.version = 2; } -
  // so every older save walks forward one version at a time.
  for (const k of ['shows', 'wrestlers', 'moves', 'teams', 'titles', 'reigns', 'seasons', 'events']) {
    if (!Array.isArray(st[k])) st[k] = [];
  }
  if (!Number.isInteger(st.nextId) || st.nextId < 1) st.nextId = 1;
  if (!Number.isInteger(st.seq) || st.seq < 0) st.seq = 0;
  SHOW_SEED.forEach(seed => { if (!showById(st, seed.id)) st.shows.push({ ...seed }); });
  if (!st.seasons.length) openSeason(st, 1, '');
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
  st.shows.forEach(s => {
    if (!/^#[0-9a-f]{3,8}$/i.test(String(s.color))) bad.push(`${s.name} has an unreadable colour.`);
    if (typeof s.promotion !== 'string') bad.push(`${s.name} has no promotion.`);
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
    }
    stamp(t.formed, t.name);
    if (t.active === !!t.disbanded) bad.push(`${t.name} are marked both active and disbanded, or neither.`);
    if (t.disbanded) stamp(t.disbanded, t.name);
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
      if (r.end.seq < r.start.seq || earlierWeek(st, r.end, r.start)) bad.push(`Reign ${r.id} ends before it starts.`);
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
    (e.matches || []).forEach(m => {
      const where = `A match at ${e.name}`;
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
      if (!OUTCOMES.includes(m.outcome)) bad.push(`${where} has an unknown result.`);
      if (m.outcome === 'win' && !(Number.isInteger(m.winner) && m.winner >= 0 && m.winner < sides.length)) bad.push(`${where} has no valid winner.`);
      if (m.outcome !== 'win' && m.winner !== null) bad.push(`${where} is a ${m.outcome} but names a winner.`);
      if (m.finish !== null && !FINISHES.includes(m.finish)) bad.push(`${where} has an unknown finish.`);
      if (m.titleId && !titleById(st, m.titleId)) bad.push(`${where} was for a title that doesn't exist.`);
    });
  });
  return bad;
}
