// Placeholder roster. Fictional characters.
//
// Stats are hidden from the player at first and surface as their read on each
// wrestler improves — see model/stats.js. They are on a 0-100 scale internally
// and are never shown as numbers.
import { nextId } from '../ids.js';

const SEED = [
  {
    name: 'Rhett Calloway', gender: 'Male', alignment: 'Heel', status: 'Available',
    archetype: 'Ageing main eventer', role: 'Main event', morale: 58,
    bio: 'Sixteen years on top and no intention of stepping down. Goes long, every time, and dares you to say something about it.',
    stats: { inRing: 82, charisma: 74, ambition: 61, ego: 91, professionalism: 44 },
  },
  {
    name: 'Tomás Ibarra', gender: 'Male', alignment: 'Face', status: 'Available',
    archetype: 'Company man', role: 'Main event', morale: 66,
    bio: 'Never misses a date, never complains, never asks. The locker room trusts him more than it trusts you.',
    stats: { inRing: 78, charisma: 66, ambition: 40, ego: 35, professionalism: 94 },
  },
  {
    name: 'Dane Mercer', gender: 'Male', alignment: 'Heel', status: 'Available',
    archetype: 'Ambitious upstart', role: 'Midcard', morale: 44,
    bio: 'Convinced he is being held down, and not entirely wrong. Counts every minute of television he does not get.',
    stats: { inRing: 64, charisma: 71, ambition: 95, ego: 72, professionalism: 38 },
  },
  {
    name: 'Cassidy Vaughn', gender: 'Female', alignment: 'Face', status: 'Available',
    archetype: 'Consummate professional', role: 'Upper card', morale: 62,
    bio: 'Takes the news, works the match, goes home. You have never once heard her raise her voice.',
    stats: { inRing: 80, charisma: 58, ambition: 46, ego: 29, professionalism: 97 },
  },
  {
    name: 'Adaeze Okonkwo', gender: 'Female', alignment: 'Face', status: 'Available',
    archetype: 'Reigning draw', role: 'Main event', morale: 71,
    bio: 'The most over person in the building and she knows exactly what that is worth.',
    stats: { inRing: 85, charisma: 89, ambition: 70, ego: 64, professionalism: 72 },
  },
  {
    name: 'Marisol Reyes', gender: 'Female', alignment: 'Heel', status: 'Available',
    archetype: 'Ruthless technician', role: 'Upper card', morale: 55,
    bio: 'Cold, precise and entirely uninterested in being liked. Will take a match with anyone, anywhere.',
    stats: { inRing: 88, charisma: 47, ambition: 68, ego: 55, professionalism: 81 },
  },
  {
    name: 'Kip Sanderson', gender: 'Male', alignment: 'Face', status: 'Available',
    archetype: 'Crowd favourite', role: 'Midcard', morale: 60,
    bio: 'Cannot work a lick but the building loves him, which is its own kind of ability.',
    stats: { inRing: 49, charisma: 86, ambition: 52, ego: 44, professionalism: 76 },
  },
  {
    name: 'The Thresher', gender: 'Male', alignment: 'Heel', status: 'Available',
    archetype: 'Monster', role: 'Upper card', morale: 50,
    bio: 'Does not speak. Does not negotiate. Fines mean nothing to him and everyone has quietly stopped trying.',
    stats: { inRing: 71, charisma: 63, ambition: 25, ego: 50, professionalism: 33 },
  },
  {
    name: 'Abel Verge', gender: 'Male', alignment: 'Heel', status: 'Available',
    archetype: 'Cult leader', role: 'Upper card', morale: 47,
    bio: 'Speaks softly, at length, and mostly to people who did not ask. The Fold grows by one or two a year.',
    stats: { inRing: 58, charisma: 92, ambition: 77, ego: 68, professionalism: 51 },
  },
  {
    name: 'Nadia Kowalczyk', gender: 'Female', alignment: 'Neutral', status: 'Available',
    archetype: 'Enforcer', role: 'Midcard', morale: 57,
    bio: 'Hired to be a problem for other people. Has never been a problem for you, yet.',
    stats: { inRing: 74, charisma: 41, ambition: 48, ego: 39, professionalism: 85 },
  },
  {
    name: 'Bo Trueblood', gender: 'Male', alignment: 'Face', status: 'Injured',
    archetype: 'Veteran on the shelf', role: 'Upper card', morale: 41,
    bio: 'Out with a knee since the spring. Calls the office every week to ask when he is cleared.',
    stats: { inRing: 69, charisma: 60, ambition: 57, ego: 47, professionalism: 88 },
  },
  {
    name: 'Sunny Delacroix', gender: 'Female', alignment: 'Heel', status: 'Available',
    archetype: 'Camera hog', role: 'Midcard', morale: 52,
    bio: 'Will find the hard camera from anywhere in the building. Genuinely funny, genuinely exhausting.',
    stats: { inRing: 55, charisma: 83, ambition: 81, ego: 88, professionalism: 42 },
  },
  {
    name: 'Ezra Vance', gender: 'Male', alignment: 'Neutral', status: 'Available',
    archetype: 'Locker room politician', role: 'Midcard', morale: 54,
    bio: 'Knows what everybody earns and who everybody is unhappy with. Always pleased to see you, which worries you.',
    stats: { inRing: 62, charisma: 70, ambition: 73, ego: 66, professionalism: 59 },
  },
  {
    name: 'Junie Park', gender: 'Female', alignment: 'Face', status: 'Available',
    archetype: 'High flyer', role: 'Opener', morale: 63,
    bio: 'Twenty-three, fearless, and one bad landing away from a long conversation with the doctor.',
    stats: { inRing: 76, charisma: 64, ambition: 66, ego: 31, professionalism: 79 },
  },
  {
    name: 'Grady Mullen', gender: 'Male', alignment: 'Heel', status: 'Unavailable',
    archetype: 'Suspended troublemaker', role: 'Midcard', morale: 38,
    bio: 'Suspended after the incident in the car park. Nobody upstairs will tell you when that ends.',
    stats: { inRing: 67, charisma: 52, ambition: 60, ego: 79, professionalism: 21 },
  },
  {
    name: 'Odessa Lyle', gender: 'Female', alignment: 'Neutral', status: 'Available',
    archetype: 'Quiet climber', role: 'Prospect', morale: 49,
    bio: 'Says almost nothing and improves every single week. You have no read on her at all.',
    stats: { inRing: 70, charisma: 45, ambition: 84, ego: 33, professionalism: 90 },
  },
];

