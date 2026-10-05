// Universe — Simulate ahead: play the next few weeks on a copy, and see what changed.
//
// The owner picks how long, how results go and the story director's pace;
// simulate.js plays a copy of the universe forward a week at a time (the page
// shows how far it has got), then reports what changed against the universe
// as it is. Nothing is saved: the copy lives only on this page, and the
// universe - its results, titles and story - is never touched.
import * as M from './model.js';
import * as SIM from './simulate.js';
import * as DR from './director.js';
import { ICON, INCIDENT, esc, section } from './ui.js';
import { pushPage, refresh, uni } from './app.js';

export function uvOpenSim() { pushPage('sim', 'all'); }

let opts = null;                    // { weeks, results, pace }
let run = null;                     // { sim, before, total, done, report, error, at }
const open = new Set();             // lists shown in full
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ALIGN = { face: 'face', heel: 'heel', tweener: 'tweener' };

export function uvSimSet(k, v) {
  opts[k] = k === 'weeks' ? Number(v) : v;
  refresh();
}
export function uvSimAll(key) { open.add(key); refresh(); }

/** Play the weeks on a copy - a week at a time, so the page can show how far it has got. */
export function uvSimRun() {
  const st = uni();
  if (run && !run.report && !run.error) return;                  // one at a time
  const seed = Math.floor(Math.random() * 2147483646);
  const before = JSON.parse(JSON.stringify(st));
  run = { sim: SIM.start(st, { ...opts, seed }), before, total: opts.weeks, done: 0, report: null, error: null, at: Date.now() };
  open.clear();
  const me = run;
  const step = () => {
    if (run !== me) return;                                         // a newer run took over
    try {
      const more = SIM.stepWeek(me.sim);
      me.done++;
      if (!more) me.report = SIM.report(me.before, me.sim);
    } catch (e) {
      me.error = e.message || String(e);
    }
    refresh();
    if (!me.report && !me.error) setTimeout(step, 20);
  };
  refresh();
  setTimeout(step, 30);
}

/** The Simulate ahead page. */
export function uvSimPage() {
  const st = uni();
  const s = M.activeSeason(st);
  if (!opts) opts = { weeks: 4, results: 'form', pace: st.story.pace };
  const seg = (key, items, cur) => `<div class="uv-seg" data-sim="${key}">${items.map(([v, lb]) => `<div class="${String(cur) === String(v) ? 'on' : ''}" data-v="${v}"
    onclick="uvSimSet('${key}','${v}')">${esc(lb)}</div>`).join('')}</div>`;
  const busy = run && !run.report && !run.error;
  const last = s.week + opts.weeks - 1;
  return {
    title: 'Simulate ahead',
    body: `
      <p class="uv-p uv-inset-p">See how much the next few weeks could change. They’re played on a <b>copy</b> of your universe:
        every show booked by the auto booker, every match decided by a stand-in for the WWE 2K25 CPU, and the story director doing
        what it does — before each show and straight after each match. <b>Nothing here is saved</b>: your universe, its results,
        titles and story stay exactly as they are.</p>
      <div class="uv-simset">
        <div class="uv-sub flush">How long</div>
        ${seg('weeks', SIM.WEEK_CHOICES.map(n => [n, plural(n, 'week')]), opts.weeks)}
        <div class="uv-sub flush">Results</div>
        ${seg('results', Object.entries(SIM.RESULTS).map(([k, r]) => [k, r.label]), opts.results)}
        <div class="fine">${esc(SIM.RESULTS[opts.results].text)} About 1 match in 25 is a draw or a no contest.</div>
        <div class="uv-sub flush">Story director</div>
        ${seg('pace', Object.entries(DR.PACE).map(([k, p]) => [k, p.label]), opts.pace)}
        <div class="fine">${esc(DR.PACE[opts.pace].text)}${st.story.on ? '' : ' It runs in the simulation even though it’s switched off in your universe.'}</div>
        <div class="uv-btn pri full${busy ? ' off' : ''}" onclick="uvSimRun()" data-simrun>${ICON.spark}${busy ? 'Simulating…'
          : `Simulate ${opts.weeks === 1 ? `week ${s.week}` : `weeks ${s.week}–${last}`}`}</div>
        <div class="fine">Starts with this week’s shows (the matches still to play), then the weeks after. Every show gets its usual
          episode; a draft waiting on a show is booked as it stands, and a show with no card gets one from the auto booker. Each run
          is a different draw.</div>
      </div>
      ${run ? runBlock(run) : ''}`,
  };
}

function runBlock(r) {
  if (r.error) return `<div class="uv-note bad uv-inset">The simulation stopped: ${esc(r.error)}</div>`;
  if (!r.report) {
    const pct = Math.round((r.done / r.total) * 100);
    return `<div class="uv-simprog" data-simprog="${r.done}"><b>Simulating week ${r.sim.week}…</b> ${r.done} of ${plural(r.total, 'week')} done
      <div class="bar"><i style="width:${pct}%"></i></div></div>`;
  }
  return reportBlock(r.report);
}

// ---------------------------------------------------------------- the report

const tile = (label, n, note) => `<div class="uv-rec" data-tile="${esc(label)}"><div class="k">${esc(label)}</div><div class="v">${n}</div><div class="s">${esc(note)}</div></div>`;
const li = (text, sub = '', cls = '') => `<div class="uv-simli ${cls}"><div>${text}</div>${sub ? `<span>${sub}</span>` : ''}</div>`;
const capped = (key, items, n, row) => {
  const all = open.has(key);
  return (all ? items : items.slice(0, n)).map(row).join('')
    + (!all && items.length > n ? `<div class="uv-more" onclick="uvSimAll('${key}')">Show all ${items.length}</div>` : '');
};
const kindWord = { grudge: ['grudge', 'grudges'], rivals: ['rivalry', 'rivalries'], allies: ['alliance', 'alliances'], friends: ['friendship', 'friendships'],
  'former-partners': ['former partnership', 'former partnerships'] };
