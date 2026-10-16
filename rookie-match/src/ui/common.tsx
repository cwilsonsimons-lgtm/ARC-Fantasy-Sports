import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { formatHeight, parseHeight } from '../core/height';
import type { AppState } from '../core/state';

// ---- store ----

export interface Store {
  state: AppState;
  /** Applies a pure update. Throws whatever the update throws, leaving state unchanged. */
  apply: (fn: (s: AppState) => AppState) => AppState;
  replace: (s: AppState) => void;
}

export const StoreContext = createContext<Store | null>(null);
export const useStore = () => useContext(StoreContext)!;

export function useStoreState(initial: AppState): Store {
  const [state, setState] = useState(initial);
  const ref = useRef(initial);
  const apply = useCallback((fn: (s: AppState) => AppState) => {
    const next = fn(ref.current);
    ref.current = next;
    setState(next);
    return next;
  }, []);
  const replace = useCallback((s: AppState) => {
    ref.current = s;
    setState(s);
  }, []);
  return { state, apply, replace };
}

// ---- toasts ----

interface ToastData { id: number; text: string; action?: { label: string; run: () => void }; tone?: 'ok' | 'error' }
type Toaster = (text: string, opts?: { action?: ToastData['action']; tone?: ToastData['tone'] }) => void;
export const ToastContext = createContext<Toaster>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const next = useRef(1);
  const push = useCallback<Toaster>((text, opts) => {
    const id = next.current++;
    setToasts((t) => [...t.slice(-2), { id, text, ...opts }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts?.action ? 8000 : 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone === 'error' ? 'toast-error' : ''}`}>
            <span>{t.text}</span>
            {t.action && (
              <button className="btn btn-small btn-ghost-light" onClick={() => { t.action!.run(); setToasts((x) => x.filter((y) => y.id !== t.id)); }}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---- modal + confirm ----

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[autofocus], [data-autofocus], input, select, textarea, button.btn-primary');
    (first ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('modal-open'); prev?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

interface ConfirmOpts { title: string; body: React.ReactNode; confirmLabel: string; danger?: boolean }
type Confirmer = (o: ConfirmOpts) => Promise<boolean>;
const ConfirmContext = createContext<Confirmer>(async () => false);
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmHost({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback<Confirmer>((o) => new Promise((resolve) => setPending({ ...o, resolve })), []);
  const close = (v: boolean) => { pending?.resolve(v); setPending(null); };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <Modal
          title={pending.title}
          onClose={() => close(false)}
          footer={
            <>
              <button className="btn" onClick={() => close(false)}>Cancel</button>
              <button className={`btn ${pending.danger ? 'btn-danger' : 'btn-primary'}`} data-autofocus onClick={() => close(true)}>{pending.confirmLabel}</button>
            </>
          }
        >
          <div className="confirm-body">{pending.body}</div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

// ---- inputs ----

export function HeightField({ id, value, onChange, label = 'Height', inputRef, onEnter }: {
  id: string; value: string; onChange: (v: string) => void; label?: string; inputRef?: React.Ref<HTMLInputElement>; onEnter?: () => void;
}) {
  const parsed = value.trim() ? parseHeight(value) : null;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        ref={inputRef}
        className={parsed && !parsed.ok ? 'invalid' : ''}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); } }}
        placeholder={`6'3" or 6-3`}
        autoComplete="off"
        inputMode="text"
        aria-describedby={`${id}-hint`}
      />
      <div id={`${id}-hint`} className={`hint ${parsed && !parsed.ok ? 'hint-error' : ''}`}>
        {!parsed ? 'Feet-inches or total inches' : parsed.ok ? <>= <b>{formatHeight(parsed.value)}</b> ({parsed.value} in){parsed.warning && <span className="hint-warn"> · {parsed.warning}</span>}</> : parsed.error}
      </div>
    </div>
  );
}

export function PositionSelect({ id, value, onChange, positions, allowAll, label = 'Position', selectRef, onEnter }: {
  id: string; value: string; onChange: (v: string) => void; positions: string[]; allowAll?: string; label?: string;
  selectRef?: React.Ref<HTMLSelectElement>; onEnter?: () => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} ref={selectRef} value={value} onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); } }}>
        {allowAll !== undefined ? <option value="">{allowAll}</option> : <option value="" disabled>Choose…</option>}
        {positions.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
    </div>
  );
}

// ---- files ----

/**
 * Offers a generated file. Inside claude.ai the page can't start downloads itself,
 * so it asks through the `downloads` capability (the viewer confirms); the
 * standalone file uses an ordinary download link.
 */
export function useDownload() {
  const toast = useToast();
  return useCallback(async (filename: string, text: string, type: string) => {
    const host = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
    if (!host || typeof host.use !== 'function') { download(filename, text, type); return; }
    const d = (await host.use('downloads')) as { save(r: { filename: string; data: string }): Promise<{ status: string }> } | null;
    if (!d) { toast("Saving files isn't available in this view. Open the page in claude.ai to save files.", { tone: 'error' }); return; }
    try {
      const r = await d.save({ filename, data: text });
      if (r.status === 'saved') toast(`Saved ${filename}.`);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'declined') return;
      toast(code === 'rate_limited' ? 'Another save is already waiting for you. Finish it, then try again.' : `Couldn't save ${filename}.`, { tone: 'error' });
    }
  }, [toast]);
}

function download(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFile(file: File): Promise<string> {
  return file.text();
}

export const today = () => new Date().toISOString().slice(0, 10);

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
