import React, { useMemo, useState } from 'react';
import type { CardSet, Finish, ThemeId, Variant } from '../sim/types';
import { FINISH_LABEL, productionSummary, signingFee, unitCost, variantPlayers } from '../sim/catalog';
import { validateSet } from '../sim/product';
import { createProduct, createSet, deleteSet, makeVariant, updateSet } from '../sim/game';
import { playerName, weekDate, weekLabel } from '../sim/league';
import { playerAppeal } from '../sim/market';
import { fmtInt, fmtMoney } from '../sim/format';
import { CardView } from './CardView';
import { Field, Issues, NumInput, Pill, Section, type Ctx } from './common';

export const THEMES: { id: ThemeId; name: string; blurb: string }[] = [
  { id: 'classic', name: 'Classic Cardboard', blurb: 'White border, team-colour nameplate.' },
  { id: 'chrome', name: 'Chrome Rush', blurb: 'Silver frame with a light sheen. Collectors pay a little more.' },
  { id: 'noir', name: 'Gridiron Noir', blurb: 'Black border and gold type.' },
  { id: 'retro', name: "Retro '78", blurb: 'Rounded photo window and bold stripes.' },
];

export const PRINT_PRESETS = [999, 299, 99, 25, 10, 5, 1];
const FINISHES = Object.keys(FINISH_LABEL) as Finish[];

export function statusPill(set: CardSet) {
  if (set.status === 'draft') return <Pill tone="warn">Draft</Pill>;
  if (set.status === 'manufactured') return <Pill tone="accent">Manufactured · locked</Pill>;
  return <Pill tone="good">Released</Pill>;
}

