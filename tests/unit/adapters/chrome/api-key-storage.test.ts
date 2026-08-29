import { describe, expect, it, vi } from "vitest";

import {
  API_KEY_STORAGE_KEY,
  createApiKeySecretReader,
  createApiKeyStatusStore,
  type ChromeStorageLocal,
} from "../../../../src/adapters/chrome/api-key-storage";
import { API_KEY_MASK } from "../../../../src/core/api-key";

function storage(get: ChromeStorageLocal["get"]): ChromeStorageLocal {
  return {
    get,
    set: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  };
}

describe("API key storage", () => {
  it("reports only a fixed mask for a valid stored key", async () => {
    const key = "secret-value-987";
    const store = createApiKeyStatusStore(
      storage(async () => ({ [API_KEY_STORAGE_KEY]: `  ${key}  ` })),
    );

    const status = await store.getStatus();

    expect(status).toEqual({ kind: "present", mask: API_KEY_MASK });
    expect(JSON.stringify(status)).not.toContain(key);
  });

  it("distinguishes missing and corrupt values", async () => {
    await expect(createApiKeyStatusStore(storage(async () => ({}))).getStatus()).resolves.toEqual({
      kind: "missing",
    });
    await expect(
      createApiKeyStatusStore(storage(async () => ({ [API_KEY_STORAGE_KEY]: 17 }))).getStatus(),
    ).resolves.toEqual({ kind: "invalid" });
    await expect(createApiKeyStatusStore(storage(async () => null)).getStatus()).resolves.toEqual({
      kind: "invalid",
    });
  });

  it("does not write an invalid value and trims valid input", async () => {
    const storePort = storage(async () => ({}));
    const store = createApiKeyStatusStore(storePort);

    await expect(store.save("   ")).resolves.toEqual({ kind: "invalid" });
    expect(storePort.set).not.toHaveBeenCalled();

    await expect(store.save("  user-key  ")).resolves.toEqual({ kind: "success" });
    expect(storePort.set).toHaveBeenCalledExactlyOnceWith({ [API_KEY_STORAGE_KEY]: "user-key" });
  });

  it("maps quota and unavailable storage failures without exposing details", async () => {
    const quota = storage(async () => {
      throw { name: "QuotaExceededError", detail: "secret transport detail" };
    });
    const unavailable = storage(async () => {
      throw new Error("backend detail");
    });

    await expect(createApiKeyStatusStore(quota).getStatus()).resolves.toEqual({
      kind: "error",
      code: "quota",
    });
    await expect(createApiKeyStatusStore(unavailable).getStatus()).resolves.toEqual({
      kind: "error",
      code: "unavailable",
    });
  });

  it("removes only the API key storage entry", async () => {
    const storePort = storage(async () => ({}));
    const store = createApiKeyStatusStore(storePort);

    await expect(store.remove()).resolves.toEqual({ kind: "success" });
    expect(storePort.remove).toHaveBeenCalledExactlyOnceWith(API_KEY_STORAGE_KEY);
  });

  it("keeps secret reading on a separate worker-only port", async () => {
    const key = "worker-secret";
    const storePort = storage(async () => ({ [API_KEY_STORAGE_KEY]: key }));
    const reader = createApiKeySecretReader(storePort);

    await expect(reader.readSecret()).resolves.toBe(key);
  });
});
