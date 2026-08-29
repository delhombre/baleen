import type { ProductRecord } from "./product-record";

import { exportCsv } from "./export-csv";
import { exportJson } from "./export-json";
import { exportMarkdown } from "./export-markdown";

export type ExportCollection = {
  readonly name: string;
  readonly products: readonly ProductRecord[];
};

export type ExportFormat = "markdown" | "csv" | "json";

export type ExportArtifact = {
  readonly filename: string;
  readonly mimeType: string;
  readonly content: string;
};

function safeCollectionSlug(name: string): string {
  const withoutDiacritics = name.normalize("NFKD").replace(/\p{M}/gu, "");
  const slug = withoutDiacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug.length === 0 ? "collection" : slug;
}

export function createExportArtifact(
  format: ExportFormat,
  collection: ExportCollection,
): ExportArtifact {
  if (format === "markdown") {
    return {
      filename: `${safeCollectionSlug(collection.name)}.md`,
      mimeType: "text/markdown",
      content: exportMarkdown(collection),
    };
  }

  if (format === "csv") {
    return {
      filename: `${safeCollectionSlug(collection.name)}.csv`,
      mimeType: "text/csv",
      content: exportCsv(collection),
    };
  }

  return {
    filename: `${safeCollectionSlug(collection.name)}.json`,
    mimeType: "application/json",
    content: exportJson(collection),
  };
}
