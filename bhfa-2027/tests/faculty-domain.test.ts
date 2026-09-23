/**
 * Faculty register logic: every count, filter and ordering rule the workspace
 * shows is defined once, here, and derived from the records — never hard-coded.
 */
import { describe, expect, it } from 'vitest';
import type { Faculty, FacultyRegion, FacultyStatus } from '@/lib/domain/types';
import {
  EMPTY_FILTER,
  activeList,
  countFaculty,
  facultyRecord,
  inactiveList,
  sortKey,
  suggestRegion,
  unsortedList,
} from '@/lib/domain/faculty';

let n = 0;
const person = (name: string, status: FacultyStatus | null, region: FacultyRegion | null = null, extra: Partial<Faculty> = {}) =>
  facultyRecord({ id: `f-${n++}`, programId: 'p', name, status, region, ...extra });

const roster = () => [
  person('Dr. Marc Mani', 'confirmed', 'local'),
  person('Dr. Ashkan Ghavami', 'confirmed', 'local'),
  person('Dr. Ana Silva', 'maybe', 'international', { specialty: 'Rhinoplasty', country: 'Brazil' }),
  person('Dr. Ben Cole', 'maybe', 'united_states'),
  person('Dr. Cara Lin', 'confirmed', null),
  person('Dr. Dana Roe', 'declined', 'united_states'),
  person('Dr. Eli Park', 'not_pursuing', 'international'),
  person('Dr. Typed Speaker', null),
];

describe('facultyRecord', () => {
  it('fills every field, so no creation site can forget a column', () => {
    const f = facultyRecord({ id: 'x', programId: 'p', name: 'Dr. X' });
    expect(f.status).toBeNull();
    expect(f.region).toBeNull();
    expect(f.priority).toBe(false);
    expect(f.internalNotes).toBeNull();
  });
});

describe('countFaculty', () => {
  it('derives every counter from the records', () => {
    const c = countFaculty(roster());
    expect(c.active).toBe(5);
    expect(c.confirmed).toBe(3);
    expect(c.maybe).toBe(2);
    expect(c.inactive).toBe(2);
    expect(c.declined).toBe(1);
    expect(c.notPursuing).toBe(1);
    expect(c.unsorted).toBe(1);
  });

  it('counts regions over the active pipeline, so they sum to the active total', () => {
    const c = countFaculty(roster());
    expect(c.local).toBe(2);
    expect(c.unitedStates).toBe(1);
    expect(c.international).toBe(1);
    expect(c.regionNotSet).toBe(1);
    expect(c.local + c.unitedStates + c.international + c.regionNotSet).toBe(c.active);
  });

  it('changes as soon as someone moves', () => {
    const list = roster();
    const before = countFaculty(list);
    list[3] = { ...list[3], status: 'declined' };
    const after = countFaculty(list);
    expect(after.active).toBe(before.active - 1);
    expect(after.maybe).toBe(before.maybe - 1);
    expect(after.inactive).toBe(before.inactive + 1);
  });

  it('is all zeros for an empty register — nothing is assumed', () => {
    expect(countFaculty([])).toMatchObject({ active: 0, confirmed: 0, maybe: 0, inactive: 0 });
  });
});

describe('the active list', () => {
  it('holds Confirmed and Maybe together, and nobody else', () => {
    const names = activeList(roster(), EMPTY_FILTER).map((f) => f.status);
    expect(new Set(names)).toEqual(new Set(['confirmed', 'maybe']));
    expect(names).toHaveLength(5);
  });

  it('orders by name, ignoring the honorific', () => {
    expect(sortKey('Dr. Marc Mani')).toBe('marc mani');
    const names = activeList(roster(), EMPTY_FILTER).map((f) => f.name);
    expect(names).toEqual([...names].sort((a, b) => sortKey(a).localeCompare(sortKey(b))));
  });

  it('lifts priority faculty to the top', () => {
    const list = roster();
    list[3] = { ...list[3], priority: true };
    expect(activeList(list, EMPTY_FILTER)[0].name).toBe('Dr. Ben Cole');
  });

  it('filters by status', () => {
    expect(activeList(roster(), { ...EMPTY_FILTER, status: 'maybe' }).map((f) => f.name)).toEqual([
      'Dr. Ana Silva',
      'Dr. Ben Cole',
    ]);
    expect(activeList(roster(), { ...EMPTY_FILTER, status: 'confirmed' })).toHaveLength(3);
  });

  it('filters by region', () => {
    expect(activeList(roster(), { ...EMPTY_FILTER, region: 'international' }).map((f) => f.name)).toEqual([
      'Dr. Ana Silva',
    ]);
    expect(activeList(roster(), { ...EMPTY_FILTER, region: 'local' })).toHaveLength(2);
  });

  it('combines region and status filters', () => {
    expect(activeList(roster(), { ...EMPTY_FILTER, region: 'local', status: 'maybe' })).toHaveLength(0);
  });

  it('searches by name, case-insensitively', () => {
    expect(activeList(roster(), { ...EMPTY_FILTER, query: 'ghav' }).map((f) => f.name)).toEqual([
      'Dr. Ashkan Ghavami',
    ]);
  });

  it('searches specialty and country too', () => {
    expect(activeList(roster(), { ...EMPTY_FILTER, query: 'rhino' })).toHaveLength(1);
    expect(activeList(roster(), { ...EMPTY_FILTER, query: 'brazil' })).toHaveLength(1);
  });
});

describe('the inactive section', () => {
  it('holds Declined and Not Pursuing, kept distinct', () => {
    const list = inactiveList(roster(), EMPTY_FILTER);
    expect(list.map((f) => f.status).sort()).toEqual(['declined', 'not_pursuing']);
  });

  it('ignores the active status filter', () => {
    expect(inactiveList(roster(), { ...EMPTY_FILTER, status: 'confirmed' })).toHaveLength(2);
  });
});

describe('agenda-only names', () => {
  it('are not in the active pipeline just because they are on a session', () => {
    expect(activeList(roster(), EMPTY_FILTER).some((f) => f.name === 'Dr. Typed Speaker')).toBe(false);
    expect(unsortedList(roster(), EMPTY_FILTER).map((f) => f.name)).toEqual(['Dr. Typed Speaker']);
  });
});

describe('suggestRegion', () => {
  it('suggests Local for Beverly Hills and its neighbours', () => {
    expect(suggestRegion({ city: 'Beverly Hills', stateProvince: 'CA', country: 'United States' })).toBe('local');
    expect(suggestRegion({ city: 'Santa Monica', stateProvince: null, country: 'USA' })).toBe('local');
  });

  it('suggests United States elsewhere in the US', () => {
    expect(suggestRegion({ city: 'New York', stateProvince: 'NY', country: 'US' })).toBe('united_states');
  });

  it('suggests International outside the US', () => {
    expect(suggestRegion({ city: 'São Paulo', stateProvince: null, country: 'Brazil' })).toBe('international');
  });

  it('suggests nothing when there is nothing to go on', () => {
    expect(suggestRegion({ city: null, stateProvince: null, country: null })).toBeNull();
  });
});
