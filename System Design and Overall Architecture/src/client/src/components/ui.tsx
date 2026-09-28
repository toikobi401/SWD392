/**
 * Shared presentation pieces. Statuses always render as a word plus colour —
 * never colour alone — so they read for colour-blind staff and in print.
 */
import { ReactNode, useEffect, useRef } from 'react';
import { ApiError } from '../api/client';
import {
  ACCOUNT_STATUS,
  BOOKING_STATUS,
  LEAVE_STATUS,
  PAYMENT_STATUS,
  REFUND_STATUS,
  ROOM_STATUS,
} from '../lib/format';

type Kind = 'booking' | 'room' | 'leave' | 'refund' | 'payment' | 'account';

const LABELS: Record<Kind, Record<string, string>> = {
  booking: BOOKING_STATUS,
  room: ROOM_STATUS,
  leave: LEAVE_STATUS,
  refund: REFUND_STATUS,
  payment: PAYMENT_STATUS,
  account: ACCOUNT_STATUS,
};

const ROOM_CLASS: Record<string, string> = {
  VACANT_CLEAN: 'clean',
  VACANT_DIRTY: 'dirty',
  OCCUPIED: 'occupied',
  INSPECTED: 'inspected',
  OUT_OF_ORDER: 'ooo',
};

export function Status({ kind, value }: { kind: Kind; value: string }) {
  const cls = kind === 'room' ? ROOM_CLASS[value] : value.toLowerCase();
  return <span className={`badge ${cls}`}>{LABELS[kind][value] ?? value}</span>;
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'ok' | 'warn' | 'error'; children: ReactNode }) {
  return (
    <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

/** Renders an API failure in the interface's voice: what happened, plainly. */
export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Something went wrong.';
  return <Notice tone="error">{message}</Notice>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="spinner" role="status">
      {label}
    </p>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

/** A side panel for detail and actions; Escape and the scrim close it. */
export function Drawer({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} tabIndex={-1} ref={ref}>
        <div className="drawer-head">
          <h2>{title}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-head">
          <h2>{title}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="stat">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}
