import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  RateLimitError,
  type ClientOptions,
} from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";

import type {
  NormalizationModel,
  NormalizationModelErrorCode,
  NormalizationModelResponse,
  NormalizationRequest,
} from "../../core/normalization";
import type { ApiKey } from "../../core/api-key";
import type { ApiKeyConnectionResponse } from "../../core/test-connection";

export const ANTHROPIC_MODEL = "claude-sonnet-4-6";
export const ANTHROPIC_TIMEOUT_MS = 60_000;
export const ANTHROPIC_MAX_TOKENS = 2_048;

export type AnthropicClientOptions = {
  readonly apiKey: string;
  readonly maxRetries: 0;
  readonly timeout: typeof ANTHROPIC_TIMEOUT_MS;
  readonly logLevel: "off";
};

export type AnthropicMessagesClient = {
  readonly messages: {
    readonly create: (params: MessageCreateParamsNonStreaming) => Promise<unknown>;
  };
};

export type AnthropicClientFactory = (options: AnthropicClientOptions) => AnthropicMessagesClient;

export type AnthropicNormalizationModelOptions = {
  readonly apiKey: string;
  readonly sdkFactory?: AnthropicClientFactory;
};

function createSdkClient(options: AnthropicClientOptions): AnthropicMessagesClient {
  const sdkOptions: ClientOptions = options;
  return new Anthropic(sdkOptions);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestContent(request: NormalizationRequest): string {
  return JSON.stringify(
    request.repair === undefined
      ? { evidence: request.evidence }
      : { evidence: request.evidence, repair: request.repair },
  );
}

function responseText(response: unknown): string | undefined {
  try {
    if (!isRecord(response) || !Array.isArray(response.content) || response.content.length !== 1) {
      return undefined;
    }

    const [block] = response.content;
    if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") {
      return undefined;
    }

    return block.text.trim().length > 0 ? block.text : undefined;
  } catch {
    return undefined;
  }
}

function statusCode(value: unknown): NormalizationModelErrorCode | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return undefined;
  }

  if (value === 401 || value === 403) {
    return "unauthorized";
  }
  if (value === 429) {
    return "rate-limited";
  }
  if (value === 408 || value === 504) {
    return "timeout";
  }
  if (value >= 500 && value <= 599) {
    return "unavailable";
  }

  return undefined;
}

function mapError(error: unknown): NormalizationModelErrorCode {
  try {
    if (error instanceof APIConnectionTimeoutError) {
      return "timeout";
    }
    if (error instanceof AuthenticationError) {
      return "unauthorized";
    }
    if (error instanceof RateLimitError) {
      return "rate-limited";
    }
    if (error instanceof APIConnectionError) {
      return "network";
    }
    if (error instanceof APIError) {
      return statusCode(error.status) ?? "unavailable";
    }
    if (isRecord(error)) {
      const name = error.name;
      if (name === "AbortError" || name === "TimeoutError") {
        return "timeout";
      }
      if (name === "AuthenticationError") {
        return "unauthorized";
      }
      if (name === "RateLimitError") {
        return "rate-limited";
      }
      if (name === "APIConnectionError") {
        return "network";
      }
      return statusCode(error.status) ?? "unavailable";
    }
  } catch {
    return "unavailable";
  }

  return "unavailable";
}

function mapConnectionError(
  error: unknown,
): Exclude<ApiKeyConnectionResponse, { readonly kind: "success" }> {
  const code = mapError(error);
  if (code === "unauthorized") {
    return { kind: "error", code };
  }
  if (code === "rate-limited") {
    return { kind: "error", code: "quota" };
  }
  if (code === "network" || code === "timeout") {
    return { kind: "error", code: "network" };
  }
  return { kind: "error", code: "unavailable" };
}

function invalidResponse(): NormalizationModelResponse {
  return { kind: "error", code: "unavailable" };
}

async function normalizeWithClient(
  client: AnthropicMessagesClient,
  request: NormalizationRequest,
): Promise<NormalizationModelResponse> {
  try {
    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      system: request.prompt,
      messages: [{ role: "user", content: requestContent(request) }],
      stream: false,
    });
    const text = responseText(response);
    return text === undefined ? invalidResponse() : { kind: "success", text };
  } catch (error: unknown) {
    return { kind: "error", code: mapError(error) };
  }
}

function resolveOptions(
  optionsOrApiKey: AnthropicNormalizationModelOptions | string,
  sdkFactory?: AnthropicClientFactory,
): AnthropicNormalizationModelOptions {
  return typeof optionsOrApiKey === "string"
    ? { apiKey: optionsOrApiKey, sdkFactory }
    : optionsOrApiKey;
}

export function createAnthropicNormalizationModel(
  options: AnthropicNormalizationModelOptions,
): NormalizationModel;
export function createAnthropicNormalizationModel(
  apiKey: string,
  sdkFactory?: AnthropicClientFactory,
): NormalizationModel;
export function createAnthropicNormalizationModel(
  optionsOrApiKey: AnthropicNormalizationModelOptions | string,
  sdkFactory?: AnthropicClientFactory,
): NormalizationModel {
  const options = resolveOptions(optionsOrApiKey, sdkFactory);
  const clientOptions: AnthropicClientOptions = {
    apiKey: options.apiKey,
    maxRetries: 0,
    timeout: ANTHROPIC_TIMEOUT_MS,
    logLevel: "off",
  };
  const client = (options.sdkFactory ?? createSdkClient)(clientOptions);

  return {
    normalize: (request) => normalizeWithClient(client, request),
  };
}

export function createAnthropicConnectionPort(
  optionsOrApiKey: AnthropicNormalizationModelOptions | string,
  sdkFactory?: AnthropicClientFactory,
): { readonly testConnection: (key: ApiKey) => Promise<unknown> } {
  const options = resolveOptions(optionsOrApiKey, sdkFactory);
  const clientOptions: AnthropicClientOptions = {
    apiKey: options.apiKey,
    maxRetries: 0,
    timeout: ANTHROPIC_TIMEOUT_MS,
    logLevel: "off",
  };
  const client = (options.sdkFactory ?? createSdkClient)(clientOptions);

  return {
    async testConnection(): Promise<ApiKeyConnectionResponse> {
      try {
        await client.messages.create({
          model: ANTHROPIC_MODEL,
          max_tokens: 1,
          system: "Reply with OK.",
          messages: [{ role: "user", content: "connection test" }],
          stream: false,
        });
        return { kind: "success" };
      } catch (error: unknown) {
        return mapConnectionError(error);
      }
    },
  };
}
