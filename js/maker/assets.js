// Binary storage for the matchup-screen maker.
//
// The JSON state (teams, slots, scores) is small and lives in localStorage.
// Images do not: ten logos plus a handful of full-bleed backgrounds runs past
// the 5 MB localStorage quota on its own, and a quota error there loses the
// whole save, not just the picture. So every image and uploaded font lives in
// IndexedDB as a blob and the state only carries its asset id.
//
// Everything is loaded and decoded once at boot into IMG, so the renderer and
// the UI stay synchronous - a canvas draw can never be halfway through an
// await when the user drags a slot.

const DB_NAME = 'cbf_maker_assets';
const STORE = 'blobs';

export const IMG = new Map();   // asset id -> decoded HTMLImageElement
export const URLS = new Map();  // asset id -> object URL (for <img> in the UI)

let db = null;

function open() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function tx(mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out && out.result);
    t.onerror = () => rej(t.error);
  });
}

export async function initAssets() {
  db = await open();
  const all = await tx('readonly', s => s.getAllKeys());
  await Promise.all((all || []).map(async id => {
    const rec = await tx('readonly', s => s.get(id));
    if (rec) await adopt(id, rec);
  }));
}

// Decode a blob into the caches. Fonts are registered with the document rather
// than decoded as images, which is what lets canvas draw with them later.
async function adopt(id, rec) {
  const blob = rec.blob || rec;
  const kind = rec.kind || 'image';
  if (kind === 'font') {
    try {
      const face = new FontFace(fontFamily(id), await blob.arrayBuffer());
      await face.load();
      document.fonts.add(face);
    } catch { /* a corrupt upload should not stop the app from booting */ }
    return;
  }
  const url = URL.createObjectURL(blob);
  URLS.set(id, url);
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch { return; }
  IMG.set(id, img);
}

export function fontFamily(id) { return 'cbfmk-' + id; }

export function newId(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 9);
}

// Store a File/Blob and return its asset id, ready to draw.
export async function putAsset(file, kind = 'image') {
  const id = newId(kind === 'font' ? 'fnt' : 'img');
  const blob = kind === 'image' ? await shrink(file) : file;
  await tx('readwrite', s => s.put({ blob, kind, name: file.name || '' }, id));
  await adopt(id, { blob, kind });
  return id;
}

export async function dropAsset(id) {
  if (!db || !id) return;
  await tx('readwrite', s => s.delete(id));
  const url = URLS.get(id);
  if (url) URL.revokeObjectURL(url);
  URLS.delete(id); IMG.delete(id);
}

// Exports are large enough to matter but must survive a machine change, so the
// backup file carries assets inline as data URLs.
export async function assetDataURL(id) {
  const rec = await tx('readonly', s => s.get(id));
  if (!rec) return null;
  const blob = rec.blob || rec;
  return await new Promise(res => {
    const r = new FileReader();
    r.onload = () => res({ data: r.result, kind: rec.kind || 'image', name: rec.name || '' });
    r.readAsDataURL(blob);
  });
}

export async function restoreAsset(id, dataURL, kind) {
  const blob = await (await fetch(dataURL)).blob();
  await tx('readwrite', s => s.put({ blob, kind, name: '' }, id));
  await adopt(id, { blob, kind });
  return id;
}

// A 4000px phone photo of a logo costs 8 MB and renders no better than 1600px
// on a 2000px canvas. Cap the long edge; keep PNG (and so transparency) when
// the source has any, because cutout logos are the whole point.
const MAX_EDGE = 2400;
async function shrink(file) {
  if (!/^image\//.test(file.type) || /svg/.test(file.type)) return file;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch { URL.revokeObjectURL(url); return file; }
  const long = Math.max(img.naturalWidth, img.naturalHeight);
  if (long <= MAX_EDGE) { URL.revokeObjectURL(url); return file; }
  const k = MAX_EDGE / long;
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  const type = /png|webp/.test(file.type) ? 'image/png' : 'image/jpeg';
  return await new Promise(r => c.toBlob(r, type, 0.92));
}
