import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NormalizationView, type NormalizationViewState } from "../../../src/ui/normalization-view";
import type { ProductRecord } from "../../../src/core/product-record";

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

describe("NormalizationView", () => {
  it.each([
    ["missing-key", "Clé API manquante"],
    ["quota", "Quota de normalisation atteint"],
    ["network", "Connexion impossible"],
    ["unavailable", "Service de normalisation indisponible"],
    ["invalid-response", "Réponse de normalisation invalide"],
  ] as const)("renders the French alert for %s", (kind, title) => {
    const state: NormalizationViewState = { kind };
    const markup = renderToStaticMarkup(<NormalizationView state={state} />);

    expect(markup).toContain(title);
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain("rate-limited");
  });

  it("exposes idle and loading as live public states", () => {
    const idle = renderToStaticMarkup(<NormalizationView state={{ kind: "idle" }} />);
    const loading = renderToStaticMarkup(<NormalizationView state={{ kind: "loading" }} />);

    expect(idle).toContain("Prête à normaliser");
    expect(idle).toContain('role="status"');
    expect(loading).toContain("Normalisation en cours…");
    expect(loading).toContain('aria-live="polite"');
    expect(loading).toContain('aria-busy="true"');
  });

  it("renders a successful normalization as a product card", () => {
    const markup = renderToStaticMarkup(
      <NormalizationView state={{ kind: "success", record: completeRecord }} />,
    );

    expect(markup).toContain("Airfryer Example");
    expect(markup).toContain("Provenance");
  });
});
