# Foil & Ink

A single-player management game: you run a sports-card manufacturer. Design a
set, decide how many of each card exist, pack them into boxes, pay to print,
ship on a release date, and watch fictional collectors buy, rip and trade
what you made while a fictional football league plays out week by week.

This is a separate app from the fantasy-league prototype in the repo root. It
shares that project's tooling approach (esbuild single-file build, Playwright
verification) and adds React + TypeScript.

## Running it

```
cd card-factory
npm install
npm run build        # writes dist/foil-and-ink.html and dist/artifact.html
```

Open `dist/foil-and-ink.html` directly in a browser. It is one self-contained
file; fonts load from Google Fonts when online and fall back to system faces
offline. `dist/artifact.html` is the same game for claude.ai, with React from
cdnjs and saves in the viewer's private cloud storage.

```
npm test             # simulation rules (vitest)
npm run typecheck
npm run check:ui     # drives the built page through the whole loop in Chromium
```

`check:ui` takes an optional screenshot folder: `node tools/ui-check.mjs shots`.
It uses the Chromium at `/opt/pw-browsers/chromium` unless `CHROME_PATH` is set.

## The loop (Stage 1)

1. **Set Creator.** Name, theme and release week. Pick the base checklist
   player by player (or quick-fill), and set how many copies of each base card
   to print. Add numbered parallels and autographs, choose their print run
   (/999 down to 1/1, or any number) and exactly which players receive them.
   The live preview renders any version for any player, and the production
   summary separates *unique cards* from *printed copies* and prices it all.
2. **Boxes & Packs.** Packs per box, cards per pack, boxes produced, price,
   guaranteed hits per box by category, and how many copies of each version
   go into the box. Validation explains shortages, impossible guarantees,
   leftover copies and over-allocation before anything is printed. Pull odds
   are computed from the allocation.
3. **Manufacturing.** Pay the bill. The checklist, print runs and allocation
   lock for good; every numbered copy gets its serial number now.
4. **Advance week.** On the release week the boxes go on sale. Collectors buy
   them (you earn the box price), open most right away and hold the rest.
   Pulls hit the secondary market; those sales never pay you but drive box
   demand, sentiment and reputation.
5. **Plan the next release** around who is rising in the league.

## Rules the simulation guarantees

* **Finite inventory.** Manufacturing turns print runs into exact per-product
  pools. Opening a box draws from the pool without replacement. A /10 card has
  ten copies across the whole release, serials 1–10, each issued once.
  Printed = in the vault + still sealed + pulled, for every card, always.
* **Guarantees hold in every box.** When boxes are opened, each sealed box's
  guaranteed hits are reserved first; only the surplus is shared out at
  random. With exactly 300 autographs and 300 boxes guaranteeing one, every
  box gets exactly one.
* **Collation timing.** Box contents are drawn when a box is opened, not
  stored per box at the factory. Sealed boxes of one product are
  interchangeable until opened, so this is the same lottery as collating up
  front, and it keeps saves small.
* **Rarity is not value.** Card value is driven mostly by player appeal
  (popularity, form, rookie status, position), then scarcity, finish, theme,
  autograph, company reputation and set sentiment. A superstar's base card
  can outsell a /99 of a player nobody follows.
* **Prices come from sales.** A card's market value is the median of recent
  completed sales. With 1–2 sales it shows a range; with none it shows no
  price at all.
* **Boxes react to what's left.** Box demand uses the expected value of the
  cards still sealed, so once the chase cards are pulled, unopened boxes are
  worth less.
* **Overproduction matters.** Each release raises collector fatigue (more if
  it carries many numbered parallels), which dampens box demand and the
  scarcity premium. It decays week by week.
* **Accounting.** Cash always equals starting capital plus the ledger. Box
  revenue equals boxes sold × price.
* **Determinism.** All randomness is seeded from the save's seed plus a
  counter stored in the save. The same seed and the same actions produce
  byte-identical state; a loaded save continues exactly as the original would.

## Saves

Four slots: an autosave (after every week and every manufacturing run) and
three manual slots, plus export/import as text. Every save carries a version
and checksum; a truncated or edited save is refused rather than half-loaded.
On claude.ai, saves go to the viewer's private `data/users/<id>/` store, split
into chunks with the index written last, and are mirrored to browser storage.
Elsewhere they live in browser storage only.

## Layout

```
src/sim/       the game, no DOM: types, rng, league, catalog, product
               (validation & odds), inventory (manufacture & collation),
               market (values, demand, secondary sales), game (actions,
               weekly advance), save (serialise, checksum, migrate)
src/ui/        React screens
test/          vitest suites for the simulation rules
tools/         build, browser check, economy probe
```

`tools/probe.ts` plays the starter release for 40 weeks and prints cash,
demand, box value and the most valuable cards, for tuning the economy:
`npx esbuild tools/probe.ts --bundle --platform=node --outfile=/tmp/probe.cjs && node /tmp/probe.cjs <seed>`.

## Stages

1. **Done.** One base set, numbered parallels, autographs, one box product
   per set, manufacturing, release, sales, openings, secondary market,
   weekly league with breakouts / slumps / injuries / retirements / rookie
   classes, news, finances, saves.
2. Multiple products per release (retail / hobby / premium), product-exclusive
   versions, split allocations of a print run across products in the UI. The
   engine already supports these; the tests cover a /10 split 5 + 5.
3. Explicit collector segments (team and player collectors, set builders,
   autograph collectors, rare hunters, speculators, breakers) replacing the
   aggregate buyer.
4. Inserts and memorabilia in the editor, design customisation, competitor
   companies, deeper reputation.
