import React, { useState } from 'react';
import type { CardSet, Product } from '../sim/types';
import { productionSummary } from '../sim/catalog';
import { hasErrors, validateSet } from '../sim/product';
import { breakWarehouseBox, describeCard, manufacture, rescheduleRelease, type BoxBreak } from '../sim/game';
import { weekDate, weekLabel } from '../sim/league';
import { boxExpectedValue, fairValueById } from '../sim/market';
import { unopenedBoxes } from '../sim/inventory';
import { fmtInt, fmtMoney, fmtPct } from '../sim/format';
import { parseCardId } from '../sim/catalog';
import { Issues, MiniCard, Modal, NumInput, Pill, Section, Stat, type Ctx } from './common';
import { statusPill } from './SetCreator';

export function Production({ ctx }: { ctx: Ctx }) {
  const { game } = ctx;
  const [brk, setBrk] = useState<BoxBreak | null>(null);
  const drafts = game.sets.filter((s) => s.status === 'draft');
  const pending = game.sets.filter((s) => s.status === 'manufactured');
  const released = game.sets.filter((s) => s.status === 'released');
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Factory floor</p>
          <h1>Manufacturing &amp; release</h1>
        </div>
      </header>
      <Section title="Ready for the press">
        {drafts.length === 0 && <p className="empty">No draft sets. Create one in the Set Creator.</p>}
        <div className="stack">
          {drafts.map((s) => <DraftRow key={s.id} ctx={ctx} set={s} />)}
        </div>
      </Section>
      <Section title="Manufactured, awaiting release">
        {pending.length === 0 && <p className="empty">Nothing waiting. Manufactured sets ship on their release week.</p>}
        <div className="stack">
          {pending.map((s) => <PendingRow key={s.id} ctx={ctx} set={s} onBreak={setBrk} />)}
        </div>
      </Section>
      <Section title="On the market">
        {released.length === 0 && <p className="empty">Nothing released yet.</p>}
        <div className="stack">
          {[...released].reverse().map((s) => game.products.filter((p) => p.setId === s.id).map((p) => <ReleasedRow key={p.id} ctx={ctx} set={s} p={p} onBreak={setBrk} />))}
        </div>
      </Section>
      {brk && <BreakModal ctx={ctx} brk={brk} onClose={() => setBrk(null)} />}
    </div>
  );
}

function DraftRow({ ctx, set }: { ctx: Ctx; set: CardSet }) {
  const { game, act, go } = ctx;
  const issues = validateSet(game, set);
  const summary = productionSummary(game, set);
  const errors = issues.filter((i) => i.level === 'error');
  const short = summary.totalCost > game.company.cash;
  const blocked = hasErrors(issues) || short;
  const [confirm, setConfirm] = useState(false);
  return (
    <article className="prod-row">
      <div className="prod-row-head">
        <div>
          <h3>{set.year} {set.name} {statusPill(set)}</h3>
          <p className="muted">Releases {weekLabel(set.releaseWeek)} · {weekDate(set.releaseWeek)}</p>
        </div>
        <div className="row gap-s wrap">
          <button className="btn" onClick={() => go('sets', set.id)}>Edit set</button>
          <button className="btn" onClick={() => go('products', set.id)}>Edit boxes</button>
          {!confirm ? (
            <button className="btn btn-primary" disabled={blocked} onClick={() => setConfirm(true)} title={blocked ? 'Fix the problems listed below first' : undefined}>
              Manufacture for {fmtMoney(summary.totalCost, { cents: false })}
            </button>
          ) : (
            <span className="confirm">
              Lock the checklist and pay {fmtMoney(summary.totalCost, { cents: false })}?
              <button className="btn btn-primary btn-sm" onClick={() => act((g) => manufacture(g, set.id), `${set.name} manufactured`) && setConfirm(false)}>Manufacture</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirm(false)}>Cancel</button>
            </span>
          )}
        </div>
      </div>
      <div className="stat-row">
        <Stat label="Unique cards" value={fmtInt(summary.uniqueCards)} />
        <Stat label="Printed copies" value={fmtInt(summary.totalCopies)} />
        <Stat label="Boxes" value={fmtInt(summary.boxes)} />
        <Stat label="Cost" value={fmtMoney(summary.totalCost, { cents: false })} tone={short ? 'bad' : undefined} sub={short ? `You have ${fmtMoney(game.company.cash, { cents: false })}` : `Cash after: ${fmtMoney(game.company.cash - summary.totalCost, { cents: false })}`} />
        <Stat label="Revenue if sold out" value={fmtMoney(summary.projectedRevenue, { cents: false })} />
      </div>
      {errors.length > 0 ? <Issues issues={errors} /> : <Issues issues={issues.filter((i) => i.level === 'warn')} empty="All checks pass." />}
    </article>
  );
}

