import type { ProductRecord } from "./product-record";
import type { ExportCollection } from "./export-artifact";
import { qualifySpecLabels } from "./spec-label";

export type { ExportCollection } from "./export-artifact";

const RESERVED_LABELS = [
  "Name",
  "Brand",
  "Price",
  "Category",
  "Pros",
  "Cons",
  "Source URL",
  "Page title",
  "Captured at",
  "Extraction method",
  "Extraction model",
] as const;

function escapeMarkdown(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replace(/\r?\n|\r/gu, "<br>");
}

function standardProductValue(product: ProductRecord, label: string): string {
  if (label === "Name") {
    return product.name;
  }
  if (label === "Brand") {
    return product.brand;
  }
  if (label === "Price") {
    return product.price === "unknown"
      ? "unknown"
      : `${String(product.price.amount)} ${product.price.currency}`;
  }
  if (label === "Category") {
    return product.category;
  }
  if (label === "Pros") {
    return product.pros.length === 0 ? "unknown" : product.pros.join("\n");
  }
  if (label === "Cons") {
    return product.cons.length === 0 ? "unknown" : product.cons.join("\n");
  }
  if (label === "Source URL") {
    return product.source.url;
  }
  if (label === "Page title") {
    return product.source.pageTitle;
  }
  if (label === "Captured at") {
    return product.capturedAt;
  }
  if (label === "Extraction method") {
    return product.extraction.method;
  }
  if (label === "Extraction model") {
    return product.extraction.model;
  }

  return "unknown";
}

function row(label: string, values: readonly string[]): string {
  return `| ${escapeMarkdown(label)} | ${values.map(escapeMarkdown).join(" | ")} |`;
}

export function exportMarkdown(collection: ExportCollection): string {
  const specLabels: string[] = [];
  const seenSpecLabels = new Set<string>();
  for (const product of collection.products) {
    for (const spec of product.specs) {
      if (!seenSpecLabels.has(spec.label)) {
        seenSpecLabels.add(spec.label);
        specLabels.push(spec.label);
      }
    }
  }

  const qualifiedSpecLabels = qualifySpecLabels(specLabels, RESERVED_LABELS);
  const standardLabels = ["Name", "Brand", "Price", "Category"];
  const header = `| Attribute | ${collection.products.map((product) => escapeMarkdown(product.name)).join(" | ")} |`;
  const separator = `| --- | ${collection.products.map(() => "---").join(" | ")} |`;
  const standardRows = standardLabels.map((label) =>
    row(
      label,
      collection.products.map((product) => standardProductValue(product, label)),
    ),
  );
  const specRows = qualifiedSpecLabels.map(({ sourceLabel, displayLabel }) =>
    row(
      displayLabel,
      collection.products.map(
        (product) => product.specs.find((spec) => spec.label === sourceLabel)?.value ?? "unknown",
      ),
    ),
  );
  const trailingRows = [
    "Pros",
    "Cons",
    "Source URL",
    "Page title",
    "Captured at",
    "Extraction method",
    "Extraction model",
  ].map((label) =>
    row(
      label,
      collection.products.map((product) => standardProductValue(product, label)),
    ),
  );
  return `# ${escapeMarkdown(collection.name)}\n\n${[header, separator, ...standardRows, ...specRows, ...trailingRows].join("\n")}\n`;
}
