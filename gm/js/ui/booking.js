// Build the card for the next show: add, remove, reorder and retime items.
import { el } from './dom.js';
import { commit, notify, getState } from '../store.js';
import {
  addItem, createMatch, createBout, createSegment, removeItem, moveItem, setItemMinutes,
  setItemMatchType, minimumMinutes, bookedMinutes, remainingMinutes, isOverbooked,
} from '../model/show.js';
import { titlesForMatch } from '../model/titles.js';
import { matchType, DEFAULT_MATCH_TYPE } from '../data/match-types.js';
import {
  preset, shapeName, shapeMinutes, evenSides, MAX_SIDES, MAX_PER_SIDE,
} from '../data/shapes.js';
import { tasteReading } from '../model/match-types.js';
import { byId } from '../model/wrestlers.js';
import { PHASES, canEditCard, startShow } from '../model/game.js';
import { typeLabel } from './labels.js';
import { itemLabelNodes, participantLinks, wrestlerLink } from './links.js';
import { bookable } from '../model/morale.js';
import { moodWord, moodClass } from './mood.js';
import { tierOf, nextTier } from '../model/network.js';
import { budgetOf, runway, wageBill, rightsFee, money } from '../model/finance.js';
import {
  shapesFor, canBuildShapes, stipulationsFor, canCustomiseShape,
  teamRefusal, teamGateSay,
} from '../model/unlocks.js';
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
  // Which builder the middle column is showing, and the roster panel's own
  // search and sort. All interface state, so none of it touches the save.
  builder: 'match',
  search: '',
  sortKey: 'name',
  sortDir: 1,
  picked: '',
  clearArmed: false,
};

// Three panels across: who you have, what you are making, and what you have
// made — then the clock, then the one button that ends the booking.
export function renderBooking(state, navigate) {
  const { show } = state;
  const locked = !canEditCard(state);

  return el('section', { class: 'wide' },
    locked ? lockedNotice(state, navigate) : null,

    el('div', { class: 'floor' },
      rosterPanel(state, locked),
      builderPanel(state, locked),
      cardPanel(state, show, locked)
    ),

    clockStrip(state, show),
    isOverbooked(show)
      ? el('div', {
          class: 'notice warn',
          text: `Overbooked by ${bookedMinutes(show) - show.runtimeMinutes} minutes. You can still run this card.`,
        })
      : null,

    el('div', { class: 'actionbar' },
      el('span', { class: 'spacer muted', text: show.items.length === 0
        ? 'Add at least one item to start the show.'
        : `${show.items.length} ${show.items.length === 1 ? 'item' : 'items'} on the card.` }),
      // Two clicks, like deleting a save. Wiping a card you spent five minutes
      // on should not be one stray click away.
      el('button', {
        type: 'button',
        class: draft.clearArmed ? 'btn wide danger-armed' : 'btn wide',
        text: draft.clearArmed ? 'Click again to clear' : 'Clear card',
        disabled: locked || show.items.length === 0,
        onClick: () => {
          if (!draft.clearArmed) {
            draft.clearArmed = true;
            notify();
            return;
          }
          draft.clearArmed = false;
          commit(s => { s.show.items = []; });
        },
      }),
      el('button', {
        type: 'button', class: 'btn go wide',
        text: '▶  Start show',
        disabled: locked || show.items.length === 0,
        onClick: () => {
          commit(s => startShow(s));
          navigate('live');
        },
      })
    ),

    opportunityPanel(state, locked),
    offTheCard(state)
  );
}

// ---------------------------------------------------------------- the roster

