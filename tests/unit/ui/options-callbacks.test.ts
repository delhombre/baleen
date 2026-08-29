import { describe, expect, it, vi } from "vitest";

import {
  ANTHROPIC_API_KEY_STORAGE_KEY,
  GROQ_API_KEY_STORAGE_KEY,
  LLM_PROVIDER_STORAGE_KEY,
  createProviderStorage,
  type ChromeStorageLocal,
  type ProviderApiKeyStorage,
} from "../../../src/adapters/chrome/api-key-storage";
import { createNormalizationMessageListener } from "../../../src/adapters/chrome/normalization-handler";
import type { ApiKey } from "../../../src/core/api-key";
import type { NormalizationModel } from "../../../src/core/normalization";
import { createOptionsCallbacks } from "../../../src/ui/options-callbacks";
import type { ChromeRuntimeMessaging } from "../../../src/adapters/chrome/runtime-client";

function memoryStorage(initial: Record<string, unknown>): ChromeStorageLocal & {
  readonly values: Record<string, unknown>;
} {
  const values = { ...initial };
  return {
    values,
    async get(key: string): Promise<unknown> {
      return Object.prototype.hasOwnProperty.call(values, key) ? { [key]: values[key] } : {};
    },
    async set(items: Record<string, string>): Promise<void> {
      Object.assign(values, items);
    },
    async remove(key: string): Promise<void> {
      delete values[key];
    },
  };
}

function unavailableModel(): NormalizationModel {
  return {
    normalize: async () => ({ kind: "error", code: "unavailable" }),
  };
}

describe("Options provider callbacks", () => {
  it("persists the entered provider key before the selected probe receives it", async () => {
    const storage = memoryStorage({
      [LLM_PROVIDER_STORAGE_KEY]: "anthropic",
      [ANTHROPIC_API_KEY_STORAGE_KEY]: "sk-old-secret",
    });
    const providerStorage = createProviderStorage(storage);
    const anthropicProbe = vi.fn(async (key: ApiKey): Promise<unknown> => {
      return { kind: key === "sk-current-secret" ? "success" : "error" };
    });
    const groqProbe = vi.fn(async (): Promise<unknown> => ({ kind: "success" }));
    const listener = createNormalizationMessageListener({
      providerStorage,
      createModel: unavailableModel,
      connection: { testConnection: anthropicProbe },
      groqConnection: { testConnection: groqProbe },
      idFactory: () => "4c1ee929-6c05-42e8-bfdc-8dfb602ca0db",
    });
    const runtime: ChromeRuntimeMessaging = { sendMessage: listener };
    const callbacks = createOptionsCallbacks(providerStorage, runtime);
    const saveProvider = callbacks.saveProvider;
    const testProviderConnection = callbacks.testProviderConnection;
    if (saveProvider === undefined || testProviderConnection === undefined) {
      throw new Error("Provider callbacks are required for the options contract.");
    }

    await expect(saveProvider("anthropic", "sk-current-secret")).resolves.toEqual({
      kind: "success",
    });
    await expect(testProviderConnection("anthropic")).resolves.toEqual({ kind: "success" });

    expect(storage.values[ANTHROPIC_API_KEY_STORAGE_KEY]).toBe("sk-current-secret");
    expect(anthropicProbe).toHaveBeenCalledWith("sk-current-secret");
    expect(anthropicProbe).not.toHaveBeenCalledWith("sk-old-secret");

    await expect(providerStorage.setProvider("groq")).resolves.toEqual({ kind: "success" });
    await expect(testProviderConnection("anthropic")).resolves.toEqual({ kind: "success" });
    expect(anthropicProbe).toHaveBeenCalledTimes(2);

    await expect(saveProvider("groq", "gsk-current-secret")).resolves.toEqual({
      kind: "success",
    });
    await expect(testProviderConnection("groq")).resolves.toEqual({ kind: "success" });
    expect(storage.values[GROQ_API_KEY_STORAGE_KEY]).toBe("gsk-current-secret");
    expect(groqProbe).toHaveBeenCalledWith("gsk-current-secret");
  });

  it("sends and tests the expected provider even when the active selection changes", async () => {
    let providerReads = 0;
    const anthropicProbe = vi.fn(async (): Promise<unknown> => ({ kind: "success" }));
    const groqProbe = vi.fn(async (): Promise<unknown> => ({ kind: "success" }));
    const providerStorage: ProviderApiKeyStorage = {
      getProvider: vi.fn(async () => {
        providerReads += 1;
        return providerReads === 1 ? "anthropic" : "groq";
      }),
      setProvider: vi.fn(async () => ({ kind: "success" as const })),
      getStatus: vi.fn(async () => ({ kind: "missing" as const })),
      save: vi.fn(async () => ({ kind: "success" as const })),
      remove: vi.fn(async () => ({ kind: "success" as const })),
      readSecret: vi.fn(async (provider) =>
        provider === "anthropic" ? "sk-anthropic-secret" : "gsk-groq-secret",
      ),
    };
    const listener = createNormalizationMessageListener({
      providerStorage,
      createModel: unavailableModel,
      connection: { testConnection: anthropicProbe },
      groqConnection: { testConnection: groqProbe },
      idFactory: () => "4c1ee929-6c05-42e8-bfdc-8dfb602ca0db",
    });
    const sendMessage = vi.fn((message: unknown) => listener(message));
    const callbacks = createOptionsCallbacks(providerStorage, { sendMessage });

    const result = await callbacks.testProviderConnection?.("anthropic");

    expect(result).toEqual({ kind: "success" });
    expect(sendMessage).toHaveBeenCalledWith({
      type: "baleen:test-connection",
      provider: "anthropic",
    });
    expect(anthropicProbe).toHaveBeenCalledWith("sk-anthropic-secret");
    expect(groqProbe).not.toHaveBeenCalled();
    expect(providerStorage.readSecret).toHaveBeenCalledWith("anthropic");
  });
});
