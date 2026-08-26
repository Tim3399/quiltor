import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type Theme = "light" | "dark";

function stylesheet(path: string) {
  return readFileSync(join(process.cwd(), "packages/client/src/design", path), "utf8");
}

const colors = stylesheet("colors.css");

function themeBlock(theme: Theme) {
  const selector =
    theme === "light"
      ? /:root\s*,\s*:root\[data-theme="light"\]\s*\{([^}]*)\}/
      : /:root\[data-theme="dark"\]\s*\{([^}]*)\}/;
  const block = colors.match(selector)?.[1];
  if (!block) throw new Error(`${theme} theme color tokens are missing`);
  return block;
}

function token(theme: Theme, name: string) {
  const value = themeBlock(theme).match(new RegExp(`${name}:\\s*(#[0-9a-f]{6});`, "i"))?.[1];
  if (!value) throw new Error(`${theme} theme token ${name} is missing or is not a hex color`);
  return value;
}

function translucentToken(theme: Theme, name: string) {
  const match = themeBlock(theme).match(
    new RegExp(`${name}:\\s*rgb\\((\\d+)\\s+(\\d+)\\s+(\\d+)\\s*\\/\\s*([\\d.]+)\\);`),
  );
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

function materialBackgrounds(theme: Theme) {
  const surfaces = Object.fromEntries(
    ["canvas", "chrome", "paper", "panel"].map((name) => [name, token(theme, `--${name}`)]),
  );
  const interactions = [
    "--control-hint",
    "--control-hover-subtle",
    "--active-surface",
    "--control-hover",
  ];
  const backgrounds: Record<string, string> = {};

  for (const [surfaceName, surface] of Object.entries(surfaces)) {
    backgrounds[surfaceName] = surface;
    for (const interaction of interactions) {
      backgrounds[`${surfaceName}:${interaction.slice(2)}`] = compositeOver(
        theme,
        interaction,
        surface,
      );
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
  it("keeps muted small text at WCAG AA across surfaces and interaction states", () => {
    expectSmallTextContrast(theme, "--muted", materialBackgrounds(theme));
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
        ["canvas", "chrome", "paper", "panel"].map((surface) => [
          `${surface}:selection`,
          compositeOver(theme, "--selection-surface", token(theme, `--${surface}`)),
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
      warning: token(theme, "--warning-bg"),
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
