// Small shared helpers for the maker's panes.

// Named `qs`/`qsa` rather than the usual `$`/`$$`: esbuild renamed both onto a
// single `var $` when bundling this into dist/maker.html, so every $$ call in
// the built file silently became querySelector and the tabs stopped working.
export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'style') n.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  kids.flat().forEach(k => k != null && n.append(k.nodeType ? k : document.createTextNode(k)));
  return n;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

let toastTimer = 0;
export function toast(msg) {
  const t = qs('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2200);
}

// A file picker that does not need a permanently mounted <input> per button.
export function pickFile(accept, multiple = false) {
  return new Promise(res => {
    const inp = el('input', { type: 'file', accept, multiple, style: 'display:none' });
    inp.addEventListener('change', () => { res(multiple ? [...inp.files] : inp.files[0] || null); inp.remove(); });
    document.body.append(inp);
    inp.click();
  });
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const safeName = s => String(s || '').replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '') || 'untitled';

export function field(label, control, hint) {
  return el('label', { class: 'fld' }, el('span', { class: 'fld-l' }, label), control,
    hint ? el('span', { class: 'fld-h' }, hint) : null);
}

export function select(options, value, onchange) {
  const s = el('select', { onchange: e => onchange(e.target.value) });
  options.forEach(([v, l]) => s.append(el('option', { value: v, selected: String(v) === String(value) }, l)));
  s.value = value;
  return s;
}

export function num(value, step, onchange, attrs = {}) {
  return el('input', Object.assign({
    type: 'number', value, step,
    oninput: e => onchange(parseFloat(e.target.value)),
  }, attrs));
}

export function text(value, onchange, attrs = {}) {
  return el('input', Object.assign({
    type: 'text', value: value == null ? '' : value,
    oninput: e => onchange(e.target.value),
  }, attrs));
}

export function color(value, onchange) {
  return el('input', { type: 'color', value: value || '#ffffff', oninput: e => onchange(e.target.value) });
}

export function btn(label, onclick, cls = '') {
  return el('button', { class: 'btn ' + cls, onclick }, label);
}
