// Universe — Tiers & transfers: the settings behind promotion and relegation.
//
// Shows sit in tiers, top down - tier 1 is the main roster. Between each tier
// and the one below it is a connection with its own rules: relegation
// matches (on or off, how many candidates, when losers move and to which
// show), qualifying matches, what happens to the lower tier's champions, what
// happens to a title when its holder moves up, and when and where wrestlers
// move up. Nothing about NXT or Evolve is written into the code - it's all
// here, and a new tier gets a connection of its own.
//
// Every change is saved as it's made. A season transition already under way
// keeps the tiers and rules it started with, so the rules here are for the
// next one. Rules the app doesn't carry out yet are kept, and marked.
import * as M from './model.js';
import { ICON, esc, field, options, select, showColor } from './ui.js';
import { closeSheet, commit, confirmThen, openSheet, pushPage, uni } from './app.js';

export function uvOpenTiers() { pushPage('tiers', 'all'); }

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const showList = (st, ids, and = 'and') => {
  const ns = ids.map(id => (M.showById(st, id) || { name: '?' }).name);
  return ns.length < 3 ? ns.join(` ${and} `) : `${ns.slice(0, -1).join(', ')} ${and} ${ns[ns.length - 1]}`;
};
const tierNo = (st, t) => st.tiers.indexOf(t) + 1;

// ================================================================ rules in words

const TIMING = { result: 'right away, on the result', window: 'at the transfer window' };
const CHAMPS = { eligible: 'draft eligible', automatic: 'move up by themselves at the transfer window', none: 'stay where they are' };
const TITLES = { ask: 'your call at each move', vacate: 'vacated', keep: 'kept — they defend it on their new show' };

/** A connection's rules, line by line: [{ dir, label, text, off, pending }]. `up`/`low` are tiers, or a transition part's names and shows. */
function ruleLines(st, rules, up, low) {
  const r = rules;
  const pending = M.pendingRules(r);
  const lines = [];
  lines.push({ dir: 'down', label: 'Relegation', off: !r.relegation.on, pending: r.relegation.on && r.relegation.timing === 'window',
    text: r.relegation.on
      ? `after WrestleMania, the ${r.relegation.candidates} with the fewest wins on each of ${showList(st, up.shows, 'and') || 'its shows'} face each other; losers go down to ${(M.showById(st, r.relegation.to) || { name: '?' }).name} ${TIMING[r.relegation.timing]}`
      : 'off' });
  lines.push({ dir: 'up', label: 'Qualifying matches', off: !r.qualifiers.on, pending: r.qualifiers.on && r.promotion.timing === 'result',
    text: r.qualifiers.on ? `on ${showList(st, low.shows, 'or') || 'its shows'} after WrestleMania; winners ${r.promotion.timing === 'result' ? 'move up straight away' : 'become draft eligible'}` : 'off' });
  lines.push({ dir: 'up', label: `${low.name} champions`, off: r.champions === 'none', pending: r.champions === 'automatic', text: CHAMPS[r.champions] });
  lines.push({ dir: 'up', label: 'Their titles', off: false, pending: false, text: TITLES[r.titles] });
  const to = r.promotion.to ? (M.showById(st, r.promotion.to) || { name: '?' }).name : `your pick of ${showList(st, up.shows, 'or') || 'its shows'} — the draft`;
  lines.push({ dir: 'up', label: 'Moving up to', off: false, pending: false, text: to });
  return { lines, pending };
}
function linesHTML(st, rules, up, low) {
  const { lines, pending } = ruleLines(st, rules, up, low);
  return `<div class="uv-rules">${lines.map(l => `<div class="${l.off ? 'off' : ''}${l.pending ? ' pend' : ''}">
      <span class="d">${l.dir === 'down' ? ICON.down : ICON.up}</span><b>${esc(l.label)}</b><span class="x">${esc(l.text)}</span></div>`).join('')}</div>
    ${pending.length ? `<div class="uv-flag"><span>Not carried out yet: ${esc(pending.join('; '))}. The rule is kept, and the transition page lists who
      it would move — for now, nobody moves by it.</span></div>` : ''}`;
}
export { linesHTML as uvRuleLines };

