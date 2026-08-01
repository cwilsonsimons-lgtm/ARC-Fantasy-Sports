// Real, cross-device authentication against a Supabase project.
//
// No SDK: this talks to Supabase's auth server (GoTrue) over plain fetch, which
// keeps the project's "no runtime dependencies" promise and works identically
// whether the app is served as modules or as the single-file build. Only the
// four calls the app needs are here — sign up, sign in, sign out, refresh.
//
// The session (access token, refresh token, and the bits of the user the UI
// shows) is stored under one GLOBAL localStorage key — never namespaced, since
// it is what *decides* the namespace. account/boot.js reads it synchronously at
// startup to pick which account's data to load.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supaConfigured = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);
const SESSION_KEY = 'arc_supabase_session';

export function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch (e) { return null; }
}
function storeSession(s) {
  try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); }
  catch (e) { /* storage blocked */ }
}
export function clearSession() { storeSession(null); }

// Shape the app cares about, pulled from a GoTrue token/user payload.
function sessionFrom(d) {
  const u = d.user || {};
  const meta = u.user_metadata || {};
  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    // GoTrue gives expires_in (seconds from now); keep an absolute ms deadline.
    expires_at: Date.now() + (d.expires_in || 3600) * 1000,
    user: {
      id: u.id,
      email: u.email,
      name: meta.name || meta.full_name || (u.email || '').split('@')[0],
    },
  };
}

// Pull a human-readable message out of the several shapes GoTrue uses for errors.
function errorFrom(data, status) {
  return data.error_description || data.msg || data.message ||
    (typeof data.error === 'string' ? data.error : null) ||
    `Request failed (${status}).`;
}

async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST', headers, body: JSON.stringify(body || {}),
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* empty body (e.g. logout) */ }
  return { ok: res.ok, status: res.status, data };
}

/** Create an account. Returns { session } when the project auto-confirms email,
 *  { needsConfirm } when it emails a confirmation link first, or { error }. */
export async function supaSignUp(name, email, password) {
  const r = await post('signup', { email, password, data: { name } });
  if (!r.ok) return { error: errorFrom(r.data, r.status) };
  if (r.data.access_token) { const s = sessionFrom(r.data); storeSession(s); return { session: s }; }
  return { needsConfirm: true };
}

/** Sign in with email + password. Returns { session } or { error }. */
export async function supaSignIn(email, password) {
  const r = await post('token?grant_type=password', { email, password });
  if (!r.ok) return { error: errorFrom(r.data, r.status) };
  const s = sessionFrom(r.data); storeSession(s); return { session: s };
}

/** Sign out: revoke the token server-side (best effort) and drop the local session. */
export async function supaSignOut() {
  const s = loadSession();
  if (s && s.access_token) { try { await post('logout', {}, s.access_token); } catch (e) { /* offline */ } }
  clearSession();
}

/** Exchange the refresh token for a fresh session.
 *  Returns the new session, null if the server rejected it (session is dead),
 *  and throws on a network error (offline — caller should keep the session). */
export async function supaRefresh() {
  const s = loadSession();
  if (!s || !s.refresh_token) return null;
  const r = await post('token?grant_type=refresh_token', { refresh_token: s.refresh_token });
  if (!r.ok) return null;                 // rejected: refresh token revoked/expired
  const ns = sessionFrom(r.data); storeSession(ns); return ns;
}
