import { describe, expect, it } from "vitest";

import { ProductRecordSchema } from "../../../src/core/product-record";

describe("ProductRecordSchema", () => {
  it("accepts a complete record whose unavailable scalar facts stay literal unknown", () => {
    const record = {
      id: "6d4013e0-93e4-45a3-9298-16e69ce3af1e",
      capturedAt: "2026-08-28T12:00:00.000Z",
      source: {
        url: "https://shop.example.test/products/espresso-mini",
        pageTitle: "Espresso Mini | Shop",
      },
      name: "Espresso Mini",
      brand: "unknown",
      price: "unknown",
      category: "unknown",
      specs: [],
      pros: [],
      cons: [],
      extraction: {
        method: "json-ld",
        model: "claude-sonnet-4-6",
      },
    };

    expect(ProductRecordSchema.parse(record)).toEqual(record);
  });

  it("rejects uncontracted keys and empty claimed facts", () => {
    const record = {
      id: "6d4013e0-93e4-45a3-9298-16e69ce3af1e",
      capturedAt: "2026-08-28T12:00:00.000Z",
      source: {
        url: "https://shop.example.test/products/espresso-mini",
        pageTitle: "Espresso Mini | Shop",
      },
      name: "Espresso Mini",
      brand: "unknown",
      price: "unknown",
      category: "unknown",
      specs: [],
      pros: [],
      cons: [],
      extraction: { method: "json-ld", model: "claude-sonnet-4-6" },
    };

    expect([
      ProductRecordSchema.safeParse({ ...record, prompt: "untrusted" }).success,
      ProductRecordSchema.safeParse({ ...record, name: "" }).success,
    ]).toEqual([false, false]);
  });

  it("allows the unknown sentinel only in the four scalar fields that permit it", () => {
    const record = {
      id: "6d4013e0-93e4-45a3-9298-16e69ce3af1e",
      capturedAt: "2026-08-28T12:00:00.000Z",
      source: {
        url: "https://shop.example.test/products/espresso-mini",
        pageTitle: "Espresso Mini | Shop",
      },
      name: "unknown",
      brand: "unknown",
      price: "unknown",
      category: "unknown",
      specs: [],
      pros: [],
      cons: [],
      extraction: { method: "json-ld", model: "claude-sonnet-4-6" },
    };

    expect([
      ProductRecordSchema.safeParse({
        ...record,
        price: { amount: 1, currency: "unknown" },
      }).success,
      ProductRecordSchema.safeParse({ ...record, pros: ["unknown"] }).success,
      ProductRecordSchema.safeParse({
        ...record,
        extraction: { method: "json-ld", model: "unknown" },
      }).success,
    ]).toEqual([false, false, false]);
  });

  it("trims known facts while rejecting whitespace-only known text, currency, and model", () => {
    const record = {
      id: "6d4013e0-93e4-45a3-9298-16e69ce3af1e",
      capturedAt: "2026-08-28T12:00:00.000Z",
      source: {
        url: "https://shop.example.test/products/espresso-mini",
        pageTitle: "Espresso Mini | Shop",
      },
      name: "  Espresso Mini  ",
      brand: "  Brew Market  ",
      price: { amount: 129, currency: " EUR " },
      category: "  Espresso machines  ",
      specs: [{ label: "  Capacity ", value: "  1.2 L  " }],
      pros: ["  Compact  "],
      cons: ["  Single boiler  "],
      extraction: { method: "json-ld", model: "  claude-sonnet-4-6  " },
    };

    expect(ProductRecordSchema.parse(record)).toMatchObject({
      name: "Espresso Mini",
      brand: "Brew Market",
      price: { amount: 129, currency: "EUR" },
      category: "Espresso machines",
      specs: [{ label: "Capacity", value: "1.2 L" }],
      pros: ["Compact"],
      cons: ["Single boiler"],
      extraction: { method: "json-ld", model: "claude-sonnet-4-6" },
    });
    expect([
      ProductRecordSchema.safeParse({ ...record, name: "   " }).success,
      ProductRecordSchema.safeParse({ ...record, price: { amount: 129, currency: "  " } }).success,
      ProductRecordSchema.safeParse({
        ...record,
        extraction: { method: "json-ld", model: "\t" },
      }).success,
    ]).toEqual([false, false, false]);
  });
});
