// Universe — the Rankings tab: each show's standings, and booking balance.
//
// Both are read from the results the owner has entered and only ever inform:
// a ranking never stops anyone being booked for anything, and a match idea
// is a line-up for the booking form, never a booking or a result. The
// arithmetic lives in standings.js; the two "How this works" sheets here
// explain it in the same terms.
import * as M from './model.js';
import { MIN_GROUP, MIN_SHORT, MIN_WEEKS, balance, matchIdeas, periodOf, rankRows, standings } from './standings.js';
import { ICON, chip, empty, esc, eventWhen, fmtRec, section, showColor, showName } from './ui.js';
import { openSheet, refresh, uni } from './app.js';

let mode = 'standings';      // 'standings' or 'balance'
let stShow = null;           // a show id, or 'all'; null: the first show
let stPeriod = null;         // a season id, or 'all'; null follows the active season
let stKind = 'singles';      // 'singles' or 'tag'
let balShow = null;          // a show id; null: the first show
let balPeriod = 'last4';     // 'last4', 'last8' or 'season'

export function uvRankingsView() {
  const st = uni();
  const seg = (k, lb) => `<div class="${mode === k ? 'on' : ''}" onclick="uvRankMode('${k}')">${lb}</div>`;
  return `<div class="uv-seg uv-seg-page">${seg('standings', 'Standings')}${seg('balance', 'Booking balance')}</div>`
    + (mode === 'standings' ? standingsView(st) : balanceView(st));
}
export function uvRankMode(k) { mode = k; refresh(); }

const pill = (on, onclick, label, color) => `<div class="uv-pill${on ? ' on' : ''}" onclick="${onclick}">`
  + `${color ? `<span class="uv-dot" style="--c:${color}"></span>` : ''}${esc(label)}</div>`;
const pct = x => `${Math.round(x * 100)}%`;
const perWeek = x => (Math.round(x * 10) / 10).toFixed(1);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ================================================================ standings

function standingsView(st) {
  const showId = stShow && (stShow === 'all' || M.showById(st, stShow)) ? stShow : st.shows[0].id;
  const cur = M.activeSeason(st);
  const periodKey = stPeriod === 'all' || (stPeriod && M.seasonById(st, stPeriod)) ? stPeriod : cur.id;
  const p = periodOf(st, periodKey);
  const shows = `<div class="uv-pills">${st.shows.map(s => pill(s.id === showId, `uvRankShow('${s.id}')`, s.name, showColor(st, s.id))).join('')}
    ${pill(showId === 'all', `uvRankShow('all')`, 'All shows')}</div>`;
  const periods = `<div class="uv-pills tight2">${[...st.seasons].reverse().map(s =>
    pill(s.id === periodKey, `uvRankPeriod('${s.id}')`, s.status === 'active' ? `${s.name} (now)` : s.name)).join('')}
    ${pill(periodKey === 'all', `uvRankPeriod('all')`, 'All time')}</div>`;
  const kseg = (k, lb) => `<div class="${stKind === k ? 'on' : ''}" onclick="uvRankKind('${k}')">${lb}</div>`;
  const where = showId === 'all' ? null : showId;
  const title = `${showId === 'all' ? 'Every show' : showName(st, showId)} · ${p.label}`;

  let body;
  if (stKind === 'singles') {
    const all = standings(st, { showId: where, period: p, kind: 'singles' });
    body = divisions(st, [...all.ranked, ...all.unranked], 'singles');
  } else {
    const teams = standings(st, { showId: where, period: p, kind: 'teams' });
    const tag = standings(st, { showId: where, period: p, kind: 'tag' });
    body = `${section('Tag teams', teams.ranked.length || null)}
      ${table(st, teams, 'No tag teams here in this period.', 'Team')}
      <div class="uv-note uv-inset">A team ranks only on matches it wrestled as the team.</div>
      ${divisions(st, [...tag.ranked, ...tag.unranked], 'tag')}`;
  }
  return `${shows}${periods}
    <div class="uv-seg uv-seg-page small">${kseg('singles', 'Singles')}${kseg('tag', 'Tag')}</div>
    <div class="uv-rk-head"><b>${esc(title)}</b><span>Ranked by winning percentage, with one win and one loss added to everyone.
      <span class="uv-link" onclick="uvHowRanked()">How rankings work</span></span></div>
    ${body}
    <div class="uv-note uv-inset ok">Rankings only show who’s succeeding. They never limit booking — anyone can be booked in any
      title match, and anyone can win it.</div>`;
}

