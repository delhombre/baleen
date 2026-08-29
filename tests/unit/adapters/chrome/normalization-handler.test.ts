import { describe, expect, it, vi } from "vitest";

import type { ApiKey } from "../../../../src/core/api-key";
import type { ApiKeySecretReader } from "../../../../src/adapters/chrome/api-key-storage";
import type {
  NormalizationModel,
  NormalizationModelResponse,
} from "../../../../src/core/normalization";
import { createNormalizationMessageListener } from "../../../../src/adapters/chrome/normalization-handler";
import type { ProviderApiKeyStorage } from "../../../../src/adapters/chrome/api-key-storage";

const extraction = {
  kind: "success",
  source: {
    url: "https://shop.example.test/product",
    pageTitle: "Product",
    capturedAt: "2026-08-28T12:00:00.000Z",
  },
  method: "json-ld",
  content: { "@type": "Product", name: "Product" },
  truncated: false,
} as const;

function deps(response: NormalizationModelResponse, secret: unknown = "test-key") {
  const normalize = vi.fn(async () => response);
  const createModel = vi.fn<(key: ApiKey) => NormalizationModel>(() => ({ normalize }));
  const connection = vi.fn(async (): Promise<unknown> => ({ kind: "success" as const }));
  const secretReader: ApiKeySecretReader = {
    readSecret: vi.fn(async (): Promise<unknown> => secret),
  };
  return {
    dependencies: {
      secretReader,
      createModel,
      connection: { testConnection: connection },
      idFactory: () => "4c1ee929-6c05-42e8-bfdc-8dfb602ca0db",
    },
    normalize,
    createModel,
    connection,
  };
}

