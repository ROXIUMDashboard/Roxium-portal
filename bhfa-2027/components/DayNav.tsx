'use client';

import { useDroppable } from '@dnd-kit/core';
import type { Day, Session } from '@/lib/domain/types';
import { conflictCountForDay } from '@/lib/domain/schedule';
import styles from '@/styles/room.module.css';

export const DAY_DROP_PREFIX = 'day-drop:';

function DayTab({
  day,
  active,
  conflicts,
  dropTarget,
  onSelect,
}: {
  day: Day;
  active: boolean;
  conflicts: number;
  dropTarget: boolean;
  onSelect: () => void;
}) {
  // Every day is a drop target while a session is in the air, which is how a
  // session moves between days without leaving the day you are looking at.
  const { setNodeRef, isOver } = useDroppable({ id: `${DAY_DROP_PREFIX}${day.id}`, disabled: !dropTarget });

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={styles.dayTab}
      data-active={active || undefined}
      data-drop={dropTarget || undefined}
      data-over={isOver || undefined}
      aria-current={active ? 'true' : undefined}
      onClick={onSelect}
    >
      <span className={styles.dayTabNumber}>{String(day.dayNumber).padStart(2, '0')}</span>
      <span className={styles.dayTabText}>
        <span className={styles.dayTabWeekday}>{day.weekdayLabel.slice(0, 3)}</span>
        <span className={styles.dayTabLabel}>
          {day.shortLabel}
          {conflicts > 0 ? (
            <span className={styles.dayTabConflicts} aria-label={`${conflicts} time conflicts`}>
              {conflicts}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

export default function DayNav({
  days,
  sessions,
  activeDayId,
  onSelect,
  dragging,
  draggingFromDayId,
}: {
  days: Day[];
  sessions: Session[];
  activeDayId: string;
  onSelect: (dayId: string) => void;
  dragging: boolean;
  draggingFromDayId: string | null;
}) {
  return (
    <nav className={styles.dayNav} aria-label="Program days" data-dragging={dragging || undefined}>
      <div className={styles.dayNavInner}>
        {days.map((day) => (
          <DayTab
            key={day.id}
            day={day}
            active={day.id === activeDayId}
            conflicts={conflictCountForDay(sessions, day.id)}
            dropTarget={dragging && day.id !== draggingFromDayId}
            onSelect={() => onSelect(day.id)}
          />
        ))}
      </div>
      {dragging ? <p className={styles.dayNavHint}>Drop on a day to move this session there</p> : null}
    </nav>
  );
}