function divisions(st, rows, kind) {
  const label = { singles: ' singles', tag: ' tag records' }[kind];
  return [['male', 'Men’s'], ['female', 'Women’s']].map(([g, name]) => {
    const list = rows.filter(r => r.gender === g);
    if (!list.length) return '';
    const ranked = rankRows(list);
    return section(`${name}${label}`, ranked.ranked.length || null)
      + table(st, ranked, kind === 'tag' ? 'No tag results in this period.' : 'No singles results in this period.', 'Wrestler');
  }).join('');
}

const FORM = { W: 'W', L: 'L', D: 'D', NC: 'NC' };
const STREAK = { W: 'Won', L: 'Lost', D: 'Drew' };

function table(st, { ranked, unranked }, none, who) {
  const open = r => (r.kind === 'team' ? `uvOpenTeam('${r.id}')` : `uvOpenWrestler('${r.id}')`);
  const rowHtml = r => `<div class="uv-st" data-id="${r.id}" onclick="${open(r)}">
      <span class="rk">${r.rank}</span>
      <div class="uv-main"><div class="nm">${esc(r.name)}${r.titles.length ? ` <span class="uv-belt in" title="${esc(r.titles.map(t => t.name).join(', '))}">${ICON.belt}</span>` : ''}</div>
        <div class="sub"><span class="uv-form">${r.form.map(x => `<i class="${x}">${FORM[x]}</i>`).join('')}</span>
          ${r.streak ? `<span>${STREAK[r.streak.type]} ${r.streak.n}</span>` : ''}</div></div>
      <div class="rec"><b>${fmtRec(r.rec)}</b>${r.rec.nc ? `<span>${r.rec.nc} NC</span>` : ''}</div>
      <div class="pc">${pct(r.score)}</div>
    </div>`;
  const head = `<div class="uv-st hd"><span class="rk">#</span><div class="uv-main">${who}</div><div class="rec">W–L–D</div><div class="pc">Score</div></div>`;
  const rest = unranked.length ? `<div class="uv-unr">Not ranked yet — no wins, losses or draws: ${unranked.map(r =>
    `<span class="uv-link" onclick="${open(r)}">${esc(r.name)}</span>`).join(', ')}</div>` : '';
  if (!ranked.length && !unranked.length) return `<div class="uv-none">${esc(none)}</div>`;
  return `<div class="uv-sts">${ranked.length ? head + ranked.map(rowHtml).join('') : ''}${rest}</div>`;
}

export function uvRankShow(k) { stShow = k; refresh(); }
export function uvRankPeriod(k) { stPeriod = k; refresh(); }
export function uvRankKind(k) { stKind = k; refresh(); }
/** When the active season changes, follow it. */
export function uvRankFollow() { stPeriod = null; }

