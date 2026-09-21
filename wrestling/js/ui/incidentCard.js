// One piece of trouble, with everything the GM needs to answer it.
//
// Shared by three screens, because trouble turns up in three places: the
// Trouble tab lists everything waiting, the Backstage screen shows what is
// happening in the room you are standing in, and the live show screen puts a
// refusal in front of you because it is stopping the card.
//
// Nothing is hidden. The reasons that produced the incident are printed with
// their weights, and every answer is shown with its odds and, when it is not
// available, the reason why not. An answer the GM cannot see the cost of is a
// coin flip with extra steps.

import * as store from '../core/store.js';
import {
  INCIDENT_SPECS, RESPONSES, severityLabel, isSerious,
} from '../models/incident.js';
import { REACTION_SPECS, REACTION_KINDS } from '../models/reaction.js';
import { optionsFor } from '../systems/incidents.js';
import { locationName } from '../models/location.js';
import { esc, mmss, signed, titleCase } from './format.js';

/** Severity decides the stripe and the tag, so the list scans at a glance. */
export function severityTone(severity) {
  if (severity >= 76) return 'bad';
  if (severity >= 54) return 'warn';
  return '';
}

function tagTone(severity) {
  if (severity >= 76) return 'red';
  if (severity >= 54) return 'amber';
  if (severity >= 31) return 'blue';
  return '';
}

