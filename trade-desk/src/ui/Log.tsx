import React, { useState } from 'react';
import type { Outcome, TradeLog } from '../core/types';
import { Empty, fullName, shortDate, useApp, who } from './common';
import { OUTCOME_LABEL } from './Lab';

function Pieces({ ids }: { ids: string[] }) {
  const { v, openAsset } = useApp();
  if (!ids.length) return <span className="faint">nothing</span>;
  return (
    <span>
      {ids.map((id, i) => (
        <React.Fragment key={id}>
          {i > 0 && ', '}
          <a
            href={'#' + 'log'}
            onClick={(e) => {
              e.preventDefault();
              openAsset(id);
            }}
            style={{ color: 'inherit' }}
          >
            {fullName(v, id)}
          </a>
        </React.Fragment>
      ))}
    </span>
  );
}

function Row({ t }: { t: TradeLog }) {
  const { v, saveTrade, dropTrade, openLab, canWrite, toast } = useApp();
  const [confirm, setConfirm] = useState(false);
  const league = t.source === 'sleeper';
  const a = who(v, t.team, true);
  const b = t.with === v.me ? 'You' : who(v, t.with, true);
  return (
    <div className="log-row">
      <div className="log-top">
        <span className={'oc oc-' + t.outcome}>{OUTCOME_LABEL[t.outcome]}</span>
        <b>{league ? `${a} ↔ ${b}` : `Offer to ${a}`}</b>
        <span className="faint" style={{ fontSize: 12 }}>
          {shortDate(t.ts)}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {!league && canWrite && (
            <select
              className="select"
              style={{ width: 'auto', padding: '3px 8px', fontSize: 12 }}
              aria-label="Outcome"
              value={t.outcome}
              onChange={async (e) => {
                await saveTrade({ ...t, outcome: e.target.value as Outcome });
                toast('Outcome updated.');
              }}
            >
              {(['pending', 'rejected', 'countered', 'accepted', 'offered'] as Outcome[]).map((o) => (
                <option key={o} value={o}>
                  {OUTCOME_LABEL[o]}
                </option>
              ))}
            </select>
          )}
          {!league && (
            <button className="btn small" onClick={() => openLab({ team: t.team, send: t.get, receive: t.give })}>
              Reopen
            </button>
          )}
          {canWrite &&
            (confirm ? (
              <>
                <button
                  className="btn small danger"
                  onClick={async () => {
                    await dropTrade(t.id);
                    toast('Removed. What it taught the desk is gone too.');
                  }}
                >
                  Remove
                </button>
                <button className="btn small" onClick={() => setConfirm(false)}>
                  Keep
                </button>
              </>
            ) : (
              <button className="btn small" onClick={() => setConfirm(true)} aria-label="Remove this entry">
                ✕
              </button>
            ))}
        </div>
      </div>
      <div className="log-sides">
        <div>
          <span className="muted">{league ? `${a} got` : 'You asked for'}: </span>
          <Pieces ids={league ? t.get : t.give} />
        </div>
        <div>
          <span className="muted">{league ? `${b} got` : 'You offered'}: </span>
          <Pieces ids={league ? t.give : t.get} />
        </div>
      </div>
      {t.note && <div className="faint" style={{ fontSize: 12 }}>“{t.note}”</div>}
    </div>
  );
}

export function Log() {
  const { data } = useApp();
  const [filter, setFilter] = useState<'all' | 'mine' | 'league'>('all');
  const rows = [...data.trades]
    .filter((t) => filter === 'all' || (filter === 'league') === (t.source === 'sleeper'))
    .sort((a, b) => b.ts.localeCompare(a.ts));
  return (
    <section className="panel">
      <div className="panel-h">
        <h2>Trade log</h2>
        <span className="sub">Everything the desk learns from. Recent answers count most; after about two months an answer counts half.</span>
        <div className="right">
          <div className="seg" role="group" aria-label="Filter">
            {(['all', 'mine', 'league'] as const).map((f) => (
              <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === 'all' ? 'All' : f === 'mine' ? 'Your offers' : 'League trades'}
              </button>
            ))}
          </div>
        </div>
      </div>
      {rows.length ? (
        rows.map((t) => <Row key={t.id} t={t} />)
      ) : (
        <Empty title="No offers logged">
          <p className="note">Build an offer in the Trade lab and log the answer. League trades arrive with every sync.</p>
        </Empty>
      )}
    </section>
  );
}
