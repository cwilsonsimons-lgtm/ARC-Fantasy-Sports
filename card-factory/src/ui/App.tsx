import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameState } from '../sim/types';
import { advanceWeek, newGame } from '../sim/game';
import { deserialize, serialize } from '../sim/save';
import { weekDate, weekLabel } from '../sim/league';
import { fmtInt, fmtMoney } from '../sim/format';
import { GameError } from '../sim/inventory';
import type { Ctx, Tab } from './common';
import { Dashboard } from './Dashboard';
import { SetCreator } from './SetCreator';
import { ProductBuilder } from './ProductBuilder';
import { Production } from './Production';
import { Market } from './Market';
import { CardDetail } from './CardDetail';
import { League } from './League';
import { NewsFinance } from './NewsFinance';
import { Saves } from './Saves';
import { browserStore, connectCloud, mirrored, type SaveStore } from './storage';

const NAV: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'sets', label: 'Set Creator' },
  { id: 'products', label: 'Boxes & Packs' },
  { id: 'production', label: 'Manufacturing' },
  { id: 'market', label: 'Market' },
  { id: 'league', label: 'League' },
  { id: 'news', label: 'News & Finance' },
  { id: 'saves', label: 'Saves' },
];

interface Toast {
  id: number;
  msg: string;
  tone: 'good' | 'bad';
}

const TAB_KEY = 'foil-ink-v1:tab';

function initialGame(boot: { save?: string }): { game: GameState; from: string } {
  if (boot.save) {
    try {
      return { game: deserialize(boot.save), from: 'live update' };
    } catch {
      /* fall through */
    }
  }
  return { game: newGame(Math.floor(Math.random() * 1e9)), from: '' };
}

