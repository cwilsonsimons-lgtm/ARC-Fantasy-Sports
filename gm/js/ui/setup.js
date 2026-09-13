// Building a promotion before it exists.
//
// Everything on this screen is a decision about what kind of job you are
// giving yourself. A twenty-eight person roster is more people to keep happy
// and a bigger wage bill; five belts is more to defend; starting at level
// twenty is a board half filled in before anybody has wrestled.
//
// The roster is previewed from the seed as it is edited, so the player is
// looking at the actual locker room they are about to inherit rather than a
// number that will become one.
import { el } from './dom.js';
import { notify, startNewSave } from '../store.js';
import {
  defaultSetup, encodeSetup, decodeSetup, BUDGET_PRESETS, AIR_NIGHTS,
  ALL_TITLES, ROSTER_RANGE, LEVEL_RANGE,
} from '../data/setup.js';
import { BASE_TITLES } from '../data/titles.js';
import { makeRng } from '../model/random.js';
import { generateRoster, generatePromotion } from '../model/generate.js';
import { pointsEarnedBy } from '../model/progression.js';
import { wageOf, wageBill, rightsFee, BASE_FEE, FEE_PER_MINUTE, money } from '../model/finance.js';
import { UPGRADES } from '../data/upgrades.js';
import { resetIds } from '../ids.js';

const ALIGNMENTS = ['Face', 'Heel', 'Neutral'];
const ROLES = ['Main event', 'Upper card', 'Midcard', 'Opener', 'Prospect'];

let setup = null;
let preview = null;
let shareCode = '';
let importText = '';
let importError = '';
let openRoster = false;

function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

export function resetSetup(seed = randomSeed()) {
  setup = defaultSetup(seed);
  const rolled = rollNames(seed);
  setup.promotion = rolled.promotion;
  setup.show = rolled.show;
  setup.airNight = rolled.airNight;
  shareCode = '';
  importText = '';
  importError = '';
  openRoster = false;
  rebuild();
}

function rollNames(seed) {
  const rng = makeRng(seed);
  const names = generatePromotion(rng);
  return { ...names, airNight: AIR_NIGHTS[Math.floor(makeRng(seed + 7)() * 7)] };
}

// The roster the seed produces, with the edits applied. Rebuilt whenever
// something that changes it changes, and never during a render — generating
// costs ids, and ids are global.
function rebuild() {
  resetIds();
  const rng = makeRng(setup.seed);
  generatePromotion(rng);
  const roster = generateRoster(rng, setup.rosterSize);
  preview = roster.map((wrestler, index) => {
    const edit = setup.edits[index] || {};
    return {
      index,
      base: wrestler,
      name: edit.name || wrestler.name,
      gender: edit.gender || wrestler.gender,
      alignment: edit.alignment || wrestler.alignment,
      role: edit.role || wrestler.role,
      dropped: (setup.dropped || []).includes(index),
      wage: wageOf({ ...wrestler, role: edit.role || wrestler.role }),
    };
  });
  resetIds();
}

function kept() {
  return preview.filter(p => !p.dropped);
}

function edit(index, field, value) {
  setup.edits[index] = { ...(setup.edits[index] || {}), [field]: value };
  shareCode = '';
  rebuild();
  notify();
}

function change(fn) {
  fn();
  shareCode = '';
  rebuild();
  notify();
}

export function renderSetup(state, navigate) {
  if (!setup) resetSetup();

  return el('section', { class: 'wide setup-view' },
    el('div', { class: 'setup-head' },
      el('div', {},
        el('h2', { text: 'A new promotion' }),
        el('p', { class: 'muted', text:
          'Everything here is a decision about the job you are giving yourself. '
          + 'Whatever you do not set, the seed decides.' })
      ),
      el('div', { class: 'setup-actions' },
        el('button', {
          type: 'button', class: 'btn', text: 'Roll it all again',
          onClick: () => { resetSetup(); notify(); },
        }),
        el('button', {
          type: 'button', class: 'btn primary', text: 'Take the job',
          onClick: () => { startNewSave(setup); setup = null; navigate('roster'); },
        })
      )
    ),

    el('div', { class: 'setup-grid' },
      promotionPanel(),
      gmPanel(),
      beltPanel(),
      moneyPanel(),
      sharePanel()
    ),

    rosterPanel()
  );
}

// ---------------------------------------------------------------- panels

function panel(title, sub, ...body) {
  return el('div', { class: 'card-panel setup-panel' },
    el('header', {},
      el('h2', { text: title }),
      sub ? el('p', { class: 'panel-sub', text: sub }) : null
    ),
    el('div', { class: 'panel-body' }, ...body)
  );
}

function field(label, control, note) {
  return el('div', { class: 'setup-field' },
    el('label', { class: 'lab', text: label }),
    control,
    note ? el('p', { class: 'setup-note', text: note }) : null
  );
}

