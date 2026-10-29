import React, { useState } from 'react';
import { cleanCode, defaultPositionSettings, positionsOf } from '../core/positions';
import {
  activeWorkspace, clearAssignments, clearProspects, counts, createWorkspace, deleteWorkspace, renameWorkspace, switchWorkspace, updateSettings, reuseExactOn,
  type AppState,
} from '../core/state';
import { makeBackup, readBackup } from '../core/storage';
import { plural, today, useConfirm, useDownload, useStore, useToast } from './common';
import { useSyncStatus } from './sync';

export function SettingsPage() {
  return (
    <section className="page" aria-labelledby="set-title">
      <div className="page-head">
        <h1 id="set-title">Settings &amp; Data</h1>
        <p className="lede">Workspaces, matching rules, position mappings, and backups.</p>
      </div>
      <StorageNote />
      <Workspaces />
      <Matching />
      <Positions />
      <Backup />
    </section>
  );
}

function StorageNote() {
  const sync = useSyncStatus();
  if (sync.mode === 'cloud' || sync.mode === 'checking') {
    return (
      <div className="notice notice-info">
        <b>Where your data lives:</b> in your private space on this page, tied to your Claude account. Only you can see it, and it follows you
        between your phone and computer. A copy is also kept in this browser. Download a backup now and then anyway.
      </div>
    );
  }
  return (
    <div className="notice notice-info">
      <b>Where your data lives:</b> everything is saved in this browser on this device (local storage). It survives refreshes and restarts, but it
      won't follow you to another browser or device, and clearing site data erases it. Download a backup regularly.
    </div>
  );
}

