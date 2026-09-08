/**
 * Interface behaviour: the agenda reads as a document until it is touched, and
 * touching a session reveals the editing controls in place.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProgramSnapshot, Session } from '@/lib/domain/types';
import { SEED_DAYS, SEED_PROGRAM } from '@/lib/seed/program-2027';
import ProgramRoom from '@/components/ProgramRoom';
import SessionCard from '@/components/SessionCard';

function buildSnapshot(): ProgramSnapshot {
  const sessions: Session[] = [];
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

  SEED_DAYS.forEach((day, dayIndex) => {
    day.sessions.forEach((seed, order) => {
      sessions.push({
        id: `s-${dayIndex}-${order}`,
        dayId: days[dayIndex].id,
        sortOrder: order,
        title: seed.title,
        description: seed.description,
        startMinute: seed.startMinute,
        endMinute: seed.endMinute,
        sessionType: seed.sessionType,
        sponsorName: null,
        sponsorLogoUrl: null,
        sponsorUrl: null,
        room: null,
        status: 'draft',
        internalNotes: null,
        speakers: (seed.speakers ?? []).map((speaker, speakerIndex) => ({
          id: `sp-${dayIndex}-${order}-${speakerIndex}`,
          facultyId: speaker.name === 'Dr. Marc Mani' ? 'f-mani' : null,
          displayName: null,
          role: speaker.role ?? 'speaker',
          status: speaker.status ?? 'confirmed',
          sortOrder: speakerIndex,
        })),
        createdAt: '2027-01-01T00:00:00.000Z',
        updatedAt: '2027-01-01T00:00:00.000Z',
        updatedBy: null,
      });
    });
  });

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
    sessions,
    faculty: [{ id: 'f-mani', programId: 'program-1', name: 'Dr. Marc Mani', credentials: null, headshotUrl: null }],
    revision: 1,
  };
}

class StubEventSource {
  onerror: (() => void) | null = null;
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('EventSource', StubEventSource);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ entries: [] }), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('entering the program', () => {
  it('asks for a name once, then shows the agenda', async () => {
    const user = userEvent.setup();
    render(<ProgramRoom token="test_token_test_token_test_token_test_token" initialSnapshot={buildSnapshot()} />);

    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
    const enter = screen.getByRole('button', { name: /enter program/i });
    expect(enter).toBeDisabled();

    await user.type(screen.getByLabelText(/your name/i), 'Ashkan Ghavami');
    await user.click(enter);

    expect(await screen.findByText('Endoscopic Facial Rejuvenation')).toBeInTheDocument();
    expect(window.localStorage.getItem('bhfa.collaborator.name')).toBe('Ashkan Ghavami');
  });
});

describe('the agenda', () => {
  async function enter() {
    const user = userEvent.setup();
    render(<ProgramRoom token="test_token_test_token_test_token_test_token" initialSnapshot={buildSnapshot()} />);
    await user.type(screen.getByLabelText(/your name/i), 'Max');
    await user.click(screen.getByRole('button', { name: /enter program/i }));
    await screen.findByText('Endoscopic Facial Rejuvenation');
    return user;
  }

  it('reads as a document: no form fields until a session is touched', async () => {
    await enter();
    expect(screen.queryByLabelText(/^topic$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

    // The programme itself is what is on screen.
    expect(screen.getByText('Live Surgery I-A')).toBeInTheDocument();
    expect(screen.getByText(/7:20 AM – 10:15 AM/)).toBeInTheDocument();
    expect(screen.getAllByText('Dr. Marc Mani').length).toBeGreaterThan(0);
  });

  it('reveals time, topic and speaker controls in place when a session is opened', async () => {
    const user = await enter();
    await user.click(screen.getByRole('button', { name: /edit live surgery i-a/i }));

    expect(await screen.findByLabelText(/^start$/i)).toHaveValue('07:20');
    expect(screen.getByLabelText(/^end$/i)).toHaveValue('10:15');
    expect(screen.getByLabelText(/^topic$/i)).toHaveValue('Live Surgery I-A');
    expect(screen.getByLabelText(/speaker 1 name/i)).toHaveValue('Dr. Marc Mani');
    expect(screen.getByLabelText(/^description$/i)).toHaveValue(
      'Endoscopic facial rejuvenation with Dr. Marc Mani: access, release, visualization, fixation, and vectors.',
    );
    expect(screen.getByText('2 hr 55 min')).toBeInTheDocument();

    // Advanced settings stay behind "More options".
    expect(screen.queryByLabelText(/internal planning notes/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /more options/i }));
    expect(screen.getByLabelText(/internal planning notes/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/sponsor \/ partner/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete session/i })).toBeInTheDocument();
  });

  it('closes the editor on Escape and returns to the clean row', async () => {
    const user = await enter();
    await user.click(screen.getByRole('button', { name: /edit opening ceremony/i }));
    expect(await screen.findByLabelText(/^topic$/i)).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByLabelText(/^topic$/i)).not.toBeInTheDocument());
  });

  it('opens a session from the keyboard alone', async () => {
    const user = await enter();
    const row = screen.getByRole('button', { name: /edit patient analysis/i });
    row.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByLabelText(/^topic$/i)).toHaveValue('Patient Analysis');
  });

  it('switches days instantly and keeps move-up and move-down available', async () => {
    const user = await enter();
    await user.click(screen.getByRole('button', { name: /03.*sat.*eyes \+ anatomy/i }));

    expect(await screen.findByText('Periorbital Surgery + Fresh-Cadaver Anatomy')).toBeInTheDocument();
    expect(screen.getByText('Cadaver Lab I')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /edit cadaver lab i$/i }));
    expect(await screen.findByRole('button', { name: /move session up/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /move session down/i })).toBeEnabled();
    expect(screen.getByLabelText(/move to another day/i)).toBeInTheDocument();
  });

  it('shows a TBD speaker as unconfirmed without inventing a name', async () => {
    const user = await enter();
    await user.click(screen.getByRole('button', { name: /03.*eyes \+ anatomy/i }));
    const row = await screen.findByRole('button', { name: /edit live surgery iii/i });
    expect(within(row).getByText('To be confirmed')).toBeInTheDocument();
    expect(within(row).getByText('TBD')).toBeInTheDocument();
  });
});

describe('optional sponsorship', () => {
  const lunch: Session = {
    id: 'lunch',
    dayId: 'day-0',
    sortOrder: 7,
    title: 'Lunch',
    description: 'Daily lunch and partner experience.',
    startMinute: 750,
    endMinute: 810,
    sessionType: 'lunch',
    sponsorName: null,
    sponsorLogoUrl: null,
    sponsorUrl: null,
    room: null,
    status: 'draft',
    internalNotes: 'Ask about the partner table.',
    speakers: [],
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
    updatedBy: null,
  };

  it('shows nothing at all when there is no sponsor', () => {
    render(<SessionCard session={lunch} />);
    expect(screen.queryByText(/supported by/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/n\/a|sponsor/i)).not.toBeInTheDocument();
  });

  it('presents a sponsor in restrained language when one exists', () => {
    render(<SessionCard session={{ ...lunch, sponsorName: 'AbbVie' }} />);
    expect(screen.getByText('Supported by AbbVie')).toBeInTheDocument();
  });

  it('never puts internal planning notes on the agenda', () => {
    render(<SessionCard session={lunch} />);
    expect(screen.queryByText(/ask about the partner table/i)).not.toBeInTheDocument();
  });

  it('marks a conflict in red and a gap in amber', () => {
    const { rerender } = render(
      <SessionCard
        session={lunch}
        issues={[{ kind: 'conflict', label: '15 MIN OVERLAP', detail: 'Overlaps.', overlapMinutes: 15, withSessionId: 'x' }]}
      />,
    );
    expect(screen.getByText('15 MIN OVERLAP')).toBeInTheDocument();

    rerender(
      <SessionCard
        session={lunch}
        issues={[{ kind: 'gap', label: '45 MIN UNSCHEDULED GAP', detail: 'Nothing scheduled.', gapMinutes: 45, afterSessionId: 'x' }]}
      />,
    );
    expect(screen.getByText('45 MIN UNSCHEDULED GAP')).toBeInTheDocument();
  });

  it('says who else is editing a session', () => {
    render(<SessionCard session={lunch} editingBy="Marc" />);
    expect(screen.getByText('Marc is editing')).toBeInTheDocument();
  });
});