// ================================================================ the page

export function uvTiersPage() {
  const st = uni();
  const inNone = st.shows.filter(s => !M.tierOfShow(st, s.id));
  const count = id => st.wrestlers.filter(w => w.showId === id).length;
  const tierOpts = cur => options([...st.tiers.map((t, i) => [t.id, `Tier ${i + 1} · ${t.name}`]), ['', 'No tier']], cur || '');
  const showRow = s => `<div class="uv-trow" data-show="${s.id}">
      <span class="uv-dot" style="--c:${showColor(st, s.id)}"></span>
      <div class="uv-main" onclick="uvShowSheet('${s.id}')"><div class="nm">${esc(s.name)}</div>
        <div class="sub">${plural(count(s.id), 'wrestler')} · ${M.DAYS[s.day]}s</div></div>
      ${select(`uvShowTier('${s.id}',this.value)`, tierOpts((M.tierOfShow(st, s.id) || {}).id), ` data-tier-of="${s.id}" aria-label="Tier"`)}
    </div>`;
  const tierCard = (t, i) => {
    const lower = i > 0;
    return `<div class="uv-tier" data-tier="${t.id}">
      <div class="h"><span class="no">Tier ${i + 1}</span><b onclick="uvTierRename('${t.id}')">${esc(t.name)}</b>
        <span class="sp"></span>
        ${lower && i > 1 ? `<div class="uv-ic mv" title="Move up" onclick="uvTierMove('${t.id}',-1)">${ICON.up}</div>` : ''}
        ${lower && i < st.tiers.length - 1 ? `<div class="uv-ic mv" title="Move down" onclick="uvTierMove('${t.id}',1)">${ICON.down}</div>` : ''}
        <div class="uv-ic mv" title="Rename" onclick="uvTierRename('${t.id}')">${ICON.edit}</div>
        ${lower ? `<div class="uv-ic mv" title="Remove" onclick="uvTierRemove('${t.id}')">${ICON.x}</div>` : ''}</div>
      ${t.shows.length ? M.tierShows(st, t).map(showRow).join('') : `<div class="uv-none">No shows yet — add one below, or move one here.</div>`}
      ${i === 0 ? '<div class="fine">The main roster. It stays at the top, and always has at least one show.</div>' : ''}
    </div>`;
  };
  const linkCard = (l, i) => {
    const up = M.tierById(st, l.upper), low = M.tierById(st, l.lower);
    return `<div class="uv-conn" data-link="${l.id}">
      <div class="h">${ICON.move}<div><b>Tier ${i + 1} ⇄ Tier ${i + 2}</b><span>${esc(up.name)} and ${esc(low.name)}</span></div></div>
      ${linesHTML(st, l.rules, up, low)}
      <div class="uv-btn full" onclick="uvLinkRules('${l.id}')">${ICON.edit}Edit the rules</div>
    </div>`;
  };
  const links = M.activeLinks(st);
  const live = st.transitions.find(t => !(t.window && t.window.closed));
  return {
    title: 'Tiers & transfers',
    body: `
      <div class="uv-storyhead">
        <div class="k">Tiers & transfers</div>
        <p>Shows sit in tiers, top down. Between each tier and the one below it are the rules for moving down (relegation) and
          up (qualifying, champions, the draft). Nothing here moves anyone — the season transition after WrestleMania does,
          by these rules.</p>
        <div class="s">${plural(st.tiers.length, 'tier')} · ${plural(links.length, 'connection')}${live
          ? ` · <span class="uv-link" onclick="uvOpenTransition('${live.id}')">A season transition is under way</span> — it keeps the rules it started with`
          : ''} · <span class="uv-link" onclick="uvHowTiers()">How it works</span></div>
      </div>
      <div class="uv-tiers">
        ${st.tiers.map((t, i) => tierCard(t, i) + (links[i] ? linkCard(links[i], i) : '')).join('')}
      </div>
      <div class="uv-page-acts"><div class="uv-btn" onclick="uvTierAdd()">${ICON.plus}Add a tier</div>
        <div class="uv-btn" onclick="uvShowAdd()">${ICON.plus}Add a show</div></div>
      ${inNone.length ? `<div class="uv-sub">Shows in no tier</div><div class="uv-tier none">${inNone.map(showRow).join('')}
        <div class="fine">Nobody on these moves up or down a tier.</div></div>` : ''}`,
  };
}

