// Archetypes are the authoring unit for personality; the trait values are the
// simulation unit. An archetype bundles a stat profile, a set of opinions about
// stipulations and a couple of bio openers, and generation rolls an individual
// inside those ranges. That is what keeps a roster varied without every
// wrestler needing to be written by hand.
//
// `stats` is ability — what they can do. `traits` is personality — who they
// are. They are separate because they behave differently: ability decides
// matches, personality decides everything else.
//
// stats, traits and tastes are [low, high] ranges. tastes are sparse — an archetype only
// declares the stipulations it has a view on. `aptitude` is optional and falls
// back to the wrestler's general in-ring ability, which is what keeps taste and
// aptitude uncorrelated.
export const ARCHETYPES = [
  {
    id: 'ageing-main-eventer', label: 'Ageing main eventer', role: 'Main event',
    stats: { inRing: [72, 88], charisma: [66, 84] },
    traits: { ambition: [50, 68], ego: [80, 96], professionalism: [32, 52], patience: [20, 38], authority: [18, 35], vindictiveness: [58, 78], aggression: [55, 72], jealousy: [52, 70], selfishness: [60, 78], loyalty: [30, 48], courage: [50, 68] },
    tastes: { singles: { taste: [78, 92] }, ladder: { taste: [4, 16], aptitude: [34, 48] }, hardcore: { taste: [10, 24], aptitude: [68, 82] } },
    openers: [
      '{years} years on top and no intention of stepping down.',
      'Has main evented more shows than most of this locker room has worked.',
    ],
  },
  {
    id: 'company-man', label: 'Company man', role: 'Upper card',
    stats: { inRing: [70, 84], charisma: [58, 72] },
    traits: { ambition: [30, 48], ego: [26, 44], professionalism: [86, 98], patience: [70, 88], authority: [78, 92], loyalty: [72, 90], selfishness: [12, 28], vindictiveness: [10, 26], jealousy: [18, 34], aggression: [28, 46], courage: [55, 72] },
    tastes: { submission: { taste: [66, 80] } },
    openers: [
      'Never misses a date, never complains, never asks.',
      'Been here {years} years and has never once been a problem.',
    ],
  },
  {
    id: 'ambitious-upstart', label: 'Ambitious upstart', role: 'Midcard',
    stats: { inRing: [56, 72], charisma: [62, 80] },
    traits: { ambition: [86, 98], ego: [62, 80], professionalism: [30, 50], patience: [8, 25], jealousy: [72, 90], selfishness: [62, 80], aggression: [58, 76], authority: [22, 40], vindictiveness: [60, 78], loyalty: [30, 48], courage: [58, 76] },
    tastes: { ladder: { taste: [84, 96], aptitude: [70, 84] }, submission: { taste: [8, 22], aptitude: [40, 56] } },
    openers: [
      'Convinced they are being held down, and not entirely wrong.',
      'Counts every minute of television they do not get.',
    ],
  },
  {
    id: 'consummate-pro', label: 'Consummate professional', role: 'Upper card',
    stats: { inRing: [74, 88], charisma: [50, 66] },
    traits: { ambition: [38, 56], ego: [20, 38], professionalism: [90, 99], patience: [78, 94], authority: [70, 86], selfishness: [15, 30], vindictiveness: [10, 25], loyalty: [66, 82], jealousy: [16, 32], aggression: [26, 44], courage: [58, 76] },
    tastes: { submission: { taste: [80, 92], aptitude: [78, 90] }, hardcore: { taste: [16, 30], aptitude: [64, 78] } },
    openers: [
      'Takes the news, works the match, goes home.',
      'You have never once heard this one raise a voice.',
    ],
  },
  {
    id: 'reigning-draw', label: 'Reigning draw', role: 'Main event',
    stats: { inRing: [80, 92], charisma: [82, 95] },
    traits: { ambition: [62, 80], ego: [56, 74], professionalism: [64, 82], patience: [48, 66], authority: [45, 62], jealousy: [40, 58], loyalty: [52, 70], selfishness: [48, 66], courage: [62, 80], aggression: [48, 66], vindictiveness: [40, 58] },
    tastes: { ladder: { taste: [76, 90], aptitude: [76, 88] }, ironman: { taste: [62, 78], aptitude: [80, 92] } },
    openers: [
      'The most over person in the building, and knows exactly what that is worth.',
      'Sells the tickets. Everyone here understands that, including them.',
    ],
  },
  {
    id: 'ruthless-technician', label: 'Ruthless technician', role: 'Upper card',
    stats: { inRing: [82, 94], charisma: [38, 54] },
    traits: { ambition: [58, 76], ego: [44, 62], professionalism: [72, 88], aggression: [70, 88], vindictiveness: [66, 84], selfishness: [58, 74], courage: [70, 86], patience: [52, 70], authority: [48, 66], loyalty: [28, 46], jealousy: [40, 58] },
    tastes: { submission: { taste: [86, 97], aptitude: [86, 96] }, cage: { taste: [10, 24], aptitude: [76, 88] } },
    openers: [
      'Cold, precise, and entirely uninterested in being liked.',
      'Will take a match with anyone, anywhere, and usually win it.',
    ],
  },
  {
    id: 'crowd-favourite', label: 'Crowd favourite', role: 'Midcard',
    stats: { inRing: [40, 56], charisma: [80, 94] },
    traits: { ambition: [42, 60], ego: [36, 54], professionalism: [68, 84], loyalty: [68, 84], courage: [60, 78], selfishness: [20, 36], jealousy: [25, 42], patience: [60, 78], authority: [58, 76], aggression: [30, 48], vindictiveness: [16, 32] },
    tastes: { hardcore: { taste: [74, 88], aptitude: [64, 78] }, submission: { taste: [6, 18], aptitude: [22, 36] } },
    openers: [
      'Cannot work a lick, but the building loves this one, which is its own ability.',
      'Gets the loudest reaction of the night and has no idea why.',
    ],
  },
  {
    id: 'monster', label: 'Monster', role: 'Upper card', ringName: true,
    stats: { inRing: [64, 80], charisma: [54, 72] },
    traits: { ambition: [16, 34], ego: [42, 60], professionalism: [24, 44], courage: [86, 98], aggression: [82, 95], authority: [8, 22], patience: [25, 45], vindictiveness: [62, 80], loyalty: [22, 40], jealousy: [12, 28], selfishness: [52, 70] },
    tastes: { cage: { taste: [84, 96], aptitude: [84, 95] }, hardcore: { taste: [78, 92], aptitude: [78, 90] }, ladder: { taste: [4, 16], aptitude: [16, 30] } },
    openers: [
      'Does not speak. Does not negotiate.',
      'Fines mean nothing here, and everyone has quietly stopped trying.',
    ],
  },
  {
    id: 'cult-leader', label: 'Cult leader', role: 'Upper card', ringName: true,
    stats: { inRing: [50, 66], charisma: [86, 97] },
    traits: { ambition: [68, 86], ego: [58, 78], professionalism: [42, 62], vindictiveness: [72, 90], authority: [10, 26], selfishness: [66, 82], loyalty: [15, 32], patience: [62, 80], jealousy: [46, 64], aggression: [44, 62], courage: [64, 82] },
    tastes: { lastman: { taste: [80, 94], aptitude: [58, 74] }, cage: { taste: [10, 26], aptitude: [36, 52] } },
    openers: [
      'Speaks softly, at length, and mostly to people who did not ask.',
      'The following grows by one or two a year, and nobody can say quite how.',
    ],
  },
  {
    id: 'enforcer', label: 'Enforcer', role: 'Midcard',
    stats: { inRing: [68, 82], charisma: [34, 50] },
    traits: { ambition: [38, 56], ego: [30, 48], professionalism: [78, 92], courage: [78, 92], aggression: [72, 88], authority: [66, 82], loyalty: [64, 80], patience: [58, 76], selfishness: [26, 44], vindictiveness: [44, 62], jealousy: [22, 38] },
    tastes: { hardcore: { taste: [76, 90], aptitude: [74, 86] }, cage: { taste: [62, 78], aptitude: [72, 84] } },
    openers: [
      'Hired to be a problem for other people.',
      'Has never been your problem. Yet.',
    ],
  },
  {
    id: 'camera-hog', label: 'Camera hog', role: 'Midcard',
    stats: { inRing: [46, 62], charisma: [78, 92] },
    traits: { ambition: [72, 88], ego: [82, 95], professionalism: [32, 52], jealousy: [78, 92], selfishness: [72, 88], patience: [18, 34], courage: [22, 38], authority: [26, 44], vindictiveness: [56, 74], loyalty: [24, 42], aggression: [36, 54] },
    tastes: { ladder: { taste: [82, 94], aptitude: [52, 68] }, submission: { taste: [8, 22], aptitude: [30, 46] } },
    openers: [
      'Will find the hard camera from anywhere in the building.',
      'Genuinely funny, genuinely exhausting.',
    ],
  },
  {
    id: 'politician', label: 'Locker room politician', role: 'Midcard',
    stats: { inRing: [54, 70], charisma: [62, 78] },
    traits: { ambition: [66, 84], ego: [56, 74], professionalism: [48, 68], selfishness: [66, 82], jealousy: [62, 78], vindictiveness: [58, 74], courage: [25, 42], patience: [56, 74], authority: [50, 68], loyalty: [30, 48], aggression: [32, 50] },
    tastes: { singles: { taste: [72, 86] }, hardcore: { taste: [4, 16], aptitude: [32, 48] } },
    openers: [
      'Knows what everybody earns and who everybody is unhappy with.',
      'Always pleased to see you, which worries you.',
    ],
  },
  {
    id: 'high-flyer', label: 'High flyer', role: 'Opener',
    stats: { inRing: [68, 84], charisma: [56, 72] },
    traits: { ambition: [58, 76], ego: [24, 42], professionalism: [70, 86], courage: [82, 95], patience: [55, 72], loyalty: [60, 76], authority: [58, 76], selfishness: [28, 46], jealousy: [34, 52], aggression: [38, 56], vindictiveness: [20, 36] },
    tastes: { ladder: { taste: [88, 98], aptitude: [84, 95] }, cage: { taste: [12, 26], aptitude: [44, 60] } },
    openers: [
      'Fearless, and one bad landing away from a long conversation with the doctor.',
      'Does things nobody else on this roster will attempt.',
    ],
  },
  {
    id: 'quiet-climber', label: 'Quiet climber', role: 'Prospect',
    stats: { inRing: [62, 78], charisma: [38, 56] },
    traits: { ambition: [76, 92], ego: [24, 42], professionalism: [82, 95], patience: [76, 92], authority: [64, 80], jealousy: [48, 66], selfishness: [28, 44], loyalty: [56, 74], courage: [56, 74], aggression: [30, 48], vindictiveness: [34, 52] },
    tastes: { submission: { taste: [68, 84], aptitude: [72, 86] } },
    openers: [
      'Says almost nothing and improves every single week.',
      'You have no read on this one at all, and that is starting to bother you.',
    ],
  },
  {
    id: 'hardcore-veteran', label: 'Hardcore veteran', role: 'Midcard',
    stats: { inRing: [58, 74], charisma: [48, 66] },
    traits: { ambition: [44, 62], ego: [62, 80], professionalism: [18, 38], courage: [84, 96], aggression: [76, 90], authority: [20, 36], patience: [30, 48], vindictiveness: [60, 78], loyalty: [46, 64], jealousy: [38, 56], selfishness: [50, 68] },
    tastes: { hardcore: { taste: [84, 96], aptitude: [74, 88] }, submission: { taste: [14, 28], aptitude: [38, 54] } },
    openers: [
      'Has been bleeding for a living for {years} years and sees no reason to stop.',
      'The scars are real and the stories are mostly true.',
    ],
  },
  {
    id: 'technical-prodigy', label: 'Technical prodigy', role: 'Prospect',
    stats: { inRing: [76, 90], charisma: [42, 60] },
    traits: { ambition: [62, 80], ego: [34, 54], professionalism: [74, 90], patience: [66, 82], authority: [62, 78], courage: [58, 74], loyalty: [54, 72], selfishness: [32, 50], jealousy: [42, 60], aggression: [42, 60], vindictiveness: [26, 44] },
    tastes: { submission: { taste: [82, 94], aptitude: [82, 94] }, hardcore: { taste: [12, 28], aptitude: [34, 50] } },
    openers: [
      'Twenty-two, and already the best pure wrestler in the building.',
      'Learned this in a gym above a garage and it shows, in the best way.',
    ],
  },
  {
    id: 'powerhouse', label: 'Powerhouse', role: 'Upper card',
    stats: { inRing: [66, 82], charisma: [52, 70] },
    traits: { ambition: [46, 64], ego: [54, 72], professionalism: [56, 76], courage: [70, 86], aggression: [60, 76], patience: [50, 68], authority: [52, 70], loyalty: [50, 68], selfishness: [42, 60], jealousy: [36, 54], vindictiveness: [40, 58] },
    tastes: { cage: { taste: [76, 90], aptitude: [78, 90] }, ladder: { taste: [14, 28], aptitude: [30, 46] } },
    openers: [
      'Built like a door and moves better than anyone expects.',
      'Has not been taken off their feet cleanly in {years} years.',
    ],
  },
];

// A second sentence that can attach to any archetype, so two wrestlers built
// from the same template still read differently.
export const COLOUR = [
  'Drives to every show alone.',
  'Has not spoken to half this locker room since the spring.',
  'Keeps a list. You are probably on it.',
  'First in the building, last out of it.',
  'Owes somebody money, and it is starting to show.',
  'Turned down a better offer to be here, and mentions it.',
  'Their contract is up at the end of the year.',
  'Has a bad shoulder nobody upstairs knows about.',
  'Came up through the same school as half the midcard.',
  'Will not travel with anybody. Nobody knows why.',
  'Answers the phone at three in the morning if you call.',
  'Never eats at catering. Not once.',
  'Married to somebody on a rival roster.',
  'Was out for a year and came back meaner.',
];
