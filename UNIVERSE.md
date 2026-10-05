# Universe

A companion app for WWE 2K25's Universe Mode. The owner plans each show and
books its card here, watches the CPU play the matches in the game, then enters
what happened. The game is the only source of truth for results: this app never
simulates a match, picks a winner or talks to the game. And the owner is exactly that — someone who sees every wrestler,
relationship and result — not a GM character inside the universe, so there is
no in-world viewpoint or hidden information anywhere in the model. Around the
matches, a story director fills in the rest of the story by itself — attacks,
saves, betrayals, alliances, challenges — from the record, as canon, without
ever touching a result. Shows sit in tiers — the main roster, NXT, Evolve, and
any below — with editable rules for moving up and down between each two. An
auto booker drafts a whole card for any show, each match with why it was
chosen, for the owner to change and book — and it follows the story: what the
director does makes matches likely, feuds move on through different matches
over weeks, and whatever the CPU decides changes what comes next.

It's a standalone app. It shares this repository with the City Boys Dynasty
fantasy league (see [README.md](README.md)) only for the build and test
tooling: no code, no page, no styles and no saved data pass between them.

## Running it

**Just want to use it?** Open `dist/universe.html` — the whole app in one
self-contained file, so double-clicking it works, with no network needed.
Rebuild it with `npm run build` (which builds both apps) after changing
anything under `js/universe/` or `css/universe.css`.

**Working on the code?** The source is plain ES modules, which browsers refuse
to load over `file://`, so it needs serving:

```
npm start          # then open http://127.0.0.1:8080/universe.html
```

**On claude.ai.** `dist/universe-artifact.html` is the same app built for
publishing as a claude.ai artifact (claude.ai supplies the surrounding
document, so it's the page's content only). Published there, the universe is
kept in your claude.ai account instead of one browser — see Saving.

```
universe.html          the page
css/universe.css       its whole stylesheet (plus Oswald and Barlow from css/fonts.css)
css/universe-artifact.css   the few overrides for the claude.ai build
js/universe/
  main.js              entry point
  model.js             the data and every rule about it - pure, runs under Node
  persist.js           saving, loading, export and import
  cloud.js             the claude.ai copy, when published as an artifact
  app.js               commit (change + save + repaint), sheets, the page stack
  index.js             start-up, tabs, the Go to sheet, the save-file sheet and restore points
  views.js             the tabs: Calendar, Roster, Teams, Titles, History
  personality.js       traits, relationships, the page for two wrestlers, incidents
  story.js             the story director on screen: What happened, a show's Before/After, the log, settings
  director.js          the story director itself - pure, seeded, runs under Node
  relations.js         relationships worked out from the record - pure, runs under Node
  ranks.js             the Rankings tab: standings and booking balance
  standings.js         the arithmetic behind it - pure, runs under Node
  relegation.js        the season transition page, its relegation and rules parts
  promotion.js         its promotion and transfer window parts, and the draft
  tiers.js             Tiers & transfers: the tiers, their shows, and each connection's rules
  card.js              a show's page and match card; the booking / result form (and a draft match's)
  booker.js            the auto booker itself - pure, seeded, runs under Node
  storylines.js        every feud worked out from the record: beats, chapters, who's drawn in - pure, runs under Node
  autobook.js          the auto booker on screen: a show's draft card, drafting a week, each show's settings
  simulate.js          simulate ahead: the next weeks played on a copy, and what changed - pure, seeded, runs under Node
  ahead.js             the Simulate ahead page
  pages.js             profile pages: a wrestler, a team, a title
  edits.js             the sheets behind the profiles
  sheets.js            creating wrestlers, teams and titles; the season clock
  find.js              the search beside long wrestler and team dropdowns
  ui.js                small HTML building blocks
tools/universe-test.mjs       166 model tests     npm run test:universe
tools/universe-check.mjs      228 browser checks  npm run check:universe
tools/universe-sample.mjs     a whole sample season, shared by the tests and the checks
tools/universe-story-demo.mjs a few weeks of the story director, printed  npm run demo:story
tools/universe-tiers-demo.mjs a fourth tier from nothing, played through  npm run demo:tiers
tools/universe-booker-demo.mjs a week of draft cards on every show, printed  npm run demo:booker
tools/universe-feud-demo.mjs  a feud over five weeks: director, booker, the CPU  npm run demo:feud
tools/fixtures/universe-v1.json   real version 1 and 2 saves, written by the code
tools/fixtures/universe-v2.json   of those versions, for the migration tests
```

## The workflow

1. **Set up.** Add wrestlers (paste a whole roster at once) to Raw, SmackDown,
   Dynamite, NXT and Evolve — any sizes. Add tag teams and titles, and crown the
   champions. Give wrestlers traits if you like.
2. **Each week.** The Calendar opens on the week, with **Up next** — today's
   show. Plan an episode: the story director decides what happens **before the
   show** (a confrontation, a title demand…), so you can book the card around
   it. Book it yourself, or **Draft the card** (or the whole week's cards) with
   the auto booker, change what you like, and book that. Play the matches in
   WWE 2K25, then enter each result as the game produced it; once the card is
   complete the director decides what happens **after**
   (an attack, a save, a betrayal…). Record anything else you saw yourself. Tap
   **Next week** when it's done.
3. **Keep track.** **What happened** (on the Calendar's season card) is the
   story so far. Rankings (standings and booking balance), Titles, Roster (and
   its Relationships view) and History all read the record. None of them books
   or decides a match.
4. **After WrestleMania.** Start the season transition from WrestleMania's page.
   It runs by the tier rules (**Tiers & transfers**): relegation matches on each
   main show's next episode, NXT qualifiers, then the transfer window and the
   draft. Close the window, then start the next season.
5. **Anything wrong?** Correct it where it happened — the result, the incident,
   the pick. Everything built on it follows, or is flagged for you.

The **Go to** button (top right, beside the save button) reaches every part of
this from anywhere, with where each stands.

## Rules at a glance

What the app does by itself — each is explained in its own section below and
in the app's "How it works" sheets.

- **Results** come only from you. A match is booked until you enter a result;
  the form starts blank. Only played matches count.
- **Records.** Singles when your own side was just you; tag when you had a
  partner. A team's record counts only matches as that team. W–L–D, with no
  contests alongside.
- **Titles** change only when a result says so. History runs in calendar
  order; a title change can't be undone while a later one depends on it. After
  a correction, a title match the champion of the day wasn't in, or a title
  change the outgoing champion wasn't part of, is flagged on the title's page.
- **Rankings**: (W + ½D + 1) ÷ (W + L + D + 2), by show and division; ties to
  more wins, then fewer losses. **Booking balance** flags a rate at most half
  of the show's typical and 2+ matches short. Neither ever limits booking.
- **Tiers**: tier 1 (Raw, SmackDown, Dynamite), tier 2 (NXT), tier 3 (Evolve),
  and any you add. Between each two, editable rules for relegation, qualifying,
  champions, titles, timing and destinations. A transition keeps the rules it
  started with.
- **Relegation** (main roster → NXT, as it starts): on each main show, the
  fewest wins up to and including WrestleMania (default 2 candidates) face each
  other on its next episode; the loser moves down on the result. Candidates are
  fixed when booked; a later correction to the win totals is shown against
  them, never applied.
- **Promotion** (NXT → main roster, as it starts): NXT champions are eligible
  when the window opens; qualifier winners are eligible on the result.
  Eligibility moves nobody — the draft does. A qualifier can't change once its
  winner is drafted, or while the window is closed. Evolve's champions are set
  to move up to NXT by themselves, titles vacated — kept as the rule, not
  carried out yet.
- **The auto booker** drafts; it never books. A draft is on the show's page
  until you book it, counts for nothing meanwhile, and books exactly as you
  left it. It never picks a winner. It reads the story director's events and
  every feud's storyline, so they shape the next cards.
- **Relationships** are worked out from the record (losses, title defeats,
  teaming, splits, incidents) plus your edits. Traits never change on their own.
- **The story director** records what happens around each show by itself, as
  canon: occasional, varied, each event with its cause; betrayals, breakups and
  turns only after buildup; seeded and logged. It never enters or changes a
  result, never awards a title, never moves anyone between shows. Anything it
  does can be edited, undone or run again.
- **Saving** is automatic in the browser (and to your claude.ai account when
  published); save files are checked before they're imported; restore points
  are kept in the browser before anything big replaces the universe.

## Decisions left to you

Everything the app won't decide, and where it asks:

| Decision | Where |
|---|---|
| Every result: the winner, the finish, who took the fall, whether a title changed hands (a DQ or a cash-in is your call) | The result form |
| Who wrestles whom, which titles are on the line, when shows air | The calendar and the card — rankings and booking balance only inform, a story event's **Book the match** only fills in the form, and the auto booker only drafts |
| Anything on a draft card: every match, who's in it, the order, the stipulation, the title, taking one off, adding your own, drawing one again, who isn't at the show — and whether to book it | The show's page |
| How each show's cards are drafted: how many matches (weekly and at a premium live event), which kinds, how many title matches, how often a stipulation | Auto booker → the show (or the draft's **Settings**) |
| Whether a pairing wrestled as a registered tag team | The result form ("Wrestling as …?") |
| Traits, and any relationship you want started, set, ended or ignored | A wrestler's page; the page for two wrestlers |
| What counts as an incident | The show page |
| Any story event you'd rather hadn't happened: edit it, undo it, or run the show again; the director's pace, or switching it off | The event (tap it), the show page, What happened |
| The tiers: which shows are in which, their order and names, new tiers and shows | Tiers & transfers |
| Each connection's rules: relegation, qualifying, champions, titles, timing, destinations | Tiers & transfers → Edit the rules |
| When WrestleMania is, and starting the transition from it | WrestleMania's page, or the season card |
| How many relegation candidates each show has (any number, zero included) | The transition page |
| A tie across the cutoff, an odd candidate out, the pairings | The transition page — booking waits for these |
| Results still missing before WrestleMania: enter them, or count wins as they stand | The transition page |
| A relegation match without a winner: rematch, or who (if anyone) goes down | The transition page |
| Whether a correction to the win totals after booking should change anything | The transition page shows what moved; it changes nothing itself |
| Who's in the qualifiers (suggestions from the season record), their pairings, a qualifier without a winner | The transition's Promotion part |
| When the transfer window opens and closes, who's drafted where, how many each show takes | Transfer window |
| For each pick: bring tag partners along or split the team; keep or vacate a title, where the rules leave it to you | The draft sheet — the pick waits for an answer |
| Which result is wrong when a title history is flagged | The title's page, then the result |
| Injuries, alignment and other details | A wrestler's page |
| When a season ends and the next begins | The season card |
| Exporting save files — the only backup that leaves this browser | The save sheet |

## Getting around

- **Go to** (top right): Up next, this week's shows, results, rosters, tag teams,
  champions, rankings, booking balance, relationships, what happened, the
  season transition and transfer window, tiers & transfers, the auto booker, and saving — each
  with where it stands — plus every "How it works" sheet.
- **Up next** on the Calendar is today's show: a show from an earlier week still
  waiting for results comes first; otherwise the first unfinished show from this
  week on, in calendar order.
- **On a show's page**, the previous and next shows (by the calendar, across every
  show) are one tap away, and so is its week. Moving between shows replaces the
  page, so Back always returns to where you came from.
