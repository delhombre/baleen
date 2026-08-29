import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Baleen UI focus styles", () => {
  it("keeps a visible focus indicator for every keyboard control", async () => {
    const stylesheet = await readFile(resolve("src/ui/styles.css"), "utf8");

    expect(stylesheet).toContain(":focus-visible");
    expect(stylesheet).toContain("outline");
  });

  it("keeps the side panel readable on narrow viewports", async () => {
    const stylesheet = await readFile(resolve("src/ui/styles.css"), "utf8");

    expect(stylesheet).toContain("max-width: 40rem");
    expect(stylesheet).not.toContain("max-width: 42rem");
    expect(stylesheet).toContain("margin-inline: auto");
  });

  it("defines semantic OKLCH tokens and resilient control defaults", async () => {
    const stylesheet = await readFile(resolve("src/ui/styles.css"), "utf8");

    expect(stylesheet).toMatch(/--color-deep-navy:\s*oklch\(/u);
    expect(stylesheet).toMatch(/--color-surface:\s*oklch\(/u);
    expect(stylesheet).toMatch(/--color-accent-cyan:\s*oklch\(/u);
    expect(stylesheet).toMatch(/--color-success:\s*oklch\(/u);
    expect(stylesheet).toMatch(/--color-danger-coral:\s*oklch\(/u);
    expect(stylesheet).toMatch(/--color-unknown-neutral:\s*oklch\(/u);
    expect(stylesheet).toContain("min-height: 44px");
    expect(stylesheet).toContain("font-size: 1rem");
    expect(stylesheet).toContain("prefers-reduced-motion: reduce");
    expect(stylesheet).not.toMatch(/transition\s*:\s*all/iu);
  });

  it("scopes option control sizing without changing sidepanel defaults", async () => {
    const stylesheet = await readFile(resolve("src/ui/styles.css"), "utf8");

    expect(stylesheet).toMatch(
      /\.options-page\s*:where\(button,\s*input,\s*select,\s*textarea\)\s*\{[^}]*min-height:\s*44px/isu,
    );
    expect(stylesheet).toMatch(
      /\.options-page\s*:where\(input,\s*select,\s*textarea\)\s*\{[^}]*font-size:\s*1rem/isu,
    );
    expect(stylesheet).not.toMatch(
      /^button,\s*input,\s*select,\s*textarea\s*\{[^}]*min-height\s*:/isu,
    );
    expect(stylesheet).not.toMatch(
      /^:where\(input,\s*select,\s*textarea\)\s*\{[^}]*font-size\s*:/isu,
    );
  });
});
