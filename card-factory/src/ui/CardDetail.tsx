import React from 'react';
import { parseCardId } from '../sim/catalog';
import { estimate, playerAppeal } from '../sim/market';
import { cardSupply } from '../sim/inventory';
import { playerName } from '../sim/league';
import { fmtInt, fmtMoney } from '../sim/format';
import { describeCard } from '../sim/game';
import { CardView } from './CardView';
import { LineChart } from './Charts';
import { Modal, Pill, PriceTag, Stat, type Ctx } from './common';

export function CardDetail({ ctx, id, onClose }: { ctx: Ctx; id: string; onClose: () => void }) {
  const { game } = ctx;
  const { setId, variantId, playerId } = parseCardId(id);
  const set = game.sets.find((s) => s.id === setId);
  const v = set?.variants.find((x) => x.id === variantId);
  const p = game.players[playerId];
  if (!set || !v || !p) return null;
  const team = game.teams.find((t) => t.id === p.teamId)!;
  const m = game.cards[id];
  const est = estimate(m, game.week);
  const sup = cardSupply(game, id);
  const serialsPulled = m ? [...m.serials].sort((a, b) => a - b) : [];
  const recentSale = m?.sales[m.sales.length - 1];
  const others = Object.keys(game.cards).filter((k) => k !== id && parseCardId(k).playerId === playerId);
  return (
    <Modal title={describeCard(game, id)} onClose={onClose} wide>
      <div className="detail">
        <div className="detail-card">
          <CardView set={set} variant={v} player={p} team={team} serial={recentSale?.s ?? (v.numbered ? serialsPulled[0] : undefined)} size="lg" />
          <dl className="kv">
            <div><dt>Set</dt><dd>{set.year} {set.name}</dd></div>
            <div><dt>Version</dt><dd>{v.name} {v.numbered && <Pill tone="gold">/{v.printRun}</Pill>} {v.autographed && <Pill tone="accent">Auto</Pill>}</dd></div>
            <div><dt>Card number</dt><dd>#{set.checklist.indexOf(p.id) + 1 || '—'}</dd></div>
            <div><dt>Player</dt><dd>{playerName(p)}, {p.pos}, {team.city} {team.name}</dd></div>
            <div><dt>Status</dt><dd>{p.status === 'active' ? 'Active' : p.status === 'injured' ? `Injured, ${p.injuryWeeks} wk` : 'Retired'}{p.rookieYear === set.year && ' · Rookie card'}</dd></div>
            <div><dt>Popularity / form</dt><dd>{p.popularity.toFixed(0)} / {p.form.toFixed(0)} · collector appeal {playerAppeal(p, set.year).toFixed(0)}</dd></div>
          </dl>
        </div>
        <div className="detail-main">
          <div className="stat-row">
            <Stat label="Market value" value={<PriceTag est={est} />} />
            <Stat label="Printed" value={fmtInt(sup.printed)} sub={v.numbered ? 'each copy serial-numbered' : 'copies of this card'} />
            <Stat label="Pulled" value={fmtInt(sup.pulled)} sub={`${fmtInt(sup.sealed)} still in sealed boxes`} />
            <Stat label="In your vault" value={fmtInt(sup.vault)} sub="printed, never packed" />
          </div>
          <h3>Price history</h3>
          {m && m.hist.length ? (
            <LineChart
              label="Market value by week"
              points={m.hist.map((h) => ({ x: h.w, y: h.est }))}
              dots={m.sales.map((s) => ({ x: s.w, y: s.p }))}
              fmtY={(n) => fmtMoney(n)}
              fmtTick={(n) => fmtMoney(n, { cents: !Number.isInteger(n) })}
              fmtX={(n) => `Wk ${n}`}
            />
          ) : (
            <p className="empty">{sup.pulled ? 'No completed sales yet.' : 'Nobody has pulled this card yet, so it has never traded.'}</p>
          )}
          <p className="muted small">Line: median of recent completed sales. Dots: individual sales. Gaps mean weeks with nothing to go on.</p>
          {v.numbered && v.printRun <= 99 && (
            <>
              <h3>Serial numbers</h3>
              <div className="serial-grid" aria-label="Serial numbers pulled">
                {Array.from({ length: v.printRun }, (_, i) => i + 1).map((n) => (
                  <span key={n} className={`serial ${serialsPulled.includes(n) ? 'is-pulled' : sup.vault && game.sets.find((s) => s.id === setId)!.leftoverSerials[id]?.includes(n) ? 'is-vault' : ''}`}>{n}</span>
                ))}
              </div>
              <p className="muted small"><span className="serial is-pulled">#</span> pulled · <span className="serial">#</span> still sealed · <span className="serial is-vault">#</span> in your vault</p>
            </>
          )}
          <h3>Recent sales</h3>
          {m && m.sales.length ? (
            <div className="table-wrap">
              <table className="table table-compact">
                <thead><tr><th>Week</th>{v.numbered && <th className="num">Serial</th>}<th className="num">Price</th></tr></thead>
                <tbody>
                  {[...m.sales].reverse().slice(0, 12).map((s, i) => (
                    <tr key={i}><td>Wk {s.w}</td>{v.numbered && <td className="num">{s.s !== undefined ? `${s.s}/${v.printRun}` : '—'}</td>}<td className="num">{fmtMoney(s.p)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="empty">No sales recorded.</p>}
          {others.length > 0 && (
            <>
              <h3>Other {playerName(p)} cards</h3>
              <ul className="link-list">
                {others.slice(0, 8).map((k) => (
                  <li key={k}><button className="link" onClick={() => ctx.openCard(k)}>{describeCard(game, k)}</button> <PriceTag est={estimate(game.cards[k], game.week)} compact /></li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
