/**
 * Wire shape for the read-only Student Profile modal on the teacher roster.
 *
 * Kept in a plain module (no `"use server"`) so client components can import
 * the types without dragging the action's Prisma imports into the bundle.
 *
 * Everything here is JSON-safe: `Date` columns are pre-formatted or reduced to
 * `YYYY-MM-DD` strings by the action, because a server action's return value
 * crosses the RSC boundary and Dates in nested arrays are needless payload.
 */

/** Rows shown per history table — matches the learner detail page's caps. */
export const PROFILE_ENROLLMENT_TAKE = 12;
export const PROFILE_ATTENDANCE_TAKE = 20;
export const PROFILE_READING_TAKE = 12;

export type ProfileEnrollment = {
  id: string;
  status: string;
  /** Local date key, `YYYY-MM-DD`. */
  enrolledAt: string;
  endedAt: string | null;
  schoolYearLabel: string | null;
  gradeType: string | null;
  sectionName: string | null;
  teacherName: string | null;
};

export type ProfileAttendance = {
  id: string;
  /** Local date key, `YYYY-MM-DD`. */
  date: string;
  weekStart: string;
  status: string;
  notes: string | null;
};

export type ProfileReadingLevel = {
  id: string;
  /** Local date key, `YYYY-MM-DD`. */
  weekStart: string;
  englishProfile: string;
  filipinoProfile: string;
  wordRecognitionLevel: string | null;
  readingComprehensionLevel: string | null;
  notes: string | null;
};

export type ProfileAralProfile = {
  absenteeismFrequency: string | null;
  absenteeismOtherReason: string | null;
  letterRecognition: string | null;
  letterSoundCorrespondence: string | null;
  wordRecognition: string | null;
  homeLiteracyEnvironment: string | null;
  parentalSupport: string | null;
  classroomEnvironment: string | null;
  languageConsiderations: string[];
  suggestedInterventions: string[];
  furtherAssessment: string[];
  furtherAssessmentOther: string | null;
  lsenObservations: string | null;
};

export type LearnerProfileData = {
  id: string;
  fullName: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  age: number;
  gender: string;
  ethnicity: string | null;
  ethnicityOther: string | null;
  englishReadingProfile: string;
  filipinoReadingProfile: string;
  englishFrustrationSubtypes: string[];
  filipinoFrustrationSubtypes: string[];
  governmentBenefits: string[];
  parentEducation: string;
  modeOfTransportation: string | null;
  distanceHomeToSchool: string | null;
  previousTransfers: string | null;
  transferDetails: string | null;
  gradeLevelId: string;
  gradeType: string;
  sectionName: string | null;
  adviserName: string | null;
  isAralLearner: boolean;
  /** Local date key, `YYYY-MM-DD`. Null when never enrolled in ARAL. */
  aralEnrolledAt: string | null;
  aralTutorName: string | null;
  /**
   * The tutor's id, so a reassign picker can open on whoever holds the learner
   * now instead of resetting to the viewing teacher.
   */
  aralTeacherId: string | null;
  archivedAt: string | null;
  /** Learner record creation date — the fallback "date enrolled". */
  createdAt: string;
  enrollments: ProfileEnrollment[];
  attendances: ProfileAttendance[];
  readingLevels: ProfileReadingLevel[];
  aralProfile: ProfileAralProfile | null;
};
