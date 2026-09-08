'use client';

import type { Faculty, Session } from '@/lib/domain/types';
import { SESSION_TYPE_LABELS, SPEAKER_STATUS_LABELS } from '@/lib/domain/types';
import type { SessionIssue } from '@/lib/domain/schedule';
import { formatDuration, formatRange } from '@/lib/domain/time';
import styles from '@/styles/session.module.css';

/** Types that carry no scientific content are set slightly quieter. */
const QUIET_TYPES = new Set(['break', 'breakfast', 'lunch']);
/** Types that read as programme punctuation rather than teaching. */
const ACCENT_TYPES = new Set(['evening_event', 'ceremony']);

export function speakerLine(session: Session, faculty: Faculty[]): { name: string; status: string | null }[] {
  return session.speakers.map((speaker) => {
    const linked = speaker.facultyId ? faculty.find((f) => f.id === speaker.facultyId) : null;
    const name = speaker.displayName ?? linked?.name ?? 'To be confirmed';
    const roleSuffix = speaker.role === 'moderator' ? ' (moderator)' : speaker.role === 'panelist' ? ' (panel)' : '';
    return {
      name: `${name}${roleSuffix}`,
      // "Confirmed" is the norm and needs no badge; anything else does.
      status: speaker.status === 'confirmed' ? null : SPEAKER_STATUS_LABELS[speaker.status],
    };
  });
}

export function typeTone(sessionType: string): 'quiet' | 'accent' | 'core' {
  if (QUIET_TYPES.has(sessionType)) return 'quiet';
  if (ACCENT_TYPES.has(sessionType)) return 'accent';
  return 'core';
}

export default function SessionCard({
  session,
  faculty = [],
  issues = [],
  lifted = false,
  editingBy = null,
}: {
  session: Session;
  faculty?: Faculty[];
  issues?: SessionIssue[];
  lifted?: boolean;
  editingBy?: string | null;
}) {
  const speakers = speakerLine(session, faculty);
  const duration = session.endMinute - session.startMinute;
  const conflict = issues.find((issue) => issue.kind === 'conflict' || issue.kind === 'invalid');
  const gap = issues.find((issue) => issue.kind === 'gap');
  const tone = typeTone(session.sessionType);

  return (
    <div
      className={styles.card}
      data-lifted={lifted || undefined}
      data-tone={tone}
      data-type={session.sessionType}
    >
      <div className={styles.timeCol}>
        <span className={styles.time}>{formatRange(session.startMinute, session.endMinute)}</span>
        <span className={styles.duration}>{duration > 0 ? formatDuration(duration) : '—'}</span>
      </div>

      <span className={styles.typeLabel}>{SESSION_TYPE_LABELS[session.sessionType]}</span>

      <div className={styles.contentCol}>
        <h3 className={styles.title}>{session.title || 'Untitled session'}</h3>

        {speakers.length > 0 ? (
          <p className={styles.speakers}>
            {speakers.map((speaker, index) => (
              <span key={`${speaker.name}-${index}`}>
                {index > 0 ? <span className={styles.separator}>·</span> : null}
                {speaker.name}
                {speaker.status ? <span className={styles.speakerStatus}>{speaker.status}</span> : null}
              </span>
            ))}
          </p>
        ) : null}

        {session.description ? <p className={styles.description}>{session.description}</p> : null}

        {/* Sponsors are optional and simply absent when unset — no placeholder. */}
        {session.sponsorName ? <p className={styles.sponsor}>Supported by {session.sponsorName}</p> : null}

        {session.room ? <p className={styles.room}>{session.room}</p> : null}

        {(conflict || gap || editingBy) && (
          <p className={styles.flags}>
            {conflict ? (
              <span className={styles.conflict} title={conflict.detail}>
                {conflict.label}
              </span>
            ) : null}
            {!conflict && gap ? (
              <span className={styles.gap} title={gap.detail}>
                {gap.label}
              </span>
            ) : null}
            {editingBy ? <span className={styles.editingBy}>{editingBy} is editing</span> : null}
          </p>
        )}
      </div>
    </div>
  );
}
