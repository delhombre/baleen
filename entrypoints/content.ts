import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";

import { registerCaptureContentScript } from "../src/adapters/chrome/content-script";

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_idle",
  allFrames: false,
  world: "ISOLATED",
  noScriptStartedPostMessage: true,
  main() {
    registerCaptureContentScript(browser.runtime, document, window.location);
  },
});
