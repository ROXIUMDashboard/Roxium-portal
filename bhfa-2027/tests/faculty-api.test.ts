// @vitest-environment node
/**
 * The faculty register through the route handlers a browser calls: adding
 * people, moving them between Confirmed, Maybe, Declined and Not Pursuing,
 * restoring them, editing their record, and the history and realtime that
 * follow every change.
 */
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Faculty, HistoryEntry, ProgramSnapshot } from '@/lib/domain/types';
import { countFaculty } from '@/lib/domain/faculty';
import { getRepositoryHandle, resetRepositoryForTests } from '@/lib/data';
import { resetRateLimits } from '@/lib/server/rate-limit';
import { subscribe, type ProgramEvent } from '@/lib/server/realtime';

import { GET as getSnapshot } from '@/app/api/program/[token]/route';
import { POST as postFaculty } from '@/app/api/program/[token]/faculty/route';
import { PATCH as patchFaculty, DELETE as deleteFaculty } from '@/app/api/program/[token]/faculty/[facultyId]/route';
import { PATCH as patchDay } from '@/app/api/program/[token]/days/[dayId]/route';
import { GET as getHistory } from '@/app/api/program/[token]/history/route';
import { POST as postRevert } from '@/app/api/program/[token]/history/[entryId]/revert/route';

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

async function member(name: string): Promise<Faculty> {
  const found = (await snapshot()).faculty.find((f) => f.name === name);
  if (!found) throw new Error(`No faculty member named ${name}`);
  return found;
}

async function add(body: Record<string, unknown>, actor = 'Max') {
  return postFaculty(request(body, actor), params({ token: TOKEN }));
}

async function edit(id: string, body: Record<string, unknown>, actor = 'Max') {
  return patchFaculty(request(body, actor), params({ token: TOKEN, facultyId: id }));
}

async function remove(id: string) {
  return deleteFaculty(request({}), params({ token: TOKEN, facultyId: id }));
}

async function undo(entryId: string) {
  return postRevert(request({ mode: 'undo' }), params({ token: TOKEN, entryId }));
}

beforeEach(() => {
  resetRepositoryForTests(TOKEN);
  resetRateLimits();
});

/* -------------------------------------------------------------- the seed */

describe('the register as seeded', () => {
  it('holds only the faculty the programme actually names — nobody invented', async () => {
    const { faculty } = await snapshot();
    expect(faculty.map((f) => f.name).sort()).toEqual(['Dr. Ashkan Ghavami', 'Dr. Marc Mani']);
  });

  it('has both live-surgery leads confirmed, so the counters start at two', async () => {
    const counts = countFaculty((await snapshot()).faculty);
    expect(counts).toMatchObject({ active: 2, confirmed: 2, maybe: 0, inactive: 0 });
  });
});

/* -------------------------------------------------------------- adding */

describe('adding faculty', () => {
  it('adds someone with the id the browser chose, so the optimistic row is the saved row', async () => {
    const id = randomUUID();
    const response = await add({ id, name: 'Dr. Test Faculty', status: 'maybe' });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.facultyMember.id).toBe(id);
    expect(body.facultyMember.status).toBe('maybe');
    expect(body.faculty.some((f: Faculty) => f.id === id)).toBe(true);
    expect((await member('Dr. Test Faculty')).id).toBe(id);
  });

  it('stores the whole record in one go', async () => {
    const response = await add({
      name: 'Dr. Test International',
      credentials: 'MD',
      status: 'confirmed',
      region: 'international',
      specialty: 'Rhinoplasty',
      proposedRole: 'Panelist',
      city: 'São Paulo',
      stateProvince: 'SP',
      country: 'Brazil',
    });
    expect(response.status).toBe(201);
    const saved = await member('Dr. Test International');
    expect(saved).toMatchObject({
      credentials: 'MD',
      status: 'confirmed',
      region: 'international',
      specialty: 'Rhinoplasty',
      proposedRole: 'Panelist',
      city: 'São Paulo',
      stateProvince: 'SP',
      country: 'Brazil',
      updatedBy: 'Max',
    });
  });

  it('refuses a name already in the register, whatever the case', async () => {
    const response = await add({ name: 'dr. marc mani' });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/already in the faculty register/);
    expect((await snapshot()).faculty).toHaveLength(2);
  });

  it('refuses a blank name', async () => {
    expect((await add({ name: '   ' })).status).toBe(400);
  });

  it('refuses a malformed client id', async () => {
    expect((await add({ id: 'not-a-uuid', name: 'Dr. Test' })).status).toBe(400);
  });

  it('refuses the same id twice', async () => {
    const id = randomUUID();
    await add({ id, name: 'Dr. Test One' });
    expect((await add({ id, name: 'Dr. Test Two' })).status).toBe(400);
  });

  it('records who added them', async () => {
    await add({ name: 'Dr. Test Faculty', status: 'maybe' }, 'Kelsey');
    const [latest] = await history();
    expect(latest.action).toBe('faculty_created');
    expect(latest.actorName).toBe('Kelsey');
    expect(latest.summary).toBe('Added Dr. Test Faculty to the faculty register as Maybe');
    expect(latest.facultyId).toBe((await member('Dr. Test Faculty')).id);
  });
});

