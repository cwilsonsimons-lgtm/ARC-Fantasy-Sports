// App state and the pure operations on it. A prospect's used/available status is
// never stored: it is derived from the active workspace's assignments, so the
// two can't drift apart. Every operation returns a new state.
import { defaultPositionSettings, positionsOf, type PositionSettings } from './positions';

export interface Prospect {
  id: string;
  name: string;
  position: string; // canonical code
  heightIn: number;
  weight: number;
  college?: string;
  notes?: string;
  sample?: boolean; // part of the bundled sample pool
}

export interface GeneratedPlayer {
  position: string;
  heightIn: number;
  weight: number;
}

export interface Assignment {
  id: string;
  prospectId: string;
  // Copied at confirm time so history still reads correctly if the prospect is edited later.
  prospectName: string;
  prospectPosition: string;
  prospectCollege?: string;
  generated: GeneratedPlayer;
  originalName?: string;
  team?: string;
  notes?: string;
  date: string; // ISO timestamp
  // This prospect's name was already in use and was picked again because the
  // generated player matched them exactly (same position, height and weight).
  reused?: true;
}

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
  prospects: Prospect[];
  assignments: Assignment[];
}

export interface Settings extends PositionSettings {
  heightTol: number;
  weightTol: number;
  resultLimit: number;
  /** Suggest already-used prospects again when they match exactly. Missing (older saves) means on. */
  reuseExact?: boolean;
}

export const reuseExactOn = (s: Settings) => s.reuseExact !== false;

/** Same position, height and weight: the only case where a used name may be picked again. */
export function isExactFor(p: Prospect, g: GeneratedPlayer): boolean {
  return positionsOf(p.position).includes(g.position) && p.heightIn === g.heightIn && p.weight === g.weight;
}

export interface AppState {
  version: 1;
  activeWorkspaceId: string;
  workspaces: Workspace[];
  settings: Settings;
}

