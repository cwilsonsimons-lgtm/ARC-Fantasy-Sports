import React, { useMemo, useState } from 'react';
import { parseMarket } from '../core/ktc';
import { fmt, shortDate, useApp } from './common';

export function DataView({ sync, syncing, syncError }: { sync: () => void; syncing: string | null; syncError: string | null }) {
  const { v, data, saveSettings, canWrite, toast } = useApp();
  const [text, setText] = useState('');
  const parsed = useMemo(() => (text.trim() ? parseMarket(text, v.league) : null), [text, v.league]);
  const overrides = Object.keys(v.settings.market).length;
  const playerCount = Object.keys(v.league.owner).filter((id) => v.league.players[id]).length;

  return (
    <div className="cols">
      <section className="panel">
        <div className="panel-h">
          <h2>Rosters</h2>
          <span className="sub">From Sleeper, through the StatsDeck connector</span>
        </div>
        <div className="panel-b" style={{ display: 'grid', gap: 12 }}>
          <div className="kv">
            <span className="muted">Last read</span>
            <span>{new Date(v.league.asOf).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
          </div>
          <div className="kv">
            <span className="muted">Rostered players · picks</span>
            <span className="num">
              {playerCount} · {Object.keys(v.league.owner).length - playerCount}
            </span>
          </div>
          <div className="kv">
            <span className="muted">Value readings saved</span>
            <span className="num">
              {data.history.length}
              {data.history.length ? ` (since ${shortDate([...data.history].sort((a, b) => a.date.localeCompare(b.date))[0].date)})` : ''}
            </span>
          </div>
          <p className="note">Syncing reads every roster, record and league trade, then saves today's values for every team. Sync weekly (after Monday night) and the value history fills in.</p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={sync} disabled={!!syncing || !canWrite}>
              {syncing ? 'Syncing…' : 'Sync from Sleeper'}
            </button>
            {syncing && <span className="muted" style={{ fontSize: 13 }}>{syncing}</span>}
          </div>
          {syncError && <div className="banner bad">{syncError}</div>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-h">
          <h2>Market values</h2>
          <span className="sub">{overrides ? `${overrides} from ${v.settings.marketSource ?? 'a paste'}${v.settings.marketAsOf ? ', ' + shortDate(v.settings.marketAsOf) : ''}` : 'Using the desk’s production model'}</span>
        </div>
        <div className="panel-b" style={{ display: 'grid', gap: 10 }}>
          <p className="note">
            To price off KeepTradeCut instead, open{' '}
            <a href="https://keeptradecut.com/dynasty-rankings?format=2" target="_blank" rel="noreferrer">
              KTC's superflex dynasty rankings
            </a>
            , select the list, copy and paste it here. Players are matched by name. Anyone not on the list keeps the model value.
          </p>
          <textarea className="textarea" id="ktc-paste" value={text} onChange={(e) => setText(e.target.value)} placeholder={'1\nJosh Allen\nBUF\nQB1\n30.5 y.o.\n9999\n…'} aria-label="Pasted rankings" />
          {parsed && (
            <div className="muted" style={{ fontSize: 13 }}>
              Matched <b>{parsed.matched.length}</b> league players and <b>{Object.keys(parsed.values).length - parsed.matched.length}</b> picks.
              {parsed.matched.length > 0 &&
                ' e.g. ' +
                  parsed.matched
                    .slice(0, 3)
                    .map((m) => `${m.name} ${fmt(m.value)}`)
                    .join(', ')}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn primary"
              disabled={!parsed || !Object.keys(parsed.values).length || !canWrite}
              onClick={async () => {
                await saveSettings({ ...v.settings, market: { ...v.settings.market, ...parsed!.values }, marketAsOf: new Date().toISOString(), marketSource: 'KeepTradeCut' });
                setText('');
                toast(`Market updated for ${Object.keys(parsed!.values).length} players and picks.`);
              }}
            >
              Use these values
            </button>
            {overrides > 0 && (
              <button
                className="btn"
                disabled={!canWrite}
                onClick={async () => {
                  await saveSettings({ ...v.settings, market: {}, marketAsOf: undefined, marketSource: undefined });
                  toast('Back to the production model.');
                }}
              >
                Go back to the model
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="panel" style={{ gridColumn: '1 / -1' }}>
        <div className="panel-h">
          <h2>How the numbers work</h2>
        </div>
        <div className="panel-b howto">
          <p>
            <b>Market value</b> is on KeepTradeCut's 0–10,000 scale. By default it comes from points per game above a replacement starter in this league (10 teams, superflex), stretched over
            the seasons a player has left at his age and position. Recent games count, but the market only believes half of a hot streak.
          </p>
          <p>
            <b>Each team's value</b> starts from market and moves for: how hard that manager chases streaks (and owners always believe their own guy's), how thin the team is at the position and
            whether he'd start there, whether they're contending (pay for veterans) or rebuilding (pay for youth and picks), the bump managers give their own players, and anything you set by hand.
          </p>
          <p>
            <b>Learning.</b> When a team turns down an offer, the desk raises what they kept and lowers what you offered, in their eyes only, by enough to explain the no. A yes does the opposite.
            Completed league trades teach both teams. One answer moves a value by up to about 20%, older answers fade, and removing a log entry removes its lesson.
          </p>
          <p>
            <b>Packages</b> add on a curve, so the best player in a deal counts for more than the depth around him. The chance of a yes compares what they get with what they give, in their eyes.
          </p>
        </div>
      </section>
    </div>
  );
}
