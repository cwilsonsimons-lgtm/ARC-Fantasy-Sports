// Placeholder roster. Fictional characters. Archetypes are flavour only — no
// stats hang off them yet. Starting morale is spread so week one is not flat.
import { nextId } from '../ids.js';

const SEED = [
  ['Rhett Calloway',  'Male',   'Heel',    'Available',   'Ageing main eventer',      58],
  ['Tomás Ibarra',    'Male',   'Face',    'Available',   'Company man',              66],
  ['Dane Mercer',     'Male',   'Heel',    'Available',   'Ambitious upstart',        44],
  ['Cassidy Vaughn',  'Female', 'Face',    'Available',   'Consummate professional',  62],
  ['Adaeze Okonkwo',  'Female', 'Face',    'Available',   'Reigning draw',            71],
  ['Marisol Reyes',   'Female', 'Heel',    'Available',   'Ruthless technician',      55],
  ['Kip Sanderson',   'Male',   'Face',    'Available',   'Crowd favourite',          60],
  ['The Thresher',    'Male',   'Heel',    'Available',   'Monster',                  50],
  ['Abel Verge',      'Male',   'Heel',    'Available',   'Cult leader',              47],
  ['Nadia Kowalczyk', 'Female', 'Neutral', 'Available',   'Enforcer',                 57],
  ['Bo Trueblood',    'Male',   'Face',    'Injured',     'Veteran on the shelf',     41],
  ['Sunny Delacroix', 'Female', 'Heel',    'Available',   'Camera hog',               52],
  ['Ezra Vance',      'Male',   'Neutral', 'Available',   'Locker room politician',   54],
  ['Junie Park',      'Female', 'Face',    'Available',   'High flyer',               63],
  ['Grady Mullen',    'Male',   'Heel',    'Unavailable', 'Suspended troublemaker',   38],
  ['Odessa Lyle',     'Female', 'Neutral', 'Available',   'Quiet climber',            49],
];

export function seedRoster() {
  return SEED.map(([name, gender, alignment, status, archetype, morale]) => ({
    id: nextId('w'),
    name,
    gender,
    alignment,
    status,
    archetype,
    morale,
    weeksOffCard: 0,
    grudges: [],
  }));
}
