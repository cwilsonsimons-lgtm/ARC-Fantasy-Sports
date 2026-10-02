import React, { useEffect, useState } from 'react';
import type { GameState } from '../sim/types';
import type { Issue } from '../sim/product';
import type { Confidence, PriceEstimate } from '../sim/market';
import { fmtMoney } from '../sim/format';
import { parseCardId } from '../sim/catalog';
import { CardView } from './CardView';

export type Act = (fn: (s: GameState) => GameState, okMsg?: string) => boolean;

export interface Ctx {
  game: GameState;
  act: Act;
  openCard: (id: string) => void;
  go: (tab: Tab, sub?: string) => void;
  toast: (msg: string, tone?: 'good' | 'bad') => void;
}

export type Tab = 'dashboard' | 'sets' | 'products' | 'production' | 'market' | 'league' | 'news' | 'saves';

export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div className={`stat ${tone ? `tone-${tone}` : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub !== undefined && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

export function Pill({ tone = 'neutral', children }: { tone?: 'good' | 'bad' | 'warn' | 'neutral' | 'accent' | 'gold'; children: React.ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function Section({ title, aside, children, id }: { title: string; aside?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section className="section" id={id}>
      <header className="section-head">
        <h2>{title}</h2>
        {aside && <div className="section-aside">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

/** Number input that lets you type freely and commits a clamped integer on blur / Enter. */
export function NumInput({ id, value, onChange, min = 0, max = 1e9, step = 1, disabled, prefix, width = 7 }: {
  id: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; disabled?: boolean; prefix?: string; width?: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (!isFinite(n) || text.trim() === '') return setText(String(value));
    const v = Math.min(max, Math.max(min, step < 1 ? Math.round(n * 100) / 100 : Math.round(n)));
    setText(String(v));
    if (v !== value) onChange(v);
  };
  return (
    <span className="num-input" style={{ ['--w' as string]: `${width}ch` }}>
      {prefix && <span className="num-prefix">{prefix}</span>}
      <input
        id={id}
        inputMode="decimal"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setText(String(value));
        }}
      />
    </span>
  );
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function Issues({ issues, empty = 'No problems found.' }: { issues: Issue[]; empty?: string }) {
  if (!issues.length) return <p className="issues-ok">✓ {empty}</p>;
  const order = { error: 0, warn: 1, info: 2 } as const;
  return (
    <ul className="issues">
      {[...issues].sort((a, b) => order[a.level] - order[b.level]).map((i, n) => (
        <li key={n} className={`issue issue-${i.level}`}>
          <span className="issue-tag">{i.level === 'error' ? 'Fix' : i.level === 'warn' ? 'Check' : 'Note'}</span>
          <span>{i.msg}</span>
        </li>
      ))}
    </ul>
  );
}

const CONF_LABEL: Record<Confidence, string> = { none: 'No sales yet', low: 'Few sales', medium: 'Some sales', high: 'Active market' };

export function PriceTag({ est, compact }: { est: PriceEstimate; compact?: boolean }) {
  if (est.value === null) return <span className="price price-none">{compact ? 'No sales' : 'No completed sales'}</span>;
  return (
    <span className={`price conf-${est.confidence}`}>
      <span className="price-value">{est.confidence === 'low' ? '≈' : ''}{fmtMoney(est.value)}</span>
      {est.confidence !== 'high' && (
        <span className="price-range">
          {fmtMoney(est.lo)}–{fmtMoney(est.hi)}
        </span>
      )}
      {!compact && <span className="price-conf">{CONF_LABEL[est.confidence]} · {est.sales} in 10 wks</span>}
    </span>
  );
}

export function ConfidenceDot({ c }: { c: Confidence }) {
  return <span className={`conf-dot conf-${c}`} title={CONF_LABEL[c]} aria-label={CONF_LABEL[c]} />;
}

export function MiniCard({ game, id, serial, size = 'sm' }: { game: GameState; id: string; serial?: number; size?: 'sm' | 'md' | 'lg' }) {
  const { setId, variantId, playerId } = parseCardId(id);
  const set = game.sets.find((s) => s.id === setId);
  const v = set?.variants.find((x) => x.id === variantId);
  const p = game.players[playerId];
  if (!set || !v || !p) return null;
  const team = game.teams.find((t) => t.id === p.teamId)!;
  return <CardView set={set} variant={v} player={p} team={team} serial={serial} size={size} />;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close">
            Close
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Trend({ now, then }: { now: number | null | undefined; then: number | null | undefined }) {
  if (!now || !then) return <span className="trend trend-flat">—</span>;
  const ch = now / then - 1;
  if (Math.abs(ch) < 0.02) return <span className="trend trend-flat">0%</span>;
  return <span className={`trend ${ch > 0 ? 'trend-up' : 'trend-down'}`}>{ch > 0 ? '▲' : '▼'} {Math.abs(ch * 100).toFixed(0)}%</span>;
}
