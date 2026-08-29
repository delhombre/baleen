import { parseApiKey, type ApiKey } from "../../core/api-key";
import { normalizeProduct, type NormalizationModel } from "../../core/normalization";
import {
  isNormalizeProductMessage,
  isTestConnectionMessage,
  type NormalizeProductMessage,
  type RuntimeConnectionResponse,
  type RuntimeErrorCode,
  type RuntimeNormalizeResponse,
} from "../../core/runtime-message";
import { testStoredConnection, type ApiKeyConnectionPort } from "../../core/test-connection";
import type { ApiKeySecretReader, ProviderApiKeyStorage } from "./api-key-storage";
import { GROQ_MODEL } from "../groq/normalization-model";
import { ANTHROPIC_MODEL } from "../anthropic/normalization-model";
import type { LlmProvider } from "../../core/llm-provider";

export const NORMALIZATION_MODEL_NAME = "claude-sonnet-4-6" as const;

export type NormalizationHandlerDependencies = {
  readonly secretReader?: ApiKeySecretReader;
  readonly createModel: (key: ApiKey) => NormalizationModel;
  readonly connection: ApiKeyConnectionPort;
  readonly providerStorage?: ProviderApiKeyStorage;
  readonly createGroqModel?: (key: ApiKey) => NormalizationModel;
  readonly groqConnection?: ApiKeyConnectionPort;
  readonly idFactory: () => string;
  readonly modelName?: string;
};

export type RuntimeMessageListener = (message: unknown) => Promise<unknown>;

function hasRuntimeType(value: unknown, type: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "type" in value &&
    value.type === type
  );
}

function error(
  code: RuntimeErrorCode,
  provider?: LlmProvider,
): {
  readonly kind: "error";
  readonly code: RuntimeErrorCode;
  readonly provider?: LlmProvider;
} {
  return provider === undefined ? { kind: "error", code } : { kind: "error", code, provider };
}

function connectionError(code: RuntimeErrorCode, provider: LlmProvider): RuntimeConnectionResponse {
  return { kind: "error", code, provider };
}

function mapNormalizationCode(
  code:
    | "invalid-extraction"
    | "invalid-model-response"
    | "invalid-response"
    | "invalid-metadata"
    | "unauthorized"
    | "rate-limited"
    | "timeout"
    | "network"
    | "unavailable",
): RuntimeErrorCode {
  switch (code) {
    case "unauthorized":
      return "unauthorized";
    case "rate-limited":
      return "quota";
    case "network":
    case "timeout":
      return "network";
    case "unavailable":
      return "unavailable";
    case "invalid-extraction":
    case "invalid-model-response":
    case "invalid-response":
    case "invalid-metadata":
      return "invalid-response";
  }
}

type ReadKeyResult =
  | { readonly kind: "key"; readonly key: ApiKey }
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly code: "quota" | "unavailable" };

async function readKey(secretReader: ApiKeySecretReader): Promise<ReadKeyResult> {
  try {
    const key = parseApiKey(await secretReader.readSecret());
    return key === undefined ? { kind: "missing" } : { kind: "key", key };
  } catch (caught: unknown) {
    if (typeof caught === "object" && caught !== null && !Array.isArray(caught)) {
      const code = "code" in caught ? caught.code : undefined;
      if (code === "quota" || code === "unavailable") {
        return { kind: "error", code };
      }
    }
    return { kind: "error", code: "unavailable" };
  }
}

async function normalize(
  message: NormalizeProductMessage,
  dependencies: NormalizationHandlerDependencies,
): Promise<RuntimeNormalizeResponse> {
  if (dependencies.providerStorage !== undefined) {
    return normalizeWithSelectedProvider(message, dependencies);
  }
  if (dependencies.secretReader === undefined) {
    return error("unavailable");
  }
  const key = await readKey(dependencies.secretReader);
  if (key.kind === "missing") {
    return error("missing-key");
  }
  if (key.kind === "error") {
    return error(key.code);
  }

  try {
    const result = await normalizeProduct({
      extraction: message.extraction,
      model: dependencies.createModel(key.key),
      idFactory: dependencies.idFactory,
      modelName: dependencies.modelName ?? NORMALIZATION_MODEL_NAME,
    });
    return result.kind === "success"
      ? { kind: "success", record: result.record }
      : error(mapNormalizationCode(result.code));
  } catch {
    return error("unavailable");
  }
}

type SelectedKeyResult =
  | { readonly kind: "key"; readonly provider: "anthropic" | "groq"; readonly key: ApiKey }
  | { readonly kind: "missing"; readonly provider: LlmProvider }
  | {
      readonly kind: "error";
      readonly code: "quota" | "unavailable";
      readonly provider?: LlmProvider;
    };

type ProviderKeyResult =
  | { readonly kind: "key"; readonly provider: LlmProvider; readonly key: ApiKey }
  | { readonly kind: "missing"; readonly provider: LlmProvider }
  | {
      readonly kind: "error";
      readonly code: "quota" | "unavailable";
      readonly provider: LlmProvider;
    };

