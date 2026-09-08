// @vitest-environment node
/**
 * End-to-end coverage of the route handlers against the in-process driver.
 * These exercise the same code paths a browser hits: token authorisation,
 * validation, persistence, revision history, undo, and the realtime broadcast.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { HistoryEntry, ProgramSnapshot, Session } from '@/lib/domain/types';
import { resetRepositoryForTests } from '@/lib/data';
import { resetRateLimits } from '@/lib/server/rate-limit';
import { subscribe, type ProgramEvent } from '@/lib/server/realtime';
import { sessionsForDay } from '@/lib/domain/schedule';

import { GET as getSnapshot } from '@/app/api/program/[token]/route';
import { POST as postSession } from '@/app/api/program/[token]/sessions/route';
import { PATCH as patchSession, DELETE as deleteSession } from '@/app/api/program/[token]/sessions/[sessionId]/route';
import { POST as postReorder } from '@/app/api/program/[token]/reorder/route';
import { POST as postShift } from '@/app/api/program/[token]/shift/route';
import { GET as getHistory } from '@/app/api/program/[token]/history/route';
import { POST as postRevert } from '@/app/api/program/[token]/history/[entryId]/revert/route';
import { POST as postRotate } from '@/app/api/program/[token]/rotate/route';

const TOKEN = 'test_token_test_token_test_token_test_token';
const BAD_TOKEN = 'nope_nope_nope_nope_nope_nope_nope_nope_nope';

function request(body?: unknown, actor = 'Max') {
  return new Request('http://localhost/api', {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      'x-collaborator-name': encodeURIComponent(actor),
      'x-collaborator-id': `client-${actor}`,
      'x-forwarded-for': `10.0.0.${actor.length}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = <T extends object>(value: T) => ({ params: Promise.resolve(value) });

async function snapshot(): Promise<ProgramSnapshot> {
  const response = await getSnapshot(request(), params({ token: TOKEN }));
  expect(response.status).toBe(200);
  return response.json();
}

async function history(): Promise<HistoryEntry[]> {
  const response = await getHistory(request(), params({ token: TOKEN }));
  return (await response.json()).entries;
}

async function findSession(title: string): Promise<Session> {
  const state = await snapshot();
  const found = state.sessions.find((s) => s.title === title);
  if (!found) throw new Error(`No session titled ${title}`);
  return found;
}

beforeEach(() => {
  resetRepositoryForTests(TOKEN);
  resetRateLimits();
});

/* ------------------------------------------------------------------ access */

describe('collaboration token', () => {
  it('serves the program to a valid link', async () => {
    const state = await snapshot();
    expect(state.program.title).toBe('Beverly Hills Face 2027');
    expect(state.days).toHaveLength(4);
    expect(state.sessions).toHaveLength(58);
  });

  it('rejects an unknown token, and says nothing about the program', async () => {
    const response = await getSnapshot(request(), params({ token: BAD_TOKEN }));
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toMatch(/Beverly|session|program_id/i);
  });

  it('rejects a malformed token without touching the data layer', async () => {
    for (const token of ['', '../../secret', 'abc']) {
      const response = await getSnapshot(request(), params({ token }));
      expect(response.status).toBe(404);
    }
  });

  it('refuses every mutation on an invalid token', async () => {
    const session = await findSession('Lunch');
    const calls = [
      postSession(request({ dayId: session.dayId, startMinute: 600, endMinute: 630 }), params({ token: BAD_TOKEN })),
      patchSession(request({ title: 'x' }), params({ token: BAD_TOKEN, sessionId: session.id })),
      deleteSession(request({}), params({ token: BAD_TOKEN, sessionId: session.id })),
      postReorder(request({ sessionId: session.id, targetDayId: session.dayId, targetIndex: 0 }), params({ token: BAD_TOKEN })),
      postShift(request({ dayId: session.dayId, afterSessionId: session.id, deltaMinutes: 15 }), params({ token: BAD_TOKEN })),
      postRotate(request({}), params({ token: BAD_TOKEN })),
    ];
    for (const call of await Promise.all(calls)) {
      expect(call.status).toBe(404);
    }
    expect((await snapshot()).sessions).toHaveLength(58);
  });

  it('rotates the link, invalidating the previous one', async () => {
    const response = await postRotate(request({}), params({ token: TOKEN }));
    const { token: next } = await response.json();
    expect(next).toMatch(/^[A-Za-z0-9_-]{43}$/);

    expect((await getSnapshot(request(), params({ token: TOKEN }))).status).toBe(404);
    expect((await getSnapshot(request(), params({ token: next }))).status).toBe(200);
  });
});