export function SetList({ ctx, selected, onSelect }: { ctx: Ctx; selected?: string; onSelect: (id: string) => void }) {
  const { game, act } = ctx;
  return (
    <aside className="set-list">
      <div className="set-list-head">
        <h3>Your sets</h3>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => {
            let newId = '';
            if (act((s) => {
              const n = createSet(s, `Untitled Set ${s.sets.length + 1}`);
              newId = n.sets[n.sets.length - 1].id;
              return n;
            }, 'New draft set created')) onSelect(newId);
          }}
        >
          New set
        </button>
      </div>
      <ul>
        {[...game.sets].reverse().map((s) => (
          <li key={s.id}>
            <button className={`set-list-item ${s.id === selected ? 'is-active' : ''}`} onClick={() => onSelect(s.id)}>
              <span className="set-list-name">{s.year} {s.name}</span>
              <span className="set-list-meta">{statusPill(s)} <span>Wk {s.releaseWeek}</span></span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export function SetCreator({ ctx, setId, onSelect }: { ctx: Ctx; setId?: string; onSelect: (id: string) => void }) {
  const { game } = ctx;
  const set = game.sets.find((s) => s.id === setId) ?? game.sets[game.sets.length - 1];
  return (
    <div className="split">
      <SetList ctx={ctx} selected={set?.id} onSelect={onSelect} />
      <div className="split-main">{set ? <SetEditor key={set.id} ctx={ctx} set={set} onSelect={onSelect} /> : <p className="empty">Create a set to begin.</p>}</div>
    </div>
  );
}

function SetEditor({ ctx, set, onSelect }: { ctx: Ctx; set: CardSet; onSelect: (id: string) => void }) {
  const { game, act, go } = ctx;
  const locked = set.status !== 'draft';
  const edit = (fn: (s: CardSet) => void) => act((g) => updateSet(g, set.id, fn));
  const [previewPlayer, setPreviewPlayer] = useState<string>('');
  const [previewVariant, setPreviewVariant] = useState<string>('');
  const pv = set.variants.find((v) => v.id === previewVariant) ?? set.variants[set.variants.length - 1];
  const pvPlayers = pv ? variantPlayers(set, pv) : [];
  const pp = game.players[pvPlayers.includes(previewPlayer) ? previewPlayer : pvPlayers[0] ?? set.checklist[0]];
  const summary = productionSummary(game, set);
  const issues = validateSet(game, set);
  const products = game.products.filter((p) => p.setId === set.id);

  return (
    <div className="editor">
      <div className="editor-main">
        <header className="page-head">
          <div>
            <p className="eyebrow">{statusPill(set)} {set.year} · release {weekLabel(set.releaseWeek)}</p>
            <h1>{set.name || 'Untitled set'}</h1>
          </div>
          <div className="row gap-s">
            {!locked && (
              <>
                <button className="btn" onClick={() => (products.length ? go('products', set.id) : act((g) => createProduct(g, set.id), 'Hobby box added') && go('products', set.id))}>
                  {products.length ? 'Edit boxes' : 'Add a box product'}
                </button>
                <DeleteSet ctx={ctx} set={set} onDone={() => onSelect(game.sets.find((s) => s.id !== set.id)?.id ?? '')} />
              </>
            )}
            {locked && <button className="btn" onClick={() => go('production', set.id)}>View production</button>}
          </div>
        </header>
        {locked && <p className="locked-note">This set has been manufactured. Its checklist, print runs and product allocations are locked, so no copies can be added to this edition later. Start a new set for the next release.</p>}

        <Section title="Identity">
          <div className="grid-3">
            <Field label="Set name" htmlFor={`set-name-${set.id}`}>
              <input id={`set-name-${set.id}`} value={set.name} disabled={locked} onChange={(e) => edit((s) => { s.name = e.target.value; })} maxLength={40} />
            </Field>
            <Field label="Release week" htmlFor={`set-week-${set.id}`} hint={`${weekDate(set.releaseWeek)} · ${weekLabel(set.releaseWeek)}`}>
              <NumInput id={`set-week-${set.id}`} value={set.releaseWeek} min={game.week + 1} max={game.week + 104} disabled={locked} onChange={(n) => edit((s) => { s.releaseWeek = n; })} />
            </Field>
            <Field label="Card year" hint="Set by the release date. Players drafted that year get RC logos.">
              <span className="readout">{set.year}</span>
            </Field>
          </div>
          <div className="theme-picker" role="radiogroup" aria-label="Visual theme">
            {THEMES.map((t) => (
              <button key={t.id} role="radio" aria-checked={set.theme === t.id} disabled={locked} className={`theme-opt ${set.theme === t.id ? 'is-active' : ''}`} onClick={() => edit((s) => { s.theme = t.id; })}>
                <span className={`theme-swatch theme-${t.id}`} />
                <span className="theme-name">{t.name}</span>
                <span className="theme-blurb">{t.blurb}</span>
              </button>
            ))}
          </div>
        </Section>

        <BaseChecklist ctx={ctx} set={set} locked={locked} />

        <Section
          title="Parallels & autographs"
          aside={
            !locked && (
              <div className="row gap-s">
                <button className="btn btn-sm" onClick={() => act((g) => updateSet(g, set.id, (s, st) => { s.variants.push(makeVariant(st, 'parallel', { name: nextName(s, 'Parallel'), playerIds: s.checklist.slice(0, 20) })); }))}>
                  Add numbered parallel
                </button>
                <button className="btn btn-sm" onClick={() => act((g) => updateSet(g, set.id, (s, st) => { s.variants.push(makeVariant(st, 'auto', { name: nextName(s, 'Autograph'), playerIds: s.checklist.slice(0, 8) })); }))}>
                  Add autograph
                </button>
              </div>
            )
          }
        >
          {set.variants.length === 1 && <p className="empty">No special versions yet. Numbered parallels and autographs are the chase cards that sell boxes.</p>}
          <div className="variant-list">
            {set.variants.slice(1).map((v) => (
              <VariantEditor key={v.id} ctx={ctx} set={set} v={v} locked={locked} onPreview={() => setPreviewVariant(v.id)} />
            ))}
          </div>
        </Section>

        <Section title="Production summary">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Version</th><th className="num">Unique cards</th><th className="num">Copies of each</th><th className="num">Total printed</th><th className="num">Print cost</th></tr>
              </thead>
              <tbody>
                {summary.variants.map((r) => (
                  <tr key={r.variant.id}>
                    <td><span className="swatch" style={{ background: r.variant.kind === 'base' ? 'var(--card-base-frame)' : r.variant.color }} /> {r.variant.name} {r.variant.numbered && <Pill tone="gold">/{r.variant.printRun}</Pill>} {r.variant.autographed && <Pill tone="accent">Auto</Pill>}</td>
                    <td className="num">{fmtInt(r.uniqueCards)}</td>
                    <td className="num">{fmtInt(r.copiesEach)}</td>
                    <td className="num">{fmtInt(r.totalCopies)}</td>
                    <td className="num">{fmtMoney(r.cost, { cents: false })}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><th>Total</th><th className="num">{fmtInt(summary.uniqueCards)}</th><th /><th className="num">{fmtInt(summary.totalCopies)}</th><th className="num">{fmtMoney(summary.printCost, { cents: false })}</th></tr>
              </tfoot>
            </table>
          </div>
          <dl className="kv kv-cols">
            <div><dt>Design & licensing</dt><dd>{fmtMoney(summary.designCost, { cents: false })}</dd></div>
            <div><dt>Boxes & wrappers</dt><dd>{fmtMoney(summary.packagingCost, { cents: false })}</dd></div>
            <div><dt>Total manufacturing cost</dt><dd className="strong">{fmtMoney(summary.totalCost, { cents: false })}</dd></div>
            <div><dt>Projected supply</dt><dd>{fmtInt(summary.boxes)} boxes · {fmtInt(summary.packs)} packs</dd></div>
            <div><dt>Sealed revenue if all sell</dt><dd>{fmtMoney(summary.projectedRevenue, { cents: false })}</dd></div>
            <div><dt>Gross margin if all sell</dt><dd className={summary.projectedRevenue - summary.totalCost >= 0 ? 'tone-good' : 'tone-bad'}>{fmtMoney(summary.projectedRevenue - summary.totalCost, { cents: false, sign: true })}</dd></div>
          </dl>
        </Section>

        <Section title="Readiness">
          <Issues issues={issues} empty="Ready to manufacture." />
        </Section>
      </div>

      <aside className="editor-side">
        <div className="preview-panel">
          <h3>Live preview</h3>
          {pv && pp ? (
            <>
              <CardView set={set} variant={pv} player={pp} team={game.teams.find((t) => t.id === pp.teamId)!} serial={pv.numbered ? Math.min(pv.printRun, 7) : undefined} size="lg" />
              <div className="preview-controls">
                <Field label="Version" htmlFor="pv-variant">
                  <select id="pv-variant" value={pv.id} onChange={(e) => setPreviewVariant(e.target.value)}>
                    {set.variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </Field>
                <Field label="Player" htmlFor="pv-player">
                  <select id="pv-player" value={pp.id} onChange={(e) => setPreviewPlayer(e.target.value)}>
                    {pvPlayers.map((id) => <option key={id} value={id}>{playerName(game.players[id])}</option>)}
                  </select>
                </Field>
              </div>
            </>
          ) : (
            <p className="empty">Add players to the checklist to see a card.</p>
          )}
        </div>
        <div className="preview-panel">
          <h3>At a glance</h3>
          <dl className="kv">
            <div><dt>Unique cards</dt><dd>{fmtInt(summary.uniqueCards)}</dd></div>
            <div><dt>Printed copies</dt><dd>{fmtInt(summary.totalCopies)}</dd></div>
            <div><dt>Cost</dt><dd>{fmtMoney(summary.totalCost, { cents: false })}</dd></div>
            <div><dt>Cash on hand</dt><dd className={summary.totalCost > game.company.cash ? 'tone-bad' : ''}>{fmtMoney(game.company.cash, { cents: false })}</dd></div>
          </dl>
        </div>
      </aside>
    </div>
  );
}

function nextName(set: CardSet, base: string) {
  let n = 1;
  while (set.variants.some((v) => v.name === `${base} ${n}`)) n++;
  return `${base} ${n}`;
}

function DeleteSet({ ctx, set, onDone }: { ctx: Ctx; set: CardSet; onDone: () => void }) {
  const [confirm, setConfirm] = useState(false);
  if (!confirm) return <button className="btn btn-ghost" onClick={() => setConfirm(true)}>Delete draft</button>;
  return (
    <span className="confirm">
      Delete {set.name}?
      <button className="btn btn-danger btn-sm" onClick={() => { if (ctx.act((g) => deleteSet(g, set.id), 'Draft deleted')) onDone(); }}>Delete</button>
      <button className="btn btn-ghost btn-sm" onClick={() => setConfirm(false)}>Keep</button>
    </span>
  );
}

function BaseChecklist({ ctx, set, locked }: { ctx: Ctx; set: CardSet; locked: boolean }) {
  const { game, act } = ctx;
  const base = set.variants[0];
  const [q, setQ] = useState('');
  const [team, setTeam] = useState('');
  const [pos, setPos] = useState('');
  const [onlyChecked, setOnlyChecked] = useState(false);
  const edit = (fn: (s: CardSet) => void) => act((g) => updateSet(g, set.id, fn));
  const inList = useMemo(() => new Set(set.checklist), [set.checklist]);
  const all = useMemo(() => Object.values(game.players).sort((a, b) => b.popularity - a.popularity), [game.players]);
  const shown = all.filter((p) =>
    (!q || playerName(p).toLowerCase().includes(q.toLowerCase())) && (!team || p.teamId === team) && (!pos || p.pos === pos) && (!onlyChecked || inList.has(p.id)),
  );
  const toggle = (id: string) =>
    edit((s) => {
      if (s.checklist.includes(id)) {
        s.checklist = s.checklist.filter((x) => x !== id);
        for (const v of s.variants) v.playerIds = v.playerIds.filter((x) => x !== id);
      } else s.checklist.push(id);
      s.variants[0].playerIds = [...s.checklist];
    });
  const setList = (ids: string[]) =>
    edit((s) => {
      s.checklist = ids;
      s.variants[0].playerIds = [...ids];
      const keep = new Set(ids);
      for (const v of s.variants.slice(1)) v.playerIds = v.playerIds.filter((x) => keep.has(x));
    });
  const active = all.filter((p) => p.status !== 'retired');
  return (
    <Section title="Base checklist" aside={<span className="muted">{fmtInt(set.checklist.length)} unique cards × {fmtInt(base.printRun)} copies = {fmtInt(set.checklist.length * base.printRun)} printed</span>}>
      <div className="grid-3">
        <Field label="Copies printed of each base card" htmlFor={`base-run-${set.id}`} hint="Unique cards are the players on the checklist. This is how many of each one you print.">
          <NumInput id={`base-run-${set.id}`} value={base.printRun} min={1} max={20000} disabled={locked} onChange={(n) => edit((s) => { s.variants[0].printRun = n; })} />
        </Field>
        <Field label="Base finish" htmlFor={`base-finish-${set.id}`} hint={`${fmtMoney(unitCost(base, undefined))} per card`}>
          <select id={`base-finish-${set.id}`} value={base.finish} disabled={locked} onChange={(e) => edit((s) => { s.variants[0].finish = e.target.value as Finish; })}>
            {FINISHES.map((f) => <option key={f} value={f}>{FINISH_LABEL[f]}</option>)}
          </select>
        </Field>
        <Field label="Quick fill">
          <div className="row gap-s wrap">
            {[25, 50, 100].map((n) => (
              <button key={n} className="btn btn-sm" disabled={locked} onClick={() => setList(active.slice(0, n).map((p) => p.id))}>Top {n}</button>
            ))}
            <button className="btn btn-sm" disabled={locked} onClick={() => setList([...set.checklist, ...active.filter((p) => p.rookieYear >= set.year && !inList.has(p.id)).map((p) => p.id)])}>Add rookies</button>
            <button className="btn btn-sm btn-ghost" disabled={locked} onClick={() => setList([])}>Clear</button>
          </div>
        </Field>
      </div>
      <div className="filters">
        <input aria-label="Search players" placeholder="Search players" value={q} onChange={(e) => setQ(e.target.value)} id={`ck-q-${set.id}`} />
        <select aria-label="Team" value={team} onChange={(e) => setTeam(e.target.value)} id={`ck-team-${set.id}`}>
          <option value="">All teams</option>
          {game.teams.map((t) => <option key={t.id} value={t.id}>{t.city} {t.name}</option>)}
        </select>
        <select aria-label="Position" value={pos} onChange={(e) => setPos(e.target.value)} id={`ck-pos-${set.id}`}>
          <option value="">All positions</option>
          {['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'CB', 'S', 'K'].map((p) => <option key={p}>{p}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={onlyChecked} onChange={(e) => setOnlyChecked(e.target.checked)} id={`ck-only-${set.id}`} /> On checklist only</label>
      </div>
      <div className="table-wrap table-scroll">
        <table className="table table-compact">
          <thead>
            <tr><th aria-label="On checklist" /><th className="num">#</th><th>Player</th><th>Team</th><th>Pos</th><th className="num">Popularity</th><th className="num">Form</th><th>Status</th><th className="num">Appeal</th></tr>
          </thead>
          <tbody>
            {shown.slice(0, 200).map((p) => {
              const t = game.teams.find((x) => x.id === p.teamId)!;
              const no = set.checklist.indexOf(p.id) + 1;
              return (
                <tr key={p.id} className={no ? 'is-checked' : ''}>
                  <td><input type="checkbox" aria-label={`Include ${playerName(p)}`} checked={!!no} disabled={locked} onChange={() => toggle(p.id)} /></td>
                  <td className="num muted">{no || ''}</td>
                  <td>{playerName(p)} {p.rookieYear >= set.year && <Pill tone="gold">RC</Pill>}</td>
                  <td><span className="team-chip" style={{ background: t.primary, color: t.secondary }}>{t.abbr}</span></td>
                  <td>{p.pos}</td>
                  <td className="num">{p.popularity.toFixed(0)}</td>
                  <td className="num">{p.form.toFixed(0)}</td>
                  <td>{p.status === 'active' ? <span className="muted">Active</span> : p.status === 'injured' ? <Pill tone="bad">Injured {p.injuryWeeks}w</Pill> : <Pill>Retired</Pill>}</td>
                  <td className="num">{playerAppeal(p, set.year).toFixed(0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length > 200 && <p className="muted small">Showing 200 of {shown.length}. Narrow the filters to see more.</p>}
      </div>
    </Section>
  );
}

function VariantEditor({ ctx, set, v, locked, onPreview }: { ctx: Ctx; set: CardSet; v: Variant; locked: boolean; onPreview: () => void }) {
  const { game, act } = ctx;
  const [picking, setPicking] = useState(false);
  const edit = (fn: (x: Variant, s: CardSet) => void) => act((g) => updateSet(g, set.id, (s) => fn(s.variants.find((x) => x.id === v.id)!, s)));
  const cost = v.playerIds.reduce((t, id) => t + unitCost(v, game.players[id]) * v.printRun, 0);
  const sameAsBase = v.playerIds.length === set.checklist.length;
  const ranked = [...set.checklist].sort((a, b) => game.players[b].popularity - game.players[a].popularity);
  const outsideChecklist = v.playerIds.filter((id) => !set.checklist.includes(id)).length;
  return (
    <article className="variant">
      <header className="variant-head">
        <span className="swatch swatch-lg" style={{ background: v.color }} />
        <input className="variant-name" aria-label="Version name" id={`vn-${v.id}`} value={v.name} disabled={locked} onChange={(e) => edit((x) => { x.name = e.target.value; })} maxLength={32} />
        {v.autographed ? <Pill tone="accent">Autograph</Pill> : <Pill>Parallel</Pill>}
        <button className="btn btn-ghost btn-sm" onClick={onPreview}>Preview</button>
        {!locked && <button className="btn btn-ghost btn-sm" onClick={() => edit((_x, s) => { s.variants = s.variants.filter((y) => y.id !== v.id); })}>Remove</button>}
      </header>
      <div className="variant-body">
        <Field label="Colour" htmlFor={`vc-${v.id}`}>
          <input type="color" id={`vc-${v.id}`} value={v.color} disabled={locked} onChange={(e) => edit((x) => { x.color = e.target.value; })} />
        </Field>
        <Field label="Finish" htmlFor={`vf-${v.id}`}>
          <select id={`vf-${v.id}`} value={v.finish} disabled={locked} onChange={(e) => edit((x) => { x.finish = e.target.value as Finish; })}>
            {FINISHES.map((f) => <option key={f} value={f}>{FINISH_LABEL[f]}</option>)}
          </select>
        </Field>
        <Field label={v.numbered ? 'Serial-numbered print run' : 'Copies of each card'} htmlFor={`vr-${v.id}`}>
          <div className="row gap-s wrap">
            <NumInput id={`vr-${v.id}`} value={v.printRun} min={1} max={v.numbered ? 9999 : 20000} disabled={locked} onChange={(n) => edit((x) => { x.printRun = n; })} width={6} />
            <label className="check"><input type="checkbox" id={`vnum-${v.id}`} checked={v.numbered} disabled={locked} onChange={(e) => edit((x) => { x.numbered = e.target.checked; if (x.numbered && x.printRun > 9999) x.printRun = 999; })} /> Serial numbered</label>
          </div>
          {v.numbered && (
            <div className="chips" role="group" aria-label="Print run presets">
              {PRINT_PRESETS.map((n) => (
                <button key={n} className={`chip ${v.printRun === n ? 'is-active' : ''}`} disabled={locked} onClick={() => edit((x) => { x.printRun = n; })}>{n === 1 ? '1/1' : `/${n}`}</button>
              ))}
            </div>
          )}
        </Field>
      </div>
      <div className="variant-players">
        <div className="row gap-s wrap">
          <strong>{v.playerIds.length} players receive it</strong>
          <span className="muted">· {fmtInt(v.playerIds.length)} unique × {fmtInt(v.printRun)} = {fmtInt(v.playerIds.length * v.printRun)} cards · {fmtMoney(cost, { cents: false })}</span>
          {v.autographed && v.playerIds.length > 0 && <span className="muted">· signing fees {fmtMoney(Math.min(...v.playerIds.map((id) => signingFee(game.players[id]))))}–{fmtMoney(Math.max(...v.playerIds.map((id) => signingFee(game.players[id]))))} per card</span>}
        </div>
        {!locked && (
          <div className="row gap-s wrap">
            <button className={`chip ${sameAsBase ? 'is-active' : ''}`} onClick={() => edit((x, s) => { x.playerIds = [...s.checklist]; })}>Whole checklist</button>
            {[5, 10, 25, 50].filter((n) => n < set.checklist.length).map((n) => (
              <button key={n} className="chip" onClick={() => edit((x) => { x.playerIds = ranked.slice(0, n); })}>Top {n}</button>
            ))}
            <button className="chip" onClick={() => edit((x, s) => { x.playerIds = s.checklist.filter((id) => game.players[id].rookieYear >= s.year); })}>Rookies</button>
            <button className="chip" onClick={() => setPicking(!picking)}>{picking ? 'Done choosing' : 'Choose players…'}</button>
          </div>
        )}
        {outsideChecklist > 0 && <p className="muted small">{outsideChecklist} of these players are not on the base checklist.</p>}
        {picking && !locked && (
          <div className="picker">
            {ranked.map((id) => {
              const p = game.players[id];
              const on = v.playerIds.includes(id);
              return (
                <label key={id} className={`picker-item ${on ? 'is-on' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => edit((x) => { x.playerIds = on ? x.playerIds.filter((y) => y !== id) : [...x.playerIds, id]; })} />
                  {playerName(p)} <span className="muted">{p.pos} · {p.popularity.toFixed(0)}</span>
                </label>
              );
            })}
          </div>
        )}
        {!picking && v.playerIds.length > 0 && (
          <p className="name-list">{v.playerIds.slice(0, 14).map((id) => playerName(game.players[id])).join(', ')}{v.playerIds.length > 14 ? `, +${v.playerIds.length - 14} more` : ''}</p>
        )}
      </div>
    </article>
  );
}
