// Universe — the season transition page: relegation after WrestleMania.
//
// One section per main-roster show. Each shows the season win totals the
// candidates come from, who the candidates are and how they're paired, where
// the matches go, and what happened - and, above all, anything the rule
// can't settle on its own (a tie at the cutoff, an odd number, results still
// missing, a match without a winner). Those wait for the owner: booking is
// held until they're decided. The winner of every relegation match is
// whoever wins in WWE 2K25; the loser moves to NXT when the result is saved.
import * as M from './model.js';
import { ICON, chip, empty, esc, eventWhen, showColor, showName } from './ui.js';
import { closeSheet, commit, confirmThen, openSheet, popPage, pushPage, refresh, uni } from './app.js';
import { uvPromotionPart, uvPromotionSummary, uvWindowPart } from './promotion.js';

export function uvOpenTransition(id) { pushPage('transition', id); }

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const nm = (st, id) => esc((M.wrestlerById(st, id) || { name: '?' }).name);

// ================================================================ starting one

/** Pick the event that ends the season - WrestleMania - and start the transition. */
export function uvStartTransition() {
  openSheet(() => {
    const st = uni();
    const cur = M.activeSeason(st);
    const seasons = st.seasons.filter(s => !M.transitionOfSeason(st, s.id)).map(s => s.id);
    const ples = st.events.filter(e => e.kind === 'ple' && seasons.includes(e.at.season))
      .sort((a, b) => M.compareStamps(st, b.at, a.at));
    const mania = e => /wrestlemania/i.test(e.name);
    const list = [...ples.filter(mania), ...ples.filter(e => !mania(e))];
    return {
      title: 'Season transition',
      body: `
        <p class="uv-p">Pick the premium live event that ends the season — WrestleMania. Its season’s win totals, up to and including
          it, decide each main show’s relegation candidates; their matches go on each show’s first episode after it.</p>
        ${list.length ? list.map(e => `<div class="uv-row" onclick="uvStartTransitionAt('${e.id}')">
            <span class="uv-av sq" style="--c:var(--uv-gold)">${ICON.star}</span>
            <div class="uv-main"><div class="nm">${esc(e.name)}</div>
              <div class="sub">${esc(eventWhen(st, e))} · ${esc(M.seasonById(st, e.at.season).name)}${e.at.season === cur.id ? '' : ' (finished)'}</div></div>
            <span class="uv-chev">${ICON.right}</span></div>`).join('')
          : empty(ICON.star, 'No premium live event yet', 'Add WrestleMania to the calendar first — the transition starts from it.')}`,
    };
  });
}
export function uvStartTransitionAt(eventId) {
  const r = commit(st => M.startTransition(st, eventId), 'Season transition started');
  if (r.ok) uvOpenTransition(r.value.id);
}

// ================================================================ the page

const STATUS = {
  unbooked: 'Not booked yet',
  booked: 'Booked — waiting for the result',
  relegated: 'Result in',
  'no winner': 'No winner — your decision',
  decided: 'Decided by you',
};

// where each part stands, in a few words, for the header and the calendar:
// [{ label, color, text, decisions }]
export function uvTransitionSummary(st, tr) {
  return [...relegationSummary(st, tr), ...uvPromotionSummary(st, tr)];
}
function relegationSummary(st, tr) {
  return M.mainShows(st).map(s => {
    const t = M.relegationTable(st, tr.id, s.id);
    const decisions = t.flags.filter(f => f.level === 'decide').length;
    const down = t.records.length;
    let text;
    if (!t.candidates.length && !t.flags.length) text = t.count ? 'no candidates' : 'no relegation this year';
    else if (decisions) text = `${plural(decisions, 'decision')} for you`;
    else if (t.pairs.length && t.pairs.every(p => ['relegated', 'decided'].includes(p.status))) text = `done — ${down} to NXT`;
    else if (t.pairs.some(p => p.status === 'booked')) text = 'booked';
    else text = 'ready to book';
    return { label: s.name, color: showColor(st, s.id), text, decisions };
  });
}

