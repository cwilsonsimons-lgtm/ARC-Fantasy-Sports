import React, { useMemo, useState } from 'react';
import { formatHeight, formatNumber, parseHeight, parseWeight } from '../core/height';
import { describeDiff } from '../core/match';
import { activeWorkspace, removeAssignment, restoreAssignment, updateAssignment, type Assignment } from '../core/state';
import { assignmentsCsv, fileSlug } from '../core/storage';
import { useDownload, formatDate, HeightField, Modal, plural, PositionSelect, today, useConfirm, useStore, useToast } from './common';

export function History() {
  const { state, apply } = useStore();
  const toast = useToast();
  const confirm = useConfirm();
  const download = useDownload();
  const ws = activeWorkspace(state);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Assignment | null>(null);
  const byId = useMemo(() => new Map(ws.prospects.map((p) => [p.id, p])), [ws]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...ws.assignments]
      .sort((a, b) => b.date.localeCompare(a.date))
      .filter((a) => {
        if (!needle) return true;
        const p = byId.get(a.prospectId);
        return [p?.name ?? a.prospectName, a.prospectPosition, a.generated.position, p?.college ?? a.prospectCollege, a.originalName, a.team, a.notes, formatHeight(a.generated.heightIn), String(a.generated.weight)]
          .some((v) => v?.toLowerCase().includes(needle));
      });
  }, [ws, q, byId]);

  const undo = (a: Assignment) => {
    apply((s) => removeAssignment(s, a.id).state);
    toast(`Undid ${a.prospectName}. They're available again.`, {
      action: { label: 'Restore', run: () => { try { apply((s) => restoreAssignment(s, a)); } catch (e) { toast((e as Error).message, { tone: 'error' }); } } },
    });
  };

  const del = async (a: Assignment) => {
    if (!(await confirm({ title: 'Delete assignment?', body: <>Delete the record for <b>{a.prospectName}</b>? They'll become available again in <b>{ws.name}</b>. This can't be undone.</>, confirmLabel: 'Delete', danger: true }))) return;
    apply((s) => removeAssignment(s, a.id).state);
    toast(`Deleted assignment. ${a.prospectName} is available again.`);
  };

  return (
    <section className="page" aria-labelledby="hist-title">
      <div className="page-head page-head-row">
        <div>
          <h1 id="hist-title">Assignment History</h1>
          <p className="lede">Confirmed renames in <b>{ws.name}</b>. Undoing or deleting one makes the real-life prospect available again.</p>
        </div>
        <div className="row-actions">
          <button className="btn btn-ghost" disabled={!ws.assignments.length} onClick={() => download(`rookie-match-assignments-${fileSlug(state)}-${today()}.csv`, assignmentsCsv(ws), 'text/csv')}>Export CSV</button>
        </div>
      </div>

      <div className="filters card">
        <div className="field grow">
          <label htmlFor="hist-q">Search</label>
          <input id="hist-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, team, position, notes…" />
        </div>
      </div>

      {ws.assignments.length === 0 ? (
        <div className="empty">No assignments yet. Confirm a match in Find a Match and it will appear here.</div>
      ) : rows.length === 0 ? (
        <div className="empty">No assignments match “{q}”.</div>
      ) : (
        <div className="table-wrap">
          <div className="muted table-count">{rows.length === ws.assignments.length ? plural(rows.length, 'assignment') : `${rows.length} of ${ws.assignments.length} assignments`}</div>
          <table className="table hist-table">
            <thead>
              <tr><th>Date</th><th>Real-life prospect</th><th>Generated player</th><th>Difference</th><th>Team</th><th>Notes</th><th><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const p = byId.get(a.prospectId);
                return (
                  <tr key={a.id}>
                    <td data-label="Date" className="muted nowrap">{formatDate(a.date)}</td>
                    <td data-label="Real-life prospect">
                      <div className="cell-name">{p?.name ?? a.prospectName}{p?.sample && <span className="badge badge-sample">Sample</span>}</div>
                      <div className="cell-notes">{p?.position ?? a.prospectPosition}{(p?.college ?? a.prospectCollege) ? ` · ${p?.college ?? a.prospectCollege}` : ''}{p ? ` · ${formatHeight(p.heightIn)}, ${formatNumber(p.weight)} lb` : ''}</div>
                    </td>
                    <td data-label="Generated player">
                      <div className="meas">{a.generated.position} · {formatHeight(a.generated.heightIn)} · {formatNumber(a.generated.weight)} lb</div>
                      {a.originalName && <div className="cell-notes">was “{a.originalName}”</div>}
                    </td>
                    <td data-label="Difference" className="cell-notes">{p ? describeDiff(p.heightIn - a.generated.heightIn, p.weight - a.generated.weight) : '—'}</td>
                    <td data-label="Team">{a.team ?? <span className="muted">—</span>}</td>
                    <td data-label="Notes" className="cell-notes">{a.notes ?? ''}</td>
                    <td className="cell-actions">
                      <button className="btn btn-small" onClick={() => setEditing(a)}>Edit</button>
                      <button className="btn btn-small" onClick={() => undo(a)} aria-label={`Undo ${a.prospectName}`}>Undo</button>
                      <button className="btn btn-small btn-ghost-danger" onClick={() => del(a)} aria-label={`Delete assignment for ${a.prospectName}`}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && <EditAssignment a={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function EditAssignment({ a, onClose }: { a: Assignment; onClose: () => void }) {
  const { state, apply } = useStore();
  const toast = useToast();
  const [position, setPosition] = useState(a.generated.position);
  const [height, setHeight] = useState(formatHeight(a.generated.heightIn));
  const [weight, setWeight] = useState(formatNumber(a.generated.weight));
  const [originalName, setOriginalName] = useState(a.originalName ?? '');
  const [team, setTeam] = useState(a.team ?? '');
  const [notes, setNotes] = useState(a.notes ?? '');
  const [errors, setErrors] = useState<string[]>([]);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const h = parseHeight(height);
    const w = parseWeight(weight);
    const errs = [...(h.ok ? [] : [`Height: ${h.error}`]), ...(w.ok ? [] : [`Weight: ${w.error}`]), ...(position ? [] : ['Choose a position.'])];
    setErrors(errs);
    if (errs.length || !h.ok || !w.ok) return;
    apply((s) => updateAssignment(s, a.id, { generated: { position, heightIn: h.value, weight: w.value }, originalName, team, notes }));
    toast('Assignment updated.');
    onClose();
  };
  return (
    <Modal title={`Edit assignment · ${a.prospectName}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" form="edit-assign">Save changes</button></>}>
      <p className="muted">To use a different real-life prospect, undo this assignment and match again.</p>
      <form id="edit-assign" className="form-grid" onSubmit={save}>
        <PositionSelect id="ea-pos" label="Generated position" value={position} onChange={setPosition} positions={state.settings.positions} />
        <HeightField id="ea-height" label="Generated height" value={height} onChange={setHeight} />
        <div className="field">
          <label htmlFor="ea-weight">Generated weight (lb)</label>
          <input id="ea-weight" value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="numeric" />
        </div>
        <div className="field">
          <label htmlFor="ea-orig">Original name <span className="opt">optional</span></label>
          <input id="ea-orig" value={originalName} onChange={(e) => setOriginalName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ea-team">Madden team <span className="opt">optional</span></label>
          <input id="ea-team" value={team} onChange={(e) => setTeam(e.target.value)} />
        </div>
        <div className="field field-full">
          <label htmlFor="ea-notes">Notes <span className="opt">optional</span></label>
          <input id="ea-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {errors.length > 0 && <div className="notice notice-error field-full" role="alert">{errors.map((x) => <div key={x}>{x}</div>)}</div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
