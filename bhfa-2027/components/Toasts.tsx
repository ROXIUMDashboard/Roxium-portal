'use client';

import type { Toast } from '@/lib/client/useProgramRoom';
import styles from '@/styles/panels.module.css';

/**
 * One quiet line at the foot of the screen. High-impact changes (delete, move
 * between days, bulk shift) carry an Undo; everything else just reports.
 */
export default function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div className={styles.toastStack} role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={styles.toast} data-tone={toast.tone}>
          <span className={styles.toastMessage}>{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              className={styles.toastAction}
              onClick={() => {
                toast.action?.run();
                onDismiss(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.toastClose}
            aria-label="Dismiss"
            onClick={() => onDismiss(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
