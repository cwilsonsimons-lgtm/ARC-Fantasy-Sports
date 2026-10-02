import React from 'react';
import { validateSet } from '../sim/product';
import { productionSummary } from '../sim/catalog';
import { estimate, boxExpectedValue } from '../sim/market';
import { unopenedBoxes } from '../sim/inventory';
import { weekDate, weekLabel } from '../sim/league';
import { fmtCompact, fmtInt, fmtMoney, fmtPct } from '../sim/format';
import { describeCard } from '../sim/game';
import { LineChart } from './Charts';
import { PriceTag, Section, Stat, type Ctx } from './common';
import { NewsFeed, totals } from './NewsFinance';
import { statusPill } from './SetCreator';

function nextStep(ctx: Ctx): { title: string; body: string; action?: { label: string; run: () => void } } {
  const { game, go } = ctx;
  const draft = game.sets.find((s) => s.status === 'draft');
  const pending = game.sets.filter((s) => s.status === 'manufactured').sort((a, b) => a.releaseWeek - b.releaseWeek)[0];
  if (draft) {
    const issues = validateSet(game, draft);
    const errors = issues.filter((i) => i.level === 'error');
    const cost = productionSummary(game, draft).totalCost;
    if (errors.length) return { title: `Finish ${draft.name}`, body: `${errors.length} problem${errors.length > 1 ? 's' : ''} to fix before it can be printed. First: ${errors[0].msg}`, action: { label: errors[0].productId ? 'Open box builder' : 'Open set creator', run: () => go(errors[0].productId ? 'products' : 'sets', draft.id) } };
    if (cost > game.company.cash) return { title: `${draft.name} costs more than you have`, body: `Printing costs ${fmtMoney(cost, { cents: false })}. Trim autographs or print runs, or wait for box sales.`, action: { label: 'Open set creator', run: () => go('sets', draft.id) } };
    return { title: `Manufacture ${draft.name}`, body: `It passes every check and costs ${fmtMoney(cost, { cents: false })}. Manufacturing locks the checklist and print runs.`, action: { label: 'Go to manufacturing', run: () => go('production') } };
  }
  if (pending) {
    const n = pending.releaseWeek - game.week;
    return { title: `${pending.name} ships in ${n} week${n > 1 ? 's' : ''}`, body: `Advance the week to reach ${weekLabel(pending.releaseWeek)}. Meanwhile you can start planning the next set.`, action: { label: 'Plan the next set', run: () => go('sets') } };
  }
  if (game.sets.some((s) => s.status === 'released')) return { title: 'Plan the next release', body: 'Watch which players are rising, check what collectors paid for your last hits, and design a set around the demand.', action: { label: 'New set', run: () => go('sets') } };
  return { title: 'Create your first set', body: 'Pick a checklist, add parallels and autographs, and design a box.', action: { label: 'Open set creator', run: () => go('sets') } };
}

