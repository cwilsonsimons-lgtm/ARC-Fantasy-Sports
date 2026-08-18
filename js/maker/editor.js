// Template editor: load a background, then drag each slot to where that piece
// of information belongs. Positions are stored as fractions of the canvas, so
// the layout is a property of the template rather than of any one matchup.

import { qs, el, clear, toast, pickFile, field, select, num, text, color, btn } from './ui.js';
import { state, save, tpl, games, newTemplate, makeSlot, preset, LAYOUTS, TOKENS, FONTS } from './store.js';
import { putAsset, dropAsset, IMG, URLS, newId } from './assets.js';
import { draw, context } from './render.js';

let sel = '';          // selected slot id
let onChange = () => {};

export function initEditor(notify) {
  onChange = notify || (() => {});
  qs('#edTpl').addEventListener('change', e => { state.editTpl = e.target.value; sel = ''; save(); paintEditor(); });
  qs('#edNew').addEventListener('click', () => addTemplate());
  qs('#edDup').addEventListener('click', () => dupTemplate());
  qs('#edRename').addEventListener('click', () => renameTemplate());
  qs('#edDefault').addEventListener('click', () => {
    state.defaultTpl = current().id; save(); toast('Default template set'); onChange(); paintEditor();
  });
  qs('#edDelete').addEventListener('click', () => removeTemplate());
  qs('#edBg').addEventListener('click', async () => {
    const files = await pickFile('image/*', true);
    if (files && files.length) importPhotos(files);
  });
  wireDrops();
  qs('#edFit').addEventListener('click', () => fitToImage());
  const lay = qs('#edLayout');
  lay.append(el('option', { value: '' }, 'Apply layout…'));
  LAYOUTS.forEach(([k, lb]) => lay.append(el('option', { value: k }, lb)));
  lay.addEventListener('change', e => {
    const kind = e.target.value;
    e.target.value = '';
    if (!kind) return;
    if (!confirm('Replace this template\'s slots with the stock layout? Anything you have moved or restyled here is lost.')) return;
    current().slots = preset(kind);
    sel = '';
    save(); onChange(); paintEditor();
    toast('Layout applied — drag from here');
  });
  qs('#edAddText').addEventListener('click', () => addSlot('text'));
  qs('#edAddImage').addEventListener('click', () => addSlot('image'));
  qs('#edBoxes').addEventListener('change', e => qs('#edOverlay').classList.toggle('hide', !e.target.checked));
  document.addEventListener('keydown', nudge);
}

const current = () => tpl(state.editTpl);
const slotOf = id => current().slots.find(s => s.id === id);

// Whatever the week actually holds, so the editor previews real names and real
// records rather than lorem ipsum that hides a slot being three sizes too big.
function sample() {
  const g = (games(state.week) || []).find(x => x.a && x.b);
  if (g) return g;
  const [a, b] = state.teams;
  return { a: a ? a.id : '', b: b ? b.id : '', as: null, bs: null, final: false,
    noteA: 'Add a note for this team on the Scores tab',
    noteB: 'Notes wrap and shrink to fit their box' };
}

export function paintEditor() {
  const t = current();
  const pick = qs('#edTpl');
  clear(pick);
  state.templates.forEach(x => pick.append(el('option', { value: x.id, selected: x.id === t.id },
    x.name + (x.id === state.defaultTpl ? '  (default)' : ''))));
  pick.value = t.id;
  qs('#edSize').textContent = `${t.w} x ${t.h}px` +
    (t.bg ? '' : '  ·  no background image yet') + '  ·  ' + clearMargins(t);
  qs('#edDelete').disabled = state.templates.length < 2;

  paintPhotos();
  draw(qs('#edCanvas'), { tplId: t.id, game: sample(), week: state.week });
  paintBoxes();
  paintList();
  paintProps();
}

// How much of each edge no slot touches - the room left for player cutouts
// dropped on in another app. Shown in the footer so it is never a guess.
function clearMargins(t) {
  const live = t.slots.filter(s => !s.hidden);
  if (!live.length) return 'whole canvas clear';
  const left = Math.min(...live.map(s => s.x));
  const right = 1 - Math.max(...live.map(s => s.x + s.w));
  const px = f => Math.round(Math.max(0, f) * t.w);
  return `clear for photos: ${px(left)}px left, ${px(right)}px right`;
}

