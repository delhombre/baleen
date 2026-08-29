import {
  isRuntimeConnectionResponse,
  isRuntimeNormalizeResponse,
  NORMALIZE_PRODUCT_MESSAGE_TYPE,
  TEST_CONNECTION_MESSAGE_TYPE,
  type RuntimeConnectionResponse,
  type RuntimeNormalizeResponse,
} from "../../core/runtime-message";
import type { ExtractionSuccess } from "../../core/raw-product";
import type { StoredConnectionResult } from "../../core/test-connection";
import type { LlmProvider } from "../../core/llm-provider";

export type ChromeRuntimeMessaging = {
  readonly sendMessage: (message: unknown) => Promise<unknown>;
};

export async function normalizeCapturedProduct(
  runtime: ChromeRuntimeMessaging,
  extraction: ExtractionSuccess,
): Promise<RuntimeNormalizeResponse> {
  try {
    const response = await runtime.sendMessage({
      type: NORMALIZE_PRODUCT_MESSAGE_TYPE,
      extraction,
    });
    return isRuntimeNormalizeResponse(response)
      ? response
      : { kind: "error", code: "invalid-response" };
  } catch {
    return { kind: "error", code: "network" };
  }
}

function toStoredConnectionResult(response: RuntimeConnectionResponse): StoredConnectionResult {
  if (response.kind === "success") {
    return { kind: "success" };
  }
  switch (response.code) {
    case "missing-key":
      return { kind: "missing" };
    case "unauthorized":
      return { kind: "unauthorized" };
    case "quota":
      return { kind: "quota" };
    case "network":
      return { kind: "network" };
    case "unavailable":
    case "invalid-response":
      return { kind: "unavailable" };
  }
}

export async function testConnectionThroughRuntime(
  runtime: ChromeRuntimeMessaging,
  provider: LlmProvider,
): Promise<StoredConnectionResult> {
  try {
    const response = await runtime.sendMessage({ type: TEST_CONNECTION_MESSAGE_TYPE, provider });
    if (!isRuntimeConnectionResponse(response)) {
      return { kind: "unavailable" };
    }
    if (response.provider !== provider) {
      return { kind: "unavailable" };
    }
    return toStoredConnectionResult(response);
  } catch {
    return { kind: "network" };
  }
}