// ================================================================ tiers

export function uvTierAdd() {
  commit(st => M.addTier(st, {}), t => `${t.name} added at the bottom — set its connection’s rules`);
}
export function uvTierMove(id, dir) { commit(st => M.moveTier(st, id, dir), 'Tier moved'); }
export function uvTierRemove(id) {
  const st = uni();
  const t = M.tierById(st, id);
  confirmThen(`Remove ${t.name}?`, `${t.shows.length ? `${showList(st, t.shows)} stay${t.shows.length === 1 ? 's' : ''}, with everyone on ${t.shows.length === 1 ? 'it' : 'them'}, in no tier. `
    : ''}The tiers either side of it get connected, with the rules they had together before (if any). Nothing that already happened changes.`,
  'Remove', () => commit(s => M.removeTier(s, id), `${t.name} removed`));
}
let rename = '';
export function uvTierRename(id) {
  rename = M.tierById(uni(), id).name;
  openSheet(() => {
    const t = M.tierById(uni(), id);
    if (!t) return null;
    return {
      title: `Tier ${tierNo(uni(), t)}`,
      body: `${field('Name', `<input id="uvTierName" class="uv-in" maxlength="60" value="${esc(rename)}" oninput="uvTierNameSet(this.value)"
          onkeydown="if(event.key==='Enter')uvTierNameSave('${id}')">`, 'wide')}
        <div class="uv-btn pri full" onclick="uvTierNameSave('${id}')">Save</div>`,
    };
  });
}
export function uvTierNameSet(v) { rename = v; }
export function uvTierNameSave(id) { if (commit(st => M.renameTier(st, id, rename), 'Tier renamed').ok) closeSheet(); }

// ================================================================ shows

export function uvShowTier(showId, tierId) {
  commit(st => M.setShowTier(st, showId, tierId || null), t => `${M.showById(uni(), showId).name} ${t ? `is in ${t.name}` : 'is in no tier'}`);
}
let sd = null;
export function uvShowAdd() {
  sd = { id: '', name: '', day: '3', tier: '' };
  openSheet(showSheet);
}
export function uvShowSheet(id) {
  const s = M.showById(uni(), id);
  sd = { id, name: s.name, day: String(s.day), tier: (M.tierOfShow(uni(), id) || {}).id || '' };
  openSheet(showSheet);
}
function showSheet() {
  const st = uni();
  if (sd.id && !M.showById(st, sd.id)) return null;
  const refs = sd.id ? M.showRefs(st, sd.id) : [];
  return {
    title: sd.id ? 'Show' : 'Add a show',
    body: `
      ${field('Name', `<input id="uvShowName" class="uv-in" maxlength="60" value="${esc(sd.name)}" placeholder="e.g. Main Event" oninput="uvShowSet('name',this.value)">`, 'wide')}
      <div class="uv-grid" style="margin-top:10px">
        ${field('Night', select(`uvShowSet('day',this.value)`, options(M.DAYS.map((n, i) => [String(i), n]), sd.day), ' id="uvShowDay"'))}
        ${sd.id ? '' : field('Tier', select(`uvShowSet('tier',this.value)`, options([...st.tiers.map((t, i) => [t.id, `Tier ${i + 1} · ${t.name}`]), ['', 'No tier']], sd.tier), ' id="uvShowTierPick"'))}
      </div>
      <div class="uv-btn pri full" onclick="uvShowSave()">${sd.id ? 'Save' : 'Add the show'}</div>
      ${sd.id ? (refs.length ? `<div class="fine">${esc(M.showById(st, sd.id).name)} has history (${esc(refs.join(', '))}), so it can’t be deleted.</div>`
        : `<div class="uv-btn bad full" onclick="uvShowDelete('${sd.id}')">Delete the show</div>`) : ''}
      <div class="fine">Episodes already on the calendar keep their name and night.</div>`,
  };
}
export function uvShowSet(k, v) { sd[k] = v; }
export function uvShowSave() {
  const d = sd;
  const r = d.id ? commit(st => M.updateShow(st, d.id, { name: d.name, day: d.day }), 'Show saved')
    : commit(st => M.addShow(st, { name: d.name, day: d.day, tier: d.tier || null }), s => `${s.name} added`);
  if (r.ok) closeSheet();
}
export function uvShowDelete(id) {
  const s = M.showById(uni(), id);
  confirmThen(`Delete ${s.name}?`, 'Nothing on record names it, so nothing else changes.', 'Delete', () => {
    if (commit(st => M.deleteShow(st, id), `${s.name} deleted`).ok) closeSheet();
  });
}

