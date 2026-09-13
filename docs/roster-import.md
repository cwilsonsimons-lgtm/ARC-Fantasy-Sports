# Importing a roster

*A plan. No code yet.*

---

## How dynastytracker actually does it

I had this wrong, and the correction changes the shape of the feature.

I assumed the app parsed a spreadsheet paste. It does accept a TSV paste — but
**that is the last step, not the feature.** The feature is that the app
*generates a prompt*. The pipeline is:

```
game screen  ->  screenshot  ->  AI, given the app's own generated prompt
             ->  TSV in a fenced block  ->  pasted into the app's import box
```

The user never opens a spreadsheet. They screenshot the in-game roster screen,
paste the app's prompt plus the screenshots into an AI, and paste the TSV that
comes back. The app's contribution is the prompt: a precise, self-describing
specification of its own import format.

### What that prompt contains

Worth reading closely, because it is a good piece of design and most of it is
directly stealable:

- **A column table** — 15 columns, in order, each with its type and its exact
  allowed values. Dropdown columns list every literal, with the near-misses
  called out by name: *do NOT output "LE", "RE", "EDGE", "LB", "OLB", "MLB",
  "OT", "OG" or "S"*. It anticipates the specific wrong answers a model gives.
- **Format rules** — no thousands separators, no units, no "N/A", integers with
  no decimal point, ASCII only, one line per row.
- **"Accuracy over completeness."** A blank is easy to fill in; a wrong value is
  hard to catch. Never guess.
- **A tiebreaker roster** — the app sends the roster it already has, so an
  abbreviated "A. Guess" on screen resolves to a full name. Explicitly *not* a
  whitelist: a full name visible on screen is copied verbatim even if it is not
  in the list, because real rosters lag the tracker.
- **Scope discipline** — only the attachments in this request. Never carry a row
  over from a previous week or from memory. It names stale rows bleeding in from
  a prior week as "the most common corruption".
- **A self-check list** — delimiter count per row, row count, a column-to-value
  walk, nothing but data inside the fence, a number-format scan.
- **Output shape** — one fenced block, nothing else inside it, commentary
  outside it.

### What this means for us

**The plan below was half a feature.** Parsing a paste is necessary and it is
the easy half. The half that makes it feel effortless is the app *emitting the
spec* so that any source — a screenshot of another game, a fed's roster page, a
list in a document, handwritten notes — can be turned into a valid paste by an
AI that has been told exactly what valid means.

So this document gains **section 10, emitting an import prompt**, and three of its
existing decisions get firmer:

1. **The column table has to be machine-readable and single-source.** It already
   had to serve the importer and the exporter (§6). Now it serves a third
   consumer — the prompt generator — and all three must read the same table or
   they will drift. This is the most important structural constraint in the
   feature.
2. **Dropdown columns must publish their exact literals**, with the likely
   near-misses named. Our equivalents: `Main event` not `main-event` or `Main
   Event`; the 17 archetype labels verbatim; `Face` / `Heel` / `Neutral` not
   `babyface`.
3. **The importer must be forgiving anyway.** A generated paste will still
   arrive with smart quotes, an em dash where a blank belonged, or a stray
   header row. §5's "never reject the whole paste" holds, and matters more.

The interaction pattern I originally described is still worth building — pasting
straight from a spreadsheet should work. It is just no longer the whole story.

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
| `js/data/roster-columns.js` | **new** — the one column table all three consumers read |
| `js/model/roster-io.js` | **new** — parse, map, validate, serialise. No DOM. |
| `js/model/import-prompt.js` | **new** — renders the column table as the spec an AI is handed |
| `js/model/generate.js` | accept per-wrestler overrides, and resolve import-time ties |
| `js/ui/setup.js` | the paste / map / preview tab |
| `js/data/setup.js` | a setup can carry an imported roster |
| `css/app.css` | the mapping row and preview states |

Everything parsing-related stays in `model/`, with no DOM anywhere in it, so
the harness can throw a hundred malformed pastes at it headlessly. That is
where the bugs in this kind of feature actually live.

---

