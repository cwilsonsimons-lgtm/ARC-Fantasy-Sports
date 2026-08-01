// Account / Profile surface — a full-screen section like Arc Markets, opened
// from the Profile item in the bottom nav.
//
// Signed out, it shows a sign-in / create-account screen. Signed in, it shows a
// profile hub: the account, the leagues it has joined, a snapshot of its Arc
// Markets portfolio, and controls to sign out.
//
// Two auth backends sit behind one UI:
//   • Supabase (account/config.js filled in) — real accounts, so a login made on
//     one device works on another and different people get different accounts.
//   • Local fallback (no config, or the offline harness) — accounts live only in
//     this browser.
// activeAccount() in store.js hides which one is in play; this file only branches
// where the action differs (the network calls are async, the local ones aren't).
//
// Signing in, out or switching changes which namespace the app's storage reads
// from (account/boot.js), and store.js / markets/data.js read that storage once
// at load — so those actions reload the page to bring the app up cleanly.
import {
  activeAccount, listUsers, createAccount, authenticate, signOut, setSession,
  getLeagues, joinLeague, leaveLeague,
} from './store.js';
import {
  supaConfigured, supaSignIn, supaSignUp, supaSignOut, supaRefresh,
  loadSession, clearSession,
} from './supabase.js';
import { portfolio, mkStore } from '../markets/data.js';

// Leagues anyone can join in the prototype. "City Boys Dynasty" is the league the
// fantasy app itself is built around; the others make joining more than one real.
const OPEN_LEAGUES = [
  { id: 'city-boys-dynasty', name: 'City Boys Dynasty', meta: '12-team Dynasty · Week 8' },
  { id: 'arc-open-redraft',  name: 'Arc Open Redraft',  meta: '10-team Redraft · Pre-draft' },
  { id: 'sunday-scaries',    name: 'Sunday Scaries',    meta: '8-team Best Ball · Open' },
];

