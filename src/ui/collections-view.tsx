import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";

import type { ExportWriteResult } from "../adapters/browser/export-writers";
import { resolveCurrentCollectionId, type Collection } from "../core/collection";
import type { ExportArtifact } from "../core/export-artifact";
import type { LlmProvider } from "../core/llm-provider";
import type { ExtractionSuccess } from "../core/raw-product";
import { ComparisonTable } from "./comparison-table";
import { ExportControls } from "./export-controls";
import { ProductCard } from "./product-card";

export type CollectionsViewState =
  | { readonly kind: "loading" }
  | { readonly kind: "storage-error"; readonly message?: string }
  | {
      readonly kind: "ready";
      readonly collections: readonly Collection[];
      readonly currentCollectionId?: string;
    };

export type CollectionMutation = "creating" | "selecting" | "renaming" | "deleting";

export type CollectionsNoticeAction =
  | { readonly kind: "retry-capture" }
  | { readonly kind: "open-options" }
  | { readonly kind: "retry-storage" };

export type CollectionsNoticeErrorCode =
  | "not-product"
  | "ambiguous-product"
  | "unavailable-page"
  | "configuration"
  | "unauthorized"
  | "quota"
  | "network"
  | "unavailable"
  | "invalid-response"
  | "storage-unavailable"
  | "storage-quota"
  | "collection-not-found"
  | "capture-failed";

type CollectionsNoticeBase = {
  readonly message: string;
  readonly action?: CollectionsNoticeAction;
};

export type CollectionsNotice =
  | (CollectionsNoticeBase & { readonly kind: "success" })
  | (CollectionsNoticeBase & {
      readonly kind: "error";
      readonly code: CollectionsNoticeErrorCode;
      readonly provider?: LlmProvider;
    });

export type CollectionsViewProps = {
  readonly state: CollectionsViewState;
  readonly onCreateCollection: (name: string) => void | Promise<boolean>;
  readonly onSelectCollection: (collectionId: string) => void;
  readonly onRenameCollection: (collectionId: string, name: string) => void | Promise<boolean>;
  readonly onDeleteCollection: (collectionId: string) => void | Promise<boolean>;
  readonly onCapture: () => void;
  readonly onRetryCapture?: () => void;
  readonly onRetryStorage?: () => void;
  readonly onOpenOptions?: () => void;
  readonly onCopyExport: (
    artifact: ExportArtifact,
  ) => ExportWriteResult | Promise<ExportWriteResult>;
  readonly onDownloadExport: (
    artifact: ExportArtifact,
  ) => ExportWriteResult | Promise<ExportWriteResult>;
  readonly collectionMutation?: CollectionMutation;
  readonly captureStatus?: "capturing" | "normalizing";
  readonly notice?: CollectionsNotice;
  readonly lastCapture?: {
    readonly record: Collection["products"][number];
    readonly extraction: ExtractionSuccess;
  };
};

function collectionLabel(collection: Collection): string {
  return `${collection.name} (${collection.products.length} fiche${collection.products.length === 1 ? "" : "s"})`;
}

function providerLabel(provider: LlmProvider): string {
  return provider === "groq" ? "Groq" : "Anthropic";
}

function noticeTitle(notice: Extract<CollectionsNotice, { readonly kind: "error" }>): string {
  switch (notice.code) {
    case "not-product":
      return "Page produit non détectée";
    case "ambiguous-product":
      return "Plusieurs produits détectés";
    case "unavailable-page":
      return "Page indisponible";
    case "configuration":
      return "Configuration requise";
    case "unauthorized":
      return notice.provider === undefined
        ? "Clé API refusée"
        : `Clé ${providerLabel(notice.provider)} refusée`;
    case "quota":
      return notice.provider === undefined
        ? "Quota du fournisseur atteint"
        : `Quota ${providerLabel(notice.provider)} atteint`;
    case "network":
      return notice.provider === undefined
        ? "Fournisseur injoignable"
        : `${providerLabel(notice.provider)} injoignable`;
    case "unavailable":
      return notice.provider === undefined
        ? "Service indisponible"
        : `${providerLabel(notice.provider)} indisponible`;
    case "invalid-response":
      return "Réponse inexploitable";
    case "storage-unavailable":
      return "Stockage local indisponible";
    case "storage-quota":
      return "Quota de stockage atteint";
    case "collection-not-found":
      return "Collection introuvable";
    case "capture-failed":
      return "Capture indisponible";
  }
}

