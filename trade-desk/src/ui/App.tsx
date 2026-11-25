import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildValuer } from '../core/model';
import { fitLearned } from '../core/trade';
import { takeSnapshot } from '../core/history';
import { emptySettings, type Settings, type TradeLog } from '../core/types';
import { AppCtx, Empty, shortDate, type Ctx, type LabState } from './common';
import { explainMcp, subscribe, syncFromStatsDeck, useCapability, writes, type Data, type DB, type Status } from './runtime';
import { MyTeam } from './MyTeam';
import { Lab } from './Lab';
import { Find } from './Find';
import { League, TeamBoard } from './League';
import { Log } from './Log';
import { Rankings } from './Rankings';
import { DataView } from './DataView';
import { PlayerSheet } from './PlayerSheet';

const TABS: [string, string][] = [
  ['roster', 'My team'],
  ['rankings', 'Rankings'],
  ['lab', 'Trade lab'],
  ['find', 'Find a trade'],
  ['league', 'League'],
  ['log', 'Log'],
  ['data', 'Data'],
];

const readHash = () => {
  const h = location.hash.replace(/^#/, '');
  return /^[a-z0-9-]+$/.test(h) ? h : 'roster';
};

export function App() {
  const [route, setRoute] = useState(readHash);
  const [db, setDb] = useState<DB | null>(null);
  const [status, setStatus] = useState<Status>({ phase: 'loading' });
  const [canWrite, setCanWrite] = useState(true);
  const [data, setData] = useState<Data>({ league: null, settings: emptySettings(), trades: [], history: [], rebuilt: {} });
  const [sheet, setSheet] = useState<string | null>(null);
  const [lab, setLab] = useState<LabState>({ team: '', send: [], receive: [] });
  const [toastMsg, setToast] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const toastTimer = useRef<number>();
  // Settings writes go out one at a time; a burst of edits collapses into the latest.
  const settingsQueue = useRef<{ busy: boolean; next: Settings | null; waiters: (() => void)[] }>({ busy: false, next: null, waiters: [] });

  useEffect(() => {
    const on = () => setRoute(readHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let alive = true;
    (async () => {
      const [d, user] = await Promise.all([useCapability<DB>('db'), useCapability<any>('user')]);
      if (!alive) return;
      if (!d) return setStatus({ phase: 'nodb' });
      setDb(d);
      try {
        const edit = await user?.canEdit?.();
        if (edit === false) setCanWrite(false);
      } catch {
        /* not told: keep the controls, a refused write will say so */
      }
      unsub = subscribe(
        d,
        (patch) => {
          // While our own settings writes are going out, the store echoes older versions; skip those.
          if (patch.settings && settingsQueue.current.busy) {
            const { settings: _skip, ...rest } = patch;
            void _skip;
            if (!Object.keys(rest).length) return;
            patch = rest;
          }
          setData((cur) => ({ ...cur, ...patch }));
        },
        setStatus,
      );
    })();
    return () => {
      alive = false;
      unsub?.();
    };
  }, []);

  const toast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const guard = useCallback(
    async (fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e: any) {
        if (e?.code === 'invalid_argument') {
          setCanWrite(false);
          toast('This page is read-only for you, so changes are not saved.');
        } else if (e?.code === 'quota_exceeded') toast('Saved data is full. Remove old log entries or value readings.');
        else toast('That change could not be saved. Try again.');
        throw e;
      }
    },
    [toast],
  );

  const learned = useMemo(() => (data.league ? fitLearned(data.league, data.settings, data.trades) : null), [data.league, data.settings, data.trades]);
  const v = useMemo(() => (data.league && learned ? buildValuer(data.league, data.settings, learned) : null), [data.league, data.settings, learned]);

  const go = (r: string) => {
    location.hash = r;
    setRoute(r);
    window.scrollTo(0, 0);
  };

  const sync = async () => {
    if (!db) return;
    setSyncError(null);
    setSyncing('Starting');
    try {
      const { league, trades } = await syncFromStatsDeck(setSyncing);
      setSyncing('Saving');
      await guard(() => writes.league(db, league));
      const known = new Set(data.trades.map((t) => t.id));
      for (const t of trades) if (!known.has(t.id)) await guard(() => writes.trade(db, t));
      const all = [...data.trades.filter((t) => !trades.some((n) => n.id === t.id)), ...trades];
      const val = buildValuer(league, data.settings, fitLearned(league, data.settings, all));
      await guard(() => writes.snapshot(db, takeSnapshot(val, league.asOf)));
      const fresh = trades.filter((t) => !known.has(t.id)).length;
      toast(`Synced ${league.teams.length} teams${fresh ? `, ${fresh} new league trade${fresh > 1 ? 's' : ''}` : ''}.`);
    } catch (e) {
      setSyncError(explainMcp(e));
    } finally {
      setSyncing(null);
    }
  };

  if (!v || !data.league) {
    return (
      <>
        <Header route={route} go={go} />
        <main>
          {status.phase === 'nodb' ? (
            <Empty title="Open this on claude.ai">
              <p className="note">Trade Desk saves your league, offers and value history to your account. Open the published page on claude.ai to use it.</p>
            </Empty>
          ) : status.phase === 'loading' || (status.phase === 'slow' && !data.league) ? (
            <Empty title="Loading your league">
              <p className="note">{status.phase === 'slow' ? status.message : 'Reading rosters, offers and value history.'}</p>
            </Empty>
          ) : status.phase === 'error' ? (
            <Empty title="Can't read saved data">
              <p className="note">{status.message}</p>
            </Empty>
          ) : (
            <Empty title="No league yet">
              <p className="note">Sync once to read every roster, record, pick and league trade from Sleeper through the StatsDeck connector.</p>
              <button className="btn primary" onClick={sync} disabled={!!syncing || !canWrite}>
                {syncing ? syncing + '…' : 'Sync from Sleeper'}
              </button>
              {syncError && <div className="banner bad">{syncError}</div>}
            </Empty>
          )}
        </main>
      </>
    );
  }

  const ctx: Ctx = {
    v,
    data,
    db,
    canWrite,
    lab,
    setLab,
    toast,
    go,
    openAsset: setSheet,
    openTeam: (id) => go('league-' + id),
    openLab: (s) => {
      setLab({ team: s.team ?? lab.team, send: s.send ?? [], receive: s.receive ?? [] });
      setSheet(null);
      go('lab');
    },
    saveSettings: (s: Settings) => {
      // Show the change at once; the store's snapshot confirms it.
      setData((cur) => ({ ...cur, settings: s }));
      const q = settingsQueue.current;
      q.next = s;
      const done = new Promise<void>((res) => q.waiters.push(res));
      if (!q.busy) {
        q.busy = true;
        (async () => {
          while (q.next) {
            const s2 = q.next;
            q.next = null;
            const waiters = q.waiters.splice(0);
            try {
              await guard(() => writes.settings(db!, s2));
            } catch {
              /* guard already told the viewer */
            }
            waiters.forEach((w) => w());
          }
          q.busy = false;
        })();
      }
      return done;
    },
    saveTrade: (t: TradeLog) => guard(() => writes.trade(db!, t)),
    dropTrade: (id: string) => guard(() => writes.dropTrade(db!, id)),
  };

  const board = /^league-(.+)$/.exec(route)?.[1];
  const view =
    route === 'lab' ? (
      <Lab />
    ) : route === 'rankings' ? (
      <Rankings />
    ) : route === 'find' ? (
      <Find />
    ) : board ? (
      <TeamBoard team={board} />
    ) : route === 'league' ? (
      <League />
    ) : route === 'log' ? (
      <Log />
    ) : route === 'data' ? (
      <DataView sync={sync} syncing={syncing} syncError={syncError} />
    ) : (
      <MyTeam />
    );

  return (
    <AppCtx.Provider value={ctx}>
      <Header route={board ? 'league' : route} go={go} asOf={data.league.asOf} league={data.league.name} sync={sync} syncing={syncing} canWrite={canWrite} />
      <main>
        {status.phase === 'slow' && <div className="banner">{status.message}</div>}
        {syncError && route !== 'data' && (
          <div className="banner bad">
            {syncError}
            <button className="btn small" onClick={() => setSyncError(null)}>
              Dismiss
            </button>
          </div>
        )}
        {view}
      </main>
      {sheet && <PlayerSheet id={sheet} onClose={() => setSheet(null)} />}
      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}
    </AppCtx.Provider>
  );
}

function Header({
  route,
  go,
  asOf,
  league,
  sync,
  syncing,
  canWrite,
}: {
  route: string;
  go: (r: string) => void;
  asOf?: string;
  league?: string;
  sync?: () => void;
  syncing?: string | null;
  canWrite?: boolean;
}) {
  return (
    <header className="top">
      <div className="top-in">
        <div className="brand">
          <div className="wordmark">
            Trade Desk <small>{league ?? 'City Boys Dynasty'}</small>
          </div>
          {asOf && (
            <div className="asof">
              <span>Rosters {shortDate(asOf)}</span>
              {sync && (
                <button className="btn small" onClick={sync} disabled={!!syncing || !canWrite} title="Read rosters and league trades again">
                  {syncing ? 'Syncing…' : 'Sync'}
                </button>
              )}
            </div>
          )}
        </div>
        <nav className="tabs" aria-label="Sections">
          {TABS.map(([r, label]) => (
            <button key={r} className="tab" aria-current={route === r ? 'page' : undefined} onClick={() => go(r)}>
              {label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}
