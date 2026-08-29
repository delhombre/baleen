import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";

import {
  createClipboardWriter,
  createDownloadWriter,
} from "../../src/adapters/browser/export-writers";
import { captureActiveTab } from "../../src/adapters/chrome/capture-page";
import { createCollectionStorage } from "../../src/adapters/chrome/collection-storage";
import {
  createCollectionsController,
  type CollectionsControllerErrorCode,
  type CollectionsControllerResult,
} from "../../src/adapters/chrome/collections-controller";
import { normalizeCapturedProduct } from "../../src/adapters/chrome/runtime-client";
import type { ExportArtifact } from "../../src/core/export-artifact";
import { resolveCurrentCollectionId } from "../../src/core/collection";
import type { LlmProvider } from "../../src/core/llm-provider";
import type { ProductRecord } from "../../src/core/product-record";
import type {
  CollectionMutation,
  CollectionsNotice,
  CollectionsNoticeAction,
  CollectionsNoticeErrorCode,
  CollectionsViewState,
} from "../../src/ui/collections-view";
import { CollectionsView } from "../../src/ui/collections-view";
import type { ExtractionSuccess } from "../../src/core/raw-product";
import "../../src/ui/styles.css";

const app = document.getElementById("app");

if (!app) {
  throw new Error("Side panel mount point is missing.");
}

function readyState(result: CollectionsControllerResult): CollectionsViewState | undefined {
  if (result.kind !== "success") {
    return undefined;
  }
  return {
    kind: "ready",
    collections: result.snapshot.collections,
    currentCollectionId: result.snapshot.currentCollectionId ?? undefined,
  };
}

function errorNotice(
  code: CollectionsNoticeErrorCode,
  message: string,
  options: { readonly action?: CollectionsNoticeAction; readonly provider?: LlmProvider } = {},
): CollectionsNotice {
  return { kind: "error", code, message, ...options };
}

function providerLabel(provider: LlmProvider | undefined): string {
  if (provider === undefined) {
    return "fournisseur non déterminé";
  }
  return provider === "groq" ? "Groq" : "Anthropic";
}

function controllerErrorNotice(code: CollectionsControllerErrorCode): CollectionsNotice {
  switch (code) {
    case "invalid-name":
      return errorNotice(
        "configuration",
        "Le nom de collection ne peut pas être vide. Saisissez un nom, puis réessayez.",
      );
    case "not-found":
      return errorNotice(
        "collection-not-found",
        "Elle a peut-être été supprimée ailleurs. Rechargez le panneau, puis réessayez.",
      );
    case "no-current-collection":
      return errorNotice(
        "configuration",
        "Créez ou sélectionnez une collection avant de capturer une fiche.",
      );
    case "not-loaded":
      return errorNotice(
        "configuration",
        "Le chargement des collections n’est pas terminé. Attendez quelques instants, puis réessayez.",
      );
    case "invalid-data":
      return errorNotice(
        "configuration",
        "Baleen n’a rien enregistré. Vérifiez vos collections, puis réessayez.",
      );
    case "quota":
      return errorNotice("storage-quota", "Supprimez une fiche ou une collection, puis réessayez.");
    case "unavailable":
      return errorNotice("storage-unavailable", "Le stockage local ne répond pas. Réessayez.", {
        action: { kind: "retry-storage" },
      });
  }
}

function captureErrorNotice(
  code: "not-product" | "ambiguous-product" | "unavailable-page",
): CollectionsNotice {
  switch (code) {
    case "not-product":
      return errorNotice(
        "not-product",
        "Baleen n’a pas trouvé assez d’informations produit. Ouvrez une page produit, puis réessayez.",
        { action: { kind: "retry-capture" } },
      );
    case "ambiguous-product":
      return errorNotice(
        "ambiguous-product",
        "Baleen ne sait pas lequel choisir. Ouvrez une page dédiée à un seul produit, puis réessayez.",
        { action: { kind: "retry-capture" } },
      );
    case "unavailable-page":
      return errorNotice(
        "unavailable-page",
        "Baleen ne peut pas lire cette page active. Ouvrez une page produit http(s), rechargez-la, puis réessayez.",
        { action: { kind: "retry-capture" } },
      );
  }
}

