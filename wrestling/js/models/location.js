// The backstage.
//
// Nine rooms and a corridor joining them. The corridor matters: almost nothing
// is next to almost anything, so crossing the building costs time, and time is
// what turns "something happened" into "something happened and you were not
// there".
//
// This is a pure graph. Nothing here knows who is standing where.

export const LOCATIONS = Object.freeze({
  gorilla: {
    id: 'gorilla',
    name: 'Gorilla Position',
    short: 'Gorilla',
    blurb: 'The curtain. Where the show is actually run from.',
    onAir: true,
  },
  gm_office: {
    id: 'gm_office',
    name: 'GM Office',
    short: 'Office',
    blurb: 'Your desk. Where people come to find you, if they can.',
  },
  locker_room: {
    id: 'locker_room',
    name: 'Locker Room',
    short: 'Locker',
    blurb: 'Where the roster waits, and where most of it goes wrong.',
  },
  hallway: {
    id: 'hallway',
    name: 'Hallways',
    short: 'Halls',
    blurb: 'Everything connects through here. You see people passing.',
    hub: true,
  },
  medical: {
    id: 'medical',
    name: 'Medical',
    short: 'Medical',
    blurb: 'The trainer. Nobody comes here with good news.',
  },
  interview_area: {
    id: 'interview_area',
    name: 'Interview Area',
    short: 'Interview',
    blurb: 'Backdrop and a camera. Words get said here that get repeated.',
  },
  production: {
    id: 'production',
    name: 'Production',
    short: 'Truck',
    blurb: 'The truck. Timing, graphics, and whoever is shouting about them.',
    onAir: true,
  },
  catering: {
    id: 'catering',
    name: 'Catering',
    short: 'Catering',
    blurb: 'Where the talking happens. Everybody passes through eventually.',
  },
  parking: {
    id: 'parking',
    name: 'Parking and Loading',
    short: 'Parking',
    blurb: 'Arrivals, departures, and the odd conversation nobody wanted overheard.',
  },
});

export const LOCATION_IDS = Object.freeze(Object.keys(LOCATIONS));

/** Undirected. The hallway is the hub; a few rooms genuinely adjoin. */
const EDGES = [
  ['hallway', 'gorilla'], ['hallway', 'gm_office'], ['hallway', 'locker_room'],
  ['hallway', 'medical'], ['hallway', 'interview_area'], ['hallway', 'production'],
  ['hallway', 'catering'], ['hallway', 'parking'],
  ['gorilla', 'production'], ['gorilla', 'interview_area'],
  ['locker_room', 'medical'], ['locker_room', 'catering'],
];

export const NEIGHBOURS = Object.freeze((() => {
  const map = Object.fromEntries(LOCATION_IDS.map((id) => [id, []]));
  for (const [a, b] of EDGES) { map[a].push(b); map[b].push(a); }
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, Object.freeze(v.sort())]));
})());

/** Seconds to cross one doorway. Crossing the building is several of these. */
export const SECONDS_PER_HOP = 45;

export function isLocation(id) {
  return Object.prototype.hasOwnProperty.call(LOCATIONS, id);
}

export function locationName(id) {
  return LOCATIONS[id]?.name || id;
}

/** The name as it fits in a status chip. */
export function locationShort(id) {
  return LOCATIONS[id]?.short || locationName(id);
}

/** Doorways between two rooms. 0 if the same room, Infinity if unreachable. */
export function hops(from, to) {
  if (from === to) return 0;
  if (!isLocation(from) || !isLocation(to)) return Infinity;
  const seen = new Set([from]);
  let frontier = [from];
  let depth = 0;
  while (frontier.length) {
    depth++;
    const next = [];
    for (const here of frontier) {
      for (const there of NEIGHBOURS[here]) {
        if (there === to) return depth;
        if (seen.has(there)) continue;
        seen.add(there);
        next.push(there);
      }
    }
    frontier = next;
  }
  return Infinity;
}

export function travelSeconds(from, to) {
  const n = hops(from, to);
  return Number.isFinite(n) ? n * SECONDS_PER_HOP : Infinity;
}

/** The shortest way there, as a list of rooms including both ends. */
export function route(from, to) {
  if (from === to) return [from];
  if (!isLocation(from) || !isLocation(to)) return [];
  const prev = { [from]: null };
  let frontier = [from];
  while (frontier.length) {
    const next = [];
    for (const here of frontier) {
      for (const there of NEIGHBOURS[here]) {
        if (there in prev) continue;
        prev[there] = here;
        if (there === to) {
          const path = [to];
          let step = here;
          while (step) { path.unshift(step); step = prev[step]; }
          return path;
        }
        next.push(there);
      }
    }
    frontier = next;
  }
  return [];
}

/** Rooms from which the show can be run. Leaving them has a cost of its own. */
export function isOnAir(id) {
  return !!LOCATIONS[id]?.onAir;
}
