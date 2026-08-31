import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CARD_KINDS, GRAPH_EDGE_COLORS } from "../../modules/graph";

type Theme = "light" | "dark";

function stylesheet(path: string) {
  return readFileSync(join(process.cwd(), "packages/client/src/design", path), "utf8");
}

const colors = stylesheet("colors.css");

function declarations(block: string) {
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]),
  );
}

function themeBlock(theme: Theme) {
  const selector =
    theme === "light"
      ? /:root\s*,\s*:root\[data-theme="light"\]\s*\{([^}]*)\}/
      : /:root\[data-theme="dark"\]\s*\{([^}]*)\}/;
  const block = colors.match(selector)?.[1];
  if (!block) throw new Error(`${theme} theme color tokens are missing`);
  return block;
}

const sharedTokens = Object.assign(
  {},
  ...[...colors.matchAll(/(?:^|\n):root\s*\{([^}]*)\}/g)].map((match) => declarations(match[1])),
);

const tokensByTheme = Object.fromEntries(
  (["light", "dark"] as const).map((theme) => [theme, declarations(themeBlock(theme))]),
) as Record<Theme, Record<string, string>>;

function resolvedValue(theme: Theme, name: string, stack: string[] = []): string {
  if (stack.includes(name)) {
    throw new Error(`${theme} theme color token cycle: ${[...stack, name].join(" -> ")}`);
  }

  const value = tokensByTheme[theme][name] ?? sharedTokens[name];
  if (!value) throw new Error(`${theme} theme token ${name} is missing`);

  const alias = value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  return alias ? resolvedValue(theme, alias[1], [...stack, name]) : value;
}

function token(theme: Theme, name: string) {
  const value = resolvedValue(theme, name);
  if (!/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`${theme} theme token ${name} does not resolve to a hex color: ${value}`);
  }
  return value;
}

function translucentToken(theme: Theme, name: string) {
  const match = resolvedValue(theme, name).match(/^rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\)$/);
  if (!match) {
    throw new Error(`${theme} theme token ${name} is missing or is not an RGB alpha color`);
  }
  return {
    channels: match.slice(1, 4).map(Number),
    alpha: Number(match[4]),
  };
}