export function uvHowRanked() {
  openSheet(() => ({
    title: 'How rankings work',
    body: `
      <p class="uv-p"><b>The score.</b> Each wrestler’s or team’s score is their winning percentage, counting a draw as half a
        win, with one extra win and one extra loss added to everyone. No contests don’t count.</p>
      <div class="uv-calc">
        <div><span>1–0</span><b>(1 + 1) ÷ (1 + 2) = 67%</b></div>
        <div><span>5–0</span><b>(5 + 1) ÷ (5 + 2) = 86%</b></div>
        <div><span>10–2</span><b>(10 + 1) ÷ (12 + 2) = 79%</b></div>
        <div><span>2–2–1</span><b>(2 + ½ + 1) ÷ (5 + 2) = 50%</b></div>
      </div>
      <p class="uv-p">The added win and loss keep a small sample honest: one lucky win doesn’t put someone above a wrestler
        who has won ten of twelve. Ties are broken by more wins, then fewer losses; wrestlers still level share a rank.</p>
      <p class="uv-p"><b>What counts.</b> Only results you’ve entered — booked matches don’t count until they’re played. A
        match is <i>singles</i> for a wrestler when their side was just them (a triple threat or a battle royal too), and
        <i>tag</i> when they had a partner. A tag team ranks only on matches it wrestled as the team. Men’s and women’s
        divisions are ranked separately.</p>
      <p class="uv-p"><b>Who’s on which show.</b> For a finished season, the show they were on when it ended; for the current
        season and all time, the show they’re on now. Their record counts every match in the period wherever it happened,
        premium live events and other shows included.</p>
      <p class="uv-p"><b>Form</b> is the last five results in the period, newest first; the streak is the current run, not
        counting no contests.</p>
      <p class="uv-p"><b>What rankings don’t do.</b> They never decide anything. Anyone can be booked against anyone, with
        any title on the line, and the winner is whoever wins in WWE 2K25.</p>`,
  }));
}

// ================================================================ booking balance

const BAL_PERIODS = [['last4', 'Last 4 weeks'], ['last8', 'Last 8 weeks'], ['season', 'This season']];

function balanceView(st) {
  const showId = balShow && M.showById(st, balShow) ? balShow : st.shows[0].id;
  const cur = M.activeSeason(st);
  const p = periodOf(st, balPeriod === 'season' ? cur.id : balPeriod);
  const res = balance(st, { showId, period: p });
  const show = showName(st, showId);
  const shows = `<div class="uv-pills">${st.shows.map(s => pill(s.id === showId, `uvBalShow('${s.id}')`, s.name, showColor(st, s.id))).join('')}</div>`;
  const periods = `<div class="uv-pills tight2">${BAL_PERIODS.map(([k, lb]) => pill(k === balPeriod, `uvBalPeriod('${k}')`, lb)).join('')}</div>`;

  const summary = res.groups.map(g => `<div class="ln"><span>${esc(g.label)}</span><b>${g.enough
    ? `typically ${perWeek(g.typical)} a week`
    : `too few to compare (${g.judged} judged)`}</b></div>`).join('');
  const flagged = res.groups.flatMap(g => g.rows.filter(r => r.flagged).map(r => ({ r, g })));
  const head = `<div class="uv-rk-head"><b>${esc(show)} · weeks ${p.from}–${p.to} of ${esc(M.seasonById(st, p.seasonId).name)}</b>
    <span>Who has had far fewer matches than is typical for their division on ${esc(show)}.
      <span class="uv-link" onclick="uvHowBalance()">How this is worked out</span></span></div>`;

  if (!res.groups.length) {
    return shows + periods + head + empty(ICON.user, `Nobody on ${show}`, 'Put wrestlers on this show to see how their matches are spread.');
  }
  const cards = flagged.length ? flagged.map(({ r, g }) => shortCard(st, showId, r, g, res)).join('')
    : `<div class="uv-note uv-inset ok">Nobody on ${esc(show)} is well short of matches over ${esc(p.label.toLowerCase())}.</div>`;
  return `${shows}${periods}${head}
    <div class="uv-bal-sum">${summary}</div>
    ${section('Short of matches', flagged.length || null)}
    ${cards}
    ${res.groups.map(g => groupTable(st, g)).join('')}`;
}

