import { describe, expect, it } from "vitest";

import { isExtractionResult } from "../../../src/core/raw-product";

const source = {
  url: "https://shop.example.test/products/short-product",
  pageTitle: "Short product",
  capturedAt: "2026-08-28T12:00:00.000Z",
} as const;

function domFallback(content: string, truncated: boolean): unknown {
  return {
    kind: "success",
    source,
    method: "dom-fallback",
    content,
    truncated,
  };
}

describe("isExtractionResult", () => {
  it("requires a DOM truncation claim to match the raw-content budget", () => {
    expect(isExtractionResult(domFallback("short", true))).toBe(false);
    expect(isExtractionResult(domFallback("x".repeat(11_999), true))).toBe(false);
    expect(isExtractionResult(domFallback("x".repeat(12_000), true))).toBe(true);
    expect(isExtractionResult(domFallback("short", false))).toBe(true);
    expect(isExtractionResult(domFallback("x".repeat(12_000), false))).toBe(true);
  });
});