/* ----------------------------------------------------- moving between lists */

describe('moving faculty between statuses', () => {
  async function maybe() {
    const body = await (await add({ name: 'Dr. Test Mover', status: 'maybe', region: 'united_states' })).json();
    return body.facultyMember as Faculty;
  }

  it('moves Maybe to Confirmed, and the counters follow', async () => {
    const f = await maybe();
    expect(countFaculty((await snapshot()).faculty)).toMatchObject({ confirmed: 2, maybe: 1 });
    const response = await edit(f.id, { status: 'confirmed' });
    expect(response.status).toBe(200);
    expect(countFaculty((await snapshot()).faculty)).toMatchObject({ active: 3, confirmed: 3, maybe: 0 });
    expect((await history())[0].summary).toBe('Dr. Test Mover marked Confirmed');
  });

  it('moves Confirmed back to Maybe', async () => {
    const f = await maybe();
    await edit(f.id, { status: 'confirmed' });
    await edit(f.id, { status: 'maybe' });
    expect((await member('Dr. Test Mover')).status).toBe('maybe');
  });

  it('moves someone to Declined — out of the active list, into the inactive section', async () => {
    const f = await maybe();
    await edit(f.id, { status: 'declined' });
    const counts = countFaculty((await snapshot()).faculty);
    expect(counts).toMatchObject({ active: 2, inactive: 1, declined: 1, notPursuing: 0 });
    expect((await history())[0].summary).toBe('Dr. Test Mover moved to Declined (inactive)');
  });

  it('moves someone to Not Pursuing, kept distinct from Declined', async () => {
    const f = await maybe();
    await edit(f.id, { status: 'not_pursuing' });
    expect(countFaculty((await snapshot()).faculty)).toMatchObject({ declined: 0, notPursuing: 1 });
    expect((await history())[0].summary).toBe('Dr. Test Mover moved to Not Pursuing (inactive)');
  });

  it('restores someone from the inactive section to the active list', async () => {
    const f = await maybe();
    await edit(f.id, { status: 'declined' });
    await edit(f.id, { status: 'maybe' });
    expect(countFaculty((await snapshot()).faculty)).toMatchObject({ active: 3, inactive: 0 });
    expect((await history())[0].summary).toBe('Dr. Test Mover restored to Maybe');
  });

  it('keeps every detail through the round trip', async () => {
    const f = await maybe();
    await edit(f.id, { proposedRole: 'Moderator', specialty: 'Facelift' });
    await edit(f.id, { status: 'not_pursuing' });
    await edit(f.id, { status: 'confirmed' });
    expect(await member('Dr. Test Mover')).toMatchObject({
      proposedRole: 'Moderator',
      specialty: 'Facelift',
      region: 'united_states',
      status: 'confirmed',
    });
  });

  it('refuses a status that does not exist', async () => {
    const f = await maybe();
    expect((await edit(f.id, { status: 'tentative' })).status).toBe(400);
    expect((await member('Dr. Test Mover')).status).toBe('maybe');
  });
});

/* ------------------------------------------------------------- editing */

