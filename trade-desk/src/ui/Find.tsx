import React, { useMemo, useState } from 'react';
import { findOffers } from '../core/trade';
import { Asset, Empty, fmt, fullName, signed, useApp, who } from './common';

export function Find() {
  const { v, openLab, openAsset } = useApp();
  const [q, setQ] = useState('');
  const [target, setTarget] = useState<string | null>(null);
  const [minP, setMinP] = useState(0.6);
  const [picksOk, setPicksOk] = useState(true);

  const pool = useMemo(
    () =>
      Object.entries(v.league.owner)
        .filter(([, t]) => t !== v.me)
        .map(([id]) => id)
        .sort((a, b) => v.market(b) - v.market(a)),
    [v],
  );
  const matches = q ? pool.filter((id) => fullName(v, id).toLowerCase().includes(q.toLowerCase())).slice(0, 12) : pool.slice(0, 12);
  const team = target ? v.league.owner[target] : null;
  const keep = picksOk ? [] : Object.keys(v.league.picks);
  const offers = useMemo(() => (target && team ? findOffers(v, team, [target], { minP, keep, limit: 8 }) : []), [v, target, team, minP, picksOk]);

  return (
    <div className="cols">
      <section className="panel">
        <div className="panel-h">
          <h2>Who do you want?</h2>
          <span className="sub">Searches every roster but yours</span>
        </div>
        <div className="panel-b" style={{ paddingBottom: 0 }}>
          <input className="input" id="find-q" placeholder="Player or pick, e.g. Emmett" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search players and picks" />
        </div>
        <div className="tbl-wrap" style={{ marginTop: 10 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Target</th>
                <th className="hide-sm">Owner</th>
                <th className="r">Market</th>
                <th className="r">To owner</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((id) => (
                <tr key={id} onClick={() => setTarget(id)} aria-selected={target === id} style={target === id ? { background: 'var(--accent-soft)' } : undefined}>
                  <td>
                    <Asset id={id} />
                  </td>
                  <td className="hide-sm" style={{ fontSize: 12 }}>
                    {who(v, v.league.owner[id], true)}
                  </td>
                  <td className="r num">{fmt(v.market(id))}</td>
                  <td className="r num">{fmt(v.value(v.league.owner[id], id))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-h">
          <h2>{target ? `Offers for ${fullName(v, target)}` : 'Offers'}</h2>
          {target && <span className="sub">Packages {who(v, team!, true)} would likely take, cheapest for you first</span>}
        </div>
        {!target ? (
          <Empty title="Pick a target">
            <p className="note">Choose a player and the desk searches your roster for one-, two- and three-piece offers his owner would likely accept, leading with pieces they value more than you do.</p>
          </Empty>
        ) : (
          <>
            <div className="panel-b" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid var(--line-2)' }}>
              <label className="field" style={{ minWidth: 200 }}>
                <span>
                  At least <b className="num">{Math.round(minP * 100)}%</b> chance of a yes
                </span>
                <input id="find-minp" type="range" min={0.5} max={0.9} step={0.05} value={minP} onChange={(e) => setMinP(+e.target.value)} />
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                <input id="find-picks" type="checkbox" checked={picksOk} onChange={(e) => setPicksOk(e.target.checked)} /> Include my picks
              </label>
              <button className="btn small" onClick={() => openAsset(target)}>
                See his values
              </button>
            </div>
            {offers.length === 0 ? (
              <Empty title="Nothing clears the bar">
                <p className="note">No package of up to three of your pieces gets {who(v, team!, true)} there. Lower the bar, or he may simply not be for sale at a price you'd pay.</p>
              </Empty>
            ) : (
              <div>
                {offers.map((o, i) => (
                  <div key={i} className="log-row">
                    <div className="log-top">
                      <b className="num">{Math.round(o.them.p * 100)}% yes</b>
                      <span className="muted" style={{ fontSize: 12 }}>
                        Your net <span className={'num ' + (o.mine.edge >= 0 ? 'up' : 'down')}>{signed(o.mine.edge)}</span> · their net{' '}
                        <span className="num">{signed(o.them.edge)}</span>
                      </span>
                      <button className="btn small" style={{ marginLeft: 'auto' }} onClick={() => openLab({ team: team!, send: o.side.get, receive: [target] })}>
                        Open in lab
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      {o.side.get.map((id) => (
                        <div key={id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <Asset id={id} sub={false} />
                          <span className="faint num" style={{ fontSize: 11 }}>
                            {fmt(v.value(team!, id))} to them · {fmt(v.value(v.me, id))} to you
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
