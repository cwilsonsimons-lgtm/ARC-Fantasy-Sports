// Custom art for the Record Book. Anything listed here replaces the Sleeper photo.
// Drop the image in records/art/ and add a line below. Paths are relative to records/.
// Prompts for each image are in records/art/PROMPTS.md.
window.RECORDS_ART = {
  // Wide banner art for the hero (about 16:10). Leave null to show the hi-score holder's photo.
  mascot: null,            // e.g. 'art/mascot.png'

  // Cartoon player portraits, keyed by Sleeper player id (the id is in PROMPTS.md).
  players: {
    // '7564': 'art/players/7564.png',   // Ja'Marr Chase
  },

  // Owner caricatures, keyed by Sleeper username.
  owners: {
    // 'Wilsonsimons12': 'art/owners/Wilsonsimons12.png',
  },
};
