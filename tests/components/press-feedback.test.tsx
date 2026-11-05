import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PressFeedback } from "@/components/press-feedback";

afterEach(cleanup);

function SaveButton({ loading }: { loading: boolean }) {
  return (
    <>
      <PressFeedback />
      <Button loading={loading} loadingText="Saving…">
        Save changes
      </Button>
    </>
  );
}

const saveButton = () => screen.getByRole("button");

describe("Button press marks", () => {
  it("marks filled buttons light, outline dark, links not at all, and save buttons", () => {
    render(
      <>
        <Button>Sign in</Button>
        <Button variant="outline">Cancel</Button>
        <Button variant="link">Help</Button>
        <Button loadingText="Saving…">Save</Button>
        <Button loadingText="Deleting…">Delete</Button>
      </>,
    );
    expect(screen.getByText("Sign in").getAttribute("data-press")).toBe("light");
    expect(screen.getByText("Cancel").getAttribute("data-press")).toBe("dark");
    expect(screen.getByText("Help").hasAttribute("data-press")).toBe(false);
    expect(screen.getByText("Save").hasAttribute("data-save")).toBe(true);
    expect(screen.getByText("Delete").hasAttribute("data-save")).toBe(false);
  });
});

describe("Saved tick", () => {
  it("draws after a save that ended with a success toast", async () => {
    const { rerender } = render(<SaveButton loading={false} />);
    rerender(<SaveButton loading />);
    await act(async () => {});
    act(() => {
      toast.success("Learner saved");
    });
    rerender(<SaveButton loading={false} />);

    await waitFor(() => expect(saveButton().querySelector("[data-press-saved]")).not.toBeNull());
    expect(saveButton().textContent).toContain("Saved");
  });

  it("stays plain when the save failed", async () => {
    const { rerender } = render(<SaveButton loading={false} />);
    rerender(<SaveButton loading />);
    await act(async () => {});
    act(() => {
      toast.error("Couldn't save");
    });
    rerender(<SaveButton loading={false} />);
    await act(async () => {});

    expect(saveButton().querySelector("[data-press-saved]")).toBeNull();
  });

  it("stays plain when nothing reported success", async () => {
    const { rerender } = render(<SaveButton loading={false} />);
    rerender(<SaveButton loading />);
    await act(async () => {});
    rerender(<SaveButton loading={false} />);
    await act(async () => {});

    expect(saveButton().querySelector("[data-press-saved]")).toBeNull();
  });
});
