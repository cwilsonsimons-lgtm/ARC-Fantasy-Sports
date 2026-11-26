# Record Book art: ChatGPT prompts

Paste a prompt into ChatGPT, save the image into this folder under the file name
given, then switch it on in `records/art.js`. Anything not listed there keeps the
Sleeper photo.

Every prompt starts with the same **style block**, so the whole page matches.
Generate the mascot first. Then, for each player, upload the mascot image along with
the prompt and say "match this style".

---

## Style block (paste at the top of every prompt)

> Bold cartoon illustration in a retro arcade / 90s sports-card style. Thick black
> outlines, cel shading, saturated colors, slight exaggeration. Dark navy night
> background with gold and lime-green accent lighting and subtle stadium glow.
> No text, no words, no letters, no numbers, no team logos, no watermarks.

---

## 1. Mascot: `art/mascot.png` (landscape, 16:10)

> [style block]
> The mascot of a fantasy football league called "City Boys Dynasty": a swaggering,
> muscular city pigeon wearing a gold football helmet with a lime-green stripe and a
> gold chain, spiking a football on a city rooftop at night. Neon-lit skyscrapers
> behind him, stadium lights in the distance. Confident, cocky grin. Landscape
> 16:10 composition with the pigeon centered and some breathing room at the edges.

Then in `art.js`: `mascot: 'art/mascot.png',`

---

## 2. Featured players (square, 1:1)

These are the players the page shows biggest right now: the hi-score holder and
the #1 at each position this season. Use this prompt for each one, filling in the
name and colors:

> [style block]
> Head-and-shoulders cartoon portrait of NFL **{PLAYER}**, {POSITION}, in a
> {COLORS} uniform with no logos, looking fierce and confident, slightly turned
> toward the camera. Square 1:1 crop, face in the upper middle of the frame,
> background a glowing {COLORS} gradient.

| File | Player | Position | Colors | Why |
|---|---|---|---|---|
| `art/players/7564.png` | Ja'Marr Chase | WR | black and orange | All-time hi-score, 61.90 |
| `art/players/6770.png` | Joe Burrow | QB | black and orange | Best QB, 2026 |
| `art/players/9221.png` | Jahmyr Gibbs | RB | Honolulu blue and silver | Best RB, 2026 |
| `art/players/9488.png` | Jaxon Smith-Njigba | WR | navy and action green | Best WR, 2026 |
| `art/players/8130.png` | Trey McBride | TE | cardinal red and white | Best TE, 2026 |

Then in `art.js`, inside `players`, add one line per image:
`'7564': 'art/players/7564.png',`

The number is the player's Sleeper id. For any other player, find it in Sleeper's
player URL or ask Claude.

---

## 3. Owner caricatures (optional, square, 1:1)

Upload a photo of the owner with:

> [style block]
> Turn this photo into a head-and-shoulders cartoon caricature in the style above,
> wearing a City Boys Dynasty jersey in navy, gold and lime green with no text.
> Keep the likeness. Square 1:1, face centered.

Save as `art/owners/<sleeper username>.png` and add it to `owners` in `art.js`, e.g.
`'Wilsonsimons12': 'art/owners/Wilsonsimons12.png',`.

Only do this with photos of people who are fine with it.
