# Rookie Match

Rename Madden's auto-generated draft prospects after real-life prospects with a
similar position, height and weight. You keep Madden's ratings, looks and
attributes; Rookie Match only helps you pick the name.

This is a separate app from the fantasy-league prototype in the repo root. It
uses the same setup as `card-factory/`: React + TypeScript, built by esbuild
into one self-contained HTML file.

## Running it

Open `dist/rookie-match.html` in a browser. It's one file with no server, no
login and no network needed.

```
cd rookie-match
npm install
npm run build        # rewrites dist/rookie-match.html
npm test             # matching, parsing, tracking, import, storage (vitest)
npm run typecheck
npm run check:ui     # drives the built page through every required case in Chromium
```

`check:ui` takes an optional screenshot folder (`node tools/ui-check.mjs shots`)
and uses `/opt/pw-browsers/chromium` unless `CHROME_PATH` is set.

## Where data lives

Everything is saved in the browser's local storage on the current device. It
survives refreshes and browser restarts, but it does not sync to other browsers
or devices, and clearing site data erases it. **Settings & Data → Download
backup** writes a JSON file with every workspace, prospect, assignment and
setting. Restoring a backup asks before it replaces anything. If saved data
can't be read, the unreadable copy is kept under `rookie_match_v1_unreadable`
rather than deleted.

## Workflow

1. **Prospect Pool**: add prospects by hand, paste rows, or import a CSV
   (there's a downloadable template). The import preview lets you map columns
   and shows each row's problems. You can fix bad rows inline and map unknown
   positions before anything is saved.
2. **Find a Match**: enter the generated player's position, height and weight.
   Suggestions update as you type.
3. Click a suggestion (or press Enter to open the top one) to review it. Add the
   generated player's original name, Madden team and notes if you want them.
   Nothing is marked used until you click **Confirm assignment**.
4. **Match Next Rookie** clears the fields and puts the cursor back in Position.
5. **Assignment History**: search, edit, undo or delete. Undo and delete both
   make the prospect available again. After an undo, a toast offers **Restore**.

## Matching rules

Only the selected position is searched. The tiers are:

1. **Exact match**: same height and weight.
2. **Within preferred range**: height within ±1 in **and** weight within ±5 lb.
   The limits count as inside the range.
3. **Outside preferred range**: the remaining same-position prospects, shown as
   fallbacks.

Inside each tier, prospects are ranked by

    distance = |Δheight| / height tolerance + |Δweight| / weight tolerance

Lower is closer. Ties go to the smaller height difference, then the smaller
weight difference, then name A–Z. Differences are measured from the generated
player, so "1 inch taller, 4 pounds lighter" describes the real prospect. You
can change the tolerances (they must be positive). The range never widens on
its own: when nothing is in range, the app says so and labels the fallbacks.
The distance only compares measurements. It is not a probability, and it says
nothing about talent.

## Positions

Every prospect and Madden entry uses one canonical position list (QB RB FB WR
TE OT OG C DE DT LB CB S K P LS by default). Mappings convert other spellings
into a listed position, for example HB→RB, LT/RT→OT, LE/RE/EDGE→DE,
MLB/LOLB/ROLB→LB and FS/SS→S. Vague labels such as DB, DL and IOL are left
unmapped on purpose, so an import flags them and you choose. The list,
mappings and related pairs can all be edited in Settings. Related positions
(e.g. CB↔S) are only searched when you switch on **Include related positions**,
and those results appear in their own section.

## Used-player tracking and workspaces

Used status isn't stored on prospects. It comes from the active workspace's
assignments, so the two can't disagree. The same prospect can't be assigned
twice in one workspace, and a used prospect can't be deleted until its
assignment is undone. Each workspace (franchise or draft class) has its own
pool and assignments. A new workspace can copy another's pool, and everyone in
the copy starts available.

## Sample data

A first run starts with 34 **fictional** sample prospects, each tagged Sample.
The WRs are clustered around 6'3" 215 lb so every tier appears for that search.
**Remove samples** on the Prospect Pool screen deletes them.

## Layout

```
src/core/   height.ts (parsing) · positions.ts · match.ts (tiers + distance)
            state.ts (model + pure operations) · importer.ts · csv.ts
            storage.ts (localStorage, backup, CSV export) · sample.ts
src/ui/     App · FindMatch · Pool · ImportDialog · History · SettingsPage · common
test/       core.test.ts
tools/      build.mjs · ui-check.mjs
```