// the page's three parts: relegation on the main shows, NXT's promotion, the transfer window
let part = 'relegation';
export function uvTrPart(k) { part = k; refresh(); }

export function uvTransitionPage(id) {
  const st = uni();
  const tr = M.transitionById(st, id);
  if (!tr) return null;
  const wm = M.eventById(st, tr.event);
  const season = M.seasonById(st, tr.season);
  const summary = uvTransitionSummary(st, tr);
  const seg = (k, lb) => `<div class="${part === k ? 'on' : ''}" data-part="${k}" onclick="uvTrPart('${k}')">${lb}</div>`;
  const head = `
      <div class="uv-evhead" style="--c:var(--uv-gold)">
        <div class="k">Season transition · ${esc(season.name)}</div>
        <div class="nm">After ${esc(wm.name)}</div>
        <div class="s"><span class="uv-link" onclick="uvOpenEvent('${wm.id}')">${esc(wm.name)}</span> · ${esc(eventWhen(st, wm, true))}</div>
        <div class="uv-trsum">${summary.map(x => `<span class="${x.decisions ? 'warn' : ''}"><i style="--c:${x.color}"></i>
          ${esc(x.label)}: ${esc(x.text)}</span>`).join('')}</div>
      </div>
      <div class="uv-seg uv-seg-page">${seg('relegation', 'Relegation')}${seg('promotion', 'NXT promotion')}${seg('window', 'Transfer window')}</div>`;
  if (part === 'promotion') return { title: `${season.name} transition`, body: head + uvPromotionPart(st, tr) };
  if (part === 'window') return { title: `${season.name} transition`, body: head + uvWindowPart(st, tr) };
  const tables = M.mainShows(st).map(s => M.relegationTable(st, id, s.id));
  const incomplete = tables[0] && tables[0].flags.find(f => f.key === 'incomplete');
  const booked = tables.some(t => t.pairs.some(p => p.matches.length));
  const started = booked || M.promotionTable(st, id).pairs.some(p => p.matches.length) || tr.window;
  return {
    title: `${season.name} transition`,
    body: `${head}
      <p class="uv-p uv-inset-p">On each main show, the wrestlers with the fewest wins in ${esc(season.name)} — up to and including
        ${esc(wm.name)} — face each other on its first show after it. Whoever loses goes to NXT; the winner stays. Each show sets
        its own number. <span class="uv-link gold" onclick="uvHowRelegation()">How relegation works</span></p>
      ${incomplete ? `<div class="uv-flag decide top"><b>Your decision</b><span>${esc(incomplete.text)}</span>
        <div class="uv-btn sm2" onclick="uvTrCountAsTheyStand('${id}')">Count the wins as they stand</div></div>` : ''}
      ${tables.map(t => showSection(st, t)).join('')}
      <div class="uv-fix">
        <div class="h">Fix a mistake</div>
        <div class="fine">A wrong relegation result is corrected on its match, like any other: the wrestler who really lost goes
          to NXT instead, and the one who didn’t comes back. Clearing the result or taking the match off the card brings them back.</div>
        ${started ? '' : `<div class="uv-fixrow bad" onclick="uvTrCancel('${id}')">${ICON.x}<div><b>Cancel this transition</b>
          <span>Nothing is booked from it yet</span></div></div>`}
      </div>`,
  };
}