function Workspaces() {
  const { state, apply } = useStore();
  const toast = useToast();
  const confirm = useConfirm();
  const ws = activeWorkspace(state);
  const [name, setName] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim() || `Draft Class ${state.workspaces.length + 1}`;
    apply((s) => createWorkspace(s, n, copyFrom || undefined));
    toast(copyFrom ? `Created ${n} with a copy of the prospect pool — everyone is available.` : `Created ${n}.`);
    setName('');
  };

  return (
    <div className="card settings-card">
      <h2>Workspaces</h2>
      <p className="muted">Each franchise or draft class has its own prospect pool and assignments. Using a prospect in one workspace doesn't mark them used anywhere else.</p>
      <ul className="ws-list">
        {state.workspaces.map((w) => {
          const c = counts(w);
          return (
            <li key={w.id} className={w.id === ws.id ? 'ws-active' : ''}>
              {renaming === w.id ? (
                <form className="inline-form" onSubmit={(e) => { e.preventDefault(); apply((s) => renameWorkspace(s, w.id, renameVal)); setRenaming(null); }}>
                  <input aria-label="Workspace name" value={renameVal} onChange={(e) => setRenameVal(e.target.value)} autoFocus />
                  <button className="btn btn-small btn-primary" type="submit">Save</button>
                  <button className="btn btn-small" type="button" onClick={() => setRenaming(null)}>Cancel</button>
                </form>
              ) : (
                <>
                  <div className="ws-info">
                    <b>{w.name}</b>{w.id === ws.id && <span className="badge badge-avail">Active</span>}
                    <div className="muted">{c.total} prospects · {c.available} available · {c.used} used · {plural(w.assignments.length, 'assignment')}</div>
                  </div>
                  <div className="row-actions wrap">
                    {w.id !== ws.id && <button className="btn btn-small btn-primary" onClick={() => apply((s) => switchWorkspace(s, w.id))}>Switch to</button>}
                    <button className="btn btn-small" onClick={() => { setRenaming(w.id); setRenameVal(w.name); }}>Rename</button>
                    <button className="btn btn-small btn-ghost-danger" onClick={async () => {
                      if (await confirm({ title: 'Delete workspace?', body: <>Delete <b>{w.name}</b> with its {plural(c.total, 'prospect')} and {plural(w.assignments.length, 'assignment')}? Download a backup first if you might need it. This can't be undone.</>, confirmLabel: 'Delete workspace', danger: true })) {
                        apply((s) => deleteWorkspace(s, w.id));
                        toast(`Deleted ${w.name}.`);
                      }
                    }}>Delete</button>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>

      <form className="new-ws" onSubmit={create}>
        <h3 className="sub">New workspace</h3>
        <div className="form-row">
          <div className="field grow">
            <label htmlFor="ws-name">Name</label>
            <input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={`Draft Class ${state.workspaces.length + 1}`} />
          </div>
          <div className="field">
            <label htmlFor="ws-copy">Prospect pool</label>
            <select id="ws-copy" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
              <option value="">Start empty</option>
              {state.workspaces.map((w) => <option key={w.id} value={w.id}>Copy from {w.name} (all available)</option>)}
            </select>
          </div>
          <button className="btn btn-primary" type="submit">Create</button>
        </div>
      </form>

      <h3 className="sub">Reset “{ws.name}”</h3>
      <div className="row-actions wrap">
        <button className="btn btn-ghost-danger" disabled={!ws.assignments.length} onClick={async () => {
          if (await confirm({ title: 'Clear all assignments?', body: <>Remove all {plural(ws.assignments.length, 'assignment')} in <b>{ws.name}</b>? Every prospect becomes available again. Prospects are kept. This can't be undone.</>, confirmLabel: 'Clear assignments', danger: true })) {
            apply(clearAssignments);
            toast('Assignments cleared.');
          }
        }}>Clear assignments</button>
        <button className="btn btn-ghost-danger" disabled={!ws.prospects.length} onClick={async () => {
          if (await confirm({ title: 'Clear the prospect pool?', body: <>Delete all {plural(ws.prospects.length, 'prospect')} <b>and</b> {plural(ws.assignments.length, 'assignment')} in <b>{ws.name}</b>? This can't be undone.</>, confirmLabel: 'Clear workspace', danger: true })) {
            apply(clearProspects);
            toast('Workspace cleared.');
          }
        }}>Clear prospects &amp; assignments</button>
      </div>
    </div>
  );
}

function NumberSetting({ id, label, value, min, step, onSave, unit }: { id: string; label: string; value: number; min: number; step: number; unit: string; onSave: (n: number) => void }) {
  const [v, setV] = useState(String(value));
  const [err, setErr] = useState('');
  const commit = () => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n <= 0) { setErr(`Must be a positive number (at least ${min}).`); return; }
    setErr('');
    if (n !== value) onSave(n);
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="with-unit">
        <input id={id} type="number" min={min} step={step} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} className={err ? 'invalid' : ''} />
        <span>{unit}</span>
      </div>
      {err && <div className="hint hint-error">{err}</div>}
    </div>
  );
}

function Matching() {
  const { state, apply } = useStore();
  const s = state.settings;
  return (
    <div className="card settings-card">
      <h2>Matching</h2>
      <p className="muted">A prospect must be within both limits to count as “within preferred range”. The same values are the divisors in the distance score.</p>
      <div className="form-row">
        <NumberSetting key={`h${s.heightTol}`} id="set-htol" label="Height tolerance" unit="inches" value={s.heightTol} min={0.125} step={0.25} onSave={(n) => apply((x) => updateSettings(x, { heightTol: n }))} />
        <NumberSetting key={`w${s.weightTol}`} id="set-wtol" label="Weight tolerance" unit="pounds" value={s.weightTol} min={0.5} step={1} onSave={(n) => apply((x) => updateSettings(x, { weightTol: n }))} />
        <NumberSetting key={`r${s.resultLimit}`} id="set-limit" label="Suggestions shown at first" unit="players" value={s.resultLimit} min={1} step={1} onSave={(n) => apply((x) => updateSettings(x, { resultLimit: Math.round(n) }))} />
      </div>
      <label className="toggle">
        <input id="set-reuse" type="checkbox" checked={reuseExactOn(s)} onChange={(e) => apply((x) => updateSettings(x, { reuseExact: e.target.checked }))} />
        Suggest already-used players again when they're an exact match (same position, height and weight)
      </label>
      <button className="btn btn-small" onClick={() => apply((x) => updateSettings(x, { heightTol: 1, weightTol: 5, resultLimit: 5 }))}>Reset to 1 in / 5 lb / 5 shown</button>
    </div>
  );
}

function Positions() {
  const { state, apply } = useStore();
  const toast = useToast();
  const confirm = useConfirm();
  const s = state.settings;
  const [newPos, setNewPos] = useState('');
  const [alias, setAlias] = useState('');
  const [aliasTo, setAliasTo] = useState('');
  const [relA, setRelA] = useState('');
  const [relB, setRelB] = useState('');
  const inUse = (p: string) => state.workspaces.some((w) => w.prospects.some((x) => positionsOf(x.position).includes(p)) || w.assignments.some((a) => a.generated.position === p));
  const aliasList = Object.entries(s.aliases).sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));

  return (
    <div className="card settings-card">
      <h2>Positions</h2>
      <p className="muted">Prospects and Madden entries share one position list. Mappings turn other spellings (like HB) into a listed position when importing. Distinct positions are only searched together through the opt-in related-position search.</p>

      <h3 className="sub">Position list</h3>
      <div className="chips">
        {s.positions.map((p) => (
          <span className="chip" key={p}>
            {p}
            <button aria-label={`Remove position ${p}`} onClick={() => {
              if (inUse(p)) { toast(`${p} is used by prospects or assignments, so it can't be removed.`, { tone: 'error' }); return; }
              apply((x) => updateSettings(x, {
                positions: x.settings.positions.filter((q) => q !== p),
                aliases: Object.fromEntries(Object.entries(x.settings.aliases).filter(([, to]) => to !== p)),
                related: x.settings.related.filter(([a, b]) => a !== p && b !== p),
              }));
            }}>×</button>
          </span>
        ))}
      </div>
      <form className="inline-form" onSubmit={(e) => {
        e.preventDefault();
        const code = cleanCode(newPos);
        if (!code) return;
        if (s.positions.includes(code)) { toast(`${code} is already listed.`, { tone: 'error' }); return; }
        apply((x) => {
          const aliases = { ...x.settings.aliases };
          delete aliases[code]; // a listed position wins over an alias with the same name
          return updateSettings(x, { positions: [...x.settings.positions, code], aliases });
        });
        setNewPos('');
      }}>
        <input aria-label="New position code" value={newPos} onChange={(e) => setNewPos(e.target.value)} placeholder="e.g. EDGE" />
        <button className="btn btn-small" type="submit">Add position</button>
      </form>

      <h3 className="sub">Mappings ({aliasList.length})</h3>
      <form className="inline-form" onSubmit={(e) => {
        e.preventDefault();
        const code = cleanCode(alias);
        if (!code || !aliasTo) return;
        if (s.positions.includes(code)) { toast(`${code} is a listed position, so it can't also be a mapping.`, { tone: 'error' }); return; }
        apply((x) => updateSettings(x, { aliases: { ...x.settings.aliases, [code]: aliasTo } }));
        setAlias('');
      }}>
        <input aria-label="Alias" value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="e.g. DB" />
        <span>→</span>
        <select aria-label="Maps to" value={aliasTo} onChange={(e) => setAliasTo(e.target.value)}>
          <option value="" disabled>Position…</option>
          {s.positions.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="btn btn-small" type="submit">Add / update mapping</button>
      </form>
      <div className="alias-grid">
        {aliasList.map(([from, to]) => (
          <span className="chip chip-alias" key={from}>
            {from} → <b>{to}</b>
            <button aria-label={`Remove mapping ${from}`} onClick={() => apply((x) => { const a = { ...x.settings.aliases }; delete a[from]; return updateSettings(x, { aliases: a }); })}>×</button>
          </span>
        ))}
      </div>

      <h3 className="sub">Related positions (for the optional related search)</h3>
      <div className="chips">
        {s.related.map(([a, b]) => (
          <span className="chip" key={`${a}-${b}`}>
            {a} ↔ {b}
            <button aria-label={`Remove related pair ${a} ${b}`} onClick={() => apply((x) => updateSettings(x, { related: x.settings.related.filter(([p, q]) => !(p === a && q === b)) }))}>×</button>
          </span>
        ))}
      </div>
      <form className="inline-form" onSubmit={(e) => {
        e.preventDefault();
        if (!relA || !relB || relA === relB) return;
        if (s.related.some(([a, b]) => (a === relA && b === relB) || (a === relB && b === relA))) return;
        apply((x) => updateSettings(x, { related: [...x.settings.related, [relA, relB]] }));
      }}>
        <select aria-label="Related position A" value={relA} onChange={(e) => setRelA(e.target.value)}><option value="" disabled>Position…</option>{s.positions.map((p) => <option key={p}>{p}</option>)}</select>
        <span>↔</span>
        <select aria-label="Related position B" value={relB} onChange={(e) => setRelB(e.target.value)}><option value="" disabled>Position…</option>{s.positions.map((p) => <option key={p}>{p}</option>)}</select>
        <button className="btn btn-small" type="submit">Add pair</button>
      </form>

      <button className="btn btn-small btn-ghost-danger" onClick={async () => {
        const d = defaultPositionSettings();
        const missing = [...new Set(state.workspaces.flatMap((w) => w.prospects.flatMap((p) => positionsOf(p.position))))].filter((p) => !d.positions.includes(p));
        if (await confirm({ title: 'Reset positions?', body: <>Restore the default position list, mappings and related pairs? Your custom mappings will be lost.{missing.length ? <> Positions still used by prospects ({missing.join(', ')}) will be kept.</> : null}</>, confirmLabel: 'Reset positions', danger: true })) {
          apply((x) => updateSettings(x, { ...d, positions: [...d.positions, ...missing] }));
        }
      }}>Reset positions to defaults</button>
    </div>
  );
}

function Backup() {
  const { state, replace } = useStore();
  const toast = useToast();
  const confirm = useConfirm();
  const download = useDownload();
  const [errors, setErrors] = useState<string[]>([]);

  const summary = (s: AppState) => {
    const p = s.workspaces.reduce((n, w) => n + w.prospects.length, 0);
    const a = s.workspaces.reduce((n, w) => n + w.assignments.length, 0);
    return `${plural(s.workspaces.length, 'workspace')}, ${plural(p, 'prospect')}, ${plural(a, 'assignment')}`;
  };

  const restore = async (file: File | undefined, input: HTMLInputElement) => {
    if (!file) return;
    const r = readBackup(await file.text());
    input.value = '';
    if (!r.ok) { setErrors(r.errors); return; }
    setErrors([]);
    const ok = await confirm({
      title: 'Replace all data?',
      body: <>
        <p>Restoring <b>{file.name}</b>{r.exportedAt ? <> (saved {new Date(r.exportedAt).toLocaleString()})</> : null} will <b>replace everything</b> in this browser.</p>
        <p>Current: {summary(state)}<br />Backup: {summary(r.state)}</p>
        <p>Download a backup of the current data first if you might need it.</p>
      </>,
      confirmLabel: 'Replace with backup',
      danger: true,
    });
    if (!ok) return;
    replace(r.state);
    toast(`Restored ${summary(r.state)}.`);
  };

  return (
    <div className="card settings-card">
      <h2>Backup &amp; restore</h2>
      <p className="muted">A JSON backup holds every workspace, prospect, assignment and setting. Use it to move to another browser or keep a safe copy.</p>
      <div className="row-actions wrap">
        <button className="btn btn-primary" onClick={() => download(`rookie-match-backup-${today()}.json`, makeBackup(state), 'application/json')}>Download backup (.json)</button>
        <label className="btn file-btn">
          Restore from backup…
          <input type="file" accept=".json,application/json" aria-label="Restore from backup" onChange={(e) => restore(e.target.files?.[0], e.target)} />
        </label>
      </div>
      <p className="hint">Currently stored: {summary(state)}. CSV exports of the prospect pool and assignment history are on those screens.</p>
      {errors.length > 0 && (
        <div className="notice notice-error" role="alert">
          <b>That backup can't be restored — nothing was changed.</b>
          <ul>{errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
