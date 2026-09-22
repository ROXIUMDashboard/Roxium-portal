'use client';

import { useEffect, useRef, useState } from 'react';
import type { PresenceEntry, Program } from '@/lib/domain/types';
import type { SaveState } from '@/lib/client/useProgramRoom';
import styles from '@/styles/room.module.css';

function SaveIndicator({ state, lastSavedAt }: { state: SaveState; lastSavedAt: number | null }) {
  const [, force] = useState(0);

  // Refresh "updated just now" without re-rendering the agenda.
  useEffect(() => {
    const timer = window.setInterval(() => force((n) => n + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (state === 'saving') return <span className={styles.status}>Saving…</span>;
  if (state === 'reconnecting') {
    return <span className={`${styles.status} ${styles.statusWarn}`}>Reconnecting…</span>;
  }
  if (state === 'saved' || lastSavedAt) {
    const elapsed = lastSavedAt ? Date.now() - lastSavedAt : 0;
    return (
      <span className={styles.status}>{elapsed < 60_000 ? 'All changes saved' : 'Updated just now'}</span>
    );
  }
  return <span className={styles.status}>All changes saved</span>;
}

export default function ProgramHeader({
  program,
  saveState,
  lastSavedAt,
  collaborators,
  name,
  editMode,
  onToggleEditMode,
  onOpenHistory,
  onRotateLink,
}: {
  program: Program;
  saveState: SaveState;
  lastSavedAt: number | null;
  collaborators: PresenceEntry[];
  name: string;
  editMode: boolean;
  onToggleEditMode: () => void;
  onOpenHistory: () => void;
  onRotateLink: () => Promise<{ token: string; path: string } | null>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [rotated, setRotated] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

  const others = collaborators.filter((entry) => entry.name !== name);

  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <div className={styles.lockup}>
          <span className={styles.lockupMark}>BH</span>
          <span className={styles.lockupSub}>FACE</span>
        </div>

        <div className={styles.titleBlock}>
          <h1 className={styles.programTitle}>{program.subtitle}</h1>
          <p className={styles.programMeta}>
            <span className={styles.statusLabel}>{program.statusLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{program.dateRangeLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{program.locationLabel}</span>
          </p>
        </div>

        <div className={styles.headerActions}>
          <SaveIndicator state={saveState} lastSavedAt={lastSavedAt} />

          <button
            type="button"
            className={styles.editToggle}
            data-active={editMode || undefined}
            aria-pressed={editMode}
            onClick={onToggleEditMode}
          >
            {editMode ? 'Done editing' : 'Edit program'}
          </button>

          {others.length > 0 ? (
            <span className={styles.presence} title={others.map((entry) => entry.name).join(', ')}>
              {others.length === 1 ? `${others[0].name} is here` : `${others.length} collaborators here`}
            </span>
          ) : null}

          <div className={styles.menuWrap} ref={menuRef}>
            <button
              type="button"
              className={styles.menuButton}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Program options"
              onClick={() => setMenuOpen((open) => !open)}
            >
              •••
            </button>

            {menuOpen ? (
              <div className={styles.menu} role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenHistory();
                  }}
                >
                  Change history
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void navigator.clipboard?.writeText(window.location.href);
                    setMenuOpen(false);
                  }}
                >
                  Copy collaboration link
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={async () => {
                    const confirmed = window.confirm(
                      'Rotate the collaboration link? The current link stops working immediately and everyone will need the new one.',
                    );
                    if (!confirmed) return;
                    const result = await onRotateLink();
                    if (result) {
                      setRotated(`${window.location.origin}${result.path}`);
                      setMenuOpen(false);
                    }
                  }}
                >
                  Rotate collaboration link
                </button>
                <p className={styles.menuNote}>Signed in as {name} on this device.</p>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {rotated ? (
        <div className={styles.rotated} role="status">
          <p>
            New collaboration link — copy it now, it is not shown again.
            <br />
            <code>{rotated}</code>
          </p>
          <div className={styles.rotatedActions}>
            <button type="button" className="btn" onClick={() => void navigator.clipboard?.writeText(rotated)}>
              Copy
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => (window.location.href = rotated)}>
              Open it
            </button>
          </div>
        </div>
      ) : null}
    </header>
  );
}
