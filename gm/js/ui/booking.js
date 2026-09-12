// Build the card for the next show: add, remove, reorder and retime items.
import { el } from './dom.js';
import { commit, notify } from '../store.js';
import {
  addItem, createMatch, createBout, createSegment, removeItem, moveItem, setItemMinutes,
  setItemMatchType, minimumMinutes, bookedMinutes, remainingMinutes, isOverbooked,
} from '../model/show.js';
import { titlesForMatch } from '../model/titles.js';
import { MATCH_TYPES, matchType, DEFAULT_MATCH_TYPE } from '../data/match-types.js';
import {
  PRESETS, preset, shapeName, shapeMinutes, evenSides, MAX_SIDES, MAX_PER_SIDE,
} from '../data/shapes.js';
import { tasteReading } from '../model/match-types.js';
import { byId } from '../model/wrestlers.js';
import { PHASES, canEditCard, startShow } from '../model/game.js';
import { typeLabel } from './labels.js';
import { itemLabelNodes, participantLinks, wrestlerLink } from './links.js';
import { bookable } from '../model/morale.js';
import { moodWord, moodClass } from './mood.js';
import { tierOf, nextTier } from '../model/network.js';
import { listOpportunities, takeOpportunity, dismissOpportunity } from '../model/opportunities.js';
import { nameOf } from '../model/wrestlers.js';

// Half-typed form values live here rather than in game state, so a redraw
// (triggered by any commit) does not wipe what the user is in the middle of.
const draft = {
  matchA: '', matchB: '', matchMinutes: 10, matchError: '', matchTypeId: DEFAULT_MATCH_TYPE, matchTitle: '',
  // The bigger-match builder. `slots` is a flat list of chosen ids in side
  // order; `sides` says where the cuts are. A slot left empty simply shrinks
  // that side, which is how a handicap match gets booked without a shape of
  // its own.
  shapeId: 'tag',
  sides: [2, 2],
  slots: [],
  royal: new Set(),
  boutTypeId: DEFAULT_MATCH_TYPE,
  boutMinutes: '',
  boutTitle: '',
  boutError: '',
  segName: '', segParticipants: new Set(), segMinutes: 5, segError: '',
};

export function renderBooking(state, navigate) {
  const { show } = state;
  const locked = !canEditCard(state);

  return el('section', {},
    el('h2', { text: `Week ${state.week} — Booking` }),
    locked ? lockedNotice(state, navigate) : null,
    totals(state, show),
    isOverbooked(show)
      ? el('div', {
          class: 'notice warn',
          text: `Overbooked by ${bookedMinutes(show) - show.runtimeMinutes} minutes. You can still run this card.`,
        })
      : null,
    cardTable(state, show, locked),
    opportunityPanel(state, locked),
    offTheCard(state),
    locked ? null : addMatchPanel(state),
    locked ? null : addBoutPanel(state),
    locked ? null : addSegmentPanel(state),
    el('div', {},
      el('button', {
        type: 'button',
        class: 'btn primary',
        text: 'Start Show',
        disabled: locked || show.items.length === 0,
        onClick: () => {
          commit(s => startShow(s));
          navigate('live');
        },
      }),
      show.items.length === 0
        ? el('span', { class: 'muted', text: '  Add at least one item to start the show.' })
        : null
    )
  );
}

function lockedNotice(state, navigate) {
  const onAir = state.phase === PHASES.LIVE;
  return el('div', { class: 'notice' },
    onAir
      ? 'A show is currently on the air, so the card is locked. '
      : `Week ${state.week} is over. Advance the week to book the next show. `,
    el('button', {
      type: 'button', class: 'link',
      text: onAir ? 'Go to the live show' : 'Go to the aftermath',
      onClick: () => navigate('live'),
    })
  );
}

function totals(state, show) {
  const left = remainingMinutes(show);
  const next = nextTier(state);
  return el('div', {},
    el('div', { class: 'totals' },
      el('div', {}, 'Show Length: ', el('b', { text: `${show.runtimeMinutes} minutes` })),
      el('div', {}, 'Time Booked: ', el('b', { text: `${bookedMinutes(show)} minutes` })),
      el('div', {}, 'Time Remaining: ',
        el('b', { class: left < 0 ? 'over' : '', text: `${left} minutes` })
      )
    ),
    el('p', { class: 'net-note muted', text: next
      ? `${tierOf(state).label}. Network trust ${state.network.trust} of ${next.trust} toward ${next.minutes} minutes.`
      : `${tierOf(state).label}. There is no more airtime to earn.` })
  );
}

