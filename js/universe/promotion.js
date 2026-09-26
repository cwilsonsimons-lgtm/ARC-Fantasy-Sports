// Universe — the season transition's other two parts: NXT promotion, and the
// transfer window where eligible wrestlers are drafted.
//
// NXT's first show after WrestleMania holds qualifying matches. Its season
// records and rankings are shown to help pick who's in them - as
// suggestions only; the owner picks. Winners, and every NXT champion, become
// draft eligible, which moves nobody. In the transfer window the owner drafts
// whoever they like to whichever show, as many to each as they like, and
// ends it whenever they like. The two questions the app has no rule for -
// does a tag partner go too, and is a title kept or vacated - are asked at
// the draft, every time.
import * as M from './model.js';
import { periodOf, rankRows, standings } from './standings.js';
import { ICON, chip, esc, eventWhen, fmtRec, showColor, showName } from './ui.js';
import { closeSheet, commit, confirmThen, openSheet, paintSheet, refresh, uni } from './app.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const nm = (st, id) => esc((M.wrestlerById(st, id) || { name: '?' }).name);
const title = (st, id) => esc((M.titleById(st, id) || { name: 'a title' }).name);

// how a wrestler became eligible, in a few words
function sourceText(st, e) {
  if (e.source === 'champion') return `NXT champion — ${title(st, e.title)}${e.team ? ` (${esc(M.teamById(st, e.team).name)})` : ''}`;
  if (e.source === 'qualifier') return `Won a qualifier vs ${nm(st, e.opponent)}`;
  return `Your decision after ${nm(st, e.opponent)}${e.note ? ` — ${esc(e.note)}` : ''}`;
}
const sourceChip = e => chip(e.source === 'champion' ? 'Champion' : e.source === 'qualifier' ? 'Qualifier' : 'Your call',
  e.source === 'champion' ? 'gold' : 'kind');

// where NXT and the window stand, for the header and the calendar
export function uvPromotionSummary(st, tr) {
  const t = M.promotionTable(st, tr.id);
  const played = t.pairs.filter(p => ['qualified', 'decided'].includes(p.status)).length;
  const nxt = !t.picked.length ? `${plural(t.champions.length, 'champion')} eligible; no qualifiers picked`
    : t.flags.some(f => f.level === 'decide') ? `${plural(t.flags.filter(f => f.level === 'decide').length, 'decision')} for you`
      : t.pairs.every(p => p.status === 'unbooked') ? `${plural(t.pairs.length, 'qualifier')} ready to book`
        : `${played} of ${plural(t.pairs.length, 'qualifier')} decided`;
  const undrafted = t.eligible.filter(e => !e.drafted).length;
  const win = !t.window ? `not open — ${t.eligible.length} eligible`
    : !t.window.closed ? `open — ${plural(t.drafts.length, 'pick')}, ${undrafted} eligible left`
      : `closed — ${plural(t.drafts.length, 'pick')}, ${t.window.undrafted.length} undrafted`;
  return [{ key: 'nxt', label: 'NXT', color: showColor(st, 'nxt'), text: nxt, decisions: t.flags.filter(f => f.level === 'decide').length },
    { key: 'window', label: 'Transfer window', color: 'var(--uv-gold)', text: win, decisions: 0 }];
}

// ================================================================ NXT promotion

let suggestN = 4;

