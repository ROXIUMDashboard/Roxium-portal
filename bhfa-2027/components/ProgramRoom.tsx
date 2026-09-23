'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { ProgramSnapshot, Session } from '@/lib/domain/types';
import { analyseDay } from '@/lib/domain/schedule';
import { useProgramRoom } from '@/lib/client/useProgramRoom';
import NameGate from './NameGate';
import ProgramHeader from './ProgramHeader';
import DayNav, { DAY_DROP_PREFIX } from './DayNav';
import DayHeader from './DayHeader';
import Agenda from './Agenda';
import SessionCard from './SessionCard';
import HistoryPanel from './HistoryPanel';
import WorkspaceNav, { type Workspace } from './WorkspaceNav';
import FacultyWorkspace from './FacultyWorkspace';
import { countFaculty } from '@/lib/domain/faculty';
import Toasts from './Toasts';
import styles from '@/styles/room.module.css';

/**
 * Drop where the cursor is. `pointerWithin` resolves a drop onto a day in the
 * selector precisely; `closestCenter` takes over for ordinary reordering, where
 * the pointer may sit between two rows.
 */
const collisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

export default function ProgramRoom({
  token,
  initialSnapshot,
}: {
  token: string;
  initialSnapshot: ProgramSnapshot;
}) {
  const room = useProgramRoom(token, initialSnapshot);
  const [dragging, setDragging] = useState<Session | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Local UI only: turning it on here never puts another collaborator into it.
  const [editMode, setEditMode] = useState(false);
  // Faculty is the planning home: a fresh link lands there. A link that names a
  // workspace (#agenda or #faculty) opens that one, and choosing a tab writes the
  // hash, so a refresh keeps you where you were.
  const [workspace, setWorkspace] = useState<Workspace>('faculty');
  useEffect(() => {
    const fromHash = () => {
      const hash = window.location.hash.slice(1);
      if (hash === 'agenda' || hash === 'faculty') setWorkspace(hash);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);
  const selectWorkspace = useCallback((next: Workspace) => {
    setWorkspace(next);
    try {
      window.history.replaceState(null, '', `#${next}`);
    } catch {
      /* the hash is a convenience */
    }
    window.scrollTo({ top: 0 });
  }, []);
  const activeFaculty = useMemo(() => countFaculty(room.snapshot.faculty).active, [room.snapshot.faculty]);

  const sensors = useSensors(
    // A short travel threshold keeps a tap on a row an "open the editor" tap.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Touch needs a deliberate press so the page still scrolls normally.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeDay = useMemo(
    () => room.snapshot.days.find((day) => day.id === room.activeDayId) ?? room.snapshot.days[0],
    [room.activeDayId, room.snapshot.days],
  );

  const daySessions = useMemo(
    () => (activeDay ? room.sessionsByDay(activeDay.id) : []),
    [activeDay, room],
  );

  const issues = useMemo(() => analyseDay(daySessions), [daySessions]);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const session = daySessions.find((s) => s.id === event.active.id);
      setDragging(session ?? null);
      room.setOpenSessionId(null);
    },
    [daySessions, room],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragging(null);
      const { active, over } = event;
      if (!over || !activeDay) return;

      const sessionId = String(active.id);
      const overId = String(over.id);

      // Dropped onto a day in the selector — move it there, times untouched.
      if (overId.startsWith(DAY_DROP_PREFIX)) {
        const targetDayId = overId.slice(DAY_DROP_PREFIX.length);
        if (targetDayId === activeDay.id) return;
        void room.reorder(sessionId, targetDayId, room.sessionsByDay(targetDayId).length);
        return;
      }

      if (overId === sessionId) return;
      const targetIndex = daySessions.findIndex((s) => s.id === overId);
      if (targetIndex === -1) return;
      void room.reorder(sessionId, activeDay.id, targetIndex);
    },
    [activeDay, daySessions, room],
  );

  // Escape closes whatever is open, innermost first.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (historyOpen) {
        setHistoryOpen(false);
        return;
      }
      room.setOpenSessionId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [historyOpen, room]);

  if (!room.name) {
    return <NameGate program={room.snapshot.program} onEnter={room.enterProgram} />;
  }

  return (
    <div className={styles.shell}>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className={styles.masthead}>
          <ProgramHeader
            program={room.snapshot.program}
            saveState={room.saveState}
            lastSavedAt={room.lastSavedAt}
            collaborators={room.collaborators}
            name={room.name}
            showEditToggle={workspace === 'agenda'}
            editMode={editMode}
            onToggleEditMode={() => {
              setEditMode((on) => {
                // Leaving the single-row editor open under a whole open day
                // would double-render it; close it as edit mode takes over.
                if (!on) room.setOpenSessionId(null);
                return !on;
              });
            }}
            onOpenHistory={() => {
              setHistoryOpen(true);
              void room.loadHistory();
            }}
            onRotateLink={room.rotateLink}
          />

          <WorkspaceNav active={workspace} onSelect={selectWorkspace} facultyCount={activeFaculty} />

          {workspace === 'agenda' ? (
            <DayNav
              days={room.snapshot.days}
              sessions={room.snapshot.sessions}
              activeDayId={activeDay?.id ?? ''}
              onSelect={(dayId) => {
                room.setOpenSessionId(null);
                room.setActiveDayId(dayId);
              }}
              dragging={Boolean(dragging)}
              draggingFromDayId={dragging?.dayId ?? null}
            />
          ) : null}
        </div>

        <main className={styles.main}>
          {workspace === 'faculty' ? (
            <FacultyWorkspace room={room} />
          ) : activeDay ? (
            <>
              <DayHeader room={room} day={activeDay} sessions={daySessions} issues={issues} editMode={editMode} />
              <Agenda room={room} day={activeDay} sessions={daySessions} issues={issues} editMode={editMode} />
            </>
          ) : null}
        </main>

        <DragOverlay modifiers={[restrictToVerticalAxis]} dropAnimation={{ duration: 180, easing: 'cubic-bezier(.2,.8,.3,1)' }}>
          {dragging ? <SessionCard session={dragging} lifted /> : null}
        </DragOverlay>
      </DndContext>

      <footer className={styles.footer}>
        <span>Where the face is decided.</span>
        <span>
          {room.snapshot.program.statusLabel} · {room.snapshot.program.dateRangeLabel}
        </span>
      </footer>

      <HistoryPanel
        open={historyOpen}
        entries={room.history}
        onClose={() => setHistoryOpen(false)}
        onRestore={(entryId) => room.revert(entryId, 'restore')}
      />

      <Toasts toasts={room.toasts} onDismiss={room.dismissToast} />
    </div>
  );
}