function cardTable(state, show, locked) {
  if (!show.items.length) {
    return el('p', { class: 'empty', text: 'No items on the card yet.' });
  }

  const rows = show.items.map((item, index) =>
    el('tr', {},
      el('td', { class: 'num', text: index + 1 }),
      el('td', {}, item.type === 'match'
        ? el('select', {
            class: 'stip',
            disabled: locked,
            onChange: e => commit(s => setItemMatchType(s.show, item.id, e.target.value)),
          }, MATCH_TYPES.map(t => el('option', {
            value: t.id, selected: t.id === item.matchType, text: t.name,
          })))
        : el('span', { text: typeLabel(item) })),
      el('td', {}, itemLabelNodes(state, item)),
      el('td', { class: 'muted' }, participantLinks(state, item.participants)),
      el('td', { class: 'num' },
        el('input', {
          type: 'number', min: String(minimumMinutes(item)), value: item.plannedMinutes, disabled: locked,
          title: `Minimum ${minimumMinutes(item)} minutes`,
          onChange: e => commit(s => setItemMinutes(s.show, item.id, e.target.value)),
        })
      ),
      el('td', {},
        el('button', {
          type: 'button', class: 'btn small', text: 'Up',
          disabled: locked || index === 0,
          onClick: () => commit(s => moveItem(s.show, item.id, -1)),
        }),
        ' ',
        el('button', {
          type: 'button', class: 'btn small', text: 'Down',
          disabled: locked || index === show.items.length - 1,
          onClick: () => commit(s => moveItem(s.show, item.id, 1)),
        }),
        ' ',
        el('button', {
          type: 'button', class: 'btn small', text: 'Remove',
          disabled: locked,
          onClick: () => commit(s => removeItem(s.show, item.id)),
        })
      )
    )
  );

  return el('table', {},
    el('thead', {},
      el('tr', {},
        el('th', { class: 'num', text: 'Pos' }),
        el('th', { text: 'Type' }),
        el('th', { text: 'Item' }),
        el('th', { text: 'Participants' }),
        el('th', { class: 'num', text: 'Planned' }),
        el('th', { text: 'Actions' })
      )
    ),
    el('tbody', {}, rows)
  );
}

// Grievances you have not done anything with yet. Taking one puts the match on
// the card; waving it away is also an answer, and the person who wanted it
// knows which one you picked.
function opportunityPanel(state, locked) {
  const open = listOpportunities(state);
  if (!open.length) return null;

  return el('div', { class: 'panel' },
    el('h3', { text: `Unfinished business (${open.length})` }),
    el('ul', { class: 'opps' },
      open.map(opportunity =>
        el('li', { class: opportunity.promised ? 'opp promised' : 'opp' },
          el('div', { class: 'opp-id' },
            el('div', { class: 'opp-pair' },
              nameOf(state.wrestlers, opportunity.aggressorId),
              ' vs. ',
              nameOf(state.wrestlers, opportunity.victimId),
              opportunity.promised ? el('span', { class: 'chip chip-bad', text: 'promised' }) : null,
              opportunity.repeats ? el('span', { class: 'chip', text: `${opportunity.repeats + 1}x` }) : null
            ),
            el('div', { class: 'opp-why', text: `From ${opportunity.reason}, week ${opportunity.week}. Goes cold after week ${opportunity.expiresWeek}.` })
          ),
          el('div', { class: 'save-actions' },
            el('button', {
              type: 'button', class: 'btn', text: 'Book it', disabled: locked,
              onClick: () => commit(s => {
                const taken = takeOpportunity(s, opportunity.id);
                if (taken) {
                  addItem(s.show, createMatch({
                    wrestlerAId: taken.aggressorId,
                    wrestlerBId: taken.victimId,
                    plannedMinutes: 12,
                  }));
                }
              }),
            }),
            el('button', {
              type: 'button', class: 'btn', text: 'Leave it', disabled: locked,
              onClick: () => commit(s => dismissOpportunity(s, opportunity.id)),
            })
          )
        )
      )
    )
  );
}