export function uvPromotionPart(st, tr) {
  const t = M.promotionTable(st, tr.id);
  const trId = tr.id;
  const season = M.seasonById(st, tr.season);
  const fixed = t.pairs.some(p => p.matches.length);
  const decide = t.flags.filter(f => f.level === 'decide'), checks = t.flags.filter(f => f.level === 'check');

  // NXT's season, ranked the way the Rankings tab ranks it - only as a guide to who had a strong one
  const table = standings(st, { showId: 'nxt', period: periodOf(st, tr.season), kind: 'singles' });
  const all = rankRows([...table.ranked, ...table.unranked].filter(r => t.inPool.has(r.id)));
  const isChamp = id => t.champions.some(c => c.wrestler === id);
  const suggested = all.ranked.filter(r => !isChamp(r.id) && !t.pool.find(p => p.id === r.id).injured).slice(0, suggestN).map(r => r.id);
  const row = r => {
    const on = t.picked.includes(r.id);
    return `<div class="uv-tw${on ? ' on pick' : ''}" data-w="${r.id}" onclick="uvQPick('${trId}','${r.id}')">
      <span class="uv-tick">${on ? ICON.check : ''}</span>
      <div class="uv-main"><div class="nm">${r.rank ? `<span class="rk">${r.rank}</span>` : ''}${esc(r.name)}
        ${suggested.includes(r.id) ? chip('Suggested', 'kind') : ''}${isChamp(r.id) ? chip('Champion', 'gold') : ''}</div>
        <div class="sub"><span class="uv-form">${r.form.map(x => `<i class="${x}">${x}</i>`).join('')}</span></div></div>
      <div class="w"><b>${fmtRec(r.rec)}</b><span>${r.rank ? `${Math.round(r.score * 100)}%` : 'unranked'}</span></div>
    </div>`;
  };
  const night = t.night.event
    ? `<div class="uv-trnight" onclick="uvOpenEvent('${t.night.event.id}')">${ICON.cal}<div><b>${esc(t.night.event.name)}</b>
        <span>${esc(eventWhen(st, t.night.event))} · NXT’s first show after ${esc(t.wm.name)}</span></div>${ICON.right}</div>`
    : `<div class="uv-trnight none">${ICON.cal}<div><b>No NXT after ${esc(t.wm.name)} yet</b>
        <span>Its first episode after it, week ${t.night.week}, holds the qualifying matches</span></div>
        <div class="uv-btn sm2" onclick="uvTrPlan('${trId}','nxt',${t.night.week})">${ICON.plus}Plan it</div></div>`;
  const toBook = t.pairs.filter(p => p.status === 'unbooked').length;
  const book = t.blocking.length ? '<div class="uv-btn full off">Settle the decisions above to book</div>'
    : !toBook ? '' : t.night.event ? `<div class="uv-btn pri full" onclick="uvQBook('${trId}')">Book ${plural(toBook, 'qualifying match', 'qualifying matches')} on ${esc(t.night.event.name)}</div>`
        : '<div class="uv-btn full off">Plan NXT’s first show after WrestleMania to book</div>';
  const champs = t.champions.length ? t.champions.map(c => `<div class="uv-el"><div class="uv-main"><div class="nm">${nm(st, c.wrestler)} ${chip('Champion', 'gold')}</div>
      <div class="sub">${title(st, c.title)}${c.team ? ` · with ${esc(M.teamById(st, c.team).name)}` : ''}</div></div></div>`).join('')
    : '<div class="uv-none">NXT has no champions right now.</div>';
  return `
    <p class="uv-p uv-inset-p">NXT’s first show after ${esc(t.wm.name)} holds qualifying matches. Every NXT champion is draft
      eligible; so is whoever wins a qualifier. Being eligible moves nobody — you draft in the transfer window.
      <span class="uv-link gold" onclick="uvHowPromotion()">How promotion works</span></p>
    <div class="uv-trshow">
      ${night}
      <div class="uv-sub flush">Eligible as champions${t.window ? ' — fixed when the window opened' : ' — fixed when you open the window'}</div>
      <div class="uv-els">${champs}</div>
      ${decide.map(f => `<div class="uv-flag decide"><b>Your decision</b><span>${esc(f.text)}</span></div>`).join('')}
      ${checks.map(f => `<div class="uv-flag"><span>${esc(f.text)}</span></div>`).join('')}
      <div class="uv-sub flush">Who’s in the qualifiers</div>
      <div class="uv-trcount"><span>Suggested: the top</span>
        <div class="uv-ic mv" onclick="uvQSuggestN(-1)">${ICON.left}</div><b>${suggestN}</b>
        <div class="uv-ic mv" onclick="uvQSuggestN(1)">${ICON.right}</div><span>by score, champions and the injured aside</span>
        ${fixed || !suggested.length ? '' : `<span class="uv-link" onclick="uvQUseSuggested('${trId}','${suggested.join(',')}')">Pick them</span>`}</div>
      <div class="uv-tws"><div class="uv-tw hd"><span></span><div class="uv-main">NXT · ${esc(season.name)} singles — ranked as on Rankings</div>
        <div class="w">W–L–D</div></div>${[...all.ranked, ...all.unranked].map(row).join('') || `<div class="uv-none">Nobody was on NXT at ${esc(t.wm.name)}.</div>`}</div>
      <div class="fine">${fixed ? 'The field is fixed now that matches are booked.' : 'Suggestions are only a guide: tap anyone to put them in or take them out.'}
        The order you pick them in is the pairing order.</div>
      ${t.pairs.length || t.unpaired.length ? `<div class="uv-sub flush">Qualifying matches</div><div class="uv-pairs">${t.pairs.map(p => pairRow(st, t, p)).join('')}
        ${t.unpaired.map(id => `<div class="uv-pair odd"><div class="vs"><b>${nm(st, id)}</b> <span class="uv-muted">— no opponent</span></div></div>`).join('')}</div>` : ''}
      ${book}
    </div>`;
}

