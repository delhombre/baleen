import { useState } from "react";

import type { CapturePanelResult } from "../adapters/chrome/capture-page";
import type { RuntimeErrorCode, RuntimeNormalizeResponse } from "../core/runtime-message";
import type { ExtractionSuccess } from "../core/raw-product";
import { ProductCard } from "./product-card";

export type CapturePanelState =
  | { readonly kind: "empty" }
  | { readonly kind: "loading" }
  | { readonly kind: "normalizing"; readonly extraction: ExtractionSuccess }
  | {
      readonly kind: "normalization-success";
      readonly record: Extract<RuntimeNormalizeResponse, { readonly kind: "success" }>["record"];
      readonly extraction: ExtractionSuccess;
    }
  | { readonly kind: "normalization-error"; readonly code: RuntimeErrorCode }
  | { readonly kind: "success"; readonly result: ExtractionSuccess }
  | {
      readonly kind: "error";
      readonly code: "not-product" | "ambiguous-product" | "unavailable-page";
    };

type CapturePanelViewProps = {
  readonly state: CapturePanelState;
  readonly onCapture: () => void;
};

type CapturePanelProps = {
  readonly capture: () => Promise<CapturePanelResult>;
  readonly normalize?: (extraction: ExtractionSuccess) => Promise<RuntimeNormalizeResponse>;
};

function resultToState(result: CapturePanelResult): CapturePanelState {
  return result.kind === "success"
    ? { kind: "success", result }
    : { kind: "error", code: result.code };
}

function errorCopy(code: "not-product" | "ambiguous-product" | "unavailable-page") {
  switch (code) {
    case "not-product":
      return {
        title: "Cette page ne semble pas être un produit",
        message:
          "Baleen n’a trouvé ni titre et prix, ni deux spécifications, ni deux bullets d’une liste produit.",
      };
    case "ambiguous-product":
      return {
        title: "Plusieurs produits détectés",
        message: "La capture est arrêtée pour éviter de choisir le mauvais produit.",
      };
    case "unavailable-page":
      return {
        title: "Page indisponible",
        message: "Impossible de contacter le content script de l’onglet actif.",
      };
  }
}

function serializeContent(result: ExtractionSuccess): string {
  return typeof result.content === "string"
    ? result.content
    : (JSON.stringify(result.content, null, 2) ?? "");
}

function panelTitle(state: CapturePanelState): string {
  switch (state.kind) {
    case "empty":
      return "Aucune fiche pour le moment";
    case "loading":
      return "Capture en cours";
    case "normalizing":
      return "Normalisation en cours";
    case "normalization-success":
      return "Fiche normalisée";
    case "normalization-error":
      return "Normalisation impossible";
    case "success":
      return "Capture brute";
    case "error":
      return errorCopy(state.code).title;
  }
}

function normalizationErrorCopy(code: RuntimeErrorCode): {
  readonly title: string;
  readonly message: string;
} {
  switch (code) {
    case "missing-key":
      return {
        title: "Clé API manquante",
        message: "Ajoutez votre clé API dans les options pour normaliser cette fiche.",
      };
    case "unauthorized":
      return {
        title: "Clé API refusée",
        message: "La clé API n’a pas été acceptée par Anthropic.",
      };
    case "quota":
      return {
        title: "Quota atteint",
        message: "Le quota de normalisation est atteint. Réessayez plus tard.",
      };
    case "network":
      return {
        title: "Connexion impossible",
        message: "La normalisation n’a pas pu joindre le service.",
      };
    case "unavailable":
      return {
        title: "Service indisponible",
        message: "Le service est momentanément indisponible.",
      };
    case "invalid-response":
      return {
        title: "Réponse invalide",
        message: "Aucun fait n’a été ajouté : la réponse ne respecte pas le format attendu.",
      };
  }
}

function ErrorIcon() {
  return (
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
  );
}

