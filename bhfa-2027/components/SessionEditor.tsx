'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Day, Faculty, Session, SessionType, SpeakerRole, SpeakerStatus } from '@/lib/domain/types';
import { SESSION_TYPES, SESSION_TYPE_LABELS, SPEAKER_ROLES, SPEAKER_STATUSES, SPEAKER_STATUS_LABELS } from '@/lib/domain/types';
import {
  composeMinute,
  formatDuration,
  formatTime,
  isNextDay,
  parseTimeInput,
  toInputValue,
  MINUTES_IN_DAY,
} from '@/lib/domain/time';
import type { ProgramRoomState } from '@/lib/client/useProgramRoom';
import styles from '@/styles/session.module.css';

const AUTOSAVE_MS = 650;

interface DraftSpeaker {
  key: string;
  name: string;
  role: SpeakerRole;
  status: SpeakerStatus;
}

interface Draft {
  title: string;
  description: string;
  startMinute: number;
  endMinute: number;
  speakers: DraftSpeaker[];
  sessionType: SessionType;
  sponsorName: string;
  sponsorUrl: string;
  room: string;
  internalNotes: string;
}

function toDraft(session: Session, faculty: Faculty[]): Draft {
  return {
    title: session.title,
    description: session.description ?? '',
    startMinute: session.startMinute,
    endMinute: session.endMinute,
    speakers: session.speakers.map((speaker, index) => ({
      key: `${speaker.id}-${index}`,
      name:
        speaker.displayName ??
        (speaker.facultyId ? (faculty.find((f) => f.id === speaker.facultyId)?.name ?? '') : ''),
      role: speaker.role,
      status: speaker.status,
    })),
    sessionType: session.sessionType,
    sponsorName: session.sponsorName ?? '',
    sponsorUrl: session.sponsorUrl ?? '',
    room: session.room ?? '',
    internalNotes: session.internalNotes ?? '',
  };
}

const speakerShape = (list: DraftSpeaker[]) =>
  JSON.stringify(list.map((s) => [s.name.trim(), s.role, s.status]));

/**
 * Only the fields this editor actually touched, and only where they differ from
 * what the server holds.
 *
 * Restricting the patch to touched fields is what stops an incoming change from
 * another collaborator turning into an automatic save of this editor's stale
 * copy — which would quietly undo their work without anyone pressing anything.
 */
function diff(
  draft: Draft,
  session: Session,
  faculty: Faculty[],
  touched: Set<keyof Draft>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const saved = toDraft(session, faculty);
  const changed = (field: keyof Draft) => touched.has(field) && draft[field] !== saved[field];

  if (changed('title')) patch.title = draft.title;
  if (changed('description')) patch.description = draft.description || null;
  if (changed('startMinute')) patch.startMinute = draft.startMinute;
  if (changed('endMinute')) patch.endMinute = draft.endMinute;
  if (changed('sessionType')) patch.sessionType = draft.sessionType;
  if (changed('sponsorName')) patch.sponsorName = draft.sponsorName || null;
  if (changed('sponsorUrl')) patch.sponsorUrl = draft.sponsorUrl || null;
  if (changed('room')) patch.room = draft.room || null;
  if (changed('internalNotes')) patch.internalNotes = draft.internalNotes || null;

  if (touched.has('speakers') && speakerShape(draft.speakers) !== speakerShape(saved.speakers)) {
    patch.speakers = draft.speakers
      .filter((speaker) => speaker.name.trim() || speaker.status === 'tbd')
      .map((speaker) => ({
        displayName: speaker.name.trim() || null,
        role: speaker.role,
        status: speaker.status,
      }));
  }

  return patch;
}

