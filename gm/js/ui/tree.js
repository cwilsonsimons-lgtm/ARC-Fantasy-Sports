// The GM board.
//
// Seven lanes, four tiers, read bottom to top: cheap verbs at the foot of the
// screen, the four capstone slots at the head of it. The whole catalogue is
// drawn, including the upgrades that are not built yet — a tree you cannot see
// the end of is a list, and the point of a board is being able to put a finger
// on something at level one and trace it up to what it becomes.
//
// Selecting a node dims the board and lights only the path to it. That is the
// most important thing on this screen: a tree you cannot plan against is a tree
// you spend points in at random.
import { el } from './dom.js';
import { commit, notify } from '../store.js';
import {
  BRANCHES, TIERS, UPGRADES, upgrade, upgradesIn, trustBand, trustNeeded,
} from '../data/upgrades.js';
import {
  progression, levelProgress, statusOf, blockers, cutReason, buy,
  capstonesHeld, pointsSpent, chainFor, runCost, branchProgress,
  CAPSTONE_SLOTS, MAX_LEVEL,
} from '../model/progression.js';
import { bossView } from '../model/executives.js';

// Which node the board is tracing, and which lane the phone-width picker is
// showing. Interface state, so it lives here and never touches the save.
let selected = null;
let lane = 'authority';

function context(state) {
  return { trust: state.network.trust, standing: bossView(state).value };
}

export function renderTree(state) {
  const gm = progression(state);
  const ctx = context(state);

  return el('section', { class: 'wide tree-view' },
    deck(state, gm),
    el('div', { class: 'tree-stage' },
      el('div', { class: 'boardwrap' },
        board(state, ctx),
        legend()
      ),
      el('div', { class: 'tree-side' },
        detail(state, ctx),
        branchKey(state)
      )
    )
  );
}

// ---------------------------------------------------------------- the header

function deck(state, gm) {
  const level = levelProgress(state);
  const boss = bossView(state);
  const spent = pointsSpent(state);

  return el('div', { class: 'tree-deck' },
    metric('GM Level', el('span', { class: 'metric-v num', text: String(gm.level) }),
      level.capped
        ? el('span', { class: 'muted', text: 'as far as it goes' })
        : el('span', { class: 'xpbar' },
            el('i', { style: `width:${Math.round(level.share * 100)}%` }))),
    metric('Unspent', el('span', { class: 'metric-v big num', text: String(gm.points) }),
      el('span', { class: 'muted', text: `${spent} spent` })),
    metric('Capstones',
      el('span', { class: 'metric-v num', text: `${capstonesHeld(state)} / ${CAPSTONE_SLOTS}` }),
      el('span', { class: 'muted', text: 'the cap never rises' })),
    metric('Management trust',
      el('span', { class: 'metric-v', text: trustBand(state.network.trust) }),
      el('span', { class: 'muted num', text: String(state.network.trust) })),
    metric('Standing', el('span', { class: 'metric-v phrase', text: boss.phrase }), null)
  );
}

function metric(label, value, note) {
  return el('div', { class: 'tree-met' },
    el('span', { class: 'lab', text: label }),
    value,
    note
  );
}

// ---------------------------------------------------------------- the board

function board(state, ctx) {
  const rows = [];
  rows.push(el('div', { class: 'gut' }));
  for (const branch of BRANCHES) {
    const read = branchProgress(state, branch.id);
    rows.push(el('div', {
      class: `lanehead lane-${branch.id}`, style: `--b:${branch.colour}`,
    },
      el('b', { text: branch.name }),
      el('span', {}, el('em', { text: String(read.owned) }), ` / ${read.total} owned`)
    ));
  }

  // Top to bottom on screen is Legacy first, which is the same board read
  // bottom to top. The doctrine bands are the only thing that crosses lanes.
  const order = [...TIERS].reverse();
  order.forEach((tier, index) => {
    if (index === 1) rows.push(doctrineBand(state, 2, 20));
    if (index === 3) rows.push(doctrineBand(state, 1, 6));
    rows.push(el('div', { class: 'gut' },
      el('b', { text: tier.label }),
      el('span', { text: tier.levels })
    ));
    for (const branch of BRANCHES) {
      rows.push(el('div', {
        class: `lane lane-${branch.id}`, style: `--b:${branch.colour}`,
      }, upgradesIn(branch.id, tier.id).map(u => node(state, u, ctx))));
    }
  });

  // `showing-*` is only honoured at phone width, where the seven lanes become
  // one lane and a picker. On a desktop it does nothing.
  return el('div', { class: `tree-board showing-${lane}${selected ? ' tracing' : ''}` }, rows);
}

