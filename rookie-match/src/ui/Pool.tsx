import React, { useMemo, useState } from 'react';
import { formatHeight, formatNumber, parseHeight, parseWeight } from '../core/height';
import { checkAgainst } from '../core/importer';
import { normalizePosition } from '../core/positions';
import {
  activeWorkspace, addProspects, counts, deleteProspect, removeSamples, updateProspect, usedMap,
  type Prospect, type ProspectInput,
} from '../core/state';
import { prospectsCsv, fileSlug } from '../core/storage';
import { TEMPLATE_CSV } from '../core/importer';
import { download, HeightField, Modal, plural, PositionSelect, today, useConfirm, useStore, useToast } from './common';
import { ImportDialog } from './ImportDialog';

type SortKey = 'name' | 'position' | 'height' | 'weight' | 'college';

export function Pool() {
  const { state, apply } = useStore();
  const toast = useToast();
  const confirm = useConfirm();
  const ws = activeWorkspace(state);
  const used = usedMap(ws);
  const c = counts(ws);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState('');
  const [avail, setAvail] = useState<'all' | 'available' | 'used'>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 });
  const [editing, setEditing] = useState<Prospect | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const samples = ws.prospects.filter((p) => p.sample).length;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = ws.prospects.filter((p) => {
      if (pos && p.position !== pos) return false;
      if (avail === 'available' && used.has(p.id)) return false;
      if (avail === 'used' && !used.has(p.id)) return false;
      if (needle && ![p.name, p.college, p.notes, p.position].some((v) => v?.toLowerCase().includes(needle))) return false;
      return true;
    });
    const val = (p: Prospect) => (sort.key === 'height' ? p.heightIn : sort.key === 'weight' ? p.weight : (p[sort.key] ?? '').toLowerCase());
    return list.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (x < y ? -1 : x > y ? 1 : a.name.localeCompare(b.name)) * sort.dir;
    });
  }, [ws, q, pos, avail, sort, used]);

  const sortBy = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }));
  const th = (key: SortKey, label: string, cls = '') => (
    <th className={cls} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="th-btn" onClick={() => sortBy(key)}>{label}{sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</button>
    </th>
  );

  const remove = async (p: Prospect) => {
    if (used.has(p.id)) {
      toast(`${p.name} is assigned. Undo the assignment in Assignment History before deleting.`, { tone: 'error' });
      return;
    }
    if (!(await confirm({ title: 'Delete prospect?', body: <>Delete <b>{p.name}</b> ({p.position}) from <b>{ws.name}</b>? This can't be undone.</>, confirmLabel: 'Delete', danger: true }))) return;
    try {
      apply((s) => deleteProspect(s, p.id));
      toast(`Deleted ${p.name}.`);
    } catch (e) {
      toast((e as Error).message, { tone: 'error' });
    }
  };

  const clearSamples = async () => {
    if (!(await confirm({ title: 'Remove sample prospects?', body: <>Remove the {plural(samples, 'fictional sample prospect')} from <b>{ws.name}</b>? Your own prospects are not affected.</>, confirmLabel: 'Remove samples', danger: true }))) return;
    let kept = 0;
    apply((s) => { const r = removeSamples(s); kept = r.kept; return r.state; });
    toast(kept ? `Removed samples. ${plural(kept, 'sample')} kept because they're assigned — undo those first.` : 'Sample prospects removed.');
  };

  return (
    <section className="page" aria-labelledby="pool-title">
      <div className="page-head page-head-row">
        <div>
          <h1 id="pool-title">Prospect Pool</h1>
          <p className="lede">Real-life prospects for <b>{ws.name}</b>. Used status only applies to this workspace.</p>
        </div>
        <div className="row-actions wrap">
          <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Add prospect</button>
          <button className="btn" onClick={() => setImporting(true)}>Import CSV / paste</button>
          <button className="btn btn-ghost" onClick={() => download('rookie-match-template.csv', TEMPLATE_CSV, 'text/csv')}>CSV template</button>
          <button className="btn btn-ghost" onClick={() => download(`rookie-match-prospects-${fileSlug(state)}-${today()}.csv`, prospectsCsv(ws), 'text/csv')} disabled={!ws.prospects.length}>Export CSV</button>
        </div>
      </div>

      <div className="stats">
        <div className="stat"><b>{c.total}</b><span>Total</span></div>
        <div className="stat stat-avail"><b>{c.available}</b><span>Available</span></div>
        <div className="stat stat-used"><b>{c.used}</b><span>Used</span></div>
      </div>

      {samples > 0 && (
        <div className="notice notice-info sample-note">
          <span>This workspace includes <b>{plural(samples, 'fictional sample prospect')}</b> (marked <span className="badge badge-sample">Sample</span>) so you can try the app. They aren't real players.</span>
          <button className="btn btn-small" onClick={clearSamples}>Remove samples</button>
        </div>
      )}

      <div className="filters card">
        <div className="field grow">
          <label htmlFor="pool-q">Search</label>
          <input id="pool-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, college or notes" />
        </div>
        <PositionSelect id="pool-pos" value={pos} onChange={setPos} positions={state.settings.positions} allowAll="All positions" />
        <div className="field">
          <label htmlFor="pool-avail">Status</label>
          <select id="pool-avail" value={avail} onChange={(e) => setAvail(e.target.value as typeof avail)}>
            <option value="all">All</option>
            <option value="available">Available</option>
            <option value="used">Used</option>
          </select>
        </div>
      </div>

      {ws.prospects.length === 0 ? (
        <div className="empty">No prospects yet. Add them one at a time, paste a list, or import a CSV (download the template to see the format).</div>
      ) : rows.length === 0 ? (
        <div className="empty">No prospects match these filters.</div>
      ) : (
        <div className="table-wrap">
          <div className="muted table-count">{rows.length === ws.prospects.length ? plural(rows.length, 'prospect') : `${rows.length} of ${ws.prospects.length} prospects`}</div>
          <table className="table pool-table">
            <thead>
              <tr>
                {th('name', 'Name')}
                {th('position', 'Pos')}
                {th('height', 'Height', 'num')}
                {th('weight', 'Weight', 'num')}
                {th('college', 'College')}
                <th>Status</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const a = used.get(p.id);
                return (
                  <tr key={p.id} className={a ? 'row-used' : ''}>
                    <td data-label="Name">
                      <div className="cell-name">{p.name}{p.sample && <span className="badge badge-sample">Sample</span>}</div>
                      {p.notes && <div className="cell-notes">{p.notes}</div>}
                    </td>
                    <td data-label="Pos"><span className="pos-chip">{p.position}</span></td>
                    <td data-label="Height" className="num meas">{formatHeight(p.heightIn)}</td>
                    <td data-label="Weight" className="num meas">{formatNumber(p.weight)}</td>
                    <td data-label="College">{p.college ?? <span className="muted">—</span>}</td>
                    <td data-label="Status">
                      {a ? (
                        <span className="badge badge-used" title={`Assigned to generated ${a.generated.position} ${formatHeight(a.generated.heightIn)} ${a.generated.weight} lb`}>Used{a.team ? ` · ${a.team}` : ''}</span>
                      ) : <span className="badge badge-avail">Available</span>}
                    </td>
                    <td className="cell-actions">
                      <button className="btn btn-small" onClick={() => setEditing(p)}>Edit</button>
                      <button className="btn btn-small btn-ghost-danger" onClick={() => remove(p)} aria-label={`Delete ${p.name}`}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && <ProspectForm prospect={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </section>
  );
}

function ProspectForm({ prospect, onClose }: { prospect: Prospect | null; onClose: () => void }) {
  const { state, apply } = useStore();
  const toast = useToast();
  const ws = activeWorkspace(state);
  const [name, setName] = useState(prospect?.name ?? '');
  const [position, setPosition] = useState(prospect?.position ?? '');
  const [height, setHeight] = useState(prospect ? formatHeight(prospect.heightIn) : '');
  const [weight, setWeight] = useState(prospect ? formatNumber(prospect.weight) : '');
  const [college, setCollege] = useState(prospect?.college ?? '');
  const [notes, setNotes] = useState(prospect?.notes ?? '');
  const [errors, setErrors] = useState<string[]>([]);
  const [dupAck, setDupAck] = useState<string | null>(null);
  const [keepOpen, setKeepOpen] = useState(false);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: string[] = [];
    const h = parseHeight(height);
    const w = parseWeight(weight);
    const position2 = normalizePosition(position, state.settings);
    if (!name.trim()) errs.push('Name is required.');
    if (!position2) errs.push('Choose a position.');
    if (!h.ok) errs.push(`Height: ${h.error}`);
    if (!w.ok) errs.push(`Weight: ${w.error}`);
    setErrors(errs);
    if (errs.length || !h.ok || !w.ok || !position2) return;
    const input: ProspectInput = {
      name: name.trim().replace(/\s+/g, ' '),
      position: position2,
      heightIn: h.value,
      weight: w.value,
      ...(college.trim() ? { college: college.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(prospect?.sample ? { sample: true } : {}),
    };
    const { duplicates } = checkAgainst(input, ws.prospects, prospect?.id);
    const sig = JSON.stringify([input.name, input.position, input.college]);
    if (duplicates.length && dupAck !== sig) {
      setDupAck(sig);
      setErrors([`Possible duplicate: ${duplicates.map((d) => `${d.name} (${d.detail})`).join('; ')}. Save again to keep both as separate players.`]);
      return;
    }
    if (prospect) {
      apply((s) => updateProspect(s, prospect.id, { ...input, college: input.college, notes: input.notes }));
      toast(`Saved ${input.name}.`);
      onClose();
    } else {
      apply((s) => addProspects(s, [input]));
      toast(`Added ${input.name}.`);
      if (keepOpen) {
        setName(''); setHeight(''); setWeight(''); setCollege(''); setNotes(''); setErrors([]); setDupAck(null);
        setTimeout(() => document.getElementById('pf-name')?.focus(), 0);
      } else onClose();
    }
  };

  return (
    <Modal
      title={prospect ? `Edit ${prospect.name}` : 'Add prospect'}
      onClose={onClose}
      footer={
        <>
          {!prospect && <label className="toggle foot-left"><input type="checkbox" checked={keepOpen} onChange={(e) => setKeepOpen(e.target.checked)} /> Add another after saving</label>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="prospect-form">{prospect ? 'Save changes' : 'Add prospect'}</button>
        </>
      }
    >
      <form id="prospect-form" onSubmit={save} className="form-grid">
        <div className="field field-full">
          <label htmlFor="pf-name">Name</label>
          <input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </div>
        <PositionSelect id="pf-pos" value={position} onChange={setPosition} positions={state.settings.positions} />
        <HeightField id="pf-height" value={height} onChange={setHeight} />
        <div className="field">
          <label htmlFor="pf-weight">Weight (lb)</label>
          <input id="pf-weight" value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="numeric" autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="pf-college">College <span className="opt">optional</span></label>
          <input id="pf-college" value={college} onChange={(e) => setCollege(e.target.value)} autoComplete="off" />
        </div>
        <div className="field field-full">
          <label htmlFor="pf-notes">Notes <span className="opt">optional</span></label>
          <input id="pf-notes" value={notes} onChange={(e) => setNotes(e.target.value)} autoComplete="off" />
        </div>
        {errors.length > 0 && <div className="notice notice-error field-full" role="alert">{errors.map((x) => <div key={x}>{x}</div>)}</div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