export function CapturePanelView({ state, onCapture }: CapturePanelViewProps) {
  const buttonLabel = state.kind === "empty" ? "Capturer" : "Capturer à nouveau";

  return (
    <main
      aria-labelledby="capture-panel-title"
      className="min-h-screen bg-slate-950 px-5 py-6 text-slate-50"
    >
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Baleen</p>
        <h1 id="capture-panel-title" className="mt-3 text-2xl font-semibold tracking-tight">
          {panelTitle(state)}
        </h1>
      </header>

      {state.kind === "empty" && (
        <p className="mb-6 max-w-xs text-sm leading-6 text-slate-300">
          Capturez une page produit pour commencer.
        </p>
      )}

      {(state.kind === "loading" || state.kind === "normalizing") && (
        <p className="mb-6 text-sm text-slate-300" role="status" aria-live="polite">
          {state.kind === "loading" ? "Capture en cours…" : "Normalisation en cours…"}
        </p>
      )}

      {state.kind === "normalization-error" && (
        <section
          role="alert"
          aria-labelledby="normalization-error-title"
          className="mb-6 flex gap-3 rounded-2xl border border-rose-400/30 bg-rose-950/30 p-4"
        >
          <ErrorIcon />
          <div>
            <h2 id="normalization-error-title" className="text-base font-semibold text-rose-100">
              {normalizationErrorCopy(state.code).title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-rose-100">
              {normalizationErrorCopy(state.code).message}
            </p>
            <p className="mt-2 text-sm leading-6 text-rose-100">
              Vérifiez la configuration, puis réessayez la capture.
            </p>
          </div>
        </section>
      )}

      {state.kind === "normalization-success" && (
        <>
          <ProductCard record={state.record} />
          <details open className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-100">
              Détails de capture
            </summary>
            <h2 className="mt-3 text-sm font-semibold text-slate-100">Capture brute</h2>
            <pre className="mt-3 max-h-[28rem] overflow-auto whitespace-pre-wrap text-xs leading-5 text-slate-200">
              {serializeContent(state.extraction)}
            </pre>
          </details>
        </>
      )}

      {state.kind === "error" && (
        <section
          role="alert"
          aria-labelledby="capture-error-title"
          className="mb-6 flex gap-3 rounded-2xl border border-rose-400/30 bg-rose-950/30 p-4"
        >
          <ErrorIcon />
          <div>
            <h2 id="capture-error-title" className="text-base font-semibold text-rose-100">
              {errorCopy(state.code).title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-rose-100">{errorCopy(state.code).message}</p>
            <p className="mt-2 text-sm leading-6 text-rose-100">
              Ouvrez une page produit, puis réessayez.
            </p>
          </div>
        </section>
      )}

      {state.kind === "success" && (
        <section className="space-y-5" aria-live="polite">
          <dl className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">URL</dt>
              <dd className="mt-1 break-all text-slate-100">{state.result.source.url}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Titre de page</dt>
              <dd className="mt-1 text-slate-100">{state.result.source.pageTitle}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Capturé le</dt>
              <dd className="mt-1 text-slate-100">{state.result.source.capturedAt}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Méthode</dt>
              <dd className="mt-1 text-slate-100">{state.result.method}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Tronquée</dt>
              <dd className="mt-1 text-slate-100">{state.result.truncated ? "Oui" : "Non"}</dd>
            </div>
          </dl>
          <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-2xl border border-slate-800 bg-slate-900 p-4 text-xs leading-5 text-slate-200">
            {serializeContent(state.result)}
          </pre>
        </section>
      )}

      <button
        type="button"
        className="rounded-xl bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-wait disabled:opacity-60"
        disabled={state.kind === "loading" || state.kind === "normalizing"}
        onClick={onCapture}
      >
        {state.kind === "loading"
          ? "Capture en cours…"
          : state.kind === "normalizing"
            ? "Normalisation en cours…"
            : buttonLabel}
      </button>
    </main>
  );
}

export function CapturePanel({ capture, normalize }: CapturePanelProps) {
  const [state, setState] = useState<CapturePanelState>({ kind: "empty" });

  const handleCapture = (): void => {
    setState({ kind: "loading" });
    void capturePage();
  };

  const capturePage = async (): Promise<void> => {
    try {
      const result = await capture();
      if (result.kind !== "success" || normalize === undefined) {
        setState(resultToState(result));
        return;
      }
      setState({ kind: "normalizing", extraction: result });
      const normalized = await normalize(result);
      setState(
        normalized.kind === "success"
          ? { kind: "normalization-success", record: normalized.record, extraction: result }
          : { kind: "normalization-error", code: normalized.code },
      );
    } catch {
      setState({ kind: "error", code: "unavailable-page" });
    }
  };

  return <CapturePanelView state={state} onCapture={handleCapture} />;
}
