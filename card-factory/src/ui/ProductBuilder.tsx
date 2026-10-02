import React from 'react';
import type { CardSet, HitCategory, Product } from '../sim/types';
import { CATEGORY_LABEL, hitCategory, packagingCost, productionSummary, variantPlayers } from '../sim/catalog';
import { productOdds, productPlan, validateSet } from '../sim/product';
import { createProduct, updateProduct, updateSet } from '../sim/game';
import { boxExpectedValue, projectedBoxValue } from '../sim/market';
import { fmtInt, fmtMoney, fmtOdds, fmtPct } from '../sim/format';
import { Field, Issues, NumInput, Pill, Section, type Ctx } from './common';
import { SetList, statusPill } from './SetCreator';
import { describeCard } from '../sim/game';

export function ProductBuilder({ ctx, setId, onSelect }: { ctx: Ctx; setId?: string; onSelect: (id: string) => void }) {
  const { game, act } = ctx;
  const set = game.sets.find((s) => s.id === setId) ?? game.sets[game.sets.length - 1];
  if (!set) return <p className="empty">Create a set first.</p>;
  const products = game.products.filter((p) => p.setId === set.id);
  return (
    <div className="split">
      <SetList ctx={ctx} selected={set.id} onSelect={onSelect} />
      <div className="split-main">
        <header className="page-head">
          <div>
            <p className="eyebrow">{statusPill(set)} Box &amp; pack design</p>
            <h1>{set.year} {set.name}</h1>
          </div>
          {set.status === 'draft' && products.length === 0 && (
            <button className="btn btn-primary" onClick={() => act((g) => createProduct(g, set.id), 'Hobby box added')}>Add a hobby box</button>
          )}
        </header>
        {products.length === 0 && <p className="empty">This set has no box product yet. A box decides how the printed cards reach collectors: how many packs, how many cards, and which hits are guaranteed.</p>}
        {products.map((p) => <ProductEditor key={p.id} ctx={ctx} set={set} p={p} />)}
        {products.length > 0 && (
          <p className="muted small stage-note">Stage 1 ships one box product per set. Retail and premium boxes, product exclusives and split allocations arrive in Stage 2; the inventory engine already supports them.</p>
        )}
      </div>
    </div>
  );
}