function normalizationErrorNotice(
  code: "missing-key" | "unauthorized" | "quota" | "network" | "unavailable" | "invalid-response",
  provider: LlmProvider | undefined,
): CollectionsNotice {
  const name = providerLabel(provider);
  switch (code) {
    case "missing-key":
      return errorNotice(
        "configuration",
        `Ajoutez une clé ${name} dans Paramètres, puis réessayez.`,
        { action: { kind: "open-options" }, provider },
      );
    case "unauthorized":
      return errorNotice(
        "unauthorized",
        "Le fournisseur a rejeté cette clé. Vérifiez-la dans Paramètres, puis réessayez.",
        { action: { kind: "open-options" }, provider },
      );
    case "quota":
      return errorNotice(
        "quota",
        "Le fournisseur refuse cette requête pour le moment. Attendez le renouvellement du quota, puis réessayez.",
        { action: { kind: "retry-capture" }, provider },
      );
    case "network":
      return errorNotice(
        "network",
        "Baleen n’a pas pu joindre le fournisseur. Vérifiez votre connexion, puis réessayez.",
        { action: { kind: "retry-capture" }, provider },
      );
    case "unavailable":
      return errorNotice(
        "unavailable",
        "Le fournisseur ne répond pas actuellement. Réessayez dans quelques instants.",
        { action: { kind: "retry-capture" }, provider },
      );
    case "invalid-response":
      return errorNotice(
        "invalid-response",
        "Le format reçu ne contient pas une fiche valide et aucun fait n’a été ajouté. Réessayez.",
        { action: { kind: "retry-capture" }, provider },
      );
  }
}

