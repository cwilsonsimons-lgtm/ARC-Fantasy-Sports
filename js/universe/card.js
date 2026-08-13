// WWE 2K Universe — show and match-card entry.
//
// This is the part that has to be fast. You have just finished playing a show
// and you want the card into the log in under a minute, so the input is the
// shorthand you would write on paper anyway:
//
//   Raw / 2026-08-17 / Raw
//   Roman Reigns d. Cody Rhodes — WWE Championship, steel cage
//   The Usos d. Judgment Day (tag)
//   Rhea d. Liv (submission)
//   * Solo Sikoa attacks Cody Rhodes after the match
//   Seth Rollins promo on Roman Reigns
//
// Rules worth knowing, and nothing else to remember:
//
//   `d.` `def.` `beat` `over` `>`   winner on the left
//   `vs`                            no winner (draw or no contest)
//   `&` or `+`                      partners — same corner
//   `,`                             another corner — a triple threat or worse
//   `(...)` or after a dash          stipulation, decision, title, free note
//   `*` at the start                 a non-match segment (attack, promo, injury)
//
// Names are matched loosely (see util.js), so "Rhea" and "Liv" land as long as
// they are unambiguous. A tag team or faction name expands to its current
// members, which is why "The Usos d. Judgment Day" is a legal tag match.
//
// Whether a title changed hands is inferred rather than typed: name the belt,
// and if the winner is not the current champion, the card writes a title.change
// alongside the match. `(retains)` or `(new champion)` override the inference.

import { MATCH_TYPES, DECISIONS, entityId } from './schema.js';
import { buildIndex, resolve, norm, table, heading } from './util.js';
import { project } from './project.js';

const DEFEAT = /\s+(?:d\.|def\.|def|defeats?|defeated|beats?|beat|over|pins?|taps?|>)\s+/i;
const VERSUS = /\s+(?:vs\.?|versus|v\.)\s+/i;
const ATTACK = /\s+(?:attacks?|attacked|jumps?|jumped|assaults?|ambushes?|lays? out|beats? down|turns? on)\s+/i;
const SAVE = /\s+(?:saves?|saved|makes? the save for|runs? out to help|rescues?)\s+/i;
const PROMO = /\s+(?:cuts? a promo on|promo on|promo|calls? out|confronts?|interrupts?)\s*/i;
const DATE_ANY = /\b(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/;

const clean = s => String(s || '').trim().replace(/\s+/g, ' ');

// Segment lines trail off into prose — "after the main event", "backstage",
// "to close the show". Names stop at the first of these words; everything from
// there on is kept as context rather than fed to the resolver.
const PROSE = /\s+(?:after|before|during|later|then|backstage|post-?match|pre-?show|to close|to open|in the|on the|at the)\b.*$/i;
function stripProse(text) {
  const t = clean(text);
  const m = PROSE.exec(t);
  return m ? { body: clean(t.slice(0, m.index)), prose: clean(m[0]) } : { body: t, prose: null };
}

// ------------------------------------------------------------------ dates

// Accepts 2026-08-17, 2026-8-7 and 8/17/2026; anything else is rejected rather
// than guessed at.
export function parseDate(text, fallbackYear = new Date().getFullYear()) {
  const t = clean(text);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : String(fallbackYear);
    return `${y}-${pad2(m[1])}-${pad2(m[2])}`;
  }
  return null;
}
const pad2 = n => String(n).padStart(2, '0');

// ------------------------------------------------------------------ parsing