export function Dashboard({ ctx }: { ctx: Ctx }) {
  const { game, go, openCard } = ctx;
  const t = totals(game);
  const last = game.reports[game.reports.length - 1];
  const prev = game.reports[game.reports.length - 2];
  const step = nextStep(ctx);
  const live = game.products.filter((p) => p.inv && game.sets.find((s) => s.id === p.setId)!.status === 'released');
  const upcoming = game.sets.filter((s) => s.status !== 'released').sort((a, b) => a.releaseWeek - b.releaseWeek);
  const topCards = Object.entries(game.cards)
    .map(([id, m]) => ({ id, est: estimate(m, game.week) }))
    .filter((x) => x.est.value !== null)
    .sort((a, b) => b.est.value! - a.est.value!)
    .slice(0, 6);
  const warehouse = game.products.reduce((s, p) => s + (p.inv?.warehouse ?? 0), 0);
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">{weekLabel(game.week)} · {weekDate(game.week)}</p>
          <h1>{game.company.name}</h1>
        </div>
      </header>
      <div className="stat-row">
        <Stat label="Cash" value={fmtMoney(game.company.cash, { cents: false })} tone={game.company.cash < 0 ? 'bad' : undefined} sub={last ? `${fmtMoney(last.revenue - last.expenses, { cents: false, sign: true })} last week` : 'Starting capital'} />
        <Stat label="Profit to date" value={fmtMoney(t.profit, { cents: false, sign: true })} tone={t.profit >= 0 ? 'good' : 'bad'} sub={`${fmtMoney(t.revenue, { cents: false })} revenue`} />
        <Stat label="Reputation" value={`${game.company.reputation.toFixed(1)}`} sub={prev && last ? `${last.reputation >= prev.reputation ? '▲' : '▼'} ${Math.abs(last.reputation - prev.reputation).toFixed(1)} last week` : 'out of 100'} />
        <Stat label="Collector fatigue" value={fmtPct(game.market.fatigue)} tone={game.market.fatigue > 0.5 ? 'bad' : undefined} sub={game.market.fatigue > 0.5 ? 'Space out releases' : 'Healthy appetite'} />
        <Stat label="Sealed boxes in stock" value={fmtInt(warehouse)} />
      </div>

      <section className="next-step">
        <div>
          <p className="eyebrow">Next step</p>
          <h2>{step.title}</h2>
          <p>{step.body}</p>
        </div>
        {step.action && <button className="btn btn-primary" onClick={step.action.run}>{step.action.label}</button>}
      </section>

      <div className="two-col">
        <div className="stack">
          <Section title="Products on the market" aside={<button className="link" onClick={() => go('production')}>Manufacturing</button>}>
            {live.length === 0 ? <p className="empty">Nothing on shelves yet.</p> : (
              <ul className="product-list">
                {live.map((p) => {
                  const set = game.sets.find((s) => s.id === p.setId)!;
                  const { ev } = boxExpectedValue(game, p);
                  const lastW = p.weeks[p.weeks.length - 1];
                  return (
                    <li key={p.id}>
                      <div>
                        <strong>{set.name} · {p.name}</strong>
                        <span className="muted small"> {fmtMoney(p.price)} · sentiment {p.sentiment.toFixed(0)}</span>
                      </div>
                      <div className="product-list-nums">
                        <span>{fmtInt(p.inv!.sold)}/{fmtInt(p.boxes)} sold</span>
                        <span className="muted">{lastW ? `${fmtInt(lastW.sold)} last wk` : ''}</span>
                        <span className="muted">{unopenedBoxes(p) ? `box value ${fmtMoney(ev)}` : 'all opened'}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
          <Section title="Pipeline" aside={<button className="link" onClick={() => go('sets')}>Set creator</button>}>
            {upcoming.length === 0 ? <p className="empty">No sets in the works.</p> : (
              <ul className="product-list">
                {upcoming.map((s) => (
                  <li key={s.id}>
                    <div><strong>{s.year} {s.name}</strong> {statusPill(s)}</div>
                    <div className="product-list-nums"><span>Week {s.releaseWeek}</span><span className="muted">{s.releaseWeek - game.week} weeks out</span></div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Most valuable cards" aside={<button className="link" onClick={() => go('market')}>Market</button>}>
            {topCards.length === 0 ? <p className="empty">No cards have traded yet.</p> : (
              <ul className="link-list">
                {topCards.map((c) => <li key={c.id}><button className="link" onClick={() => openCard(c.id)}>{describeCard(game, c.id)}</button> <PriceTag est={c.est} compact /></li>)}
              </ul>
            )}
          </Section>
        </div>
        <div className="stack">
          <Section title="Headlines" aside={<button className="link" onClick={() => go('news')}>All news</button>}>
            <NewsFeed ctx={ctx} limit={7} compact />
          </Section>
          <Section title="Cash by week">
            <LineChart label="Cash" points={game.reports.slice(-52).map((r) => ({ x: r.w, y: r.cash }))} fmtY={fmtCompact} fmtX={(n) => `Wk ${n}`} zeroBased height={170} />
          </Section>
        </div>
      </div>
    </div>
  );
}
