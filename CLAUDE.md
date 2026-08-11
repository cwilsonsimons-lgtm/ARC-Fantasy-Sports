# City Boys Dynasty

## Read this first

**This repository is not the whole app.** The full app is the reference build at
`prototypes/1stPrototype.html`, and it contains roughly twenty subsystems that
have never existed in `js/` or `css/` here — the league hub and multi-league
model, the create-league wizard, league chat, the trade builder, waivers, the
scoring editor, notifications, commissioner tools, the transaction log, and
Arc Markets trading.

`docs/APP-SCOPE.md` maps the whole thing: what is in this repo, what is only in
the prototype, and where to find each subsystem in that file.

Before planning or estimating any feature, check `docs/APP-SCOPE.md` — the
feature may already be designed and working in the prototype, in which case the
job is to port it, not to invent it. Do not conclude a feature is missing from
the product because it is missing from `js/`.

## Layout

- `index.html` + `css/` + `js/` — the source. Plain ES modules, no framework, no
  runtime dependencies.
- `dist/index.html` — single-file build, `npm run build`. Rebuild after changing
  anything under `css/` or `js/`.
- `prototypes/` — reference builds. Not part of the app; do not import from them.
- `tools/` — dev server, verification harness, per-subsystem checks.

## Working on it

```
npm start                # serve at http://127.0.0.1:8080 (ES modules need a server)
npm run build            # regenerate dist/index.html
npm run check:markets    # subsystem checks; see tools/ for the others
```

Fonts are embedded as base64 in `css/fonts.css` so the app renders with no
network. Regenerate with `node tools/fetch-fonts.mjs`; do not hand-edit.
