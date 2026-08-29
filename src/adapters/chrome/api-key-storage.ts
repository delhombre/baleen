import { API_KEY_MASK, maskApiKey, parseApiKey, type ApiKey } from "../../core/api-key";
import { DEFAULT_LLM_PROVIDER, isLlmProvider, type LlmProvider } from "../../core/llm-provider";

export const LLM_PROVIDER_STORAGE_KEY = "baleen.llmProvider.v1" as const;
export const ANTHROPIC_API_KEY_STORAGE_KEY = "baleen.anthropicApiKey.v1" as const;
export const GROQ_API_KEY_STORAGE_KEY = "baleen.groqApiKey.v1" as const;
export const LEGACY_API_KEY_STORAGE_KEY = "apiKey" as const;
export const API_KEY_STORAGE_KEY = ANTHROPIC_API_KEY_STORAGE_KEY;

export type ChromeStorageLocal = {
  readonly get: (keys: string) => Promise<unknown>;
  readonly set: (items: Record<string, string>) => Promise<void>;
  readonly remove: (keys: string) => Promise<void>;
};

export type ApiKeyStorageErrorCode = "quota" | "unavailable";

export type ApiKeyStorageError = {
  readonly kind: "error";
  readonly code: ApiKeyStorageErrorCode;
};

export type ApiKeyStatus =
  | { readonly kind: "missing" }
  | { readonly kind: "invalid" }
  | { readonly kind: "present"; readonly mask: typeof API_KEY_MASK }
  | ApiKeyStorageError;

export type ApiKeyWriteResult =
  { readonly kind: "success" } | { readonly kind: "invalid" } | ApiKeyStorageError;

export type ApiKeyStatusStore = {
  readonly getStatus: () => Promise<ApiKeyStatus>;
  readonly save: (value: unknown) => Promise<ApiKeyWriteResult>;
  readonly remove: () => Promise<{ readonly kind: "success" } | ApiKeyStorageError>;
};

export type ApiKeySecretReader = {
  readonly readSecret: () => Promise<unknown>;
};

const INVALID_STORAGE_RESPONSE = Symbol("invalid-storage-response");

function isQuotaFailure(value: unknown): boolean {
  if (typeof value === "string") {
    return /quota/iu.test(value);
  }

  if (typeof value !== "object" || value === null) {
    return false;
  }

  try {
    const record = value as Record<string, unknown>;
    return (
      record.name === "QuotaExceededError" ||
      record.code === "QUOTA_BYTES" ||
      (typeof record.message === "string" && /quota/iu.test(record.message))
    );
  } catch {
    return false;
  }
}

function storageError(value: unknown): ApiKeyStorageError {
  return { kind: "error", code: isQuotaFailure(value) ? "quota" : "unavailable" };
}

function readStoredValue(response: unknown, key: string): unknown {
  if (typeof response !== "object" || response === null || Array.isArray(response)) {
    return INVALID_STORAGE_RESPONSE;
  }

  try {
    return Object.prototype.hasOwnProperty.call(response, key)
      ? (response as Record<string, unknown>)[key]
      : undefined;
  } catch {
    return INVALID_STORAGE_RESPONSE;
  }
}

function providerStorageKey(provider: LlmProvider): string {
  return provider === "anthropic" ? ANTHROPIC_API_KEY_STORAGE_KEY : GROQ_API_KEY_STORAGE_KEY;
}

export type ProviderApiKeyStorage = {
  readonly getProvider: () => Promise<LlmProvider>;
  readonly setProvider: (value: unknown) => Promise<ApiKeyWriteResult>;
  readonly getStatus: (provider: LlmProvider) => Promise<ApiKeyStatus>;
  readonly save: (provider: LlmProvider, value: unknown) => Promise<ApiKeyWriteResult>;
  readonly remove: (
    provider: LlmProvider,
  ) => Promise<{ readonly kind: "success" } | ApiKeyStorageError>;
  readonly readSecret: (provider: LlmProvider) => Promise<unknown>;
};

