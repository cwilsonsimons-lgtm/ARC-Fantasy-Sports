import React, { useEffect, useState } from 'react';
import { windowLabel } from '../core/model';
import { GROUPS, POSITIONS, type TeamTraits, type TradeLog } from '../core/types';
import { Asset, Delta, fmt, fullName, pct, useApp, who } from './common';
import { FactorChips } from './Lab';
import { ordinal } from './MyTeam';

const GROUP_LABEL: Record<string, string> = { QB: 'QBs', RB: 'RBs', WR: 'WRs', TE: 'TEs', PICK: 'picks' };

export function lessons(v: ReturnType<typeof useApp>['v'], team: string): string[] {
  const out: string[] = [];
  const g = v.learned.group[team] ?? {};
  for (const k of GROUPS) {
    const x = g[k];
    if (x != null && Math.abs(x) >= 0.03) out.push(`${x > 0 ? 'Pays up for' : 'Discounts'} ${GROUP_LABEL[k]} ${pct(Math.exp(x) - 1)}`);
  }
  const a = Object.entries(v.learned.asset[team] ?? {})
    .filter(([, x]) => Math.abs(x) >= 0.02)
    .sort((p, q) => Math.abs(q[1]) - Math.abs(p[1]))
    .slice(0, 3);
  for (const [id, x] of a) out.push(`${x > 0 ? 'Values' : 'Cooler on'} ${fullName(v, id)} ${pct(Math.exp(x) - 1)}`);
  const m = v.learned.margin[team];
  if (m != null && Math.abs(m) >= 0.01) out.push(m > 0 ? 'Wants to win trades clearly' : 'Will take a close deal');
  return out;
}

function heatBg(r: number) {
  // Diverging around the league average: blue above, red below, gray at par.
  const d = Math.max(-1, Math.min(1, (r - 1) / 0.5));
  if (Math.abs(d) < 0.08) return 'var(--surface-2)';
  return d > 0
    ? `color-mix(in oklab, var(--series-1) ${Math.round(12 + 40 * d)}%, var(--surface))`
    : `color-mix(in oklab, var(--down) ${Math.round(12 + 40 * -d)}%, var(--surface))`;
}