// ---------- templates ----------

function addTemplate() {
  const name = prompt('Name this template', 'Holiday') || 'Untitled';
  const t = newTemplate(name, 'scoreboard');
  state.templates.push(t);
  state.editTpl = t.id;
  sel = '';
  save(); onChange(); paintEditor();
}

// Duplicating keeps the slots and the background; swapping the picture is one
// click on the photo strip, which is the usual next move for a holiday version.
function dupTemplate() {
  const t = current();
  const copy = JSON.parse(JSON.stringify(t));
  copy.id = newId('tpl');
  copy.name = t.name + ' copy';
  copy.slots.forEach(s => { s.id = newId('slot'); });
  state.templates.push(copy);
  state.editTpl = copy.id;
  save(); onChange(); paintEditor();
  toast('Duplicated — pick its background from the strip');
}

function renameTemplate() {
  const t = current();
  const name = prompt('Template name', t.name);
  if (name) { t.name = name; save(); onChange(); paintEditor(); }
}

function removeTemplate() {
  const t = current();
  if (state.templates.length < 2) return;
  if (!confirm(`Delete the "${t.name}" template?`)) return;
  state.templates = state.templates.filter(x => x.id !== t.id);
  if (state.defaultTpl === t.id) state.defaultTpl = state.templates[0].id;
  state.editTpl = state.templates[0].id;
  save(); onChange(); paintEditor();
}

// ---------- background photos ----------

// Imports go into a library shared by every template rather than straight onto
// the one being edited: the same photo usually wants to be the background of
// more than one template, and re-uploading it each time stores it twice.
export async function importPhotos(files) {
  const list = [...files].filter(f => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|avif|heic|heif)$/i.test(f.name || ''));
  if (!list.length) return toast('Those are not image files');
  let first = '', failed = [];
  for (const file of list) {
    try {
      const id = await putAsset(file);
      state.photos.push({ id, name: (file.name || 'photo').replace(/\.[^.]+$/, '') });
      if (!first) first = id;
    } catch (e) {
      failed.push(e.message);
    }
  }
  if (first) setBackground(first, true);
  save(); onChange(); paintEditor();
  if (failed.length) toast(failed[0]);
  else toast(list.length > 1 ? `Imported ${list.length} photos` : 'Background set');
}

function setBackground(id, silent) {
  const t = current();
  t.bg = id;
  const img = IMG.get(id);
  if (img) { t.w = img.naturalWidth; t.h = img.naturalHeight; }
  save(); onChange(); paintEditor();
  if (!silent) toast('Background set');
}

// Dropping a photo onto the canvas, or pasting one, is how anyone actually
// expects to do this - the file picker is the fallback, not the main route.
function wireDrops() {
  const stage = qs('#edStage');
  ['dragenter', 'dragover'].forEach(ev => stage.addEventListener(ev, e => {
    e.preventDefault();
    stage.classList.add('drop');
  }));
  ['dragleave', 'drop'].forEach(ev => stage.addEventListener(ev, e => {
    e.preventDefault();
    if (ev === 'dragleave' && stage.contains(e.relatedTarget)) return;
    stage.classList.remove('drop');
  }));
  stage.addEventListener('drop', e => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) importPhotos(files);
  });
  document.addEventListener('paste', e => {
    if (!qs('#pane-template').classList.contains('on')) return;
    const files = [...(e.clipboardData ? e.clipboardData.files : [])];
    if (files.length) { e.preventDefault(); importPhotos(files); }
  });
}

function paintPhotos() {
  const bar = clear(qs('#edBgBar'));
  const t = current();
  bar.append(el('div', {
    class: 'bgtile add', title: 'Import background photos',
    onclick: async () => {
      const files = await pickFile('image/*', true);
      if (files && files.length) importPhotos(files);
    },
  }, el('b', {}, '＋ Import photos'), el('i', {}, 'or drop / paste')));

  state.photos.forEach(p => {
    const url = URLS.get(p.id);
    bar.append(el('div', {
      class: 'bgtile' + (t.bg === p.id ? ' on' : ''),
      title: p.name + (t.bg === p.id ? ' (in use here)' : ' — click to use'),
      onclick: () => setBackground(p.id),
    },
      url ? el('img', { src: url, alt: '' }) : el('div', { class: 'nm' }, 'unreadable'),
      el('span', { class: 'nm' }, p.name),
      el('button', {
        class: 'x', title: 'Remove from the library',
        onclick: e => {
          e.stopPropagation();
          if (!confirm(`Remove "${p.name}" from the photo library?`)) return;
          state.photos = state.photos.filter(x => x.id !== p.id);
          state.templates.forEach(x => { if (x.bg === p.id) x.bg = ''; });
          dropAsset(p.id);
          save(); onChange(); paintEditor();
        },
      }, '\u00d7')));
  });
}