export function App({ boot }: { boot: { save?: string } }) {
  const [{ game, from }] = useState(() => initialGame(boot));
  const [state, setState] = useState<GameState>(game);
  const gameRef = useRef(state);
  const dirty = useRef(!!from);
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return (window.localStorage.getItem(TAB_KEY) as Tab) || 'dashboard';
    } catch {
      return 'dashboard';
    }
  });
  const [sub, setSub] = useState<string | undefined>();
  const [card, setCard] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [store, setStore] = useState<SaveStore>(() => browserStore());
  const [saveStatus, setSaveStatus] = useState('');
  const [savedTick, setSavedTick] = useState(0);
  const [navOpen, setNavOpen] = useState(false);

  const toast = useCallback((msg: string, tone: 'good' | 'bad' = 'good') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-1), { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'bad' ? 6000 : 3000);
  }, []);

  const commit = useCallback((next: GameState) => {
    gameRef.current = next;
    setState(next);
  }, []);

  const act = useCallback<Ctx['act']>((fn, okMsg) => {
    try {
      const next = fn(gameRef.current);
      commit(next);
      dirty.current = true;
      if (okMsg) toast(okMsg);
      return true;
    } catch (e) {
      toast(e instanceof GameError || e instanceof Error ? e.message : String(e), 'bad');
      return false;
    }
  }, [commit, toast]);

  const go = useCallback((t: Tab, s?: string) => {
    setTab(t);
    if (s !== undefined) setSub(s);
    setNavOpen(false);
    try {
      window.localStorage.setItem(TAB_KEY, t);
    } catch {
      /* ignore */
    }
    window.scrollTo({ top: 0 });
  }, []);

  // Boot: resume the latest autosave from this browser, then from the cloud once it answers.
  useEffect(() => {
    let cancelled = false;
    const local = browserStore();
    if (!from) {
      local.read('autosave').then((g) => {
        if (!cancelled && !dirty.current) {
          commit(g);
          toast(`Resumed autosave · week ${g.week}`);
        }
      }).catch(() => undefined);
    }
    connectCloud().then(async (cloud) => {
      if (cancelled || !cloud) return;
      setStore(mirrored(cloud, local));
      try {
        const metas = await cloud.list();
        const auto = metas.find((m) => m.slot === 'autosave');
        const localMeta = (await local.list()).find((m) => m.slot === 'autosave');
        if (auto && !dirty.current && (!localMeta || auto.savedAt > localMeta.savedAt)) {
          const g = await cloud.read('autosave');
          if (!cancelled && !dirty.current) {
            commit(g);
            toast(`Resumed your cloud autosave · week ${g.week}`);
          }
        }
      } catch {
        /* cloud list failed; local saves still work */
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Autosave whenever a week passes or a set is manufactured.
  const saveKey = `${state.seed}:${state.week}:${state.sets.map((s) => s.status[0]).join('')}`;
  const firstKey = useRef(saveKey);
  useEffect(() => {
    if (saveKey === firstKey.current && !dirty.current) return;
    let live = true;
    setSaveStatus('Saving…');
    store.write('autosave', gameRef.current).then(
      () => {
        if (!live) return;
        setSaveStatus(`Autosaved wk ${gameRef.current.week}`);
        setSavedTick((n) => n + 1);
      },
      () => live && setSaveStatus('Autosave failed. Export a backup from Saves.'),
    );
    return () => {
      live = false;
    };
  }, [saveKey, store]);

  // Live-update hook: keep the game across a republish of this page.
  useEffect(() => {
    window.claude?.hot?.snapshot?.(() => ({ save: serialize(gameRef.current) }));
  }, []);

  const ctx: Ctx = useMemo(() => ({ game: state, act, openCard: setCard, go, toast }), [state, act, go, toast]);

  const advance = () => {
    const before = gameRef.current;
    if (act((g) => advanceWeek(g))) {
      const r = gameRef.current.reports[gameRef.current.reports.length - 1];
      const released = gameRef.current.sets.filter((s) => s.status === 'released' && before.sets.find((b) => b.id === s.id)?.status !== 'released');
      const parts = [`Week ${r.w}`];
      if (released.length) parts.push(`${released.map((s) => s.name).join(', ')} released`);
      parts.push(r.boxesSold ? `${fmtInt(r.boxesSold)} boxes sold` : 'no box sales');
      parts.push(`${fmtMoney(r.revenue - r.expenses, { cents: false, sign: true })}`);
      toast(parts.join(' · '));
    }
  };

  const load = (g: GameState, label: string) => {
    commit(g);
    dirty.current = true;
    toast(`Loaded ${label} · week ${g.week}`);
    go('dashboard');
  };

  const c = state.company;
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <div>
            <span className="brand-name">{c.name}</span>
            <span className="brand-sub">{weekLabel(state.week)} · {weekDate(state.week)}</span>
          </div>
        </div>
        <div className="topbar-stats">
          <span className="tb-stat"><span>Cash</span><b className={c.cash < 0 ? 'tone-bad' : ''}>{fmtMoney(c.cash, { cents: false })}</b></span>
          <span className="tb-stat"><span>Reputation</span><b>{c.reputation.toFixed(1)}</b></span>
          <span className="tb-stat tb-save" aria-live="polite">{saveStatus}</span>
        </div>
        <button className="btn btn-advance" onClick={advance}>
          Advance week <span aria-hidden="true">→</span>
        </button>
        <button className="btn btn-ghost nav-toggle" aria-expanded={navOpen} onClick={() => setNavOpen(!navOpen)}>Menu</button>
      </header>
      <nav className={`nav ${navOpen ? 'is-open' : ''}`} aria-label="Sections">
        {NAV.map((n) => (
          <button key={n.id} className={`nav-item ${tab === n.id ? 'is-active' : ''}`} aria-current={tab === n.id ? 'page' : undefined} onClick={() => go(n.id)}>
            {n.label}
            {n.id === 'news' && state.news.length > 0 && state.news[state.news.length - 1].w === state.week && <span className="nav-dot" aria-label="new" />}
          </button>
        ))}
      </nav>
      <main className="main">
        {tab === 'dashboard' && <Dashboard ctx={ctx} />}
        {tab === 'sets' && <SetCreator ctx={ctx} setId={sub} onSelect={(id) => setSub(id)} />}
        {tab === 'products' && <ProductBuilder ctx={ctx} setId={sub} onSelect={(id) => setSub(id)} />}
        {tab === 'production' && <Production ctx={ctx} />}
        {tab === 'market' && <Market ctx={ctx} />}
        {tab === 'league' && <League ctx={ctx} />}
        {tab === 'news' && <NewsFinance ctx={ctx} />}
        {tab === 'saves' && <Saves ctx={ctx} store={store} onLoad={load} savedTick={savedTick} onNewGame={(seed, name) => { commit(newGame(seed, name)); dirty.current = true; toast(`New game · seed ${seed}`); go('dashboard'); }} />}
      </main>
      {card && <CardDetail ctx={ctx} id={card} onClose={() => setCard(null)} />}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.tone}`}>{t.msg}</div>)}
      </div>
    </div>
  );
}