function promotionPanel() {
  return panel('The promotion', 'What it is called, and when it is on.',
    field('Promotion', el('input', {
      type: 'text', value: setup.promotion, maxlength: '48',
      onInput: e => { setup.promotion = e.target.value; shareCode = ''; },
    })),
    field('Weekly show', el('input', {
      type: 'text', value: setup.show, maxlength: '48',
      onInput: e => { setup.show = e.target.value; shareCode = ''; },
    })),
    field('Air night', el('select', {
      onChange: e => change(() => { setup.airNight = e.target.value; }),
    }, AIR_NIGHTS.map(night => el('option', {
      value: night, selected: night === setup.airNight, text: night,
    }))))
  );
}

function gmPanel() {
  const points = pointsEarnedBy(setup.level);
  const affordable = UPGRADES
    .filter(u => u.built && u.level <= setup.level)
    .sort((a, b) => a.cost - b.cost);
  let spend = points;
  let count = 0;
  for (const u of affordable) {
    if (spend < u.cost) break;
    spend -= u.cost;
    count += 1;
  }

  return panel('The GM', 'Where you are starting from, not how far in you are.',
    field('Starting level', el('div', { class: 'with-unit' },
      el('input', {
        type: 'range', min: String(LEVEL_RANGE.min), max: String(LEVEL_RANGE.max),
        value: String(setup.level),
        onInput: e => change(() => { setup.level = Number(e.target.value); }),
      }),
      el('span', { class: 'unit num', text: `Level ${setup.level}` })
    )),
    el('dl', { class: 'setup-read' },
      el('dt', { text: 'Upgrade points' }),
      el('dd', { class: 'big num', text: String(points) }),
      el('dt', { text: 'Buys, roughly' }),
      el('dd', { text: count >= affordable.length
        ? `every one of the ${affordable.length} built upgrades open at that level`
        : `${count} of the ${affordable.length} built upgrades open at that level` })
    ),
    el('p', { class: 'setup-note', text:
      'You still start in week one with nothing bought and no XP banked. A high '
      + 'level is a board half filled in, which makes the early weeks easier — '
      + 'it does not hand you a promotion that has already been run.' })
  );
}

function beltPanel() {
  const chosen = new Set(setup.titles);
  return panel('Championships', 'What is already on the wall when you arrive.',
    el('ul', { class: 'belt-list' }, ALL_TITLES.map(title => {
      const on = chosen.has(title.key);
      const isBase = BASE_TITLES.some(t => t.key === title.key);
      return el('li', { class: on ? 'belt-pick on' : 'belt-pick' },
        el('label', {},
          el('input', {
            type: 'checkbox', checked: on,
            onChange: () => change(() => {
              setup.titles = on
                ? setup.titles.filter(k => k !== title.key)
                : [...setup.titles, title.key];
            }),
          }),
          el('span', { class: 'belt-title', text: title.name }),
          el('span', { class: 'belt-tag', text: title.holders === 2 ? 'tag' : (title.gender || 'open') })
        ),
        title.note && !isBase ? el('p', { class: 'setup-note', text: title.note }) : null
      );
    })),
    el('p', { class: 'setup-note', text:
      setup.titles.length
        ? `${setup.titles.length} to defend. Every belt is somebody who has to be `
          + 'beaten to take it and somebody who expects to be on television.'
        : 'No belts at all. Nothing to chase, and nothing to lose.' })
  );
}

function moneyPanel() {
  const wages = wageBill(kept().map(p => ({ ...p.base, role: p.role })));
  const minutes = 60;
  const fee = BASE_FEE + minutes * FEE_PER_MINUTE;
  const net = fee - wages;
  const weeks = net < 0 ? Math.floor(setup.budget / -net) : null;

  return panel('The money', 'What is in the account, and what leaves it weekly.',
    el('div', { class: 'segmented budget' }, BUDGET_PRESETS.map(preset =>
      el('button', {
        type: 'button', class: setup.budget === preset.amount ? 'on' : '',
        text: preset.label, title: preset.note,
        onClick: () => change(() => { setup.budget = preset.amount; }),
      })
    )),
    field('Starting budget', el('div', { class: 'with-unit' },
      el('input', {
        type: 'number', min: '0', step: '10000', value: String(setup.budget),
        onChange: e => change(() => { setup.budget = Math.max(0, Number(e.target.value) || 0); }),
      }),
      el('span', { class: 'unit', text: money(setup.budget) })
    )),
    el('dl', { class: 'setup-read' },
      el('dt', { text: 'Weekly wages' }),
      el('dd', { class: 'num', text: money(wages) }),
      el('dt', { text: 'Rights fee, on the hour' }),
      el('dd', { class: 'num', text: money(fee) }),
      el('dt', { text: 'Each week' }),
      el('dd', { class: `num ${net < 0 ? 'bad' : 'good'}`, text: money(net) })
    ),
    el('p', { class: 'setup-note', text: net < 0
      ? `Losing money from week one. The budget covers about ${weeks} `
        + `week${weeks === 1 ? '' : 's'} before head office starts asking. More `
        + 'television is the way out, and more television is earned.'
      : 'In the black on an hour of television, which gives you room to grow '
        + 'the roster before you have grown the show.' })
  );
}

