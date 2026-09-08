/**
 * Seeds the Beverly Hills Face 2027 working program into Supabase and issues a
 * collaboration link.
 *
 * Safe to re-run: the program, days and faculty are matched on their stable
 * keys, and sessions are only inserted when a day has none — an existing
 * working draft is never overwritten by the seed. Pass --force-sessions to
 * replace the sessions of a day that already has some.
 */
import { createClient } from '@supabase/supabase-js';
import { SEED_DAYS, SEED_FACULTY, SEED_PROGRAM } from '../lib/seed/program-2027';
import { generateToken, hashToken, tokenPrefix } from '../lib/server/tokens';
import { requireSupabaseEnv } from './env';

const { url, key } = requireSupabaseEnv();
const forceSessions = process.argv.includes('--force-sessions');
const client = createClient(url, key, { auth: { persistSession: false } });

function fail(context: string, error: { message: string } | null): never {
  console.error(`\n${context}: ${error?.message ?? 'unknown error'}\n`);
  process.exit(1);
}

async function main() {
  /* ------------------------------------------------------------- program */
  const { data: program, error: programError } = await client
    .from('bhfa_programs')
    .upsert(
      {
        key: SEED_PROGRAM.key,
        title: SEED_PROGRAM.title,
        subtitle: SEED_PROGRAM.subtitle,
        status_label: SEED_PROGRAM.statusLabel,
        location_label: SEED_PROGRAM.locationLabel,
        date_range_label: SEED_PROGRAM.dateRangeLabel,
      },
      { onConflict: 'key' },
    )
    .select('id')
    .single();
  if (programError || !program) fail('Could not create the program', programError);
  const programId = program.id as string;
  console.log(`program  ${SEED_PROGRAM.title}`);

  /* ------------------------------------------------------------- faculty */
  const facultyIds = new Map<string, string>();
  for (const person of SEED_FACULTY) {
    const { data: existing } = await client
      .from('bhfa_faculty')
      .select('id')
      .eq('program_id', programId)
      .ilike('name', person.name)
      .maybeSingle();

    if (existing) {
      facultyIds.set(person.name, existing.id);
      continue;
    }
    const { data, error } = await client
      .from('bhfa_faculty')
      .insert({ program_id: programId, name: person.name, credentials: person.credentials })
      .select('id')
      .single();
    if (error || !data) fail(`Could not add faculty ${person.name}`, error);
    facultyIds.set(person.name, data.id);
  }
  console.log(`faculty  ${SEED_FACULTY.length} named in the draft`);

  /* ---------------------------------------------------------------- days */
  let inserted = 0;
  let skipped = 0;

  for (const [index, day] of SEED_DAYS.entries()) {
    const { data: dayRow, error: dayError } = await client
      .from('bhfa_days')
      .upsert(
        {
          program_id: programId,
          key: day.key,
          day_number: day.dayNumber,
          date: day.date,
          weekday_label: day.weekdayLabel,
          short_label: day.shortLabel,
          title: day.title,
          subtitle: day.subtitle,
          hours_label: day.hoursLabel,
          sort_order: index,
        },
        { onConflict: 'program_id,key' },
      )
      .select('id')
      .single();
    if (dayError || !dayRow) fail(`Could not create ${day.key}`, dayError);
    const dayId = dayRow.id as string;

    const { count } = await client
      .from('bhfa_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('day_id', dayId);

    if ((count ?? 0) > 0) {
      if (!forceSessions) {
        skipped += count ?? 0;
        console.log(`day ${day.dayNumber}    already has ${count} sessions — left untouched`);
        continue;
      }
      const { error } = await client.from('bhfa_sessions').delete().eq('day_id', dayId);
      if (error) fail(`Could not clear ${day.key}`, error);
    }

    for (const [order, session] of day.sessions.entries()) {
      const { data: created, error } = await client
        .from('bhfa_sessions')
        .insert({
          day_id: dayId,
          sort_order: order,
          title: session.title,
          description: session.description,
          start_minute: session.startMinute,
          end_minute: session.endMinute,
          session_type: session.sessionType,
          status: 'draft',
        })
        .select('id')
        .single();
      if (error || !created) fail(`Could not add “${session.title}”`, error);
      inserted += 1;

      for (const [speakerOrder, speaker] of (session.speakers ?? []).entries()) {
        const { error: speakerError } = await client.from('bhfa_session_speakers').insert({
          session_id: created.id,
          faculty_id: speaker.name ? (facultyIds.get(speaker.name) ?? null) : null,
          role: speaker.role ?? 'speaker',
          status: speaker.status ?? 'confirmed',
          sort_order: speakerOrder,
        });
        if (speakerError) fail(`Could not add a speaker to “${session.title}”`, speakerError);
      }
    }
    console.log(`day ${day.dayNumber}    ${day.sessions.length} sessions seeded`);
  }

  /* --------------------------------------------------------- collaboration */
  const { data: workspace } = await client
    .from('bhfa_workspaces')
    .select('id')
    .eq('program_id', programId)
    .is('revoked_at', null)
    .maybeSingle();

  const token = process.env.SEED_COLLAB_TOKEN || generateToken();
  const payload = { token_hash: hashToken(token), token_prefix: tokenPrefix(token) };

  if (workspace) {
    const { error } = await client.from('bhfa_workspaces').update(payload).eq('id', workspace.id);
    if (error) fail('Could not update the collaboration link', error);
  } else {
    const { error } = await client
      .from('bhfa_workspaces')
      .insert({ program_id: programId, ...payload, label: 'Primary collaboration link' });
    if (error) fail('Could not create the collaboration link', error);
  }

  console.log(`\nsessions ${inserted} inserted${skipped ? `, ${skipped} left untouched` : ''}`);
  console.log('\n--------------------------------------------------------------');
  console.log('COLLABORATION LINK (shown once — only its hash is stored):\n');
  console.log(`  /program/${token}\n`);
  console.log('--------------------------------------------------------------\n');
}

void main();
