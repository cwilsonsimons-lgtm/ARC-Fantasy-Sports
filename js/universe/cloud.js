// Universe — the claude.ai copy of the universe, when the app runs as a
// published artifact.
//
// Opened as a file there is no window.claude and none of this runs: the
// browser's storage is the save, as it always was. Published on claude.ai,
// that storage belongs to one browser and can be cleared out from under the
// page, so every save also goes to the artifact's database - into the
// viewer's own private space, data/users/<id>/ - and any browser that opens
// the page loads it from there. The browser's copy stays as a local cache.
//
// A universe outgrows one database document (256 KiB), so the saved JSON is
// split into parts. They go into whichever of two slots the manifest isn't
// pointing at, and the manifest is written last: a save cut off half-way
// leaves the previous one whole.
//
// Everything it touches is passed in, so it runs under Node against a
// stand-in store for the tests.
import { migrate } from './model.js';

const META = 'wwe_universe_v1:cloud';          // this browser's copy: { rev, dirty }
const ASIDE = 'wwe_universe_v1:before-sync';   // unsent changes a newer save replaced
const PART = 60000;                             // characters per part: far inside 256 KiB once stored

const STOPPED = {
  invalid_argument: 'This page can’t save to your claude.ai account here — you may only have view access. Changes stay in this browser.',
  quota_exceeded: 'This page’s claude.ai storage is full. Changes stay in this browser — export a save file.',
};
const hasContent = st => st.wrestlers.length + st.teams.length + st.titles.length + st.events.length > 0;

/**
 * env: { claude, storage, current() -> universe, adopt(universe), onStatus(status), toast(msg), delay }
 * status.mode: 'connecting' | 'synced' | 'saving' | 'error' | 'off' (this view can't keep a copy)
 */
