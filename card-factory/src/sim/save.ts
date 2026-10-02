// Save files: versioned JSON with a checksum, so a truncated or hand-edited
// save is rejected instead of silently loading half a game.
import type { GameState } from './types';
import { hashString } from './rng';
import { SAVE_VERSION } from './game';
import { weekLabel } from './league';

export interface SaveMeta {
  slot: string;
  company: string;
  week: number;
  label: string;
  cash: number;
  reputation: number;
  savedAt: string;
  checksum: string;
  size: number;
}

export interface SaveFile {
  format: 'foil-and-ink-save';
  version: number;
  checksum: string;
  state: GameState;
}

export function checksum(json: string) {
  // Two independent 32-bit hashes over the serialised state.
  return hashString(json).toString(16).padStart(8, '0') + hashString(json.split('').reverse().join('')).toString(16).padStart(8, '0');
}

export function serialize(state: GameState): string {
  const body = JSON.stringify(state);
  return JSON.stringify({ format: 'foil-and-ink-save', version: SAVE_VERSION, checksum: checksum(body), state: '__STATE__' }).replace('"__STATE__"', body);
}

export function deserialize(text: string): GameState {
  let parsed: SaveFile;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That save is not valid JSON. It may have been cut off while copying.');
  }
  if (!parsed || parsed.format !== 'foil-and-ink-save' || !parsed.state) throw new Error('That text is not a Foil & Ink save file.');
  const body = JSON.stringify(parsed.state);
  if (checksum(body) !== parsed.checksum) throw new Error('The save failed its integrity check, so it was not loaded. It may be truncated or edited.');
  return migrate(parsed.state, parsed.version);
}

function migrate(state: GameState, version: number): GameState {
  if (version > SAVE_VERSION) throw new Error(`This save comes from a newer version of the game (v${version}).`);
  // v1 is the first format; later stages add migrations here.
  state.version = SAVE_VERSION;
  return state;
}

export function metaFor(slot: string, state: GameState, text: string): SaveMeta {
  const parsed = JSON.parse(text) as SaveFile;
  return {
    slot,
    company: state.company.name,
    week: state.week,
    label: weekLabel(state.week),
    cash: state.company.cash,
    reputation: state.company.reputation,
    savedAt: new Date().toISOString(),
    checksum: parsed.checksum,
    size: text.length,
  };
}
