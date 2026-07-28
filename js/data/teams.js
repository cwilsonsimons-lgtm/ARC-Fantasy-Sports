// ---------- DATA ----------
export const T = {
  pandas:{n:'UGF Pandas',mgr:'Wilson',rec:'0-0',rk:3,c:'#8CE04A',bg:'#1c3312',mono:'P',font:'oswald'},
  radiator:{n:'Radiator Springs',mgr:'Benton',rec:'0-0',rk:6,c:'#F0453E',bg:'#331414',mono:'R',font:'slab'},
  barzal:{n:"Barzal's Balls",mgr:'Luke',rec:'0-0',rk:1,c:'#5AA9E6',bg:'#1a2c3d',mono:'B',font:'bebas'},
  dakyard:{n:'Dakyard Football',mgr:'Jake',rec:'0-0',rk:10,c:'#E6A85A',bg:'#3d2f1a',mono:'D',font:'elite'},
  boutte:{n:'Diggin in Boutte',mgr:'Jatin',rec:'0-0',rk:4,c:'#5AE6B5',bg:'#1a3d33',mono:'D',font:'marker'},
  burrow:{n:'Seriously Step Burrow',mgr:'Jarren',rec:'0-0',rk:7,c:'#E65A7A',bg:'#3d1a26',mono:'S',font:'archivo'},
  saquon:{n:'Saquon My Balls',mgr:'Cam',rec:'0-0',rk:2,c:'#C77DFF',bg:'#2c1a3d',mono:'S',font:'bungee'},
  brady:{n:'Brady Bunch',mgr:'Manas',rec:'0-0',rk:9,c:'#7D9BFF',bg:'#1a2340',mono:'B',font:'playfair'},
  longhorns:{n:'Texas Longhorns',mgr:'Mason',rec:'0-0',rk:8,c:'#E6845A',bg:'#3d271a',mono:'T',font:'anton'},
  doghouse:{n:"Mike Vick's Dog House",mgr:'Seabass',rec:'0-0',rk:5,c:'#E6D15A',bg:'#3d381a',mono:'M',font:'creep'},
};
export const MY_TEAM='pandas';
// ---- team identity fonts ----
// Each manager picks a typeface; it renders wherever their team name appears.
// sc = optical size correction (some faces run much larger/smaller at the same px)
// tt = text-transform, ls = letter-spacing. Keeps every face sitting on the same line height.
export const TEAM_FONTS=[
  {k:'oswald',  lb:'Broadcast',  ff:"'Oswald'",            w:700, sc:1.00, tt:'uppercase', ls:'.4px'},
  {k:'anton',   lb:'Stadium',    ff:"'Anton'",             w:400, sc:0.94, tt:'uppercase', ls:'.3px'},
  {k:'bebas',   lb:'Marquee',    ff:"'Bebas Neue'",        w:400, sc:1.10, tt:'uppercase', ls:'.6px'},
  {k:'archivo', lb:'Heavyweight',ff:"'Archivo Black'",     w:400, sc:0.86, tt:'uppercase', ls:'0'},
  {k:'slab',    lb:'Ballpark',   ff:"'Alfa Slab One'",     w:400, sc:0.84, tt:'uppercase', ls:'0'},
  {k:'bungee',  lb:'Signage',    ff:"'Bungee'",            w:400, sc:0.80, tt:'uppercase', ls:'0'},
  {k:'marker',  lb:'Sharpie',    ff:"'Permanent Marker'",  w:400, sc:0.92, tt:'none',      ls:'0'},
  {k:'creep',   lb:'Horror',     ff:"'Creepster'",         w:400, sc:1.06, tt:'none',      ls:'.5px'},
  {k:'arcade',  lb:'Arcade',     ff:"'Press Start 2P'",    w:400, sc:0.62, tt:'uppercase', ls:'0'},
  {k:'playfair',lb:'Broadsheet', ff:"'Playfair Display'",  w:900, sc:1.02, tt:'none',      ls:'0'},
  {k:'elite',   lb:'Typewriter', ff:"'Special Elite'",     w:400, sc:0.98, tt:'uppercase', ls:'.3px'},
  {k:'rubik',   lb:'Blockletter',ff:"'Rubik Mono One'",    w:400, sc:0.80, tt:'uppercase', ls:'0'},
  {k:'monoton', lb:'Neon',       ff:"'Monoton'",           w:400, sc:0.98, tt:'uppercase', ls:'.5px'},
];
export const FONT_BY_KEY={};TEAM_FONTS.forEach(f=>FONT_BY_KEY[f.k]=f);
export function teamFont(key){return FONT_BY_KEY[(T[key]&&T[key].font)||'oswald']||FONT_BY_KEY.oswald;}
// one class per team; every team-name element carries it
export function teamFontCSS(){
  return Object.keys(T).map(k=>{const f=teamFont(k);
    return `.tf-${k}{font-family:${f.ff},'Oswald',sans-serif;font-weight:${f.w};`
      +`font-size:calc(var(--tn-size,14px) * ${f.sc});text-transform:${f.tt};letter-spacing:${f.ls}}`;
  }).join('');
}
export function applyTeamFonts(){
  let el=document.getElementById('teamFontCSS');
  if(!el){el=document.createElement('style');el.id='teamFontCSS';document.head.appendChild(el);}
  el.textContent=teamFontCSS();
}