describe('editing a faculty record', () => {
  it('sets the region, and the region counters follow', async () => {
    const f = await member('Dr. Marc Mani');
    await edit(f.id, { region: 'local' });
    expect(countFaculty((await snapshot()).faculty)).toMatchObject({ local: 1, regionNotSet: 1 });
    expect((await history())[0].summary).toBe('Dr. Marc Mani: region set to Beverly Hills / Local');
  });

  it('clears a field with an explicit null, and leaves absent fields alone', async () => {
    const f = await member('Dr. Marc Mani');
    await edit(f.id, { city: 'Beverly Hills', specialty: 'Endoscopic facial rejuvenation' });
    await edit(f.id, { city: null });
    expect(await member('Dr. Marc Mani')).toMatchObject({ city: null, specialty: 'Endoscopic facial rejuvenation' });
  });

  it('writes no history for a save that changes nothing', async () => {
    const f = await member('Dr. Marc Mani');
    const before = (await history()).length;
    const response = await edit(f.id, { status: 'confirmed' });
    expect(response.status).toBe(200);
    expect((await history()).length).toBe(before);
  });

  it('names the fields that changed', async () => {
    const f = await member('Dr. Marc Mani');
    await edit(f.id, { specialty: 'Endoscopic facial rejuvenation', proposedRole: 'Live surgery' });
    expect((await history())[0].summary).toBe('Dr. Marc Mani: specialty, proposed role updated');
  });

  it('refuses a region that does not exist', async () => {
    const f = await member('Dr. Marc Mani');
    expect((await edit(f.id, { region: 'europe' })).status).toBe(400);
  });
});

/* ------------------------------------------------ the retired CRM fields */

describe('the retired CRM fields', () => {
  const RETIRED = {
    invitationStatus: 'Invited',
    invitationDate: '2026-10-01',
    lastContactDate: '2026-10-02',
    owner: 'Kelsey',
    internalNotes: 'Confidential',
    email: 'someone@example.com',
    phone: '555-0100',
    website: 'https://example.com/',
    headshotUrl: 'https://example.com/a.jpg',
    priority: true,
  };

  it('cannot be written through the product any more — they are ignored', async () => {
    const response = await add({ name: 'Dr. Test Retired', status: 'maybe', ...RETIRED });
    expect(response.status).toBe(201);
    expect(await member('Dr. Test Retired')).toMatchObject({
      status: 'maybe',
      invitationStatus: null,
      internalNotes: null,
      email: null,
      priority: false,
    });

    const f = await member('Dr. Test Retired');
    const before = (await history()).length;
    expect((await edit(f.id, RETIRED)).status).toBe(200);
    expect((await history()).length).toBe(before);
    expect((await member('Dr. Test Retired')).owner).toBeNull();
  });

  it('keeps anything already recorded in them — through edits, status moves and undo', async () => {
    const f = await member('Dr. Marc Mani');
    // As if written before the fields were retired.
    await getRepositoryHandle().repository.updateFaculty(f.id, RETIRED, 'earlier');

    await edit(f.id, { specialty: 'Endoscopic facial rejuvenation' });
    await edit(f.id, { status: 'declined' });
    const [move] = await history();
    await undo(move.id);

    expect(await member('Dr. Marc Mani')).toMatchObject({
      status: 'confirmed',
      specialty: 'Endoscopic facial rejuvenation',
      ...RETIRED,
    });
  });

  it('renames, and the agenda resolves the new name through the same link', async () => {
    const f = await member('Dr. Marc Mani');
    const response = await edit(f.id, { name: 'Dr. Marc H. Mani' });
    expect(response.status).toBe(200);
    const state = await snapshot();
    const live = state.sessions.find((s) => s.title === 'Live Surgery I-A');
    expect(live?.speakers[0].facultyId).toBe(f.id);
    expect(state.faculty.find((x) => x.id === f.id)?.name).toBe('Dr. Marc H. Mani');
  });

  it('refuses a rename onto someone else', async () => {
    const f = await member('Dr. Marc Mani');
    expect((await edit(f.id, { name: 'Dr. Ashkan Ghavami' })).status).toBe(400);
  });

  it('says so when the person was already removed by someone else', async () => {
    const response = await edit(randomUUID(), { status: 'maybe' });
    expect(response.status).toBe(404);
  });
});

/* ------------------------------------------------------------ removing */

