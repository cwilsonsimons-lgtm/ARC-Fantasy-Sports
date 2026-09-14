// Install every system's subscriptions. Called once at boot.
//
// Systems do not call each other. They subscribe to the event log and write
// through store actions, so the order they are installed in does not matter and
// adding one never means editing another.

import * as results from './results.js';
import * as rankings from './rankings.js';
import * as titles from './titles.js';
import * as upkeep from './upkeep.js';

export function installSystems() {
  // Order is only about readability - every system subscribes to the log rather
  // than calling the next one, so none of them depends on installing first.
  results.install();   // a result lands on the record
  titles.install();    // ...and can move a belt
  rankings.install();  // ...and reshuffles the rankings, which sets contenders
  upkeep.install();    // between shows: condition back, momentum fading
}
