import { SCORING_CATEGORIES, RULE_BY_KEY, isYardRule, perYardFromYards, yardsPerPoint }
  from './data/scoring-rules.js';
import { SCORING_PRESETS } from './data/scoring-presets.js';
import { escHtml } from './panel.js';
import { activePreset, applyPreset, favourites, isDirty, isFav, resetScoringToPreset,
         scoreValue, searchRules, setScoreValue, scoreStats, toggleFav } from './scoring.js';
import { isCommish } from './settings.js';
import { ICON_X } from './team.js';

// ======================= SCORING SETTINGS UI =======================
// Built entirely from the catalog: the tab strip, the cards, the search index
// and the favourites list are all derived, so a new rule appears here the
// moment it is added to the catalog and nothing in this file changes.

let tab = 'pass';
let query = '';
let openTip = null;

export function setScoringTab(k){ tab = k; query = ''; renderScoringBody(); }
export function scoringSearch(v){
  query = v;
  const el = document.getElementById('scList');
  if (el) el.innerHTML = listHTML(); else renderScoringBody();
}
export function clearScoringSearch(){
  query = '';
  renderScoringBody();
}
export function toggleTip(k){ openTip = openTip === k ? null : k; renderScoringBody(); }
export function toggleScoringFav(k){ toggleFav(k); renderScoringBody(); }

export function pickPreset(id){ if (!isCommish()) return; applyPreset(id); renderScoringBody(); }
export function resetScoring(){ if (!isCommish()) return; resetScoringToPreset(); renderScoringBody(); }

/** A yard rule is stored per-yard but entered as "1 point every N yards". */
export function setYardRule(k, yards){
  if (!isCommish()) return;
  setScoreValue(k, perYardFromYards(yards));
  renderScoringBody();
}
export function setRuleValue(k, v){
  if (!isCommish()) return;
  setScoreValue(k, v);
  renderScoringBody();
}

function ro(){ return isCommish() ? '' : ' disabled'; }

function ruleRow(r){
  const v = scoreValue(r.k);
  const fav = isFav(r.k);
  const tip = openTip === r.k;
  const input = isYardRule(r.k)
    ? `<div class="sc-yard">
         <div class="sc-yardline">1 point every
           <input class="sc-in yd" type="number" inputmode="decimal" step="1" min="0"
             value="${yardsPerPoint(v) || ''}"${ro()}
             onchange="setYardRule('${r.k}',this.value)"> yards</div>
         <div class="sc-per">${v ? (v > 0 ? '+' : '') + v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : '0'} per yard</div>
       </div>`
    : `<input class="sc-in" type="number" inputmode="decimal" step="${r.step}"
         value="${v}"${ro()} onchange="setRuleValue('${r.k}',this.value)">`;
  return `<div class="sc-row${fav ? ' fav' : ''}" data-rule="${r.k}">
    <div class="sc-lb">
      <span class="sc-star${fav ? ' on' : ''}" onclick="toggleScoringFav('${r.k}')">${fav ? '★' : '☆'}</span>
      <span class="sc-name">${escHtml(r.lb)}</span>
      <span class="sc-info${tip ? ' on' : ''}" onclick="toggleTip('${r.k}')">i</span>
    </div>
    ${input}
    ${tip ? `<div class="sc-tip">${escHtml(r.help || '')}</div>` : ''}
  </div>`;
}

function groupCard(lb, rules){
  return `<div class="set-card sc-card">
    <div class="set-title">${escHtml(lb)}</div>
    ${rules.map(ruleRow).join('')}
  </div>`;
}

function listHTML(){
  const hits = searchRules(query);
  if (hits) {
    if (!hits.length) return `<div class="sc-none">No setting matches “${escHtml(query.trim())}”</div>`;
    // search crosses categories, so each hit says where it lives
    return `<div class="sc-count">${hits.length} setting${hits.length > 1 ? 's' : ''}</div>` +
      hits.map(r => `<div class="set-card sc-card">
        <div class="sc-where">${escHtml(r.catLb)} · ${escHtml(r.group)}</div>
        ${ruleRow(r)}
      </div>`).join('');
  }
  if (tab === 'fav') {
    const favs = favourites().map(k => RULE_BY_KEY[k]).filter(Boolean);
    if (!favs.length) return `<div class="sc-none">Nothing starred yet</div>`;
    return favs.map(r => `<div class="set-card sc-card">
      <div class="sc-where">${escHtml(r.catLb)} · ${escHtml(r.group)}</div>
      ${ruleRow(r)}
    </div>`).join('');
  }
  const cat = SCORING_CATEGORIES.find(c => c.id === tab) || SCORING_CATEGORIES[0];
  return cat.groups.map(g => groupCard(g.lb, g.rules)).join('');
}

