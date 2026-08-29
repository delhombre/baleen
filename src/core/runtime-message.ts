import { ProductRecordSchema, type ProductRecord } from "./product-record";
import { isExtractionResult, type ExtractionSuccess } from "./raw-product";
import { isLlmProvider, type LlmProvider } from "./llm-provider";

export const NORMALIZE_PRODUCT_MESSAGE_TYPE = "baleen:normalize-product" as const;
export const TEST_CONNECTION_MESSAGE_TYPE = "baleen:test-connection" as const;

export type NormalizeProductMessage = {
  readonly type: typeof NORMALIZE_PRODUCT_MESSAGE_TYPE;
  readonly extraction: ExtractionSuccess;
};

export type TestConnectionMessage = {
  readonly type: typeof TEST_CONNECTION_MESSAGE_TYPE;
  readonly provider: LlmProvider;
};

export type RuntimeMessage = NormalizeProductMessage | TestConnectionMessage;

export type RuntimeErrorCode =
  "missing-key" | "unauthorized" | "quota" | "network" | "unavailable" | "invalid-response";

export type RuntimeErrorResponse = {
  readonly kind: "error";
  readonly code: RuntimeErrorCode;
};

export type RuntimeConnectionResponse =
  | { readonly kind: "success"; readonly provider: LlmProvider }
  | (RuntimeErrorResponse & { readonly provider: LlmProvider });
export type RuntimeNormalizeErrorResponse = RuntimeErrorResponse & {
  /** Provider selected for this request, when selection completed before the error. */
  readonly provider?: LlmProvider;
};
export type RuntimeNormalizeResponse =
  | { readonly kind: "success"; readonly record: ProductRecord; readonly provider?: LlmProvider }
  | RuntimeNormalizeErrorResponse;
export type RuntimeResponse = RuntimeNormalizeResponse | RuntimeConnectionResponse;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function isNormalizeProductMessage(value: unknown): value is NormalizeProductMessage {
  if (!isRecord(value) || !hasExactKeys(value, ["type", "extraction"])) {
    return false;
  }
  return (
    value.type === NORMALIZE_PRODUCT_MESSAGE_TYPE &&
    isExtractionResult(value.extraction) &&
    value.extraction.kind === "success"
  );
}

export function isTestConnectionMessage(value: unknown): value is TestConnectionMessage {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["type", "provider"]) &&
    value.type === TEST_CONNECTION_MESSAGE_TYPE &&
    isLlmProvider(value.provider)
  );
}

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  return isNormalizeProductMessage(value) || isTestConnectionMessage(value);
}

function isRuntimeErrorCode(value: unknown): value is RuntimeErrorCode {
  return (
    value === "missing-key" ||
    value === "unauthorized" ||
    value === "quota" ||
    value === "network" ||
    value === "unavailable" ||
    value === "invalid-response"
  );
}

function isRuntimeNormalizeErrorResponse(value: unknown): value is RuntimeNormalizeErrorResponse {
  if (!isRecord(value) || value.kind !== "error" || !isRuntimeErrorCode(value.code)) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length === 2 && keys.includes("kind") && keys.includes("code")) {
    return true;
  }
  return (
    keys.length === 3 &&
    keys.includes("kind") &&
    keys.includes("code") &&
    keys.includes("provider") &&
    isLlmProvider(value.provider)
  );
}

export function isRuntimeConnectionResponse(value: unknown): value is RuntimeConnectionResponse {
  return (
    isRecord(value) &&
    ((hasExactKeys(value, ["kind", "provider"]) &&
      value.kind === "success" &&
      isLlmProvider(value.provider)) ||
      (hasExactKeys(value, ["kind", "code", "provider"]) &&
        value.kind === "error" &&
        isRuntimeErrorCode(value.code) &&
        isLlmProvider(value.provider)))
  );
}

export function isRuntimeNormalizeResponse(value: unknown): value is RuntimeNormalizeResponse {
  if (isRuntimeNormalizeErrorResponse(value)) {
    return true;
  }
  if (
    !isRecord(value) ||
    value.kind !== "success" ||
    !ProductRecordSchema.safeParse(value.record).success
  ) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length === 2 && keys.includes("kind") && keys.includes("record")) {
    return true;
  }
  return (
    keys.length === 3 &&
    keys.includes("kind") &&
    keys.includes("record") &&
    keys.includes("provider") &&
    isLlmProvider(value.provider)
  );
}

export function isRuntimeResponse(value: unknown): value is RuntimeResponse {
  return isRuntimeConnectionResponse(value) || isRuntimeNormalizeResponse(value);
}
