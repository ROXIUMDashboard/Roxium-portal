/**
 * Global Edit Program mode.
 *
 * The agenda reads as a document by default. One control turns the whole of the
 * selected day into editable fields at once, so a planner can move through many
 * sessions without opening each one. It is local UI state: switching it on here
 * must not change what another collaborator sees.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProgramSnapshot, Session } from '@/lib/domain/types';
import { SEED_DAYS, SEED_PROGRAM } from '@/lib/seed/program-2027';
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
  const sessions: Session[] = [];
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
        speakers: [],
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
    faculty: [],
    revision: 1,
  };
}

class StubEventSource {
  onerror: (() => void) | null = null;
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

let mutations = 0;

beforeEach(() => {
  mutations = 0;
  window.localStorage.clear();
  vi.stubGlobal('EventSource', StubEventSource);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') !== 'GET' && !String(url).includes('/presence')) mutations += 1;
      if (String(url).includes('/presence')) {
        return new Response(JSON.stringify({ entries: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ revision: 2, sessions: [], history: null }), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function enter() {
  const user = userEvent.setup();
  render(<ProgramRoom token={TOKEN} initialSnapshot={buildSnapshot()} />);
  await user.type(screen.getByLabelText(/your name/i), 'Max');
  await user.click(screen.getByRole('button', { name: /enter program/i }));
  await screen.findByText('Endoscopic Facial Rejuvenation');
  return user;
}

const dayOneCount = SEED_DAYS[0].sessions.length;

describe('Edit Program mode', () => {
  it('shows a clean agenda with no form fields until it is turned on', async () => {
    await enter();
    expect(screen.getByRole('button', { name: /edit program/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^topic$/i)).not.toBeInTheDocument();
  });

  it('opens every session on the day at once, and renames the control', async () => {
    const user = await enter();
    await user.click(screen.getByRole('button', { name: /edit program/i }));

    // Time, topic and description are editable for the whole day together.
    expect(screen.getAllByLabelText(/^topic$/i)).toHaveLength(dayOneCount);
    expect(screen.getAllByLabelText(/^start$/i)).toHaveLength(dayOneCount);
    expect(screen.getAllByLabelText(/^description$/i)).toHaveLength(dayOneCount);
    expect(screen.getByRole('button', { name: /done editing/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^edit program$/i })).not.toBeInTheDocument();
  });

  it('keeps advanced fields behind More options', async () => {
    const user = await enter();
    await user.click(screen.getByRole('button', { name: /edit program/i }));
    expect(screen.queryByLabelText(/internal planning notes/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /more options/i })).toHaveLength(dayOneCount);
  });

  it('returns to the clean agenda on Done editing', async () => {
    const user = await enter();
    await user.click(screen.getByRole('button', { name: /edit program/i }));
    await user.click(screen.getByRole('button', { name: /done editing/i }));
    expect(screen.queryByLabelText(/^topic$/i)).not.toBeInTheDocument();
  });

  it('does not write anything merely by entering or leaving edit mode', async () => {
    const user = await enter();
    await user.click(screen.getByRole('button', { name: /edit program/i }));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await user.click(screen.getByRole('button', { name: /done editing/i }));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    // Opening a day's worth of editors must stay as quiet as opening none.
    expect(mutations).toBe(0);
  });

  it('still allows reordering while editing', async () => {
    const user = await enter();
    await user.click(screen.getByRole('button', { name: /edit program/i }));
    expect(screen.getAllByRole('button', { name: /^reorder /i }).length).toBe(dayOneCount);
  });
});
