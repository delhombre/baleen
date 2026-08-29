import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CapturePanel, CapturePanelView, type CapturePanelState } from "../../src/ui/capture-panel";

const source = {
  url: "https://example.test/product",
  pageTitle: "Example product",
  capturedAt: "2026-08-28T12:00:00.000Z",
} as const;

describe("CapturePanelView", () => {
  it("renders an empty panel with a capture button", () => {
    const markup = renderToStaticMarkup(
      <CapturePanelView state={{ kind: "empty" }} onCapture={vi.fn()} />,
    );

    expect(markup).toContain("Aucune fiche pour le moment");
    expect(markup).toContain("Capturez une page produit pour commencer.");
    expect(markup).toContain(">Capturer<");
  });

  it("renders loading, raw success and error states", () => {
    const states: CapturePanelState[] = [
      { kind: "loading" },
      {
        kind: "success",
        result: {
          kind: "success",
          source,
          method: "json-ld",
          content: { "@type": "Product", name: "<unsafe>" },
          truncated: false,
        },
      },
      { kind: "error", code: "not-product" },
      { kind: "error", code: "ambiguous-product" },
      { kind: "error", code: "unavailable-page" },
    ];

    const markups = states.map((state) =>
      renderToStaticMarkup(<CapturePanelView state={state} onCapture={vi.fn()} />),
    );

    expect(markups[0]).toContain("Capture en cours");
    expect(markups[1]).toContain("https://example.test/product");
    expect(markups[1]).toContain("json-ld");
    expect(markups[1]).toContain("Tronquée");
    expect(markups[1]).toContain(">Non</dd>");
    expect(markups[1]).toContain("&lt;unsafe&gt;");
    expect(markups[2]).toContain("Cette page ne semble pas être un produit");
    expect(markups[2]).toContain("deux bullets d’une liste produit");
    expect(markups[2]).toContain('role="alert"');
    expect(markups[2]).toContain('aria-hidden="true"');
    expect(markups[2]).toContain("Ouvrez une page produit, puis réessayez.");
    expect(markups[3]).toContain("Plusieurs produits détectés");
    expect(markups[4]).toContain("Page indisponible");
  });
});

describe("CapturePanel", () => {
  it("starts in memory-only empty state", () => {
    const markup = renderToStaticMarkup(<CapturePanel capture={vi.fn()} />);

    expect(markup).toContain("Aucune fiche pour le moment");
    expect(markup).not.toContain("localStorage");
  });
});
