import { ProductRecordSchema, type ProductRecord } from "./product-record";
import { qualifySpecLabels } from "./spec-label";

export type ComparisonRow = {
  readonly label: string;
  readonly values: readonly string[];
};

export type ComparisonTable = {
  readonly products: readonly ProductRecord[];
  readonly rows: readonly ComparisonRow[];
};

const FIXED_ROW_LABELS = ["Name", "Brand", "Price", "Category"] as const;

function formatPrice(product: ProductRecord): string {
  return product.price === "unknown"
    ? "unknown"
    : `${String(product.price.amount)} ${product.price.currency}`;
}

export function buildComparisonTable(products: readonly ProductRecord[]): ComparisonTable {
  const checkedProducts = products.map((product) => ProductRecordSchema.parse(product));
  const specLabels: string[] = [];
  const seenSpecLabels = new Set<string>();

  for (const product of checkedProducts) {
    for (const spec of product.specs) {
      if (!seenSpecLabels.has(spec.label)) {
        seenSpecLabels.add(spec.label);
        specLabels.push(spec.label);
      }
    }
  }

  const fixedRows: readonly {
    readonly label: string;
    readonly value: (product: ProductRecord) => string;
  }[] = [
    { label: "Name", value: (product) => product.name },
    { label: "Brand", value: (product) => product.brand },
    { label: "Price", value: formatPrice },
    { label: "Category", value: (product) => product.category },
  ];
  const rows: ComparisonRow[] = fixedRows.map(({ label, value }) => ({
    label,
    values: checkedProducts.map(value),
  }));

  for (const { sourceLabel, displayLabel } of qualifySpecLabels(specLabels, FIXED_ROW_LABELS)) {
    rows.push({
      label: displayLabel,
      values: checkedProducts.map(
        (product) => product.specs.find((spec) => spec.label === sourceLabel)?.value ?? "unknown",
      ),
    });
  }

  return { products: checkedProducts, rows };
}