const QSTATUS = { unbooked: 'Not booked yet', booked: 'Booked — waiting for the result', qualified: 'Result in',
  'no winner': 'No winner — your decision', decided: 'Decided by you' };

function pairRow(st, t, p) {
  const trId = t.tr.id;
  const status = `<span class="uv-pst ${p.status.replace(' ', '-')}">${QSTATUS[p.status]}</span>`;
  if (p.status === 'unbooked') {
    return `<div class="uv-pair"><div class="vs"><b>${nm(st, p.a)}</b> vs
      <select class="uv-in sm" onchange="uvQPair('${trId}','${p.a}',this.value)">${t.picked.filter(id => id !== p.a).map(id =>
        `<option value="${id}"${id === p.b ? ' selected' : ''}>${nm(st, id)}</option>`).join('')}</select></div>${status}</div>`;
  }
  const { m, ev } = p.last;
  let detail = '';
  if (p.status === 'booked') detail = `On <span class="uv-link" onclick="uvOpenEvent('${ev.id}')">${esc(ev.name)}</span>`;
  if (p.status === 'qualified') detail = `<b>${nm(st, m.sides[m.winner].wrestlers[0])}</b> won at ${esc(ev.name)} — draft eligible`;
  if (p.status === 'no winner') {
    detail = `${m.outcome === 'draw' ? 'A draw' : 'A no contest'} at ${esc(ev.name)}.
      <div class="uv-pacts"><div class="uv-btn sm2" onclick="uvQRematch('${trId}','${p.id}')">Book a rematch…</div>
        <div class="uv-btn sm2" onclick="uvQDecide('${trId}','${p.id}')">Decide…</div></div>`;
  }
  if (p.status === 'decided') {
    const q = p.decision.qualify;
    detail = `${q.length ? `You sent ${q.map(id => `<b>${nm(st, id)}</b>`).join(' and ')} through` : 'Neither goes through, by your decision'}.
      <span class="uv-link" onclick="uvQUndoDecision('${trId}','${p.id}')">Undo</span>`;
  }
  return `<div class="uv-pair"><div class="vs"><b>${nm(st, p.a)}</b> vs <b>${nm(st, p.b)}</b></div>${status}<div class="d">${detail}</div></div>`;
}

export function uvQPick(trId, wid) { commit(st => M.toggleQualifier(st, trId, wid)); }
export function uvQSuggestN(d) { suggestN = Math.max(0, Math.min(20, suggestN + d)); paintPage(); }
export function uvQUseSuggested(trId, ids) { commit(st => M.setQualifiers(st, trId, ids.split(',').filter(Boolean)), 'Qualifiers picked'); }
export function uvQPair(trId, a, b) { commit(st => M.pairQualifiers(st, trId, a, b), 'Pairing changed'); }
export function uvQBook(trId) {
  const t = M.promotionTable(uni(), trId);
  commit(st => M.bookQualifiers(st, trId, t.night.event.id),
    ms => `${plural(ms.length, 'qualifying match', 'qualifying matches')} booked on ${t.night.event.name}`);
}
const paintPage = () => refresh();

