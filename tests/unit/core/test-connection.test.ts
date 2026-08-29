import { describe, expect, it, vi } from "vitest";

import {
  testStoredConnection,
  type ApiKeyConnectionPort,
  type ApiKeySecretPort,
} from "../../../src/core/test-connection";

function reader(value: unknown): ApiKeySecretPort {
  return { readSecret: vi.fn(async () => value) };
}

describe("testStoredConnection", () => {
  it("returns missing and invalid without calling the connection port", async () => {
    const connection: ApiKeyConnectionPort = {
      testConnection: vi.fn(async () => ({ kind: "success" as const })),
    };

    await expect(testStoredConnection(reader(undefined), connection)).resolves.toEqual({
      kind: "missing",
    });
    await expect(testStoredConnection(reader("  "), connection)).resolves.toEqual({
      kind: "invalid",
    });
    await expect(testStoredConnection(reader({}), connection)).resolves.toEqual({
      kind: "invalid",
    });
    expect(connection.testConnection).not.toHaveBeenCalled();
  });

  it("passes a trimmed valid key to the injected port and returns success only", async () => {
    const testConnection = vi.fn<ApiKeyConnectionPort["testConnection"]>(async () => ({
      kind: "success",
    }));

    await expect(
      testStoredConnection(reader("  user-secret-123  "), { testConnection }),
    ).resolves.toEqual({ kind: "success" });
    expect(testConnection).toHaveBeenCalledExactlyOnceWith("user-secret-123");
    expect(
      JSON.stringify(await testStoredConnection(reader("user-secret-123"), { testConnection })),
    ).not.toContain("user-secret-123");
  });

  it("preserves structured storage errors and maps connection failures", async () => {
    const quotaReader: ApiKeySecretPort = {
      readSecret: vi.fn(async () => {
        throw { kind: "error", code: "quota" };
      }),
    };
    const unavailableReader: ApiKeySecretPort = {
      readSecret: vi.fn(async () => {
        throw { kind: "error", code: "unavailable" };
      }),
    };

    await expect(
      testStoredConnection(quotaReader, {
        testConnection: vi.fn(async () => ({ kind: "success" as const })),
      }),
    ).resolves.toEqual({ kind: "quota" });
    await expect(
      testStoredConnection(unavailableReader, {
        testConnection: vi.fn(async () => ({ kind: "success" as const })),
      }),
    ).resolves.toEqual({ kind: "unavailable" });

    await expect(
      testStoredConnection(reader("key"), {
        testConnection: vi.fn(async () => ({ kind: "error", code: "unavailable" as const })),
      }),
    ).resolves.toEqual({ kind: "unavailable" });
    await expect(
      testStoredConnection(reader("key"), {
        testConnection: vi.fn(async () => {
          throw new Error("network detail");
        }),
      }),
    ).resolves.toEqual({ kind: "network" });
  });

  it("fails closed on a malformed connection response", async () => {
    for (const response of [
      undefined,
      null,
      { kind: "success", secret: "leaked" },
      { kind: "error" },
    ]) {
      await expect(
        testStoredConnection(reader("key"), {
          testConnection: vi.fn(async () => response),
        }),
      ).resolves.toEqual({ kind: "network" });
    }
  });
});
