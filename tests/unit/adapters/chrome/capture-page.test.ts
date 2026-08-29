import { describe, expect, it, vi } from "vitest";

import { captureActiveTab, type ChromeTabs } from "../../../../src/adapters/chrome/capture-page";

describe("captureActiveTab", () => {
  it("queries the active tab and sends the capture message", async () => {
    const result = {
      kind: "success",
      source: {
        url: "https://example.test/product",
        pageTitle: "Example product",
        capturedAt: "2026-08-28T12:00:00.000Z",
      },
      method: "json-ld",
      content: { "@type": "Product", name: "Example product" },
      truncated: false,
    } as const;
    const query = vi.fn<ChromeTabs["query"]>(async () => [{ id: 42 }]);
    const sendMessage = vi.fn<ChromeTabs["sendMessage"]>(async () => result);
    const tabs: ChromeTabs = { query, sendMessage };

    await expect(captureActiveTab(tabs)).resolves.toEqual(result);
    expect(query).toHaveBeenCalledExactlyOnceWith({ active: true, currentWindow: true });
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(42, { type: "baleen:capture" });
  });

  it("maps a missing active tab and transport failures to unavailable-page", async () => {
    const missingTabTabs: ChromeTabs = {
      query: vi.fn(async () => []),
      sendMessage: vi.fn(),
    };
    const queryFailureTabs: ChromeTabs = {
      query: vi.fn(async () => {
        throw new Error("query failed");
      }),
      sendMessage: vi.fn(),
    };
    const sendFailureTabs: ChromeTabs = {
      query: vi.fn(async () => [{ id: 7 }]),
      sendMessage: vi.fn(async () => {
        throw new Error("send failed");
      }),
    };

    await expect(captureActiveTab(missingTabTabs)).resolves.toEqual({
      kind: "error",
      code: "unavailable-page",
    });
    await expect(captureActiveTab(queryFailureTabs)).resolves.toEqual({
      kind: "error",
      code: "unavailable-page",
    });
    await expect(captureActiveTab(sendFailureTabs)).resolves.toEqual({
      kind: "error",
      code: "unavailable-page",
    });
  });

  it("maps malformed runtime responses to unavailable-page", async () => {
    const malformedResponses = [
      {
        kind: "success",
        source: {
          url: "https://example.test/product",
          pageTitle: "Example product",
          capturedAt: "2026-08-28T12:00:00.000Z",
        },
        method: "json-ld",
        content: "not a JSON-LD object",
        truncated: false,
      },
      { kind: "error", code: "unknown-error" },
    ] as const;

    for (const malformedResponse of malformedResponses) {
      const tabs: ChromeTabs = {
        query: vi.fn(async () => [{ id: 9 }]),
        sendMessage: vi.fn(async () => malformedResponse),
      };

      await expect(captureActiveTab(tabs)).resolves.toEqual({
        kind: "error",
        code: "unavailable-page",
      });
    }
  });
});
