import { describe, it, expect } from "vitest";
import { filterOptions, MAX_VISIBLE_OPTIONS, type SearchableOption } from "@/components/ui/searchable-select";

const opt = (label: string): SearchableOption => ({ value: label, label });

describe("filterOptions", () => {
  it("returns everything for an empty query", () => {
    const all = [opt("Alabel Central ES"), opt("Glan ES")];
    expect(filterOptions(all, "")).toHaveLength(2);
    expect(filterOptions(all, "   ")).toHaveLength(2);
  });

  it("is case-insensitive", () => {
    expect(filterOptions([opt("Alabel Central ES")], "ALABEL")).toHaveLength(1);
  });

  it("is diacritic-insensitive in both directions", () => {
    expect(filterOptions([opt("Peñaranda ES")], "penaranda")).toHaveLength(1);
    expect(filterOptions([opt("Penaranda ES")], "peñaranda")).toHaveLength(1);
  });

  it("matches every token regardless of word order", () => {
    const all = [opt("Alabel Central Elementary School")];
    expect(filterOptions(all, "central alabel")).toHaveLength(1);
    expect(filterOptions(all, "alabel central")).toHaveLength(1);
  });

  it("requires all tokens to match, not any", () => {
    expect(filterOptions([opt("Alabel Central ES")], "alabel glan")).toHaveLength(0);
  });

  it("also searches the hint, so a district narrows the list", () => {
    const all = [{ value: "1", label: "Del Hilado ES", hint: "Malapatan 2" }];
    expect(filterOptions(all, "malapatan")).toHaveLength(1);
  });

  it("caps results at MAX_VISIBLE_OPTIONS", () => {
    const many = Array.from({ length: 350 }, (_, i) => opt(`School ${i}`));
    expect(filterOptions(many, "school")).toHaveLength(MAX_VISIBLE_OPTIONS);
  });

  it("preserves input order", () => {
    // NOTE: brief specified "Banlibato IS" here, which contains no "e" and so
    // cannot match query "es" under any correct substring implementation.
    // Using "Banlibato ES" instead, consistent with the ES-suffix pattern used
    // by the other fixtures in this file, to keep the assertion's intent (order
    // preservation across two genuine matches) meaningful.
    const all = [opt("Banlibato ES"), opt("Alabel Central ES")];
    expect(filterOptions(all, "es").map((o) => o.label)).toEqual(["Banlibato ES", "Alabel Central ES"]);
  });
});
