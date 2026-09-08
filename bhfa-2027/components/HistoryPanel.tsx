'use client';

import type { HistoryEntry } from '@/lib/domain/types';
import styles from '@/styles/panels.module.css';

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Change history. Every mutation is recorded; restoring a prior state writes a
 * new entry rather than erasing anything, so the record only ever grows.
 */
export default function HistoryPanel({
  open,
  entries,
  onClose,
  onRestore,
}: {
  open: boolean;
  entries: HistoryEntry[];
  onClose: () => void;
  onRestore: (entryId: string) => void;
}) {
  if (!open) return null;

  return (
    <>
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <aside className={styles.panel} aria-label="Change history">
        <header className={styles.panelHeader}>
          <div>
            <p className="eyebrow">Version</p>
            <h2 className={styles.panelTitle}>Change history</h2>
          </div>
          <button type="button" className="btn btn--quiet" onClick={onClose}>
            Close
          </button>
        </header>

        <div className={styles.panelBody}>
          {entries.length === 0 ? (
            <p className={styles.panelEmpty}>No changes recorded yet.</p>
          ) : (
            <ol className={styles.historyList}>
              {entries.map((entry) => (
                <li key={entry.id} className={styles.historyItem} data-undone={entry.undone || undefined}>
                  <div className={styles.historyMeta}>
                    <span className={styles.historyActor}>{entry.actorName}</span>
                    <span className={styles.historyTime}>{relativeTime(entry.createdAt)}</span>
                  </div>
                  <p className={styles.historySummary}>{entry.summary}</p>
                  <div className={styles.historyActions}>
                    {entry.undone ? <span className={styles.historyFlag}>Reverted</span> : null}
                    <button
                      type="button"
                      className={styles.historyRestore}
                      onClick={() => onRestore(entry.id)}
                      disabled={entry.action === 'undone' || entry.action === 'restored'}
                    >
                      Restore previous state
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>
    </>
  );
}