function colorChannels(color: string) {
  return [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
}

function channelsToHex(channels: number[]) {
  return `#${channels
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

function compositeOver(theme: Theme, tokenName: string, background: string) {
  const { channels, alpha } = translucentToken(theme, tokenName);
  const backgroundChannels = colorChannels(background);
  return channelsToHex(
    channels.map((channel, index) => channel * alpha + backgroundChannels[index] * (1 - alpha)),
  );
}

function mixColors(first: string, firstShare: number, second: string) {
  const firstChannels = colorChannels(first);
  const secondChannels = colorChannels(second);
  return channelsToHex(
    firstChannels.map(
      (channel, index) => channel * firstShare + secondChannels[index] * (1 - firstShare),
    ),
  );
}

function relativeLuminance(color: string) {
  const channels = colorChannels(color).map((channel) => channel / 255);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

function oklab(color: string) {
  const [red, green, blue] = colorChannels(color)
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  const long = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const medium = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const short = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);

  return [
    0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short,
    1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short,
    0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short,
  ];
}

function deltaEOk(first: string, second: string) {
  const firstLab = oklab(first);
  const secondLab = oklab(second);
  return Math.hypot(...firstLab.map((channel, index) => channel - secondLab[index])) * 100;
}

function oklchHue(color: string) {
  const [, a, b] = oklab(color);
  return (Math.atan2(b, a) * 180) / Math.PI + (Math.atan2(b, a) < 0 ? 360 : 0);
}

function hueDistance(first: string, second: string) {
  const distance = Math.abs(oklchHue(first) - oklchHue(second));
  return Math.min(distance, 360 - distance);
}

function materialBackgrounds(theme: Theme) {
  const surfaces = Object.fromEntries([
    ["canvas", token(theme, "--surface-canvas")],
    ["chrome", token(theme, "--surface-chrome")],
    ["panel", token(theme, "--surface-panel")],
    ["paper", token(theme, "--surface-paper")],
    ["raised", token(theme, "--surface-raised")],
  ]);
  const materials = ["--material-toolbar", "--material-popover", "--material-sheet"];
  const interactions = [
    "--control-hint",
    "--control-hover-subtle",
    "--active-surface",
    "--control-hover",
  ];
  const backgrounds: Record<string, string> = {};

  for (const [surfaceName, surface] of Object.entries(surfaces)) {
    backgrounds[surfaceName] = surface;

    const effectiveMaterials = Object.fromEntries(
      materials.map((material) => [
        `${surfaceName}:${material.slice(2)}`,
        compositeOver(theme, material, surface),
      ]),
    );

    for (const [materialName, material] of [
      [surfaceName, surface],
      ...Object.entries(effectiveMaterials),
    ]) {
      backgrounds[materialName] = material;
      for (const interaction of interactions) {
        backgrounds[`${materialName}:${interaction.slice(2)}`] = compositeOver(
          theme,
          interaction,
          material,
        );
      }
    }
  }
  return backgrounds;
}

function expectSmallTextContrast(
  theme: Theme,
  foregroundName: string,
  backgrounds: Record<string, string>,
) {
  const foreground = token(theme, foregroundName);
  for (const [surface, background] of Object.entries(backgrounds)) {
    expect(
      contrastRatio(foreground, background),
      `${theme} ${surface}: ${foregroundName} ${foreground} on ${background}`,
    ).toBeGreaterThanOrEqual(4.5);
  }
}

function expectNonTextContrast(
  theme: Theme,
  foregroundName: string,
  backgrounds: Record<string, string>,
) {
  const foreground = token(theme, foregroundName);
  for (const [surface, background] of Object.entries(backgrounds)) {
    expect(
      contrastRatio(foreground, background),
      `${theme} ${surface}: ${foregroundName} ${foreground} on ${background}`,
    ).toBeGreaterThanOrEqual(3);
  }
}

describe.each(["light", "dark"] as const)("%s-theme text contrast", (theme) => {
  it("keeps all normal-size foundation text at WCAG AA across materials and states", () => {
    const backgrounds = materialBackgrounds(theme);
    expectSmallTextContrast(theme, "--text-primary", backgrounds);
    expectSmallTextContrast(theme, "--text-secondary", backgrounds);
    expectSmallTextContrast(theme, "--text-muted", backgrounds);
    expectSmallTextContrast(theme, "--attribution", backgrounds);
  });

  it("keeps moss success text and icons at WCAG AA across surfaces and interaction states", () => {
    expectSmallTextContrast(theme, "--moss-text", materialBackgrounds(theme));
  });

  it("keeps semantic accent text at WCAG AA across material backgrounds", () => {
    const backgrounds = materialBackgrounds(theme);
    expectSmallTextContrast(theme, "--gold-text", backgrounds);
    expectSmallTextContrast(theme, "--rose-text", backgrounds);
    expectSmallTextContrast(theme, "--moss-text", backgrounds);
    expectSmallTextContrast(theme, "--focus-text", backgrounds);
    expectSmallTextContrast(theme, "--accent-primary-text", backgrounds);
    expectSmallTextContrast(theme, "--success-text", backgrounds);
    expectSmallTextContrast(theme, "--info-text", backgrounds);
    expectSmallTextContrast(theme, "--warning-text", backgrounds);
    expectSmallTextContrast(theme, "--error-text", backgrounds);
    expectSmallTextContrast(theme, "--link", backgrounds);
    expectSmallTextContrast(theme, "--link-hover", backgrounds);
    expectSmallTextContrast(theme, "--link-visited", backgrounds);
    expectSmallTextContrast(theme, "--rose-text", {
      roseSoft: token(theme, "--rose-soft"),
    });
    expectSmallTextContrast(theme, "--moss-text", {
      mossSoft: token(theme, "--moss-soft"),
    });
    expectSmallTextContrast(theme, "--focus-text", {
      focusSoft: token(theme, "--focus-soft"),
    });
    expectSmallTextContrast(theme, "--error-text", {
      ...backgrounds,
      error: token(theme, "--error-bg"),
    });
    expectSmallTextContrast(theme, "--warning-text", {
      warning: token(theme, "--warning-bg"),
    });
  });

  it("keeps state borders and graphical accents at WCAG non-text contrast", () => {
    const materials = materialBackgrounds(theme);
    expectNonTextContrast(theme, "--gold-border", {
      ...materials,
      goldSoft: token(theme, "--gold-soft"),
      ...Object.fromEntries(
        ["canvas", "chrome", "panel", "paper", "raised"].map((surface) => [
          `${surface}:selection`,
          compositeOver(theme, "--selection-surface", token(theme, `--surface-${surface}`)),
        ]),
      ),
    });
    expectNonTextContrast(theme, "--gold", materials);
    expectNonTextContrast(theme, "--error-border", {
      ...materials,
      error: token(theme, "--error-bg"),
    });
    expectNonTextContrast(theme, "--rose-border", {
      ...materials,
      roseSoft: token(theme, "--rose-soft"),
    });
    expectNonTextContrast(theme, "--moss-border", {
      ...materials,
      mossSoft: token(theme, "--moss-soft"),
    });
    expectNonTextContrast(theme, "--focus", materials);
    expectNonTextContrast(theme, "--focus-border", {
      ...materials,
      focusSoft: token(theme, "--focus-soft"),
    });
    expectNonTextContrast(theme, "--rose", {
      graphCanvas: token(theme, "--canvas"),
    });
    expectNonTextContrast(theme, "--moss", {
      graphCanvas: token(theme, "--canvas"),
    });
    expectNonTextContrast(theme, "--warning-border", {
      ...materials,
      warning: token(theme, "--warning-bg"),
    });
    expectNonTextContrast(theme, "--warning-icon", {
      ...materials,
      warning: token(theme, "--warning-bg"),
    });
    expectNonTextContrast(theme, "--error-icon", {
      error: token(theme, "--error-bg"),
    });
    expectNonTextContrast(theme, "--success-icon", {
      success: token(theme, "--success-bg"),
    });
    expectNonTextContrast(theme, "--info-icon", {
      info: token(theme, "--info-bg"),
    });
    expectNonTextContrast(theme, "--control-border", materials);
    expectNonTextContrast(theme, "--drop-target-border", {
      dropTarget: token(theme, "--drop-target-surface"),
    });
  });

  it("keeps destructive text and icons at WCAG AA without using the fill color", () => {
    expectSmallTextContrast(theme, "--danger", {
      ...materialBackgrounds(theme),
      dangerHover: token(theme, "--error-bg"),
    });
  });

  it("keeps danger-on at WCAG AA on primary danger fills and their hover state", () => {
    const dangerOn = token(theme, "--danger-on");
    const dangerFill = token(theme, "--danger-fill");
    const dangerFillHover = mixColors(dangerFill, 0.88, token(theme, "--ink"));

    expect(contrastRatio(dangerOn, dangerFill), `${theme} danger fill`).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(dangerOn, dangerFillHover),
      `${theme} danger fill hover`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps inverse text at WCAG AA on primary accent fills", () => {
    expect(
      contrastRatio(token(theme, "--accent-on"), token(theme, "--accent-fill")),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps ink, soft and muted text in a legible visual hierarchy", () => {
    const hierarchy = ["--ink", "--soft", "--muted"].map((name) =>
      relativeLuminance(token(theme, name)),
    );
    if (theme === "dark") {
      expect(hierarchy[0]).toBeGreaterThan(hierarchy[1]);
      expect(hierarchy[1]).toBeGreaterThan(hierarchy[2]);
    } else {
      expect(hierarchy[0]).toBeLessThan(hierarchy[1]);
      expect(hierarchy[1]).toBeLessThan(hierarchy[2]);
    }
  });
});

describe("five-family semantic palette", () => {
  it.each(["light", "dark"] as const)(
    "keeps the %s warning family perceptually distinct from brand gold",
    (theme) => {
      const warningAndBrandRoles = [
        ["--warning-icon", "--accent-primary", 10],
        ["--warning-bg", "--accent-primary-soft", 8],
        ["--warning-text", "--accent-primary-text", 10],
        ["--warning-border", "--accent-primary-border", 10],
      ] as const;

      for (const [warningRole, brandRole, minimum] of warningAndBrandRoles) {
        const warning = token(theme, warningRole);
        const brand = token(theme, brandRole);
        expect(
          deltaEOk(warning, brand),
          `${theme} ${warningRole} ${warning} must remain distinct from ${brandRole} ${brand}`,
        ).toBeGreaterThanOrEqual(minimum);
      }

      expect(
        hueDistance(token(theme, "--warning-icon"), token(theme, "--accent-primary")),
      ).toBeGreaterThanOrEqual(25);
    },
  );

  it.each(["light", "dark"] as const)(
    "keeps %s semantic aliases on their intended hue-family roles",
    (theme) => {
      expect(token(theme, "--danger")).toBe(token(theme, "--rose-text"));
      expect(token(theme, "--warning-bg")).toBe(token(theme, "--copper-soft"));
      expect(token(theme, "--success-text")).toBe(token(theme, "--moss-text"));
      expect(token(theme, "--focus-ring")).toBe(token(theme, "--ink-blue"));
      expect(token(theme, "--selection-border")).toBe(token(theme, "--gold-border"));
      expect(token(theme, "--attribution")).toBe(token(theme, "--text-muted"));
    },
  );
});

describe("danger token roles", () => {
  it.each([
    ["Button", "primitives/Button/Button.css"],
    ["IconButton", "primitives/IconButton/IconButton.css"],
  ])("uses danger-fill only for %s primary backgrounds and borders", (_name, path) => {
    const styles = stylesheet(path);
    expect(styles.match(/var\(--danger-fill\)/g)).toHaveLength(4);
    expect(styles.match(/background:\s*var\(--danger\);/g)).toBeNull();
    expect(styles).toMatch(/secondary[^}]*color:\s*var\(--danger\);/s);
    expect(styles).toMatch(/ghost[^}]*color:\s*var\(--danger\);/s);
  });
});

describe.each(["light", "dark"] as const)("%s-theme graph color contrast", (theme) => {
  it.each(CARD_KINDS)(
    "keeps the %s card-kind marker distinguishable from its canvas and card surface",
    (kind) => {
      const colorRole = `--card-kind-${kind}`;
      const surfaceRole = `--card-kind-${kind}-surface`;
      const color = token(theme, colorRole);

      expect(
        contrastRatio(color, token(theme, "--canvas")),
        `${theme} ${colorRole} ${color} on graph canvas`,
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrastRatio(color, token(theme, surfaceRole)),
        `${theme} ${colorRole} ${color} on ${surfaceRole}`,
      ).toBeGreaterThanOrEqual(3);
    },
  );

  it.each(GRAPH_EDGE_COLORS.filter((color) => color !== "auto"))(
    "keeps the explicit %s edge palette role distinguishable from the graph canvas",
    (color) => {
      const colorRole = `--graph-edge-color-${color}`;
      const resolvedColor = token(theme, colorRole);

      expect(
        contrastRatio(resolvedColor, token(theme, "--canvas")),
        `${theme} ${colorRole} ${resolvedColor} on graph canvas`,
      ).toBeGreaterThanOrEqual(3);
    },
  );

  it.each([
    ["directed", "--graph-edge-directed-stroke"],
    ["undirected", "--graph-edge-undirected-stroke"],
  ] as const)(
    "keeps the automatic %s edge role distinguishable from the graph canvas",
    (_, role) => {
      const resolvedColor = token(theme, role);

      expect(
        contrastRatio(resolvedColor, token(theme, "--canvas")),
        `${theme} ${role} ${resolvedColor} on graph canvas`,
      ).toBeGreaterThanOrEqual(3);
    },
  );
});

describe("graph semantic color token ownership", () => {
  it("keeps every card-kind color and surface behind a semantic alias", () => {
    for (const kind of CARD_KINDS) {
      for (const role of [`--card-kind-${kind}`, `--card-kind-${kind}-surface`]) {
        expect(sharedTokens[role], role).toMatch(/^var\(\s*--[\w-]+\s*\)$/);
      }
    }
  });

  it("keeps explicit and automatic edge colors behind semantic aliases", () => {
    const roles = [
      ...GRAPH_EDGE_COLORS.filter((color) => color !== "auto").map(
        (color) => `--graph-edge-color-${color}`,
      ),
      "--graph-edge-directed-stroke",
      "--graph-edge-undirected-stroke",
    ];

    for (const role of roles) {
      expect(sharedTokens[role], role).toMatch(/^var\(\s*--[\w-]+\s*\)$/);
    }
  });
});