function PendingRow({ ctx, set, onBreak }: { ctx: Ctx; set: CardSet; onBreak: (b: BoxBreak) => void }) {
  const { game, act } = ctx;
  const products = game.products.filter((p) => p.setId === set.id);
  const weeks = set.releaseWeek - game.week;
  return (
    <article className="prod-row">
      <div className="prod-row-head">
        <div>
          <h3>{set.year} {set.name} {statusPill(set)}</h3>
          <p className="muted">Ships {weekLabel(set.releaseWeek)}, {weekDate(set.releaseWeek)} · in {weeks} week{weeks === 1 ? '' : 's'}</p>
        </div>
        <div className="row gap-s wrap">
          <label htmlFor={`rw-${set.id}`} className="muted">Move release to week</label>
          <NumInput id={`rw-${set.id}`} value={set.releaseWeek} min={game.week + 1} max={game.week + 104} onChange={(n) => act((g) => rescheduleRelease(g, set.id, n), `Release moved to week ${n}`)} width={5} />
        </div>
      </div>
      {products.map((p) => <InventoryLine key={p.id} ctx={ctx} p={p} onBreak={onBreak} />)}
    </article>
  );
}

function ReleasedRow({ ctx, set, p, onBreak }: { ctx: Ctx; set: CardSet; p: Product; onBreak: (b: BoxBreak) => void }) {
  const { game } = ctx;
  const { ev, chase } = boxExpectedValue(game, p);
  const last = p.weeks[p.weeks.length - 1];
  return (
    <article className="prod-row">
      <div className="prod-row-head">
        <div>
          <h3>{set.year} {set.name} · {p.name} {p.soldOutWeek ? <Pill tone="good">Sold out wk {p.soldOutWeek}</Pill> : <Pill tone="accent">Selling</Pill>}</h3>
          <p className="muted">Released {weekLabel(set.releaseWeek)} · {fmtMoney(p.price)} per box · revenue so far {fmtMoney(p.revenue, { cents: false })}</p>
        </div>
      </div>
      <InventoryLine ctx={ctx} p={p} onBreak={onBreak} />
      <div className="stat-row">
        <Stat label="Last week" value={last ? `${fmtInt(last.sold)} sold` : '—'} sub={last ? `${fmtInt(last.demand)} wanted · ${fmtInt(last.opened)} opened` : undefined} />
        <Stat label="Value per unopened box" value={unopenedBoxes(p) ? fmtMoney(ev) : '—'} sub={unopenedBoxes(p) ? `${fmtPct(ev / p.price)} of price` : 'All boxes opened'} tone={ev / p.price < 0.5 ? 'bad' : undefined} />
        <Stat label="Collector sentiment" value={`${p.sentiment.toFixed(0)}/100`} tone={p.sentiment >= 65 ? 'good' : p.sentiment < 40 ? 'bad' : undefined} sub={p.valueRatio !== undefined ? `Opened boxes return ${fmtPct(p.valueRatio)} of price` : 'No boxes opened yet'} />
      </div>
      {chase.length > 0 && unopenedBoxes(p) > 0 && (
        <p className="muted small">Still sealed: {chase.slice(0, 3).map((c, i) => <React.Fragment key={c.id}>{i > 0 && ', '}<button className="link" onClick={() => ctx.openCard(c.id)}>{describeCard(game, c.id)}</button></React.Fragment>)}</p>
      )}
    </article>
  );
}

