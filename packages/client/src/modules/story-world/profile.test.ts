import { describe, expect, it } from "vitest";
import { normalizeProfile, normalizeProfileFields } from "./profile";

describe("story-world profile normalization", () => {
  it("projects fixed and custom legacy values once with stable identities", () => {
    const legacy = {
      alter: "31",
      rolle: "Kartographin",
      extra: [{ k: "Motiv", v: "Heimkehr", source: "import" }],
    };

    expect(normalizeProfileFields(legacy, "mara")).toEqual([
      { id: "profile-field:mara:legacy:alter", key: "Alter", value: "31" },
      {
        id: "profile-field:mara:legacy:rolle",
        key: "Rolle in der Geschichte",
        value: "Kartographin",
      },
      {
        id: "profile-field:mara:extra:0",
        key: "Motiv",
        value: "Heimkehr",
        source: "import",
      },
    ]);
  });

  it("treats an intentionally empty canonical collection as authoritative", () => {
    expect(
      normalizeProfile(
        {
          alter: "darf nicht wiederkehren",
          extra: [{ k: "Auch nicht", v: "gelöscht" }],
          fields: [],
        },
        "mara",
      ),
    ).toEqual({ fields: [] });
  });

  it("clones canonical fields while preserving profile and field extensions", () => {
    const profile = {
      notizen: "Text",
      futureProfile: { kept: true },
      fields: [
        {
          id: "motive",
          key: "Motiv",
          value: "Wahrheit",
          futureField: { kept: true },
        },
      ],
    };
    const normalized = normalizeProfile(profile, "mara");

    expect(normalized).toEqual(profile);
    expect(normalized.fields).not.toBe(profile.fields);
    expect(normalized.fields?.[0]).not.toBe(profile.fields[0]);
  });
});