// A little history so week one is not a blank slate. Values are prior meetings
// and prior shared segments, which is what the relationship system counts.
const HISTORY = [
  ['Rhett Calloway', 'Tomás Ibarra', { matches: 6, segments: 1 }],
  ['Rhett Calloway', 'Dane Mercer', { matches: 2, segments: 0 }],
  ['Adaeze Okonkwo', 'Marisol Reyes', { matches: 5, segments: 0 }],
  ['Cassidy Vaughn', 'Junie Park', { matches: 1, segments: 4 }],
  ['Abel Verge', 'The Thresher', { matches: 0, segments: 5 }],
  ['Abel Verge', 'Odessa Lyle', { matches: 0, segments: 2 }],
  ['Kip Sanderson', 'Sunny Delacroix', { matches: 3, segments: 2 }],
  ['Ezra Vance', 'Rhett Calloway', { matches: 0, segments: 3 }],
  ['Nadia Kowalczyk', 'Marisol Reyes', { matches: 0, segments: 3 }],
  ['Bo Trueblood', 'Tomás Ibarra', { matches: 4, segments: 2 }],
];

export function seedRoster() {
  const wrestlers = SEED.map(w => ({
    id: nextId('w'),
    name: w.name,
    gender: w.gender,
    alignment: w.alignment,
    status: w.status,
    archetype: w.archetype,
    role: w.role,
    bio: w.bio,
    photo: null,
    morale: w.morale,
    weeksOffCard: 0,
    grudges: [],
    stats: { ...w.stats },
    record: { wins: 0, losses: 0 },
    familiarity: 0,
    relationships: {},
  }));

  const byName = new Map(wrestlers.map(w => [w.name, w]));
  for (const [a, b, counts] of HISTORY) {
    const left = byName.get(a);
    const right = byName.get(b);
    if (!left || !right) continue;
    left.relationships[right.id] = { ...counts };
    right.relationships[left.id] = { ...counts };
  }
  return wrestlers;
}