// Who is available and not booked. Being left off is the one thing in the game
// today that actually moves morale, so the player has to be able to see it
// before the show, not only learn about it afterwards.
function offTheCard(state) {
  const booked = new Set(state.show.items.flatMap(item => item.participants));
  const idle = state.wrestlers.filter(w => bookable(w) && !booked.has(w.id));

  if (!idle.length) {
    return el('div', { class: 'panel' },
      el('h3', { text: 'Off the card' }),
      el('p', { class: 'empty', text: 'Everyone available is booked. Nobody is sitting at home this week.' })
    );
  }

  return el('div', { class: 'panel' },
    el('h3', { text: `Off the card (${idle.length})` }),
    el('ul', { class: 'moods compact' },
      idle.map(w =>
        el('li', {},
          el('span', { class: 'mood-name' }, wrestlerLink(state, w.id)),
          el('span', { class: 'mood-arch', text: w.archetype }),
          el('span', { class: `mood-word ${moodClass(w)}`, text: moodWord(w) }),
          w.weeksOffCard > 0
            ? el('span', {
                class: w.weeksOffCard >= 2 ? 'chip chip-bad' : 'chip',
                text: `missed ${w.weeksOffCard}`,
              })
            : null
        )
      )
    )
  );
}

function wrestlerOptions(state, selected) {
  return [
    el('option', { value: '', text: '— choose —', selected: selected === '' }),
    ...state.wrestlers.map(w =>
      el('option', {
        value: w.id,
        selected: w.id === selected,
        text: w.status === 'Available' ? w.name : `${w.name} (${w.status})`,
      })
    ),
  ];
}

function addMatchPanel(state) {
  return el('div', { class: 'panel' },
    el('h3', { text: 'Add match' }),
    el('div', { class: 'row' },
      el('div', { class: 'field' },
        el('label', { text: 'Wrestler A' }),
        el('select', { onChange: e => { draft.matchA = e.target.value; notify(); } }, wrestlerOptions(state, draft.matchA))
      ),
      el('div', { class: 'field' },
        el('label', { text: 'Wrestler B' }),
        el('select', { onChange: e => { draft.matchB = e.target.value; notify(); } }, wrestlerOptions(state, draft.matchB))
      ),
      el('div', { class: 'field' },
        el('label', { text: 'Stipulation' }),
        el('select', {
          onChange: e => { draft.matchTypeId = e.target.value; notify(); },
        }, MATCH_TYPES.map(t => el('option', {
          value: t.id, selected: t.id === draft.matchTypeId, text: t.name,
        })))
      ),
      el('div', { class: 'field' },
        el('label', { text: `Minutes (min ${matchType(draft.matchTypeId).minMinutes})` }),
        el('input', {
          type: 'number', min: String(matchType(draft.matchTypeId).minMinutes), value: draft.matchMinutes,
          onChange: e => { draft.matchMinutes = e.target.value; },
        })
      ),
      titleField(state, [draft.matchA, draft.matchB], [1, 1], 'matchTitle'),
      el('button', { type: 'button', class: 'btn', text: 'Add match', onClick: addMatch })
    ),
    el('p', { class: 'stip-note muted', text: matchType(draft.matchTypeId).note }),
    stipulationRead(state),
    draft.matchError ? el('p', { class: 'over', text: draft.matchError }) : null
  );
}

// What you know about how these two feel about this stipulation. This is the
// whole decision: it is only visible for wrestlers you have a read on, so early
// on you book blind and find out in the aftermath.
function stipulationRead(state) {
  const ids = [draft.matchA, draft.matchB].filter(Boolean);
  if (!ids.length) return null;

  return el('ul', { class: 'stip-read' },
    ids.map(id => {
      const w = byId(state.wrestlers, id);
      if (!w) return null;
      const reading = tasteReading(w, draft.matchTypeId);
      return el('li', {},
        el('span', { class: 'stip-who', text: w.name }),
        reading
          ? el('span', { class: `stip-taste taste-${reading.tone}`, text: reading.word })
          : el('span', { class: 'stip-taste taste-plain', text: 'no read on this yet' })
      );
    })
  );
}

