// Universe — the auto booker on screen: a show's draft card, drafting a
// whole week at once, and each show's booking settings.
//
// A draft sits on its show's page above nothing booked yet - or after what is
// - with every match's reasons. Everything on it is the owner's to change: edit
// a match (the same form as booking one), draw one match again, take it off,
// move it, add their own, say who isn't at the show, draw the rest again (what
// they changed or added stays), or throw it away. Only "Book this card" puts
// it on the card - exactly as it stands. The booker (booker.js) never picks a
// winner, and nothing here enters a result.
import * as M from './model.js';
import * as B from './booker.js';
import { ICON, chip, empty, esc, eventWhen, kindChip, section, showColor, showName, vsLine } from './ui.js';
import { closeSheet, commit, confirmThen, openSheet, pushPage, uni } from './app.js';
import { uvDirect, uvDirectedToast } from './story.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const nope = msg => { throw new M.UniverseError(msg); };

// ================================================================ drafting a card

/** Draft a card for one show, up to its size - what's booked already stays, and counts. */
export function uvDraftCard(eventId) {
  commit(st => {
    const r = B.draftCard(st, eventId);
    if (!r.matches.length) nope(r.short || 'Nothing to draft.');
    M.setDraft(st, eventId, r.matches.map(B.toSpec));
    return r;
  }, r => `Draft card: ${plural(r.matches.length, 'match', 'matches')}${r.short ? ` — ${r.short}` : ''}. Nothing is booked until you book it`);
}

/** Draw everything again except what the owner changed or added. */
export function uvDraftAgain(eventId) {
  const ev = M.eventById(uni(), eventId);
  const kept = ev.draft.matches.filter(x => !x.auto || x.auto.edited).length;
  const redo = ev.draft.matches.length - kept;
  confirmThen('Draw the rest again?',
    `${kept ? `The ${plural(kept, 'match', 'matches')} you changed or added stay${kept === 1 ? 's' : ''} as ${kept === 1 ? 'it is' : 'they are'}. ` : ''}`
    + `${redo ? `The other ${plural(redo, 'match', 'matches')} ${redo === 1 ? 'is' : 'are'} drawn again` : 'The card is filled up again'}; anything you took off stays off.`,
    'Draw again', () => commit(st => {
      const r = B.redraft(st, eventId);
      M.setDraft(st, eventId, r.list, { nonce: r.nonce });
      return r;
    }, r => `Drawn again${r.short ? ` — ${r.short}` : ''}`));
}

/** Another match in one place on the draft. */
export function uvDraftRedraw(eventId, dmId) {
  commit(st => {
    const x = B.redrawOne(st, eventId, dmId);
    if (!x) nope('Nothing else fits here: everyone else available is already on the card. Change this one by hand, or take it off.');
    M.redrawDraftMatch(st, eventId, dmId, B.toSpec(x));
    return x;
  }, x => `Drawn again — ${x.why[0]}`);
}
export function uvDraftDrop(eventId, dmId) {
  commit(st => M.deleteDraftMatch(st, eventId, dmId), 'Taken off the draft — it won’t be drawn again for this show');
}
export function uvDraftMove(eventId, dmId, d) {
  commit(st => M.moveDraftMatch(st, eventId, dmId, d));
}
export function uvDraftDiscard(eventId) {
  confirmThen('Discard this draft?', 'The draft goes, with any changes you made to it. Nothing on the card changes.', 'Discard',
    () => commit(st => M.discardDraft(st, eventId), 'Draft discarded'));
}
export function uvDraftBook(eventId) {
  const st = uni();
  const ev = M.eventById(st, eventId);
  const n = ev.draft.matches.length;
  confirmThen(`Book ${plural(n, 'match', 'matches')}?`,
    `${ev.matches.length ? `They go on the card after the ${plural(ev.matches.length, 'match', 'matches')} already there, ` : 'They go on the card '}`
    + 'exactly as the draft has them. Then play them in WWE 2K25 and enter each result — nothing is decided for you.',
    'Book them', () => commit(s => M.bookDraft(s, eventId), made => `${plural(made.length, 'match', 'matches')} booked on ${ev.name}`));
}