function showSection(st, t) {
  const tr = t.tr, sid = t.show.id, trId = tr.id;
  const fixed = t.pairs.some(p => p.matches.length);
  const decide = t.flags.filter(f => f.level === 'decide' && f.key !== 'incomplete');
  const checks = t.flags.filter(f => f.level === 'check');
  const night = t.night.event
    ? `<div class="uv-trnight" onclick="uvOpenEvent('${t.night.event.id}')">${ICON.cal}<div><b>${esc(t.night.event.name)}</b>
        <span>${esc(eventWhen(st, t.night.event))} · the first ${esc(t.show.name)} after ${esc(t.wm.name)}</span></div>${ICON.right}</div>`
    : `<div class="uv-trnight none">${ICON.cal}<div><b>No ${esc(t.show.name)} after ${esc(t.wm.name)} yet</b>
        <span>Its first episode after it, week ${t.night.week}, holds the relegation matches</span></div>
        <div class="uv-btn sm2" onclick="uvTrPlan('${trId}','${sid}',${t.night.week})">${ICON.plus}Plan it</div></div>`;
  const cutoff = t.auto ? t.candidates.length + t.tied.length : null;
  const rows = t.pool.map((r, i) => {
    const on = t.candidates.includes(r.id), tied = t.auto && t.tied.some(x => x.id === r.id);
    const line = t.auto && i === cutoff - 1 && i < t.pool.length - 1 ? ' cut' : '';
    const notes = [r.injured && 'injured', r.now !== sid && (r.now ? `now ${showName(st, r.now)}` : 'now unassigned')].filter(Boolean);
    return `<div class="uv-tw${on ? ' on' : ''}${tied ? ' tied' : ''}${line}" data-w="${r.id}" onclick="uvTrPick('${trId}','${sid}','${r.id}')">
      <span class="uv-tick">${on ? ICON.check : ''}</span>
      <div class="uv-main"><div class="nm">${esc(r.name)}${tied ? ' <span class="uv-chip warn">Tied</span>' : ''}</div>
        <div class="sub">${esc(notes.join(' · ') || `${plural(r.matches, 'match', 'matches')}`)}</div></div>
      <div class="w"><b>${r.wins}</b><span>${r.wins ? [r.singles && `singles ${r.singles}`, r.tag && `tag ${r.tag}`].filter(Boolean).join(' · ') : ''}</span></div>
    </div>`;
  }).join('');
  const count = t.auto
    ? `<div class="uv-trcount"><span>Candidates: the</span>
        <div class="uv-ic mv" onclick="uvTrCount('${trId}','${sid}',-1)">${ICON.left}</div><b>${t.count}</b>
        <div class="uv-ic mv" onclick="uvTrCount('${trId}','${sid}',1)">${ICON.right}</div><span>with the fewest wins</span></div>`
    : `<div class="uv-trcount"><span>Candidates picked by you (${t.candidates.length})</span>
        ${fixed ? '' : `<span class="uv-link" onclick="uvTrAuto('${trId}','${sid}')">Use the win totals</span>`}</div>`;
  const pairs = t.pairs.map(p => pairRow(st, t, p)).join('')
    + t.unpaired.map(id => `<div class="uv-pair odd"><div class="vs"><b>${nm(st, id)}</b> <span class="uv-muted">— no opponent</span></div></div>`).join('');
  const toBook = t.pairs.filter(p => p.status === 'unbooked').length;
  const book = t.blocking.length && (toBook || t.tied.length)
    ? `<div class="uv-btn full off">Settle the decisions above to book</div>`
    : !toBook ? '' : t.night.event ? `<div class="uv-btn pri full" onclick="uvTrBook('${trId}','${sid}')">Book ${plural(toBook, 'relegation match', 'relegation matches')} on ${esc(t.night.event.name)}</div>`
      : `<div class="uv-btn full off">Plan ${esc(t.show.name)}’s first show after ${esc(t.wm.name)} to book</div>`;
  return `<div class="uv-sec" style="--c:${showColor(st, sid)}"><span class="bar"></span><span class="t">${esc(t.show.name)}</span>
      <span class="n">${plural(t.candidates.length, 'candidate')}</span></div>
    <div class="uv-trshow" data-show="${sid}">
      ${night}
      ${decide.map(f => `<div class="uv-flag decide"><b>Your decision</b><span>${esc(f.text)}</span></div>`).join('')}
      ${checks.map(f => `<div class="uv-flag"><span>${esc(f.text)}</span></div>`).join('')}
      ${count}
      <div class="uv-tws"><div class="uv-tw hd"><span></span><div class="uv-main">Wins in ${esc(M.seasonById(st, tr.season).name)} up to ${esc(t.wm.name)}</div>
        <div class="w">Wins</div></div>${rows || `<div class="uv-none">Nobody was on ${esc(t.show.name)} at ${esc(t.wm.name)}.</div>`}</div>
      ${fixed ? '<div class="fine">Candidates are fixed now that matches are booked.</div>' : '<div class="fine">Tap a wrestler to make them a candidate, or not.</div>'}
      ${t.pairs.length || t.unpaired.length ? `<div class="uv-sub">Relegation matches</div><div class="uv-pairs">${pairs}</div>` : ''}
      ${book}
      ${t.records.map(r => `<div class="uv-relrec"><b>${nm(st, r.wrestler)} → NXT</b><span>${esc(r.reason)}</span></div>`).join('')}
    </div>`;
}

