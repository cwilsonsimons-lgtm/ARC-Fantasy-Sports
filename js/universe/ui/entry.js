// Entry panels: type a card, paste a roster.
//
// Both work the same way — you type, and the preview under the box shows what
// the parser heard, updated on every keystroke. Nothing is written until you
// press the button, and the button is disabled while there are errors. Loose
// parsing is only safe if you can see what it decided, so the preview is not a
// nicety here, it is the safety rail.

import { h, table, chip, plural, today } from './dom.js';
import { parseCard } from '../card.js';
import { parseRoster, commitRoster } from '../roster.js';
import { brandName } from './views.js';

const CARD_PLACEHOLDER = `Monday Night Raw / ${today()} / Raw
Damian Priest d. Gunther — World Heavyweight Championship, steel cage
The War Raiders d. Alpha Academy (tag)
Rhea d. Liv (submission)
Seth Rollins d. Sami Zayn, Bron Breakker — triple threat
* Solo Sikoa attacks Cody Rhodes after the main event
Seth Rollins promo on Roman Reigns
injury: Sami Zayn (6 weeks, knee)`;

const ROSTER_PLACEHOLDER = `RAW
Seth Rollins, m, active
Rhea Ripley (female) - active
Trick Williams, m, promotion

SmackDown
Cody Rhodes, male, active
Carmelo Hayes, m, relegation

Free Agents
Kairi Sane, f

Tag Teams
The War Raiders = Erik & Ivar`;

// ------------------------------------------------------------------ card

export function entryView() {
  return `<div class="cols">
    <div class="card entry">
      <h2>Tonight's card <span class="sub">one segment per line</span></h2>
      <textarea id="cardText" spellcheck="false" placeholder="${h(CARD_PLACEHOLDER)}"></textarea>
      <div class="row">
        <button class="btn" id="cardSave" disabled>Save card</button>
        <button class="btn ghost" id="cardClear">Clear</button>
        <button class="btn ghost" id="cardPrompt" title="Copies a prompt telling an AI exactly what format to write in">Copy AI prompt</button>
        <span class="hint"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> saves</span>
      </div>
      <div class="syntax">
        <code>d.</code> <code>def.</code> <code>beat</code> <code>&gt;</code> winner on the left ·
        <code>vs</code> no winner<br>
        <code>&amp;</code> partners, same corner · <code>,</code> another corner (triple threat or worse)<br>
        <code>(...)</code> or after a dash: stipulation, finish, title, note ·
        <code>*</code> starts a non-match segment<br>
        Team names expand to their members. Name a belt and the change of hands is worked out for you.
      </div>
    </div>
    <div class="card">
      <h2>What will be saved <span class="sub">live</span></h2>
      <div id="cardPreview"><div class="empty">Start typing a card on the left.</div></div>
    </div>
  </div>`;
}

