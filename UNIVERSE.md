# Universe

A companion app for WWE 2K25's Universe Mode. The owner plans each show and
books its card here, watches the CPU play the matches in the game, then enters
what happened. The game is the only source of truth for results: this app never
simulates a match, picks a winner or talks to the game. And the owner is exactly that — someone who sees every wrestler,
relationship and result — not a GM character inside the universe, so there is
no in-world viewpoint or hidden information anywhere in the model. Around the
matches, a story director fills in the rest of the story by itself — attacks,
saves, betrayals, alliances, challenges — from the record, as canon, without
ever touching a result.

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
  relegation.js        the season transition page, and its relegation part
  promotion.js         its NXT promotion and transfer window parts, and the draft
  card.js              a show's page and match card; the booking / result form
  pages.js             profile pages: a wrestler, a team, a title
  edits.js             the sheets behind the profiles
  sheets.js            creating wrestlers, teams and titles; the season clock
  find.js              the search beside long wrestler and team dropdowns
  ui.js                small HTML building blocks
tools/universe-test.mjs       119 model tests     npm run test:universe
tools/universe-check.mjs      180 browser checks  npm run check:universe
tools/universe-sample.mjs     a whole sample season, shared by the tests and the checks
tools/universe-story-demo.mjs a few weeks of the story director, printed  npm run demo:story
tools/fixtures/universe-v1.json   real version 1 and 2 saves, written by the code
tools/fixtures/universe-v2.json   of those versions, for the migration tests
```

## The workflow

1. **Set up.** Add wrestlers (paste a whole roster at once) to Raw, SmackDown,
   Dynamite and NXT — any sizes. Add tag teams and titles, and crown the
   champions. Give wrestlers traits if you like.
2. **Each week.** The Calendar opens on the week, with **Up next** — today's
   show. Plan an episode: the story director decides what happens **before the
   show** (a confrontation, a title demand…), so you can book the card around
   it. Play the matches in WWE 2K25, then enter each result as the game produced
   it; once the card is complete the director decides what happens **after**
   (an attack, a save, a betrayal…). Record anything else you saw yourself. Tap
   **Next week** when it's done.
3. **Keep track.** **What happened** (on the Calendar's season card) is the
   story so far. Rankings (standings and booking balance), Titles, Roster (and
   its Relationships view) and History all read the record. None of them books
   or decides a match.
4. **After WrestleMania.** Start the season transition from WrestleMania's page:
   relegation matches on each main show's next episode, NXT qualifiers, then the
   transfer window and the draft. Close the window, then start the next season.
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
- **Relegation**: on each main show, the fewest wins up to and including
  WrestleMania (default 2 candidates) face each other on its next episode; the
  loser moves to NXT on the result. Candidates are fixed when booked; a later
  correction to the win totals is shown against them, never applied.
- **NXT promotion**: NXT champions are eligible when the window opens;
  qualifier winners are eligible on the result. Eligibility moves nobody — the
  draft does. A qualifier can't change once its winner is drafted, or while the
  window is closed.
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
| Who wrestles whom, which titles are on the line, when shows air | The calendar and the card — rankings and booking balance only inform, and a story event's **Book the match** only fills in the form |
| Whether a pairing wrestled as a registered tag team | The result form ("Wrestling as …?") |
| Traits, and any relationship you want started, set, ended or ignored | A wrestler's page; the page for two wrestlers |
| What counts as an incident | The show page |
| Any story event you'd rather hadn't happened: edit it, undo it, or run the show again; the director's pace, or switching it off | The event (tap it), the show page, What happened |
| When WrestleMania is, and starting the transition from it | WrestleMania's page, or the season card |
| How many relegation candidates each show has (any number, zero included) | The transition page |
| A tie across the cutoff, an odd candidate out, the pairings | The transition page — booking waits for these |
| Results still missing before WrestleMania: enter them, or count wins as they stand | The transition page |
| A relegation match without a winner: rematch, or who (if anyone) goes down | The transition page |
| Whether a correction to the win totals after booking should change anything | The transition page shows what moved; it changes nothing itself |
| Who's in the NXT qualifiers (suggestions from the season record), their pairings, a qualifier without a winner | NXT promotion |
| When the transfer window opens and closes, who's drafted where, how many each show takes | Transfer window |
| For each pick: keep or vacate every title they (or their team) hold; bring tag partners along or split the team | The draft sheet — the pick waits for an answer |
| Which result is wrong when a title history is flagged | The title's page, then the result |
| Injuries, alignment and other details | A wrestler's page |
| When a season ends and the next begins | The season card |
| Exporting save files — the only backup that leaves this browser | The save sheet |

## Getting around

- **Go to** (top right): Up next, this week's shows, results, rosters, tag teams,
  champions, rankings, booking balance, relationships, what happened, the
  season transition and transfer window, and saving — each with where it
  stands — plus every "How it works" sheet.
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
| shows     | Raw, SmackDown, Dynamite, NXT. Rosters are uncapped and never expected to match in size. |
| wrestlers | name, division (men's / women's), where they come from (WWE / AEW / NXT / Other — independent of which show they're on), alignment, active or injured, notes, current show |
| moves     | roster history: one row per change of show, dated, with an optional note |
| teams     | two or more wrestlers, plus a log of the team forming, disbanding and reuniting. A wrestler can be on several; a team split across shows is allowed and flagged |
| memberships | team line-up history: one row per spell a wrestler spent on a team, dated when they joined and left |
| titles    | singles or tag, a division, one show or none, can be retired |
| reigns    | title history. The reign with no end is the champion |
| shows     | also the night each airs: Raw Monday, NXT Tuesday, Dynamite Wednesday, SmackDown Friday |
| seasons   | always exactly one active, each with its own week counter (the clock), and optionally the real date its week 1 falls in |
| events    | weekly episodes (one show) and premium live events (one show, or all), each on a week and a night, each holding its card — and its incidents: betrayals, interferences, attacks, saves, brawls, confrontations, challenges, open challenges, demands, alliances, tension, walk-outs, truces, turns and runs of momentum. Each is before the show or after it, and the director's keep their run and their cause |
| traitLog  | every change to a wrestler's personality, one trait at a time: dated, or counted from the start. A wrestler's `traits` are where it ends up |
| relEdits  | the owner's own relationship changes (start, set, end, note — dated, or from the start) and the automatic changes they've chosen to ignore |
| story     | the story director: on or off, its pace, the save's seed, the week it started from, and a log of every run — the show, before or after, the seed and run number, every possibility it weighed with its chance and draw, and what it recorded |

A **match** is one record from the moment it's booked: its sides — each a set
of wrestlers, plus the tag team they wrestled as — the title on the line, a
stipulation and notes. While it's `scheduled` it has no result at all. Entering
the result makes it `played`: a win (with the winning side), a draw or a no
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
   royal) or build any line-up side by side, then the title on the line and a
   stipulation. Booked matches can be edited, reordered or taken off the card,
   and they count for nothing yet.
3. Watch the CPU play it in WWE 2K25, then **Enter result**: who won, a draw or
   a no contest; the finish and who took the fall if you want them; whether
   the title changed hands; and notes on what happened. The form shows the
   match as booked and leaves the result blank until you pick it — saving
   without one is refused. (A run-in or a late change? Change the line-up from
   the same form.)
4. **Next week** moves the clock on. Browsing other weeks with the arrows, or
   from the season grid, never moves it.

Each show's row, its page and the season grid say where its card stands:
planned, booked, some results in, or complete. **Set dates** pins a season to
the real calendar — pick any day in its week 1 — so every show shows its date;
without one, shows are labelled by week and night.

The **History** tab browses the past, newest first: **Results** lists every
result show by show, filterable by season and by show (or just the PLEs), each
with its finish, title and notes; **Everything** puts results, title changes,
moves and team changes on one timeline. Tap any of it to open the show.

## The season transition: relegation after WrestleMania

Once a season, WrestleMania ends it. Each main-roster show — every show but NXT:
Raw, SmackDown and Dynamite — holds its own relegation matches on its first
episode after WrestleMania. Whoever loses a relegation match moves to NXT the
moment the result is saved; the winner stays. The game decides who wins.

Start it from the season card on the Calendar ("WrestleMania ends the season")
or from WrestleMania's own page. The transition page has a section per show:

- **The win totals.** Everyone who was on the show at WrestleMania, fewest wins
  first — wins in that season up to and including WrestleMania, singles and tag,
  wherever they happened (relegation matches themselves never count). This is
  the list the candidates come from, shown in full.
- **Candidates.** The ones with the fewest wins — as many as you set *for that
  show* (two to start; any number, including none). Tap anyone to make them a
  candidate or not. Shows never have to match: roster sizes, numbers of
  candidates and numbers relegated are each show's own.
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
| A relegation match without a winner (draw or no contest) | Book a rematch, or send one (or neither) to NXT yourself |

Also shown, without holding anything up: an injured candidate, a candidate who
has changed show since WrestleMania, a pairing across divisions, a candidate
with no matches, and candidates you picked by hand.

**The record.** Every relegation keeps, for good, the show they were relegated
from, the match and who won it (or that it was your decision, with your note),
and the win total and place that made them a candidate — or that you picked
them. It shows on the wrestler's page, on the transition page, and in their
career history as the move to NXT. A wrong relegation result is corrected like
any other: the real loser goes down and the other comes back; clearing the
result or taking the match off the card brings them back — only while it's
still their latest move, so nothing later is rewritten. A relegation match's
line-up is its pairing, so it's changed only on the transition page.

## NXT promotion and the transfer window

The season transition page has three parts: **Relegation**, **NXT promotion** and
**Transfer window**.

**NXT promotion.** NXT's first show after WrestleMania holds one-on-one
qualifying matches (**Plan it** puts that episode on the calendar if it isn't
there).

- **Who's in them is your pick.** Everyone who was on NXT at WrestleMania is
  listed with their season record, ranked exactly as on the Rankings tab. The
  top few (you set how many), leaving out champions and the injured, are marked
  *Suggested* — **Pick them** takes all of those, or tap anyone in or out. The
  order you pick in is the pairing order, and pairings can be changed.
- **Winners become draft eligible**, the moment the result is saved. A
  qualifier without a winner is your decision: a rematch, or send one, both or
  neither through (with a note). A corrected result changes who's eligible —
  refused once they've been drafted, until that pick is undone.
- **Every NXT champion is draft eligible without a match** — both members of a
  team holding an NXT tag title. They're fixed as eligible when the transfer
  window opens.
- **Eligible moves nobody.**

**The transfer window.** Open it when you're ready (it can be taken back until
someone's drafted). Tap an eligible wrestler to draft them to Raw, SmackDown or
Dynamite. Each show can take any number, and rosters never have to come out
even — the tiles show each show's roster, plus drafted in and relegated out.
End the window whenever you like: anyone left undrafted stays on NXT, and the
closed window keeps who that was. It can be reopened to draft more or undo a
pick; an undone pick goes back to NXT, and a title vacated with it goes back to
its holder — only while nothing has happened since.

**Decided at every pick, never by the app:**

| Question | How it's asked |
|---|---|
| A drafted wrestler (or their team) holds a title | **Keep it** or **Vacate it** — the pick waits for an answer |
| A drafted wrestler has tag partners | **Bring them too** (eligible or not — noted as your decision), or leave the team split across shows |

**The record.** Each eligibility says how it came about: holding an NXT title
(which one, and with which team), winning a qualifier (against whom), or your
decision after a qualifier without a winner (with your note). Each pick keeps
its number, the show, the eligibility it used — or that a partner came along by
your decision — every title kept or vacated, and a note. The window page lists
every roster move since WrestleMania in order: relegations, draft picks, and
any other transfer. Wrestlers' pages show their draft, or that they were
eligible and left undrafted.

## Rankings and booking balance

The **Rankings** tab reads the results you've entered and nothing else. It never
feeds back into booking: anyone can be booked against anyone with any title on
the line, and win it — the tests book the bottom of a table for the world title
and crown them. `model.js` and `card.js` don't use the standings at all.

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
| A betrayal (logged on the show) | a grudge against the betrayer, heat 2 (loyal: 3); any friendship or alliance between them ends |
| An interference | a grudge against whoever interfered; whoever it helped becomes their ally |
| An attack | a grudge against the attacker (hot-headed: heat 2) |
| A save | the attacker holds a grudge against whoever made the save; the one saved becomes their ally |
| A brawl | a grudge each way, and they're rivals |
| A title challenge, calling someone out, or a confrontation | they're rivals (or 1 more heat) |
| An alliance | allies (or stronger ones) |
| Tension between partners | an alliance or friendship between them weakens a step |
| A truce | each grudge between them, and the rivalry, cools a step |
| Walking out on a team | anyone left behind holds a grudge; any friendship or alliance between them ends |
| 5 matches on the same side, win or lose | allies (either loyal: 3). At 12, friends — never for the opportunistic, or with a grudge between them |
| Leaving a tag team, or it disbanding | former partners |

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
vs. Raw 2011's Universe Mode. It runs by itself, at two moments, and nothing it
does waits for approval:

- **Before a show**, once it's the next one up — planned for this week, with
  every show before it through. What happens here comes before you book the
  card, so it can shape it: a confrontation is a match waiting to happen, and a
  title demand or challenge offers **Book the title match** (the booking form,
  filled in).
- **After a show**, once its card is complete, or its week has gone by.

It runs when a result goes in, when a show is planned, when you move on a
week, and when it's switched on. What it decides is canon at once: incidents
on the show, each with its cause, so relationships follow and it's on the
History timeline, each wrestler's page, the show's **Before the show** and
**During & after**, and the **What happened** feed (the Calendar's season card,
and its own page). The toast says what happened.

| Before a show | Comes from | Changes |
|---|---|---|
| Backstage confrontation | rivals and grudges on the show — much likelier if they're booked against each other | rivals |
| Title demand | someone hot or rising, ambitious, or who has beaten the champion lately — however low they're ranked | rivals with the champion |
| Open challenge | a champion who's proud, a fighting face, or hasn't defended lately; or someone red-hot | nothing — who answers is yours |
| New alliance | two with a grudge against the same person, or one who saved the other; never current partners | allies |
| Rivalry cools | a rivalry nobody has touched for 6+ weeks — likelier across shows, or for the patient | cools a step |
| Team tension, turn | as after a show | |

| After a show | Comes from | Changes |
|---|---|---|
| Post-match attack | a loser lashing out: hot-headed, proud, a heel, a grudge, a losing run against them, a title just lost, revenge | a grudge |
| Surprise save | someone stopping that attack: a friend, ally, partner, or someone with their own grudge against the attacker | a grudge, allies |
| Betrayal | a partner who has had enough — only after buildup (below) | a grudge; friendship and alliance end |
| Rivalry escalates | rivals or grudges, especially after sharing a ring | grudges both ways, rivals |
| Team tension | losing, a partner winning alone, opportunism, ambition, a grudge inside the team | weakens the alliance |
| Team breakup | only after repeated tension (below); never champions | a walk-out; the team disbands |
| Rivalry cools | a hard-fought match between rivals, a respectful or patient one among them | cools a step |
| Title challenge | a challenger drawn from everyone eligible (below) | rivals |
| On the rise | an upset over a champion from low in the standings (or after a losing record), or a winning run after losing more than winning | nothing — it's remembered for title shots |
| Turn | a record of it (below) | the alignment |

**Every event has a cause.** Its reasons come with it: the feed shows the lead
one ("Gunther lost to Akira Tozawa at Raw · Week 5"); tapping it shows them
all, what it changed — each relationship, an alignment, a team — and its chance
and draw.

**Occasional and varied.** Every chance starts small, and the pace scales it.

| Pace | Chances | At most, before a show / after / a week | Measured* |
|---|---|---|---|
| Quiet | ×0.5 | 1 / 1 / 2 | 0.4 a show (0.2–0.5) |
| Normal | ×1 | 1 / 2 / 3 | 0.7 a show (0.6–0.9) |
| Wild | ×2 | 2 / 3 / 6 | 1.1 a show (1.0–1.4) |

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
once — puts wrestlers on Raw, SmackDown, Dynamite, NXT or unassigned. Shows
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
| A relegation result entered wrong | **Correct** it on its match: the wrestler who really lost goes to NXT, and the other comes back. Clearing it, or taking it off the card, brings them back — while it's still their latest move. |
| A relegation decision made wrong | **Undo** it on the transition page. |
| A season transition started by mistake | **Cancel** it, while nothing is booked or drafted from it. |
| A qualifier result entered wrong | **Correct** it on its match: eligibility follows the real winner — refused once they've been drafted, until that pick is undone. |
| A draft pick made wrong | Reopen the window if it's closed, then **Undo** the pick: everyone drafted with it goes back to NXT, and a title vacated with it goes back — while it's still their latest move and the title hasn't changed hands since. |
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
already played is gone over again.
`tools/fixtures/` holds real version 1 and 2 saves, written by that version's
code, and the tests load both.

## Not built yet, on purpose

The story director tells the story around the matches; it doesn't write
promos, run injuries, handle contracts or book whole cards, and it only goes
over the last couple of weeks of the current season (it reads the record as it
stands now, so it never rewrites the past). A relationship still only changes
because of something on record — a result, a team change, or an incident,
whether the director's or yours. Whatever the story sets up, the result still
comes from the game.
