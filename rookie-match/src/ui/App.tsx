import React, { useEffect, useState } from 'react';
import { activeWorkspace, counts, switchWorkspace } from '../core/state';
import { loadState, saveState } from '../core/storage';
import { ConfirmHost, StoreContext, ToastHost, useStore, useStoreState } from './common';
import { emptyForm, FindMatch, type FindForm } from './FindMatch';
import { Pool } from './Pool';
import { History } from './History';
import { SettingsPage } from './SettingsPage';

type Tab = 'find' | 'pool' | 'history' | 'settings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'find', label: 'Find a Match' },
  { id: 'pool', label: 'Prospect Pool' },
  { id: 'history', label: 'Assignment History' },
  { id: 'settings', label: 'Settings & Data' },
];

const initial = loadState();

export function App() {
  const store = useStoreState(initial.state);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadNote, setLoadNote] = useState(initial.message ?? null);

  useEffect(() => { setSaveError(saveState(store.state)); }, [store.state]);

  return (
    <StoreContext.Provider value={store}>
      <ToastHost>
        <ConfirmHost>
          <Shell saveError={saveError} loadNote={loadNote} dismissLoadNote={() => setLoadNote(null)} />
        </ConfirmHost>
      </ToastHost>
    </StoreContext.Provider>
  );
}

function readTab(): Tab {
  const h = location.hash.replace('#', '');
  return (TABS.some((t) => t.id === h) ? h : 'find') as Tab;
}

function Shell({ saveError, loadNote, dismissLoadNote }: { saveError: string | null; loadNote: string | null; dismissLoadNote: () => void }) {
  const { state, apply } = useStore();
  const [tab, setTabState] = useState<Tab>(readTab);
  const [form, setForm] = useState<FindForm>(emptyForm);
  const ws = activeWorkspace(state);
  const c = counts(ws);

  const setTab = (t: Tab) => {
    setTabState(t);
    try { history.replaceState(null, '', `#${t}`); } catch { /* sandboxed frames may refuse */ }
  };

  useEffect(() => {
    const onHash = () => setTabState(readTab());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">RM</span>
            <span className="brand-name">Rookie Match</span>
          </div>
          <div className="ws-picker">
            <label htmlFor="ws-select" className="sr-only">Active workspace</label>
            <select id="ws-select" value={ws.id} onChange={(e) => { apply((s) => switchWorkspace(s, e.target.value)); setForm(emptyForm); }}>
              {state.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="counts" aria-label="Prospect counts">
            <span className="count"><b>{c.total}</b> total</span>
            <span className="count count-avail"><b>{c.available}</b> available</span>
            <span className="count count-used"><b>{c.used}</b> used</span>
          </div>
        </div>
        <nav className="tabs" aria-label="Sections">
          <div className="tabs-inner">
            {TABS.map((t) => (
              <button key={t.id} className={`tab ${tab === t.id ? 'tab-active' : ''}`} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
                {t.label}
                {t.id === 'history' && ws.assignments.length > 0 && <span className="tab-count">{ws.assignments.length}</span>}
              </button>
            ))}
          </div>
        </nav>
      </header>

      <main className="main">
        {saveError && <div className="notice notice-error" role="alert">{saveError}</div>}
        {loadNote && (
          <div className="notice notice-warn" role="alert">
            {loadNote} <button className="btn btn-small" onClick={dismissLoadNote}>Dismiss</button>
          </div>
        )}
        {tab === 'find' && <FindMatch form={form} setForm={setForm} />}
        {tab === 'pool' && <Pool />}
        {tab === 'history' && <History />}
        {tab === 'settings' && <SettingsPage />}
      </main>

      <footer className="footer">
        Saved in this browser on this device only. <button className="link" onClick={() => setTab('settings')}>Back up your data</button> to keep it safe or move it.
      </footer>
    </div>
  );
}
