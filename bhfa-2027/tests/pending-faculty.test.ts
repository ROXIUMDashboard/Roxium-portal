/**
 * In-flight faculty edits stay on screen until their own request settles, even
 * when an older response or a collaborator's broadcast carries an older roster.
 */
import { describe, expect, it } from 'vitest';
import { PendingFaculty } from '@/lib/client/pending-faculty';
import { facultyRecord } from '@/lib/domain/faculty';

const mani = facultyRecord({ id: 'f-1', programId: 'p', name: 'Dr. Marc Mani', status: 'confirmed' });
const ghavami = facultyRecord({ id: 'f-2', programId: 'p', name: 'Dr. Ashkan Ghavami', status: 'confirmed' });
const server = [mani, ghavami];

describe('PendingFaculty', () => {
  it('passes the roster straight through when nothing is in flight', () => {
    const pending = new PendingFaculty();
    expect(pending.overlay(server)).toBe(server);
  });

  it('keeps a status click on screen when an older roster arrives', () => {
    const pending = new PendingFaculty();
    pending.patch('f-1', { status: 'maybe' });
    expect(pending.overlay(server).find((f) => f.id === 'f-1')?.status).toBe('maybe');
  });

  it('merges quick successive edits, and only the latest one clears them', () => {
    const pending = new PendingFaculty();
    const first = pending.patch('f-1', { status: 'maybe' });
    const second = pending.patch('f-1', { region: 'local' });

    first(); // the status save came back first — the region save is still going
    expect(pending.overlay(server)[0]).toMatchObject({ status: 'maybe', region: 'local' });

    second();
    expect(pending.empty).toBe(true);
    expect(pending.overlay(server)[0]).toMatchObject({ status: 'confirmed', region: null });
  });

  it('keeps a just-added person when a collaborator’s roster lands first', () => {
    const pending = new PendingFaculty();
    const added = facultyRecord({ id: 'f-3', programId: 'p', name: 'Dr. New', status: 'maybe' });
    const settle = pending.create(added);
    expect(pending.overlay(server).map((f) => f.id)).toEqual(['f-1', 'f-2', 'f-3']);

    // Once the server has them, they are not shown twice.
    expect(pending.overlay([...server, added]).filter((f) => f.id === 'f-3')).toHaveLength(1);
    settle();
    expect(pending.overlay(server).map((f) => f.id)).toEqual(['f-1', 'f-2']);
  });

  it('keeps a removal hidden until the server answers', () => {
    const pending = new PendingFaculty();
    const settle = pending.remove('f-2');
    expect(pending.overlay(server).map((f) => f.id)).toEqual(['f-1']);
    settle();
    expect(pending.overlay(server).map((f) => f.id)).toEqual(['f-1', 'f-2']);
  });
});
