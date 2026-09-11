// Archetypes are the authoring unit for personality; the trait values are the
// simulation unit. An archetype bundles a stat profile, a set of opinions about
// stipulations and a couple of bio openers, and generation rolls an individual
// inside those ranges. That is what keeps a roster varied without every
// wrestler needing to be written by hand.
//
// stats and tastes are [low, high] ranges. tastes are sparse — an archetype only
// declares the stipulations it has a view on. `aptitude` is optional and falls
// back to the wrestler's general in-ring ability, which is what keeps taste and
// aptitude uncorrelated.
export const ARCHETYPES = [
  {
    id: 'ageing-main-eventer', label: 'Ageing main eventer', role: 'Main event',
    stats: { inRing: [72, 88], charisma: [66, 84], ambition: [50, 68], ego: [80, 96], professionalism: [32, 52] },
    tastes: { singles: { taste: [78, 92] }, ladder: { taste: [4, 16], aptitude: [34, 48] }, hardcore: { taste: [10, 24], aptitude: [68, 82] } },
    openers: [
      '{years} years on top and no intention of stepping down.',
      'Has main evented more shows than most of this locker room has worked.',
    ],
  },
  {
    id: 'company-man', label: 'Company man', role: 'Upper card',
    stats: { inRing: [70, 84], charisma: [58, 72], ambition: [30, 48], ego: [26, 44], professionalism: [86, 98] },
    tastes: { submission: { taste: [66, 80] } },
    openers: [
      'Never misses a date, never complains, never asks.',
      'Been here {years} years and has never once been a problem.',
    ],
  },
  {
    id: 'ambitious-upstart', label: 'Ambitious upstart', role: 'Midcard',
    stats: { inRing: [56, 72], charisma: [62, 80], ambition: [86, 98], ego: [62, 80], professionalism: [30, 50] },
    tastes: { ladder: { taste: [84, 96], aptitude: [70, 84] }, submission: { taste: [8, 22], aptitude: [40, 56] } },
    openers: [
      'Convinced they are being held down, and not entirely wrong.',
      'Counts every minute of television they do not get.',
    ],
  },
  {
    id: 'consummate-pro', label: 'Consummate professional', role: 'Upper card',
    stats: { inRing: [74, 88], charisma: [50, 66], ambition: [38, 56], ego: [20, 38], professionalism: [90, 99] },
    tastes: { submission: { taste: [80, 92], aptitude: [78, 90] }, hardcore: { taste: [16, 30], aptitude: [64, 78] } },
    openers: [
      'Takes the news, works the match, goes home.',
      'You have never once heard this one raise a voice.',
    ],
  },
  {
    id: 'reigning-draw', label: 'Reigning draw', role: 'Main event',
    stats: { inRing: [80, 92], charisma: [82, 95], ambition: [62, 80], ego: [56, 74], professionalism: [64, 82] },
    tastes: { ladder: { taste: [76, 90], aptitude: [76, 88] }, ironman: { taste: [62, 78], aptitude: [80, 92] } },
    openers: [
      'The most over person in the building, and knows exactly what that is worth.',
      'Sells the tickets. Everyone here understands that, including them.',
    ],
  },
  {
    id: 'ruthless-technician', label: 'Ruthless technician', role: 'Upper card',
    stats: { inRing: [82, 94], charisma: [38, 54], ambition: [58, 76], ego: [44, 62], professionalism: [72, 88] },
    tastes: { submission: { taste: [86, 97], aptitude: [86, 96] }, cage: { taste: [10, 24], aptitude: [76, 88] } },
    openers: [
      'Cold, precise, and entirely uninterested in being liked.',
      'Will take a match with anyone, anywhere, and usually win it.',
    ],
  },
  {
    id: 'crowd-favourite', label: 'Crowd favourite', role: 'Midcard',
    stats: { inRing: [40, 56], charisma: [80, 94], ambition: [42, 60], ego: [36, 54], professionalism: [68, 84] },
    tastes: { hardcore: { taste: [74, 88], aptitude: [64, 78] }, submission: { taste: [6, 18], aptitude: [22, 36] } },
    openers: [
      'Cannot work a lick, but the building loves this one, which is its own ability.',
      'Gets the loudest reaction of the night and has no idea why.',
    ],
  },
  {
    id: 'monster', label: 'Monster', role: 'Upper card', ringName: true,
    stats: { inRing: [64, 80], charisma: [54, 72], ambition: [16, 34], ego: [42, 60], professionalism: [24, 44] },
    tastes: { cage: { taste: [84, 96], aptitude: [84, 95] }, hardcore: { taste: [78, 92], aptitude: [78, 90] }, ladder: { taste: [4, 16], aptitude: [16, 30] } },
    openers: [
      'Does not speak. Does not negotiate.',
      'Fines mean nothing here, and everyone has quietly stopped trying.',
    ],
  },
  {
    id: 'cult-leader', label: 'Cult leader', role: 'Upper card', ringName: true,
    stats: { inRing: [50, 66], charisma: [86, 97], ambition: [68, 86], ego: [58, 78], professionalism: [42, 62] },
    tastes: { lastman: { taste: [80, 94], aptitude: [58, 74] }, cage: { taste: [10, 26], aptitude: [36, 52] } },
    openers: [
      'Speaks softly, at length, and mostly to people who did not ask.',
      'The following grows by one or two a year, and nobody can say quite how.',
    ],
  },
  {
    id: 'enforcer', label: 'Enforcer', role: 'Midcard',
    stats: { inRing: [68, 82], charisma: [34, 50], ambition: [38, 56], ego: [30, 48], professionalism: [78, 92] },
    tastes: { hardcore: { taste: [76, 90], aptitude: [74, 86] }, cage: { taste: [62, 78], aptitude: [72, 84] } },
    openers: [
      'Hired to be a problem for other people.',
      'Has never been your problem. Yet.',
    ],
  },
  {
    id: 'camera-hog', label: 'Camera hog', role: 'Midcard',
    stats: { inRing: [46, 62], charisma: [78, 92], ambition: [72, 88], ego: [82, 95], professionalism: [32, 52] },
    tastes: { ladder: { taste: [82, 94], aptitude: [52, 68] }, submission: { taste: [8, 22], aptitude: [30, 46] } },
    openers: [
      'Will find the hard camera from anywhere in the building.',
      'Genuinely funny, genuinely exhausting.',
    ],
  },
  {
    id: 'politician', label: 'Locker room politician', role: 'Midcard',
    stats: { inRing: [54, 70], charisma: [62, 78], ambition: [66, 84], ego: [56, 74], professionalism: [48, 68] },
    tastes: { singles: { taste: [72, 86] }, hardcore: { taste: [4, 16], aptitude: [32, 48] } },
    openers: [
      'Knows what everybody earns and who everybody is unhappy with.',
      'Always pleased to see you, which worries you.',
    ],
  },
  {
    id: 'high-flyer', label: 'High flyer', role: 'Opener',
    stats: { inRing: [68, 84], charisma: [56, 72], ambition: [58, 76], ego: [24, 42], professionalism: [70, 86] },
    tastes: { ladder: { taste: [88, 98], aptitude: [84, 95] }, cage: { taste: [12, 26], aptitude: [44, 60] } },
    openers: [
      'Fearless, and one bad landing away from a long conversation with the doctor.',
      'Does things nobody else on this roster will attempt.',
    ],
  },
  {
    id: 'quiet-climber', label: 'Quiet climber', role: 'Prospect',
    stats: { inRing: [62, 78], charisma: [38, 56], ambition: [76, 92], ego: [24, 42], professionalism: [82, 95] },
    tastes: { submission: { taste: [68, 84], aptitude: [72, 86] } },
    openers: [
      'Says almost nothing and improves every single week.',
      'You have no read on this one at all, and that is starting to bother you.',
    ],
  },
  {
    id: 'hardcore-veteran', label: 'Hardcore veteran', role: 'Midcard',
    stats: { inRing: [58, 74], charisma: [48, 66], ambition: [44, 62], ego: [62, 80], professionalism: [18, 38] },
    tastes: { hardcore: { taste: [84, 96], aptitude: [74, 88] }, submission: { taste: [14, 28], aptitude: [38, 54] } },
    openers: [
      'Has been bleeding for a living for {years} years and sees no reason to stop.',
      'The scars are real and the stories are mostly true.',
    ],
  },
  {
    id: 'technical-prodigy', label: 'Technical prodigy', role: 'Prospect',
    stats: { inRing: [76, 90], charisma: [42, 60], ambition: [62, 80], ego: [34, 54], professionalism: [74, 90] },
    tastes: { submission: { taste: [82, 94], aptitude: [82, 94] }, hardcore: { taste: [12, 28], aptitude: [34, 50] } },
    openers: [
      'Twenty-two, and already the best pure wrestler in the building.',
      'Learned this in a gym above a garage and it shows, in the best way.',
    ],
  },
  {
    id: 'powerhouse', label: 'Powerhouse', role: 'Upper card',
    stats: { inRing: [66, 82], charisma: [52, 70], ambition: [46, 64], ego: [54, 72], professionalism: [56, 76] },
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
