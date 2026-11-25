import React, { useEffect, useMemo, useState } from 'react';
import { defaultMarket, groupOf, marketSource } from '../core/model';
import { byValue, clampValue, valueForRank, type Ranked } from '../core/rankings';
import type { Group, Settings } from '../core/types';
import { Asset, Delta, fmt, fullName, useApp, who } from './common';

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
  const { v, saveSettings, toast } = useApp();
  const key = (mode: Mode) => (mode === 'mine' ? 'mine' : 'consensus') as 'mine' | 'consensus';
  const write = (mode: Mode, patch: (m: Record<string, number>) => void) => {
    const map = { ...(v.settings[key(mode)] ?? {}) };
    patch(map);
    const next: Settings = { ...v.settings, [key(mode)]: map };
    return saveSettings(next).catch(() => undefined);
  };
  return {
    current: (mode: Mode, id: string) => (mode === 'mine' ? v.value(v.me, id) : v.market(id)),
    auto: (mode: Mode, id: string) => (mode === 'mine' ? v.explain(v.me, id).auto : defaultMarket(v.league, v.settings, id)),
    edited: (mode: Mode, id: string) => v.settings[key(mode)]?.[id] != null,
    set: (mode: Mode, id: string, value: number) => write(mode, (m) => void (m[id] = clampValue(value))),
    reset: (mode: Mode, id: string) => write(mode, (m) => void delete m[id]),
    resetAll: async (mode: Mode) => {
      await saveSettings({ ...v.settings, [key(mode)]: {} }).catch(() => undefined);
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

export function Rankings() {
  const { v, canWrite, openAsset } = useApp();
  const edits = useRankEdits();
  const [mode, setMode] = useState<Mode>('mine');
  const [filter, setFilter] = useState<Group | 'ALL'>('ALL');
  const [scope, setScope] = useState<'all' | 'mine'>('all');
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState(false);

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
      <div className="panel-b" style={{ display: 'grid', gap: 10, borderBottom: '1px solid var(--line-2)' }}>
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
          Type a value, type a rank to move someone there, or use the arrows.
        </p>
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
            {editedCount ? `${editedCount} set by you` : 'Nothing set by you yet'}
          </span>
          {editedCount > 0 &&
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
    </section>
  );
}
