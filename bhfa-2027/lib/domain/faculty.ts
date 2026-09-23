/**
 * Faculty register logic: counting, filtering, ordering and region suggestion.
 *
 * Pure functions over the canonical faculty records, so the counters, the
 * filters and the tests all agree on exactly one definition of each. No total
 * is ever hard-coded — every number here is derived from the records passed in.
 */
import {
  ACTIVE_FACULTY_STATUSES,
  INACTIVE_FACULTY_STATUSES,
  type Faculty,
  type FacultyRegion,
  type FacultyStatus,
} from './types';

/**
 * A complete faculty record from the fields that matter, with everything else
 * explicitly empty. The one place a Faculty is assembled, so a new column can
 * never be forgotten at one creation site and present at another.
 */
export function facultyRecord(
  fields: Pick<Faculty, 'id' | 'programId' | 'name'> & Partial<Faculty>,
): Faculty {
  return {
    credentials: null,
    headshotUrl: null,
    status: null,
    region: null,
    city: null,
    stateProvince: null,
    country: null,
    specialty: null,
    proposedRole: null,
    invitationStatus: null,
    invitationDate: null,
    lastContactDate: null,
    owner: null,
    priority: false,
    internalNotes: null,
    email: null,
    phone: null,
    institution: null,
    website: null,
    sortOrder: 0,
    updatedAt: null,
    updatedBy: null,
    ...fields,
  };
}

export const isActive = (f: Faculty) =>
  f.status !== null && (ACTIVE_FACULTY_STATUSES as readonly string[]).includes(f.status);

export const isInactive = (f: Faculty) =>
  f.status !== null && (INACTIVE_FACULTY_STATUSES as readonly string[]).includes(f.status);

/** Known to the agenda, not yet placed in the register. */
export const isUnsorted = (f: Faculty) => f.status === null;

export interface FacultyCounts {
  active: number;
  confirmed: number;
  maybe: number;
  /** Region counts are over the ACTIVE pipeline, so they sum to `active`. */
  local: number;
  unitedStates: number;
  international: number;
  regionNotSet: number;
  inactive: number;
  declined: number;
  notPursuing: number;
  unsorted: number;
}

export function countFaculty(faculty: Faculty[]): FacultyCounts {
  const active = faculty.filter(isActive);
  const by = (list: Faculty[], status: FacultyStatus) => list.filter((f) => f.status === status).length;
  const region = (r: FacultyRegion) => active.filter((f) => f.region === r).length;
  return {
    active: active.length,
    confirmed: by(active, 'confirmed'),
    maybe: by(active, 'maybe'),
    local: region('local'),
    unitedStates: region('united_states'),
    international: region('international'),
    regionNotSet: active.filter((f) => f.region === null).length,
    inactive: faculty.filter(isInactive).length,
    declined: by(faculty, 'declined'),
    notPursuing: by(faculty, 'not_pursuing'),
    unsorted: faculty.filter(isUnsorted).length,
  };
}

export type RegionFilter = 'all' | FacultyRegion;
export type StatusFilter = 'all_active' | 'confirmed' | 'maybe';

export interface FacultyFilter {
  region: RegionFilter;
  status: StatusFilter;
  query: string;
}

export const EMPTY_FILTER: FacultyFilter = { region: 'all', status: 'all_active', query: '' };

/** Honorifics are ignored when matching and ordering: "Dr. Mani" sorts under M. */
const HONORIFIC = /^(dr|prof|professor|mr|mrs|ms|mx|sir|dame)\.?\s+/i;
export const sortKey = (name: string) => name.trim().replace(HONORIFIC, '').toLocaleLowerCase();

const matchesQuery = (f: Faculty, query: string) => {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return true;
  return [f.name, f.credentials, f.specialty, f.proposedRole, f.city, f.stateProvince, f.country]
    .filter(Boolean)
    .some((field) => String(field).toLocaleLowerCase().includes(q));
};

const byName = (a: Faculty, b: Faculty) => sortKey(a.name).localeCompare(sortKey(b.name));

/** The active list: Confirmed and Maybe together, ordered by name. */
export function activeList(faculty: Faculty[], filter: FacultyFilter): Faculty[] {
  return faculty
    .filter(isActive)
    .filter((f) => filter.status === 'all_active' || f.status === filter.status)
    .filter((f) => filter.region === 'all' || f.region === filter.region)
    .filter((f) => matchesQuery(f, filter.query))
    .sort(byName);
}

/** Declined and Not Pursuing. Region and search apply; the status filter does not. */
export function inactiveList(faculty: Faculty[], filter: FacultyFilter): Faculty[] {
  return faculty
    .filter(isInactive)
    .filter((f) => filter.region === 'all' || f.region === filter.region)
    .filter((f) => matchesQuery(f, filter.query))
    .sort(byName);
}

/** Named on the agenda but not in the register. Search applies. */
export function unsortedList(faculty: Faculty[], filter: FacultyFilter): Faculty[] {
  return faculty.filter(isUnsorted).filter((f) => matchesQuery(f, filter.query)).sort(byName);
}

const LOCAL_CITIES = [
  'beverly hills', 'los angeles', 'west hollywood', 'santa monica', 'century city',
  'brentwood', 'bel air', 'malibu', 'culver city', 'pasadena', 'encino', 'sherman oaks',
  'newport beach', 'marina del rey', 'westwood', 'studio city', 'burbank', 'glendale',
];
const US_NAMES = ['us', 'u.s.', 'usa', 'u.s.a.', 'united states', 'united states of america', 'america'];

/**
 * A region suggested from location, or null when there is nothing to go on.
 *
 * This only ever suggests. The workspace offers it as a one-click choice and
 * never writes it over a region someone has already set on purpose.
 */
export function suggestRegion(f: Pick<Faculty, 'city' | 'stateProvince' | 'country'>): FacultyRegion | null {
  const country = f.country?.trim().toLocaleLowerCase() ?? '';
  const city = f.city?.trim().toLocaleLowerCase() ?? '';
  const state = f.stateProvince?.trim().toLocaleLowerCase() ?? '';
  if (!country && !city) return null;

  const inUs = !country || US_NAMES.includes(country);
  if (country && !inUs) return 'international';
  if (LOCAL_CITIES.includes(city) && (!state || state === 'ca' || state === 'california')) return 'local';
  return inUs && country ? 'united_states' : null;
}
