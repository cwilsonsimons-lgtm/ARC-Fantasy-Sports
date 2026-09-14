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
import { TRAITS, ABILITIES } from '../model/traits.js';
import { ARCHETYPES } from '../data/archetypes.js';
import { resetIds } from '../ids.js';
import { listRosters, readRoster, keepFile, removeRoster, describe } from '../rosters.js';
import { toRosterFile, fromText, toText, valid as validRoster } from '../model/roster-file.js';

const ALIGNMENTS = ['Face', 'Heel', 'Neutral'];
const ROLES = ['Main event', 'Upper card', 'Midcard', 'Opener', 'Prospect'];

let setup = null;
let preview = null;
let shareCode = '';
let importText = '';
let importError = '';
let openRoster = false;
let editing = null;   // index into the preview, or 'added:N'
let rosterText = '';
let rosterError = '';
let rosterSaved = '';
const writingArchetype = new Set();   // keys whose archetype is being typed

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
  const read = (wrestler, edit, key) => (edit[key] !== undefined && edit[key] !== '' ? edit[key] : wrestler[key]);
  preview = roster.map((wrestler, index) => {
    const edit = setup.edits[index] || {};
    return {
      key: index,
      written: false,
      base: wrestler,
      edit,
      name: read(wrestler, edit, 'name'),
      gender: read(wrestler, edit, 'gender'),
      alignment: read(wrestler, edit, 'alignment'),
      role: read(wrestler, edit, 'role'),
      archetype: read(wrestler, edit, 'archetype'),
      dropped: (setup.dropped || []).includes(index),
      wage: wageOf({ ...wrestler, role: read(wrestler, edit, 'role') }),
    };
  });

  // Wrestlers written from nothing sit after the generated ones, keyed apart
  // so an edit to one never lands on the other.
  (setup.added || []).forEach((written, n) => {
    preview.push({
      key: `added:${n}`,
      written: true,
      base: null,
      edit: written,
      name: written.name || 'New wrestler',
      gender: written.gender || 'Male',
      alignment: written.alignment || 'Neutral',
      role: written.role || 'Midcard',
      archetype: written.archetype || 'Roster member',
      dropped: false,
      wage: wageOf({ role: written.role || 'Midcard', stats: written.stats || { inRing: 55 } }),
    });
  });
  resetIds();
}

function kept() {
  return preview.filter(p => !p.dropped);
}

function bagFor(key) {
  if (typeof key === 'string' && key.startsWith('added:')) {
    const n = Number(key.slice(6));
    setup.added[n] = setup.added[n] || {};
    return setup.added[n];
  }
  setup.edits[key] = setup.edits[key] || {};
  return setup.edits[key];
}

function edit(key, field, value) {
  const bag = bagFor(key);
  if (value === '' || value === null) delete bag[field];
  else bag[field] = value;
  shareCode = '';
  rebuild();
  notify();
}

// Ability and personality live one level down, and a blank there means "you
// decide" the same way a blank anywhere else does.
//
// This one deliberately does NOT redraw the screen. Rebuilding the page on
// every commit tore the control out from under whoever was using it — a drag
// lost the slider, and typing into a box replaced the box between the clearing
// keystroke and the value. Rating rows repaint themselves instead, and the
// rest of the screen catches up when the panel closes.
function setRating(key, group, field, value) {
  const bag = bagFor(key);
  const box = { ...(bag[group] || {}) };
  const n = Number(value);
  if (value === '' || !Number.isFinite(n)) delete box[field];
  else box[field] = Math.max(0, Math.min(99, Math.round(n)));
  if (Object.keys(box).length) bag[group] = box;
  else delete bag[group];
  shareCode = '';
}

