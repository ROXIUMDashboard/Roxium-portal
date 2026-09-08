import { describe, expect, it } from 'vitest';
import type { Session, SessionType } from '@/lib/domain/types';
import {
  analyseDay,
  computeShift,
  computeSnapAfterPrevious,
  conflictCountForDay,
  isInvalid,
  overlapMinutes,
  sessionsForDay,
} from '@/lib/domain/schedule';
import { SEED_DAYS } from '@/lib/seed/program-2027';

let counter = 0;

function session(partial: Partial<Session> & { startMinute: number; endMinute: number }): Session {
  counter += 1;
  return {
    id: partial.id ?? `s${counter}`,
    dayId: partial.dayId ?? 'day-1',
    sortOrder: partial.sortOrder ?? counter,
    title: partial.title ?? `Session ${counter}`,
    description: null,
    sessionType: (partial.sessionType ?? 'scientific_session') as SessionType,
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
    ...partial,
  };
}

describe('conflict detection', () => {
  it('flags the later session when two sessions overlap', () => {
    const a = session({ id: 'a', sortOrder: 0, title: 'Session A', startMinute: 630, endMinute: 690 });
    const b = session({ id: 'b', sortOrder: 1, title: 'Session B', startMinute: 675, endMinute: 705 });

    const issues = analyseDay([a, b]);
    expect(issues.a).toBeUndefined();
    expect(issues.b?.[0]).toMatchObject({ kind: 'conflict', overlapMinutes: 15, withSessionId: 'a' });
    expect(issues.b?.[0].label).toBe('15 MIN OVERLAP');
  });

  it('clears the conflict as soon as the overlap is resolved', () => {
    const a = session({ id: 'a', sortOrder: 0, startMinute: 630, endMinute: 690 });
    const b = session({ id: 'b', sortOrder: 1, startMinute: 690, endMinute: 720 });
    expect(analyseDay([a, b]).b).toBeUndefined();
  });

  it('treats an end time at or before the start as an error', () => {
    const bad = session({ id: 'x', startMinute: 600, endMinute: 600 });
    expect(isInvalid(bad)).toBe(true);
    expect(analyseDay([bad]).x?.[0]).toMatchObject({ kind: 'invalid', label: 'INVALID TIME' });

    const backwards = session({ id: 'y', startMinute: 600, endMinute: 540 });
    expect(analyseDay([backwards]).y?.[0].kind).toBe('invalid');
  });

  it('measures overlap between two sessions', () => {
    const a = session({ startMinute: 600, endMinute: 660 });
    const b = session({ startMinute: 630, endMinute: 700 });
    expect(overlapMinutes(a, b)).toBe(30);
  });

  it('counts conflicting sessions per day for the day selector', () => {
    const sessions = [
      session({ id: 'a', dayId: 'd1', sortOrder: 0, startMinute: 600, endMinute: 700 }),
      session({ id: 'b', dayId: 'd1', sortOrder: 1, startMinute: 650, endMinute: 720 }),
      session({ id: 'c', dayId: 'd2', sortOrder: 0, startMinute: 600, endMinute: 700 }),
    ];
    expect(conflictCountForDay(sessions, 'd1')).toBe(1);
    expect(conflictCountForDay(sessions, 'd2')).toBe(0);
  });
});

describe('gap detection', () => {
  it('flags a meaningful gap in amber, naming the duration', () => {
    const a = session({ id: 'a', sortOrder: 0, title: 'Grand Rounds', startMinute: 600, endMinute: 660 });
    const b = session({ id: 'b', sortOrder: 1, startMinute: 705, endMinute: 750 });

    const issue = analyseDay([a, b]).b?.[0];
    expect(issue).toMatchObject({ kind: 'gap', gapMinutes: 45 });
    expect(issue?.label).toBe('45 MIN UNSCHEDULED GAP');
  });

  it('ignores ordinary turnaround time', () => {
    const a = session({ id: 'a', sortOrder: 0, startMinute: 600, endMinute: 660 });
    const b = session({ id: 'b', sortOrder: 1, startMinute: 665, endMinute: 700 });
    expect(analyseDay([a, b]).b).toBeUndefined();
  });

  it('does not flag the deliberate space before an evening event', () => {
    const close = session({ id: 'a', sortOrder: 0, startMinute: 1080, endMinute: 1110 });
    const party = session({ id: 'b', sortOrder: 1, startMinute: 1200, endMinute: 1440, sessionType: 'ceremony' });
    expect(analyseDay([close, party]).b).toBeUndefined();
  });
});

