import React, { useMemo, useState } from 'react';
import { formatHeight, formatNumber } from '../core/height';
import { parseTable } from '../core/csv';
import {
  applyMapping, FIELD_LABEL, guessMapping, looksLikeHeader, validateRows, type Field, type RawValues, type ValidatedRow,
} from '../core/importer';
import { cleanCode } from '../core/positions';
import { parseBoard, type BoardSource } from '../core/board';
import { fillFromLookup, lookupId, type LookupEntry } from '../core/lookup';
import { useLookup } from './lookupStore';
import { activeWorkspace, addProspects, updateSettings } from '../core/state';
import { Modal, plural, useStore, useToast } from './common';

const FIELDS: Field[] = ['name', 'firstName', 'lastName', 'position', 'height', 'weight', 'college', 'notes', 'ignore'];
const EDITABLE: (keyof RawValues)[] = ['name', 'position', 'height', 'weight', 'college', 'notes'];

export const TANKATHON_URL = 'https://www.tankathon.com/nfl/big_board';
export const MDDB_URL = 'https://www.nflmockdraftdatabase.com/big-boards/2027/consensus-big-board-2027';

const BOARD: Record<BoardSource, { tab: string; site: string; url: string; shortUrl: string; example: string }> = {
  tankathon: { tab: 'Tankathon', site: 'Tankathon', url: TANKATHON_URL, shortUrl: 'tankathon.com/nfl/big_board', example: '"WR | Ohio State"' },
  mddb: { tab: 'NFL Mock Draft Database', site: 'NFL Mock Draft Database', url: MDDB_URL, shortUrl: 'nflmockdraftdatabase.com consensus big board', example: 'a position (like "WR") followed by the school' },
};

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const { state, apply } = useStore();
  const toast = useToast();
  const ws = activeWorkspace(state);
  const [mode, setMode] = useState<BoardSource | 'table'>('tankathon');
  const board = mode === 'table' ? null : BOARD[mode];
  const lookup = useLookup();
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [step, setStep] = useState<'source' | 'preview'>('source');
  const [hasHeader, setHasHeader] = useState(false);
  const [mapping, setMapping] = useState<Field[]>([]);
  const [edits, setEdits] = useState<Record<number, Partial<RawValues>>>({});
  const [includeDup, setIncludeDup] = useState<Record<number, boolean>>({});
  const [onlyProblems, setOnlyProblems] = useState(false);

  const table = useMemo(() => parseTable(text), [text]);
  const tk = useMemo(() => (mode === 'table' ? null : parseBoard(text, mode, state.settings)), [text, mode, state.settings]);
  const width = Math.max(0, ...table.rows.map((r) => r.length));

  const goPreview = () => {
    setEdits({});
    setIncludeDup({});
    if (mode !== 'table') { setStep('preview'); return; }
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

  const sourceRows = useMemo<{ line: number; raw: RawValues }[]>(
    () => (tk ? tk.rows.map(({ line, raw }) => ({ line, raw })) : dataRows.map(({ line, cells }) => ({ line, raw: applyMapping(cells, mapping) }))),
    [tk, dataRows, mapping],
  );

  // Fill missing measurements from the looked-up list; anything typed in the preview still wins.
  const filled = useMemo(() => {
    const used = new Map<number, LookupEntry>();
    const rows = sourceRows.map(({ line, raw }) => {
      const f = fillFromLookup(raw, lookup.index);
      if (f.entry) used.set(line, f.entry);
      return { line, raw: f.raw };
    });
    return { rows, used };
  }, [sourceRows, lookup.index]);

  const validated = useMemo<ValidatedRow[]>(
    () => validateRows(filled.rows.map(({ line, raw }) => ({ line, raw: { ...raw, ...edits[line] } })), state.settings, ws.prospects),
    [filled, edits, state.settings, ws.prospects],
  );

  const unknown = [...new Set(validated.map((v) => v.unknownPosition).filter((x): x is string => !!x))];
  const isIncluded = (v: ValidatedRow) => !!v.prospect && (v.duplicates.length === 0 || includeDup[v.line]);
  const ready = validated.filter(isIncluded);
  const errorCount = validated.filter((v) => !v.prospect && !v.duplicates.length).length;
  const noMeasure = validated.filter((v) => !v.prospect && !v.duplicates.length && v.raw.name.trim() && (!v.raw.height.trim() || !v.raw.weight.trim()));
  const toAsk = noMeasure.filter((v) => !lookup.pending.has(lookupId(v.raw.name)));

  const askClaude = async () => {
    setAsking(true);
    try {
      const n = await lookup.request(toAsk.map((v) => v.raw));
      toast(`Saved ${plural(n, 'name')} for Claude. In your Claude chat, ask it to "look up the pending Rookie Match players".`);
    } catch {
      toast("Couldn't save the names. Try again in a moment.", { tone: 'error' });
    } finally {
      setAsking(false);
    }
  };
  const dupSkipped = validated.filter((v) => v.duplicates.length && (!v.prospect || !includeDup[v.line])).length;
  const mapped = new Set(mapping);
  const missingFields = mode !== 'table' ? [] : (['position', 'height', 'weight'] as Field[]).filter((f) => !mapped.has(f));
  if (mode === 'table' && !mapped.has('name') && !mapped.has('firstName') && !mapped.has('lastName')) missingFields.unshift('name');
  const rankByLine = useMemo(() => new Map((tk?.rows ?? []).map((r) => [r.line, r.rank])), [tk]);
  const canPreview = mode !== 'table' ? (tk?.rows.length ?? 0) > 0 : table.rows.length > 0;

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

  const shownRows = onlyProblems ? validated.filter((v) => (!v.prospect && !v.duplicates.length) || (v.prospect && v.duplicates.length) || v.warnings.length || v.sameName.length) : validated;

  return (
    <Modal
      wide
      title={step === 'source' ? 'Import prospects' : 'Check the import'}
      onClose={onClose}
      footer={step === 'source' ? (
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!canPreview} onClick={goPreview}>
            Preview {mode !== 'table' ? (tk?.rows.length ? `(${plural(tk.rows.length, 'player')})` : '') : table.rows.length ? `(${plural(table.rows.length, 'line')})` : ''}
          </button>
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
          <div className="seg" role="tablist" aria-label="Import source">
            {(Object.keys(BOARD) as BoardSource[]).map((k) => (
              <button key={k} role="tab" aria-selected={mode === k} className={`seg-btn ${mode === k ? 'seg-on' : ''}`} onClick={() => setMode(k)}>{BOARD[k].tab}</button>
            ))}
            <button role="tab" aria-selected={mode === 'table'} className={`seg-btn ${mode === 'table' ? 'seg-on' : ''}`} onClick={() => setMode('table')}>CSV / other list</button>
          </div>
          {board ? (
            <>
              <ol className="steps">
                <li>Open the <a href={board.url} target="_blank" rel="noopener noreferrer">{board.shortUrl}</a> and scroll to the bottom so the whole board has loaded.</li>
                <li>Select the whole page (<kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>A</kbd>) and copy it (<kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>C</kbd>).</li>
                <li>Paste it below. You can also upload the page saved as <b>.html</b> (<kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>S</kbd>).</li>
              </ol>
              {mode === 'mddb' && (
                <div className="notice notice-warn">
                  NFL Mock Draft Database boards usually list rank, name, position and school but <b>not height and weight</b>, and suggestions need both.
                  Import the Tankathon board first for measurements. Players already in your pool are skipped here, and any new players arrive with height and weight to fill in.
                </div>
              )}
              <p className="hint">Rookie Match picks out each player's name, position, school, and the height and weight when the board shows them. You'll check every row before anything is saved. Players already in your pool are flagged as possible duplicates and skipped, so you can re-paste an updated board.</p>
              <div className="field">
                <label htmlFor="imp-text">Paste the {board.site} page here</label>
                <textarea id="imp-text" rows={10} value={text} onChange={(e) => { setText(e.target.value); setFileName(''); }} placeholder="Paste the copied big board here" spellCheck={false} />
                <div className={`hint ${text.trim() && !tk?.rows.length ? 'hint-error' : ''}`}>
                  {!text.trim() ? '' : tk?.rows.length
                    ? <>Found <b>{plural(tk.rows.length, 'player')}</b>{tk.year ? ` on the ${tk.year} board` : ''}.</>
                    : `No players found. Each player needs ${board.example} after their name. Make sure you copied the whole board.`}
                </div>
              </div>
              <div className="field">
                <label htmlFor="imp-file">Or upload the saved page</label>
                <input id="imp-file" type="file" accept=".html,.htm,.txt,text/html,text/plain" onChange={(e) => onFile(e.target.files?.[0])} />
                {fileName && <div className="hint">Loaded {fileName}</div>}
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      ) : (
        <div className="import-preview">
          {board ? (
            <>
              <div className="notice notice-info">
                Read <b>{plural(validated.length, 'player')}</b> from the {board.site} board{tk?.year ? ` (${tk.year})` : ''}. Check heights and weights below. Rows Rookie Match couldn't fully read are highlighted and editable. The board rank is saved in each player's notes.
              </div>
              {tk && tk.withMeasurements < tk.rows.length && (
                <div className="notice notice-warn">
                  {tk.withMeasurements === 0 ? 'This board had no heights or weights.' : `${tk.rows.length - tk.withMeasurements} of ${tk.rows.length} players had no height or weight on the board.`}{' '}
                  {dupSkipped > 0 && <>{plural(dupSkipped, 'player')} you already have will be skipped. </>}
                  Fill in the rest below, or leave them out: rows without measurements aren't imported.
                </div>
              )}
            </>
          ) : (<>
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
          </>)}

          {(filled.used.size > 0 || (lookup.available && noMeasure.length > 0)) && (
            <div className="notice notice-info lookup-note">
              {filled.used.size > 0 && <div><b>{plural(filled.used.size, 'player')}</b> had height and weight filled from measurements Claude looked up. Each row names its source; check them before importing.</div>}
              {lookup.available && noMeasure.length > 0 && (
                <div className="lookup-ask">
                  <span>
                    <b>{plural(noMeasure.length, 'player')}</b> still {noMeasure.length === 1 ? 'has' : 'have'} no height or weight.
                    {toAsk.length < noMeasure.length && <> {noMeasure.length - toAsk.length} already waiting for Claude.</>}
                  </span>
                  {toAsk.length > 0 && <button className="btn btn-small btn-primary" disabled={asking} onClick={askClaude}>Ask Claude to look up {plural(toAsk.length, 'player')}</button>}
                </div>
              )}
            </div>
          )}

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
                <tr><th>{board ? 'Rank' : 'Line'}</th><th>Name</th><th>Pos</th><th>Height</th><th>Weight</th><th>College</th><th>Notes</th><th>Check</th></tr>
              </thead>
              <tbody>
                {shownRows.map((v) => {
                  const have = !v.prospect && v.duplicates.length > 0; // incomplete, but already in the pool
                  const bad = !v.prospect && !have;
                  const dup = !!v.prospect && v.duplicates.length > 0;
                  const editable = bad || !!edits[v.line]; // keep inputs once edited so focus isn't lost mid-typing
                  return (
                    <tr key={v.line} className={bad ? 'row-error' : dup ? 'row-dup' : have ? 'row-have' : ''} data-line={v.line}>
                      <td data-label={board ? 'Rank' : 'Line'} className="muted">{board ? (rankByLine.get(v.line) ?? '—') : v.line}</td>
                      {EDITABLE.map((k) => (
                        <td key={k} data-label={k}>
                          {editable ? (
                            <input className="cell-input" aria-label={`Line ${v.line} ${k}`} value={v.raw[k]}
                              onChange={(e) => setEdits({ ...edits, [v.line]: { ...edits[v.line], [k]: e.target.value } })} />
                          ) : !v.prospect ? (v.raw[k] || <span className="muted">—</span>)
                            : k === 'height' ? <span className="meas">{formatHeight(v.prospect.heightIn)}</span>
                            : k === 'weight' ? <span className="meas">{formatNumber(v.prospect.weight)}</span>
                              : k === 'position' ? <span className="pos-chip">{v.prospect.position}</span>
                                : (v.raw[k] || <span className="muted">—</span>)}
                        </td>
                      ))}
                      <td data-label="Check" className="cell-check">
                        {filled.used.has(v.line) && !edits[v.line]?.height && (() => {
                          const e = filled.used.get(v.line)!;
                          return <div className="issue-info">Measurements from {e.sourceUrl ? <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer">{e.source}</a> : e.source}. Check them.</div>;
                        })()}
                        {lookup.pending.has(lookupId(v.raw.name)) && !v.prospect && !have && <div className="issue-info">Waiting for Claude to look up.</div>}
                        {have && <div className="issue-info">Already in your pool ({v.duplicates[0].detail.replace('already in pool ', '')}). Skipped.</div>}
                        {bad && <ul className="issues">{v.errors.map((e) => <li key={e} className="issue-error">{e}</li>)}</ul>}
                        {dup && (
                          <div className="issue-dup">
                            Possible duplicate: {v.duplicates.map((d) => `${d.name} — ${d.detail}`).join('; ')}
                            <label className="toggle"><input type="checkbox" checked={!!includeDup[v.line]} onChange={(e) => setIncludeDup({ ...includeDup, [v.line]: e.target.checked })} /> Import as a separate player</label>
                          </div>
                        )}
                        {v.warnings.map((wn) => <div key={wn} className="issue-warn">{wn}</div>)}
                        {v.sameName.length > 0 && <div className="issue-info">Shares a name with {v.sameName.join('; ')} — imported separately.</div>}
                        {!bad && !dup && !have && !v.warnings.length && !v.sameName.length && <span className="issue-ok">OK</span>}
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