let counter = 0;
export function uid(prefix: string): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${counter.toString(36)}`;
}

export function defaultSettings(): Settings {
  return { ...defaultPositionSettings(), heightTol: 1, weightTol: 5, resultLimit: 5, reuseExact: true };
}

export function newWorkspace(name: string, prospects: Prospect[] = []): Workspace {
  return { id: uid('ws'), name, createdAt: new Date().toISOString(), prospects, assignments: [] };
}

export function initialState(prospects: Prospect[] = []): AppState {
  const ws = newWorkspace('My Draft Class', prospects);
  return { version: 1, activeWorkspaceId: ws.id, workspaces: [ws], settings: defaultSettings() };
}

export function activeWorkspace(s: AppState): Workspace {
  return s.workspaces.find((w) => w.id === s.activeWorkspaceId) ?? s.workspaces[0];
}

/** prospectId -> assignment, for the given workspace. */
export function usedMap(ws: Workspace): Map<string, Assignment> {
  return new Map(ws.assignments.map((a) => [a.prospectId, a]));
}

export function counts(ws: Workspace) {
  const used = usedMap(ws);
  const usedCount = ws.prospects.filter((p) => used.has(p.id)).length;
  return { total: ws.prospects.length, used: usedCount, available: ws.prospects.length - usedCount };
}

function mapActive(s: AppState, fn: (w: Workspace) => Workspace): AppState {
  return { ...s, workspaces: s.workspaces.map((w) => (w.id === s.activeWorkspaceId ? fn(w) : w)) };
}

// ---- prospects ----

export type ProspectInput = Omit<Prospect, 'id'>;

export function addProspects(s: AppState, inputs: ProspectInput[]): AppState {
  const added = inputs.map((p) => ({ ...p, id: uid('p') }));
  return mapActive(s, (w) => ({ ...w, prospects: [...w.prospects, ...added] }));
}

export function updateProspect(s: AppState, id: string, patch: Partial<ProspectInput>): AppState {
  return mapActive(s, (w) => ({ ...w, prospects: w.prospects.map((p) => (p.id === id ? { ...p, ...patch, sample: patch.sample ?? p.sample } : p)) }));
}

export class AssignmentError extends Error {}

export function deleteProspect(s: AppState, id: string): AppState {
  const ws = activeWorkspace(s);
  if (usedMap(ws).has(id)) throw new AssignmentError('This prospect is assigned. Undo the assignment before deleting them.');
  return mapActive(s, (w) => ({ ...w, prospects: w.prospects.filter((p) => p.id !== id) }));
}

/** Removes sample prospects that aren't assigned; returns how many were kept because they are in use. */
export function removeSamples(s: AppState): { state: AppState; kept: number } {
  const ws = activeWorkspace(s);
  const used = usedMap(ws);
  const kept = ws.prospects.filter((p) => p.sample && used.has(p.id)).length;
  return { state: mapActive(s, (w) => ({ ...w, prospects: w.prospects.filter((p) => !p.sample || used.has(p.id)) })), kept };
}

// ---- assignments ----

export interface AssignInput {
  prospectId: string;
  generated: GeneratedPlayer;
  originalName?: string;
  team?: string;
  notes?: string;
  date?: string;
  /** Allow picking a prospect who is already used, as long as they match exactly. */
  allowReuse?: boolean;
}

export function assign(s: AppState, input: AssignInput): { state: AppState; assignment: Assignment } {
  const ws = activeWorkspace(s);
  const p = ws.prospects.find((x) => x.id === input.prospectId);
  if (!p) throw new AssignmentError('That prospect is no longer in this workspace.');
  const existing = usedMap(ws).get(p.id);
  if (existing && !(input.allowReuse && isExactFor(p, input.generated))) {
    throw new AssignmentError(`${p.name} is already assigned in this workspace. Undo that assignment first.`);
  }
  const assignment: Assignment = {
    id: uid('a'),
    prospectId: p.id,
    prospectName: p.name,
    prospectPosition: p.position,
    ...(p.college ? { prospectCollege: p.college } : {}),
    generated: { ...input.generated },
    ...(clean(input.originalName) ? { originalName: clean(input.originalName) } : {}),
    ...(clean(input.team) ? { team: clean(input.team) } : {}),
    ...(clean(input.notes) ? { notes: clean(input.notes) } : {}),
    date: input.date ?? new Date().toISOString(),
    ...(existing ? { reused: true as const } : {}),
  };
  return { state: mapActive(s, (w) => ({ ...w, assignments: [...w.assignments, assignment] })), assignment };
}

const clean = (v?: string) => (v ?? '').trim();

export function updateAssignment(s: AppState, id: string, patch: Partial<Pick<Assignment, 'generated' | 'originalName' | 'team' | 'notes'>>): AppState {
  return mapActive(s, (w) => ({
    ...w,
    assignments: w.assignments.map((a) => {
      if (a.id !== id) return a;
      const next: Assignment = { ...a, ...patch };
      for (const k of ['originalName', 'team', 'notes'] as const) {
        if (k in patch) {
          const v = clean(patch[k]);
          if (v) next[k] = v;
          else delete next[k];
        }
      }
      return next;
    }),
  }));
}

/** Undo and delete both remove the record, which makes the prospect available again. */
export function removeAssignment(s: AppState, id: string): { state: AppState; removed?: Assignment } {
  const removed = activeWorkspace(s).assignments.find((a) => a.id === id);
  return { state: mapActive(s, (w) => ({ ...w, assignments: w.assignments.filter((a) => a.id !== id) })), removed };
}

/** Puts back an assignment that was just undone (for the undo toast). Fails if the prospect was reassigned meanwhile. */
export function restoreAssignment(s: AppState, a: Assignment): AppState {
  const ws = activeWorkspace(s);
  const p = ws.prospects.find((x) => x.id === a.prospectId);
  if (!p) throw new AssignmentError('That prospect has been deleted.');
  const others = ws.assignments.filter((x) => x.prospectId === a.prospectId);
  if (others.length === 0) return mapActive(s, (w) => ({ ...w, assignments: [...w.assignments, a] }));
  // Assigned again since: putting this one back is a reuse, allowed only for an exact match.
  if (!isExactFor(p, a.generated)) throw new AssignmentError(`${a.prospectName} has been assigned again since.`);
  const { reused: _drop, ...rest } = a;
  const back: Assignment = others.some((x) => !x.reused) ? { ...rest, reused: true } : rest;
  return mapActive(s, (w) => ({ ...w, assignments: [...w.assignments, back] }));
}

export function clearAssignments(s: AppState): AppState {
  return mapActive(s, (w) => ({ ...w, assignments: [] }));
}

export function clearProspects(s: AppState): AppState {
  return mapActive(s, (w) => ({ ...w, prospects: [], assignments: [] }));
}

// ---- workspaces ----

export function createWorkspace(s: AppState, name: string, copyPoolFrom?: string): AppState {
  const src = copyPoolFrom ? s.workspaces.find((w) => w.id === copyPoolFrom) : undefined;
  // Copies get fresh ids and no assignments, so everyone starts available.
  const prospects = src ? src.prospects.map((p) => ({ ...p, id: uid('p') })) : [];
  const ws = newWorkspace(name.trim() || 'Untitled workspace', prospects);
  return { ...s, workspaces: [...s.workspaces, ws], activeWorkspaceId: ws.id };
}

export function renameWorkspace(s: AppState, id: string, name: string): AppState {
  return { ...s, workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, name: name.trim() || w.name } : w)) };
}

export function deleteWorkspace(s: AppState, id: string): AppState {
  const rest = s.workspaces.filter((w) => w.id !== id);
  if (rest.length === 0) {
    const ws = newWorkspace('My Draft Class');
    return { ...s, workspaces: [ws], activeWorkspaceId: ws.id };
  }
  return { ...s, workspaces: rest, activeWorkspaceId: s.activeWorkspaceId === id ? rest[0].id : s.activeWorkspaceId };
}

export function switchWorkspace(s: AppState, id: string): AppState {
  return s.workspaces.some((w) => w.id === id) ? { ...s, activeWorkspaceId: id } : s;
}

export function updateSettings(s: AppState, patch: Partial<Settings>): AppState {
  return { ...s, settings: { ...s.settings, ...patch } };
}

// ---- validation (used for storage loads and backup restores) ----

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optStr = (v: unknown) => v === undefined || isStr(v);

/** Checks a parsed object is a usable AppState. Returns a list of problems (empty = valid). */
export function validateState(raw: unknown): string[] {
  const errs: string[] = [];
  const o = raw as AppState;
  if (!o || typeof o !== 'object') return ['Not a Rookie Match backup (no data object).'];
  if (o.version !== 1) errs.push(`Unsupported backup version: ${String(o.version)}.`);
  if (!Array.isArray(o.workspaces) || o.workspaces.length === 0) return [...errs, 'Backup has no workspaces.'];
  if (!o.settings || !isNum(o.settings.heightTol) || !isNum(o.settings.weightTol) || o.settings.heightTol <= 0 || o.settings.weightTol <= 0) {
    errs.push('Settings are missing or have invalid tolerances.');
  }
  if (!o.settings || !Array.isArray(o.settings.positions) || typeof o.settings.aliases !== 'object' || !Array.isArray(o.settings.related)) {
    errs.push('Position settings are missing.');
  }
  o.workspaces.forEach((w, i) => {
    const where = `Workspace ${i + 1}`;
    if (!isStr(w.id) || !isStr(w.name) || !Array.isArray(w.prospects) || !Array.isArray(w.assignments)) {
      errs.push(`${where} is malformed.`);
      return;
    }
    const ids = new Set<string>();
    for (const p of w.prospects) {
      if (!isStr(p.id) || !isStr(p.name) || !isStr(p.position) || !isNum(p.heightIn) || !isNum(p.weight) || !optStr(p.college) || !optStr(p.notes)) {
        errs.push(`${where}: a prospect record is malformed (${JSON.stringify(p).slice(0, 80)}).`);
      } else ids.add(p.id);
    }
    const assigned = new Set<string>();
    for (const a of w.assignments) {
      if (!isStr(a.id) || !isStr(a.prospectId) || !a.generated || !isNum(a.generated.heightIn) || !isNum(a.generated.weight) || !isStr(a.date)) {
        errs.push(`${where}: an assignment record is malformed.`);
        continue;
      }
      if (!ids.has(a.prospectId)) errs.push(`${where}: assignment for "${a.prospectName}" points to a missing prospect.`);
      // A prospect has at most one ordinary assignment; repeats must be marked as reuses.
      if (a.reused) continue;
      if (assigned.has(a.prospectId)) errs.push(`${where}: "${a.prospectName}" is assigned twice.`);
      assigned.add(a.prospectId);
    }
  });
  if (!o.workspaces.some((w) => w.id === o.activeWorkspaceId)) errs.push('Active workspace is missing.');
  return errs;
}