export function createProviderStorage(storage: ChromeStorageLocal): ProviderApiKeyStorage {
  const read = async (key: string): Promise<unknown> =>
    readStoredValue(await storage.get(key), key);

  const migrateLegacyAnthropicKey = async (): Promise<unknown> => {
    const current = await read(ANTHROPIC_API_KEY_STORAGE_KEY);
    const legacy = await read(LEGACY_API_KEY_STORAGE_KEY);
    if (current !== undefined) {
      if (legacy !== undefined) {
        await storage.remove(LEGACY_API_KEY_STORAGE_KEY);
      }
      return current;
    }

    const parsed = parseApiKey(legacy);
    if (parsed === undefined) {
      return undefined;
    }

    await storage.set({ [ANTHROPIC_API_KEY_STORAGE_KEY]: parsed });
    await storage.remove(LEGACY_API_KEY_STORAGE_KEY);
    return parsed;
  };

  const readProviderSecret = async (provider: LlmProvider): Promise<unknown> =>
    provider === "anthropic" ? migrateLegacyAnthropicKey() : read(providerStorageKey(provider));

  return {
    async getProvider(): Promise<LlmProvider> {
      const value = await read(LLM_PROVIDER_STORAGE_KEY);
      return isLlmProvider(value) ? value : DEFAULT_LLM_PROVIDER;
    },

    async setProvider(value: unknown): Promise<ApiKeyWriteResult> {
      if (!isLlmProvider(value)) {
        return { kind: "invalid" };
      }
      try {
        await storage.set({ [LLM_PROVIDER_STORAGE_KEY]: value });
        return { kind: "success" };
      } catch (error: unknown) {
        return storageError(error);
      }
    },

    async getStatus(provider: LlmProvider): Promise<ApiKeyStatus> {
      try {
        const value = await readProviderSecret(provider);
        if (value === undefined) {
          return { kind: "missing" };
        }
        const key = parseApiKey(value);
        return key === undefined ? { kind: "invalid" } : { kind: "present", mask: maskApiKey(key) };
      } catch (error: unknown) {
        return storageError(error);
      }
    },

    async save(provider: LlmProvider, value: unknown): Promise<ApiKeyWriteResult> {
      const key = parseApiKey(value);
      if (key === undefined) {
        return { kind: "invalid" };
      }
      try {
        await storage.set({ [providerStorageKey(provider)]: key });
        return { kind: "success" };
      } catch (error: unknown) {
        return storageError(error);
      }
    },

    async remove(
      provider: LlmProvider,
    ): Promise<{ readonly kind: "success" } | ApiKeyStorageError> {
      try {
        await storage.remove(providerStorageKey(provider));
        return { kind: "success" };
      } catch (error: unknown) {
        return storageError(error);
      }
    },

    async readSecret(provider: LlmProvider): Promise<unknown> {
      try {
        return await readProviderSecret(provider);
      } catch (error: unknown) {
        throw storageError(error);
      }
    },
  };
}

export function createApiKeyStatusStore(storage: ChromeStorageLocal): ApiKeyStatusStore {
  const read = async (): Promise<unknown> => {
    const response = await storage.get(API_KEY_STORAGE_KEY);
    return readStoredValue(response, API_KEY_STORAGE_KEY);
  };

  return {
    async getStatus(): Promise<ApiKeyStatus> {
      try {
        const value = await read();
        if (value === undefined) {
          return { kind: "missing" };
        }

        const key = parseApiKey(value);
        return key === undefined ? { kind: "invalid" } : { kind: "present", mask: maskApiKey(key) };
      } catch (error: unknown) {
        return storageError(error);
      }
    },

    async save(value: unknown): Promise<ApiKeyWriteResult> {
      const key = parseApiKey(value);
      if (key === undefined) {
        return { kind: "invalid" };
      }

      try {
        await storage.set({ [API_KEY_STORAGE_KEY]: key });
        return { kind: "success" };
      } catch (error: unknown) {
        return storageError(error);
      }
    },

    async remove(): Promise<{ readonly kind: "success" } | ApiKeyStorageError> {
      try {
        await storage.remove(API_KEY_STORAGE_KEY);
        return { kind: "success" };
      } catch (error: unknown) {
        return storageError(error);
      }
    },
  };
}

export function createApiKeySecretReader(storage: ChromeStorageLocal): ApiKeySecretReader {
  return {
    async readSecret(): Promise<unknown> {
      try {
        const response = await storage.get(API_KEY_STORAGE_KEY);
        return readStoredValue(response, API_KEY_STORAGE_KEY);
      } catch (error: unknown) {
        throw storageError(error);
      }
    },
  };
}

export function createApiKeyStorage(storage: ChromeStorageLocal): {
  readonly statusStore: ApiKeyStatusStore;
  readonly secretReader: ApiKeySecretReader;
} {
  return {
    statusStore: createApiKeyStatusStore(storage),
    secretReader: createApiKeySecretReader(storage),
  };
}

export type { ApiKey };
