import type { ExportCollection } from "./export-artifact";
import type { ProductRecord } from "./product-record";

export type { ExportCollection } from "./export-artifact";

function canonicalProduct(product: ProductRecord): ProductRecord {
  return {
    id: product.id,
    capturedAt: product.capturedAt,
    source: {
      url: product.source.url,
      pageTitle: product.source.pageTitle,
    },
    name: product.name,
    brand: product.brand,
    price:
      product.price === "unknown"
        ? "unknown"
        : { amount: product.price.amount, currency: product.price.currency },
    category: product.category,
    specs: product.specs.map((spec) => ({ label: spec.label, value: spec.value })),
    pros: [...product.pros],
    cons: [...product.cons],
    extraction: {
      method: product.extraction.method,
      model: product.extraction.model,
    },
  };
}

export function exportJson(collection: ExportCollection): string {
  const serialized = JSON.stringify(
    {
      name: collection.name,
      products: collection.products.map(canonicalProduct),
    },
    null,
    2,
  );
  if (serialized === undefined) {
    throw new Error("Unable to serialize export collection.");
  }
  return `${serialized}\n`;
}
