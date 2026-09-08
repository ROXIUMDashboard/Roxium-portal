/**
 * The Beverly Hills Face 2027 working programme, transcribed from the
 * chair-review draft (DRAFT PROGRAM · SEPT 9–12, 2027).
 *
 * This is *seed* data only: it is loaded into the database once and every
 * screen in the app reads from the database afterwards. Nothing here is
 * rendered directly by a component.
 *
 * Faculty are recorded exactly as the draft states them. Where the draft says a
 * surgeon is still to be confirmed, the speaker is seeded with `tbd` status and
 * no name — no assignment is invented.
 */
import type { SessionType, SpeakerRole, SpeakerStatus } from '../domain/types';

export interface SeedSpeaker {
  name?: string;
  role?: SpeakerRole;
  status?: SpeakerStatus;
}

export interface SeedSession {
  key: string;
  title: string;
  description: string;
  startMinute: number;
  endMinute: number;
  sessionType: SessionType;
  speakers?: SeedSpeaker[];
}

export interface SeedDay {
  key: string;
  dayNumber: number;
  date: string;
  weekdayLabel: string;
  shortLabel: string;
  title: string;
  subtitle: string | null;
  hoursLabel: string;
  sessions: SeedSession[];
}

export const SEED_PROGRAM = {
  key: 'bhfa-2027',
  title: 'Beverly Hills Face 2027',
  subtitle: '2027 Scientific Program',
  statusLabel: 'Working Program',
  locationLabel: 'Beverly Hills, California',
  dateRangeLabel: 'September 9–12, 2027',
};

const MANI = { name: 'Dr. Marc Mani', status: 'confirmed' as const };
const GHAVAMI = { name: 'Dr. Ashkan Ghavami', status: 'confirmed' as const };

