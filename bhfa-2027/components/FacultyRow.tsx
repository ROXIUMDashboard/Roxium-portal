'use client';

import { memo, useEffect, useRef, useState } from 'react';
import type { Faculty, FacultyRegion, FacultyStatus } from '@/lib/domain/types';
import {
  FACULTY_REGIONS,
  FACULTY_REGION_SHORT,
  FACULTY_STATUSES,
  FACULTY_STATUS_LABELS,
} from '@/lib/domain/types';
import type { ProgramRoomState } from '@/lib/client/useProgramRoom';
import FacultyEditor from './FacultyEditor';
import styles from '@/styles/faculty.module.css';

/**
 * The status pill. Clicking it is the primary — and always reliable — way to
 * move someone: Confirmed ↔ Maybe, or out to Declined / Not Pursuing and back.
 */
function StatusPill({
  status,
  name,
  onChange,
}: {
  status: FacultyStatus | null;
  name: string;
  onChange: (next: FacultyStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', escape);
    };
  }, [open]);

  // Put the caret on the current choice when the menu opens.
  useEffect(() => {
    if (open) wrap.current?.querySelector<HTMLButtonElement>('[aria-checked="true"], [role="menuitemradio"]')?.focus();
  }, [open]);

  return (
    <div className={styles.pillWrap} ref={wrap}>
      <button
        type="button"
        className={styles.pill}
        data-status={status ?? 'unsorted'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${name}: ${status ? FACULTY_STATUS_LABELS[status] : 'not in register'}. Change status`}
        onClick={() => setOpen((value) => !value)}
      >
        {status ? FACULTY_STATUS_LABELS[status] : 'Add to register'}
        <span aria-hidden="true" className={styles.pillCaret}>▾</span>
      </button>
      {open ? (
        <div className={styles.pillMenu} role="menu" aria-label={`Status for ${name}`}>
          {FACULTY_STATUSES.map((option, index) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={option === status}
              className={styles.pillOption}
              data-status={option}
              data-divider={index === 2 || undefined}
              onClick={() => {
                setOpen(false);
                if (option !== status) onChange(option);
              }}
            >
              <span className={styles.pillDot} data-status={option} aria-hidden="true" />
              {FACULTY_STATUS_LABELS[option]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function locationLine(f: Faculty) {
  return [f.city, f.stateProvince, f.country].filter(Boolean).join(', ');
}

/**
 * One person in the register. Collapsed it is a single concise line; opened it
 * is the full record, edited in place.
 *
 * Memoised: typing in one person's notes re-renders that row, not the list.
 * `room` is deliberately excluded from the comparison — it is rebuilt on every
 * render of the room, while its actions are stable callbacks.
 */
function FacultyRow({
  room,
  member,
  open,
  onToggle,
}: {
  room: ProgramRoomState;
  member: Faculty;
  open: boolean;
  onToggle: (id: string) => void;
}) {
  const detail = [member.specialty, member.institution, locationLine(member)].filter(Boolean).join(' · ');

  return (
    <article className={styles.row} data-status={member.status ?? 'unsorted'} data-open={open || undefined}>
      <div className={styles.rowLine}>
        <button
          type="button"
          className={styles.rowName}
          aria-expanded={open}
          aria-label={`${open ? 'Close' : 'Edit'} ${member.name}`}
          onClick={() => onToggle(member.id)}
        >
          <span className={styles.name}>
            {member.priority ? <span className={styles.star} aria-label="Priority">★</span> : null}
            {member.name}
            {member.credentials ? <span className={styles.credentials}>, {member.credentials}</span> : null}
          </span>
          {detail ? <span className={styles.detail}>{detail}</span> : null}
        </button>

        <div className={styles.rowControls}>
          <label className={styles.regionWrap}>
            <span className={styles.visuallyHidden}>Region for {member.name}</span>
            <select
              className={styles.region}
              value={member.region ?? ''}
              data-empty={member.region ? undefined : true}
              onChange={(event) =>
                void room.updateFaculty(member.id, {
                  region: (event.target.value || null) as FacultyRegion | null,
                })
              }
            >
              <option value="">Region…</option>
              {FACULTY_REGIONS.map((region) => (
                <option key={region} value={region}>
                  {FACULTY_REGION_SHORT[region]}
                </option>
              ))}
            </select>
          </label>
          <StatusPill
            status={member.status}
            name={member.name}
            onChange={(next) => void room.updateFaculty(member.id, { status: next })}
          />
        </div>
      </div>

      {open ? <FacultyEditor room={room} member={member} /> : null}
    </article>
  );
}

export default memo(
  FacultyRow,
  (prev, next) => prev.member === next.member && prev.open === next.open && prev.onToggle === next.onToggle,
);
