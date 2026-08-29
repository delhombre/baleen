import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";

import { extractDomSnapshot, extractJsonLdBlocks } from "../../../../src/adapters/dom/product-page";
import { extractRawProduct } from "../../../../src/core/raw-product";

describe("extractDomSnapshot", () => {
  it("serializes visible product evidence and excludes non-content regions", () => {
    const { document } = parseHTML(`
      <html>
        <body>
          <header><nav><a>Navigation price €1</a></nav></header>
          <main>
            <h1>Northstar\nQuietClean Cordless Vacuum</h1>
            <div class="productPrice"> €379.00 </div>
            <div class="price" hidden>€1.00</div>
            <div aria-hidden="true"><span class="price">€2.00</span></div>
            <table>
              <tr><th>Battery runtime</th><td>60 minutes</td></tr>
              <tr><th>Dust capacity</th><td>0.7 L</td></tr>
            </table>
            <ul><li>HEPA filtration</li><li>LED floor head</li></ul>
            <aside><p>Recommended €49.00</p></aside>
          </main>
          <footer><p>Footer price €0</p><ul><li>Footer item</li></ul></footer>
        </body>
      </html>
    `);

    expect(extractDomSnapshot(document)).toEqual({
      title: "Northstar QuietClean Cordless Vacuum",
      priceTexts: ["€379.00"],
      specs: [
        { label: "Battery runtime", value: "60 minutes" },
        { label: "Dust capacity", value: "0.7 L" },
      ],
      bullets: ["HEPA filtration", "LED floor head"],
      hasProductBulletEvidence: false,
    });
  });

  it("excludes invisible descendant text from prices, specifications and bullets", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Northstar QuietClean Cordless Vacuum</h1>
        <div class="product-price">
          €379.00
          <span hidden>€999.00 hidden attribute</span>
          <span aria-hidden="true">€998.00 aria hidden</span>
          <span style="display: none !important">€997.00 display none</span>
          <span style="visibility: hidden !important">€996.00 visibility hidden</span>
          <span style="opacity: 0">€995.00 opacity zero</span>
        </div>
        <table>
          <tr>
            <th>Battery runtime</th>
            <td>60 minutes <span hidden>masked value</span></td>
          </tr>
          <tr>
            <th>Dust capacity</th>
            <td>0.7 L <span style="opacity: 0">masked capacity</span></td>
          </tr>
        </table>
        <ul>
          <li>HEPA filtration <span aria-hidden="true">masked bullet</span></li>
        </ul>
      </main>
    `);

    expect(extractDomSnapshot(document)).toEqual({
      title: "Northstar QuietClean Cordless Vacuum",
      priceTexts: ["€379.00"],
      specs: [
        { label: "Battery runtime", value: "60 minutes" },
        { label: "Dust capacity", value: "0.7 L" },
      ],
      bullets: ["HEPA filtration"],
      hasProductBulletEvidence: false,
    });
  });

  it("excludes hidden table and description-list cells from product qualification", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Northstar QuietClean Cordless Vacuum</h1>
        <table>
          <tr><th style="display: none">Battery runtime</th><td>60 minutes</td></tr>
          <tr><th>Dust capacity</th><td hidden>0.7 L</td></tr>
        </table>
        <dl>
          <dt style="display: none">Filter</dt><dd>HEPA</dd>
          <dt>Noise level</dt><dd style="visibility: hidden">58 dB</dd>
        </dl>
      </main>
    `);

    const dom = extractDomSnapshot(document);
    expect(dom.specs).toEqual([]);
    expect(
      extractRawProduct({
        source: {
          url: "https://example.test/vacuum",
          pageTitle: "Northstar QuietClean Cordless Vacuum",
          capturedAt: "2026-08-28T12:00:00.000Z",
        },
        jsonLdBlocks: [],
        dom,
      }),
    ).toEqual({ kind: "error", code: "not-product" });
  });

  it("excludes sr-only clip patterns but keeps a partially clipped price", () => {
    const { document } = parseHTML(`
      <main>
        <h1>CrispWave Air Fryer 5.5L</h1>
        <p class="productPrice">
          <span style="clip: rect(0 0 0 0)">€999.00 clipped</span>
          <span style="clip-path: inset(50%)">€998.00 clipped path</span>
          <span style="content-visibility: hidden">€997.00 hidden content</span>
          <span style="clip: rect(0 0 1px 1px)">€129.99 partially clipped</span>
        </p>
      </main>
    `);

    expect(extractDomSnapshot(document)).toEqual({
      title: "CrispWave Air Fryer 5.5L",
      priceTexts: ["€129.99 partially clipped"],
      specs: [],
      bullets: [],
      hasProductBulletEvidence: false,
    });
  });

  it("excludes prices with collapsed visibility", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Northstar QuietClean Cordless Vacuum</h1>
        <p class="product-price">
          <span style="visibility: collapse">€998.00 collapsed</span>
          <span>€379.00</span>
        </p>
      </main>
    `);

    expect(extractDomSnapshot(document).priceTexts).toEqual(["€379.00"]);
  });

  it("excludes prices fully covered by a clip-path inset of at least half", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Northstar QuietClean Cordless Vacuum</h1>
        <p class="product-price">
          <span style="clip-path: inset(60%)">€998.00 clipped</span>
          <span>€379.00</span>
        </p>
      </main>
    `);

    expect(extractDomSnapshot(document).priceTexts).toEqual(["€379.00"]);
  });

  it("excludes clip-path insets that cover either full axis but keeps a ninety-nine percent inset", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Northstar QuietClean Cordless Vacuum</h1>
        <span class="price" style="clip-path: inset(100% 0)">€100.00 top axis</span>
        <span class="price" style="clip-path: inset(0 100%)">€101.00 side axis</span>
        <span class="price" style="clip-path: inset(50% 0)">€102.00 equal vertical axis</span>
        <span class="price" style="clip-path: inset(50% 49%)">€103.00 mixed vertical axis</span>
        <span class="price" style="clip-path: inset(60% 40%)">€104.00 mixed axes</span>
        <span class="price" style="clip-path: inset(40% 0 60%)">€105.00 three values</span>
        <span class="price" style="clip-path: inset(0 60% 0 40%)">€106.00 four values</span>
        <span class="price" style="clip-path: inset(0 49% 0 50%)">€129.00 barely visible</span>
        <span class="price">€379.00</span>
      </main>
    `);

    expect(extractDomSnapshot(document).priceTexts).toEqual(["€129.00 barely visible", "€379.00"]);
  });

  it("keeps a visible descendant under an inherited hidden visibility", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Northstar QuietClean Cordless Vacuum</h1>
        <div style="visibility: hidden">
          <span class="product-price" style="visibility: visible">€379.00</span>
          <span class="product-price">€998.00 inherited hidden</span>
        </div>
      </main>
    `);

    expect(extractDomSnapshot(document).priceTexts).toEqual(["€379.00"]);
  });

  it("keeps a collapsed table branch hidden when descendants set visibility visible", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Northstar QuietClean Cordless Vacuum</h1>
        <p class="product-price">€379.00</p>
        <table>
          <tbody style="visibility: collapse">
            <tr style="visibility: visible">
              <th style="visibility: visible">Collapsed label</th>
              <td style="visibility: visible">Collapsed value</td>
            </tr>
          </tbody>
          <tbody>
            <tr><th>Battery runtime</th><td>60 minutes</td></tr>
          </tbody>
        </table>
      </main>
    `);

    expect(extractDomSnapshot(document).specs).toEqual([
      { label: "Battery runtime", value: "60 minutes" },
    ]);
  });

  it("uses the final important inline declaration when CSSOM is unavailable", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Northstar QuietClean Cordless Vacuum</h1>
        <span class="price" style="display: none; display: block">€379.00</span>
        <span class="price" style="display: block; display: none !important; display: block">€999.00</span>
      </main>
    `);

    expect(extractDomSnapshot(document).priceTexts).toEqual(["€379.00"]);
  });

  it("preserves adjacent text fragments without inventing spaces", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Compact espresso machine</h1>
        <p class="productPrice"><span>€</span><span>379</span><span>.00</span></p>
      </main>
    `);

    expect(extractDomSnapshot(document)).toEqual({
      title: "Compact espresso machine",
      priceTexts: ["€379.00"],
      specs: [],
      bullets: [],
      hasProductBulletEvidence: false,
    });
  });

  it("normalizes adjacent specification fragments once after collecting raw text", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Northstar QuietClean Cordless Vacuum</h1>
        <p class="productPrice"><span>€</span><span>379</span><span>.00</span></p>
        <table>
          <tr>
            <th><span>Battery</span><span> runtime</span></th>
            <td><span>60</span><span> minutes</span></td>
          </tr>
        </table>
      </main>
    `);

    expect(extractDomSnapshot(document)).toEqual({
      title: "Northstar QuietClean Cordless Vacuum",
      priceTexts: ["€379.00"],
      specs: [{ label: "Battery runtime", value: "60 minutes" }],
      bullets: [],
      hasProductBulletEvidence: false,
    });
  });

  it("reads a deeply nested visible price without overflowing the call stack", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Northstar QuietClean Cordless Vacuum</h1>
      </main>
    `);
    const main = document.querySelector("main");
    if (main === null) {
      throw new Error("Fixture main content is missing.");
    }

    const price = document.createElement("p");
    price.className = "productPrice";
    let deepest: Element = price;
    for (let depth = 0; depth < 5_000; depth += 1) {
      const wrapper = document.createElement("span");
      deepest.append(wrapper);
      deepest = wrapper;
    }
    deepest.append(document.createTextNode("€379.00"));
    main.append(price);

    let snapshot: ReturnType<typeof extractDomSnapshot> | undefined;
    expect(() => {
      snapshot = extractDomSnapshot(document);
    }).not.toThrow();
    expect(snapshot?.priceTexts).toEqual(["€379.00"]);
  });

  it("keeps a collapsed descendant out of a five-thousand-deep specification path", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Northstar QuietClean Cordless Vacuum</h1>
        <table><tr><th></th><td>60 minutes</td></tr></table>
      </main>
    `);
    const label = document.querySelector("th");
    if (label === null) {
      throw new Error("Fixture specification label is missing.");
    }

    let deepest: Element = label;
    for (let depth = 0; depth < 5_000; depth += 1) {
      const wrapper = document.createElement("span");
      deepest.append(wrapper);
      deepest = wrapper;
    }
    deepest.append(document.createTextNode("Battery runtime"));

    const collapsed = document.createElement("span");
    collapsed.setAttribute("style", "visibility: collapse");
    const visibleDescendant = document.createElement("span");
    visibleDescendant.setAttribute("style", "visibility: visible");
    visibleDescendant.textContent = " leaked collapsed text";
    collapsed.append(visibleDescendant);
    deepest.append(collapsed);

    let snapshot: ReturnType<typeof extractDomSnapshot> | undefined;
    expect(() => {
      snapshot = extractDomSnapshot(document);
    }).not.toThrow();
    expect(snapshot?.specs).toEqual([{ label: "Battery runtime", value: "60 minutes" }]);
  });

  it("does not reread nested price candidates", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Northstar QuietClean Cordless Vacuum</h1>
      </main>
    `);
    const main = document.querySelector("main");
    if (main === null) {
      throw new Error("Fixture main content is missing.");
    }

    const price = document.createElement("p");
    price.className = "product-price";
    let deepest: Element = price;
    for (let depth = 0; depth < 3_000; depth += 1) {
      const wrapper = document.createElement("span");
      wrapper.className = "price";
      deepest.append(wrapper);
      deepest = wrapper;
    }
    deepest.append(document.createTextNode("€379.00"));
    main.append(price);

    expect(extractDomSnapshot(document).priceTexts).toEqual(["€379.00"]);
  });

  it("bounds one hundred thousand distinct prices to the deterministic raw budget", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Northstar QuietClean Cordless Vacuum</h1>
      </main>
    `);
    const main = document.querySelector("main");
    if (main === null) {
      throw new Error("Fixture main content is missing.");
    }

    for (let index = 0; index < 100_000; index += 1) {
      const price = document.createElement("p");
      price.className = "product-price";
      price.textContent = `€${String(index).padStart(5, "0")}`;
      main.append(price);
    }

    const result = extractRawProduct({
      source: {
        url: "https://example.test/vacuum",
        pageTitle: "Northstar QuietClean Cordless Vacuum",
        capturedAt: "2026-08-28T12:00:00.000Z",
      },
      jsonLdBlocks: [],
      dom: extractDomSnapshot(document),
    });

    if (result.kind !== "success" || result.method !== "dom-fallback") {
      throw new Error("Distinct product prices did not produce a DOM fallback capture.");
    }

    expect(result.truncated).toBe(true);
    expect(result.content).toHaveLength(12_000);
    expect(
      result.content.startsWith(
        "Title: Northstar QuietClean Cordless Vacuum\nPrices:\n- €00000\n- €00001",
      ),
    ).toBe(true);
  });

  it("does not report truncation when DOM evidence formats to exactly twelve thousand characters", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Exact Budget Product</h1>
        <p class="product-price">${"x".repeat(11_962)}</p>
      </main>
    `);

    const result = extractRawProduct({
      source: {
        url: "https://example.test/exact-budget",
        pageTitle: "Exact Budget Product",
        capturedAt: "2026-08-28T12:00:00.000Z",
      },
      jsonLdBlocks: [],
      dom: extractDomSnapshot(document),
    });

    if (result.kind !== "success" || result.method !== "dom-fallback") {
      throw new Error("Exact DOM evidence did not produce a DOM fallback capture.");
    }

    expect(result.content).toHaveLength(12_000);
    expect(result.truncated).toBe(false);
  });

  it("bounds one hundred thousand distinct table specifications before the raw capture budget", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Northstar QuietClean Cordless Vacuum</h1>
        <table></table>
      </main>
    `);
    const table = document.querySelector("table");
    if (table === null) {
      throw new Error("Fixture specification table is missing.");
    }

    for (let index = 0; index < 100_000; index += 1) {
      const row = document.createElement("tr");
      const label = document.createElement("th");
      const value = document.createElement("td");
      label.textContent = `Specification ${String(index).padStart(5, "0")}`;
      value.textContent = `Value ${String(index).padStart(5, "0")}`;
      row.append(label, value);
      table.append(row);
    }

    const dom = extractDomSnapshot(document);
    const result = extractRawProduct({
      source: {
        url: "https://example.test/vacuum",
        pageTitle: "Northstar QuietClean Cordless Vacuum",
        capturedAt: "2026-08-28T12:00:00.000Z",
      },
      jsonLdBlocks: [],
      dom,
    });

    if (result.kind !== "success" || result.method !== "dom-fallback") {
      throw new Error("Distinct specifications did not produce a DOM fallback capture.");
    }

    const expectedPrefix =
      "Title: Northstar QuietClean Cordless Vacuum\nSpecifications:\n- Specification 00000: Value 00000\n- Specification 00001: Value 00001";
    expect(dom.specs.slice(0, 2)).toEqual([
      { label: "Specification 00000", value: "Value 00000" },
      { label: "Specification 00001", value: "Value 00001" },
    ]);
    expect(dom.specs.length).toBeLessThan(1_000);
    expect(dom.hasTruncatedEvidence).toBe(true);
    expect(result.content).toHaveLength(12_000);
    expect(result.truncated).toBe(true);
    expect(result.content.slice(0, expectedPrefix.length)).toBe(expectedPrefix);
  });

  it("does not report truncation when two table specifications format to exactly twelve thousand characters", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Exact Spec Budget</h1>
        <table>
          <tr><th>First</th><td>one</td></tr>
          <tr><th>Second</th><td>${"x".repeat(11_936)}</td></tr>
        </table>
      </main>
    `);

    const dom = extractDomSnapshot(document);
    const result = extractRawProduct({
      source: {
        url: "https://example.test/exact-spec-budget",
        pageTitle: "Exact Spec Budget",
        capturedAt: "2026-08-28T12:00:00.000Z",
      },
      jsonLdBlocks: [],
      dom,
    });

    if (result.kind !== "success" || result.method !== "dom-fallback") {
      throw new Error("Exact specification evidence did not produce a DOM fallback capture.");
    }

    expect(dom.hasTruncatedEvidence).toBeUndefined();
    expect(result.content).toHaveLength(12_000);
    expect(result.truncated).toBe(false);
  });

  it("retains bounded product qualification after an overflowing specification", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Overflow qualification product</h1>
        <table>
          <tr><th>Long</th><td>${"x".repeat(11_997)}</td></tr>
          <tr><th>Battery runtime</th><td>60 minutes</td></tr>
          <tr><th>Dust capacity</th><td>0.7 L</td></tr>
        </table>
      </main>
    `);

    const dom = extractDomSnapshot(document);
    const result = extractRawProduct({
      source: {
        url: "https://example.test/overflow-qualification",
        pageTitle: "Overflow qualification product",
        capturedAt: "2026-08-28T12:00:00.000Z",
      },
      jsonLdBlocks: [],
      dom,
    });

    if (result.kind !== "success" || result.method !== "dom-fallback") {
      throw new Error("Overflowing product specifications did not produce a DOM fallback capture.");
    }

    const expectedPrefix = "Title: Overflow qualification product\nSpecifications:\n- Long: ";
    expect(dom.specs).toHaveLength(1);
    expect(dom.hasTruncatedEvidence).toBe(true);
    expect(dom.hasProductSpecEvidence).toBe(true);
    expect(result.content).toHaveLength(12_000);
    expect(result.truncated).toBe(true);
    expect(result.content.slice(0, expectedPrefix.length)).toBe(expectedPrefix);
    expect(result.content).not.toContain("Battery runtime");
    expect(result.content).not.toContain("Dust capacity");
  });

  it("does not qualify a single overflowing specification", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Single overflowing specification</h1>
        <table>
          <tr><th>Long</th><td>${"x".repeat(11_997)}</td></tr>
        </table>
      </main>
    `);

    const dom = extractDomSnapshot(document);

    expect(dom.specs).toHaveLength(1);
    expect(dom.hasTruncatedEvidence).toBe(true);
    expect(dom.hasProductSpecEvidence).toBeUndefined();
    expect(
      extractRawProduct({
        source: {
          url: "https://example.test/single-overflowing-specification",
          pageTitle: "Single overflowing specification",
          capturedAt: "2026-08-28T12:00:00.000Z",
        },
        jsonLdBlocks: [],
        dom,
      }),
    ).toEqual({ kind: "error", code: "not-product" });
  });

  it("does not report truncation for one hundred thousand duplicate prices", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Northstar QuietClean Cordless Vacuum</h1>
      </main>
    `);
    const main = document.querySelector("main");
    if (main === null) {
      throw new Error("Fixture main content is missing.");
    }

    for (let index = 0; index < 100_000; index += 1) {
      const price = document.createElement("p");
      price.className = "product-price";
      price.textContent = "€379.00";
      main.append(price);
    }

    const result = extractRawProduct({
      source: {
        url: "https://example.test/vacuum",
        pageTitle: "Northstar QuietClean Cordless Vacuum",
        capturedAt: "2026-08-28T12:00:00.000Z",
      },
      jsonLdBlocks: [],
      dom: extractDomSnapshot(document),
    });

    expect(result).toEqual({
      kind: "success",
      source: {
        url: "https://example.test/vacuum",
        pageTitle: "Northstar QuietClean Cordless Vacuum",
        capturedAt: "2026-08-28T12:00:00.000Z",
      },
      method: "dom-fallback",
      content: "Title: Northstar QuietClean Cordless Vacuum\nPrices:\n- €379.00",
      truncated: false,
    });
  });

  it("bounds one hundred thousand distinct marked bullets to the deterministic raw budget", () => {
    const { document } = parseHTML(`
      <main data-page-type="product">
        <h1>Northstar QuietClean Cordless Vacuum</h1>
        <ul class="product-features"></ul>
      </main>
    `);
    const list = document.querySelector("ul");
    if (list === null) {
      throw new Error("Fixture product list is missing.");
    }

    for (let index = 0; index < 100_000; index += 1) {
      const bullet = document.createElement("li");
      bullet.textContent = `Feature ${String(index).padStart(5, "0")}`;
      list.append(bullet);
    }

    const dom = extractDomSnapshot(document);
    expect(dom.bullets.join("").length).toBeLessThanOrEqual(12_000);
    expect(dom.bullets.slice(0, 2)).toEqual(["Feature 00000", "Feature 00001"]);
    expect(dom.hasProductBulletEvidence).toBe(true);
  });

  it("excludes navigation and closed details content except its summary", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Northstar QuietClean Cordless Vacuum</h1>
        <p class="productPrice">€379.00</p>
        <div role="navigation">
          <p class="productPrice">€998.00 navigation</p>
          <ul><li>Navigation item</li></ul>
        </div>
        <details>
          <summary>Delivery details</summary>
          <p class="productPrice">€997.00 closed detail</p>
          <ul><li>Closed detail item</li></ul>
        </details>
        <details class="productPrice">
          <summary>Hidden offer</summary>
          <p>€996.00 closed details element</p>
        </details>
      </main>
    `);

    expect(extractDomSnapshot(document)).toEqual({
      title: "Northstar QuietClean Cordless Vacuum",
      priceTexts: ["€379.00"],
      specs: [],
      bullets: [],
      hasProductBulletEvidence: false,
    });
  });

  it("excludes other content roots while retaining product headers in the selected main root", () => {
    const { document } = parseHTML(`
      <header>
        <h1>Northstar Home</h1>
        <p class="productPrice">€999.00 site promotion</p>
      </header>
      <main>
        <header>
          <h1>Northstar Main Product</h1>
          <p class="productPrice">€379.00</p>
        </header>
      </main>
      <div role="main">
        <header>
          <h1>Northstar Role Product</h1>
          <p class="productPrice">€279.00</p>
        </header>
      </div>
      <article>
        <header>
          <h1>Northstar Article Product</h1>
          <p class="productPrice">€179.00</p>
        </header>
      </article>
    `);

    const snapshot = extractDomSnapshot(document);

    expect(snapshot).toEqual({
      title: "Northstar Main Product",
      priceTexts: ["€379.00"],
      specs: [],
      bullets: [],
      hasProductBulletEvidence: false,
    });
    expect(JSON.stringify(snapshot)).not.toContain("€279.00");
    expect(JSON.stringify(snapshot)).not.toContain("€179.00");
    expect(JSON.stringify(snapshot)).not.toContain("Northstar Role Product");
    expect(JSON.stringify(snapshot)).not.toContain("Northstar Article Product");
  });

  it("uses document scope only when no semantic content root exists", () => {
    const { document } = parseHTML(`
      <header><p class="product-price">€999.00 site promotion</p></header>
      <section>
        <h1>Northstar QuietClean Cordless Vacuum</h1>
        <p class="product-price">€379.00</p>
        <p class="product-price">€279.00</p>
        <p class="product-price">€179.00</p>
      </section>
    `);

    expect(extractDomSnapshot(document)).toEqual({
      title: "Northstar QuietClean Cordless Vacuum",
      priceTexts: ["€379.00", "€279.00", "€179.00"],
      specs: [],
      bullets: [],
      hasProductBulletEvidence: false,
    });
  });

  it("uses an outer semantic root as deterministic negative scope when no root has product evidence", () => {
    const { document } = parseHTML(`
      <article>
        <h1>Editorial comparison shell</h1>
        <main>
          <h1>Nested product shell</h1>
        </main>
      </article>
    `);

    expect(extractDomSnapshot(document)).toEqual({
      title: "Editorial comparison shell",
      priceTexts: [],
      specs: [],
      bullets: [],
      hasProductBulletEvidence: false,
    });
  });

  it("uses the product content root title before an earlier guide root", () => {
    const { document } = parseHTML(`
      <article>
        <h1>Buying guide: quiet kitchen appliances</h1>
        <p>Choose the right capacity for your home.</p>
      </article>
      <main>
        <h1>Northstar QuietClean Cordless Vacuum</h1>
        <p class="product-price">€379.00</p>
      </main>
    `);

    const dom = extractDomSnapshot(document);
    expect(dom.title).toBe("Northstar QuietClean Cordless Vacuum");
    expect(
      extractRawProduct({
        source: {
          url: "https://example.test/vacuum",
          pageTitle: "Northstar QuietClean Cordless Vacuum",
          capturedAt: "2026-08-28T12:00:00.000Z",
        },
        jsonLdBlocks: [],
        dom,
      }),
    ).toEqual({
      kind: "success",
      source: {
        url: "https://example.test/vacuum",
        pageTitle: "Northstar QuietClean Cordless Vacuum",
        capturedAt: "2026-08-28T12:00:00.000Z",
      },
      method: "dom-fallback",
      content: "Title: Northstar QuietClean Cordless Vacuum\nPrices:\n- €379.00",
      truncated: false,
    });
  });

  it("uses a local Product marker to select scope without treating the marker as core qualification", () => {
    const { document } = parseHTML(`
      <article>
        <h1>Editorial guide</h1>
        <p class="product-price">€5.00 editorial</p>
      </article>
      <main data-page-type="product">
        <h1>Northstar QuietClean Cordless Vacuum</h1>
      </main>
    `);
    const dom = extractDomSnapshot(document);

    expect(dom).toEqual({
      title: "Northstar QuietClean Cordless Vacuum",
      priceTexts: [],
      specs: [],
      bullets: [],
      hasProductBulletEvidence: false,
    });
    expect(
      extractRawProduct({
        source: {
          url: "https://example.test/vacuum",
          pageTitle: "Northstar QuietClean Cordless Vacuum",
          capturedAt: "2026-08-28T12:00:00.000Z",
        },
        jsonLdBlocks: [],
        dom,
      }),
    ).toEqual({ kind: "error", code: "not-product" });
  });

  it("prefers main product evidence before an article Product marker", () => {
    const { document } = parseHTML(`
      <article data-page-type="product">
        <h1>Editorial product shell</h1>
      </article>
      <main>
        <h1>Northstar QuietClean Cordless Vacuum</h1>
        <p class="product-price">€379.00</p>
      </main>
    `);

    expect(extractDomSnapshot(document)).toEqual({
      title: "Northstar QuietClean Cordless Vacuum",
      priceTexts: ["€379.00"],
      specs: [],
      bullets: [],
      hasProductBulletEvidence: false,
    });
  });

  it("prefers a local Product article over an earlier og:type-supported editorial list", () => {
    const { document } = parseHTML(`
      <html>
        <head><meta property="og:type" content="product" /></head>
        <body>
          <article>
            <h1>Editorial feature roundup</h1>
            <section class="product-features">
              <ul><li>Editorial point A</li><li>Editorial point B</li></ul>
            </section>
          </article>
          <article itemscope itemtype="https://schema.org/Product">
            <h1>Northstar QuietClean Cordless Vacuum</h1>
            <p class="product-price">€379.00</p>
          </article>
        </body>
      </html>
    `);

    const dom = extractDomSnapshot(document);

    expect(dom).toEqual({
      title: "Northstar QuietClean Cordless Vacuum",
      priceTexts: ["€379.00"],
      specs: [],
      bullets: [],
      hasProductBulletEvidence: false,
    });
    expect(
      extractRawProduct({
        source: {
          url: "https://example.test/vacuum",
          pageTitle: "Northstar QuietClean Cordless Vacuum",
          capturedAt: "2026-08-28T12:00:00.000Z",
        },
        jsonLdBlocks: [],
        dom,
      }),
    ).toEqual({
      kind: "success",
      source: {
        url: "https://example.test/vacuum",
        pageTitle: "Northstar QuietClean Cordless Vacuum",
        capturedAt: "2026-08-28T12:00:00.000Z",
      },
      method: "dom-fallback",
      content: "Title: Northstar QuietClean Cordless Vacuum\nPrices:\n- €379.00",
      truncated: false,
    });
  });

  it("prefers a locally marked product list over an earlier og:type-supported editorial list", () => {
    const { document } = parseHTML(`
      <html>
        <head><meta property="og:type" content="product" /></head>
        <body>
          <article>
            <h1>Editorial feature roundup</h1>
            <section class="product-features">
              <ul><li>Editorial point A</li><li>Editorial point B</li></ul>
            </section>
          </article>
          <article>
            <h1>CrispWave Air Fryer 5.5L</h1>
            <section data-page-type="product" class="product-features">
              <ul><li>Rapid hot-air circulation</li><li>Dishwasher-safe basket</li></ul>
            </section>
          </article>
        </body>
      </html>
    `);

    const dom = extractDomSnapshot(document);

    expect(dom).toEqual({
      title: "CrispWave Air Fryer 5.5L",
      priceTexts: [],
      specs: [],
      bullets: ["Rapid hot-air circulation", "Dishwasher-safe basket"],
      hasProductBulletEvidence: true,
    });
    expect(
      extractRawProduct({
        source: {
          url: "https://example.test/air-fryer",
          pageTitle: "CrispWave Air Fryer 5.5L",
          capturedAt: "2026-08-28T12:00:00.000Z",
        },
        jsonLdBlocks: [],
        dom,
      }),
    ).toEqual({
      kind: "success",
      source: {
        url: "https://example.test/air-fryer",
        pageTitle: "CrispWave Air Fryer 5.5L",
        capturedAt: "2026-08-28T12:00:00.000Z",
      },
      method: "dom-fallback",
      content:
        "Title: CrispWave Air Fryer 5.5L\nBullets:\n- Rapid hot-air circulation\n- Dishwasher-safe basket",
      truncated: false,
    });
  });

  it("keeps contradictory price and specification evidence inside the selected product root", () => {
    const { document } = parseHTML(`
      <article>
        <h1>Guide editorial</h1>
        <p class="product-price">€5.00 editorial</p>
        <table><tr><th>Editorial length</th><td>8 pages</td></tr></table>
        <ul><li>Editorial point A</li><li>Editorial point B</li></ul>
      </article>
      <main data-page-type="product">
        <h1>Northstar QuietClean Cordless Vacuum</h1>
        <p class="product-price">€379.00</p>
        <table><tr><th>Battery runtime</th><td>60 minutes</td></tr></table>
        <section class="product-features">
          <ul><li>HEPA filtration</li><li>LED floor head</li></ul>
        </section>
      </main>
    `);

    expect(extractDomSnapshot(document)).toEqual({
      title: "Northstar QuietClean Cordless Vacuum",
      priceTexts: ["€379.00"],
      specs: [{ label: "Battery runtime", value: "60 minutes" }],
      bullets: ["HEPA filtration", "LED floor head"],
      hasProductBulletEvidence: true,
    });
  });

  it("does not borrow a title from a nested content root", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Northstar QuietClean Cordless Vacuum</h1>
        <p class="product-price">€379.00</p>
        <article>
          <h1>Customer review: quiet and easy</h1>
          <p class="price">€5.00</p>
        </article>
      </main>
    `);

    expect(extractDomSnapshot(document).title).toBe("Northstar QuietClean Cordless Vacuum");
  });

  it("excludes a nested review price from the selected product root", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Northstar QuietClean Cordless Vacuum</h1>
        <p class="product-price">€379.00</p>
        <article>
          <h2>Customer review</h2>
          <p class="product-price">€5.00 review price</p>
        </article>
      </main>
    `);

    expect(extractDomSnapshot(document).priceTexts).toEqual(["€379.00"]);
  });

  it("excludes a nested review specification from the selected product root", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Northstar QuietClean Cordless Vacuum</h1>
        <p class="product-price">€379.00</p>
        <table><tr><th>Battery runtime</th><td>60 minutes</td></tr></table>
        <article>
          <h2>Customer review</h2>
          <table><tr><th>Review score</th><td>5 stars</td></tr></table>
        </article>
      </main>
    `);

    expect(extractDomSnapshot(document).specs).toEqual([
      { label: "Battery runtime", value: "60 minutes" },
    ]);
  });

  it("uses a local itemprop name when the selected root has no visible h1", () => {
    const { document } = parseHTML(`
      <main>
        <span itemprop="name">Northstar QuietClean Cordless Vacuum</span>
        <p class="product-price">€379.00</p>
      </main>
      <article>
        <h1>Guide editorial</h1>
      </article>
    `);

    expect(extractDomSnapshot(document).title).toBe("Northstar QuietClean Cordless Vacuum");
  });

  it("uses only the selected root's marked product bullet list", () => {
    const { document } = parseHTML(`
      <html>
        <head><meta property="og:type" content="product" /></head>
        <body>
          <article>
            <h1>Editorial guide</h1>
            <section class="product-features">
              <ul><li>Editorial point A</li><li>Editorial point B</li></ul>
            </section>
          </article>
          <main>
            <h1>Northstar QuietClean Cordless Vacuum</h1>
            <p class="product-price">€379.00</p>
            <section class="product-features">
              <ul><li>HEPA filtration</li><li>LED floor head</li></ul>
            </section>
          </main>
        </body>
      </html>
    `);

    expect(extractDomSnapshot(document).bullets).toEqual(["HEPA filtration", "LED floor head"]);
  });

  it("does not aggregate generic bullets from separate lists in the selected root", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Northstar QuietClean Cordless Vacuum</h1>
        <p class="product-price">€379.00</p>
        <ul><li>First product bullet</li></ul>
        <ul><li>Second unrelated bullet</li></ul>
      </main>
    `);

    expect(extractDomSnapshot(document).bullets).toEqual(["First product bullet"]);
  });

  it("does not mark a generic editorial list as product evidence", () => {
    const { document } = parseHTML(`
      <div role="article">
        <h1>How to choose a quiet kitchen</h1>
        <ul>
          <li>Compare the noise level</li>
          <li>Read the warranty terms</li>
        </ul>
      </div>
    `);

    expect(extractDomSnapshot(document)).toEqual({
      title: "How to choose a quiet kitchen",
      priceTexts: [],
      specs: [],
      bullets: ["Compare the noise level", "Read the warranty terms"],
      hasProductBulletEvidence: false,
    });
  });

  it("does not mark article feature lists without a structural product marker", () => {
    const { document } = parseHTML(`
      <article>
        <h1>How to choose a quiet kitchen</h1>
        <ul class="article-features">
          <li>Compare the noise level</li>
          <li>Read the warranty terms</li>
        </ul>
      </article>
    `);

    expect(extractDomSnapshot(document).hasProductBulletEvidence).toBe(false);
  });

  it("does not mark role article feature lists without a structural product marker", () => {
    const { document } = parseHTML(`
      <div role="article">
        <h1>How to choose a quiet kitchen</h1>
        <ul class="article-features">
          <li>Compare the noise level</li>
          <li>Read the warranty terms</li>
        </ul>
      </div>
    `);

    expect(extractDomSnapshot(document).hasProductBulletEvidence).toBe(false);
  });

  it("marks a product list even when a review article is elsewhere", () => {
    const { document } = parseHTML(`
      <article>
        <h2>Customer review</h2>
        <p>Quiet and easy to use.</p>
      </article>
      <main data-page-type="product">
        <h1>CrispWave Air Fryer 5.5L</h1>
        <ul class="product-features">
          <li>Rapid hot-air circulation</li>
          <li>Dishwasher-safe basket</li>
        </ul>
      </main>
    `);

    expect(extractDomSnapshot(document)).toEqual({
      title: "CrispWave Air Fryer 5.5L",
      priceTexts: [],
      specs: [],
      bullets: ["Rapid hot-air circulation", "Dishwasher-safe basket"],
      hasProductBulletEvidence: true,
    });
  });

  it("marks wrapped product bullets when the document has an exact microdata product marker", () => {
    const { document } = parseHTML(`
      <main itemscope itemtype="https://schema.org/Product">
        <h1>CrispWave Air Fryer 5.5L</h1>
        <section class="product-features">
          <div><ul><li>Rapid hot-air circulation</li><li>Dishwasher-safe basket</li></ul></div>
        </section>
      </main>
    `);

    expect(extractDomSnapshot(document).hasProductBulletEvidence).toBe(true);
  });

  it("marks product bullets when og:type is exactly product", () => {
    const { document } = parseHTML(`
      <html>
        <head><meta property="og:type" content="product" /></head>
        <body>
          <main>
            <h1>CrispWave Air Fryer 5.5L</h1>
            <ul data-testid="selling-points">
              <li>Rapid hot-air circulation</li><li>Dishwasher-safe basket</li>
            </ul>
          </main>
        </body>
      </html>
    `);

    expect(extractDomSnapshot(document).hasProductBulletEvidence).toBe(true);
  });

  it("ignores og:type product metadata outside document head", () => {
    const { document } = parseHTML(`
      <main>
        <h1>CrispWave Air Fryer 5.5L</h1>
        <ul class="product-features">
          <li>Rapid hot-air circulation</li><li>Dishwasher-safe basket</li>
        </ul>
      </main>
      <aside hidden><meta property="og:type" content="product" /></aside>
    `);

    expect(extractDomSnapshot(document).hasProductBulletEvidence).toBe(false);
  });

  it("marks product bullets when data-page-type is exactly product", () => {
    const { document } = parseHTML(`
      <body data-page-type="product">
        <h1>CrispWave Air Fryer 5.5L</h1>
        <ul class="features">
          <li>Rapid hot-air circulation</li><li>Dishwasher-safe basket</li>
        </ul>
      </body>
    `);

    expect(extractDomSnapshot(document).hasProductBulletEvidence).toBe(true);
  });

  it("ignores a non-schema itemtype as a product page marker", () => {
    const { document } = parseHTML(`
      <main itemscope itemtype="https://evil.test/Product">
        <h1>CrispWave Air Fryer 5.5L</h1>
        <ul class="product-features">
          <li>Rapid hot-air circulation</li><li>Dishwasher-safe basket</li>
        </ul>
      </main>
    `);

    expect(extractDomSnapshot(document).hasProductBulletEvidence).toBe(false);
  });

  it("does not borrow a visible Product marker from a separate annex", () => {
    const { document } = parseHTML(`
      <main>
        <h1>How to choose a quiet kitchen</h1>
        <ul class="article-features">
          <li>Compare prices</li><li>Read reviews</li>
        </ul>
      </main>
      <section itemscope itemtype="https://schema.org/Product">
        Product metadata for another region
      </section>
    `);

    expect(extractDomSnapshot(document).hasProductBulletEvidence).toBe(false);
  });

  it("serializes the first qualifying marked list and excludes a later marked list", () => {
    const { document } = parseHTML(`
      <main data-page-type="product">
        <h1>CrispWave Air Fryer 5.5L</h1>
        <section class="product-features">
          <ul><li>Rapid hot-air circulation</li><li>Dishwasher-safe basket</li></ul>
        </section>
        <section class="product-highlights">
          <ul><li>Viewing window</li><li>Cool-touch handle</li></ul>
        </section>
      </main>
    `);

    expect(extractDomSnapshot(document)).toEqual({
      title: "CrispWave Air Fryer 5.5L",
      priceTexts: [],
      specs: [],
      bullets: ["Rapid hot-air circulation", "Dishwasher-safe basket"],
      hasProductBulletEvidence: true,
    });
  });

  it("serializes only the marked product list when an editorial list is nearby", () => {
    const { document } = parseHTML(`
      <main itemscope itemtype="https://schema.org/Product">
        <h1>CrispWave Air Fryer 5.5L</h1>
        <section class="product-features">
          <div><ul><li>Rapid hot-air circulation</li><li>Dishwasher-safe basket</li></ul></div>
        </section>
        <article>
          <ul><li>Compare prices</li><li>Read reviews</li></ul>
        </article>
      </main>
    `);

    expect(extractDomSnapshot(document)).toEqual({
      title: "CrispWave Air Fryer 5.5L",
      priceTexts: [],
      specs: [],
      bullets: ["Rapid hot-air circulation", "Dishwasher-safe basket"],
      hasProductBulletEvidence: true,
    });
  });

  it("does not borrow a list marker beyond the content root", () => {
    const { document } = parseHTML(`
      <div class="product-features">
        <main data-page-type="product">
          <h1>CrispWave Air Fryer 5.5L</h1>
          <div><ul><li>Rapid hot-air circulation</li><li>Dishwasher-safe basket</li></ul></div>
        </main>
      </div>
    `);

    expect(extractDomSnapshot(document).hasProductBulletEvidence).toBe(false);
  });

  it("does not combine bullets from separate marked lists", () => {
    const { document } = parseHTML(`
      <main data-page-type="product">
        <h1>CrispWave Air Fryer 5.5L</h1>
        <ul class="product-features"><li>Rapid hot-air circulation</li></ul>
        <ol data-testid="selling-points"><li>Dishwasher-safe basket</li></ol>
      </main>
    `);

    expect(extractDomSnapshot(document)).toEqual({
      title: "CrispWave Air Fryer 5.5L",
      priceTexts: [],
      specs: [],
      bullets: ["Rapid hot-air circulation"],
      hasProductBulletEvidence: false,
    });
  });

  it("keeps only the first marked list when no marked list has two bullets", () => {
    const { document } = parseHTML(`
      <main data-page-type="product">
        <h1>CrispWave Air Fryer 5.5L</h1>
        <section class="product-features"><ul><li>Rapid hot-air circulation</li></ul></section>
        <section class="product-highlights"><ul><li>Viewing window</li></ul></section>
      </main>
    `);

    expect(extractDomSnapshot(document).bullets).toEqual(["Rapid hot-air circulation"]);
  });

  it("accepts a product marker on a list parent only", () => {
    const { document } = parseHTML(`
      <main data-page-type="product">
        <h1>CrispWave Air Fryer 5.5L</h1>
        <section aria-label="Product benefits">
          <ul><li>Rapid hot-air circulation</li><li>Dishwasher-safe basket</li></ul>
        </section>
      </main>
    `);

    expect(extractDomSnapshot(document).hasProductBulletEvidence).toBe(true);
  });

  it("extracts JSON-LD script text separately from visible DOM evidence", () => {
    const { document } = parseHTML(`
      <body>
        <script type="application/ld+json">{"@type":"Product","name":"Visible product"}</script>
        <script type="text/javascript">const ignored = true;</script>
        <main><h1>Visible product</h1><p class="price">€20.00</p></main>
      </body>
    `);

    expect(extractJsonLdBlocks(document)).toEqual(['{"@type":"Product","name":"Visible product"}']);
    expect(extractDomSnapshot(document)).toEqual({
      title: "Visible product",
      priceTexts: ["€20.00"],
      specs: [],
      bullets: [],
      hasProductBulletEvidence: false,
    });
  });

  it("drops an oversized JSON-LD script before retaining its text", () => {
    const oversizedJsonLd = `{"padding":"${"x".repeat(64_000)}","@type":"Product","name":"Late sentinel"}`;
    const { document } = parseHTML(
      `<script type="application/ld+json">${oversizedJsonLd}</script>`,
    );

    expect(oversizedJsonLd.length).toBeGreaterThan(64_000);
    expect(extractJsonLdBlocks(document)).toEqual([]);
  });

  it("stops after the first sixteen JSON-LD scripts before a later sentinel", () => {
    const retainedBlocks = Array.from(
      { length: 16 },
      (_, index) => `{"@type":"BreadcrumbList","name":"retained-${index}"}`,
    );
    const sentinel = '{"@type":"Product","name":"seventeenth sentinel"}';
    const { document } = parseHTML(
      retainedBlocks
        .concat(sentinel)
        .map((block) => `<script type="application/ld+json">${block}</script>`)
        .join(""),
    );

    expect(extractJsonLdBlocks(document)).toEqual(retainedBlocks);
  });

  it("stops at the 256000-character JSON-LD budget before a later sentinel", () => {
    const retainedBlocks = Array.from({ length: 4 }, (_, index) =>
      JSON.stringify({ padding: "x".repeat(59_900), marker: `retained-${index}` }),
    );
    const sentinel = JSON.stringify({
      padding: "x".repeat(20_000),
      mainEntity: { "@type": "Product", name: "over-budget sentinel" },
    });
    const totalRetainedLength = retainedBlocks.reduce((total, block) => total + block.length, 0);
    const { document } = parseHTML(
      retainedBlocks
        .concat(sentinel)
        .map((block) => `<script type="application/ld+json">${block}</script>`)
        .join(""),
    );

    expect(totalRetainedLength).toBeLessThanOrEqual(256_000);
    expect(totalRetainedLength + sentinel.length).toBeGreaterThan(256_000);
    expect(extractJsonLdBlocks(document)).toHaveLength(4);
    expect(extractJsonLdBlocks(document)).not.toContain(sentinel);
  });
});
