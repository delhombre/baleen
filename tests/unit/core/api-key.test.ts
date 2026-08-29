import { describe, expect, it } from "vitest";

import { API_KEY_MASK, maskApiKey, parseApiKey } from "../../../src/core/api-key";

describe("api key", () => {
  it("trims a non-blank unknown string without requiring a prefix", () => {
    const key = parseApiKey("  secret-without-prefix  ");

    expect(key).toBe("secret-without-prefix");
  });

  it("rejects non-strings and blank strings", () => {
    for (const value of [undefined, null, 42, {}, "", "   ", "\n\t"]) {
      expect(parseApiKey(value)).toBeUndefined();
    }
  });

  it("returns a fixed mask that reveals no suffix", () => {
    const key = parseApiKey("sk-secret-suffix-123");

    expect(key).toBeDefined();
    expect(maskApiKey(key!)).toBe(API_KEY_MASK);
    expect(maskApiKey(key!)).toBe("••••••••");
    expect(maskApiKey(key!)).not.toContain("123");
  });
});
