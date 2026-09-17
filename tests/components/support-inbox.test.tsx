import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TicketRow } from "@/lib/support/queries";

import { SupportInbox } from "@/components/support/support-inbox";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

afterEach(cleanup);

function ticket(overrides: Partial<TicketRow>): TicketRow {
  return {
    id: "ticket-1",
    category: "OTHER",
    status: "OPEN",
    subject: "How do I add a section?",
    body: "Need help adding a new section.",
    pageUrl: null,
    requestedScope: null,
    requestedTargetKey: null,
    resolutionNote: null,
    resolvedAt: null,
    createdAt: new Date(),
    requesterName: "Marivic Acibar",
    requesterRole: "TEACHER",
    schoolName: "Malandag Central ES",
    resolverName: null,
    activeGrant: null,
    isDemoSchool: false,
    ...overrides,
  } as TicketRow;
}

describe("SupportInbox", () => {
  it("marks a ticket from a demo school and leaves a real school's ticket unmarked", () => {
    render(
      <SupportInbox
        tickets={[
          ticket({ id: "real", schoolName: "Malandag Central ES", isDemoSchool: false }),
          ticket({ id: "demo", schoolName: "Test Lab Demo School", isDemoSchool: true }),
        ]}
      />
    );

    expect(screen.getAllByText("Demo")).toHaveLength(1);
  });
});
