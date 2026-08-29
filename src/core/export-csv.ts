import type { ExportCollection } from "./export-artifact";
import type { ProductRecord } from "./product-record";

export type { ExportCollection } from "./export-artifact";

function csvField(value: string): string {
  const transportValue = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  return /[",\r\n]/u.test(transportValue)
    ? `"${transportValue.replaceAll('"', '""')}"`
    : transportValue;
}

function joinedOrUnknown(values: readonly string[]): string {
  return values.length === 0 ? "unknown" : values.join("; ");
}

function specsOrUnknown(product: ProductRecord): string {
  return joinedOrUnknown(product.specs.map((spec) => `${spec.label}: ${spec.value}`));
}

function row(collectionName: string, product: ProductRecord): string {
  const values = [
    collectionName,
    product.id,
    product.name,
    product.brand,
    product.price === "unknown" ? "unknown" : String(product.price.amount),
    product.price === "unknown" ? "unknown" : product.price.currency,
    product.category,
    specsOrUnknown(product),
    joinedOrUnknown(product.pros),
    joinedOrUnknown(product.cons),
    product.source.url,
    product.source.pageTitle,
    product.capturedAt,
    product.extraction.method,
    product.extraction.model,
  ];
  return values.map(csvField).join(",");
}

export function exportCsv(collection: ExportCollection): string {
  const header =
    "collection_name,id,name,brand,price_amount,price_currency,category,specs,pros,cons,source_url,page_title,captured_at,extraction_method,extraction_model";
  return `${[header, ...collection.products.map((product) => row(collection.name, product))].join("\r\n")}\r\n`;
}