describe("normalization runtime message handler", () => {
  it("uses the selected Groq provider, key, model name, and connection port", async () => {
    const normalize = vi.fn(async () => ({
      kind: "success" as const,
      text: JSON.stringify({
        version: 1,
        name: "e1",
        brand: null,
        price: null,
        category: null,
        specs: [],
        pros: [],
        cons: [],
      }),
    }));
    const providerStorage: ProviderApiKeyStorage = {
      getProvider: vi.fn(async () => "groq" as const),
      setProvider: vi.fn(async () => ({ kind: "success" as const })),
      getStatus: vi.fn(async () => ({ kind: "missing" as const })),
      save: vi.fn(async () => ({ kind: "success" as const })),
      remove: vi.fn(async () => ({ kind: "success" as const })),
      readSecret: vi.fn(async () => "gsk-test-secret"),
    };
    const createGroqModel = vi.fn(() => ({ normalize }));
    const createGroqConnection = vi.fn(async () => ({ kind: "success" as const }));
    const listener = createNormalizationMessageListener({
      providerStorage,
      createModel: vi.fn(() => ({ normalize })),
      createGroqModel,
      connection: { testConnection: vi.fn(async () => ({ kind: "success" as const })) },
      groqConnection: { testConnection: createGroqConnection },
      idFactory: () => "4c1ee929-6c05-42e8-bfdc-8dfb602ca0db",
    });

    await expect(listener({ type: "baleen:normalize-product", extraction })).resolves.toMatchObject(
      {
        kind: "success",
        provider: "groq",
        record: { extraction: { model: "openai/gpt-oss-120b" } },
      },
    );
    expect(providerStorage.readSecret).toHaveBeenCalledWith("groq");
    expect(createGroqModel).toHaveBeenCalledWith("gsk-test-secret");
    await expect(listener({ type: "baleen:test-connection", provider: "groq" })).resolves.toEqual({
      kind: "success",
      provider: "groq",
    });
    expect(createGroqConnection).toHaveBeenCalledWith("gsk-test-secret");
  });

  it("rejects malformed recognized messages and ignores unrelated messages", async () => {
    const fake = deps({ kind: "error", code: "unavailable" });
    const listener = createNormalizationMessageListener(fake.dependencies);

    await expect(listener({ type: "baleen:normalize-product" })).resolves.toEqual({
      kind: "error",
      code: "invalid-response",
    });
    await expect(listener({ type: "baleen:test-connection", extra: true })).resolves.toEqual({
      kind: "error",
      code: "invalid-response",
    });
    await expect(listener({ type: "other" })).resolves.toBeUndefined();
  });

  it("returns missing-key before constructing or calling the model", async () => {
    const fake = deps({ kind: "error", code: "unavailable" }, null);
    const listener = createNormalizationMessageListener(fake.dependencies);

    await expect(listener({ type: "baleen:normalize-product", extraction })).resolves.toEqual({
      kind: "error",
      code: "missing-key",
    });
    expect(fake.createModel).not.toHaveBeenCalled();
    expect(fake.normalize).not.toHaveBeenCalled();
  });

  it("probes the provider requested by the message when selection changes during its key read", async () => {
    let selectedProvider: "anthropic" | "groq" = "anthropic";
    let releaseSecret: (() => void) | undefined;
    const secretPending = new Promise<void>((resolve) => {
      releaseSecret = resolve;
    });
    const providerStorage: ProviderApiKeyStorage = {
      getProvider: vi.fn(async () => selectedProvider),
      setProvider: vi.fn(async () => ({ kind: "success" as const })),
      getStatus: vi.fn(async () => ({ kind: "missing" as const })),
      save: vi.fn(async () => ({ kind: "success" as const })),
      remove: vi.fn(async () => ({ kind: "success" as const })),
      readSecret: vi.fn(async (provider) => {
        expect(provider).toBe("anthropic");
        await secretPending;
        return "sk-anthropic-secret";
      }),
    };
    const createGroqModel = vi.fn();
    const anthropicProbe = vi.fn(async () => ({ kind: "success" as const }));
    const listener = createNormalizationMessageListener({
      providerStorage,
      createModel: vi.fn(() => ({ normalize: vi.fn() })),
      createGroqModel,
      connection: { testConnection: anthropicProbe },
      idFactory: () => "4c1ee929-6c05-42e8-bfdc-8dfb602ca0db",
    });

    const responsePromise = listener({ type: "baleen:test-connection", provider: "anthropic" });
    await vi.waitFor(() => expect(providerStorage.readSecret).toHaveBeenCalledWith("anthropic"));
    selectedProvider = "groq";
    releaseSecret?.();

    await expect(responsePromise).resolves.toEqual({
      kind: "success",
      provider: "anthropic",
    });
    expect(anthropicProbe).toHaveBeenCalledWith("sk-anthropic-secret");
    expect(createGroqModel).not.toHaveBeenCalled();
  });

  it("does not invent Anthropic when provider selection cannot be read", async () => {
    const providerStorage: ProviderApiKeyStorage = {
      getProvider: vi.fn(async () => {
        throw new Error("storage unavailable");
      }),
      setProvider: vi.fn(async () => ({ kind: "success" as const })),
      getStatus: vi.fn(async () => ({ kind: "missing" as const })),
      save: vi.fn(async () => ({ kind: "success" as const })),
      remove: vi.fn(async () => ({ kind: "success" as const })),
      readSecret: vi.fn(async () => undefined),
    };
    const listener = createNormalizationMessageListener({
      providerStorage,
      createModel: vi.fn(() => ({ normalize: vi.fn() })),
      connection: { testConnection: vi.fn(async () => ({ kind: "success" as const })) },
      idFactory: () => "4c1ee929-6c05-42e8-bfdc-8dfb602ca0db",
    });

    await expect(listener({ type: "baleen:normalize-product", extraction })).resolves.toEqual({
      kind: "error",
      code: "unavailable",
    });
  });

  it("returns a normalized record with trusted metadata and no secret", async () => {
    const fake = deps({
      kind: "success",
      text: JSON.stringify({
        version: 1,
        name: "e1",
        brand: null,
        price: null,
        category: null,
        specs: [],
        pros: [],
        cons: [],
      }),
    });
    const listener = createNormalizationMessageListener(fake.dependencies);

    const response = await listener({ type: "baleen:normalize-product", extraction });

    expect(response).toEqual({
      kind: "success",
      record: {
        id: "4c1ee929-6c05-42e8-bfdc-8dfb602ca0db",
        capturedAt: extraction.source.capturedAt,
        source: { url: extraction.source.url, pageTitle: extraction.source.pageTitle },
        name: "Product",
        brand: "unknown",
        price: "unknown",
        category: "unknown",
        specs: [],
        pros: [],
        cons: [],
        extraction: { method: "json-ld", model: "claude-sonnet-4-6" },
      },
    });
    expect(JSON.stringify(response)).not.toContain("test-key");
  });

  it("maps provider failures to safe runtime codes", async () => {
    for (const [providerCode, runtimeCode] of [
      ["rate-limited", "quota"],
      ["unauthorized", "unauthorized"],
      ["network", "network"],
      ["unavailable", "unavailable"],
    ] as const) {
      const fake = deps({ kind: "error", code: providerCode });
      const listener = createNormalizationMessageListener(fake.dependencies);
      await expect(listener({ type: "baleen:normalize-product", extraction })).resolves.toEqual({
        kind: "error",
        code: runtimeCode,
      });
    }
  });

  it("returns the provider that was selected for every normalized outcome", async () => {
    const outcomes = [
      { model: { kind: "error" as const, code: "unauthorized" as const }, runtime: "unauthorized" },
      { model: { kind: "error" as const, code: "rate-limited" as const }, runtime: "quota" },
      { model: { kind: "error" as const, code: "network" as const }, runtime: "network" },
      { model: { kind: "error" as const, code: "unavailable" as const }, runtime: "unavailable" },
    ] as const;

    for (const outcome of outcomes) {
      const normalize = vi.fn(async () => outcome.model);
      const providerStorage: ProviderApiKeyStorage = {
        getProvider: vi.fn(async () => "groq" as const),
        setProvider: vi.fn(async () => ({ kind: "success" as const })),
        getStatus: vi.fn(async () => ({ kind: "present" as const, mask: "••••••••" as const })),
        save: vi.fn(async () => ({ kind: "success" as const })),
        remove: vi.fn(async () => ({ kind: "success" as const })),
        readSecret: vi.fn(async () => "gsk-test-secret"),
      };
      const listener = createNormalizationMessageListener({
        providerStorage,
        createModel: vi.fn(() => ({ normalize })),
        createGroqModel: vi.fn(() => ({ normalize })),
        connection: { testConnection: vi.fn(async () => ({ kind: "success" as const })) },
        groqConnection: { testConnection: vi.fn(async () => ({ kind: "success" as const })) },
        idFactory: () => "4c1ee929-6c05-42e8-bfdc-8dfb602ca0db",
      });

      await expect(listener({ type: "baleen:normalize-product", extraction })).resolves.toEqual({
        kind: "error",
        code: outcome.runtime,
        provider: "groq",
      });
    }
  });

  it("reports the selected provider when normalization returns an invalid response", async () => {
    const providerStorage: ProviderApiKeyStorage = {
      getProvider: vi.fn(async () => "anthropic" as const),
      setProvider: vi.fn(async () => ({ kind: "success" as const })),
      getStatus: vi.fn(async () => ({ kind: "present" as const, mask: "••••••••" as const })),
      save: vi.fn(async () => ({ kind: "success" as const })),
      remove: vi.fn(async () => ({ kind: "success" as const })),
      readSecret: vi.fn(async () => "test-key"),
    };
    const listener = createNormalizationMessageListener({
      providerStorage,
      createModel: vi.fn(() => ({
        normalize: vi.fn(async () => ({ kind: "success" as const, text: "not-json" })),
      })),
      connection: { testConnection: vi.fn(async () => ({ kind: "success" as const })) },
      idFactory: () => "4c1ee929-6c05-42e8-bfdc-8dfb602ca0db",
    });

    await expect(listener({ type: "baleen:normalize-product", extraction })).resolves.toEqual({
      kind: "error",
      code: "invalid-response",
      provider: "anthropic",
    });
  });

  it("keeps the provider used by an in-flight request for every provider failure", async () => {
    const outcomes = [
      { result: { kind: "error" as const, code: "unauthorized" as const }, code: "unauthorized" },
      { result: { kind: "error" as const, code: "rate-limited" as const }, code: "quota" },
      { result: { kind: "error" as const, code: "network" as const }, code: "network" },
      { result: { kind: "error" as const, code: "unavailable" as const }, code: "unavailable" },
      { result: { kind: "success" as const, text: "not-json" }, code: "invalid-response" },
    ] as const;

    for (const outcome of outcomes) {
      let selectedProvider: "anthropic" | "groq" = "anthropic";
      let releaseNormalization: (() => void) | undefined;
      const normalizationPending = new Promise<void>((resolve) => {
        releaseNormalization = resolve;
      });
      const normalize = vi.fn(async () => {
        await normalizationPending;
        return outcome.result;
      });
      const providerStorage: ProviderApiKeyStorage = {
        getProvider: vi.fn(async () => selectedProvider),
        setProvider: vi.fn(async () => ({ kind: "success" as const })),
        getStatus: vi.fn(async () => ({ kind: "present" as const, mask: "••••••••" as const })),
        save: vi.fn(async () => ({ kind: "success" as const })),
        remove: vi.fn(async () => ({ kind: "success" as const })),
        readSecret: vi.fn(async () => "test-key"),
      };
      const listener = createNormalizationMessageListener({
        providerStorage,
        createModel: vi.fn(() => ({ normalize })),
        connection: { testConnection: vi.fn(async () => ({ kind: "success" as const })) },
        idFactory: () => "4c1ee929-6c05-42e8-bfdc-8dfb602ca0db",
      });

      const responsePromise = listener({ type: "baleen:normalize-product", extraction });
      await vi.waitFor(() => expect(normalize).toHaveBeenCalledOnce());
      selectedProvider = "groq";
      releaseNormalization?.();

      await expect(responsePromise).resolves.toEqual({
        kind: "error",
        code: outcome.code,
        provider: "anthropic",
      });
    }
  });

  it("tests the connection exactly once and maps unauthorized safely", async () => {
    const fake = deps({ kind: "error", code: "unavailable" });
    fake.connection.mockResolvedValue({ kind: "error", code: "unauthorized" });
    const listener = createNormalizationMessageListener(fake.dependencies);

    await expect(
      listener({ type: "baleen:test-connection", provider: "anthropic" }),
    ).resolves.toEqual({
      kind: "error",
      code: "unauthorized",
      provider: "anthropic",
    });
    expect(fake.connection).toHaveBeenCalledExactlyOnceWith("test-key");
    expect(fake.normalize).not.toHaveBeenCalled();
  });
});
