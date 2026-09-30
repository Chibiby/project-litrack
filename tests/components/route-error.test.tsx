import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { RouteError } = await import("@/components/errors/route-error");

type Err = Error & { digest?: string };

function make(name: string, message: string, digest?: string): Err {
  const err: Err = new Error(message);
  err.name = name;
  if (digest) err.digest = digest;
  return err;
}

function setup(error: Err) {
  const retry = vi.fn();
  const reset = vi.fn();
  render(
    <RouteError
      error={error}
      retry={retry}
      reset={reset}
      scope="Test"
      homeHref="/home"
      homeLabel="Back home"
    />
  );
  return { retry, reset };
}

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { value, configurable: true });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  setOnline(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RouteError", () => {
  it("offline: says so, offers no refresh, and retries when the connection returns", () => {
    setOnline(false);
    const { retry } = setup(make("Error", "boom"));

    expect(screen.getByRole("heading", { name: "You're offline" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /try again|reload/i })).toBeNull();
    expect(retry).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("offline with a server digest: shows the classified variant with its reference, not 'You're offline'", () => {
    setOnline(false);
    const { retry } = setup(make("Error", "x", "DBU-1a2b3c"));

    expect(screen.getByRole("heading", { name: "The database isn't responding" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "You're offline" })).toBeNull();
    expect(screen.getByText("DBU-1a2b3c")).not.toBeNull();

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(retry).not.toHaveBeenCalled();
  });

  it("does not retry on `online` when the failure was not an offline one", () => {
    const { retry } = setup(make("Error", "boom", "abc123"));
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(retry).not.toHaveBeenCalled();
  });

  it("a stale bundle (ChunkLoadError) offers Reload page, not Try again", () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      value: { ...original, reload },
      configurable: true,
    });
    try {
      const { retry } = setup(make("ChunkLoadError", "Loading chunk 12 failed."));
      expect(screen.getByRole("heading", { name: "LITRACK was updated" })).not.toBeNull();
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
      expect(reload).toHaveBeenCalledTimes(1);
      expect(retry).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", { value: original, configurable: true });
    }
  });

  it("a network TypeError says LITRACK couldn't be reached", () => {
    setup(make("TypeError", "Failed to fetch"));
    expect(screen.getByRole("heading", { name: "Couldn't reach LITRACK" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).not.toBeNull();
  });

  it("DBU digest: database copy, reference shown, Try again offered", () => {
    setup(make("Error", "x", "DBU-1a2b3c"));
    expect(screen.getByRole("heading", { name: "The database isn't responding" })).not.toBeNull();
    expect(screen.getByText("DBU-1a2b3c")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).not.toBeNull();
  });

  it("DBS digest: no Try again, points to the administrator, reference shown", () => {
    setup(make("Error", "x", "DBS-9f8e7d"));
    expect(screen.getByRole("heading", { name: "LITRACK needs a database update" })).not.toBeNull();
    expect(screen.getByText("DBS-9f8e7d")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByText(/ask your administrator/i)).not.toBeNull();
  });

  it("plain digest: generic copy that no longer claims fault, plus the reference", () => {
    setup(make("Error", "x", "1234567890"));
    expect(screen.getByRole("heading", { name: "This page couldn't load" })).not.toBeNull();
    expect(screen.getByText("1234567890")).not.toBeNull();
    expect(screen.queryByText(/on our side/i)).toBeNull();
  });

  it("Try again calls retry, not reset, and the home link stays", () => {
    const { retry, reset } = setup(make("Error", "x", "1234567890"));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Back home" }).getAttribute("href")).toBe("/home");
  });

  it("AbortError clears itself with reset and renders nothing", () => {
    const { retry, reset } = setup(make("AbortError", "aborted"));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
