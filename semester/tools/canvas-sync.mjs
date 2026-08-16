#!/usr/bin/env node
/**
 * canvas-sync — pull a Canvas course load into a Semester Ledger backup file.
 *
 * Canvas will not talk to a web page directly (its API sends no CORS headers,
 * so a browser refuses the response), which is why this runs on your machine
 * instead. It writes a .json file that the Ledger's "Import backup" button
 * reads. Your token never leaves this computer.
 *
 *   node semester/tools/canvas-sync.mjs \
 *     --host school.instructure.com \
 *     --token 1234~abcdef... \
 *     --in  ~/Downloads/semester-ledger-2026-08-16.json \
 *     --out ~/Downloads/semester-canvas.json
 *
 * --token may be left off if CANVAS_TOKEN is set in the environment.
 * --in is optional: pass an existing backup and this keeps everything Canvas
 * does not know about (meeting times, colours, hour estimates, notes, targets).
 *
 * Get a token: Canvas → Account → Settings → "+ New Access Token".
 */

import fs from 'node:fs';
import path from 'node:path';

/* ---------------- args ---------------- */
const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = name => argv.includes('--' + name);

if (flag('help') || !argv.length) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*| \* ?/gm, ''));
  process.exit(0);
}

const host = String(arg('host') || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const token = arg('token') || process.env.CANVAS_TOKEN;
const inFile = arg('in');
const outFile = arg('out', 'semester-canvas.json');
const termFilter = arg('term');
const dryRun = flag('dry-run');
const insecure = flag('insecure'); // allow plain http, for a local test server

if (!host) fail('Missing --host (e.g. --host school.instructure.com)');
if (!token) fail('Missing --token (or set CANVAS_TOKEN in the environment)');

const base = `${insecure ? 'http' : 'https'}://${host}`;

function fail(msg) { console.error('\n  ' + msg + '\n'); process.exit(1); }

/* ---------------- Canvas API ---------------- */
async function api(pathAndQuery) {
  let url = pathAndQuery.startsWith('http') ? pathAndQuery : base + pathAndQuery;
  const out = [];
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (res.status === 401) fail('Canvas rejected the token (401). Generate a fresh one in Account → Settings.');
    if (res.status === 403) fail('Canvas refused the request (403) — the token may lack scopes, or the host is wrong.');
    if (!res.ok) fail(`Canvas returned ${res.status} for ${url.replace(base, '')}`);
    const body = await res.json();
    Array.isArray(body) ? out.push(...body) : out.push(body);
    url = nextLink(res.headers.get('link'));
  }
  return out;
}
function nextLink(header) {
  if (!header) return null;
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

/* ---------------- helpers ---------------- */
const uid = () => Math.random().toString(36).slice(2, 9);
const pad = n => String(n).padStart(2, '0');

/** Canvas sends UTC ISO; the Ledger stores wall-clock local time. */
function toLocalStamp(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

/** Canvas has no idea how long anything takes, so make a first guess by name. */
function guessHours(name, points) {
  const n = String(name).toLowerCase();
  if (/\bfinal\b|\bexam\b|midterm/.test(n)) return 5;
  if (/project|paper|essay|thesis|presentation/.test(n)) return 5;
  if (/\blab\b|report/.test(n)) return 3;
  if (/quiz|reading|discussion|response/.test(n)) return 1;
  if (Number(points) >= 100) return 4;
  return 2;
}

/* ---------------- pull ---------------- */
console.log(`\n  Canvas → Semester Ledger\n  host: ${base}\n`);

const courses = (await api('/api/v1/courses?enrollment_state=active&enrollment_type=student&include[]=term&per_page=100'))
  .filter(c => c && c.id && !c.access_restricted_by_date)
  .filter(c => !termFilter || (c.term && String(c.term.name || '').toLowerCase().includes(termFilter.toLowerCase())));

if (!courses.length) fail('No active student enrolments came back. Check --host, or drop --term.');

/* ---------------- merge target ---------------- */
let prior = { courses: [], tasks: [], settings: null };
if (inFile) {
  try {
    prior = JSON.parse(fs.readFileSync(inFile, 'utf8'));
    if (!prior.courses || !prior.tasks) throw new Error('not a Semester Ledger backup');
  } catch (e) { fail(`Could not read --in file: ${e.message}`); }
}
const priorCourse = cid => prior.courses.find(c => String(c.canvasId) === String(cid));
const priorTask = aid => prior.tasks.find(t => String(t.canvasId) === String(aid));

const ledgerCourses = [];
const ledgerTasks = [];
const report = [];
let skippedNoDue = 0;

for (const [i, course] of courses.entries()) {
  const groups = await api(
    `/api/v1/courses/${course.id}/assignment_groups?include[]=assignments&include[]=submission&per_page=100`);

  const old = priorCourse(course.id);

  // Weighted groups are the normal case. When a course grades on raw points
  // every group_weight is 0, so derive the weights from points possible —
  // same arithmetic, and it keeps the Grades tab meaningful.
  const totalWeight = groups.reduce((a, g) => a + (Number(g.group_weight) || 0), 0);
  const pointsOf = g => (g.assignments || []).reduce((a, x) => a + (Number(x.points_possible) || 0), 0);
  const totalPoints = groups.reduce((a, g) => a + pointsOf(g), 0);
  const weighted = totalWeight > 0;

  const categories = groups.map(g => {
    const oldCat = old && (old.categories || []).find(k => String(k.canvasId) === String(g.id));
    const weight = weighted
      ? Number(g.group_weight) || 0
      : (totalPoints > 0 ? Math.round(pointsOf(g) / totalPoints * 100) : 0);
    return { id: oldCat ? oldCat.id : uid(), canvasId: g.id, name: g.name, weight };
  });

  const ledgerCourse = {
    id: old ? old.id : uid(),
    canvasId: course.id,
    name: course.name || `Course ${course.id}`,
    code: course.course_code || '',
    instructor: old ? old.instructor || '' : '',
    credits: old ? old.credits : 3,
    colorIndex: old ? old.colorIndex : (ledgerCourses.length + i) % 8,
    meetings: old ? old.meetings || [] : [],   // Canvas does not carry class times
    categories,
    target: old ? old.target : undefined
  };
  if (ledgerCourse.target === undefined) delete ledgerCourse.target;
  ledgerCourses.push(ledgerCourse);

  let added = 0, updated = 0;
  for (const g of groups) {
    const cat = categories.find(k => String(k.canvasId) === String(g.id));
    for (const a of g.assignments || []) {
      const due = toLocalStamp(a.due_at);
      if (!due) { skippedNoDue++; continue; }             // undated work has nowhere to go
      const sub = a.submission || null;
      const before = priorTask(a.id);
      const graded = sub && sub.score != null && sub.workflow_state === 'graded';
      const handedIn = sub && (sub.submitted_at || graded);

      ledgerTasks.push({
        id: before ? before.id : uid(),
        canvasId: a.id,
        courseId: ledgerCourse.id,
        catId: cat ? cat.id : '',
        title: a.name || 'Untitled',
        due,
        est: before && before.est != null ? before.est : guessHours(a.name, a.points_possible),
        score: graded ? Number(sub.score) : (before ? before.score : null),
        outOf: graded ? (Number(a.points_possible) || null) : (before ? before.outOf : null),
        status: handedIn ? 'done' : (before ? before.status : 'todo'),
        notes: before ? before.notes || '' : '',
        url: a.html_url || ''
      });
      before ? updated++ : added++;
    }
  }
  report.push({ code: ledgerCourse.code, name: ledgerCourse.name, cats: categories.length, weighted, added, updated });
}

/* Anything the student typed by hand — a course or task with no canvasId — survives. */
const handMade = prior.courses.filter(c => !c.canvasId);
const handMadeTasks = prior.tasks.filter(t => !t.canvasId && (handMade.some(c => c.id === t.courseId) ||
                                                             ledgerCourses.some(c => c.id === t.courseId)));

const now = new Date();
const out = {
  courses: [...ledgerCourses, ...handMade],
  tasks: [...ledgerTasks, ...handMadeTasks],
  settings: prior.settings || {
    termStart: ymd(now), termEnd: ymd(new Date(now.getFullYear(), now.getMonth() + 4, now.getDate())),
    dailyCap: 4, dayStart: '08:00', dayEnd: '22:00', target: 90
  }
};

/* ---------------- report ---------------- */
const w = Math.max(...report.map(r => (r.code || r.name).length), 6);
console.log(`  ${'COURSE'.padEnd(w)}  GROUPS  NEW  UPDATED`);
for (const r of report) {
  console.log(`  ${(r.code || r.name).padEnd(w)}  ${String(r.cats).padStart(6)}  ${String(r.added).padStart(3)}  ${String(r.updated).padStart(7)}` +
    (r.weighted ? '' : '   (points-based — weights derived)'));
}
console.log(`\n  ${ledgerCourses.length} courses, ${ledgerTasks.length} assignments with due dates` +
  (skippedNoDue ? `, ${skippedNoDue} skipped for having no due date` : '') +
  (handMade.length ? `, ${handMade.length} hand-made course(s) kept` : ''));

if (dryRun) { console.log('\n  --dry-run: nothing written.\n'); process.exit(0); }

fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(`\n  Wrote ${outFile}`);
console.log(`  Open the Ledger → Courses → Import backup → pick that file.`);
console.log(`  Then add your class meeting times; Canvas does not publish them.\n`);
