import React, { useMemo, useState } from 'react';
import { formatHeight, formatNumber } from '../core/height';
import { parseTable } from '../core/csv';
import {
  applyMapping, FIELD_LABEL, guessMapping, looksLikeHeader, validateRows, type Field, type RawValues, type ValidatedRow,
} from '../core/importer';
import { cleanCode } from '../core/positions';
import { activeWorkspace, addProspects, updateSettings } from '../core/state';
import { Modal, plural, useStore, useToast } from './common';

const FIELDS: Field[] = ['name', 'firstName', 'lastName', 'position', 'height', 'weight', 'college', 'notes', 'ignore'];
const EDITABLE: (keyof RawValues)[] = ['name', 'position', 'height', 'weight', 'college', 'notes'];

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const { state, apply } = useStore();
  const toast = useToast();
  const ws = activeWorkspace(state);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [step, setStep] = useState<'source' | 'preview'>('source');
  const [hasHeader, setHasHeader] = useState(false);
  const [mapping, setMapping] = useState<Field[]>([]);
  const [edits, setEdits] = useState<Record<number, Partial<RawValues>>>({});
  const [includeDup, setIncludeDup] = useState<Record<number, boolean>>({});
  const [onlyProblems, setOnlyProblems] = useState(false);

  const table = useMemo(() => parseTable(text), [text]);
  const width = Math.max(0, ...table.rows.map((r) => r.length));

  const goPreview = () => {
    const header = table.rows.length > 0 && looksLikeHeader(table.rows[0]);
    setHasHeader(header);
    const first = table.rows[0] ?? [];
    const padded = [...first, ...Array(Math.max(0, width - first.length)).fill('')];
    setMapping(guessMapping(padded, header));
    setEdits({});
    setIncludeDup({});
    setStep('preview');
  };

  const dataRows = useMemo(
    () => (hasHeader ? table.rows.slice(1) : table.rows).map((r, i) => ({ line: i + (hasHeader ? 2 : 1), cells: r })),
    [table, hasHeader],
  );

  const validated = useMemo<ValidatedRow[]>(
    () => validateRows(dataRows.map(({ line, cells }) => ({ line, raw: { ...applyMapping(cells, mapping), ...edits[line] } })), state.settings, ws.prospects),
    [dataRows, mapping, edits, state.settings, ws.prospects],
  );

  const unknown = [...new Set(validated.map((v) => v.unknownPosition).filter((x): x is string => !!x))];
  const isIncluded = (v: ValidatedRow) => !!v.prospect && (v.duplicates.length === 0 || includeDup[v.line]);
  const ready = validated.filter(isIncluded);
  const errorCount = validated.filter((v) => !v.prospect).length;
  const dupSkipped = validated.filter((v) => v.prospect && v.duplicates.length && !includeDup[v.line]).length;
  const mapped = new Set(mapping);
  const missingFields = (['position', 'height', 'weight'] as Field[]).filter((f) => !mapped.has(f));
  if (!mapped.has('name') && !mapped.has('firstName') && !mapped.has('lastName')) missingFields.unshift('name');

  const mapPosition = (raw: string, to: string) => {
    if (!to) return;
    apply((s) => updateSettings(s, { aliases: { ...s.settings.aliases, [cleanCode(raw)]: to } }));
    toast(`"${raw}" now maps to ${to}. Change it any time in Settings.`);
  };

  const doImport = () => {
    const list = ready.map((v) => v.prospect!);
    apply((s) => addProspects(s, list));
    toast(`Imported ${plural(list.length, 'prospect')} into ${ws.name}.`);
    onClose();
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setFileName(f.name);
    setText(await f.text());
  };

  const shownRows = onlyProblems ? validated.filter((v) => !v.prospect || v.duplicates.length || v.warnings.length || v.sameName.length) : validated;

  return (
    <Modal
      wide
      title={step === 'source' ? 'Import prospects' : 'Check the import'}
      onClose={onClose}
      footer={step === 'source' ? (
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={table.rows.length === 0} onClick={goPreview}>Preview {table.rows.length ? `(${plural(table.rows.length, 'line')})` : ''}</button>
        </>
      ) : (
        <>
          <span className="foot-left muted">
            {plural(ready.length, 'prospect')} ready{errorCount ? ` · ${errorCount} with problems (not imported)` : ''}{dupSkipped ? ` · ${dupSkipped} possible duplicate${dupSkipped === 1 ? '' : 's'} skipped` : ''}
          </span>
          <button className="btn" onClick={() => setStep('source')}>Back</button>
          <button className="btn btn-primary" disabled={ready.length === 0 || missingFields.length > 0} onClick={doImport}>Import {plural(ready.length, 'prospect')}</button>
        </>
      )}
    >
      {step === 'source' ? (
        <div className="import-source">
          <p>Paste rows from a spreadsheet or text file, or choose a CSV. Columns can be in any order — you'll map them on the next step. Without a header row, the order is assumed to be <b>name, position, height, weight, college, notes</b>.</p>
          <div className="field">
            <label htmlFor="imp-file">CSV or text file</label>
            <input id="imp-file" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={(e) => onFile(e.target.files?.[0])} />
            {fileName && <div className="hint">Loaded {fileName}</div>}
          </div>
          <div className="field">
            <label htmlFor="imp-text">Or paste here</label>
            <textarea id="imp-text" rows={10} value={text} onChange={(e) => { setText(e.target.value); setFileName(''); }}
              placeholder={`name,position,height,weight,college\nJordan Example,WR,6'3",215,Example State\nChris Sample,HB,5-11,205,Sample Tech`} spellCheck={false} />
            <div className="hint">Comma, tab, semicolon or pipe separated. Heights like 6'3", 6-3 or 75 are all fine.</div>
          </div>
        </div>
      ) : (
        <div className="import-preview">
          <div className="map-head">
            <label className="toggle"><input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> First line is a header row</label>
            <span className="muted">Detected {table.delimiter === '\t' ? 'tab' : `"${table.delimiter}"`}-separated · {plural(dataRows.length, 'data row')}</span>
          </div>

          <h3 className="sub">Field mapping</h3>
          <div className="mapping">
            {Array.from({ length: width }, (_, i) => (
              <div className="map-col" key={i}>
                <div className="map-src" title={table.rows[0]?.[i]}>{hasHeader ? (table.rows[0]?.[i] || `Column ${i + 1}`) : `Column ${i + 1}`}</div>
                <div className="map-sample muted">{(hasHeader ? table.rows[1] : table.rows[0])?.[i] ?? ''}</div>
                <select aria-label={`Map column ${i + 1}`} value={mapping[i] ?? 'ignore'} onChange={(e) => { const m = [...mapping]; m[i] = e.target.value as Field; setMapping(m); }}>
                  {FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
                </select>
              </div>
            ))}
          </div>
          {missingFields.length > 0 && <div className="notice notice-error">Map a column to: {missingFields.map((f) => FIELD_LABEL[f]).join(', ')}.</div>}

          {unknown.length > 0 && (
            <div className="notice notice-warn">
              <b>Unrecognized positions.</b> Map each to one of your positions (saved to Settings → Position mappings), or fix the rows below.
              <div className="unknown-list">
                {unknown.map((u) => (
                  <label key={u} className="unknown-item">
                    <span className="pos-chip">{u}</span> →
                    <select aria-label={`Map position ${u}`} defaultValue="" onChange={(e) => mapPosition(u, e.target.value)}>
                      <option value="" disabled>Choose…</option>
                      {state.settings.positions.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="map-head">
            <h3 className="sub">Rows</h3>
            <label className="toggle"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Only show rows that need attention</label>
          </div>
          <div className="table-wrap">
            <table className="table import-table">
              <thead>
                <tr><th>Line</th><th>Name</th><th>Pos</th><th>Height</th><th>Weight</th><th>College</th><th>Notes</th><th>Check</th></tr>
              </thead>
              <tbody>
                {shownRows.map((v) => {
                  const bad = !v.prospect;
                  const dup = !!v.prospect && v.duplicates.length > 0;
                  const editable = bad || !!edits[v.line]; // keep inputs once edited so focus isn't lost mid-typing
                  return (
                    <tr key={v.line} className={bad ? 'row-error' : dup ? 'row-dup' : ''} data-line={v.line}>
                      <td data-label="Line" className="muted">{v.line}</td>
                      {EDITABLE.map((k) => (
                        <td key={k} data-label={k}>
                          {editable ? (
                            <input className="cell-input" aria-label={`Line ${v.line} ${k}`} value={v.raw[k]}
                              onChange={(e) => setEdits({ ...edits, [v.line]: { ...edits[v.line], [k]: e.target.value } })} />
                          ) : k === 'height' ? <span className="meas">{formatHeight(v.prospect!.heightIn)}</span>
                            : k === 'weight' ? <span className="meas">{formatNumber(v.prospect!.weight)}</span>
                              : k === 'position' ? <span className="pos-chip">{v.prospect!.position}</span>
                                : (v.raw[k] || <span className="muted">—</span>)}
                        </td>
                      ))}
                      <td data-label="Check" className="cell-check">
                        {bad && <ul className="issues">{v.errors.map((e) => <li key={e} className="issue-error">{e}</li>)}</ul>}
                        {dup && (
                          <div className="issue-dup">
                            Possible duplicate: {v.duplicates.map((d) => `${d.name} — ${d.detail}`).join('; ')}
                            <label className="toggle"><input type="checkbox" checked={!!includeDup[v.line]} onChange={(e) => setIncludeDup({ ...includeDup, [v.line]: e.target.checked })} /> Import as a separate player</label>
                          </div>
                        )}
                        {v.warnings.map((wn) => <div key={wn} className="issue-warn">{wn}</div>)}
                        {v.sameName.length > 0 && <div className="issue-info">Shares a name with {v.sameName.join('; ')} — imported separately.</div>}
                        {!bad && !dup && !v.warnings.length && !v.sameName.length && <span className="issue-ok">OK</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {shownRows.length === 0 && <div className="empty">No rows need attention.</div>}
          </div>
        </div>
      )}
    </Modal>
  );
}
