import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, type LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Terms and Conditions · LITRACK",
  description: "The rules for using LITRACK.",
};

const UPDATED = "2026-11-16";

const SECTIONS: readonly LegalSection[] = [
  {
    heading: "Who may use LITRACK",
    body: (
      <p>
        LITRACK is for authorized school staff and administrators taking part in the ARAL Program. You need an
        account approved by your School Head or by a division or district administrator. Accounts are personal: do
        not share your sign-in or let anyone else use your account.
      </p>
    ),
  },
  {
    heading: "Your responsibilities",
    body: (
      <ul>
        <li>Enter learner information accurately, and only for learners you are responsible for.</li>
        <li>Keep your password private. Change it right away if you think someone else knows it.</li>
        <li>Sign out on shared or public computers.</li>
        <li>Report any mistake, data leak, or suspicious activity to your School Head or through Support.</li>
      </ul>
    ),
  },
  {
    heading: "Learner data",
    body: (
      <>
        <p>
          Learner records are confidential and belong to the school. Use them only for school work and the ARAL
          Program. Exported files (Excel and printouts) carry the same duty of care: share them only with authorized
          school staff, and delete copies you no longer need.
        </p>
        <p>
          The <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link> explains how
          personal information is handled.
        </p>
      </>
    ),
  },
  {
    heading: "What you must not do",
    body: (
      <ul>
        <li>Try to see another school&apos;s data, or any data your role does not allow.</li>
        <li>Enter false records, or change records to misstate a learner&apos;s progress.</li>
        <li>Disrupt the service, probe it for weaknesses, or access it with automated tools.</li>
        <li>Upload a profile photo that is not of you, or that is offensive.</li>
      </ul>
    ),
  },
  {
    heading: "Monitoring and suspension",
    body: (
      <p>
        Security-related actions, such as sign-ins, exports, and deletions, are logged. Administrators can turn off an
        account that breaks these terms or is no longer needed. Misuse of learner data may also lead to action under
        DepEd rules and the Data Privacy Act.
      </p>
    ),
  },
  {
    heading: "Availability",
    body: (
      <p>
        We try to keep LITRACK available and your data safe, but we cannot promise the service will never be
        interrupted. Updates may change how features work. The update notes in the app list each change.
      </p>
    ),
  },
  {
    heading: "Ownership",
    body: (
      <p>
        The LITRACK software, name, and design belong to their owners. The ARAL Program, DepEd, Bagong Pilipinas, and
        Schools Division logos belong to their respective agencies. Using LITRACK gives you no rights to any of
        them.
      </p>
    ),
  },
  {
    heading: "Changes and contact",
    body: (
      <p>
        If these terms change, the date at the top changes too. If you keep using LITRACK after a change, you accept
        the new terms. Send questions to your School Head or your Schools Division Office.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms and Conditions"
      updated={UPDATED}
      intro={<p>When you sign in to LITRACK, you agree to these terms.</p>}
      sections={SECTIONS}
    />
  );
}
