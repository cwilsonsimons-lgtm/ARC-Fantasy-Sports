// Championships: who holds what, for how long, and what happens when it changes
// hands.
//
// A title is optional in every sense. You need not book for it, and you may
// retire any of them — including the three you start with — if a promotion with
// fewer belts is the one you want to run.
import { byId } from './wrestlers.js';
import { createEntry } from './journal.js';
import { nextId } from '../ids.js';
import { remember } from './memory.js';
import { BASE_TITLES, UNLOCKABLE_TITLES, SLOT_THRESHOLDS, titleTemplate } from '../data/titles.js';

function createTitle(template, championIds, week) {
  return {
    id: nextId('t'),
    key: template.key,
    name: template.name,
    holders: template.holders,
    gender: template.gender,
    tier: template.tier,
    base: BASE_TITLES.some(t => t.key === template.key),
    active: true,
    championIds: [...championIds],
    since: week,
    defenses: 0,
    lineage: championIds.length
      ? [{ championIds: [...championIds], wonWeek: week, lostWeek: null, defenses: 0 }]
      : [],
  };
}

export function eligibleFor(wrestlers, title) {
  return wrestlers.filter(w =>
    w.status === 'Available' && (!title.gender || w.gender === title.gender));
}

// A new promotion already has champions. Vacant belts on day one read as a
// promotion that has not started yet.
export function seedTitles(wrestlers, rng) {
  const taken = new Set();
  const titles = [];

  for (const template of BASE_TITLES) {
    const pool = wrestlers
      .filter(w => w.status === 'Available' && !taken.has(w.id) && (!template.gender || w.gender === template.gender))
      .sort((a, b) => rank(b) - rank(a));

    const champions = pool.slice(0, template.holders).map(w => w.id);
    if (champions.length < template.holders) continue; // not enough of that division to crown one
    champions.forEach(id => taken.add(id));
    titles.push(createTitle(template, champions, 1 - Math.floor(rng() * 12)));
  }
  return titles;
}

function rank(wrestler) {
  const roleWeight = { 'Main event': 30, 'Upper card': 18, Midcard: 8, Opener: 4, Prospect: 2 };
  return wrestler.stats.inRing + (roleWeight[wrestler.role] || 0);
}

export function activeTitles(state) {
  return (state.titles || []).filter(t => t.active);
}

export function titleById(state, id) {
  return (state.titles || []).find(t => t.id === id) || null;
}

export function heldBy(state, wrestlerId) {
  return activeTitles(state).filter(t => t.championIds.includes(wrestlerId));
}

// Which belts could plausibly be on the line in this match.
//
// A belt held by two people needs every side to be a pair; a singles belt needs
// every side to be one person — which means a singles title can now be defended
// in a fatal four-way or a battle royal, because every side in one of those is
// a single wrestler. A locked division needs everyone in the match to belong to
// it.
export function titlesForMatch(state, participantIds, sides) {
  const shape = Array.isArray(sides) && sides.length >= 2 ? sides : [1, 1];
  return activeTitles(state).filter(title => {
    if (!shape.every(size => size === title.holders)) return false;
    if (!title.gender) return true;
    return participantIds.every(id => {
      const wrestler = byId(state.wrestlers, id);
      return wrestler && wrestler.gender === title.gender;
    });
  });
}

export function reignWeeks(state, title) {
  return Math.max(0, state.week - title.since);
}

// ---------- slots ----------

export function slotsEarned(state) {
  const trust = state.network ? state.network.trust : 0;
  return SLOT_THRESHOLDS.filter(threshold => trust >= threshold).length;
}

export function slotsUsed(state) {
  return (state.titles || []).filter(t => !t.base).length;
}

export function nextSlotAt(state) {
  return SLOT_THRESHOLDS[slotsUsed(state)] || null;
}

export function availableToAdd(state) {
  const have = new Set((state.titles || []).map(t => t.key));
  return UNLOCKABLE_TITLES.filter(t => !have.has(t.key));
}

export function addTitle(state, key) {
  if (slotsUsed(state) >= slotsEarned(state)) return null;
  const template = titleTemplate(key);
  if (!template || (state.titles || []).some(t => t.key === key)) return null;

  // A new belt starts vacant. Somebody has to win it.
  const title = createTitle(template, [], state.week);
  state.titles = state.titles || [];
  state.titles.push(title);

  state.journal.push(createEntry({
    week: state.week, at: 0, type: 'title-created', data: { titleId: title.id },
  }));
  return title;
}

export function retireTitle(state, id) {
  const title = titleById(state, id);
  if (!title) return null;
  title.active = false;
  closeReign(title, state.week);
  title.championIds = [];
  return title;
}

export function reinstateTitle(state, id) {
  const title = titleById(state, id);
  if (!title) return null;
  title.active = true;
  return title;
}

// ---------- changing hands ----------

function closeReign(title, week) {
  const current = title.lineage[title.lineage.length - 1];
  if (current && current.lostWeek === null) {
    current.lostWeek = week;
    current.defenses = title.defenses;
  }
}

// Called once a title match has a winner. Returns what happened so the journal
// and the post-show can say it.
export function settleTitleMatch(state, title, winnerIds, at = 0) {
  if (!title || !title.active || !winnerIds.length) return null;

  const held = title.championIds.length
    && winnerIds.every(id => title.championIds.includes(id))
    && title.championIds.every(id => winnerIds.includes(id));

  // A major belt is the best and worst thing that happens to somebody all year,
  // and has to outweigh the ordinary lift of having been on the show at all —
  // otherwise you can lose a world title and finish the night happier.
  const weight = title.tier === 'major' ? 18 : 11;

  if (held) {
    title.defenses += 1;
    for (const id of winnerIds) bump(state, id, title.tier === 'major' ? 5 : 3, 'defended');
    state.journal.push(createEntry({
      week: state.week, at, type: 'title-defended',
      data: { titleId: title.id, championIds: [...winnerIds] },
    }));
    return { changed: false, title };
  }

  const formerIds = [...title.championIds];
  closeReign(title, state.week);

  title.championIds = [...winnerIds];
  title.since = state.week;
  title.defenses = 0;
  title.lineage.push({ championIds: [...winnerIds], wonWeek: state.week, lostWeek: null, defenses: 0 });

  // Winning one of these is the best night of somebody's year. Losing it is not.
  for (const id of winnerIds) bump(state, id, weight, 'won');
  for (const id of formerIds) bump(state, id, -weight, 'lost');

  state.journal.push(createEntry({
    week: state.week, at, type: 'title-change',
    data: { titleId: title.id, championIds: [...winnerIds], formerIds },
  }));
  return { changed: true, title, formerIds };
}

function bump(state, wrestlerId, amount, detail) {
  remember(state, wrestlerId, { source: 'title', weight: amount, detail });
}

// Being champion is worth something every week, quietly.
export function championMorale(state) {
  for (const title of activeTitles(state)) {
    for (const id of title.championIds) bump(state, id, 1, 'carrying-it');
  }
}