// A reference you glance at while booking, rather than a screen you leave for.
// Clicking a row drops that wrestler into the next empty slot in whichever
// builder is open; clicking their name still opens their card, which is what it
// does everywhere else in the game.
function rosterPanel(state, locked) {
  const term = draft.search.trim().toLowerCase();
  const people = state.wrestlers
    .filter(w => !term || w.name.toLowerCase().includes(term)
      || w.archetype.toLowerCase().includes(term)
      || w.role.toLowerCase().includes(term))
    .sort(rosterOrder);

  return el('div', { class: 'card-panel col-roster' },
    el('header', {},
      el('h2', { text: 'Roster' }),
      el('span', { class: 'panel-count', text: `${state.wrestlers.length} wrestlers` }),
      el('p', { class: 'panel-sub', text: locked
        ? 'The card is locked, so this is a read-only list tonight.'
        : 'Click a row to put somebody in the match you are building.' })
    ),
    el('label', { class: 'search' },
      el('input', {
        type: 'search', id: 'roster-search', value: draft.search,
        placeholder: 'Search wrestlers…',
        onInput: e => { draft.search = e.target.value; notify(); },
      })
    ),
    el('div', { class: 'panel-body flush roster-scroll' },
      el('table', {},
        el('thead', {},
          el('tr', {},
            el('th', {}, sorter('name', 'Name')),
            el('th', {}, sorter('alignment', 'Alignment')),
            el('th', {}, sorter('status', 'Status'))
          )
        ),
        el('tbody', {},
          people.length
            ? people.map(w => rosterRow(state, w, locked))
            : el('tr', {}, el('td', { colSpan: 3, class: 'empty', text: 'Nobody by that name.' }))
        )
      )
    )
  );
}

function rosterRow(state, w, locked) {
  const free = bookable(w);
  return el('tr', {
    class: `${locked ? '' : 'pick-row'}${draft.picked === w.id ? ' on' : ''}`.trim(),
    onClick: locked ? null : () => assign(w.id),
  },
    el('td', { title: `${w.archetype} · ${w.role}` }, wrestlerLink(state, w.id)),
    el('td', { class: 'muted', text: w.alignment }),
    el('td', {},
      el('span', { class: free ? 'status-good' : 'status-bad', text: w.status }),
      free && w.weeksOffCard > 2
        ? el('span', { class: 'off-badge', text: `${w.weeksOffCard}w off` })
        : null
    )
  );
}

function sorter(key, label) {
  const on = draft.sortKey === key;
  return el('button', {
    type: 'button', class: on ? 'sorter on' : 'sorter',
    onClick: () => {
      if (draft.sortKey === key) draft.sortDir = -draft.sortDir;
      else { draft.sortKey = key; draft.sortDir = 1; }
      notify();
    },
  },
    label,
    el('span', { class: 'arrow', text: on ? (draft.sortDir > 0 ? '▲' : '▼') : '↕' })
  );
}

function rosterOrder(a, b) {
  const key = draft.sortKey;
  const value = w => (key === 'status'
    ? `${bookable(w) ? 0 : 1}${w.status}`
    : String(w[key] || ''));
  return value(a).localeCompare(value(b)) * draft.sortDir
    || a.name.localeCompare(b.name);
}

// Drop somebody into the first empty slot of whatever is being built. Picking
// the same person again takes them back out, so a misclick is one more click to
// undo rather than a hunt through the selects.
function assign(id) {
  draft.picked = id;

  if (draft.builder === 'segment') {
    if (draft.segParticipants.has(id)) draft.segParticipants.delete(id);
    else draft.segParticipants.add(id);
    notify();
    return;
  }

  if (draft.builder === 'bout') {
    if (preset(draft.shapeId).open) {
      if (draft.royal.has(id)) draft.royal.delete(id);
      else draft.royal.add(id);
      notify();
      return;
    }
    trimSlots();
    const taken = draft.slots.indexOf(id);
    if (taken >= 0) draft.slots[taken] = '';
    else {
      const free = draft.slots.indexOf('');
      if (free >= 0) draft.slots[free] = id;
    }
    notify();
    return;
  }

  if (draft.matchA === id) draft.matchA = '';
  else if (draft.matchB === id) draft.matchB = '';
  else if (!draft.matchA) draft.matchA = id;
  else draft.matchB = id;
  notify();
}

// ---------------------------------------------------------------- the builder