function pairRow(st, t, p) {
  const trId = t.tr.id, sid = t.show.id;
  const wins = id => (t.pool.find(r => r.id === id) || { wins: '?' }).wins;
  const others = id => t.candidates.filter(c => c !== id);
  const status = `<span class="uv-pst ${p.status.replace(' ', '-')}">${STATUS[p.status]}</span>`;
  if (p.status === 'unbooked') {
    return `<div class="uv-pair">
      <div class="vs"><b>${nm(st, p.a)}</b> <span class="uv-muted">(${wins(p.a)})</span> vs
        <select class="uv-in sm" onchange="uvTrPair('${trId}','${sid}','${p.a}',this.value)">${others(p.a).map(id =>
          `<option value="${id}"${id === p.b ? ' selected' : ''}>${nm(st, id)} (${wins(id)})</option>`).join('')}</select></div>
      ${status}</div>`;
  }
  const m = p.last.m, ev = p.last.ev;
  const rec = st.relegations.find(r => r.pair === p.id && (r.match === m.id || r.decided));
  let detail = '';
  if (p.status === 'booked') detail = `On <span class="uv-link" onclick="uvOpenEvent('${ev.id}')">${esc(ev.name)}</span>`;
  if (p.status === 'relegated') detail = `<b>${nm(st, m.sides[m.winner].wrestlers[0])}</b> won at ${esc(ev.name)}${rec ? ` — <b>${nm(st, rec.wrestler)}</b> to NXT` : ''}`;
  if (p.status === 'no winner') {
    detail = `${m.outcome === 'draw' ? 'A draw' : 'A no contest'} at ${esc(ev.name)}.
      <div class="uv-pacts"><div class="uv-btn sm2" onclick="uvTrRematch('${trId}','${sid}','${p.id}')">Book a rematch…</div>
        <div class="uv-btn sm2" onclick="uvTrDecide('${trId}','${sid}','${p.id}')">Decide…</div></div>`;
  }
  if (p.status === 'decided') {
    detail = `${p.decision.relegate ? `You sent <b>${nm(st, p.decision.relegate)}</b> to NXT` : 'You kept both'}${p.decision.note ? ` — ${esc(p.decision.note)}` : ''}.
      <span class="uv-link" onclick="uvTrUndoDecision('${trId}','${sid}','${p.id}')">Undo</span>`;
  }
  return `<div class="uv-pair">
    <div class="vs"><b>${nm(st, p.a)}</b> <span class="uv-muted">(${wins(p.a)})</span> vs <b>${nm(st, p.b)}</b> <span class="uv-muted">(${wins(p.b)})</span></div>
    ${status}<div class="d">${detail}</div></div>`;
}

// ================================================================ actions