export const SEED_DAYS: SeedDay[] = [
  {
    key: 'day-01',
    dayNumber: 1,
    date: '2027-09-09',
    weekdayLabel: 'Thursday',
    shortLabel: 'Endoscopic',
    title: 'Endoscopic Facial Rejuvenation',
    subtitle: 'Live surgery lead: Dr. Marc Mani',
    hoursLabel: '5:30 AM – 7:00 PM',
    sessions: [
      { key: 'd1-registration', title: 'Registration + Breakfast', description: 'Daily registration, credentials, breakfast, and live-surgery orientation.', startMinute: 330, endMinute: 390, sessionType: 'breakfast' },
      { key: 'd1-opening', title: 'Opening Ceremony', description: 'Official welcome, program vision, patient-safety briefing, and opening ceremony.', startMinute: 390, endMinute: 420, sessionType: 'ceremony' },
      { key: 'd1-patient-analysis', title: 'Patient Analysis', description: 'Preoperative facial analysis, indications, surgical plan, and anticipated decision points.', startMinute: 420, endMinute: 440, sessionType: 'scientific_session' },
      { key: 'd1-live-1a', title: 'Live Surgery I-A', description: 'Endoscopic facial rejuvenation with Dr. Marc Mani: access, release, visualization, fixation, and vectors.', startMinute: 440, endMinute: 615, sessionType: 'live_surgery', speakers: [MANI] },
      { key: 'd1-coffee-1', title: 'Coffee Break', description: 'First daily coffee break.', startMinute: 615, endMinute: 630, sessionType: 'break' },
      { key: 'd1-live-1b', title: 'Live Surgery I-B', description: 'Continuation of live surgery with moderated intraoperative decision-making.', startMinute: 630, endMinute: 720, sessionType: 'live_surgery', speakers: [MANI] },
      { key: 'd1-debrief', title: 'Surgical Debrief', description: 'Key maneuvers, technical pearls, and audience questions.', startMinute: 720, endMinute: 750, sessionType: 'scientific_session' },
      { key: 'd1-lunch', title: 'Lunch', description: 'Daily lunch and partner experience.', startMinute: 750, endMinute: 810, sessionType: 'lunch' },
      { key: 'd1-anatomy', title: 'Anatomy Session', description: 'Temporal, forehead, midface, and facial nerve anatomy for endoscopic surgery.', startMinute: 810, endMinute: 855, sessionType: 'scientific_session' },
      { key: 'd1-technique', title: 'Technique + Cases', description: 'Patient selection, instrumentation, fixation, longevity, and case-planning discussion.', startMinute: 855, endMinute: 915, sessionType: 'scientific_session' },
      { key: 'd1-coffee-2', title: 'Coffee Break', description: 'Second daily coffee break.', startMinute: 915, endMinute: 930, sessionType: 'break' },
      { key: 'd1-complications', title: 'Complication Forum', description: 'Avoidance and management of nerve injury, asymmetry, alopecia, edema, and fixation failure.', startMinute: 930, endMinute: 990, sessionType: 'panel' },
      { key: 'd1-debate', title: 'Debate', description: 'Endoscopic vs. open approaches: where each technique delivers its strongest result.', startMinute: 990, endMinute: 1050, sessionType: 'panel' },
      { key: 'd1-grand-rounds', title: 'Grand Rounds', description: 'Faculty-led analysis of varied facial shapes, aging patterns, and combined procedures.', startMinute: 1050, endMinute: 1110, sessionType: 'panel' },
      { key: 'd1-takeaways', title: 'Takeaways', description: 'Day-one synthesis, audience questions, and preview of deep-plane day.', startMinute: 1110, endMinute: 1140, sessionType: 'scientific_session' },
    ],
  },
  {
    key: 'day-02',
    dayNumber: 2,
    date: '2027-09-10',
    weekdayLabel: 'Friday',
    shortLabel: 'Deep Plane',
    title: 'Deep Plane Face and Neck Rejuvenation',
    subtitle: 'Live surgery lead: Dr. Ashkan Ghavami',
    hoursLabel: '5:30 AM – 10:00 PM',
    sessions: [
      { key: 'd2-registration', title: 'Registration + Breakfast', description: 'Daily registration, breakfast, patient-safety update, and day-two objectives.', startMinute: 330, endMinute: 390, sessionType: 'breakfast' },
      { key: 'd2-patient-analysis', title: 'Patient Analysis', description: 'Aging pattern, scar planning, vectors, neck diagnosis, and operative strategy.', startMinute: 390, endMinute: 420, sessionType: 'scientific_session' },
      { key: 'd2-live-2a', title: 'Live Surgery II-A', description: 'Deep-plane facelift and neck rejuvenation with Dr. Ashkan Ghavami.', startMinute: 420, endMinute: 615, sessionType: 'live_surgery', speakers: [GHAVAMI] },
      { key: 'd2-coffee-1', title: 'Coffee Break', description: 'First daily coffee break.', startMinute: 615, endMinute: 630, sessionType: 'break' },
      { key: 'd2-live-2b', title: 'Live Surgery II-B', description: 'Continuation of live surgery with moderated step-by-step commentary.', startMinute: 630, endMinute: 720, sessionType: 'live_surgery', speakers: [GHAVAMI] },
      { key: 'd2-debrief', title: 'Surgical Debrief', description: 'Decision review, technical pearls, and questions from the operating room.', startMinute: 720, endMinute: 750, sessionType: 'scientific_session' },
      { key: 'd2-lunch', title: 'Lunch', description: 'Daily lunch and networking.', startMinute: 750, endMinute: 810, sessionType: 'lunch' },
      { key: 'd2-anatomy', title: 'Anatomy Session', description: 'Retaining ligaments, facial nerve relationships, SMAS, platysma, and danger zones.', startMinute: 810, endMinute: 855, sessionType: 'scientific_session' },
      { key: 'd2-neck', title: 'Neck Masterclass', description: 'Submental access, platysmal management, deep neck contouring, and jawline definition.', startMinute: 855, endMinute: 915, sessionType: 'scientific_session' },
      { key: 'd2-coffee-2', title: 'Coffee Break', description: 'Second daily coffee break.', startMinute: 915, endMinute: 930, sessionType: 'break' },
      { key: 'd2-vector-debate', title: 'Vector Debate', description: 'Vertical, lateral, and hybrid strategies across different facial phenotypes.', startMinute: 930, endMinute: 975, sessionType: 'panel' },
      { key: 'd2-revision', title: 'Revision Forum', description: 'Secondary facelift challenges, scar management, distorted planes, and realistic outcomes.', startMinute: 975, endMinute: 1020, sessionType: 'panel' },
      { key: 'd2-complications', title: 'Complication Forum', description: 'Hematoma, nerve injury, skin compromise, contour irregularity, and early intervention.', startMinute: 1020, endMinute: 1065, sessionType: 'panel' },
      { key: 'd2-case-conference', title: 'Case Conference', description: 'Complex cases reviewed by the invited surgical council.', startMinute: 1065, endMinute: 1110, sessionType: 'panel' },
      { key: 'd2-takeaways', title: 'Takeaways', description: 'Faculty synthesis and transition to anatomy lab day.', startMinute: 1110, endMinute: 1140, sessionType: 'scientific_session' },
      { key: 'd2-faculty-dinner', title: 'Faculty Dinner', description: 'Private faculty dinner and relationship-building evening. Location to be announced.', startMinute: 1170, endMinute: 1320, sessionType: 'evening_event' },
    ],
  },
  {
    key: 'day-03',
    dayNumber: 3,
    date: '2027-09-11',
    weekdayLabel: 'Saturday',
    shortLabel: 'Eyes + Anatomy',
    title: 'Periorbital Surgery + Fresh-Cadaver Anatomy',
    subtitle: 'Closing White Party',
    hoursLabel: '5:30 AM – Midnight',
    sessions: [
      { key: 'd3-registration', title: 'Registration + Breakfast', description: 'Daily registration, breakfast, lab orientation, patient safety, and objectives.', startMinute: 330, endMinute: 390, sessionType: 'breakfast' },
      { key: 'd3-patient-analysis', title: 'Patient Analysis', description: 'Upper and lower eyelid assessment, brow-eye relationship, fat compartments, and surgical plan.', startMinute: 390, endMinute: 420, sessionType: 'scientific_session' },
      { key: 'd3-live-3', title: 'Live Surgery III', description: 'Live periorbital surgery: blepharoplasty, canthal support, fat management, and adjunctive strategy. Surgeon to be confirmed.', startMinute: 420, endMinute: 585, sessionType: 'live_surgery', speakers: [{ status: 'tbd' }] },
      { key: 'd3-live-debrief', title: 'Live Debrief', description: 'Operative decision review and audience questions.', startMinute: 585, endMinute: 615, sessionType: 'scientific_session' },
      { key: 'd3-coffee-1', title: 'Coffee Break', description: 'First daily coffee break and laboratory transition.', startMinute: 615, endMinute: 630, sessionType: 'break' },
      { key: 'd3-cadaver-1', title: 'Cadaver Lab I', description: 'Guided facial and periorbital anatomy: brow, temple, eyelids, midface, facial nerve, and safe planes.', startMinute: 630, endMinute: 750, sessionType: 'cadaver_lab' },
      { key: 'd3-lunch', title: 'Lunch', description: 'Daily lunch and faculty exchange.', startMinute: 750, endMinute: 810, sessionType: 'lunch' },
      { key: 'd3-cadaver-2', title: 'Cadaver Lab II', description: 'Technique stations: endoscopic release, deep-plane dissection, neck anatomy, canthal support, and lower-lid approaches.', startMinute: 810, endMinute: 915, sessionType: 'cadaver_lab' },
      { key: 'd3-coffee-2', title: 'Coffee Break', description: 'Second daily coffee break.', startMinute: 915, endMinute: 930, sessionType: 'break' },
      { key: 'd3-cadaver-3', title: 'Cadaver Lab III', description: 'Faculty-guided completion of station objectives and final anatomical review.', startMinute: 930, endMinute: 990, sessionType: 'cadaver_lab' },
      { key: 'd3-eyes-forum', title: 'Eyes Forum', description: 'Avoiding hollowing, malposition, dry eye, asymmetry, and overcorrection.', startMinute: 990, endMinute: 1035, sessionType: 'panel' },
      { key: 'd3-grand-rounds', title: 'Grand Rounds', description: 'Integrated face, neck, brow, and eyelid case planning with invited faculty.', startMinute: 1035, endMinute: 1080, sessionType: 'panel' },
      { key: 'd3-scientific-close', title: 'Scientific Close', description: 'Clinical takeaways, acknowledgments, and completion instructions.', startMinute: 1080, endMinute: 1110, sessionType: 'scientific_session' },
      { key: 'd3-closing-ceremony', title: 'Closing Ceremony', description: 'Beverly Hills Face White Party: closing ceremony, celebration, and community recognition.', startMinute: 1200, endMinute: 1440, sessionType: 'ceremony' },
    ],
  },
  {
    key: 'day-04',
    dayNumber: 4,
    date: '2027-09-12',
    weekdayLabel: 'Sunday',
    shortLabel: 'Practice Growth',
    title: 'The Modern Aesthetic Practice',
    subtitle: 'Growth, systems, market leadership + certification',
    hoursLabel: '5:30 AM – 2:00 PM',
    sessions: [
      { key: 'd4-registration', title: 'Registration + Breakfast', description: 'Daily registration and breakfast.', startMinute: 330, endMinute: 390, sessionType: 'breakfast' },
      { key: 'd4-networking', title: 'Networking Window', description: 'Optional networking, private meetings, and preparation for the 8:00 AM program start.', startMinute: 390, endMinute: 480, sessionType: 'other' },
      { key: 'd4-program-reset', title: 'Program Reset', description: 'Transition from surgical mastery to practice implementation.', startMinute: 480, endMinute: 510, sessionType: 'business' },
      { key: 'd4-market-outlook', title: 'Market Outlook', description: 'The evolving facial aesthetics market: patient expectations, premium positioning, and competitive shifts.', startMinute: 510, endMinute: 540, sessionType: 'business' },
      { key: 'd4-brand-strategy', title: 'Brand Strategy', description: 'Building authority without losing clinical integrity: differentiation, surgeon brand, and message discipline.', startMinute: 540, endMinute: 575, sessionType: 'business' },
      { key: 'd4-content', title: 'Content + Marketing', description: 'Patient education, ethical storytelling, channel strategy, and a repeatable content engine.', startMinute: 575, endMinute: 615, sessionType: 'business' },
      { key: 'd4-coffee-1', title: 'Coffee Break', description: 'First coffee break.', startMinute: 615, endMinute: 630, sessionType: 'break' },
      { key: 'd4-practice-optimization', title: 'Practice Optimization', description: 'Consult conversion, scheduling, treatment coordination, service standards, and measurement.', startMinute: 630, endMinute: 670, sessionType: 'business' },
      { key: 'd4-patient-journey', title: 'Patient Journey', description: 'From first inquiry through recovery: designing a premium, safe, and consistent experience.', startMinute: 670, endMinute: 710, sessionType: 'business' },
      { key: 'd4-team-systems', title: 'Team Systems', description: 'Roles, accountability, training rhythms, communication, and performance dashboards.', startMinute: 710, endMinute: 750, sessionType: 'business' },
      { key: 'd4-lunch-panel', title: 'Lunch + Leadership Panel', description: 'Daily lunch with leadership discussion on scaling reputation and protecting standards.', startMinute: 750, endMinute: 810, sessionType: 'lunch' },
      { key: 'd4-certification', title: 'Certification', description: 'Knowledge check, program evaluation, completion requirements, and certificate presentation.', startMinute: 810, endMinute: 830, sessionType: 'ceremony' },
      { key: 'd4-final-close', title: 'Final Close', description: 'Commitments, next steps, and official conclusion of Beverly Hills Face 2027.', startMinute: 830, endMinute: 840, sessionType: 'ceremony' },
    ],
  },
];

/** Faculty named in the draft. Everything else stays deliberately unassigned. */
export const SEED_FACULTY = [
  { key: 'marc-mani', name: 'Dr. Marc Mani', credentials: 'Live surgery lead · Day 01' },
  { key: 'ashkan-ghavami', name: 'Dr. Ashkan Ghavami', credentials: 'Live surgery lead · Day 02' },
];

export const SEED_SESSION_COUNT = SEED_DAYS.reduce((n, d) => n + d.sessions.length, 0);
