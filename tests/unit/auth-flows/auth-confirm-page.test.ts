import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

/**
 * `/auth/confirm` — the landing pad a password recovery email points at.
 *
 * It must be a plain page render, never a token consumer or checker: mail
 * scanners and "safe link" prefetchers follow the emailed link with a bare GET
 * before the person ever clicks it, and a scanner's visit must not burn (or
 * even probe) the one-time token. The page therefore decides what to show from
 * the query params alone and never touches the reset-token store.
 *
 * The element tree is walked rather than rendered because this is a plain unit
 * test, not a DOM test. Replaces the Supabase-era test in tests/unit/auth/
 * (deleted by T14): the same properties, with `consumeResetToken` /
 * `peekResetToken` now being the things that must stay uncalled.
 */

const consumeResetToken = vi.fn();
const peekResetToken = vi.fn();
const issueResetToken = vi.fn();
vi.mock("@/lib/auth/password-reset", () => ({
  consumeResetToken: (...args: unknown[]) => consumeResetToken(...args),
  peekResetToken: (...args: unknown[]) => peekResetToken(...args),
  issueResetToken: (...args: unknown[]) => issueResetToken(...args),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {}, prismaFresh: {} }));

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

function expectTokenStoreUntouched() {
  expect(consumeResetToken).not.toHaveBeenCalled();
  expect(peekResetToken).not.toHaveBeenCalled();
  expect(issueResetToken).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AuthConfirmPage", () => {
  it("never consumes or even looks up the token — this page's whole point is a safe GET", async () => {
    await AuthConfirmPage({
      searchParams: Promise.resolve({ token_hash: "abc123", type: "recovery" }),
    });

    expectTokenStoreUntouched();
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

  it("does not submit the form by itself: no script on the page", async () => {
    const tree = await AuthConfirmPage({
      searchParams: Promise.resolve({ token_hash: "abc123", type: "recovery" }),
    });
    expect(collect(tree, (el) => el.type === "script")).toHaveLength(0);
    expect(collect(tree, (el) => el.type === "meta")).toHaveLength(0);
  });

  it("shows the invalid-link message and no form when type is not recovery", async () => {
    const tree = await AuthConfirmPage({
      searchParams: Promise.resolve({ token_hash: "abc123", type: "magiclink" }),
    });

    expectTokenStoreUntouched();
    expect(collect(tree, (el) => el.type === "form")).toHaveLength(0);
    expect(collect(tree, (el) => el.type === ConfirmForm)).toHaveLength(0);
    const [message] = collect(tree, (el) => el.type === "p" && /invalid or has expired/i.test(textOf(el)));
    expect(message).toBeTruthy();
  });

  it("shows the invalid-link message and no form when token_hash is missing", async () => {
    const tree = await AuthConfirmPage({
      searchParams: Promise.resolve({ type: "recovery" }),
    });

    expectTokenStoreUntouched();
    expect(collect(tree, (el) => el.type === "form")).toHaveLength(0);
    expect(collect(tree, (el) => el.type === ConfirmForm)).toHaveLength(0);
    const [message] = collect(tree, (el) => el.type === "p" && /invalid or has expired/i.test(textOf(el)));
    expect(message).toBeTruthy();
  });

  it("shows the invalid-link message when type is missing", async () => {
    const tree = await AuthConfirmPage({
      searchParams: Promise.resolve({ token_hash: "abc123" }),
    });

    expect(collect(tree, (el) => el.type === ConfirmForm)).toHaveLength(0);
    expect(collect(tree, (el) => el.type === "p" && /invalid or has expired/i.test(textOf(el)))).toHaveLength(1);
  });

  it("offers a way to request a new link when the link is unusable", async () => {
    const tree = await AuthConfirmPage({ searchParams: Promise.resolve({}) });
    const hrefs = collect(tree, (el) => (el.props as { href?: string })?.href === "/forgot-password");
    expect(hrefs.length).toBeGreaterThan(0);
  });

  it("escapes a hostile token_hash when the form is rendered, so the URL cannot inject markup", async () => {
    const hostile = '"><script>alert(1)</script>';
    const tree = await AuthConfirmPage({
      searchParams: Promise.resolve({ token_hash: hostile, type: "recovery" }),
    });
    const [formEl] = collect(tree, (el) => el.type === ConfirmForm);
    const html = renderToStaticMarkup(formEl);
    expect(html).not.toContain("<script>");
  });
});
