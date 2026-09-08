'use client';

import { useEffect, useRef, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Day, Session } from '@/lib/domain/types';
import { computeSnapAfterPrevious, type SessionIssue } from '@/lib/domain/schedule';
import { formatDuration } from '@/lib/domain/time';
import type { ProgramRoomState } from '@/lib/client/useProgramRoom';
import SessionCard from './SessionCard';
import SessionEditor from './SessionEditor';
import styles from '@/styles/session.module.css';

function ConflictFix({
  room,
  session,
  daySessions,
  day,
  index,
}: {
  room: ProgramRoomState;
  session: Session;
  daySessions: Session[];
  day: Day;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const previous = index > 0 ? daySessions[index - 1] : null;
  const snap = computeSnapAfterPrevious(daySessions, session.id);

  if (!previous) return null;

  const delta = previous.endMinute - session.startMinute;

  return (
    <div className={styles.fixWrap}>
      <button type="button" className={styles.fixButton} onClick={() => setOpen((value) => !value)}>
        Fix
      </button>
      {open ? (
        <div className={styles.fixMenu} role="menu">
          {snap ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void room.updateSession(session.id, { startMinute: snap.startMinute, endMinute: snap.endMinute });
              }}
            >
              Start after “{previous.title || 'previous session'}”
            </button>
          ) : null}
          {delta !== 0 ? (
            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                setOpen(false);
                // Move this session clear of the overlap, then carry the rest of
                // the day with it so nothing else collides.
                await room.updateSession(session.id, {
                  startMinute: session.startMinute + delta,
                  endMinute: session.endMinute + delta,
                });
                await room.shiftFollowing(day.id, session.id, delta);
              }}
            >
              Shift this session and all following by {formatDuration(Math.abs(delta))}
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              room.setOpenSessionId(session.id);
            }}
          >
            Edit manually
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function SessionRow({
  room,
  day,
  session,
  daySessions,
  index,
  issues,
}: {
  room: ProgramRoomState;
  day: Day;
  session: Session;
  daySessions: Session[];
  index: number;
  issues: SessionIssue[];
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: session.id,
  });
  const rowRef = useRef<HTMLElement>(null);
  const promptRef = useRef<HTMLDivElement>(null);
  const open = room.openSessionId === session.id;
  const editors = room.editorsOf(session.id);
  const conflict = issues.find((issue) => issue.kind === 'conflict' || issue.kind === 'invalid');
  const pendingShift = room.pendingShift?.sessionId === session.id ? room.pendingShift : null;

  // Clicking elsewhere closes the editor. The autosave flush runs on unmount,
  // so nothing typed is lost on the way out.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rowRef.current?.contains(target)) return;
      // Ignore clicks inside overlays that belong to this row's flow.
      if ((target as HTMLElement).closest?.('[data-keeps-editor-open]')) return;
      room.setOpenSessionId(null);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open, room]);

  // The prompt is a decision the planner has to see, so bring it into view.
  useEffect(() => {
    if (!pendingShift) return;
    promptRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [pendingShift]);

  return (
    <article
      ref={(node) => {
        setNodeRef(node);
        rowRef.current = node;
      }}
      className={styles.row}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-open={open || undefined}
      data-dragging={isDragging || undefined}
      data-conflict={conflict ? true : undefined}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className={styles.handle}
        aria-label={`Reorder ${session.title || 'session'}`}
        {...attributes}
        {...listeners}
      >
        <span aria-hidden="true" />
      </button>

      {open ? (
        <SessionEditor
          room={room}
          session={session}
          day={day}
          daySessions={daySessions}
          index={index}
          onClose={() => room.setOpenSessionId(null)}
        />
      ) : (
        <div
          role="button"
          tabIndex={0}
          className={styles.rowTrigger}
          aria-label={`Edit ${session.title || 'session'}`}
          onClick={() => room.setOpenSessionId(session.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              room.setOpenSessionId(session.id);
            }
          }}
        >
          <SessionCard
            session={session}
            faculty={room.snapshot.faculty}
            issues={issues}
            editingBy={editors[0]?.name ?? null}
          />
        </div>
      )}

      {conflict && !open ? (
        <ConflictFix room={room} session={session} daySessions={daySessions} day={day} index={index} />
      ) : null}

      {pendingShift ? (
        <div
          ref={promptRef}
          className={styles.shiftPrompt}
          role="dialog"
          aria-label="Adjust the rest of the day"
          data-keeps-editor-open
        >
          <p className={styles.shiftMessage}>{pendingShift.message}</p>
          <div className={styles.shiftActions}>
            <button
              type="button"
              className="btn btn--solid"
              onClick={() =>
                void room.shiftFollowing(pendingShift.dayId, pendingShift.sessionId, pendingShift.deltaMinutes)
              }
            >
              Shift following sessions {pendingShift.deltaMinutes > 0 ? '+' : '−'}
              {formatDuration(Math.abs(pendingShift.deltaMinutes))}
            </button>
            <button type="button" className="btn" onClick={() => room.setPendingShift(null)}>
              Change this session only
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