export function uvTrPick(trId, showId, wid) { commit(st => M.toggleCandidate(st, trId, showId, wid)); }
export function uvTrCount(trId, showId, d) {
  const n = M.transitionById(uni(), trId).shows[showId].count + d;
  if (n < 0) return;
  commit(st => M.setCandidateCount(st, trId, showId, n));
}
export function uvTrAuto(trId, showId) { commit(st => M.useWinTotals(st, trId, showId), 'Back to the win totals'); }
export function uvTrPair(trId, showId, a, b) { commit(st => M.pairCandidates(st, trId, showId, a, b), 'Pairing changed'); }
export function uvTrCountAsTheyStand(trId) {
  confirmThen('Count the wins as they stand?',
    'Matches without a result won’t count toward anyone’s wins. You can still enter them later — the candidates follow the win totals until matches are booked.',
    'Count them', () => commit(st => M.countWinsAsTheyStand(st, trId), 'Counting the wins as they stand'));
}
export function uvTrPlan(trId, showId, week) {
  commit(st => M.addEvent(st, { showId, week }), e => `${e.name} planned`);
}
export function uvTrBook(trId, showId) {
  const t = M.relegationTable(uni(), trId, showId);
  commit(st => M.bookRelegation(st, trId, showId, t.night.event.id),
    ms => `${plural(ms.length, 'relegation match', 'relegation matches')} booked on ${t.night.event.name}`);
}
export function uvTrCancel(trId) {
  confirmThen('Cancel the season transition?', 'Nothing has been booked from it. You can start it again whenever you like.', 'Cancel it',
    () => { if (commit(st => M.cancelTransition(st, trId), 'Season transition cancelled').ok) popPage(); });
}

// a rematch goes on a later episode of the show, or a new one
export function uvTrRematch(trId, showId, pairId) {
  openSheet(() => {
    const st = uni();
    const t = M.relegationTable(st, trId, showId);
    const p = t.pairs.find(x => x.id === pairId);
    if (!p || p.status !== 'no winner') return null;
    const cur = M.activeSeason(st);
    const later = st.events.filter(e => e.kind === 'weekly' && e.showId === showId && M.compareStamps(st, e.at, p.last.ev.at) > 0)
      .sort((a, b) => M.compareStamps(st, a.at, b.at));
    const week = Math.max(cur.week, p.last.ev.at.season === cur.id ? p.last.ev.at.week + 1 : 1);
    return {
      title: 'Book a rematch',
      body: `<p class="uv-p"><b>${nm(st, p.a)}</b> vs <b>${nm(st, p.b)}</b> again — the loser goes to NXT.</p>
        ${later.map(e => `<div class="uv-row" onclick="uvTrRematchOn('${trId}','${showId}','${pairId}','${e.id}')">
          <span class="uv-av sq" style="--c:${showColor(st, showId)}">${ICON.cal}</span>
          <div class="uv-main"><div class="nm">${esc(e.name)}</div><div class="sub">${esc(eventWhen(st, e))}</div></div>
          <span class="uv-chev">${ICON.right}</span></div>`).join('')}
        ${later.some(e => e.at.season === cur.id && e.at.week === week) ? '' : `<div class="uv-row" onclick="uvTrRematchPlan('${trId}','${showId}','${pairId}',${week})">
          <span class="uv-av sq" style="--c:${showColor(st, showId)}">${ICON.plus}</span>
          <div class="uv-main"><div class="nm">Plan ${esc(showName(st, showId))} · Week ${week}</div><div class="sub">A new episode</div></div>
          <span class="uv-chev">${ICON.right}</span></div>`}`,
    };
  });
}
export function uvTrRematchOn(trId, showId, pairId, eventId) {
  if (commit(st => M.bookRelegation(st, trId, showId, eventId, [pairId]), 'Rematch booked').ok) closeSheet();
}
export function uvTrRematchPlan(trId, showId, pairId, week) {
  const r = commit(st => {
    const ev = M.addEvent(st, { showId, week });
    M.bookRelegation(st, trId, showId, ev.id, [pairId]);
    return ev;
  }, e => `Rematch booked on ${e.name}`);
  if (r.ok) closeSheet();
}