const BUILDERS = [
  ['match', 'Match'],
  ['bout', 'Bigger match'],
  ['segment', 'Segment'],
];

function builderPanel(state, locked) {
  if (locked) {
    return el('div', { class: 'card-panel col-book' },
      el('header', {},
        el('h2', { text: 'Book match' }),
        el('p', { class: 'panel-sub', text: 'Nothing can be added while a show is on the air.' })
      )
    );
  }

  return el('div', { class: 'card-panel col-book' },
    el('header', {},
      el('h2', { text: 'Book match' }),
      el('p', { class: 'panel-sub', text: 'Set the details for the next match on your show.' })
    ),
    el('div', { class: 'panel-body' },
      el('div', { class: 'segmented' },
        BUILDERS.map(([id, label]) => el('button', {
          type: 'button', class: draft.builder === id ? 'on' : '',
          text: label,
          onClick: () => { draft.builder = id; notify(); },
        }))
      ),
      draft.builder === 'match' ? matchForm(state)
        : draft.builder === 'bout' ? (canBuildShapes(state) ? boutForm(state) : noShapes())
        : segmentForm(state)
    )
  );
}

// ---------------------------------------------------------------- the card

function cardPanel(state, show, locked) {
  return el('div', { class: 'card-panel col-card' },
    el('header', {},
      el('h2', { text: 'Show card' }),
      el('span', { class: 'panel-count', text: `${bookedMinutes(show)} of ${show.runtimeMinutes} min` }),
      el('p', { class: 'panel-sub', text: 'Order and manage the matches for your show.' })
    ),
    el('div', { class: 'panel-body flush' }, cardTable(state, show, locked))
  );
}

// Said in weeks rather than in a balance, because weeks is the unit the
// decision is made in: whether to carry a twenty-eight person roster is a
// question about how long you can carry it.
function moneyNote(state) {
  const left = runway(state);
  const wages = wageBill(state.wrestlers);
  if (budgetOf(state) < 0) {
    return el('p', { class: 'net-note over', text:
      `Overdrawn. ${money(wageBill(state.wrestlers))} a week goes out and head office knows.` });
  }
  if (left === null) {
    return el('p', { class: 'net-note muted', text:
      `${money(rightsFee(state))} a week in, ${money(wages)} out. The books are fine.` });
  }
  return el('p', { class: `net-note ${left <= 4 ? 'over' : 'muted'}`, text:
    `${money(wages)} a week in wages against ${money(rightsFee(state))} from the network. `
    + `About ${left} week${left === 1 ? '' : 's'} of it left.` });
}

