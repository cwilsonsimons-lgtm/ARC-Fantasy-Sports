// The roster rail: everybody, grouped by where they sit on the card.
//
// The stripe down the left of each name is their morale, because that is the
// thing a GM most wants to catch out of the corner of their eye. The tag on the
// right is what they are currently feeling.

import * as store from '../core/store.js';
import { CAREER_ORDER, statusRank } from '../models/wrestler.js';
import { satisfactionOf } from '../systems/satisfaction.js';
import { esc, titleCase } from './format.js';

/** Search and filter state for the rail. Per session, not per save. */
export const railFilter = { text: '', only: 'all' };

export function setRailText(v) { railFilter.text = String(v || ''); }
export function setRailOnly(v) { railFilter.only = v || 'all'; }

const GROUP_LABEL = {
  superstar: 'Superstars', main_event: 'Main Eventers', upper_midcard: 'Upper Midcarders',
  midcard: 'Midcarders', lower_card: 'Lower Card', jobber: 'Jobbers', rookie: 'Rookies',
};

function moraleTone(m) {
  if (m >= 60) return 'good';
  if (m >= 38) return 'warn';
  return 'bad';
}

function moodTag(w) {
  const m = w.state.morale;
  if (m >= 60) return '<span class="tag green">Content</span>';
  if (m >= 38) return '<span class="tag amber">Restless</span>';
  return '<span class="tag red">Unhappy</span>';
}

function matches(w) {
  const text = railFilter.text.trim().toLowerCase();
  if (text && !w.name.toLowerCase().includes(text)) return false;
  if (railFilter.only === 'champions' && !store.titlesHeldBy(w.id).length) return false;
  if (railFilter.only === 'asking' && !store.openRequestsFor(w.id).length) return false;
  if (railFilter.only === 'unhappy' && w.state.morale >= 38) return false;
  return true;
}

/**
 * The whole rail as one panel.
 * `pair` puts two wrestlers per row, which is what the wider layouts want.
 */
export function rosterRailHtml({ pair = false } = {}) {
  const all = store.allWrestlers();
  const shown = all.filter(matches);

  const groups = [...CAREER_ORDER].reverse().map((status) => {
    const people = shown
      .filter((w) => w.standing.careerStatus === status)
      .sort((a, b) => (a.standing.rank ?? 99) - (b.standing.rank ?? 99));
    if (!people.length) return '';

    const cards = people.map((w) => {
      const belts = store.titlesHeldBy(w.id);
      const asks = store.openRequestsFor(w.id).length;
      return `<button class="wcard ${moraleTone(w.state.morale)}"
          data-action="go" data-arg="wrestler/${w.id}" title="${esc(w.name)}">
        <span class="who">
          <span class="nm">${esc(w.name)}</span>
          <span class="sub">#${w.standing.rank ?? '-'} &middot; ${w.standing.wins}-${w.standing.losses}${belts.length ? ` &middot; ${esc(belts[0].shortName)}` : ''}${asks ? ` &middot; ${asks} asking` : ''}</span>
        </span>
        ${moodTag(w)}
      </button>`;
    }).join('');

    return `<div class="rgroup">${GROUP_LABEL[status] || titleCase(status)} <span class="n">(${people.length})</span></div>
      <div class="rgrid${pair ? ' pair' : ''}">${cards}</div>`;
  }).join('');

  const filters = [
    ['all', 'All'], ['champions', 'Champions'], ['asking', 'Asking'], ['unhappy', 'Unhappy'],
  ].map(([key, label]) =>
    `<button class="act ${railFilter.only === key ? 'primary' : ''}" data-action="railOnly" data-arg="${key}">${label}</button>`
  ).join('');

  return `<section class="panel">
    <div class="head">
      <span class="title">Roster</span>
      <span class="meta">${shown.length}${shown.length !== all.length ? ` of ${all.length}` : ''} wrestlers</span>
    </div>
    <div class="body">
      <input id="railSearch" data-action="railSearch" type="text" placeholder="Search wrestlers..."
        value="${esc(railFilter.text)}" autocomplete="off">
      <div class="bar" style="margin:.5rem 0 0">${filters}</div>
    </div>
    <div class="body flush">${groups || '<p class="empty">Nobody matches.</p>'}</div>
  </section>`;
}