function addMatch() {
  if (!draft.matchA || !draft.matchB) {
    draft.matchError = 'Choose both wrestlers.';
    notify();
    return;
  }
  if (draft.matchA === draft.matchB) {
    draft.matchError = 'A wrestler cannot face themselves.';
    notify();
    return;
  }

  const match = {
    wrestlerAId: draft.matchA,
    wrestlerBId: draft.matchB,
    plannedMinutes: draft.matchMinutes,
    matchTypeId: draft.matchTypeId,
    titleId: draft.matchTitle || null,
  };
  draft.matchA = '';
  draft.matchB = '';
  draft.matchTitle = '';
  draft.matchError = '';
  commit(s => addItem(s.show, createMatch(match)));
}

// Only belts that could actually be on the line here: a tag title needs a tag
// match, and a locked division needs everyone in it to belong to that division.
function titleField(state, participantIds, sides, key) {
  const chosen = participantIds.filter(Boolean);
  const total = (sides || []).reduce((sum, n) => sum + n, 0);
  const options = chosen.length === total && total >= 2
    ? titlesForMatch(state, chosen, sides)
    : [];

  if (draft[key] && !options.some(t => t.id === draft[key])) draft[key] = '';

  return el('div', { class: 'field' },
    el('label', { text: 'Championship' }),
    el('select', {
      disabled: !options.length,
      onChange: e => { draft[key] = e.target.value; },
    },
      el('option', { value: '', selected: !draft[key], text: options.length ? '— no title —' : '— none available —' }),
      ...options.map(t => el('option', { value: t.id, selected: t.id === draft[key], text: t.name }))
    )
  );
}

// Any shape bigger than one against one.
//
// A preset picks the arrangement, or "custom" takes two numbers and builds it;
// a battle royal drops the slots entirely for a checklist, because the whole
// point of one is that there is no limit. The name is derived and shown live,
// so the player builds a shape and the game tells them what it is called —
// including "Handicap", which is what you get by leaving a slot empty.
function addBoutPanel(state) {
  const chosen = preset(draft.shapeId);
  const open = Boolean(chosen.open);
  const sides = open ? null : draft.sides;
  const ids = open ? [...draft.royal] : draft.slots.filter(Boolean);

  const stipulation = open ? matchType('battle-royal') : matchType(draft.boutTypeId);
  const shape = open
    ? 'Battle Royal'
    : shapeName(sidesFromSlots(), draft.boutTypeId) || 'Singles Match';
  const floor = open
    ? Math.max(stipulation.minMinutes, shapeMinutes(new Array(Math.max(2, ids.length)).fill(1), 'battle-royal'))
    : Math.max(stipulation.minMinutes, shapeMinutes(sidesFromSlots(), draft.boutTypeId));

  return el('div', { class: 'panel' },
    el('h3', { text: 'Add a bigger match' }),
    el('div', { class: 'row' },
      el('div', { class: 'field' },
        el('label', { text: 'Shape' }),
        el('select', { onChange: e => setShape(e.target.value) },
          ...PRESETS.map(p => el('option', {
            value: p.id, selected: p.id === draft.shapeId, text: p.label,
          })),
          el('option', { value: 'custom', selected: draft.shapeId === 'custom', text: 'Custom…' })
        )
      ),
      draft.shapeId === 'custom' ? customFields() : null,
      open
        ? null
        : el('div', { class: 'field' },
            el('label', { text: 'Stipulation' }),
            el('select', {
              onChange: e => { draft.boutTypeId = e.target.value; notify(); },
            }, MATCH_TYPES.filter(t => !t.open).map(t => el('option', {
              value: t.id,
              selected: t.id === draft.boutTypeId,
              // In here "singles" means "no stipulation", and calling it a
              // singles match while the shape says six-person tag reads as a
              // contradiction.
              text: t.id === 'singles' ? 'Standard rules' : t.name,
            })))
          ),
      el('div', { class: 'field' },
        el('label', { text: `Minutes (min ${floor})` }),
        el('input', {
          type: 'number', min: String(floor),
          value: draft.boutMinutes === '' ? String(floor) : draft.boutMinutes,
          onChange: e => { draft.boutMinutes = e.target.value; },
        })
      ),
      titleField(state, ids, open ? new Array(ids.length).fill(1) : sidesFromSlots(), 'boutTitle'),
      // Named for what it is about to make, so it is never the same button as
      // the singles one above it.
      el('button', {
        type: 'button', class: 'btn',
        text: `Add ${shape.toLowerCase()}`,
        onClick: () => addBout(open),
      })
    ),

    el('p', { class: 'shape-read' },
      el('span', { class: 'shape', text: shape }),
      el('span', { class: 'muted', text: open
        ? `  ${ids.length} selected. No limit — put the whole roster in it if you want.`
        : `  ${ids.length} of ${sides.reduce((a, b) => a + b, 0)} chosen. Leave one empty for a handicap match.` })
    ),
    // The "singles" note is about a singles match, so it is the wrong thing to
    // read under a six-person tag. The shape line above has already said what
    // this is.
    open || draft.boutTypeId !== 'singles'
      ? el('p', { class: 'stip-note muted', text: stipulation.note })
      : null,

    open ? royalChecks(state) : slotFields(state),
    draft.boutError ? el('p', { class: 'over', text: draft.boutError }) : null
  );
}

