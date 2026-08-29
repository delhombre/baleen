import { renderToStaticMarkup } from "react-dom/server";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";

import type { ExportWriteResult } from "../../../src/adapters/browser/export-writers";
import type { Collection } from "../../../src/core/collection";
import type { ProductRecord } from "../../../src/core/product-record";
import type { ExtractionSuccess } from "../../../src/core/raw-product";
import { CollectionsView } from "../../../src/ui/collections-view";

const product: ProductRecord = {
  id: "6d4013e0-93e4-45a3-9298-16e69ce3af1e",
  capturedAt: "2026-08-28T12:00:00.000Z",
  source: { url: "https://shop.example.test/crispwave", pageTitle: "CrispWave" },
  name: "CrispWave",
  brand: "Baleen",
  price: "unknown",
  category: "Air fryer",
  specs: [{ label: "Capacity", value: "5.5 L" }],
  pros: [],
  cons: [],
  extraction: { method: "json-ld", model: "claude-sonnet-4-6" },
};

const collection = (name: string, products: readonly ProductRecord[] = []): Collection => ({
  id:
    name === "Air fryers"
      ? "4c1ee929-6c05-42e8-bfdc-8dfb602ca0db"
      : "9df4e444-6d40-45a2-a09d-4bd2e05d7b1d",
  name,
  products,
});

const callbacks = () => ({
  onCreateCollection: vi.fn(),
  onSelectCollection: vi.fn(),
  onRenameCollection: vi.fn(),
  onDeleteCollection: vi.fn(),
  onCapture: vi.fn(),
  onCopyExport: vi.fn((): ExportWriteResult => ({ kind: "ok" })),
  onDownloadExport: vi.fn((): ExportWriteResult => ({ kind: "ok" })),
});