const listOf = xs => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] || '');
const counted = map => Object.entries(map).filter(([, n]) => n).map(([k, n]) => `${n} ${kindWord[k] ? kindWord[k][n === 1 ? 0 : 1] : k}`);

function reportBlock(x) {
  const rel = x.relationships;
  const formed = counted(rel.formed), ended = counted(rel.ended);
  const relTotal = rel.lines.length;
  const weeks = x.from === x.to ? `Week ${x.from}` : `Weeks ${x.from}–${x.to}`;
  const storyChips = Object.entries(x.storyKinds).sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `<span class="uv-rk" style="--k:${(INCIDENT[k] || { color: '#98A3B3' }).color}">${esc((INCIDENT[k] || { label: k }).label)} ×${n}</span>`).join('');
  return `
    ${section('What changed', null)}
    <div class="uv-simhead" data-simreport>${esc(weeks)} of ${esc(x.season)} · ${plural(x.shows, 'show')} · ${plural(x.matches, 'match', 'matches')}
      · ${esc(SIM.RESULTS[x.results].label.toLowerCase())} · ${esc((DR.PACE[x.pace] || { label: x.pace }).label.toLowerCase())} story pace</div>
    <div class="uv-recs">
      ${tile('Title changes', x.titles.length, x.titles.length ? `${new Set(x.titles.map(t => t.title)).size} titles` : 'every champion kept it')}
      ${tile('Relationships', relTotal, `${rel.before} → ${rel.after} now`)}
      ${tile('Story events', x.story.length, x.story.length ? `${Object.keys(x.storyKinds).length} kinds` : 'a quiet stretch')}
    </div>
    <div class="uv-note uv-inset">None of this happened in your universe — it’s one way the weeks could go. Run it again for another.</div>

    ${section('Championships', x.titles.length || null)}
    ${x.titles.length ? capped('titles', x.titles, 8, t => li(`<b>${esc(t.title)}</b>: ${t.from ? `${esc(t.from)} → ` : ''}${esc(t.to)}`,
      `${esc(t.where)}${t.from ? '' : ' · it was vacant'}`, 'gold')) : '<div class="uv-none">Every champion kept their title.</div>'}
    ${x.contenders.length ? `<div class="uv-sub">#1 contenders now</div>${x.contenders.map(c => li(`<b>${esc(c.who)}</b> for the ${esc(c.title)}`,
      `won the #1 contender’s match at ${esc(c.where)}${c.isNew ? '' : ' · already next in line'}`)).join('')}` : ''}

    ${section('Relationships', relTotal || null)}
    <div class="uv-simsum">${relTotal ? `${formed.length ? `${esc(listOf(formed))} formed` : 'Nothing new formed'}${rel.grew ? ` · ${rel.grew} grew` : ''}${rel.cooled
      ? ` · ${rel.cooled} cooled` : ''}${ended.length ? ` · ${esc(listOf(ended))} ended` : ''}.` : 'Nothing changed between anyone.'}</div>
    ${capped('rels', rel.lines, 10, t => li(esc(t)))}

    ${section('Story events', x.story.length || null)}
    ${x.story.length ? `<div class="uv-simchips">${storyChips}</div>${capped('story', x.story, 10, g => li(esc(g.text), `${esc(g.where)}, ${esc(g.when)}`))}`
      : '<div class="uv-none">The story director had nothing to add.</div>'}
    ${x.turns.length ? `<div class="uv-sub">Turns</div>${x.turns.map(t => li(`<b>${esc(t.who)}</b> turned ${esc(ALIGN[t.to] || t.to)}`, `was ${esc(ALIGN[t.from] || t.from || 'unset')}`)).join('')}` : ''}
    ${x.splits.length ? `<div class="uv-sub">Teams split</div>${x.splits.map(n => li(`<b>${esc(n)}</b> split up`)).join('')}` : ''}

    ${section('Feuds to watch', x.feuds.length || null)}
    ${x.feuds.length ? x.feuds.map(f => li(`<b>${esc(f.who)}</b>${f.isNew ? ' <span class="uv-tag ple">New</span>' : ''}`, `${esc(f.stage)} · ${esc(f.text)}`)).join('')
      : '<div class="uv-none">No feuds going.</div>'}

    ${section('Standings', null)}
    ${x.standings.map(s => li(`<b>${esc(s.show)}</b>: ${s.top.map(r => `${r.rank}. ${esc(r.name)}${r.was && r.was !== r.rank ? ` <em>(was ${r.was})</em>` : !r.was ? ' <em>(new)</em>' : ''}`).join(' · ')}`,
      s.climber ? `Biggest climber: ${esc(s.climber.name)}, up ${s.climber.up} to #${s.climber.rank}` : '')).join('')}

    ${section('On a roll', null)}
    ${x.hot.length ? li(`Hot now: ${x.hot.map(h => `<b>${esc(h.name)}</b> ${esc(h.form)}`).join(' · ')}`) : ''}
    ${x.winners.length ? li(`Most wins in those weeks: ${x.winners.map(w => `<b>${esc(w.name)}</b> ${w.wins}`).join(' · ')}`) : ''}
    ${x.problems.length ? `<div class="fine uv-inset-p">Skipped: ${esc(x.problems.join(' · '))}</div>` : ''}
    <div class="uv-page-acts"><div class="uv-btn" onclick="uvSimRun()">${ICON.spark}Run it again — a different draw</div></div>`;
}
