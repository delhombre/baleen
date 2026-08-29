import { useState } from "react";

import {
  createExportArtifact,
  type ExportArtifact,
  type ExportCollection,
  type ExportFormat,
} from "../core/export-artifact";
import type { ExportWriteResult } from "../adapters/browser/export-writers";

export type ExportControlsProps = {
  readonly collection: ExportCollection;
  readonly onCopy: (artifact: ExportArtifact) => ExportWriteResult | Promise<ExportWriteResult>;
  readonly onDownload: (artifact: ExportArtifact) => ExportWriteResult | Promise<ExportWriteResult>;
  readonly disabled?: boolean;
};

type ExportAction = "copy" | "download";
type ExportFeedback =
  | { readonly kind: "success"; readonly action: ExportAction }
  | { readonly kind: "error"; readonly action: ExportAction };

function actionLabel(action: ExportAction): string {
  return action === "copy" ? "copie" : "téléchargement";
}

function errorMessage(action: ExportAction): string {
  return action === "copy"
    ? "Copie impossible. Le presse-papiers du navigateur n’est pas disponible ou a refusé l’accès. Autorisez l’accès, puis réessayez."
    : "Téléchargement impossible. Le navigateur a refusé la création du fichier. Autorisez les téléchargements, puis réessayez.";
}

function successMessage(action: ExportAction): string {
  return action === "copy" ? "Export copié dans le presse-papiers." : "Export téléchargé.";
}

export function ExportControls({
  collection,
  onCopy,
  onDownload,
  disabled = false,
}: ExportControlsProps) {
  const [format, setFormat] = useState<ExportFormat>("markdown");
  const [busyAction, setBusyAction] = useState<ExportAction | undefined>();
  const [feedback, setFeedback] = useState<ExportFeedback | undefined>();
  const collectionIsEmpty = collection.products.length === 0;
  const actionsDisabled = disabled || busyAction !== undefined;

  const runExport = async (action: ExportAction): Promise<void> => {
    if (collectionIsEmpty || disabled || busyAction !== undefined) return;

    setBusyAction(action);
    setFeedback(undefined);
    try {
      const artifact = createExportArtifact(format, collection);
      const result = await (action === "copy" ? onCopy(artifact) : onDownload(artifact));
      setFeedback({ kind: result.kind === "ok" ? "success" : "error", action });
    } catch {
      setFeedback({ kind: "error", action });
    } finally {
      setBusyAction(undefined);
    }
  };

  return (
    <section aria-labelledby="export-controls-title" className="space-y-3">
      <h2 id="export-controls-title" className="text-lg font-semibold tracking-tight">
        Exporter la collection
      </h2>
      <div className="space-y-2">
        <label htmlFor="export-format" className="text-sm font-semibold text-slate-100">
          Format d’export
        </label>
        <select
          id="export-format"
          value={format}
          onChange={(event) => setFormat(event.currentTarget.value as ExportFormat)}
          disabled={actionsDisabled}
          className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-base text-slate-100"
        >
          <option value="markdown">Markdown (.md)</option>
          <option value="csv">CSV (.csv)</option>
          <option value="json">JSON (.json)</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void runExport("copy")}
          disabled={collectionIsEmpty || actionsDisabled}
          className="min-h-11 min-w-11 rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busyAction === "copy" ? "Copie en cours…" : "Copier l’export"}
        </button>
        <button
          type="button"
          onClick={() => void runExport("download")}
          disabled={collectionIsEmpty || actionsDisabled}
          className="min-h-11 min-w-11 rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busyAction === "download" ? "Téléchargement en cours…" : "Télécharger l’export"}
        </button>
      </div>
      {collectionIsEmpty && (
        <p className="text-sm leading-6 text-slate-300">
          Ajoutez au moins une fiche à cette collection pour l’exporter.
        </p>
      )}
      {disabled && (
        <p role="status" aria-live="polite" className="text-sm leading-6 text-slate-300">
          Export indisponible pendant une opération en cours.
        </p>
      )}
      <div
        role={feedback?.kind === "error" ? "alert" : "status"}
        aria-live={feedback?.kind === "error" ? undefined : "polite"}
        aria-busy={busyAction !== undefined}
        className="min-h-6 space-y-2 text-sm text-slate-300"
      >
        {feedback?.kind === "success" ? (
          successMessage(feedback.action)
        ) : feedback?.kind === "error" ? (
          <>
            <p>{errorMessage(feedback.action)}</p>
            <button
              type="button"
              onClick={() => void runExport(feedback.action)}
              disabled={actionsDisabled}
              className="min-h-11 min-w-11 rounded-xl border border-current px-4 py-2 font-semibold"
            >
              Réessayer {actionLabel(feedback.action)}
            </button>
          </>
        ) : busyAction !== undefined ? (
          `${busyAction === "copy" ? "Copie" : "Téléchargement"} en cours…`
        ) : null}
      </div>
    </section>
  );
}
