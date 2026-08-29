export type JsonPrimitive = string | number | boolean | null;

export type JsonObject = {
  readonly [key: string]: JsonValue;
};

export type JsonArray = readonly JsonValue[];

export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export type PageSource = {
  readonly url: string;
  readonly pageTitle: string;
  readonly capturedAt: string;
};

export type DomSpec = {
  readonly label: string;
  readonly value: string;
};

export type DomSnapshot = {
  readonly title: string;
  readonly priceTexts: readonly string[];
  readonly specs: readonly DomSpec[];
  readonly bullets: readonly string[];
  readonly hasProductBulletEvidence: boolean;
  /**
   * The DOM adapter observed at least two distinct visible specifications, but
   * could not retain them all within the raw-content budget.
   */
  readonly hasProductSpecEvidence?: true;
  readonly hasTruncatedEvidence?: true;
};

export type PageSnapshot = {
  readonly source: PageSource;
  readonly jsonLdBlocks: readonly string[];
  readonly dom: DomSnapshot;
};

export type ExtractionMethod = "json-ld" | "dom-fallback";

export type JsonLdExtractionSuccess = {
  readonly kind: "success";
  readonly source: PageSource;
  readonly method: "json-ld";
  readonly content: JsonObject;
  readonly truncated: false;
};

export type DomExtractionSuccess = {
  readonly kind: "success";
  readonly source: PageSource;
  readonly method: "dom-fallback";
  readonly content: string;
  readonly truncated: boolean;
};

export type ExtractionSuccess = JsonLdExtractionSuccess | DomExtractionSuccess;

export type ExtractionErrorCode = "not-product" | "ambiguous-product";

export type ExtractionError = {
  readonly kind: "error";
  readonly code: ExtractionErrorCode;
};

export type ExtractionResult = ExtractionSuccess | ExtractionError;

export const MAX_RAW_CONTENT_LENGTH = 12_000;
export const MAX_JSON_LD_BLOCKS = 16;
export const MAX_JSON_LD_BLOCK_LENGTH = 64_000;
export const MAX_JSON_LD_TOTAL_LENGTH = 256_000;
const MAX_JSON_LD_NODE_VISITS = 12_000;

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

type JsonValidationFrame = {
  readonly value: unknown;
  readonly exit: boolean;
};

export function isJsonValue(value: unknown): value is JsonValue {
  const pending: JsonValidationFrame[] = [{ value, exit: false }];
  const active = new WeakSet<object>();

  try {
    while (pending.length > 0) {
      const frame = pending.pop();
      if (frame === undefined) {
        continue;
      }

      const current = frame.value;
      if (
        current === null ||
        typeof current === "string" ||
        typeof current === "boolean" ||
        (typeof current === "number" && Number.isFinite(current))
      ) {
        continue;
      }

      if (typeof current !== "object") {
        return false;
      }

      if (frame.exit) {
        active.delete(current);
        continue;
      }

      if (active.has(current) || (Array.isArray(current) === false && !isPlainObject(current))) {
        return false;
      }

      active.add(current);
      pending.push({ value: current, exit: true });

      if (Array.isArray(current)) {
        for (let index = current.length - 1; index >= 0; index -= 1) {
          const item = current[index];
          if (item === undefined) {
            return false;
          }

          pending.push({ value: item, exit: false });
        }
        continue;
      }

      const symbols = Object.getOwnPropertySymbols(current);
      if (symbols.length > 0) {
        return false;
      }

      const keys = Object.keys(current);
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index];
        if (key === undefined) {
          continue;
        }

        pending.push({ value: current[key], exit: false });
      }
    }
  } catch {
    return false;
  }

  return true;
}

