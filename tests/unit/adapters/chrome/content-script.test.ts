import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";

import {
  registerCaptureContentScript,
  type CaptureRuntime,
  type CaptureRuntimeListener,
} from "../../../../src/adapters/chrome/content-script";

describe("registerCaptureContentScript", () => {
  it("answers the capture message with one provenance timestamp", () => {
    const { document } = parseHTML(`
      <html>
        <head>
          <title>Northstar QuietClean Cordless Vacuum | Northstar Home</title>
        </head>
        <body>
          <main>
            <h1>Northstar QuietClean Cordless Vacuum</h1>
            <p class="product-price">€379.00</p>
            <table>
              <tr><th>Battery runtime</th><td>60 minutes</td></tr>
              <tr><th>Dust capacity</th><td>0.7 L</td></tr>
            </table>
          </main>
        </body>
      </html>
    `);
    let listener: CaptureRuntimeListener | undefined;
    const runtime: CaptureRuntime = {
      onMessage: {
        addListener: (registeredListener) => {
          listener = registeredListener;
        },
      },
    };
    const now = vi.fn(() => "2026-08-28T12:34:56.000Z");
    const sendResponse = vi.fn();

    registerCaptureContentScript(
      runtime,
      document,
      { href: "http://127.0.0.1:4321/vacuum-no-jsonld.html" },
      now,
    );
    listener?.({ type: "baleen:capture" }, {}, sendResponse);

    expect(now).toHaveBeenCalledExactlyOnceWith();
    expect(sendResponse).toHaveBeenCalledExactlyOnceWith({
      kind: "success",
      source: {
        url: "http://127.0.0.1:4321/vacuum-no-jsonld.html",
        pageTitle: "Northstar QuietClean Cordless Vacuum | Northstar Home",
        capturedAt: "2026-08-28T12:34:56.000Z",
      },
      method: "dom-fallback",
      content:
        "Title: Northstar QuietClean Cordless Vacuum\nPrices:\n- €379.00\nSpecifications:\n- Battery runtime: 60 minutes\n- Dust capacity: 0.7 L",
      truncated: false,
    });
  });

  it("ignores unrelated runtime messages", () => {
    const { document } = parseHTML("<html></html>");
    let listener: CaptureRuntimeListener | undefined;
    const runtime: CaptureRuntime = {
      onMessage: {
        addListener: (registeredListener) => {
          listener = registeredListener;
        },
      },
    };
    const sendResponse = vi.fn();

    registerCaptureContentScript(runtime, document, { href: "https://example.test/" }, () => "now");
    listener?.({ type: "other-message" }, {}, sendResponse);

    expect(sendResponse).not.toHaveBeenCalled();
  });
});
