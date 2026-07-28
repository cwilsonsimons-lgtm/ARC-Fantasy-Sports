// ---------- REWIND SCRUBBER ----------
export function buildRewind(el,aFinal,xFinal){
  el.innerHTML=`
    <div class="rw-times"><div class="c"><b>THU</b>8:20 PM</div><div class="c"><b>SUN</b>12:00 PM</div><div class="c"><b>MON</b>8:15 PM</div></div>
    <div class="rw-track">
      <div class="rw-line"></div>
      <div class="rw-dots"></div>
      <div class="rw-handle"><div class="rw-tip"><div class="t">SUN 1:15 PM</div><div class="s"><span class="a"></span> – <span class="x"></span></div><div class="o"></div></div></div>
    </div>
    <div class="rw-live">● LIVE</div>`;
  const dots=el.querySelector('.rw-dots');
  for(let i=0;i<24;i++){const d=document.createElement('span');d.className='rw-dot';
    d.style.background=i<11?'rgba(140,224,74,.7)':i<13?'#5E6B7C':'rgba(240,69,62,.7)';dots.appendChild(d);}
  const track=el.querySelector('.rw-track'),handle=el.querySelector('.rw-handle');
  const tipA=el.querySelector('.rw-tip .a'),tipX=el.querySelector('.rw-tip .x'),
        tipT=el.querySelector('.rw-tip .t'),tipO=el.querySelector('.rw-tip .o');
  const times=['THU 8:20','FRI 2:10','SAT 4:30','SUN 12:58','SUN 1:15','SUN 3:44','SUN 8:20','MON 6:00','MON 8:15'];
  function set(pos){
    pos=Math.max(0,Math.min(1,pos));
    handle.style.left=(pos*100)+'%';
    const a=(aFinal*pos),x=(xFinal*pos);
    tipA.textContent=a.toFixed(1);tipX.textContent=x.toFixed(1);
    tipT.textContent=times[Math.round(pos*(times.length-1))];
    const odds=Math.round(50+(a-x)*1.6);
    tipO.textContent=Math.max(1,Math.min(99,odds))+'% WIN ODDS';
  }
  set(0.55);
  let drag=false;
  // buildRewind re-runs on every week/sim step; abort the previous run's window listeners
  if(el._rwAbort)el._rwAbort.abort();
  const ac=(typeof AbortController!=='undefined')?new AbortController():null;
  el._rwAbort=ac;
  const sig=ac?{signal:ac.signal}:{};
  const sigP=ac?{passive:false,signal:ac.signal}:{passive:false};
  const move=e=>{if(!drag)return;const r=track.getBoundingClientRect();
    const cx=(e.touches?e.touches[0].clientX:e.clientX);set((cx-r.left)/r.width);e.preventDefault();};
  const start=e=>{drag=true;move(e);};
  const end=()=>{drag=false;};
  handle.addEventListener('mousedown',start,sig);track.addEventListener('mousedown',start,sig);
  window.addEventListener('mousemove',move,sig);window.addEventListener('mouseup',end,sig);
  handle.addEventListener('touchstart',start,sigP);track.addEventListener('touchstart',start,sigP);
  window.addEventListener('touchmove',move,sigP);window.addEventListener('touchend',end,sig);
}
// win% bar / win% numbers are the Rewind trigger (no separate button)
export const rwOpen={};
export function toggleRewind(id){
  const rw=document.getElementById(id);if(!rw)return;
  const open=!rwOpen[id];rwOpen[id]=open;
  rw.style.display=open?'block':'none';
  document.querySelectorAll('[data-rw="'+id+'"]').forEach(e=>e.classList.toggle('rw-on',open));
  if(open&&rw.scrollIntoView)rw.scrollIntoView({block:'nearest',behavior:'smooth'});
}
// re-apply the open/closed state after a hero re-render (week step, sim step, backdrop change)
export function syncRewind(id){
  const rw=document.getElementById(id);if(!rw)return;
  const open=!!rwOpen[id];
  rw.style.display=open?'block':'none';
  document.querySelectorAll('[data-rw="'+id+'"]').forEach(e=>e.classList.toggle('rw-on',open));
}