export function parseCard(text, store, { date = null, brandId = null, showName = null } = {}) {
  const state = project(store);
  const idx = {
    wrestler: buildIndex(store, 'wrestler'),
    group: buildIndex(store, 'group'),
    brand: buildIndex(store, 'brand'),
    championship: buildIndex(store, 'championship'),
  };

  const errors = [], warnings = [];
  const show = { name: showName, date, brandId, note: '' };
  const segments = [];
  const lines = String(text || '').split(/\r?\n/);
  let headerSeen = false;

  const fail = (lineNo, line, message) => errors.push({ lineNo, line, message });
  const warn = (lineNo, line, message) => warnings.push({ lineNo, line, message });

  // A corner is one side of a match: "Jey Uso & Jimmy Uso" or "The Usos".
  const corner = (text, lineNo, line) => {
    const refs = [];
    splitPartners(text).forEach(nm => {
      const w = resolve(idx.wrestler, nm);
      if (w.ok) { refs.push(w.id); return; }
      // Only fall through to team names when the name matched no wrestler at
      // all. A name that matched several must not quietly resolve to a group
      // that happens to contain the word — "Uso" is a question, not an answer.
      if (w.reason === 'ambiguous') {
        fail(lineNo, line, `"${nm}" matches ${w.candidates.join(', ')} — type more of the name`);
        return;
      }
      const g = resolve(idx.group, nm);
      if (g.ok) {
        const members = (state.groups[g.id] || {}).members || [];
        if (members.length) { members.forEach(m => refs.push(m)); return; }
        fail(lineNo, line, `"${nm}" is a group with no current members`);
        return;
      }
      fail(lineNo, line, w.reason === 'ambiguous'
        ? `"${nm}" matches ${w.candidates.join(', ')} — type more of the name`
        : `unknown name "${nm}"${w.candidates && w.candidates.length ? ` (did you mean ${w.candidates.join(', ')}?)` : ''}`);
    });
    return refs;
  };

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    let line = raw.trim();
    if (!line || /^([-=_]{3,}|\/\/)/.test(line)) return;

    const starred = /^\*\s*/.test(line);
    line = line.replace(/^\*\s*/, '').replace(/^\d+[.)]\s*/, '').trim();
    if (!line) return;

    // -- header ------------------------------------------------------------
    if (!headerSeen && !DEFEAT.test(line) && !VERSUS.test(line) && !ATTACK.test(line) && !starred) {
      const parsed = parseHeader(line, idx, state);
      if (parsed) {
        headerSeen = true;
        show.name = show.name || parsed.name;
        show.date = show.date || parsed.date;
        show.brandId = show.brandId || parsed.brandId;
        return;
      }
    }

    if (/^note\s*:/i.test(line)) { show.note = clean(line.replace(/^note\s*:/i, '')); return; }

    // -- non-match segments -------------------------------------------------
    const seg = parseSegment(line, { corner, idx, lineNo, raw, fail, warn });
    if (seg) { segments.push(seg); return; }

    // -- matches -------------------------------------------------------------
    if (DEFEAT.test(line) || VERSUS.test(line)) {
      const m = parseMatch(line, { corner, idx, state, lineNo, raw, fail, warn });
      if (m) segments.push(m);
      return;
    }

    warn(lineNo, raw, 'could not read this line — no result verb (d. / def. / vs) and no segment keyword');
  });

  if (!show.date) errors.unshift({ lineNo: 1, line: lines[0] || '', message: 'no show date — start the card with "Name / YYYY-MM-DD / Brand"' });
  if (!show.name) show.name = show.brandId && state.brands[show.brandId] ? state.brands[show.brandId].name : 'Show';

  return { show, segments, errors, warnings };
}

// "Raw / 2026-08-17 / Raw", "Monday Night Raw — 2026-08-17", "8/17 Raw"
function parseHeader(line, idx, state) {
  const dateHit = DATE_ANY.exec(line);
  if (!dateHit) return null;
  const date = parseDate(dateHit[1]);
  if (!date) return null;
  const rest = line.replace(dateHit[0], ' ').replace(/^\s*show\s*:/i, ' ');
  const parts = rest.split(/\s*[\/|,]\s*|\s+[-–—]+\s+/).map(clean).filter(Boolean);
  let brandId = null, name = null;
  parts.forEach(p => {
    const b = resolve(idx.brand, p);
    if (b.ok && !brandId) brandId = b.id;
    else if (!name) name = p;
  });
  if (!name && brandId) name = state.brands[brandId] ? state.brands[brandId].name : null;
  return { name, date, brandId };
}

