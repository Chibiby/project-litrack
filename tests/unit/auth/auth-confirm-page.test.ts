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
const { ConfirmForm } = await import("@/app/auth/confirm/confirm-form");
const { renderToStaticMarkup } = await import("react-dom/server");

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

    // The form is a small client component (it locks the button on submit),
    // so the page hands it the params and the form is rendered separately.
    const [formEl] = collect(tree, (el) => el.type === ConfirmForm);
    expect(formEl).toBeTruthy();
    expect(formEl.props).toEqual({ tokenHash: "abc123", type: "recovery" });

    const html = renderToStaticMarkup(formEl);
    const formTag = html.match(/<form[^>]*>/)?.[0] ?? "";
    expect(formTag).toContain('method="POST"');
    expect(formTag).toContain('action="/auth/confirm/verify"');
    expect(html).toContain('name="token_hash" value="abc123"');
    expect(html).toContain('name="type" value="recovery"');
    expect(html).toMatch(/<button[^>]*type="submit"/);
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
