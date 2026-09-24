import { describe, expect, it } from "vitest";
import { subjectKey, subjectLabel } from "@/lib/summary/shape/subject-key";

describe("subjectKey (T16)", () => {
  it("keys a seeded subject by its learning area, however it was renamed", () => {
    expect(subjectKey({ legacyArea: "ENGLISH", name: "English 4", legacySubject: null })).toBe("area:ENGLISH");
    expect(subjectKey({ legacyArea: "ENGLISH", name: "Ingles", legacySubject: null })).toBe("area:ENGLISH");
  });

  it("keys a school-made subject by its folded name", () => {
    expect(subjectKey({ legacyArea: null, name: "  Reading   Literacy ", legacySubject: null })).toBe(
      "name:reading literacy"
    );
    expect(subjectKey({ legacyArea: null, name: "READING LITERACY", legacySubject: null })).toBe(
      "name:reading literacy"
    );
  });

  it("never merges a subject named like an area into that area", () => {
    expect(subjectKey({ legacyArea: null, name: "English", legacySubject: null })).toBe("name:english");
  });

  it("falls back to the legacy TermGrade subject", () => {
    expect(subjectKey({ legacyArea: null, name: null, legacySubject: "SCIENCE" })).toBe("area:SCIENCE");
    expect(subjectKey({ legacyArea: null, name: null, legacySubject: null })).toBeNull();
  });
});

describe("subjectLabel", () => {
  it("uses the learning-area label for an area key", () => {
    expect(subjectLabel("area:ARALING_PANLIPUNAN", new Map())).toBe("Araling Panlipunan");
  });

  it("uses the most common spelling for a name key", () => {
    const spellings = new Map([
      ["Reading literacy", 3],
      ["Reading Literacy", 9],
    ]);
    expect(subjectLabel("name:reading literacy", spellings)).toBe("Reading Literacy");
  });
});
