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
      <span class="d">${esc(incident.participantIds.map(store.nameOf).join(' and '))}
        &middot; ${esc(locationName(incident.locationId))}
        &middot; ${esc(severityLabel(incident.severity))} ${incident.severity}
        ${incident.discoveredTick == null ? '&middot; you never found out' : ''}</span>
    </span>
    <span class="side">${options}</span>
  </div>`;
}