function ProductEditor({ ctx, set, p }: { ctx: Ctx; set: CardSet; p: Product }) {
  const { game, act } = ctx;
  const locked = set.status !== 'draft';
  const edit = (fn: (x: Product, s: CardSet) => void) => act((g) => updateProduct(g, p.id, fn));
  const plan = productPlan(set, p);
  const odds = productOdds(set, p);
  const issues = validateSet(game, set).filter((i) => i.productId === p.id || (i.variantId && !i.productId));
  const cats = [...new Set(set.variants.map(hitCategory).filter((c): c is HitCategory => c !== null))];
  const summary = productionSummary(game, set);
  const ev = locked ? boxExpectedValue(game, p) : projectedBoxValue(game, p);
  const costPerBox = p.boxes ? summary.totalCost / p.boxes : 0;
  const ratio = ev.ev / p.price;
  const otherProducts = game.products.filter((x) => x.setId === set.id && x.id !== p.id);

  const fitBoxes = () =>
    edit((x, s) => {
      const pl = productPlan(s, x);
      let boxes = Math.floor(pl.total / pl.slotsPerBox);
      for (const g of pl.guaranteed) boxes = Math.min(boxes, Math.floor(g.copies / g.perBox));
      x.boxes = Math.max(1, boxes);
    });
  const fitBase = () =>
    act((g) => {
      const s = g.sets.find((y) => y.id === set.id)!;
      const pl = productPlan(s, p);
      const base = s.variants[0];
      const baseCopies = (p.alloc[base.id] ?? 0) * s.checklist.length;
      const need = pl.slots - (pl.total - baseCopies);
      const per = Math.max(1, Math.ceil(need / Math.max(1, s.checklist.length)));
      const g2 = updateSet(g, set.id, (ss) => { ss.variants[0].printRun = per; });
      return updateProduct(g2, p.id, (x) => { x.alloc[base.id] = per; });
    }, 'Base print run matched to the boxes');

  return (
    <div className="product">
      <Section title="Box configuration" aside={<span className="muted">{p.tier} product</span>}>
        <div className="grid-4">
          <Field label="Product name" htmlFor={`pn-${p.id}`}>
            <input id={`pn-${p.id}`} value={p.name} disabled={locked} maxLength={28} onChange={(e) => edit((x) => { x.name = e.target.value; })} />
          </Field>
          <Field label="Packs per box" htmlFor={`pp-${p.id}`}>
            <NumInput id={`pp-${p.id}`} value={p.packsPerBox} min={1} max={48} disabled={locked} onChange={(n) => edit((x) => { x.packsPerBox = n; })} />
          </Field>
          <Field label="Cards per pack" htmlFor={`pc-${p.id}`}>
            <NumInput id={`pc-${p.id}`} value={p.cardsPerPack} min={1} max={30} disabled={locked} onChange={(n) => edit((x) => { x.cardsPerPack = n; })} />
          </Field>
          <Field label="Boxes produced" htmlFor={`pb-${p.id}`} hint={!locked && <button className="link" onClick={fitBoxes}>Fit to allocated cards</button>}>
            <NumInput id={`pb-${p.id}`} value={p.boxes} min={1} max={100000} disabled={locked} onChange={(n) => edit((x) => { x.boxes = n; })} />
          </Field>
          <Field label="Box price" htmlFor={`pr-${p.id}`} hint="What collectors pay you per sealed box.">
            <NumInput id={`pr-${p.id}`} value={p.price} min={1} max={5000} step={0.01} prefix="$" disabled={locked} onChange={(n) => edit((x) => { x.price = n; })} />
          </Field>
          <Field label="Cards per box">
            <span className="readout">{plan.slotsPerBox}</span>
          </Field>
          <Field label="Card slots in all boxes">
            <span className="readout">{fmtInt(plan.slots)}</span>
          </Field>
          <Field label="Cards allocated" hint={!locked && plan.shortage > 0 ? <button className="link" onClick={fitBase}>Raise base copies to fill boxes</button> : undefined}>
            <span className={`readout ${plan.shortage ? 'tone-bad' : plan.excess ? 'tone-warn' : 'tone-good'}`}>{fmtInt(plan.total)}</span>
          </Field>
        </div>
      </Section>

      <Section title="Guaranteed hits per box">
        {cats.length === 0 && <p className="empty">Add a numbered parallel or autograph to the set to offer guaranteed hits.</p>}
        <div className="grid-4">
          {cats.map((c) => {
            const g = p.guarantees.find((x) => x.category === c)?.perBox ?? 0;
            const pc = plan.guaranteed.find((x) => x.category === c);
            const avail = set.variants.filter((v) => hitCategory(v) === c).reduce((t, v) => t + (p.alloc[v.id] ?? 0) * variantPlayers(set, v).length, 0);
            return (
              <Field key={c} label={CATEGORY_LABEL[c]} htmlFor={`g-${p.id}-${c}`} hint={`${fmtInt(avail)} allocated · ${g ? `${fmtInt(g * p.boxes)} needed` : `~${(avail / Math.max(1, p.boxes)).toFixed(2)} per box at random`}`}>
                <div className="row gap-s">
                  <NumInput id={`g-${p.id}-${c}`} value={g} min={0} max={plan.slotsPerBox} disabled={locked} width={4} onChange={(n) => edit((x) => {
                    x.guarantees = x.guarantees.filter((y) => y.category !== c);
                    if (n > 0) x.guarantees.push({ category: c, perBox: n });
                  })} />
                  <span className={pc && pc.copies < pc.need ? 'tone-bad' : 'muted'}>per box</span>
                </div>
              </Field>
            );
          })}
        </div>
      </Section>

      <Section title="Allocation of the print run" aside={!locked && <button className="btn btn-sm" onClick={() => edit((x, s) => { for (const v of s.variants) x.alloc[v.id] = v.printRun - otherProducts.reduce((t, o) => t + (o.alloc[v.id] ?? 0), 0); })}>Pack every printed copy</button>}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Version</th><th className="num">Unique cards</th><th className="num">Printed of each</th><th className="num">Packed in this box</th><th className="num">Left in vault</th><th className="num">Cards in product</th><th className="num">Per box</th><th className="num">Pack odds</th></tr>
            </thead>
            <tbody>
              {set.variants.map((v) => {
                const n = p.alloc[v.id] ?? 0;
                const elsewhere = otherProducts.reduce((t, o) => t + (o.alloc[v.id] ?? 0), 0);
                const row = odds.find((o) => o.variant.id === v.id);
                const g = row?.guaranteed;
                return (
                  <tr key={v.id}>
                    <td><span className="swatch" style={{ background: v.kind === 'base' ? 'var(--card-base-frame)' : v.color }} /> {v.name} {v.numbered && <Pill tone="gold">/{v.printRun}</Pill>}</td>
                    <td className="num">{variantPlayers(set, v).length}</td>
                    <td className="num">{fmtInt(v.printRun)}</td>
                    <td className="num">
                      <NumInput id={`al-${p.id}-${v.id}`} value={n} min={0} max={v.printRun} disabled={locked} width={6} onChange={(x) => edit((pp) => { pp.alloc[v.id] = x; })} />
                    </td>
                    <td className={`num ${v.printRun - n - elsewhere < 0 ? 'tone-bad' : ''}`}>{fmtInt(v.printRun - n - elsewhere)}</td>
                    <td className="num">{fmtInt(row?.copies ?? 0)}</td>
                    <td className="num">{row ? (g ? `${row.perBox.toFixed(2)} (${g} guaranteed)` : row.perBox.toFixed(2)) : '—'}</td>
                    <td className="num">{row ? fmtOdds(row.packOdds) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">Odds come straight from the allocation: pack odds = packs in the product ÷ copies packed. A /{set.variants.find((v) => v.numbered)?.printRun ?? 25} card exists exactly that many times, and each copy carries its own serial number.</p>
      </Section>

      <Section title="Box economics">
        <dl className="kv kv-cols">
          <div><dt>Manufacturing cost per box</dt><dd>{fmtMoney(costPerBox)}</dd></div>
          <div><dt>Packaging per box</dt><dd>{fmtMoney(packagingCost(p.packsPerBox))}</dd></div>
          <div><dt>Box price</dt><dd className="strong">{fmtMoney(p.price)}</dd></div>
          <div><dt>Margin per box</dt><dd className={p.price - costPerBox >= 0 ? 'tone-good' : 'tone-bad'}>{fmtMoney(p.price - costPerBox, { sign: true })}</dd></div>
          <div><dt>{locked ? 'Collector value per unopened box' : 'Projected collector value per box'}</dt><dd>{fmtMoney(ev.ev)}</dd></div>
          <div><dt>Value for money</dt><dd className={ratio >= 0.8 ? 'tone-good' : ratio >= 0.5 ? 'tone-warn' : 'tone-bad'}>{fmtPct(ratio)} of price</dd></div>
        </dl>
        <p className="muted small">Collectors compare the price with what a box is likely to hold. Below about 50% they start calling it a letdown; above 100% boxes fly off shelves. Value depends on player popularity far more than rarity, so these figures move as the season plays out.</p>
        {ev.chase.length > 0 && (
          <div className="chase">
            <h3>Top chase cards</h3>
            <ol>
              {ev.chase.map((c) => (
                <li key={c.id}><button className="link" onClick={() => ctx.openCard(c.id)}>{describeCard(game, c.id)}</button> <span className="muted">≈ {fmtMoney(c.value)}</span></li>
              ))}
            </ol>
          </div>
        )}
      </Section>

      <Section title="Validation">
        <Issues issues={issues} empty="This box is ready to manufacture." />
      </Section>
    </div>
  );
}
