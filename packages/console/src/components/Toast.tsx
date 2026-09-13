import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastKind = "info" | "success" | "warning" | "danger";

interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string | undefined;
}

interface ToastContextValue {
  /** Pop a transient result in the corner — a rental confirmed, a payment
   *  refused, a stream reconnecting. For anything the user needs to keep
   *  seeing while it's true, use a Banner instead. */
  notify: (kind: ToastKind, title: string, detail?: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const ICON: Record<ToastKind, string> = {
  info: "i",
  success: "✓",
  warning: "!",
  danger: "✕",
};

const LIVE_MS = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (kind: ToastKind, title: string, detail?: string) => {
      const id = nextId.current++;
      setItems((prev) => [...prev, { id, kind, title, detail }]);
      window.setTimeout(() => dismiss(id), LIVE_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div className={`toast toast--${t.kind}`} key={t.id}>
            <span className="toast__icon" aria-hidden="true">
              {ICON[t.kind]}
            </span>
            <div className="toast__body">
              <p className="toast__title">{t.title}</p>
              {t.detail && <p className="toast__detail">{t.detail}</p>}
            </div>
            <button className="toast__close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Fire a toast from anywhere inside `<ToastProvider>`. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be called within a ToastProvider");
  return ctx;
}
