# Universe

A companion app for WWE 2K25's Universe Mode. The matches are played or watched
in the game, with the CPU deciding who wins; the owner records the results here
afterwards. It never simulates a match, picks a winner, books a card or talks to
the game. And the owner is exactly that — someone who sees every wrestler,
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

```
universe.html          the page
css/universe.css       its whole stylesheet (plus Oswald and Barlow from css/fonts.css)
js/universe/
  main.js              entry point
  model.js             the data and every rule about it - pure, runs under Node
  persist.js           saving, loading, export and import
  app.js               commit (change + save + repaint), sheets, the page stack
  index.js             start-up, tabs, the save-file sheet
  views.js             the four tabs: Roster, Teams, Titles, History
  pages.js             profile pages: a wrestler, a team, a title
  edits.js             the sheets behind the profiles
  sheets.js            creating things; events and results
  ui.js                small HTML building blocks
tools/universe-test.mjs       49 model tests      npm run test:universe
tools/universe-check.mjs      64 browser checks   npm run check:universe
tools/fixtures/universe-v1.json   a real version 1 save, for the migration tests
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
| seasons   | always exactly one active, each with its own week counter |
| events    | weekly episodes (one show) and premium live events (one show, or all), each holding its results |

A result lists its sides — each a set of wrestlers, plus the tag team they
wrestled as — and a win (with the winning side), draw or no contest, with an
optional finish, stipulation and title on the line.

Anything that happens at a point in time carries a stamp,
`{ season, week, seq }`: the universe's own calendar, plus a counter that only
goes up to order things inside a week. The History tab's timeline is *built*
from those stamps on the records rather than kept as a second log, so it can't
drift out of step with them.

What the model enforces, so the data stays trustworthy as it grows:

- **A failed change changes nothing.** Every function checks all its inputs
  before touching the universe, and the UI additionally snapshots and restores
  around each change. The reason comes back as a sentence for the owner.
- **Nothing is inferred.** A title changes hands only when the result says so
  ("the title changed hands"), because only the owner knows whether a DQ
  finish or a cash-in moved the belt.
- **History can't be pulled out from under itself.** A wrestler, team or title
  with any history can't be deleted — leave them unassigned, disband or retire
  them instead. A result or event where a title changed hands can be deleted
  only while nothing later on that title depends on it; the belt then goes
  back to whoever held it before.
- **Title changes land in calendar order.** Backfilling a change into a week
  before the current reign began would crown the wrong champion, so it's
  refused. Match lists and the timeline sort by season and week, not by the
  order things were typed in.
- **Names are unique** (ignoring case and spacing) within wrestlers, teams and
  titles, which is what makes pasting a whole roster safe to repeat.

## Profiles and records

Tapping a wrestler, team or title opens its **profile page**; Back retraces the
path (roster → wrestler → team → title) and returns to where the list was
scrolled.

- **A wrestler** shows their current show, singles record, tag record, title
  reigns, every team they've been on with who they teamed with and their
  record together, makeshift partners, a dated career history and every result.
- **A team** shows its own record, current and former members with dates,
  title reigns, its history (formed, members joining and leaving, disbanding,
  reuniting, titles) and its results.
- **A title** shows the champion with reign length and successful defences,
  and the full history of reigns.

How records are counted, which is the part that matters:

- A match is **singles** for a wrestler when their own side was just them — a
  triple threat is singles, and so is the lone wrestler in a handicap match.
  It's **tag** when they had a partner.
- **A team's record is its own.** It counts only matches recorded as that team
  (the result form's "as a tag team" pick). Its members' singles matches, and
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
| Wrong winner, people, finish or title on a result | Tap it on its event and correct it in place. It keeps its place on the card. If it changed a title, a different winner becomes that reign's champion — the reigns after it are untouched. Dropping the title change hands the belt back, but only while nothing later on that title depends on it. |
| A move made by mistake | **Undo last move** on the profile: the wrestler goes back, earlier moves stay. |
| A line-up change made by mistake | **Undo last change** on the team page (joining, leaving, disbanding or reuniting). A join someone has since wrestled under can't just vanish. |
| An older reign recorded wrong | Tap it in the title history: correct who held it or the week it began. Its neighbours are checked, not changed. A reign won in a result is corrected through that result. |
| An event in the wrong week | Change its week; any title change there moves with it, as long as the title's history still reads in order. |
| The same wrestler entered twice | **Merge a duplicate** on the profile: results, team spells and reigns move over. Refused if the two were ever in the same match or on the same team. |
| Something added by mistake with no history | Delete it. |

## Saving

Every change is saved to the browser straight away, under its own key
(`wwe_universe_v1`). Opened from the same place as the fantasy app — both as
local files in Chrome, say — the two apps share one browser storage area, which
is why Universe never reads or writes the fantasy app's keys.

The save menu (top right) exports the whole universe as a JSON file and
imports one back; that file is the only backup, and how the universe moves
between browsers or devices.

Import refuses anything that isn't a sound universe — wrong app, newer
version, or data that fails `validate()` — before touching what's there. A
stored save that can't be read on load is copied aside to
`wwe_universe_v1:unreadable-N` and never overwritten; if even the copy can't be
written, the app stays read-only rather than lose it.

Saves carry a `version`, and `migrate()` walks older saves forward one step at
a time. **Version 2** added team line-up history: a version 1 save only knew
each team's current members, so on load everyone becomes a founding member and
nobody has left. `tools/fixtures/universe-v1.json` is a real version 1 save,
written by the version 1 code, and the tests load it.

## Not built yet, on purpose

Rankings, match booking, promotion/relegation (the annual transfer system),
personality events and story generation are all later work. The foundation is shaped for them — results already record sides,
winners, finishes and titles; roster moves already record who changed show and
when; seasons have hard edges — but none of that logic exists yet. There are
also no personality or relationship fields: those belong to the features that
will use them, and inventing their shape now would only mean migrating it
later.

