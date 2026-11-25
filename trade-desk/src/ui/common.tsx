import React, { createContext, useContext } from 'react';
import type { Valuer } from '../core/model';
import { assetName, assetSub, groupOf } from '../core/model';
import type { Data, DB } from './runtime';
import type { Settings, TradeLog } from '../core/types';

export interface LabState {
  team: string;
  /** what I send (their `get`) */
  send: string[];
  /** what I receive (their `give`) */
  receive: string[];
}

export interface Ctx {
  v: Valuer;
  data: Data;
  db: DB | null;
  canWrite: boolean;
  openAsset: (id: string) => void;
  openTeam: (id: string) => void;
  openLab: (s: Partial<LabState>) => void;
  lab: LabState;
  setLab: (s: LabState) => void;
  saveSettings: (s: Settings) => Promise<void>;
  saveTrade: (t: TradeLog) => Promise<void>;
  dropTrade: (id: string) => Promise<void>;
  toast: (msg: string) => void;
  go: (route: string) => void;
}

export const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
export const pct = (x: number, digits = 0) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(digits) + '%';
export const signed = (n: number) => (n >= 0 ? '+' : '−') + fmt(Math.abs(n));

export function teamName(v: Valuer, id: string | undefined) {
  if (!id) return 'Free agent';
  return v.league.teams.find((t) => t.id === id)?.name ?? 'Unknown team';
}

/** "Jake (Dakyard Football)" when you've named the manager, else the team. */
export function who(v: Valuer, id: string, short = false) {
  const t = teamName(v, id);
  const m = v.settings.traits[id]?.manager;
  if (!m) return t;
  return short ? m : `${m} · ${t}`;
}

export function PosTag({ v, id }: { v: Valuer; id: string }) {
  const g = groupOf(v.league, id);
  return <span className={`pos pos-${g}`}>{g === 'PICK' ? 'PK' : g}</span>;
}

/** A pick's label plus whose it was, so two "2028 1st"s can be told apart. */
export function fullName(v: Valuer, id: string) {
  const k = v.league.picks[id];
  const n = assetName(v.league, id);
  if (!k) return n;
  const owner = v.league.owner[id];
  return owner && owner !== k.orig ? `${n} (${teamName(v, k.orig)})` : n;
}

export function Asset({ id, sub = true }: { id: string; sub?: boolean }) {
  const { v } = useApp();
  const p = v.league.players[id];
  return (
    <div className="who">
      <PosTag v={v} id={id} />
      <div style={{ minWidth: 0 }}>
        <div className="who-n">
          {fullName(v, id)}{' '}
          {p?.inj && <span className="tag inj">{p.inj}</span>}
          {p && (p.slot === 'taxi' || (p.slot === 'ir' && p.inj !== 'IR')) && <span className="tag">{p.slot}</span>}
        </div>
        {sub && <div className="who-s">{assetSub(v.league, id)}</div>}
      </div>
    </div>
  );
}

export function Trend({ id }: { id: string }) {
  const { v } = useApp();
  const p = v.league.players[id];
  if (!p) return <span className="faint">—</span>;
  const t = p.trend;
  if (Math.abs(t) < 0.08) return <span className="trend faint">steady</span>;
  return (
    <span className={'trend ' + (t > 0 ? 'up' : 'down')} title={`Recent form ${p.form} ppg vs ${p.base} longer run`}>
      {t > 0 ? '▲ hot' : '▼ cold'} {pct(t)}
    </span>
  );
}

export function Delta({ value, base }: { value: number; base: number }) {
  if (!base) return null;
  const d = value / base - 1;
  if (Math.abs(d) < 0.01) return <span className="delta faint">even</span>;
  return <span className={'delta ' + (d > 0 ? 'up' : 'down')}>{pct(d)}</span>;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export const shortDate = (iso: string) =>
  new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
