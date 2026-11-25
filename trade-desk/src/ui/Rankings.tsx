import React, { useEffect, useMemo, useState } from 'react';
import { defaultMarket, groupOf, marketSource } from '../core/model';
import { byValue, clampValue, valueForRank, type Ranked } from '../core/rankings';
import type { Group, RankingWeek, Settings } from '../core/types';
import { Asset, Delta, fmt, fullName, shortDate, useApp, who } from './common';
import { weekRange } from '../core/weeks';

export type Mode = 'mine' | 'league';

/** A number field that saves on Enter or when you leave it, not on every keystroke. */
export function NumberEdit({
  value,
  onCommit,
  label,
  id,
  width = 80,
  disabled,
  min = 0,
  max = 10000,
}: {
  value: number;
  onCommit: (n: number) => void;
  label: string;
  id: string;
  width?: number;
  disabled?: boolean;
  min?: number;
  max?: number;
}) {
  const [text, setText] = useState(String(Math.round(value)));
  useEffect(() => setText(String(Math.round(value))), [value]);
  const commit = () => {
    const n = Number(text.replace(/[^0-9.]/g, ''));
    if (!text.trim() || !Number.isFinite(n)) return setText(String(Math.round(value)));
    const c = Math.min(max, Math.max(min, Math.round(n)));
    if (c !== Math.round(value)) onCommit(c);
    else setText(String(Math.round(value)));
  };
  return (
    <input
      id={id}
      className="input num edit"
      inputMode="numeric"
      aria-label={label}
      style={{ width }}
      value={text}
      disabled={disabled}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(String(Math.round(value)));
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/** Shared by the Rankings tab and the player sheet. */
export function useRankEdits() {
  const { v, saveRanking, toast } = useApp();
  const key = (mode: Mode) => (mode === 'mine' ? 'mine' : 'consensus') as 'mine' | 'consensus';
  const edited = () => ({ mine: { ...(v.settings.mine ?? {}) }, consensus: { ...(v.settings.consensus ?? {}) } });
  const write = (mode: Mode, patch: (m: Record<string, number>) => void) => {
    const next = edited();
    patch(next[key(mode)]);
    return saveRanking(next);
  };
  return {
    current: (mode: Mode, id: string) => (mode === 'mine' ? v.value(v.me, id) : v.market(id)),
    auto: (mode: Mode, id: string) => (mode === 'mine' ? v.explain(v.me, id).auto : defaultMarket(v.league, v.settings, id)),
    edited: (mode: Mode, id: string) => v.settings[key(mode)]?.[id] != null,
    set: (mode: Mode, id: string, value: number) => write(mode, (m) => void (m[id] = clampValue(value))),
    reset: (mode: Mode, id: string) => write(mode, (m) => void delete m[id]),
    resetAll: async (mode: Mode) => {
      await saveRanking({ ...edited(), [key(mode)]: {} });
      toast(mode === 'mine' ? 'Your values are back to the desk’s read.' : 'League values are back to the market.');
    },
  };
}

const FILTERS: [string, Group | 'ALL'][] = [
  ['All', 'ALL'],
  ['QB', 'QB'],
  ['RB', 'RB'],
  ['WR', 'WR'],
  ['TE', 'TE'],
  ['Picks', 'PICK'],
];

function sourceLabel(mode: Mode, s: Settings, id: string, edited: boolean) {
  if (edited) return 'you';
  if (mode === 'mine') return 'auto';
  return marketSource(s, id) === 'ktc' ? 'KTC' : 'model';
}

function WeekBar({ view, setView }: { view: string; setView: (w: string) => void }) {
  const { data, week } = useApp();
  const past = data.rankings.filter((w) => w.week < week.key).sort((a, b) => b.week.localeCompare(a.week));
  const viewing = view ? data.rankings.find((w) => w.week === view) : null;
  return (
    <div className="weekbar">
      <div>
        <div className="wk-label">{viewing ? viewing.label : week.label}</div>
        <div className="who-s">
          {weekRange(viewing ? viewing.week : week.key)}
          {viewing
            ? ` · saved ${shortDate(viewing.updatedAt)}`
            : week.from && week.from.week === week.key
              ? ' · this week'
              : week.from
                ? ` · this week, starting from ${week.from.label}'s list`
                : ' · this week'}
        </div>
      </div>
      <label className="field" style={{ marginLeft: 'auto' }}>
        <span>{past.length ? 'Look back' : 'Past weeks appear here once a week ends'}</span>
        <select className="select" id="rank-week" value={view} onChange={(e) => setView(e.target.value)} disabled={!past.length}>
          <option value="">{week.label} (this week)</option>
          {past.map((w) => (
            <option key={w.week} value={w.week}>
              {w.label} · {weekRange(w.week)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

interface PastRow extends Ranked {
  group: Group;
  edited: boolean;
  now: number;
  /** spots climbed since that week (negative = fell); null if he isn't on both lists */
  rankNow: number | null;
}

/** A saved week, read-only, against where everyone stands now. */
function PastBoard({ week, mode, filter, scope, q }: { week: RankingWeek; mode: Mode; filter: Group | 'ALL'; scope: 'all' | 'mine'; q: string }) {
  const { v, openAsset } = useApp();
  const edits = useRankEdits();
  const values = mode === 'mine' ? week.board.mine : week.board.league;
  const setBy = mode === 'mine' ? week.edited.mine : week.edited.consensus;
  const keep = (id: string, g: Group) => (filter === 'ALL' || g === filter) && (scope === 'all' || v.league.owner[id] === v.me);
  // Moves compare only players on both lists, so someone cut or newly added doesn't shift everyone by one.
  const both = Object.keys(values).filter((id) => v.league.owner[id] && keep(id, (week.names[id]?.[1] ?? groupOf(v.league, id)) as Group));
  const rankOf = (vals: (id: string) => number) =>
    new Map(both.map((id) => ({ id, value: vals(id), name: fullName(v, id) })).sort(byValue).map((r, i) => [r.id, i + 1]));
  const thenRank = rankOf((id) => values[id]);
  const nowRank = rankOf((id) => edits.current(mode, id));
  const list: PastRow[] = Object.entries(values)
    .map(([id, value]) => {
      const inLeague = !!v.league.owner[id];
      const [stored, group] = week.names[id] ?? [id, groupOf(v.league, id)];
      return {
        id,
        value,
        name: inLeague ? fullName(v, id) : stored,
        group: group as Group,
        edited: setBy[id] != null,
        now: inLeague ? edits.current(mode, id) : 0,
        rankNow: inLeague && thenRank.has(id) ? thenRank.get(id)! - nowRank.get(id)! : null,
      };
    })
    .filter((r) => keep(r.id, r.group))
    .sort(byValue);
  const shown = q ? list.filter((r) => r.name.toLowerCase().includes(q.toLowerCase())) : list;
  const moves = list
    .map((r) => ({ r, d: r.rankNow ?? 0 }))
    .filter((x) => x.d !== 0)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const risers = moves.filter((m) => m.d > 0).slice(0, 3);
  const fallers = moves.filter((m) => m.d < 0).slice(0, 3);

  return (
    <>
      {(risers.length > 0 || fallers.length > 0) && (
        <div className="panel-b moves-since" style={{ borderBottom: '1px solid var(--line-2)' }}>
          <div>
            <div className="h2" style={{ fontSize: 13 }}>
              Up since {week.label}
            </div>
            {risers.length ? risers.map((m) => <MoveLine key={m.r.id} name={m.r.name} d={m.d} />) : <div className="faint">Nobody</div>}
          </div>
          <div>
            <div className="h2" style={{ fontSize: 13 }}>
              Down since {week.label}
            </div>
            {fallers.length ? fallers.map((m) => <MoveLine key={m.r.id} name={m.r.name} d={m.d} />) : <div className="faint">Nobody</div>}
          </div>
        </div>
      )}
      <div className="tbl-wrap">
        <table className="tbl rank-tbl">
          <thead>
            <tr>
              <th>Rank</th>
              <th>{filter === 'PICK' ? 'Pick' : 'Player'}</th>
              <th className="r">{week.label}</th>
              <th className="r">Now</th>
              <th className="r">Move</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const rank = list.indexOf(r) + 1;
              const d = r.rankNow;
              const inLeague = !!v.league.owner[r.id];
              return (
                <tr key={r.id} onClick={() => inLeague && openAsset(r.id)} className={r.edited ? 'edited' : undefined} style={inLeague ? undefined : { cursor: 'default' }}>
                  <td className="num">{rank}</td>
                  <td>
                    {inLeague ? (
                      <Asset id={r.id} />
                    ) : (
                      <div className="who">
                        <span className={`pos pos-${r.group}`}>{r.group === 'PICK' ? 'PK' : r.group}</span>
                        <div className="who-n">{r.name}</div>
                      </div>
                    )}
                  </td>
                  <td className="r">
                    <div className="num">{fmt(r.value)}</div>
                    {r.edited && (
                      <div className="src">
                        <span className="src-you">you</span>
                      </div>
                    )}
                  </td>
                  <td className="r">{inLeague ? <><div className="num">{fmt(r.now)}</div><Delta value={r.now} base={r.value} /></> : <span className="faint">gone</span>}</td>
                  <td className="r num">{d == null ? <span className="faint">—</span> : d === 0 ? <span className="faint">same</span> : <span className={d > 0 ? 'up' : 'down'}>{d > 0 ? `▲${d}` : `▼${-d}`}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MoveLine({ name, d }: { name: string; d: number }) {
  return (
    <div className="kv">
      <span>{name}</span>
      <span className={'num ' + (d > 0 ? 'up' : 'down')}>{d > 0 ? `▲${d}` : `▼${-d}`}</span>
    </div>
  );
}

export function Rankings() {
  const { v, canWrite, openAsset, data, week } = useApp();
  const edits = useRankEdits();
  const [mode, setMode] = useState<Mode>('mine');
  const [filter, setFilter] = useState<Group | 'ALL'>('ALL');
  const [scope, setScope] = useState<'all' | 'mine'>('all');
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [view, setView] = useState('');
  const past = view ? data.rankings.find((w) => w.week === view) ?? null : null;

  // Rank among everything that passes the position and roster filters; the search only hides rows.
  const list: Ranked[] = useMemo(
    () =>
      Object.entries(v.league.owner)
        .filter(([id, t]) => (filter === 'ALL' || groupOf(v.league, id) === filter) && (scope === 'all' || t === v.me))
        .map(([id]) => ({ id, value: edits.current(mode, id), name: fullName(v, id) }))
        .sort(byValue),
    [v, mode, filter, scope],
  );
  const shown = q ? list.filter((r) => r.name.toLowerCase().includes(q.toLowerCase())) : list;
  const editedCount = Object.keys(v.settings[mode === 'mine' ? 'mine' : 'consensus'] ?? {}).length;
  const moveTo = (id: string, rank: number) => edits.set(mode, id, valueForRank(list, id, rank));

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>Rankings</h2>
        <div className="seg" role="group" aria-label="Whose values">
          <button aria-pressed={mode === 'mine'} onClick={() => setMode('mine')}>
            Your values
          </button>
          <button aria-pressed={mode === 'league'} onClick={() => setMode('league')}>
            League values
          </button>
        </div>
        <div className="right" style={{ flex: '1 1 180px' }}>
          <input className="input" id="rank-q" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search rankings" />
        </div>
      </div>
      <div className="panel-b" style={{ borderBottom: '1px solid var(--line-2)' }}>
        <WeekBar view={view} setView={setView} />
      </div>
      <div className="panel-b" style={{ display: 'grid', gap: 10, borderBottom: '1px solid var(--line-2)' }}>
        {past ? (
          <p className="note">
            Your {mode === 'mine' ? 'values' : 'league values'} as they stood in {past.label}, against where everyone is now. Read-only: past weeks are kept as they were. ▲ means he has climbed since.
          </p>
        ) : (
        <p className="note">
          {mode === 'mine' ? (
            <>
              What each player is worth <b>to you</b>. Trade reads, offers and the finder use these for your side. Anything you haven't set follows the desk's read for your team.
            </>
          ) : (
            <>
              What <b>the league in general</b> pays. Every team starts from this number, then their own lean (streaks, need, window, past trades) moves it. Anything you haven't set follows{' '}
              {Object.keys(v.settings.market).length ? 'your KTC paste or ' : ''}the model.
            </>
          )}{' '}
          Type a value, type a rank to move someone there, or use the arrows. Edits save to {week.label}; next week starts from this list.
        </p>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="seg" role="group" aria-label="Position">
            {FILTERS.map(([l, g]) => (
              <button key={g} aria-pressed={filter === g} onClick={() => setFilter(g)}>
                {l}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Rosters">
            <button aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
              Whole league
            </button>
            <button aria-pressed={scope === 'mine'} onClick={() => setScope('mine')}>
              Your roster
            </button>
          </div>
          <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
            {past
              ? `${Object.keys(mode === 'mine' ? past.edited.mine : past.edited.consensus).length} set by you that week`
              : editedCount
                ? `${editedCount} set by you`
                : 'Nothing set by you yet'}
          </span>
          {!past && editedCount > 0 &&
            canWrite &&
            (confirm ? (
              <span style={{ display: 'flex', gap: 6 }}>
                <button
                  className="btn small danger"
                  onClick={() => {
                    setConfirm(false);
                    edits.resetAll(mode);
                  }}
                >
                  Reset all {editedCount}
                </button>
                <button className="btn small" onClick={() => setConfirm(false)}>
                  Keep
                </button>
              </span>
            ) : (
              <button className="btn small" onClick={() => setConfirm(true)}>
                Reset all
              </button>
            ))}
        </div>
      </div>
      {past ? (
        <PastBoard week={past} mode={mode} filter={filter} scope={scope} q={q} />
      ) : (
      <div className="tbl-wrap">
        <table className="tbl rank-tbl">
          <thead>
            <tr>
              <th>Rank</th>
              <th>{filter === 'PICK' ? 'Pick' : 'Player'}</th>
              <th className="hide-sm">Owner</th>
              <th className="r">Value</th>
              <th className="r hide-sm">{mode === 'mine' ? 'Desk read' : 'Default'}</th>
              <th className="r">
                <span className="sr-only">Move or reset</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const rank = list.indexOf(r) + 1;
              const edited = edits.edited(mode, r.id);
              const auto = edits.auto(mode, r.id);
              const owner = v.league.owner[r.id];
              return (
                <tr key={r.id} onClick={() => openAsset(r.id)} className={edited ? 'edited' : undefined}>
                  <td>
                    <NumberEdit id={`rank-${r.id}`} label={`Rank for ${r.name}`} value={rank} min={1} max={list.length} width={56} disabled={!canWrite} onCommit={(n) => moveTo(r.id, n)} />
                  </td>
                  <td>
                    <Asset id={r.id} />
                  </td>
                  <td className="hide-sm" style={{ fontSize: 12 }}>
                    {owner === v.me ? 'You' : who(v, owner, true)}
                  </td>
                  <td className="r">
                    <NumberEdit id={`val-${r.id}`} label={`Value for ${r.name}`} value={r.value} disabled={!canWrite} onCommit={(n) => edits.set(mode, r.id, n)} />
                    <div className="src">
                      <span className={'src-' + sourceLabel(mode, v.settings, r.id, edited)}>{sourceLabel(mode, v.settings, r.id, edited)}</span>
                    </div>
                  </td>
                  <td className="r hide-sm">
                    <div className="num">{fmt(auto)}</div>
                    {edited && <Delta value={r.value} base={auto} />}
                  </td>
                  <td className="r" onClick={(e) => e.stopPropagation()}>
                    <span className="moves">
                      <button className="btn small" disabled={!canWrite || rank === 1} aria-label={`Move ${r.name} up`} onClick={() => moveTo(r.id, rank - 1)}>
                        ▲
                      </button>
                      <button className="btn small" disabled={!canWrite || rank === list.length} aria-label={`Move ${r.name} down`} onClick={() => moveTo(r.id, rank + 1)}>
                        ▼
                      </button>
                      {edited && (
                        <button className="btn small" disabled={!canWrite} aria-label={`Reset ${r.name}`} title="Back to the default" onClick={() => edits.reset(mode, r.id)}>
                          ↺
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </section>
  );
}
