// Team profiles. A team carries its logo, its typeface and its colours once;
// every screen made afterwards picks them up automatically.

import { qs, el, clear, toast, pickFile, field, select, text, color, btn } from './ui.js';
import { state, save, FONTS } from './store.js';
import { putAsset, dropAsset, URLS, fontFamily, newId } from './assets.js';

let onChange = () => {};

export function initTeams(notify) {
  onChange = notify || (() => {});
  qs('#teamAdd').addEventListener('click', () => {
    state.teams.push({ id: newId('t'), name: 'New team', mgr: '', color: '#5AA9E6', accent: '#ffffff', font: 'oswald', logo: '' });
    save(); onChange(); paintTeams();
  });
}

// The face a team's name renders in, as a CSS shorthand — used for the live
// preview so picking a typeface shows the real thing, not a name in a list.
export function faceCSS(t, px) {
  const key = t.font || 'oswald';
  if (String(key).startsWith('custom:')) return `400 ${px}px '${fontFamily(key.slice(7))}', 'Oswald', sans-serif`;
  const f = FONTS.find(x => x.k === key) || FONTS[0];
  return `${f.w} ${Math.round(px * f.sc)}px ${f.ff}, 'Oswald', sans-serif`;
}

function fontOptions() {
  return FONTS.map(f => [f.k, f.lb])
    .concat((state.fonts || []).map(f => ['custom:' + f.id, f.name + ' (yours)']));
}

export function paintTeams() {
  const grid = clear(qs('#teamGrid'));
  state.teams.forEach(t => {
    const prev = el('div', { class: 'tprev' }, t.name);
    const style = () => {
      prev.style.font = faceCSS(t, 22);
      prev.style.color = t.color;
      const f = FONTS.find(x => x.k === t.font);
      prev.style.textTransform = f ? f.tt : 'none';
      prev.textContent = t.name;
    };

    const logo = el('div', {
      class: 'tlogo',
      title: 'Upload a logo (PNG with transparency looks best)',
      onclick: async () => {
        const file = await pickFile('image/*');
        if (!file) return;
        let id;
        try { id = await putAsset(file); } catch (e) { return toast(e.message); }
        if (t.logo) dropAsset(t.logo);
        t.logo = id;
        save(); onChange(); paintTeams();
        toast('Logo set for ' + t.name);
      },
    }, t.logo && URLS.get(t.logo)
      ? el('img', { src: URLS.get(t.logo), alt: '' })
      : el('span', { class: 'mono', style: `color:${t.color}` }, (t.name || '?').trim()[0].toUpperCase()));

    const body = el('div', {},
      el('div', { class: 'tname' }, text(t.name, v => { t.name = v; save(); style(); onChange(); })),
      field('Manager', text(t.mgr, v => { t.mgr = v; save(); onChange(); })),
      field('Typeface', select(fontOptions(), t.font, v => { t.font = v; save(); style(); onChange(); })),
      field('Colours', el('div', { class: 'row' },
        color(t.color, v => { t.color = v; save(); style(); onChange(); }),
        color(t.accent, v => { t.accent = v; save(); onChange(); }),
        el('span', { class: 'fld-h' }, 'main / accent'))),
      prev,
      el('div', { class: 'row', style: 'margin-top:8px' },
        t.logo ? btn('Remove logo', () => {
          dropAsset(t.logo); t.logo = ''; save(); onChange(); paintTeams();
        }, 'sm') : null,
        btn('Delete team', () => {
          if (!confirm(`Delete ${t.name}?`)) return;
          if (t.logo) dropAsset(t.logo);
          state.teams = state.teams.filter(x => x.id !== t.id);
          save(); onChange(); paintTeams();
        }, 'sm warn')));

    style();
    grid.append(el('div', { class: 'tcard' }, logo, body));
  });
}