describe('removing faculty', () => {
  it('removes someone who is not on the agenda', async () => {
    const created = (await (await add({ name: 'Dr. Test Removable' })).json()).facultyMember as Faculty;
    const response = await remove(created.id);
    expect(response.status).toBe(200);
    expect((await snapshot()).faculty.some((f) => f.id === created.id)).toBe(false);
    expect((await history())[0].action).toBe('faculty_deleted');
  });

  it('refuses to remove someone the agenda depends on, and says what to do instead', async () => {
    const f = await member('Dr. Marc Mani');
    const response = await remove(f.id);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(
      'Dr. Marc Mani is on 2 agenda sessions. Mark them Not Pursuing, or take them off those sessions first.',
    );
    expect((await snapshot()).faculty.some((x) => x.id === f.id)).toBe(true);
  });
});

/* ------------------------------------------------------------ undo */

describe('undoing faculty changes', () => {
  it('undoes a move to Declined', async () => {
    const f = (await (await add({ name: 'Dr. Test Undo', status: 'maybe' })).json()).facultyMember as Faculty;
    await edit(f.id, { status: 'declined' });
    const [entry] = await history();
    expect((await undo(entry.id)).status).toBe(200);
    expect((await member('Dr. Test Undo')).status).toBe('maybe');
  });

  it('undoes an addition by removing them again', async () => {
    await add({ name: 'Dr. Test Undo' });
    const [entry] = await history();
    expect((await undo(entry.id)).status).toBe(200);
    expect((await snapshot()).faculty.some((f) => f.name === 'Dr. Test Undo')).toBe(false);
  });

  it('undoes a removal by putting the whole record back', async () => {
    const f = (
      await (await add({ name: 'Dr. Test Undo', status: 'maybe', region: 'international', proposedRole: 'Keynote' })).json()
    ).facultyMember as Faculty;
    await remove(f.id);
    const [entry] = await history();
    expect((await undo(entry.id)).status).toBe(200);
    expect(await member('Dr. Test Undo')).toMatchObject({
      id: f.id,
      status: 'maybe',
      region: 'international',
      proposedRole: 'Keynote',
    });
  });

  it('undoes a day header edit — this used to be silently ignored', async () => {
    const day = (await snapshot()).days[0];
    await patchDay(request({ title: 'Changed title' }), params({ token: TOKEN, dayId: day.id }));
    expect((await snapshot()).days[0].title).toBe('Changed title');
    const [entry] = await history();
    expect(entry.action).toBe('day_changed');
    expect((await undo(entry.id)).status).toBe(200);
    expect((await snapshot()).days[0].title).toBe(day.title);
  });
});

/* ------------------------------------------------------------ access & realtime */

describe('faculty access and realtime', () => {
  it('refuses every faculty change without a valid collaboration link', async () => {
    const f = await member('Dr. Marc Mani');
    expect((await postFaculty(request({ name: 'Dr. X' }), params({ token: BAD_TOKEN }))).status).toBe(404);
    expect((await patchFaculty(request({ status: 'declined' }), params({ token: BAD_TOKEN, facultyId: f.id }))).status).toBe(404);
    expect((await deleteFaculty(request({}), params({ token: BAD_TOKEN, facultyId: f.id }))).status).toBe(404);
    expect((await member('Dr. Marc Mani')).status).toBe('confirmed');
  });

  it('sends every other browser the new roster with each change', async () => {
    const state = await snapshot();
    const events: ProgramEvent[] = [];
    const unsubscribe = subscribe(state.program.id, (event) => events.push(event));
    const created = (await (await add({ name: 'Dr. Test Realtime', status: 'maybe' }, 'Ashkan')).json())
      .facultyMember as Faculty;
    await edit(created.id, { status: 'confirmed' }, 'Ashkan');
    unsubscribe();

    const mutations = events.filter((event) => event.type === 'mutation');
    expect(mutations).toHaveLength(2);
    const [first, second] = mutations;
    if (first.type !== 'mutation' || second.type !== 'mutation') throw new Error('expected mutation events');
    expect(first.actorClientId).toBe('client-Ashkan');
    expect(first.faculty?.find((f) => f.id === created.id)?.status).toBe('maybe');
    expect(second.faculty?.find((f) => f.id === created.id)?.status).toBe('confirmed');
    expect(second.summary).toBe('Dr. Test Realtime marked Confirmed');
  });
});
