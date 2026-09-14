// The money.
//
// Deliberately one page. This is not an economy — there is no sponsorship, no
// ticket revenue, no contract negotiation, and signing somebody is not a thing
// you can do yet. What exists is the one loop that makes a starting budget mean
// something: the network pays for the minutes it gives you, the roster costs
// money whether or not you book them, and the difference lands every week.
//
// That loop is enough to make the two dials on the setup screen real. A
// twenty-eight person roster on an hour of television bleeds, and it bleeds
// faster than a fourteen-person one, which is the same thing the executive
// review has been saying about roster use in words.
//
// Contracts, signings and wage negotiation belong to the Corporate and
// Negotiation branches. See docs/gm-progression.md.
import { createEntry } from './journal.js';
import { runtimeFor } from './network.js';

// Per televised minute, per week. The network pays for airtime rather than for
// quality: the grade moves trust, and trust moves how many minutes you have,
// so quality reaches the money the long way round — through the thing the game
// is already about.
export const FEE_PER_MINUTE = 900;

// A floor under the fee so a promotion on the hour is not dead on arrival, and
// so that the first broadcast upgrade reads as a raise rather than a rescue.
export const BASE_FEE = 12000;

// What somebody costs a week. Role is most of it, because that is what a
// wrestler is paid for; ability is a smaller premium on top.
const ROLE_WAGE = {
  'Main event': 5200,
  'Upper card': 3100,
  Midcard: 1900,
  Opener: 1200,
  Prospect: 800,
};

export function wageOf(wrestler) {
  const base = ROLE_WAGE[wrestler.role] || ROLE_WAGE.Midcard;
  const premium = Math.round(((wrestler.stats && wrestler.stats.inRing) || 50) * 12);
  return base + premium;
}

export function wageBill(wrestlers) {
  // An injured wrestler is still paid. That is the point of a wage bill: the
  // roster costs what it costs whether or not it is any use to you this week.
  return (wrestlers || []).reduce((total, w) => total + wageOf(w), 0);
}

export function rightsFee(state) {
  return BASE_FEE + runtimeFor(state) * FEE_PER_MINUTE;
}

export function createFinance(budget = 120000) {
  return { budget: Math.max(0, Math.round(budget)), opening: Math.max(0, Math.round(budget)), weeks: [] };
}

export function finance(state) {
  if (!state.finance) state.finance = createFinance();
  return state.finance;
}

export function budgetOf(state) {
  return finance(state).budget;
}

export function overdrawn(state) {
  return budgetOf(state) < 0;
}

// How many more weeks the current balance covers at the current rate. Null when
// the week is making money, because "infinite weeks of runway" is not a number
// anybody needs to read.
export function runway(state) {
  const net = rightsFee(state) - wageBill(state.wrestlers);
  if (net >= 0) return null;
  return Math.max(0, Math.floor(budgetOf(state) / -net));
}

// Settled once, when the week turns. Returns what moved so the aftermath can
// say it plainly.
export function settleWeek(state) {
  const account = finance(state);
  const fee = rightsFee(state);
  const wages = wageBill(state.wrestlers);
  const net = fee - wages;

  account.budget = Math.round(account.budget + net);
  account.weeks.push({ week: state.week, fee, wages, net, balance: account.budget });
  if (account.weeks.length > 26) account.weeks.shift();

  state.journal.push(createEntry({
    week: state.week, at: 0, type: 'books-settled',
    data: { fee, wages, net, balance: account.budget },
  }));

  return { fee, wages, net, balance: account.budget };
}

// What head office makes of the books, as a penalty on their read of you. An
// overdrawn promotion is a promotion somebody upstairs is being asked about.
export const OVERDRAWN_PENALTY = 14;

export function standingPenalty(state) {
  if (!overdrawn(state)) return 0;
  // Deeper in the red is worse, but it tops out: past a point they are already
  // as worried as they are going to get, and the rest is the same conversation.
  const depth = Math.min(1, -budgetOf(state) / 250000);
  return Math.round(OVERDRAWN_PENALTY * (0.5 + depth * 0.5));
}

export function money(amount) {
  const sign = amount < 0 ? '−' : '';
  const value = Math.abs(Math.round(amount));
  return `${sign}$${value.toLocaleString('en-US')}`;
}