export function uvQRematch(trId, pairId) {
  openSheet(() => {
    const st = uni();
    const t = M.promotionTable(st, trId);
    const p = t.pairs.find(x => x.id === pairId);
    if (!p || p.status !== 'no winner') return null;
    const cur = M.activeSeason(st);
    const later = st.events.filter(e => e.kind === 'weekly' && e.showId === 'nxt' && M.compareStamps(st, e.at, p.last.ev.at) > 0)
      .sort((a, b) => M.compareStamps(st, a.at, b.at));
    const week = Math.max(cur.week, p.last.ev.at.season === cur.id ? p.last.ev.at.week + 1 : 1);
    return {
      title: 'Book a rematch',
      body: `<p class="uv-p"><b>${nm(st, p.a)}</b> vs <b>${nm(st, p.b)}</b> again — the winner becomes draft eligible.</p>
        ${later.map(e => `<div class="uv-row" onclick="uvQRematchOn('${trId}','${pairId}','${e.id}')">
          <span class="uv-av sq" style="--c:${showColor(st, 'nxt')}">${ICON.cal}</span>
          <div class="uv-main"><div class="nm">${esc(e.name)}</div><div class="sub">${esc(eventWhen(st, e))}</div></div>
          <span class="uv-chev">${ICON.right}</span></div>`).join('')}
        ${later.some(e => e.at.season === cur.id && e.at.week === week) ? '' : `<div class="uv-row" onclick="uvQRematchPlan('${trId}','${pairId}',${week})">
          <span class="uv-av sq" style="--c:${showColor(st, 'nxt')}">${ICON.plus}</span>
          <div class="uv-main"><div class="nm">Plan NXT · Week ${week}</div><div class="sub">A new episode</div></div>
          <span class="uv-chev">${ICON.right}</span></div>`}`,
    };
  });
}
export function uvQRematchOn(trId, pairId, eventId) {
  if (commit(st => M.bookQualifiers(st, trId, eventId, [pairId]), 'Rematch booked').ok) closeSheet();
}
export function uvQRematchPlan(trId, pairId, week) {
  const r = commit(st => {
    const ev = M.addEvent(st, { showId: 'nxt', week });
    M.bookQualifiers(st, trId, ev.id, [pairId]);
    return ev;
  }, e => `Rematch booked on ${e.name}`);
  if (r.ok) closeSheet();
}

let qd = null;
export function uvQDecide(trId, pairId) {
  qd = { trId, pairId, pick: [], note: '' };
  openSheet(() => {
    const st = uni();
    const t = M.promotionTable(st, trId);
    const p = t.pairs.find(x => x.id === pairId);
    if (!p || p.status !== 'no winner') return null;
    const box = id => `<label class="uv-check"><input type="checkbox" id="uvQD-${id}"${qd.pick.includes(id) ? ' checked' : ''}
        onchange="uvQDecideToggle('${id}')"><span>${nm(st, id)} goes through — draft eligible</span></label>`;
    return {
      title: 'Your decision',
      body: `<p class="uv-p"><b>${nm(st, p.a)}</b> vs <b>${nm(st, p.b)}</b> ended in ${p.last.m.outcome === 'draw' ? 'a draw' : 'a no contest'}.
          Who goes through is your call — one, both, or neither. Or book a rematch instead.</p>
        ${box(p.a)}${box(p.b)}
        <label class="uv-f wide" style="margin-top:12px"><span>Why (kept in the record, optional)</span>
          <input id="uvQDNote" class="uv-in" maxlength="60" value="${esc(qd.note)}" oninput="uvQDecideNote(this.value)"></label>
        <div class="uv-btn pri full" onclick="uvQDecideSave()">${qd.pick.length ? `Send ${qd.pick.map(id => nm(st, id)).join(' and ')} through` : 'Neither goes through'}</div>`,
    };
  });
}
export function uvQDecideToggle(id) { qd.pick = qd.pick.includes(id) ? qd.pick.filter(x => x !== id) : [...qd.pick, id]; paintSheet(); }
export function uvQDecideNote(v) { qd.note = v; }
export function uvQDecideSave() {
  const d = qd;
  const r = commit(st => M.decideQualifier(st, d.trId, d.pairId, d.pick, d.note), d.pick.length ? 'Draft eligible by your decision' : 'Neither goes through');
  if (r.ok) closeSheet();
}
export function uvQUndoDecision(trId, pairId) {
  confirmThen('Undo your decision?', 'Whoever it made draft eligible isn’t any more, and the match is left without a winner again.', 'Undo',
    () => commit(st => M.undoQualifierDecision(st, trId, pairId), 'Decision undone'));
}

