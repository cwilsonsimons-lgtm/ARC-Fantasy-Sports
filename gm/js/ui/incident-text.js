// How an incident reads.
//
// One place, used by the decision panel while it is happening and by the
// journal afterwards, so the sentence a player is asked to rule on is the same
// sentence they read back in the aftermath. Composed at render time from ids,
// as everything in this prototype is — no prose is ever written into the save.
import { nameOf } from '../model/wrestlers.js';
import { locationProse } from '../data/locations.js';
import { DEMANDS } from '../data/backstage.js';

const IN = id => (id ? ` in ${locationProse(id)}` : '');

export function incidentLine(state, kind, data = {}) {
  const who = nameOf(state.wrestlers, data.aggressorId);
  const them = data.victimId && data.victimId !== 'gm'
    ? nameOf(state.wrestlers, data.victimId)
    : null;
  const where = IN(data.locationId);

  switch (kind) {
    case 'attack':
      return `${who} put hands on ${them} after the bell.`;
    case 'brawl':
      return `${who} and ${them} are swinging at each other${where}.`;
    case 'ambush':
      return `${who} went looking for ${them} and found them${where}.`;
    case 'argument':
      return `${who} and ${them} are going at it${where}.`;
    case 'tag-dispute':
      return `${who} is telling ${them} who has been carrying whom${where}.`;
    case 'faction-dispute':
      return `${who} is questioning who runs things, to ${them}'s face${where}.`;
    case 'complaint':
      return `${who} wants a word, and has rehearsed it.`;
    case 'storm-in':
      return `${who} is in front of you without knocking${where}.`;
    case 'confrontation':
      return `${who} has something to say about you, out loud${where}.`;
    case 'refusal':
      return `${who} is booked in the next one and is not moving.`;
    case 'walkout':
      return `${who} is in the car park with a bag.`;
    default:
      return `${who} is a problem${where}.`;
  }
}

// What they are actually asking for, which is what makes conceding a decision
// rather than a shrug.
export function demandLine(demand) {
  const entry = DEMANDS[demand];
  return entry ? `They want ${entry.label}.` : null;
}

export function concedeLine(demand) {
  const entry = DEMANDS[demand];
  return entry ? entry.concede : null;
}