let authMode = 'signin';                 // 'signin' | 'create'
let busy = false;                        // guards double-submit during a network call
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const initials = n => String(n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const money = n => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------------------------------------------------------------- open / close
export function openAccount() {
  document.body.classList.remove('markets');           // never stack two sections
  if (window.mkCloseSheet) window.mkCloseSheet();
  document.body.classList.add('account');
  renderAccount();
  const sc = document.querySelector('.acct-scroll');
  if (sc) sc.scrollTop = 0;
}
export function closeAccount() { document.body.classList.remove('account'); }

export function acctToast(msg) {
  const el = document.getElementById('acctHint');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(acctToast._t);
  acctToast._t = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------------------------------------------------------------- render
export function renderAccount() {
  const el = document.getElementById('acctBody');
  if (!el) return;
  const acc = activeAccount();
  el.innerHTML = acc ? profileHTML(acc) : authHTML();
}

// ---- signed-out: sign in / create account ----
function authHTML() {
  const cloud = supaConfigured();
  const others = cloud ? [] : listUsers();     // saved-on-device is a local-mode idea
  return `
    <div class="acct-hero">
      <div class="acct-logo">${footballSvg()}</div>
      <h1>Welcome to Arc Fantasy</h1>
      <p>Sign in to your account — your leagues, your roster and your Arc Markets
         portfolio all live behind it.</p>
    </div>

    <div class="acct-seg">
      <div class="seg${authMode === 'signin' ? ' on' : ''}" onclick="acctAuthMode('signin')">Sign in</div>
      <div class="seg${authMode === 'create' ? ' on' : ''}" onclick="acctAuthMode('create')">Create account</div>
    </div>

    <div id="acctErr" class="acct-err" style="display:none"></div>

    ${authMode === 'signin' ? signinForm() : createForm(cloud)}

    ${others.length ? `<div class="acct-lb">SAVED ON THIS DEVICE</div>
      <div class="acct-card">
        ${others.map(u => `<div class="acct-row" onclick="acctSwitch('${u.id}')">
          <div class="acct-av sm">${initials(u.name)}</div>
          <div class="acct-row-t"><div class="a">${esc(u.name)}</div><div class="b">${esc(u.email)}</div></div>
          <div class="acct-go">Use ›</div>
        </div>`).join('')}
      </div>` : ''}

    <div class="acct-guest" onclick="closeAccount()">Keep browsing as a guest</div>
    <p class="acct-fine">${cloud
      ? 'Your account works on any device you sign in on. Passwords are handled by '
        + 'Supabase over an encrypted connection — this app never sees or stores them.'
      : 'Prototype accounts are stored only in this browser — there is no server and no '
        + 'real security. Don’t reuse a password you use anywhere else.'}</p>`;
}

function signinForm() {
  return `<div class="acct-form">
    <label>Email</label>
    <input id="acctEmail" type="email" inputmode="email" autocomplete="username" placeholder="you@example.com">
    <label>Password</label>
    <input id="acctPass" type="password" autocomplete="current-password" placeholder="••••••••"
      onkeydown="if(event.key==='Enter')acctSignIn()">
    <div class="acct-btn" id="acctSignInBtn" onclick="acctSignIn()">Sign in</div>
  </div>`;
}
function createForm(cloud) {
  return `<div class="acct-form">
    <label>Display name</label>
    <input id="acctName" type="text" autocomplete="name" placeholder="Team manager name">
    <label>Email</label>
    <input id="acctEmail" type="email" inputmode="email" autocomplete="username" placeholder="you@example.com">
    <label>Password</label>
    <input id="acctPass" type="password" autocomplete="new-password"
      placeholder="At least ${cloud ? 6 : 4} characters"
      onkeydown="if(event.key==='Enter')acctCreate()">
    <div class="acct-btn" id="acctCreateBtn" onclick="acctCreate()">Create account</div>
  </div>`;
}

// ---- signed-in: profile hub ----
function profileHTML(acc) {
  const leagues = getLeagues(acc.id);
  const joinable = OPEN_LEAGUES.filter(l => !leagues.some(j => j.id === l.id));
  const pf = portfolio();
  const watch = (mkStore.watch || []).length;
  const local = acc.source === 'local';
  const others = local ? listUsers().filter(x => x.id !== acc.id) : [];

  return `
    <div class="acct-me">
      <div class="acct-av">${initials(acc.name)}</div>
      <div class="acct-me-t">
        <div class="a">${esc(acc.name)}</div>
        <div class="b">${esc(acc.email)}</div>
        <div class="acct-badge">${acc.source === 'supabase'
          ? 'Signed in · works across your devices'
          : 'Signed in · on this device'}</div>
      </div>
    </div>

    <div class="acct-lb">YOUR LEAGUES</div>
    <div class="acct-card">
      ${leagues.length ? leagues.map(l => `<div class="acct-row">
          <div class="acct-shield">${shieldSvg()}</div>
          <div class="acct-row-t"><div class="a">${esc(l.name)}</div><div class="b">${esc(l.meta || 'League')}</div></div>
          <div class="acct-x" onclick="acctLeaveLeague('${l.id}')" title="Leave league">Leave</div>
        </div>`).join('')
        : `<div class="acct-empty">You haven't joined any leagues yet. Join one below.</div>`}
    </div>

    ${joinable.length ? `<div class="acct-lb">JOIN A LEAGUE</div>
      <div class="acct-card">
        ${joinable.map(l => `<div class="acct-row">
          <div class="acct-shield dim">${shieldSvg()}</div>
          <div class="acct-row-t"><div class="a">${esc(l.name)}</div><div class="b">${esc(l.meta)}</div></div>
          <div class="acct-join" onclick="acctJoinLeague('${l.id}')">Join</div>
        </div>`).join('')}
      </div>` : ''}
    <div class="acct-code">
      <input id="acctCode" type="text" placeholder="Have an invite code? Enter it"
        onkeydown="if(event.key==='Enter')acctJoinCode()">
      <div class="acct-btn sm" onclick="acctJoinCode()">Join</div>
    </div>

    <div class="acct-lb">ARC MARKETS</div>
    <div class="acct-card">
      <div class="acct-mk">
        <div class="stat"><div class="k">PORTFOLIO</div><div class="v">${money(pf.value)}</div></div>
        <div class="stat"><div class="k">HOLDINGS</div><div class="v">${pf.rows.length}</div></div>
        <div class="stat"><div class="k">WATCHING</div><div class="v">${watch}</div></div>
      </div>
      <div class="acct-btn ghost" onclick="closeAccount();openMarkets()">Open Arc Markets — buy &amp; sell ›</div>
    </div>

    ${others.length ? `<div class="acct-lb">SWITCH ACCOUNT</div>
      <div class="acct-card">
        ${others.map(o => `<div class="acct-row" onclick="acctSwitch('${o.id}')">
          <div class="acct-av sm">${initials(o.name)}</div>
          <div class="acct-row-t"><div class="a">${esc(o.name)}</div><div class="b">${esc(o.email)}</div></div>
          <div class="acct-go">Use ›</div>
        </div>`).join('')}
      </div>` : ''}

    ${local ? `<div class="acct-btn ghost" onclick="acctSignOut()">Add another account</div>` : ''}
    <div class="acct-btn danger" onclick="acctSignOut()">Sign out</div>`;
}

// ---------------------------------------------------------------- handlers
export function acctAuthMode(m) { authMode = m; showErr(''); renderAccount(); }

function showErr(msg) {
  const el = document.getElementById('acctErr');
  if (!el) return;
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}
const val = id => { const el = document.getElementById(id); return el ? el.value : ''; };
function btnBusy(id, on, label) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.pointerEvents = on ? 'none' : '';
  el.style.opacity = on ? '.6' : '';
  el.textContent = on ? label : (id === 'acctSignInBtn' ? 'Sign in' : 'Create account');
}
// Turn the various server messages into something a person wants to read.
function friendly(msg) {
  const m = String(msg || '');
  if (/invalid login credentials/i.test(m)) return 'That email or password isn’t right.';
  if (/user already registered/i.test(m)) return 'An account with that email already exists — try signing in.';
  if (/invalid.*email|email.*invalid/i.test(m)) return 'Enter a valid email address.';
  return m;
}

export async function acctSignIn() {
  if (busy) return;
  showErr('');
  if (supaConfigured()) {
    busy = true; btnBusy('acctSignInBtn', true, 'Signing in…');
    let r;
    try { r = await supaSignIn(val('acctEmail'), val('acctPass')); }
    catch (e) { r = { error: 'Can’t reach the server. Check your connection and try again.' }; }
    busy = false; btnBusy('acctSignInBtn', false);
    if (r.error) return showErr(friendly(r.error));
    location.reload();
  } else {
    const r = authenticate({ email: val('acctEmail'), password: val('acctPass') });
    if (r.error) return showErr(r.error);
    location.reload();
  }
}

export async function acctCreate() {
  if (busy) return;
  showErr('');
  const name = val('acctName'), email = val('acctEmail'), password = val('acctPass');
  if (supaConfigured()) {
    if (!name || !name.trim()) return showErr('Enter a display name.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return showErr('Enter a valid email address.');
    if (!password || password.length < 6) return showErr('Password must be at least 6 characters.');
    busy = true; btnBusy('acctCreateBtn', true, 'Creating…');
    let r;
    try { r = await supaSignUp(name.trim(), email, password); }
    catch (e) { r = { error: 'Can’t reach the server. Check your connection and try again.' }; }
    busy = false; btnBusy('acctCreateBtn', false);
    if (r.error) return showErr(friendly(r.error));
    if (r.needsConfirm) {                 // project has "Confirm email" turned on
      authMode = 'signin'; renderAccount();
      showErr('Account created — check your email for a confirmation link, then sign in.');
      return;
    }
    location.reload();
  } else {
    const r = createAccount({ name, email, password });
    if (r.error) return showErr(r.error);
    location.reload();
  }
}

export function acctSwitch(id) { setSession(id); location.reload(); }

export async function acctSignOut() {
  if (busy) return;
  if (supaConfigured() && loadSession()) { busy = true; try { await supaSignOut(); } catch (e) { clearSession(); } busy = false; }
  else signOut();
  location.reload();
}

export function acctJoinLeague(id) {
  const acc = activeAccount(); if (!acc) return;
  const l = OPEN_LEAGUES.find(x => x.id === id); if (!l) return;
  joinLeague(acc.id, l);
  acctToast('Joined ' + l.name);
  renderAccount();
}
export function acctLeaveLeague(id) {
  const acc = activeAccount(); if (!acc) return;
  leaveLeague(acc.id, id);
  acctToast('Left league');
  renderAccount();
}
export function acctJoinCode() {
  const acc = activeAccount(); if (!acc) return;
  const code = val('acctCode').trim();
  if (!code) return acctToast('Enter an invite code');
  const id = 'code-' + code.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (joinLeague(acc.id, { id, name: 'League ' + code.toUpperCase(), meta: 'Private · joined by code' })) {
    acctToast('Joined by code');
  } else {
    acctToast('You are already in that league');
  }
  renderAccount();
}

// ---------------------------------------------------------------- little SVGs
function footballSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 20C3 15 5 7 12 4c5 7 5 11 8 16-5 3-13 3-16 0Z"/><path d="M9 15l6-6M10 12h4M12 10v4"/></svg>`;
}
function shieldSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5l-8-3Z"/><path d="m9 12 2 2 4-4"/></svg>`;
}

// On startup, keep a real Supabase session fresh. If the access token has aged
// out, silently exchange the refresh token for a new one; if the server says the
// session is dead, drop it and reload to guest. A network error (offline) leaves
// the session in place so the user stays signed in.
export async function initAccount() {
  if (!supaConfigured()) return;
  const s = loadSession();
  if (!s) return;
  if (Date.now() > (s.expires_at || 0) - 60000) {
    try {
      const ns = await supaRefresh();
      if (!ns) { clearSession(); location.reload(); }
    } catch (e) { /* offline — keep the session, stay signed in */ }
  }
}
