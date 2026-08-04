import { S } from './state.js';
import { stadiumHeroHTML } from './hero.js';
import { detailStartersHTML } from './lineup.js';
import { medianStripHTML } from './median.js';
import { showView } from './nav.js';
import { buildRewind, syncRewind } from './rewind.js';

// ---------- DETAIL VIEW ----------
export function openDetail(i){
  const g=S.games[i];
  const dh=document.getElementById('detailHero');dh.className='';
  dh.innerHTML=stadiumHeroHTML(g.a,g.x,g.as,g.xs,g.aw,g.xw,null,null,{editBackdrop:true,rewind:'detailRewind'});
  buildRewind(document.getElementById('detailRewind'),g.as,g.xs);
  syncRewind('detailRewind');
  document.getElementById('detailStarters').innerHTML=
    medianStripHTML(g.a,g.x,S.week)+detailStartersHTML();
  showView('detail');
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  document.getElementById('scroll').scrollTop=0;
}