type CreateCollectionFormProps = {
  readonly value: string;
  readonly error?: string;
  readonly disabled: boolean;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly onValueChange: (value: string) => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
};

function CreateCollectionForm({
  value,
  error,
  disabled,
  inputRef,
  onValueChange,
  onSubmit,
}: CreateCollectionFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4"
    >
      <div className="space-y-2">
        <label htmlFor="new-collection-name" className="text-sm font-semibold text-slate-100">
          Nom de la collection
        </label>
        <input
          id="new-collection-name"
          name="name"
          ref={inputRef}
          value={value}
          onChange={(event) => onValueChange(event.currentTarget.value)}
          onInput={(event) => onValueChange(event.currentTarget.value)}
          disabled={disabled}
          aria-invalid={error !== undefined}
          aria-describedby={error === undefined ? undefined : "new-collection-error"}
          className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-base text-slate-100 outline-cyan-300"
        />
      </div>
      {error !== undefined && (
        <p id="new-collection-error" role="alert" className="text-sm text-amber-200">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={disabled}
        className="min-h-11 min-w-11 rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950"
      >
        Créer la collection
      </button>
    </form>
  );
}

export function CollectionsView({
  state,
  onCreateCollection,
  onSelectCollection,
  onRenameCollection,
  onDeleteCollection,
  onCopyExport,
  onDownloadExport,
  onCapture,
  onRetryCapture,
  onRetryStorage,
  onOpenOptions,
  collectionMutation,
  captureStatus,
  notice,
  lastCapture,
}: CollectionsViewProps) {
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | undefined>();
  const [renamingId, setRenamingId] = useState<string | undefined>();
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | undefined>();
  const [deletingId, setDeletingId] = useState<string | undefined>();
  const [view, setView] = useState<"list" | "comparison">("list");
  const newCollectionInputRef = useRef<HTMLInputElement>(null);
  const renameInputRefs = useRef(new Map<string, HTMLInputElement>());
  const renameTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const deleteTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const deleteConfirmRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingDeleteFocusRef = useRef<
    { readonly deletedId: string; readonly targetId: string } | undefined
  >(undefined);
  const collectionActionsDisabled = collectionMutation !== undefined || captureStatus !== undefined;
  const exportDisabled = collectionActionsDisabled || captureStatus !== undefined;

  useEffect(() => {
    if (deletingId !== undefined) {
      deleteConfirmRefs.current.get(deletingId)?.focus();
    }
  }, [deletingId]);

  useEffect(() => {
    if (renamingId !== undefined) {
      renameInputRefs.current.get(renamingId)?.focus();
    }
  }, [renamingId]);

  useEffect(() => {
    const pendingFocus = pendingDeleteFocusRef.current;
    if (pendingFocus === undefined) {
      return;
    }
    if (
      state.kind === "ready" &&
      state.collections.some((collection) => collection.id === pendingFocus.deletedId)
    ) {
      return;
    }
    pendingDeleteFocusRef.current = undefined;
    const target = deleteTriggerRefs.current.get(pendingFocus.targetId);
    if (target !== undefined) {
      target.focus();
      return;
    }
    newCollectionInputRef.current?.focus();
  }, [deletingId, state]);

  const mutationMessage =
    collectionMutation === "creating"
      ? "Création de la collection en cours…"
      : collectionMutation === "selecting"
        ? "Sélection de la collection en cours…"
        : collectionMutation === "renaming"
          ? "Renommage de la collection en cours…"
          : "Suppression de la collection en cours…";

  const noticeAction = notice?.action;
  const runNoticeAction = (): void => {
    if (noticeAction?.kind === "retry-capture") {
      (onRetryCapture ?? onCapture)();
    } else if (noticeAction?.kind === "open-options") {
      onOpenOptions?.();
    } else if (noticeAction?.kind === "retry-storage") {
      onRetryStorage?.();
    }
  };

  const noticeActionLabel =
    noticeAction?.kind === "retry-capture"
      ? "Réessayer"
      : noticeAction?.kind === "open-options"
        ? "Ouvrir Paramètres"
        : noticeAction?.kind === "retry-storage"
          ? "Réessayer"
          : undefined;

  const submitCreate = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const name = newName.trim();
    if (name.length === 0) {
      setCreateError("Le nom de la collection ne peut pas être vide.");
      return;
    }
    setCreateError(undefined);
    try {
      const result = await onCreateCollection(name);
      if (result !== false) {
        setNewName("");
      }
    } catch {
      setCreateError("Création impossible. Vérifiez le stockage, puis réessayez.");
    }
  };

  const startRename = (collection: Collection): void => {
    setRenamingId(collection.id);
    setRenameValue(collection.name);
    setRenameError(undefined);
    setDeletingId(undefined);
  };

  const cancelRename = (collectionId: string): void => {
    renameTriggerRefs.current.get(collectionId)?.focus();
    setRenamingId(undefined);
    setRenameError(undefined);
  };

  const submitRename = async (
    event: FormEvent<HTMLFormElement>,
    collectionId: string,
  ): Promise<void> => {
    event.preventDefault();
    const input = event.currentTarget.querySelector<HTMLInputElement>(
      `#rename-input-${collectionId}`,
    );
    const name = (input?.value ?? renameValue).trim();
    if (name.length === 0) {
      setRenameError("Le nom de la collection ne peut pas être vide.");
      return;
    }
    setRenameError(undefined);
    try {
      const result = await onRenameCollection(collectionId, name);
      if (result !== false) {
        renameTriggerRefs.current.get(collectionId)?.focus();
        setRenamingId(undefined);
      } else {
        renameInputRefs.current.get(collectionId)?.focus();
      }
    } catch {
      setRenameError("Renommage impossible. Vérifiez le stockage, puis réessayez.");
      renameInputRefs.current.get(collectionId)?.focus();
    }
  };

  const submitDelete = async (collectionId: string): Promise<void> => {
    const collectionIndex =
      state.kind === "ready"
        ? state.collections.findIndex((collection) => collection.id === collectionId)
        : -1;
    const focusTarget =
      state.kind === "ready"
        ? (state.collections[collectionIndex + 1]?.id ??
          state.collections[collectionIndex - 1]?.id ??
          collectionId)
        : collectionId;
    try {
      const result = await onDeleteCollection(collectionId);
      if (result !== false) {
        pendingDeleteFocusRef.current = { deletedId: collectionId, targetId: focusTarget };
        setDeletingId(undefined);
      } else {
        deleteConfirmRefs.current.get(collectionId)?.focus();
      }
    } catch {
      deleteConfirmRefs.current.get(collectionId)?.focus();
    }
  };

  if (state.kind === "loading") {
    return (
      <main
        aria-labelledby="collections-view-title"
        className="min-h-screen bg-slate-950 px-5 py-6 text-slate-50"
      >
        <h1 id="collections-view-title" className="text-2xl font-semibold tracking-tight">
          Collections
        </h1>
        <p
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="mt-6 text-sm text-slate-300"
        >
          Chargement des collections…
        </p>
      </main>
    );
  }

  if (state.kind === "storage-error") {
    return (
      <main
        aria-labelledby="collections-view-title"
        className="min-h-screen bg-slate-950 px-5 py-6 text-slate-50"
      >
        <h1 id="collections-view-title" className="text-2xl font-semibold tracking-tight">
          Collections
        </h1>
        <section
          role="alert"
          className="mt-6 rounded-2xl border border-rose-400/30 bg-rose-950/30 p-4"
        >
          <h2 className="font-semibold text-rose-100">Impossible de charger vos collections</h2>
          <p className="mt-2 text-sm leading-6 text-rose-100">
            {state.message ?? "Le stockage local est indisponible. Réessayez dans un instant."}
          </p>
          {onRetryStorage !== undefined && (
            <button
              type="button"
              onClick={onRetryStorage}
              className="mt-3 min-h-11 min-w-11 rounded-xl bg-rose-100 px-4 py-2 text-sm font-semibold text-rose-950"
            >
              Réessayer
            </button>
          )}
        </section>
      </main>
    );
  }

  const { collections } = state;
  const currentId = resolveCurrentCollectionId(collections, state.currentCollectionId);
  const currentCollection = collections.find((collection) => collection.id === currentId);

  return (
    <main
      aria-labelledby="collections-view-title"
      className="min-h-screen space-y-6 bg-slate-950 px-5 py-6 text-slate-50"
    >
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Baleen</p>
        <h1 id="collections-view-title" className="text-2xl font-semibold tracking-tight">
          Collections
        </h1>
        <p className="text-sm leading-6 text-slate-300">
          Rassemblez vos fiches produit et comparez les faits.
        </p>
      </header>

      {captureStatus !== undefined && (
        <p role="status" aria-live="polite" aria-busy="true" className="text-sm text-slate-300">
          {captureStatus === "capturing" ? "Capture en cours…" : "Normalisation en cours…"}
        </p>
      )}
      {collectionMutation !== undefined && (
        <p role="status" aria-live="polite" aria-busy="true" className="text-sm text-slate-300">
          {mutationMessage}
        </p>
      )}
      {notice?.kind === "error" && (
        <section
          role="alert"
          aria-labelledby="collections-notice-title"
          aria-describedby="collections-notice-description"
          className="rounded-2xl border border-rose-400/30 bg-rose-950/30 p-4 text-rose-100"
        >
          <div className="flex gap-3">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="mt-0.5 size-5 shrink-0"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v4m0 4h.01M10.3 3.9 2.7 17a2 2 0 0 0 1.73 3h15.14A2 2 0 0 0 21.3 17L13.7 3.9a2 2 0 0 0-3.4 0Z"
              />
            </svg>
            <div>
              <h2 id="collections-notice-title" className="text-base font-semibold">
                {noticeTitle(notice)}
              </h2>
              <p id="collections-notice-description" className="mt-2 text-sm leading-6">
                {notice.message}
              </p>
              {noticeActionLabel !== undefined && (
                <button
                  type="button"
                  onClick={runNoticeAction}
                  className="mt-4 min-h-11 min-w-11 rounded-xl border border-current px-4 py-2 font-semibold"
                >
                  {noticeActionLabel}
                </button>
              )}
            </div>
          </div>
        </section>
      )}
      {notice?.kind === "success" && (
        <div role="status" aria-live="polite" className="space-y-3 text-sm text-emerald-300">
          <p>{notice.message}</p>
          {noticeActionLabel !== undefined && (
            <button
              type="button"
              onClick={runNoticeAction}
              className="min-h-11 min-w-11 rounded-xl border border-current px-4 py-2 font-semibold"
            >
              {noticeActionLabel}
            </button>
          )}
        </div>
      )}
      {lastCapture !== undefined && (
        <section
          aria-labelledby="normalized-capture-title"
          aria-label="Fiche normalisée"
          className="space-y-3"
        >
          <h2 id="normalized-capture-title" className="text-lg font-semibold tracking-tight">
            Fiche normalisée
          </h2>
          <details
            key={`capture-details-${lastCapture.record.id}`}
            className="rounded-2xl border border-slate-800 bg-slate-900 p-4"
          >
            <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold text-slate-100">
              Détails de capture
            </summary>
            <h3 className="mt-3 text-sm font-semibold text-slate-100">Capture brute</h3>
            <dl className="mt-3 grid gap-2 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">URL</dt>
                <dd className="mt-1 break-all text-slate-100">
                  {lastCapture.extraction.source.url}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Capturé le</dt>
                <dd className="mt-1 text-slate-100">{lastCapture.extraction.source.capturedAt}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Méthode</dt>
                <dd className="mt-1 text-slate-100">{lastCapture.extraction.method}</dd>
              </div>
            </dl>
            <pre className="mt-3 max-h-[28rem] overflow-auto whitespace-pre-wrap text-xs leading-5 text-slate-200">
              {typeof lastCapture.extraction.content === "string"
                ? lastCapture.extraction.content
                : (JSON.stringify(lastCapture.extraction.content, null, 2) ?? "")}
            </pre>
          </details>
        </section>
      )}

      {collections.length === 0 ? (
        <>
          <section className="space-y-3" aria-labelledby="no-collection-title">
            <h2 id="no-collection-title" className="text-lg font-semibold tracking-tight">
              Aucune collection
            </h2>
            <p className="text-sm leading-6 text-slate-300">
              Créez une collection pour organiser vos fiches produit.
            </p>
            <p className="text-sm leading-6 text-slate-300">
              La capture sera disponible dès qu’une collection sera créée.
            </p>
          </section>

          <CreateCollectionForm
            value={newName}
            error={createError}
            disabled={collectionActionsDisabled}
            inputRef={newCollectionInputRef}
            onValueChange={setNewName}
            onSubmit={submitCreate}
          />
        </>
      ) : (
        <>
          {currentCollection !== undefined && (
            <section aria-labelledby="active-collection-title" className="space-y-4">
              <div className="space-y-2">
                <h2 id="active-collection-title" className="text-lg font-semibold tracking-tight">
                  Collection courante
                </h2>
                <p className="text-xl font-semibold tracking-tight text-slate-100">
                  {currentCollection.name}
                </p>
              </div>
              <button
                type="button"
                disabled={collectionActionsDisabled || captureStatus !== undefined}
                onClick={onCapture}
                className="min-h-11 min-w-11 rounded-xl bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 disabled:cursor-wait disabled:opacity-60"
              >
                {captureStatus === undefined
                  ? "Capturer cette page produit"
                  : captureStatus === "capturing"
                    ? "Capture en cours…"
                    : "Normalisation en cours…"}
              </button>
            </section>
          )}

          <details className="rounded-2xl border border-slate-800 bg-slate-900/40 p-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-slate-100">
              <span>Gérer les collections</span>
              <span className="text-xs font-medium text-slate-400">
                {collections.length} collection{collections.length === 1 ? "" : "s"}
              </span>
            </summary>
            <div className="mt-3 space-y-4">
              <CreateCollectionForm
                value={newName}
                error={createError}
                disabled={collectionActionsDisabled}
                inputRef={newCollectionInputRef}
                onValueChange={setNewName}
                onSubmit={submitCreate}
              />

              <section aria-labelledby="collection-selector-title" className="space-y-3">
                <h2 id="collection-selector-title" className="text-lg font-semibold tracking-tight">
                  Collection courante
                </h2>
                <label htmlFor="collection-selector" className="sr-only">
                  Collection courante
                </label>
                <select
                  id="collection-selector"
                  aria-label="Collection courante"
                  value={currentId ?? ""}
                  onChange={(event) => onSelectCollection(event.currentTarget.value)}
                  disabled={collectionActionsDisabled}
                  className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-base text-slate-100"
                >
                  {collections.map((collection) => (
                    <option key={collection.id} value={collection.id}>
                      {collectionLabel(collection)}
                    </option>
                  ))}
                </select>
              </section>

              <section aria-labelledby="collection-actions-title" className="space-y-3">
                <h2 id="collection-actions-title" className="text-sm font-semibold text-slate-200">
                  Collections existantes
                </h2>
                <ul className="space-y-3">
                  {collections.map((collection) => (
                    <li
                      key={collection.id}
                      className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-slate-100">{collection.name}</span>
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            ref={(element) => {
                              if (element === null) {
                                renameTriggerRefs.current.delete(collection.id);
                              } else {
                                renameTriggerRefs.current.set(collection.id, element);
                              }
                            }}
                            onClick={() => startRename(collection)}
                            disabled={collectionActionsDisabled}
                            aria-expanded={renamingId === collection.id}
                            aria-controls={`rename-${collection.id}`}
                            aria-label={`Renommer la collection ${collection.name}`}
                            className="min-h-11 min-w-11 rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-100"
                          >
                            Renommer
                          </button>
                          <button
                            type="button"
                            ref={(element) => {
                              if (element === null) {
                                deleteTriggerRefs.current.delete(collection.id);
                              } else {
                                deleteTriggerRefs.current.set(collection.id, element);
                              }
                            }}
                            onClick={() => {
                              setDeletingId(collection.id);
                              setRenamingId(undefined);
                            }}
                            disabled={collectionActionsDisabled}
                            aria-expanded={deletingId === collection.id}
                            aria-controls={`delete-${collection.id}`}
                            aria-label={`Supprimer la collection ${collection.name}`}
                            className="min-h-11 min-w-11 rounded-xl border border-rose-400/50 px-3 py-1.5 text-xs font-semibold text-rose-100"
                          >
                            Supprimer
                          </button>
                        </div>
                      </div>
                      {renamingId === collection.id && (
                        <form
                          id={`rename-${collection.id}`}
                          onSubmit={(event) => submitRename(event, collection.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              if (collectionMutation !== undefined) {
                                return;
                              }
                              cancelRename(collection.id);
                            }
                          }}
                          className="mt-4 space-y-2"
                        >
                          <label
                            htmlFor={`rename-input-${collection.id}`}
                            className="text-sm text-slate-300"
                          >
                            Nouveau nom pour {collection.name}
                          </label>
                          <input
                            id={`rename-input-${collection.id}`}
                            name="name"
                            ref={(element) => {
                              if (element === null) {
                                renameInputRefs.current.delete(collection.id);
                              } else {
                                renameInputRefs.current.set(collection.id, element);
                              }
                            }}
                            value={renameValue}
                            onChange={(event) => setRenameValue(event.currentTarget.value)}
                            onInput={(event) => setRenameValue(event.currentTarget.value)}
                            disabled={collectionActionsDisabled}
                            aria-invalid={renameError !== undefined}
                            aria-describedby={
                              renameError === undefined
                                ? undefined
                                : `rename-error-${collection.id}`
                            }
                            className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-base text-slate-100"
                          />
                          {renameError !== undefined && (
                            <p
                              id={`rename-error-${collection.id}`}
                              role="alert"
                              className="text-sm text-amber-200"
                            >
                              {renameError}
                            </p>
                          )}
                          <button
                            type="submit"
                            disabled={collectionActionsDisabled}
                            className="min-h-11 min-w-11 rounded-xl bg-cyan-300 px-3 py-1.5 text-xs font-semibold text-slate-950"
                          >
                            Enregistrer le nom
                          </button>
                          <button
                            type="button"
                            onClick={() => cancelRename(collection.id)}
                            disabled={collectionActionsDisabled}
                            className="min-h-11 min-w-11 rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-100"
                          >
                            Annuler
                          </button>
                        </form>
                      )}
                      {deletingId === collection.id && (
                        <div
                          id={`delete-${collection.id}`}
                          role="alertdialog"
                          aria-labelledby={`delete-title-${collection.id}`}
                          aria-describedby={`delete-description-${collection.id}`}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              if (collectionMutation !== undefined) {
                                return;
                              }
                              deleteTriggerRefs.current.get(collection.id)?.focus();
                              setDeletingId(undefined);
                            }
                          }}
                          className="mt-4 space-y-3 border-t border-slate-800 pt-3"
                        >
                          <h3
                            id={`delete-title-${collection.id}`}
                            className="text-sm font-semibold text-rose-100"
                          >
                            Supprimer « {collection.name} » ?
                          </h3>
                          <p
                            id={`delete-description-${collection.id}`}
                            className="text-sm text-slate-300"
                          >
                            Ses fiches seront retirées de cette collection.
                          </p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              ref={(element) => {
                                if (element === null) {
                                  deleteConfirmRefs.current.delete(collection.id);
                                } else {
                                  deleteConfirmRefs.current.set(collection.id, element);
                                }
                              }}
                              onClick={() => {
                                void submitDelete(collection.id);
                              }}
                              disabled={collectionActionsDisabled}
                              className="min-h-11 min-w-11 rounded-xl bg-rose-400 px-3 py-1.5 text-xs font-semibold text-slate-950"
                            >
                              Confirmer la suppression
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                deleteTriggerRefs.current.get(collection.id)?.focus();
                                setDeletingId(undefined);
                              }}
                              disabled={collectionActionsDisabled}
                              className="min-h-11 min-w-11 rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-100"
                            >
                              Annuler
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </details>

          {currentCollection === undefined ? (
            <section
              role="status"
              className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100"
            >
              Aucune collection courante sélectionnée.
            </section>
          ) : (
            <>
              <div role="group" aria-label="Vue de la collection" className="flex gap-2">
                <button
                  type="button"
                  aria-pressed={view === "list"}
                  onClick={() => setView("list")}
                  className={`min-h-11 min-w-11 rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${
                    view === "list"
                      ? "border-slate-100 bg-slate-100 text-slate-950"
                      : "border-slate-600 bg-slate-900 text-slate-100"
                  }`}
                >
                  Liste
                </button>
                <button
                  type="button"
                  aria-pressed={view === "comparison"}
                  onClick={() => setView("comparison")}
                  className={`min-h-11 min-w-11 rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${
                    view === "comparison"
                      ? "border-slate-100 bg-slate-100 text-slate-950"
                      : "border-slate-600 bg-slate-900 text-slate-100"
                  }`}
                >
                  Comparaison
                </button>
              </div>

              {view === "list" ? (
                <section
                  aria-labelledby="current-collection-title"
                  role="region"
                  className="space-y-4"
                >
                  <h2
                    id="current-collection-title"
                    className="text-xl font-semibold tracking-tight"
                  >
                    {currentCollection.name}
                  </h2>
                  {currentCollection.products.length === 0 ? (
                    <p className="text-sm leading-6 text-slate-300">
                      Aucune fiche dans cette collection. Capturez une page produit pour commencer.
                    </p>
                  ) : (
                    <div className="space-y-5">
                      {currentCollection.products.map((product) => (
                        <ProductCard key={product.id} record={product} />
                      ))}
                    </div>
                  )}
                  {currentCollection.products.length < 2 && (
                    <p className="text-sm leading-6 text-slate-300">
                      Ajoutez au moins deux fiches pour comparer.
                    </p>
                  )}
                </section>
              ) : (
                <section role="region" aria-labelledby="comparison-table-title">
                  <ComparisonTable products={currentCollection.products} />
                </section>
              )}

              {currentCollection.products.length > 0 && (
                <ExportControls
                  collection={currentCollection}
                  onCopy={onCopyExport}
                  onDownload={onDownloadExport}
                  disabled={exportDisabled}
                />
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}
