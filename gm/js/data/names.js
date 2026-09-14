// Name pools for roster generation. All invented — no real performer's name or
// ring name appears here, and none is close enough to be mistaken for one.
// Split by how the name reads, so a generated wrestler's name and gender agree.
export const FIRST_NAMES = {
  Male: [
    'Rhett', 'Dane', 'Kip', 'Ezra', 'Grady', 'Bo', 'Abel', 'Cormac', 'Tomás',
    'Thaddeus', 'Emeka', 'Beau', 'Lars', 'Rourke', 'Marcus', 'Tobias',
    'Desmond', 'Rafael', 'Augustin', 'Calder', 'Otto', 'Silas', 'Jonah',
    'Rico', 'Laszlo', 'Oscar', 'Bastian', 'Kwame', 'Dez', 'Hollis',
  ],
  Female: [
    'Cassidy', 'Marisol', 'Adaeze', 'Nadia', 'Junie', 'Odessa', 'Sunny',
    'Imani', 'Delphine', 'Roisin', 'Clementine', 'Xiomara', 'Birdie',
    'Octavia', 'Solveig', 'Lena', 'Priya', 'Winona', 'Sable', 'Maeve',
    'Ines', 'Noor', 'Tamsin', 'Fenella', 'Amara', 'Verity', 'Nia',
    'Perpetua', 'Greer', 'Wren',
  ],
};

export const SURNAMES = [
  'Calloway', 'Ibarra', 'Mercer', 'Vaughn', 'Okonkwo', 'Reyes', 'Sanderson',
  'Verge', 'Kowalczyk', 'Trueblood', 'Delacroix', 'Vance', 'Park', 'Mullen',
  'Lyle', 'Ashgrove', 'Brennan', 'Castellanos', 'Doyle', 'Eriksen', 'Fontaine',
  'Garrick', 'Halloran', 'Ives', 'Jarrow', 'Keane', 'Lindqvist', 'Moreau',
  'Nkemdi', 'Osgood', 'Pruitt', 'Quintero', 'Rasmussen', 'Stagg', 'Thorne',
  'Udoka', 'Valdez', 'Whitlock', 'Yarrow', 'Zabala', 'Brightwater', 'Coburn',
  'Drummond', 'Ferreira', 'Gilchrist', 'Hawthorne', 'Ingram', 'Jessup',
  'Kirkwood', 'Larkin', 'Machado', 'Northcote', 'Oyelaran', 'Petrosyan',
  'Rhodes-Webb', 'Sarkissian', 'Tallow', 'Ulbricht', 'Varga', 'Wexler',
];

// Single-name monikers, for wrestlers whose gimmick does not take a surname.
export const RING_NAMES = [
  'The Thresher', 'The Verger', 'Scrimshaw', 'The Harrower', 'Nightjar',
  'The Shrike', 'Marrow', 'Cinder', 'The Reliquary', 'Blight', 'The Quarry',
  'Mordant', 'The Rookery', 'Ashfall', 'The Tithe', 'Gloam', 'The Carrion Bell',
  'Hushed', 'The Weir', 'Tallowman',
];

// Promotions, which double as the name of a save.
const PROMO_FIRST = [
  'Continental', 'Apex', 'Ironclad', 'Northgate', 'Sovereign', 'Meridian',
  'Bellwether', 'Crown', 'Dominion', 'Fathom', 'Gauntlet', 'Highwater',
];
const PROMO_SECOND = [
  'Championship Wrestling', 'Wrestling Alliance', 'Pro Wrestling',
  'Wrestling Federation', 'Grappling Union', 'Wrestling Collective',
];
const SHOW_NAMES = [
  'Mainline', 'Hard Out', 'Primetime', 'The Anvil', 'Crossfire', 'Nightwatch',
  'Last Call', 'The Gauntlet', 'Overdrive', 'Deadline',
];

export function promotionNames(rng, pick) {
  return {
    promotion: `${pick(rng, PROMO_FIRST)} ${pick(rng, PROMO_SECOND)}`,
    show: pick(rng, SHOW_NAMES),
  };
}
