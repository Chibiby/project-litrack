"use client";

import { useMemo, useState, useTransition } from "react";
import { Mail, Plus, X } from "lucide-react";
import { sendAdminEmail } from "@/lib/actions/admin-email";
import type { AdminEmailRecipientOption } from "@/lib/admin-email/queries";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function AdminEmailComposer({ recipients, configured }: { recipients: AdminEmailRecipientOption[]; configured: boolean }) {
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return recipients.filter((person) =>
      [person.name, person.email, person.role, person.schoolName].some((value) => value.toLowerCase().includes(needle))
    ).slice(0, 8);
  }, [query, recipients]);

  function add(email: string, label = email) {
    const normalized = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalized) || isSyntheticEmail(normalized)) {
      setNotice("Enter a valid, real email address.");
      return;
    }
    setSelected((current) => new Map(current).set(normalized, label));
    setManual("");
    setQuery("");
    setNotice(null);
  }

  function submit() {
    setNotice(null);
    startTransition(async () => {
      const result = await sendAdminEmail({ recipients: [...selected.keys()], subject, body });
      if (!result.ok) {
        setNotice(result.error);
        return;
      }
      if (!result.data) {
        setNotice("Email delivery did not return a result.");
        return;
      }
      const failed = result.data.failed.length;
      setNotice(failed ? `Sent ${result.data.sent}; ${failed} delivery${failed === 1 ? "" : "ies"} failed.` : `Sent ${result.data.sent} private emails.`);
      if (!failed) {
        setSelected(new Map());
        setSubject("");
        setBody("");
      }
    });
  }

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex size-10 items-center justify-center rounded-lg bg-violet-soft text-violet"><Mail className="size-5" /></span>
        <div><h2 className="font-semibold">Send email</h2><p className="text-sm text-muted-foreground">Each recipient receives a separate private copy.</p></div>
      </div>
      {!configured && <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Outbound email is not configured. Add the Resend API key and support sender in deployment settings.</p>}
      <div className="space-y-4">
        <div className="relative">
          <label htmlFor="email-recipient-search" className="mb-1.5 block text-sm font-medium">Recipients</label>
          <Input id="email-recipient-search" aria-label="Search teachers and school heads" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search teachers and school heads" />
          {matches.length > 0 && <div className="absolute z-10 mt-1 w-full rounded-lg border bg-background p-1 shadow-lg">{matches.map((person) => <Button key={person.id} type="button" variant="ghost" className="h-auto w-full justify-start py-2 text-left" onClick={() => add(person.email, person.name)}>{person.name} · {person.role} · {person.schoolName}</Button>)}</div>}
          <div className="mt-2 flex flex-wrap gap-2">{[...selected].map(([email, label]) => <span key={email} className="inline-flex items-center gap-1 rounded-full bg-violet-soft py-1 pl-3 pr-1 text-xs text-violet-soft-foreground">{label}<Button type="button" variant="ghost" size="icon" className="size-5 rounded-full" aria-label={`Remove ${email}`} onClick={() => setSelected((current) => { const next = new Map(current); next.delete(email); return next; })}><X className="size-3" /></Button></span>)}</div>
        </div>
        <div><label htmlFor="manual-email" className="mb-1.5 block text-sm font-medium">Add another recipient</label><div className="flex gap-2"><Input id="manual-email" aria-label="New email address" value={manual} onChange={(event) => setManual(event.target.value)} placeholder="name@example.com" /><Button type="button" variant="outline" onClick={() => add(manual)}><Plus className="size-4" />Add address</Button></div></div>
        <div><label htmlFor="email-subject" className="mb-1.5 block text-sm font-medium">Subject</label><Input id="email-subject" value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={160} /></div>
        <div><label htmlFor="email-body" className="mb-1.5 block text-sm font-medium">Message</label><Textarea id="email-body" value={body} onChange={(event) => setBody(event.target.value)} maxLength={10_000} className="min-h-48" /></div>
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{selected.size} private {selected.size === 1 ? "email" : "emails"}</p><Button type="button" onClick={submit} disabled={!configured || pending || selected.size === 0 || !subject.trim() || !body.trim()}>{pending ? "Sending…" : "Send email"}</Button></div>
        {notice && <p role="status" className="text-sm">{notice}</p>}
      </div>
    </div>
  );
}
