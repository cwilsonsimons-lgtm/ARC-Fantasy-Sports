// Stitches the meeting voice-memo transcripts, the stories and the review
// rubric into one prompt you can paste into an AI in a single go.
//
//   node tools/story-review-prompt.mjs                 # -> review/prompt.md
//   node tools/story-review-prompt.mjs --stdout        # -> stdout, for piping
//   node tools/story-review-prompt.mjs --memos other/  # read memos elsewhere

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, extname, join, dirname, relative } from 'node:path';

const TEXT = new Set(['.txt', '.text', '.md', '.markdown', '.vtt', '.srt']);
const AUDIO = new Set(['.m4a', '.mp3', '.wav', '.aac', '.aiff', '.caf', '.flac', '.ogg', '.mp4', '.mov']);

const DEFAULTS = {
  memos: 'review/memos',
  stories: 'review/stories',
  rubric: 'review/rubric.md',
  out: 'review/prompt.md',
  stdout: false,
};

function parseArgs(argv) {
  const opts = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--stdout') { opts.stdout = true; continue; }
    if (arg === '--help' || arg === '-h') { opts.help = true; continue; }
    const key = arg.replace(/^--/, '');
    if (arg.startsWith('--') && key in DEFAULTS && typeof DEFAULTS[key] === 'string') {
      const value = argv[++i];
      if (!value) die(`--${key} needs a path after it.`);
      opts[key] = value;
      continue;
    }
    die(`Don't know the option "${arg}". Run with --help.`);
  }
  return opts;
}

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const HELP = `
  Build one story-review prompt out of your meeting memos and your stories.

    node tools/story-review-prompt.mjs [options]

    --memos <dir>     transcripts of the meeting voice memos  (${DEFAULTS.memos})
    --stories <dir>   one story per file                      (${DEFAULTS.stories})
    --rubric <file>   the dos and don'ts                      (${DEFAULTS.rubric})
    --out <file>      where to write the prompt               (${DEFAULTS.out})
    --stdout          print the prompt instead of writing it
`;

const LEADING_CLOCK = /^\[?\(?-?\d{1,2}:\d{2}(:\d{2})?([.,]\d+)?\)?\]?\s*/;

// Otter, Zoom and YouTube exports come out as subtitle files: cue numbers and
// timecodes interleaved with the words. Strip them back to prose so the memo
// reads as speech and doesn't burn a third of the prompt on timestamps.
function stripCues(text) {
  const kept = [];
  for (let line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^WEBVTT/.test(trimmed)) continue;
    if (/^(NOTE|STYLE|REGION)\b/.test(trimmed)) continue;
    if (/^\d+$/.test(trimmed)) continue;                                  // SRT cue number
    if (/^-?\d{1,2}:\d{2}(:\d{2})?[.,]?\d*\s*-->/.test(trimmed)) continue; // timecode span
    if (LEADING_CLOCK.test(trimmed) && !trimmed.replace(LEADING_CLOCK, '').trim()) continue;
    // "00:14 Chris: ..." — keep the speaker, drop the clock.
    line = trimmed.replace(LEADING_CLOCK, '');
    // Rolling captions repeat the previous caption verbatim; keep one copy.
    if (line === kept[kept.length - 1]) continue;
    kept.push(line);
  }
  return kept.join('\n');
}

// Only treat a file as a transcript export when the clock is the rule rather
// than the exception — otherwise "10:30 kickoff on Sunday" loses its time.
function isCueFile(text, ext) {
  if (ext === '.vtt' || ext === '.srt') return true;
  if (/^-?\d{1,2}:\d{2}(:\d{2})?[.,]?\d*\s*-->/m.test(text)) return true;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const clocked = lines.filter((l) => LEADING_CLOCK.test(l)).length;
  return clocked >= 3 && clocked / lines.length >= 0.5;
}