export function cardPreview(store, state, text) {
  if (!String(text || '').trim()) return { html: '<div class="empty">Start typing a card on the left.</div>', ok: false };

  const parsed = parseCard(text, store);
  if (parsed.errors.length) {
    return {
      ok: false, parsed,
      html: `<div class="msg err"><strong>${plural(parsed.errors.length, 'problem')} — nothing will be saved</strong>
        <ul>${parsed.errors.map(e => `<li>line ${e.lineNo}: ${h(e.message)}${e.line ? ` <code>${h(e.line.trim())}</code>` : ''}</li>`).join('')}</ul></div>`,
    };
  }

  const nm = ref => (state.wrestlers[ref] ? state.wrestlers[ref].name : ref);
  const rows = parsed.segments.map((s, i) => {
    const side = n => s.participants.filter(p => p.side === n).map(p => nm(p.ref)).join(' & ');
    let what = '', detail = '';
    if (s.type === 'match') {
      const nums = [...new Set(s.participants.map(p => p.side))].sort();
      const win = s.participants.find(p => p.role === 'winner');
      what = win
        ? `<strong>${h(side(win.side))}</strong> def. ${h(nums.filter(n => n !== win.side).map(side).join(', '))}`
        : h(nums.map(side).join(' vs '));
      const t = s.data.titleId ? state.championships[s.data.titleId] : null;
      const shot = s.data.contender && state.championships[s.data.contender];
      // The belt outcome is a button, not a verdict: click it to flip the line
      // between a title change and a defense before anything is saved.
      const outcome = t && !s.data.unify
        ? `<button class="chiplink" data-titletoggle="${s.lineNo}" data-want="${s.data.titleChanged ? 'retain' : 'change'}"
             title="Click to make this a ${s.data.titleChanged ? 'successful defense' : 'title change'}">${
            s.data.titleChanged ? chip('NEW CHAMPION', 'new') : '<span class="dim">defense ⇄</span>'}</button>`
        : (s.data.unify ? chip('UNIFIED', 'new') : '');
      detail = [
        s.data.matchType ? h(s.data.matchType) : '',
        s.data.decision ? h(s.data.decision) : '',
        s.data.interim ? chip('interim', 'new') : '',
        t ? chip(t.name.replace(/ Championship$/, ''), 'title') : '',
        outcome,
        s.data.contender ? `<span class="dim">#1 contender${shot ? `: ${h(shot.name)}` : ''}</span>` : '',
        s.data.note ? `<span class="dim">${h(s.data.note)}</span>` : '',
      ].filter(Boolean).join(' ');
    } else if (s.type === 'save') {
      const from = s.participants.filter(p => p.role === 'attacker').map(p => nm(p.ref));
      what = `<strong>${h(s.participants.filter(p => p.role === 'subject').map(p => nm(p.ref)).join(' & '))}</strong> saves `
        + `${h(s.participants.filter(p => p.role === 'victim').map(p => nm(p.ref)).join(' & '))}`
        + (from.length ? ` from ${h(from.join(' & '))}` : '');
      detail = h(s.data.context || '');
    } else if (s.type === 'thread.open') {
      what = h(s.participants.map(p => nm(p.ref)).join(' & '));
      const about = s.data.about && state.championships[s.data.about];
      detail = `${chip('thread', 'group')} ${h(s.data.text)}${about ? ` ${chip(about.name, 'title')}` : ''}`;
    } else if (s.type === 'title.change') {
      what = h((state.championships[s.data.titleId] || {}).name || s.data.titleId);
      detail = chip(s.data.reason, s.data.reason === 'retired' ? 'down' : 'fa');
    } else if (s.type === 'attack') {
      what = `${h(s.participants.filter(p => p.role === 'attacker').map(p => nm(p.ref)).join(' & '))} attacks <strong>${h(s.participants.filter(p => p.role === 'victim').map(p => nm(p.ref)).join(' & '))}</strong>`;
      detail = h(s.data.context || '');
    } else if (s.type === 'promo') {
      const t = s.participants.filter(p => p.role === 'target').map(p => nm(p.ref));
      what = `${h(s.participants.filter(p => p.role === 'speaker').map(p => nm(p.ref)).join(' & '))} promo${t.length ? ` on ${h(t.join(' & '))}` : ''}`;
      detail = h(s.data.topic || '');
    } else {
      what = h(s.participants.map(p => nm(p.ref)).join(', '));
      detail = h(s.data.description || s.data.weeks ? `${s.data.weeks || ''} ${s.data.description || ''}`.trim() : '');
    }
    return { n: i + 1, type: s.type, what, detail };
  });

  const warn = parsed.warnings.length
    ? `<div class="msg warn"><strong>${plural(parsed.warnings.length, 'line')} not understood</strong>
       <ul>${parsed.warnings.map(w => `<li>line ${w.lineNo}: ${h(w.message)}</li>`).join('')}</ul></div>` : '';

  const titleMoves = parsed.segments.filter(s => s.data && s.data.titleChanged);

  return {
    ok: true, parsed,
    html: `<div class="msg ok"><strong>${h(parsed.show.name)}</strong> · ${h(parsed.show.date)}
        · ${h(brandName(state, parsed.show.brandId) || 'no brand')} · ${plural(parsed.segments.length, 'segment')}
        ${titleMoves.length ? ` · ${plural(titleMoves.length, 'title change')}` : ''}</div>
      ${warn}
      ${table(rows, [
        { label: '#', num: true, get: r => r.n, dim: true },
        { label: 'Type', get: r => r.type, dim: true },
        { label: 'Segment', get: r => r.what, html: true },
        { label: 'Detail', get: r => r.detail, html: true },
      ])}`,
  };
}

// ------------------------------------------------------------------ roster

