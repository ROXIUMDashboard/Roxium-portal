'use client';

import type { Day, Session } from '@/lib/domain/types';
import type { IssueMap } from '@/lib/domain/schedule';
import { formatIsoDate } from '@/lib/domain/time';
import styles from '@/styles/room.module.css';

export default function DayHeader({
  day,
  sessions,
  issues,
}: {
  day: Day;
  sessions: Session[];
  issues: IssueMap;
}) {
  const issueList = Object.values(issues).flat();
  const conflicts = issueList.filter((issue) => issue.kind === 'conflict' || issue.kind === 'invalid').length;
  const gaps = issueList.filter((issue) => issue.kind === 'gap').length;

  return (
    <section className={styles.dayHeader}>
      <div className={styles.dayHeaderTop}>
        <p className={styles.dayEyebrow}>Day</p>
        <p className={styles.dayNumeral}>{String(day.dayNumber).padStart(2, '0')}</p>
      </div>

      <h2 className={styles.dayTitle}>{day.title}</h2>
      {day.subtitle ? <p className={styles.daySubtitle}>{day.subtitle}</p> : null}

      <p className={styles.dayMeta}>
        <span>{formatIsoDate(day.date)}</span>
        {day.hoursLabel ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{day.hoursLabel}</span>
          </>
        ) : null}
        <span aria-hidden="true">·</span>
        <span>
          {sessions.length} session{sessions.length === 1 ? '' : 's'}
        </span>
        {conflicts > 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <span className={styles.dayMetaAlert}>
              {conflicts} time conflict{conflicts === 1 ? '' : 's'}
            </span>
          </>
        ) : null}
        {gaps > 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <span className={styles.dayMetaWarn}>
              {gaps} unscheduled gap{gaps === 1 ? '' : 's'}
            </span>
          </>
        ) : null}
      </p>
    </section>
  );
}