// The full redraw. Everything that changes the roster, the wage bill or the
// share code goes through here; everything inside the editor deliberately does
// not, because redrawing under somebody's cursor takes the control with it.
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
      lockerRoomPanel(),
      sharePanel()
    ),

    rosterPanel(),
    editing !== null ? editorOverlay() : null
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
          el('span', { class: 'belt-title', text: (setup.titleNames || {})[title.key] || title.name }),
          el('span', { class: 'belt-tag', text: title.holders === 2 ? 'tag' : (title.gender || 'open') })
        ),
        // Call it whatever it is called. Only the name changes — how many
        // people hold it and which division it locks stay with the template.
        on
          ? el('input', {
              type: 'text', class: 'belt-rename', maxlength: '48',
              placeholder: title.name,
              value: (setup.titleNames || {})[title.key] || '',
              onInput: e => {
                setup.titleNames = setup.titleNames || {};
                if (e.target.value) setup.titleNames[title.key] = e.target.value;
                else delete setup.titleNames[title.key];
                shareCode = '';
              },
              onChange: () => change(() => {}),
            })
          : null,
        title.note && !isBase && !on ? el('p', { class: 'setup-note', text: title.note }) : null
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
          class: 'share-code setup-code', rows: 3, readonly: true, value: shareCode,
          onClick: e => e.target.select(),
        })
      : null,
    // A seed and a few tweaks is a line of text. A roster written wrestler by
    // wrestler is not, and somebody about to paste one into a message should
    // find that out here rather than in the message.
    shareCode
      ? el('p', { class: `setup-note${shareCode.length > 4000 ? ' over' : ''}`, text:
          shareCode.length > 4000
            ? `${shareCode.length} characters. That is a written roster rather than a seed — `
              + 'save it to a file rather than pasting it into a chat.'
            : `${shareCode.length} characters.` })
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
      el('div', { class: 'roster-tools' },
        el('button', {
          type: 'button', class: 'link',
          text: openRoster ? 'Hide the roster' : 'Edit them one by one',
          onClick: () => { openRoster = !openRoster; notify(); },
        }),
        el('button', {
          type: 'button', class: 'btn', text: 'Write one from nothing',
          title: 'A wrestler who is not on the seed at all. Everything about them is yours.',
          onClick: () => change(() => {
            setup.added = setup.added || [];
            setup.added.push({ name: 'New wrestler' });
            openRoster = true;
            editing = `added:${setup.added.length - 1}`;
          }),
        })
      ),
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
        onInput: e => { bagFor(person.key).name = e.target.value; shareCode = ''; },
      })),
      el('td', { class: 'muted arch-cell', text: person.archetype },
        written(person) ? el('span', { class: 'authored', title: 'You wrote this one', text: '✎' }) : null),
      el('td', {}, el('select', {
        onChange: e => edit(person.key, 'role', e.target.value),
      }, ROLES.map(role => el('option', { value: role, selected: role === person.role, text: role })))),
      el('td', {}, el('select', {
        onChange: e => edit(person.key, 'alignment', e.target.value),
      }, ALIGNMENTS.map(a => el('option', { value: a, selected: a === person.alignment, text: a })))),
      el('td', { class: 'num', text: money(person.wage) }),
      el('td', { class: 'row-actions' },
        el('button', {
          type: 'button', class: 'link', text: 'Edit',
          onClick: () => { editing = person.key; notify(); },
        }),
        el('button', {
          type: 'button', class: 'link',
          text: person.written ? 'Delete' : person.dropped ? 'Keep' : 'Cut',
          onClick: () => change(() => {
            if (person.written) {
              setup.added.splice(Number(String(person.key).slice(6)), 1);
              return;
            }
            const dropped = new Set(setup.dropped || []);
            if (dropped.has(person.key)) dropped.delete(person.key);
            else dropped.add(person.key);
            setup.dropped = [...dropped];
          }),
        })
      )
    )))
  );
}

// Whether anything about this one was written rather than rolled.
function written(person) {
  return person.written || Object.keys(person.edit || {}).length > 0;
}

// ---------------------------------------------------------------- the editor

