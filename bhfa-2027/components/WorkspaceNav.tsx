'use client';

import styles from '@/styles/room.module.css';

export type Workspace = 'agenda' | 'faculty';

const TABS: { id: Workspace; label: string }[] = [
  { id: 'agenda', label: 'Agenda' },
  { id: 'faculty', label: 'Faculty' },
];

/**
 * The two planning workspaces behind the one collaboration link. Two words
 * under the masthead, in the programme's own type — a table of contents, not an
 * application sidebar.
 */
export default function WorkspaceNav({
  active,
  onSelect,
  facultyCount,
}: {
  active: Workspace;
  onSelect: (workspace: Workspace) => void;
  facultyCount: number;
}) {
  return (
    <nav className={styles.workspaceNav} aria-label="Planning workspace">
      <div className={styles.workspaceNavInner} role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            className={styles.workspaceTab}
            data-active={active === tab.id || undefined}
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
            {tab.id === 'faculty' && facultyCount > 0 ? (
              <span className={styles.workspaceCount}>{facultyCount}</span>
            ) : null}
          </button>
        ))}
      </div>
    </nav>
  );
}
