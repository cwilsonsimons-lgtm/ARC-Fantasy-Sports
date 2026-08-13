#!/usr/bin/env node
// Regenerate js/universe/seed-data.js from data/universe-seed.json.
//
// The JSON is the canonical seed — the CLI reads it directly. The browser
// cannot: fetch() is dead over file://, and dist/universe.html has to work by
// double-clicking. So the same data is committed as a JS module the bundler can
// inline, and this script keeps the two in step.
//
// Usage: node tools/build-universe-seed.mjs   (after editing the JSON)
import { readFile, writeFile } from 'node:fs/promises';

const SRC = 'data/universe-seed.json';
const OUT = 'js/universe/seed-data.js';

const doc = JSON.parse(await readFile(SRC, 'utf8'));
delete doc._comment;

const body = `// Generated from ${SRC} by tools/build-universe-seed.mjs — do not edit by hand.
//
// The browser build has no filesystem and no network, so the starting universe
// ships as a module. Edit the JSON and re-run the generator.
export const UNIVERSE_SEED = ${JSON.stringify(doc, null, 2)};
`;

await writeFile(OUT, body);
console.log(`${OUT}  ${(body.length / 1024).toFixed(1)} KB  (${doc.wrestlers.length} wrestlers)`);