function InventoryLine({ ctx, p, onBreak }: { ctx: Ctx; p: Product; onBreak: (b: BoxBreak) => void }) {
  const { act, toast } = ctx;
  const inv = p.inv!;
  const unopened = unopenedBoxes(p);
  const [confirm, setConfirm] = useState(false);
  const segs = [
    { label: 'In your warehouse', n: inv.warehouse, cls: 'seg-wh' },
    { label: 'Sold, still sealed', n: inv.collectorSealed, cls: 'seg-sealed' },
    { label: 'Opened', n: inv.opened, cls: 'seg-open' },
  ];
  return (
    <div className="inventory">
      <div className="inv-bar" role="img" aria-label={segs.map((s) => `${s.label} ${s.n}`).join(', ')}>
        {segs.map((s) => s.n > 0 && <span key={s.cls} className={s.cls} style={{ flexGrow: s.n }} />)}
      </div>
      <div className="inv-legend">
        <strong>{p.name}</strong>
        {segs.map((s) => <span key={s.cls}><i className={`dot ${s.cls}`} /> {s.label} <b>{fmtInt(s.n)}</b></span>)}
        <span className="muted">of {fmtInt(p.boxes)} boxes · {fmtInt(unopened)} unopened anywhere</span>
        {inv.warehouse > 0 && (!confirm ? (
          <button className="btn btn-sm" onClick={() => setConfirm(true)}>Break a box</button>
        ) : (
          <span className="confirm">
            Open one of your own boxes? It won't be sold.
            <button className="btn btn-sm btn-primary" onClick={() => {
              let res: BoxBreak | null = null;
              const ok = act((g) => {
                const r = breakWarehouseBox(g, p.id);
                res = r.result;
                return r.state;
              });
              setConfirm(false);
              if (ok && res) onBreak(res);
              else if (!ok) toast('Could not open a box.', 'bad');
            }}>Open box</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setConfirm(false)}>Cancel</button>
          </span>
        ))}
      </div>
    </div>
  );
}

function BreakModal({ ctx, brk, onClose }: { ctx: Ctx; brk: BoxBreak; onClose: () => void }) {
  const { game } = ctx;
  const [opened, setOpened] = useState(0);
  const p = game.products.find((x) => x.id === brk.productId)!;
  const revealed = brk.packs.slice(0, opened).flat();
  const isHit = (id: string) => {
    const { setId, variantId } = parseCardId(id);
    return game.sets.find((s) => s.id === setId)!.variants.find((v) => v.id === variantId)!.kind !== 'base';
  };
  const hits = revealed.filter((x) => isHit(x.cardId));
  const value = revealed.reduce((t, x) => t + fairValueById(game, x.cardId), 0);
  return (
    <Modal title={`Box break · ${p.name}`} onClose={onClose} wide>
      <div className="break-head">
        <p>
          Pack {Math.min(opened, brk.packs.length)} of {brk.packs.length} · {hits.length} hit{hits.length === 1 ? '' : 's'} · cards worth about {fmtMoney(value)} so far (box price {fmtMoney(p.price)}).
        </p>
        <div className="row gap-s">
          <button className="btn btn-primary" disabled={opened >= brk.packs.length} onClick={() => setOpened(opened + 1)}>Rip next pack</button>
          <button className="btn" disabled={opened >= brk.packs.length} onClick={() => setOpened(brk.packs.length)}>Open all</button>
        </div>
      </div>
      <div className="break-grid">
        {brk.packs.slice(0, opened).map((pack, i) => (
          <div key={i} className="break-pack">
            <h4>Pack {i + 1}</h4>
            <div className="break-cards">
              {pack.map((x, j) => (
                <button key={j} className={`break-card ${isHit(x.cardId) ? 'is-hit' : ''}`} onClick={() => ctx.openCard(x.cardId)} title={describeCard(game, x.cardId, x.serial)}>
                  <MiniCard game={game} id={x.cardId} serial={x.serial} size="sm" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {opened === 0 && <p className="empty">Rip the first pack to see what's inside.</p>}
    </Modal>
  );
}
