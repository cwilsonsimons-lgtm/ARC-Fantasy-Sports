import React, { useMemo, useState } from 'react';
import type { Player } from '../sim/types';
import { parseCardId } from '../sim/catalog';
import { playerName, seasonYear, weekLabel } from '../sim/league';
import { estimate } from '../sim/market';
import { describeCard } from '../sim/game';
import { LineChart, Sparkline } from './Charts';
import { Modal, Pill, PriceTag, type Ctx } from './common';

type Sort = 'popularity' | 'form' | 'skill' | 'age';

export function League({ ctx }: { ctx: Ctx }) {
  const { game } = ctx;
  const [q, setQ] = useState('');
  const [team, setTeam] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<Sort>('popularity');
  const [open, setOpen] = useState<string | null>(null);
  const year = seasonYear(game.week);
  const cardCount = useMemo(() => {
    const c: Record<string, number> = {};
    for (const id of Object.keys(game.cards)) {
      const pid = parseCardId(id).playerId;
      c[pid] = (c[pid] ?? 0) + 1;
    }
    return c;
  }, [game.cards]);
  const players = Object.values(game.players)
    .filter((p) => (!q || playerName(p).toLowerCase().includes(q.toLowerCase())) && (!team || p.teamId === team) && (!status || (status === 'rookie' ? p.rookieYear >= year : p.status === status)))
    .sort((a, b) => (sort === 'age' ? a.age - b.age : b[sort] - a[sort]));
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">{weekLabel(game.week)}</p>
          <h1>League &amp; players</h1>
        </div>
      </header>
      <p className="lede">Popularity is what collectors care about. It follows performance, position, team market size and rookie buzz, and it moves every game week.</p>
      <div className="filters">
        <input id="lg-q" aria-label="Search players" placeholder="Search players" value={q} onChange={(e) => setQ(e.target.value)} />
        <select id="lg-team" aria-label="Team" value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">All teams</option>
          {game.teams.map((t) => <option key={t.id} value={t.id}>{t.city} {t.name}</option>)}
        </select>
        <select id="lg-status" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Everyone</option>
          <option value="active">Active</option>
          <option value="injured">Injured</option>
          <option value="retired">Retired</option>
          <option value="rookie">Rookies</option>
        </select>
        <select id="lg-sort" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="popularity">Sort: popularity</option>
          <option value="form">Sort: current form</option>
          <option value="skill">Sort: talent</option>
          <option value="age">Sort: youngest</option>
        </select>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Player</th><th>Team</th><th>Pos</th><th className="num">Age</th><th className="num">Popularity</th><th>Trend</th><th className="num">Form</th><th className="num">Talent</th><th>Status</th><th className="num">Season</th><th className="num">Your cards</th></tr>
          </thead>
          <tbody>
            {players.slice(0, 200).map((p) => {
              const t = game.teams.find((x) => x.id === p.teamId)!;
              return (
                <tr key={p.id} className="row-link" onClick={() => setOpen(p.id)}>
                  <td><button className="link" onClick={(e) => { e.stopPropagation(); setOpen(p.id); }}>{playerName(p)}</button> {p.rookieYear >= year && <Pill tone="gold">Rookie</Pill>}</td>
                  <td><span className="team-chip" style={{ background: t.primary, color: t.secondary }}>{t.abbr}</span></td>
                  <td>{p.pos}</td>
                  <td className="num">{p.age}</td>
                  <td className="num">{p.popularity.toFixed(0)}</td>
                  <td><Sparkline values={p.hist.slice(-16).map((h) => h.pop)} /></td>
                  <td className="num">{p.form.toFixed(0)}</td>
                  <td className="num">{p.skill.toFixed(0)}</td>
                  <td>{statusOf(p)}</td>
                  <td className="num muted">{p.season.games ? `${p.season.yards ? `${p.season.yards.toLocaleString()} yds · ` : ''}${p.season.tds} TD` : '—'}</td>
                  <td className="num">{cardCount[p.id] ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {open && <PlayerModal ctx={ctx} p={game.players[open]} onClose={() => setOpen(null)} />}
    </div>
  );
}

function statusOf(p: Player) {
  if (p.status === 'injured') return <Pill tone="bad">Out {p.injuryWeeks > 18 ? 'for season' : `${p.injuryWeeks} wk`}</Pill>;
  if (p.status === 'retired') return <Pill>Retired</Pill>;
  if (p.slumpWeeks > 0) return <Pill tone="warn">Slumping</Pill>;
  return <span className="muted">Active</span>;
}

function PlayerModal({ ctx, p, onClose }: { ctx: Ctx; p: Player; onClose: () => void }) {
  const { game } = ctx;
  const t = game.teams.find((x) => x.id === p.teamId)!;
  const cards = Object.keys(game.cards).filter((id) => parseCardId(id).playerId === p.id);
  const news = game.news.filter((n) => n.playerId === p.id).slice(-6).reverse();
  return (
    <Modal title={`${playerName(p)} · ${p.pos} · ${t.city} ${t.name}`} onClose={onClose} wide>
      <div className="stack">
        <p>Age {p.age} · drafted {p.rookieYear} · {statusOf(p)} · popularity {p.popularity.toFixed(0)}, form {p.form.toFixed(0)}, talent {p.skill.toFixed(0)} (ceiling {p.potential.toFixed(0)})</p>
        <h3>Popularity by week</h3>
        <LineChart label="Popularity" points={p.hist.map((h) => ({ x: h.w, y: h.pop }))} fmtY={(n) => n.toFixed(0)} fmtX={(n) => `Wk ${n}`} zeroBased />
        <h3>Cards in circulation</h3>
        {cards.length === 0 ? <p className="empty">None of this player's cards have been pulled yet.</p> : (
          <ul className="link-list">
            {cards.map((id) => (
              <li key={id}><button className="link" onClick={() => ctx.openCard(id)}>{describeCard(game, id)}</button> <PriceTag est={estimate(game.cards[id], game.week)} compact /> <span className="muted small">{game.cards[id].pulled} pulled</span></li>
            ))}
          </ul>
        )}
        {news.length > 0 && (
          <>
            <h3>Headlines</h3>
            <ul className="link-list">{news.map((n) => <li key={n.id}><span className="muted">Wk {n.w}</span> {n.title}</li>)}</ul>
          </>
        )}
        <p className="muted small">Market values are medians of completed sales; cards with few sales show a range.</p>
      </div>
    </Modal>
  );
}
