'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Faculty } from '@/lib/domain/types';
import { FACULTY_REGION_LABELS } from '@/lib/domain/types';
import { suggestRegion } from '@/lib/domain/faculty';
import type { ProgramRoomState } from '@/lib/client/useProgramRoom';
import styles from '@/styles/faculty.module.css';

/** The same rhythm as the agenda editors, so the whole room saves alike. */
const AUTOSAVE_MS = 650;

/**
 * Who they are, what they do, where they are, and what BHFA has in mind for
 * them. Status and region are not here: they sit on the row, one click each.
 */
const FIELDS = [
  { key: 'name', label: 'Full name', placeholder: 'Dr. First Last', span: 'name' },
  { key: 'credentials', label: 'Credentials', placeholder: 'MD, FACS', span: 'credentials' },
  { key: 'specialty', label: 'Specialty / expertise', placeholder: 'Facial plastic surgery', span: 'half' },
  { key: 'proposedRole', label: 'Proposed BHFA role', placeholder: 'Panelist, moderator…', span: 'half' },
  { key: 'city', label: 'City', placeholder: 'Beverly Hills', span: 'third' },
  { key: 'stateProvince', label: 'State / province', placeholder: 'CA', span: 'third' },
  { key: 'country', label: 'Country', placeholder: 'United States', span: 'third' },
] as const;

type TextField = (typeof FIELDS)[number]['key'];
type Draft = Record<TextField, string>;

const toDraft = (f: Faculty): Draft =>
  Object.fromEntries(FIELDS.map(({ key }) => [key, f[key] ?? ''])) as Draft;

/**
 * Removal is rare and final, so it lives behind a quiet "•••" rather than
 * sitting in every open record. Not Pursuing is the everyday way out.
 */
function MoreActions({ name, onRemove }: { name: string; onRemove: () => void }) {
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

  return (
    <div className={styles.moreWrap} ref={wrap}>
      <button
        type="button"
        className={styles.more}
        aria-expanded={open}
        aria-label={`More actions for ${name}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">•••</span>
      </button>
      {open ? (
        <div className={styles.moreMenu}>
          <button
            type="button"
            className={styles.moreItem}
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
          >
            Remove from register…
          </button>
          <p className={styles.moreHint}>To stop pursuing someone, change their status instead.</p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A faculty member's record, edited in place.
 *
 * Like the agenda editors: nothing to press. Each field autosaves on a short
 * debounce, and only the fields this collaborator actually typed in are written
 * — so a colleague changing the same person at the same time is not
 * overwritten by a stale copy of everything else.
 */
export default function FacultyEditor({
  room,
  member,
  fresh = false,
}: {
  room: ProgramRoomState;
  member: Faculty;
  /** Just added: the name is in, so the caret goes straight to the next field. */
  fresh?: boolean;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(member));
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const memberRef = useRef(member);
  memberRef.current = member;
  const touched = useRef(new Set<TextField>());
  const credentialsField = useRef<HTMLInputElement>(null);

  const save = useCallback(async () => {
    const saved = toDraft(memberRef.current);
    const patch: Partial<Record<TextField, string | null>> = {};
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
      for (const { key } of FIELDS) {
        if (touched.current.has(key) || incoming[key] === current[key]) continue;
        if (next === current) next = { ...current };
        next[key] = incoming[key];
      }
      return next;
    });
  }, [member]);

  useEffect(() => {
    if (fresh) credentialsField.current?.focus({ preventScroll: true });
  }, [fresh]);

  const edit = (key: TextField, value: string) => {
    touched.current.add(key);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const suggestion = member.region
    ? null
    : suggestRegion({ city: draft.city || null, stateProvince: draft.stateProvince || null, country: draft.country || null });

  return (
    <div className={styles.editor} data-keeps-editor-open>
      <div className={styles.fields}>
        {FIELDS.map((field) => (
          <label key={field.key} className={styles.field} data-span={field.span}>
            <span className="fieldLabel">{field.label}</span>
            <input
              ref={field.key === 'credentials' ? credentialsField : undefined}
              className="field"
              data-name={field.key === 'name' || undefined}
              value={draft[field.key]}
              placeholder={field.placeholder}
              onChange={(event) => edit(field.key, event.target.value)}
            />
          </label>
        ))}
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.editorFooter}>
        {suggestion ? (
          <p className={styles.suggestion}>
            No region yet —{' '}
            <button
              type="button"
              className={styles.suggestionApply}
              onClick={() => void room.updateFaculty(member.id, { region: suggestion })}
            >
              Set {FACULTY_REGION_LABELS[suggestion]}
            </button>
          </p>
        ) : (
          <span />
        )}
        <MoreActions
          name={member.name}
          onRemove={() => {
            if (window.confirm(`Remove ${member.name} from the faculty register?`)) void room.deleteFaculty(member);
          }}
        />
      </div>
    </div>
  );
}
