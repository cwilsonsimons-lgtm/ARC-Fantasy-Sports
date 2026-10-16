// localStorage persistence plus JSON backup/restore and CSV exports.
import { formatHeight } from './height';
import { toCsv } from './csv';
import { activeWorkspace, initialState, usedMap, validateState, type AppState, type Workspace } from './state';
import { samplePool } from './sample';

export const STORAGE_KEY = 'rookie_match_v1';
const CORRUPT_KEY = 'rookie_match_v1_unreadable';

export interface LoadResult {
  state: AppState;
  status: 'loaded' | 'fresh' | 'recovered' | 'unavailable';
  message?: string;
}

export function loadState(storage: Storage | undefined = safeStorage()): LoadResult {
  if (!storage) return { state: initialState(samplePool()), status: 'unavailable', message: 'Browser storage is unavailable here, so changes will be lost when this page closes. Use Backup to keep your work.' };
  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { state: initialState(samplePool()), status: 'unavailable', message: 'Browser storage is blocked, so changes will be lost when this page closes. Use Backup to keep your work.' };
  }
  if (raw === null) return { state: initialState(samplePool()), status: 'fresh' };
  try {
    const parsed = JSON.parse(raw);
    const errs = validateState(parsed);
    if (errs.length) throw new Error(errs.join(' '));
    return { state: parsed as AppState, status: 'loaded' };
  } catch (e) {
    // Keep the unreadable copy so nothing is lost, and start clean.
    try { storage.setItem(CORRUPT_KEY, raw); } catch { /* ignore */ }
    return {
      state: initialState(samplePool()),
      status: 'recovered',
      message: `Saved data couldn't be read (${(e as Error).message.slice(0, 160)}). A copy was kept under "${CORRUPT_KEY}" in this browser's storage; starting fresh.`,
    };
  }
}

export function saveState(state: AppState, storage: Storage | undefined = safeStorage()): string | null {
  if (!storage) return 'Browser storage is unavailable — changes are not being saved.';
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return null;
  } catch (e) {
    return `Couldn't save to browser storage (${(e as Error).name}). Download a backup to keep your work.`;
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

// ---- backup ----

export interface BackupFile {
  app: 'rookie-match';
  exportedAt: string;
  data: AppState;
}

export function makeBackup(state: AppState): string {
  const file: BackupFile = { app: 'rookie-match', exportedAt: new Date().toISOString(), data: state };
  return JSON.stringify(file, null, 2);
}

export function readBackup(text: string): { ok: true; state: AppState; exportedAt?: string } | { ok: false; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['That file is not valid JSON.'] };
  }
  const file = parsed as Partial<BackupFile>;
  // Accept a wrapped backup file or a bare state object.
  const data = file && file.app === 'rookie-match' ? file.data : parsed;
  const errors = validateState(data);
  if (errors.length) return { ok: false, errors };
  return { ok: true, state: data as AppState, exportedAt: file?.exportedAt };
}

// ---- CSV exports ----

export function prospectsCsv(ws: Workspace): string {
  const used = usedMap(ws);
  return toCsv(
    ['name', 'position', 'height', 'height_inches', 'weight', 'college', 'notes', 'status', 'assigned_to_generated', 'assigned_team'],
    ws.prospects.map((p) => {
      const a = used.get(p.id);
      return [
        p.name, p.position, formatHeight(p.heightIn), p.heightIn, p.weight, p.college ?? '', p.notes ?? '',
        a ? 'used' : 'available',
        a ? `${a.generated.position} ${formatHeight(a.generated.heightIn)} ${a.generated.weight}${a.originalName ? ` (${a.originalName})` : ''}` : '',
        a?.team ?? '',
      ];
    }),
  );
}

export function assignmentsCsv(ws: Workspace): string {
  const byId = new Map(ws.prospects.map((p) => [p.id, p]));
  return toCsv(
    ['date', 'real_name', 'real_position', 'real_college', 'real_height', 'real_weight', 'generated_position', 'generated_height', 'generated_height_inches', 'generated_weight', 'original_name', 'madden_team', 'notes'],
    [...ws.assignments].sort((a, b) => a.date.localeCompare(b.date)).map((a) => {
      const p = byId.get(a.prospectId);
      return [
        a.date, p?.name ?? a.prospectName, p?.position ?? a.prospectPosition, p?.college ?? a.prospectCollege ?? '',
        p ? formatHeight(p.heightIn) : '', p?.weight ?? '',
        a.generated.position, formatHeight(a.generated.heightIn), a.generated.heightIn, a.generated.weight,
        a.originalName ?? '', a.team ?? '', a.notes ?? '',
      ];
    }),
  );
}

export const fileSlug = (s: AppState) => activeWorkspace(s).name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';