function clean(raw, ext) {
  let text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (isCueFile(text, ext)) text = stripCues(text);
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

// 2026-08-24-trade-block.md -> { date: '2026-08-24', title: 'trade block' }
function describe(file) {
  const stem = basename(file, extname(file));
  const dated = stem.match(/^(\d{4}-\d{2}-\d{2})[-_ ]*(.*)$/);
  const date = dated ? dated[1] : '';
  const rest = dated ? dated[2] : stem;
  const title = rest.replace(/[-_]+/g, ' ').trim();
  return { id: stem, date, title: title || stem };
}

function collect(dir, label) {
  if (!existsSync(dir)) die(`There's no ${dir} folder. Make it and put your ${label} in it.`);
  const names = readdirSync(dir).sort();
  const docs = [];
  const audio = [];
  const ignored = [];
  for (const name of names) {
    if (name.startsWith('.') || name.toLowerCase() === 'readme.md') continue;
    const ext = extname(name).toLowerCase();
    if (AUDIO.has(ext)) { audio.push(name); continue; }
    if (!TEXT.has(ext)) { ignored.push(name); continue; }
    const body = clean(readFileSync(join(dir, name), 'utf8'), ext);
    if (!body) { ignored.push(`${name} (empty)`); continue; }
    docs.push({ ...describe(name), file: name, body });
  }
  return { docs, audio, ignored };
}

function attr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function buildPrompt({ rubric, stories, memos }) {
  const parts = [];

  parts.push(`# Story review

Below are three things:

1. **How to review** — the rules. They are instructions, not suggestions.
2. **The stories** — what I have written down so far. Each one is wrapped in a
   \`<story>\` tag with its id.
3. **The meeting record** — transcripts of the voice memos I recorded in the
   meetings where this work was discussed, oldest first. Each is wrapped in a
   \`<memo>\` tag with its date. This is speech, so it rambles, and the
   transcription is imperfect — read it for intent, and don't treat a garbled
   word as a decision.

Read all three before you write anything.`);

  parts.push('---\n\n' + rubric);

  parts.push('---\n\n## The stories');
  for (const story of stories) {
    parts.push(`<story id="${attr(story.id)}" source="${attr(story.file)}">\n${story.body}\n</story>`);
  }

  parts.push('---\n\n## The meeting record');
  if (memos.length === 0) {
    parts.push(
      'No meeting record was supplied with this review. Judge the stories on\n' +
      'their own terms, and where a check depends on knowing what was asked for,\n' +
      'say plainly that you cannot tell rather than guessing. Section C of the\n' +
      'output format is "nothing" for this run.'
    );
  } else {
    for (const memo of memos) {
      const date = memo.date ? ` date="${attr(memo.date)}"` : '';
      parts.push(
        `<memo${date} title="${attr(memo.title)}" source="${attr(memo.file)}">\n${memo.body}\n</memo>`
      );
    }
  }

  parts.push(
    '---\n\n' +
    'Now do the review. Follow the output format above exactly: the verdict\n' +
    'table first, then the per-story findings, then what was decided in a\n' +
    'meeting but written into no story, then the open questions. Nothing else.'
  );

  return parts.join('\n\n') + '\n';
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return; }

  if (!existsSync(opts.rubric)) die(`Can't find the rubric at ${opts.rubric}.`);
  const rubric = clean(readFileSync(opts.rubric, 'utf8'), '.md');

  const stories = collect(opts.stories, 'stories');
  const memos = collect(opts.memos, 'memo transcripts');

  if (stories.docs.length === 0) {
    die(`No stories in ${opts.stories}/. Put one story per .md file in there, then run this again.`);
  }

  const prompt = buildPrompt({ rubric, stories: stories.docs, memos: memos.docs });

  if (opts.stdout) {
    process.stdout.write(prompt);
    return;
  }

  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, prompt);

  const words = prompt.split(/\s+/).length;
  const tokens = Math.round(prompt.length / 4 / 100) * 100;
  const shown = relative(process.cwd(), opts.out);
  console.log(`
  Wrote ${shown.startsWith('..') ? opts.out : shown}
    ${stories.docs.length} ${stories.docs.length === 1 ? 'story' : 'stories'}, ${memos.docs.length} ${memos.docs.length === 1 ? 'memo' : 'memos'}
    ~${words.toLocaleString()} words, roughly ${tokens.toLocaleString()} tokens

  Paste the whole file into the AI as one message.`);

  if (memos.docs.length === 0) {
    console.log(`
  No memos found in ${opts.memos}/, so the prompt asks for a review of the
  stories on their own. Drop your transcripts in there for the full thing.`);
  }

  for (const [dir, found] of [[opts.memos, memos], [opts.stories, stories]]) {
    if (found.audio.length) {
      console.log(`
  Skipped ${found.audio.length} recording${found.audio.length === 1 ? '' : 's'} in ${dir}/ — this reads transcripts, not audio:
    ${found.audio.join('\n    ')}
  Open the memo, copy its transcript, and save that as a .txt or .md file.`);
    }
    if (found.ignored.length) {
      console.log(`\n  Ignored in ${dir}/: ${found.ignored.join(', ')}`);
    }
  }
  console.log('');
}

main();
