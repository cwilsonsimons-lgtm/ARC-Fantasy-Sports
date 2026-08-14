// Prompt export and screenshot import.
//
// Both are "get state out / get state in" panels, which is why they share a
// file. Neither writes to the log directly: prompts are read-only, and an
// imported screenshot lands in the ordinary card or roster box so it gets the
// ordinary preview and the ordinary save button.

import { h, table, chip, plural } from './dom.js';
import { PROMPTS } from '../prompts.js';
import { hasKey, getKey, DEFAULT_MODEL } from '../ingest.js';

// ------------------------------------------------------------------ clipboard

// navigator.clipboard needs a secure context, which a page opened from file://
// is not. The textarea trick still works there, so try the modern path and fall
// back rather than leaving the button dead in the one place it is most used.
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

// ------------------------------------------------------------------ prompts

export function promptsView(state, sel = {}) {
  const id = sel.id || 'next';
  const spec = PROMPTS.find(p => p.id === id) || PROMPTS[2];

  const cards = PROMPTS.map(p => `<button class="promptcard${p.id === id ? ' on' : ''}" data-prompt="${h(p.id)}">
      <div class="nm">${h(p.label)}</div>
      <div class="bl">${h(p.blurb)}</div>
    </button>`).join('');

  let options = '';
  if (spec.needs === 'show') {
    const shows = [...state.shows].reverse();
    options = `<label class="opt">Show
      <select id="promptShow">${shows.map(s =>
        `<option value="${h(s.id)}"${s.id === sel.showId ? ' selected' : ''}>${h(s.name)} — ${h(s.date)}</option>`).join('')}</select>
    </label>`;
  }
  if (spec.needs === 'ple') {
    options = `<label class="opt">Brand
        <select id="promptBrand">
          <option value="">All brands</option>
          ${Object.values(state.brands).map(b =>
            `<option value="${h(b.id)}"${b.id === sel.brandId ? ' selected' : ''}>${h(b.name)}</option>`).join('')}
        </select>
      </label>
      <label class="opt">Event
        <input id="promptPle" type="text" value="${h(sel.ple || 'the next premium live event')}">
      </label>`;
  }

  return `<h2>Prompt export <span class="sub">current state already embedded — copy and paste into any AI</span></h2>
    <div class="promptrow">${cards}</div>
    <div class="card entry" style="margin-top:14px">
      <div class="row" style="margin-top:0">${options}
        <button class="btn" id="promptCopy">Copy to clipboard</button>
        <span class="hint" id="promptSize"></span>
      </div>
      <textarea id="promptText" spellcheck="false" style="min-height:340px" readonly></textarea>
    </div>`;
}

// ------------------------------------------------------------------ import

export function importView(state, ui = {}) {
  const key = hasKey();
  const shots = ui.shots || [];

  const thumbs = shots.length ? `<div class="shots">${shots.map((s, i) => `
    <figure class="shot${i === ui.active ? ' on' : ''}" data-shot="${i}">
      <img src="${s.dataUrl}" alt="">
      <figcaption>${h(s.name)}</figcaption>
    </figure>`).join('')}</div>` : '';

  return `<h2>Screenshots in <span class="sub">drop a card or a roster page — it lands in the normal box, with the normal preview</span></h2>

    <div class="cols">
      <div>
        <div class="card">
          <div id="drop" class="drop">
            <input type="file" id="shotFile" accept="image/*" multiple hidden>
            <div class="big">Drop screenshots here</div>
            <div class="hint">or <button class="linkbtn" id="shotPick">choose files</button> — PNG or JPG, several at once</div>
          </div>
          ${thumbs}
          <div class="row">
            <label class="opt">This is a
              <select id="shotKind">
                <option value="card"${ui.kind === 'roster' ? '' : ' selected'}>show card</option>
                <option value="roster"${ui.kind === 'roster' ? ' selected' : ''}>roster page</option>
              </select>
            </label>
            ${key
              ? `<button class="btn" id="shotRead"${shots.length ? '' : ' disabled'}>Read screenshot</button>`
              : `<button class="btn ghost" id="shotPrompt"${shots.length ? '' : ' disabled'}>Copy transcription prompt</button>`}
          </div>
          ${key ? '' : `<div class="syntax">
            No API key set, so this uses the copy-paste route: copy the prompt, paste it
            into whatever AI you already use <em>along with the screenshot</em>, then paste
            the reply into the box on the right. Works offline and with no key.
          </div>`}
          <details class="keybox">
            <summary>${key ? 'API key is set' : 'Read screenshots automatically'}</summary>
            <div class="hint" style="margin:8px 0">
              With an Anthropic API key the page reads the screenshot itself and fills the box.
              The key is stored in this browser's localStorage under <code>arc_universe_key_v1</code>
              and is sent straight to api.anthropic.com from this page — anyone with access to
              this browser profile can read it. Leave it empty to keep using the copy-paste route.
            </div>
            <div class="row">
              <input type="password" id="apiKey" placeholder="sk-ant-..." value="${h(getKey())}" style="flex:1;min-width:220px">
              <button class="btn ghost" id="apiSave">Save key</button>
              ${key ? '<button class="btn danger" id="apiClear">Remove</button>' : ''}
            </div>
            <div class="hint" style="margin-top:6px">Model: <code>${h(DEFAULT_MODEL)}</code></div>
          </details>
        </div>
      </div>

      <div>
        <div class="card entry">
          <h2>Transcription <span class="sub">paste the reply here, or let the key fill it</span></h2>
          <textarea id="shotText" spellcheck="false" style="min-height:200px"
            placeholder="Raw / 2026-08-17 / Raw&#10;Damian Priest d. Gunther — World Heavyweight Championship&#10;..."></textarea>
          <div class="row">
            <button class="btn" id="shotUse" disabled>Use this</button>
            <button class="btn ghost" id="shotClear">Clear</button>
            <span class="hint" id="shotStatus"></span>
          </div>
          <div id="shotPreview"></div>
        </div>
      </div>
    </div>`;
}

export { PROMPTS };
