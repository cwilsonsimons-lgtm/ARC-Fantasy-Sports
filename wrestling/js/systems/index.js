// Install every system's subscriptions. Called once at boot.
//
// Systems do not call each other. They subscribe to the event log and write
// through store actions, so the order they are installed in does not matter and
// adding one never means editing another.

import * as results from './results.js';
import * as upkeep from './upkeep.js';

export function installSystems() {
  results.install();
  upkeep.install();
}
