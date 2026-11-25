import React, { useEffect, useRef, useState } from 'react';
import { assetSub, MARKET_RECENCY, modelPlayerValue } from '../core/model';
import { gameLines, rebuildFromGames, series } from '../core/history';
import { Delta, fmt, fullName, PosTag, Trend, useApp, who } from './common';
import { FactorChips } from './Lab';
import { LineChart, type Series } from './Chart';
import { explainMcp, playerGames, writes } from './runtime';
import { NumberEdit, useRankEdits, type Mode } from './Rankings';

export function PlayerSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { v, data, db, saveSettings, canWrite, toast, openLab } = useApp();
  const p = v.league.players[id];
  const owner = v.league.owner[id];
  const [compare, setCompare] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const edits = useRankEdits();

  const closeFn = useRef(onClose);
  closeFn.current = onClose;
  // Focus Close once when the sheet opens (not on every save, or Enter in a field would hit it).
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeFn.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const teams = [...v.league.teams].sort((a, b) => v.value(b.id, id) - v.value(a.id, id));
  const market = v.market(id);

  // The line: recorded snapshots, plus anything rebuilt from his game log, plus today.
  const today = { date: v.league.asOf.slice(0, 10), value: market };
  // Today's point is always the live number, so an edit shows on the chart straight away.
  const withToday = (pts: { date: string; value: number }[], now: number) => [...pts.filter((x) => x.date !== today.date), { date: today.date, value: now }];
  const rebuilt = data.rebuilt[id] ?? [];
  const lines: Series[] = [];
  if (rebuilt.length) lines.push({ key: 'rebuilt', label: 'Market, from game logs', color: 'var(--series-market)', points: rebuilt.filter((x) => x.date < (series(data.history, id)[0]?.date ?? today.date)) });
  lines.push({ key: 'market', label: 'Market', color: 'var(--series-market)', points: withToday(series(data.history, id), market) });
  if (owner && owner !== v.me) lines.push({ key: 'owner', label: who(v, owner, true), color: 'var(--series-2)', points: withToday(series(data.history, id, owner), v.value(owner, id)) });
  lines.push({ key: 'me', label: 'You', color: 'var(--series-1)', points: withToday(series(data.history, id, v.me), v.value(v.me, id)) });
  if (compare && compare !== owner && compare !== v.me) lines.push({ key: 'cmp', label: who(v, compare, true), color: 'var(--series-3)', points: withToday(series(data.history, id, compare), v.value(compare, id)) });

  const nudge = (team: string) => v.settings.nudges.find((n) => n.team === team && n.asset === id)?.pct ?? 0;
  const setNudge = (team: string, pct: number) => {
    const rest = v.settings.nudges.filter((n) => !(n.team === team && n.asset === id));
    const next = Math.abs(pct) < 0.001 ? rest : [...rest, { team, asset: id, pct: Math.round(pct * 100) / 100 }];
    return saveSettings({ ...v.settings, nudges: next });
  };

  const rebuild = async () => {
    if (!p || !db) return;
    setBusy(true);
    setErr(null);
    try {
      const games = gameLines(await playerGames(p.name));
      if (!games.length) throw Object.assign(new Error(), { code: 'none' });
      await writes.rebuilt(db, id, rebuildFromGames(p, games));
      toast(`Rebuilt ${games.length} weeks for ${p.name}.`);
    } catch (e: any) {
      setErr(e?.code === 'none' ? 'StatsDeck has no game log for him yet.' : explainMcp(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scrim" onClick={onClose}>
      <aside className="sheet" role="dialog" aria-modal="true" aria-label={fullName(v, id)} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <PosTag v={v} id={id} />
              <span className="muted" style={{ fontSize: 12 }}>
                {assetSub(v.league, id)}
                {owner ? ' · ' + (owner === v.me ? 'your team' : who(v, owner)) : ''}
              </span>
            </div>
            <h2>{fullName(v, id)}</h2>
          </div>
          <button ref={closeRef} className="btn" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
        <div className="sheet-b">
          <div className="stats">
            {(['league', 'mine'] as Mode[]).map((mode) => (
              <div className="stat" key={mode}>
                <div className="l">{mode === 'mine' ? 'To you' : 'League value'}</div>
                <NumberEdit
                  id={`sheet-${mode}`}
                  label={mode === 'mine' ? 'Your value' : 'League value'}
                  value={edits.current(mode, id)}
                  width={96}
                  disabled={!canWrite}
                  onCommit={(n) => edits.set(mode, id, n)}
                />
                <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>
                  {edits.edited(mode, id) ? (
                    <>
                      set by you ·{' '}
                      <button className="linkish" onClick={() => edits.reset(mode, id)} disabled={!canWrite}>
                        reset to {fmt(edits.auto(mode, id))}
                      </button>
                    </>
                  ) : mode === 'mine' ? (
                    'desk read · tap to set'
                  ) : (
                    'tap to set'
                  )}
                </div>
              </div>
            ))}
            {p && (
              <>
                <div className="stat">
                  <div className="l">Recent form</div>
                  <div className="v">{p.form.toFixed(1)}</div>
                  <Trend id={id} />
                </div>
                <div className="stat">
                  <div className="l">Longer run</div>
                  <div className="v">{p.base.toFixed(1)}</div>
                  <span className="faint" style={{ fontSize: 12 }}>
                    pts per game
                  </span>
                </div>
              </>
            )}
          </div>
          {p && Math.abs(p.trend) >= 0.08 && (
            <p className="note">
              On form alone he'd price at <b className="num">{fmt(modelPlayerValue(p, 1))}</b>; on his longer run, <b className="num">{fmt(modelPlayerValue(p, 0))}</b>. The market takes the middle (
              {fmt(modelPlayerValue(p, MARKET_RECENCY))}). Managers who chase streaks, and his owner, lean toward form.
            </p>
          )}

          <section className="panel">
            <div className="panel-h">
              <h2>Value over time</h2>
              <div className="right">
                <select className="select" id="cmp-team" style={{ width: 'auto' }} value={compare} onChange={(e) => setCompare(e.target.value)} aria-label="Compare a team">
                  <option value="">Compare a team…</option>
                  {v.league.teams
                    .filter((t) => t.id !== owner && t.id !== v.me)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {who(v, t.id)}
                      </option>
                    ))}
                </select>
              </div>
            </div>
            <div className="panel-b">
              <LineChart series={lines} />
              {data.history.length <= 1 && !rebuilt.length && (
                <p className="note" style={{ marginTop: 8 }}>
                  One reading so far. Each sync adds a point{p ? ', or rebuild his season from game logs to see how his value moved before the desk was tracking.' : '.'}
                </p>
              )}
              {p && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                  <button className="btn small" onClick={rebuild} disabled={busy || !canWrite}>
                    {busy ? 'Reading game logs…' : rebuilt.length ? 'Rebuild again' : 'Rebuild from game logs'}
                  </button>
                  {rebuilt.length > 0 && <span className="faint" style={{ fontSize: 12 }}>The earlier, gray stretch is rebuilt from game logs: market only.</span>}
                </div>
              )}
              {err && (
                <div className="banner bad" style={{ marginTop: 10 }}>
                  {err}
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-h">
              <h2>Every team's number</h2>
              <span className="sub">Tap ± if you know a manager is higher or lower on him</span>
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Team</th>
                    <th className="r">Value</th>
                    <th className="r">vs mkt</th>
                    <th className="hide-sm">Why</th>
                    <th className="r">Your note</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map((t) => {
                    const n = nudge(t.id);
                    return (
                      <tr key={t.id} style={{ cursor: 'default' }}>
                        <td>
                          <div className="who-n" style={{ fontSize: 13 }}>
                            {who(v, t.id, true)}
                            {t.id === owner ? ' · owner' : ''}
                            {t.me ? ' · you' : ''}
                          </div>
                          <div className="who-s">{t.name}</div>
                        </td>
                        <td className="r num">{fmt(v.value(t.id, id))}</td>
                        <td className="r">
                          <Delta value={v.value(t.id, id)} base={market} />
                        </td>
                        <td className="hide-sm">
                          <FactorChips f={v.explain(t.id, id)} />
                        </td>
                        <td className="r">
                          <span className="stepper">
                            <button disabled={!canWrite} aria-label={`Lower ${t.name}'s value 5%`} onClick={() => setNudge(t.id, Math.max(-0.5, n - 0.05))}>
                              −
                            </button>
                            <span>{n ? (n > 0 ? '+' : '−') + Math.round(Math.abs(n) * 100) + '%' : '—'}</span>
                            <button disabled={!canWrite} aria-label={`Raise ${t.name}'s value 5%`} onClick={() => setNudge(t.id, Math.min(0.5, n + 0.05))}>
                              +
                            </button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          {owner && owner !== v.me && (
            <button
              className="btn primary"
              style={{ justifySelf: 'start' }}
              onClick={() => {
                onClose();
                openLab({ team: owner, send: [], receive: [id] });
              }}
            >
              Trade for {p ? p.name.split(' ').slice(-1)[0] : 'this pick'}
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
