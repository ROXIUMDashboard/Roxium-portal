/**
 * The Faculty workspace in the browser: the AGENDA | FACULTY switch, counters
 * derived from the records, region and status filters, the collapsed inactive
 * section, and moving someone with the status pill.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Faculty, ProgramSnapshot } from '@/lib/domain/types';
import { SEED_DAYS, SEED_PROGRAM } from '@/lib/seed/program-2027';
import { facultyRecord } from '@/lib/domain/faculty';
import ProgramRoom from '@/components/ProgramRoom';

const TOKEN = 'test_token_test_token_test_token_test_token';

function buildSnapshot(): ProgramSnapshot {
  const days = SEED_DAYS.map((day, index) => ({
    id: `day-${index}`,
    programId: 'program-1',
    dayNumber: day.dayNumber,
    date: day.date,
    weekdayLabel: day.weekdayLabel,
    shortLabel: day.shortLabel,
    title: day.title,
    subtitle: day.subtitle,
    hoursLabel: day.hoursLabel,
    sortOrder: index,
  }));
  const person = (id: string, name: string, extra: Partial<Faculty>) =>
    facultyRecord({ id, programId: 'program-1', name, ...extra });

  return {
    program: {
      id: 'program-1',
      title: SEED_PROGRAM.title,
      subtitle: SEED_PROGRAM.subtitle,
      statusLabel: SEED_PROGRAM.statusLabel,
      locationLabel: SEED_PROGRAM.locationLabel,
      dateRangeLabel: SEED_PROGRAM.dateRangeLabel,
    },
    days,
    sessions: [],
    faculty: [
      person('f-mani', 'Dr. Marc Mani', { status: 'confirmed', region: 'local' }),
      person('f-ana', 'Dr. Ana Silva', { status: 'maybe', region: 'international', country: 'Brazil' }),
      person('f-dana', 'Dr. Dana Roe', { status: 'declined', region: 'united_states' }),
      person('f-eli', 'Dr. Eli Park', { status: 'not_pursuing' }),
    ],
    revision: 1,
  };
}

class StubEventSource {
  onerror: (() => void) | null = null;
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
  if (init?.method && init.method !== 'GET') {
    return new Response(JSON.stringify({ revision: 2, history: null }), { status: 200 });
  }
  return new Response(JSON.stringify({ entries: [] }), { status: 200 });
});

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  fetchMock.mockClear();
  vi.stubGlobal('EventSource', StubEventSource);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function enterFaculty() {
  const user = userEvent.setup();
  render(<ProgramRoom token={TOKEN} initialSnapshot={buildSnapshot()} />);
  await user.type(screen.getByLabelText(/your name/i), 'Max');
  await user.click(screen.getByRole('button', { name: /enter program/i }));
  await user.click(await screen.findByRole('tab', { name: /^faculty/i }));
  await screen.findByText('Active faculty');
  return user;
}

/** The number shown against a counter label. */
const counter = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent;

describe('the workspace switch', () => {
  it('opens on the agenda, with Faculty one click away', async () => {
    const user = userEvent.setup();
    render(<ProgramRoom token={TOKEN} initialSnapshot={buildSnapshot()} />);
    await user.type(screen.getByLabelText(/your name/i), 'Max');
    await user.click(screen.getByRole('button', { name: /enter program/i }));

    const agenda = await screen.findByRole('tab', { name: /^agenda/i });
    expect(agenda).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('Active faculty')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /^faculty/i }));
    expect(await screen.findByText('Active faculty')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^faculty/i })).toHaveAttribute('aria-selected', 'true');
    expect(window.location.hash).toBe('#faculty');
    // Edit Program belongs to the agenda.
    expect(screen.queryByRole('button', { name: /edit program/i })).not.toBeInTheDocument();
  });
});

describe('the faculty register', () => {
  it('derives every counter from the records', async () => {
    await enterFaculty();
    expect(counter('Confirmed')).toBe('1');
    expect(counter('Maybe')).toBe('1');
    expect(counter('Local')).toBe('1');
    expect(counter('United States')).toBe('0');
    expect(counter('International')).toBe('1');
    expect(counter('Inactive')).toBe('2');
  });

  it('shows Confirmed and Maybe together, and keeps the inactive section collapsed', async () => {
    await enterFaculty();
    expect(screen.getByText('Dr. Marc Mani')).toBeInTheDocument();
    expect(screen.getByText('Dr. Ana Silva')).toBeInTheDocument();
    expect(screen.queryByText('Dr. Dana Roe')).not.toBeInTheDocument();
    expect(screen.queryByText('Dr. Eli Park')).not.toBeInTheDocument();
  });

  it('opens No / Not Pursuing with the two kept apart', async () => {
    const user = await enterFaculty();
    const toggle = screen.getByRole('button', { name: /no \/ not pursuing/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(screen.getByText('Declined — said no')).toBeInTheDocument();
    expect(screen.getByText("Not Pursuing — BHFA's decision")).toBeInTheDocument();
    expect(screen.getByText('Dr. Dana Roe')).toBeInTheDocument();
    expect(screen.getByText('Dr. Eli Park')).toBeInTheDocument();
  });

  it('filters by region instantly, and says how many are hidden', async () => {
    const user = await enterFaculty();
    await user.click(screen.getByRole('button', { name: 'International' }));
    expect(screen.getByText('Dr. Ana Silva')).toBeInTheDocument();
    expect(screen.queryByText('Dr. Marc Mani')).not.toBeInTheDocument();
    expect(screen.getByText(/showing 1 of 2/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(screen.getByText('Dr. Marc Mani')).toBeInTheDocument();
  });

  it('searches by name', async () => {
    const user = await enterFaculty();
    await user.type(screen.getByRole('searchbox'), 'mani');
    await waitFor(() => expect(screen.queryByText('Dr. Ana Silva')).not.toBeInTheDocument());
    expect(screen.getByText('Dr. Marc Mani')).toBeInTheDocument();
  });

  it('moves someone with the status pill, before the server answers', async () => {
    const user = await enterFaculty();
    await user.click(screen.getByRole('button', { name: /dr\. ana silva: maybe\. change status/i }));
    const menu = screen.getByRole('menu', { name: /status for dr\. ana silva/i });
    await user.click(within(menu).getByRole('menuitemradio', { name: 'Confirmed' }));

    expect(counter('Confirmed')).toBe('2');
    expect(counter('Maybe')).toBe('0');
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]: [RequestInfo | URL, RequestInit?]) =>
            String(url).endsWith('/faculty/f-ana') &&
            init?.method === 'PATCH' &&
            init.body === JSON.stringify({ status: 'confirmed' }),
        ),
      ).toBe(true),
    );
  });

  it('adds someone as Maybe and opens their record', async () => {
    const user = await enterFaculty();
    await user.type(screen.getByLabelText(/new faculty member's name/i), 'Dr. Test Added');
    await user.click(screen.getByRole('button', { name: 'Add faculty' }));

    expect(await screen.findByText('Dr. Test Added')).toBeInTheDocument();
    expect(counter('Maybe')).toBe('2');
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]: [RequestInfo | URL, RequestInit?]) => String(url).endsWith('/faculty') && init?.method === 'POST' && /Dr\. Test Added/.test(String(init.body)),
        ),
      ).toBe(true),
    );
  });
});