// Collapsed by default: the tables are what you open this tab to read, and the
// paste box is what you use once after a draft.
export function rosterImportPanel(open = false, { addOnly = false } = {}) {
  return `<details class="card entry" id="rosterPanel" style="margin-bottom:16px"${open ? ' open' : ''}>
    <summary><h2>Paste a roster <span class="sub">one brand at a time — the paste becomes that brand's roster</span></h2></summary>
    <textarea id="rosterText" spellcheck="false" placeholder="${h(ROSTER_PLACEHOLDER)}"></textarea>
    <div class="row">
      <button class="btn" id="rosterSave" disabled>Import roster</button>
      <button class="btn ghost" id="rosterClear">Clear</button>
      <button class="btn ghost" id="rosterPrompt" title="Copies a prompt telling an AI exactly what format to write in">Copy AI prompt</button>
      <label class="opt inline" title="For a deliberately partial paste — half a division, one call-up">
        <input type="checkbox" id="rosterAddOnly"${addOnly ? ' checked' : ''}> only add and update</label>
      <span class="hint">Brand, gender and status in any order; a brand on its own line applies to everyone under it.
        Whoever is on that brand and <em>not</em> in the paste comes off it — the preview names them first.
        Brands you do not paste are untouched.</span>
    </div>
    <div id="rosterPreview"></div>
  </details>`;
}

export function rosterPreview(store, state, text, { addOnly = false } = {}) {
  if (!String(text || '').trim()) return { html: '', ok: false };

  const parsed = parseRoster(text, store);
  if (parsed.errors.length) {
    return {
      ok: false, parsed,
      html: `<div class="msg err" style="margin-top:12px"><strong>${plural(parsed.errors.length, 'problem')} — nothing will be imported</strong>
        <ul>${parsed.errors.map(e => `<li>line ${e.lineNo}: ${h(e.message)}</li>`).join('')}</ul></div>`,
    };
  }

  // A dry run answers the only question that matters: what changes?
  let dry;
  try { dry = commitRoster(store, parsed, { date: today(), dryRun: true, addOnly }); }
  catch (e) { return { ok: false, parsed, html: `<div class="msg err" style="margin-top:12px">${h(e.message)}</div>` }; }

  const s = dry.summary;
  const bits = [];
  const add = (label, rows, fmt) => { if (rows.length) bits.push(`<li><strong>${label} (${rows.length}):</strong> ${rows.map(fmt).join(', ')}</li>`); };
  add('Added', s.added, r => `${h(r.name)} <span class="dim">${h(r.brandName || 'free agent')}</span>`);
  add('Moved', s.moved, r => `${h(r.name)} <span class="dim">${h(r.fromName || 'free agent')} → ${h(r.toName)}</span>`);
  add('Flagged', s.flagged, r => `${h(r.name)} <span class="dim">${h(r.to)}</span>`);
  // The one that can surprise: a paste is the brand's roster, so anybody on it
  // who is missing comes off. Never let that happen silently.
  add('Come off the brand', s.left, r => `${h(r.name)} <span class="dim">was ${h(r.fromName)}</span>`);
  add('Teams formed', s.groupsFormed, r => h(r.name));
  add('Teams changed', s.groupsChanged, r => `${h(r.name)} <span class="dim">+${r.joined}/−${r.left}</span>`);

  const warn = parsed.warnings.length
    ? `<div class="msg warn" style="margin-top:10px"><strong>${plural(parsed.warnings.length, 'warning')}</strong>
        <ul>${parsed.warnings.map(w => `<li>line ${w.lineNo}: ${h(w.message)}</li>`).join('')}</ul></div>` : '';

  if (!bits.length) {
    return { ok: false, parsed, html: `${warn}<div class="msg ok" style="margin-top:10px">Read ${plural(parsed.wrestlers.length, 'wrestler')} — everything already matches. Nothing to write.</div>` };
  }

  // What this paste is claiming to be, brand by brand, so the scope of the
  // sync is on screen before anything is written.
  const scope = !s.brands.length ? ''
    : addOnly
    ? `<div class="dim" style="margin-top:6px">Adding to
        ${s.brands.map(b => `<strong>${h(b.name)}</strong>`).join(', ')} only — nobody comes off.</div>`
    : `<div class="dim" style="margin-top:6px">Read as the full roster of
        ${s.brands.map(b => `<strong>${h(b.name)}</strong> (${b.listed} listed${
          b.leaving ? `, ${b.leaving} coming off` : ''})`).join(', ')}.
        Other brands are untouched.</div>`;

  return {
    ok: true, parsed,
    html: `${warn}<div class="msg ok" style="margin-top:10px">
      <strong>${plural(dry.events.length, 'event')} will be written</strong>
      <ul>${bits.join('')}</ul>
      ${scope}
      ${s.unchanged.length ? `<div class="dim" style="margin-top:6px">${s.unchanged.length} unchanged</div>` : ''}
    </div>`,
  };
}

export { CARD_PLACEHOLDER };