// ================================================================ a connection's rules

export function uvLinkRules(linkId) {
  openSheet(() => {
    const st = uni();
    const l = M.linkById(st, linkId);
    if (!l || !M.activeLinks(st).includes(l)) return null;
    const up = M.tierById(st, l.upper), low = M.tierById(st, l.lower), r = l.rules;
    const i = st.tiers.indexOf(up);
    const seg = (key, items, cur) => `<div class="uv-seg" data-rule="${key}">${items.map(([v, lb]) => `<div class="${String(cur) === String(v) ? 'on' : ''}" data-v="${v}"
      onclick="uvRule('${linkId}','${key}','${v}')">${esc(lb)}</div>`).join('')}</div>`;
    const showPick = (key, ids, cur, blank) => select(`uvRule('${linkId}','${key}',this.value)`,
      options([...(blank ? [['', blank]] : []), ...ids.map(id => [id, M.showById(st, id).name])], cur || ''), ` data-rule="${key}"`);
    const { pending } = ruleLines(st, r, up, low);
    return {
      title: `Tier ${i + 1} ⇄ Tier ${i + 2}`,
      body: `
        <p class="uv-p">The rules between <b>${esc(up.name)}</b> and <b>${esc(low.name)}</b>. Each change is saved as you make it, for the
          next season transition — one already under way keeps the rules it started with.</p>
        <h4>${ICON.down}Relegation matches</h4>
        ${seg('relegation.on', [['true', 'On'], ['false', 'Off']], r.relegation.on)}
        ${r.relegation.on ? `
          <div class="uv-trcount"><span>Candidates on each ${esc(up.name)} show: the</span>
            <div class="uv-ic mv" onclick="uvRule('${linkId}','relegation.candidates','${Math.max(0, r.relegation.candidates - 1)}')">${ICON.left}</div>
            <b>${r.relegation.candidates}</b>
            <div class="uv-ic mv" onclick="uvRule('${linkId}','relegation.candidates','${r.relegation.candidates + 1}')">${ICON.right}</div>
            <span>with the fewest wins</span></div>
          <div class="uv-sub flush">Losers move down</div>
          ${seg('relegation.timing', [['result', 'Right away'], ['window', 'At the transfer window']], r.relegation.timing)}
          ${field('Down to', low.shows.length ? showPick('relegation.to', low.shows, r.relegation.to) : `<div class="uv-in ro">${esc(low.name)} has no shows</div>`, 'wide')}` : ''}
        <h4>${ICON.up}Qualifying matches on ${esc(low.name)}</h4>
        ${seg('qualifiers.on', [['true', 'On'], ['false', 'Off']], r.qualifiers.on)}
        ${r.qualifiers.on ? `<div class="uv-sub flush">Winners</div>
          ${seg('promotion.timing', [['window', 'Draft eligible'], ['result', 'Move up straight away']], r.promotion.timing)}` : ''}
        <h4>${ICON.up}${esc(low.name)} champions</h4>
        ${seg('champions', [['eligible', 'Draft eligible'], ['automatic', 'Move up by themselves'], ['none', 'Stay']], r.champions)}
        <div class="uv-sub flush">A title, when its holder moves up</div>
        ${seg('titles', [['ask', 'Your call'], ['vacate', 'Vacated'], ['keep', 'Kept']], r.titles)}
        <div class="fine">${esc(r.titles === 'ask' ? 'You decide at each move whether the title is kept or vacated.'
          : r.titles === 'vacate' ? 'The title is vacated the moment its holder moves up — ready for a new champion.'
            : 'The holder keeps it, and defends it on their new show.')}</div>
        <h4>${ICON.up}Moving up to</h4>
        ${showPick('promotion.to', up.shows, r.promotion.to, `Your pick of ${showList(st, up.shows, 'or')} — the draft`)}
        ${pending.length ? `<div class="uv-flag" style="margin-top:12px"><span>Not carried out yet: ${esc(pending.join('; '))}. The rule is kept and
          the transition page lists who it would move, but nobody moves by it yet.</span></div>` : ''}`,
    };
  });
}
// one control's change, as a patch - checked as a whole by the model
export function uvRule(linkId, key, value) {
  const [part, sub] = key.split('.');
  const v = value === 'true' ? true : value === 'false' ? false : key === 'relegation.candidates' ? Number(value) : value === '' ? null : value;
  const patch = sub ? { [part]: { [sub]: v } } : { [part]: v };
  commit(st => M.setLinkRules(st, linkId, patch), 'Rules saved');
}

