import { describe, expect, it } from "vitest";
import publicIndex from "../../index.ts?raw";
import { designAuditProfiles } from "./auditProfiles";
import { designStories } from "./registry";

describe("design audit profiles", () => {
  it("requires an explicit audit profile for every public design folder", () => {
    const publicComponents = [
      ...publicIndex.matchAll(
        /export \* from "\.\/(?:components|patterns|primitives)\/([^"/]+)";/g,
      ),
    ]
      .map((match) => match[1])
      .sort();

    expect(Object.keys(designAuditProfiles).sort()).toEqual(publicComponents);
  });

  it("maps every gallery scenario to at least one reviewed capability", () => {
    const registered = new Set(designStories.map((story) => story.id));
    const audited = new Set<string>();

    for (const [component, profile] of Object.entries(designAuditProfiles)) {
      expect(
        Object.keys(profile.coverage).length,
        `${component} has no capabilities`,
      ).toBeGreaterThan(0);
      for (const [capability, names] of Object.entries(profile.coverage)) {
        expect(names.length, `${component}.${capability} is empty`).toBeGreaterThan(0);
        for (const name of names) {
          const id = `${component}/${name}`;
          expect(registered.has(id), `${component}.${capability} references missing ${id}`).toBe(
            true,
          );
          audited.add(id);
        }
      }
    }

    expect([...audited].sort()).toEqual([...registered].sort());
  });

  it("keeps every P0 component under responsive, keyboard, overlay, or content pressure", () => {
    for (const [component, profile] of Object.entries(designAuditProfiles)) {
      if (profile.priority !== "P0") continue;
      const pressureCapabilities = [
        "longContent",
        "touch",
        "responsive",
        "keyboard",
        "overlay",
        "scrolling",
      ];
      expect(
        pressureCapabilities.some((capability) => capability in profile.coverage),
        `${component} lacks a pressure scenario`,
      ).toBe(true);
    }
  });
});
