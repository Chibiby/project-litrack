import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy · LITRACK",
  description: "How LITRACK collects, uses, and protects personal information.",
};

const UPDATED = "2026-11-16";

const SECTIONS: readonly LegalSection[] = [
  {
    heading: "Who we are",
    body: (
      <p>
        LITRACK is a school reading-profiling system for the ARAL Program, used by public schools under the
        Department of Education (DepEd). Each school decides whose records are entered and is responsible for
        that information. LITRACK processes it on the school&apos;s behalf, following the Data Privacy Act of
        2012 (Republic Act No. 10173) and DepEd data-handling rules.
      </p>
    ),
  },
  {
    heading: "Information we collect",
    body: (
      <>
        <p>About learners, entered by their teachers and School Heads:</p>
        <ul>
          <li>Name, learner reference number (LRN), sex, birthdate, grade, and section.</li>
          <li>Reading profiles, reading levels, attendance, grades, and ARAL Program records.</li>
          <li>Background details the school records for learner support, such as Indigenous Peoples group.</li>
        </ul>
        <p>About staff (teachers, School Heads, and administrators):</p>
        <ul>
          <li>Name, school, role, sign-in details, and an optional profile photo.</li>
          <li>Professional details entered for profiling, such as position and trainings.</li>
          <li>Security records, such as failed sign-ins, password changes, and exports.</li>
        </ul>
        <p>LITRACK does not collect information directly from learners or parents.</p>
      </>
    ),
  },
  {
    heading: "How we use information",
    body: (
      <ul>
        <li>To let schools track each learner&apos;s reading progress and plan support.</li>
        <li>To produce the reports that schools, districts, and the division need.</li>
        <li>To sign people in, keep accounts secure, and investigate misuse.</li>
        <li>To answer help questions through the in-app assistant (see section 5).</li>
      </ul>
    ),
  },
  {
    heading: "Who can see it",
    body: (
      <>
        <p>Access follows each person&apos;s role:</p>
        <ul>
          <li>Teachers see the learners they teach or advise.</li>
          <li>School Heads see their own school.</li>
          <li>District administrators see the schools in their districts.</li>
          <li>Division administrators see every school in the division. Each time they open a school, it is logged.</li>
        </ul>
        <p>
          We do not sell personal information or use it for advertising. We share it only with the service
          providers that run LITRACK (see section 5), or when the law requires it.
        </p>
      </>
    ),
  },
  {
    heading: "Service providers and transfers outside the Philippines",
    body: (
      <>
        <p>LITRACK runs on these services. Their servers may be outside the Philippines:</p>
        <ul>
          <li>Cloudflare, which hosts the application and stores profile photos.</li>
          <li>Neon, which hosts the database.</li>
          <li>
            Google Gemini, which answers questions typed into the in-app assistant. Each question sends a summary of
            the asker&apos;s own class or school: counts, totals, and learners named only by first name and last
            initial. Full names, LRNs, birthdates, addresses, contact details, and passwords are never sent.
          </li>
        </ul>
      </>
    ),
  },
  {
    heading: "How we protect it",
    body: (
      <ul>
        <li>Connections are encrypted (HTTPS).</li>
        <li>Each school&apos;s data is kept separate from every other school&apos;s.</li>
        <li>Sign-in attempts are rate-limited.</li>
        <li>Photos are re-encoded on your device, which removes location data before upload.</li>
        <li>Exports and other sensitive actions are recorded in a security log.</li>
        <li>
          Division administrators can view a School Head&apos;s password so they can help with sign-in problems.
          Every view is logged.
        </li>
      </ul>
    ),
  },
  {
    heading: "How long we keep it",
    body: (
      <p>
        Records stay while the school needs them for DepEd reporting. Deleted learners can be restored for a time,
        and then they are permanently removed. Security log entries are removed after a set period. A removed
        profile photo is deleted right away, but a browser may show a cached copy for up to 24 hours.
      </p>
    ),
  },
  {
    heading: "Your rights",
    body: (
      <>
        <p>
          Under the Data Privacy Act, you have the right to be informed, to access your information, to object, to
          have errors corrected, to have information erased or blocked, to data portability, to claim damages, and to
          file a complaint with the National Privacy Commission.
        </p>
        <p>
          Staff can update their own profile and photo in Settings. Parents and guardians who want to see or correct a
          learner&apos;s record should ask the learner&apos;s school. The school handles the request with its Data
          Protection Officer.
        </p>
      </>
    ),
  },
  {
    heading: "Cookies",
    body: (
      <p>
        LITRACK uses cookies only to keep you signed in and secure, and stores a few display preferences on your
        device. It uses no advertising or tracking cookies.
      </p>
    ),
  },
  {
    heading: "Changes and contact",
    body: (
      <p>
        If this policy changes, the date at the top changes too. Send questions or privacy concerns to your School
        Head or your Schools Division Office&apos;s Data Protection Officer. Signed-in users can also use Support in
        the app.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated={UPDATED}
      intro={
        <p>
          This policy explains what personal information LITRACK keeps about learners and school staff, why it keeps
          it, who can see it, and the choices you have.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
