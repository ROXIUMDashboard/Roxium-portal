import { describe, expect, it } from 'vitest';
import type { Session } from '@/lib/domain/types';
import { insertionOrder, moveAcrossDays, moveWithinDay } from '@/lib/domain/ordering';

function make(id: string, dayId: string, sortOrder: number): Session {
  return {
    id,
    dayId,
    sortOrder,
    title: id.toUpperCase(),
    description: null,
    startMinute: 600 + sortOrder * 60,
    endMinute: 660 + sortOrder * 60,
    sessionType: 'scientific_session',
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
  };
}

const day1 = [make('a', 'd1', 0), make('b', 'd1', 1), make('c', 'd1', 2)];
const day2 = [make('x', 'd2', 0), make('y', 'd2', 1)];

describe('moveWithinDay', () => {
  it('moves a session up and renumbers the day densely', () => {
    expect(moveWithinDay(day1, 'c', 0)).toEqual([
      { id: 'c', dayId: 'd1', sortOrder: 0 },
      { id: 'a', dayId: 'd1', sortOrder: 1 },
      { id: 'b', dayId: 'd1', sortOrder: 2 },
    ]);
  });

  it('moves a session down', () => {
    expect(moveWithinDay(day1, 'a', 2).map((a) => a.id)).toEqual(['b', 'c', 'a']);
  });

  it('does nothing when the position is unchanged or unknown', () => {
    expect(moveWithinDay(day1, 'b', 1)).toEqual([]);
    expect(moveWithinDay(day1, 'nope', 0)).toEqual([]);
  });

  it('clamps an out-of-range index instead of losing the session', () => {
    expect(moveWithinDay(day1, 'a', 99).map((a) => a.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('moveAcrossDays', () => {
  it('inserts into the target day and renumbers both days', () => {
    const assignments = moveAcrossDays(day1, day2, 'b', 'd2', 1);
    expect(assignments).toEqual([
      { id: 'a', dayId: 'd1', sortOrder: 0 },
      { id: 'c', dayId: 'd1', sortOrder: 1 },
      { id: 'x', dayId: 'd2', sortOrder: 0 },
      { id: 'b', dayId: 'd2', sortOrder: 1 },
      { id: 'y', dayId: 'd2', sortOrder: 2 },
    ]);
  });

  it('appends when dropped past the end of the target day', () => {
    const assignments = moveAcrossDays(day1, day2, 'a', 'd2', 99);
    expect(assignments.filter((a) => a.dayId === 'd2').map((a) => a.id)).toEqual(['x', 'y', 'a']);
  });

  it('does not change the times of the moved session', () => {
    // Ordering only ever produces day/sortOrder assignments; times are untouched
    // so the planner decides whether the moved session needs a new slot.
    const assignments = moveAcrossDays(day1, day2, 'a', 'd2', 0);
    for (const assignment of assignments) {
      expect(Object.keys(assignment).sort()).toEqual(['dayId', 'id', 'sortOrder']);
    }
  });
});

describe('insertionOrder', () => {
  it('opens a slot directly after a given session', () => {
    expect(insertionOrder(day1, 'a')).toEqual([
      { id: 'b', dayId: 'd1', sortOrder: 2 },
      { id: 'c', dayId: 'd1', sortOrder: 3 },
    ]);
  });
});
