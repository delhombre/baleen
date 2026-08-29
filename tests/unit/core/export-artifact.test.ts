import { describe, expect, it } from "vitest";

import { createExportArtifact, type ExportCollection } from "../../../src/core/export-artifact";

const collection: ExportCollection = {
  name: "../Café picks: 2026",
  products: [],
};

describe("createExportArtifact", () => {
  it("creates safe deterministic Markdown metadata and content", () => {
    expect(createExportArtifact("markdown", collection)).toEqual({
      filename: "cafe-picks-2026.md",
      mimeType: "text/markdown",
      content: [
        "# ../Café picks: 2026\n\n| Attribute |  |\n| --- |  |\n| Name |  |\n| Brand |  |\n| Price |  |\n| Category |  |\n| Pros |  |\n| Cons |  |\n| Source URL |  |\n| Page title |  |\n| Captured at |  |\n",
        "| Extraction method |  |\n",
        "| Extraction model |  |\n",
      ].join(""),
    });
  });

  it("creates safe deterministic CSV metadata and content", () => {
    expect(createExportArtifact("csv", collection)).toEqual({
      filename: "cafe-picks-2026.csv",
      mimeType: "text/csv",
      content:
        "collection_name,id,name,brand,price_amount,price_currency,category,specs,pros,cons,source_url,page_title,captured_at,extraction_method,extraction_model\r\n",
    });
  });

  it("creates safe deterministic JSON metadata and content", () => {
    expect(createExportArtifact("json", collection)).toEqual({
      filename: "cafe-picks-2026.json",
      mimeType: "application/json",
      content: '{\n  "name": "../Café picks: 2026",\n  "products": []\n}\n',
    });
  });
});
