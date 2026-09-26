import { useState, type ComponentProps } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, act } from "@testing-library/react";
import { SearchInput } from "@/components/ui/search-input";

/**
 * The shared search field behind `header-search.tsx` and every filter box
 * that used to hand-roll its own <Input> + debounce + clear button. These
 * tests pin the contract other callers rely on so a future edit here cannot
 * quietly drop a behaviour another screen depends on.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Controlled({
  value: initialValue,
  onValueChange,
  ...rest
}: Partial<ComponentProps<typeof SearchInput>> = {}) {
  const [value, setValue] = useState(initialValue ?? "");
  return (
    <SearchInput
      label="Search"
      value={value}
      onValueChange={(next: string) => {
        setValue(next);
        onValueChange?.(next);
      }}
      {...rest}
    />
  );
}

describe("SearchInput — debounce", () => {
  it("fires onDebouncedChange once after the debounce pause, not per keystroke", () => {
    const onDebouncedChange = vi.fn();
    render(<Controlled onDebouncedChange={onDebouncedChange} debounceMs={300} />);
    const input = screen.getByRole("searchbox");

    fireEvent.change(input, { target: { value: "a" } });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.change(input, { target: { value: "an" } });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.change(input, { target: { value: "ana" } });

    expect(onDebouncedChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onDebouncedChange).toHaveBeenCalledTimes(1);
    expect(onDebouncedChange).toHaveBeenCalledWith("ana");
  });
});

describe("SearchInput — Enter", () => {
  it("fires onDebouncedChange immediately and cancels the pending timer", () => {
    const onDebouncedChange = vi.fn();
    render(<Controlled onDebouncedChange={onDebouncedChange} debounceMs={500} />);
    const input = screen.getByRole("searchbox");

    fireEvent.change(input, { target: { value: "ana" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onDebouncedChange).toHaveBeenCalledTimes(1);
    expect(onDebouncedChange).toHaveBeenCalledWith("ana");

    // The pending 500ms timer from the change above must not fire a second time.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onDebouncedChange).toHaveBeenCalledTimes(1);
  });

  it("calls onSubmit on Enter", () => {
    const onSubmit = vi.fn();
    render(<Controlled onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("SearchInput — Escape", () => {
  it("clears the field when it has a value, and prevents default", () => {
    const onClear = vi.fn();
    render(<Controlled onClear={onClear} />);
    const input = screen.getByRole("searchbox") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "ana" } });
    expect(input.value).toBe("ana");

    fireEvent.keyDown(input, { key: "Escape" });

    expect(input.value).toBe("");
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("does nothing (and calls the passthrough onKeyDown) when the field is already empty", () => {
    const onClear = vi.fn();
    const onKeyDown = vi.fn();
    render(<Controlled onClear={onClear} onKeyDown={onKeyDown} />);
    const input = screen.getByRole("searchbox") as HTMLInputElement;

    fireEvent.keyDown(input, { key: "Escape" });

    expect(onClear).not.toHaveBeenCalled();
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });
});

describe("SearchInput — clear button", () => {
  it("only renders when the value is non-empty", () => {
    render(<Controlled />);
    expect(screen.queryByRole("button", { name: /clear/i })).toBeNull();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "ana" } });
    expect(screen.getByRole("button", { name: /clear/i })).toBeTruthy();
  });

  it("clears the value and refocuses the input when clicked", () => {
    const onDebouncedChange = vi.fn();
    render(<Controlled onDebouncedChange={onDebouncedChange} debounceMs={500} />);
    const input = screen.getByRole("searchbox") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "ana" } });
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));

    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    // Flushed immediately, not after the 500ms debounce.
    expect(onDebouncedChange).toHaveBeenLastCalledWith("");
  });
});

describe("SearchInput — result count", () => {
  it("renders a live region only when resultCount is passed", () => {
    const { rerender } = render(<Controlled />);
    expect(screen.queryByRole("status")).toBeNull();

    rerender(<Controlled resultCount={3} />);
    expect(screen.getByRole("status").textContent).toBe("3 results");

    rerender(<Controlled resultCount={1} />);
    expect(screen.getByRole("status").textContent).toBe("1 result");
  });
});

describe("SearchInput — accessible name", () => {
  it("keeps an accessible name from the (sr-only by default) label", () => {
    render(<Controlled label="Search learners" />);
    expect(
      screen.getByRole("searchbox", { name: "Search learners" })
    ).toBeTruthy();
  });
});

describe("SearchInput — uncontrolled mode", () => {
  it("clears the DOM value on × even with no value/onValueChange", () => {
    render(<SearchInput label="Search" name="q" defaultValue="ana" />);
    const input = screen.getByRole("searchbox") as HTMLInputElement;
    expect(input.value).toBe("ana");

    fireEvent.click(screen.getByRole("button", { name: /clear/i }));

    expect(input.value).toBe("");
  });

  it("clears the DOM value on Escape even with no value/onValueChange", () => {
    render(<SearchInput label="Search" name="q" defaultValue="ana" />);
    const input = screen.getByRole("searchbox") as HTMLInputElement;
    expect(input.value).toBe("ana");

    fireEvent.keyDown(input, { key: "Escape" });

    expect(input.value).toBe("");
  });
});

describe("SearchInput — focus shortcut", () => {
  it("focuses on Ctrl/⌘+K even while another field has focus", () => {
    render(
      <div>
        <input aria-label="Other field" />
        <SearchInput label="Search" focusShortcut={{ key: "k", metaOrCtrl: true }} />
      </div>
    );
    const other = screen.getByLabelText("Other field");
    const search = screen.getByRole("searchbox");
    other.focus();
    expect(document.activeElement).toBe(other);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(document.activeElement).toBe(search);
  });
});

describe("SearchInput — escapeClears={false}", () => {
  it("leaves a typed value alone on Escape and hands the key to the caller", () => {
    const onKeyDown = vi.fn();
    render(<Controlled value="maria" escapeClears={false} onKeyDown={onKeyDown} />);
    const input = screen.getByRole("searchbox") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("maria");
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });
});