function parseSegment(line, ctx) {
  const { corner, lineNo, raw, warn } = ctx;

  // "Sami Zayn saves Jey Uso from Solo Sikoa" — checked before the attack verb,
  // since a save line usually names the attack it broke up.
  if (SAVE.test(line)) {
    const [a, b] = line.split(SAVE);
    const tail = trailing(b);
    const from = /\s+from\s+/i.test(tail.body) ? tail.body.split(/\s+from\s+/i) : [tail.body, ''];
    const saved = stripProse(from[0]);
    const attacker = stripProse(from[1] || '');
    return {
      type: 'save',
      participants: [
        ...corner(stripProse(a).body, lineNo, raw).map(ref => ({ ref, role: 'subject' })),
        ...corner(saved.body, lineNo, raw).map(ref => ({ ref, role: 'victim' })),
        ...(attacker.body ? corner(attacker.body, lineNo, raw).map(ref => ({ ref, role: 'attacker' })) : []),
      ],
      data: { context: [tail.note, saved.prose].filter(Boolean).join(' · ') || null },
      text: clean(line),
    };
  }

  if (ATTACK.test(line)) {
    const [a, b] = line.split(ATTACK);
    const tail = trailing(b);
    const victims = stripProse(tail.body);
    return {
      type: 'attack',
      participants: [
        ...corner(stripProse(a).body, lineNo, raw).map(ref => ({ ref, role: 'attacker' })),
        ...corner(victims.body, lineNo, raw).map(ref => ({ ref, role: 'victim' })),
      ],
      data: { context: [tail.note, victims.prose].filter(Boolean).join(' · ') || null },
      text: clean(line),
    };
  }

  if (PROMO.test(line) || /^promo\s*:/i.test(line)) {
    const body = line.replace(/^promo\s*:\s*/i, '');
    const [a, b = ''] = body.split(PROMO);
    const tail = trailing(b);
    const t = stripProse(tail.body);
    const targets = t.body ? corner(t.body, lineNo, raw) : [];
    return {
      type: 'promo',
      participants: [
        ...corner(stripProse(a).body, lineNo, raw).map(ref => ({ ref, role: 'speaker' })),
        ...targets.map(ref => ({ ref, role: 'target' })),
      ],
      data: { topic: [tail.note, t.prose].filter(Boolean).join(' · ') || null },
      text: clean(line),
    };
  }

  const inj = /^injur(?:y|ed)\s*:?\s*(.+)$/i.exec(line) || /^(.+?)\s+is\s+injured\b(.*)$/i.exec(line);
  if (inj) {
    const tail = trailing(inj[1] + (inj[2] || ''));
    const weeks = /(\d+)\s*weeks?/i.exec(tail.note || '');
    const refs = corner(tail.body, lineNo, raw);
    if (!refs.length) return null;
    return {
      type: 'injury',
      participants: refs.map(ref => ({ ref, role: 'subject' })),
      data: { weeks: weeks ? +weeks[1] : null, description: tail.note || null, severity: severityOf(tail.note) },
      text: clean(line),
    };
  }

  const cleared = /^(?:cleared|returns?)\s*:?\s*(.+)$/i.exec(line);
  if (cleared) {
    const refs = corner(trailing(cleared[1]).body, lineNo, raw);
    if (!refs.length) return null;
    return { type: 'injury.cleared', participants: refs.map(ref => ({ ref, role: 'subject' })), data: {}, text: clean(line) };
  }

  const vac = /^(vacate[ds]?|strip(?:ped)?|retire[ds]?)\s*:?\s*(.+)$/i.exec(line);
  if (vac) {
    const t = resolve(ctx.idx.championship, clean(vac[2]));
    if (!t.ok) { warn(lineNo, raw, `unknown championship "${vac[2]}"`); return null; }
    const reason = /^strip/i.test(vac[1]) ? 'stripped' : /^retire/i.test(vac[1]) ? 'retired' : 'vacated';
    return { type: 'title.change', participants: [], data: { titleId: t.id, reason }, text: clean(line) };
  }

  // "promise: Cody Rhodes — WWE Championship" opens a title-shot thread.
  // The dash separates the wrestler from what they were promised, so these two
  // deliberately skip trailing(), which would swallow the second half as a note.
  const promise = /^promise[ds]?\s*:\s*(.+)$/i.exec(line);
  if (promise) {
    const parts = promise[1].split(/\s*[-–—>]+\s*|\s+for\s+the\s+|\s+at\s+the\s+/i).map(clean).filter(Boolean);
    const who = corner(parts[0], lineNo, raw);
    if (!who.length) return null;
    const rest = parts.slice(1).join(' — ');
    const belt = rest ? resolve(ctx.idx.championship, rest) : { ok: false };
    return {
      type: 'thread.open',
      participants: who.map(ref => ({ ref, role: 'subject' })),
      data: {
        threadKind: belt.ok ? 'title-shot' : 'promise',
        about: belt.ok ? belt.id : null,
        text: belt.ok ? 'promised a title shot' : (rest || 'was promised something'),
      },
      text: clean(line),
    };
  }

  // "thread: Jey Uso & Roman Reigns — the story is not over"
  const thread = /^(?:thread|open)\s*:\s*(.+)$/i.exec(line);
  if (thread) {
    const parts = thread[1].split(/\s*[-–—]+\s*/).map(clean).filter(Boolean);
    const who = corner(parts[0], lineNo, raw);
    if (!who.length) return null;
    return {
      type: 'thread.open',
      participants: who.map(ref => ({ ref, role: 'subject' })),
      data: { threadKind: 'promise', text: parts.slice(1).join(' — ') || 'unfinished business' },
      text: clean(line),
    };
  }

  return null;
}

