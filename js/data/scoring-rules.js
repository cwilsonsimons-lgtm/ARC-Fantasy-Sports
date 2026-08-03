// ======================= SCORING CATALOG =======================
//
// The single source of truth for what a league can score. Everything else reads
// this: the settings UI builds itself from it, the engine walks it to turn a
// stat line into points, presets are keyed by it, and search and favourites
// index it.
//
// Adding a rule is adding one row here. Nothing in the engine or the UI needs
// to change — that is the point of holding the schema as data rather than as
// code, and it is why no point value appears anywhere except in a preset.
//
// Each rule:
//   k     storage key, also the stat key the engine looks for
//   lb    label
//   per   'yd' renders as "1 point every N yards (+0.0x per yard)"
//   help  what it tracks and how it is counted
//   step  input granularity (default 0.01)

export const YARD_STEP = 0.01;

export const SCORING_CATEGORIES = [
  // ---------------------------------------------------------------- passing
  { id:'pass', lb:'Passing', groups:[
    { lb:'Yardage', rules:[
      {k:'passYd', lb:'Passing Yards', per:'yd',
       help:'Every passing yard the quarterback throws for. Set as 1 point per N yards; 25 is the common default.'},
    ]},
    { lb:'Touchdowns', rules:[
      {k:'passTD', lb:'Passing TD', help:'A touchdown pass, at any distance.'},
    ]},
    { lb:'First Downs', rules:[
      {k:'passFD', lb:'Passing First Down', help:'A completion that moves the chains. Awarded on top of the yardage.'},
    ]},
    { lb:'Conversions', rules:[
      {k:'pass2pt', lb:'2 Point Conversion', help:'A successful two-point conversion pass.'},
    ]},
    { lb:'Turnovers', rules:[
      {k:'passInt', lb:'Pass Intercepted', help:'Thrown interception. Usually negative.'},
      {k:'passPick6', lb:'Pick Six Thrown', help:'An interception returned for a touchdown. Stacks with Pass Intercepted.'},
    ]},
    { lb:'Efficiency', rules:[
      {k:'passComp', lb:'Pass Completed', help:'Every completion. Small values here reward accuracy over volume.'},
      {k:'passInc', lb:'Incomplete Pass', help:'Every incompletion. Usually negative if used at all.'},
      {k:'passAtt', lb:'Pass Attempts', help:'Every attempt, complete or not.'},
      {k:'passSacked', lb:'QB Sacked', help:'Each time the quarterback is sacked.'},
    ]},
    { lb:'Bonuses', rules:[
      {k:'passCmp40', lb:'40+ Yard Completion Bonus', help:'Once per completion of 40 yards or more, on top of the yardage.'},
      {k:'passTD40', lb:'40+ Yard Passing TD Bonus', help:'Once per touchdown pass of 40 yards or more.'},
      {k:'passTD50', lb:'50+ Yard Passing TD Bonus', help:'Once per touchdown pass of 50 yards or more. Stacks with the 40+ bonus unless you set that to 0.'},
    ]},
  ]},

  // ---------------------------------------------------------------- rushing
  { id:'rush', lb:'Rushing', groups:[
    { lb:'Yardage', rules:[
      {k:'rushYd', lb:'Rushing Yards', per:'yd',
       help:'Every rushing yard. Set as 1 point per N yards; 10 is the common default.'},
    ]},
    { lb:'Touchdowns', rules:[{k:'rushTD', lb:'Rushing TD', help:'A rushing touchdown, at any distance.'}]},
    { lb:'First Downs', rules:[{k:'rushFD', lb:'Rushing First Down', help:'A carry that moves the chains.'}]},
    { lb:'Conversions', rules:[{k:'rush2pt', lb:'2 Point Conversion', help:'A successful two-point conversion run.'}]},
    { lb:'Attempts', rules:[{k:'rushAtt', lb:'Rush Attempts', help:'Every carry, regardless of result. Rewards volume.'}]},
    { lb:'Bonuses', rules:[
      {k:'rush40', lb:'40+ Yard Rush Bonus', help:'Once per carry of 40 yards or more.'},
      {k:'rushTD40', lb:'40+ Yard Rush TD Bonus', help:'Once per rushing touchdown of 40 yards or more.'},
      {k:'rushTD50', lb:'50+ Yard Rush TD Bonus', help:'Once per rushing touchdown of 50 yards or more.'},
    ]},
  ]},

  // -------------------------------------------------------------- receiving
  { id:'rec', lb:'Receiving', groups:[
    { lb:'Base', rules:[
      {k:'rec', lb:'Reception', help:'Every catch. 1 is full PPR, 0.5 is half, 0 is standard.'},
      {k:'recYd', lb:'Receiving Yards', per:'yd', help:'Every receiving yard. 10 yards per point is the common default.'},
      {k:'recTD', lb:'Receiving TD', help:'A receiving touchdown, at any distance.'},
      {k:'recFD', lb:'Receiving First Down', help:'A catch that moves the chains.'},
      {k:'rec2pt', lb:'2 Point Conversion', help:'A caught two-point conversion.'},
    ]},
    { lb:'Reception Distance Bonuses', rules:[
      {k:'recB0', lb:'0-4 Yard Reception Bonus', help:'Per catch gaining 0 to 4 yards.'},
      {k:'recB5', lb:'5-9 Yard Reception Bonus', help:'Per catch gaining 5 to 9 yards.'},
      {k:'recB10', lb:'10-19 Yard Reception Bonus', help:'Per catch gaining 10 to 19 yards.'},
      {k:'recB20', lb:'20-29 Yard Reception Bonus', help:'Per catch gaining 20 to 29 yards.'},
      {k:'recB30', lb:'30-39 Yard Reception Bonus', help:'Per catch gaining 30 to 39 yards.'},
      {k:'recB40', lb:'40+ Yard Reception Bonus', help:'Per catch gaining 40 yards or more.'},
    ]},
    { lb:'Touchdown Bonuses', rules:[
      {k:'recTD40', lb:'40+ Yard Reception TD Bonus', help:'Once per receiving touchdown of 40 yards or more.'},
      {k:'recTD50', lb:'50+ Yard Reception TD Bonus', help:'Once per receiving touchdown of 50 yards or more.'},
    ]},
    { lb:'Position Reception Bonuses', rules:[
      {k:'recRB', lb:'Reception Bonus - RB', help:'Extra per catch when the receiver is a running back. Stacks with Reception.'},
      {k:'recWR', lb:'Reception Bonus - WR', help:'Extra per catch when the receiver is a wide receiver.'},
      {k:'recTE', lb:'Reception Bonus - TE', help:'Extra per catch when the receiver is a tight end. The usual TE premium.'},
    ]},
  ]},

  // ---------------------------------------------------------------- kicking
  { id:'kick', lb:'Kicking', groups:[
    { lb:'Field Goals', rules:[
      {k:'fgMade', lb:'FG Made', help:'Every made field goal, before any distance band is applied.'},
      {k:'fg0', lb:'FG Made (0-19)', help:'Additional for a make from inside 20 yards.'},
      {k:'fg20', lb:'FG Made (20-29)', help:'Additional for a make from 20 to 29 yards.'},
      {k:'fg30', lb:'FG Made (30-39)', help:'Additional for a make from 30 to 39 yards.'},
      {k:'fg40', lb:'FG Made (40-49)', help:'Additional for a make from 40 to 49 yards.'},
      {k:'fg50_59', lb:'FG Made (50-59)', help:'Additional for a make from 50 to 59 yards.'},
      {k:'fg50', lb:'FG Made (50+)', help:'Additional for any make of 50 yards or more. Use this or the 50-59/60+ pair, not both.'},
      {k:'fg60', lb:'FG Made (60+)', help:'Additional for a make from 60 yards or more.'},
      {k:'fgYd', lb:'Points Per FG Yard', per:'yd', help:'Per yard of every made field goal. Distance scoring without bands.'},
      {k:'fgYd30', lb:'Points Per FG Yard Over 30', per:'yd', help:'Per yard beyond 30 on a made field goal. A 45-yarder counts 15 yards.'},
    ]},
    { lb:'Extra Points', rules:[{k:'patMade', lb:'PAT Made', help:'Every made extra point.'}]},
    { lb:'Misses', rules:[
      {k:'fgMiss', lb:'FG Missed', help:'Every missed field goal, before any distance band.'},
      {k:'fgM0', lb:'FG Missed (0-19)', help:'Additional for a miss from inside 20 yards.'},
      {k:'fgM20', lb:'FG Missed (20-29)', help:'Additional for a miss from 20 to 29 yards.'},
      {k:'fgM30', lb:'FG Missed (30-39)', help:'Additional for a miss from 30 to 39 yards.'},
      {k:'fgM40', lb:'FG Missed (40-49)', help:'Additional for a miss from 40 to 49 yards.'},
      {k:'fgM50_59', lb:'FG Missed (50-59)', help:'Additional for a miss from 50 to 59 yards.'},
      {k:'fgM50', lb:'FG Missed (50+)', help:'Additional for any miss of 50 yards or more.'},
      {k:'fgM60', lb:'FG Missed (60+)', help:'Additional for a miss from 60 yards or more.'},
      {k:'patMiss', lb:'PAT Missed', help:'Every missed extra point.'},
    ]},
  ]},

  // ----------------------------------------------------------- team defense
  { id:'def', lb:'Team Defense', groups:[
    { lb:'Touchdowns', rules:[{k:'defTD', lb:'Defense TD', help:'Any defensive score: interception, fumble or blocked kick returned in.'}]},
    { lb:'Points Allowed', rules:[
      {k:'pa0', lb:'Points Allowed 0', help:'A shutout: the defence gave up no points at all.'},
      {k:'pa1', lb:'Points Allowed 1-6', help:'The unit allows 1 to 6 points.'},
      {k:'pa7', lb:'Points Allowed 7-13', help:'The unit allows 7 to 13 points.'},
      {k:'pa14', lb:'Points Allowed 14-20', help:'The unit allows 14 to 20 points.'},
      {k:'pa21', lb:'Points Allowed 21-27', help:'The unit allows 21 to 27 points.'},
      {k:'pa28', lb:'Points Allowed 28-34', help:'The unit allows 28 to 34 points.'},
      {k:'pa35', lb:'Points Allowed 35+', help:'The unit allows 35 or more. Usually negative.'},
      {k:'paPer', lb:'Points Per Point Allowed', help:'Applied per point conceded, instead of the bands above. Usually negative.'},
    ]},
    { lb:'Total Yards Allowed', rules:[
      {k:'ya0', lb:'Less Than 100', help:'Total yards allowed under 100.'},
      {k:'ya100', lb:'100-199', help:'Total yards allowed 100 to 199.'},
      {k:'ya200', lb:'200-299', help:'Total yards allowed 200 to 299.'},
      {k:'ya300', lb:'300-349', help:'Total yards allowed 300 to 349.'},
      {k:'ya350', lb:'350-399', help:'Total yards allowed 350 to 399.'},
      {k:'ya400', lb:'400-449', help:'Total yards allowed 400 to 449.'},
      {k:'ya450', lb:'450-499', help:'Total yards allowed 450 to 499.'},
      {k:'ya500', lb:'500-549', help:'Total yards allowed 500 to 549.'},
      {k:'ya550', lb:'550+', help:'Total yards allowed 550 or more.'},
      {k:'yaPer', lb:'Points Per Yard Allowed', per:'yd', help:'Applied per yard conceded, instead of the bands above.'},
    ]},
    { lb:'Defensive Stops', rules:[
      {k:'def3out', lb:'3 and Out', help:'A drive forced to punt after three plays.'},
      {k:'def4th', lb:'4th Down Stop', help:'A fourth-down attempt stopped short.'},
    ]},
    { lb:'Pressure', rules:[
      {k:'defSack', lb:'Sack', help:'Every team sack.'},
      {k:'defSackYd', lb:'Sack Yards', per:'yd', help:'Per yard lost on sacks.'},
      {k:'defQBHit', lb:'Hit on QB', help:'Every recorded quarterback hit.'},
    ]},
    { lb:'Turnovers', rules:[
      {k:'defInt', lb:'Interception', help:'Every interception by the unit.'},
      {k:'defIntYd', lb:'INT Return Yards', per:'yd', help:'Per yard of interception returns.'},
      {k:'defFF', lb:'Forced Fumble', help:'Every fumble forced, recovered or not.'},
      {k:'defFR', lb:'Fumble Recovery', help:'Every fumble recovered.'},
      {k:'defFRYd', lb:'Fumble Return Yards', per:'yd', help:'Per yard of fumble returns.'},
    ]},
    { lb:'Tackles', rules:[
      {k:'defTkl', lb:'Tackle', help:'Any tackle, solo or assisted.'},
      {k:'defSolo', lb:'Solo Tackle', help:'Unassisted tackles only.'},
      {k:'defAst', lb:'Assisted Tackle', help:'Assists only.'},
      {k:'defTFL', lb:'Tackle For Loss', help:'A tackle behind the line of scrimmage.'},
    ]},
    { lb:'Miscellaneous', rules:[
      {k:'defSafety', lb:'Safety', help:'Every safety.'},
      {k:'defBlk', lb:'Blocked Kick', help:'A blocked punt, field goal or extra point.'},
      {k:'defPunt', lb:'Forced Punt', help:'Every drive that ends in a punt.'},
      {k:'defPD', lb:'Pass Defended', help:'Every pass broken up.'},
      {k:'def2ptRet', lb:'2 Point Conversion Returns', help:'A failed conversion returned the other way for two.'},
      {k:'defFGRetYd', lb:'Missed FG Return Yards', per:'yd', help:'Per yard returning a missed field goal.'},
      {k:'defBlkRetYd', lb:'Blocked Kick Return Yards', per:'yd', help:'Per yard returning a blocked kick.'},
    ]},
  ]},

  // -------------------------------------------------- special teams defense
  { id:'std', lb:'ST Defense', groups:[
    { lb:'Special Teams Defense', rules:[
      {k:'stTD', lb:'Special Teams TD', help:'A kick or punt returned for a score by the unit.'},
      {k:'stFF', lb:'Special Teams Forced Fumble', help:'A fumble forced on a return.'},
      {k:'stFR', lb:'Special Teams Fumble Recovery', help:'A fumble recovered on a return.'},
      {k:'stSolo', lb:'Special Teams Solo Tackle', help:'An unassisted tackle in coverage.'},
      {k:'stPRYd', lb:'Punt Return Yards', per:'yd', help:'Per yard of punt returns by the unit.'},
      {k:'stKRYd', lb:'Kick Return Yards', per:'yd', help:'Per yard of kick returns by the unit.'},
    ]},
  ]},

  // --------------------------------------------------- special teams player
  { id:'stp', lb:'ST Player', groups:[
    { lb:'Special Teams Player', rules:[
      {k:'stpTD', lb:'Special Teams Player TD', help:'A return touchdown credited to the individual returner.'},
      {k:'stpFF', lb:'Special Teams Player Forced Fumble', help:'A fumble the player forces on special teams.'},
      {k:'stpFR', lb:'Special Teams Player Fumble Recovery', help:'A fumble the player recovers on special teams.'},
      {k:'stpSolo', lb:'Special Teams Player Solo Tackle', help:'An unassisted special teams tackle by the player.'},
      {k:'stpPRYd', lb:'Player Punt Return Yards', per:'yd', help:'Per punt return yard by the player.'},
      {k:'stpKRYd', lb:'Player Kick Return Yards', per:'yd', help:'Per kick return yard by the player.'},
    ]},
  ]},

  // -------------------------------------------------------------------- IDP
  { id:'idp', lb:'IDP', groups:[
    { lb:'Touchdowns', rules:[{k:'idpTD', lb:'IDP TD', help:'A defensive touchdown credited to the individual player.'}]},
    { lb:'Sacks', rules:[
      {k:'idpSack', lb:'Sack', help:'Every sack by the player. Half-sacks count 0.5.'},
      {k:'idpSackYd', lb:'Sack Yards', per:'yd', help:'Per yard lost on the player’s sacks.'},
      {k:'idpQBHit', lb:'Hit on QB', help:'Every quarterback hit by the player.'},
    ]},
    { lb:'Tackles', rules:[
      {k:'idpTkl', lb:'Tackle', help:'Any tackle, solo or assisted.'},
      {k:'idpSolo', lb:'Solo Tackle', help:'Unassisted tackles only.'},
      {k:'idpAst', lb:'Assisted Tackle', help:'Assists only.'},
      {k:'idpTFL', lb:'Tackle For Loss', help:'A tackle behind the line of scrimmage.'},
    ]},
    { lb:'Turnovers', rules:[
      {k:'idpInt', lb:'Interception', help:'Every interception by the player.'},
      {k:'idpIntYd', lb:'INT Return Yards', per:'yd', help:'Per yard of the player’s interception returns.'},
      {k:'idpFF', lb:'Forced Fumble', help:'Every fumble the player forces.'},
      {k:'idpFR', lb:'Fumble Recovery', help:'Every fumble the player recovers.'},
      {k:'idpFRYd', lb:'Fumble Return Yards', per:'yd', help:'Per yard of the player’s fumble returns.'},
    ]},
    { lb:'Miscellaneous', rules:[
      {k:'idpPD', lb:'Pass Defended', help:'Every pass the player breaks up.'},
      {k:'idpSafety', lb:'Safety', help:'Every safety the player records.'},
      {k:'idpBlk', lb:'Blocked Punt / PAT / FG', help:'Any kick the player blocks.'},
    ]},
    { lb:'IDP Bonuses', rules:[
      {k:'idpB10Tkl', lb:'10+ Tackle Bonus', help:'Once, when the player finishes with 10 or more tackles.'},
      {k:'idpB2Sack', lb:'2+ Sack Bonus', help:'Once, at two or more sacks.'},
      {k:'idpB3PD', lb:'3+ Pass Defended Bonus', help:'Once, at three or more passes defended.'},
      {k:'idpBInt50', lb:'50+ Yard Interception Return TD Bonus', help:'Once per pick six of 50 yards or more.'},
      {k:'idpBFum50', lb:'50+ Yard Fumble Return TD Bonus', help:'Once per fumble return touchdown of 50 yards or more.'},
    ]},
  ]},

  // ---------------------------------------------------------------- general
  { id:'misc', lb:'Misc', groups:[
    { lb:'Miscellaneous', rules:[
      {k:'fum', lb:'Fumble', help:'Every fumble, recovered by either side.'},
      {k:'fumLost', lb:'Fumble Lost', help:'A fumble the other team recovers. Stacks with Fumble.'},
      {k:'fumTD', lb:'Fumble Recovery TD', help:'An offensive player recovering a fumble in the end zone.'},
    ]},
  ]},

  // ---------------------------------------------------------------- bonuses
  { id:'bonus', lb:'Bonuses', groups:[
    { lb:'Yardage Bonuses', rules:[
      {k:'bRush100', lb:'100-199 Yard Rushing Game', help:'Once, for finishing the week with 100 to 199 rushing yards.'},
      {k:'bRush200', lb:'200+ Yard Rushing Game', help:'Once, at 200 or more rushing yards.'},
      {k:'bRec100', lb:'100-199 Yard Receiving Game', help:'Once, for 100 to 199 receiving yards.'},
      {k:'bRec200', lb:'200+ Yard Receiving Game', help:'Once, at 200 or more receiving yards.'},
      {k:'bPass300', lb:'300-399 Yard Passing Game', help:'Once, for 300 to 399 passing yards.'},
      {k:'bPass400', lb:'400+ Yard Passing Game', help:'Once, at 400 or more passing yards.'},
      {k:'bComb100', lb:'100-199 Combined Rush + Receiving', help:'Once, for 100 to 199 rushing and receiving yards together.'},
      {k:'bComb200', lb:'200+ Combined Rush + Receiving', help:'Once, at 200 or more combined.'},
    ]},
    { lb:'Usage Bonuses', rules:[
      {k:'bComp25', lb:'25+ Pass Completions', help:'Once, at 25 or more completions.'},
      {k:'bCarry20', lb:'20+ Carries', help:'Once, at 20 or more carries.'},
    ]},
    { lb:'First Down Bonuses', rules:[
      {k:'fdQB', lb:'First Down Bonus - QB', help:'Extra per first down when the player is a quarterback.'},
      {k:'fdRB', lb:'First Down Bonus - RB', help:'Extra per first down when the player is a running back.'},
      {k:'fdWR', lb:'First Down Bonus - WR', help:'Extra per first down when the player is a wide receiver.'},
      {k:'fdTE', lb:'First Down Bonus - TE', help:'Extra per first down when the player is a tight end.'},
    ]},
  ]},
];

/** Flat index: key -> rule, with its category and group attached. */
export const RULE_BY_KEY = {};
export const ALL_RULES = [];
SCORING_CATEGORIES.forEach(cat => cat.groups.forEach(g => g.rules.forEach(r => {
  const rule = Object.assign({ cat: cat.id, catLb: cat.lb, group: g.lb, step: r.per === 'yd' ? YARD_STEP : 0.01 }, r);
  RULE_BY_KEY[r.k] = rule;
  ALL_RULES.push(rule);
})));

export function isYardRule(k){ const r = RULE_BY_KEY[k]; return !!(r && r.per === 'yd'); }
/** "1 point every N yards" is the inverse of the stored per-yard value. */
export function yardsPerPoint(v){
  const n = Math.abs(+v || 0);
  return n ? Math.round((1 / n) * 100) / 100 : 0;
}
export function perYardFromYards(y){
  const n = Math.abs(+y || 0);
  return n ? Math.round((1 / n) * 10000) / 10000 : 0;
}