// One representative week per category, so the live line below the controls is
// about the rules you are actually looking at. These are stat lines, not point
// values — nothing here can affect a score on its own.
const SAMPLES = {
  pass: { who:'Sample QB', pos:'QB', line:'24/35, 287 yds, 2 TD, 1 INT',
          stats:{ passYd:287, passTD:2, passInt:1, passComp:24, passAtt:35, passInc:11,
                  passFD:13, passSacked:2, passCmp40:1 } },
  rush: { who:'Sample RB', pos:'RB', line:'19 car, 104 yds, 1 TD',
          stats:{ rushYd:104, rushAtt:19, rushTD:1, rushFD:5 } },
  rec:  { who:'Sample WR', pos:'WR', line:'7 rec, 98 yds, 1 TD',
          stats:{ rec:7, recYd:98, recTD:1, recFD:5, recB5:2, recB10:3, recB20:1, recB40:1 } },
  kick: { who:'Sample K', pos:'K', line:'3/4 FG, 3 PAT',
          stats:{ fgMade:3, fg20:1, fg40:1, fg50:1, fg50_59:1, fgYd:127, fgYd30:37,
                  patMade:3, fgMiss:1, fgM40:1 } },
  def:  { who:'Sample DEF', pos:'DEF', line:'13 allowed, 3 sacks, 2 TO',
          stats:{ pa7:1, ya300:1, defSack:3, defSackYd:19, defInt:1, defIntYd:12, defFR:1,
                  defFF:1, defTkl:58, defSolo:38, defAst:20, defTFL:5, defQBHit:7, defPD:6,
                  defPunt:5, def3out:3, def4th:1, paPer:13, yaPer:318 } },
  std:  { who:'Sample DEF', pos:'DEF', line:'4 returns, 96 yds',
          stats:{ stPRYd:31, stKRYd:65, stSolo:3, stFF:1 } },
  stp:  { who:'Sample RET', pos:'WR', line:'4 returns, 96 yds, 1 TD',
          stats:{ stpTD:1, stpPRYd:31, stpKRYd:65, stpSolo:2 } },
  idp:  { who:'Sample LB', pos:'LB', line:'11 tackles, 1.5 sacks, 1 INT',
          stats:{ idpTkl:11, idpSolo:8, idpAst:3, idpSack:1.5, idpSackYd:11, idpQBHit:3,
                  idpTFL:2, idpInt:1, idpIntYd:14, idpPD:3, idpFF:1, idpB10Tkl:1, idpB3PD:1 } },
  misc: { who:'Sample RB', pos:'RB', line:'1 fumble lost',
          stats:{ rushYd:64, rushAtt:14, fum:1, fumLost:1 } },
  bonus:{ who:'Sample RB', pos:'RB', line:'21 car, 128 yds, 5 rec, 44 yds',
          stats:{ rushYd:128, rushAtt:21, rec:5, recYd:44, rushFD:6, recFD:3,
                  bRush100:1, bComb100:1, bCarry20:1 } },
};

/** A live line under the controls: the same engine the app scores with, run on
 *  a sample week, so an edit above shows its effect immediately. */
function previewHTML(){
  const s = SAMPLES[tab] || SAMPLES.rec;
  const out = scoreStats(s.stats, { pos: s.pos });
  const top = out.lines.slice().sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts)).slice(0, 4);
  return `<div class="sc-prev">
    <div class="sc-prev-h"><span>${escHtml(s.who)} · ${escHtml(s.line)}</span>
      <b>${out.total.toFixed(2)}</b></div>
    <div class="sc-prev-l">${top.map(l =>
      `<span>${escHtml(l.lb)} <b>${l.pts > 0 ? '+' : ''}${l.pts}</b></span>`).join('')}</div>
  </div>`;
}

export function renderScoringBody(){
  const el = document.getElementById('scoringBody');
  if (!el) return;
  const tabs = [{ id:'fav', lb:'★' }].concat(SCORING_CATEGORIES.map(c => ({ id:c.id, lb:c.lb })));
  const preset = activePreset();
  el.innerHTML = `
    <div class="set-card">
      <div class="set-title">Preset</div>
      <div class="sc-presets">
        ${SCORING_PRESETS.map(p => `<div class="sc-preset${preset === p.id ? ' on' : ''}"
          onclick="pickPreset('${p.id}')">${escHtml(p.lb)}</div>`).join('')}
      </div>
      ${isCommish() ? `<div class="set-btns">
        <div class="set-btn" onclick="resetScoring()">${ICON_X} Reset scoring${isDirty() ? '' : ''}</div>
      </div>` : ''}
      ${isDirty() ? `<div class="set-note" style="margin-top:9px">Edited from ${escHtml((SCORING_PRESETS.find(p => p.id === preset) || {}).lb || '')}.</div>` : ''}
    </div>

    <div class="sc-search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>
      <input id="scSearch" type="search" autocomplete="off" autocapitalize="off" spellcheck="false"
        value="${escHtml(query)}" oninput="scoringSearch(this.value)">
      ${query ? `<span class="x" onclick="clearScoringSearch()">&#10005;</span>` : ''}
    </div>

    <div class="sc-tabs">${tabs.map(t =>
      `<div class="sc-tab${!query && tab === t.id ? ' on' : ''}" onclick="setScoringTab('${t.id}')">${escHtml(t.lb)}</div>`).join('')}</div>

    <div id="scList">${listHTML()}</div>
    ${previewHTML()}`;
  // eleven categories overflow a phone; slide the selected one into the strip.
  // Only `scrollLeft` — scrollIntoView would drag the page vertically too.
  const strip = el.querySelector('.sc-tabs'), on = el.querySelector('.sc-tab.on');
  if (strip && on) {
    const l = on.offsetLeft, r = l + on.offsetWidth;
    if (l < strip.scrollLeft) strip.scrollLeft = Math.max(0, l - 12);
    else if (r > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = r - strip.clientWidth + 12;
  }
  // repainting the whole body loses focus; put it back while typing
  if (query) {
    const i = document.getElementById('scSearch');
    if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }
}

/** What Settings renders for the Scoring tab. */
export function scoringCards(){
  // the body paints itself after the tab mounts, so this only reserves the node
  setTimeout(renderScoringBody, 0);
  return `<div id="scoringBody"></div>`;
}
