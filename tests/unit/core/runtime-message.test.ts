import { describe, expect, it } from "vitest";

import {
  isNormalizeProductMessage,
  isRuntimeConnectionResponse,
  isRuntimeNormalizeResponse,
  isTestConnectionMessage,
} from "../../../src/core/runtime-message";

const extraction = {
  kind: "success",
  source: {
    url: "https://shop.example.test/product",
    pageTitle: "Product",
    capturedAt: "2026-08-28T12:00:00.000Z",
  },
  method: "json-ld",
  content: { "@type": "Product", name: "Product" },
  truncated: false,
} as const;

const record = {
  id: "4c1ee929-6c05-42e8-bfdc-8dfb602ca0db",
  capturedAt: extraction.source.capturedAt,
  source: { url: extraction.source.url, pageTitle: extraction.source.pageTitle },
  name: "Product",
  brand: "unknown",
  price: "unknown",
  category: "unknown",
  specs: [],
  pros: [],
  cons: [],
  extraction: { method: "json-ld", model: "claude-sonnet-4-6" },
} as const;

describe("runtime message contract", () => {
  it("accepts only exact normalized and connection messages", () => {
    expect(isNormalizeProductMessage({ type: "baleen:normalize-product", extraction })).toBe(true);
    expect(isTestConnectionMessage({ type: "baleen:test-connection", provider: "anthropic" })).toBe(
      true,
    );
    expect(isTestConnectionMessage({ type: "baleen:test-connection" })).toBe(false);
    expect(
      isNormalizeProductMessage({ type: "baleen:normalize-product", extraction, key: "secret" }),
    ).toBe(false);
    expect(isTestConnectionMessage({ type: "baleen:test-connection", key: "secret" })).toBe(false);
    expect(isNormalizeProductMessage({ type: "baleen:normalize-product", extraction: null })).toBe(
      false,
    );
  });

  it("accepts only exact safe response shapes and validated records", () => {
    expect(isRuntimeConnectionResponse({ kind: "success", provider: "anthropic" })).toBe(true);
    expect(
      isRuntimeConnectionResponse({ kind: "error", code: "missing-key", provider: "groq" }),
    ).toBe(true);
    expect(isRuntimeConnectionResponse({ kind: "success" })).toBe(false);
    expect(isRuntimeConnectionResponse({ kind: "error", code: "missing-key" })).toBe(false);
    expect(isRuntimeConnectionResponse({ kind: "success", key: "secret" })).toBe(false);
    expect(isRuntimeNormalizeResponse({ kind: "success", record })).toBe(true);
    expect(isRuntimeNormalizeResponse({ kind: "success", record, provider: "groq" })).toBe(true);
    expect(
      isRuntimeNormalizeResponse({ kind: "error", code: "quota", provider: "anthropic" }),
    ).toBe(true);
    expect(isRuntimeNormalizeResponse({ kind: "error", code: "quota", provider: "openai" })).toBe(
      false,
    );
    expect(isRuntimeNormalizeResponse({ kind: "success", record, key: "secret" })).toBe(false);
    expect(
      isRuntimeNormalizeResponse({ kind: "success", record: { ...record, id: "not-uuid" } }),
    ).toBe(false);
    expect(isRuntimeNormalizeResponse({ kind: "error", code: "provider-detail" })).toBe(false);
  });
});
