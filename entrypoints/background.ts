import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";

import {
  createAnthropicConnectionPort,
  createAnthropicNormalizationModel,
} from "../src/adapters/anthropic/normalization-model";
import { createProviderStorage } from "../src/adapters/chrome/api-key-storage";
import { createNormalizationMessageListener } from "../src/adapters/chrome/normalization-handler";
import { configureSidePanel } from "../src/adapters/chrome/side-panel";
import {
  createGroqConnectionPort,
  createGroqNormalizationModel,
} from "../src/adapters/groq/normalization-model";

export default defineBackground(() => {
  const sidePanelReady = configureSidePanel(browser.sidePanel);

  const providerStorage = createProviderStorage(browser.storage.local);
  const listener = createNormalizationMessageListener({
    providerStorage,
    createModel: (apiKey) => createAnthropicNormalizationModel({ apiKey }),
    connection: {
      testConnection: (apiKey) => createAnthropicConnectionPort({ apiKey }).testConnection(apiKey),
    },
    createGroqModel: (apiKey) => createGroqNormalizationModel({ apiKey }),
    groqConnection: {
      testConnection: (apiKey) => createGroqConnectionPort({ apiKey }).testConnection(apiKey),
    },
    idFactory: () => crypto.randomUUID(),
  });
  browser.runtime.onMessage.addListener((message: unknown) =>
    sidePanelReady.then(() => listener(message)),
  );
});