function parseMatch(line, ctx) {
  const { corner, idx, state, lineNo, raw, fail } = ctx;
  const tail = trailing(line);
  const body = tail.body;
  const mods = parseModifiers(tail.note, idx, state);

  let winnerSide = null, halves;
  if (DEFEAT.test(body)) {
    const bits = body.split(DEFEAT);
    if (bits.length > 2) { fail(lineNo, raw, 'more than one result verb on this line'); return null; }
    halves = bits;
    winnerSide = 1;
  } else {
    halves = body.split(VERSUS);
  }

  const participants = [];
  let side = 0;
  const cornersOf = half => half.split(/\s*,\s*/).map(clean).filter(Boolean);

  const winnerCorners = cornersOf(halves[0]);
  if (winnerSide && winnerCorners.length > 1) {
    fail(lineNo, raw, 'the winning side has a comma in it — use "&" for partners, or list the losers after the verb');
    return null;
  }

  halves.forEach((half, hi) => {
    cornersOf(half).forEach(c => {
      side += 1;
      const refs = corner(c, lineNo, raw);
      refs.forEach(ref => participants.push({
        ref, side,
        role: winnerSide && hi === 0 ? 'winner' : winnerSide ? 'loser' : 'competitor',
      }));
    });
  });

  if (participants.length < 2) return null;
  const sides = new Set(participants.map(p => p.side));
  if (sides.size < 2) { fail(lineNo, raw, 'a match needs two sides'); return null; }

  const dupes = participants.map(p => p.ref).filter((r, i, a) => a.indexOf(r) !== i);
  if (dupes.length) {
    fail(lineNo, raw, `${[...new Set(dupes)].map(d => (state.wrestlers[d] || {}).name || d).join(', ')} appears on both sides`);
    return null;
  }

  const data = {
    matchType: mods.matchType || inferType(participants),
    decision: mods.decision || (winnerSide ? null : 'no contest'),
    titleId: mods.titleId || null,
  };
  if (mods.note) data.note = mods.note;

  // A number-one contender match names the belt but is not for it. Move the
  // title onto `contender` so the match does not read as a title match — it
  // opens a title-shot thread instead.
  if (mods.contender) {
    data.contender = data.titleId || true;
    data.titleId = null;
  }

  // Did the belt move? The author's override wins; otherwise compare the
  // winning corner against whoever is holding it — the interim champion when
  // this is an interim match, the real one otherwise.
  if (data.titleId) {
    const champ = state.championships[data.titleId];
    const winners = participants.filter(p => p.role === 'winner').map(p => p.ref).sort();
    if (mods.interim) data.interim = true;
    if (mods.unify) data.unify = true;

    if (!winnerSide) {
      data.titleVacated = !!mods.vacated;
    } else if (mods.unify) {
      data.titleChanged = true;                       // unification always ends somewhere new
    } else if (mods.titleChanged != null) {
      data.titleChanged = mods.titleChanged;
    } else {
      const held = [...((champ ? (mods.interim ? champ.interimHolders : champ.holders) : []) || [])].sort();
      data.titleChanged = held.join() !== winners.join();
    }
    if (data.titleChanged && champ && !champ.holders.length && !mods.interim) data.newChampionOfVacant = true;
  }

  return { type: 'match', participants, data, text: clean(line) };
}

// Everything after the last spaced dash, plus any parenthesised or bracketed
// chunks, is modifier text rather than names.
function trailing(text) {
  const notes = [];
  let body = String(text || '').replace(/[([]([^)\]]*)[)\]]/g, (_, inner) => { notes.push(inner); return ' '; });
  const dash = body.split(/\s+[-–—]{1,2}\s+/);
  if (dash.length > 1) { notes.push(dash.slice(1).join(' - ')); body = dash[0]; }
  return { body: clean(body), note: clean(notes.join(', ')) || null };
}

