// Demeanour, not digits.
//
// Morale is a number under the hood and is never shown as one. The player gets
// a word and a colour, which is both easier to read at a glance and keeps them
// reading people rather than optimising a meter.
const BANDS = [
  [85, 'Delighted', 'good'],
  [70, 'Happy', 'good'],
  [55, 'Content', 'fine'],
  [40, 'Restless', 'warn'],
  [25, 'Unhappy', 'bad'],
  [0, 'Furious', 'bad'],
];

export function moodWord(wrestler) {
  return BANDS.find(([floor]) => wrestler.morale >= floor)[1];
}

export function moodClass(wrestler) {
  return 'mood-' + BANDS.find(([floor]) => wrestler.morale >= floor)[2];
}

// Unhappiest first — the ones a GM actually needs to look at.
export function byMood(wrestlers) {
  return [...wrestlers].sort((a, b) => a.morale - b.morale);
}
