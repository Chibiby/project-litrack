import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

/**
 * `/auth/confirm` — the landing pad a password recovery email points at.
 *
 * It must be a plain page render, never a token consumer: mail scanners and
 * "safe link" prefetchers follow the emailed link with a bare GET before the
 * person ever clicks it, and the old shape of this route called
 * `supabase.auth.verifyOtp` straight from GET — so a scanner's visit burned
 * the one-time token and the actual recipient saw "invalid or has expired"
 * on a link nobody had used yet.
 *
 * This page only decides what to show from the query params; it never
 * imports anything that could verify them. The element tree is walked
 * rather than rendered (mirrors `schools-page-sort-wiring.test.ts`) because
 * this is a plain unit test, not a DOM test.
 */

const verifyOtp = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { verifyOtp } }),
}));

const { default: AuthConfirmPage } = await import("@/app/auth/confirm/page");

function collect(
  node: ReactNode,
  predicate: (el: ReactElement) => boolean,
  out: ReactElement[] = []
): ReactElement[] {
  if (node === null || node === undefined || typeof node === "boolean") return out;
  if (Array.isArray(node)) {
    for (const child of node) collect(child, predicate, out);
    return out;
  }
  if (typeof node === "object" && "type" in (node as object)) {
    const el = node as ReactElement;
    if (predicate(el)) out.push(el);
    const children = (el.props as { children?: ReactNode } | undefined)?.children;
    if (children !== undefined) collect(children, predicate, out);
  }
  return out;
}

function textOf(el: ReactElement): string {
  const children = (el.props as { children?: ReactNode }).children;
  return typeof children === "string" ? children : "";
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AuthConfirmPage", () => {
  it("never calls verifyOtp — this page's whole point is not consuming the token", async () => {
    await AuthConfirmPage({
      searchParams: Promise.resolve({ token_hash: "abc123", type: "recovery" }),
    });

    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("renders a form posting to /auth/confirm/verify carrying the token_hash and type", async () => {
    const tree = await AuthConfirmPage({
      searchParams: Promise.resolve({ token_hash: "abc123", type: "recovery" }),
    });

    const [form] = collect(tree, (el) => el.type === "form");
    expect(form).toBeTruthy();
    const formProps = form.props as { method?: string; action?: string };
    expect(formProps.method).toBe("POST");
    expect(formProps.action).toBe("/auth/confirm/verify");

    const inputs = collect(tree, (el) => el.type === "input");
    const inputProps = (el: ReactElement) => el.props as { name?: string; value?: string };
    const tokenInput = inputs.find((el) => inputProps(el).name === "token_hash");
    const typeInput = inputs.find((el) => inputProps(el).name === "type");
    expect(tokenInput && inputProps(tokenInput).value).toBe("abc123");
    expect(typeInput && inputProps(typeInput).value).toBe("recovery");

    const [button] = collect(tree, (el) => el.type === "button" || (el.props as { type?: string })?.type === "submit");
    expect(button).toBeTruthy();
  });

  it("shows the invalid-link message and no form when type is not recovery, without calling verifyOtp", async () => {
    const tree = await AuthConfirmPage({
      searchParams: Promise.resolve({ token_hash: "abc123", type: "magiclink" }),
    });

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(collect(tree, (el) => el.type === "form")).toHaveLength(0);
    const [message] = collect(tree, (el) => el.type === "p" && /invalid or has expired/i.test(textOf(el)));
    expect(message).toBeTruthy();
  });

  it("shows the invalid-link message and no form when token_hash is missing, without calling verifyOtp", async () => {
    const tree = await AuthConfirmPage({
      searchParams: Promise.resolve({ type: "recovery" }),
    });

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(collect(tree, (el) => el.type === "form")).toHaveLength(0);
    const [message] = collect(tree, (el) => el.type === "p" && /invalid or has expired/i.test(textOf(el)));
    expect(message).toBeTruthy();
  });
});
