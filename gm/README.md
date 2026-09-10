# Wrestling GM — prototype

The player is the kayfabe General Manager of a weekly wrestling television
show. This is the first skeleton: view the roster, book a card, run the show
segment by segment, finish. Nothing else is simulated yet.

## Running it

```
npm start                      # from the repo root
```

Then open <http://127.0.0.1:8080/gm/>. Plain ES modules, no build step and no
dependencies — the modules need an HTTP server only because browsers refuse to
load them over `file://`.

State is saved to `localStorage` under `wgm_v1`. "Reset prototype data" in the
footer clears it and reseeds the roster.

## Layout

```
js/model/   game state and rules — no DOM, no storage
js/ui/      the only code that touches the page
js/store.js the single source of truth and the only writer to localStorage
js/data/    seed data
```

`model/` never imports from `ui/`. That boundary is the point of the structure:
a future backstage-incident system changes the show by calling the same model
functions the buttons call, without going near the interface.

## Data shapes

| Object | Shape |
| --- | --- |
| Wrestler | `{ id, name, gender, alignment, status }` |
| ShowItem | `{ id, type, name, participants[], plannedMinutes }` |
| Show | `{ id, name, runtimeMinutes, items[] }` |
| Broadcast | `{ showId, status, results[] }` |

Four decisions here exist for systems that do not exist yet:

- **Everything is referenced by id**, never by name or list position, so future
  relationships, grudges, requests and incidents have something stable to point
  at.
- **Matches and segments share one record shape.** Code that walks the card
  never branches on type; a match's participants are `[wrestlerA, wrestlerB]`
  and a segment carries its own name.
- **Planned and actual are stored apart.** `plannedMinutes` lives on the card
  item; what actually aired lives in `broadcast.results` as
  `{ itemId, actualMinutes, status }`. A match running long later is a different
  number in `results`, not a change to either shape. `status` is always `aired`
  today and is where `cut` will go.
- **The current segment is derived**, not stored as a cursor — it is the first
  item with no result yet. Inserting or removing items mid-show later cannot
  desynchronise the position.

`completeCurrent(show, broadcast, actualMinutes)` already takes an actual
duration and defaults it to the planned one. That argument is the seam every
"ran long / ran short / got cut" system will use.
