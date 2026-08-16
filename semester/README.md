# Semester Ledger

A single-file semester planner for a heavy course load. Unrelated to the fantasy
app in this repo — it just lives here so it is version-controlled somewhere.

Open `semester/index.html` in any browser; that one file is the whole thing
(fonts included as base64, no network, no build step, no dependencies). Data is
stored in `localStorage` under `semester_ledger_v1`, so it stays on the machine
that entered it. Export a JSON backup from the Courses tab before switching
browsers or clearing history.

## The idea

One entry per assignment does four jobs at once — it is a to-do, a block on the
calendar, a line in the study plan, and a graded item. Enter it once and it
shows up everywhere it matters.

- **Today** — how many days are left in the term, what is overdue, the three
  things worth starting right now (ranked by deadline × syllabus weight ×
  hours of work), and a bar chart of study hours owed per day for a week.
- **Week** — the real timetable: classes from each course's meeting times, plus
  suggested study blocks the planner drops into the actual gaps between them.
- **Work** — every assignment, filterable by course and status.
- **Grades** — weighted categories per the syllabus, the running course grade,
  and what average the remaining work needs to hit a target.
- **Courses** — the setup: meeting times, colours, grade weights, term dates,
  daily study cap, and the study window (default 08:00–22:00).

## The planner

`buildPlan()` walks the next 14 days. For each day it subtracts class meetings
from the study window to get free gaps, then fills them earliest-first with the
tasks that are due soonest — never scheduling a task past its own due date, in
sittings of at most 2.5 hours, with a 15-minute break between them, and never
more than the daily cap. Anything that cannot fit before its deadline comes back
as **at risk**, which is the useful part: it says a week ahead that six classes
do not fit into the days left, while there is still time to do something about it.

Keyboard: `1`–`5` switch tabs, `n` adds work.

## Getting work in from Canvas

A web page cannot call the Canvas API directly: Canvas serves no CORS headers,
so the browser refuses the response no matter what token you hold. Both routes
below therefore go around that rather than through it. Neither sends your data
anywhere — the sync script talks only to Canvas and writes a local file.

Canvas never publishes **class meeting times**, and the calendar feed carries no
**grade weights**. Those two stay manual, and they are what the schedule and
Grades tabs run on.

### 1. Paste or drop — no token, ~30 seconds

**Courses → Paste from Canvas** takes anything with dates in it:

- the contents of your Canvas calendar feed (`.ics`) — pasted as text, or the
  file dropped anywhere on the page;
- a plain list copied off the Canvas dashboard, a course page, or a syllabus:
  one item per line, each with a date. `Problem set 6 CHEM 232 Aug 20 11:59pm`
  and `Quiz 4 [MATH 221] due 8/24 at 10:00 AM` both read correctly.

Everything lands in a **preview** first, one row per item, where the title,
course and due date can each be corrected or the row dropped. Nothing is written
until that is approved — a fuzzy parser you cannot check is worse than typing.

Getting the feed: Canvas → **Calendar** → **Calendar Feed** (bottom right).
The link itself cannot be fetched by the page (no CORS), so open it in a tab,
let the browser download the `.ics`, and drop that in.

Course codes are matched to courses you already have; an unrecognised code
creates a course. Items keep their Canvas assignment id where one is available,
so re-importing a moved deadline updates the row in place and your hour
estimates, notes and status survive. Grades do not come through this route.

### 2. API sync — needs an access token, brings grades

```
node semester/tools/canvas-sync.mjs \
  --host unt.instructure.com \
  --token "1234~your-token" \
  --term Fall \
  --in  ~/Downloads/semester-ledger-2026-08-16.json \
  --out ~/Downloads/semester-canvas.json
```

Token: Canvas → **Account** → **Settings** → **+ New Access Token**. Some schools
disable student tokens; if the button is not there, use the calendar feed.
Requires Node 18+ (for `fetch`), no npm install.

This pulls courses, assignment groups **with their syllabus weights**, every
assignment, and your scores — then writes a backup file you load through
**Import backup**. Pass your current export as `--in` and the sync keeps
everything Canvas does not know: meeting times, colours, hour estimates, notes,
grade targets, and any course or task you added by hand. `--dry-run` prints the
summary without writing. Courses graded on raw points (all group weights zero)
get weights derived from points possible.
