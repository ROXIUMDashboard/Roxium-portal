'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Faculty } from '@/lib/domain/types';
import { FACULTY_REGION_LABELS } from '@/lib/domain/types';
import { suggestRegion } from '@/lib/domain/faculty';
import type { ProgramRoomState } from '@/lib/client/useProgramRoom';
import styles from '@/styles/faculty.module.css';

/** The same rhythm as the agenda editors, so the whole room saves alike. */
const AUTOSAVE_MS = 650;

/** Free-text fields the editor owns. Status, region and priority are one-click, saved at once. */
const TEXT_FIELDS = [
  'name',
  'credentials',
  'specialty',
  'institution',
  'city',
  'stateProvince',
  'country',
  'proposedRole',
  'invitationStatus',
  'invitationDate',
  'lastContactDate',
  'owner',
  'internalNotes',
  'email',
  'phone',
  'website',
  'headshotUrl',
] as const;
type TextField = (typeof TEXT_FIELDS)[number];
type Draft = Record<TextField, string>;

const toDraft = (f: Faculty): Draft =>
  Object.fromEntries(TEXT_FIELDS.map((key) => [key, (f[key] as string | null) ?? ''])) as Draft;

interface FieldSpec {
  key: TextField;
  label: string;
  placeholder?: string;
  type?: 'text' | 'date' | 'email' | 'tel' | 'url';
  wide?: boolean;
  multiline?: boolean;
}

const GROUPS: { title: string; fields: FieldSpec[] }[] = [
  {
    title: 'Faculty',
    fields: [
      { key: 'name', label: 'Full name', placeholder: 'Dr. First Last', wide: true },
      { key: 'credentials', label: 'Credentials', placeholder: 'MD, FACS' },
      { key: 'specialty', label: 'Specialty / expertise', placeholder: 'Facial plastic surgery' },
      { key: 'institution', label: 'Institution / practice', wide: true },
    ],
  },
  {
    title: 'Location',
    fields: [
      { key: 'city', label: 'City', placeholder: 'Beverly Hills' },
      { key: 'stateProvince', label: 'State / province', placeholder: 'CA' },
      { key: 'country', label: 'Country', placeholder: 'United States' },
    ],
  },
  {
    title: 'Planning',
    fields: [
      { key: 'proposedRole', label: 'Proposed BHFA role', placeholder: 'Panelist, moderator…' },
      { key: 'invitationStatus', label: 'Invitation status', placeholder: 'Invited, awaiting reply…' },
      { key: 'invitationDate', label: 'Invitation date', type: 'date' },
      { key: 'lastContactDate', label: 'Last contact', type: 'date' },
      { key: 'owner', label: 'Owner', placeholder: 'Who is handling this' },
      { key: 'internalNotes', label: 'Internal notes', wide: true, multiline: true },
    ],
  },
  {
    title: 'Contact · optional',
    fields: [
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Phone', type: 'tel' },
      { key: 'website', label: 'Website', type: 'url', placeholder: 'practice.com' },
      { key: 'headshotUrl', label: 'Headshot URL', type: 'url' },
    ],
  },
];

/**
 * A faculty member's full record, edited in place.
 *
 * Like the agenda editors: nothing to press. Each field autosaves on a short
 * debounce, and only the fields this collaborator actually typed in are written
 * — so a colleague changing the same person's notes at the same time is not
 * overwritten by a stale copy of everything else.
 */
export default function FacultyEditor({ room, member }: { room: ProgramRoomState; member: Faculty }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(member));
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const memberRef = useRef(member);
  memberRef.current = member;
  const touched = useRef(new Set<TextField>());
  const firstField = useRef<HTMLInputElement>(null);

  const save = useCallback(async () => {
    const saved = toDraft(memberRef.current);
    const patch: Record<string, unknown> = {};
    for (const key of touched.current) {
      if (draftRef.current[key] !== saved[key]) patch[key] = draftRef.current[key].trim() || null;
    }
    if (!Object.keys(patch).length) return;
    if ('name' in patch && !patch.name) {
      setError('A faculty member needs a name.');
      return;
    }
    setError(null);
    const sent = { ...draftRef.current };
    const response = await room.updateFaculty(memberRef.current.id, patch as Partial<Faculty>);
    if (!response) return;
    for (const key of Object.keys(patch) as TextField[]) {
      if (sent[key] === draftRef.current[key]) touched.current.delete(key);
    }
  }, [room]);

  // `room` is rebuilt every render; reach save through a ref so the debounce
  // re-arms on edits, not on renders.
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    const timer = window.setTimeout(() => void saveRef.current(), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [draft]);

  useEffect(() => () => void saveRef.current(), []);

  // A colleague's change lands on the fields this collaborator has not touched.
  useEffect(() => {
    const incoming = toDraft(member);
    setDraft((current) => {
      let next = current;
      for (const key of TEXT_FIELDS) {
        if (touched.current.has(key) || incoming[key] === current[key]) continue;
        if (next === current) next = { ...current };
        next[key] = incoming[key];
      }
      return next;
    });
  }, [member]);

  useEffect(() => {
    firstField.current?.focus({ preventScroll: true });
  }, []);

  const edit = (key: TextField, value: string) => {
    touched.current.add(key);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const suggestion = member.region
    ? null
    : suggestRegion({ city: draft.city || null, stateProvince: draft.stateProvince || null, country: draft.country || null });

  return (
    <div className={styles.editor} data-keeps-editor-open>
      {GROUPS.map((group) => (
        <fieldset key={group.title} className={styles.group}>
          <legend className={styles.groupTitle}>{group.title}</legend>
          <div className={styles.groupFields}>
            {group.fields.map((field, index) => (
              <label key={field.key} className={field.wide ? `${styles.field} ${styles.fieldWide}` : styles.field}>
                <span className="fieldLabel">{field.label}</span>
                {field.multiline ? (
                  <textarea
                    className="field"
                    rows={3}
                    value={draft[field.key]}
                    placeholder={field.placeholder}
                    onChange={(event) => edit(field.key, event.target.value)}
                  />
                ) : (
                  <input
                    ref={group.title === 'Faculty' && index === 0 ? firstField : undefined}
                    className="field"
                    type={field.type ?? 'text'}
                    value={draft[field.key]}
                    placeholder={field.placeholder}
                    onChange={(event) => edit(field.key, event.target.value)}
                  />
                )}
              </label>
            ))}
          </div>
          {group.title === 'Location' && suggestion ? (
            <p className={styles.suggestion}>
              Region not set. From this location:{' '}
              <button
                type="button"
                className={styles.suggestionApply}
                onClick={() => void room.updateFaculty(member.id, { region: suggestion })}
              >
                Set {FACULTY_REGION_LABELS[suggestion]}
              </button>
            </p>
          ) : null}
        </fieldset>
      ))}

      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.editorFooter}>
        <label className={styles.priority}>
          <input
            type="checkbox"
            checked={member.priority}
            onChange={(event) => void room.updateFaculty(member.id, { priority: event.target.checked })}
          />
          <span>Priority</span>
        </label>
        <button
          type="button"
          className={styles.remove}
          onClick={() => {
            if (window.confirm(`Remove ${member.name} from the faculty register?`)) void room.deleteFaculty(member);
          }}
        >
          Remove from register
        </button>
      </div>
    </div>
  );
}
