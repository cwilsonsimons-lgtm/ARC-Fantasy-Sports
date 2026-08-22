// The league's own regular-season shape: how many weeks, and who plays whom.
//
// This is a leaf module — it imports only the team table — so anything that
// needs the schedule (the app's week engine, the matchup-graphic builder) can
// read it without pulling in the whole app.
import { T } from './teams.js';

export const MINW = 1, MAXW = 14;

// deterministic round-robin so each week shows different matchups
export function scheduleForWeek(week){
  const ids=Object.keys(T),n=ids.length,arr=ids.slice(1),r=(week-1)%(n-1);
  const rotated=arr.map((_,i)=>arr[((i-r)%arr.length+arr.length)%arr.length]);
  const circle=[ids[0],...rotated],pairs=[];
  for(let i=0;i<n/2;i++)pairs.push([circle[i],circle[n-1-i]]);
  return pairs;
}