describe("CollectionsView", () => {
  it("exposes loading and storage failure as public accessible states", () => {
    const props = callbacks();
    const onRetryStorage = vi.fn();
    const loading = renderToStaticMarkup(
      <CollectionsView state={{ kind: "loading" }} {...props} />,
    );
    const error = renderToStaticMarkup(
      <CollectionsView
        state={{ kind: "storage-error" }}
        onRetryStorage={onRetryStorage}
        {...props}
      />,
    );

    expect(loading).toContain("Chargement des collections…");
    expect(loading).toContain('aria-busy="true"');
    expect(error).toContain("Impossible de charger vos collections");
    expect(error).toContain('role="alert"');
    expect(error).toContain("Réessayer");
  });

  it("puts the active collection and capture CTA before closed collection management", () => {
    const props = callbacks();
    const firstCollection = collection("Air fryers", [product]);
    const secondCollection = collection("Espresso");
    const collections = [firstCollection, secondCollection];
    const markup = renderToStaticMarkup(
      <CollectionsView
        state={{ kind: "ready", collections, currentCollectionId: firstCollection.id }}
        {...props}
      />,
    );

    expect(markup).toContain("Collection courante");
    expect(markup).toContain(`value="${firstCollection.id}" selected`);
    expect(markup).toContain("Capturer cette page produit");
    expect(markup).not.toContain("Capturer une page produit");
    expect(markup).toContain("<details");
    expect(markup).not.toMatch(/<details[^>]*open/);
    expect(markup.indexOf("Capturer cette page produit")).toBeLessThan(
      markup.indexOf("Gérer les collections"),
    );
    expect(markup).toContain("CrispWave");
    expect(markup).toContain("https://shop.example.test/crispwave");
  });

  it("passes the exact current collection export artifact to the copy callback", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const props = callbacks();
    const firstCollection = collection("Air fryers", [product]);
    const root = createRoot(document.getElementById("root")!);

    await act(async () => {
      root.render(
        <CollectionsView
          state={{
            kind: "ready",
            collections: [firstCollection],
            currentCollectionId: firstCollection.id,
          }}
          {...props}
        />,
      );
    });

    const copyButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Copier l’export",
    );
    expect(copyButton).toBeDefined();
    await act(async () => {
      copyButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(props.onCopyExport).toHaveBeenCalledWith({
      filename: "air-fryers.md",
      mimeType: "text/markdown",
      content:
        "# Air fryers\n\n" +
        "| Attribute | CrispWave |\n" +
        "| --- | --- |\n" +
        "| Name | CrispWave |\n" +
        "| Brand | Baleen |\n" +
        "| Price | unknown |\n" +
        "| Category | Air fryer |\n" +
        "| Capacity | 5.5 L |\n" +
        "| Pros | unknown |\n" +
        "| Cons | unknown |\n" +
        "| Source URL | https://shop.example.test/crispwave |\n" +
        "| Page title | CrispWave |\n" +
        "| Captured at | 2026-08-28T12:00:00.000Z |\n" +
        "| Extraction method | json-ld |\n" +
        "| Extraction model | claude-sonnet-4-6 |\n",
    });
    root.unmount();
  });

  it("renders the no-collection onboarding and empty current collection states", () => {
    const props = callbacks();
    const noCollection = renderToStaticMarkup(
      <CollectionsView state={{ kind: "ready", collections: [] }} {...props} />,
    );
    const emptyCurrent = renderToStaticMarkup(
      <CollectionsView
        state={{ kind: "ready", collections: [collection("Air fryers")] }}
        {...props}
      />,
    );

    expect(noCollection).toContain("Aucune collection");
    expect(noCollection).toContain("Créez une collection pour organiser vos fiches produit.");
    expect(noCollection).toContain("Créer la collection");
    expect(noCollection).not.toContain("Capturer cette page produit");
    expect(emptyCurrent).toContain("Aucune fiche dans cette collection");
    expect(emptyCurrent).toContain("Ajoutez au moins deux fiches pour comparer.");
    expect(emptyCurrent).not.toContain("Exporter la collection");
    expect(emptyCurrent).not.toContain("Format d’export");
  });

  it("lets the user switch between the collection list and comparison views", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const props = callbacks();
    const secondProduct = {
      ...product,
      id: "9df4e444-6d40-45a2-a09d-4bd2e05d7b1d",
      name: "Barista Mini",
    };
    const root = createRoot(document.getElementById("root")!);
    await act(async () => {
      root.render(
        <CollectionsView
          state={{
            kind: "ready",
            collections: [collection("Air fryers", [product, secondProduct])],
          }}
          {...props}
        />,
      );
    });

    expect(document.querySelector("table")).toBeNull();
    const comparisonButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Comparaison",
    );
    expect(comparisonButton).toBeDefined();
    await act(async () => {
      comparisonButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    expect(document.querySelector("table")).not.toBeNull();

    const listButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Liste",
    );
    expect(listButton).toBeDefined();
    await act(async () => {
      listButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    expect(document.querySelector("table")).toBeNull();
    await act(async () => {
      root.unmount();
    });
  });

  it("exposes collection view toggles with one accessible panel", async () => {
    const props = callbacks();
    const firstCollection = collection("Air fryers", [
      product,
      { ...product, id: "b7a9e9e8-7345-4f1a-9a2e-3bb7e9a54b41", name: "Espresso" },
    ]);
    const markup = renderToStaticMarkup(
      <CollectionsView
        state={{
          kind: "ready",
          collections: [firstCollection],
          currentCollectionId: firstCollection.id,
        }}
        {...props}
      />,
    );

    expect(markup).toContain('aria-label="Vue de la collection"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).not.toContain('role="tab"');
    expect(markup).not.toContain('role="tablist"');
    expect(markup).not.toContain('aria-controls="collection-list-panel"');
    expect(markup).not.toContain('aria-controls="collection-comparison-panel"');
    expect(markup).toMatch(
      /aria-pressed="true"[^>]*class="[^"]*min-h-11[^"]*min-w-11[^"]*"[^>]*>Liste/,
    );
    expect(markup).toMatch(
      /aria-pressed="false"[^>]*class="[^"]*min-h-11[^"]*min-w-11[^"]*"[^>]*>Comparaison/,
    );
    expect(markup).toMatch(
      /aria-pressed="true"[^>]*class="[^"]*rounded-xl[^"]*bg-slate-100[^"]*text-slate-950[^"]*"[^>]*>Liste/,
    );
    expect(markup).toMatch(
      /aria-pressed="false"[^>]*class="[^"]*rounded-xl[^"]*"[^>]*>Comparaison/,
    );

    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const root = createRoot(document.getElementById("root")!);
    await act(async () => {
      root.render(
        <CollectionsView
          state={{
            kind: "ready",
            collections: [firstCollection],
            currentCollectionId: firstCollection.id,
          }}
          {...props}
        />,
      );
    });
    const comparisonButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Comparaison",
    );
    await act(async () => {
      comparisonButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    expect(comparisonButton?.getAttribute("aria-pressed")).toBe("true");
    expect(
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent === "Liste")
        ?.getAttribute("aria-pressed"),
    ).toBe("false");
    expect(document.querySelector('section[role="region"] h2')).not.toBeNull();
    expect(document.querySelectorAll('section[role="region"]')).toHaveLength(1);
    root.unmount();
  });

  it("keeps collection creation and rename text inputs at the 44px touch target", () => {
    const props = callbacks();
    const firstCollection = collection("Air fryers");
    const noCollectionMarkup = renderToStaticMarkup(
      <CollectionsView state={{ kind: "ready", collections: [] }} {...props} />,
    );
    const collectionMarkup = renderToStaticMarkup(
      <CollectionsView state={{ kind: "ready", collections: [firstCollection] }} {...props} />,
    );
    expect(noCollectionMarkup).toMatch(
      /id="new-collection-name"[^>]*class="[^"]*min-h-11[^"]*text-base/,
    );
    expect(collectionMarkup).toMatch(
      /id="new-collection-name"[^>]*class="[^"]*min-h-11[^"]*text-base/,
    );
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const root = createRoot(document.getElementById("root")!);
    act(() => {
      root.render(
        <CollectionsView state={{ kind: "ready", collections: [firstCollection] }} {...props} />,
      );
    });
    const renameButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Renommer",
    );
    act(() => {
      renameButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    const renameInput = document.querySelector(
      'input[id="rename-input-' + firstCollection.id + '"]',
    );
    expect(renameInput?.className).toContain("min-h-11");
    expect(renameInput?.className).toContain("text-base");
    root.unmount();
  });

  it("focuses the delete confirmation and restores the trigger", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const focusCalls: Element[] = [];
    Object.defineProperty(window.HTMLElement.prototype, "focus", {
      configurable: true,
      value: function (this: Element): void {
        focusCalls.push(this);
      },
    });
    const props = callbacks();
    const firstCollection = collection("Air fryers");
    const root = createRoot(document.getElementById("root")!);
    await act(async () => {
      root.render(
        <CollectionsView
          state={{
            kind: "ready",
            collections: [firstCollection],
            currentCollectionId: firstCollection.id,
          }}
          {...props}
        />,
      );
    });
    const deleteButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Supprimer",
    ) as HTMLButtonElement;
    await act(async () => {
      deleteButton.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.getAttribute("aria-modal")).toBeNull();
    expect(dialog?.getAttribute("aria-describedby")).toBe(
      `delete-description-${firstCollection.id}`,
    );
    expect(focusCalls.at(-1)?.textContent).toBe("Confirmer la suppression");

    await act(async () => {
      const escapeEvent = new window.Event("keydown", { bubbles: true });
      Object.defineProperty(escapeEvent, "key", { value: "Escape" });
      dialog?.dispatchEvent(escapeEvent);
    });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(focusCalls.at(-1)).toBe(deleteButton);
    root.unmount();
  });

  it("does not start a capture while no collection is selected", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const props = callbacks();
    const root = createRoot(document.getElementById("root")!);
    await act(async () => {
      root.render(<CollectionsView state={{ kind: "ready", collections: [] }} {...props} />);
    });

    const captureButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Capturer cette page produit",
    );
    expect(captureButton).toBeUndefined();
    expect(props.onCapture).not.toHaveBeenCalled();
    await act(async () => {
      root.unmount();
    });
  });

  it("keeps collection actions and export disabled until selection persistence renders the target", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const props = callbacks();
    const firstCollection = collection("Air fryers", [product]);
    const secondProduct = {
      ...product,
      id: "b7a9e9e8-7345-4f1a-9a2e-3bb7e9a54b41",
      name: "Espresso",
    };
    const secondCollection = collection("Espresso", [secondProduct]);
    const collections = [firstCollection, secondCollection];
    let releaseSelection: (() => void) | undefined;
    const selectionPending = new Promise<void>((resolve) => {
      releaseSelection = resolve;
    });

    const SelectionHarness = () => {
      const [currentCollectionId, setCurrentCollectionId] = useState(firstCollection.id);
      const [collectionMutation, setCollectionMutation] = useState<"selecting" | undefined>();
      const selectCollection = (collectionId: string): void => {
        setCollectionMutation("selecting");
        void selectionPending.then(() => {
          setCurrentCollectionId(collectionId);
          setCollectionMutation(undefined);
        });
      };

      return (
        <CollectionsView
          state={{ kind: "ready", collections, currentCollectionId }}
          {...props}
          onSelectCollection={selectCollection}
          collectionMutation={collectionMutation}
        />
      );
    };

    const root = createRoot(document.getElementById("root")!);
    await act(async () => {
      root.render(<SelectionHarness />);
    });

    const selector = document.querySelector("#collection-selector") as HTMLSelectElement;
    await act(async () => {
      Object.defineProperty(selector, "value", {
        configurable: true,
        value: secondCollection.id,
      });
      selector.dispatchEvent(new window.Event("change", { bubbles: true }));
    });

    expect(selector.disabled).toBe(true);
    expect(document.body.textContent).toContain("Sélection de la collection en cours");
    expect(
      Array.from(document.querySelectorAll("button"))
        .filter((button) =>
          [
            "Renommer",
            "Supprimer",
            "Créer la collection",
            "Capturer cette page produit",
            "Copier l’export",
            "Télécharger l’export",
          ].includes(button.textContent ?? ""),
        )
        .every((button) => button.disabled),
    ).toBe(true);

    const copyButtonWhileMutating = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Copier l’export",
    );
    expect(copyButtonWhileMutating?.disabled).toBe(true);
    await act(async () => {
      copyButtonWhileMutating?.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    expect(props.onCopyExport).not.toHaveBeenCalled();

    releaseSelection?.();
    await act(async () => {
      await selectionPending;
    });

    expect(selector.disabled).toBe(false);
    expect(selector.value).toBe(secondCollection.id);
    const copyButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Copier l’export",
    );
    expect(copyButton?.disabled).toBe(false);
    await act(async () => {
      copyButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(props.onCopyExport).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "espresso.md",
        content: expect.stringContaining("| Name | Espresso |"),
      }),
    );
    root.unmount();
  });

  it("locks selection, collection actions, and export while capture is pending", () => {
    const props = callbacks();
    const firstCollection = collection("Air fryers", [product]);
    const markup = renderToStaticMarkup(
      <CollectionsView
        state={{
          kind: "ready",
          collections: [firstCollection],
          currentCollectionId: firstCollection.id,
        }}
        captureStatus="capturing"
        {...props}
      />,
    );

    expect(markup).toContain("Capture en cours…");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toMatch(/<select[^>]*id="collection-selector"[^>]*disabled/);
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>Capture en cours…/);
    expect(markup).toContain("Exporter la collection");
    expect(markup.match(/<button[^>]*disabled[^>]*>Renommer/g)?.length).toBe(1);
    expect(markup.match(/<button[^>]*disabled[^>]*>Supprimer/g)?.length).toBe(1);
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>Copier l’export/);
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>Télécharger l’export/);
  });

  it("shows a visible error instead of submitting a blank renamed collection", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const props = callbacks();
    const firstCollection = collection("Air fryers");
    const root = createRoot(document.getElementById("root")!);
    await act(async () => {
      root.render(
        <CollectionsView state={{ kind: "ready", collections: [firstCollection] }} {...props} />,
      );
    });

    const renameButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Renommer",
    );
    expect(renameButton).toBeDefined();
    await act(async () => {
      renameButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    const input = document.getElementById(`rename-input-${firstCollection.id}`) as HTMLInputElement;
    const form = input.closest("form")!;
    await act(async () => {
      input.value = "";
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
      form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(props.onRenameCollection).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Le nom de la collection ne peut pas être vide.");
    await act(async () => {
      root.unmount();
    });
  });

  it("exposes structured capture recovery without a conflicting polite alert live region", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const props = callbacks();
    const onRetryCapture = vi.fn();
    const root = createRoot(document.getElementById("root")!);
    await act(async () => {
      root.render(
        <CollectionsView
          state={{ kind: "ready", collections: [collection("Air fryers")] }}
          notice={{
            kind: "error",
            code: "not-product",
            message: "Ouvrez une page produit, puis réessayez.",
            action: { kind: "retry-capture" },
          }}
          onRetryCapture={onRetryCapture}
          {...props}
        />,
      );
    });

    const alert = document.querySelector('[role="alert"]');
    expect(alert?.getAttribute("aria-live")).toBeNull();
    const retryButton = Array.from(alert?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Réessayer",
    );
    expect(retryButton).toBeDefined();
    await act(async () => {
      retryButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    expect(onRetryCapture).toHaveBeenCalledOnce();
    root.unmount();
  });

  it("preserves a typed collection name when creation persistence fails", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const props = callbacks();
    props.onCreateCollection = vi.fn(async () => false);
    const root = createRoot(document.getElementById("root")!);
    await act(async () => {
      root.render(<CollectionsView state={{ kind: "ready", collections: [] }} {...props} />);
    });

    const input = document.getElementById("new-collection-name") as HTMLInputElement;
    const form = input.closest("form")!;
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "Cuisine du soir");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    expect(input.value).toBe("Cuisine du soir");
    await act(async () => {
      form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(props.onCreateCollection).toHaveBeenCalledWith("Cuisine du soir");
    expect((document.getElementById("new-collection-name") as HTMLInputElement).value).toBe(
      "Cuisine du soir",
    );
    root.unmount();
  });

  it("focuses the rename field, preserves it on failure, and cancels with Escape", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const focusCalls: Element[] = [];
    Object.defineProperty(window.HTMLElement.prototype, "focus", {
      configurable: true,
      value: function (this: Element): void {
        focusCalls.push(this);
      },
    });
    const props = callbacks();
    props.onRenameCollection = vi.fn(async () => false);
    const firstCollection = collection("Air fryers");
    const root = createRoot(document.getElementById("root")!);
    await act(async () => {
      root.render(
        <CollectionsView state={{ kind: "ready", collections: [firstCollection] }} {...props} />,
      );
    });

    const renameButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Renommer",
    )!;
    await act(async () => {
      renameButton.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    expect(focusCalls.at(-1)?.id).toBe(`rename-input-${firstCollection.id}`);

    const input = document.getElementById(`rename-input-${firstCollection.id}`) as HTMLInputElement;
    const form = input.closest("form")!;
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "Air fryers du soir");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(document.getElementById(`rename-input-${firstCollection.id}`)).not.toBeNull();
    expect(
      (document.getElementById(`rename-input-${firstCollection.id}`) as HTMLInputElement).value,
    ).toBe("Air fryers du soir");
    expect(focusCalls.at(-1)?.id).toBe(`rename-input-${firstCollection.id}`);

    await act(async () => {
      const escapeEvent = new window.Event("keydown", { bubbles: true });
      Object.defineProperty(escapeEvent, "key", { value: "Escape" });
      form.dispatchEvent(escapeEvent);
    });
    expect(document.getElementById(`rename-input-${firstCollection.id}`)).toBeNull();
    expect(focusCalls.at(-1)?.textContent).toBe("Renommer");
    root.unmount();
  });

  it("keeps the deletion confirmation open when deletion persistence fails", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const props = callbacks();
    props.onDeleteCollection = vi.fn(async () => false);
    const firstCollection = collection("Air fryers");
    const root = createRoot(document.getElementById("root")!);
    await act(async () => {
      root.render(
        <CollectionsView state={{ kind: "ready", collections: [firstCollection] }} {...props} />,
      );
    });

    const deleteButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Supprimer",
    )!;
    await act(async () => {
      deleteButton.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    const confirmButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Confirmer la suppression",
    )!;
    await act(async () => {
      confirmButton.dispatchEvent(new window.Event("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    root.unmount();
  });

  it("keeps a pending delete dialog stable and restores focus after success", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const props = callbacks();
    const firstCollection = collection("Air fryers");
    let releaseDeletion: (() => void) | undefined;
    const deletionPending = new Promise<void>((resolve) => {
      releaseDeletion = resolve;
    });
    const DeleteHarness = () => {
      const [collectionMutation, setCollectionMutation] = useState<"deleting" | undefined>();
      const onDeleteCollection = (): Promise<boolean> => {
        setCollectionMutation("deleting");
        return deletionPending.then(() => {
          setCollectionMutation(undefined);
          return true;
        });
      };
      return (
        <CollectionsView
          state={{ kind: "ready", collections: [firstCollection] }}
          {...props}
          onDeleteCollection={onDeleteCollection}
          collectionMutation={collectionMutation}
        />
      );
    };
    const root = createRoot(document.getElementById("root")!);
    await act(async () => {
      root.render(<DeleteHarness />);
    });
    const deleteButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Supprimer",
    )!;
    await act(async () => {
      deleteButton.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    const dialog = document.querySelector('[role="alertdialog"]')!;
    const confirmButton = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent === "Confirmer la suppression",
    )!;
    await act(async () => {
      confirmButton.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(confirmButton.disabled).toBe(true);
    await act(async () => {
      const escapeEvent = new window.Event("keydown", { bubbles: true });
      Object.defineProperty(escapeEvent, "key", { value: "Escape" });
      dialog.dispatchEvent(escapeEvent);
    });
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();

    releaseDeletion?.();
    await act(async () => {
      await deletionPending;
    });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    root.unmount();
  });

  it("keeps a pending delete dialog open and focusable after rejection", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const focusCalls: Element[] = [];
    Object.defineProperty(window.HTMLElement.prototype, "focus", {
      configurable: true,
      value: function (this: Element): void {
        focusCalls.push(this);
      },
    });
    const props = callbacks();
    const firstCollection = collection("Air fryers");
    let rejectDeletion: ((error: Error) => void) | undefined;
    const deletionPending = new Promise<boolean>((_, reject) => {
      rejectDeletion = reject;
    });
    const DeleteHarness = () => {
      const [collectionMutation, setCollectionMutation] = useState<"deleting" | undefined>();
      const onDeleteCollection = (): Promise<boolean> => {
        setCollectionMutation("deleting");
        return deletionPending.then(
          (result) => {
            setCollectionMutation(undefined);
            return result;
          },
          (error: unknown) => {
            setCollectionMutation(undefined);
            throw error;
          },
        );
      };
      return (
        <CollectionsView
          state={{ kind: "ready", collections: [firstCollection] }}
          {...props}
          onDeleteCollection={onDeleteCollection}
          collectionMutation={collectionMutation}
        />
      );
    };
    const root = createRoot(document.getElementById("root")!);
    await act(async () => {
      root.render(<DeleteHarness />);
    });
    const deleteButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Supprimer",
    )!;
    await act(async () => {
      deleteButton.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    const confirmButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Confirmer la suppression",
    )!;
    await act(async () => {
      confirmButton.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    rejectDeletion?.(new Error("storage unavailable"));
    await act(async () => {
      await deletionPending.catch(() => undefined);
    });
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(focusCalls.at(-1)?.textContent).toBe("Confirmer la suppression");
    root.unmount();
  });

  it("exposes capture progress and typed mutation failures visibly", () => {
    const props = callbacks();
    const markup = renderToStaticMarkup(
      <CollectionsView
        state={{ kind: "ready", collections: [collection("Air fryers")] }}
        captureStatus="normalizing"
        notice={{
          kind: "error",
          code: "storage-unavailable",
          message: "Le stockage local est indisponible.",
        }}
        {...props}
      />,
    );

    expect(markup).toContain("Normalisation en cours…");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Le stockage local est indisponible.");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("Stockage local indisponible");
    expect(markup).not.toContain("Une action nécessite votre attention");
  });

  it("renders a named error card with an explicit recovery action", () => {
    const markup = renderToStaticMarkup(
      <CollectionsView
        state={{ kind: "ready", collections: [collection("Air fryers")] }}
        notice={{
          kind: "error",
          code: "unavailable",
          provider: "groq",
          message: "Le fournisseur est momentanément indisponible.",
          action: { kind: "retry-capture" },
        }}
        {...callbacks()}
      />,
    );

    expect(markup).toMatch(
      /<section[^>]*role="alert"[^>]*aria-labelledby="collections-notice-title"/u,
    );
    expect(markup).toContain('<svg aria-hidden="true"');
    expect(markup).toContain("Groq indisponible");
    expect(markup).not.toContain("Une action nécessite votre attention");
    expect(markup).toContain("Le fournisseur est momentanément indisponible.");
    expect(markup).toContain("Réessayer");
  });

  it.each([
    ["not-product", undefined, "Page produit non détectée"],
    ["ambiguous-product", undefined, "Plusieurs produits détectés"],
    ["configuration", "anthropic", "Configuration requise"],
    ["unauthorized", "groq", "Clé Groq refusée"],
    ["quota", "anthropic", "Quota Anthropic atteint"],
    ["network", "groq", "Groq injoignable"],
    ["unavailable", "anthropic", "Anthropic indisponible"],
    ["invalid-response", undefined, "Réponse inexploitable"],
  ] as const)("uses typed public copy for %s", (code, provider, title) => {
    const markup = renderToStaticMarkup(
      <CollectionsView
        state={{ kind: "ready", collections: [collection("Air fryers")] }}
        notice={{
          kind: "error",
          code,
          ...(provider === undefined ? {} : { provider }),
          message: "Une explication utile sans répéter le titre.",
          action: { kind: "retry-capture" },
        }}
        {...callbacks()}
      />,
    );

    expect(markup).toContain(title);
    expect(markup).toContain("Une explication utile sans répéter le titre.");
    expect(markup).toContain("Réessayer");
    expect(markup).not.toContain("Une action nécessite votre attention");
  });

  it.each([
    ["unauthorized", "Clé API refusée"],
    ["quota", "Quota du fournisseur atteint"],
    ["network", "Fournisseur injoignable"],
    ["unavailable", "Service indisponible"],
  ] as const)("does not invent Anthropic when %s has no provider", (code, title) => {
    const markup = renderToStaticMarkup(
      <CollectionsView
        state={{ kind: "ready", collections: [collection("Air fryers")] }}
        notice={{
          kind: "error",
          code,
          message: "Une explication utile sans fournisseur inventé.",
        }}
        {...callbacks()}
      />,
    );

    expect(markup).toContain(title);
    expect(markup).toContain("Une explication utile sans fournisseur inventé.");
    expect(markup).not.toContain("Anthropic");
  });

  it("keeps raw capture details collapsed after a product is added", () => {
    const props = callbacks();
    const extraction: ExtractionSuccess = {
      kind: "success",
      source: {
        url: "https://shop.example.test/crispwave",
        pageTitle: "CrispWave",
        capturedAt: "2026-08-28T12:00:00.000Z",
      },
      method: "dom-fallback",
      content: "Title: CrispWave",
      truncated: false,
    };
    const markup = renderToStaticMarkup(
      <CollectionsView
        state={{ kind: "ready", collections: [collection("Air fryers", [product])] }}
        lastCapture={{ record: product, extraction }}
        {...props}
      />,
    );

    expect(markup).toContain("Fiche normalisée");
    expect(markup).toContain("Détails de capture");
    expect(markup).toMatch(/<details(?![^>]*open)/);
    expect(markup.match(/CrispWave/g)?.length).toBeGreaterThan(0);
  });

  it("does not call creation for a blank name", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const props = callbacks();
    const root = createRoot(document.getElementById("root")!);
    await act(async () => {
      root.render(<CollectionsView state={{ kind: "ready", collections: [] }} {...props} />);
    });

    const input = document.getElementById("new-collection-name") as HTMLInputElement;
    const form = input.closest("form")!;
    await act(async () => {
      input.value = "   ";
      input.dispatchEvent(
        new window.InputEvent("input", { bubbles: true, data: "   ", inputType: "insertText" }),
      );
      form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(props.onCreateCollection).not.toHaveBeenCalled();
    await act(async () => {
      root.unmount();
    });
  });
});