// ================================================================ the rules, in the app

export function uvHowTiers() {
  openSheet(() => ({
    title: 'How tiers work',
    body: `
      <p class="uv-p"><b>Tiers.</b> Every show can sit in one tier. Tier 1 is the main roster — Raw, SmackDown and Dynamite, as it
        starts — and stays at the top. Below it, as it starts: NXT, then Evolve. Add tiers at the bottom, rename them, reorder the
        lower ones, remove them, and move shows between them. A show in no tier takes no part in promotion or relegation.</p>
      <p class="uv-p"><b>Connections.</b> Between each tier and the one below it are that pair’s own rules:</p>
      <div class="uv-calc">
        <div><span>Down</span><b>relegation matches after WrestleMania — on or off, how many candidates on each upper show, when losers
          move (right away or at the transfer window) and to which lower show</b></div>
        <div><span>Up</span><b>qualifying matches on the lower tier — winners draft eligible, or moving up straight away</b></div>
        <div><span>Champs</span><b>the lower tier’s champions: draft eligible, moving up by themselves at the transfer window, or staying</b></div>
        <div><span>Titles</span><b>when a champion moves up: your call at each move, vacated, or kept</b></div>
        <div><span>Where</span><b>up to your pick of the upper tier’s shows (the draft), or a set show</b></div>
      </div>
      <p class="uv-p"><b>As it starts.</b> Main roster ⇄ NXT is the rules as they always were: two candidates with the fewest wins on
        each main show, losers straight down to NXT; NXT champions and qualifying winners draft eligible; titles your call; drafted to
        your pick. NXT ⇄ Evolve: Evolve’s champions move up to NXT by themselves at the transfer window, their titles vacated.</p>
      <p class="uv-p"><b>When rules change.</b> Each season transition keeps a copy of the tiers and rules it started with, so what
        already happened always reads the same. Changes here apply from the next transition. A new tier’s connection starts
        with everything off.</p>
      <p class="uv-p"><b>Not carried out yet.</b> Moving down at the transfer window, champions moving up by themselves, and moving up
        straight after a qualifying win are kept as rules and shown on the transition page with who they’d move — but nobody moves
        by them yet. Relegation matches or qualifiers under those rules can’t be booked, so nothing happens halfway.</p>`,
  }));
}