// ================================================================ the draft on the show page

// what each match is, in a word
const kindLabel = a => (a ? B.KIND_LABEL[a.kind] || 'Drafted' : 'Yours');

function draftMatch(st, ev, dm, i, first, notes) {
  const title = dm.titleId && M.titleById(st, dm.titleId);
  const a = dm.auto;
  const move = d => `<div class="uv-ic mv" title="Move ${d < 0 ? 'up' : 'down'}" onclick="uvDraftMove('${ev.id}','${dm.id}',${d})">${d < 0 ? ICON.up : ICON.down}</div>`;
  const why = a ? a.why : [];
  return `<div class="uv-mc draft${a ? '' : ' own'}" data-dm="${dm.id}">
    <div class="uv-mc-top"><span class="n">${first + i + 1}</span>${kindChip(dm)}${title ? chip(title.name, 'gold') : ''}${dm.stip ? chip(dm.stip) : ''}
      <span class="st">${a ? (a.edited ? 'Draft · changed' : 'Draft') : 'Draft · yours'}</span></div>
    <div class="uv-mc-body">${vsLine(st, dm)}</div>
    ${dm.notes ? `<div class="uv-mc-n">${esc(dm.notes)}</div>` : ''}
    ${why.length ? `<div class="uv-why" title="${esc(kindLabel(a))}"><b>Why</b> ${esc(why[0])}${why.length > 1
      ? `<ul>${why.slice(1, 4).map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}</div>` : ''}
    ${a && a.edited ? '<div class="uv-mc-d">You changed it, so it stays as you have it when the rest is drawn again.</div>' : ''}
    ${notes ? `<div class="uv-mc-d warn">${notes.map(esc).join(' · ')}</div>` : ''}
    <div class="uv-mc-acts">
      <div class="uv-btn sm2" onclick="uvDraftEdit('${ev.id}','${dm.id}')">${ICON.edit}Edit</div>
      <div class="uv-btn sm2" onclick="uvDraftRedraw('${ev.id}','${dm.id}')">${ICON.redraw}Draw again</div>
      <span class="sp"></span>${move(-1)}${move(1)}
      <div class="uv-ic mv" title="Take it off the draft" onclick="uvDraftDrop('${ev.id}','${dm.id}')">${ICON.x}</div>
    </div>
  </div>`;
}

/** The way into the auto booker on a show's page: a draft to make, or the draft itself. */
export function uvDraftBlock(st, ev) {
  const d = ev.draft;
  if (!d) {
    if (M.cardStatus(ev).state === 'complete') return '';
    const size = M.cardSize(st, ev);
    const room = size - ev.matches.length;
    return `<div class="uv-autorow${room > 0 ? '' : ' quiet'}" onclick="uvDraftCard('${ev.id}')">${ICON.spark}<div><b>Draft the card</b>
      <span>${room > 0 ? `The auto booker suggests ${ev.matches.length ? `the other ${plural(room, 'match', 'matches')}` : `${plural(size, 'match', 'matches')}`}, each with why — you change anything, then book it`
        : `Already ${plural(ev.matches.length, 'match', 'matches')} of ${size} — raise the size in its settings to draft more`}</span></div>${ICON.right}</div>`;
  }
  const notes = B.draftNotes(st, ev);
  const out = d.out.map(id => M.wrestlerById(st, id)).filter(Boolean);
  const size = M.cardSize(st, ev);
  const total = ev.matches.length + d.matches.length;
  return `${section('Draft card', d.matches.length, 'var(--uv-gold)')}
    <div class="uv-draft" data-draft="${ev.id}">
      <div class="uv-draft-note">${ICON.spark}<span>Drafted by the auto booker${d.nonce ? ` (draw ${d.nonce + 1})` : ''} for a ${size}-match card.
        Nothing here is booked yet and no winner is picked. Change anything — every match, who’s in it, the order, the stipulation,
        the title — then book it.${total !== size ? ` ${total < size ? `The card comes to ${total} of ${size}.` : `The card comes to ${total}, over its ${size}.`}` : ''}</span></div>
      ${d.matches.length ? `<div class="uv-cards">${d.matches.map((dm, i) => draftMatch(st, ev, dm, i, ev.matches.length, notes.get(dm.id))).join('')}</div>`
        : empty(ICON.spark, 'The draft is empty', 'Add a match of your own, or draw the card again.')}
      <div class="uv-add inset" onclick="uvDraftAdd('${ev.id}')">${ICON.plus}Add your own match</div>
      <div class="uv-draft-out">Not at this show: <b>${out.length ? esc(out.map(w => w.name).join(', ')) : 'nobody'}</b>
        <span class="uv-link" onclick="uvDraftOut('${ev.id}')">Change</span></div>
      <div class="uv-page-acts"><div class="uv-btn pri" onclick="uvDraftBook('${ev.id}')">${ICON.check}Book this card</div></div>
      <div class="uv-page-acts">
        <div class="uv-btn" onclick="uvDraftAgain('${ev.id}')">${ICON.redraw}Draw the rest again</div>
        <div class="uv-btn" onclick="uvBookerSettings('${ev.showId || ''}')">Settings</div>
      </div>
      <div class="uv-draft-foot"><span class="uv-link" onclick="uvDraftDiscard('${ev.id}')">Discard the draft</span>
        <span class="uv-link" onclick="uvHowBooker()">How the auto booker works</span></div>
    </div>`;
}

/** The reason under a booked match that came from the booker. */
export function uvAutoLine(m) {
  if (!m.auto || !m.auto.why.length) return '';
  return `<div class="uv-why small"><b>Auto-booked</b> ${esc(m.auto.why[0])}${m.auto.edited ? ' <i>· changed by you</i>' : ''}</div>`;
}

// ================================================================ who isn't at the show

let outPick = null;
export function uvDraftOut(eventId) {
  outPick = { eventId, ids: new Set(M.eventById(uni(), eventId).draft.out) };
  openSheet(() => {
    const st = uni();
    const ev = M.eventById(st, outPick.eventId);
    if (!ev || !ev.draft) return null;
    const roster = st.wrestlers.filter(w => (ev.showId ? w.showId === ev.showId : !!w.showId)).sort(M.byName);
    const row = w => {
      const off = w.status !== 'active';
      return `<label class="uv-check${off ? ' dim' : ''}"><input type="checkbox"${outPick.ids.has(w.id) || off ? ' checked' : ''}${off ? ' disabled' : ''}
        onchange="uvDraftOutPick('${w.id}',this.checked)"><span>${esc(w.name)}${off ? ` — ${w.status}` : ''}</span></label>`;
    };
    return {
      title: 'Not at this show',
      body: `<p class="uv-p">Who isn’t at ${esc(ev.name)} — for this show only. Anyone ticked is left out of whatever’s drawn for it; a drafted
          match they’re in is drawn again without them. Injured and away wrestlers are left out anyway (change that on their page).</p>
        <div class="uv-checks">${roster.map(row).join('') || '<div class="fine">Nobody on the roster.</div>'}</div>
        <div class="uv-btn pri full" onclick="uvDraftOutSave()">Save</div>`,
    };
  });
}
export function uvDraftOutPick(id, on) { if (on) outPick.ids.add(id); else outPick.ids.delete(id); }
export function uvDraftOutSave() {
  const { eventId, ids } = outPick;
  const r = commit(st => {
    M.setDraftOut(st, eventId, [...ids]);
    // drafted matches they're in (and the owner hasn't changed) are drawn again without them
    let redrawn = 0, dropped = 0;
    M.eventById(st, eventId).draft.matches.filter(dm => dm.auto && !dm.auto.edited && dm.sides.some(sd => sd.wrestlers.some(id => ids.has(id))))
      .forEach(dm => {
        const x = B.redrawOne(st, eventId, dm.id);
        if (x) { M.redrawDraftMatch(st, eventId, dm.id, B.toSpec(x)); redrawn++; } else { M.deleteDraftMatch(st, eventId, dm.id); dropped++; }
      });
    return { redrawn, dropped };
  }, x => `Saved${x.redrawn ? ` — ${plural(x.redrawn, 'match', 'matches')} drawn again without them` : ''}${x.dropped ? ` — ${plural(x.dropped, 'match', 'matches')} taken off: nothing else fits` : ''}`);
  if (r.ok) closeSheet();
}

// ================================================================ a whole week

/** Draft every show's card for a week: plan the episodes that aren't on the calendar, and draft each. */
export function uvDraftWeek(week) {
  openSheet(() => {
    const st = uni();
    const rows = B.weekPlan(st, week);
    const todo = rows.filter(r => r.action !== 'skip');
    return {
      title: `Draft week ${week}`,
      body: `<p class="uv-p">The auto booker drafts a card for each show below, each by its own settings and roster. Nothing is booked:
          each draft waits on its show’s page for you to change and book. No winner is ever picked.</p>
        <div class="uv-plan">${rows.map(r => `<div class="uv-planrow${r.action === 'skip' ? ' off' : ''}" style="--c:${showColor(st, r.show ? r.show.id : null)}">
          <div class="uv-main"><div class="nm">${esc(r.event ? r.event.name : `${r.show.name} · Week ${week}`)}</div><div class="sub">${esc(r.text)}</div></div>
          ${r.action === 'skip' ? '' : ICON.check}</div>`).join('')}</div>
        ${todo.length ? `<div class="uv-btn pri full" onclick="uvDraftWeekGo(${week})">${ICON.spark}Draft ${plural(todo.length, 'card')}</div>`
          : '<div class="fine">Nothing to draft this week.</div>'}
        <div class="fine">Planning an episode here is the same as tapping Plan on the calendar.</div>`,
    };
  });
}
export function uvDraftWeekGo(week) {
  let runs = [];
  const r = commit(st => {
    const rows = B.weekPlan(st, week).filter(x => x.action !== 'skip');
    const evs = rows.map(x => x.event || M.addEvent(st, { showId: x.show.id, week }));
    runs = uvDirect(st);                        // planning an episode lets the story director catch up, as it always does
    let drafted = 0;
    evs.forEach(ev => {
      const res = B.draftCard(st, ev.id);
      if (!res.matches.length) return;
      M.setDraft(st, ev.id, res.matches.map(B.toSpec));
      drafted++;
    });
    return drafted;
  }, n => `${plural(n, 'card')} drafted — each waits on its show’s page until you book it${uvDirectedToast(runs)}`);
  if (r.ok) closeSheet();
}

// ================================================================ settings

const TYPES = M.MATCH_TYPES;
export function uvBookerSettings(showId) {
  openSheet(() => {
    const st = uni();
    const id = showId || null;
    const show = id ? M.showById(st, id) : null;
    if (id && !show) return null;
    const s = M.bookerSettings(st, id);
    const t = id ? st.tiers.findIndex(x => x.shows.includes(id)) : -1;
    const seg = (key, items, cur) => `<div class="uv-seg" data-set="${key}">${items.map(([v, lb]) => `<div class="${cur === v ? 'on' : ''}" data-v="${v}"
      onclick="uvBookerSet('${showId}','${key}','${v}')">${esc(lb)}</div>`).join('')}</div>`;
    const step = (key, v, min, max, label) => `<div class="uv-trcount" data-set="${key}"><span>${esc(label)}</span>
      <div class="uv-ic mv" onclick="uvBookerSet('${showId}','${key}','${Math.max(min, v - 1)}')">${ICON.left}</div><b>${v}</b>
      <div class="uv-ic mv" onclick="uvBookerSet('${showId}','${key}','${Math.min(max, v + 1)}')">${ICON.right}</div></div>`;
    const levels = Object.entries(B.LEVEL_LABEL);
    return {
      title: show ? `${show.name}: auto booker` : 'All-shows events',
      body: `
        <p class="uv-p">${show ? `How ${esc(show.name)}’s cards are drafted. Anything you haven’t set follows its tier${t >= 0 ? ` (tier ${t + 1})` : ' (it’s in none)'}.`
          : 'How a premium live event for every show is drafted: everyone on any show can be in it, and any title.'}
          A draft already made stays as it is — draw it again to use new settings.</p>
        <h4>${ICON.list}Matches on a card</h4>
        ${show ? step('size', s.size, 1, M.MAX_CARD, 'A weekly episode:') : ''}
        ${step('pleSize', s.pleSize, 1, M.MAX_CARD, 'A premium live event:')}
        ${show ? step('titles', s.titles, 0, M.MAX_TITLE_MATCHES, 'Title matches on an episode, at most:') : ''}
        <div class="fine">At a premium live event, every title with a contender is on the line. A roster too small for the card gets as many
          matches as it can fill.</div>
        <h4>${ICON.team}Kinds of match</h4>
        ${TYPES.map(k => `<div class="uv-sub flush">${esc(B.TYPE_LABEL[k])}</div>${seg(`mix.${k}`, levels, s.mix[k])}`).join('')}
        <h4>${ICON.star}Stipulations</h4>
        ${seg('stips', Object.entries(B.STIP_LABEL), s.stips)}
        <div class="fine">${esc({ never: 'No stipulations — add your own on any match.',
          feuds: 'Only to settle a feud: a third meeting in a few weeks, or a heated one at a premium live event.',
          often: 'Also on heated feuds and tag feuds from week to week.' }[s.stips])}</div>
        ${s.changed ? `<div class="uv-btn full" onclick="uvBookerReset('${showId}')">Back to the defaults${show ? ' for its tier' : ''}</div>` : ''}`,
    };
  });
}
export function uvBookerSet(showId, key, value) {
  const [k, sub] = key.split('.');
  const patch = sub ? { mix: { [sub]: value } } : { [k]: k === 'stips' ? value : Number(value) };
  commit(st => M.setBookerSettings(st, showId || null, patch), 'Settings saved');
}
export function uvBookerReset(showId) {
  commit(st => M.resetBookerSettings(st, showId || null), 'Back to the defaults');
}

// ================================================================ the auto booker's page

const summary = s => [`${s.size} a week`, `${s.pleSize} at a PLE`, s.titles ? `up to ${plural(s.titles, 'title match', 'title matches')}` : 'no title matches weekly',
  `stipulations: ${B.STIP_LABEL[s.stips].toLowerCase()}`].join(' · ');

export function uvOpenBooker() { pushPage('booker', 'all'); }
export function uvBookerPage() {
  const st = uni();
  const season = M.activeSeason(st);
  const drafts = st.events.filter(e => e.draft).sort((a, b) => M.compareStamps(st, a.at, b.at));
  const tierOf = id => { const i = st.tiers.findIndex(t => t.shows.includes(id)); return i < 0 ? 'No tier' : `Tier ${i + 1}`; };
  const all = M.bookerSettings(st, null);
  return {
    title: 'Auto booker',
    body: `
      <div class="uv-rk-head"><b>Auto booker</b><span>Drafts a whole card for any show from the record — rosters, titles, standings,
        rivalries and friendships, teams, goals, who’s short of matches, injuries and the calendar — with why for every match. It never books
        anything or picks a winner: you change the draft, then book it. <span class="uv-link" onclick="uvHowBooker()">How it works</span></span></div>
      <div class="uv-autorow" onclick="uvDraftWeek(${season.week})">${ICON.spark}<div><b>Draft this week’s cards</b>
        <span>Week ${season.week}: every show, planned if it isn’t yet</span></div>${ICON.right}</div>
      ${drafts.length ? `${section('Drafts waiting', drafts.length)}<div class="uv-list">${drafts.map(e => `<div class="uv-row" style="--c:${showColor(st, e.showId)}"
        onclick="uvOpenEvent('${e.id}')"><div class="uv-main"><div class="nm">${esc(e.name)}</div><div class="sub">${esc(eventWhen(st, e))} ·
        ${plural(e.draft.matches.length, 'match', 'matches')} drafted</div></div>${ICON.right}</div>`).join('')}</div>` : ''}
      ${section('Each show', st.shows.length)}
      <div class="uv-list">${st.shows.map(sh => {
        const s = M.bookerSettings(st, sh.id);
        return `<div class="uv-row" data-booker="${sh.id}" style="--c:${showColor(st, sh.id)}" onclick="uvBookerSettings('${sh.id}')">
          <div class="uv-main"><div class="nm">${esc(sh.name)} <span class="uv-muted">${esc(tierOf(sh.id))}</span>${s.changed ? ' ' + chip('Set by you', 'gold') : ''}</div>
          <div class="sub">${esc(summary(s))}</div></div>${ICON.right}</div>`;
      }).join('')}
        <div class="uv-row" data-booker="all" onclick="uvBookerSettings('')"><div class="uv-main"><div class="nm">Premium live events for every show
          ${all.changed ? chip('Set by you', 'gold') : ''}</div><div class="sub">${esc(`${all.pleSize} matches · stipulations: ${B.STIP_LABEL[all.stips].toLowerCase()}`)}</div></div>${ICON.right}</div>
      </div>
      <p class="uv-p uv-inset-p fine">A show you add later starts with the defaults for its tier: 6 matches a week in tier 1, 5 in tier 2,
        4 below that (5 in no tier), and 2 more at a premium live event.</p>`,
  };
}

// ================================================================ how it works

export function uvHowBooker() {
  openSheet(() => ({
    title: 'How the auto booker works',
    body: `
      <p class="uv-p"><b>A draft, never a booking.</b> It drafts a card for a show — up to that show’s size, after anything already
        booked — and leaves it on the show’s page. Nothing on a draft counts, the story director doesn’t read it, and it never has a
        result. <b>Book this card</b> puts it on the card exactly as it stands; then the game decides every match.</p>
      <p class="uv-p"><b>What it reads.</b> The show’s roster — injured, away and anyone you mark as not at the show left out — its tier
        (for the card’s size), the titles it can put on the line, this season’s standings, recent results and who is short of matches,
        rivalries, grudges, friendships and alliances, tag teams and factions (a team of three or more), what each wrestler is after,
        arrivals from another show, and the calendar: a premium live event ahead, or tonight being one.</p>
      <p class="uv-p"><b>What it looks for.</b></p>
      <div class="uv-calc">
        <div><b>Titles</b><span>the champion against the best contender: high in the standings, a recent win over the champion, a grudge,
          after the title, hot. A title left alone for weeks is due; just defended, the contenders meet instead. At a premium live event,
          every title with a contender. A vacant title: the top contenders meet for it.</span></div>
        <div><b>Feuds</b><span>rivals face each other — or each other’s allies and tag partners, or meet in a tag match. A feud builds
          across shows: after a one-on-one meeting it goes another way, and with a premium live event ahead the singles match waits for
          it. A third meeting in a few weeks, or a heated one at a premium live event, gets a stipulation to settle it (if the show’s
          settings allow).</span></div>
        <div><b>Friends</b><span>a friend stands up to a friend’s rival.</span></div>
        <div><b>Teams</b><span>teams at odds, or close in the tag standings, face each other; factions go three on three; partners face
          members of a team they’re at odds with.</span></div>
        <div><b>Upsets</b><span>a win from well down the standings, or over a champion, earns a rematch or a step up.</span></div>
        <div><b>Opportunities</b><span>anyone short of matches (as Booking balance counts them) gets a chance; someone cold gets one to
          turn it around; a new arrival gets a first match on the show.</span></div>
        <div><b>Everyone else</b><span>fresh matchups, close in the standings and not met lately.</span></div>
      </div>
      <p class="uv-p"><b>Putting a card together.</b> Nobody is in two matches. The card leans toward each show’s mix of match types and
        each division’s share of who’s available, rests people who wrestled lately, never repeats last week’s singles match, and keeps a
        weekly show to its number of title matches. The biggest match goes last. Close calls are settled by a seeded draw, so the same
        universe drafts the same card — and <b>Draw again</b> gives a different one.</p>
      <p class="uv-p"><b>Yours to change.</b> Edit any match — who’s in it, the title, the stipulation, the notes — draw one match again,
        move it, take it off (it won’t come back on that draft), add your own, or say who isn’t at the show. <b>Draw the rest again</b>
        keeps everything you changed or added. Every match says why it was chosen, and keeps that once it’s booked.</p>
      <p class="uv-p"><b>Not yet.</b> It doesn’t read or start the story director’s events — a title demand or a confrontation doesn’t book
        a match by itself yet. It reads only the relationships they leave behind.</p>`,
  }));
}