// ================================================================ the transfer window

export function uvWindowPart(st, tr) {
  const t = M.promotionTable(st, tr.id);
  const trId = tr.id;
  const w = t.window;
  const shows = M.mainShows(st);
  const moved = show => ({
    in: t.drafts.filter(d => d.to === show).length,
    out: st.relegations.filter(r => r.transition === trId && r.show === show).length,
  });
  const tiles = `<div class="uv-wtiles">${shows.map(s => {
    const x = moved(s.id);
    return `<div class="uv-wtile" style="--c:${showColor(st, s.id)}"><b>${esc(s.name)}</b>
      <span class="n">${st.wrestlers.filter(y => y.showId === s.id).length}</span><span>on the roster</span>
      <span class="ch">${x.in ? `+${x.in} drafted` : 'none drafted'}${x.out ? ` · −${x.out} relegated` : ''}</span></div>`;
  }).join('')}</div>`;
  const pending = t.pairs.filter(p => ['unbooked', 'booked', 'no winner'].includes(p.status));
  const eligibleRow = e => {
    const x = M.wrestlerById(st, e.wrestler);
    const teams = st.teams.filter(tm => tm.active && tm.members.includes(x.id));
    const held = st.reigns.filter(r => !r.end && (r.holder.type === 'wrestler' ? r.holder.id === x.id
      : (M.teamById(st, r.holder.id) || { members: [] }).members.includes(x.id)));
    const open = w && !w.closed && !e.drafted && x.showId === 'nxt';
    return `<div class="uv-el${open ? ' tap' : ''}" data-w="${x.id}"${open ? ` onclick="uvDraft('${trId}','${x.id}')"` : ''}>
      <div class="uv-main"><div class="nm">${esc(x.name)} ${e.sources.map(sourceChip).join('')}</div>
        <div class="sub">${e.sources.map(s => sourceText(st, s)).join(' · ')}</div>
        ${teams.length || held.length ? `<div class="sub warn">${[...teams.map(tm => `On ${esc(tm.name)}`), ...held.map(r => `Holds the ${title(st, r.titleId)}`)].join(' · ')}</div>` : ''}</div>
      ${e.drafted ? `<span class="uv-drafted" style="--c:${showColor(st, e.drafted.to)}">${esc(showName(st, e.drafted.to))}</span>`
        : open ? `<span class="uv-btn sm2 pri">Draft…</span>` : ''}
    </div>`;
  };
  const undrafted = t.eligible.filter(e => !e.drafted);
  const picks = groups(t.drafts).map(g => `<div class="uv-pick-row">
      <span class="no">${g[0].pick}</span>
      <div class="uv-main"><div class="nm">${g.map(d => nm(st, d.wrestler)).join(' & ')} → <span style="color:${showColor(st, g[0].to)}">${esc(showName(st, g[0].to))}</span></div>
        <div class="sub">${g.map(d => {
          const src = d.eligibility.map(id => st.eligibility.find(e => e.id === id)).filter(Boolean).map(e => sourceText(st, e));
          return `${nm(st, d.wrestler)}: ${src.length ? src.join(' · ') : 'not eligible — brought along by your decision'}`;
        }).join('<br>')}</div>
        ${g[0].titles.length ? `<div class="sub">${[...new Map(g.flatMap(d => d.titles).map(x => [x.reign, x])).values()].map(x => `${x.choice === 'vacated' ? 'Vacated' : 'Kept'} the ${title(st, x.title)}`).join(' · ')}</div>` : ''}
        ${g[0].note ? `<div class="sub">“${esc(g[0].note)}”</div>` : ''}</div>
      ${w && !w.closed ? `<span class="uv-link" onclick="uvUndoDraft('${g[0].id}')">Undo</span>` : ''}
    </div>`).join('');
  const history = M.transfersSince(st, trId).map(x => {
    const why = x.relegation ? 'relegated' : x.draft ? `draft pick ${x.draft.pick}` : (x.move.note ? esc(x.move.note) : 'transfer');
    return `<div class="uv-tl"><span class="w">S${M.seasonById(st, x.move.at.season).number} · W${x.move.at.week}</span>
      <span class="x"><b>${nm(st, x.move.wrestler)}</b> ${esc(showName(st, x.move.from))} → ${esc(showName(st, x.move.to))} <span class="uv-muted">— ${why}</span></span></div>`;
  }).join('');

  let top;
  if (!w) {
    top = `<p class="uv-p uv-inset-p">Draft eligible NXT wrestlers to Raw, SmackDown or Dynamite — as many to each as you like,
        or none, and end the window whenever you like. Opening it fixes the NXT champions as eligible.
        <span class="uv-link gold" onclick="uvHowPromotion()">How the draft works</span></p>
      ${pending.length ? `<div class="uv-flag top"><span>${plural(pending.length, 'qualifying match', 'qualifying matches')} ${pending.length === 1 ? 'has' : 'have'} no result yet.
        Its winner can still become eligible after the window opens.</span></div>` : ''}
      <div class="uv-btn pri full uv-inset-btn" onclick="uvOpenWindow('${trId}')">Open the transfer window</div>`;
  } else if (!w.closed) {
    top = `<p class="uv-p uv-inset-p">The window is open. Tap an eligible wrestler to draft them. Each show takes as many as
        you like; nobody has to go. <span class="uv-link gold" onclick="uvHowPromotion()">How the draft works</span></p>`;
  } else {
    top = `<div class="uv-flag top ok"><span>The window closed in week ${w.closed.week}: ${plural(t.drafts.length, 'wrestler')} drafted,
        ${plural(w.undrafted.length, 'eligible wrestler')} left on NXT${w.undrafted.length ? ` (${w.undrafted.map(id => nm(st, id)).join(', ')})` : ''}.</span></div>`;
  }
  return `${top}
    ${tiles}
    <div class="uv-sub">${w ? 'Draft eligible' : 'Eligible so far'} <span class="uv-muted">${t.eligible.length}</span></div>
    <div class="uv-els inset">${t.eligible.map(eligibleRow).join('') || '<div class="uv-none">Nobody is eligible yet.</div>'}</div>
    ${t.drafts.length ? `<div class="uv-sub">Draft picks</div><div class="uv-picks">${picks}</div>` : ''}
    ${w && !w.closed ? `<div class="uv-btn full uv-inset-btn" onclick="uvCloseWindow('${trId}')">End the transfer window${undrafted.length ? ` — ${undrafted.length} undrafted` : ''}</div>` : ''}
    ${history ? `<div class="uv-sub">Every transfer since ${esc(t.wm.name)}</div><div class="uv-tls">${history}</div>` : ''}
    ${w ? `<div class="uv-fix"><div class="h">Fix a mistake</div>
      ${w.closed ? `<div class="uv-fixrow" onclick="uvReopenWindow('${trId}')">${ICON.undo}<div><b>Reopen the transfer window</b><span>To draft someone after all, or undo a pick</span></div></div>`
        : t.drafts.length ? '<div class="fine">Undo a pick above: they go back to NXT, and a title vacated with it goes back to them — while nothing has happened since.</div>'
          : `<div class="uv-fixrow" onclick="uvUnopenWindow('${trId}')">${ICON.undo}<div><b>Take back opening the window</b><span>Nobody has been drafted yet</span></div></div>`}
    </div>` : ''}`;
}
function groups(drafts) {
  const out = new Map();
  drafts.forEach(d => { if (!out.has(d.group)) out.set(d.group, []); out.get(d.group).push(d); });
  return [...out.values()];
}

