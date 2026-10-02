import React, { useMemo, useState } from 'react';
import { parseCardId } from '../sim/catalog';
import { estimate, boxExpectedValue } from '../sim/market';
import { cardSupply, unopenedBoxes } from '../sim/inventory';
import { playerName, weekLabel } from '../sim/league';
import { fmtInt, fmtMoney, fmtPct } from '../sim/format';
import { describeCard } from '../sim/game';
import { ConfidenceDot, Pill, PriceTag, Section, Stat, Trend, type Ctx } from './common';
import { Sparkline } from './Charts';

type Sort = 'value' | 'volume' | 'trend' | 'supply';

export function Market({ ctx }: { ctx: Ctx }) {
  const { game, openCard } = ctx;
  const [q, setQ] = useState('');
  const [setF, setSetF] = useState('');
  const [kind, setKind] = useState('');
  const [sort, setSort] = useState<Sort>('value');
  const rows = useMemo(() => {
    return Object.entries(game.cards).map(([id, m]) => {
      const { setId, variantId, playerId } = parseCardId(id);
      const set = game.sets.find((s) => s.id === setId)!;
      const v = set.variants.find((x) => x.id === variantId)!;
      const p = game.players[playerId];
      const est = estimate(m, game.week);
      const vol4 = m.sales.filter((s) => s.w > game.week - 4).length;
      const past = [...m.hist].reverse().find((h) => h.w <= game.week - 4 && h.est !== null)?.est ?? null;
      const sup = cardSupply(game, id);
      return { id, set, v, p, m, est, vol4, past, sup };
    });
  }, [game]);
  const filtered = rows
    .filter((r) => (!q || playerName(r.p).toLowerCase().includes(q.toLowerCase())) && (!setF || r.set.id === setF) && (!kind || (kind === 'base' ? r.v.kind === 'base' : kind === 'auto' ? r.v.autographed : r.v.numbered && !r.v.autographed)))
    .sort((a, b) => {
      if (sort === 'volume') return b.vol4 - a.vol4;
      if (sort === 'supply') return a.sup.pulled - b.sup.pulled;
      if (sort === 'trend') return ((b.est.value ?? 0) / (b.past ?? b.est.value ?? 1)) - ((a.est.value ?? 0) / (a.past ?? a.est.value ?? 1));
      return (b.est.value ?? -1) - (a.est.value ?? -1);
    });
  const last = game.reports[game.reports.length - 1];
  const released = game.products.filter((p) => p.inv && game.sets.find((s) => s.id === p.setId)!.status === 'released');

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Collector market · {weekLabel(game.week)}</p>
          <h1>The secondary market</h1>
        </div>
      </header>
      <p className="lede">Collectors trade the cards they pull. These sales do not pay you, but they set what your boxes are worth to the next buyer and shape your reputation.</p>
      <div className="stat-row">
        <Stat label="Sales last week" value={last ? fmtInt(last.secondaryCount) : '—'} />
        <Stat label="Traded value last week" value={last ? fmtMoney(last.secondaryValue, { cents: false }) : '—'} />
        <Stat label="Cards in circulation" value={fmtInt(rows.reduce((t, r) => t + r.sup.pulled, 0))} sub={`${fmtInt(rows.length)} different cards`} />
        <Stat label="Collector fatigue" value={fmtPct(game.market.fatigue)} tone={game.market.fatigue > 0.5 ? 'bad' : undefined} sub={game.market.fatigue > 0.5 ? 'Too many releases lately' : 'Collectors are keen'} />
      </div>

      <Section title="Sealed boxes">
        {released.length === 0 ? <p className="empty">No products on the market yet.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Product</th><th className="num">Price</th><th className="num">Value per box</th><th className="num">Value for money</th><th className="num">Sentiment</th><th className="num">Unopened</th><th>Biggest card still sealed</th></tr>
              </thead>
              <tbody>
                {released.map((p) => {
                  const set = game.sets.find((s) => s.id === p.setId)!;
                  const { ev, chase } = boxExpectedValue(game, p);
                  const un = unopenedBoxes(p);
                  return (
                    <tr key={p.id}>
                      <td>{set.year} {set.name} · {p.name}</td>
                      <td className="num">{fmtMoney(p.price)}</td>
                      <td className="num">{un ? fmtMoney(ev) : '—'}</td>
                      <td className="num">{un ? <span className={ev / p.price >= 0.8 ? 'tone-good' : ev / p.price < 0.5 ? 'tone-bad' : ''}>{fmtPct(ev / p.price)}</span> : '—'}</td>
                      <td className="num">{p.sentiment.toFixed(0)}</td>
                      <td className="num">{fmtInt(un)}</td>
                      <td>{chase[0] && un ? <button className="link" onClick={() => openCard(chase[0].id)}>{describeCard(game, chase[0].id)}</button> : <span className="muted">All opened</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Singles" aside={<span className="muted">{fmtInt(filtered.length)} cards</span>}>
        <div className="filters">
          <input id="mk-q" aria-label="Search player" placeholder="Search player" value={q} onChange={(e) => setQ(e.target.value)} />
          <select id="mk-set" aria-label="Set" value={setF} onChange={(e) => setSetF(e.target.value)}>
            <option value="">All sets</option>
            {game.sets.filter((s) => s.status === 'released').map((s) => <option key={s.id} value={s.id}>{s.year} {s.name}</option>)}
          </select>
          <select id="mk-kind" aria-label="Version" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All versions</option>
            <option value="base">Base</option>
            <option value="numbered">Numbered parallels</option>
            <option value="auto">Autographs</option>
          </select>
          <select id="mk-sort" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="value">Sort: market value</option>
            <option value="volume">Sort: sales, last 4 weeks</option>
            <option value="trend">Sort: 4-week change</option>
            <option value="supply">Sort: fewest pulled</option>
          </select>
        </div>
        {rows.length === 0 ? <p className="empty">No cards have been pulled yet. Once a release ships and collectors open boxes, every pulled card appears here.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Card</th><th>Version</th><th className="num">Pulled / printed</th><th className="num">Market value</th><th className="num">Last sale</th><th className="num">Sales (4 wk)</th><th className="num">4-wk change</th><th>History</th></tr>
              </thead>
              <tbody>
                {filtered.slice(0, 150).map((r) => (
                  <tr key={r.id} className="row-link" onClick={() => openCard(r.id)}>
                    <td>
                      <button className="link" onClick={(e) => { e.stopPropagation(); openCard(r.id); }}>{playerName(r.p)}</button>
                      <span className="muted small"> {r.p.pos} · {r.set.year} {r.set.name}</span>
                      {r.p.rookieYear === r.set.year && <> <Pill tone="gold">RC</Pill></>}
                    </td>
                    <td><span className="swatch" style={{ background: r.v.kind === 'base' ? 'var(--card-base-frame)' : r.v.color }} /> {r.v.name}{r.v.numbered ? ` /${r.v.printRun}` : ''}</td>
                    <td className="num">{fmtInt(r.sup.pulled)} / {fmtInt(r.sup.printed)}</td>
                    <td className="num"><ConfidenceDot c={r.est.confidence} /> <PriceTag est={r.est} compact /></td>
                    <td className="num">{r.est.last ? <>{fmtMoney(r.est.last.p)}{r.est.last.s !== undefined && <span className="muted small"> #{r.est.last.s}</span>}<span className="muted small"> wk {r.est.last.w}</span></> : '—'}</td>
                    <td className="num">{r.vol4}</td>
                    <td className="num"><Trend now={r.est.value} then={r.past} /></td>
                    <td><Sparkline values={r.m.hist.filter((h) => h.est !== null).slice(-20).map((h) => h.est!)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 150 && <p className="muted small">Showing the first 150. Use the filters to narrow it down.</p>}
          </div>
        )}
        <p className="muted small legend-line">
          <ConfidenceDot c="high" /> 8+ sales in 10 weeks · <ConfidenceDot c="medium" /> 3–7 · <ConfidenceDot c="low" /> 1–2, shown as a range · cards with no sales show no price.
        </p>
      </Section>
    </div>
  );
}
