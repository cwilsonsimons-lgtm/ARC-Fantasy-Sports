import React, { useMemo, useState } from 'react';
import { balance, likelihoodLabel, mySide, readTrade, type Read, type Side } from '../core/trade';
import type { Factors } from '../core/model';
import type { Outcome, TradeLog } from '../core/types';
import { Asset, fmt, fullName, pct, signed, useApp, who } from './common';

const meterColor = (p: number) => (p >= 0.6 ? 'var(--up)' : p >= 0.4 ? 'var(--warn)' : 'var(--down)');

function Picker({ team, chosen, onToggle, title }: { team: string; chosen: string[]; onToggle: (id: string) => void; title: string }) {
  const { v } = useApp();
  const [q, setQ] = useState('');
  const ids = Object.entries(v.league.owner)
    .filter(([, t]) => t === team)
    .map(([id]) => id)
    .filter((id) => !q || fullName(v, id).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => v.value(team, b) - v.value(team, a));
  return (
    <section className="panel">
      <div className="panel-h">
        <h2>{title}</h2>
        <div className="right" style={{ flex: '1 1 160px' }}>
          <input className="input" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${title}`} id={`search-${team}`} />
        </div>
      </div>
      <div className="basket" aria-live="polite">
        {chosen.length === 0 && <span className="faint" style={{ fontSize: 12 }}>Nothing yet. Tick players or picks below.</span>}
        {chosen.map((id) => (
          <span className="bchip" key={id}>
            {fullName(v, id)}
            <button aria-label={`Remove ${fullName(v, id)}`} onClick={() => onToggle(id)}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="picker-list" role="listbox" aria-multiselectable="true">
        {ids.map((id) => {
          const on = chosen.includes(id);
          return (
            <div key={id} className="pick-row" role="option" aria-checked={on} aria-selected={on} onClick={() => onToggle(id)}>
              <input type="checkbox" checked={on} readOnly tabIndex={-1} aria-hidden="true" />
              <Asset id={id} />
              <span className="num">{fmt(v.value(team, id))}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** The one or two reasons a team's number differs most from the market. */
export function reasons(f: Factors): { text: string; up: boolean }[] {
  const items: [string, number][] = [
    ['hot/cold streak', f.hype],
    ['positional need', f.need],
    ['contend/rebuild', f.window],
    ['owns him', f.endowment],
    ['past trades', f.learned],
    ['your note', f.nudge],
  ];
  return items
    .filter(([, x]) => Math.abs(x - 1) >= 0.025)
    .sort((a, b) => Math.abs(b[1] - 1) - Math.abs(a[1] - 1))
    .slice(0, 2)
    .map(([t, x]) => ({ text: `${t} ${pct(x - 1)}`, up: x > 1 }));
}

export function FactorChips({ f }: { f: Factors }) {
  if (f.set) return <span className="factor pos-f" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>your ranking</span>;
  const r = reasons(f);
  if (!r.length) return <span className="faint" style={{ fontSize: 11 }}>at market</span>;
  return (
    <span className="factors">
      {r.map((x) => (
        <span key={x.text} className={'factor ' + (x.up ? 'pos-f' : 'neg-f')}>
          {x.text}
        </span>
      ))}
    </span>
  );
}

function ViewCard({ title, read, giveLabel, getLabel }: { title: string; read: Read; giveLabel: string; getLabel: string }) {
  return (
    <div className="view">
      <h3>{title}</h3>
      <div className="kv">
        <span className="muted">{getLabel}</span>
        <span className="num">{fmt(read.getValue)}</span>
      </div>
      <div className="kv">
        <span className="muted">{giveLabel}</span>
        <span className="num">{fmt(read.giveValue)}</span>
      </div>
      <div className="kv" style={{ borderTop: '1px solid var(--line)', marginTop: 4, paddingTop: 6 }}>
        <span>Net</span>
        <span className={'num ' + (read.edge >= 0 ? 'up' : 'down')}>{signed(read.edge)}</span>
      </div>
    </div>
  );
}

export function Lab() {
  const { v, lab, setLab, saveTrade, toast, canWrite, openAsset } = useApp();
  const others = v.league.teams.filter((t) => t.id !== v.me);
  const team = lab.team && lab.team !== v.me ? lab.team : others[0]?.id;
  const side: Side = { team, give: lab.receive, get: lab.send };
  const has = side.give.length > 0 || side.get.length > 0;
  const them = useMemo(() => readTrade(v, side), [v, team, lab.send.join(), lab.receive.join()]);
  const mine = useMemo(() => readTrade(v, mySide(v, side)), [v, team, lab.send.join(), lab.receive.join()]);
  const fixes = useMemo(() => (has && side.give.length && side.get.length ? balance(v, side) : []), [v, team, lab.send.join(), lab.receive.join()]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const toggle = (key: 'send' | 'receive') => (id: string) => {
    const cur = lab[key];
    setLab({ ...lab, team, [key]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };

  const log = async (outcome: Outcome) => {
    setSaving(true);
    const t: TradeLog = {
      id: 'm-' + Date.now().toString(36),
      ts: new Date().toISOString(),
      team,
      with: v.me,
      give: side.give,
      get: side.get,
      outcome,
      source: 'manual',
      ...(note.trim() ? { note: note.trim().slice(0, 300) } : {}),
    };
    try {
      await saveTrade(t);
      setNote('');
      toast(
        outcome === 'pending'
          ? 'Saved as sent. Mark it once they answer.'
          : `Logged as ${OUTCOME_LABEL[outcome].toLowerCase()}. ${who(v, team, true)}'s values are updated.`,
      );
    } catch {
      toast('That offer could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <section className="panel">
        <div className="panel-h">
          <h2>Trade lab</h2>
          <span className="sub">Each side is priced in that team's own eyes</span>
          <div className="right" style={{ flex: '1 1 220px' }}>
            <label className="field" style={{ flex: 1 }}>
              <span>Trading with</span>
              <select id="lab-team" className="select" value={team} onChange={(e) => setLab({ team: e.target.value, send: lab.send, receive: [] })}>
                {others.map((t) => (
                  <option key={t.id} value={t.id}>
                    {who(v, t.id)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {!has ? (
          <div className="panel-b">
            <p className="note">Pick what you'd send and what you want back. The read updates as you go, and suggests the cheapest way to get a no to a yes.</p>
          </div>
        ) : (
          <>
            <div className="verdict">
              <div className="view" style={{ gridColumn: '1 / -1', background: 'var(--surface)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                  <span className="big">{Math.round(them.p * 100)}%</span>
                  <span className="lik" style={{ color: meterColor(them.p) }}>
                    {likelihoodLabel(them.p)}
                  </span>
                  <span className="muted" style={{ fontSize: 13 }}>
                    chance {who(v, team, true)} accepts
                  </span>
                </div>
                <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(them.p * 100)} aria-label="Chance they accept">
                  <span style={{ width: `${them.p * 100}%`, background: meterColor(them.p) }} />
                </div>
                {them.margin > 0.05 && <div className="faint" style={{ fontSize: 12 }}>Their past trades say they want a clear win before they say yes.</div>}
              </div>
              <ViewCard title={`${who(v, team, true)}'s view`} read={them} getLabel="They get" giveLabel="They give" />
              <ViewCard title="Your view" read={mine} getLabel="You get" giveLabel="You give" />
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>In the deal</th>
                    <th className="r">Market</th>
                    <th className="r">Them</th>
                    <th className="r">You</th>
                    <th className="hide-sm">Why they differ</th>
                  </tr>
                </thead>
                <tbody>
                  {[...side.get.map((id) => ({ id, dir: 'You send' })), ...side.give.map((id) => ({ id, dir: 'You get' }))].map(({ id, dir }) => (
                    <tr key={id} onClick={() => openAsset(id)}>
                      <td>
                        <div className="who-s" style={{ marginBottom: 2 }}>
                          {dir}
                        </div>
                        <Asset id={id} sub={false} />
                      </td>
                      <td className="r num">{fmt(v.market(id))}</td>
                      <td className="r num">{fmt(v.value(team, id))}</td>
                      <td className="r num">{fmt(v.value(v.me, id))}</td>
                      <td className="hide-sm">
                        <FactorChips f={v.explain(team, id)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {fixes.length > 0 && (
              <div className="panel-b" style={{ borderTop: '1px solid var(--line-2)' }}>
                <div className="h2" style={{ fontSize: 14, marginBottom: 8 }}>
                  {fixes[0].kind === 'add' ? 'Get it to a yes' : 'Room to ask for more'}
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {fixes.map((f) => (
                    <div key={f.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        className="btn small"
                        onClick={() =>
                          setLab(f.kind === 'add' ? { ...lab, team, send: [...lab.send, f.id] } : { ...lab, team, receive: [...lab.receive, f.id] })
                        }
                      >
                        {f.kind === 'add' ? 'Add' : 'Ask for'} {fullName(v, f.id)}
                      </button>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {Math.round(f.read.p * 100)}% yes · your net <span className={'num ' + (f.mine.edge >= 0 ? 'up' : 'down')}>{signed(f.mine.edge)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="panel-b" style={{ borderTop: '1px solid var(--line-2)', display: 'grid', gap: 10 }}>
              <div className="h2" style={{ fontSize: 14 }}>
                Log what happened
              </div>
              <p className="note">A no tells the desk they value what they kept more than you thought. Logging it moves their numbers, and every future read for them.</p>
              <input className="input" id="lab-note" placeholder="Note (optional), e.g. said he's not selling his rookies" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="outcomes">
                {(['rejected', 'countered', 'accepted', 'offered', 'pending'] as Outcome[]).map((o) => (
                  <button key={o} className={'btn' + (o === 'rejected' ? ' primary' : '')} disabled={!canWrite || saving || !side.give.length || !side.get.length} onClick={() => log(o)}>
                    {OUTCOME_VERB[o]}
                  </button>
                ))}
                <button className="btn" onClick={() => setLab({ team, send: [], receive: [] })}>
                  Clear
                </button>
              </div>
              {!canWrite && <span className="faint" style={{ fontSize: 12 }}>Logging needs edit access to this page.</span>}
            </div>
          </>
        )}
      </section>
      <div className="lab">
        <Picker team={v.me} chosen={lab.send} onToggle={toggle('send')} title="You send" />
        <Picker team={team} chosen={lab.receive} onToggle={toggle('receive')} title={`You get from ${who(v, team, true)}`} />
      </div>
    </>
  );
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  rejected: 'Rejected',
  countered: 'Countered',
  accepted: 'Accepted',
  offered: 'Their offer',
  pending: 'Sent',
  completed: 'League trade',
};
const OUTCOME_VERB: Record<Outcome, string> = {
  rejected: 'They said no',
  countered: 'They countered',
  accepted: 'They said yes',
  offered: 'They offered this',
  pending: 'Sent, no answer yet',
  completed: 'League trade',
};