// Everything about one wrestler, in one place. A field left blank is still the
// generator's to decide, so the panel shows what it *would* be beside every
// empty box — you are always looking at the wrestler you are about to get,
// not at a form.
function editorOverlay() {
  const person = preview.find(p => p.key === editing);
  if (!person) { editing = null; return null; }

  return el('div', {
    class: 'overlay',
    onClick: e => { if (e.target.classList.contains('overlay')) { editing = null; notify(); } },
  },
    el('div', { class: 'card editor', role: 'dialog', 'aria-label': `Edit ${person.name}` },
      el('button', {
        type: 'button', class: 'card-close', text: '✕', title: 'Close',
        onClick: () => { editing = null; notify(); },
      }),
      el('div', { class: 'editor-head' },
        el('span', { class: 'lab', text: person.written ? 'Written from nothing' : 'Rolled from the seed' }),
        el('h3', { text: person.name }),
        el('p', { class: 'muted', text: person.written
          ? 'Nothing here came from the seed. Anything you leave blank sits in the middle.'
          : 'Anything you leave blank stays as the seed rolled it, shown in grey.' })
      ),
      el('div', { class: 'editor-body' },
        identityBlock(person),
        abilityBlock(person),
        personalityBlock(person),
        recordBlock(person)
      ),
      el('div', { class: 'editor-foot' },
        el('button', {
          type: 'button', class: 'link', text: 'Clear everything I wrote',
          onClick: () => change(() => {
            if (person.written) setup.added[Number(String(person.key).slice(6))] = { name: person.name };
            else delete setup.edits[person.key];
          }),
        }),
        el('button', {
          type: 'button', class: 'btn primary', text: 'Done',
          onClick: () => change(() => { editing = null; }),
        })
      )
    )
  );
}

function editorSection(title, note, ...body) {
  return el('div', { class: 'editor-section' },
    el('h4', { text: title }),
    note ? el('p', { class: 'setup-note', text: note }) : null,
    ...body
  );
}

function identityBlock(person) {
  const pick = (label, fieldName, options) => el('div', { class: 'setup-field' },
    el('label', { class: 'lab', text: label }),
    el('select', { onChange: e => edit(person.key, fieldName, e.target.value) },
      options.map(value => el('option', {
        value, selected: value === person[fieldName], text: value,
      })))
  );

  const custom = writingArchetype.has(person.key)
    || (person.archetype && !ARCHETYPES.some(a => a.label === person.archetype));

  return editorSection('Who they are', null,
    el('div', { class: 'editor-grid' },
      el('div', { class: 'setup-field' },
        el('label', { class: 'lab', text: 'Name' }),
        el('input', {
          type: 'text', value: person.name, maxlength: '40',
          onInput: e => { bagFor(person.key).name = e.target.value; shareCode = ''; },
        })
      ),
      pick('Gender', 'gender', ['Male', 'Female']),
      pick('Alignment', 'alignment', ALIGNMENTS),
      pick('Role', 'role', ROLES),
      pick('Status', 'status', ['Available', 'Injured', 'Unavailable'])
    ),
    // The archetype is a label everywhere the game reads it — only its stat
    // bands ever mattered, and those are spent the moment somebody is rolled.
    // So anything you can type is as real as the seventeen.
    el('div', { class: 'setup-field' },
      el('label', { class: 'lab', text: 'Archetype' }),
      el('select', {
        onChange: e => {
          if (e.target.value === '__custom') {
            writingArchetype.add(person.key);
            notify();
            return;
          }
          writingArchetype.delete(person.key);
          edit(person.key, 'archetype', e.target.value);
        },
      },
        ARCHETYPES.map(a => el('option', {
          value: a.label, selected: a.label === person.archetype, text: a.label,
        })),
        el('option', { value: '__custom', selected: custom, text: 'Write your own...' })
      ),
      custom
        ? el('input', {
            type: 'text', value: person.archetype, maxlength: '40',
            placeholder: 'Bloodline enforcer',
            onInput: e => { bagFor(person.key).archetype = e.target.value; shareCode = ''; },
          })
        : null,
      el('p', { class: 'setup-note', text: 'Only the label reaches the game. Type whatever the character is.' })
    ),
    el('div', { class: 'setup-field' },
      el('label', { class: 'lab', text: 'Description' }),
      el('textarea', {
        rows: 3, value: person.edit.bio !== undefined ? person.edit.bio : (person.base ? person.base.bio : ''),
        placeholder: 'What is their deal?',
        onInput: e => { bagFor(person.key).bio = e.target.value; shareCode = ''; },
      })
    )
  );
}