- **On a wrestler's page**, their ranking this season links to their show's
  standings; titles, teams, relationships and results link on as before.
- Every page opened from Go to starts from its tab, so Back leads somewhere
  sensible.
- **Searching a long list.** Wherever a wrestler or tag team is picked from a
  dropdown with 7 or more choices — booking a match, a team's members, an
  incident, a relationship, a champion, a merge, a pairing — a search button
  sits beside it. Type part of a name (case and accents don't matter; "rey mys"
  finds Rey Mysterio), then tap a match, or press Enter for the best one. It
  searches exactly what that dropdown offers, each match labelled with its show,
  and picking one is the same as picking it in the dropdown, which still works
  as before.

## The data

`js/universe/model.js` is pure — no DOM, no storage, no clock, no randomness —
so the whole model runs under Node for tests exactly as it does in the page.

| Record    | Holds |
|-----------|-------|
| shows     | Raw, SmackDown, Dynamite, NXT and Evolve to start; more can be added. Rosters are uncapped and never expected to match in size. |
| tiers     | the shows in tiers, top down — tier 1 is the main roster. A show is in one tier at most |
| links     | the connection between each tier and the one below it, with its rules: relegation (on, candidates, timing, destination), qualifiers, champions, titles, promotion (timing, destination) |
| wrestlers | name, division (men's / women's), where they come from (WWE / AEW / NXT / Other — independent of which show they're on), alignment, active, injured or away, notes, current show |
| moves     | roster history: one row per change of show, dated, with an optional note |
| teams     | two or more wrestlers, plus a log of the team forming, disbanding and reuniting. A wrestler can be on several; a team split across shows is allowed and flagged |
| memberships | team line-up history: one row per spell a wrestler spent on a team, dated when they joined and left |
| titles    | singles or tag, a division, one show or none, can be retired |
| reigns    | title history. The reign with no end is the champion |
| shows     | also the night each airs: Raw Monday, NXT Tuesday, Dynamite and Evolve Wednesday, SmackDown Friday |
| seasons   | always exactly one active, each with its own week counter (the clock), and optionally the real date its week 1 falls in |
| events    | weekly episodes (one show) and premium live events (one show, or all), each on a week and a night, each holding its card — and its incidents: betrayals, interferences, attacks, saves, brawls, confrontations, challenges, open challenges, demands, alliances, tension, walk-outs, truces, turns and runs of momentum. Each is before the show or after it — on a match, if it happened in or straight after one — and the director's keep their run and their cause |
| traitLog  | every change to a wrestler's personality, one trait at a time: dated, or counted from the start. A wrestler's `traits` are where it ends up |
| relEdits  | the owner's own relationship changes (start, set, end, note — dated, or from the start), between two wrestlers or two tag teams (`teams`), and the automatic changes they've chosen to ignore |
| story     | the story director: on or off, its pace, the save's seed, the week it started from, and a log of every run — the show, before it, straight after one of its matches, or after it, the seed and run number, every possibility it weighed with its chance and draw, and what it recorded |
| booker    | the auto booker's settings, per show — only what you've changed; the rest follows the show's tier — plus one set for premium live events on every show |

An event can also hold a **draft card**: the auto booker's matches (each with
why it was chosen, and whether you've changed it) and your own, in order; who
isn't at the show; the draft's draw number; and the drafted matches you took
off, so they aren't offered again. A draft is never a booking and never holds a
result. Each drafted match names the story events behind it, and the draft
remembers which story events and how many results it knew of, so anything newer
can be pointed out. A booked match keeps why the booker chose it, and the story
events behind it, if it did.

A **match** is one record from the moment it's booked: its sides — each a set
of wrestlers, plus the tag team they wrestled as — the title on the line (or,
for a **#1 contender's match**, the title it's for), a stipulation and notes.
While it's `scheduled` it has no result at all. Entering the result makes it
`played`: a win (with the winning side), a draw or a no
contest, and optionally the finish and who scored or took the fall. Only
played matches count — toward records, defences and history. Whether it's
singles, a tag match, a triple threat, a handicap match and so on is worked out
from its line-up, never stored, so it can't disagree with who was in it.

Anything that happens at a point in time carries a stamp,
`{ season, week, day?, seq }`: the universe's own calendar, plus a counter that
only goes up. Things that happen on a show carry its night, so Monday's Raw
comes before Friday's SmackDown however they were entered; changes made
between shows (a move, a line-up change) belong to the week as a whole. The
History timeline is *built* from those stamps on the records rather than kept
as a second log, so it can't drift out of step with them.

What the model enforces, so the data stays trustworthy as it grows:

- **A failed change changes nothing.** Every function checks all its inputs
  before touching the universe, and the UI additionally snapshots and restores
  around each change. The reason comes back as a sentence for the owner.
- **Nothing is inferred.** A match has a result only when the owner enters one,
  and a win needs its winner named — there is no default, and the form starts
  blank. A title changes hands only when the result says so ("the title
  changed hands"), because only the owner knows whether a DQ finish or a
  cash-in moved the belt.
- **History can't be pulled out from under itself.** A wrestler, team or title
  with any history can't be deleted — leave them unassigned, disband or retire
  them instead. A result or event where a title changed hands can be deleted
  only while nothing later on that title depends on it; the belt then goes
  back to whoever held it before.
- **Title changes land in calendar order.** Backfilling a change onto a night
  before the current reign began would crown the wrong champion, so it's
  refused. Match lists and the timeline sort by season, week and night, not by
  the order things were typed in.
- **Names are unique** (ignoring case and spacing) within wrestlers, teams and
  titles, which is what makes pasting a whole roster safe to repeat.

## The calendar and the card

The **Calendar** tab is where a week is run:

1. The week's four shows sit on their nights. **Plan** puts an episode on the
   calendar and opens its page; **Add a premium live event** adds one with its
   own name, for one show or all of them, on any night (Saturday by default).
2. On the show's page, **Book a match**: pick a shape (singles, tag team,
   triple threat, fatal 4-way, handicap, 3-on-3, triple threat tag, battle
   royal) or build any line-up side by side, then the title on the line — or
   the title a **#1 contender's match** is for — and a stipulation. Booked
   matches can be edited, reordered or taken off the card, and they count for
   nothing yet.
3. Watch the CPU play it in WWE 2K25, then **Enter result**: who won, a draw or
   a no contest; the finish and who took the fall if you want them; whether
   the title changed hands; and notes on what happened. The form shows the
   match as booked and leaves the result blank until you pick it — saving
   without one is refused. (A run-in or a late change? Change the line-up from
   the same form.)
4. **Next week** moves the clock on. Browsing other weeks with the arrows, or
   from the season grid, never moves it.

**#1 contender's matches.** Pick the title under **#1 contender's match for**
on the match form (a match is for a title or a #1 contender's spot, never
both). Its winner is the title's **#1 contender** — named on the title's page,
on their own page and in the result's toast — until they've had their shot: a
title match for it with them in it, win or lose, or winning it some other way.
A later #1 contender's match names someone new; a draw or no contest names
nobody, and whoever was next in line stays there. Nobody holding the title that
night can be in one; for a singles title it's one wrestler a side, for a tag
title every side wrestles as a tag team. Losing one counts like losing the
title (Personalities and relationships), the auto booker gives the #1
contender the next shot, and the story director has them step up to the
champion.

Each show's row, its page and the season grid say where its card stands:
planned, booked, some results in, or complete. **Set dates** pins a season to
the real calendar — pick any day in its week 1 — so every show shows its date;
without one, shows are labelled by week and night.

The **History** tab browses the past, newest first: **Results** lists every
result show by show, filterable by season and by show (or just the PLEs), each
with its finish, title and notes; **Everything** puts results, title changes,
moves and team changes on one timeline. Tap any of it to open the show.

## Tiers and transfers

Shows sit in **tiers**, top down. Tier 1 is the main roster — Raw, SmackDown and
Dynamite, three separate shows with their own rosters of any size. Tier 2 is NXT
and tier 3 is Evolve. **Tiers & transfers** (from **Go to**) lets you add tiers at
the bottom, rename them, reorder the lower ones, remove them, add shows, and
move shows between tiers. Tier 1 stays at the top and always keeps a show. A
show in no tier takes no part in promotion or relegation. Removing a tier never
touches its shows or anyone on them.

Between each tier and the one below it is a **connection** with its own rules.
Nothing about NXT or Evolve is written into the code; it's all here:

| Rule | Choices |
|---|---|
| Relegation matches | On or off; how many candidates on each upper-tier show (the fewest wins); when losers move — right away, on the result, or at the transfer window; which lower-tier show they go to |
| Qualifying matches | On or off, on the lower tier after WrestleMania; winners become draft eligible, or move up straight away |
| Champions of the lower tier | Draft eligible, move up by themselves at the transfer window, or stay |
| A title, when its holder moves up | Your call at each move, vacated, or kept |
| Moving up to | Your pick of the upper tier's shows (the draft), or a set show |

**As it starts:**

- **Main roster ⇄ NXT** has the rules as they always were. After WrestleMania,
  each main show holds its own relegation matches between its 2 lowest-win
  wrestlers, and losers go straight down to NXT. NXT champions and qualifying
  winners are draft eligible, and are drafted to your pick of the main shows.
  Their titles are your call at each pick.
- **NXT ⇄ Evolve:** Evolve champions move up to NXT by themselves at the transfer
  window, and their titles are **vacated**, so the championship is left with a
  clear status. No relegation matches and no qualifiers.

A new tier's connection starts with everything off.

**Changes and history.** Each season transition keeps a copy of the tiers and
rules it started with (its *Rules* part shows them), so what already happened
always reads the same. Rule changes apply from the next transition. Tiers can be
reordered and moved away and back: a connection is kept while both its tiers
are, so its rules come back.

**Not carried out yet.** Three choices are kept as rules but aren't acted on:

- moving down at the transfer window;
- champions moving up by themselves (Evolve's, as it starts);
- moving up straight after a qualifying win.

The transition page lists who each would move, with **Not carried out yet**,
and nobody moves by them. Relegation matches or qualifiers under such a rule
can't be booked, so nothing happens halfway. Evolve's own annual events come
next.

**A fourth tier needs no new code.** Add it, put a show in it, set its
connection's rules, and the same engine that runs the main roster ⇄ NXT runs
it. `npm run demo:tiers` does exactly that and checks each step:

- a new tier "Indies" with a show "LFG" below Evolve;
- relegation matches on Evolve send the loser down to LFG, with the reason on
  record;
- an LFG qualifying winner and the LFG champion become draft eligible;
- the champion can only be drafted up to Evolve, and the LFG title is vacated
  by the rule.

The unit and browser tests do the same.

## The season transition: relegation after WrestleMania

Once a season, WrestleMania ends it. Every show in a tier whose connection to
the tier below has relegation on — Raw, SmackDown and Dynamite, as it starts —
holds its own relegation matches on its first episode after WrestleMania.
Whoever loses a relegation match moves down to the connection's show (NXT, as
it starts) the moment the result is saved; the winner stays. The game decides
who wins.

Start it from the season card on the Calendar ("WrestleMania ends the season")
or from WrestleMania's own page. The transition page has four parts:
**Relegation**, **Promotion**, **Window** and **Rules**. Relegation has a
section per show, grouped by connection when more than one has relegation on:

- **The win totals.** Everyone who was on the show at WrestleMania, fewest wins
  first — wins in that season up to and including WrestleMania, singles and tag,
  wherever they happened (relegation matches themselves never count). This is
  the list the candidates come from, shown in full.
- **Candidates.** The ones with the fewest wins — as many as the rules say (two,
  as it starts), changeable *for that show* (any number, including none). Tap
  anyone to make them a candidate or not. Shows never have to match: roster
  sizes, numbers of candidates and numbers relegated are each show's own.
- **Pairings.** One on one, in win order until you pair them differently.
- **Relegation night.** The show's first episode after WrestleMania; if there
  isn't one yet, **Plan it** puts one on the calendar. **Book** puts the
  matches on its card, marked as relegation matches.

Nothing is decided for you where the rule runs out. Each of these is flagged as
*your decision*, and booking waits until it's settled:

| Flag | What you decide |
|---|---|
| A tie across the cutoff | Who takes the spot — or change the number |
| An odd number of candidates, or someone unpaired | Add or take out a candidate, or re-pair |
| Matches up to WrestleMania still without a result | Enter them, or count the wins as they stand |
| A relegation match without a winner (draw or no contest) | Book a rematch, or send one (or neither) down yourself |

Also shown, without holding anything up: an injured candidate, a candidate who
has changed show since WrestleMania, a pairing across divisions, a candidate
with no matches, and candidates you picked by hand.

**The record.** Every relegation keeps, for good, the show they were relegated
from and the show they went to, the match and who won it (or that it was your
decision, with your note), and the win total and place that made them a
candidate — or that you picked them. It shows on the wrestler's page, on the
transition page, and in their career history as the move down. A wrong
relegation result is corrected like any other: the real loser goes down and the
other comes back; clearing the result or taking the match off the card brings
them back — only while it's still their latest move, so nothing later is
rewritten. A relegation match's line-up is its pairing, so it's changed only on
the transition page.

## Promotion and the transfer window

**Promotion.** One section per connection that moves anyone up, with its rules
in a line. Where a connection has qualifying matches, the lower tier's first
show after WrestleMania holds one-on-one qualifiers (**Plan it** puts that
episode on the calendar if it isn't there).

- **Who's in them is your pick.** Everyone who was on the lower tier at
  WrestleMania is listed with their season record, ranked exactly as on the
  Rankings tab. The top few (you set how many), leaving out champions and the
  injured, are marked *Suggested* — **Pick them** takes all of those, or tap
  anyone in or out. The order you pick in is the pairing order, and pairings can
  be changed.
- **Winners become draft eligible**, the moment the result is saved. A
  qualifier without a winner is your decision: a rematch, or send one, both or
  neither through (with a note). A corrected result changes who's eligible —
  refused once they've been drafted, until that pick is undone.
- **Champions**, where the rules make them eligible, are draft eligible without
  a match — both members of a team holding a tag title. They're fixed as
  eligible when the transfer window opens. Champions set to move up by
  themselves are listed as *not carried out yet*.
- **Eligible moves nobody.**

**The transfer window.** One window per transition, for every connection. Open
it when you're ready (it can be taken back until someone's drafted). Tap an
eligible wrestler to draft them up a tier — to your pick of the upper tier's
shows, or the show the rules set. Each show can take any number, and rosters
never have to come out even — the tiles show each show's roster, plus drafted
in and relegated out. End the window whenever you like: anyone left undrafted
stays where they are, and the closed window keeps who that was. It can be
reopened to draft more or undo a pick; an undone pick goes back where it came
from, and a title vacated with it goes back to its holder — only while nothing
has happened since.

**At every pick:**

| Question | How it's settled |
|---|---|
| A drafted wrestler (or their team) holds a title | By the connection's title rule: **vacated**, **kept**, or — "your call" (NXT, as it starts) — **Keep it** or **Vacate it**, and the pick waits for an answer |
| A drafted wrestler has tag partners | Always your call: **Bring them too** (eligible or not — noted as your decision), or leave the team split across shows |

**The record.** Each eligibility says how it came about and which connection it
belongs to: holding a title (which one, and with which team), winning a
qualifier (against whom), or your decision after a qualifier without a winner
(with your note). Each pick keeps its number, where it came from and went, the
eligibility it used — or that a partner came along by your decision — every
title kept or vacated (and whether the rule decided), and a note. The window
page lists every roster move since WrestleMania in order. Wrestlers' pages show
their draft, or that they were eligible and left undrafted.

## Rankings and booking balance

The **Rankings** tab reads the results you've entered and nothing else. It never
limits booking: anyone can be booked against anyone with any title on the line,
and win it — the tests book the bottom of a table for the world title and crown
them. `model.js` and `card.js` don't use the standings at all; the auto booker
reads them only to suggest (see below), and its draft is yours to change.

**Standings** — pick a show (or every show), a season or all time, and singles
or tag. Men's and women's divisions are ranked separately; tag shows the
registered teams on their own records, then each wrestler's tag record.

- The score is a winning percentage with one win and one loss added to
  everyone, a draw counting half and no contests left out:
  (W + ½D + 1) ÷ (W + L + D + 2). So 1–0 is 67%, 5–0 is 86% and 10–2 is 79% —
  one lucky win doesn't top the table. Ties go to more wins, then fewer
  losses; still level, they share a rank. Anyone with no wins, losses or
  draws in the period is listed as not ranked yet.
- Who's on a show: for a finished season, where they were when it ended; for
  the current season and all time, where they are now. The record is every
  match in the period, wherever it happened.
- Each row shows the record, the score, the last five results and the
  current streak, and a belt for a champion.

**Booking balance** — pick a show and the last 4 weeks, the last 8 or the
season. It flags who has had far fewer matches than is typical *for their
division on that show*; nobody is compared with another show, roster sizes
never come into it, and nobody is expected to match anyone exactly.

- *Matches*: results entered while they were on the show (singles and tag,
  any event); a team counts only matches as the team. *Weeks*: weeks of the
  period they were on the show, so a newcomer is judged on their time there.
  *Rate*: matches ÷ weeks.
- *Typical*: the median rate of their group — men, women, or the show's tag
  teams — leaving out the injured and anyone there under 2 weeks. A group
  needs at least 3 to compare.
- *Short of matches*: a rate at most half of typical **and** at least 2
  matches below typical × their weeks. The second rule is why a quiet show
  flags nobody. *Well below* is at most a quarter of typical.
- Every wrestler's rate is shown against the typical line, so the flags can
  be checked by eye.

**Match ideas** — up to three opponents for each flagged wrestler or team:
same show and division, not injured, never their own partners. Each is scored
on both being short of matches (+3), a rivalry (+2) or a recent first meeting
(+1.5), closeness in this season's standings (up to +1.5), a shot at someone in
the top three (+0.75), never having met (+0.75) and holding a title (+0.5), less
1 if already booked or they met last week — and shown with the reasons. **Book…**
opens the booking form with the line-up filled in, on an upcoming episode or a
new one; nothing is booked until you add it, and the result still comes from
the game. Both calculations are explained in the app ("How rankings work",
"How this is worked out").

## The auto booker

**Draft the card** on a show's page — or **Draft week N's cards** on the
Calendar, which plans any show not on the calendar yet and drafts each — and
the auto booker fills the card up to the show's size, after anything already
booked there. It works for every show: Raw, SmackDown, Dynamite, NXT, Evolve,
and any show you add, by its own settings. It never books anything and never
picks a winner: the draft waits on the show's page, counts for nothing, and the
story director doesn't read it. **Book this card** puts it on the card exactly
as it stands, after anything already booked; then the game plays it.

**What it reads.** The story — the director's events and your own, and every
feud's storyline (below); the show's roster (injured, away, and anyone you mark
as not at this show, left out); its tier, for the card's size; the championships it can
put on the line (its own, and any show-less title whose champion is on it); this
season's standings and results; who's short of matches (as Booking balance
counts them) and who wrestled lately; grudges, rivalries, friendships and
alliances; tag teams and factions (a team of three or more); what each wrestler
is after (as on their page: keep the title, revenge, a title, tag team gold,
turn it around); who has arrived from another show lately (drafted, relegated,
moved); and the calendar — a premium live event ahead, or tonight being one.

**What it looks for**, each match with why it was chosen:

| Idea | How it reads |
|---|---|
| Title match | the champion against the best contender. The story comes first in the case: a title demand or challenge, a title lost lately (they want it back), the story event between them ("Revenge: Gunther attacked Cody last week"), a run everyone's talking about; then high in the standings, a recent win over the champion or one of the top three, a grudge or rivalry, after that title, hot. A champion's open challenge gets answered. The #1 contender, if someone has won a #1 contender's match and not had their shot yet, comes first of all ("Seth earned the shot: #1 contender — won the #1 contender's match last week"). A title idle for weeks is due; one just defended — or a champion who can't be here — sends the top contenders into a #1 contender's match, never while a #1 contender is still waiting, and never on the same card as that title's match. Whoever lost a shot at it, or met the champion one on one, in the last week or two waits their turn. A vacant title: the top contenders meet for it. |
| Feud | a storyline's next chapter (see Storylines): one on one, through someone who stands with the other, or a tag match with backup on both sides — whichever moves it on |
| From the story | a save becomes a tag match — the one saved and the one who saved them against the attacker and whoever stands with the attacker (or the attacker outnumbered); new allies take on a common enemy; a team in trouble has to hold it together against another team |
| Surprise | now and then, one pairing nobody would predict, with a hook (see Storylines) |
| Teams | teams at odds — the teams' own grudge or rivalry named when there is one — or close in the tag standings; factions three on three; a tag partner against a member of a team they're at odds with; someone with a grudge against a faction, alone, handicap. Allied teams are unlikely opponents ("a friendly contest at most") |
| Upset | a win from three or more places lower, or over a champion: a rematch, or a step up against the top three |
| Opportunity | someone short of matches gets a chance, against an opponent picked as Booking balance's match ideas pick them; someone cold gets one to turn it around; a new arrival gets a first match on the show |
| Fresh matchup | everyone else: close in the standings, not met lately; three or four free for a while in one match; the top three of a division at once |

**Putting the card together.** Nobody is in two matches. The card leans toward
the show's mix of match types and each division's share of who's available,
favours whoever has gone longest without a match, and keeps away from what just
happened: a line-up from the last two weeks, in any format, is much less likely
(a rematch after an upset aside); facing the same people again so soon needs a
story behind it; and someone whose last three matches were all one kind gets
something different. It keeps a weekly episode to its
number of title matches (every title with a contender at a premium live event),
takes at most two matches from one feud, and only picks a big multi-person match
while enough people are left for the rest of the card. When nothing with a story
fits, whoever's left gets a match of a kind the show allows. The biggest match
goes last, something with a crowd of people opens. Close calls are settled by a
hash of the show, the draw number and the match — so the same universe drafts
the same card, and drawing again draws a different one. A roster too small for
the card gets as many matches as it can make, and the draft says so.

**Each show's settings** (Go to → Auto booker, or **Settings** on a draft):

| Setting | Default |
|---|---|
| Matches on a weekly episode | 6 in tier 1, 5 in tier 2, 4 below that (5 in no tier) |
| Matches at a premium live event | 2 more than weekly; 10 for an event for every show |
| Title matches on an episode, at most | 1 |
| Singles · tag team · triple threat · fatal 4-way · 6-person tag · handicap | often · often · sometimes · rarely · rarely · never (each: often, sometimes, rarely or never) |
| Stipulations | only to settle a feud (or never, or often) |

Only what you change is kept for a show, so a show added later — or moved to
another tier — starts from its tier's defaults. A draft already made stays as
it is; draw it again to use new settings.

**Yours to change.** On the draft, every match can be edited in the booking form
— who's in it, the title, the stipulation, the notes (it's then marked
*changed*); **Draw again** swaps one match for another in the same place,
without touching the rest; the arrows move a match; ✕ takes it off (it isn't
offered again on that draft); **Add your own match**; **Not at this show** leaves
someone out of anything drawn for it, drawing their matches again without them.
**Draw the rest again** keeps every match you changed or added, in its order,
and draws the others. **Discard the draft** throws it away. A draft match that
needs a look says so — someone injured, away, not at the show, on another show
now, in two matches, or a title match without its champion — but nothing is
refused until you book it, and booking checks the whole draft first: it books
all of it or none.

`npm run demo:booker` drafts week 5 of a sample universe on every show, plus a
premium live event, prints each match with why, then changes, draws, adds to
and books a draft, checking at each step.

**After the results.** Nothing the booker knows is stored: once you enter what
the CPU did, records, relationships, the story director's next events and the
booker's priorities all follow from it. A draft drawn before new story events
or results says so (**Since this draft: …**), and **Draw the rest again** takes
them in, keeping what you changed. A drafted match whose story event you undo
or edit says so too.

## Storylines

Every feud is a **storyline**, worked out from the record rather than stored
(`storylines.js`), the way relationships are — so an undone story event or a
corrected result changes it too. Two wrestlers have one when there's a grudge
or rivalry between them, or when something hostile happened between them: an
attack, a betrayal, a brawl, a confrontation, an interference, a save (the
attacker and the saver), a title challenge or demand, a walk-out, tension
between partners. A grudge or rivalry they have only through their teams doesn't
start one — a feud between two teams is booked team against team — but it adds
its heat to any storyline two members already have.

- **Beats**: those story events, and every match that advanced it — one on one,
  on opposite sides of a tag or multi-person match, or through someone standing
  with the other one (a proxy). **Chapters** are its matches, and the storyline
  knows how many and in which formats.
- **Priority**: its heat, plus every beat — a betrayal 5, a walk-out 4, an
  attack or brawl 3, an interference or challenge 2.5, a demand, confrontation or
  save 2, tension 1.5, a truce −3 — each fading by half every 3 weeks. So big
  events shape cards for weeks rather than being forgotten after one.
- **Stage**: a *spark* (nothing in the ring yet), *building*, *at its peak*
  (three chapters, or heat 3 with one, or very pressing — due a blow-off), or
  *settled* (a stipulation match won, or a truce, in the last 3 weeks, with
  nothing hostile since — it cools off).

**The next chapter** is picked to move it on:

- The story event behind it leads: *Revenge: Gunther attacked Cody last week*,
  *Betrayal: Kevin turned on Sami*, *Former partners: …*, and a confrontation
  before tonight's show makes the match tonight.
- After a one-on-one meeting last week, or the same format twice running, it
  goes another way; with a premium live event ahead the singles match waits;
  at its peak it gets a stipulation (if the show's settings allow); a feud with
  a champion in it is fought for the title at a premium live event.
- An unexpected result — a win over a champion, or from a clearly worse run —
  keeps it going: *Gunther beat Cody 2 weeks ago — nobody saw it coming, and it
  isn't over*. A pin in a tag match that nobody expected earns a one-on-one.

**Who is drawn in.** Someone joins a side only with a reason, and every
connection is spelled out as a path:
*Connection: Gunther → Cody (rival) → Jey (made the save for Cody against
Gunther at Raw · Week 4)*.

| Standing with one of them | Counts |
|---|---|
| Made a save for them, interfered for them, teamed with them against the other, or has a grudge of their own against the other | fully — drawn in |
| Their tag partner | stands with them |
| Their friend or ally, nothing more | only once the feud is at its hottest |
| Close to both of them | never — they're torn, and stay out of it |

A rival's friends and partners are not enemies by default.

**A surprise, now and then.** A seeded draw per card (about 3 cards in 10 at a
normal story pace; fewer when quiet, more when wild) allows one pairing between
two with nothing between them and no meeting lately — but only with a hook: a
common enemy (both at war with the same wrestler), the same champion beaten
lately, or two hot runs that haven't crossed. At most one a card.

**The Auto booker page** lists the storylines that matter now, with where each
stands; tap one for the page for the two of them, which shows its stage, its
chapters and who stands with whom, and why.

`npm run demo:feud` plays Raw from week 5 to week 9, Backlash included: the
director runs before and after each show, the booker drafts every card and it's
booked as drafted, and a stand-in for the CPU decides every match (the better
record wins — except once, when the feud's chapter goes to the underdog). From
it (seed 7):

```
Raw · Week 6   Gunther vs Cody (World Heavyweight Championship) — the CPU: Gunther won   ← nobody saw that coming
Raw · Week 7   before the show: Seth confronted Kevin
               Cody and Gunther sit this one out · also from the story: Seth vs Kevin — the match is tonight
Backlash       Gunther vs Seth (title) · Cody vs Priest
Raw · Week 8   Cody vs Gunther — Gunther beat Cody 2 weeks ago — nobody saw it coming, and it isn't over
               after the show: Cody and Gunther brawled
Raw · Week 9   Gunther vs Jey — Connection: Gunther → Cody (grudges both ways) → Jey (Cody's friend — the feud is at its hottest)
               · Cody and Gunther brawled last week — it needs settling in the ring
               · They met one on one last week — the feud moves on another way
```

It checks that the feud moved on through different matches, that no line-up from
it came back the next week, that the unexpected result was picked up, that the
director's events became reasons for matches, and that every result came from
the CPU stand-in. Other seeds tell other stories — a truce can cool the feud
first — and the checks allow for that.

## Personalities and relationships

The owner sees all of it, from the start: every trait, every relationship, and
why each one exists. Nothing is hidden, scouted or discovered over time.

**Traits** — ambitious, loyal, opportunistic, hot-headed, patient, proud,
cowardly, respectful — are set on a wrestler's page (**Edit personality**), each
shown with what it means and what it does. They're the owner's alone: no
result, however many, changes one. A change is logged and dated to this week,
or counted **from the start** — for who someone has always been. Proud,
cowardly and respectful are there for booking and change nothing by themselves.

**Relationships** — a grudge (one way: one wrestler holds it against another),
rivals, allies, friends, former partners — are never stored. They're worked
out (`relations.js`) by replaying the record in calendar order, so correcting a
result, or editing or deleting an incident, corrects everything that grew out
of it. Heat and strength run 1–3. The rules, each explained in the app ("How
relationships work"), with traits counted as they were at the time:

| What happened | What it does |
|---|---|
| 3 straight losses to the same wrestler (no win over them in between) | a grudge against them, or 1 more heat. Hot-headed: 2 losses. Patient: 4 |
| Losing a title to someone in a match | a grudge against the new champion (ambitious: heat 2), and they're rivals |
| Losing a #1 contender's match | the same as losing a title: a grudge against whoever won it (ambitious: heat 2), and they're rivals — every loser, in a multi-person one |
| A betrayal (logged on the show) | a grudge against the betrayer, heat 2 (loyal: 3); any friendship or alliance between them ends |
| An interference | a grudge against whoever interfered; whoever it helped becomes their ally |
| An attack | a grudge against the attacker (hot-headed: heat 2) |
| A save | the attacker holds a grudge against whoever made the save; the one saved becomes their ally |
| A brawl | a grudge each way, and they're rivals |
| A title challenge, calling someone out, or a confrontation | they're rivals (or 1 more heat) |
| An alliance | allies (or stronger ones) |
| Tension between partners | an alliance or friendship between them weakens a step |
| On a tag team or faction together | allies at strength 3 with everyone in the group, from the day they team up — or join, or the team reunites |
| A reason not to trust an ally (teammate or not) | the alliance weakens: a step for tension, a confrontation, a challenge, a save against them or a grudge forming (losing to them again and again, a title lost to them); two for an attack, an interference against them or a brawl (and a friendship a step). A betrayal or a walk-out ends it. At nothing it ends — even while they're still a team |
| A truce | each grudge between them, and the rivalry, cools a step |
| Walking out on a team | anyone left behind holds a grudge; any friendship or alliance between them ends |
| 5 matches on the same side, win or lose | allies (either loyal: 3). At 12, friends — never for the opportunistic, or with a grudge between them |
| Leaving a tag team, or it disbanding | former partners, and the alliance drops a step |

**Between tag teams.** Teams have relationships of their own — a grudge (one
team against another), rivals, allies — worked out the same way, and each
extends to every pair of their members while both are on their teams: the
wrestler's page says "Kofi and Sami are allies — through KO & Sami and New
Day". A pair's own relationship shows when it's stronger; an alliance between
teams doesn't reach two members with a grudge between them; a disbanded team's
are on hold; and a new member is in at once, someone who left is out.

| Between two teams | What it does |
|---|---|
| 3 straight losses to the same team, as teams | a grudge against them, or 1 more heat |
| A tag title — or a #1 contender's match for one — lost to another team | a grudge against them, and they're rivals |
| A member of one attacking, interfering against, betraying or walking out on a member of the other | a grudge against that team |
| A brawl between members | a grudge each way, and they're rivals |
| A confrontation, challenge or call-out between members | rivals |
| A save, or an interference to help, a member of another team; joining forces across teams | allies |
| A truce between members | the grudges and the rivalry cool a step |
| Anything that costs trust between two wrestlers, between members | the alliance between the teams loses it the same way; a betrayal or a walk-out ends it |

A team's page shows **Trust inside the team** (every pair of members and how
much they trust each other), its **Relationships with other teams**, and their
timeline — each change with Ignore or Take back; **Add or change a
relationship** starts, sets, ends or notes one, with what it would change
first. The Roster tab's **Relationships** view lists them under **Between tag
teams**.

**Incidents** go on the show they happened on — the story director records
most of them, and you can add your own (**Record something yourself**): who did
it, to whom, who an interference helped, the match, if any, and whether it was
before the show or during/after it. A turn changes the wrestler's alignment
(and deleting it changes it back). The sheet shows what it will change before
it's saved, and the show page lists every relationship change made there. What
happens before a show counts before its matches.

**Seeing why.** A wrestler's page lists their relationships, grouped by person,
and what's building up ("Lost to Gunther the last 2 times — 1 more in a row
makes a grudge"). Tapping one opens the page for the two of them: what's
between them now, what's building, and the whole timeline, oldest first — each
entry says what happened, where, and what it did. The Roster tab's
**Relationships** view lists every one, filtered by kind, and the latest
changes. Saving a result, incident or trait says in its toast what it changed.

**Changing it.** **Ignore** any automatic change: it stays on the timeline,
crossed out, and everything after it is worked out again without it (**Count
it again** undoes that). **Change…** starts, sets, ends or adds a note to any
relationship — dated to this week, or from the start for history before the
universe began. Those are entries on the same timeline, and can be taken back.

## The story director

You watch; it tells the story around the matches, in the spirit of SmackDown
vs. Raw 2011's Universe Mode. It runs by itself, and nothing it does waits for
approval:

- **Before a show**, once it's the next one up — planned for this week, with
  every show before it through. What happens here comes before you book the
  card, so it can shape it: a confrontation is a match waiting to happen, and a
  title demand or challenge offers **Book the title match** (the booking form,
  filled in).
- **Straight after each match**, the moment you enter its result — whatever
  order the results go in, and for a match added to the card later too. Only
  that match and the people in it are in play: a loser lashing out, someone
  running in, a partner turning, a handshake, a title challenge for a title it
  was about. What it makes goes on that match, under it on the show's page
  ("Straight after"), and counts in relationships right after that match —
  before the next one.
- **After the show**, once its card is complete, or its week has gone by: what
  wasn't about one match — bad blood between people who were in different
  matches, a champion who didn't wrestle being called out.

It runs when a result goes in, when a show is planned, when you move on a
week, and when it's switched on. What it decides is canon at once: incidents
on the show, each with its cause, so relationships follow and it's on the
History timeline, each wrestler's page, the show's **Before the show**, each
match's **Straight after** and **After the show**, and the **What happened**
feed (the Calendar's season card, and its own page). The toast says what
happened ("Result saved — … · Straight after the match: Gunther attacked Jey
Uso — Seth Rollins made the save"). One show's limits hold across all its
matches together: at most so many after its matches, never two of a kind, and
never one wrestler twice. Each match's run has its own log, and can be undone
or run again on its own.

| Before a show | Comes from | Changes |
|---|---|---|
| Backstage confrontation | rivals and grudges on the show — much likelier if they're booked against each other. Two tag teams at odds face off as teams (not pair by pair) | rivals |
| Title demand | someone hot or rising, ambitious, or who has beaten the champion lately — however low they're ranked; a #1 contender wants their match | rivals with the champion |
| Open challenge | a champion who's proud, a fighting face, or hasn't defended lately; or someone red-hot | nothing — who answers is yours |
| New alliance | two with a grudge against the same person, or one who saved the other; never current partners | allies |
| Rivalry cools | a rivalry nobody has touched for 6+ weeks — likelier across shows, or for the patient | cools a step |
| Team tension, turn | as after a show | |

| Straight after a match (and after the show) | Comes from | Changes |
|---|---|---|
| Interference | someone not in the match gets involved: a friend, tag partner or ally runs in to help them win (the loyal, the opportunistic, heels, and anyone helping a coward more so), or someone with a grudge or rivalry costs the loser the match (the hot-headed more so) — never against their own friend, ally or partner; the patient and the respectful mostly stay out of it | a grudge against whoever interfered; whoever it helped becomes their ally |
| Post-match attack | a loser lashing out: hot-headed, proud, a heel, a grudge, a losing run against them, a title or #1 contender's match just lost, revenge. A partner who lost alongside them joins in, and so does a teammate who's loyal, backing up a coward, or in a faction — never the respectful | a grudge |
| Surprise save | someone stopping that attack: a friend, ally, partner, or someone with their own grudge against the attacker | a grudge, allies |
| Betrayal | a partner who has had enough — only after buildup (below); less likely while teammates still trust each other fully, likelier once that trust has slipped | a grudge; friendship and alliance end |
| Rivalry escalates | rivals or grudges, especially after sharing a ring | grudges both ways, rivals |
| Team tension | losing, a partner winning alone, opportunism, ambition, a grudge inside the team | weakens the alliance |
| Team breakup | only after repeated tension (below); never champions | a walk-out; the team disbands |
| Rivalry cools | a hard-fought match between rivals, a respectful or patient one among them | cools a step |
| Title challenge | a challenger drawn from everyone eligible (below) — a new #1 contender above all | rivals |
| On the rise | an upset over a champion from low in the standings (or after a losing record), or a winning run after losing more than winning | nothing — it's remembered for title shots |
| Turn | a record of it (below) | the alignment |

**Every event has a cause.** Its reasons come with it: the feed shows the lead
one ("Gunther lost to Akira Tozawa at Raw · Week 5"); tapping it shows them
all, what it changed — each relationship, an alignment, a team — and its chance
and draw.

**Personalities and relationships decide who does what.** You don't have to
record incidents: the director makes them from who everyone is. The
hot-headed attack and confront; the proud hate to lose; the cowardly strike
from outside the ring, bring their partners and need the help; the
opportunistic run in when there's something in it; the loyal stand by partners
and make saves; the patient hold back; the respectful shake hands and stay out
of other people's fights. Friends, tag partners and allies (their own, or
through their teams) run in for each other and make the saves; rivals and
grudges cost each other matches and confront each other; tag teams at odds face
off as teams; teammates who stop trusting each other clash, and then split.
Anything you record yourself counts the same way.

**Occasional and varied.** Every chance starts small, and the pace scales it.

| Pace | Chances | At most, before a show / after its matches (all together) / a week | Measured* |
|---|---|---|---|
| Quiet | ×0.5 | 1 / 1 / 2 | 0.4 a show (0.3–0.6) |
| Normal | ×1 | 1 / 2 / 3 | 0.7 a show (0.5–1.0) |
| Wild | ×2 | 2 / 3 / 6 | 1.2 a show (1.0–1.5) |

\* `tools/universe-story-demo.mjs`, 12 weeks of Raw and SmackDown, 16 seeds.

A show never gets two of a kind or one wrestler twice. Anyone in something in
the last 2 weeks is less likely to be in more. The same thing between the same
people doesn't happen again for 6 weeks. After an eventful episode, the show's
next one is calmer. Betrayals are at least 3 weeks apart across the universe,
breakups and turns 4.

**Big moments are earned.** Buildup between two partners counts 2 for each
clash of team tension in the last 12 weeks, 1 per level of grudge, 1 for
losing 2 of their last 4 together, 1 for an opportunist, 1 for the ambitious
with a champion for a partner. A **betrayal** needs 5, including tension or a
grudge of heat 2. At 7, a face who betrays turns heel; at 7, or with 2
clashes behind them, their team splits too. A **breakup** needs 2 clashes within 12 weeks. A
**turn** needs a record: a face with 2+ attacks or betrayals in 12 weeks goes
heel; a heel with 2+ saves, alliances, truces — or attacks from heels — goes
face. Nobody turns twice within 10 weeks; tweeners and wrestlers with no
alignment are left alone. A true **shock** — a betrayal from nowhere — is a
0.4% long shot at most once every 8 weeks. At a normal pace, the demo comes
to about one big moment every 30–35 shows.

**The auto booker reads it.** Its events are canon for the booker too: they make
matches likely on the next cards (see Storylines). The director doesn't read
drafts; it sees a match once it's booked, as it always has.

**It never** enters, invents or changes a match or its winner; never awards a
title (titles change only on a result you enter); never moves anyone between
shows (only relegation and the draft do); never books a match. A breakup
disbanding a team and a turn changing an alignment are all it changes beyond
the story.

**An underdog can rise.** A title challenger is drawn from everyone eligible
on the title's show and division, weighted by momentum, grudges, wins over the
champion, streaks and ambition — never ranked out. An upset or a run from low
in the standings is noticed ("On the rise"), and momentum feeds title demands.
So if the CPU keeps giving someone at the bottom wins, the story follows: in
the demo, Akira Tozawa's run leads to a title demand, a title match you book,
and — because the results said so — the title.

**Reproducible.** Each save has its own seed, rolled at random the first time
the director runs (by the app; the model never rolls). Every draw is a hash of
the seed, the show, before or after, the run and the possibility, so the same
save always tells the same story. Every run is logged — its seed, run number,
pace, and every possibility it weighed (the 80 likeliest) with its chance and
draw — under **The director's log** on the show's page and the What happened
page. If what it picked ever can't be recorded, the run is logged with nothing
made and the reason, so it can be looked into and nothing after it is held up. `npm run demo:story` (or `node tools/universe-story-demo.mjs [weeks] [seed] [pace] [results]`)
plays a universe forward the same way and checks that the director left every
result, title and roster alone.

**Yours to change.** Tap any event: **Edit** it (it's marked as edited by you),
or **Undo it** — its incidents come off, a turn goes back, a team it split is
back together. **Undo all** takes back everything the director did around a
show; **Run it again** undoes it and draws again with the next run number,
just as reproducible. What you undo stays undone — the director never does a
show's part twice by itself. **Record something yourself** adds your own,
before the show or during and after it. Switch the director off on the What
happened page and nothing more happens by itself; switch it back on and it
starts from that week. If a result an event followed is corrected later, the
event is marked, and stays until you change it.

**On a wrestler's page**, **Story** shows what they're after — keep the title,
revenge on someone, win their show's title, tag team gold, turn it around — and
their momentum (hot, rising, steady or cold, from their last six results,
wins over champions and winning runs), with their latest story events.

From the demo (seed 23, normal pace; the results are a stand-in for the CPU):

```
Week 3
  Raw · Week 3
    after   Kevin Owens and Sami Zayn clashed — trouble in KO & Sami  (KO & Sami lost at Raw · Week 3)
Week 4
  SmackDown · Week 4
    after   Bron Breakker is on the rise  (Bron Breakker beat Carmelo Hayes, a champion, from 6th of 6)
Week 5
  Raw · Week 5
    before  Akira Tozawa called out Gunther over the World Heavyweight Championship  (Akira Tozawa is hot — 4 straight wins)
    card    Akira Tozawa vs Gunther (World Heavyweight Championship) · KO & Sami vs Judgment Day · …
    winners Akira Tozawa (new champion) · Judgment Day · …
    after   Gunther attacked Akira Tozawa — Cody Rhodes made the save  (Gunther lost to Akira Tozawa at Raw · Week 5)
Week 7
  Raw · Week 7
    before  Kevin Owens confronted Seth Rollins  (Kevin Owens holds a grudge against Seth Rollins (heat 1))
    after   Kevin Owens and Seth Rollins brawled  (Seth Rollins and Kevin Owens are rivals (heat 1))
```

## Simulate ahead

To see how much the next few weeks could change, **Simulate ahead** (the
Calendar's season card, or Go to) plays them on a **copy** of the universe and
reports what changed. Nothing is saved: the universe — its results, titles,
story and relationships — is exactly as it was, and the copy lives only on that
page. That's the line the app never crosses elsewhere: in the universe itself,
results only come from the game.

Pick how long (1, 2, 4, 8 or 12 weeks, starting with this week), how results go,
and the story director's pace for the run (it runs in the copy even if it's
switched off in the universe). Each week is played the way you would play it:

1. every show's usual episode is planned (premium live events already on the
   calendar are included);
2. the story director goes before each show, once it's the next one up;
3. a draft waiting on a show is booked as it stands; a show with no card gets
   one from the auto booker, by that show's settings;
4. a stand-in for the WWE 2K25 CPU decides each match, and the story director
   goes straight after it.

| Results | How the stand-in decides |
|---|---|
| Favourites usually win | each side's strength is its wrestlers' win rate (an even start for a newcomer), up a little for momentum or gold and down for a cold run; the chance of winning goes with strength squared — a 70% wrestler beats a 40% one about three times in four |
| Anyone can win | every side the same chance |

About 1 match in 25 is a draw or a no contest either way. A title changes hands
when its challengers win it (a tag title needs a team on the winning side);
\#1 contender's matches, relegation and qualifying matches on the card do what
they always do.

**What changed** compares the copy with the universe as it is: title changes
and new #1 contenders; every relationship that formed, grew, cooled or ended;
every story event, where and when ("Raw · Week 6, straight after Cody vs
Gunther"), counted by kind; turns and teams that split; the feuds that matter
most now (new ones marked); each show's top three and biggest climber; who's
hot and who won most. **Run it again** is another draw — the same universe,
settings and draw always simulate the same weeks.

## Profiles and records

Tapping a wrestler, team or title opens its **profile page**; Back retraces the
path (roster → wrestler → team → title) and returns to where the list was
scrolled.

- **A wrestler** shows their current show, singles record, tag record, title
  reigns, what they're booked in next, their personality and relationships
  (see above), every team they've been on with who
  they teamed with and their record together, makeshift partners, a dated
  career history and every result.
- **A team** shows its own record, what it's booked in, current and former
  members with dates, title reigns, its history (formed, members joining and
  leaving, disbanding, reuniting, titles) and its results.
- **A title** shows the champion with reign length and successful defences,
  upcoming title matches, and the full history of reigns.

How records are counted, which is the part that matters:

- A match is **singles** for a wrestler when their own side was just them — a
  triple threat is singles, and so is the lone wrestler in a handicap match.
  It's **tag** when they had a partner.
- **A team's record is its own.** It counts only matches recorded as that team
  (the match form's "as a tag team" pick). Its members' singles matches, and
  tag matches they had with other partners, never add to it. When two
  members of a registered team are put on one side without the team, the form
  offers "Wrestling as …?" rather than assuming.
- Records are wins–losses–draws; no contests are counted and shown alongside.
- A **defence** is a title match, dated inside the reign, that the champion was
  in and that didn't change the title. Reign length is in weeks and carries
  across seasons.

## Moving wrestlers and changing line-ups

**Move show** on a profile — or **Select** on the roster to move several at
once — puts wrestlers on any show (Raw, SmackDown, Dynamite, NXT, Evolve…) or unassigned. Shows
have no size limit and can even be emptied. A move is dated (backdating within
the season is allowed, but moves stay in order) and added to the wrestler's
history. Nothing they've done changes: a result names the wrestlers who were
in it and belongs to the event's show, not to wherever those wrestlers are now.

A team's **line-up** changes the same way: joining and leaving are dated spells,
so a former member keeps the team — and their record with it — on their
profile, and matches the team already wrestled keep the line-up they had.

## Correcting mistakes

Each tool fixes one thing, says what it will take back before it does, and
refuses rather than disturb anything else:

| Mistake | Fix |
|---|---|
| Wrong winner, people, finish or title on a result | **Correct** it on the show's card, in place: it keeps its place on the card, and every record it touches follows. If it changed a title, a different winner becomes that reign's champion — the reigns after it are untouched. Dropping the title change hands the belt back, but only while nothing later on that title depends on it. |
| A result entered for a match that hasn't really happened | **Clear the result** from the same form: the match goes back to booked, off everyone's record, and a title it changed goes back (on the same terms). |
| A match that shouldn't be on the card | **Take it off the card**. If it was played, its result goes with it; a title it changed goes back, on the same terms. |
| A move made by mistake | **Undo last move** on the profile: the wrestler goes back, earlier moves stay. |
| A line-up change made by mistake | **Undo last change** on the team page (joining, leaving, disbanding or reuniting). A join someone has since wrestled under can't just vanish. |
| An older reign recorded wrong | Tap it in the title history: correct who held it or the week it began. Its neighbours are checked, not changed. A reign won in a result is corrected through that result. |
| A show on the wrong week or night | Change it in the show's **Details**; any title change there moves with it, as long as the title's history still reads in order. An episode still called by its default name ("Raw · Week 3") is renamed to match. |
| The same wrestler entered twice | **Merge a duplicate** on the profile: results, team spells and reigns move over. Refused if the two were ever in the same match or on the same team. |
| Something added by mistake with no history | Delete it. |
| A relegation result entered wrong | **Correct** it on its match: the wrestler who really lost goes down, and the other comes back. Clearing it, or taking it off the card, brings them back — while it's still their latest move. |
| A relegation decision made wrong | **Undo** it on the transition page. |
| A season transition started by mistake | **Cancel** it, while nothing is booked or drafted from it. |
| A qualifier result entered wrong | **Correct** it on its match: eligibility follows the real winner — refused once they've been drafted, until that pick is undone. |
| A drafted match you don't want | Change it, **Draw again**, or take it off the draft. |
| A whole draft card you don't like | **Draw the rest again** (what you changed or added stays), or **Discard the draft**. |
| An auto-booked match, once it's on the card | Edit or take it off like any booking — it's marked as changed by you. |
| A story event the booker followed, that shouldn't have happened | Undo it (or edit it) on its show as usual. A drafted match that followed it says so; **Draw the rest again** starts from what's on record now. |
| A draft pick made wrong | Reopen the window if it's closed, then **Undo** the pick: everyone drafted with it goes back where they came from, and a title vacated with it goes back — while it's still their latest move and the title hasn't changed hands since. |
| The transfer window opened too early | **Take back opening the window**, while nobody's been drafted. |
| An automatic relationship change you don't agree with | **Ignore** it on the timeline. It stays there, crossed out, and doesn't count; **Count it again** brings it back. |
| A relationship change of your own, made wrong | **Take back** on the timeline. |
| An incident recorded wrong | Tap it on its show: edit it, or undo it. The relationships it built follow. |
| A trait set wrong | **Edit personality** again. A trait set from the start can be removed from the start, as if it had never been there. |
| A story event you don't want | Tap it: **Edit** it, or **Undo it** — its incidents go, a turn goes back, a team it split is back together (while nothing has changed on the team since). The director won't do it again by itself. |
| Everything the director did around a show | **Undo all** on the show's page, or **Run it again** for a different outcome (the next draw — just as reproducible). |
| The result behind a story event corrected | The event is marked ("The result it followed has been corrected since") and stays on the record — edit it or undo it if it no longer fits. |
| A result before WrestleMania corrected after relegation matches were booked | The candidates, pairings and relegations stand as booked. The transition page lists exactly whose win totals moved, and what the rule would pick now; a relegated wrestler's record shows their total now beside the one it was decided on. Any change — undoing a relegation, re-pairing — is yours. |
| A title history flagged after a correction | The title's page names the title match the champion of the day wasn't in (or the change the outgoing champion wasn't part of). Correct whichever result is really wrong. |
| A qualifier result after the transfer window closed | Refused while the window is closed — its record of who was left undrafted rests on it. Reopen the window, correct it, close it again. |
| A title the draft vacated | Comes back only by undoing that draft pick, never from the title page. |
| A connection's rule set wrong | Change it back in **Tiers & transfers**. A transition already under way keeps the rules it started with; to use new rules for it, cancel and restart it while nothing is booked from it. |
| A tier moved or removed by mistake | Move it back, or add it again and put its shows back. Moving tiers away and back keeps their connection's rules; a removed tier's connection starts over. |
| A show added by mistake | Delete it from its row in **Tiers & transfers**, while nothing on record names it. |
| The universe itself went wrong (a bad import, a reset, a week to redo) | Save sheet → **Restore points**. |

## Saving

Every change is saved to the browser straight away, under its own key
(`wwe_universe_v1`). Opened from the same place as the fantasy app — both as
local files in Chrome, say — the two apps share one browser storage area, which
is why Universe never reads or writes the fantasy app's keys.

The save menu (top right) exports the whole universe as a JSON file and
imports one back; that file is the real backup, and how the universe moves
between browsers or devices. The save sheet says when a save file was last
exported from this browser — or that one never has been.

**Restore points** are copies kept in the browser, taken automatically before
an import, a reset or a restore replaces the universe, and each time the week
moves on (only the newest of those), or by hand (**Keep a restore point
now**). Up to four are kept, oldest dropped first; restoring one first keeps
what you have as another, so it can be undone. They share the browser's
storage with the save itself and give way — oldest first — whenever the save
needs the room, so they can never cost you a save. They're checked like an
imported file before they're used.

**Published on claude.ai**, a browser's storage can't be relied on, so every
save also goes to the artifact's database, into the viewer's own private
space (`data/users/<id>/` — nobody else, the page's owner included, can read
it), and any browser that opens the page loads it from there. A universe is
bigger than one database document allows, so it's stored in parts in one of
two slots, with a small manifest written last: a save that's cut off leaves the
previous one whole. A change that couldn't go up is kept in the browser and
sent next time; if the stored copy ever can't be read, the page shows the
browser's copy and never writes over it. Export there goes through claude.ai's
save prompt, since a published page can't start a download itself. None of
this runs when the app is opened as a file (`cloud.js`).

Import refuses anything that isn't a sound universe — wrong app, newer
version, or data that fails `validate()` — before touching what's there. A
stored save that can't be read on load is copied aside to
`wwe_universe_v1:unreadable-N` and never overwritten; if even the copy can't be
written, the app stays read-only rather than lose it.

Saves carry a `version`, and `migrate()` walks older saves forward one step at
a time. **Version 2** added team line-up history: a version 1 save only knew
each team's current members, so on load everyone becomes a founding member and
nobody has left. **Version 3** added the calendar and bookings: every result
in an older save becomes a played match, and every show lands on its show's
night (a PLE on Saturday). **Version 4** added the season transition and the
relegation record; nothing in an older save was a relegation match. **Version
5** added NXT promotion, draft eligibility and draft picks; a version 4
transition gets an empty qualifier field and an unopened window. **Version 6**
added personalities, incidents and relationship edits; an older save starts
with no traits, no incidents and no edits, and its relationships are worked out
from its results and teams on load. **Version 7** added story suggestions;
an older save starts with them on, at a normal pace, having suggested
nothing, and its incidents name no title or team. **Version 8** replaced
suggestions with the story director: an accepted suggestion's incidents stay,
as the owner's, with its reasons as their cause; open and dismissed ones are
dropped; and the director starts from the save's current week, so nothing
already played is gone over again. **Version 9** added tiers. Nothing is
replaced or dropped. The shows go into the tiers they always worked as: Raw,
SmackDown and Dynamite in tier 1, NXT in tier 2. Evolve is added as tier 3.
The rules between them are the ones that used to be written into the code.
Each season transition keeps its candidates, pairings, qualifiers and window as
they were, as its main roster ⇄ NXT part. Every relegation, eligibility and
draft record is marked as belonging to that connection, and each relegation
keeps where it went (NXT). **Version 10** added the auto booker: nothing in an
older save had been drafted or auto-booked, every show drafts by its tier's
defaults, and wrestlers can be away as well as active or injured. **Version 11**
connected it to the story: drafted and auto-booked matches name the story events
behind them (none, for anything drafted before), and a draft remembers what it
had seen (one drafted before doesn't know, so it points out nothing).
**Version 12** added relationships between tag teams: every relationship change
in an older save is between two wrestlers. Teammates being allies at strength 3
is worked out from the record, like every relationship, so an older save shows
it at once. **Version 13** added #1 contender's matches: no match in an older save
was one. **Version 14** has the director run straight after each match: every
run in an older save was for a whole show's part, and a show already gone
through that way isn't gone over again match by match.
`tools/fixtures/` holds real version 1 and 2 saves, written by that version's
code, and the tests load both.

## Not built yet, on purpose

Evolve's annual events aren't built yet. Nor is carrying out the tier rules kept
for them: Evolve's champions moving up to NXT by themselves at the transfer
window, moving down at the window, and moving up straight after a qualifier.
The rules are stored, editable and shown with who they'd move, but nobody moves
by them.

The auto booker reads the story director's events, but never makes one, and the
director doesn't read drafts. Neither writes promos or segments: a story event
is something on record, and a match is always one the owner books.

The story director tells the story around the matches; it doesn't write
promos, run injuries, handle contracts or book whole cards, and it only goes
over the last couple of weeks of the current season (it reads the record as it
stands now, so it never rewrites the past). A relationship still only changes
because of something on record — a result, a team change, or an incident,
whether the director's or yours. Whatever the story sets up, the result still
comes from the game.
