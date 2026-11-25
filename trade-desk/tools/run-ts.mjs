// Runs a TypeScript file under node by bundling it first: node tools/run-ts.mjs file.ts [args]
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const [file, ...rest] = process.argv.slice(2);
const dir = await mkdtemp(path.join(os.tmpdir(), 'td-'));
const out = path.join(dir, 'run.mjs');
await build({ entryPoints: [file], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
process.argv = [process.argv[0], out, ...rest];
await import(pathToFileURL(out).href);
