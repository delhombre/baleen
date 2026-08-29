import type { ProductRecord } from "../core/product-record";
import { ProductCard } from "./product-card";

export type NormalizationViewState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "success"; readonly record: ProductRecord }
  | { readonly kind: "missing-key" }
  | { readonly kind: "quota" }
  | { readonly kind: "network" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "invalid-response" };

export type NormalizationViewProps = {
  readonly state: NormalizationViewState;
};

const errorCopy = {
  "missing-key": {
    title: "Clé API manquante",
    message: "Ajoutez votre clé API dans les options pour normaliser cette fiche.",
  },
  quota: {
    title: "Quota de normalisation atteint",
    message: "Le quota est atteint. Réessayez plus tard ou vérifiez votre compte.",
  },
  network: {
    title: "Connexion impossible",
    message: "La normalisation n’a pas pu joindre le service. Vérifiez votre connexion.",
  },
  unavailable: {
    title: "Service de normalisation indisponible",
    message: "Le service est momentanément indisponible. Réessayez dans un instant.",
  },
  "invalid-response": {
    title: "Réponse de normalisation invalide",
    message: "La fiche reçue n’a pas le format attendu. Aucun fait n’a été ajouté.",
  },
} as const;

export function NormalizationView({ state }: NormalizationViewProps) {
  return (
    <main
      aria-labelledby="normalization-view-title"
      className="min-h-screen bg-slate-950 px-5 py-6 text-slate-50"
    >
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Baleen</p>
        <h1 id="normalization-view-title" className="mt-3 text-2xl font-semibold tracking-tight">
          Normalisation
        </h1>
      </header>

      {state.kind === "idle" && (
        <p role="status" aria-live="polite" aria-busy="false" className="text-sm text-slate-300">
          Prête à normaliser. Capturez une page produit pour commencer.
        </p>
      )}

      {state.kind === "loading" && (
        <p role="status" aria-live="polite" aria-busy="true" className="text-sm text-slate-300">
          Normalisation en cours…
        </p>
      )}

      {state.kind === "success" && <ProductCard record={state.record} />}

      {(state.kind === "missing-key" ||
        state.kind === "quota" ||
        state.kind === "network" ||
        state.kind === "unavailable" ||
        state.kind === "invalid-response") && (
        <section role="alert" className="rounded-2xl border border-rose-400/30 bg-rose-950/30 p-4">
          <h2 className="text-base font-semibold text-rose-100">{errorCopy[state.kind].title}</h2>
          <p className="mt-2 text-sm leading-6 text-rose-100">{errorCopy[state.kind].message}</p>
        </section>
      )}
    </main>
  );
}