// A 0-99 box that shows the rolled value as its placeholder, so an empty field
// reads as "this is what you will get" rather than as a missing answer.
function ratingRow(person, group, key, label, note) {
  const rolled = person.base ? (person.base[group] || {})[key] : null;
  const hasRoll = Number.isFinite(rolled);
  const current = () => (bagFor(person.key)[group] || {})[key];

  const box = el('input', {
    type: 'number', class: 'rating-num', min: '0', max: '99',
    placeholder: hasRoll ? String(rolled) : '',
  });
  const slider = el('input', { type: 'range', min: '0', max: '99' });
  const source = el('span', { class: 'rating-src' });
  const clear = el('button', {
    type: 'button', class: 'link rating-clear', text: 'clear',
    title: 'Hand it back to the seed',
  });

  function paint() {
    const written = current();
    const value = written !== undefined ? written : (hasRoll ? rolled : 50);
    box.value = written !== undefined ? String(written) : '';
    slider.value = String(value);
    source.textContent = person.base ? 'rolled' : 'middle';
    source.hidden = written !== undefined;
    clear.hidden = written === undefined;
    row.classList.toggle('written', written !== undefined);
  }

  const commit = value => { setRating(person.key, group, key, value); paint(); };

  // Dragging writes the live figure into the box beside it and commits nothing
  // until the drag is finished.
  slider.addEventListener('input', e => { box.value = e.target.value; });
  slider.addEventListener('change', e => commit(e.target.value));
  // Committing as it is typed is only affordable because commits no longer
  // redraw anything. It means a figure counts the moment it is entered rather
  // than whenever the box happens to lose focus.
  box.addEventListener('input', e => commit(e.target.value));
  box.addEventListener('change', e => commit(e.target.value));
  clear.addEventListener('click', () => commit(''));

  const row = el('div', { class: 'rating-row' },
    el('label', { class: 'rating-key', text: label, title: note || '' }),
    slider, box, source, clear
  );
  paint();
  return row;
}

function abilityBlock(person) {
  return editorSection('What they can do',
    'Ability decides matches. Write either one and you know what they can do from week one.',
    el('div', { class: 'ratings' },
      ABILITIES.map(stat => ratingRow(person, 'stats', stat.key, stat.label, stat.note))
    )
  );
}

function personalityBlock(person) {
  return editorSection('Who they are backstage',
    'Personality decides everything that is not a match. Write any of it and you '
    + 'know the person, not just the worker.',
    el('div', { class: 'ratings ratings-two' },
      TRAITS.map(trait => ratingRow(person, 'traits', trait.key, trait.label, trait.note))
    )
  );
}

function recordBlock(person) {
  const rec = person.edit.record || {};
  const rolled = person.base ? person.base.record : { wins: 0, losses: 0 };
  const box = (key, label) => el('div', { class: 'setup-field' },
    el('label', { class: 'lab', text: label }),
    el('input', {
      type: 'number', min: '0', max: '999',
      placeholder: String(rolled[key] || 0),
      value: rec[key] !== undefined ? String(rec[key]) : '',
      // Model only. Blurring this box to click Done must not delete Done.
      onInput: e => {
        const bag = bagFor(person.key);
        const next = { ...(bag.record || {}) };
        const n = Number(e.target.value);
        if (e.target.value === '' || !Number.isFinite(n)) delete next[key];
        else next[key] = Math.max(0, Math.min(999, Math.round(n)));
        if (Object.keys(next).length) bag.record = next; else delete bag.record;
        shareCode = '';
      },
    })
  );
  return editorSection('Record', 'Where they stand before your first show.',
    el('div', { class: 'editor-grid' }, box('wins', 'Wins'), box('losses', 'Losses'))
  );
}

// ---------------------------------------------------------------- the library