function customFields() {
  const field = (label, value, max, onSet) => el('div', { class: 'field' },
    el('label', { text: label }),
    el('input', {
      type: 'number', min: '1', max: String(max), value: String(value),
      onChange: e => onSet(Number(e.target.value)),
    })
  );
  return [
    field('Sides', draft.sides.length, MAX_SIDES, n => setSides(evenSides(n, draft.sides[0] || 1))),
    field('Each', draft.sides[0] || 1, MAX_PER_SIDE, n => setSides(evenSides(draft.sides.length, n))),
  ];
}

// One select per seat, grouped by side, with "vs." between the groups.
function slotFields(state) {
  const groups = [];
  let at = 0;
  draft.sides.forEach((size, sideIndex) => {
    const seats = [];
    for (let seat = 0; seat < size; seat += 1) {
      const index = at + seat;
      seats.push(el('select', {
        onChange: e => { draft.slots[index] = e.target.value; notify(); },
      }, wrestlerOptions(state, draft.slots[index] || '')));
    }
    at += size;
    groups.push(el('div', { class: 'side' },
      el('label', { text: draft.sides.length === 2 && size > 1 ? `Team ${sideIndex + 1}` : `Side ${sideIndex + 1}` }),
      el('div', { class: 'side-seats' }, seats)
    ));
  });

  const withVs = [];
  groups.forEach((group, index) => {
    if (index) withVs.push(el('span', { class: 'side-vs', text: 'vs.' }));
    withVs.push(group);
  });
  // A row of one-person sides reads across, like the match does. Teams are too
  // wide for that, so they stack with the "vs." between them where it belongs.
  const teams = draft.sides.some(size => size > 1);
  return el('div', { class: teams ? 'sides sides-stacked' : 'sides' }, withVs);
}

function royalChecks(state) {
  const fit = state.wrestlers.filter(bookable);
  return el('div', {},
    el('div', { class: 'royal-tools' },
      el('button', {
        type: 'button', class: 'link',
        text: 'Everyone available',
        onClick: () => { draft.royal = new Set(fit.map(w => w.id)); notify(); },
      }),
      el('button', {
        type: 'button', class: 'link',
        text: 'Clear',
        onClick: () => { draft.royal = new Set(); notify(); },
      })
    ),
    el('div', { class: 'checklist checklist-wide' },
      state.wrestlers.map(w =>
        el('label', {},
          el('input', {
            type: 'checkbox',
            checked: draft.royal.has(w.id),
            disabled: !bookable(w),
            onChange: e => {
              if (e.target.checked) draft.royal.add(w.id);
              else draft.royal.delete(w.id);
              notify();
            },
          }),
          ` ${w.name}`,
          bookable(w) ? null : el('span', { class: 'muted', text: ` (${w.status})` })
        )
      )
    )
  );
}