function sharePanel() {
  return panel('Share this promotion', 'A code somebody else can start from.',
    el('p', { class: 'setup-note', text:
      'The code carries the seed and whatever you changed on top of it, so two '
      + 'people who paste the same one get the same locker room — down to who '
      + 'is already injured.' }),
    el('button', {
      type: 'button', class: 'btn',
      text: shareCode ? 'Code below' : 'Make a code',
      onClick: () => { shareCode = encodeSetup(setup); notify(); },
    }),
    shareCode
      ? el('textarea', {
          class: 'share-code', rows: 3, readonly: true, value: shareCode,
          onClick: e => e.target.select(),
        })
      : null,
    el('div', { class: 'setup-import' },
      el('label', { class: 'lab', text: 'Or start from somebody else’s' }),
      el('textarea', {
        class: 'share-code', rows: 3, placeholder: 'Paste a setup code',
        value: importText,
        onInput: e => { importText = e.target.value; },
      }),
      el('button', {
        type: 'button', class: 'btn',
        text: 'Load it',
        onClick: () => {
          const loaded = decodeSetup(importText);
          if (!loaded) {
            importError = 'That is not a setup code this build understands.';
            notify();
            return;
          }
          setup = loaded;
          if (!setup.promotion) {
            const rolled = rollNames(setup.seed);
            setup.promotion = rolled.promotion;
            setup.show = rolled.show;
            setup.airNight = setup.airNight || rolled.airNight;
          }
          importError = '';
          shareCode = '';
          rebuild();
          notify();
        },
      }),
      importError ? el('p', { class: 'over', text: importError }) : null
    )
  );
}

// ---------------------------------------------------------------- the roster

function rosterPanel() {
  const live = kept();
  return el('div', { class: 'card-panel setup-roster' },
    el('header', {},
      el('h2', { text: 'The locker room' }),
      el('p', { class: 'panel-sub', text:
        `${live.length} wrestlers · ${money(wageBill(live.map(p => ({ ...p.base, role: p.role }))))} a week` })
    ),
    el('div', { class: 'panel-body' },
      el('div', { class: 'setup-field' },
        el('label', { class: 'lab', text: 'Roster size' }),
        el('div', { class: 'with-unit' },
          el('input', {
            type: 'range', min: String(ROSTER_RANGE.min), max: String(ROSTER_RANGE.max),
            value: String(setup.rosterSize),
            onInput: e => change(() => {
              setup.rosterSize = Number(e.target.value);
              // Edits are keyed by position, so a smaller roster drops the
              // ones that no longer exist rather than quietly moving them.
              setup.dropped = (setup.dropped || []).filter(i => i < setup.rosterSize);
              for (const key of Object.keys(setup.edits)) {
                if (Number(key) >= setup.rosterSize) delete setup.edits[key];
              }
            }),
          }),
          el('span', { class: 'unit num', text: `${setup.rosterSize} generated` })
        )
      ),
      el('button', {
        type: 'button', class: 'link',
        text: openRoster ? 'Hide the roster' : 'Edit them one by one',
        onClick: () => { openRoster = !openRoster; notify(); },
      }),
      openRoster ? rosterTable() : null
    )
  );
}

function rosterTable() {
  return el('table', { class: 'setup-table' },
    el('thead', {}, el('tr', {},
      el('th', { text: 'Name' }),
      el('th', { text: 'Archetype' }),
      el('th', { text: 'Role' }),
      el('th', { text: 'Alignment' }),
      el('th', { class: 'num', text: 'Wage' }),
      el('th', { text: '' })
    )),
    el('tbody', {}, preview.map(person => el('tr', { class: person.dropped ? 'dropped' : '' },
      el('td', {}, el('input', {
        type: 'text', class: 'cell-input', value: person.name, maxlength: '40',
        onInput: e => { setup.edits[person.index] = { ...(setup.edits[person.index] || {}), name: e.target.value }; shareCode = ''; },
      })),
      el('td', { class: 'muted', text: person.base.archetype }),
      el('td', {}, el('select', {
        onChange: e => edit(person.index, 'role', e.target.value),
      }, ROLES.map(role => el('option', { value: role, selected: role === person.role, text: role })))),
      el('td', {}, el('select', {
        onChange: e => edit(person.index, 'alignment', e.target.value),
      }, ALIGNMENTS.map(a => el('option', { value: a, selected: a === person.alignment, text: a })))),
      el('td', { class: 'num', text: money(person.wage) }),
      el('td', {}, el('button', {
        type: 'button', class: 'link',
        text: person.dropped ? 'Keep' : 'Cut',
        onClick: () => change(() => {
          const dropped = new Set(setup.dropped || []);
          if (dropped.has(person.index)) dropped.delete(person.index);
          else dropped.add(person.index);
          setup.dropped = [...dropped];
        }),
      }))
    )))
  );
}