function parseModifiers(note, idx, state) {
  const out = {
    matchType: null, decision: null, titleId: null, titleChanged: null,
    vacated: false, interim: false, unify: false, contender: false, note: null,
  };
  if (!note) return out;
  const leftovers = [];

  note.split(/\s*[,;]\s*/).map(clean).filter(Boolean).forEach(tok => {
    const n = norm(tok);
    if (!n) return;
    if (n === 'c' || n === 'champion') return;
    if (/^(new champion|title change|new champ|and new)$/.test(n)) { out.titleChanged = true; return; }
    if (/^(retains?|retained|successful defense|defense|and still)$/.test(n)) { out.titleChanged = false; return; }
    if (/^(vacant|vacated|held up)$/.test(n)) { out.vacated = true; return; }
    if (/^(interim|interim title|for the interim)$/.test(n)) { out.interim = true; return; }
    if (/^(unify|unified|unification|winner takes all|undisputed)$/.test(n)) { out.unify = true; return; }
    if (/^(contender|number one contender|no 1 contender|1 contender|top contender|eliminator)$/.test(n)) { out.contender = true; return; }

    const dec = DECISIONS.find(d => n === d || n === d.replace(/\s/g, ''));
    if (dec) { out.decision = dec; return; }
    if (n === 'nc' || n === 'no contest') { out.decision = 'no contest'; return; }
    if (n === 'dq' || n === 'disqualification') { out.decision = 'dq'; return; }
    if (n === 'count out' || n === 'countout' || n === 'co') { out.decision = 'countout'; return; }

    const titled = /^(?:for the|title|for|belt)\s*:?\s*(.+)$/i.exec(tok);
    const cand = titled ? clean(titled[1]) : tok;
    const t = resolve(idx.championship, cand);
    if (t.ok && (titled || /title|championship|belt/i.test(cand) || ['id', 'exact'].includes(t.how))) { out.titleId = t.id; return; }

    const type = MATCH_TYPES.find(mt => n === mt || n === mt + ' match' || n.replace(/ match$/, '') === mt);
    if (type) { out.matchType = type; return; }
    if (/match$/.test(n)) { out.matchType = n.replace(/\s*match$/, ''); return; }

    leftovers.push(tok);
  });

  out.note = leftovers.join(', ') || null;
  return out;
}

function inferType(participants) {
  const bySide = new Map();
  participants.forEach(p => bySide.set(p.side, (bySide.get(p.side) || 0) + 1));
  const sides = [...bySide.values()];
  if (sides.length > 4) return 'battle royal';
  if (sides.length === 4) return sides.every(n => n === 1) ? 'fatal four-way' : 'tag';
  if (sides.length === 3) return sides.every(n => n === 1) ? 'triple threat' : 'tag';
  const max = Math.max(...sides);
  if (max === 1) return 'singles';
  if (max === 2) return 'tag';
  if (max === 3) return 'six-man tag';
  return 'tag';
}

const splitPartners = s => String(s || '').split(/\s*[&+]\s*|\s+and\s+/i).map(clean).filter(Boolean);

function severityOf(note) {
  const n = norm(note);
  if (/career|retire/.test(n)) return 'career';
  if (/major|severe|surgery|torn|acl|out for the year/.test(n)) return 'major';
  if (/minor|tweak|bruise/.test(n)) return 'minor';
  return null;
}

// ------------------------------------------------------------------ commit

// Write the whole card as one batch: a show event, then a segment per line, then
// a title.change for every belt that moved. Ids are assigned up front so a
// title change can point back at the match that caused it.
export function commitCard(store, parsed, { dryRun = false, source = 'card-entry' } = {}) {
  if (parsed.errors.length) {
    const e = new Error(`card has ${parsed.errors.length} error(s) — nothing was saved`);
    e.errors = parsed.errors;
    throw e;
  }

  const { show, segments } = parsed;
  let seq = store.doc.meta.seq;
  const nextId = type => `${type === 'show' ? 'sh' : 'ev'}_${String(seq += 1).padStart(4, '0')}`;

  const showEvent = {
    id: nextId('show'), type: 'show', date: show.date, source,
    participants: [], note: show.note || '',
    data: { name: show.name, brandId: show.brandId || null },
  };
  const showId = showEvent.id;
  const batch = [showEvent];

  segments.forEach((seg, i) => {
    const ev = {
      id: nextId(seg.type), type: seg.type, date: show.date, showId, cardOrder: i + 1,
      participants: seg.participants, data: seg.data, source, note: seg.text || '',
    };
    batch.push(ev);

    // A title won in a match is NOT also written as a separate title.change.
    // The match already carries the title.award effect, and one event with one
    // set of consequences is the whole point: correct the winner and the reign
    // moves with it. A second linked event would survive that correction and
    // leave the belt on the wrong wrestler. The standalone title.change type is
    // for changes that happen outside a match — vacancies, off-screen awards.
  });

  if (dryRun) return { showId, events: batch, written: 0 };
  const written = store.appendBatch(batch);
  store.save();
  return { showId, events: written, written: written.length };
}