export function createCloud(env) {
  const { claude, storage, current, adopt, onStatus = () => {}, toast = () => {}, delay = 700 } = env;
  const holder = `tab-${Math.random().toString(36).slice(2)}`;
  const downloads = Promise.resolve(claude.use('downloads')).catch(() => null);
  let col = null;          // the viewer's own collection
  let manifest = null;     // { rev, slot, parts: { a, b }, savedAt } as last read or written
  let halted = false;      // never write again this visit (no access, or the stored copy is unreadable)
  let latest = null;       // JSON waiting to go up
  let timer = null, writing = null;
  let status = { mode: 'connecting', message: '' };

  const setStatus = (mode, message = '') => { status = { mode, message }; onStatus(status); };
  const meta = () => {
    try { return JSON.parse(storage.getItem(META)) || { rev: 0, dirty: false }; } catch (e) { return { rev: 0, dirty: false }; }
  };
  const setMeta = m => { try { storage.setItem(META, JSON.stringify(m)); } catch (e) { /* the claude.ai copy is what counts */ } };

  async function read(m) {
    const n = m.parts[m.slot];
    const snaps = await Promise.all(Array.from({ length: n }, (_, i) => col.doc(`${m.slot}-${i}`).get()));
    if (snaps.some(s => !s.exists)) throw new Error('part of the save is missing');
    return migrate(JSON.parse(snaps.map(s => s.data().s).join('')));
  }

  async function write(json) {
    // one tab writes at a time; a busy lease means another is mid-save
    const lease = await col.doc('lock').acquire({ holder, ttlMs: 30000 }).catch(() => ({ acquired: true }));
    if (!lease.acquired) throw { code: 'busy' };
    const snap = await col.doc('save').get();
    const cur = snap.exists ? snap.data() : null;
    const slot = cur && cur.slot === 'a' ? 'b' : 'a';
    const had = (cur && cur.parts && cur.parts[slot]) || 0;
    const parts = [];
    for (let i = 0; i < json.length; i += PART) parts.push(json.slice(i, i + PART));
    for (let i = 0; i < parts.length; i++) await col.doc(`${slot}-${i}`).set({ s: parts[i] });
    const m = { rev: (cur ? cur.rev : 0) + 1, slot, parts: { ...(cur && cur.parts), [slot]: parts.length }, savedAt: new Date().toISOString() };
    await col.doc('save').set(m);
    manifest = m;
    for (let i = parts.length; i < had; i++) await col.doc(`${slot}-${i}`).delete().catch(() => {});
  }

  /** Send what's waiting now. Resolves when it has gone up, or failed. */
  function flush() {
    clearTimeout(timer);
    timer = null;
    if (writing) return writing;
    if (!col || halted || latest == null) return Promise.resolve();
    writing = (async () => {
      while (latest != null) {
        const json = latest;
        latest = null;
        setStatus('saving');
        try {
          await write(json);
          if (latest == null) setMeta({ rev: manifest.rev, dirty: false });
          setStatus('synced');
        } catch (e) {
          if (latest == null) latest = json;
          const code = e && e.code;
          if (STOPPED[code]) { halted = true; setStatus('error', STOPPED[code]); }
          else if (code === 'busy') { timer = setTimeout(flush, 2000); }
          else {
            timer = setTimeout(flush, 15000);
            setStatus('error', 'Couldn’t reach your claude.ai account just now. Changes are safe in this browser; trying again shortly.');
          }
          break;
        }
      }
      writing = null;
    })();
    return writing;
  }

  /** Every saved change. Returns true while the claude.ai copy is being kept. */
  function changed(st) {
    if (status.mode === 'off') return false;
    latest = JSON.stringify(st);
    setMeta({ ...meta(), dirty: true });
    if (halted) return false;
    if (col) { clearTimeout(timer); timer = setTimeout(flush, delay); }
    return true;
  }

  // another tab or device saved: take it, unless a change here is waiting to go up
  function watch() {
    col.doc('save').onSnapshot(snap => {
      if (!snap.exists || snap.metadata.hasPendingWrites) return;
      const m = snap.data();
      const stale = () => (manifest && m.rev <= manifest.rev) || writing || latest != null || halted;
      if (stale()) return;
      read(m).then(st => {
        if (stale()) return;
        manifest = m;
        setMeta({ rev: m.rev, dirty: false });
        adopt(st);
        toast('Updated with changes saved elsewhere');
      }).catch(() => {});
    }, () => {});
  }

  async function start() {
    try {
      const [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
      const id = user && await user.id();
      if (!db || !id) { setStatus('off'); return; }
      col = db.collection(`data/users/${id}`);
      const snap = await col.doc('save').get();
      const local = meta();
      if (snap.exists) {
        const m = snap.data();
        if (!local.dirty || m.rev > local.rev) {
          const st = await read(m);
          if (local.dirty) {
            try { storage.setItem(ASIDE, JSON.stringify(current())); } catch (e) { /* nowhere to keep it */ }
            toast('Loaded the newer save from your claude.ai account');
          }
          manifest = m;
          latest = null;
          setMeta({ rev: m.rev, dirty: false });
          if (JSON.stringify(st) !== JSON.stringify(current())) adopt(st);
        } else {
          manifest = m;
          latest = JSON.stringify(current());
        }
      } else if (local.dirty || hasContent(current())) {
        latest = JSON.stringify(current());
      }
      setStatus('synced');
      await flush();
      watch();
    } catch (e) {
      // what's stored there can't be read: show this browser's copy, and never write over it
      halted = true;
      setStatus('error', 'Couldn’t load your universe from your claude.ai account. You’re seeing this browser’s copy, and it won’t be saved over the one there.');
    }
  }

  /** Offer a file through claude.ai's save prompt: 'saved', 'declined', 'failed' or 'unavailable'. */
  async function exportFile(filename, text) {
    const d = await downloads;
    if (!d) return 'unavailable';
    try {
      await d.save({ filename, data: text });
      return 'saved';
    } catch (e) {
      return e && e.code === 'declined' ? 'declined' : 'failed';
    }
  }

  return { start, changed, flush, exportFile, status: () => status };
}
