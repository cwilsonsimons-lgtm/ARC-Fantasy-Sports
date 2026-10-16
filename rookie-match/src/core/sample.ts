// A small, clearly fictional sample pool so the app can be tried before importing
// a real one. Every record is flagged `sample` and can be removed in one click.
import type { Prospect } from './state';

type Row = [name: string, pos: string, heightIn: number, weight: number, college: string];

const ROWS: Row[] = [
  // WRs clustered around 6'3" 215 so every tier shows up for that search.
  ['Dorian Hale', 'WR', 75, 215, 'Sample State'],
  ['Marcus Pell', 'WR', 76, 220, 'Example Tech'],
  ['Jalen Okafor', 'WR', 74, 210, 'Placeholder U'],
  ['Trey Lindqvist', 'WR', 75, 212, 'Sample State'],
  ['Corbin Vance', 'WR', 76, 221, 'Demo A&M'],
  ['Elijah Strand', 'WR', 72, 190, 'Example Tech'],
  ['Kofi Reyes', 'WR', 70, 178, 'Mockingbird College'],
  ['Andre Whitlock', 'QB', 75, 222, 'Sample State'],
  ['Silas Brennan', 'QB', 77, 235, 'Demo A&M'],
  ['Mateo Cruz', 'QB', 73, 210, 'Placeholder U'],
  ['Damon Fairley', 'RB', 70, 210, 'Example Tech'],
  ['Isaiah Moten', 'RB', 71, 218, 'Mockingbird College'],
  ['Rashad Quill', 'RB', 69, 195, 'Sample State'],
  ['Gus Hammond', 'FB', 72, 245, 'Demo A&M'],
  ['Brody Kessler', 'TE', 77, 250, 'Placeholder U'],
  ['Nolan Aberdeen', 'TE', 76, 244, 'Example Tech'],
  ['Victor Osei', 'OT', 78, 315, 'Sample State'],
  ['Henrik Dahl', 'OT', 77, 308, 'Demo A&M'],
  ['Calvin Burr', 'OG', 76, 318, 'Mockingbird College'],
  ['Luis Montero', 'OG', 75, 310, 'Placeholder U'],
  ['Wade Tolliver', 'C', 75, 300, 'Example Tech'],
  ['Desmond Achebe', 'DE', 76, 262, 'Sample State'],
  ['Kyle Ransom', 'DE', 77, 270, 'Demo A&M'],
  ['Tobias Grant', 'DT', 75, 305, 'Placeholder U'],
  ['Omar Haddad', 'DT', 74, 295, 'Mockingbird College'],
  ['Preston Lyle', 'LB', 74, 235, 'Example Tech'],
  ['Xavier Bloom', 'LB', 73, 228, 'Sample State'],
  ['Jamal Northcutt', 'CB', 72, 190, 'Demo A&M'],
  ['Reggie Amos', 'CB', 71, 185, 'Placeholder U'],
  ['Theo Castellanos', 'CB', 73, 195, 'Example Tech'],
  ['Mason Iwu', 'S', 73, 205, 'Mockingbird College'],
  ['Caleb Rourke', 'S', 72, 200, 'Sample State'],
  ['Ezra Klein-Moss', 'K', 72, 190, 'Demo A&M'],
  ['Finn Calloway', 'P', 75, 210, 'Placeholder U'],
];

export function samplePool(): Prospect[] {
  return ROWS.map(([name, position, heightIn, weight, college], i) => ({
    id: `sample_${i + 1}`,
    name,
    position,
    heightIn,
    weight,
    college,
    notes: 'Fictional sample prospect',
    sample: true,
  }));
}