export function uvOpenWindow(trId) {
  const t = M.promotionTable(uni(), trId);
  confirmThen('Open the transfer window?',
    `${plural(t.champions.length, 'NXT champion')} become${t.champions.length === 1 ? 's' : ''} draft eligible now. Nobody moves until you draft them.`,
    'Open it', () => commit(st => M.openWindow(st, trId), 'Transfer window open'));
}
export function uvUnopenWindow(trId) { commit(st => M.unopenWindow(st, trId), 'Window closed again — nothing kept'); }
export function uvCloseWindow(trId) {
  const st = uni();
  const left = M.promotionTable(st, trId).eligible.filter(e => !e.drafted).map(e => M.wrestlerById(st, e.wrestler).name);
  confirmThen('End the transfer window?',
    left.length ? `${left.join(', ')} ${left.length === 1 ? 'stays' : 'stay'} on NXT, undrafted — and that’s kept on record.` : 'Everyone eligible has been drafted.',
    'End it', () => commit(s => M.closeWindow(s, trId), 'Transfer window closed'));
}
export function uvReopenWindow(trId) { commit(st => M.reopenWindow(st, trId), 'Transfer window reopened'); }
export function uvUndoDraft(draftId) {
  const st = uni();
  const d = st.drafts.find(x => x.id === draftId);
  const who = st.drafts.filter(x => x.group === d.group).map(x => M.wrestlerById(st, x.wrestler).name);
  confirmThen(`Undo pick ${d.pick}?`, `${who.join(' and ')} go${who.length === 1 ? 'es' : ''} back to NXT. A title vacated with this pick goes back to its holder.`,
    'Undo pick', () => commit(s => M.undoDraft(s, draftId), 'Pick undone'));
}

