// Universe — a search beside the long dropdowns.
//
// Wherever a wrestler or a tag team is picked from a long list - booking a
// match, a team's members, an incident, a relationship, a champion - the
// dropdown gets a search button beside it (ui.js findable). The dropdown stays
// exactly as it was. The search reads the dropdown's own choices, so it
// offers exactly what the dropdown does, and picking a match sets the
// dropdown as if it had been chosen there: its own handler does the rest.
// Nothing here is saved.

const SHOWN = 8;
// case, accents and punctuation don't matter: "rey mys" finds Rey Mysterio, "leon" finds Léon
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = s => norm(s).split(/[^a-z0-9]+/).filter(Boolean);

// the dropdown's choices that match every word typed, best first: the name
// starts with it, then a word in it does, then it's anywhere in the name
function matches(sel, q) {
  const want = words(q);
  if (!want.length) return [];
  const out = [];
  [...sel.options].forEach((o, i) => {
    if (!o.value || o.disabled) return;
    const name = norm(o.textContent), parts = words(o.textContent);
    if (!want.every(w => name.includes(w))) return;
    const rank = name.startsWith(want[0]) ? 0 : parts.some(p => p.startsWith(want[0])) ? 1 : 2;
    out.push({ o, rank, i });
  });
  return out.sort((a, b) => a.rank - b.rank || a.i - b.i);
}

function line(res, text) {
  const d = document.createElement('div');
  d.className = 'uv-findnote';
  d.textContent = text;
  res.append(d);
}

function paint(box) {
  const sel = box.uvSelect, q = box.querySelector('input').value;
  const res = box.querySelector('.uv-findres');
  res.textContent = '';
  if (!words(q).length) { line(res, 'Type part of a name'); return; }
  const list = matches(sel, q);
  if (!list.length) { line(res, 'Nobody by that name in this list'); return; }
  list.slice(0, SHOWN).forEach(({ o }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `uv-findhit${o.value === sel.value ? ' on' : ''}`;
    b.dataset.v = o.value;
    const name = document.createElement('b');
    name.textContent = o.textContent;
    b.append(name);
    const group = o.parentElement && o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : '';
    if (group) { const g = document.createElement('span'); g.textContent = group; b.append(g); }
    b.addEventListener('click', () => pick(box, o.value));
    res.append(b);
  });
  if (list.length > SHOWN) line(res, `${list.length - SHOWN} more — keep typing`);
}

function close(box) {
  if (box.uvButton) box.uvButton.classList.remove('on');
  box.remove();
}
// set the dropdown, as if it had been picked there - its onchange does whatever it does
function pick(box, value) {
  const sel = box.uvSelect;
  close(box);
  if (sel.value === value) return;
  sel.value = value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}

/** The search button beside a dropdown: open a search under it, or close it again. */
export function uvFind(btn) {
  const wrap = btn.closest('.uv-find');
  const sel = wrap && wrap.querySelector('select');
  if (!sel) return;
  const host = wrap.closest('.uv-pick, .uv-f') || wrap;         // under the whole row
  const open = host.nextElementSibling;
  if (open && open.classList.contains('uv-findbox')) { close(open); return; }
  document.querySelectorAll('.uv-findbox').forEach(close);      // one at a time
  const box = document.createElement('div');
  box.className = 'uv-findbox';
  box.uvSelect = sel;
  box.uvButton = btn;
  const input = document.createElement('input');
  input.className = 'uv-in';
  input.type = 'search';
  input.placeholder = 'Search by name';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Search the list');
  const res = document.createElement('div');
  res.className = 'uv-findres';
  box.append(input, res);
  host.after(box);
  btn.classList.add('on');
  input.addEventListener('input', () => paint(box));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {                                    // the best match
      e.preventDefault();
      const first = res.querySelector('.uv-findhit');
      if (first) pick(box, first.dataset.v);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(box);
    }
  });
  paint(box);
  // never scroll to it: in a sheet, a plain focus() can drag the whole app column (see app.js focusField)
  input.focus({ preventScroll: true });
}
