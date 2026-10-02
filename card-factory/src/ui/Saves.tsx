import React, { useEffect, useState } from 'react';
import type { GameState } from '../sim/types';
import type { SaveMeta } from '../sim/save';
import { deserialize, serialize } from '../sim/save';
import { fmtMoney } from '../sim/format';
import { SLOTS, SLOT_LABEL, getDownloads, type SaveStore, type Slot } from './storage';
import { Field, Section, type Ctx } from './common';

export function Saves({ ctx, store, onLoad, onNewGame, savedTick }: {
  ctx: Ctx;
  store: SaveStore;
  onLoad: (s: GameState, from: string) => void;
  onNewGame: (seed: number, name: string) => void;
  savedTick: number;
}) {
  const { game, toast } = ctx;
  const [metas, setMetas] = useState<Record<string, SaveMeta>>({});
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState('');
  const [exportText, setExportText] = useState('');
  const [importText, setImportText] = useState('');
  const [seed, setSeed] = useState(String(Math.floor(Math.random() * 1e9)));
  const [name, setName] = useState('Foil & Ink Card Co.');
  const [canDownload, setCanDownload] = useState(false);

  const refresh = () => store.list().then((ms) => setMetas(Object.fromEntries(ms.map((m) => [m.slot, m])))).catch(() => toast('Could not read the save list.', 'bad'));
  useEffect(() => { refresh(); }, [store, savedTick]);
  useEffect(() => { getDownloads().then((d) => setCanDownload(!!d)); }, []);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy('');
      setConfirm('');
      refresh();
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Saves</p>
          <h1>Save slots</h1>
        </div>
      </header>
      <p className="lede">{store.describe} The game autosaves after every week and every manufacturing run. Seed <code>{game.seed}</code> reproduces this league exactly.</p>
      <div className="slot-grid">
        {SLOTS.map((slot) => {
          const m = metas[slot];
          return (
            <article key={slot} className="slot">
              <h3>{SLOT_LABEL[slot]}</h3>
              {m ? (
                <dl className="kv">
                  <div><dt>Company</dt><dd>{m.company}</dd></div>
                  <div><dt>Game date</dt><dd>Week {m.week} · {m.label}</dd></div>
                  <div><dt>Cash</dt><dd>{fmtMoney(m.cash, { cents: false })}</dd></div>
                  <div><dt>Saved</dt><dd>{new Date(m.savedAt).toLocaleString()}</dd></div>
                </dl>
              ) : <p className="empty">Empty</p>}
              <div className="row gap-s wrap">
                {slot !== 'autosave' && (
                  confirm === `save:${slot}` ? (
                    <span className="confirm">Overwrite?
                      <button className="btn btn-sm btn-primary" onClick={() => run(slot, async () => { await store.write(slot, game); toast(`Saved to ${SLOT_LABEL[slot]}`); })}>Overwrite</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setConfirm('')}>Cancel</button>
                    </span>
                  ) : (
                    <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => (m ? setConfirm(`save:${slot}`) : run(slot, async () => { await store.write(slot, game); toast(`Saved to ${SLOT_LABEL[slot]}`); }))}>
                      {busy === slot ? 'Saving…' : 'Save here'}
                    </button>
                  )
                )}
                {m && (confirm === `load:${slot}` ? (
                  <span className="confirm">Replace the current game?
                    <button className="btn btn-sm btn-primary" onClick={() => run(slot, async () => { onLoad(await store.read(slot as Slot), SLOT_LABEL[slot]); })}>Load</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setConfirm('')}>Cancel</button>
                  </span>
                ) : <button className="btn btn-sm" disabled={!!busy} onClick={() => setConfirm(`load:${slot}`)}>Load</button>)}
                {m && (confirm === `del:${slot}` ? (
                  <span className="confirm">Delete this save?
                    <button className="btn btn-sm btn-danger" onClick={() => run(slot, async () => { await store.remove(slot); toast(`${SLOT_LABEL[slot]} cleared`); })}>Delete</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setConfirm('')}>Cancel</button>
                  </span>
                ) : <button className="btn btn-sm btn-ghost" disabled={!!busy} onClick={() => setConfirm(`del:${slot}`)}>Delete</button>)}
              </div>
            </article>
          );
        })}
      </div>

      <div className="two-col">
        <Section title="Export a backup">
          <p className="muted">A save file is plain text with a built-in integrity check. Keep it anywhere and paste it back to restore.</p>
          <div className="row gap-s wrap">
            <button className="btn" onClick={() => setExportText(serialize(game))}>Show save text</button>
            {exportText && (
              <button className="btn" onClick={() => {
                navigator.clipboard.writeText(exportText).then(() => toast('Save copied'), () => {
                  const el = document.getElementById('export-text') as HTMLTextAreaElement | null;
                  el?.select();
                  toast('Copy blocked here. The text is selected; press Ctrl+C or ⌘C.', 'bad');
                });
              }}>Copy</button>
            )}
            {canDownload && (
              <button className="btn" onClick={async () => {
                const d = await getDownloads();
                try {
                  await d.save({ filename: `foil-and-ink-week-${game.week}.json`, data: serialize(game) });
                } catch {
                  toast('Download was cancelled.', 'bad');
                }
              }}>Download file</button>
            )}
          </div>
          {exportText && <textarea id="export-text" className="mono-area" readOnly value={exportText} rows={5} onFocus={(e) => e.target.select()} />}
        </Section>
        <Section title="Import a save">
          <textarea id="import-text" className="mono-area" rows={5} placeholder="Paste save text here" value={importText} onChange={(e) => setImportText(e.target.value)} />
          <div className="row gap-s wrap">
            <button className="btn btn-primary" disabled={!importText.trim()} onClick={() => {
              try {
                onLoad(deserialize(importText.trim()), 'imported save');
                setImportText('');
              } catch (e) {
                toast((e as Error).message, 'bad');
              }
            }}>Load pasted save</button>
            <label className="btn">
              Open file…
              <input type="file" accept=".json,application/json,text/plain" hidden onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const r = new FileReader();
                r.onload = () => setImportText(String(r.result ?? ''));
                r.readAsText(f);
              }} />
            </label>
          </div>
        </Section>
      </div>

      <Section title="New game">
        <div className="grid-3">
          <Field label="Company name" htmlFor="ng-name">
            <input id="ng-name" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Seed" htmlFor="ng-seed" hint="The same seed and the same choices replay the same league and market.">
            <input id="ng-seed" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, '').slice(0, 10))} />
          </Field>
          <Field label="Start">
            {confirm === 'new' ? (
              <span className="confirm">Unsaved progress in the current game is lost.
                <button className="btn btn-sm btn-danger" onClick={() => { onNewGame(Number(seed) || 1, name.trim() || 'Foil & Ink Card Co.'); setConfirm(''); }}>Start new game</button>
                <button className="btn btn-sm btn-ghost" onClick={() => setConfirm('')}>Cancel</button>
              </span>
            ) : <button className="btn" onClick={() => setConfirm('new')}>Start a new game</button>}
          </Field>
        </div>
      </Section>
    </div>
  );
}
