// Arc Markets — player status the trading screen needs: injury, opponent,
// game state and points scored so far.
//
// These are facts about the player, not about the market, so they live apart
// from the tape. They feed the information panel and (via events.js) the
// participants — never a price.
import { NFL_BY_ID } from '../data/nfl-players.js';
import { WEEKS_PLAYED, gameLog } from './data.js';
import { eventsFor } from './events.js';

const DAY = 86400000;

/** Derived from the player's recent injury events rather than invented here. */
export function injuryFor(playerId) {
  const evs = eventsFor(playerId, { maxTier: 2, since: Date.now() - 21 * DAY })
    .filter(e => e.kind === 'injury' || e.kind === 'seasonEnding');
  if (!evs.length) return { label: 'Healthy', cls: 'up', status: 'healthy' };
  const worst = evs.some(e => e.kind === 'seasonEnding');
  if (worst) return { label: 'Out (season)', cls: 'down', status: 'out' };
  const last = evs[evs.length - 1];
  const days = (Date.now() - last.ts) / DAY;
  if (days < 3) return { label: 'Questionable', cls: 'warn', status: 'questionable' };
  return { label: 'Probable', cls: 'warn', status: 'probable' };
}

// The market runs at a live point in the season (see data.js); the fantasy side
// of the app sits at week 1. This is the market's own week.
export function marketWeek() { return WEEKS_PLAYED + 1; }

const OPPONENTS = ['KC', 'BUF', 'PHI', 'SF', 'DAL', 'BAL', 'DET', 'MIA', 'GB', 'CIN',
                   'HOU', 'LA', 'NYJ', 'MIN', 'SEA', 'TB'];
function pick(playerId, list, salt) {
  let h = 2166136261;
  const s = playerId + (salt || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return list[(h >>> 0) % list.length];
}

export function opponentFor(playerId) {
  const p = NFL_BY_ID[playerId];
  const opp = pick(playerId, OPPONENTS, '#opp' + marketWeek());
  if (p && opp === p.tm) return '@ ' + OPPONENTS[(OPPONENTS.indexOf(opp) + 3) % OPPONENTS.length];
  return (pick(playerId, ['vs', '@'], '#ha')) + ' ' + opp;
}

const STATES = ['Sun 1:00', 'Sun 4:25', 'Thu 8:15', 'Mon 8:15', 'Sun 8:20'];
export function gameStatusFor(playerId) {
  return pick(playerId, STATES, '#gs' + marketWeek());
}

/** Fantasy points actually scored this season, from the market's game log. */
export function seasonPointsFor(playerId) {
  const p = NFL_BY_ID[playerId];
  if (!p) return 0;
  const log = gameLog({ id: playerId, sproj: p.sproj });
  return Math.round(log.slice(0, WEEKS_PLAYED).reduce((n, g) => n + g.pts, 0) * 10) / 10;
}