function clockStrip(state, show) {
  const left = remainingMinutes(show);
  const next = nextTier(state);
  return el('div', {},
    el('div', { class: 'clockstrip' },
      el('div', {},
        el('span', { class: 'clock-label', text: 'Show length' }),
        el('span', { class: 'clock-value', text: `${show.runtimeMinutes} min` })
      ),
      el('div', {},
        el('span', { class: 'clock-label', text: 'Time booked' }),
        el('span', { class: 'clock-value', text: `${bookedMinutes(show)} min` })
      ),
      el('div', {},
        el('span', { class: 'clock-label', text: 'Time remaining' }),
        el('span', { class: `clock-value ${left < 0 ? 'over' : 'left'}`, text: `${left} min` })
      ),
      // The books sit next to the clock because they are the same kind of
      // fact: a number that is going to run out, and how long you have.
      el('div', {},
        el('span', { class: 'clock-label', text: 'In the account' }),
        el('span', {
          class: `clock-value ${budgetOf(state) < 0 ? 'over' : 'left'}`,
          text: money(budgetOf(state)),
        })
      )
    ),
    el('p', { class: 'net-note muted', text: next
      ? `${tierOf(state).label}. Network trust ${state.network.trust} of ${next.trust} toward ${next.minutes} minutes.`
      : `${tierOf(state).label}. There is no more airtime to earn.` }),
    moneyNote(state)
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

function cardTable(state, show, locked) {
  if (!show.items.length) {
    return el('p', { class: 'empty', style: 'padding:22px 17px;margin:0', text: 'Nothing on the card yet.' });
  }

  const rows = show.items.map((item, index) =>
    el('tr', {},
      el('td', { class: 'pos', text: index + 1 }),
      el('td', { class: 'what' },
        el('strong', { text: typeLabel(item) }),
        el('span', { class: 'who' }, itemLabelNodes(state, item))
      ),
      el('td', { class: 'when' },
        el('div', { class: 'timebox' },
          el('input', {
            type: 'number', min: String(minimumMinutes(item)), value: item.plannedMinutes,
            disabled: locked,
            title: `At least ${minimumMinutes(item)} minutes`,
            onChange: e => commit(s => setItemMinutes(s.show, item.id, e.target.value)),
          }),
          el('span', { class: 'unit', text: 'min' })
        )
      ),
      el('td', { class: 'handles' },
        el('button', {
          type: 'button', class: 'btn icon', text: '↑', title: 'Move up',
          disabled: locked || index === 0,
          onClick: () => commit(s => moveItem(s.show, item.id, -1)),
        }),
        el('button', {
          type: 'button', class: 'btn icon', text: '↓', title: 'Move down',
          disabled: locked || index === show.items.length - 1,
          onClick: () => commit(s => moveItem(s.show, item.id, 1)),
        }),
        el('button', {
          type: 'button', class: 'btn icon danger', text: '✕', title: 'Take it off the card',
          disabled: locked,
          onClick: () => commit(s => removeItem(s.show, item.id)),
        })
      )
    )
  );

  return el('table', { class: 'cardlist' },
    el('thead', {},
      el('tr', {},
        el('th', { class: 'pos', text: '#' }),
        el('th', { text: 'Match type / participants' }),
        el('th', { text: 'Time' }),
        el('th', { text: 'Actions' })
      )
    ),
    el('tbody', {}, rows)
  );
}

// The stipulation is changed from the builder rather than inline on the row:
// with a shape, a stipulation and a title to reconcile, a dropdown in a table
// cell was the one control that could put a card into a state the builder would
// not have allowed.
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

function matchForm(state) {
  const stipulation = matchType(draft.matchTypeId);
  return el('div', {},
    el('div', { class: 'form-rows' },
      row('Wrestler A', el('select', {
        onChange: e => { draft.matchA = e.target.value; notify(); },
      }, wrestlerOptions(state, draft.matchA))),
      row('Wrestler B', el('select', {
        onChange: e => { draft.matchB = e.target.value; notify(); },
      }, wrestlerOptions(state, draft.matchB))),
      row(['Stipulation', 'optional'], el('select', {
        onChange: e => { draft.matchTypeId = e.target.value; notify(); },
      }, stipulationsFor(state).filter(t => !t.open).map(t => el('option', {
        value: t.id, selected: t.id === draft.matchTypeId,
        text: t.id === 'singles' ? 'None' : t.name,
      })))),
      row('Championship', titleSelect(state, [draft.matchA, draft.matchB], [1, 1], 'matchTitle')),
      row('Planned time', el('div', { class: 'with-unit' },
        el('input', {
          type: 'number', min: String(stipulation.minMinutes), value: draft.matchMinutes,
          onChange: e => { draft.matchMinutes = e.target.value; },
        }),
        el('span', { class: 'unit', text: `minutes (${stipulation.minMinutes}–60)` })
      ))
    ),

    draft.matchTypeId === 'singles'
      ? null
      : el('p', { class: 'stip-note muted', text: stipulation.note }),
    stipulationRead(state),

    el('button', {
      type: 'button', class: 'btn primary wide', style: 'width:100%;margin-top:16px',
      text: '＋  Add match',
      onClick: addMatch,
    }),
    draft.matchError ? el('p', { class: 'over', text: draft.matchError }) : null
  );
}

// A labelled row: the label on the left, the control on the right. Reads as a
// list of settings rather than a wall of boxes.
function row(label, control) {
  const [text, hint] = Array.isArray(label) ? label : [label, null];
  return el('div', { class: 'form-row' },
    el('label', {}, text, hint ? el('span', { class: 'hint', text: ` (${hint})` }) : null),
    control
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
// Only belts that fit the shape in front of you, and only once every seat is
// filled — a title needs to know who is in the match before it can say whether
// it could be on the line.
function titleSelect(state, participantIds, sides, key) {
  const chosen = participantIds.filter(Boolean);
  const total = (sides || []).reduce((sum, n) => sum + n, 0);
  const options = chosen.length === total && total >= 2
    ? titlesForMatch(state, chosen, sides)
    : [];

  if (draft[key] && !options.some(t => t.id === draft[key])) draft[key] = '';

  return el('select', {
    disabled: !options.length,
    onChange: e => { draft[key] = e.target.value; },
  },
    el('option', { value: '', selected: !draft[key], text: options.length ? 'None' : 'None available' }),
    ...options.map(t => el('option', { value: t.id, selected: t.id === draft[key], text: t.name }))
  );
}

// Any shape bigger than one against one.
//
// A preset picks the arrangement, or "custom" takes two numbers and builds it;
// a battle royal drops the slots entirely for a checklist, because the whole
// point of one is that there is no limit. The name is derived and shown live,
// so the player builds a shape and the game tells them what it is called —
// including "Handicap", which is what you get by leaving a slot empty.
function boutForm(state) {
  // A locked preset can be left on the draft by a reload, or simply by being
  // the default before anything on the branch is bought.
  const available = shapesFor(state);
  if (draft.shapeId !== 'custom' && !available.some(p => p.id === draft.shapeId)) {
    draft.shapeId = available[0].id;
    if (!available[0].open) draft.sides = [...available[0].sides];
    trimSlots();
  }
  const chosen = preset(draft.shapeId);
  const open = Boolean(chosen.open);
  const ids = open ? [...draft.royal] : draft.slots.filter(Boolean);
  const shapeSides = open ? new Array(Math.max(2, ids.length)).fill(1) : sidesFromSlots();

  const stipulation = open ? matchType('battle-royal') : matchType(draft.boutTypeId);
  const shape = open ? 'Battle Royal' : shapeName(shapeSides, draft.boutTypeId) || 'Singles Match';
  const floor = Math.max(stipulation.minMinutes, shapeMinutes(shapeSides, stipulation.id));
  const wanted = open ? null : draft.sides.reduce((a, b) => a + b, 0);

  return el('div', {},
    el('div', { class: 'form-rows' },
      row('Shape', el('select', { onChange: e => setShape(e.target.value) },
        ...shapesFor(state).map(p => el('option', {
          value: p.id, selected: p.id === draft.shapeId, text: p.label,
        })),
        canCustomiseShape(state)
          ? el('option', { value: 'custom', selected: draft.shapeId === 'custom', text: 'Custom…' })
          : null
      )),
      draft.shapeId === 'custom' ? row('Sides', numberBox(
        draft.sides.length, MAX_SIDES, n => setSides(evenSides(n, draft.sides[0] || 1))
      )) : null,
      draft.shapeId === 'custom' ? row('People each', numberBox(
        draft.sides[0] || 1, MAX_PER_SIDE, n => setSides(evenSides(draft.sides.length, n))
      )) : null,
      open ? null : row(['Stipulation', 'optional'], el('select', {
        onChange: e => { draft.boutTypeId = e.target.value; notify(); },
      }, stipulationsFor(state).filter(t => !t.open).map(t => el('option', {
        value: t.id, selected: t.id === draft.boutTypeId,
        text: t.id === 'singles' ? 'None' : t.name,
      })))),
      row('Championship', titleSelect(state, ids, shapeSides, 'boutTitle')),
      row('Planned time', el('div', { class: 'with-unit' },
        el('input', {
          type: 'number', min: String(floor),
          value: draft.boutMinutes === '' ? String(floor) : draft.boutMinutes,
          onChange: e => { draft.boutMinutes = e.target.value; },
        }),
        el('span', { class: 'unit', text: `minutes (from ${floor})` })
      ))
    ),

    el('p', { class: 'shape-read' },
      el('span', { class: 'shape', text: shape }),
      el('span', { class: 'muted', text: open
        ? `${ids.length} selected. No limit — put the whole roster in it if you want.`
        : `${ids.length} of ${wanted} chosen. Leave one empty for a handicap match.` })
    ),
    open || draft.boutTypeId !== 'singles'
      ? el('p', { class: 'stip-note muted', text: stipulation.note })
      : null,

    open ? royalChecks(state) : slotFields(state),

    el('button', {
      type: 'button', class: 'btn primary wide', style: 'width:100%;margin-top:16px',
      text: `＋  Add ${shape.toLowerCase()}`,
      onClick: () => addBout(open),
    }),
    draft.boutError ? el('p', { class: 'over', text: draft.boutError }) : null
  );
}

function numberBox(value, max, onSet) {
  return el('input', {
    type: 'number', min: '1', max: String(max), value: String(value),
    onChange: e => onSet(Number(e.target.value)),
  });
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
// turns a 2 v 2 with one blank into a handicap match, and tells the player so
// before they commit to it.
//
// Until two sides have somebody in them there is no match to describe yet, so
// it falls back to the arrangement that was *chosen*. Otherwise an empty fatal
// four-way announced itself as a singles match.
function sidesFromSlots() {
  const sides = [];
  let at = 0;
  for (const size of draft.sides) {
    const filled = draft.slots.slice(at, at + size).filter(Boolean).length;
    at += size;
    if (filled) sides.push(filled);
  }
  return sides.length >= 2 ? sides : [...draft.sides];
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

// Before anything on the Booking branch is bought, one against one is the
// whole vocabulary. Saying so is better than an empty select.
function noShapes() {
  return el('p', { class: 'muted form-note' },
    'You can book a singles match and nothing else yet. Tag teams, triple '
    + 'threats and everything past them are bought on the Booking branch of '
    + 'the GM board.');
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

  // Two names on the same side is a tag team, and who you are allowed to make
  // one out of is a Booking upgrade. The refusal names the pair, because
  // "invalid team" is not something a GM would say.
  const state = getState();
  for (const side of teams) {
    const refusal = teamRefusal(state, state.wrestlers, side);
    if (refusal) {
      draft.boutError = refusal;
      notify();
      return;
    }
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

function segmentForm(state) {
  return el('div', {},
    el('div', { class: 'form-rows' },
      row('Segment name', el('input', {
        type: 'text', value: draft.segName, placeholder: 'Contract signing',
        onChange: e => { draft.segName = e.target.value; },
      })),
      row('Planned time', el('div', { class: 'with-unit' },
        el('input', {
          type: 'number', min: '1', value: draft.segMinutes,
          onChange: e => { draft.segMinutes = e.target.value; },
        }),
        el('span', { class: 'unit', text: 'minutes' })
      ))
    ),

    el('h3', { text: `Who is in it (${draft.segParticipants.size})` }),
    el('div', { class: 'checklist checklist-wide' },
      state.wrestlers.map(w =>
        el('label', {},
          el('input', {
            type: 'checkbox',
            checked: draft.segParticipants.has(w.id),
            onChange: e => {
              if (e.target.checked) draft.segParticipants.add(w.id);
              else draft.segParticipants.delete(w.id);
              notify();
            },
          }),
          ` ${w.name}`,
          bookable(w) ? null : el('span', { class: 'muted', text: ` (${w.status})` })
        )
      )
    ),

    el('button', {
      type: 'button', class: 'btn primary wide', style: 'width:100%;margin-top:16px',
      text: '＋  Add segment',
      onClick: addSegment,
    }),
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