/* --------------------------------------------------------------- mutations */

describe('editing a session', () => {
  it('changes a topic and records who did it', async () => {
    const session = await findSession('Vector Debate');
    const response = await patchSession(
      request({ title: 'Deep Plane Vector Selection' }, 'Ashkan'),
      params({ token: TOKEN, sessionId: session.id }),
    );
    expect(response.status).toBe(200);

    expect((await findSession('Deep Plane Vector Selection')).updatedBy).toBe('Ashkan');
    const entries = await history();
    expect(entries[0]).toMatchObject({ actorName: 'Ashkan', action: 'title_changed' });
    expect(entries[0].summary).toContain('Deep Plane Vector Selection');
  });

  it('adds and removes a speaker, promoting the name into faculty', async () => {
    const session = await findSession('Eyes Forum');
    await patchSession(
      request({ speakers: [{ displayName: 'Dr. Marc Mani', status: 'confirmed' }] }, 'Max'),
      params({ token: TOKEN, sessionId: session.id }),
    );

    let updated = await findSession('Eyes Forum');
    expect(updated.speakers).toHaveLength(1);
    const state = await snapshot();
    const faculty = state.faculty.find((f) => f.id === updated.speakers[0].facultyId);
    expect(faculty?.name).toBe('Dr. Marc Mani');

    await patchSession(request({ speakers: [] }, 'Max'), params({ token: TOKEN, sessionId: session.id }));
    updated = await findSession('Eyes Forum');
    expect(updated.speakers).toEqual([]);
  });

  it('keeps an unconfirmed speaker as TBD without inventing a name', async () => {
    const session = await findSession('Live Surgery III');
    expect(session.speakers).toHaveLength(1);
    expect(session.speakers[0]).toMatchObject({ status: 'tbd', facultyId: null, displayName: null });
  });

  it('adds a sponsor and removes it again, leaving nothing behind', async () => {
    const lunch = await findSession('Lunch');
    await patchSession(request({ sponsorName: 'AbbVie' }, 'Max'), params({ token: TOKEN, sessionId: lunch.id }));
    expect((await findSession('Lunch')).sponsorName).toBe('AbbVie');

    await patchSession(request({ sponsorName: '' }, 'Max'), params({ token: TOKEN, sessionId: lunch.id }));
    expect((await findSession('Lunch')).sponsorName).toBeNull();

    const entries = await history();
    expect(entries[0].summary).toContain('Sponsor removed');
  });

  it('refuses a nonsense value and leaves the session untouched', async () => {
    const session = await findSession('Lunch');
    const response = await patchSession(
      request({ startMinute: 'quarter past' }),
      params({ token: TOKEN, sessionId: session.id }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/minutes/i);
    expect((await findSession('Lunch')).startMinute).toBe(session.startMinute);
  });

  it('reports a session that another collaborator has already deleted', async () => {
    const session = await findSession('Takeaways');
    await deleteSession(request({}), params({ token: TOKEN, sessionId: session.id }));

    const response = await patchSession(request({ title: 'x' }), params({ token: TOKEN, sessionId: session.id }));
    expect(response.status).toBe(404);
    expect((await response.json()).error).toMatch(/already been removed/i);
  });

  it('creates a session in place with sensible ordering', async () => {
    const lunch = await findSession('Lunch');
    const response = await postSession(
      request({
        dayId: lunch.dayId,
        afterSessionId: lunch.id,
        title: 'Sponsor Demonstration',
        startMinute: 810,
        endMinute: 825,
        sessionType: 'other',
      }),
      params({ token: TOKEN }),
    );
    expect(response.status).toBe(201);

    const day = sessionsForDay((await snapshot()).sessions, lunch.dayId);
    const index = day.findIndex((s) => s.title === 'Sponsor Demonstration');
    expect(day[index - 1].title).toBe('Lunch');
    expect(day.map((s) => s.sortOrder)).toEqual(day.map((_, i) => i));
  });
});

/* ---------------------------------------------------------------- ordering */

describe('ordering', () => {
  it('reorders within a day and persists the new order', async () => {
    const state = await snapshot();
    const dayId = state.days[0].id;
    const before = sessionsForDay(state.sessions, dayId);
    const moved = before[3];

    await postReorder(request({ sessionId: moved.id, targetDayId: dayId, targetIndex: 1 }), params({ token: TOKEN }));

    const after = sessionsForDay((await snapshot()).sessions, dayId);
    expect(after[1].id).toBe(moved.id);
    expect(after.map((s) => s.sortOrder)).toEqual(after.map((_, i) => i));
    expect(after).toHaveLength(before.length);
  });

  it('moves a session to another day without altering its times', async () => {
    const state = await snapshot();
    const [thursday, friday] = state.days;
    const moved = sessionsForDay(state.sessions, thursday.id)[5];

    await postReorder(
      request({ sessionId: moved.id, targetDayId: friday.id, targetIndex: 0 }, 'Max'),
      params({ token: TOKEN }),
    );

    const after = await snapshot();
    const relocated = after.sessions.find((s) => s.id === moved.id);
    expect(relocated?.dayId).toBe(friday.id);
    expect(relocated?.startMinute).toBe(moved.startMinute);
    expect(relocated?.endMinute).toBe(moved.endMinute);
    expect(sessionsForDay(after.sessions, thursday.id)).toHaveLength(14);
    expect(sessionsForDay(after.sessions, friday.id)).toHaveLength(17);

    const entries = await history();
    expect(entries[0]).toMatchObject({ action: 'session_moved_day' });
    expect(entries[0].summary).toContain('Day 02');
  });

  it('rejects a malformed drop position', async () => {
    const session = await findSession('Lunch');
    const response = await postReorder(
      request({ sessionId: session.id, targetDayId: session.dayId, targetIndex: -4 }),
      params({ token: TOKEN }),
    );
    expect(response.status).toBe(400);
  });
});

/* ------------------------------------------------------------ time shifting */

describe('smart time changes', () => {
  it('shifts every following session by the delta, preserving durations', async () => {
    const state = await snapshot();
    const dayId = state.days[0].id;
    const day = sessionsForDay(state.sessions, dayId);
    const anchor = day.find((s) => s.title === 'Live Surgery I-B')!;
    const following = day.filter((s) => s.sortOrder > anchor.sortOrder);

    // Extend the anchor by 15 minutes, then carry the rest of the day with it.
    await patchSession(
      request({ endMinute: anchor.endMinute + 15 }),
      params({ token: TOKEN, sessionId: anchor.id }),
    );
    const response = await postShift(
      request({ dayId, afterSessionId: anchor.id, deltaMinutes: 15 }),
      params({ token: TOKEN }),
    );
    expect(response.status).toBe(200);

    const after = sessionsForDay((await snapshot()).sessions, dayId);
    for (const original of following) {
      const moved = after.find((s) => s.id === original.id)!;
      expect(moved.startMinute).toBe(original.startMinute + 15);
      expect(moved.endMinute).toBe(original.endMinute + 15);
      expect(moved.endMinute - moved.startMinute).toBe(original.endMinute - original.startMinute);
    }
  });

  it('leaves the rest of the day alone when only this session changes', async () => {
    const state = await snapshot();
    const dayId = state.days[0].id;
    const day = sessionsForDay(state.sessions, dayId);
    const anchor = day.find((s) => s.title === 'Live Surgery I-B')!;
    const next = day[day.findIndex((s) => s.id === anchor.id) + 1];

    await patchSession(request({ endMinute: anchor.endMinute + 15 }), params({ token: TOKEN, sessionId: anchor.id }));

    const after = sessionsForDay((await snapshot()).sessions, dayId);
    const untouched = after.find((s) => s.id === next.id)!;
    expect(untouched.startMinute).toBe(next.startMinute);

    // …and the resulting overlap is what the UI paints red.
    const overlapped = after.find((s) => s.id === next.id)!;
    expect(overlapped.startMinute).toBeLessThan(anchor.endMinute + 15);
  });

  it('refuses an implausible bulk shift', async () => {
    const session = await findSession('Lunch');
    for (const deltaMinutes of [0, 6000, 2.5]) {
      const response = await postShift(
        request({ dayId: session.dayId, afterSessionId: session.id, deltaMinutes }),
        params({ token: TOKEN }),
      );
      expect(response.status).toBe(400);
    }
  });
});

/* ------------------------------------------------- concurrent editing */

describe('two collaborators editing the same session', () => {
  it('warns the second writer that they replaced a newer version, and hands it back', async () => {
    const session = await findSession('Vector Debate');
    const baseline = session.updatedAt;

    // Ashkan saves first.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await patchSession(request({ title: 'Vector Selection' }, 'Ashkan'), params({ token: TOKEN, sessionId: session.id }));

    // Max saves from the version he opened, before Ashkan's change existed.
    const response = await patchSession(
      request({ title: 'Vector Strategy', baseUpdatedAt: baseline }, 'Max'),
      params({ token: TOKEN, sessionId: session.id }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();

    // The write is not refused — Max's typing is never thrown away…
    expect((await findSession('Vector Strategy')).id).toBe(session.id);

    // …but he is told exactly what he replaced, and can put it back.
    expect(body.conflict).toBeTruthy();
    expect(body.conflict.actorName).toBe('Ashkan');
    expect(body.conflict.fields).toContainEqual({
      label: 'Topic',
      theirs: 'Vector Selection',
      yours: 'Vector Strategy',
    });
    expect(body.conflict.latest.title).toBe('Vector Selection');

    // And the overwritten version is still in the history.
    const entries = await history();
    expect(entries.some((entry) => entry.actorName === 'Ashkan' && entry.summary.includes('Vector Selection'))).toBe(true);
  });

  it('says nothing when the save is the first since the editor opened', async () => {
    const session = await findSession('Revision Forum');
    const response = await patchSession(
      request({ title: 'Revision Panel', baseUpdatedAt: session.updatedAt }, 'Max'),
      params({ token: TOKEN, sessionId: session.id }),
    );
    expect((await response.json()).conflict).toBeNull();
  });

  it('does not warn a collaborator about their own earlier save', async () => {
    const session = await findSession('Neck Masterclass');
    const baseline = session.updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await patchSession(request({ room: 'Theatre A' }, 'Max'), params({ token: TOKEN, sessionId: session.id }));

    const response = await patchSession(
      request({ title: 'Neck Masterclass II', baseUpdatedAt: baseline }, 'Max'),
      params({ token: TOKEN, sessionId: session.id }),
    );
    expect((await response.json()).conflict).toBeNull();
  });

  it('describes a replaced time range and speaker list in words', async () => {
    const session = await findSession('Eyes Forum');
    const baseline = session.updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await patchSession(
      request({ startMinute: 1000, endMinute: 1040, speakers: [{ displayName: 'Dr. Marc Mani' }] }, 'Ashkan'),
      params({ token: TOKEN, sessionId: session.id }),
    );

    const response = await patchSession(
      request({ startMinute: 1005, endMinute: 1050, baseUpdatedAt: baseline }, 'Max'),
      params({ token: TOKEN, sessionId: session.id }),
    );
    const { conflict } = await response.json();
    const time = conflict.fields.find((f: { label: string }) => f.label === 'Time');
    expect(time.theirs).toBe('4:40 PM – 5:20 PM');
    expect(time.yours).toBe('4:45 PM – 5:30 PM');
  });
});

describe('midnight', () => {
  it('stores and returns the White Party ending as 1440, not 1439', async () => {
    const party = await findSession('Closing Ceremony');
    expect(party.endMinute).toBe(1440);

    // Saving an unrelated field must not round midnight down.
    await patchSession(request({ room: 'Rooftop' }), params({ token: TOKEN, sessionId: party.id }));
    expect((await findSession('Closing Ceremony')).endMinute).toBe(1440);
  });

  it('accepts an end time on the following morning', async () => {
    const party = await findSession('Closing Ceremony');
    const response = await patchSession(
      request({ endMinute: 1440 + 60 }),
      params({ token: TOKEN, sessionId: party.id }),
    );
    expect(response.status).toBe(200);
    expect((await findSession('Closing Ceremony')).endMinute).toBe(1500);
  });
});

/* ------------------------------------------------------ history and undo */

describe('revision history', () => {
  it('records who changed what, with the prior state kept', async () => {
    const session = await findSession('Neck Masterclass');
    await patchSession(request({ title: 'Neck Masterclass II' }, 'Ashkan'), params({ token: TOKEN, sessionId: session.id }));

    const [entry] = await history();
    expect(entry.actorName).toBe('Ashkan');
    expect(entry.before).toMatchObject({ kind: 'fields', fields: { title: 'Neck Masterclass' } });
    expect(entry.after).toMatchObject({ kind: 'fields', fields: { title: 'Neck Masterclass II' } });
  });

  it('undoes a delete by restoring the session with its speakers', async () => {
    const session = await findSession('Live Surgery II-A');
    await deleteSession(request({}, 'Max'), params({ token: TOKEN, sessionId: session.id }));
    expect((await snapshot()).sessions.find((s) => s.id === session.id)).toBeUndefined();

    const [entry] = await history();
    expect(entry.action).toBe('session_deleted');

    const response = await postRevert(request({ mode: 'undo' }, 'Max'), params({ token: TOKEN, entryId: entry.id }));
    expect(response.status).toBe(200);

    const restored = (await snapshot()).sessions.find((s) => s.id === session.id);
    expect(restored?.title).toBe('Live Surgery II-A');
    expect(restored?.speakers).toHaveLength(1);
  });

  it('undoes a bulk time shift in one step', async () => {
    const state = await snapshot();
    const dayId = state.days[0].id;
    const before = sessionsForDay(state.sessions, dayId);
    const anchor = before[2];

    await postShift(request({ dayId, afterSessionId: anchor.id, deltaMinutes: 30 }), params({ token: TOKEN }));
    const [shiftEntry] = await history();
    expect(shiftEntry.action).toBe('bulk_time_shift');

    await postRevert(request({ mode: 'undo' }), params({ token: TOKEN, entryId: shiftEntry.id }));

    const after = sessionsForDay((await snapshot()).sessions, dayId);
    for (const original of before) {
      const now = after.find((s) => s.id === original.id)!;
      expect(now.startMinute).toBe(original.startMinute);
      expect(now.endMinute).toBe(original.endMinute);
    }
  });

  it('undoes a creation by removing the session again', async () => {
    const state = await snapshot();
    await postSession(
      request({ dayId: state.days[0].id, title: 'Temporary', startMinute: 1200, endMinute: 1230 }),
      params({ token: TOKEN }),
    );
    const [entry] = await history();
    expect(entry.action).toBe('session_created');

    await postRevert(request({ mode: 'undo' }), params({ token: TOKEN, entryId: entry.id }));
    expect((await snapshot()).sessions.some((s) => s.title === 'Temporary')).toBe(false);
  });

  it('never destroys history when restoring — it adds to it', async () => {
    const session = await findSession('Case Conference');
    await patchSession(request({ title: 'Complex Case Conference' }), params({ token: TOKEN, sessionId: session.id }));
    const before = await history();

    await postRevert(request({ mode: 'restore' }), params({ token: TOKEN, entryId: before[0].id }));
    const after = await history();

    expect(after.length).toBe(before.length + 1);
    expect(after[0].action).toBe('restored');
    expect(after.some((entry) => entry.id === before[0].id)).toBe(true);
    expect((await findSession('Case Conference')).title).toBe('Case Conference');
  });

  it('refuses to undo the same change twice', async () => {
    const session = await findSession('Grand Rounds');
    await patchSession(request({ title: 'Grand Rounds A' }), params({ token: TOKEN, sessionId: session.id }));
    const [entry] = await history();

    expect((await postRevert(request({ mode: 'undo' }), params({ token: TOKEN, entryId: entry.id }))).status).toBe(200);
    const second = await postRevert(request({ mode: 'undo' }), params({ token: TOKEN, entryId: entry.id }));
    expect(second.status).toBe(400);
  });
});

/* ------------------------------------------------------------- realtime */

describe('realtime broadcast', () => {
  it('publishes every mutation to other collaborators with the changed rows', async () => {
    const state = await snapshot();
    const events: ProgramEvent[] = [];
    const unsubscribe = subscribe(state.program.id, (event) => events.push(event));

    const session = await findSession('Anatomy Session');
    await patchSession(request({ title: 'Applied Anatomy' }, 'Ashkan'), params({ token: TOKEN, sessionId: session.id }));
    unsubscribe();

    const mutation = events.find((event) => event.type === 'mutation');
    expect(mutation).toBeDefined();
    if (mutation?.type !== 'mutation') throw new Error('expected a mutation event');
    expect(mutation.actorName).toBe('Ashkan');
    expect(mutation.actorClientId).toBe('client-Ashkan');
    expect(mutation.upserted.some((s) => s.title === 'Applied Anatomy')).toBe(true);
    expect(mutation.revision).toBeGreaterThan(state.revision);
  });

  it('reports deletions so other browsers can drop the row', async () => {
    const state = await snapshot();
    const events: ProgramEvent[] = [];
    const unsubscribe = subscribe(state.program.id, (event) => events.push(event));

    const session = await findSession('Coffee Break');
    await deleteSession(request({}), params({ token: TOKEN, sessionId: session.id }));
    unsubscribe();

    const mutation = events.find((event) => event.type === 'mutation');
    if (mutation?.type !== 'mutation') throw new Error('expected a mutation event');
    expect(mutation.deleted).toContain(session.id);
  });
});
