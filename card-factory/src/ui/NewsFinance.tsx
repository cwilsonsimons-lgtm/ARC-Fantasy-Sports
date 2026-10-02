import React, { useState } from 'react';
import type { GameState, LedgerKind } from '../sim/types';
import { weekDate } from '../sim/league';
import { fmtCompact, fmtInt, fmtMoney } from '../sim/format';
import { STARTING_CASH } from '../sim/game';
import { BarChart, LineChart } from './Charts';
import { Section, Stat, type Ctx } from './common';

const KIND_LABEL: Record<LedgerKind, string> = { manufacturing: 'Printing & packaging', design: 'Design & licensing', 'box-sales': 'Sealed box sales', overhead: 'Overhead', storage: 'Storage' };

export function NewsFeed({ ctx, limit, compact }: { ctx: Ctx; limit?: number; compact?: boolean }) {
  const { game, openCard } = ctx;
  const [tone, setTone] = useState('');
  const items = [...game.news].reverse().filter((n) => !tone || n.tone === tone).slice(0, limit ?? 120);
  return (
    <div className="news">
      {!compact && (
        <div className="chips" role="group" aria-label="Filter news">
          {[['', 'All'], ['good', 'Good news'], ['bad', 'Problems'], ['neutral', 'Other']].map(([k, l]) => (
            <button key={k} className={`chip ${tone === k ? 'is-active' : ''}`} onClick={() => setTone(k)}>{l}</button>
          ))}
        </div>
      )}
      {items.length === 0 && <p className="empty">No headlines yet. Advance the week.</p>}
      <ol className="news-list">
        {items.map((n) => (
          <li key={n.id} className={`news-item tone-${n.tone}`}>
            <span className="news-week">Wk {n.w}</span>
            <div>
              <h4>{n.cardId ? <button className="link" onClick={() => openCard(n.cardId!)}>{n.title}</button> : n.title}</h4>
              {!compact && <p>{n.body}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function totals(game: GameState) {
  const by: Record<string, number> = {};
  for (const e of game.ledger) by[e.kind] = (by[e.kind] ?? 0) + e.amount;
  const revenue = by['box-sales'] ?? 0;
  const expenses = -Object.entries(by).filter(([k]) => k !== 'box-sales').reduce((t, [, v]) => t + v, 0);
  return { by, revenue, expenses, profit: revenue - expenses };
}

export function NewsFinance({ ctx }: { ctx: Ctx }) {
  const { game } = ctx;
  const t = totals(game);
  const reports = game.reports.slice(-52);
  const last = game.reports[game.reports.length - 1];
  const [page, setPage] = useState(0);
  const ledger = [...game.ledger].reverse();
  const per = 25;
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Week {game.week} · {weekDate(game.week)}</p>
          <h1>News &amp; financials</h1>
        </div>
      </header>
      <div className="two-col">
        <Section title="Headlines">
          <NewsFeed ctx={ctx} />
        </Section>
        <div className="stack">
          <Section title="Last week">
            {last ? (
              <div className="stat-row stat-row-2">
                <Stat label="Revenue" value={fmtMoney(last.revenue, { cents: false })} sub={`${fmtInt(last.boxesSold)} boxes sold`} />
                <Stat label="Expenses" value={fmtMoney(last.expenses, { cents: false })} />
                <Stat label="Profit" value={fmtMoney(last.revenue - last.expenses, { cents: false, sign: true })} tone={last.revenue - last.expenses >= 0 ? 'good' : 'bad'} />
                <Stat label="Secondary market" value={fmtMoney(last.secondaryValue, { cents: false })} sub={`${fmtInt(last.secondaryCount)} sales · not your revenue`} />
              </div>
            ) : <p className="empty">Advance a week to see results.</p>}
          </Section>
          <Section title="Since founding">
            <dl className="kv">
              <div><dt>Starting capital</dt><dd>{fmtMoney(STARTING_CASH, { cents: false })}</dd></div>
              {Object.entries(KIND_LABEL).map(([k, l]) => (
                <div key={k}><dt>{l}</dt><dd className={(t.by[k] ?? 0) >= 0 ? '' : 'tone-bad'}>{fmtMoney(t.by[k] ?? 0, { cents: false, sign: true })}</dd></div>
              ))}
              <div><dt>Net profit</dt><dd className={`strong ${t.profit >= 0 ? 'tone-good' : 'tone-bad'}`}>{fmtMoney(t.profit, { cents: false, sign: true })}</dd></div>
              <div><dt>Cash now</dt><dd className="strong">{fmtMoney(game.company.cash, { cents: false })}</dd></div>
            </dl>
          </Section>
          <Section title="Weekly profit">
            <BarChart label="Weekly profit" data={reports.map((r) => ({ x: r.w, y: r.revenue - r.expenses }))} fmtY={fmtCompact} fmtX={(n) => `${n}`} />
          </Section>
          <Section title="Cash">
            <LineChart label="Cash" points={reports.map((r) => ({ x: r.w, y: r.cash }))} fmtY={fmtCompact} fmtX={(n) => `Wk ${n}`} zeroBased />
          </Section>
        </div>
      </div>
      <Section title="Ledger" aside={<span className="muted">{fmtInt(game.ledger.length)} entries</span>}>
        <div className="table-wrap">
          <table className="table table-compact">
            <thead><tr><th>Week</th><th>Category</th><th>Detail</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {ledger.slice(page * per, page * per + per).map((e, i) => (
                <tr key={i}><td>{e.w}</td><td>{KIND_LABEL[e.kind]}</td><td>{e.memo}</td><td className={`num ${e.amount < 0 ? 'tone-bad' : 'tone-good'}`}>{fmtMoney(e.amount, { sign: true })}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row gap-s pager">
          <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Newer</button>
          <span className="muted">Page {page + 1} of {Math.max(1, Math.ceil(ledger.length / per))}</span>
          <button className="btn btn-sm" disabled={(page + 1) * per >= ledger.length} onClick={() => setPage(page + 1)}>Older</button>
        </div>
      </Section>
    </div>
  );
}
