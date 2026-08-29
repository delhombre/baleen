import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ProductRecord } from "../../src/core/product-record";
import { ProductCard } from "../../src/ui/product-card";

const completeRecord: ProductRecord = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  capturedAt: "2026-08-28T12:00:00.000Z",
  source: {
    url: "https://example.test/products/airfryer",
    pageTitle: "Airfryer Example",
  },
  name: "Airfryer Example",
  brand: "Baleen Kitchen",
  price: { amount: 129.9, currency: "EUR" },
  category: "Air fryer",
  specs: [{ label: "Capacité", value: "5 L" }],
  pros: ["Cuisson rapide"],
  cons: ["Panier lourd"],
  extraction: { method: "json-ld", model: "claude-sonnet-4-6" },
};

describe("ProductCard", () => {
  it("presents the normalized product facts and provenance", () => {
    const markup = renderToStaticMarkup(<ProductCard record={completeRecord} />);

    expect(markup).toContain("Airfryer Example");
    expect(markup).toContain("Baleen Kitchen");
    expect(markup).toContain("129,90 EUR");
    expect(markup).toContain("Cuisson rapide");
    expect(markup).toContain("Panier lourd");
    expect(markup).toContain("https://example.test/products/airfryer");
    expect(markup).toContain(
      'href="https://example.test/products/airfryer" target="_blank" rel="noreferrer noopener"',
    );
    expect(markup).toContain('<time dateTime="2026-08-28T12:00:00.000Z">');
    expect(markup).toContain("28 août 2026");
    expect(markup).toContain("break-all");
    expect(markup).toContain("claude-sonnet-4-6");
    expect(markup).not.toContain("Fiche partielle");
  });

  it("renders capture time in French UTC even close to midnight", () => {
    const record: ProductRecord = {
      ...completeRecord,
      capturedAt: "2026-08-28T23:59:00.000Z",
    };

    const markup = renderToStaticMarkup(<ProductCard record={record} />);

    expect(markup).toContain('<time dateTime="2026-08-28T23:59:00.000Z">');
    expect(markup).toContain("28 août 2026 à 23:59 UTC");
  });

  it("exposes a complete accessible summary and a clear fact reading order", () => {
    const markup = renderToStaticMarkup(<ProductCard record={completeRecord} />);
    const factsIndex = markup.indexOf("Faits essentiels");
    const specsIndex = markup.indexOf("Spécifications");
    const prosIndex = markup.indexOf("Points forts");
    const consIndex = markup.indexOf("Points faibles");
    const provenanceIndex = markup.indexOf("Provenance");

    expect(markup).toContain(
      'aria-describedby="product-card-summary-550e8400-e29b-41d4-a716-446655440000"',
    );
    expect(markup).toContain(
      "Fiche produit. Marque : Baleen Kitchen. Prix : 129,90 EUR. Catégorie : Air fryer.",
    );
    expect(factsIndex).toBeGreaterThan(-1);
    expect(factsIndex).toBeLessThan(specsIndex);
    expect(specsIndex).toBeLessThan(prosIndex);
    expect(prosIndex).toBeLessThan(consIndex);
    expect(consIndex).toBeLessThan(provenanceIndex);
  });

  it("does not mark a record partial when only optional pros and cons are empty", () => {
    const recordWithoutPolarity: ProductRecord = {
      ...completeRecord,
      pros: [],
      cons: [],
    };

    const markup = renderToStaticMarkup(<ProductCard record={recordWithoutPolarity} />);

    expect(markup).not.toContain("Fiche partielle");
    expect(markup).toContain("Aucun point fort renseigné.");
    expect(markup).toContain("Aucun point faible renseigné.");
  });

  it("makes unknown and empty evidence explicit without unsafe links", () => {
    const partialRecord: ProductRecord = {
      ...completeRecord,
      source: { ...completeRecord.source, url: "javascript:alert(1)" },
      name: "unknown",
      brand: "unknown",
      price: "unknown",
      category: "unknown",
      specs: [],
      pros: [],
      cons: [],
    };

    const markup = renderToStaticMarkup(<ProductCard record={partialRecord} />);

    expect(markup).toContain("Fiche partielle");
    expect(markup).toContain("unknown");
    expect(markup).toContain("Aucune spécification renseignée.");
    expect(markup).toContain("Aucun point fort renseigné.");
    expect(markup).toContain("Aucun point faible renseigné.");
    expect(markup).not.toContain('href="javascript:alert(1)"');
  });
});
