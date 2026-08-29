import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";

import { createProviderStorage } from "../../src/adapters/chrome/api-key-storage";
import { OptionsPage } from "../../src/ui/options-page";
import { createOptionsCallbacks } from "../../src/ui/options-callbacks";
import "../../src/ui/styles.css";

const app = document.getElementById("app");

if (!app) {
  throw new Error("Options page mount point is missing.");
}

const providerStorage = createProviderStorage(browser.storage.local);

createRoot(app).render(
  <StrictMode>
    <OptionsPage callbacks={createOptionsCallbacks(providerStorage, browser.runtime)} />
  </StrictMode>,
);