describe('bulk time shift', () => {
  const day = [
    session({ id: 'a', sortOrder: 0, startMinute: 630, endMinute: 675 }),
    session({ id: 'b', sortOrder: 1, startMinute: 675, endMinute: 705 }),
    session({ id: 'c', sortOrder: 2, startMinute: 705, endMinute: 765 }),
  ];

  it('moves every following session while preserving its duration', () => {
    const targets = computeShift(day, 0, 15);
    expect(targets).toEqual([
      { id: 'b', startMinute: 690, endMinute: 720 },
      { id: 'c', startMinute: 720, endMinute: 780 },
    ]);
  });

  it('shifts backwards for a shortened session', () => {
    expect(computeShift(day, 0, -15)).toEqual([
      { id: 'b', startMinute: 660, endMinute: 690 },
      { id: 'c', startMinute: 690, endMinute: 750 },
    ]);
  });

  it('changes nothing when the delta is zero or not a whole number of minutes', () => {
    expect(computeShift(day, 0, 0)).toEqual([]);
    expect(computeShift(day, 0, 7.5)).toEqual([]);
  });

  it('leaves earlier sessions alone', () => {
    expect(computeShift(day, 1, 15).map((t) => t.id)).toEqual(['c']);
  });
});

describe('conflict fixes', () => {
  it('suggests starting a session where the previous one ends', () => {
    const day = [
      session({ id: 'a', sortOrder: 0, startMinute: 630, endMinute: 690 }),
      session({ id: 'b', sortOrder: 1, startMinute: 675, endMinute: 705 }),
    ];
    expect(computeSnapAfterPrevious(day, 'b')).toEqual({ id: 'b', startMinute: 690, endMinute: 720 });
  });

  it('has nothing to suggest for the first session of a day', () => {
    const day = [session({ id: 'a', sortOrder: 0, startMinute: 630, endMinute: 690 })];
    expect(computeSnapAfterPrevious(day, 'a')).toBeNull();
  });
});

describe('the seeded 2027 program', () => {
  it('carries every session from the printed draft', () => {
    expect(SEED_DAYS).toHaveLength(4);
    expect(SEED_DAYS.reduce((n, d) => n + d.sessions.length, 0)).toBe(58);
  });

  it('has no conflicts and no unexpected gaps as seeded', () => {
    for (const day of SEED_DAYS) {
      const sessions = day.sessions.map(({ key, speakers, ...seed }, index) =>
        session({ id: `${day.key}-${index}`, dayId: day.key, sortOrder: index, ...seed }),
      );
      const issues = Object.values(analyseDay(sessions)).flat();
      expect(issues, `${day.key} should be clean`).toEqual([]);
    }
  });

  it('keeps the White Party ending exactly at midnight', () => {
    const party = SEED_DAYS[2].sessions.at(-1);
    expect(party?.title).toBe('Closing Ceremony');
    expect(party?.endMinute).toBe(1440);
  });

  it('leaves the unconfirmed periorbital surgeon unassigned', () => {
    const liveSurgery = SEED_DAYS[2].sessions.find((s) => s.title === 'Live Surgery III');
    expect(liveSurgery?.speakers).toEqual([{ status: 'tbd' }]);
  });

  it('filters and orders sessions by day', () => {
    const sessions = [
      session({ id: 'b', dayId: 'd1', sortOrder: 2, startMinute: 600, endMinute: 660 }),
      session({ id: 'a', dayId: 'd1', sortOrder: 1, startMinute: 500, endMinute: 560 }),
      session({ id: 'c', dayId: 'd2', sortOrder: 1, startMinute: 500, endMinute: 560 }),
    ];
    expect(sessionsForDay(sessions, 'd1').map((s) => s.id)).toEqual(['a', 'b']);
  });
});
