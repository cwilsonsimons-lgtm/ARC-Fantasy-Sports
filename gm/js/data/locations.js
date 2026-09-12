// The building.
//
// The GM is somewhere specific all night, and that is the whole tier. Where you
// are decides what you see, who you can talk to, what you get to rule on, and —
// the part that matters — what happens without you.
//
// The layout is a real backstage rather than a menu: the hallways are the hub
// everything hangs off, Gorilla is next to Production because that is where the
// truck is, and the parking lot is as far from the curtain as anywhere gets. So
// the walk from the curtain to somebody's car is most of a match, and that cost
// is the reason presence is a decision instead of a preference.
//
//              Interview ── Production
//                   │           │
//   Medical ── Locker room ── Hallways ── Gorilla
//                   │           │
//               Catering    GM office
//                               │
//                           Security ── Parking lot
//
export const LOCATIONS = [
  {
    id: 'gorilla', prose: 'gorilla', name: 'Gorilla', short: 'Gorilla',
    note: 'The curtain. Everything goes out through here and everyone comes back through it.',
    sees: 'You see the show as it airs, and you catch people on the way out and on the way back.',
    neighbours: ['hallways', 'production'],
  },
  {
    id: 'office', prose: 'your office', name: 'GM Office', short: 'Office',
    note: 'Your desk. People come here when they want something from you.',
    sees: 'Anyone looking for you knows where to find you. Nothing else reaches this room.',
    neighbours: ['hallways', 'security'],
  },
  {
    id: 'locker', prose: 'the locker room', name: 'Locker room', short: 'Locker room',
    note: 'Most of the roster, most of the night. Where a mood becomes a consensus.',
    sees: 'You hear what the room actually thinks, which is never what it tells you.',
    neighbours: ['hallways', 'medical', 'catering', 'interview'],
  },
  {
    id: 'hallways', prose: 'the hallways', name: 'Hallways', short: 'Hallways',
    note: 'The corridor everything runs through. You see people moving; you control nothing.',
    sees: 'Whatever passes you. It is the fastest way to anywhere and the worst place to be standing.',
    neighbours: ['gorilla', 'office', 'locker', 'production'],
  },
  {
    id: 'medical', prose: 'medical', name: 'Medical', short: 'Medical',
    note: 'The doctor, the table, and whoever is pretending they are fine.',
    sees: 'Who is actually hurt, as opposed to who has said so.',
    neighbours: ['locker'],
  },
  {
    id: 'interview', prose: 'the interview area', name: 'Interview area', short: 'Interview',
    note: 'A curtain, a logo wall and a camera. Whatever gets said here is on television.',
    sees: 'What people are prepared to say with a camera running.',
    neighbours: ['locker', 'production'],
  },
  {
    id: 'production', prose: 'the truck', name: 'Production', short: 'Production',
    note: 'The truck. Timings, graphics, and the people who will tell you the show is running long.',
    sees: 'Exactly how the night is going out, which nobody else in the building knows.',
    neighbours: ['gorilla', 'hallways', 'interview'],
  },
  {
    id: 'parking', prose: 'the car park', name: 'Parking lot', short: 'Parking lot',
    note: 'Cars, buses, and the way out. Nobody comes here to have a conversation.',
    sees: 'Who is leaving. Usually about a minute too late to matter.',
    neighbours: ['security'],
  },
  {
    id: 'catering', prose: 'catering', name: 'Catering', short: 'Catering',
    note: 'Long tables and longer conversations. Where grievances get rehearsed.',
    sees: 'Who is sitting with whom, which tells you more than it should.',
    neighbours: ['locker'],
  },
  {
    id: 'security', prose: 'the security desk', name: 'Security area', short: 'Security',
    note: 'The desk by the loading door, and however many people you can actually call on.',
    sees: 'The doors. And whether anybody you sent for has been found.',
    neighbours: ['office', 'parking'],
  },
];

// Minutes per corridor. A hop is short; the building is what makes it add up.
export const MINUTES_PER_HOP = 2;

const BY_ID = new Map(LOCATIONS.map(l => [l.id, l]));

export function location(id) {
  return BY_ID.get(id) || LOCATIONS[0];
}

export function locationName(id) {
  return location(id).name;
}

// The same room in the middle of a sentence. "You headed for the hallways"
// rather than "You headed for hallways", and never "gm office".
export function locationProse(id) {
  const room = location(id);
  return room.prose || room.name;
}

// Breadth-first over the map above, once, at module load. Ten rooms — the whole
// table is smaller than the code that would avoid building it.
const DISTANCE = (() => {
  const table = new Map();
  for (const from of LOCATIONS) {
    const seen = new Map([[from.id, 0]]);
    const queue = [from.id];
    while (queue.length) {
      const here = queue.shift();
      for (const next of location(here).neighbours) {
        if (seen.has(next)) continue;
        seen.set(next, seen.get(here) + 1);
        queue.push(next);
      }
    }
    table.set(from.id, seen);
  }
  return table;
})();

// Hops, not minutes. Adjacency is what "you can hear it from here" means.
export function hops(fromId, toId) {
  const row = DISTANCE.get(location(fromId).id);
  const n = row ? row.get(location(toId).id) : undefined;
  return n === undefined ? 99 : n;
}

export function walkMinutes(fromId, toId) {
  return hops(fromId, toId) * MINUTES_PER_HOP;
}

export function isAdjacent(fromId, toId) {
  return hops(fromId, toId) === 1;
}

// Everywhere you could go, nearest first, with what it costs to get there.
export function routesFrom(fromId) {
  return LOCATIONS
    .filter(l => l.id !== location(fromId).id)
    .map(l => ({ ...l, minutes: walkMinutes(fromId, l.id) }))
    .sort((a, b) => a.minutes - b.minutes || a.name.localeCompare(b.name));
}
