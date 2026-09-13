import { describe, expect, it } from "vitest";
import { adminEmailSchema } from "@/lib/validators/admin-email.schema";

const valid = { recipients: ["Teacher@Example.com"], subject: "  Hello  ", body: "  Message  " };

describe("adminEmailSchema", () => {
  it("normalizes and deduplicates recipient addresses privately", () => {
    const result = adminEmailSchema.parse({
      ...valid,
      recipients: [" Teacher@Example.com ", "teacher@example.com", "head@example.com"],
    });
    expect(result).toEqual({
      recipients: ["teacher@example.com", "head@example.com"],
      subject: "Hello",
      body: "Message",
    });
  });

  it.each(["teacher@school.local", "admin@litrack.local", "sh@100.litrack.local"])(
    "rejects synthetic recipient %s",
    (email) => expect(adminEmailSchema.safeParse({ ...valid, recipients: [email] }).success).toBe(false)
  );

  it("rejects more than 50 unique recipients", () => {
    const recipients = Array.from({ length: 51 }, (_, index) => `person${index}@example.com`);
    expect(adminEmailSchema.safeParse({ ...valid, recipients }).success).toBe(false);
  });

  it("accepts the subject, body, and recipient upper boundaries", () => {
    const recipients = Array.from({ length: 50 }, (_, index) => `person${index}@example.com`);
    expect(adminEmailSchema.safeParse({ recipients, subject: "s".repeat(160), body: "b".repeat(10_000) }).success).toBe(true);
  });

  it.each([
    { recipients: ["not-an-email"], subject: "Hello", body: "Message" },
    { recipients: ["a@example.com"], subject: " ", body: "Message" },
    { recipients: ["a@example.com"], subject: "Hello", body: " " },
    { recipients: ["a@example.com"], subject: "s".repeat(161), body: "Message" },
    { recipients: ["a@example.com"], subject: "Hello", body: "b".repeat(10_001) },
  ])("rejects malformed composer input", (input) => {
    expect(adminEmailSchema.safeParse(input).success).toBe(false);
  });
});
