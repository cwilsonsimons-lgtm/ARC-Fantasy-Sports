import React, { useMemo, useState } from 'react';
import { buyers } from '../core/trade';
import { windowLabel } from '../core/model';
import { POSITIONS } from '../core/types';
import { Asset, Delta, fmt, pct, Trend, useApp, who } from './common';

type SortKey = 'market' | 'mine' | 'buyer' | 'edge';

export function MyTeam() {
  const { v, openAsset, openLab } = useApp();
  const me = v.me;
  const c = v.ctx[me];
  const rows = useMemo(() => buyers(v), [v]);
  const [sort, setSort] = useState<SortKey>('market');
  const [kind, setKind] = useState<'players' | 'picks'>('players');

  const list = rows
    .filter((r) => (kind === 'picks') === !v.league.players[r.id])
    .sort((a, b) => {
      if (sort === 'mine') return b.mine - a.mine;
      if (sort === 'buyer') return b.best[0].value - a.best[0].value;
      if (sort === 'edge') return b.best[0].value / (b.mine || 1) - a.best[0].value / (a.mine || 1);
      return b.market - a.market;
    });

  // Where someone pays more than I'd keep him for: the sell-high list.
  const sellHigh = rows
    .filter((r) => r.mine > 1500 && r.best[0].value > r.mine * 1.06)
    .sort((a, b) => b.best[0].value / b.mine - a.best[0].value / a.mine)
    .slice(0, 3);

  const t = c.team;
  const th = (k: SortKey, label: string, cls = 'r') => (
    <th className={cls} aria-sort={sort === k ? 'descending' : undefined}>
      <button onClick={() => setSort(k)}>
        {label}
        {sort === k ? ' ↓' : ''}
      </button>
    </th>
  );

  return (
    <>
      <section className="panel">
        <div className="strip">
          <div>
            <div className="teamname">{t.name}</div>
            <div className="chips">
              <span className="chip">
                {t.wins}-{t.losses} · {ordinal(t.standing)}
              </span>
              <span className="chip win">{windowLabel(c.window)}</span>
              <span className="chip num">{fmt(rows.reduce((s, r) => s + r.market, 0))} total</span>
            </div>
          </div>
          <div>
            <div className="bar-l" style={{ marginBottom: 8 }}>
              <span>Starting strength vs league average</span>
              <span className="faint">tick = average</span>
            </div>
            <div className="bars">
              {POSITIONS.map((p) => {
                const r = c.ratio[p];
                return (
                  <div key={p}>
                    <div className="bar-l">
                      <b style={{ color: 'var(--ink)' }}>{p}</b>
                      <span className={'num ' + (r >= 1 ? 'up' : 'down')}>{pct(r - 1)}</span>
                    </div>
                    <div className="bar-t">
                      <div className="bar-f" style={{ width: `${Math.min(100, r * 50)}%`, background: `var(--pos-${p.toLowerCase()})` }} />
                      <div className="bar-avg" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {sellHigh.length > 0 && (
        <section className="panel">
          <div className="panel-h">
            <h2>Sell-high spots</h2>
            <span className="sub">Teams that value your players above what they're worth to you</span>
          </div>
          <div>
            {sellHigh.map((r) => (
              <div key={r.id} className="sell" onClick={() => openAsset(r.id)}>
                <Asset id={r.id} />
                <div className="sell-to">
                  <div style={{ fontSize: 13 }}>
                    {who(v, r.best[0].team)} <Delta value={r.best[0].value} base={r.mine} />
                  </div>
                  <div className="who-s">
                    <span className="num">{fmt(r.best[0].value)}</span> to them vs <span className="num">{fmt(r.mine)}</span> to you
                  </div>
                </div>
                <button
                  className="btn small"
                  onClick={(e) => {
                    e.stopPropagation();
                    openLab({ team: r.best[0].team, send: [r.id], receive: [] });
                  }}
                >
                  Shop him
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-h">
          <h2>Your roster</h2>
          <span className="sub">Tap anyone for every team's view and the value history</span>
          <div className="right">
            <div className="seg" role="group" aria-label="Show">
              <button aria-pressed={kind === 'players'} onClick={() => setKind('players')}>
                Players
              </button>
              <button aria-pressed={kind === 'picks'} onClick={() => setKind('picks')}>
                Picks
              </button>
            </div>
          </div>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>{kind === 'players' ? 'Player' : 'Pick'}</th>
                <th className="hide-sm">Form</th>
                {th('market', 'Market')}
                {th('mine', 'To you')}
                {th('buyer', 'Top buyer', 'r hide-sm')}
                {th('edge', 'Premium')}
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} onClick={() => openAsset(r.id)}>
                  <td>
                    <Asset id={r.id} />
                  </td>
                  <td className="hide-sm">
                    <Trend id={r.id} />
                  </td>
                  <td className="r num">{fmt(r.market)}</td>
                  <td className="r num">{fmt(r.mine)}</td>
                  <td className="r hide-sm">
                    <div style={{ fontSize: 12 }}>{who(v, r.best[0].team, true)}</div>
                    <div className="who-s num">{fmt(r.best[0].value)}</div>
                  </td>
                  <td className="r">
                    <Delta value={r.best[0].value} base={r.mine} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export const ordinal = (n: number) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th');