function shortCard(st, showId, r, g, res) {
  const ideas = matchIdeas(st, { kind: r.kind, id: r.id }, { showId, balanceResult: res });
  const open = r.kind === 'team' ? `uvOpenTeam('${r.id}')` : `uvOpenWrestler('${r.id}')`;
  const lineup = i => i.lineup.map(sd => (sd.team ? `${sd.team}:` : '') + sd.wrestlers.join(',')).join('|');
  const booked = r.booked[0];
  return `<div class="uv-short" data-id="${r.id}">
    <div class="t"><span class="uv-link nm" onclick="${open}">${esc(r.name)}</span>${chip(r.severity === 'well below' ? 'Well below' : 'Below', r.severity === 'well below' ? 'bad' : 'warn')}</div>
    <div class="s">${plural(r.matches, 'match', 'matches')} in ${plural(r.weeks, 'week')} on ${esc(showName(st, showId))} — typical for the
      ${r.kind === 'team' ? 'show’s teams' : esc(g.label.toLowerCase())} would be about ${Math.round(r.expected * 10) / 10}.
      ${r.last ? `Last match: ${esc(r.last.name)}.` : 'No matches in this period.'}</div>
    ${booked ? `<div class="s ok">Already booked: ${esc(booked.event.name)} (${esc(eventWhen(st, booked.event))}).</div>` : ''}
    ${ideas.length ? `<div class="uv-ideas"><div class="h">Match ideas</div>${ideas.map(i => `<div class="uv-idea">
        <div class="b"><div class="vs">vs <b>${esc(i.opponent.name)}</b></div>
          <div class="why">${i.reasons.map(esc).join(' · ')}</div>
          ${i.note ? `<div class="why warn">${esc(i.note)}</div>` : ''}</div>
        <div class="uv-btn sm2" onclick="uvIdeaBook('${showId}','${lineup(i)}')">Book…</div></div>`).join('')}</div>`
      : `<div class="s">No available opponents on ${esc(showName(st, showId))} right now.</div>`}
  </div>`;
}

function groupTable(st, g) {
  const max = Math.max(...g.rows.map(r => r.rate), g.typical || 0, 0.01);
  const open = r => (r.kind === 'team' ? `uvOpenTeam('${r.id}')` : `uvOpenWrestler('${r.id}')`);
  const note = r => (r.injured ? 'Injured — not counted' : r.weeks < MIN_WEEKS ? `Here ${plural(r.weeks, 'week')} — not judged yet` : '');
  const rowHtml = r => `<div class="uv-bl${r.flagged ? ' flag' : ''}${r.judged ? '' : ' dim'}" onclick="${open(r)}">
      <div class="uv-main"><div class="nm">${esc(r.name)}</div><div class="sub">${note(r) || `${plural(r.matches, 'match', 'matches')} in ${plural(r.weeks, 'week')}`}</div></div>
      <div class="bar"><i style="width:${Math.round((r.rate / max) * 100)}%"></i>${g.typical ? `<u style="left:${Math.round((g.typical / max) * 100)}%"></u>` : ''}</div>
      <div class="pw">${perWeek(r.rate)}</div>
    </div>`;
  return section(`Everyone · ${g.label}`, g.rows.length)
    + `<div class="uv-bls"><div class="uv-bl hd"><div class="uv-main">Matches a week${g.typical ? ' — the line is typical' : ''}</div><div class="pw">/wk</div></div>`
    + [...g.rows].sort((a, b) => b.rate - a.rate || M.byName(a, b)).map(rowHtml).join('') + '</div>';
}

export function uvBalShow(k) { balShow = k; refresh(); }
export function uvBalPeriod(k) { balPeriod = k; refresh(); }

