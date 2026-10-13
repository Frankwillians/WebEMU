/**
 * Toasts - Notificações flutuantes
 */

import { useStore } from '../store';

export function Toasts() {
  const { toasts, removeToast } = useStore();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.type}`} onClick={() => removeToast(toast.id)}>
          <span className="toast-icon">
            {toast.type === 'success' && '✓'}
            {toast.type === 'error' && '✕'}
            {toast.type === 'warning' && '⚠'}
            {toast.type === 'info' && 'ℹ'}
          </span>
          <span className="toast-message">{toast.message}</span>
          <style>{`
            .toast-icon { font-size: 16px; font-weight: 700; flex-shrink: 0; }
            .toast-message { font-size: 13px; flex: 1; }
            .toast.success .toast-icon { color: var(--accent-tertiary); }
            .toast.error .toast-icon { color: var(--accent-secondary); }
            .toast.warning .toast-icon { color: var(--accent-warning); }
            .toast.info .toast-icon { color: var(--accent-primary); }
            .toast { cursor: pointer; }
          `}</style>
        </div>
      ))}
    </div>
  );
}

export default Toasts;