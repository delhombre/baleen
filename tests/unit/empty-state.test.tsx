import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EmptyState } from "../../src/ui/empty-state";

describe("EmptyState", () => {
  it("renders onboarding copy for an empty collection", () => {
    const markup = renderToStaticMarkup(<EmptyState />);

    expect(markup).toContain("Aucune fiche pour le moment");
    expect(markup).toContain("Capturez une page produit pour commencer.");
  });
});