function node(state, u, ctx) {
  const status = statusOf(state, u.id, ctx);
  const lit = selected ? chainFor(selected).has(u.id) : true;
  const classes = ['tree-node', `s-${status}`];
  if (u.tier === 'Capstones') classes.push('cap');
  if (!u.built) classes.push('unbuilt');
  if (selected && lit) classes.push('lit');
  if (selected === u.id) classes.push('sel');

  return el('button', {
    type: 'button', class: classes.join(' '),
    title: `${u.name} — ${u.hook}`,
    onClick: () => { selected = selected === u.id ? null : u.id; notify(); },
  },
    el('span', { class: 'pip', text: String(u.cost) }),
    el('span', { class: 'nm', text: u.name })
  );
}

const DOORS = ['The Hand', 'The Ear', 'The Desk'];

function doctrineBand(state, which, level) {
  const gm = progression(state);
  const held = gm.doctrines[which - 1] || null;
  const open = gm.level >= level;

  return el('div', { class: 'doctrine-band' },
    el('span', { class: 'lab', text: `Doctrine ${which === 1 ? 'I' : 'II'} · level ${level}` }),
    el('div', { class: 'doors' }, DOORS.map(door => el('span', {
      class: 'door'
        + (gm.doctrines.includes(door) ? ' taken' : '')
        + (!gm.doctrines.includes(door) && gm.doctrines.length >= 2 ? ' gone' : ''),
      text: door,
    }))),
    el('em', {
      text: held
        ? 'Taken. The doors you did not walk through stay shut.'
        : open
          ? 'Doctrine is not built yet — the board shows where it will sit.'
          : `Opens at level ${level}.`,
    })
  );
}

function legend() {
  const key = (cls, text) => el('span', {}, el('i', { class: cls }), text);
  return el('div', { class: 'tree-legend' },
    key('i-own', 'Owned'),
    key('i-open', 'Available now'),
    key('i-lock', 'Locked'),
    key('i-cut', 'Gone for good'),
    el('span', { text: '◆ Capstone' }),
    el('span', { class: 'muted', text: 'Click any node to trace its path' })
  );
}

// ---------------------------------------------------------------- the detail

function detail(state, ctx) {
  if (!selected) return intro(state);

  const u = upgrade(selected);
  const status = statusOf(state, u.id, ctx);
  const cut = cutReason(state, u.id);
  const miss = blockers(state, u.id, ctx);
  const branch = BRANCHES.find(b => b.id === u.branch);

  return el('div', { class: 'tree-detail', style: `--b:${branch.colour}` },
    el('div', { class: 'tree-head' },
      el('span', { class: 'lab', text: branch.name }),
      el('h3', { text: u.name }),
      el('p', { class: 'hook', text: u.hook })
    ),
    el('div', { class: 'detail-body' },
      el('p', { class: 'effect', text: u.effect }),
      verdict(state, u, status, cut, miss),
      specs(state, u, ctx),
      status === 'locked' ? traceList(state, u, miss) : null,
      status === 'open'
        ? el('button', {
            type: 'button', class: 'btn primary',
            text: `Buy — ${u.cost} point${u.cost === 1 ? '' : 's'}`,
            onClick: () => commit(s => { buy(s, u.id, context(s)); }),
          })
        : null
    )
  );
}

function intro(state) {
  const gm = progression(state);
  const built = UPGRADES.filter(u => u.built).length;
  return el('div', { class: 'tree-detail', style: '--b:var(--cool)' },
    el('div', { class: 'tree-head' },
      el('span', { class: 'lab', text: `${UPGRADES.length} upgrades · 269 points` }),
      el('h3', { text: 'Pick anything on the board' }),
      el('p', { class: 'hook', text:
        'You will earn about 97 points by level ' + MAX_LEVEL
        + '. That is a third of this tree, and no two GMs spend it the same way.' })
    ),
    el('div', { class: 'detail-body' },
      el('p', { class: 'effect', text:
        'Selecting an upgrade dims the board and lights only the path to it — '
        + 'every prerequisite, the level it needs and the trust band it needs.' }),
      el('dl', { class: 'specs' },
        spec('Owned', `${gm.spent.length} upgrades, ${pointsSpent(state)} points spent`),
        spec('Built so far', `${built} of ${UPGRADES.length} do something today`),
        spec('Capstones', `${capstonesHeld(state)} of ${CAPSTONE_SLOTS} slots used`)
      ),
      el('p', { class: 'muted', text:
        'Greyed nodes with no border are designed and not built yet. They are on '
        + 'the board so you can see where a branch goes before you commit to it.' })
    )
  );
}