// ------------------------------------------------------------------ read-back

// The card as it will be saved — always print this before committing, because
// the whole point of loose parsing is that you check what it heard.
export function renderCard(parsed, store, state = null) {
  const st = state || project(store);
  const nm = ref => (st.wrestlers[ref] ? st.wrestlers[ref].name : ref);
  const brand = st.brands[parsed.show.brandId];
  const out = [heading(`${parsed.show.name}  —  ${parsed.show.date}${brand ? `  —  ${brand.name}` : ''}`)];

  const rows = parsed.segments.map((s, i) => {
    const side = n => s.participants.filter(p => p.side === n).map(p => nm(p.ref)).join(' & ');
    let what = '', extra = '';
    if (s.type === 'match') {
      const nums = [...new Set(s.participants.map(p => p.side))].sort();
      const win = s.participants.find(p => p.role === 'winner');
      what = win
        ? `${side(win.side)} def. ${nums.filter(n => n !== win.side).map(side).join(', ')}`
        : `${nums.map(side).join(' vs ')}`;
      const t = s.data.titleId ? (st.championships[s.data.titleId] || {}).name : null;
      const belt = t && `${s.data.interim ? 'interim ' : ''}${t}${
        s.data.unify ? ' — UNIFIED' : s.data.titleChanged ? ' — NEW CHAMPION' : s.data.titleVacated ? ' — VACATED' : ' (defense)'}`;
      const shot = s.data.contender && `#1 contender${s.data.contender !== true && st.championships[s.data.contender] ? `: ${st.championships[s.data.contender].name}` : ''}`;
      extra = [s.data.matchType, s.data.decision, belt, shot, s.data.note].filter(Boolean).join(' · ');
    } else if (s.type === 'save') {
      const from = s.participants.filter(p => p.role === 'attacker').map(p => nm(p.ref));
      what = `${s.participants.filter(p => p.role === 'subject').map(p => nm(p.ref)).join(' & ')} saves `
        + `${s.participants.filter(p => p.role === 'victim').map(p => nm(p.ref)).join(' & ')}`
        + (from.length ? ` from ${from.join(' & ')}` : '');
      extra = s.data.context || '';
    } else if (s.type === 'thread.open') {
      what = `${s.participants.map(p => nm(p.ref)).join(' & ')}`;
      extra = `thread: ${s.data.text}${s.data.about && st.championships[s.data.about] ? ` (${st.championships[s.data.about].name})` : ''}`;
    } else if (s.type === 'title.change') {
      what = `${(st.championships[s.data.titleId] || {}).name || s.data.titleId}`;
      extra = s.data.reason;
    } else if (s.type === 'attack') {
      what = `${s.participants.filter(p => p.role === 'attacker').map(p => nm(p.ref)).join(' & ')} attacks ${s.participants.filter(p => p.role === 'victim').map(p => nm(p.ref)).join(' & ')}`;
      extra = s.data.context || '';
    } else if (s.type === 'promo') {
      const t = s.participants.filter(p => p.role === 'target').map(p => nm(p.ref));
      what = `${s.participants.filter(p => p.role === 'speaker').map(p => nm(p.ref)).join(' & ')} promo${t.length ? ` on ${t.join(' & ')}` : ''}`;
      extra = s.data.topic || '';
    } else {
      what = `${s.participants.map(p => nm(p.ref)).join(', ')}`;
      extra = s.data.description || s.data.reason || '';
    }
    return { n: i + 1, type: s.type, what, extra };
  });

  out.push(table(rows, [
    { label: '#', align: 'right', get: r => r.n },
    { label: 'Type', get: r => r.type },
    { label: 'Segment', get: r => r.what },
    { label: 'Detail', get: r => r.extra },
  ], { indent: '  ' }));

  if (parsed.warnings.length) {
    out.push(heading('Warnings'));
    parsed.warnings.forEach(w => out.push(`  line ${w.lineNo}: ${w.message}`));
  }
  return out.join('\n');
}

export { splitPartners, trailing, parseModifiers, entityId };
