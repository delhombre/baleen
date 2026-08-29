import { describe, expect, it } from "vitest";

import { exportCsv } from "../../../src/core/export-csv";
import type { ExportCollection } from "../../../src/core/export-artifact";

const collection: ExportCollection = {
  name: "Kitchen picks",
  products: [
    {
      id: "6d4013e0-93e4-45a3-9298-16e69ce3af1e",
      capturedAt: "2026-08-28T12:00:00.000Z",
      source: {
        url: "https://shop.example.test/aero",
        pageTitle: "Aero Max",
      },
      name: 'Aero, "Max"',
      brand: "Brew Co",
      price: { amount: 129.5, currency: "EUR" },
      category: "Kitchen",
      specs: [{ label: "Capacity", value: "5 L\nLarge" }],
      pros: ["Fast", 'Quiet, "clean"'],
      cons: [],
      extraction: { method: "json-ld", model: "claude-sonnet-4-6" },
    },
    {
      id: "9fbe2f7a-4b95-44bc-9d6c-5b4f0d15b03b",
      capturedAt: "2026-08-28T12:05:00.000Z",
      source: {
        url: "https://shop.example.test/bean-maker",
        pageTitle: "Bean Maker",
      },
      name: "Bean Maker",
      brand: "unknown",
      price: "unknown",
      category: "unknown",
      specs: [],
      pros: [],
      cons: ["Fragile"],
      extraction: { method: "dom-fallback", model: "claude-sonnet-4-6" },
    },
  ],
};

describe("exportCsv", () => {
  it("writes RFC 4180 rows with separate price fields, unknown arrays, and provenance", () => {
    expect(exportCsv(collection)).toBe(
      "collection_name,id,name,brand,price_amount,price_currency,category,specs,pros,cons,source_url,page_title,captured_at,extraction_method,extraction_model\r\n" +
        'Kitchen picks,6d4013e0-93e4-45a3-9298-16e69ce3af1e,"Aero, ""Max""",Brew Co,129.5,EUR,Kitchen,"Capacity: 5 L\nLarge","Fast; Quiet, ""clean""",unknown,https://shop.example.test/aero,Aero Max,2026-08-28T12:00:00.000Z,json-ld,claude-sonnet-4-6\r\n' +
        "Kitchen picks,9fbe2f7a-4b95-44bc-9d6c-5b4f0d15b03b,Bean Maker,unknown,unknown,unknown,unknown,unknown,unknown,Fragile,https://shop.example.test/bean-maker,Bean Maker,2026-08-28T12:05:00.000Z,dom-fallback,claude-sonnet-4-6\r\n",
    );
  });

  it("escapes spreadsheet formulas in every textual transport field without changing unknown", () => {
    const firstProduct = collection.products[0];
    if (firstProduct === undefined) {
      throw new Error("Reference collection is empty.");
    }
    const hostileProduct: ExportCollection = {
      name: "Kitchen picks",
      products: [
        {
          ...firstProduct,
          name: "=SUM(A1:A2)",
          source: { ...firstProduct.source, pageTitle: "+Injected title" },
          specs: [{ label: "@spec", value: "Value" }],
          pros: ["-formula"],
          cons: ["\tleading tab"],
        },
        {
          ...firstProduct,
          id: "3e9d920d-2bb0-4a6e-b4a1-7c3af8ed6fd7",
          name: "\rCarriage product",
        },
      ],
    };

    const csv = exportCsv(hostileProduct);
    expect(csv).toContain("'=SUM(A1:A2)");
    expect(csv).toContain("'+Injected title");
    expect(csv).toContain("'@spec: Value");
    expect(csv).toContain("'-formula");
    expect(csv).toContain("'\tleading tab");
    expect(csv).toContain('"\'\rCarriage product"');
    expect(csv).toContain(",unknown,");
    expect(csv).toContain("Kitchen picks,");
  });
});