function isJsonValueWithinBudget(value: unknown, maximumLength: number): value is JsonValue {
  const pending: JsonValidationFrame[] = [{ value, exit: false }];
  const active = new WeakSet<object>();
  let encodedLength = 0;

  const addEncodedLength = (length: number): boolean => {
    if (length < 0 || length > maximumLength - encodedLength) {
      return false;
    }

    encodedLength += length;
    return true;
  };

  const addEncodedString = (current: string): boolean => {
    if (current.length + 2 > maximumLength - encodedLength) {
      return false;
    }

    return addEncodedLength(JSON.stringify(current).length);
  };

  try {
    while (pending.length > 0) {
      const frame = pending.pop();
      if (frame === undefined) {
        continue;
      }

      const current = frame.value;
      if (current === null) {
        if (!addEncodedLength(4)) {
          return false;
        }
        continue;
      }
      if (typeof current === "string") {
        if (!addEncodedString(current)) {
          return false;
        }
        continue;
      }
      if (typeof current === "boolean") {
        if (!addEncodedLength(current ? 4 : 5)) {
          return false;
        }
        continue;
      }
      if (typeof current === "number" && Number.isFinite(current)) {
        if (!addEncodedLength(JSON.stringify(current).length)) {
          return false;
        }
        continue;
      }
      if (typeof current !== "object") {
        return false;
      }

      if (frame.exit) {
        active.delete(current);
        continue;
      }

      if (active.has(current) || (Array.isArray(current) === false && !isPlainObject(current))) {
        return false;
      }

      active.add(current);
      pending.push({ value: current, exit: true });
      if (!addEncodedLength(2)) {
        return false;
      }

      if (Array.isArray(current)) {
        if (current.length > 1 && !addEncodedLength(current.length - 1)) {
          return false;
        }

        for (let index = current.length - 1; index >= 0; index -= 1) {
          const item = current[index];
          if (item === undefined) {
            return false;
          }
          pending.push({ value: item, exit: false });
        }
        continue;
      }

      if (Object.getOwnPropertySymbols(current).length > 0) {
        return false;
      }

      let keyCount = 0;
      for (const key in current) {
        if (!Object.hasOwn(current, key)) {
          continue;
        }
        if (keyCount > 0 && !addEncodedLength(1)) {
          return false;
        }
        keyCount += 1;
        if (key.length + 3 > maximumLength - encodedLength || !addEncodedString(key)) {
          return false;
        }
        if (!addEncodedLength(1)) {
          return false;
        }
        pending.push({ value: current[key], exit: false });
      }
    }
  } catch {
    return false;
  }

  return true;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return isJsonValue(value) && typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonObjectNode(value: unknown): value is JsonObject {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && isPlainObject(value)
  );
}

function isProductType(value: string): boolean {
  return (
    value === "Product" ||
    value === "https://schema.org/Product" ||
    value === "http://schema.org/Product"
  );
}

function isProductNode(value: JsonObject): boolean {
  const type = value["@type"];

  if (typeof type === "string") {
    return isProductType(type);
  }

  if (Array.isArray(type)) {
    return (
      type.length > 0 &&
      type.every((item) => typeof item === "string") &&
      type.some((item) => typeof item === "string" && isProductType(item))
    );
  }

  return false;
}

export function isProductJsonObject(value: unknown): value is JsonObject {
  if (!isJsonValueWithinBudget(value, MAX_RAW_CONTENT_LENGTH) || !isJsonObjectNode(value)) {
    return false;
  }

  return isProductNode(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && isPlainObject(value)
  );
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();

  return (
    actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index])
  );
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    return false;
  }

  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}

function isPageSource(value: unknown): value is PageSource {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["capturedAt", "pageTitle", "url"]) &&
    isHttpUrl(value.url) &&
    typeof value.pageTitle === "string" &&
    isIsoTimestamp(value.capturedAt)
  );
}

export function isExtractionResult(value: unknown): value is ExtractionResult {
  try {
    if (!isRecord(value) || typeof value.kind !== "string") {
      return false;
    }

    if (value.kind === "error") {
      return (
        hasExactKeys(value, ["code", "kind"]) &&
        (value.code === "not-product" || value.code === "ambiguous-product")
      );
    }

    if (
      value.kind !== "success" ||
      !hasExactKeys(value, ["content", "kind", "method", "source", "truncated"]) ||
      !isPageSource(value.source)
    ) {
      return false;
    }

    if (value.method === "json-ld") {
      return value.truncated === false && isProductJsonObject(value.content);
    }

    if (value.method !== "dom-fallback") {
      return false;
    }

    return (
      typeof value.content === "string" &&
      value.content.trim().length > 0 &&
      ((value.truncated === true && value.content.length === MAX_RAW_CONTENT_LENGTH) ||
        (value.truncated === false && value.content.length <= MAX_RAW_CONTENT_LENGTH))
    );
  } catch {
    return false;
  }
}

