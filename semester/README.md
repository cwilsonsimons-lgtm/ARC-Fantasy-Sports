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