let decisionNote = '';
export function uvTrDecide(trId, showId, pairId) {
  decisionNote = '';
  openSheet(() => {
    const st = uni();
    const t = M.relegationTable(st, trId, showId);
    const p = t.pairs.find(x => x.id === pairId);
    if (!p || p.status !== 'no winner') return null;
    return {
      title: 'Your decision',
      body: `<p class="uv-p"><b>${nm(st, p.a)}</b> vs <b>${nm(st, p.b)}</b> ended in ${p.last.m.outcome === 'draw' ? 'a draw' : 'a no contest'}
          at ${esc(p.last.ev.name)}, so the rule can’t say who goes down. It’s your call — or book a rematch instead.</p>
        <label class="uv-f wide"><span>Why (kept in the record, optional)</span>
          <input id="uvTrNote" class="uv-in" maxlength="60" placeholder="e.g. Lost the rematch on the tie-break" oninput="uvTrNote(this.value)"></label>
        <div class="uv-btn full" onclick="uvTrDecideSave('${trId}','${showId}','${pairId}','${p.a}')">Send ${nm(st, p.a)} to NXT</div>
        <div class="uv-btn full" onclick="uvTrDecideSave('${trId}','${showId}','${pairId}','${p.b}')">Send ${nm(st, p.b)} to NXT</div>
        <div class="uv-btn full" onclick="uvTrDecideSave('${trId}','${showId}','${pairId}','')">Keep both on ${esc(t.show.name)}</div>`,
    };
  });
}
export function uvTrNote(v) { decisionNote = v; }
export function uvTrDecideSave(trId, showId, pairId, wid) {
  const r = commit(st => M.decidePair(st, trId, showId, pairId, wid || null, decisionNote),
    () => (wid ? `${M.wrestlerById(uni(), wid).name} sent to NXT` : 'Both stay'));
  if (r.ok) closeSheet();
}
export function uvTrUndoDecision(trId, showId, pairId) {
  confirmThen('Undo your decision?', 'Anyone it sent to NXT comes back, and the match is left without a winner again.', 'Undo',
    () => commit(st => M.undoDecision(st, trId, showId, pairId), 'Decision undone'));
}

export function uvHowRelegation() {
  openSheet(() => ({
    title: 'How relegation works',
    body: `
      <p class="uv-p"><b>When.</b> Once a season, after WrestleMania. Each main-roster show — every show but NXT — holds its own
        relegation matches on its first episode after WrestleMania.</p>
      <p class="uv-p"><b>Who.</b> Everyone who was on the show at WrestleMania is ranked by their wins that season, up to and
        including WrestleMania: singles and tag wins, wherever they happened. Draws, losses and no contests aren’t wins. The
        candidates are the ones with the fewest — as many as you set for that show. Shows don’t have to match: one can have
        four candidates and another none, whatever their roster sizes.</p>
      <p class="uv-p"><b>The matches.</b> Candidates face each other one on one, paired in win order until you pair them
        differently. The loser moves to NXT the moment you save the result — the winner stays. WWE 2K25 decides who wins;
        this never does.</p>
      <p class="uv-p"><b>What waits for you.</b> Nothing is invented where the rule runs out. Booking waits while any of these
        is open, and each is flagged as <i>your decision</i>:</p>
      <div class="uv-calc">
        <div><span>Tie</span><b>wrestlers level on wins across the cutoff — pick who’s a candidate, or change the number</b></div>
        <div><span>Odd</span><b>someone without an opponent — add or take out a candidate, or re-pair</b></div>
        <div><span>Missing</span><b>matches up to WrestleMania still without a result — enter them, or count the wins as they stand</b></div>
        <div><span>Draw</span><b>a relegation match without a winner — book a rematch, or decide who (if anyone) goes down</b></div>
      </div>
      <p class="uv-p">Worth a look, but not blocking: an injured candidate, one who has changed show since, a pairing across
        divisions, a candidate with no matches, and candidates you picked by hand.</p>
      <p class="uv-p"><b>The record.</b> Every relegation keeps why: the show, the match and who won it (or your decision), and
        the win total and place that made them a candidate — on the wrestler’s page for good, even if they come back up.</p>`,
  }));
}
