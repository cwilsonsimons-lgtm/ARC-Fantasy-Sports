// Placeholder roster. Fictional characters, no stats yet — just the five fields
// the prototype needs. Ids are assigned at seed time from the shared counter.
import { nextId } from '../ids.js';

const SEED = [
  ['Rhett Calloway',   'Male',   'Heel',    'Available'],
  ['Tomás Ibarra',     'Male',   'Face',    'Available'],
  ['Dane Mercer',      'Male',   'Heel',    'Available'],
  ['Cassidy Vaughn',   'Female', 'Face',    'Available'],
  ['Adaeze Okonkwo',   'Female', 'Face',    'Available'],
  ['Marisol Reyes',    'Female', 'Heel',    'Available'],
  ['Kip Sanderson',    'Male',   'Face',    'Available'],
  ['The Thresher',     'Male',   'Heel',    'Available'],
  ['Abel Verge',       'Male',   'Heel',    'Available'],
  ['Nadia Kowalczyk',  'Female', 'Neutral', 'Available'],
  ['Bo Trueblood',     'Male',   'Face',    'Injured'],
  ['Sunny Delacroix',  'Female', 'Heel',    'Available'],
  ['Ezra Vance',       'Male',   'Neutral', 'Available'],
  ['Junie Park',       'Female', 'Face',    'Available'],
  ['Grady Mullen',     'Male',   'Heel',    'Unavailable'],
  ['Odessa Lyle',      'Female', 'Neutral', 'Available'],
];

export function seedRoster() {
  return SEED.map(([name, gender, alignment, status]) => ({
    id: nextId('w'),
    name,
    gender,
    alignment,
    status,
  }));
}
