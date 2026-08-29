import { describe, expect, it } from "vitest";

import { exportMarkdown, type ExportCollection } from "../../../src/core/export-markdown";

const collection: ExportCollection = {
  name: "Kitchen picks",
  products: [
    {
      id: "6d4013e0-93e4-45a3-9298-16e69ce3af1e",
      capturedAt: "2026-08-28T12:00:00.000Z",
      source: {
        url: "https://shop.example.test/aero?ref=one",
        pageTitle: "Aero | Max\\Guide",
      },
      name: "Aero | Max",
      brand: "Brew\\Co",
      price: { amount: 129.5, currency: "EUR" },
      category: "Kitchen",
      specs: [
        { label: "Capacity", value: "5 L\nLarge" },
        { label: "Noise", value: "44 dB" },
      ],
      pros: ["Fast", "Quiet"],
      cons: ["Hot"],
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
      specs: [
        { label: "Capacity", value: "1.2 L" },
        { label: "Grind", value: "Burr" },
      ],
      pros: [],
      cons: ["Fragile"],
      extraction: { method: "dom-fallback", model: "claude-sonnet-4-6" },
    },
  ],
};

describe("exportMarkdown", () => {
  it("renders an attribute-by-product table with stable specs and provenance", () => {
    expect(exportMarkdown(collection)).toBe(
      "# Kitchen picks\n\n" +
        "| Attribute | Aero \\| Max | Bean Maker |\n" +
        "| --- | --- | --- |\n" +
        "| Name | Aero \\| Max | Bean Maker |\n" +
        "| Brand | Brew\\\\Co | unknown |\n" +
        "| Price | 129.5 EUR | unknown |\n" +
        "| Category | Kitchen | unknown |\n" +
        "| Capacity | 5 L<br>Large | 1.2 L |\n" +
        "| Noise | 44 dB | unknown |\n" +
        "| Grind | unknown | Burr |\n" +
        "| Pros | Fast<br>Quiet | unknown |\n" +
        "| Cons | Hot | Fragile |\n" +
        "| Source URL | https://shop.example.test/aero?ref=one | https://shop.example.test/bean-maker |\n" +
        "| Page title | Aero \\| Max\\\\Guide | Bean Maker |\n" +
        "| Captured at | 2026-08-28T12:00:00.000Z | 2026-08-28T12:05:00.000Z |\n" +
        "| Extraction method | json-ld | dom-fallback |\n" +
        "| Extraction model | claude-sonnet-4-6 | claude-sonnet-4-6 |\n",
    );
  });

  it("keeps a specification label distinct from built-in attribute labels", () => {
    const firstProduct = collection.products[0];
    if (firstProduct === undefined) {
      throw new Error("Reference collection is empty.");
    }
    const collisionCollection: ExportCollection = {
      name: "Collision",
      products: [
        {
          ...firstProduct,
          specs: [{ label: "Brand", value: "Steel" }],
        },
      ],
    };

    expect(exportMarkdown(collisionCollection)).toBe(
      "# Collision\n\n" +
        "| Attribute | Aero \\| Max |\n" +
        "| --- | --- |\n" +
        "| Name | Aero \\| Max |\n" +
        "| Brand | Brew\\\\Co |\n" +
        "| Price | 129.5 EUR |\n" +
        "| Category | Kitchen |\n" +
        "| Spec: Brand | Steel |\n" +
        "| Pros | Fast<br>Quiet |\n" +
        "| Cons | Hot |\n" +
        "| Source URL | https://shop.example.test/aero?ref=one |\n" +
        "| Page title | Aero \\| Max\\\\Guide |\n" +
        "| Captured at | 2026-08-28T12:00:00.000Z |\n" +
        "| Extraction method | json-ld |\n" +
        "| Extraction model | claude-sonnet-4-6 |\n",
    );
  });

  it("qualifies every reserved specification label without changing first-seen order", () => {
    const firstProduct = collection.products[0];
    if (firstProduct === undefined) {
      throw new Error("Reference collection is empty.");
    }
    const collisionCollection: ExportCollection = {
      name: "Reserved labels",
      products: [
        {
          ...firstProduct,
          specs: [
            { label: "Name", value: "Spec name" },
            { label: "Brand", value: "Spec brand" },
            { label: "Price", value: "Spec price" },
            { label: "Category", value: "Spec category" },
            { label: "Pros", value: "Spec pros" },
            { label: "Cons", value: "Spec cons" },
            { label: "Source URL", value: "Spec URL" },
            { label: "Page title", value: "Spec title" },
            { label: "Captured at", value: "Spec captured" },
            { label: "Extraction method", value: "Spec method" },
            { label: "Extraction model", value: "Spec model" },
            { label: "Capacity", value: "5.5 L" },
          ],
        },
      ],
    };

    expect(exportMarkdown(collisionCollection)).toBe(
      "# Reserved labels\n\n" +
        "| Attribute | Aero \\| Max |\n" +
        "| --- | --- |\n" +
        "| Name | Aero \\| Max |\n" +
        "| Brand | Brew\\\\Co |\n" +
        "| Price | 129.5 EUR |\n" +
        "| Category | Kitchen |\n" +
        "| Spec: Name | Spec name |\n" +
        "| Spec: Brand | Spec brand |\n" +
        "| Spec: Price | Spec price |\n" +
        "| Spec: Category | Spec category |\n" +
        "| Spec: Pros | Spec pros |\n" +
        "| Spec: Cons | Spec cons |\n" +
        "| Spec: Source URL | Spec URL |\n" +
        "| Spec: Page title | Spec title |\n" +
        "| Spec: Captured at | Spec captured |\n" +
        "| Spec: Extraction method | Spec method |\n" +
        "| Spec: Extraction model | Spec model |\n" +
        "| Capacity | 5.5 L |\n" +
        "| Pros | Fast<br>Quiet |\n" +
        "| Cons | Hot |\n" +
        "| Source URL | https://shop.example.test/aero?ref=one |\n" +
        "| Page title | Aero \\| Max\\\\Guide |\n" +
        "| Captured at | 2026-08-28T12:00:00.000Z |\n" +
        "| Extraction method | json-ld |\n" +
        "| Extraction model | claude-sonnet-4-6 |\n",
    );
  });

  it("keeps qualified specification labels unique after qualification", () => {
    const firstProduct = collection.products[0];
    if (firstProduct === undefined) {
      throw new Error("Reference collection is empty.");
    }
    const collisionCollection: ExportCollection = {
      name: "Qualified collisions",
      products: [
        {
          ...firstProduct,
          specs: [
            { label: "Name", value: "First spec" },
            { label: "Spec: Name", value: "Second spec" },
          ],
        },
      ],
    };

    expect(exportMarkdown(collisionCollection)).toContain(
      "| Spec: Name | First spec |\n| Spec: Name (2) | Second spec |\n",
    );
  });
});
