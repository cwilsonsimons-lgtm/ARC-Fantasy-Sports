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
  const list = ids => (ids || []).map(id => nameOf(state.wrestlers, id)).join(' and ');

  switch (kind) {
    case 'attack':
      return `${who} put hands on ${them} after the bell.`;
    case 'cheap-shot':
      return `${who} took one shot at ${them} on the way out.`;
    case 'submission-held':
      return `${who} kept the hold on after the bell. ${them} could not get out of it.`;
    case 'faction-beatdown': {
      const crew = list(data.crewIds);
      return crew
        ? `${who} did not come alone. ${crew} held ${them} down.`
        : `${who} and his people went to work on ${them}.`;
    }
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
    // No location on these two: they happen wherever the GM is standing, so
    // naming the room only makes the sentence read as though it were news.
    case 'storm-in':
      return `${who} is in front of you without knocking.`;
    case 'confrontation':
      return `${who} has something to say about you, and is saying it out loud.`;
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

// The bell, and everything it can produce that nobody has to rule on. Kept
// beside the incidents rather than in the journal, because the player reads the
// same sentence whether they were asked about it or only told.
export function momentLine(state, type, data = {}) {
  const name = id => nameOf(state.wrestlers, id);

  switch (type) {
    case 'handshake':
      return `${name(data.winnerId)} and ${name(data.loserId)} shook hands in the middle of the ring.`;
    case 'handshake-refused':
      return `${name(data.offererId)} put a hand out. ${name(data.refuserId)} looked at it and walked.`;
    case 'stare-down':
      return `${name(data.aId)} and ${name(data.bId)} stood nose to nose and neither of them swung.`;
    case 'champion-challenge':
      return `${name(data.championId)} came down with the belt and stood in front of ${name(data.challengerId)}.`;
    case 'broke-it-up':
      return `${name(data.wrestlerId)} got between them and that was the end of it.`;
    case 'balked': {
      const who = name(data.wrestlerId);
      return `${who} had every reason to go and never moved. ${name(data.victimId)} watched them not.`;
    }
    case 'tie-formed':
      return tieLine(state, data);
    default:
      return null;
  }
}

// The game noticing something rather than being told it.
function tieLine(state, data) {
  const names = (data.ids || []).map(id => nameOf(state.wrestlers, id));
  if (data.kind === 'faction') {
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are running together now. Nobody booked that.`;
  }
  if (data.kind === 'tag-team') {
    return `${names.join(' and ')} have stopped being two people you book on the same side. They are a team.`;
  }
  return `${names.join(' and ')} have each other's backs now. That built itself.`;
}

export function concedeLine(demand) {
  const entry = DEMANDS[demand];
  return entry ? entry.concede : null;
}
