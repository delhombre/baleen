import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";

import type { ExportWriteResult } from "../../../src/adapters/browser/export-writers";
import type { ExportArtifact, ExportCollection } from "../../../src/core/export-artifact";
import { ExportControls } from "../../../src/ui/export-controls";

const collection: ExportCollection = {
  name: "Café picks",
  products: [
    {
      id: "6d4013e0-93e4-45a3-9298-16e69ce3af1e",
      capturedAt: "2026-08-28T12:00:00.000Z",
      source: { url: "https://shop.example.test/cafe", pageTitle: "Café" },
      name: "Machine Café",
      brand: "Baleen",
      price: "unknown",
      category: "unknown",
      specs: [],
      pros: [],
      cons: [],
      extraction: { method: "json-ld", model: "claude-sonnet-4-6" },
    },
  ],
};

describe("ExportControls", () => {
  it("offers the three formats and disables both actions for an empty collection", () => {
    const markup = renderToStaticMarkup(
      <ExportControls
        collection={{ name: "Vide", products: [] }}
        onCopy={vi.fn()}
        onDownload={vi.fn()}
      />,
    );

    expect(markup).toContain("Format d’export");
    expect(markup).toContain('value="markdown"');
    expect(markup).toContain('value="csv"');
    expect(markup).toContain('value="json"');
    expect(markup).toContain("Ajoutez au moins une fiche à cette collection pour l’exporter.");
    expect(markup.match(/disabled=""/gu)).toHaveLength(2);
  });

  it("keeps export status idle while another operation disables the controls", () => {
    const markup = renderToStaticMarkup(
      <ExportControls collection={collection} onCopy={vi.fn()} onDownload={vi.fn()} disabled />,
    );

    expect(markup).toContain("Export indisponible pendant une opération en cours.");
    expect(markup).toContain('role="status" aria-live="polite" aria-busy="false"');
  });

  it("sends the exact Markdown artifact to copy and keeps download separate", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const copiedArtifacts: ExportArtifact[] = [];
    const onCopy = vi.fn(async (artifact: ExportArtifact) => {
      copiedArtifacts.push(artifact);
      return { kind: "ok" as const };
    });
    const onDownload = vi.fn(async () => ({ kind: "ok" as const }));
    const root = createRoot(document.getElementById("root")!);

    await act(async () => {
      root.render(
        <ExportControls collection={collection} onCopy={onCopy} onDownload={onDownload} />,
      );
    });
    const buttons = document.querySelectorAll("button");
    await act(async () => {
      buttons[0]?.dispatchEvent(new window.Event("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onCopy).toHaveBeenCalledWith({
      filename: "cafe-picks.md",
      mimeType: "text/markdown",
      content: [
        "# Café picks\n\n| Attribute | Machine Café |\n| --- | --- |\n| Name | Machine Café |\n| Brand | Baleen |\n| Price | unknown |\n| Category | unknown |\n| Pros | unknown |\n| Cons | unknown |\n| Source URL | https://shop.example.test/cafe |\n| Page title | Café |\n| Captured at | 2026-08-28T12:00:00.000Z |\n",
        "| Extraction method | json-ld |\n",
        "| Extraction model | claude-sonnet-4-6 |\n",
      ].join(""),
    });
    expect(onDownload).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Export copié dans le presse-papiers.");

    await act(async () => {
      buttons[1]?.dispatchEvent(new window.Event("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(onDownload).toHaveBeenCalledWith(copiedArtifacts[0]);
    expect(document.body.textContent).toContain("Export téléchargé.");
    root.unmount();
  });

  it("reports a typed writer failure without exposing external error details", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const onCopy = vi.fn(async () => ({ kind: "error" as const, code: "unavailable" as const }));
    const root = createRoot(document.getElementById("root")!);

    await act(async () => {
      root.render(<ExportControls collection={collection} onCopy={onCopy} onDownload={vi.fn()} />);
    });
    await act(async () => {
      document.querySelector("button")?.dispatchEvent(new window.Event("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("Copie impossible.");
    expect(document.body.textContent).not.toContain("unavailable");
    expect(document.body.textContent).toContain("Réessayer copie");
    const retryButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Réessayer copie",
    );
    expect(retryButton).toBeDefined();
    root.unmount();
  });

  it("announces a busy copy and prevents a duplicate write until it completes", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    let releaseCopy: ((result: ExportWriteResult) => void) | undefined;
    const copyPending = new Promise<ExportWriteResult>((resolve) => {
      releaseCopy = resolve;
    });
    const onCopy = vi.fn(() => copyPending);
    const root = createRoot(document.getElementById("root")!);

    await act(async () => {
      root.render(<ExportControls collection={collection} onCopy={onCopy} onDownload={vi.fn()} />);
    });
    const copyButton = document.querySelector("button") as HTMLButtonElement;
    await act(async () => {
      copyButton.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    expect(copyButton.disabled).toBe(true);
    expect(copyButton.textContent).toBe("Copie en cours…");
    expect(document.body.textContent).toContain("Copie en cours…");
    await act(async () => {
      copyButton.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    expect(onCopy).toHaveBeenCalledOnce();

    releaseCopy?.({ kind: "ok" });
    await act(async () => {
      await copyPending;
    });
    expect(document.body.textContent).toContain("Export copié dans le presse-papiers.");
    root.unmount();
  });
});
