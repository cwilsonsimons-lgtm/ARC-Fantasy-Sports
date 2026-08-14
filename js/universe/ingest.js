// WWE 2K Universe — screenshots in.
//
// Drop a screenshot of a card or a roster page and get events out. There are
// two routes, because this app has no backend and is meant to work offline from
// a single file:
//
//   BRIDGE (always available, no key, no network)
//     The page builds a transcription prompt with your roster names embedded.
//     You paste it and the screenshot into whatever AI you already use, then
//     paste the reply back. It lands in the normal card/roster box, gets the
//     normal preview, and is saved by the normal path.
//
//   DIRECT (opt-in, needs an Anthropic API key)
//     The page sends the image itself and fills the box for you, so dropping a
//     screenshot is the whole interaction.
//
// Both routes converge on the same place: the model is asked to answer in the
// card shorthand from card.js, so its output goes through the same parser,
// preview and validation as anything typed by hand. A screenshot is never
// trusted straight into the log — you always see the parsed card first.
//
// Not attempted: local OCR. A bundled engine would be megabytes of WASM against
// this repo's no-runtime-dependencies rule, and stylised game UI is exactly
// what generic OCR is worst at. Getting it wrong quietly would be worse than
// asking.

import { CARD_RULES, ROSTER_RULES, knownNames } from './prompts.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_MODEL = 'claude-sonnet-5';
export const KEY_STORE = 'arc_universe_key_v1';

// ------------------------------------------------------------------ prompts

// The format rules live in prompts.js, because the paste boxes need the same
// paragraph — "write me a card in this format" and "read this screenshot and
// write it in this format" differ only in the sentence around them.
export function transcriptionPrompt(state, kind = 'card') {
  const isRoster = kind === 'roster';
  return `Read this screenshot from WWE 2K Universe mode and transcribe ${
    isRoster ? 'the roster it shows' : 'the show card and results it shows'}.

${isRoster ? ROSTER_RULES : CARD_RULES}

${knownNames(state)}

Transcribe only what is visible. If a name is cut off or unreadable, leave that
line out rather than guessing. Output the lines and nothing else — no preamble,
no explanation, no code fences.`;
}

// ------------------------------------------------------------------ replies

// Models like to wrap answers in fences and open with "Here is the card:".
// Strip that back to the lines the parsers want.
export function cleanReply(text) {
  let out = String(text || '').trim();
  const fenced = out.match(/```(?:[a-z]*)\n([\s\S]*?)```/i);
  if (fenced) out = fenced[1];
  return out
    .split(/\r?\n/)
    .filter(l => !/^\s*(here('s| is)|sure|of course|transcription|i've|i have)\b/i.test(l))
    .join('\n')
    .trim();
}

// Which box does this belong in? A card has result verbs; a roster is mostly
// comma-separated lines with a gender in them.
export function detectKind(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const matchy = lines.filter(l => /\s(?:d\.|def\.|defeats?|beat|vs)\s/i.test(l)).length;
  const rostery = lines.filter(l => /,\s*(m|f|male|female)\b/i.test(l)).length;
  if (matchy > rostery) return 'card';
  if (rostery > 0) return 'roster';
  return matchy ? 'card' : null;
}

// ------------------------------------------------------------------ direct call

export const hasKey = () => {
  try { return !!localStorage.getItem(KEY_STORE); } catch (e) { return false; }
};
export const getKey = () => {
  try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; }
};
export const setKey = k => {
  try { k ? localStorage.setItem(KEY_STORE, k) : localStorage.removeItem(KEY_STORE); return true; }
  catch (e) { return false; }
};

const splitDataUrl = dataUrl => {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(dataUrl || ''));
  if (!m) throw new Error('that does not look like an image');
  return { mediaType: m[1], data: m[2] };
};

// Send one screenshot and get shorthand back. `fetchImpl` is injectable so the
// checks can exercise the whole path — request shape included — without a key
// or a network.
export async function readScreenshot({
  dataUrl, prompt, apiKey = getKey(), model = DEFAULT_MODEL,
  fetchImpl = (typeof fetch !== 'undefined' ? fetch : null), maxTokens = 2000,
} = {}) {
  if (!apiKey) throw new Error('no API key set — use the copy-paste route, or add a key in Import ▸ settings');
  if (!fetchImpl) throw new Error('no fetch available in this environment');
  const { mediaType, data } = splitDataUrl(dataUrl);

  const res = await fetchImpl(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Anthropic blocks browser calls unless this opt-in header is present.
      // It is opt-in because it means the key lives in the page.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`the API said ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  const json = await res.json();
  const text = (json.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  if (!text) throw new Error('the model returned nothing to read');
  return { text: cleanReply(text), raw: json };
}

// One screenshot, start to finish: ask, clean, and say which box it belongs in.
export async function ingestScreenshot(state, { dataUrl, kind = 'card', ...opts } = {}) {
  const { text } = await readScreenshot({ dataUrl, prompt: transcriptionPrompt(state, kind), ...opts });
  return { text, kind: detectKind(text) || kind };
}
