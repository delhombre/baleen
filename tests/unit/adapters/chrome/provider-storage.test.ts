import { describe, expect, it } from "vitest";

import {
  ANTHROPIC_API_KEY_STORAGE_KEY,
  GROQ_API_KEY_STORAGE_KEY,
  LEGACY_API_KEY_STORAGE_KEY,
  LLM_PROVIDER_STORAGE_KEY,
  createProviderStorage,
  type ChromeStorageLocal,
} from "../../../../src/adapters/chrome/api-key-storage";

function memoryStorage(
  initial: Record<string, unknown> = {},
  removeFailure = false,
): ChromeStorageLocal & {
  readonly values: Record<string, unknown>;
  readonly removeCalls: number;
} {
  const values = { ...initial };
  let removeCalls = 0;
  return {
    values,
    get removeCalls() {
      return removeCalls;
    },
    async get(key: string): Promise<unknown> {
      return Object.prototype.hasOwnProperty.call(values, key) ? { [key]: values[key] } : {};
    },
    async set(items: Record<string, string>): Promise<void> {
      Object.assign(values, items);
    },
    async remove(key: string): Promise<void> {
      removeCalls += 1;
      if (removeFailure) {
        throw new Error("cleanup failed");
      }
      delete values[key];
    },
  };
}

describe("provider storage", () => {
  it("defaults to Anthropic and persists an explicit provider", async () => {
    const storage = memoryStorage();
    const providers = createProviderStorage(storage);

    await expect(providers.getProvider()).resolves.toBe("anthropic");
    await expect(providers.setProvider("groq")).resolves.toEqual({ kind: "success" });
    await expect(providers.getProvider()).resolves.toBe("groq");
    expect(storage.values[LLM_PROVIDER_STORAGE_KEY]).toBe("groq");
  });

  it("migrates the legacy apiKey into the namespaced Anthropic entry without exposing it", async () => {
    const secret = "sk-legacy-secret";
    const storage = memoryStorage({ [LEGACY_API_KEY_STORAGE_KEY]: secret });
    const providers = createProviderStorage(storage);

    await expect(providers.readSecret("anthropic")).resolves.toBe(secret);
    expect(storage.values[ANTHROPIC_API_KEY_STORAGE_KEY]).toBe(secret);
    expect(storage.values[LEGACY_API_KEY_STORAGE_KEY]).toBeUndefined();
    expect(JSON.stringify(await providers.getStatus("anthropic"))).not.toContain(secret);
  });

  it("keeps Groq secrets isolated from Anthropic and validates provider keys", async () => {
    const storage = memoryStorage();
    const providers = createProviderStorage(storage);

    await expect(providers.save("groq", "gsk-test-secret")).resolves.toEqual({ kind: "success" });
    await expect(providers.readSecret("groq")).resolves.toBe("gsk-test-secret");
    await expect(providers.readSecret("anthropic")).resolves.toBeUndefined();
    expect(storage.values[GROQ_API_KEY_STORAGE_KEY]).toBe("gsk-test-secret");
    await expect(providers.setProvider("unsupported")).resolves.toEqual({ kind: "invalid" });
    expect(storage.values[LLM_PROVIDER_STORAGE_KEY]).toBeUndefined();
  });

  it("keeps a namespaced Anthropic key authoritative and reports legacy cleanup failure", async () => {
    const namespaced = "sk-current-secret";
    const legacy = "sk-legacy-secret";
    const storage = memoryStorage(
      {
        [ANTHROPIC_API_KEY_STORAGE_KEY]: namespaced,
        [LEGACY_API_KEY_STORAGE_KEY]: legacy,
      },
      true,
    );
    const providers = createProviderStorage(storage);

    await expect(providers.readSecret("anthropic")).rejects.toEqual({
      kind: "error",
      code: "unavailable",
    });
    expect(storage.values[ANTHROPIC_API_KEY_STORAGE_KEY]).toBe(namespaced);
    expect(storage.values[LEGACY_API_KEY_STORAGE_KEY]).toBe(legacy);
    expect(storage.removeCalls).toBe(1);
  });

  it("deletes a coexisting legacy key after the namespaced key has been read", async () => {
    const namespaced = "sk-current-secret";
    const storage = memoryStorage({
      [ANTHROPIC_API_KEY_STORAGE_KEY]: namespaced,
      [LEGACY_API_KEY_STORAGE_KEY]: "sk-legacy-secret",
    });
    const providers = createProviderStorage(storage);

    await expect(providers.readSecret("anthropic")).resolves.toBe(namespaced);
    expect(storage.values[ANTHROPIC_API_KEY_STORAGE_KEY]).toBe(namespaced);
    expect(storage.values[LEGACY_API_KEY_STORAGE_KEY]).toBeUndefined();
    expect(storage.removeCalls).toBe(1);
  });
});
