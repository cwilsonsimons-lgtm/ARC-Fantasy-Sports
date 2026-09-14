// What happens when two people who have a history are handed a microphone.
//
// The GM books the segment, sets how hot to let it go, and picks which of the
// material they are allowed to bring up. Everything after that is the two of
// them, their traits, and the seeded roll — the same as a match.
//
// The result is three things: what the crowd got out of it, what it did to the
// two of them, and whether it stopped being a promo.
import { byId } from './wrestlers.js';
import { createEntry } from './journal.js';
import { noteThread } from './threads.js';
import { remember } from './memory.js';
import { intensity } from '../data/promos.js';
import { ammoFor, fightChance } from './rivalries.js';
import { lean } from './traits.js';
import { nextId } from '../ids.js';

// Charisma decides how much of what they were given actually lands. Somebody
// excellent on a microphone gets more out of a thin segment than somebody
// ordinary gets out of a loaded one.
function delivery(wrestler) {
  const charisma = (wrestler.stats && wrestler.stats.charisma) || 50;
  return 0.55 + (charisma / 100) * 0.9;
}

// A promo item carries its own settings alongside the usual segment fields.
export function createPromo({ speakerId, targetId, plannedMinutes, intensityId = 'heated', ammo = [] }) {
  if (!speakerId || !targetId || speakerId === targetId) return null;
  return {
    id: nextId('si'),
    type: 'segment',
    kind: 'promo',
    name: 'Promo',
    participants: [speakerId, targetId],
    speakerId,
    targetId,
    intensityId,
    ammo: [...ammo],
    plannedMinutes: Math.max(2, Math.round(plannedMinutes) || 4),
  };
}

export function isPromo(item) {
  return Boolean(item) && item.type === 'segment' && item.kind === 'promo';
}

// Runs the segment. Returns what it was worth and, when it goes wrong, an
// incident for the GM to rule on — the same shape resolvePostMatch hands back,
// so game.js treats a promo that turns into a fight exactly like a bell that
// turns into one.
export function resolvePromo(state, item, at, roll) {
  const speaker = byId(state.wrestlers, item.speakerId);
  const target = byId(state.wrestlers, item.targetId);
  if (!speaker || !target) return null;

  const level = intensity(item.intensityId);
  const available = ammoFor(state, speaker.id, target.id);
  const used = (item.ammo || [])
    .map(kind => available.find(a => a.kind === kind))
    .filter(Boolean);

  // Material is worth what it is worth; the intensity is a multiplier on top of
  // it, and how well it is delivered decides how much of that survives contact
  // with the crowd.
  const said = used.reduce((n, a) => n + a.heat, 0);
  const meant = used.reduce((n, a) => n + a.hatred, 0);
  const spoken = delivery(speaker);

  const heat = Math.round((4 + said) * level.heat * spoken);
  const hatred = Math.round((1 + meant) * level.hatred);

  // Whether it stays a promo. The intensity sets the floor, the material pushes
  // it up, and the two of them decide the rest.
  const ammoRisk = used.reduce((n, a) => n + a.risk, 0);
  const chance = fightChance(state, level.risk + ammoRisk, speaker.id, target.id);
  const fight = roll() < chance;

  // The thread hears about it either way. A promo that ends in a fight files
  // both, because both happened.
  noteThread(state, speaker.id, target.id, 'promo', at);

  // Being handed the microphone is an opportunity, and being the one it is
  // aimed at is not. Both of them remember it.
  remember(state, speaker, {
    source: 'opportunity', weight: 2 + Math.round(heat / 6), detail: 'given-the-mic',
  });
  remember(state, target, {
    source: 'peer', weight: -Math.max(1, Math.round(hatred / 4)),
    targetId: speaker.id, detail: 'said-to-my-face',
  });

  const outcome = fight ? 'physical' : heat >= 16 ? 'strong' : heat >= 8 ? 'solid' : 'flat';

  state.journal.push(createEntry({
    week: state.week, at, type: 'promo', itemId: item.id,
    data: {
      speakerId: speaker.id, targetId: target.id,
      intensityId: level.id, ammo: used.map(a => a.kind),
      heat, hatred, outcome,
    },
  }));

  const result = { heat, hatred, outcome, used, chance };

  if (fight) {
    // It went physical on live television, so there is no version of this the
    // GM missed — the same rule as a post-match attack.
    result.incident = {
      id: nextId('inc'),
      kind: 'brawl',
      aggressorId: speaker.id,
      victimId: target.id,
      severity: level.id === 'fight' ? 'major' : 'moderate',
      locationId: 'ring',
      onCamera: true,
      at,
      cause: 'promo',
    };
  }

  return result;
}

// Whether a pair have enough between them to be worth putting on a microphone.
// Not a hard gate — you can book two strangers to talk — but the booking screen
// says so, because a promo with nothing behind it is four minutes of nothing.
export function promoReadiness(state, speakerId, targetId) {
  const ammo = ammoFor(state, speakerId, targetId);
  if (!ammo.length) return { ready: false, ammo, say: 'They have no history to draw on yet.' };
  if (ammo.length < 3) return { ready: true, ammo, say: `${ammo.length} things they could bring up.` };
  return { ready: true, ammo, say: `${ammo.length} things they could bring up, and some of it is personal.` };
}

export { delivery };
