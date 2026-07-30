// Client-side account system for the prototype.
//
// There is no backend, so "accounts" live entirely in localStorage: a directory
// of users under one global key, plus a session pointer to whoever is signed in.
// A signed-in user gets an isolated copy of the app's data — their own team,
// roster, lineup and markets — because account/boot.js namespaces the app's
// storage keys by the active account id.
//
// Guest (no session) maps to the original, un-namespaced keys, so anyone who
// never signs in gets exactly the app that shipped before accounts existed, and
// the build/verification harness is untouched.
//
// SECURITY: this is a front-end demo. The password "hash" below is not
// cryptographic and the whole store is readable by anyone with the device. It
// exists to make the prototype feel like a real multi-account app, not to
// protect real credentials. A production build would move all of this behind a
// server.

export const ACCT_KEY = 'arc_account_v1';

export function loadAccounts() {
  try {
    const a = JSON.parse(localStorage.getItem(ACCT_KEY)) || {};
    a.users = Array.isArray(a.users) ? a.users : [];
    a.session = a.session || null;
    return a;
  } catch (e) { return { users: [], session: null }; }
}
export function saveAccounts(a) {
  try { localStorage.setItem(ACCT_KEY, JSON.stringify(a)); return true; }
  catch (e) { return false; }
}

// A deliberately simple, NON-cryptographic scramble (FNV-1a, base36). It only
// keeps the stored password from being readable at a glance — see the security
// note above.
export function hashPass(s) {
  let h = 2166136261 >>> 0;
  s = String(s);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

const normEmail = e => String(e || '').trim().toLowerCase();
// id is derived from the email so one person maps to one namespace across
// reloads, regardless of how many times they sign in and out.
const idFor = email => 'u_' + hashPass('id:' + normEmail(email));

export function sessionId() { return loadAccounts().session; }
export function findUser(id) { return loadAccounts().users.find(u => u.id === id) || null; }
export function currentUser() { const a = loadAccounts(); return a.users.find(u => u.id === a.session) || null; }
export function listUsers() { return loadAccounts().users; }

export function createAccount({ name, email, password }) {
  const a = loadAccounts();
  const em = normEmail(email);
  if (!name || !name.trim()) return { error: 'Enter a display name.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return { error: 'Enter a valid email address.' };
  if (!password || password.length < 4) return { error: 'Password must be at least 4 characters.' };
  if (a.users.some(u => u.email === em)) return { error: 'An account with that email already exists.' };
  const user = {
    id: idFor(em), name: name.trim(), email: em, pass: hashPass(password),
    created: Date.now(), leagues: [],
  };
  a.users.push(user);
  a.session = user.id;
  saveAccounts(a);
  return { user };
}

export function authenticate({ email, password }) {
  const a = loadAccounts();
  const em = normEmail(email);
  const user = a.users.find(u => u.email === em);
  if (!user) return { error: 'No account found for that email.' };
  if (user.pass !== hashPass(password)) return { error: 'Incorrect password.' };
  a.session = user.id;
  saveAccounts(a);
  return { user };
}

export function setSession(id) { const a = loadAccounts(); a.session = id; saveAccounts(a); }
export function signOut() { const a = loadAccounts(); a.session = null; saveAccounts(a); }

// ---------------------------------------------------------------- leagues
// Membership is per user and lives in the account record (not the namespaced
// app data), so it survives account switches and never collides across users.
export function joinLeague(userId, league) {
  const a = loadAccounts();
  const u = a.users.find(x => x.id === userId);
  if (!u) return false;
  u.leagues = u.leagues || [];
  if (u.leagues.some(l => l.id === league.id)) return false;
  u.leagues.push({ id: league.id, name: league.name, meta: league.meta || '', joined: Date.now() });
  saveAccounts(a);
  return true;
}
export function leaveLeague(userId, leagueId) {
  const a = loadAccounts();
  const u = a.users.find(x => x.id === userId);
  if (!u) return false;
  u.leagues = (u.leagues || []).filter(l => l.id !== leagueId);
  saveAccounts(a);
  return true;
}
