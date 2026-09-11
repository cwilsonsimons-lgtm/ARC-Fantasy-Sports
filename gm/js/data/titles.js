// The belts.
//
// Every promotion starts with three: a major men's, a major women's, and the
// tag titles. Everything past that is sanctioned by the network as they come to
// trust you, and which one you add is your choice — a promotion that never adds
// a fourth is a perfectly good promotion.
//
// `holders` is 1 for a singles title and 2 for tag titles, which is also what
// decides whether it is defended in a tag match. `gender` locks a division;
// null means anyone can hold it.
export const BASE_TITLES = [
  { key: 'world', name: 'World Championship', holders: 1, gender: 'Male', tier: 'major' },
  { key: 'womens', name: "Women's World Championship", holders: 1, gender: 'Female', tier: 'major' },
  { key: 'tag', name: 'World Tag Team Championship', holders: 2, gender: null, tier: 'major' },
];

// Unlocked in this order as network trust grows. The slot opens; the player
// picks which of the remaining ones to bring in.
export const UNLOCKABLE_TITLES = [
  {
    key: 'television', name: 'Television Championship', holders: 1, gender: null, tier: 'secondary',
    note: 'Defended most weeks. A working title for people who are not main eventing yet.',
  },
  {
    key: 'womenstag', name: "Women's Tag Team Championship", holders: 2, gender: 'Female', tier: 'secondary',
    note: 'Gives the women’s division somewhere to put a team.',
  },
  {
    key: 'hardcore', name: 'Hardcore Championship', holders: 1, gender: null, tier: 'secondary',
    note: 'For the people who enjoy that sort of thing, and there are always some.',
  },
];

// Trust at which each additional slot is sanctioned.
export const SLOT_THRESHOLDS = [10, 22, 34];

export function titleTemplate(key) {
  return [...BASE_TITLES, ...UNLOCKABLE_TITLES].find(t => t.key === key) || null;
}
