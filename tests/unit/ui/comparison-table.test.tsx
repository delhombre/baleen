import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ProductRecord } from "../../../src/core/product-record";
import { ComparisonTable } from "../../../src/ui/comparison-table";

const product = (
  id: string,
  name: ProductRecord["name"],
  specs: ProductRecord["specs"] = [],
): ProductRecord => ({
  id,
  capturedAt: "2026-08-28T12:00:00.000Z",
  source: { url: `https://shop.example.test/${id}`, pageTitle: String(name) },
  name,
  brand: "unknown",
  price: "unknown",
  category: "unknown",
  specs,
  pros: [],
  cons: [],
  extraction: { method: "json-ld", model: "claude-sonnet-4-6" },
});

describe("ComparisonTable", () => {
  it("renders the exact core rows with semantic headings and explicit unknown values", () => {
    const markup = renderToStaticMarkup(
      <ComparisonTable
        products={[
          product("6d4013e0-93e4-45a3-9298-16e69ce3af1e", "CrispWave", [
            { label: "Capacity", value: "5.5 L" },
          ]),
          product("9df4e444-6d40-45a2-a09d-4bd2e05d7b1d", "Barista Mini", [
            { label: "Power", value: "1350 W" },
          ]),
        ]}
      />,
    );

    expect(markup).toContain('<caption class="sr-only">Comparaison des fiches produit</caption>');
    expect(markup).toContain('<th scope="col"');
    expect(markup).toContain('<th scope="row"');
    expect(markup).toContain("CrispWave");
    expect(markup).toContain("Capacity");
    expect(markup).toContain("1350 W");
    expect(markup).toContain('title="Information absente de la page"');
    expect(markup).toContain("unknown");
    expect(markup).toContain("max-h-[28rem] overflow-auto");
    expect(markup).not.toContain("overflow-x-auto");
    expect(markup).toContain('role="region"');
  });

  it("keeps the comparison region navigable with sticky headings and bounded product names", () => {
    const markup = renderToStaticMarkup(
      <ComparisonTable
        products={[
          product(
            "6d4013e0-93e4-45a3-9298-16e69ce3af1e",
            "Aspirateur vertical sans fil ultra performant et silencieux édition premium",
          ),
          product("9df4e444-6d40-45a2-a09d-4bd2e05d7b1d", "Barista Mini"),
        ]}
      />,
    );

    expect(markup).toContain(
      "Faites défiler horizontalement et verticalement pour voir tous les produits.",
    );
    expect(markup).toContain('aria-describedby="comparison-table-instructions"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toMatch(/<th[^>]*class="[^"]*sticky left-0 top-0[^"]*"[^>]*>\s*Attribut/u);
    expect(markup).toMatch(/<th[^>]*scope="col"[^>]*class="[^"]*sticky top-0[^"]*"/u);
    expect(markup).toMatch(/<th[^>]*scope="row"[^>]*class="[^"]*sticky left-0[^"]*"/u);
    expect(markup).toContain("line-clamp-2");
  });

  it("localizes scalar row labels while preserving unknown values", () => {
    const markup = renderToStaticMarkup(
      <ComparisonTable
        products={[
          product("6d4013e0-93e4-45a3-9298-16e69ce3af1e", "CrispWave"),
          product("9df4e444-6d40-45a2-a09d-4bd2e05d7b1d", "Barista Mini"),
        ]}
      />,
    );

    expect(markup).toContain(">Nom</th>");
    expect(markup).toContain(">Marque</th>");
    expect(markup).toContain(">Prix</th>");
    expect(markup).toContain(">Catégorie</th>");
    expect(markup).not.toContain(">Name</th>");
    expect(markup).not.toContain(">Brand</th>");
    expect(markup).not.toContain(">Price</th>");
    expect(markup).not.toContain(">Category</th>");
    expect(markup).toContain('title="Information absente de la page"');
    expect(markup).toContain(">unknown</span>");
  });

  it("explains that at least two products are needed", () => {
    const markup = renderToStaticMarkup(
      <ComparisonTable products={[product("6d4013e0-93e4-45a3-9298-16e69ce3af1e", "CrispWave")]} />,
    );

    expect(markup).toContain("Ajoutez encore une fiche pour comparer.");
    expect(markup).not.toContain("Ajoutez une fiche pour commencer la comparaison.");
    expect(markup).not.toContain("<table");
  });

  it("explains how to start when the collection has no products", () => {
    const markup = renderToStaticMarkup(<ComparisonTable products={[]} />);

    expect(markup).toContain("Ajoutez une fiche pour commencer la comparaison.");
    expect(markup).not.toContain("Ajoutez encore une fiche pour comparer.");
    expect(markup).not.toContain("<table");
  });
});