// Match the canvas to the picture so nothing is cropped and the export comes
// out at the background's own resolution.
function fitToImage() {
  const t = current();
  const img = t.bg && IMG.get(t.bg);
  if (!img) return toast('Load a background image first');
  t.w = img.naturalWidth;
  t.h = img.naturalHeight;
  save(); onChange(); paintEditor();
}

// ---------- slots ----------

function addSlot(kind) {
  const t = current();
  const s = makeSlot({
    kind, side: 'a', label: kind === 'image' ? 'Logo' : 'Text',
    text: kind === 'image' ? '' : '{{team}}',
    x: .38, y: .45, w: .24, h: .1, size: .07,
  });
  t.slots.push(s);
  sel = s.id;
  save(); paintEditor();
}

function paintList() {
  const list = clear(qs('#edSlots'));
  current().slots.forEach(s => {
    const li = el('li', { class: s.id === sel ? 'sel' : '', onclick: () => { sel = s.id; paintBoxes(); paintList(); paintProps(); } },
      el('span', { class: 'k' }, s.side ? s.side.toUpperCase() : '–'),
      el('span', {}, s.label || s.text || s.kind),
      el('span', { class: 'spacer', style: 'flex:1' }),
      el('button', {
        class: 'eye', title: s.hidden ? 'Hidden' : 'Visible',
        onclick: e => { e.stopPropagation(); s.hidden = !s.hidden; save(); paintEditor(); },
      }, s.hidden ? '○' : '●'));
    list.append(li);
  });
}

// ---------- the overlay: drag, resize, snap ----------

function paintBoxes() {
  const ov = clear(qs('#edOverlay'));
  current().slots.forEach(s => {
    const b = el('div', {
      class: 'sbox' + (s.id === sel ? ' sel' : ''),
      style: `left:${s.x * 100}%;top:${s.y * 100}%;width:${s.w * 100}%;height:${s.h * 100}%`,
      title: s.label || s.kind,
    }, el('span', { class: 'tag' }, s.label || s.kind),
       ...['nw', 'ne', 'sw', 'se'].map(h => el('i', { class: 'h ' + h, 'data-h': h })));
    b.addEventListener('pointerdown', e => startDrag(e, s, b));
    ov.append(b);
  });
}

function startDrag(e, s, node) {
  e.preventDefault();
  sel = s.id;
  paintList(); paintProps();
  document.querySelectorAll('.sbox.sel').forEach(n => n.classList.remove('sel'));
  node.classList.add('sel');

  const stage = qs('#edStage').getBoundingClientRect();
  const handle = e.target.dataset ? e.target.dataset.h : '';
  const from = { x: s.x, y: s.y, w: s.w, h: s.h };
  const ox = e.clientX, oy = e.clientY;
  node.setPointerCapture(e.pointerId);

  const move = ev => {
    let dx = (ev.clientX - ox) / stage.width;
    let dy = (ev.clientY - oy) / stage.height;
    if (ev.shiftKey && !handle) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    if (handle) {
      const west = handle[1] === 'w', north = handle[0] === 'n';
      s.w = Math.max(.02, from.w + (west ? -dx : dx));
      s.h = Math.max(.02, from.h + (north ? -dy : dy));
      if (west) s.x = from.x + from.w - s.w;
      if (north) s.y = from.y + from.h - s.h;
    } else {
      s.x = from.x + dx;
      s.y = from.y + dy;
      if (qs('#edSnap').checked && !ev.altKey) snap(s);
    }
    node.style.left = s.x * 100 + '%'; node.style.top = s.y * 100 + '%';
    node.style.width = s.w * 100 + '%'; node.style.height = s.h * 100 + '%';
    repaintCanvas();
  };
  const up = () => {
    node.removeEventListener('pointermove', move);
    node.removeEventListener('pointerup', up);
    document.querySelectorAll('.guide').forEach(g => g.remove());
    save(); paintProps();
  };
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
}

