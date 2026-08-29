import type { ProductRecord } from "../core/product-record";
import { buildComparisonTable } from "../core/comparison";

export type ComparisonTableProps = {
  readonly products: readonly ProductRecord[];
};

function ComparisonValue({ value }: { readonly value: string }) {
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

function comparisonRowLabel(label: string): string {
  switch (label) {
    case "Name":
      return "Nom";
    case "Brand":
      return "Marque";
    case "Price":
      return "Prix";
    case "Category":
      return "Catégorie";
    default:
      return label;
  }
}

export function ComparisonTable({ products }: ComparisonTableProps) {
  const comparison = buildComparisonTable(products);

  if (comparison.products.length < 2) {
    const message =
      comparison.products.length === 0
        ? "Ajoutez une fiche pour commencer la comparaison."
        : "Ajoutez encore une fiche pour comparer.";

    return (
      <section aria-labelledby="comparison-table-title" className="space-y-3">
        <h2 id="comparison-table-title" className="text-lg font-semibold tracking-tight">
          Comparaison
        </h2>
        <p className="text-sm leading-6 text-slate-300">{message}</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="comparison-table-title" className="space-y-3">
      <h2 id="comparison-table-title" className="text-lg font-semibold tracking-tight">
        Comparaison
      </h2>
      <p id="comparison-table-instructions" className="text-xs leading-5 text-slate-400">
        Faites défiler horizontalement et verticalement pour voir tous les produits.
      </p>
      <div
        className="max-h-[28rem] overflow-auto rounded-2xl border border-slate-800 bg-slate-900/70"
        role="region"
        aria-label="Tableau comparatif"
        aria-describedby="comparison-table-instructions"
        tabIndex={0}
      >
        <table className="min-w-max border-collapse text-left text-sm tabular-nums">
          <caption className="sr-only">Comparaison des fiches produit</caption>
          <thead>
            <tr className="border-b border-slate-800">
              <th
                scope="col"
                className="sticky left-0 top-0 z-30 min-w-36 bg-slate-900 px-4 py-3 font-semibold text-slate-200"
              >
                Attribut
              </th>
              {comparison.products.map((product) => (
                <th
                  key={product.id}
                  scope="col"
                  className="sticky top-0 min-w-48 bg-slate-900 px-4 py-3 font-semibold text-slate-100"
                >
                  <span className="line-clamp-2 break-words">
                    <ComparisonValue value={product.name} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comparison.rows.map((row) => (
              <tr key={row.label} className="border-b border-slate-800 last:border-b-0">
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-slate-900 px-4 py-3 font-medium text-slate-300"
                >
                  {comparisonRowLabel(row.label)}
                </th>
                {row.values.map((value, index) => (
                  <td
                    key={`${row.label}-${comparison.products[index]?.id ?? index}`}
                    className="px-4 py-3 align-top text-slate-100"
                  >
                    <ComparisonValue value={value} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