// ---------------------------------------------------------------- the draft sheet

let dr = null;
export function uvDraft(trId, wid) {
  dr = { trId, wid, to: '', partners: [], titles: {}, note: '' };
  openSheet(draftSheet);
}
function draftSheet() {
  const st = uni();
  const d = dr;
  const w = M.wrestlerById(st, d.wid);
  if (!w || w.showId !== 'nxt') return null;
  const q = M.draftQuestions(st, d.wid);
  const group = [d.wid, ...d.partners];
  const titles = new Map();
  group.forEach(id => M.draftQuestions(st, id).titles.forEach(h => titles.set(h.title, h)));
  const elig = M.eligibilityOf(st, d.trId, d.wid);
  const tiles = M.mainShows(st).map(s => `<div class="uv-tile${d.to === s.id ? ' on' : ''}" style="--c:${showColor(st, s.id)}" data-show="${s.id}"
      onclick="uvDraftSet('to','${s.id}')"><span class="uv-dot"></span><b>${esc(s.name)}</b>
      <span>${st.wrestlers.filter(x => x.showId === s.id).length} on the roster</span></div>`).join('');
  const partners = q.partners.map(p => {
    const team = M.teamById(st, p.team);
    return p.partners.map(pid => {
      const x = M.wrestlerById(st, pid);
      const eligible = M.eligibilityOf(st, d.trId, pid).length > 0;
      const here = x.showId === 'nxt';
      return `<label class="uv-check"><input type="checkbox"${d.partners.includes(pid) ? ' checked' : ''}${here ? '' : ' disabled'}
          onchange="uvDraftPartner('${pid}')"><span>Bring <b>${esc(x.name)}</b> too — ${esc(team.name)}${here ? eligible ? ' (draft eligible)'
          : ' (not draft eligible — your call)' : ` (already on ${esc(showName(st, x.showId))})`}</span></label>`;
    }).join('');
  }).join('');
  const titleQs = [...titles.values()].map(h => {
    const who = h.team ? esc(M.teamById(st, h.team).name) : nm(st, st.reigns.find(r => r.id === h.reign).holder.id);
    const seg = (k, lb) => `<div class="${d.titles[h.title] === k ? 'on' : ''}" onclick="uvDraftTitle('${h.title}','${k}')">${lb}</div>`;
    return `<div class="uv-tq"><span>${who} hold${h.team ? '' : 's'} the <b>${title(st, h.title)}</b>. The app has no rule for this — your call:</span>
      <div class="uv-seg">${seg('keep', 'Keep it')}${seg('vacate', 'Vacate it')}</div></div>`;
  }).join('');
  const names = group.map(id => M.wrestlerById(st, id).name).join(' & ');
  const unanswered = [...titles.values()].some(h => !d.titles[h.title]);
  const ready = d.to && !unanswered;
  return {
    title: `Draft ${esc(w.name)}`,
    body: `
      <p class="uv-p">${elig.map(e => sourceText(st, e)).join(' · ')}</p>
      <h4>To</h4>
      <div class="uv-tiles">${tiles}</div>
      ${partners ? `<h4>Tag partners</h4><p class="uv-p">Whether a team moves together is up to you.</p>${partners}` : ''}
      ${titleQs ? `<h4>Titles</h4>${titleQs}` : ''}
      <label class="uv-f wide" style="margin-top:12px"><span>Note (optional)</span>
        <input id="uvDraftNote" class="uv-in" maxlength="60" value="${esc(d.note)}" placeholder="e.g. First overall pick" oninput="uvDraftSet('note',this.value)"></label>
      <div class="uv-btn pri full${ready ? '' : ' off'}" onclick="uvDraftSave()">${!d.to ? 'Pick a show' : unanswered ? 'Keep or vacate each title first'
        : `Draft ${esc(names)} to ${esc(showName(st, d.to))}`}</div>`,
  };
}
export function uvDraftSet(k, v) { dr[k] = v; if (k !== 'note') paintSheet(); }
export function uvDraftPartner(pid) { dr.partners = dr.partners.includes(pid) ? dr.partners.filter(x => x !== pid) : [...dr.partners, pid]; paintSheet(); }
export function uvDraftTitle(titleId, choice) { dr.titles[titleId] = choice; paintSheet(); }
export function uvDraftSave() {
  const d = dr;
  if (!d.to) return;                                   // the model still asks about any unanswered title
  const r = commit(st => M.draftWrestler(st, d.trId, d.wid, d.to, { partners: d.partners, titles: d.titles, note: d.note }),
    recs => `Pick ${recs[0].pick}: ${recs.map(x => M.wrestlerById(uni(), x.wrestler).name).join(' & ')} to ${showName(uni(), d.to)}`);
  if (r.ok) closeSheet();
}