// Snap to the canvas centre and edges, and to any other slot's edges - the
// symmetry in these graphics is the thing the eye notices when it is off.
const TOL = .006;
function snap(s) {
  document.querySelectorAll('.guide').forEach(g => g.remove());
  const xs = [0, .5 - s.w / 2, 1 - s.w], ys = [0, .5 - s.h / 2, 1 - s.h];
  current().slots.forEach(o => {
    if (o.id === s.id) return;
    xs.push(o.x, o.x + o.w - s.w, o.x + (o.w - s.w) / 2);
    ys.push(o.y, o.y + o.h - s.h, o.y + (o.h - s.h) / 2);
  });
  const hit = (v, list) => list.find(t => Math.abs(v - t) < TOL);
  const nx = hit(s.x, xs), ny = hit(s.y, ys);
  if (nx != null) { s.x = nx; guide('x', s.x); }
  if (ny != null) { s.y = ny; guide('y', s.y); }
}

function guide(axis, at) {
  const g = el('div', {
    class: 'guide',
    style: axis === 'x' ? `left:${at * 100}%;top:0;width:1px;height:100%` : `top:${at * 100}%;left:0;height:1px;width:100%`,
  });
  qs('#edStage').append(g);
}

let raf = 0;
function repaintCanvas() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    draw(qs('#edCanvas'), { tplId: current().id, game: sample(), week: state.week });
  });
}

