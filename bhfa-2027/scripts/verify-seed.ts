/**
 * Verifies what is actually in the database against the transcribed 2027 draft.
 *
 * Run it straight after `npm run db:seed`, and any time you want to confirm the
 * live programme still matches the source. It only reads.
 *
 * Exits 1 on any mismatch so it can gate a deployment.
 */
import { createClient } from '@supabase/supabase-js';
import { SEED_DAYS, SEED_PROGRAM, SEED_SESSION_COUNT } from '../lib/seed/program-2027';
import { formatRange } from '../lib/domain/time';
import { requireSupabaseEnv } from './env';

const { url, key } = requireSupabaseEnv();
const client = createClient(url, key, { auth: { persistSession: false } });

const problems: string[] = [];
const note = (message: string) => problems.push(message);

async function main() {
  const { data: program, error } = await client
    .from('bhfa_programs')
    .select('id, title')
    .eq('key', SEED_PROGRAM.key)
    .maybeSingle();

  if (error || !program) {
    console.error('\nNo seeded program found. Run `npm run db:seed` first.\n');
    process.exit(1);
  }

  const { data: dayRows } = await client
    .from('bhfa_days')
    .select('id, key, day_number, date, title, sort_order')
    .eq('program_id', program.id)
    .order('sort_order');

  const days = dayRows ?? [];
  console.log(`\nprogram   ${program.title}`);
  console.log(`days      ${days.length} (expected ${SEED_DAYS.length})\n`);
  if (days.length !== SEED_DAYS.length) note(`Expected ${SEED_DAYS.length} days, found ${days.length}.`);

  let total = 0;

  for (const seedDay of SEED_DAYS) {
    const day = days.find((d) => d.key === seedDay.key);
    if (!day) {
      note(`Day ${seedDay.key} is missing entirely.`);
      continue;
    }
    if (String(day.date).slice(0, 10) !== seedDay.date) {
      note(`${seedDay.key}: date is ${day.date}, expected ${seedDay.date}.`);
    }
    if (day.title !== seedDay.title) {
      note(`${seedDay.key}: title is “${day.title}”, expected “${seedDay.title}”.`);
    }

    const { data: sessionRows } = await client
      .from('bhfa_sessions')
      .select('id, title, description, start_minute, end_minute, session_type, sort_order, bhfa_session_speakers(status, faculty_id, display_name)')
      .eq('day_id', day.id)
      .order('sort_order');

    const sessions = sessionRows ?? [];
    total += sessions.length;

    const matched = sessions.length === seedDay.sessions.length;
    console.log(
      `day ${seedDay.dayNumber}     ${sessions.length}/${seedDay.sessions.length} sessions ${matched ? 'ok' : 'MISMATCH'}  · ${seedDay.title}`,
    );
    if (!matched) {
      note(`${seedDay.key}: expected ${seedDay.sessions.length} sessions, found ${sessions.length}.`);
    }

    seedDay.sessions.forEach((expected, index) => {
      const actual = sessions[index];
      if (!actual) {
        note(`${seedDay.key}: “${expected.title}” is missing at position ${index + 1}.`);
        return;
      }
      if (actual.title !== expected.title) {
        note(`${seedDay.key} #${index + 1}: title is “${actual.title}”, expected “${expected.title}”.`);
      }
      if (actual.start_minute !== expected.startMinute || actual.end_minute !== expected.endMinute) {
        note(
          `${seedDay.key} “${expected.title}”: time is ${formatRange(actual.start_minute, actual.end_minute)}, ` +
            `expected ${formatRange(expected.startMinute, expected.endMinute)}.`,
        );
      }
      if (actual.session_type !== expected.sessionType) {
        note(`${seedDay.key} “${expected.title}”: type is ${actual.session_type}, expected ${expected.sessionType}.`);
      }
      if ((actual.description ?? '') !== expected.description) {
        note(`${seedDay.key} “${expected.title}”: description does not match the draft.`);
      }

      const speakers = actual.bhfa_session_speakers ?? [];
      const expectedSpeakers = expected.speakers ?? [];
      if (speakers.length !== expectedSpeakers.length) {
        note(
          `${seedDay.key} “${expected.title}”: ${speakers.length} speakers, expected ${expectedSpeakers.length}.`,
        );
      }
      // A speaker the draft leaves unconfirmed must stay unconfirmed.
      expectedSpeakers.forEach((expectedSpeaker, speakerIndex) => {
        const speaker = speakers[speakerIndex];
        if (!speaker) return;
        const expectedStatus = expectedSpeaker.status ?? 'confirmed';
        if (speaker.status !== expectedStatus) {
          note(`${seedDay.key} “${expected.title}”: speaker status ${speaker.status}, expected ${expectedStatus}.`);
        }
        if (expectedStatus === 'tbd' && (speaker.faculty_id || speaker.display_name)) {
          note(`${seedDay.key} “${expected.title}”: an unconfirmed speaker has been given a name.`);
        }
      });
    });
  }

  // The two named faculty from the draft, and nothing invented.
  const { data: faculty } = await client.from('bhfa_faculty').select('name').eq('program_id', program.id);
  console.log(`faculty   ${(faculty ?? []).length} on file: ${(faculty ?? []).map((f) => f.name).join(', ')}`);

  const midnight = SEED_DAYS[2].sessions.at(-1);
  console.log(`\nsessions  ${total}/${SEED_SESSION_COUNT}`);
  console.log(`midnight  Day 03 “${midnight?.title}” ends at minute ${midnight?.endMinute} (1440 = midnight)`);

  if (problems.length) {
    console.error(`\n${problems.length} MISMATCH${problems.length === 1 ? '' : 'ES'}:\n`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('');
    process.exit(1);
  }

  console.log('\nAll seeded sessions match the 2027 draft.\n');
}

void main();