async function readSelectedKey(
  dependencies: NormalizationHandlerDependencies,
): Promise<SelectedKeyResult> {
  const storage = dependencies.providerStorage;
  if (storage === undefined) {
    return { kind: "error", code: "unavailable" };
  }
  let provider: LlmProvider | undefined;
  try {
    provider = await storage.getProvider();
    const confirmedProvider = await storage.getProvider();
    if (confirmedProvider !== provider) {
      return { kind: "error", code: "unavailable", provider: confirmedProvider };
    }
    const key = parseApiKey(await storage.readSecret(provider));
    return key === undefined ? { kind: "missing", provider } : { kind: "key", provider, key };
  } catch (caught: unknown) {
    if (typeof caught === "object" && caught !== null && !Array.isArray(caught)) {
      const code = "code" in caught ? caught.code : undefined;
      if (code === "quota" || code === "unavailable") {
        return provider === undefined ? { kind: "error", code } : { kind: "error", code, provider };
      }
    }
    return provider === undefined
      ? { kind: "error", code: "unavailable" }
      : { kind: "error", code: "unavailable", provider };
  }
}

async function readProviderKey(
  dependencies: NormalizationHandlerDependencies,
  provider: LlmProvider,
): Promise<ProviderKeyResult> {
  const storage = dependencies.providerStorage;
  if (storage === undefined) {
    return { kind: "error", code: "unavailable", provider };
  }
  try {
    const key = parseApiKey(await storage.readSecret(provider));
    return key === undefined ? { kind: "missing", provider } : { kind: "key", provider, key };
  } catch (caught: unknown) {
    if (typeof caught === "object" && caught !== null && !Array.isArray(caught)) {
      const code = "code" in caught ? caught.code : undefined;
      if (code === "quota" || code === "unavailable") {
        return { kind: "error", code, provider };
      }
    }
    return { kind: "error", code: "unavailable", provider };
  }
}

async function normalizeWithSelectedProvider(
  message: NormalizeProductMessage,
  dependencies: NormalizationHandlerDependencies,
): Promise<RuntimeNormalizeResponse> {
  const selected = await readSelectedKey(dependencies);
  if (selected.kind === "missing") {
    return error("missing-key", selected.provider);
  }
  if (selected.kind === "error") {
    return error(selected.code, selected.provider);
  }

  const model =
    selected.provider === "groq"
      ? dependencies.createGroqModel?.(selected.key)
      : dependencies.createModel(selected.key);
  if (model === undefined) {
    return error("unavailable", selected.provider);
  }
  try {
    const result = await normalizeProduct({
      extraction: message.extraction,
      model,
      idFactory: dependencies.idFactory,
      modelName:
        dependencies.modelName ?? (selected.provider === "groq" ? GROQ_MODEL : ANTHROPIC_MODEL),
    });
    return result.kind === "success"
      ? { kind: "success", record: result.record, provider: selected.provider }
      : error(mapNormalizationCode(result.code), selected.provider);
  } catch {
    return error("unavailable", selected.provider);
  }
}

async function testConnection(
  dependencies: NormalizationHandlerDependencies,
  expectedProvider: LlmProvider,
): Promise<RuntimeConnectionResponse> {
  if (dependencies.providerStorage !== undefined) {
    const selected = await readProviderKey(dependencies, expectedProvider);
    if (selected.kind === "missing") {
      return connectionError("missing-key", selected.provider);
    }
    if (selected.kind === "error") {
      return connectionError(selected.code, selected.provider);
    }
    const connection =
      selected.provider === "groq" ? dependencies.groqConnection : dependencies.connection;
    if (connection === undefined) {
      return connectionError("unavailable", selected.provider);
    }
    try {
      const result = await testStoredConnection(
        { readSecret: async () => selected.key },
        connection,
      );
      switch (result.kind) {
        case "success":
          return { kind: "success", provider: selected.provider };
        case "missing":
        case "invalid":
          return connectionError("missing-key", selected.provider);
        case "unauthorized":
          return connectionError("unauthorized", selected.provider);
        case "quota":
          return connectionError("quota", selected.provider);
        case "network":
          return connectionError("network", selected.provider);
        case "unavailable":
          return connectionError("unavailable", selected.provider);
      }
    } catch {
      return connectionError("network", selected.provider);
    }
  }
  if (expectedProvider !== "anthropic") {
    return connectionError("unavailable", expectedProvider);
  }
  if (dependencies.secretReader === undefined) {
    return connectionError("unavailable", expectedProvider);
  }
  const result = await testStoredConnection(dependencies.secretReader, dependencies.connection);
  switch (result.kind) {
    case "success":
      return { kind: "success", provider: expectedProvider };
    case "missing":
    case "invalid":
      return connectionError("missing-key", expectedProvider);
    case "unauthorized":
      return connectionError("unauthorized", expectedProvider);
    case "quota":
      return connectionError("quota", expectedProvider);
    case "network":
      return connectionError("network", expectedProvider);
    case "unavailable":
      return connectionError("unavailable", expectedProvider);
  }
}

export function createNormalizationMessageListener(
  dependencies: NormalizationHandlerDependencies,
): RuntimeMessageListener {
  return async (message: unknown): Promise<unknown> => {
    if (isNormalizeProductMessage(message)) {
      return normalize(message, dependencies);
    }
    if (isTestConnectionMessage(message)) {
      return testConnection(dependencies, message.provider);
    }
    if (
      hasRuntimeType(message, "baleen:normalize-product") ||
      hasRuntimeType(message, "baleen:test-connection")
    ) {
      return error("invalid-response");
    }
    return undefined;
  };
}
