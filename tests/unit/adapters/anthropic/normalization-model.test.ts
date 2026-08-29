import { describe, expect, it, vi } from "vitest";

import {
  createAnthropicConnectionPort,
  createAnthropicNormalizationModel,
  type AnthropicClientFactory,
} from "../../../../src/adapters/anthropic/normalization-model";
import { parseApiKey } from "../../../../src/core/api-key";
import type {
  NormalizationRequest,
  NormalizationModelResponse,
} from "../../../../src/core/normalization";

const request: NormalizationRequest = {
  prompt: "Return only the selection.",
  evidence: {
    version: 1,
    items: [{ id: "e1", kind: "name", text: "A product" }],
  },
};

function fakeFactory(response: unknown): {
  readonly factory: AnthropicClientFactory;
  readonly create: ReturnType<typeof vi.fn>;
  readonly options: () => unknown;
} {
  const create = vi.fn(async () => response);
  let options: unknown;
  const factory: AnthropicClientFactory = (receivedOptions) => {
    options = receivedOptions;
    return { messages: { create } };
  };
  return { factory, create, options: () => options };
}

describe("Anthropic normalization model adapter", () => {
  it("uses one minimal request for the connection test", async () => {
    const fake = fakeFactory({ content: [{ type: "text", text: "OK" }] });
    const port = createAnthropicConnectionPort({
      apiKey: "sk-secret-test-key",
      sdkFactory: fake.factory,
    });
    const key = parseApiKey("sk-secret-test-key");
    if (key === undefined) {
      throw new Error("Test key should be valid.");
    }

    await expect(port.testConnection(key)).resolves.toEqual({ kind: "success" });
    expect(fake.create).toHaveBeenCalledExactlyOnceWith({
      model: "claude-sonnet-4-6",
      max_tokens: 1,
      system: "Reply with OK.",
      messages: [{ role: "user", content: "connection test" }],
      stream: false,
    });
  });

  it("creates a configured SDK client and sends a system prompt plus bounded user evidence", async () => {
    const fake = fakeFactory({ content: [{ type: "text", text: ' {"version":1} ' }] });
    const model = createAnthropicNormalizationModel({
      apiKey: "sk-secret-test-key",
      sdkFactory: fake.factory,
    });

    await expect(model.normalize(request)).resolves.toEqual({
      kind: "success",
      text: ' {"version":1} ',
    });
    expect(fake.options()).toEqual({
      apiKey: "sk-secret-test-key",
      maxRetries: 0,
      timeout: 60_000,
      logLevel: "off",
    });
    expect(fake.create).toHaveBeenCalledExactlyOnceWith({
      model: "claude-sonnet-4-6",
      max_tokens: 2_048,
      system: request.prompt,
      messages: [
        {
          role: "user",
          content: JSON.stringify({ evidence: request.evidence }),
        },
      ],
      stream: false,
    });
    expect(JSON.stringify(fake.create.mock.calls)).not.toContain("sk-secret-test-key");
  });

  it("includes only structured repair codes in the user message", async () => {
    const fake = fakeFactory({ content: [{ type: "text", text: "{}" }] });
    const model = createAnthropicNormalizationModel("sk-secret-test-key", fake.factory);

    await model.normalize({ ...request, repair: { codes: ["invalid-json"] } });

    expect(fake.create.mock.calls[0]?.[0]).toMatchObject({
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            evidence: request.evidence,
            repair: { codes: ["invalid-json"] },
          }),
        },
      ],
    });
  });

  it("maps SDK transport failures to stable core codes without exposing details", async () => {
    const errors: readonly [string, Error, NormalizationModelResponse][] = [
      ["unauthorized", new Error("not used"), { kind: "error", code: "unauthorized" }],
      ["rate-limited", new Error("not used"), { kind: "error", code: "rate-limited" }],
    ];

    for (const [code, error, expected] of errors) {
      const fake = fakeFactory(undefined);
      fake.create.mockRejectedValueOnce(
        Object.assign(error, { status: code === "unauthorized" ? 401 : 429 }),
      );
      const model = createAnthropicNormalizationModel({
        apiKey: "sk-secret-test-key",
        sdkFactory: fake.factory,
      });

      await expect(model.normalize(request)).resolves.toEqual(expected);
      expect(JSON.stringify(await model.normalize(request))).not.toContain("sk-secret-test-key");
    }
  });

  it("maps timeout, connection, server, and unknown failures without exposing details", async () => {
    const failures: readonly [unknown, NormalizationModelResponse][] = [
      [
        { name: "AbortError", message: "secret timeout" },
        { kind: "error", code: "timeout" },
      ],
      [
        { name: "APIConnectionError", message: "secret network detail" },
        { kind: "error", code: "network" },
      ],
      [
        { status: 503, body: "secret server detail" },
        { kind: "error", code: "unavailable" },
      ],
      [new Error("secret unknown detail"), { kind: "error", code: "unavailable" }],
    ];

    for (const [failure, expected] of failures) {
      const fake = fakeFactory(undefined);
      fake.create.mockRejectedValueOnce(failure);
      const model = createAnthropicNormalizationModel({
        apiKey: "sk-secret-test-key",
        sdkFactory: fake.factory,
      });

      const result = await model.normalize(request);

      expect(result).toEqual(expected);
      expect(JSON.stringify(result)).not.toContain("secret");
    }
  });

  it("rejects malformed content blocks safely", async () => {
    const contents: readonly unknown[][] = [
      [],
      [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ],
      [{ type: "tool_use", input: {} }],
      [{ type: "text", text: "   " }],
    ];

    for (const content of contents) {
      const fake = fakeFactory({ content });
      const model = createAnthropicNormalizationModel({
        apiKey: "sk-secret-test-key",
        sdkFactory: fake.factory,
      });

      const result = await model.normalize(request);

      expect(result).toEqual({ kind: "error", code: "unavailable" });
      expect(result).not.toHaveProperty("message");
    }
  });
});
