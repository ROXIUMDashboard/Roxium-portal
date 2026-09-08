'use client';

import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Day, Session } from '@/lib/domain/types';
import type { IssueMap } from '@/lib/domain/schedule';
import type { ProgramRoomState } from '@/lib/client/useProgramRoom';
import SessionRow from './SessionRow';
import styles from '@/styles/session.module.css';

/** Sensible defaults for a new row: 30 minutes, starting when the last one ended. */
function defaultsFor(previous: Session | null): { startMinute: number; endMinute: number } {
  const start = previous ? previous.endMinute : 8 * 60;
  return { startMinute: Math.min(start, 1440 - 30), endMinute: Math.min(start + 30, 1440) };
}

function AddSlot({
  room,
  day,
  after,
  always = false,
}: {
  room: ProgramRoomState;
  day: Day;
  after: Session | null;
  always?: boolean;
}) {
  const { startMinute, endMinute } = defaultsFor(after);

  return (
    <div className={styles.addSlot} data-always={always || undefined}>
      <button
        type="button"
        className={styles.addButton}
        onClick={() =>
          void room.createSession({
            dayId: day.id,
            afterSessionId: after?.id ?? null,
            title: '',
            startMinute,
            endMinute,
            sessionType: 'scientific_session',
          })
        }
      >
        + Add session
      </button>
    </div>
  );
}

export default function Agenda({
  room,
  day,
  sessions,
  issues,
}: {
  room: ProgramRoomState;
  day: Day;
  sessions: Session[];
  issues: IssueMap;
}) {
  return (
    <section className={styles.agenda} aria-label={`${day.title} agenda`}>
      <SortableContext items={sessions.map((session) => session.id)} strategy={verticalListSortingStrategy}>
        {sessions.map((session, index) => (
          <div key={session.id} className={styles.rowGroup}>
            <SessionRow
              room={room}
              day={day}
              session={session}
              daySessions={sessions}
              index={index}
              issues={issues[session.id] ?? []}
            />
            <AddSlot room={room} day={day} after={session} always={index === sessions.length - 1} />
          </div>
        ))}
      </SortableContext>

      {sessions.length === 0 ? (
        <div className={styles.emptyDay}>
          <p>This day has no sessions yet.</p>
          <AddSlot room={room} day={day} after={null} always />
        </div>
      ) : null}
    </section>
  );
}
