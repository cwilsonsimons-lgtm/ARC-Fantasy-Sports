# Importing a roster

*A plan. No code yet.*

---

## Before anything else: what I actually know

**I do not remember other conversations.** Whatever files I made for you for
dynastytracker happened in a session I have no access to. Nothing in this repo
references it and there is no note of it in the commit history. If those files
are useful here, the fastest thing is to paste one in.

**I could not look at the site.** Both `dynastytracker.com` and
`dynastytracker.app` are blocked by this environment's network proxy. What a
search does establish is what it *is*:
[dynastytracker.app](https://www.dynastytracker.app/) is a free **EA Sports
College Football 25/26/27 dynasty-mode tracker** — no paywall, no sign-up. You
record games and seasons, build rosters, work a recruiting board and NIL, and
follow player careers, stats, awards and All-Americans. It handles roster
import, player ratings, dev traits and year progression. What the search does
not tell me is the exact mechanics of its paste flow.

### Why that identification sharpens the plan

A CFB dynasty tracker is solving almost exactly this problem, one genre over,
and the shape carries across cleanly:

| CFB dynasty roster | This game |
|---|---|
| Name | `name` |
| Position (QB, WR, …) | `role` — where they sit on the card |
| Dev trait (Normal / Impact / Star / Elite) | `archetype` — a categorical that drives everything downstream |
| OVR, a 0–99 rating | `inRing` and `charisma` |
| Class (FR / SO / JR / SR, redshirt) | no direct equivalent |
| 85 players a season, re-entered every year | 8–30 wrestlers, re-entered per promotion |

Two things follow from that which I would not have weighted as heavily
otherwise.

**Tolerance for mess has to be high.** People assembling a CFB roster are
transcribing off a game screen or maintaining a hand-built spreadsheet that has
been edited by several people across three seasons. Ragged whitespace,
inconsistent capitalisation, a stray blank row in the middle, a column somebody
renamed. The importer should shrug at all of it. This is why §5 says *never
reject the whole paste* — it is the single most important behaviour in the
feature.

**Re-import is the normal case, not the edge case.** A dynasty tracker gets a
fresh roster every season. That makes §6 — export in exactly the format the
importer reads — load-bearing rather than a nicety.

The interaction pattern I am building against, which I am confident about even
without seeing the site:

> You keep your data in a spreadsheet. You select a block of cells and copy.
> You paste it into a box. The tool works out what the columns are, shows you
> what it thinks before it commits, you fix anything it guessed wrong, and it
> fills everything in. Blank cells do not become blank records — they become
> whatever the tool would have made up anyway.

If dynastytracker does something meaningfully beyond that, the questions in §10
are the ones that would change the plan.

---

## 1. The one rule everything else follows

**A blank cell means "you decide".**

The roster generator already knows how to invent a wrestler: an archetype, two
abilities, eleven personality traits, a bio, a baseline mood, and a place in
the pecking order. Import does not replace that. It **overrides** it, one cell
at a time.

Which means the smallest useful paste is a single column of names:

```
Kestrel Vane
Bruno Fisk
Delphine Oyelaran
```

Three wrestlers, fully formed, with everything except their names decided by
the seed. Add a `Role` column and you have decided who main events. Add
`Archetype` and you have decided what kind of wrestler they are. Add all
sixteen columns and you have authored them completely.

Nobody should ever have to fill in a column they do not care about, and nothing
should arrive half-built because they didn't.

---

## 2. The columns

Sixteen fields, one required. Headers are matched loosely — case, spaces,
underscores and the listed aliases all resolve to the same field.

### Identity

| Field | Accepts | Aliases |
|---|---|---|
| **`name`** *(required)* | any text | wrestler, ring name, player |
| `gender` | Male / Female | sex, div, division |
| `alignment` | Face / Heel / Neutral | face/heel, babyface → Face, tweener → Neutral |
| `role` | Main event / Upper card / Midcard / Opener / Prospect | push, card position, tier, slot |
| `archetype` | any of the 17, by label or id | gimmick, type, character |
| `bio` | any text | notes, description, gimmick notes |
| `status` | Available / Injured / Unavailable | condition, health |

### Ability

| Field | Accepts | Aliases |
|---|---|---|
| `inRing` | 0–100, or Elite / Excellent / Good / Average / Poor / Terrible | in-ring, wrestling, workrate, ring |
| `charisma` | same | mic, promo, presence |

### Personality — all eleven

`ego` · `ambition` · `aggression` · `patience` · `professionalism` · `loyalty` ·
`jealousy` · `courage` · `authority` · `vindictiveness` · `selfishness`

Each accepts 0–100 **or that trait's own vocabulary** — the words the game
already uses on a wrestler's card. `Enormous` is a valid value for `ego`
because that is what the card says when ego is high. This matters: somebody
building a roster in a spreadsheet is going to type words, not calibrate
integers, and the game already owns the right words.

### Record and standing

| Field | Accepts | Notes |
|---|---|---|
| `wins`, `losses` | integers | seeds the record rather than starting everyone 0–0 |
| `champion` | a belt name or key | must be a belt the promotion is starting with |

### Relationships

This is the column set that makes a spreadsheet worth keeping, and the one a
generic importer would miss.

| Field | Accepts | Becomes |
|---|---|---|
| `partner` | another wrestler's name in the same paste | a seeded `tag-team` tie |
| `ally` | same | a seeded `allies` tie |
| `rival` | same | seeded `matches` history and a live thread |
| `mentor` | same | the `mentor` / `student` pair, which is not symmetric |

Names in these columns are resolved **within the import**, after every row has
been read, so order does not matter and a mutual `partner` pair only creates
one team. A name that does not resolve is a row-level warning, not a failure.

---

## 3. Reading the paste

### Delimiter

Sniffed from the first few lines, in this order: **tab**, then pipe, then
comma, then two-or-more spaces. Tab wins whenever it appears because that is
what Excel, Google Sheets and Numbers put on the clipboard, which makes
copy-paste from a spreadsheet the path of least resistance — which is the whole
point.

Comma parsing has to handle quoted fields properly, because bios have commas
in them. Tab parsing does not, which is another reason to prefer it.

### Header row

Row 1 is treated as a header when most of its cells resolve to known field
names. Otherwise every row is data and the columns are guessed positionally
(first column is `name`, and everything else needs mapping by hand).

Either way the mapping is **shown and editable** before anything is imported.
Guessing is a convenience, never a decision made behind the player's back.

### Values

- **Numbers** — plain integers 0–100.
- **Words** — the game's own bands, per field. Ability uses Elite → Terrible.
  Each trait uses its own three words.
- **Other scales** — if a numeric column's values all sit at or below 10, the
  mapping row offers a *"looks like 1–10, scale it?"* toggle rather than
  silently multiplying by ten. Guessing at scale is how you end up with a
  roster of terrible wrestlers and no idea why.
- **Blank, `-`, `n/a`, `?`** — all mean "you decide".

---

## 4. The screen

It lives in **The locker room** panel on the setup screen, as a second tab
beside the roster table. Four steps on one screen, no wizard:

**1 · Paste.** A big textarea, plus a drop zone that takes a `.tsv`, `.csv` or
`.txt` file. One line under it: *"Paste from a spreadsheet, or drop a file.
Anything you leave blank, the game decides."*

**2 · Map.** A single row of dropdowns, one per detected column, pre-filled
with the importer's guess and showing the first value as a sample. Columns it
cannot place default to *Ignore*. Any numeric column that looks scaled gets its
toggle here.

**3 · Preview.** The roster table you already have, filled in. Cells you
supplied render normally; cells the generator will fill render dim, so you can
see at a glance how much of each wrestler you actually authored. Rows with
problems carry a marker and a sentence.

**4 · Import.** One button, labelled with the count: *"Import 22 wrestlers"*.
It replaces the preview roster; the size slider becomes *"and generate N more
to fill it out"*, so importing twelve real wrestlers and topping up with eight
invented ones is one action rather than a compromise.

Nothing is committed to a save until *Take the job*, same as everything else on
that screen.

---

## 5. When it goes wrong

**Never reject the whole paste.** Every problem is row-level or cell-level, the
row still imports with the parts that were good, and the message says which
cell and what it will do instead:

| Problem | What happens |
|---|---|
| Unknown archetype | Nearest match offered; falls back to generated |
| Unparseable number | Cell ignored, generator fills it, warning on the row |
| `partner` names nobody | Tie skipped, warning on the row |
| Duplicate names | Second one flagged; you rename or drop it in the preview |
| A row with no name | Skipped, counted in a line at the bottom |
| `champion` names a belt you did not select | Offers to add the belt, or ignores the cell |
| Column mapped twice | Blocked in the mapping row before it can happen |

A footer states the outcome plainly: *"22 rows · 20 imported · 2 skipped · 5
warnings"*, with the warnings expandable.

---

## 6. Export, which is half the feature

Import without export is a one-way door. **Export the roster as TSV, emitting
exactly the columns the importer reads.** That gives you:

- A starting point — roll a promotion, export it, edit it in a spreadsheet,
  paste it back.
- Round-tripping — a save's roster twelve weeks in, exported, adjusted, and
  used as the basis for the next promotion.
- A format for sharing custom rosters that is not a wall of base64.

The exporter and the importer must share one column table, so they cannot drift
apart. If a field can be imported it can be exported, and vice versa.

---

## 7. What this does to setup codes

The share code from the last batch carries the **seed plus edits**, which is why
it is ~144 characters. An imported roster is not edits — it is a whole locker
room, and it will not fit.

The honest resolution is that **you already have a portable roster format: the
TSV you pasted.** So:

- A setup with an imported roster produces a code that says so, and carries
  everything else — level, budget, belts, promotion name.
- Loading that code prompts for the roster TSV, or offers to generate one.
- *"Copy setup code + roster"* puts both on the clipboard, the code first and
  the TSV under a separator, for pasting into one message.

That keeps the common case short and makes the custom case explicit rather than
producing a 20KB code that looks broken.

---

## 8. One tension worth naming

The game deliberately does not show you what a wrestler is. Ability arrives as
a *reading* that sharpens with familiarity; personality lags behind it; morale
is never a number. Learning who these people are is a mechanic.

Import hands you a spreadsheet where you typed `ego: 91` yourself.

I think that is fine and should not be fought: **you invented them, so of
course you know them.** A wrestler you authored starts with full familiarity;
a wrestler the generator invented starts a stranger, as now. That is a coherent
rule, it needs no extra interface, and it means a half-imported roster has a
genuinely interesting texture — the people you wrote and the people you were
given, and only one of those groups can surprise you.

Worth deciding deliberately rather than by accident, because the alternative
(imported wrestlers still have to be learned) is also defensible and is a
one-line difference.

---

## 9. What it touches

| File | Change |
|---|---|
| `js/data/roster-columns.js` | **new** — the one column table both directions read |
| `js/model/roster-io.js` | **new** — parse, map, validate, serialise. No DOM. |
| `js/model/generate.js` | accept per-wrestler overrides, and resolve import-time ties |
| `js/ui/setup.js` | the paste / map / preview tab |
| `js/data/setup.js` | a setup can carry an imported roster |
| `css/app.css` | the mapping row and preview states |

Everything parsing-related stays in `model/`, with no DOM anywhere in it, so
the harness can throw a hundred malformed pastes at it headlessly. That is
where the bugs in this kind of feature actually live.

---

## 10. What I'd need from you

Four things, in order of how much they'd change the plan:

1. **A real sample.** Three or four rows of what you would actually paste,
   with your real headers. This is worth more than everything else combined —
   it settles the aliases, the value formats and the column set at a stroke.
2. **Where the data comes from.** Your own spreadsheet, an export from
   somewhere, or a page you copy off? A copied web table brings ragged
   whitespace and merged cells; a clean export does not.
3. **Does dynastytracker do something I have not described?** The candidates
   that would change the shape: live validation as you type rather than a
   preview step; fuzzy matching against a known list of names; a saved mapping
   it remembers between imports; or importing a whole *season* at once rather
   than a roster.
4. **Mid-save import, or setup only?** Setup only is the smaller build. Adding
   wrestlers to a running promotion is the same parser, but it has to answer
   what a new arrival costs, what they know about anybody, and whether the
   locker room notices — which is really the Corporate branch's *Talent Budget*
   wearing a different hat.

---

## 11. Build order

Each step is usable on its own, so it can stop at any of them.

1. **The column table and the parser** — model only, no interface, tested
   headlessly against deliberately awful input.
2. **Names only.** Paste a column of names, get a roster. Genuinely useful and
   about a fifth of the work.
3. **The full column set**, with the mapping row.
4. **Preview and warnings.**
5. **Export**, sharing the column table.
6. **Relationship columns** — `partner`, `rival`, `mentor`. Last because it is
   the only part that needs a second pass over the data.
