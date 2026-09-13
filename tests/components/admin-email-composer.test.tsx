import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { sendAdminEmail } = vi.hoisted(() => ({ sendAdminEmail: vi.fn() }));
vi.mock("@/lib/actions/admin-email", () => ({ sendAdminEmail }));

import { AdminEmailComposer } from "@/components/admin/admin-email-composer";

const recipients = [{ id: "1", email: "ana@example.com", name: "Ana Teacher", role: "Teacher" as const, schoolName: "North School" }];

afterEach(() => { cleanup(); sendAdminEmail.mockReset(); });

describe("AdminEmailComposer", () => {
  it("combines selected staff and a manual address into private deliveries", async () => {
    sendAdminEmail.mockResolvedValue({ ok: true, data: { sent: 2, failed: [] } });
    render(<AdminEmailComposer recipients={recipients} configured />);
    fireEvent.change(screen.getByLabelText("Search teachers and school heads"), { target: { value: "Ana" } });
    fireEvent.click(screen.getByRole("button", { name: /Ana Teacher/ }));
    fireEvent.change(screen.getByLabelText("New email address"), { target: { value: "Outside@Example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add address" }));
    expect(screen.getByText("2 private emails")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Notice" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Please review." } });
    fireEvent.click(screen.getByRole("button", { name: "Send email" }));
    await waitFor(() => expect(sendAdminEmail).toHaveBeenCalledWith({ recipients: ["ana@example.com", "outside@example.com"], subject: "Notice", body: "Please review." }));
    expect(await screen.findByText("Sent 2 private emails.")).not.toBeNull();
  });

  it("disables delivery when Resend is not configured", () => {
    render(<AdminEmailComposer recipients={recipients} configured={false} />);
    expect(screen.getByText(/Outbound email is not configured/)).not.toBeNull();
    expect((screen.getByRole("button", { name: "Send email" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
