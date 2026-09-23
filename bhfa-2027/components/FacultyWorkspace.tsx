'use client';

import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import type { ProgramRoomState } from '@/lib/client/useProgramRoom';
import { FACULTY_REGIONS, FACULTY_REGION_SHORT, type Faculty } from '@/lib/domain/types';
import {
  EMPTY_FILTER,
  activeList,
  countFaculty,
  inactiveList,
  unsortedList,
  type FacultyFilter,
  type RegionFilter,
  type StatusFilter,
} from '@/lib/domain/faculty';
import FacultyRow from './FacultyRow';
import styles from '@/styles/faculty.module.css';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all_active', label: 'All active' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'maybe', label: 'Maybe' },
];

const REGION_FILTERS: { value: RegionFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  ...FACULTY_REGIONS.map((region) => ({ value: region, label: FACULTY_REGION_SHORT[region] })),
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The faculty register.
 *
 * The active pipeline — Confirmed and Maybe together, told apart by colour — is
 * what the page is about. People who said no, or whom BHFA stopped pursuing,
 * sit in a separate section below, collapsed by default. Every count is derived
 * from the records on screen; none is written down anywhere.
 *
 * Filtering and search run in the browser against the roster already loaded,
 * so they are instant and never reload anything.
 */
export default function FacultyWorkspace({ room }: { room: ProgramRoomState }) {
  const faculty = room.snapshot.faculty;
  const [filter, setFilter] = useState<FacultyFilter>(EMPTY_FILTER);
  const [openId, setOpenId] = useState<string | null>(null);
  // The person just added, whose record opens ready for the next detail.
  const [freshId, setFreshId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState('');
  const addInput = useRef<HTMLInputElement>(null);

  // Typing in search never blocks on filtering the list.
  const query = useDeferredValue(filter.query);
  const effective = useMemo(() => ({ ...filter, query }), [filter, query]);

  const counts = useMemo(() => countFaculty(faculty), [faculty]);
  const active = useMemo(() => activeList(faculty, effective), [faculty, effective]);
  const inactive = useMemo(() => inactiveList(faculty, effective), [faculty, effective]);
  const unsorted = useMemo(() => unsortedList(faculty, effective), [faculty, effective]);
  const declined = inactive.filter((f) => f.status === 'declined');
  const notPursuing = inactive.filter((f) => f.status === 'not_pursuing');

  const filtered = filter.region !== 'all' || filter.status !== 'all_active' || query.trim() !== '';

  // Stable, so memoised rows are not re-rendered by a parent render.
  const toggle = useCallback((id: string) => {
    setFreshId(null);
    setOpenId((current) => (current === id ? null : id));
  }, []);

  const row = (member: Faculty) => (
    <FacultyRow
      key={member.id}
      room={room}
      member={member}
      open={openId === member.id}
      fresh={freshId === member.id}
      onToggle={toggle}
    />
  );

  const add = async () => {
    const name = adding.trim();
    if (!name) {
      addInput.current?.focus();
      return;
    }
    setAdding('');
    // New people start in the active pipeline as Maybe; the pill moves them on.
    const id = await room.createFaculty({ name, status: 'maybe' });
    if (id) {
      setFreshId(id);
      setOpenId(id);
    }
  };

  return (
    <section className={styles.workspace} aria-label="Faculty register">
      {/* -------------------------------------------------------- counters */}
      <header className={styles.summary}>
        <div className={styles.summaryLead}>
          <p className={styles.bigCount}>{counts.active}</p>
          <p className={styles.bigLabel}>Active faculty</p>
        </div>
        <dl className={styles.countGrid}>
          <div data-tone="confirmed">
            <dt>Confirmed</dt>
            <dd>{counts.confirmed}</dd>
          </div>
          <div data-tone="maybe">
            <dt>Maybe</dt>
            <dd>{counts.maybe}</dd>
          </div>
          <div>
            <dt>Local</dt>
            <dd>{counts.local}</dd>
          </div>
          <div>
            <dt>United States</dt>
            <dd>{counts.unitedStates}</dd>
          </div>
          <div>
            <dt>International</dt>
            <dd>{counts.international}</dd>
          </div>
          <div data-tone="muted">
            <dt>Inactive</dt>
            <dd>{counts.inactive}</dd>
          </div>
        </dl>
        {counts.regionNotSet > 0 ? (
          <p className={styles.summaryNote}>{plural(counts.regionNotSet, 'active member')} without a region yet.</p>
        ) : null}
      </header>

      {/* --------------------------------------------------------- toolbar */}
      <div className={styles.toolbar}>
        <label className={styles.search}>
          <span className={styles.visuallyHidden}>Search faculty</span>
          <input
            className="field"
            type="search"
            placeholder="Search by name"
            value={filter.query}
            onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))}
          />
        </label>

        <div className={styles.chips} role="group" aria-label="Region">
          {REGION_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={styles.chip}
              aria-pressed={filter.region === option.value}
              onClick={() => setFilter((current) => ({ ...current, region: option.value }))}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className={styles.chips} role="group" aria-label="Status">
          {STATUS_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={styles.chip}
              data-tone={option.value}
              aria-pressed={filter.status === option.value}
              onClick={() => setFilter((current) => ({ ...current, status: option.value }))}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* ----------------------------------------------------- add faculty */}
      <form
        className={styles.addRow}
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <input
          ref={addInput}
          className="field"
          placeholder="Add faculty — full name"
          value={adding}
          maxLength={160}
          onChange={(event) => setAdding(event.target.value)}
          aria-label="New faculty member's name"
        />
        <button type="submit" className="btn btn--solid" disabled={!adding.trim()}>
          Add faculty
        </button>
      </form>

      {/* ---------------------------------------------------------- active */}
      <div className={styles.listHead}>
        <h2 className={styles.listTitle}>Active</h2>
        {filtered ? (
          <p className={styles.listMeta}>
            Showing {active.length} of {counts.active}
            <button type="button" className={styles.clear} onClick={() => setFilter(EMPTY_FILTER)}>
              Clear filters
            </button>
          </p>
        ) : null}
      </div>
      {active.length ? (
        <div className={styles.list}>
          {active.map(row)}
        </div>
      ) : (
        <p className={styles.empty}>
          {counts.active === 0
            ? 'No active faculty yet. Add someone above — they start as Maybe.'
            : 'No active faculty match these filters.'}
        </p>
      )}

      {/* ------------------------------------------------------- unsorted */}
      {unsorted.length ? (
        <section className={styles.section}>
          <div className={styles.listHead}>
            <h2 className={styles.listTitle}>From the agenda</h2>
            <p className={styles.listMeta}>Named on a session, not yet in the faculty register.</p>
          </div>
          <div className={styles.list}>
            {unsorted.map(row)}
          </div>
        </section>
      ) : null}

      {/* -------------------------------------------------------- inactive */}
      <section className={styles.section} data-inactive>
        <button
          type="button"
          className={styles.inactiveToggle}
          aria-expanded={showInactive}
          onClick={() => setShowInactive((value) => !value)}
        >
          <span className={styles.listTitle}>No / Not Pursuing</span>
          <span className={styles.listMeta}>
            {counts.declined} declined · {counts.notPursuing} not pursuing
          </span>
          <span aria-hidden="true" className={styles.toggleCaret} data-open={showInactive || undefined}>
            ▾
          </span>
        </button>
        {showInactive ? (
          inactive.length ? (
            <>
              {declined.length ? (
                <div className={styles.subgroup}>
                  <h3 className={styles.subTitle}>Declined — said no</h3>
                  <div className={styles.list}>
                    {declined.map(row)}
                  </div>
                </div>
              ) : null}
              {notPursuing.length ? (
                <div className={styles.subgroup}>
                  <h3 className={styles.subTitle}>Not Pursuing — BHFA's decision</h3>
                  <div className={styles.list}>
                    {notPursuing.map(row)}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className={styles.empty}>{counts.inactive ? 'No inactive faculty match these filters.' : 'Nobody here yet.'}</p>
          )
        ) : null}
      </section>
    </section>
  );
}