function verdict(state, u, status, cut, miss) {
  if (status === 'owned') {
    return el('div', { class: 'verdict ok', text: `Owned. Bought for ${u.cost} point${u.cost === 1 ? '' : 's'}.` });
  }
  if (status === 'cut') return el('div', { class: 'verdict cut', text: `Gone for good. ${cut}` });
  if (status === 'open') {
    return el('div', { class: 'verdict can', text: `Available now — ${u.cost} of your ${progression(state).points} points.` });
  }
  return el('div', { class: 'verdict no', text: `Locked — ${miss.length} thing${miss.length === 1 ? '' : 's'} in the way.` });
}

function spec(key, value, bad) {
  return [el('dt', { text: key }), el('dd', { class: bad ? 'no' : '', text: value })];
}

function specs(state, u, ctx) {
  const gm = progression(state);
  const rows = [];
  rows.push(spec('Cost', `${u.cost} point${u.cost === 1 ? '' : 's'}`));
  rows.push(spec('Level', u.level > gm.level ? `${u.level} — you are ${gm.level}` : String(u.level), u.level > gm.level));
  rows.push(spec('Trust', u.trust || '—', Boolean(u.trust) && trustNeeded(u.trust) > ctx.trust));
  if (u.standing) rows.push(spec('Standing', u.standing));
  rows.push(spec('Requires',
    (u.requires || []).map(id => (upgrade(id) ? upgrade(id).name : id)).join(', ') || '—'));
  if ((u.excludes || []).length) {
    rows.push(spec('Excludes', u.excludes.map(id => (upgrade(id) ? upgrade(id).name : id)).join(', '), true));
  }
  if (u.doctrine) rows.push(spec('Doctrine', u.doctrine));
  if (u.shutBy) rows.push(spec('Shut by', `Doctrine: ${u.shutBy}`));
  rows.push(spec('Tier', u.tier === 'Capstones' ? 'Capstone' : u.tier));
  if (!u.built) rows.push(spec('Status', 'Designed, not built yet', true));
  return el('dl', { class: 'specs' }, rows.flat());
}

function traceList(state, u, miss) {
  const done = [...chainFor(u.id)].filter(id => id !== u.id && statusOf(state, id) === 'owned');
  const total = runCost(state, u.id);
  const gm = progression(state);

  return el('div', {},
    el('ul', { class: 'trace' },
      miss.map(([what, why]) => el('li', { class: 'miss' },
        el('i', { text: '✕' }),
        el('span', {}, what, el('em', { text: ` — ${why}` }))
      )),
      done.map(id => el('li', { class: 'done' },
        el('i', { text: '✓' }),
        el('span', { text: upgrade(id).name })
      ))
    ),
    el('div', { class: 'trace-total', text:
      `Total from here: ${total} points`
      + (u.level > gm.level ? ` · ${u.level - gm.level} level${u.level - gm.level === 1 ? '' : 's'}` : '') })
  );
}

// ---------------------------------------------------------------- the key

function branchKey(state) {
  return el('div', { class: 'tree-key' },
    el('h4', { text: 'The seven branches' }),
    el('ol', {}, BRANCHES.map(branch => {
      const read = branchProgress(state, branch.id);
      const share = read.cost ? Math.round((read.points / read.cost) * 100) : 0;
      return el('li', { style: `--b:${branch.colour}`, class: lane === branch.id ? 'on' : '',
        onClick: () => { lane = branch.id; notify(); } },
        el('span', { class: 'sw' }),
        el('span', {},
          el('b', { text: branch.name }),
          el('em', { text: branch.question })),
        el('span', { class: 'ct' },
          el('u', { text: String(read.owned) }), ` / ${read.total}`),
        el('span', { class: 'keybar' }, el('i', { style: `width:${share}%` }))
      );
    })),
    el('p', { class: 'muted', text:
      'Bars show points spent, not upgrades owned — a branch can be a third '
      + 'owned and two thirds paid for.' })
  );
}

// The phone-width picker shows one lane at a time. Exported so main.js can
// reset it when a save is opened.
export function resetTree() {
  selected = null;
  lane = 'authority';
}
