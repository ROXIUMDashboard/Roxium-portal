/**
 * Adding a speaker.
 *
 * These cover a defect found in production: clicking "+ Add speaker" revealed a
 * row, but the blank row counted as a difference against the saved session while
 * being filtered out of the patch. The draft and the server could therefore never
 * agree, so the editor re-saved `speakers: []` on every render — hundreds of
 * requests a second — and the echo of those saves sometimes deleted the row the
 * collaborator was about to type into.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProgramSnapshot } from '@/lib/domain/types';
import ProgramRoom from '@/components/ProgramRoom';
import { facultyRecord } from '@/lib/domain/faculty';

const TOKEN = 'test_token_test_token_test_token_test_token';
/** Comfortably longer than the editor's autosave debounce. */
const PAST_AUTOSAVE_MS = 1200;

function snapshot(): ProgramSnapshot {
  const day = {
    id: 'day-1',
    programId: 'program-1',
    dayNumber: 1,
    date: '2027-09-09',
    weekdayLabel: 'Thursday',
    shortLabel: 'Endoscopic',
    title: 'Endoscopic Facial Rejuvenation',
    subtitle: 'Live surgery lead: Dr. Marc Mani',
    hoursLabel: '5:30 AM – 7:00 PM',
    sortOrder: 0,
  };
  return {
    program: {
      id: 'program-1',
      title: 'Beverly Hills Face 2027',
      subtitle: 'Working scientific program',
      statusLabel: 'Draft',
      locationLabel: 'Beverly Hills',
      dateRangeLabel: 'September 9–12, 2027',
    },
    days: [day],
    sessions: [
      {
        id: 's-1',
        dayId: 'day-1',
        sortOrder: 0,
        title: 'Opening Ceremony',
        description: 'Official welcome.',
        startMinute: 390,
        endMinute: 420,
        sessionType: 'ceremony',
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
      },
    ],
    faculty: [
      facultyRecord({ id: 'f-mani', programId: 'program-1', name: 'Dr. Marc Mani' }),
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

let mutations: { method: string; body: string }[] = [];

beforeEach(() => {
  mutations = [];
  window.localStorage.clear();
  // The room opens on Faculty unless the link names a workspace; these tests work the agenda.
  window.history.replaceState(null, '', '/#agenda');
  vi.stubGlobal('EventSource', StubEventSource);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method !== 'GET') {
        mutations.push({ method, body: String(init?.body ?? '') });
      }
      if (String(url).includes('/presence')) {
        return new Response(JSON.stringify({ entries: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ revision: 2, sessions: [] }), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The speaker writes the editor actually sent, ignoring presence heartbeats. */
const speakerWrites = () => mutations.filter((m) => m.body.includes('"speakers"'));

async function openSession() {
  const user = userEvent.setup();
  render(<ProgramRoom token={TOKEN} initialSnapshot={snapshot()} />);
  await user.type(screen.getByLabelText(/your name/i), 'Max');
  await user.click(screen.getByRole('button', { name: /enter program/i }));
  await user.click(await screen.findByRole('button', { name: /edit opening ceremony/i }));
  await screen.findByLabelText(/^topic$/i);
  return user;
}

describe('adding a speaker', () => {
  it('reveals a speaker row straight away, without waiting for the server', async () => {
    const user = await openSession();
    expect(screen.getByText(/no speaker assigned yet/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /add speaker/i }));

    // Present immediately — no findBy, no awaiting a request.
    expect(screen.getByLabelText(/speaker 1 name/i)).toBeInTheDocument();
    expect(speakerWrites()).toHaveLength(0);
  });

  it('does not save, and does not remove the row, while it is still unnamed', async () => {
    const user = await openSession();
    await user.click(screen.getByRole('button', { name: /add speaker/i }));

    await new Promise((resolve) => setTimeout(resolve, PAST_AUTOSAVE_MS));

    // The regression: an empty row must never become a `speakers: []` write, and
    // the echo of such a write must never take the row away again.
    expect(speakerWrites()).toHaveLength(0);
    expect(screen.getByLabelText(/speaker 1 name/i)).toBeInTheDocument();
  });

  it('puts the caret in the new row', async () => {
    const user = await openSession();
    await user.click(screen.getByRole('button', { name: /add speaker/i }));
    await waitFor(() => expect(screen.getByLabelText(/speaker 1 name/i)).toHaveFocus());
  });

  it('does not stack blank rows when the button is clicked repeatedly', async () => {
    const user = await openSession();
    const add = screen.getByRole('button', { name: /add speaker/i });
    await user.click(add);
    await user.click(add);
    await user.click(add);

    expect(screen.getAllByLabelText(/speaker \d+ name/i)).toHaveLength(1);
    expect(speakerWrites()).toHaveLength(0);
  });

  it('saves the speaker once it has a name, and keeps what was typed', async () => {
    const user = await openSession();
    await user.click(screen.getByRole('button', { name: /add speaker/i }));
    await user.type(screen.getByLabelText(/speaker 1 name/i), 'Dr. Marc Mani');

    await waitFor(() => expect(speakerWrites().length).toBeGreaterThan(0), { timeout: 3000 });

    const written = JSON.parse(speakerWrites()[0].body) as {
      speakers: { displayName: string; role: string; status: string }[];
    };
    expect(written.speakers).toEqual([
      { displayName: 'Dr. Marc Mani', role: 'speaker', status: 'confirmed' },
    ]);
    expect(screen.getByLabelText(/speaker 1 name/i)).toHaveValue('Dr. Marc Mani');
  });

  it('keeps showing a newly typed name after the server turns it into faculty', async () => {
    // The server promotes a typed name into the faculty table and returns the
    // speaker as { facultyId, displayName: null }. Browsers resolve names through
    // their own roster, so unless the response carries the new roster the name
    // reads as "To be confirmed" until the page is reloaded.
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method !== 'GET') mutations.push({ method, body: String(init?.body ?? '') });
        if (String(url).includes('/presence')) {
          return new Response(JSON.stringify({ entries: [] }), { status: 200 });
        }
        const base = snapshot().sessions[0];
        return new Response(
          JSON.stringify({
            revision: 2,
            session: {
              ...base,
              speakers: [
                {
                  id: 'sp-new',
                  facultyId: 'f-new',
                  displayName: null,
                  role: 'speaker',
                  status: 'confirmed',
                  sortOrder: 0,
                },
              ],
              updatedAt: '2027-01-02T00:00:00.000Z',
            },
            faculty: [
              facultyRecord({ id: 'f-mani', programId: 'program-1', name: 'Dr. Marc Mani' }),
              facultyRecord({ id: 'f-new', programId: 'program-1', name: 'Dr. New Name' }),
            ],
            history: null,
          }),
          { status: 200 },
        );
      },
    );

    const user = await openSession();
    await user.click(screen.getByRole('button', { name: /add speaker/i }));
    await user.type(screen.getByLabelText(/speaker 1 name/i), 'Dr. New Name');
    await waitFor(() => expect(speakerWrites().length).toBeGreaterThan(0), { timeout: 3000 });

    // Resolved through the roster the response carried — not blanked out.
    await waitFor(() =>
      expect(screen.getByLabelText(/speaker 1 name/i)).toHaveValue('Dr. New Name'),
    );
    expect(screen.queryByText(/to be confirmed/i)).not.toBeInTheDocument();
  });

  it('settles: an open editor does not keep writing on its own', async () => {
    const user = await openSession();
    await user.click(screen.getByRole('button', { name: /add speaker/i }));
    await user.type(screen.getByLabelText(/speaker 1 name/i), 'Dr. Marc Mani');
    await waitFor(() => expect(speakerWrites().length).toBeGreaterThan(0), { timeout: 3000 });

    const settled = speakerWrites().length;
    await new Promise((resolve) => setTimeout(resolve, PAST_AUTOSAVE_MS));
    // The loop this replaced produced hundreds of writes in this window.
    expect(speakerWrites().length).toBe(settled);
  });
});