// Where to put a match idea: this week's or a later episode of the show, a
// premium live event, or a new episode. The form opens filled in; booking it
// is still the owner's call.
export function uvIdeaBook(showId, lineup) {
  openSheet(() => {
    const st = uni();
    const cur = M.activeSeason(st);
    const names = lineup.split('|').map(part => {
      const [team, list] = part.includes(':') ? part.split(':') : ['', part];
      const t = team && M.teamById(st, team);
      return t ? t.name : list.split(',').map(id => (M.wrestlerById(st, id) || { name: '?' }).name).join(' & ');
    });
    const upcoming = M.eventsIn(st, cur.id).filter(e => e.at.week >= cur.week
      && (e.showId === showId || (e.kind === 'ple' && !e.showId)));
    const open = [];
    for (let wk = cur.week; open.length < 2 && wk < cur.week + 8; wk++) {
      if (!st.events.some(e => e.at.season === cur.id && e.at.week === wk && e.kind === 'weekly' && e.showId === showId)) open.push(wk);
    }
    const when = e => `${esc(eventWhen(st, e))} · ${plural(e.matches.length, 'match', 'matches')} on the card`;
    return {
      title: 'Book this match',
      body: `
        <p class="uv-p"><b>${names.map(esc).join('</b> vs <b>')}</b> — pick where it goes. The booking form opens with them
          filled in; change anything before you add it, or don’t book it at all.</p>
        ${upcoming.map(e => `<div class="uv-row" onclick="uvBookLineup('${e.id}','${lineup}')">
          <span class="uv-av sq" style="--c:${showColor(st, e.showId)}">${e.kind === 'ple' ? ICON.star : ICON.cal}</span>
          <div class="uv-main"><div class="nm">${esc(e.name)}</div><div class="sub">${when(e)}</div></div>
          <span class="uv-chev">${ICON.right}</span></div>`).join('')}
        ${open.map(wk => `<div class="uv-row" onclick="uvPlanAndBook('${showId}',${wk},'${lineup}')">
          <span class="uv-av sq" style="--c:${showColor(st, showId)}">${ICON.plus}</span>
          <div class="uv-main"><div class="nm">Plan ${esc(showName(st, showId))} · Week ${wk}</div>
            <div class="sub">A new episode${wk === cur.week ? ' this week' : ''}</div></div>
          <span class="uv-chev">${ICON.right}</span></div>`).join('')}`,
    };
  });
}

export function uvHowBalance() {
  openSheet(() => ({
    title: 'How booking balance works',
    body: `
      <p class="uv-p"><b>Who’s compared with whom.</b> Everyone on the show now, men with men and women with women; tag teams
        with the show’s other tag teams. Nobody is compared with another show, and it doesn’t matter how big each show’s
        roster is.</p>
      <p class="uv-p"><b>Counting.</b> For the weeks you pick, each wrestler’s <i>matches</i> are the results you’ve entered
        while they were on this show — singles and tag, including premium live events and other shows. A team counts only
        matches as the team. Their <i>weeks</i> are the weeks of the period they were on the show, so someone who arrived
        halfway is judged on their time here. Their <i>rate</i> is matches ÷ weeks.</p>
      <p class="uv-p"><b>What’s typical.</b> The median rate of the group: half wrestle more often, half less. Injured
        wrestlers, and anyone on the show for fewer than ${MIN_WEEKS} weeks of the period, are left out of it and aren’t
        judged. A group needs at least ${MIN_GROUP} to compare.</p>
      <p class="uv-p"><b>Short of matches</b> means both:</p>
      <div class="uv-calc">
        <div><span>1</span><b>their rate is at most half the typical rate, and</b></div>
        <div><span>2</span><b>they’re at least ${MIN_SHORT} matches below typical rate × their weeks.</b></div>
      </div>
      <p class="uv-p">Rule 2 means a quiet show or division flags nobody, and small gaps are left alone — nobody is expected to
        wrestle as often as everyone else. <i>Well below</i> is a rate at most a quarter of typical.</p>
      <p class="uv-p"><b>Match ideas</b> are opponents on the same show and division, not injured and not their own tag
        partners (a team: another team with nobody in common). Each is scored on: both being short of matches (+3); a
        rivalry — met two or more times (+2) — or a recent first meeting (+1.5); being close in this season’s standings
        (up to +1.5); a shot at someone in the top three (+0.75); never having met (+0.75); holding a title (+0.5). An
        opponent already booked this week or later, or met last week, scores 1 less. The top three are shown with why.</p>
      <p class="uv-p">They’re only ideas. Nothing is booked until you add it to a card, and you can book anyone else instead —
        the result is whatever the game produces.</p>`,
  }));
}