// Locker rooms you have kept. A roster outlives the promotion it came from:
// save the one you spent sixty weeks building, then start a fresh promotion
// with the same people and none of the history.
function lockerRoomPanel() {
  const kept = listRosters();
  const loaded = setup.roster;

  return panel('Locker rooms', 'Rosters you kept, and rosters somebody sent you.',
    loaded
      ? el('div', { class: 'lr-loaded' },
          el('span', { class: 'lab', text: 'Loaded' }),
          el('b', { text: loaded.name || 'Locker room' }),
          el('span', { class: 'muted', text: describe(loaded) }),
          el('button', {
            type: 'button', class: 'link', text: 'Use the seed instead',
            onClick: () => change(() => { setup.roster = null; }),
          })
        )
      : el('p', { class: 'setup-note', text:
          'Nothing loaded. The roster below is the one the seed rolled.' }),

    kept.length
      ? el('ul', { class: 'lr-list' }, kept.map(entry => el('li', { class: 'lr-row' },
          el('div', {},
            el('b', { text: entry.name }),
            el('span', { class: 'muted', text:
              `${entry.count} wrestlers${entry.teams ? ` · ${entry.teams} team${entry.teams === 1 ? '' : 's'}` : ''}`
              + `${entry.source ? ` · ${entry.source}` : ''}` })
          ),
          el('div', { class: 'lr-actions' },
            el('button', {
              type: 'button', class: 'link', text: 'Load',
              onClick: () => change(() => {
                const file = readRoster(entry.id);
                if (file) setup.roster = file;
              }),
            }),
            el('button', {
              type: 'button', class: 'link', text: 'Forget',
              onClick: () => change(() => { removeRoster(entry.id); }),
            })
          )
        )))
      : el('p', { class: 'setup-note', text:
          'No locker rooms kept yet. Save one from the roster screen of a save '
          + 'you are playing, or paste one in below.' }),

    // Keeping the roster currently on this screen, whether it was rolled,
    // edited, or written from nothing.
    el('button', {
      type: 'button', class: 'btn', text: 'Keep the roster below',
      onClick: () => {
        const people = kept0();
        const entry = keepFile(toRosterFile(people, setup.promotion || 'Locker room'), 'from setup');
        rosterSaved = entry ? `Kept as "${entry.name}".` : 'Could not keep it — storage is full.';
        rebuild();
        notify();
      },
    }),
    rosterSaved ? el('p', { class: 'setup-note', text: rosterSaved }) : null,

    el('div', { class: 'setup-import' },
      el('label', { class: 'lab', text: 'Paste a locker room' }),
      el('textarea', {
        class: 'share-code', rows: 3, placeholder: 'Paste the text of a locker room',
        value: rosterText,
        onInput: e => { rosterText = e.target.value; },
      }),
      el('div', { class: 'lr-actions' },
        el('button', {
          type: 'button', class: 'btn', text: 'Load it',
          onClick: () => {
            const file = fromText(rosterText);
            if (!file) {
              rosterError = 'That is not a locker room this build understands.';
              notify();
              return;
            }
            rosterError = '';
            rosterText = '';
            change(() => {
              setup.roster = file;
              keepFile(file, 'pasted in');
            });
          },
        }),
        loaded
          ? el('button', {
              type: 'button', class: 'link', text: 'Copy this one as text',
              onClick: () => { rosterText = toText(loaded); notify(); },
            })
          : null
      ),
      rosterError ? el('p', { class: 'over', text: rosterError }) : null
    )
  );
}

// The roster as it currently stands on this screen, as whole wrestlers rather
// than preview rows — which is what a locker-room file is made of.
function kept0() {
  return kept().map(person => ({
    id: person.base ? person.base.id : `w_new_${person.key}`,
    name: person.name,
    gender: person.gender,
    alignment: person.alignment,
    role: person.role,
    archetype: person.archetype,
    archetypeId: person.base ? person.base.archetypeId : null,
    bio: person.edit.bio !== undefined ? person.edit.bio : (person.base ? person.base.bio : ''),
    photo: null,
    baseline: person.base ? person.base.baseline : 55,
    stats: { ...(person.base ? person.base.stats : { inRing: 55, charisma: 55 }), ...(person.edit.stats || {}) },
    traits: { ...(person.base ? person.base.traits : {}), ...(person.edit.traits || {}) },
    matchTypes: person.base ? person.base.matchTypes : {},
    record: person.edit.record || (person.base ? person.base.record : { wins: 0, losses: 0 }),
    relationships: person.base ? person.base.relationships : {},
  }));
}
