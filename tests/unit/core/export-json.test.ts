import { describe, expect, it } from "vitest";

import { exportJson } from "../../../src/core/export-json";
import type { ExportCollection } from "../../../src/core/export-artifact";

const collection: ExportCollection = {
  name: "Reference collection",
  products: [
    {
      id: "6d4013e0-93e4-45a3-9298-16e69ce3af1e",
      capturedAt: "2026-08-28T12:00:00.000Z",
      source: {
        url: "https://shop.example.test/aero",
        pageTitle: "Aero Max",
      },
      name: "Aero Max",
      brand: "Brew Co",
      price: { amount: 129.5, currency: "EUR" },
      category: "Kitchen",
      specs: [{ label: "Capacity", value: "5 L" }],
      pros: ["Fast"],
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

describe("exportJson", () => {
  it("keeps the collection name, product order, exact records, unknowns, and arrays", () => {
    expect(exportJson(collection)).toBe(
      "{\n" +
        '  "name": "Reference collection",\n' +
        '  "products": [\n' +
        "    {\n" +
        '      "id": "6d4013e0-93e4-45a3-9298-16e69ce3af1e",\n' +
        '      "capturedAt": "2026-08-28T12:00:00.000Z",\n' +
        '      "source": {\n' +
        '        "url": "https://shop.example.test/aero",\n' +
        '        "pageTitle": "Aero Max"\n' +
        "      },\n" +
        '      "name": "Aero Max",\n' +
        '      "brand": "Brew Co",\n' +
        '      "price": {\n' +
        '        "amount": 129.5,\n' +
        '        "currency": "EUR"\n' +
        "      },\n" +
        '      "category": "Kitchen",\n' +
        '      "specs": [\n' +
        "        {\n" +
        '          "label": "Capacity",\n' +
        '          "value": "5 L"\n' +
        "        }\n" +
        "      ],\n" +
        '      "pros": [\n' +
        '        "Fast"\n' +
        "      ],\n" +
        '      "cons": [],\n' +
        '      "extraction": {\n' +
        '        "method": "json-ld",\n' +
        '        "model": "claude-sonnet-4-6"\n' +
        "      }\n" +
        "    },\n" +
        "    {\n" +
        '      "id": "9fbe2f7a-4b95-44bc-9d6c-5b4f0d15b03b",\n' +
        '      "capturedAt": "2026-08-28T12:05:00.000Z",\n' +
        '      "source": {\n' +
        '        "url": "https://shop.example.test/bean-maker",\n' +
        '        "pageTitle": "Bean Maker"\n' +
        "      },\n" +
        '      "name": "Bean Maker",\n' +
        '      "brand": "unknown",\n' +
        '      "price": "unknown",\n' +
        '      "category": "unknown",\n' +
        '      "specs": [],\n' +
        '      "pros": [],\n' +
        '      "cons": [\n' +
        '        "Fragile"\n' +
        "      ],\n" +
        '      "extraction": {\n' +
        '        "method": "dom-fallback",\n' +
        '        "model": "claude-sonnet-4-6"\n' +
        "      }\n" +
        "    }\n" +
        "  ]\n" +
        "}\n",
    );
  });
});
