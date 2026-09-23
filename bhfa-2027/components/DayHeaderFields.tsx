'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Day } from '@/lib/domain/types';
import type { ProgramRoomState } from '@/lib/client/useProgramRoom';
import styles from '@/styles/room.module.css';

/** Matches the session editor, so the whole page saves on one rhythm. */
const AUTOSAVE_MS = 650;

/**
 * The draft is all-strings: an input cannot hold null, so a cleared optional
 * field is '' here and the server turns it back into null on save.
 */
interface Editable {
  shortLabel: string;
  title: string;
  subtitle: string;
  weekdayLabel: string;
  date: string;
  hoursLabel: string;
}

const FIELDS: { key: keyof Editable; label: string; placeholder: string; wide?: boolean }[] = [
  { key: 'shortLabel', label: 'Navigation label', placeholder: 'Endoscopic' },
  { key: 'weekdayLabel', label: 'Weekday', placeholder: 'Thursday' },
  { key: 'date', label: 'Date', placeholder: 'YYYY-MM-DD' },
  { key: 'hoursLabel', label: 'Displayed hours', placeholder: '5:30 AM – 7:00 PM' },
  { key: 'title', label: 'Day title', placeholder: 'Endoscopic Facial Rejuvenation', wide: true },
  { key: 'subtitle', label: 'Focus', placeholder: 'Live surgery lead: …', wide: true },
];

const toDraft = (day: Day): Editable => ({
  shortLabel: day.shortLabel,
  title: day.title,
  subtitle: day.subtitle ?? '',
  weekdayLabel: day.weekdayLabel,
  date: day.date,
  hoursLabel: day.hoursLabel ?? '',
});

/**
 * The day's own heading, editable in place.
 *
 * These values come from bhfa_days, not from constants in the code, so a
 * planner can correct a label without a deploy. Autosave follows the same
 * debounce as the session editor, and only fields this collaborator actually
 * touched are ever written — so someone else renaming the day while this is
 * open does not get quietly overwritten.
 */
export default function DayHeaderFields({ room, day }: { room: ProgramRoomState; day: Day }) {
  const [draft, setDraft] = useState<Editable>(() => toDraft(day));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const dayRef = useRef(day);
  dayRef.current = day;
  const touched = useRef(new Set<keyof Editable>());
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async () => {
    const saved = toDraft(dayRef.current);
    const patch: Record<string, unknown> = {};
    for (const field of touched.current) {
      if (draftRef.current[field] !== saved[field]) patch[field] = draftRef.current[field];
    }
    if (!Object.keys(patch).length) return;

    if (typeof patch.date === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(patch.date)) {
      setError('Enter the date as YYYY-MM-DD.');
      return;
    }
    if (patch.shortLabel === '' || patch.title === '' || patch.weekdayLabel === '') {
      setError('Navigation label, title and weekday cannot be empty.');
      return;
    }
    setError(null);

    const sent = { ...draftRef.current };
    const response = await room.updateDay(dayRef.current.id, patch);
    if (!response) return;
    for (const field of Object.keys(patch) as (keyof Editable)[]) {
      if (sent[field] === draftRef.current[field]) touched.current.delete(field);
    }
  }, [room]);

  // `room` is a fresh object on every render, so reach save through a ref —
  // otherwise the debounce re-arms on each render instead of on each edit.
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    const timer = window.setTimeout(() => void saveRef.current(), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [draft]);

  useEffect(() => () => void saveRef.current(), []);

  // Someone else's change lands on fields this collaborator has not touched.
  useEffect(() => {
    const incoming = toDraft(day);
    setDraft((current) => {
      let next = current;
      for (const field of Object.keys(incoming) as (keyof Editable)[]) {
        if (touched.current.has(field)) continue;
        if (incoming[field] === current[field]) continue;
        if (next === current) next = { ...current };
        next[field] = incoming[field];
      }
      return next;
    });
  }, [day]);

  const edit = (field: keyof Editable, value: string) => {
    touched.current.add(field);
    setDraft((current) => ({ ...current, [field]: value }));
  };

  return (
    <div className={styles.dayFields}>
      {FIELDS.map((field) => (
        <label
          key={field.key}
          className={field.wide ? `${styles.dayField} ${styles.dayFieldWide}` : styles.dayField}
        >
          <span className="fieldLabel">{field.label}</span>
          <input
            className="field"
            value={draft[field.key] ?? ''}
            placeholder={field.placeholder}
            maxLength={field.key === 'date' ? 10 : 200}
            onChange={(event) => edit(field.key, event.target.value)}
          />
        </label>
      ))}
      {error ? <p className={styles.dayFieldError}>{error}</p> : null}
    </div>
  );
}