// The sides as they actually stand, with empty seats removed — which is what
// turns a 2 v 2 with one blank into a handicap match.
function sidesFromSlots() {
  const sides = [];
  let at = 0;
  for (const size of draft.sides) {
    const filled = draft.slots.slice(at, at + size).filter(Boolean).length;
    at += size;
    if (filled) sides.push(filled);
  }
  return sides.length >= 2 ? sides : [1, 1];
}

function setShape(id) {
  draft.shapeId = id;
  draft.boutError = '';
  draft.boutTitle = '';
  draft.boutMinutes = '';
  if (id === 'custom') {
    draft.sides = evenSides(draft.sides.length, draft.sides[0] || 1);
  } else {
    const chosen = preset(id);
    if (chosen.open) draft.slots = [];
    else draft.sides = [...chosen.sides];
  }
  trimSlots();
  notify();
}

function setSides(sides) {
  draft.sides = sides;
  draft.boutTitle = '';
  draft.boutMinutes = '';
  trimSlots();
  notify();
}

function trimSlots() {
  const total = draft.sides.reduce((sum, n) => sum + n, 0);
  draft.slots.length = total;
  for (let i = 0; i < total; i += 1) if (!draft.slots[i]) draft.slots[i] = '';
}

function addBout(open) {
  const teams = [];
  if (open) {
    const ids = [...draft.royal];
    if (ids.length < 3) {
      draft.boutError = 'A battle royal needs at least three.';
      notify();
      return;
    }
    for (const id of ids) teams.push([id]);
  } else {
    let at = 0;
    for (const size of draft.sides) {
      const side = draft.slots.slice(at, at + size).filter(Boolean);
      at += size;
      if (side.length) teams.push(side);
    }
    if (teams.length < 2) {
      draft.boutError = 'Two sides at the very least.';
      notify();
      return;
    }
  }

  const flat = teams.flat();
  if (new Set(flat).size !== flat.length) {
    draft.boutError = 'Nobody can be in this twice.';
    notify();
    return;
  }

  const bout = createBout({
    teams,
    matchTypeId: open ? 'battle-royal' : draft.boutTypeId,
    plannedMinutes: Number(draft.boutMinutes) || 0,
    titleId: draft.boutTitle || null,
  });
  if (!bout) {
    draft.boutError = 'That is not a match yet.';
    notify();
    return;
  }

  draft.slots = draft.slots.map(() => '');
  draft.royal = new Set();
  draft.boutTitle = '';
  draft.boutError = '';
  draft.boutMinutes = '';
  commit(s => addItem(s.show, bout));
}

function addSegmentPanel(state) {
  const checks = state.wrestlers.map(w =>
    el('label', {},
      el('input', {
        type: 'checkbox',
        checked: draft.segParticipants.has(w.id),
        onChange: e => {
          if (e.target.checked) draft.segParticipants.add(w.id);
          else draft.segParticipants.delete(w.id);
        },
      }),
      ' ', w.name
    )
  );

  return el('div', { class: 'panel' },
    el('h3', { text: 'Add segment' }),
    el('div', { class: 'row' },
      el('div', { class: 'field' },
        el('label', { text: 'Segment name' }),
        el('input', {
          type: 'text', value: draft.segName, placeholder: 'Contract signing',
          onChange: e => { draft.segName = e.target.value; },
        })
      ),
      el('div', { class: 'field' },
        el('label', { text: 'Wrestlers involved (optional)' }),
        el('div', { class: 'checklist' }, checks)
      ),
      el('div', { class: 'field' },
        el('label', { text: 'Planned minutes' }),
        el('input', {
          type: 'number', min: '1', value: draft.segMinutes,
          onChange: e => { draft.segMinutes = e.target.value; },
        })
      ),
      el('button', { type: 'button', class: 'btn', text: 'Add segment', onClick: addSegment })
    ),
    draft.segError ? el('p', { class: 'over', text: draft.segError }) : null
  );
}

function addSegment() {
  if (!draft.segName.trim()) {
    draft.segError = 'Give the segment a name.';
    notify();
    return;
  }

  const segment = {
    name: draft.segName,
    participants: [...draft.segParticipants],
    plannedMinutes: draft.segMinutes,
  };
  draft.segName = '';
  draft.segParticipants = new Set();
  draft.segError = '';
  commit(s => addItem(s.show, createSegment(segment)));
}