function TraitEditor({ team }: { team: string }) {
  const { v, saveSettings, canWrite } = useApp();
  const tr = v.settings.traits[team] ?? {};
  const [name, setName] = useState(tr.manager ?? '');
  useEffect(() => setName(tr.manager ?? ''), [tr.manager]);
  const set = (patch: Partial<TeamTraits>) => {
    const next = { ...v.settings, traits: { ...v.settings.traits, [team]: { ...tr, ...patch } } };
    for (const k of Object.keys(patch) as (keyof TeamTraits)[]) if (patch[k] === undefined) delete next.traits[team][k];
    return saveSettings(next);
  };
  const seg = (label: string, key: 'recency' | 'endowment', opts: [string, number | undefined][]) => (
    <div className="field">
      <span>{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {opts.map(([l, val]) => (
          <button key={l} disabled={!canWrite} aria-pressed={tr[key] === val} onClick={() => set({ [key]: val })}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <label className="field">
        <span>Manager</span>
        <input
          className="input"
          id={`mgr-${team}`}
          placeholder="e.g. Jake"
          value={name}
          disabled={!canWrite}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() !== (tr.manager ?? '') && set({ manager: name.trim().slice(0, 30) || undefined })}
        />
      </label>
      {team !== v.me &&
        seg('Hot streaks', 'recency', [
          ['Ignores', 0.25],
          ['Normal', undefined],
          ['Chases', 0.8],
        ])}
      {team !== v.me &&
        seg('Own players', 'endowment', [
          ['Sells easily', 0.02],
          ['Normal', undefined],
          ['Hoards', 0.18],
        ])}
      <div className="field">
        <span>Window</span>
        <div className="seg" role="group" aria-label="Window">
          {(
            [
              ['Auto', undefined],
              ['Contending', 0.8],
              ['Rebuilding', -0.8],
            ] as [string, number | undefined][]
          ).map(([l, val]) => (
            <button key={l} disabled={!canWrite} aria-pressed={tr.window === val} onClick={() => set({ window: val })}>
              {l}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const answers = (trades: TradeLog[], team: string) => trades.filter((t) => t.outcome !== 'pending' && (t.team === team || t.with === team)).length;

export function League() {
  const { v, openTeam } = useApp();
  const teams = [...v.league.teams].sort((a, b) => a.standing - b.standing);
  return (
    <>
      <p className="note">
        Every manager prices players differently. Strength is each team's starters against the league average; the lessons come from trades they've made or turned down. Tap a team to see who
        they overrate and underrate.
      </p>
      <div className="teams">
        {teams.map((t) => {
          const c = v.ctx[t.id];
          const ls = lessons(v, t.id);
          return (
            <article key={t.id} className={'tcard' + (t.me ? ' me' : '')}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <h3>{t.name}</h3>
                  <div className="who-s">
                    {v.settings.traits[t.id]?.manager ? v.settings.traits[t.id]!.manager + ' · ' : ''}
                    {t.wins}-{t.losses} · {ordinal(t.standing)}
                    {t.me ? ' · you' : ''}
                  </div>
                </div>
                <span className="chip win" style={{ marginLeft: 'auto' }}>
                  {windowLabel(c.window)}
                </span>
              </div>
              <div className="heat" aria-label="Strength by position vs league average">
                {POSITIONS.map((p) => (
                  <div key={p} style={{ background: heatBg(c.ratio[p]) }}>
                    {p}
                    <b>{pct(c.ratio[p] - 1)}</b>
                  </div>
                ))}
              </div>
              {ls.length ? (
                <ul className="lessons">
                  {ls.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              ) : (
                <div className="faint" style={{ fontSize: 12 }}>
                  No trade history to learn from yet.
                </div>
              )}
              <button className="btn small" style={{ justifySelf: 'start' }} onClick={() => openTeam(t.id)}>
                {t.me ? 'Your settings' : 'Their board'}
              </button>
            </article>
          );
        })}
      </div>
    </>
  );
}

export function TeamBoard({ team }: { team: string }) {
  const { v, data, openAsset, openLab, go } = useApp();
  const t = v.league.teams.find((x) => x.id === team);
  const [kind, setKind] = useState<'theirs' | 'mine'>('theirs');
  if (!t) return null;
  const ids = Object.entries(v.league.owner)
    .filter(([, o]) => o === (kind === 'theirs' ? team : v.me))
    .map(([id]) => id)
    .sort((a, b) => v.value(team, b) - v.value(team, a));
  return (
    <div className="cols">
      <section className="panel">
        <div className="panel-h">
          <h2>{who(v, team)}</h2>
          <span className="sub">{windowLabel(v.ctx[team].window)}</span>
          <div className="right">
            <button className="btn small" onClick={() => go('league')}>
              All teams
            </button>
          </div>
        </div>
        <div className="panel-b">
          <TraitEditor team={team} />
        </div>
        <div className="panel-b" style={{ borderTop: '1px solid var(--line-2)' }}>
          <div className="h2" style={{ fontSize: 14, marginBottom: 6 }}>
            What their trades show
          </div>
          {lessons(v, team).length ? (
            <ul className="lessons">
              {lessons(v, team).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : answers(data.trades, team) ? (
            <p className="note">
              {answers(data.trades, team)} answer{answers(data.trades, team) > 1 ? 's' : ''} logged, all in line with what the desk expected, so nothing has moved. A no to an offer the desk
              rated close teaches the most.
            </p>
          ) : (
            <p className="note">Nothing logged yet. Log offers they turn down in the Trade lab and this fills in.</p>
          )}
        </div>
      </section>
      {team !== v.me && (
        <section className="panel">
          <div className="panel-h">
            <h2>Through their eyes</h2>
            <div className="right">
              <div className="seg" role="group" aria-label="Roster">
                <button aria-pressed={kind === 'theirs'} onClick={() => setKind('theirs')}>
                  Their roster
                </button>
                <button aria-pressed={kind === 'mine'} onClick={() => setKind('mine')}>
                  Your roster
                </button>
              </div>
            </div>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{kind === 'theirs' ? 'Their player' : 'Your player'}</th>
                  <th className="r">Market</th>
                  <th className="r">To them</th>
                  <th className="r">vs mkt</th>
                  <th className="hide-sm">Why</th>
                </tr>
              </thead>
              <tbody>
                {ids.map((id) => (
                  <tr key={id} onClick={() => openAsset(id)}>
                    <td>
                      <Asset id={id} />
                    </td>
                    <td className="r num">{fmt(v.market(id))}</td>
                    <td className="r num">{fmt(v.value(team, id))}</td>
                    <td className="r">
                      <Delta value={v.value(team, id)} base={v.market(id)} />
                    </td>
                    <td className="hide-sm">
                      <FactorChips f={v.explain(team, id)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel-b" style={{ borderTop: '1px solid var(--line-2)' }}>
            <button className="btn" onClick={() => openLab({ team, send: [], receive: [] })}>
              Start a trade with {who(v, team, true)}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
