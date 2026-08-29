import type { ReactElement } from "react";

import type { ProductRecord } from "../core/product-record";

export type ProductCardProps = {
  readonly record: ProductRecord;
};

function isSafeHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function formatPrice(price: ProductRecord["price"]): string {
  if (price === "unknown") {
    return "unknown";
  }

  return `${price.amount.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${price.currency}`;
}

const FRENCH_MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
] as const;

function formatCapturedAt(capturedAt: string): string {
  const date = new Date(capturedAt);
  if (Number.isNaN(date.valueOf())) {
    return capturedAt;
  }

  const month = FRENCH_MONTHS[date.getUTCMonth()];
  return `${date.getUTCDate()} ${month} ${date.getUTCFullYear()} à ${String(
    date.getUTCHours(),
  ).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")} UTC`;
}

function FactValue({ value }: { readonly value: string }): ReactElement {
  if (value !== "unknown") {
    return <>{value}</>;
  }

  return (
    <span
      className="inline-flex rounded-md border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-xs text-slate-300"
      title="Information absente de la page"
    >
      unknown
    </span>
  );
}

function isPartialRecord(record: ProductRecord): boolean {
  return (
    record.name === "unknown" ||
    record.brand === "unknown" ||
    record.price === "unknown" ||
    record.category === "unknown" ||
    record.specs.length === 0
  );
}

function EmptyListMessage({ label }: { readonly label: string }): ReactElement {
  return <p className="text-sm leading-5 text-slate-400">{label}</p>;
}

export function ProductCard({ record }: ProductCardProps) {
  const partial = isPartialRecord(record);
  const sourceUrl = isSafeHttpUrl(record.source.url);
  const titleId = `product-card-title-${record.id}`;
  const summaryId = `product-card-summary-${record.id}`;
  const essentialsId = `product-card-essentials-${record.id}`;
  const specsId = `product-card-specs-${record.id}`;
  const prosId = `product-card-pros-${record.id}`;
  const consId = `product-card-cons-${record.id}`;

  return (
    <article
      aria-labelledby={titleId}
      aria-describedby={summaryId}
      className="space-y-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-5"
    >
      <p id={summaryId} className="sr-only">
        Fiche produit. Marque : {record.brand}. Prix : {formatPrice(record.price)}. Catégorie :{" "}
        {record.category}.
      </p>
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="min-w-0 text-xl font-semibold leading-6 tracking-tight">
            <FactValue value={record.name} />
          </h2>
          {partial && (
            <span className="shrink-0 rounded-full border border-amber-300/40 bg-amber-300/10 px-2 py-1 text-xs font-semibold text-amber-100">
              Fiche partielle
            </span>
          )}
        </div>
        <p className="text-sm text-slate-300">
          <FactValue value={record.brand} />
        </p>
      </header>

      <section aria-labelledby={essentialsId} className="space-y-3">
        <h3
          id={essentialsId}
          className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400"
        >
          Faits essentiels
        </h3>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <dt className="text-xs uppercase tracking-wide text-slate-400">Prix</dt>
            <dd className="mt-1 font-semibold tabular-nums text-slate-100">
              <FactValue value={formatPrice(record.price)} />
            </dd>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <dt className="text-xs uppercase tracking-wide text-slate-400">Catégorie</dt>
            <dd className="mt-1 text-slate-100">
              <FactValue value={record.category} />
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby={specsId} className="space-y-3 border-t border-slate-800 pt-5">
        <h3 id={specsId} className="text-sm font-semibold text-slate-100">
          Spécifications
        </h3>
        {record.specs.length === 0 ? (
          <EmptyListMessage label="Aucune spécification renseignée." />
        ) : (
          <dl className="divide-y divide-slate-800 text-sm">
            {record.specs.map((spec) => (
              <div
                key={`${spec.label}-${spec.value}`}
                className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0"
              >
                <dt className="text-slate-400">{spec.label}</dt>
                <dd className="text-right text-slate-100">{spec.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section aria-labelledby={prosId} className="space-y-3 border-t border-slate-800 pt-5">
        <h3 id={prosId} className="text-sm font-semibold text-slate-100">
          Points forts
        </h3>
        {record.pros.length === 0 ? (
          <EmptyListMessage label="Aucun point fort renseigné." />
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm leading-5 text-slate-200">
            {record.pros.map((pro) => (
              <li key={pro}>{pro}</li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={consId} className="space-y-3 border-t border-slate-800 pt-5">
        <h3 id={consId} className="text-sm font-semibold text-slate-100">
          Points faibles
        </h3>
        {record.cons.length === 0 ? (
          <EmptyListMessage label="Aucun point faible renseigné." />
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm leading-5 text-slate-200">
            {record.cons.map((con) => (
              <li key={con}>{con}</li>
            ))}
          </ul>
        )}
      </section>

      <footer className="space-y-3 border-t border-slate-800 pt-5">
        <h3 className="text-sm font-semibold text-slate-100">Provenance</h3>
        <dl className="grid gap-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">URL</dt>
            <dd className="mt-1 break-all text-slate-100">
              {sourceUrl ? (
                <a href={record.source.url} target="_blank" rel="noreferrer noopener">
                  {record.source.url}
                </a>
              ) : (
                record.source.url
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">Titre de page</dt>
            <dd className="mt-1 text-slate-100">{record.source.pageTitle}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">Capturé le</dt>
            <dd className="mt-1 text-slate-100">
              <time dateTime={record.capturedAt}>{formatCapturedAt(record.capturedAt)}</time>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">Méthode</dt>
            <dd className="mt-1 text-slate-100">{record.extraction.method}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">Modèle</dt>
            <dd className="mt-1 text-slate-100">{record.extraction.model}</dd>
          </div>
        </dl>
      </footer>
    </article>
  );
}