function SidePanelApp() {
  const controller = useMemo(
    () =>
      createCollectionsController(createCollectionStorage(browser.storage.local), () =>
        crypto.randomUUID(),
      ),
    [],
  );
  const clipboardWriter = useMemo(() => createClipboardWriter(), []);
  const downloadWriter = useMemo(() => createDownloadWriter(), []);
  const [state, setState] = useState<CollectionsViewState>({ kind: "loading" });
  const [collectionMutation, setCollectionMutation] = useState<CollectionMutation>();
  const [captureStatus, setCaptureStatus] = useState<"capturing" | "normalizing">();
  const [notice, setNotice] = useState<CollectionsNotice>();
  const [lastCapture, setLastCapture] = useState<{
    readonly record: ProductRecord;
    readonly extraction: ExtractionSuccess;
  }>();
  const captureInFlight = useRef(false);
  const collectionMutationRef = useRef<CollectionMutation | undefined>(undefined);
  const pendingCollectionMutations = useRef(0);
  const loadGeneration = useRef(0);

  const applyLoadResult = useCallback((result: CollectionsControllerResult): void => {
    const nextState = readyState(result);
    if (nextState !== undefined) {
      setState(nextState);
      setNotice(undefined);
      return;
    }

    setState({
      kind: "storage-error",
      message:
        result.kind === "error"
          ? controllerErrorNotice(result.code).message
          : "Données persistées invalides. Baleen n’a pas utilisé ces données. Vérifiez le stockage, puis réessayez.",
    });
    setNotice(undefined);
  }, []);

  const loadCollections = useCallback(
    (showLoading: boolean): void => {
      const generation = ++loadGeneration.current;
      if (showLoading) {
        setState({ kind: "loading" });
      }
      void controller
        .load()
        .then((result) => {
          if (generation === loadGeneration.current) {
            applyLoadResult(result);
          }
        })
        .catch(() => {
          if (generation === loadGeneration.current) {
            applyLoadResult({ kind: "error", code: "unavailable" });
          }
        });
    },
    [applyLoadResult, controller],
  );

  useEffect(() => {
    loadCollections(false);
    return () => {
      loadGeneration.current += 1;
    };
  }, [loadCollections]);

  const onRetryStorage = useCallback((): void => {
    loadCollections(true);
  }, [loadCollections]);

  const applyResult = useCallback((result: CollectionsControllerResult): boolean => {
    const nextState = readyState(result);
    if (nextState !== undefined) {
      setState(nextState);
      setNotice(undefined);
      return true;
    }
    if (result.kind === "error") {
      setNotice(controllerErrorNotice(result.code));
    }
    return false;
  }, []);

  const beginCollectionMutation = useCallback((mutation: CollectionMutation): void => {
    pendingCollectionMutations.current += 1;
    collectionMutationRef.current = mutation;
    setCollectionMutation(mutation);
  }, []);

  const endCollectionMutation = useCallback((): void => {
    pendingCollectionMutations.current = Math.max(0, pendingCollectionMutations.current - 1);
    if (pendingCollectionMutations.current === 0) {
      collectionMutationRef.current = undefined;
      setCollectionMutation(undefined);
    }
  }, []);

  const runCollectionMutation = useCallback(
    async (
      mutation: CollectionMutation,
      operation: () => Promise<CollectionsControllerResult>,
    ): Promise<boolean> => {
      beginCollectionMutation(mutation);
      try {
        return applyResult(await operation());
      } catch {
        return applyResult({ kind: "error", code: "unavailable" });
      } finally {
        endCollectionMutation();
      }
    },
    [applyResult, beginCollectionMutation, endCollectionMutation],
  );

  const onCreateCollection = useCallback(
    (name: string): Promise<boolean> => {
      return runCollectionMutation("creating", () => controller.createCollection(name));
    },
    [controller, runCollectionMutation],
  );

  const onSelectCollection = useCallback(
    (collectionId: string): void => {
      void runCollectionMutation("selecting", () => controller.selectCollection(collectionId));
    },
    [controller, runCollectionMutation],
  );

  const onRenameCollection = useCallback(
    (collectionId: string, name: string): Promise<boolean> => {
      return runCollectionMutation("renaming", () =>
        controller.renameCollection(collectionId, name),
      );
    },
    [controller, runCollectionMutation],
  );

  const onDeleteCollection = useCallback(
    (collectionId: string): Promise<boolean> => {
      return runCollectionMutation("deleting", () => controller.deleteCollection(collectionId));
    },
    [controller, runCollectionMutation],
  );

  const onCopyExport = useCallback(
    (artifact: ExportArtifact) => {
      if (collectionMutationRef.current !== undefined || captureInFlight.current) {
        return { kind: "error" as const, code: "unavailable" as const };
      }
      return clipboardWriter.write(artifact);
    },
    [clipboardWriter],
  );

  const onDownloadExport = useCallback(
    (artifact: ExportArtifact) => {
      if (collectionMutationRef.current !== undefined || captureInFlight.current) {
        return { kind: "error" as const, code: "unavailable" as const };
      }
      return downloadWriter.write(artifact);
    },
    [downloadWriter],
  );

  const onCapture = useCallback(async (): Promise<void> => {
    if (captureInFlight.current || collectionMutationRef.current !== undefined) {
      return;
    }

    if (state.kind !== "ready") {
      return;
    }

    const targetCollectionId = resolveCurrentCollectionId(
      state.collections,
      state.currentCollectionId,
    );
    const targetCollection = state.collections.find(
      (collection) => collection.id === targetCollectionId,
    );
    if (targetCollectionId === undefined || targetCollection === undefined) {
      setNotice(controllerErrorNotice("no-current-collection"));
      return;
    }

    const targetCollectionName = targetCollection.name;
    captureInFlight.current = true;
    setNotice(undefined);
    setCaptureStatus("capturing");
    try {
      const extraction = await captureActiveTab(browser.tabs);
      if (extraction.kind !== "success") {
        setNotice(captureErrorNotice(extraction.code));
        return;
      }

      setCaptureStatus("normalizing");
      const normalized = await normalizeCapturedProduct(browser.runtime, extraction);
      if (normalized.kind !== "success") {
        setNotice(normalizationErrorNotice(normalized.code, normalized.provider));
        return;
      }
      const result = await controller.addProduct(targetCollectionId, normalized.record);
      const nextState = readyState(result);
      if (nextState === undefined) {
        if (result.kind === "error") {
          setNotice(controllerErrorNotice(result.code));
        }
        return;
      }
      setState(nextState);
      setLastCapture({ record: normalized.record, extraction });
      setNotice({ kind: "success", message: `Fiche ajoutée à « ${targetCollectionName} ».` });
    } catch {
      setNotice(
        errorNotice(
          "capture-failed",
          "Une erreur inattendue est survenue pendant la lecture ou la normalisation. Vérifiez la page, puis réessayez.",
          { action: { kind: "retry-capture" } },
        ),
      );
    } finally {
      captureInFlight.current = false;
      setCaptureStatus(undefined);
    }
  }, [controller, state]);

  return (
    <CollectionsView
      state={state}
      onCreateCollection={onCreateCollection}
      onSelectCollection={onSelectCollection}
      onRenameCollection={onRenameCollection}
      onDeleteCollection={onDeleteCollection}
      onCopyExport={onCopyExport}
      onDownloadExport={onDownloadExport}
      onCapture={() => {
        void onCapture();
      }}
      onRetryCapture={() => {
        void onCapture();
      }}
      onRetryStorage={onRetryStorage}
      onOpenOptions={() => {
        void browser.runtime.openOptionsPage();
      }}
      collectionMutation={collectionMutation}
      captureStatus={captureStatus}
      notice={notice}
      lastCapture={lastCapture}
    />
  );
}

createRoot(app).render(
  <StrictMode>
    <SidePanelApp />
  </StrictMode>,
);