export function uvHowPromotion() {
  openSheet(() => ({
    title: 'How promotion works',
    body: `
      <p class="uv-p"><b>Qualifiers.</b> NXT’s first show after WrestleMania holds one-on-one qualifying matches. You pick who’s
        in them, from everyone on NXT at WrestleMania. The page suggests the top of NXT’s season standings — ranked exactly as
        on the Rankings tab, champions and the injured aside — but it’s only a suggestion. Winners become draft eligible. A
        qualifier without a winner is your call: a rematch, or send one, both or neither through.</p>
      <p class="uv-p"><b>Champions.</b> Every NXT champion is draft eligible without a match — both members of a tag team
        holding an NXT tag title. They’re fixed as eligible when you open the transfer window.</p>
      <p class="uv-p"><b>The transfer window.</b> Being eligible moves nobody. In the window you draft eligible wrestlers to Raw,
        SmackDown or Dynamite, in any order, as many to each show as you like — rosters don’t have to come out even. End it
        whenever you like: anyone left undrafted stays on NXT, and that’s kept on record too.</p>
      <p class="uv-p"><b>What you decide at every pick.</b> The app has no rule for these, so it asks:</p>
      <div class="uv-calc">
        <div><span>Titles</span><b>a drafted champion keeps the title or vacates it — for a tag title, the whole team’s</b></div>
        <div><span>Teams</span><b>whether tag partners come along — eligible or not — or the team is split across shows</b></div>
      </div>
      <p class="uv-p"><b>The record.</b> Every eligibility says how it came about — an NXT title, a qualifier win, or your decision
        — and every pick keeps its number, show, eligibility, title decisions and note, for good. Every transfer since
        WrestleMania is listed on the window’s page, and each wrestler’s page shows their draft.</p>`,
  }));
}
