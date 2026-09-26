# Universe

A companion app for WWE 2K25's Universe Mode. The owner plans each show and
books its card here, watches the CPU play the matches in the game, then enters
what happened. The game is the only source of truth for results: this app never
simulates a match, picks a winner or talks to the game. And the owner is exactly that — someone who sees every wrestler,
relationship and result — not a GM character inside the universe, so there is
no in-world viewpoint or hidden information anywhere in the model.

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
  index.js             start-up, tabs, the save-file sheet
  views.js             the tabs: Calendar, Roster, Teams, Titles, History
  ranks.js             the Rankings tab: standings and booking balance
  standings.js         the arithmetic behind it - pure, runs under Node
  relegation.js        the season transition page, and its relegation part
  promotion.js         its NXT promotion and transfer window parts, and the draft
  card.js              a show's page and match card; the booking / result form
  pages.js             profile pages: a wrestler, a team, a title
  edits.js             the sheets behind the profiles
  sheets.js            creating wrestlers, teams and titles; the season clock
  ui.js                small HTML building blocks
tools/universe-test.mjs       93 model tests      npm run test:universe
tools/universe-check.mjs      129 browser checks  npm run check:universe
tools/fixtures/universe-v1.json   real version 1 and 2 saves, written by the code
tools/fixtures/universe-v2.json   of those versions, for the migration tests
```

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
| events    | weekly episodes (one show) and premium live events (one show, or all), each on a week and a night, each holding its card |

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

## Profiles and records

Tapping a wrestler, team or title opens its **profile page**; Back retraces the
path (roster → wrestler → team → title) and returns to where the list was
scrolled.

- **A wrestler** shows their current show, singles record, tag record, title
  reigns, what they're booked in next, every team they've been on with who
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

## Saving

Every change is saved to the browser straight away, under its own key
(`wwe_universe_v1`). Opened from the same place as the fantasy app — both as
local files in Chrome, say — the two apps share one browser storage area, which
is why Universe never reads or writes the fantasy app's keys.

The save menu (top right) exports the whole universe as a JSON file and
imports one back; that file is the only backup, and how the universe moves
between browsers or devices.

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
transition gets an empty qualifier field and an unopened window.
`tools/fixtures/` holds real version 1 and 2 saves, written by that version's
code, and the tests load both.

## Not built yet, on purpose

Personality events and story generation are later work. The foundation is
shaped for them — results record sides, winners, finishes and titles,
standings rank every show, roster moves record who changed show and when, the
season transition keeps why each wrestler went down or came up, and seasons
have hard edges — but none of that logic exists yet. Whatever suggests a match, the result still comes
from the game. There are
also no personality or relationship fields: those belong to the features that
will use them, and inventing their shape now would only mean migrating it
later.

