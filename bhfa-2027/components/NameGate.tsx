'use client';

import { useState } from 'react';
import type { Program } from '@/lib/domain/types';
import styles from '@/styles/panels.module.css';

/**
 * One question, once per browser. This is not a login: the name only labels
 * changes in the revision history and tells other collaborators who is here.
 */
export default function NameGate({
  program,
  onEnter,
}: {
  program: Program;
  onEnter: (name: string) => void;
}) {
  const [value, setValue] = useState('');
  const trimmed = value.trim();

  return (
    <main className={styles.gate}>
      <form
        className={styles.gateCard}
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed) onEnter(trimmed);
        }}
      >
        <div className={styles.gateMark}>
          <span>BH</span>
          <span>FACE</span>
        </div>

        <p className="eyebrow">{program.subtitle}</p>
        <h1 className={styles.gateTitle}>{program.title}</h1>
        <p className={styles.gateCopy}>
          {program.dateRangeLabel} · {program.locationLabel}
        </p>

        <label className={styles.gateField}>
          <span className="fieldLabel">Your name</span>
          <input
            className="field"
            name="collaborator-name"
            autoComplete="name"
            autoFocus
            placeholder="Ashkan Ghavami"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            maxLength={80}
          />
        </label>

        <button type="submit" className="btn btn--solid" disabled={!trimmed}>
          Enter Program
        </button>

        <p className={styles.gateNote}>
          Your name is stored in this browser only, so edits in the change history are attributable.
        </p>
      </form>
    </main>
  );
}