function nudge(e) {
  if (!sel || !qs('#pane-template').classList.contains('on')) return;
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  const s = slotOf(sel);
  if (!s) return;
  const t = current();
  const step = (e.shiftKey ? 10 : 1);
  const dx = step / t.w, dy = step / t.h;
  const k = { ArrowLeft: [-dx, 0], ArrowRight: [dx, 0], ArrowUp: [0, -dy], ArrowDown: [0, dy] }[e.key];
  if (k) { e.preventDefault(); s.x += k[0]; s.y += k[1]; save(); paintEditor(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSlot(s); }
}

function removeSlot(s) {
  const t = current();
  t.slots = t.slots.filter(x => x.id !== s.id);
  sel = '';
  save(); paintEditor();
}

// A slot and its opposite number should be mirror images across the centre;
// doing that by hand never quite lands, so make it one button.
function mirror(s) {
  const t = current();
  const other = t.slots.find(o => o.id !== s.id && o.side && o.side !== s.side &&
    (o.label || '').replace(/[AB]$/i, '') === (s.label || '').replace(/[AB]$/i, ''));
  const target = other || Object.assign(JSON.parse(JSON.stringify(s)), {
    id: newId('slot'), side: s.side === 'a' ? 'b' : 'a',
    label: (s.label || 'Slot').replace(/\s*[AB]$/i, '') + (s.side === 'a' ? ' B' : ' A'),
  });
  Object.assign(target, {
    y: s.y, w: s.w, h: s.h,
    x: 1 - s.x - s.w,
    size: s.size, font: s.font, color: s.color, stroke: s.stroke, strokeColor: s.strokeColor,
    shadow: s.shadow, shadowColor: s.shadowColor, wrap: s.wrap, caps: s.caps,
    align: s.align === 'left' ? 'right' : s.align === 'right' ? 'left' : 'center',
    valign: s.valign, text: s.text, kind: s.kind, opacity: s.opacity, rotate: -s.rotate,
    hidden: s.hidden,
  });
  if (!other) t.slots.push(target);
  save(); paintEditor();
  toast(other ? 'Mirrored onto ' + (target.label || 'the other side') : 'Mirrored copy added');
}

// ---------- properties ----------

function paintProps() {
  const box = clear(qs('#edProps'));
  const s = slotOf(sel);
  if (!s) { box.append(el('p', { class: 'muted' }, 'Pick a slot to edit it. Drag to move, corners to resize, arrow keys to nudge.')); return; }
  const t = current();
  const upd = () => { save(); paintEditor(); };

  box.append(el('div', { class: 'sect' }));
  box.append(field('Label', text(s.label, v => { s.label = v; save(); paintList(); paintBoxes(); })));
  box.append(field('Belongs to', select([['a', 'Team A (left)'], ['b', 'Team B (right)'], ['', 'Neither']], s.side, v => { s.side = v; upd(); })));

  if (s.kind === 'text') {
    const ta = el('textarea', { rows: 2, oninput: e => { s.text = e.target.value; repaintCanvas(); save(); } }, s.text);
    box.append(field('Text', ta));
    const toks = el('div', { class: 'tokens' });
    TOKENS.forEach(([tok, desc]) => toks.append(el('span', {
      class: 'tok', title: desc,
      onclick: () => { s.text = (s.text || '') + tok; ta.value = s.text; save(); repaintCanvas(); },
    }, tok.replace(/[{}]/g, ''))));
    box.append(toks);

    const fonts = [['team', 'Team’s own typeface']]
      .concat(FONTS.map(f => [f.k, f.lb]))
      .concat((state.fonts || []).map(f => ['custom:' + f.id, f.name + ' (yours)']));
    box.append(field('Typeface', select(fonts, s.font, v => { s.font = v; upd(); })));
    box.append(field('Max size', num(Math.round(s.size * t.h), 1, v => { s.size = v / t.h; upd(); }),
      'px — shrinks automatically to fit the box'));

    const colorKind = s.color === 'team' ? 'team' : s.color === 'accent' ? 'accent' : 'fixed';
    box.append(field('Colour', el('div', { class: 'row' },
      select([['team', 'Team colour'], ['accent', 'Team accent'], ['fixed', 'Pick…']], colorKind,
        v => { s.color = v === 'fixed' ? (s.color.startsWith('#') ? s.color : '#ffffff') : v; upd(); }),
      colorKind === 'fixed' ? color(s.color, v => { s.color = v; upd(); }) : null)));

    box.append(field('Outline', el('div', { class: 'row' },
      num(+(s.stroke * t.h).toFixed(1), .5, v => { s.stroke = v / t.h; upd(); }),
      color(s.strokeColor, v => { s.strokeColor = v; upd(); }))));
    box.append(field('Shadow', el('div', { class: 'row' },
      num(+(s.shadow * 100).toFixed(0), 5, v => { s.shadow = v / 100; upd(); }),
      color(s.shadowColor, v => { s.shadowColor = v; upd(); }))));

    box.append(el('div', { class: 'row' },
      el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: s.wrap, onchange: e => { s.wrap = e.target.checked; upd(); } }), 'Wrap lines'),
      el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: s.caps, onchange: e => { s.caps = e.target.checked; upd(); } }), 'ALL CAPS')));
  }

  box.append(el('div', { class: 'sect' }));
  box.append(field('Align', el('div', { class: 'row' },
    select([['left', 'Left'], ['center', 'Centre'], ['right', 'Right']], s.align, v => { s.align = v; upd(); }),
    select([['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']], s.valign, v => { s.valign = v; upd(); }))));
  box.append(field('Position', el('div', { class: 'row' },
    num(Math.round(s.x * t.w), 1, v => { s.x = v / t.w; upd(); }),
    num(Math.round(s.y * t.h), 1, v => { s.y = v / t.h; upd(); }))));
  box.append(field('Size', el('div', { class: 'row' },
    num(Math.round(s.w * t.w), 1, v => { s.w = v / t.w; upd(); }),
    num(Math.round(s.h * t.h), 1, v => { s.h = v / t.h; upd(); }))));
  box.append(field('Rotate', num(s.rotate || 0, 1, v => { s.rotate = v || 0; upd(); }), 'degrees'));
  box.append(field('Opacity', num(Math.round((s.opacity == null ? 1 : s.opacity) * 100), 5, v => { s.opacity = v / 100; upd(); }), '%'));

  box.append(el('div', { class: 'sect' }));
  box.append(el('div', { class: 'row' },
    btn('Mirror ▸', () => mirror(s), 'sm'),
    btn('Duplicate', () => {
      const c = Object.assign(JSON.parse(JSON.stringify(s)), { id: newId('slot'), x: s.x + .01, y: s.y + .01 });
      t.slots.push(c); sel = c.id; save(); paintEditor();
    }, 'sm'),
    btn('Delete', () => removeSlot(s), 'sm warn')));
}
