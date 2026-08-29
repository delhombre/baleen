import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";

import { extractDomSnapshot, extractJsonLdBlocks } from "../../../src/adapters/dom/product-page";
import {
  extractRawProduct,
  isExtractionResult,
  type PageSnapshot,
} from "../../../src/core/raw-product";

const source = {
  url: "http://127.0.0.1:4321/airfryer-jsonld.html",
  pageTitle: "CrispWave Air Fryer 5.5L | Shop Harbor",
  capturedAt: "2026-08-28T12:00:00.000Z",
} as const;

const emptyDom = {
  title: "",
  priceTexts: [],
  specs: [],
  bullets: [],
  hasProductBulletEvidence: false,
} as const;

describe("extractRawProduct", () => {
  it("returns the single Product JSON-LD node unchanged", () => {
    const product = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: "CrispWave Air Fryer 5.5L",
      brand: { "@type": "Brand", name: "CrispWave" },
      offers: { "@type": "Offer", priceCurrency: "EUR", price: "129.99" },
    } as const;
    const pageSnapshot: PageSnapshot = {
      source,
      jsonLdBlocks: [JSON.stringify(product)],
      dom: emptyDom,
    };

    const result = extractRawProduct(pageSnapshot);

    expect(result).toEqual({
      kind: "success",
      source,
      method: "json-ld",
      content: product,
      truncated: false,
    });
  });

  it("keeps a partial JSON-LD Product instead of merging DOM evidence", () => {
    const product = {
      "@context": "https://schema.org",
      "@type": "https://schema.org/Product",
      name: "Barista Mini Espresso Machine",
      brand: { "@type": "Brand", name: "Brew Market" },
    } as const;
    const pageSnapshot: PageSnapshot = {
      source: {
        ...source,
        url: "http://127.0.0.1:4321/espresso-jsonld-partial.html",
        pageTitle: "Barista Mini Espresso Machine | Brew Market",
      },
      jsonLdBlocks: [JSON.stringify(product)],
      dom: {
        title: "Barista Mini Espresso Machine",
        priceTexts: ["€249,00"],
        specs: [{ label: "Power", value: "1350 W" }],
        bullets: [],
        hasProductBulletEvidence: false,
      },
    };

    const result = extractRawProduct(pageSnapshot);

    expect(result).toEqual({
      kind: "success",
      source: pageSnapshot.source,
      method: "json-ld",
      content: product,
      truncated: false,
    });
    expect(JSON.stringify(result)).not.toContain("249");
  });

  it("fails closed on an oversized JSON-LD result before normalization evidence traversal", () => {
    const product = { "@type": "Product", name: "x".repeat(12_001) };
    const rawResult = {
      kind: "success",
      source,
      method: "json-ld",
      content: product,
      truncated: false,
    } as const;

    expect(
      extractRawProduct({
        source,
        jsonLdBlocks: [JSON.stringify(product)],
        dom: emptyDom,
      }),
    ).toEqual({ kind: "error", code: "not-product" });
    expect(isExtractionResult(rawResult)).toBe(false);
  });

  it("rejects an oversized JSON-LD block before parsing a nested sentinel Product", () => {
    const nestedProduct = { "@type": "Product", name: "Nested sentinel product" } as const;
    const oversizedBlock = JSON.stringify({
      padding: "x".repeat(64_000),
      mainEntity: nestedProduct,
    });

    expect(oversizedBlock.length).toBeGreaterThan(64_000);
    expect(
      extractRawProduct({
        source,
        jsonLdBlocks: [oversizedBlock],
        dom: emptyDom,
      }),
    ).toEqual({ kind: "error", code: "not-product" });
  });

  it("rejects a non-string JSON-LD block before JSON.parse can coerce it", () => {
    const coercibleBlock = {
      toString: () => JSON.stringify({ "@type": "Product", name: "Coerced sentinel product" }),
    };

    expect(
      extractRawProduct({
        source,
        jsonLdBlocks: [coercibleBlock] as unknown as readonly string[],
        dom: emptyDom,
      }),
    ).toEqual({ kind: "error", code: "not-product" });
  });

  it("ignores a Product JSON-LD block after the first sixteen inspected blocks", () => {
    const nonProductBlocks = Array.from({ length: 16 }, (_, index) =>
      JSON.stringify({ "@type": "BreadcrumbList", name: `retained-${index}` }),
    );
    const sentinel = JSON.stringify({ "@type": "Product", name: "seventeenth sentinel" });

    expect(
      extractRawProduct({
        source,
        jsonLdBlocks: nonProductBlocks.concat(sentinel),
        dom: emptyDom,
      }),
    ).toEqual({ kind: "error", code: "not-product" });
  });

  it("ignores a Product JSON-LD block beyond the 256000-character block budget", () => {
    const nonProductBlocks = Array.from({ length: 4 }, (_, index) =>
      JSON.stringify({ padding: "x".repeat(59_900), marker: `retained-${index}` }),
    );
    const sentinel = JSON.stringify({
      padding: "x".repeat(20_000),
      mainEntity: { "@type": "Product", name: "over-budget sentinel" },
    });
    const totalRetainedLength = nonProductBlocks.reduce((total, block) => total + block.length, 0);

    expect(totalRetainedLength).toBeLessThanOrEqual(256_000);
    expect(totalRetainedLength + sentinel.length).toBeGreaterThan(256_000);
    expect(
      extractRawProduct({
        source,
        jsonLdBlocks: nonProductBlocks.concat(sentinel),
        dom: emptyDom,
      }),
    ).toEqual({ kind: "error", code: "not-product" });
  });

  it("fails closed before scanning a million JSON-LD direct properties", () => {
    const directProperty = { name: "Capacity", value: "1 L" } as const;
    const content = {
      "@type": "Product",
      additionalProperty: new Array(1_000_000).fill(directProperty),
    };

    expect(
      isExtractionResult({
        kind: "success",
        source,
        method: "json-ld",
        content,
        truncated: false,
      }),
    ).toBe(false);
  });

  it("finds a Product in a JSON-LD array and graph", () => {
    const product = {
      "@type": ["Thing", "Product"],
      name: "Graph product",
    } as const;
    const pageSnapshot: PageSnapshot = {
      source,
      jsonLdBlocks: [
        JSON.stringify([{ "@type": "BreadcrumbList", itemListElement: [] }, product]),
        JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [{ "@type": "WebSite", name: "Shop Harbor" }],
        }),
      ],
      dom: emptyDom,
    };

    const result = extractRawProduct(pageSnapshot);

    expect(result).toEqual({
      kind: "success",
      source,
      method: "json-ld",
      content: product,
      truncated: false,
    });
  });

  it("finds a nested Product in mainEntity without merging DOM evidence", () => {
    const product = {
      "@type": "Product",
      name: "Nested product",
      brand: { "@type": "Brand", name: "Nested brand" },
    } as const;
    const pageSnapshot: PageSnapshot = {
      source,
      jsonLdBlocks: [
        JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          mainEntity: product,
        }),
      ],
      dom: {
        title: "Nested product",
        priceTexts: ["€777.00"],
        specs: [],
        bullets: [],
        hasProductBulletEvidence: false,
      },
    };

    const result = extractRawProduct(pageSnapshot);

    expect(result).toEqual({
      kind: "success",
      source,
      method: "json-ld",
      content: product,
      truncated: false,
    });
    expect(JSON.stringify(result)).not.toContain("777");
  });

  it("iterates deep JSON-LD data without scanning @context definitions", () => {
    const depth = 5_000;
    const nestedObjects = new Array<string>(depth).fill('{"nested":').join("");
    const jsonLdBlock = [
      '{"@context":{"definition":{"@type":"Product"}},"mainEntity":',
      nestedObjects,
      '{"@type":"Product","name":"Deep product"}',
      "}".repeat(depth),
      "}",
    ].join("");

    expect(() =>
      extractRawProduct({
        source,
        jsonLdBlocks: [jsonLdBlock],
        dom: {
          title: "Deep product",
          priceTexts: ["€999.00"],
          specs: [],
          bullets: [],
          hasProductBulletEvidence: false,
        },
      }),
    ).not.toThrow();

    expect(
      extractRawProduct({
        source,
        jsonLdBlocks: [jsonLdBlock],
        dom: emptyDom,
      }),
    ).toEqual({
      kind: "success",
      source,
      method: "json-ld",
      content: { "@type": "Product", name: "Deep product" },
      truncated: false,
    });
  });

  it("accepts only literal and exact schema.org Product types", () => {
    const acceptedTypes: readonly (string | readonly string[])[] = [
      "Product",
      "https://schema.org/Product",
      "http://schema.org/Product",
      ["Thing", "https://schema.org/Product"],
    ];

    for (const type of acceptedTypes) {
      const result = extractRawProduct({
        source,
        jsonLdBlocks: [JSON.stringify({ "@type": type, name: "Accepted product" })],
        dom: emptyDom,
      });

      expect(result.kind).toBe("success");
      if (result.kind === "success") {
        expect(result.method).toBe("json-ld");
        expect(result.content).toEqual({ "@type": type, name: "Accepted product" });
      }
    }

    expect(
      extractRawProduct({
        source,
        jsonLdBlocks: [JSON.stringify({ "@type": "https://evil.test/Product", name: "Foreign" })],
        dom: emptyDom,
      }),
    ).toEqual({ kind: "error", code: "not-product" });
    expect(
      extractRawProduct({
        source,
        jsonLdBlocks: [JSON.stringify({ "@type": ["Product", 7], name: "Malformed" })],
        dom: emptyDom,
      }),
    ).toEqual({ kind: "error", code: "not-product" });
  });

  it("ignores malformed JSON-LD and reports multiple Product nodes as ambiguous", () => {
    const pageSnapshot: PageSnapshot = {
      source,
      jsonLdBlocks: [
        "{ malformed",
        JSON.stringify({ "@type": "Product", name: "First" }),
        JSON.stringify({ "@graph": [{ "@type": "https://schema.org/Product", name: "Second" }] }),
      ],
      dom: emptyDom,
    };

    expect(extractRawProduct(pageSnapshot)).toEqual({
      kind: "error",
      code: "ambiguous-product",
    });
  });

  it("reports not-product when JSON-LD has no Product", () => {
    const pageSnapshot: PageSnapshot = {
      source,
      jsonLdBlocks: [JSON.stringify({ "@type": "Article", headline: "A guide" })],
      dom: emptyDom,
    };

    expect(extractRawProduct(pageSnapshot)).toEqual({
      kind: "error",
      code: "not-product",
    });
  });

  it("returns deterministic structured text for a title and price DOM fallback", () => {
    const pageSnapshot: PageSnapshot = {
      source: {
        ...source,
        url: "http://127.0.0.1:4321/vacuum-no-jsonld.html",
        pageTitle: "Northstar QuietClean Cordless Vacuum | Northstar Home",
      },
      jsonLdBlocks: [],
      dom: {
        title: "  Northstar\nQuietClean Cordless Vacuum  ",
        priceTexts: [" €379.00 ", "\n€379.00\n"],
        specs: [
          { label: " Battery\n runtime ", value: " 60\tminutes " },
          { label: "Dust capacity", value: "0.7 L" },
        ],
        bullets: [" HEPA filtration ", "LED floor head"],
        hasProductBulletEvidence: false,
      },
    };

    const result = extractRawProduct(pageSnapshot);

    expect(result).toEqual({
      kind: "success",
      source: pageSnapshot.source,
      method: "dom-fallback",
      content:
        "Title: Northstar QuietClean Cordless Vacuum\nPrices:\n- €379.00\nSpecifications:\n- Battery runtime: 60 minutes\n- Dust capacity: 0.7 L\nBullets:\n- HEPA filtration\n- LED floor head",
      truncated: false,
    });
  });

  it("accepts a title with two meaningful specifications without a price", () => {
    const pageSnapshot: PageSnapshot = {
      source,
      jsonLdBlocks: [],
      dom: {
        title: "Northstar QuietClean Cordless Vacuum",
        priceTexts: [],
        specs: [
          { label: "Battery runtime", value: "60 minutes" },
          { label: "Dust capacity", value: "0.7 L" },
        ],
        bullets: [],
        hasProductBulletEvidence: false,
      },
    };

    const result = extractRawProduct(pageSnapshot);

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.method).toBe("dom-fallback");
      expect(result.truncated).toBe(false);
      expect(result.content).toContain("- Battery runtime: 60 minutes");
    }
  });

  it("truncates DOM content deterministically at the character budget", () => {
    const pageSnapshot: PageSnapshot = {
      source,
      jsonLdBlocks: [],
      dom: {
        title: "Long product",
        priceTexts: ["€10.00"],
        specs: [],
        bullets: Array.from({ length: 2_000 }, (_, index) => `Bullet ${index} ${"x".repeat(12)}`),
        hasProductBulletEvidence: false,
      },
    };

    const result = extractRawProduct(pageSnapshot);

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.method).toBe("dom-fallback");
      expect(result.truncated).toBe(true);
      expect(typeof result.content).toBe("string");
      expect(result.content).toHaveLength(12_000);
      expect(result.content).toMatch(
        /^Title: Long product\nPrices:\n- €10\.00\nBullets:\n- Bullet 0/,
      );
    }
  });

  it("reports not-product when DOM evidence is insufficient", () => {
    const pageSnapshot: PageSnapshot = {
      source,
      jsonLdBlocks: [],
      dom: {
        title: "An article about vacuums",
        priceTexts: [],
        specs: [{ label: "Reading time", value: "5 minutes" }],
        bullets: [],
        hasProductBulletEvidence: false,
      },
    };

    expect(extractRawProduct(pageSnapshot)).toEqual({
      kind: "error",
      code: "not-product",
    });
  });

  it("does not qualify an editorial page from a title and generic bullets", () => {
    expect(
      extractRawProduct({
        source,
        jsonLdBlocks: [],
        dom: {
          title: "An article about vacuums",
          priceTexts: [],
          specs: [],
          bullets: ["First article point", "Second article point"],
          hasProductBulletEvidence: false,
        },
      }),
    ).toEqual({ kind: "error", code: "not-product" });
  });

  it("does not use product-like words in a title as list evidence", () => {
    expect(
      extractRawProduct({
        source,
        jsonLdBlocks: [],
        dom: {
          title: "Product features guide",
          priceTexts: [],
          specs: [],
          bullets: ["First editorial point", "Second editorial point"],
          hasProductBulletEvidence: false,
        },
      }),
    ).toEqual({ kind: "error", code: "not-product" });
  });

  it("does not combine one bullet from each marked list", () => {
    expect(
      extractRawProduct({
        source,
        jsonLdBlocks: [],
        dom: {
          title: "CrispWave Air Fryer 5.5L",
          priceTexts: [],
          specs: [],
          bullets: ["Rapid hot-air circulation", "Dishwasher-safe basket"],
          hasProductBulletEvidence: false,
        },
      }),
    ).toEqual({ kind: "error", code: "not-product" });
  });

  it("qualifies a snapshot whose adapter reports product bullet evidence", () => {
    const result = extractRawProduct({
      source,
      jsonLdBlocks: [],
      dom: {
        title: "CrispWave Air Fryer 5.5L",
        priceTexts: [],
        specs: [],
        bullets: ["Rapid hot-air circulation", "Dishwasher-safe basket"],
        hasProductBulletEvidence: true,
      },
    });

    expect(result).toEqual({
      kind: "success",
      source,
      method: "dom-fallback",
      content:
        "Title: CrispWave Air Fryer 5.5L\nBullets:\n- Rapid hot-air circulation\n- Dishwasher-safe basket",
      truncated: false,
    });
  });

  it("qualifies marked product bullets through the DOM adapter and core seams", () => {
    const { document } = parseHTML(`
      <main itemscope itemtype="https://schema.org/Product">
        <h1>CrispWave Air Fryer 5.5L</h1>
        <section class="product-features">
          <div><ul><li>Rapid hot-air circulation</li><li>Dishwasher-safe basket</li></ul></div>
        </section>
      </main>
    `);

    const result = extractRawProduct({
      source,
      jsonLdBlocks: extractJsonLdBlocks(document),
      dom: extractDomSnapshot(document),
    });

    expect(result).toEqual({
      kind: "success",
      source,
      method: "dom-fallback",
      content:
        "Title: CrispWave Air Fryer 5.5L\nBullets:\n- Rapid hot-air circulation\n- Dishwasher-safe basket",
      truncated: false,
    });
  });

  it("rejects article feature bullets through the DOM adapter and core seams without a page marker", () => {
    const { document } = parseHTML(`
      <article>
        <h1>How to choose a quiet kitchen</h1>
        <ul class="article-features">
          <li>Compare prices</li><li>Read reviews</li>
        </ul>
      </article>
    `);

    const result = extractRawProduct({
      source,
      jsonLdBlocks: extractJsonLdBlocks(document),
      dom: extractDomSnapshot(document),
    });

    expect(result).toEqual({ kind: "error", code: "not-product" });
  });

  it("rejects article bullets when the only Product marker is hidden in an annex", () => {
    const { document } = parseHTML(`
      <article>
        <h1>How to choose a quiet kitchen</h1>
        <ul class="article-features">
          <li>Compare prices</li><li>Read reviews</li>
        </ul>
      </article>
      <aside hidden itemscope itemtype="https://schema.org/Product">
        Hidden product metadata
      </aside>
    `);

    const dom = extractDomSnapshot(document);
    expect(dom.hasProductBulletEvidence).toBe(false);

    expect(
      extractRawProduct({
        source,
        jsonLdBlocks: extractJsonLdBlocks(document),
        dom,
      }),
    ).toEqual({ kind: "error", code: "not-product" });
  });

  it("rejects role article bullets when the only Product marker is hidden in an annex", () => {
    const { document } = parseHTML(`
      <div role="article">
        <h1>How to choose a quiet kitchen</h1>
        <ul class="article-features">
          <li>Compare prices</li><li>Read reviews</li>
        </ul>
      </div>
      <aside hidden itemscope itemtype="https://schema.org/Product">
        Hidden product metadata
      </aside>
    `);

    const dom = extractDomSnapshot(document);
    expect(dom.hasProductBulletEvidence).toBe(false);

    expect(
      extractRawProduct({
        source,
        jsonLdBlocks: extractJsonLdBlocks(document),
        dom,
      }),
    ).toEqual({ kind: "error", code: "not-product" });
  });

  it("uses a content-root h1 before an earlier brand itemprop name", () => {
    const { document } = parseHTML(`
      <main>
        <span itemprop="name">CrispWave</span>
        <h1>CrispWave Air Fryer 5.5L</h1>
        <p class="product-price">€129.99</p>
      </main>
    `);

    const dom = extractDomSnapshot(document);
    expect(dom.title).toBe("CrispWave Air Fryer 5.5L");
    expect(
      extractRawProduct({
        source,
        jsonLdBlocks: extractJsonLdBlocks(document),
        dom,
      }),
    ).toEqual({
      kind: "success",
      source,
      method: "dom-fallback",
      content: "Title: CrispWave Air Fryer 5.5L\nPrices:\n- €129.99",
      truncated: false,
    });
  });

  it("validates extraction results at the pure runtime boundary", () => {
    const validJsonLdResult = {
      kind: "success",
      source,
      method: "json-ld",
      content: { "@type": "Product", name: "Runtime product" },
      truncated: false,
    } as const;
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(isExtractionResult(validJsonLdResult)).toBe(true);
    expect(
      isExtractionResult({
        kind: "success",
        source,
        method: "dom-fallback",
        content: "Title: Runtime product",
        truncated: false,
      }),
    ).toBe(true);

    const malformedResults: readonly unknown[] = [
      { ...validJsonLdResult, source: { ...source, url: "file://fixture.invalid/product" } },
      { ...validJsonLdResult, source: { ...source, url: "not-a-url" } },
      { ...validJsonLdResult, source: { ...source, capturedAt: "2026-08-28" } },
      { ...validJsonLdResult, source: { ...source, capturedAt: "2026-02-30T12:00:00.000Z" } },
      { ...validJsonLdResult, content: cyclic },
      { ...validJsonLdResult, content: { "@type": "Product", invalid: undefined } },
      { ...validJsonLdResult, content: { "@type": "Product", invalid: Number.NaN } },
      { ...validJsonLdResult, extra: true },
      { kind: "error", code: "not-product", extra: true },
      { kind: "error", code: "unknown-error" },
      { ...validJsonLdResult, method: "json-ld", content: "raw", truncated: false },
      { ...validJsonLdResult, method: "dom-fallback", content: "", truncated: false },
      { ...validJsonLdResult, method: "dom-fallback", content: "   ", truncated: false },
      {
        ...validJsonLdResult,
        method: "dom-fallback",
        content: "x".repeat(12_001),
        truncated: true,
      },
      { ...validJsonLdResult, method: "dom-fallback", content: "raw", truncated: "false" },
    ];

    for (const malformedResult of malformedResults) {
      expect(isExtractionResult(malformedResult)).toBe(false);
    }
  });

  it("counts raw DOM content in UTF-16 code units", () => {
    const atLimit = "😀".repeat(6_000);
    const aboveLimit = "😀".repeat(6_001);

    expect(atLimit).toHaveLength(12_000);
    expect(aboveLimit).toHaveLength(12_002);
    expect(
      isExtractionResult({
        kind: "success",
        source,
        method: "dom-fallback",
        content: atLimit,
        truncated: false,
      }),
    ).toBe(true);
    expect(
      isExtractionResult({
        kind: "success",
        source,
        method: "dom-fallback",
        content: aboveLimit,
        truncated: false,
      }),
    ).toBe(false);
  });
});
