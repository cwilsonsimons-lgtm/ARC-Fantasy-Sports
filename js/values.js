import { NFL_BY_ID } from './data/nfl-players.js';

// ======================= TRADE VALUES =======================
// A local, static value table in the KeepTradeCut mould: one number per asset,
// on a 0–10,000 scale. Seed data, hardcoded — nothing here calls out.
//
// The seed covers the names a trade actually gets built around. Everyone else
// falls off an ADP curve fitted to the same scale, so the evaluator has a
// number for all ~900 players in the pool rather than a hole.

export const VALUES={
  // QB
  'Josh Allen':7900,'Lamar Jackson':7450,'Jayden Daniels':7800,'Patrick Mahomes':6900,
  'Joe Burrow':6600,'Jalen Hurts':6350,'Justin Herbert':5100,'Caleb Williams':5250,
  'C.J. Stroud':5600,'Drake Maye':5900,'Bo Nix':4300,'Brock Purdy':4100,
  'Dak Prescott':3600,'Kyler Murray':3400,'Baker Mayfield':3300,'Justin Fields':2400,
  'Matthew Stafford':1900,'Aaron Rodgers':900,'Bryce Young':2600,'Jalen Milroe':2300,
  // RB
  'Bijan Robinson':9600,'Jahmyr Gibbs':9300,'Saquon Barkley':8200,'De\'Von Achane':7600,
  'Ashton Jeanty':8900,'Christian McCaffrey':6100,'Jonathan Taylor':7100,'Derrick Henry':4700,
  'Josh Jacobs':6200,'Kenneth Walker':5200,'Breece Hall':5400,'James Cook':6000,
  'Bucky Irving':6800,'Omarion Hampton':6500,'TreVeyon Henderson':6300,'Quinshon Judkins':5800,
  'Chase Brown':5000,'Kyren Williams':4600,'Joe Mixon':3300,'Rhamondre Stevenson':2600,
  'Javonte Williams':2900,'Chuba Hubbard':3100,'Travis Etienne':3000,'Tyjae Spears':1800,
  'Bhayshul Tuten':3400,'Kaleb Johnson':3500,'Trey Benson':3700,'Rico Dowdle':2700,
  'Brian Robinson':2100,'Ollie Gordon':1700,
  // WR
  'Ja\'Marr Chase':9800,'Justin Jefferson':9500,'CeeDee Lamb':8800,'Malik Nabers':9100,
  'Puka Nacua':8600,'Amon-Ra St. Brown':8000,'Nico Collins':7300,'Brian Thomas':8400,
  'Drake London':7700,'Rome Odunze':6400,'Marvin Harrison':7000,'Ladd McConkey':6700,
  'Tyreek Hill':4200,'Garrett Wilson':7200,'A.J. Brown':5500,'Jaxon Smith-Njigba':7500,
  'Tetairoa McMillan':6600,'Travis Hunter':6900,'Matthew Golden':5700,'George Pickens':5300,
  'DK Metcalf':4400,'Michael Pittman':3200,'Keenan Allen':1600,'Jalen McMillan':2200,
  'Malik Washington':1900,'Luke McCaffrey':1500,'Parker Washington':1400,'Zay Flowers':5900,
  // TE
  'Brock Bowers':8300,'Trey McBride':7400,'Sam LaPorta':4900,'Kyle Pitts':2800,
  'George Kittle':4000,'Travis Kelce':2000,'Dalton Kincaid':3000,'T.J. Hockenson':3300,
  'Colston Loveland':4500,'Tyler Warren':4800,'Dallas Goedert':1700,'Pat Freiermuth':1600,
  'Oronde Gadsden':3600,'Theo Johnson':1800,'Jake Tonges':1200,
};

/** Off-curve fallback: ADP 1 ≈ 9,000 decaying to a few hundred by the end of a
 *  10-team board. Same shape as the seed, so a mixed deal still ranks sensibly. */
export function adpValue(adp){
  if(!adp||adp>=999)return 150;
  return Math.max(150,Math.round(9000*Math.exp(-adp/58)));
}
export function playerValue(p){
  if(!p)return 0;
  const full=p.full||(p.id&&NFL_BY_ID[p.id]&&NFL_BY_ID[p.id].full)||p.n;
  if(VALUES[full]!=null)return VALUES[full];
  const rec=p.id?NFL_BY_ID[p.id]:null;
  return adpValue(p.adp!=null?p.adp:(rec?rec.adp:null));
}

// ---- draft picks ----
// A pick is worth its round, discounted the further out the year sits.
export const CURRENT_YEAR=2026;
export const PICK_BASE={1:4200,2:2100,3:1050,4:520};
export function pickValue(pk){
  if(!pk)return 0;
  const base=PICK_BASE[pk.round]||300;
  const yrs=Math.max(0,(pk.year||CURRENT_YEAR)-CURRENT_YEAR);
  const v=Math.round(base*Math.pow(0.86,yrs));
  // A conditional pick is priced between what it is and what it becomes: the
  // upgrade is not free, and it is not certain either.
  if(pk.cond&&pk.cond.upgradeTo){
    const up=PICK_BASE[+pk.cond.upgradeTo]||base;
    const odds={playoffs:0.55,championship:0.25,points_threshold:0.4}[pk.cond.trigger]||0.35;
    return Math.round(v+(Math.round(up*Math.pow(0.86,yrs))-v)*odds);
  }
  return v;
}
export function assetValue(a){return a.kind==='pick'?pickValue(a.pick):playerValue(a.player);}
export function sideValue(list){return (list||[]).reduce((n,a)=>n+assetValue(a),0);}

/** red / yellow / green, from how lopsided the two sides are. */
export function verdictFor(inV,outV){
  const tot=inV+outV;
  const gap=tot?Math.abs(inV-outV)/tot:0;
  if(!tot)return {tone:'flat',pct:50,line:'No assets'};
  const pct=Math.round(inV/tot*100);
  if(gap<=0.06)return {tone:'green',pct,line:'Even deal'};
  if(gap<=0.18)return {tone:'yellow',pct,line:inV>outV?'Slight win for you':'Slight win for them'};
  return {tone:'red',pct,line:inV>outV?'Heavily in your favour':'Heavily against you'};
}