## 10. Emitting an import prompt

The half I had missed. A **Copy import prompt** button beside the paste box,
which puts on the clipboard a spec of exactly what this game accepts — generated
from the same column table the importer and exporter read, so it can never
describe a format the importer does not honour.

### What ours would say

Structurally the same as dynastytracker's, with our content:

- **The 16 columns**, in order, with types. One required: `name`.
- **Every dropdown's literals, verbatim**, with near-misses named:
  - `role` — `Main event` | `Upper card` | `Midcard` | `Opener` | `Prospect`.
    Not `main event`, not `Main Event`, not `ME`.
  - `alignment` — `Face` | `Heel` | `Neutral`. Not `babyface`, not `tweener`.
  - `gender` — `Male` | `Female`.
  - `status` — `Available` | `Injured` | `Unavailable`.
  - `archetype` — all 17 labels verbatim, and a note that the label is what is
    wanted, not the id.
- **The value rules** — ability and the eleven traits take 0-99 or the game's
  own word for that trait; integers carry no decimal point; ASCII only.
- **The blank rule**, stated as strongly as theirs: a blank cell means the game
  decides, so leaving one is always safe and guessing never is. This is the one
  place our rule is *better* than theirs and should be said out loud — in their
  app a blank is a hole the user has to fill later; in ours a blank is a
  finished wrestler the generator completed.
- **The current roster as a tiebreaker**, when a save is open and the paste is
  meant to edit it rather than replace it — same purpose as theirs, resolving a
  shortened or misspelled name to somebody who already exists. Not a whitelist:
  a clear new name is a new wrestler.
- **Scope discipline and a self-check list**, lifted almost intact. Theirs are
  well-tuned and there is no reason to reinvent them.
- **Output shape** — one fenced block, data only, commentary outside it.

### Why this is worth building

It means the importer's source stops mattering. A screenshot of another
wrestling game's roster, a fed's website, a list in a document, a photo of
handwriting on paper — anything an AI can read becomes a valid paste, because
the AI has been handed the exact grammar. We would never have to write a parser
for any of those formats.

It is also cheap. The prompt generator is a function over the column table we
already have to build, and the table already has to carry each column's type,
literals and aliases for the importer to work at all. Emitting it as prose is
the smallest of the three consumers.

### One thing to get right

The generated prompt must state the **game's version of the format**, not a
frozen copy of it. If an archetype is added later, the prompt says so the day
it ships. That is the whole argument for generating it rather than writing it
once into a help page.

---

## 11. Still open

The prompt answered most of what I asked. What is left:

1. **Screenshots, or a spreadsheet, or both?** For CFB the source is always a
   game screen, so the AI path is the only path. For a wrestling promotion you
   are inventing, a spreadsheet is likelier — and the two want slightly
   different defaults. If you would mostly be pasting from a sheet, the mapping
   row matters most; if you would mostly be handing screenshots to an AI, the
   prompt generator matters most. It is worth knowing which to build first.
2. **Mid-save import, or setup only?** Setup only is the smaller build. Adding
   wrestlers to a running promotion uses the same parser but has to answer what
   a new arrival costs against the wage bill, what the locker room knows about
   them, and whether anybody notices they have arrived.
3. **Does the app's import box do anything the prompt does not describe?** A
   preview before committing, a diff against the existing roster, partial
   updates by name. If it does, that is worth copying too.

---

## 12. Build order

Each step is usable on its own, so it can stop at any of them.

1. **The column table and the parser** — model only, no interface, tested
   headlessly against deliberately awful input. Everything else reads this.
2. **Names only.** Paste a column of names, get a roster. Genuinely useful and
   about a fifth of the work.
3. **The full column set**, with the mapping row.
4. **The prompt generator.** Cheap once step 1 exists, and it is what makes the
   source of the data stop mattering. Could move ahead of step 3 if screenshots
   are the likelier input — see section 11.
5. **Preview and warnings.**
6. **Export**, sharing the column table.
7. **Relationship columns** — `partner`, `rival`, `mentor`. Last because it is
   the only part that needs a second pass over the data.
