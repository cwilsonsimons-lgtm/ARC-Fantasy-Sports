// Backup, custom fonts, and the reset button.
//
// The images live in IndexedDB, which no amount of "export my settings" in a
// browser will carry to another machine - so the backup file inlines them.

import { qs, el, clear, toast, pickFile, download, btn } from './ui.js';
import { state, save, KEY } from './store.js';
import { putAsset, dropAsset, assetDataURL, restoreAsset } from './assets.js';

let onChange = () => {};

export function initData(notify) {
  onChange = notify || (() => {});
  qs('#dataExport').addEventListener('click', exportAll);
  qs('#dataImport').addEventListener('click', importAll);
  qs('#fontAdd').addEventListener('click', addFont);
  qs('#dataWeeks').addEventListener('change', e => {
    state.weeks = Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 14));
    save(); onChange();
  });
  qs('#dataReset').addEventListener('click', reset);
}

export function paintData() {
  qs('#dataWeeks').value = state.weeks || 14;
  const list = clear(qs('#fontList'));
  (state.fonts || []).forEach(f => {
    list.append(el('li', {},
      el('span', { style: `font-family:'cbfmk-${f.id}',sans-serif;font-size:16px` }, f.name),
      el('span', { class: 'spacer', style: 'flex:1' }),
      btn('Remove', () => {
        dropAsset(f.id);
        state.fonts = state.fonts.filter(x => x.id !== f.id);
        // Anything still pointing at it falls back to the default face.
        state.teams.forEach(t => { if (t.font === 'custom:' + f.id) t.font = 'oswald'; });
        state.templates.forEach(t => t.slots.forEach(s => { if (s.font === 'custom:' + f.id) s.font = 'team'; }));
        save(); onChange(); paintData();
      }, 'sm warn')));
  });
  if (!(state.fonts || []).length) list.append(el('li', { class: 'muted' }, 'None yet.'));
}

async function addFont() {
  const file = await pickFile('.ttf,.otf,.woff,.woff2,font/*');
  if (!file) return;
  let id;
  try { id = await putAsset(file, 'font'); } catch (e) { return toast(e.message); }
  state.fonts.push({ id, name: file.name.replace(/\.[^.]+$/, '') });
  save(); onChange(); paintData();
  toast('Font added — pick it on a team or a slot');
}

// Every asset id referenced anywhere, so a backup carries exactly what is used.
function usedAssets() {
  const ids = new Set();
  state.teams.forEach(t => t.logo && ids.add(t.logo));
  state.templates.forEach(t => t.bg && ids.add(t.bg));
  (state.photos || []).forEach(p => ids.add(p.id));
  (state.fonts || []).forEach(f => ids.add(f.id));
  return [...ids];
}

async function exportAll() {
  toast('Packing backup…');
  const assets = {};
  for (const id of usedAssets()) {
    const rec = await assetDataURL(id);
    if (rec) assets[id] = rec;
  }
  const blob = new Blob([JSON.stringify({ kind: 'cbf-matchup-maker', v: 1, state, assets })],
    { type: 'application/json' });
  download(blob, `matchup-screens-${state.year}-wk${state.week}.json`);
  toast('Backup saved');
}

async function importAll() {
  const file = await pickFile('application/json,.json');
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast('That file is not a backup'); }
  if (!data || data.kind !== 'cbf-matchup-maker') return toast('That file is not a backup');
  if (!confirm('Restoring replaces everything currently in the tool. Continue?')) return;

  toast('Restoring…');
  for (const [id, rec] of Object.entries(data.assets || {})) {
    await restoreAsset(id, rec.data, rec.kind || 'image', rec.name || '');
  }
  Object.keys(state).forEach(k => delete state[k]);
  Object.assign(state, data.state);
  save(); onChange();
  toast('Restored');
}

function reset() {
  if (!confirm('Delete every team, template, logo and score in this tool?')) return;
  usedAssets().forEach(dropAsset);
  localStorage.removeItem(KEY);
  location.reload();
}