function findProductNodes(value: unknown): JsonObject[] {
  const products: JsonObject[] = [];
  const pending: unknown[] = [value];
  let inspectedNodes = 0;

  while (pending.length > 0) {
    if (inspectedNodes >= MAX_JSON_LD_NODE_VISITS) {
      return products;
    }
    inspectedNodes += 1;

    const current = pending.pop();
    if (current === undefined) {
      continue;
    }

    if (Array.isArray(current)) {
      if (current.length > MAX_JSON_LD_NODE_VISITS) {
        return products;
      }
      for (let index = current.length - 1; index >= 0; index -= 1) {
        const item = current[index];
        if (item !== undefined) {
          pending.push(item);
        }
      }
      continue;
    }

    if (!isJsonObjectNode(current)) {
      continue;
    }

    if (isProductNode(current)) {
      products.push(current);
      if (products.length === 2) {
        return products;
      }
    }

    let childCount = 0;
    for (const key in current) {
      if (!Object.hasOwn(current, key) || key === "@context") {
        continue;
      }

      if (childCount >= MAX_JSON_LD_NODE_VISITS) {
        return products;
      }
      childCount += 1;

      const child = current[key];
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }

  return products;
}

function findJsonLdProduct(jsonLdBlocks: unknown): JsonObject[] {
  if (!Array.isArray(jsonLdBlocks)) {
    return [];
  }

  const products: JsonObject[] = [];
  let inspectedBlocks = 0;
  let inspectedCharacters = 0;

  for (const block of jsonLdBlocks) {
    if (inspectedBlocks >= MAX_JSON_LD_BLOCKS) {
      break;
    }
    inspectedBlocks += 1;

    if (typeof block !== "string") {
      continue;
    }
    if (block.length > MAX_JSON_LD_BLOCK_LENGTH) {
      continue;
    }
    if (block.length > MAX_JSON_LD_TOTAL_LENGTH - inspectedCharacters) {
      break;
    }
    inspectedCharacters += block.length;

    let parsed: unknown;

    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }

    for (const product of findProductNodes(parsed)) {
      products.push(product);
      if (products.length === 2) {
        return products;
      }
    }
  }

  return products;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function uniqueValues(values: readonly string[]): string[] {
  const seen = new Set<string>();

  return values.reduce<string[]>((result, value) => {
    const normalized = normalizeText(value);

    if (normalized.length > 0 && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }

    return result;
  }, []);
}

function normalizeSpecs(specs: readonly DomSpec[]): DomSpec[] {
  const seen = new Set<string>();

  return specs.reduce<DomSpec[]>((result, spec) => {
    const label = normalizeText(spec.label);
    const value = normalizeText(spec.value);
    const key = `${label}\u0000${value}`;

    if (label.length > 0 && value.length > 0 && !seen.has(key)) {
      seen.add(key);
      result.push({ label, value });
    }

    return result;
  }, []);
}

function appendSection(lines: string[], heading: string, entries: readonly string[]): void {
  if (entries.length === 0) {
    return;
  }

  lines.push(heading, ...entries.map((entry) => `- ${entry}`));
}

function formatDomContent(dom: DomSnapshot): { content: string; truncated: boolean } {
  const title = normalizeText(dom.title);
  const prices = uniqueValues(dom.priceTexts);
  const specs = normalizeSpecs(dom.specs);
  const bullets = uniqueValues(dom.bullets);
  const lines = [`Title: ${title}`];

  appendSection(lines, "Prices:", prices);
  appendSection(
    lines,
    "Specifications:",
    specs.map((spec) => `${spec.label}: ${spec.value}`),
  );
  appendSection(lines, "Bullets:", bullets);

  const content = lines.join("\n");

  const reachesRawContentBudget =
    content.length > MAX_RAW_CONTENT_LENGTH ||
    (dom.hasTruncatedEvidence === true && content.length >= MAX_RAW_CONTENT_LENGTH);

  return reachesRawContentBudget
    ? { content: content.slice(0, MAX_RAW_CONTENT_LENGTH), truncated: true }
    : { content, truncated: false };
}

function extractDomFallback(dom: DomSnapshot, source: PageSource): ExtractionResult {
  const title = normalizeText(dom.title);
  const prices = uniqueValues(dom.priceTexts);
  const specs = normalizeSpecs(dom.specs);
  const bullets = uniqueValues(dom.bullets);
  const hasBulletEvidence = dom.hasProductBulletEvidence && bullets.length >= 2;
  const hasSpecificationEvidence = specs.length >= 2 || dom.hasProductSpecEvidence === true;

  if (
    title.length === 0 ||
    (prices.length === 0 && !hasSpecificationEvidence && !hasBulletEvidence)
  ) {
    return { kind: "error", code: "not-product" };
  }

  const formatted = formatDomContent(dom);

  return {
    kind: "success",
    source,
    method: "dom-fallback",
    content: formatted.content,
    truncated: formatted.truncated,
  };
}

export function extractRawProduct(pageSnapshot: PageSnapshot): ExtractionResult {
  const products = findJsonLdProduct(pageSnapshot.jsonLdBlocks);

  if (products.length === 1) {
    const product = products[0];
    if (product === undefined || !isProductJsonObject(product)) {
      return { kind: "error", code: "not-product" };
    }

    return {
      kind: "success",
      source: pageSnapshot.source,
      method: "json-ld",
      content: product,
      truncated: false,
    };
  }

  if (products.length > 1) {
    return { kind: "error", code: "ambiguous-product" };
  }

  return extractDomFallback(pageSnapshot.dom, pageSnapshot.source);
}