/** "A and B", "A, B and C" - never "A and B and C". */
export function nameList(ids) {
  const names = ids.map(store.nameOf);
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function person(id) {
  const w = store.getWrestler(id);
  if (!w) return '';
  return `<button class="wcard" data-action="go" data-arg="wrestler/${w.id}">
    <span class="who">
      <span class="nm">${esc(w.name)}</span>
      <span class="sub">${esc(titleCase(w.standing.careerStatus))} &middot; morale ${w.state.morale}
        &middot; trusts you ${w.ties.gm.trust}</span>
    </span>
    ${w.state.discipline.warnings ? `<span class="tag amber">${w.state.discipline.warnings} warning${w.state.discipline.warnings === 1 ? '' : 's'}</span>` : ''}
  </button>`;
}

function reasonRow(r) {
  const weight = Number(r.weight);
  return `<div class="kv">
    <span>${esc(r.label || '')}${r.detail ? ` <span class="muted">&middot; ${esc(r.detail)}</span>` : ''}</span>
    <span class="${weight < 0 ? 'pos' : ''}">${Number.isFinite(weight) ? signed(Math.round(weight)) : ''}</span>
  </div>`;
}

/** Who else got involved, and who pointedly did not. */
const REACTION_TONE = {
  [REACTION_KINDS.SAVE]: 'green',
  [REACTION_KINDS.JOIN]: 'red',
  [REACTION_KINDS.INTERFERE]: 'red',
  [REACTION_KINDS.STOOD_BY]: 'amber',
  [REACTION_KINDS.AVOIDED]: '',
};

/**
 * One person's decision about somebody else's trouble.
 *
 * Deciding not to move is shown exactly like deciding to, because it is exactly
 * as much of a decision and the person who was not helped treats it as one.
 */
function reactionRow(r) {
  const spec = REACTION_SPECS[r.kind];
  const about = r.forId || r.againstId;
  const why = r.reasons.filter((x) => x.label).map((x) => esc(x.label)).join(' &middot; ');
  const waiting = r.tick == null;
  return `<div class="slot ${waiting ? '' : 'done'}">
    <span class="what">
      <span class="t">${esc(store.nameOf(r.wrestlerId))}
        <span class="muted">${esc(spec.label.toLowerCase())}${
          about ? ` ${r.againstId ? 'at' : 'for'} ${esc(store.nameOf(about))}` : ''}</span></span>
      <span class="d">${why}${waiting ? ' &middot; on their way' : ''}</span>
    </span>
    <span class="side"><span class="tag ${REACTION_TONE[r.kind] || ''}">${esc(spec.label)}</span></span>
  </div>`;
}


/**
 * What this answer costs, said the way a person would say it.
 *
 * Two different things belong here and only one of them is the odds: a certain
 * answer is not free, it costs show clock, and the clock is the resource the
 * whole live layer is about.
 */
function cost(option) {
  const parts = [];
  if (option.chance < 1) parts.push(`${Math.round(option.chance * 100)}% to land`);
  else if (option.seconds) parts.push('certain');
  if (option.seconds) parts.push(mmss(option.seconds));
  return parts.join(' \u00b7 ') || 'costs you nothing now';
}

function optionButton(incident, option) {
  const why = option.problems[0] || option.blurb;
  const primary = option.ok && (option.key === RESPONSES.TALK || option.key === RESPONSES.MEDIATE);
  return `<button class="act${primary ? ' primary' : ''}${option.key === RESPONSES.SUSPENSION || option.key === RESPONSES.EJECTION ? ' danger' : ''}"
    data-action="respondTo" data-id="${incident.id}" data-response="${option.key}"
    title="${esc(why)}"${option.ok ? '' : ' disabled'}>
    ${esc(option.label)}<em>${option.ok ? esc(cost(option)) : esc(option.problems[0])}</em>
  </button>`;
}

/**
 * Render one incident.
 *
 * `compact` drops the reasons and the people, for the backstage rail where the
 * point is only that something is happening near you.
 */
export function incidentCard(incident, { compact = false } = {}) {
  const spec = INCIDENT_SPECS[incident.kind];
  const known = incident.discoveredTick != null;
  // The incident's OWN log line, not the thing upstream of it: for a refusal
  // the cause is the match that just finished, which is not what happened.
  const started = store.getEvent(incident.startedEventId);
  const line = started?.summary || `${spec.label} in ${locationName(incident.locationId)}`;

  const meta = [
    `${severityLabel(incident.severity)} ${incident.severity}`,
    locationName(incident.locationId),
    `${mmss(incident.tick)} in`,
  ].join(' &middot; ');

  if (!known) {
    // Should never render: the GM is not told about these. Kept as a guard so a
    // future screen cannot accidentally leak one.
    return '';
  }

  const options = optionsFor(incident.id);
  const available = options.filter((o) => o.ok);
  // Only worth showing when this one came out of something else.
  const chain = incident.causeIncidentId ? store.incidentChain(incident.id) : [];

  return `
    <section class="panel trouble ${severityTone(incident.severity)}">
      <div class="head">
        <h2>${esc(spec.label)}</h2>
        <span class="meta">
          <span class="tag ${tagTone(incident.severity)}">${esc(severityLabel(incident.severity))}</span>
          ${esc(locationName(incident.locationId))} &middot; ${mmss(incident.tick)} in
        </span>
      </div>
      <div class="body">
        <p class="sub" style="margin-top:0">${esc(line)}</p>
        ${compact ? '' : `<div class="sheet">${incident.participantIds.map(person).join('')}</div>`}

        ${compact || !incident.reasons.length ? '' : `
          <h3>Why it happened</h3>
          ${incident.reasons.map(reasonRow).join('')}`}

        ${compact || !incident.reactions.length ? '' : `
          <h3>Who else got involved</h3>
          <div class="sheet">${incident.reactions.map(reactionRow).join('')}</div>`}

        ${compact || !chain.length ? '' : `
          <h3>How it got here</h3>
          <div class="log narrow">${chain.map((link, i) => `<div class="ev">
            <span class="d">${i + 1}</span>
            <span>${esc(store.getEvent(link.startedEventId)?.summary || link.kind)}</span>
          </div>`).join('')}</div>`}

        <h3>What you can do</h3>
        ${incident.attempted.length ? `<p class="sub">Already tried:
          ${incident.attempted.map((a) => esc(options.find((o) => o.key === a)?.label || a)).join(', ')}</p>` : ''}
        <div class="opts">${options.map((o) => optionButton(incident, o)).join('')}</div>
        ${available.length ? '' : '<p class="empty">Nothing is available from here. Walk to them, or wait.</p>'}
      </div>
    </section>`;
}

/** A one-line version for a list of things that already happened. */
export function incidentRow(incident) {
  const spec = INCIDENT_SPECS[incident.kind];
  const options = incident.response
    ? `<span class="tag ${incident.outcome?.landed === false ? 'red' : 'green'}">${esc(incident.response.replace(/_/g, ' '))}</span>`
    : '<span class="tag">left as it was</span>';
  return `<div class="slot ${isSerious(incident) ? 'next' : 'done'}">
    <span class="idx">${esc(severityLabel(incident.severity)[0])}</span>
    <span class="what">
      <span class="t">${esc(incident.outcome?.summary || spec.label)}</span>
      <span class="d">${esc(nameList(incident.participantIds))}
        &middot; ${esc(locationName(incident.locationId))}
        &middot; ${esc(severityLabel(incident.severity))} ${incident.severity}
        ${incident.discoveredTick == null ? '&middot; you never found out' : ''}</span>
    </span>
    <span class="side">${options}</span>
  </div>`;
}

/**
 * A whole chain as an indented list, root first.
 *
 * This is the shape Tier 9 exists to produce, so it gets shown as a shape: one
 * thing, then the thing it turned into, with who stepped in at each step.
 */
export function chainRows(root) {
  const walk = (incident) => [incident, ...store.incidentsCausedBy(incident.id).flatMap(walk)];
  return walk(root).map((link) => {
    const acts = link.reactions.filter((r) => r.tick != null && REACTION_SPECS[r.kind].acts);
    const depth = link.chainDepth;
    return `<div class="slot ${depth ? 'done' : 'next'}" style="margin-left:${depth * 1.1}rem">
      <span class="idx">${depth ? '&#8627;' : '&#9679;'}</span>
      <span class="what">
        <span class="t">${esc(store.getEvent(link.startedEventId)?.summary
          || INCIDENT_SPECS[link.kind].label)}</span>
        <span class="d">${esc(severityLabel(link.severity))} ${link.severity}${
          acts.length
            ? ` &middot; ${acts.map((r) => `${esc(store.nameOf(r.wrestlerId))} ${esc(REACTION_SPECS[r.kind].label.toLowerCase())}`).join(', ')}`
            : ''}</span>
      </span>
    </div>`;
  }).join('');
}
