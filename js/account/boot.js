// Namespaces the app's own localStorage keys by the signed-in account, so each
// account carries an isolated copy of its team, roster and markets.
//
// This MUST run before any module that reads those keys — store.js reads
// `cbd_team_v1` and markets/data.js reads `arc_markets_v1` at import time — so
// main.js imports this module first. Guest (no session) is left on the original
// keys, so the app that ships for someone who never signs in is byte-for-byte
// the one that existed before accounts, and the verification harness (which
// clears storage and asserts on the raw keys) is unaffected.
import { sessionId } from './store.js';

// Only the app's own data keys are namespaced. The account directory itself
// (arc_account_v1) is global and must never be rewritten.
const OWNED = ['cbd_team_v1', 'arc_markets_v1'];

(function install() {
  let id = null;
  try { id = sessionId(); } catch (e) { id = null; }
  if (!id) return;                       // guest → original keys, nothing to wrap

  const suffix = '::' + id;
  const ls = window.localStorage;
  const _get = ls.getItem.bind(ls);
  const _set = ls.setItem.bind(ls);
  const _rem = ls.removeItem.bind(ls);
  const map = k => (OWNED.includes(k) ? k + suffix : k);

  try {
    ls.getItem = k => _get(map(k));
    ls.setItem = (k, v) => _set(map(k), v);
    ls.removeItem = k => _rem(map(k));
  } catch (e) {
    // Storage object is locked down (rare). Fall back to shared keys rather than
    // breaking the app; accounts simply won't be isolated in that environment.
  }
})();
