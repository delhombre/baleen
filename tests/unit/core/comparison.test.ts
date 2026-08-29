import { describe, expect, it } from "vitest";

import { buildComparisonTable } from "../../../src/core/comparison";
import type { ProductRecord } from "../../../src/core/product-record";

const product = (
  record: Partial<ProductRecord> & Pick<ProductRecord, "id" | "name">,
): ProductRecord => ({
  id: record.id,
  capturedAt: record.capturedAt ?? "2026-08-28T12:00:00.000Z",
  source: record.source ?? {
    url: `https://shop.example.test/products/${record.id}`,
    pageTitle: record.name,
  },
  name: record.name,
  brand: record.brand ?? "unknown",
  price: record.price ?? "unknown",
  category: record.category ?? "unknown",
  specs: record.specs ?? [],
  pros: record.pros ?? [],
  cons: record.cons ?? [],
  extraction: record.extraction ?? { method: "json-ld", model: "claude-sonnet-4-6" },
});

describe("comparison core", () => {
  it("builds stable attribute rows and explicit unknown cells", () => {
    const products = [
      product({
        id: "6d4013e0-93e4-45a3-9298-16e69ce3af1e",
        name: "CrispWave",
        brand: "CrispWave",
        price: { amount: 129.99, currency: "EUR" },
        category: "Air fryers",
        specs: [{ label: "Capacity", value: "5.5 L" }],
      }),
      product({
        id: "9df4e444-6d40-45a2-a09d-4bd2e05d7b1d",
        name: "Barista Mini",
        specs: [
          { label: "Power", value: "1350 W" },
          { label: "Capacity", value: "1.2 L" },
        ],
      }),
    ];

    expect(buildComparisonTable(products)).toEqual({
      products,
      rows: [
        { label: "Name", values: ["CrispWave", "Barista Mini"] },
        { label: "Brand", values: ["CrispWave", "unknown"] },
        { label: "Price", values: ["129.99 EUR", "unknown"] },
        { label: "Category", values: ["Air fryers", "unknown"] },
        { label: "Capacity", values: ["5.5 L", "1.2 L"] },
        { label: "Power", values: ["unknown", "1350 W"] },
      ],
    });
  });

  it("uses the first value for a repeated label while preserving first-seen label order", () => {
    const products = [
      product({
        id: "6d4013e0-93e4-45a3-9298-16e69ce3af1e",
        name: "CrispWave",
        specs: [
          { label: "Capacity", value: "5.5 L" },
          { label: "Capacity", value: "wrong duplicate" },
          { label: "Power", value: "1500 W" },
        ],
      }),
      product({
        id: "9df4e444-6d40-45a2-a09d-4bd2e05d7b1d",
        name: "Barista Mini",
        specs: [{ label: "Power", value: "1350 W" }],
      }),
    ];

    expect(buildComparisonTable(products).rows.slice(4)).toEqual([
      { label: "Capacity", values: ["5.5 L", "unknown"] },
      { label: "Power", values: ["1500 W", "1350 W"] },
    ]);
  });

  it("qualifies specs whose labels collide with fixed rows", () => {
    const products = [
      product({
        id: "6d4013e0-93e4-45a3-9298-16e69ce3af1e",
        name: "CrispWave",
        brand: "CrispWave",
        price: { amount: 129.99, currency: "EUR" },
        category: "Air fryers",
        specs: [
          { label: "Name", value: "Spec name" },
          { label: "Brand", value: "Spec brand" },
          { label: "Price", value: "Spec price" },
          { label: "Category", value: "Spec category" },
          { label: "Capacity", value: "5.5 L" },
        ],
      }),
      product({
        id: "9df4e444-6d40-45a2-a09d-4bd2e05d7b1d",
        name: "Barista Mini",
        specs: [{ label: "Capacity", value: "1.2 L" }],
      }),
    ];

    expect(buildComparisonTable(products).rows).toEqual([
      { label: "Name", values: ["CrispWave", "Barista Mini"] },
      { label: "Brand", values: ["CrispWave", "unknown"] },
      { label: "Price", values: ["129.99 EUR", "unknown"] },
      { label: "Category", values: ["Air fryers", "unknown"] },
      { label: "Spec: Name", values: ["Spec name", "unknown"] },
      { label: "Spec: Brand", values: ["Spec brand", "unknown"] },
      { label: "Spec: Price", values: ["Spec price", "unknown"] },
      { label: "Spec: Category", values: ["Spec category", "unknown"] },
      { label: "Capacity", values: ["5.5 L", "1.2 L"] },
    ]);
  });

  it("keeps qualified labels unique when a source label already has the qualifier", () => {
    const products = [
      product({
        id: "6d4013e0-93e4-45a3-9298-16e69ce3af1e",
        name: "CrispWave",
        specs: [
          { label: "Name", value: "First spec" },
          { label: "Spec: Name", value: "Second spec" },
        ],
      }),
    ];

    expect(buildComparisonTable(products).rows.slice(4)).toEqual([
      { label: "Spec: Name", values: ["First spec"] },
      { label: "Spec: Name (2)", values: ["Second spec"] },
    ]);
  });
});