export default function SessionEditor({
  room,
  session,
  day,
  daySessions,
  index,
  onClose,
}: {
  room: ProgramRoomState;
  session: Session;
  day: Day;
  daySessions: Session[];
  index: number;
  onClose: () => void;
}) {
  const faculty = room.snapshot.faculty;
  const [draft, setDraft] = useState<Draft>(() => toDraft(session, faculty));
  const [showMore, setShowMore] = useState(false);
  const [timeError, setTimeError] = useState<string | null>(null);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // The last times we successfully saved, so a duration change can be measured
  // against what the schedule actually had — not against an intermediate keystroke.
  const savedTimes = useRef({ start: session.startMinute, end: session.endMinute });
  // The version this editor opened on. Sent with every save so the server can
  // tell us if we just wrote over someone else's newer version.
  const baseUpdatedAt = useRef(session.updatedAt);
  // Fields this collaborator has changed since opening, and therefore the only
  // fields autosave is allowed to write.
  const touched = useRef(new Set<keyof Draft>());

  /** Change draft fields and mark them as this editor's own. */
  const edit = useCallback((fields: (keyof Draft)[], update: (current: Draft) => Draft) => {
    for (const field of fields) touched.current.add(field);
    setDraft(update);
  }, []);

  const followingCount = daySessions.length - index - 1;

  const save = useCallback(async () => {
    const patch = diff(draftRef.current, sessionRef.current, faculty, touched.current);
    if (Object.keys(patch).length === 0) return;
    const sent = { ...draftRef.current };

    const timesChanged = 'startMinute' in patch || 'endMinute' in patch;
    const previous = { ...savedTimes.current };

    const response = await room.updateSession(sessionRef.current.id, patch, baseUpdatedAt.current);
    if (!response) return;
    baseUpdatedAt.current = response.session?.updatedAt ?? baseUpdatedAt.current;

    // A field is no longer "ours to write" once it is saved — unless the
    // collaborator has typed in it again while the request was in flight.
    for (const field of Object.keys(patch) as (keyof Draft)[]) {
      const key = field === 'speakers' ? 'speakers' : field;
      const unchangedSinceSend =
        key === 'speakers'
          ? speakerShape(sent.speakers) === speakerShape(draftRef.current.speakers)
          : sent[key] === draftRef.current[key];
      if (unchangedSinceSend) touched.current.delete(key);
    }

    if (!timesChanged) return;

    const nextStart = draftRef.current.startMinute;
    const nextEnd = draftRef.current.endMinute;
    savedTimes.current = { start: nextStart, end: nextEnd };

    const endDelta = nextEnd - previous.end;
    if (endDelta === 0 || followingCount <= 0) return;

    const durationDelta = nextEnd - nextStart - (previous.end - previous.start);
    const message =
      durationDelta !== 0
        ? `This session is now ${formatDuration(Math.abs(durationDelta))} ${durationDelta > 0 ? 'longer' : 'shorter'}.`
        : `This session now ends ${formatDuration(Math.abs(endDelta))} ${endDelta > 0 ? 'later' : 'earlier'}.`;

    room.setPendingShift({ sessionId: sessionRef.current.id, dayId: day.id, deltaMinutes: endDelta, message });
  }, [day.id, faculty, followingCount, room]);

  // Autosave, and flush anything outstanding when the editor closes.
  useEffect(() => {
    const timer = window.setTimeout(() => void save(), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, save]);

  useEffect(() => () => void save(), [save]);

  /**
   * Someone else saved this session while it is open here. Fields this editor
   * has not touched simply update on screen; fields it has touched are left
   * alone, and the baseline is deliberately not advanced so the next save
   * reports what it replaced.
   */
  useEffect(() => {
    const incoming = toDraft(session, faculty);
    const holdsOwnEdits = [...touched.current].some((field) =>
      field === 'speakers'
        ? speakerShape(incoming.speakers) !== speakerShape(draftRef.current.speakers)
        : incoming[field] !== draftRef.current[field],
    );

    setDraft((current) => {
      let next = current;
      for (const field of Object.keys(incoming) as (keyof Draft)[]) {
        if (touched.current.has(field)) continue;
        const same =
          field === 'speakers'
            ? speakerShape(incoming.speakers) === speakerShape(current.speakers)
            : incoming[field] === current[field];
        if (same) continue;
        if (next === current) next = { ...current };
        (next as unknown as Record<string, unknown>)[field] = incoming[field];
      }
      return next;
    });

    if (!holdsOwnEdits) {
      // Everything this editor holds now matches the server: it is up to date.
      baseUpdatedAt.current = session.updatedAt;
      savedTimes.current = { start: session.startMinute, end: session.endMinute };
    }
  }, [session, faculty]);

  const setTime = (field: 'startMinute' | 'endMinute', raw: string) => {
    const parsed = parseTimeInput(raw);
    if (parsed === null) {
      setTimeError('Enter a time such as 10:30 AM.');
      return;
    }
    edit([field], (current) => {
      // A time typed into the end field keeps whichever day that field is on,
      // so 12:00 AM on the next day stays midnight rather than becoming 0.
      const value =
        field === 'endMinute' ? composeMinute(parsed, isNextDay(current.endMinute)) : parsed;
      const next = { ...current, [field]: value };
      setTimeError(next.endMinute <= next.startMinute ? 'The end time must come after the start time.' : null);
      return next;
    });
  };

  /** Move the end time between this evening and the following morning. */
  const setEndsNextDay = (nextDay: boolean) =>
    edit(['endMinute'], (current) => {
      const next = { ...current, endMinute: composeMinute(current.endMinute, nextDay) };
      setTimeError(next.endMinute <= next.startMinute ? 'The end time must come after the start time.' : null);
      return next;
    });

  const duration = draft.endMinute - draft.startMinute;
  const facultyNames = useMemo(() => faculty.map((f) => f.name), [faculty]);

  const updateSpeaker = (key: string, patch: Partial<DraftSpeaker>) =>
    edit(['speakers'], (current) => ({
      ...current,
      speakers: current.speakers.map((speaker) => (speaker.key === key ? { ...speaker, ...patch } : speaker)),
    }));

  const moveSpeaker = (key: string, direction: -1 | 1) =>
    edit(['speakers'], (current) => {
      const from = current.speakers.findIndex((speaker) => speaker.key === key);
      const to = from + direction;
      if (from === -1 || to < 0 || to >= current.speakers.length) return current;
      const speakers = [...current.speakers];
      const [moved] = speakers.splice(from, 1);
      speakers.splice(to, 0, moved);
      return { ...current, speakers };
    });

  const conflict = room.conflicts[session.id];

  /** Put the other collaborator's version back, and carry on from theirs. */
  const useTheirVersion = async () => {
    const latest = conflict.latest;
    touched.current.clear();
    setDraft(toDraft(latest, faculty));
    savedTimes.current = { start: latest.startMinute, end: latest.endMinute };
    room.dismissConflict(session.id);
    await room.updateSession(
      session.id,
      {
        title: latest.title,
        description: latest.description,
        startMinute: latest.startMinute,
        endMinute: latest.endMinute,
        sessionType: latest.sessionType,
        sponsorName: latest.sponsorName,
        sponsorUrl: latest.sponsorUrl,
        room: latest.room,
        internalNotes: latest.internalNotes,
        speakers: latest.speakers.map((speaker) => ({
          facultyId: speaker.facultyId,
          displayName: speaker.displayName,
          role: speaker.role,
          status: speaker.status,
        })),
      },
      null,
    );
  };

  return (
    <div className={styles.editor}>
      {conflict ? (
        <div className={styles.conflictNotice} role="alert" aria-label="Session changed by another collaborator">
          <p className={styles.conflictHeadline}>
            {conflict.actorName} changed this session while you were editing. Your version was saved over
            theirs — nothing is lost, and both are in the change history.
          </p>

          {conflict.fields.length > 0 ? (
            <dl className={styles.conflictFields}>
              {conflict.fields.map((field) => (
                <div key={field.label}>
                  <dt>{field.label}</dt>
                  <dd>
                    <span className={styles.conflictTheirs}>{conflict.actorName}: {field.theirs}</span>
                    <span className={styles.conflictYours}>Yours: {field.yours}</span>
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          <div className={styles.conflictActions}>
            <button type="button" className="btn" onClick={() => void useTheirVersion()}>
              Use their version
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => room.dismissConflict(session.id)}>
              Keep mine
            </button>
          </div>
        </div>
      ) : null}

      {/* ---------------------------------------------------------- time */}
      <div className={styles.editorTimes}>
        <label className={styles.editorField}>
          <span className="fieldLabel">Start</span>
          <input
            className="field"
            type="time"
            step={300}
            value={toInputValue(draft.startMinute)}
            onChange={(event) => setTime('startMinute', event.target.value)}
          />
        </label>

        <span className={styles.editorDash} aria-hidden="true">
          –
        </span>

        <label className={styles.editorField}>
          <span className="fieldLabel">End</span>
          <input
            className="field"
            type="time"
            step={300}
            value={toInputValue(draft.endMinute)}
            onChange={(event) => setTime('endMinute', event.target.value)}
          />
        </label>

        <button
          type="button"
          className={styles.nextDayToggle}
          aria-pressed={isNextDay(draft.endMinute)}
          title="Ends after midnight, on the following morning"
          onClick={() => setEndsNextDay(!isNextDay(draft.endMinute))}
        >
          Next day
        </button>

        <p className={styles.editorDuration} aria-live="polite">
          {duration > 0 ? formatDuration(duration) : '—'}
          {draft.endMinute === MINUTES_IN_DAY ? <span className={styles.editorHint}>ends at midnight</span> : null}
        </p>
      </div>

      {timeError ? <p className={styles.editorError}>{timeError}</p> : null}

      {/* --------------------------------------------------------- topic */}
      <label className={styles.editorField}>
        <span className="fieldLabel">Topic</span>
        <input
          className={`field ${styles.titleInput}`}
          value={draft.title}
          placeholder="Session title"
          maxLength={200}
          onChange={(event) => edit(['title'], (current) => ({ ...current, title: event.target.value }))}
        />
      </label>

      {/* ------------------------------------------------------ speakers */}
      <div className={styles.editorField}>
        <span className="fieldLabel">Speakers</span>
        <datalist id="bhfa-faculty">
          {facultyNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>

        {draft.speakers.length === 0 ? <p className={styles.editorEmpty}>No speaker assigned yet.</p> : null}

        {draft.speakers.map((speaker, speakerIndex) => (
          <div className={styles.speakerRow} key={speaker.key}>
            <input
              className="field"
              list="bhfa-faculty"
              value={speaker.name}
              placeholder={speaker.status === 'tbd' ? 'To be confirmed' : 'Faculty name'}
              onChange={(event) => updateSpeaker(speaker.key, { name: event.target.value })}
              aria-label={`Speaker ${speakerIndex + 1} name`}
            />
            <select
              className={`field ${styles.compactSelect}`}
              value={speaker.role}
              aria-label={`Speaker ${speakerIndex + 1} role`}
              onChange={(event) => updateSpeaker(speaker.key, { role: event.target.value as SpeakerRole })}
            >
              {SPEAKER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role === 'speaker' ? 'Speaker' : role === 'moderator' ? 'Moderator' : 'Panelist'}
                </option>
              ))}
            </select>
            <select
              className={`field ${styles.compactSelect}`}
              value={speaker.status}
              aria-label={`Speaker ${speakerIndex + 1} status`}
              onChange={(event) => updateSpeaker(speaker.key, { status: event.target.value as SpeakerStatus })}
            >
              {SPEAKER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {SPEAKER_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
            <div className={styles.speakerActions}>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`Move ${speaker.name || 'speaker'} up`}
                disabled={speakerIndex === 0}
                onClick={() => moveSpeaker(speaker.key, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`Move ${speaker.name || 'speaker'} down`}
                disabled={speakerIndex === draft.speakers.length - 1}
                onClick={() => moveSpeaker(speaker.key, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`Remove ${speaker.name || 'speaker'}`}
                onClick={() =>
                  edit(['speakers'], (current) => ({
                    ...current,
                    speakers: current.speakers.filter((entry) => entry.key !== speaker.key),
                  }))
                }
              >
                ×
              </button>
            </div>
          </div>
        ))}

        <button
          type="button"
          className={styles.addSpeaker}
          onClick={() =>
            edit(['speakers'], (current) => ({
              ...current,
              speakers: [
                ...current.speakers,
                { key: `new-${Date.now()}-${current.speakers.length}`, name: '', role: 'speaker', status: 'confirmed' },
              ],
            }))
          }
        >
          + Add speaker
        </button>
      </div>

      {/* ---------------------------------------------------- description */}
      <label className={styles.editorField}>
        <span className="fieldLabel">Description</span>
        <textarea
          className={`field ${styles.textarea}`}
          rows={3}
          maxLength={4000}
          value={draft.description}
          placeholder="What this session covers."
          onChange={(event) => edit(['description'], (current) => ({ ...current, description: event.target.value }))}
        />
      </label>

      {/* --------------------------------------------------- more options */}
      <button
        type="button"
        className={styles.moreToggle}
        aria-expanded={showMore}
        onClick={() => setShowMore((open) => !open)}
      >
        {showMore ? 'Fewer options' : 'More options'}
      </button>

      {showMore ? (
        <div className={styles.morePanel}>
          <div className={styles.moreGrid}>
            <label className={styles.editorField}>
              <span className="fieldLabel">Session type</span>
              <select
                className="field"
                value={draft.sessionType}
                onChange={(event) =>
                  edit(['sessionType'], (current) => ({ ...current, sessionType: event.target.value as SessionType }))
                }
              >
                {SESSION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {SESSION_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.editorField}>
              <span className="fieldLabel">Room / location</span>
              <input
                className="field"
                value={draft.room}
                placeholder="Optional"
                onChange={(event) => edit(['room'], (current) => ({ ...current, room: event.target.value }))}
              />
            </label>

            <label className={styles.editorField}>
              <span className="fieldLabel">Sponsor / partner</span>
              <input
                className="field"
                value={draft.sponsorName}
                placeholder="Optional — shown as “Supported by …”"
                onChange={(event) => edit(['sponsorName'], (current) => ({ ...current, sponsorName: event.target.value }))}
              />
            </label>

            <label className={styles.editorField}>
              <span className="fieldLabel">Sponsor link</span>
              <input
                className="field"
                type="url"
                inputMode="url"
                value={draft.sponsorUrl}
                placeholder="https://"
                onChange={(event) => edit(['sponsorUrl'], (current) => ({ ...current, sponsorUrl: event.target.value }))}
              />
            </label>
          </div>

          <label className={styles.editorField}>
            <span className="fieldLabel">Internal planning notes</span>
            <textarea
              className={`field ${styles.textarea}`}
              rows={2}
              value={draft.internalNotes}
              placeholder="Only visible here — never shown on the agenda."
              onChange={(event) => edit(['internalNotes'], (current) => ({ ...current, internalNotes: event.target.value }))}
            />
          </label>

          <div className={styles.moreActions}>
            <button type="button" className="btn btn--quiet" onClick={() => void room.duplicateSession(session)}>
              Duplicate
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                if (window.confirm(`Delete “${session.title || 'this session'}”? You can undo this straight away.`)) {
                  void room.deleteSession(session);
                }
              }}
            >
              Delete session
            </button>
          </div>
        </div>
      ) : null}

      {/* -------------------------------------------------------- footer */}
      <div className={styles.editorFooter}>
        <div className={styles.moveControls}>
          <span className="fieldLabel">Move</span>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Move session up"
            disabled={index === 0}
            onClick={() => void room.reorder(session.id, day.id, index - 1, { announce: true })}
          >
            ↑
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Move session down"
            disabled={index === daySessions.length - 1}
            onClick={() => void room.reorder(session.id, day.id, index + 1, { announce: true })}
          >
            ↓
          </button>
          <select
            className={`field ${styles.compactSelect}`}
            aria-label="Move to another day"
            value={day.id}
            onChange={(event) => {
              const targetDayId = event.target.value;
              if (targetDayId === day.id) return;
              void room.reorder(session.id, targetDayId, room.sessionsByDay(targetDayId).length);
            }}
          >
            {room.snapshot.days.map((option) => (
              <option key={option.id} value={option.id}>
                Day {String(option.dayNumber).padStart(2, '0')} · {option.shortLabel}
              </option>
            ))}
          </select>
        </div>

        <button type="button" className="btn" onClick={onClose}>
          Done
        </button>
      </div>

      <p className={styles.editorMeta}>
        {formatTime(session.startMinute)} · last edited by {session.updatedBy ?? 'the program draft'}
      </p>
    </div>
  );
}
